const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SudokuConstraintHandler, InvalidConstraintError } = await import('./handlers.js' + self.VERSION_PARAM);
const { memoize } = await import('../util.js' + self.VERSION_PARAM);

// Sentinel for "no neighbour" (grid edge) in the neighbour table, and for
// "no cell" generally.
export const NO_CELL = 0xffff;

// Position-indexed orthogonal-neighbour lookup for `numCells` cells laid out in
// `numCols` columns (the last row may be partial): neighbors[i * 4 + dir] is the
// neighbour of position i in direction dir (0 left, 1 right, 2 up, 3 down), or
// `sentinel` at an edge.
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

// Full grid, using NO_CELL at the edges. Memoized by grid dimensions so it is
// built once and shared across handlers.
export const neighborTable = memoize((numRows, numCols) =>
  buildNeighborTable(numRows * numCols, numCols, NO_CELL));

// A cell layer whose missing-neighbour sentinel is `numCells` — a permanently
// EXCLUDED states slot, so traversals need no edge checks. Depends only on the
// layer's shape, so it is memoized and shared across handlers.
const layerNeighborTable = memoize((numCells, numCols) =>
  buildNeighborTable(numCells, numCols, numCells));

// Returns `cell`'s in-grid orthogonal neighbours when every one of them is in
// `cellSet` (the cell is "enclosed"), otherwise null.
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

// Cell classification within a pass (see enforceConsistency). Chosen so that
// bit 0 = "may hold an in-set value" and bit 1 = "certainly holds one".
const EXCLUDED = 0;
const UNDECIDED = 1;
const DECIDED = 3;
const VISITED = 4;

// Sentinel for "several doors" in door forcing; both sentinels sort above any
// real cell index so `door >= MULTI_DOOR` means "nothing to force".
const MULTI_DOOR = 0xfffe;

// Enforces that, for each of its value sets, the cells holding one of the
// set's values form a single non-empty orthogonally-connected region.
//
// The handler covers a whole cell layer — the grid itself (cellOffset 0),
// or a var-cell group with one cell per grid cell — so position i's search
// cell is `cellOffset + i`, and grid adjacency defines the connectivity
// graph.
//
// See handler_docs/connected_values.md for the algorithm and its soundness
// arguments; § references below are into that document.
export class ConnectedValues extends SudokuConstraintHandler {
  // `values` is one set, or a list of pairwise-disjoint single-value sets (a
  // multi-value set is only supported alone). The optimizer merges same-layer
  // instances into one multi-set handler and adds the joint ConnectedCrossing/
  // ConnectedBorder handlers (§5).
  constructor(numGridCells, cellOffset, values) {
    const cells = new Uint16Array(numGridCells);
    for (let i = 0; i < numGridCells; i++) cells[i] = cellOffset + i;
    super(cells);

    this._cellOffset = cellOffset;
    this._valueSets =
      values.length && Array.isArray(values[0]) ? values : [values];
    this._valueMasks = null;
    this._neighbors = null;
    this._queue = null;
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
    // Merged instances must be pairwise-disjoint single-value sets, so a
    // decided cell's candidates match exactly one set mask — the owner tokens
    // the crossing/border handlers depend on (§5).
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
    if (numCells !== geometry.numGridCells ||
      this._cellOffset !== this.constructor._layerStart(
        geometry, this._cellOffset)) {
      throw new InvalidConstraintError(
        'Connected Values must cover the grid, or a var-cell group with one cell per grid cell.');
    }
    // The layer is laid out in `numCols` columns — the grid's, or a var-cell
    // group's own — so the layer need not match the grid's shape.
    let numCols = geometry.numCols;
    if (this._cellOffset !== 0) {
      const group = geometry.varCellGroups().find(
        (g) => g.cells[0] === this._cellOffset);
      if (group) numCols = group.columns || geometry.numCols;
    }
    this._neighbors = layerNeighborTable(numCells, numCols);
    this._queue = new Uint16Array(numCells);
    // One extra states entry for the sentinel neighbor index numCells.
    // Scratch, classified fresh from the grid each pass.
    this._states = new Uint8Array(numCells + 1);

    return true;
  }

  // Start index of `cell`'s layer (the grid itself, or a full-grid var-cell
  // group).
  static _layerStart(geometry, cell) {
    if (cell < geometry.numGridCells) return 0;
    for (const group of geometry.varCellGroups()) {
      const start = group.cells[0];
      if (cell < start || cell >= start + group.count) continue;
      if (group.count !== geometry.numGridCells) {
        throw new InvalidConstraintError(
          'Connected Values var cells must be from a group with one cell per grid cell.');
      }
      return start;
    }
    throw new InvalidConstraintError('Connected Values: unknown cell.');
  }

  enforceConsistency(grid, pQueue) {
    // One pass over the sets: disjoint sets feed each other through the grid
    // (an exclusion from one decides a cell for another). The joint crossing
    // and border rules are separate handlers (§5).
    const numSets = this._valueMasks.length;
    for (let s = 0; s < numSets; s++) {
      if (!this._enforceSet(grid, pQueue, s)) return false;
    }
    return true;
  }

  // Enforces the value set with index `s` (§2-4). Returns false on conflict,
  // true otherwise.
  _enforceSet(grid, pQueue, s) {
    const cellOffset = this._cellOffset;
    const numCells = this.cells.length;
    const valueMask = this._valueMasks[s];
    const states = this._states;

    // states is scratch: classify this set fresh from the grid.
    let numPossible = 0;
    let numDecided = 0;
    let firstDecided = 0;
    for (let i = 0; i < numCells; i++) {
      const value = grid[cellOffset + i];
      if (!(value & valueMask)) {
        states[i] = EXCLUDED;
        continue;
      }
      numPossible++;
      if (value & ~valueMask) {
        states[i] = UNDECIDED;
      } else {
        states[i] = DECIDED;
        if (!numDecided++) firstDecided = i;
      }
    }

    // With no decided cell only non-emptiness can be checked (§2.2).
    if (numDecided === 0) return numPossible !== 0;

    const neighbors = this._neighbors;
    const queue = this._queue;

    // A single traversal from any decided cell answers everything (§3):
    // unvisited decided => fail, unvisited possible => prune, and once every
    // possible cell is visited nothing more can be marked — exit early.
    let queueSize = 0;
    let visitedPossible = 1;
    let visitedDecided = 1;
    queue[queueSize++] = firstDecided;
    states[firstDecided] |= VISITED;
    for (let head = 0; head < queueSize && visitedPossible < numPossible;
      head++) {
      const cell = queue[head];
      const offset = cell << 2;
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighbors[offset + dir];
        const state = states[neighbor];
        if ((state & (VISITED | UNDECIDED)) !== UNDECIDED) continue;
        states[neighbor] = state | VISITED;
        visitedPossible++;
        visitedDecided += state >> 1;
        queue[queueSize++] = neighbor;
      }
    }

    if (visitedDecided < numDecided) return false;

    if (visitedPossible < numPossible) {
      let toPrune = numPossible - visitedPossible;
      for (let i = 0; toPrune; i++) {
        if ((states[i] & (VISITED | UNDECIDED)) !== UNDECIDED) continue;
        // Unvisited cells are undecided (unvisited decided failed above),
        // so stripping the value mask cannot empty them.
        states[i] = EXCLUDED;
        grid[cellOffset + i] &= ~valueMask;
        pQueue.addForCell(cellOffset + i);
        toPrune--;
      }
      numPossible = visitedPossible;
    }
    // Fully decided and unsplit: the region is complete.
    if (numPossible === numDecided) return true;

    // A single decided cell is a single blob, which never forces.
    if (numDecided === 1) return true;

    // Door forcing to a fixed point (§4). Forcing leaves the possible graph
    // unchanged, so the traversal above never reruns; rounds re-mark cheaply
    // by alternating the decided cells' VISITED polarity (§6).
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

  // One round of one-door forcing for the set with mask `valueMask` (§4): a
  // decided blob whose only undecided neighbour is its single door forces it,
  // when ≥2 blobs exist. Returns the number of cells forced.
  // `unvisitedDecidedState` is the decided cells' current state; this round
  // marks them by toggling their VISITED bit.
  _forceDoors(grid, pQueue, valueMask, numDecided, unvisitedDecidedState) {
    const cellOffset = this._cellOffset;
    const numCells = this.cells.length;
    const neighbors = this._neighbors;
    const queue = this._queue;
    const states = this._states;
    const visitedDecidedState = unvisitedDecidedState ^ VISITED;
    const undecidedState = UNDECIDED | VISITED;

    // Traverse each blob and bank its door (or MULTI_DOOR) in a dead seed
    // slot, forming a queue prefix later traversals start past (§6). Doors are
    // applied only after the scan — each must come from the pre-forcing
    // snapshot (§4.2).
    let numBlobs = 0;
    let numVisited = 0;
    // Once every decided cell is visited no further blob can be seeded.
    for (let i = 0; i < numCells && numVisited < numDecided; i++) {
      if (states[i] !== unvisitedDecidedState) continue;

      let door = NO_CELL;
      let queueSize = numBlobs;
      queue[queueSize++] = i;
      states[i] = visitedDecidedState;
      numVisited++;
      for (let head = numBlobs; head < queueSize; head++) {
        const cell = queue[head];
        const offset = cell << 2;
        for (let dir = 0; dir < 4; dir++) {
          const neighbor = neighbors[offset + dir];
          const state = states[neighbor];
          if (state === unvisitedDecidedState) {
            states[neighbor] = visitedDecidedState;
            numVisited++;
            queue[queueSize++] = neighbor;
          } else if (state === undecidedState && door !== neighbor) {
            door = door === NO_CELL ? neighbor : MULTI_DOOR;
          }
        }
      }
      queue[numBlobs++] = door;
    }
    if (numBlobs < 2) return 0;

    let numForced = 0;
    for (let blobId = 0; blobId < numBlobs; blobId++) {
      const door = queue[blobId];
      if (door >= MULTI_DOOR) continue;
      if (states[door] !== undecidedState) continue;  // Forced by an earlier blob.

      // Forced doors join the visited polarity so the next round toggles
      // every decided cell together.
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
// fourth cell cannot complete the checkerboard by taking Y. Woken only when a
// corner changes, so it needs no sweep or scratch. `values` is the sets' union.
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
    // Owner token per corner: the single set bit a decided cell holds, else 0
    // (undecided or out-of-set). Equal nonzero tokens mean the same set.
    let v;
    v = grid[cells[0]]; const nw = (v & setMask) && !(v & (v - 1)) ? v : 0;
    v = grid[cells[1]]; const ne = (v & setMask) && !(v & (v - 1)) ? v : 0;
    v = grid[cells[2]]; const sw = (v & setMask) && !(v & (v - 1)) ? v : 0;
    v = grid[cells[3]]; const se = (v & setMask) && !(v & (v - 1)) ? v : 0;

    // One diagonal decided to set X, a cell of the other to Y ≠ X: Y is
    // forbidden on the fourth (completing) cell (§5.2).
    let target = 0;
    let forbidden = 0;
    if (nw && nw === se) {
      if (ne && ne !== nw) { target = cells[2]; forbidden = ne; }
      else if (sw && sw !== nw) { target = cells[1]; forbidden = sw; }
    } else if (ne && ne === sw) {
      if (nw && nw !== ne) { target = cells[3]; forbidden = nw; }
      else if (se && se !== ne) { target = cells[0]; forbidden = se; }
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

// Border rule (§5.3) over the perimeter `cells` in cyclic order: two disjoint
// connected regions cannot interleave around it (X..Y..X..Y), so a gap flanked
// by same-set decided cells cannot hold the other set. `values` is the union
// of the two single-value sets.
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
      if (!(v & setMask) || (v & (v - 1))) {  // not decided into a set: a gap
        gapUnion |= v;
        continue;
      }
      if (v !== prev) {
        transitions++;
        prev = v;
      } else if (gapUnion & (setMask ^ v)) {
        needsStrip = true;
      }
      gapUnion = 0;
    }
    if (transitions === 0) return true;   // At most one set on the border.
    if (transitions > 2) return false;    // Interleaved.
    if (!needsStrip) return true;

    // Enforcement pass: the same lap, stripping each gap flanked by matching
    // tokens. One lap reaches the fixed point (§5.3).
    let prevToken = first;
    let gapStart = start + 1;
    for (let step = 1; step <= numPerimeter; step++) {
      let j = start + step;
      if (j >= numPerimeter) j -= numPerimeter;
      const v = grid[cells[j]];
      if (!(v & setMask) || (v & (v - 1))) continue;  // skip gaps
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
      }
      prevToken = v;
      gapStart = j + 1 >= numPerimeter ? 0 : j + 1;
    }
    return true;
  }
}
