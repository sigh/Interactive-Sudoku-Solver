const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SudokuConstraintHandler, InvalidConstraintError } = await import('./handlers.js' + self.VERSION_PARAM);
const { memoize } = await import('../util.js' + self.VERSION_PARAM);

export const NO_CELL = 0xffff;

// neighbors[i * 4 + dir] is the orthogonal neighbour of position i (dir: 0 left,
// 1 right, 2 up, 3 down), or `sentinel` at an edge. `numCells` cells in `numCols`
// columns, the last row possibly partial.
const buildNeighborTable = (numCells, numCols, sentinel) => {
  const neighbors = new Uint16Array(numCells * 4).fill(sentinel);
  for (let i = 0; i < numCells; i++) {
    const col = i % numCols;
    const offset = i * 4;
    if (col > 0) neighbors[offset] = i - 1;
    if (col + 1 < numCols && i + 1 < numCells) neighbors[offset + 1] = i + 1;
    if (i >= numCols) neighbors[offset + 2] = i - numCols;
    if (i + numCols < numCells) neighbors[offset + 3] = i + numCols;
  }
  return neighbors;
};

// Full grid, using NO_CELL at the edges.
export const neighborTable = memoize((numRows, numCols) =>
  buildNeighborTable(numRows * numCols, numCols, NO_CELL));

// A cell layer whose missing-neighbour sentinel is `numCells` — a permanently
// EXCLUDED states slot, so traversals need no edge checks.
const layerNeighborTable = memoize((numCells, numCols) =>
  buildNeighborTable(numCells, numCols, numCells));

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
  // `values` is one set, or a list of pairwise-disjoint single-value sets (a
  // multi-value set is only supported alone).
  constructor(numCells, cellOffset, values) {
    const cells = new Uint16Array(numCells);
    for (let i = 0; i < numCells; i++) cells[i] = cellOffset + i;
    super(cells);

    this._cellOffset = cellOffset;
    this._valueSets =
      values.length && Array.isArray(values[0]) ? values : [values];
    this._valueMasks = null;
    this._neighbors = null;
    this._traversalBuffer = null;
    this._states = null;
  }

  valueSets() {
    return this._valueSets;
  }

  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    const lookupTables = LookupTables.get(geometry.numValues);
    this._valueMasks = this._valueSets.map((values) => {
      const valueMask = LookupTables.fromOffsetValuesArray(
        values, geometry.valueOffset);
      if (!valueMask || (valueMask & ~lookupTables.allValues)) {
        throw new InvalidConstraintError(
          'Connected Values values must be valid grid values.');
      }
      return valueMask;
    });
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
    // The grid, or a whole var-cell group. A group sets its own size and
    // width, so the layer need not have the grid's shape.
    const layer = this._cellOffset === 0 ?
      { count: geometry.numGridCells, columns: geometry.numCols } :
      geometry.varCellGroups().find((g) => g.cells[0] === this._cellOffset);
    if (layer?.count !== numCells) {
      throw new InvalidConstraintError(
        'Connected Values must cover the grid or a whole var-cell group.');
    }
    this._neighbors = layerNeighborTable(numCells, layer.columns);
    this._traversalBuffer = new Uint16Array(numCells);
    this._states = new Uint8Array(numCells + 1);

    return true;
  }

  enforceConsistency(grid, pQueue) {
    const numSets = this._valueMasks.length;
    for (let s = 0; s < numSets; s++) {
      if (!this._enforceSet(grid, pQueue, s)) return false;
    }
    return true;
  }

  _enforceSet(grid, pQueue, s) {
    const cellOffset = this._cellOffset;
    const numCells = this.cells.length;
    const valueMask = this._valueMasks[s];
    const states = this._states;

    // The traversal may start at any decided cell (§3), so keep the last one
    // seen.
    let numPossible = 0;
    let numDecided = 0;
    let possibleCell = 0;
    let seedCell = 0;
    for (let i = 0; i < numCells; i++) {
      const value = grid[cellOffset + i];
      if (!(value & valueMask)) {
        states[i] = EXCLUDED;
        continue;
      }
      numPossible++;
      possibleCell = i;
      if (value & ~valueMask) {
        states[i] = UNDECIDED;
      } else {
        states[i] = DECIDED;
        numDecided++;
        seedCell = i;
      }
    }

    // With no decided cell, non-emptiness fails on zero supports and forces the
    // sole support when exactly one remains.
    if (numDecided === 0) {
      if (numPossible === 0) return false;
      if (numPossible === 1) {
        grid[cellOffset + possibleCell] &= valueMask;
        pQueue.addForCell(cellOffset + possibleCell);
      }
      return true;
    }

    const neighbors = this._neighbors;
    const buffer = this._traversalBuffer;

    // Traverse the possible cells from `seedCell` (§3). Undecided cells queue
    // FIFO from the front of `buffer`, the blob being drained is a LIFO from its
    // back; the ends cannot meet (§6).
    let numBlobs = 0;
    let anySingleDoor = false;
    let queueHead = 0;
    let queueSize = 0;
    let visitedDecided = 0;
    let seed = seedCell;

    while (true) {
      if (seed !== NO_CELL) {
        numBlobs++;
        let door = NO_CELL;
        let stackTop = numCells;
        buffer[--stackTop] = seed;
        states[seed] = DECIDED | VISITED;
        visitedDecided++;
        while (stackTop < numCells) {
          const cell = buffer[stackTop++];
          const offset = cell << 2;
          for (let dir = 0; dir < 4; dir++) {
            const neighbor = neighbors[offset + dir];
            const state = states[neighbor];
            if (state === DECIDED) {
              states[neighbor] = DECIDED | VISITED;
              visitedDecided++;
              buffer[--stackTop] = neighbor;
            } else if ((state & DECIDED) === UNDECIDED) {
              // Undecided, marked or not — a door either way. Masking with
              // UNDECIDED would also match a marked decided cell (§6).
              if (door !== neighbor) {
                door = door === NO_CELL ? neighbor : MULTI_DOOR;
              }
              if (state === UNDECIDED) {
                states[neighbor] = UNDECIDED | VISITED;
                buffer[queueSize++] = neighbor;
              }
            }
          }
        }
        anySingleDoor ||= door < MULTI_DOOR;
        seed = NO_CELL;
        continue;
      }

      if (queueHead === queueSize ||
        visitedDecided + queueSize === numPossible) break;

      // Drain a decided neighbour's blob before reading this cell's remaining
      // neighbours, or a blob touched on two sides counts twice — so the cell
      // stays at the head and is expanded again after (§3.1).
      const cell = buffer[queueHead];
      const offset = cell << 2;
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighbors[offset + dir];
        const state = states[neighbor];
        if (state === DECIDED) {
          seed = neighbor;
          break;
        }
        if (state === UNDECIDED) {
          states[neighbor] = UNDECIDED | VISITED;
          buffer[queueSize++] = neighbor;
        }
      }
      if (seed === NO_CELL) queueHead++;
    }

    if (visitedDecided < numDecided) return false;

    const visitedPossible = visitedDecided + queueSize;
    if (visitedPossible < numPossible) {
      let toPrune = numPossible - visitedPossible;
      for (let i = 0; toPrune; i++) {
        if ((states[i] & (VISITED | UNDECIDED)) !== UNDECIDED) continue;
        // Unvisited cells are undecided, so stripping the value mask cannot
        // empty them.
        states[i] = EXCLUDED;
        grid[cellOffset + i] &= ~valueMask;
        pQueue.addForCell(cellOffset + i);
        toPrune--;
      }
      numPossible = visitedPossible;
    }
    if (numPossible === numDecided) return true;

    // Exactly when forcing fires (§4.1), so a round only runs if it will force
    // (§4.4). The prune cannot invalidate it: only unmarked cells are pruned.
    if (numBlobs < 2 || !anySingleDoor) return true;

    // Force to a fixed point (§4.3). Each round must re-mark the decided cells,
    // so rather than clear the marks, alternate which VISITED polarity counts as
    // unmarked (§6).
    let unvisitedDecidedState = DECIDED | VISITED;
    while (true) {
      const forced = this._forceDoors(
        grid, pQueue, valueMask, numDecided, unvisitedDecidedState);
      if (!forced) return true;
      numDecided += forced;
      if (numPossible === numDecided) return true;
      unvisitedDecidedState ^= VISITED;
    }
  }

  _forceDoors(grid, pQueue, valueMask, numDecided, unvisitedDecidedState) {
    const cellOffset = this._cellOffset;
    const numCells = this.cells.length;
    const neighbors = this._neighbors;
    const buffer = this._traversalBuffer;
    const states = this._states;
    const visitedDecidedState = unvisitedDecidedState ^ VISITED;
    const undecidedState = UNDECIDED | VISITED;

    // Bank each blob's door one slot per blob at the front of `buffer`, the blob
    // being traversed a LIFO from its back (§6). Doors are applied only after
    // the scan — each must come from the pre-forcing snapshot (§4.2). The scan
    // stops once every decided cell is seen: no blob is left to seed.
    let numBlobs = 0;
    let numVisited = 0;
    for (let i = 0; i < numCells && numVisited < numDecided; i++) {
      if (states[i] !== unvisitedDecidedState) continue;

      let door = NO_CELL;
      let stackTop = numCells;
      buffer[--stackTop] = i;
      states[i] = visitedDecidedState;
      numVisited++;
      while (stackTop < numCells) {
        const cell = buffer[stackTop++];
        const offset = cell << 2;
        for (let dir = 0; dir < 4; dir++) {
          const neighbor = neighbors[offset + dir];
          const state = states[neighbor];
          if (state === unvisitedDecidedState) {
            states[neighbor] = visitedDecidedState;
            numVisited++;
            buffer[--stackTop] = neighbor;
          } else if (state === undecidedState && door !== neighbor) {
            door = door === NO_CELL ? neighbor : MULTI_DOOR;
          }
        }
      }
      buffer[numBlobs++] = door;
    }
    if (numBlobs < 2) return 0;

    let numForced = 0;
    for (let blobId = 0; blobId < numBlobs; blobId++) {
      const door = buffer[blobId];
      if (door >= MULTI_DOOR) continue;
      if (states[door] !== undecidedState) continue;

      // Take the visited polarity, so the next round toggles the decided cells
      // as one.
      states[door] = visitedDecidedState;
      grid[cellOffset + door] &= valueMask;
      pQueue.addForCell(cellOffset + door);
      numForced++;
    }
    return numForced;
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
