const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SudokuConstraintHandler, InvalidConstraintError } = await import('./handlers.js' + self.VERSION_PARAM);

export const NO_CELL = 0xffff;

// Flat 4-neighbour table for the `numCells` cells from `cellOffset`, taken from
// the geometry's cell graph: neighbors[i * 4 + dir] is the layer-local index
// of position i's neighbour (dir: 0 left, 1 right, 2 up, 3 down, as in
// CellGraph), or `sentinel` where the graph has none. Cached per graph.
const neighborTableCache = new WeakMap();
const neighborTableFor = (geometry, cellOffset, numCells, sentinel) => {
  const graph = geometry.cellGraph();
  let tables = neighborTableCache.get(graph);
  if (!tables) neighborTableCache.set(graph, tables = new Map());
  const key = `${cellOffset}:${numCells}:${sentinel}`;
  let neighbors = tables.get(key);
  if (neighbors) return neighbors;

  neighbors = new Uint16Array(numCells * 4).fill(sentinel);
  for (let i = 0; i < numCells; i++) {
    const edges = graph.cellEdges(cellOffset + i);
    for (let dir = 0; dir < 4; dir++) {
      const neighbor = edges[dir];
      if (neighbor !== null) neighbors[i * 4 + dir] = neighbor - cellOffset;
    }
  }
  tables.set(key, neighbors);
  return neighbors;
};

// Full grid, using NO_CELL at the edges.
export const neighborTable = (geometry) =>
  neighborTableFor(geometry, 0, geometry.numGridCells, NO_CELL);

// A cell layer whose missing-neighbour sentinel is `numCells` — a permanently
// EXCLUDED states slot, so traversals need no edge checks.
const layerNeighborTable = (geometry, cellOffset, numCells) =>
  neighborTableFor(geometry, cellOffset, numCells, numCells);

// `cell`'s in-grid neighbours if every one of them is in `cellSet`, else null.
export const enclosingNeighbors = (gridNeighbors, cell, cellSet) => {
  const base = cell * 4;
  const neighbors = [];
  for (let dir = 0; dir < 4; dir++) {
    const neighbor = gridNeighbors[base + dir];
    if (neighbor === NO_CELL) continue;
    if (!cellSet.has(neighbor)) return null;
    neighbors.push(neighbor);
  }
  return neighbors;
};

// Bit 0 = "may hold an in-set value", bit 1 = "certainly holds one".
const EXCLUDED = 0;
const UNDECIDED = 1;
const DECIDED = 3;
const VISITED = 4;

// "Several doors". Sorts above any real cell index but below NO_CELL, so
// `door >= MULTI_DOOR` means "nothing to force".
const MULTI_DOOR = 0xfffe;

// Enforces that, for each of its value sets, the cells holding one of the
// set's values form a single non-empty orthogonally-connected region.
//
// See handler_docs/connected_values.md for the algorithm and its soundness
// arguments; § references below are into that document.
export class ConnectedValues extends SudokuConstraintHandler {
  // `sets` maps each value set to its exact region size (0/null =
  // unconstrained). Sets are pairwise disjoint; a multi-value set must be
  // the only one.
  constructor(numCells, cellOffset, sets) {
    const cells = new Uint16Array(numCells);
    for (let i = 0; i < numCells; i++) cells[i] = cellOffset + i;
    super(cells);

    this._sets = sets;
    this._valueMasks = null;
    this._sizes = null;
    this._neighbors = null;
    this._traversalBuffer = null;
    this._states = null;
  }

  sets() {
    return this._sets;
  }

  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    const lookupTables = LookupTables.get(geometry.numValues);
    this._valueMasks = [...this._sets.keys()].map((values) => {
      const valueMask = LookupTables.fromOffsetValuesArray(
        values, geometry.valueOffset);
      if (!valueMask || (valueMask & ~lookupTables.allValues)) {
        throw new InvalidConstraintError(
          'Connected Values values must be valid grid values.');
      }
      return valueMask;
    });
    this._sizes = [...this._sets.values()].map(size => size || 0);
    // With multiple sets, a decided cell's candidates must identify one set.
    const numSets = this._valueMasks.length;
    let allSetsMask = 0;
    for (const mask of this._valueMasks) {
      if (mask & allSetsMask) {
        throw new InvalidConstraintError(
          'Connected Values sets must be disjoint.');
      }
      allSetsMask |= mask;
    }
    if (numSets > 1 &&
      !this._valueMasks.every((mask) => !(mask & (mask - 1)))) {
      throw new InvalidConstraintError(
        'Connected Values multi-value sets must be the only set.');
    }

    const numCells = this.cells.length;
    const cellOffset = this.cells[0];
    // The grid, or a whole var-cell group; the cell graph carries each layer's
    // own adjacency. With no main grid (a primary cell group), offset 0 is the
    // first var group, not the grid.
    const layerCount = cellOffset === 0 && geometry.numGridCells ?
      geometry.numGridCells :
      geometry.varCellGroups().find((g) => g.cells[0] === cellOffset)?.count;
    if (layerCount !== numCells) {
      throw new InvalidConstraintError(
        'Connected Values must cover the grid or a whole var-cell group.');
    }
    this._neighbors = layerNeighborTable(geometry, cellOffset, numCells);
    this._traversalBuffer = new Uint16Array(numCells);
    this._states = new Uint8Array(numCells + 1);

    // Disjoint sets need disjoint regions: sizes summing past the layer are
    // unsatisfiable.
    return this._sizes.reduce((a, b) => a + b, 0) <= numCells;
  }

  enforceConsistency(grid, pQueue) {
    const numSets = this._valueMasks.length;
    for (let s = 0; s < numSets; s++) {
      if (!this._enforceSet(grid, pQueue, s)) return false;
    }
    return true;
  }

  _enforceSet(grid, pQueue, s) {
    const cellOffset = this.cells[0];
    const numCells = this.cells.length;
    const valueMask = this._valueMasks[s];
    const size = this._sizes[s];
    const states = this._states;

    // Any decided cell can seed the search (§3).
    let numPossible = 0;
    let numDecided = 0;
    let firstPossible = 0;
    let seedCell = 0;
    for (let i = 0; i < numCells; i++) {
      const value = grid[cellOffset + i];
      if (!(value & valueMask)) {
        states[i] = EXCLUDED;
        continue;
      }
      if (!numPossible) firstPossible = i;
      numPossible++;
      if (value & ~valueMask) {
        states[i] = UNDECIDED;
      } else {
        states[i] = DECIDED;
        numDecided++;
        seedCell = i;
      }
    }

    // The region holds every decided cell, `size` cells if given, and at
    // least one cell (§7.1).
    if (size && numDecided > size) return false;
    const target = size || Math.max(numDecided, 1);
    if (numPossible < target) return false;
    if (numDecided === 0) {
      // No seed, nothing to deduce — unless every possible cell is in the
      // region (§7.3): then the first seeds the search that decides the rest.
      if (numPossible > target) return true;
      this._resolveUndecidedState(
        grid, pQueue, valueMask, UNDECIDED, DECIDED, 1);
      numDecided = 1;
      seedCell = firstPossible;
    }

    // Prune what the search cannot reach; a size bounds the path cost (§7.2).
    // Forcing needs an incomplete region: a size, or a second blob (§7.4).
    const budget = size ? size - numDecided : numCells;
    const minBlobs = size ? 1 : 2;
    const reached = this._reach(
      budget, seedCell, numDecided, numPossible, minBlobs);
    if (reached < 0) return false;
    const pruned = numPossible - numDecided - (reached >> 1);
    if (pruned) {
      this._resolveUndecidedState(
        grid, pQueue, valueMask, UNDECIDED, EXCLUDED, pruned);
      numPossible -= pruned;
    }
    if (numPossible < target) return false;
    if (numPossible === target) {
      // All possible cells are in the region (§7.3).
      if (numDecided < numPossible) {
        this._resolveUndecidedState(grid, pQueue, valueMask,
          UNDECIDED | VISITED, DECIDED, numPossible - numDecided);
      }
      return true;
    }

    // Force only when a round will act (§4.4); overshooting a size fails (§4.2).
    if (!(reached & 1)) return true;
    numDecided = this._forceDoors(
      grid, pQueue, valueMask, numDecided, minBlobs, size || numPossible);
    if (!size || numDecided < size) return true;
    if (numDecided > size) return false;

    // Exactly full: the decided cells must be connected, and the rest leave.
    for (let i = 0; i < numCells; i++) states[i] &= ~VISITED;
    if (this._reach(0, seedCell, numDecided, numPossible, 1) < 0) return false;
    this._resolveUndecidedState(
      grid, pQueue, valueMask, UNDECIDED, EXCLUDED, numPossible - numDecided);
    return true;
  }

  // Breadth-first search from the seed, marking reached cells VISITED. Decided
  // cells are free; each undecided cell costs one of `budget` (§7.2). Undecided
  // queue at the buffer's front, blob stack at its back (§6).
  // Returns -1 if a decided cell is unreached, else undecidedSeen << 1, with
  // bit 0 set when forcing would act: a single-door blob and >= minBlobs blobs.
  _reach(budget, seedCell, numDecided, numPossible, minBlobs) {
    const numCells = this.cells.length;
    const neighbors = this._neighbors;
    const buffer = this._traversalBuffer;
    const states = this._states;

    let head = 0;
    let levelEnd = 0;
    let queueEnd = 0;
    let remainingBudget = budget;
    let decidedSeen = 0;
    let undecidedSeen = 0;
    let numBlobs = 0;
    let anySingleDoor = false;
    let seed = seedCell;

    while (true) {
      if (seed !== NO_CELL) {
        // Walk the blob. Neighbours past the budget stay unmarked, to be pruned.
        numBlobs++;
        let door = NO_CELL;
        let stackTop = numCells;
        buffer[--stackTop] = seed;
        states[seed] = DECIDED | VISITED;
        decidedSeen++;
        while (stackTop < numCells) {
          const offset = buffer[stackTop++] << 2;
          for (let dir = 0; dir < 4; dir++) {
            const neighbor = neighbors[offset + dir];
            const state = states[neighbor];
            if (state === DECIDED) {
              states[neighbor] = DECIDED | VISITED;
              decidedSeen++;
              buffer[--stackTop] = neighbor;
            } else if ((state & DECIDED) === UNDECIDED) {
              // Undecided, marked or not (§6).
              if (state === UNDECIDED) {
                if (remainingBudget <= 0) continue;
                states[neighbor] = UNDECIDED | VISITED;
                buffer[queueEnd++] = neighbor;
                undecidedSeen++;
              }
              if (door !== neighbor) {
                door = door === NO_CELL ? neighbor : MULTI_DOOR;
              }
            }
          }
        }
        anySingleDoor ||= door < MULTI_DOOR;
        seed = NO_CELL;
        continue;
      }

      if (head === queueEnd || decidedSeen + undecidedSeen === numPossible) break;
      if (head === levelEnd) {
        levelEnd = queueEnd;
        // Past the budget only unseen decided cells matter.
        if (--remainingBudget <= 0 && decidedSeen === numDecided) break;
      }

      // Walk a blob first, then re-read this cell, so it is counted once (§3.1).
      const offset = buffer[head] << 2;
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighbors[offset + dir];
        const state = states[neighbor];
        if (state === DECIDED) {
          seed = neighbor;
          break;
        }
        if (state === UNDECIDED && remainingBudget > 0) {
          states[neighbor] = UNDECIDED | VISITED;
          buffer[queueEnd++] = neighbor;
          undecidedSeen++;
        }
      }
      if (seed === NO_CELL) head++;
    }

    if (decidedSeen < numDecided) return -1;
    return (undecidedSeen << 1) | +(anySingleDoor && numBlobs >= minBlobs);
  }

  // Resolves the first `count` undecided cells in `fromState` into or out of
  // the set, per `toState`. Never empties a domain: an undecided cell holds
  // candidates on both sides of the value mask.
  _resolveUndecidedState(grid, pQueue, valueMask, fromState, toState, count) {
    const cellOffset = this.cells[0];
    const states = this._states;
    const mask = toState === DECIDED ? valueMask : ~valueMask;
    for (let i = 0; count; i++) {
      if (states[i] !== fromState) continue;
      states[i] = toState;
      grid[cellOffset + i] &= mask;
      pQueue.addForCell(cellOffset + i);
      count--;
    }
  }

  // Door-forcing rounds to a fixed point (§4.3), stopping once `maxDecided`
  // is reached. Returns the final decided count.
  _forceDoors(grid, pQueue, valueMask, numDecided, minBlobs, maxDecided) {
    const cellOffset = this.cells[0];
    const numCells = this.cells.length;
    const neighbors = this._neighbors;
    const buffer = this._traversalBuffer;
    const states = this._states;

    while (true) {
      // The scan marks cells VISITED; start each round from clear marks.
      for (let i = 0; i < numCells; i++) states[i] &= ~VISITED;

      // Each blob's door goes in one slot at the front of `buffer`; the blob
      // walk stacks from the back (§6). Doors are applied after the scan, so
      // all come from the same snapshot (§4.2).
      let numBlobs = 0;
      let numVisited = 0;
      for (let i = 0; i < numCells && numVisited < numDecided; i++) {
        if (states[i] !== DECIDED) continue;

        let door = NO_CELL;
        let stackTop = numCells;
        buffer[--stackTop] = i;
        states[i] = DECIDED | VISITED;
        numVisited++;
        while (stackTop < numCells) {
          const cell = buffer[stackTop++];
          const offset = cell << 2;
          for (let dir = 0; dir < 4; dir++) {
            const neighbor = neighbors[offset + dir];
            const state = states[neighbor];
            if (state === DECIDED) {
              states[neighbor] = DECIDED | VISITED;
              numVisited++;
              buffer[--stackTop] = neighbor;
            } else if (state === UNDECIDED && door !== neighbor) {
              door = door === NO_CELL ? neighbor : MULTI_DOOR;
            }
          }
        }
        buffer[numBlobs++] = door;
      }
      if (numBlobs < minBlobs) return numDecided;

      let numForced = 0;
      for (let blobId = 0; blobId < numBlobs; blobId++) {
        const door = buffer[blobId];
        if (door >= MULTI_DOOR) continue;
        if (states[door] !== UNDECIDED) continue;

        states[door] = DECIDED | VISITED;
        grid[cellOffset + door] &= valueMask;
        pQueue.addForCell(cellOffset + door);
        numForced++;
      }
      if (!numForced) return numDecided;
      numDecided += numForced;
      if (numDecided >= maxDecided) return numDecided;
    }
  }

}

// Crossing rule (§5.2) over one 2x2 block `[nw, ne, sw, se]`: when one diagonal
// is decided into set X and one cell of the other diagonal into set Y ≠ X, the
// fourth cell cannot complete the checkerboard by taking Y.
export class ConnectedCrossing extends SudokuConstraintHandler {
  constructor(cells, values) {
    super(cells);
    this._values = values;
    this._setMask = 0;
  }

  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    this._setMask = LookupTables.fromOffsetValuesArray(
      this._values, geometry.valueOffset);
    return true;
  }

  enforceConsistency(grid, pQueue) {
    const cells = this.cells;
    const setMask = this._setMask;
    const nw = grid[cells[0]];
    const ne = grid[cells[1]];
    const sw = grid[cells[2]];
    const se = grid[cells[3]];

    let target = 0;
    let forbidden = 0;
    // Raw equality is checked before proving that the matching candidates are
    // a single set bit with no other candidates.
    if (nw === se && (nw & setMask) && !(nw & (nw - 1))) {
      if (ne !== nw && (ne & setMask) && !(ne & (ne - 1))) {
        target = cells[2]; forbidden = ne;
      } else if (sw !== nw && (sw & setMask) && !(sw & (sw - 1))) {
        target = cells[1]; forbidden = sw;
      }
    } else if (ne === sw && (ne & setMask) && !(ne & (ne - 1))) {
      if (nw !== ne && (nw & setMask) && !(nw & (nw - 1))) {
        target = cells[3]; forbidden = nw;
      } else if (se !== ne && (se & setMask) && !(se & (se - 1))) {
        target = cells[0]; forbidden = se;
      }
    }
    if (forbidden && (grid[target] & forbidden)) {
      const restricted = grid[target] & ~forbidden;
      if (!restricted) return false;
      grid[target] = restricted;
      pQueue.addForCell(target);
    }
    return true;
  }
}

// Border rule (§5.3) over the perimeter `cells` in cyclic order: at most 2
// transitions between set tokens around the perimeter.
export class ConnectedBorder extends SudokuConstraintHandler {
  constructor(cells, values) {
    super(cells);
    this._values = values;
    this._setMask = 0;
  }

  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    if (this._values.length !== 2) {
      throw new InvalidConstraintError(
        'Connected border rule requires exactly two values.');
    }
    this._setMask = LookupTables.fromOffsetValuesArray(
      this._values, geometry.valueOffset);
    return true;
  }

  enforceConsistency(grid, pQueue) {
    const cells = this.cells;
    const numPerimeter = cells.length;
    const setMask = this._setMask;

    // Anchor both passes at any decided border cell; with none, at most one
    // set touches the border and there is nothing to do.
    let start = 0;
    while (start < numPerimeter) {
      const v = grid[cells[start]];
      if ((v & setMask) && !(v & (v - 1))) break;
      start++;
    }
    if (start === numPerimeter) return true;
    const first = grid[cells[start]];

    // Search pass: count cyclic transitions between decided cells' owner
    // tokens (>2 ⇒ interleave, fail), and note whether any same-set gap holds
    // the other set (§5.3).
    let prev = first;
    let transitions = 0;
    let gapUnion = 0;
    let needsStrip = false;
    for (let step = 1; step <= numPerimeter; step++) {
      let j = start + step;
      if (j >= numPerimeter) j -= numPerimeter;
      const v = grid[cells[j]];
      if (v === prev) {
        if (gapUnion & (setMask ^ v)) needsStrip = true;
        gapUnion = 0;
        continue;
      }
      if (!(v & setMask) || (v & (v - 1))) {  // not decided into a set: a gap
        gapUnion |= v;
        continue;
      }
      if (++transitions > 2) return false;
      prev = v;
      gapUnion = 0;
    }
    if (transitions === 0) return true;
    if (!needsStrip) return true;

    // Enforcement pass: the same lap, stripping each gap flanked by matching
    // tokens. One lap reaches the fixed point (§5.3).
    let prevToken = first;
    let gapStart = start + 1;
    for (let step = 1; step <= numPerimeter; step++) {
      let j = start + step;
      if (j >= numPerimeter) j -= numPerimeter;
      const v = grid[cells[j]];
      if (v === prevToken) {
        const stripMask = setMask ^ v;
        for (let i = gapStart; i !== j;) {
          const cell = cells[i];
          const value = grid[cell];
          if (value & stripMask) {
            const restricted = value & ~stripMask;
            if (!restricted) return false;
            grid[cell] = restricted;
            pQueue.addForCell(cell);
          }
          if (++i >= numPerimeter) i -= numPerimeter;
        }
      } else if (!(v & setMask) || (v & (v - 1))) {
        continue;
      }
      prevToken = v;
      gapStart = j + 1 >= numPerimeter ? 0 : j + 1;
    }
    return true;
  }
}
