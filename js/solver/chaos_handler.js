const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SudokuConstraintHandler, InvalidConstraintError } = await import('./handlers.js' + self.VERSION_PARAM);
const { countOnes16bit, memoize } = await import('../util.js' + self.VERSION_PARAM);

const DEFER_CONNECTIVITY = 2;
const REGION_POSSIBLE_COUNT_MASK = 0x1ff;
const REGION_FIXED_COUNT_SHIFT = 9;
const REGION_FIXED_COUNT_MASK = 0x1f;
const REGION_VALUE_MASK_SHIFT = 14;
const REGION_COUNT_MASK = (1 << REGION_VALUE_MASK_SHIFT) - 1;

const cellsAreAdjacent = (cellA, cellB, numCols) => {
  const delta = Math.abs(cellA - cellB);
  return delta === numCols || (delta === 1 && (cellA / numCols | 0) === (cellB / numCols | 0));
};

// Sentinel for "no neighbour" (grid edge) in the neighbour table.
const NO_CELL = 0xffff;

// Orthogonal-neighbour lookup: neighbors[cell * 4 + dir] is the neighbouring cell
// in direction dir (0 left, 1 right, 2 up, 3 down), or NO_CELL at the grid edge.
// Memoized by grid dimensions so it is built once and shared across handlers.
export const neighborTable = memoize((numRows, numCols) => {
  const numCells = numRows * numCols;
  const neighbors = new Uint16Array(numCells * 4).fill(NO_CELL);
  for (let cell = 0; cell < numCells; cell++) {
    const row = (cell / numCols) | 0;
    const col = cell - row * numCols;
    const offset = cell * 4;
    if (col > 0) neighbors[offset] = cell - 1;
    if (col + 1 < numCols) neighbors[offset + 1] = cell + 1;
    if (row > 0) neighbors[offset + 2] = cell - numCols;
    if (row + 1 < numRows) neighbors[offset + 3] = cell + numCols;
  }
  return neighbors;
});

// Returns `cell`'s in-grid orthogonal neighbours when every one of them is in
// `cellSet` (the cell is "enclosed"), otherwise null.
export const enclosingNeighbors = (neighborTable, cell, cellSet) => {
  const base = cell * 4;
  const neighbors = [];
  for (let dir = 0; dir < 4; dir++) {
    const neighbor = neighborTable[base + dir];
    if (neighbor === NO_CELL) continue;
    if (!cellSet.has(neighbor)) return null;
    neighbors.push(neighbor);
  }
  return neighbors;
};

// Union-find union: merges cellA and cellB's shards, keeping the smaller index as root.
const unionShardRoots = (roots, offset, cellA, cellB) => {
  let rootA = roots[offset + cellA];
  let rootB = roots[offset + cellB];
  if (rootA === rootB) return false;
  while (rootA !== cellA) {
    cellA = rootA;
    rootA = roots[offset + cellA];
  }
  while (rootB !== cellB) {
    cellB = rootB;
    rootB = roots[offset + cellB];
  }
  if (rootA === rootB) return false;
  // Keep roots monotonic so shard member lists can be rebuilt in cell order.
  if (rootB < rootA) [rootA, rootB] = [rootB, rootA];
  roots[offset + rootB] = rootA;
  return true;
};

class ChaosRegionShardState {
  configure(regionCellOffset, regionShardOffset) {
    this._regionCellOffset = regionCellOffset;
    this._regionShardOffset = regionShardOffset;
  }

  // Merge the shards of cellA and cellB, queuing their region cells if they changed.
  merge(grid, cellA, cellB, handlerAccumulator = null) {
    if (!unionShardRoots(grid, this._regionShardOffset, cellA, cellB)) return false;
    if (handlerAccumulator) {
      handlerAccumulator.addForCell(this._regionCellOffset + cellA);
      handlerAccumulator.addForCell(this._regionCellOffset + cellB);
    }
    return true;
  }

  // Return the current representative for a physical same-region shard.
  findRoot(grid, cell) {
    const offset = this._regionShardOffset;
    let root = grid[offset + cell];
    while (root !== cell) {
      cell = root;
      root = grid[offset + cell];
    }
    return root;
  }
}

export class ChaosConstruction extends SudokuConstraintHandler {

  constructor(numGridCells, regionCellOffset, regionSize) {
    const cells = new Uint16Array(numGridCells * 2);
    for (let cell = 0; cell < numGridCells; cell++) {
      cells[cell * 2] = cell;
      cells[cell * 2 + 1] = regionCellOffset + cell;
    }
    super(cells);

    this._numGridCells = numGridCells;
    this._regionCellOffset = regionCellOffset;
    this._regionSize = regionSize;
    this._canonicalAnchorCells = [0];
    this._regionLinks = [];
    this._regionShardState = new ChaosRegionShardState();
    this._effectiveValueMask = -1;
    this.idStr = [this.constructor.name, this._numGridCells].join('|');
  }

  setEffectiveValueMask(mask) {
    this._effectiveValueMask = mask;
  }

  linkedSearchCells() {
    return this.cells;
  }

  addRegionLink(line) {
    if (line.length < 2) return;
    this._regionLinks.push(Uint16Array.from(line));
  }

  regionShardState() {
    return this._regionShardState;
  }

  // Picks up to three well-separated, high-priority edge cells to pre-seed region labels 0,1,2.
  _chooseCanonicalAnchors(shape, cellPriorities) {
    if (this._numRegions < 3 || this._numGridCells < 3) return [0];

    const { numRows, numCols, numValues } = shape;
    const regionCellOffset = this._regionCellOffset;
    const anchorScore = cell => cellPriorities[cell] + cellPriorities[regionCellOffset + cell];

    // Anchors break region-label symmetry; keeping them separated avoids
    // over-constraining one local corner of the layout.
    const separated = (cellA, cellB) => {
      const rowDistance = Math.abs((cellA / numCols | 0) - (cellB / numCols | 0));
      const colDistance = Math.abs((cellA % numCols) - (cellB % numCols));
      return rowDistance + colDistance >= this._regionSize;
    };

    const edgeCells = [];
    for (let col = 0; col < numCols; col++) {
      edgeCells.push(col);
      if (numRows > 1) edgeCells.push((numRows - 1) * numCols + col);
    }
    for (let row = 1; row < numRows - 1; row++) {
      edgeCells.push(row * numCols);
      if (numCols > 1) edgeCells.push(row * numCols + numCols - 1);
    }

    let bestCells = null;
    let bestScore = -Infinity;
    for (let edgeIndexA = 0; edgeIndexA < edgeCells.length - 1; edgeIndexA++) {
      const edgeA = edgeCells[edgeIndexA];
      for (let edgeIndexB = edgeIndexA + 1; edgeIndexB < edgeCells.length; edgeIndexB++) {
        const edgeB = edgeCells[edgeIndexB];
        if (!separated(edgeA, edgeB)) continue;
        const edgeScore = anchorScore(edgeA) + anchorScore(edgeB);
        for (let cell = 0; cell < this._numGridCells; cell++) {
          if (cell === edgeA || cell === edgeB) continue;
          if (!separated(edgeA, cell) || !separated(edgeB, cell)) continue;
          const score = edgeScore + anchorScore(cell);
          if (score > bestScore) {
            bestScore = score;
            bestCells = [edgeA, edgeB, cell];
          }
        }
      }
    }

    if (!bestCells) return [0];
    return bestCells.sort((a, b) => a - b);
  }

  _configureShape(shape) {
    if (this._numGridCells !== shape.numGridCells
      || this._regionCellOffset < shape.numGridCells
      || this._regionCellOffset + this._numGridCells > shape.totalCells()) {
      throw new InvalidConstraintError(
        'ChaosConstruction requires one region cell for every grid cell.');
    }
    if (shape.numGridCells % this._regionSize !== 0) {
      throw new InvalidConstraintError(
        'ChaosConstruction requires grid cell count to be divisible by region size.');
    }
    this._numRegions = shape.numGridCells / this._regionSize;
    // Region labels reuse the normal value bitmask representation.
    this._regionMask = (1 << this._numRegions) - 1;
    this._numValues = shape.numValues;
    this._effectiveValueMask &= (1 << this._numValues) - 1;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._configureShape(shape);

    const numGridCells = shape.numGridCells;

    // === Immutable configuration (built once, never mutated) ===
    this._neighbors = neighborTable(shape.numRows, shape.numCols);  // 4-neighbour adjacency

    // === Branch state (saved/restored across backtracking by stateAllocator) ===
    // NOTE: the two allocate() calls must keep this relative order — offsets are
    // assigned by call sequence.
    // Per-region cache of the last stable possible weight; a label is dirty for
    // connectivity when its possible weight changes from this.
    this._possibleCountCacheOffset = stateAllocator.allocate(
      new Uint16Array(this._numRegions).fill(NO_CELL));
    // Union-find over cells known to share a region (the shard forest), seeded
    // from the explicit region-link clues.
    const regionShardRoots = Uint16Array.from({ length: numGridCells }, (_, cell) => cell);
    this._regionShardOffset = 0;
    for (const link of this._regionLinks) {
      const root = link[0];
      for (let i = 1; i < link.length; i++) {
        unionShardRoots(regionShardRoots, this._regionShardOffset, root, link[i]);
      }
    }
    this._regionShardOffset = stateAllocator.allocate(regionShardRoots);
    this._regionShardState.configure(this._regionCellOffset, this._regionShardOffset);

    // === Persistent across calls ===
    // Dirty labels accumulate here across rescans until connectivity consumes them.
    this._connectivityDirtyRegionsMask = 0;
    // Visited-set with O(1) reset: a stamp equal to _visitId means "visited this
    // pass". It survives between calls (the generation avoids re-zeroing), so it
    // is persistent state, not scratch.
    this._visitId = 0;
    this._visitMarks = new Uint16Array(numGridCells);

    // === Per-call derived state, rebuilt each pass and consumed by later phases.
    //     Grouped into two bundles so the pipeline passes 2 objects, not ~9 arrays;
    //     a stage's signature names the bundles it reads/writes. Allocated once
    //     here over their arrays (the bundles add no per-call allocation). ===
    // Per-shard summaries, indexed by union-find root (produced by _rebuildShards):
    this._shards = {
      sizes: new Uint8Array(numGridCells),            // cells per shard
      fixedValueMasks: new Uint16Array(numGridCells), // values fixed within the shard
      nextCells: new Uint16Array(numGridCells),       // shard member linked list
      // Shard value masks (rebuild -> scan); the same buffer is reused as
      // connectivity's region-candidate working copy.
      masks: new Uint16Array(numGridCells),
    };
    // Per-region summaries (produced by _scanRegionCandidates):
    this._regions = {
      // possible cell weight (low bits) + possible value mask (high lane, also read
      // by hidden singles). Fixed weight lives in fixedSize, not here.
      scanData: new Uint32Array(this._numRegions),
      fixedValueMasks: new Uint16Array(this._numRegions), // values fixed in the region
      // Lowest-index shard fixed to each region; connectivity's traversal seed (only
      // read when the region's fixed weight is non-zero, so stale entries are unused).
      firstFixedRoot: new Uint16Array(this._numRegions),
      // Live fixed cell weight, kept current as the connectivity pass fixes shards.
      fixedSize: new Uint16Array(this._numRegions),
    };

    // === Scratch: transient working storage. Contents live only within one
    //     operation and never cross a phase boundary; each is reused for unrelated
    //     transient roles (never live together) and aliased to a descriptive local
    //     at the use site. Named by size, not role. ===
    this._scratchRegions0 = new Uint16Array(this._numRegions);
    // Uint8: these hold grid-cell indices / union-find roots only. Grid cells are
    // capped at 16x16 = 256 (numValues <= 16), so they never exceed 255 — unlike
    // the region-label var cells, which live above the grid and use Uint16 above.
    this._scratchGridCells0 = new Uint8Array(numGridCells);
    this._scratchRoots0 = new Uint8Array(this._regionSize * Math.max(numGridCells, this._numValues));

    const regionCellOffset = this._regionCellOffset;

    for (let i = 0; i < numGridCells; i++) {
      if (!(initialGridCells[i] &= this._effectiveValueMask)) return false;
      if (!(initialGridCells[regionCellOffset + i] &= this._regionMask)) return false;
    }

    const numAnchors = Math.min(this._canonicalAnchorCells.length, this._numRegions);
    for (let i = 0; i < numAnchors; i++) {
      if (!(initialGridCells[regionCellOffset + this._canonicalAnchorCells[i]] &= (1 << i))) {
        return false;
      }
    }
    this._canonicalSeedMask = (1 << numAnchors) - 1;

    return true;
  }

  selectPriorityAnchorCells(shape, cellPriorities) {
    this._configureShape(shape);
    const anchorCells = this._chooseCanonicalAnchors(shape, cellPriorities);
    const numAnchors = Math.min(anchorCells.length, this._numRegions);
    this._canonicalAnchorCells = anchorCells.slice(0, numAnchors);
  }

  priority() {
    return 2;
  }

  // Returns a fresh generation stamp for _visitMarks; resets marks on overflow.
  _nextVisitId() {
    this._visitId++;
    if (this._visitId === NO_CELL) {
      this._visitMarks.fill(0);
      this._visitId = 1;
    }
    return this._visitId;
  }

  // Writes mask to every member of a shard's region cell, queuing changed cells.
  _writeShardRegion(grid, root, mask, handlerAccumulator) {
    const regionCellOffset = this._regionCellOffset;
    const nextCells = this._shards.nextCells;

    // A shard is one same-region unit, so every member's CC cell gets the same mask.
    for (let cell = root; cell !== NO_CELL; cell = nextCells[cell]) {
      const regionCell = regionCellOffset + cell;
      if (grid[regionCell] === mask) continue;
      grid[regionCell] = mask;
      handlerAccumulator.addForCell(regionCell);
    }
  }

  // Removes regionBit from a shard's scratch mask; if the shard becomes fixed, records it.
  _dropShardRegion(shardMasks, root, regionBit) {
    // Connectivity only removes labels from roots with at least one other candidate.
    const oldMask = shardMasks[root];
    const newMask = oldMask & ~regionBit;
    shardMasks[root] = newMask;
    this._connectivityDirtyRegionsMask |= oldMask;
    // A removal that leaves a single candidate newly fixes this shard to that
    // region; keep the per-region fixed weight that later labels rely on current.
    if (newMask && !(newMask & (newMask - 1))) {
      this._recordFixedShard(31 - Math.clz32(newMask), root);
    }
  }

  // Forces a shard's scratch mask to exactly regionBit; records the shard as fixed.
  _fixShardRegion(shardMasks, root, regionBit) {
    const oldMask = shardMasks[root];
    this._connectivityDirtyRegionsMask |= oldMask;
    shardMasks[root] = regionBit;
    // Forcing a multi-candidate shard newly fixes it to the region.
    if (oldMask !== regionBit) {
      this._recordFixedShard(31 - Math.clz32(regionBit), root);
    }
  }

  // Adds a newly fixed shard's weight to its region and updates the lowest-index seed root.
  _recordFixedShard(region, root) {
    // Fixed shards are never un-fixed within a connectivity pass, so the weight
    // only grows. The seed must stay the lowest-index fixed root so the
    // distance-bounded traversal (and its boundary pruning) matches the order an
    // index scan would produce.
    const fixedSizeByRegion = this._regions.fixedSize;
    const firstFixedRootByRegion = this._regions.firstFixedRoot;
    const shardSize = this._shards.sizes[root];
    if ((fixedSizeByRegion[region] += shardSize) === shardSize
      || root < firstFixedRootByRegion[region]) {
      firstFixedRootByRegion[region] = root;
    }
  }

  // Unions right- and down-neighbours that are fixed to the same region label into one shard.
  _mergeAdjacentFixedRegions(grid) {
    const neighbors = this._neighbors;
    const regionCellOffset = this._regionCellOffset;
    const shardOffset = this._regionShardOffset;

    // Adjacent cells fixed to the same region label are already one connected
    // part of that final region.
    for (let cell = 0; cell < this._numGridCells; cell++) {
      const regionMask = grid[regionCellOffset + cell];
      if (!regionMask || (regionMask & (regionMask - 1))) continue;

      const neighborOffset = cell << 2;
      const right = neighbors[neighborOffset + 1];
      if (right !== NO_CELL && grid[regionCellOffset + right] === regionMask) {
        unionShardRoots(grid, shardOffset, cell, right);
      }
      const down = neighbors[neighborOffset + 3];
      if (down !== NO_CELL && grid[regionCellOffset + down] === regionMask) {
        unionShardRoots(grid, shardOffset, cell, down);
      }
    }
  }

  // Phase 2a: merges fixed neighbours, flattens the shard forest, rebuilds summaries,
  // and tightens each shard's region mask to the intersection of its members' masks.
  _rebuildShards(grid, handlerAccumulator, shards) {
    // Phase 1: materialize same-region facts into shards and rebuild summaries.
    this._mergeAdjacentFixedRegions(grid);

    const regionCellOffset = this._regionCellOffset;
    const shardSizes = shards.sizes;
    const shardValueMasks = shards.masks;
    const shardFixedValueMasks = shards.fixedValueMasks;
    const nextCells = shards.nextCells;
    const constrainedRoots = this._scratchGridCells0;
    const shardOffset = this._regionShardOffset;
    let constrainedCount = 0;

    // Roots only move toward lower indexes, so a non-root's parent has already
    // been flattened to the true root in this scan. A member folds its region
    // candidates into the root's running intersection, which lives directly in the
    // grid; a root is recorded only when a member actually narrows it. Single-cell
    // shards take the root branch only, so they cost nothing here.
    for (let cell = 0; cell < this._numGridCells; cell++) {
      let root = grid[shardOffset + cell];
      shardSizes[cell] = 0;
      if (cell === root) {
        shardValueMasks[root] = 0;
        shardFixedValueMasks[root] = 0;
        nextCells[root] = NO_CELL;
      } else {
        root = grid[shardOffset + root];
        grid[shardOffset + cell] = root;
        nextCells[cell] = nextCells[root];
        nextCells[root] = cell;

        const rootRegionCell = regionCellOffset + root;
        const currentRegionMask = grid[rootRegionCell];
        const memberMask = grid[regionCellOffset + cell];
        // A member disagreeing with the running intersection means the shard needs
        // a rewrite (the member loses bits, or it narrows the others, or both).
        if (memberMask !== currentRegionMask) {
          const newRegionMask = currentRegionMask & memberMask;
          if (newRegionMask !== currentRegionMask) {
            if (!newRegionMask) return false;
            grid[rootRegionCell] = newRegionMask;        // the root itself narrowed
            handlerAccumulator.addForCell(rootRegionCell);
          }
          // Record the root for write-back. The back-of-list check elides the
          // common run of adjacent same-shard members.
          if (!constrainedCount || constrainedRoots[constrainedCount - 1] !== root) {
            constrainedRoots[constrainedCount++] = root;
          }
        }
      }
      const shardSize = shardSizes[root] + 1;
      if (shardSize > this._regionSize) return false;
      shardSizes[root] = shardSize;

      const cellValues = grid[cell];
      shardValueMasks[root] |= cellValues;
      if (cellValues && !(cellValues & (cellValues - 1))) {
        if (shardFixedValueMasks[root] & cellValues) return false;
        shardFixedValueMasks[root] |= cellValues;
      }
    }

    // Propagate each narrowed intersection to the shard's members.
    for (let i = 0; i < constrainedCount; i++) {
      const root = constrainedRoots[i];
      this._writeShardRegion(grid, root, grid[regionCellOffset + root], handlerAccumulator);
    }

    return true;
  }

  // BFS over shards reachable from startRoot for regionBit; returns total cell weight.
  _collectShardComponent(grid, shards, startRoot, regionBit, visitId) {
    const shardMasks = shards.masks;
    const neighbors = this._neighbors;
    const shardOffset = this._regionShardOffset;
    const stack = this._scratchGridCells0;
    const visitMarks = this._visitMarks;
    const shardSizes = shards.sizes;
    const nextCells = shards.nextCells;
    let componentSize = 0;
    let stackSize = 0;
    stack[stackSize++] = startRoot;
    visitMarks[startRoot] = visitId;
    componentSize += shardSizes[startRoot];

    // Component size is weighted by shard size, not root count.
    for (let componentIndex = 0; componentIndex < stackSize; componentIndex++) {
      const root = stack[componentIndex];
      for (let cell = root; cell !== NO_CELL; cell = nextCells[cell]) {
        const neighborOffset = cell << 2;
        for (let dir = 0; dir < 4; dir++) {
          const neighbor = neighbors[neighborOffset + dir];
          if (neighbor === NO_CELL) continue;

          const neighborRoot = grid[shardOffset + neighbor];
          if (visitMarks[neighborRoot] === visitId) continue;
          if (!(shardMasks[neighborRoot] & regionBit)) continue;

          visitMarks[neighborRoot] = visitId;
          componentSize += shardSizes[neighborRoot];
          stack[stackSize++] = neighborRoot;
        }
      }
    }

    this._scratchGridCells0Size = stackSize;
    return componentSize;
  }

  // Distance-bounded BFS from the fixed core; prunes shards too far to fit and returns
  // the reachable optional-cell weight (0 if the fixed shards are not all connected).
  _growComponentFromCore(
    grid, shards, regionBit, fixedSize, startRoot, visitId) {
    const shardMasks = shards.masks;
    const neighbors = this._neighbors;
    const shardOffset = this._regionShardOffset;
    const stack = this._scratchGridCells0;
    const visitMarks = this._visitMarks;
    const rootsByDistance = this._scratchRoots0;
    // Connectivity runs after possible-count summaries have been consumed.
    const rootCountsByDistance = this._scratchRegions0;
    const shardSizes = shards.sizes;
    const nextCells = shards.nextCells;
    const numGridCells = this._numGridCells;
    let componentSize = fixedSize;
    let componentRootCount = 0;
    let reachedFixedSize = shardSizes[startRoot];
    const maxExtraSize = this._regionSize - fixedSize;
    rootCountsByDistance.fill(0, 0, maxExtraSize + 1);
    visitMarks[startRoot] = visitId;
    rootsByDistance[rootCountsByDistance[0]++] = startRoot;

    for (let rootDistance = 0; rootDistance <= maxExtraSize; rootDistance++) {
      const bucketOffset = rootDistance * numGridCells;
      while (rootCountsByDistance[rootDistance]) {
        const root = rootsByDistance[bucketOffset + --rootCountsByDistance[rootDistance]];

        for (let cell = root; cell !== NO_CELL; cell = nextCells[cell]) {
          const neighborOffset = cell << 2;
          for (let dir = 0; dir < 4; dir++) {
            const neighbor = neighbors[neighborOffset + dir];
            if (neighbor === NO_CELL) continue;

            const neighborRoot = grid[shardOffset + neighbor];
            if (visitMarks[neighborRoot] === visitId) continue;

            const neighborRegionMask = shardMasks[neighborRoot];
            if (!(neighborRegionMask & regionBit)) continue;

            let neighborDistance = rootDistance;
            const isFixedRoot = neighborRegionMask === regionBit;
            if (!isFixedRoot) {
              const neighborSize = shardSizes[neighborRoot];
              neighborDistance = rootDistance + neighborSize;
              if (neighborDistance > maxExtraSize) {
                // A path that enters a shard must reserve the whole shard, even
                // when it only needs to pass through one of its cells.
                this._dropShardRegion(shardMasks, neighborRoot, regionBit);
                continue;
              }
            }

            visitMarks[neighborRoot] = visitId;
            rootsByDistance[neighborDistance * numGridCells
              + rootCountsByDistance[neighborDistance]++] = neighborRoot;
            if (isFixedRoot) {
              reachedFixedSize += shardSizes[neighborRoot];
            } else {
              stack[componentRootCount++] = neighborRoot;
              componentSize += shardSizes[neighborRoot];
            }
          }
        }
      }
    }

    this._scratchGridCells0Size = componentRootCount;
    if (reachedFixedSize < fixedSize) return 0;
    return componentSize;
  }

  // Removes shards from the component that cannot fit in any valid size-s selection
  // with distinct fixed values; returns the remaining cell weight.
  _pruneValueInfeasibleShards(
    shards, regionBit, componentRootCount, componentSize, baseSize, baseFixedValueMask) {
    const shardMasks = shards.masks;
    const stack = this._scratchGridCells0;
    const shardSizes = shards.sizes;
    const shardFixedValueMasks = shards.fixedValueMasks;
    const regionSize = this._regionSize;
    let remainingComponentSize = componentSize;

    for (let i = 0; i < componentRootCount; i++) {
      const root = stack[i];
      const rootFixedValueMask = shardFixedValueMasks[root];
      if (!(baseFixedValueMask | rootFixedValueMask)) continue;

      let compatibleSize = baseSize;
      for (let j = 0; j < componentRootCount; j++) {
        const componentRoot = stack[j];
        const componentFixedValueMask = shardFixedValueMasks[componentRoot];
        if (componentFixedValueMask & baseFixedValueMask) continue;
        if (componentRoot !== root && (componentFixedValueMask & rootFixedValueMask)) continue;
        compatibleSize += shardSizes[componentRoot];
        if (compatibleSize >= regionSize) break;
      }

      if (compatibleSize < regionSize) {
        this._dropShardRegion(shardMasks, root, regionBit);
        remainingComponentSize -= shardSizes[root];
      }
    }

    return remainingComponentSize;
  }

  // For each undersized fixed component, forces its single exit shard into the region;
  // returns false if any component has no exit (contradiction).
  _forceComponentDoors(grid, shards, checkRegionsMask) {
    const shardMasks = shards.masks;
    const numGridCells = this._numGridCells;
    const neighbors = this._neighbors;
    const shardOffset = this._regionShardOffset;
    const visitMarks = this._visitMarks;
    const stack = this._scratchGridCells0;
    const shardSizes = shards.sizes;
    const nextCells = shards.nextCells;
    const regionSize = this._regionSize;

    let regionValues = checkRegionsMask;
    while (regionValues) {
      const regionBit = regionValues & -regionValues;
      regionValues ^= regionBit;
      const visitId = this._nextVisitId();
      let forcedCount = 0;

      for (let startRoot = 0; startRoot < numGridCells; startRoot++) {
        if (!shardSizes[startRoot]
          || visitMarks[startRoot] === visitId
          || shardMasks[startRoot] !== regionBit) {
          continue;
        }

        let stackSize = 0;
        let componentSize = 0;
        let doorRoot = NO_CELL;
        let doorCount = 0;
        stack[stackSize++] = startRoot;
        visitMarks[startRoot] = visitId;

        // Work on the whole connected fixed component. A single fixed shard may
        // have one apparent exit even when adjacent fixed shards give the
        // component several ways out.
        for (let componentIndex = 0; componentIndex < stackSize; componentIndex++) {
          const root = stack[componentIndex];
          componentSize += shardSizes[root];

          for (let cell = root; cell !== NO_CELL; cell = nextCells[cell]) {
            const neighborOffset = cell << 2;
            for (let dir = 0; dir < 4; dir++) {
              const neighbor = neighbors[neighborOffset + dir];
              if (neighbor === NO_CELL) continue;

              const neighborRoot = grid[shardOffset + neighbor];
              if (neighborRoot === root) continue;

              const neighborMask = shardMasks[neighborRoot];
              if (neighborMask === regionBit) {
                if (visitMarks[neighborRoot] !== visitId) {
                  visitMarks[neighborRoot] = visitId;
                  stack[stackSize++] = neighborRoot;
                }
              } else if (doorCount < 2 && (neighborMask & regionBit)) {
                if (doorRoot === NO_CELL) {
                  doorRoot = neighborRoot;
                  doorCount = 1;
                } else if (doorRoot !== neighborRoot) {
                  doorCount = 2;
                }
              }
            }
          }
        }

        if (componentSize >= regionSize) continue;
        if (!doorCount) return false;
        if (doorCount !== 1) continue;

        stack[numGridCells - ++forcedCount] = doorRoot;
      }

      for (let i = 0; i < forcedCount; i++) {
        const root = stack[numGridCells - i - 1];
        this._fixShardRegion(shardMasks, root, regionBit);
      }
    }

    return true;
  }

  // Accumulates per-region fixed weight, possible weight, and value mask into _regionScanData;
  // marks dirty regions where possible weight changed since the last stable scan.
  _scanRegionCandidates(grid, shards, regions) {
    const regionScanData = regions.scanData;
    const fixedValueMasks = regions.fixedValueMasks;
    regionScanData.fill(0);
    fixedValueMasks.fill(0);

    const numGridCells = this._numGridCells;
    const numRegions = this._numRegions;
    const shardSizes = shards.sizes;
    const shardValueMasks = shards.masks;
    const shardFixedValueMasks = shards.fixedValueMasks;
    const firstFixedRootByRegion = regions.firstFixedRoot;
    const possibleCountCacheOffset = this._possibleCountCacheOffset;
    const regionCellOffset = this._regionCellOffset;
    let connectivityDirtyRegionsMask = this._connectivityDirtyRegionsMask;
    let hasPossibleRegionCells = false;
    // One scan feeds size validation, value-pair validation, fixed-value
    // conflicts, and connectivity dirtying.
    for (let root = 0; root < numGridCells; root++) {
      const shardSize = shardSizes[root];
      if (!shardSize) continue;

      const regionMask = grid[regionCellOffset + root];
      if (!regionMask) return false;
      const shardValueMask = shardValueMasks[root];

      if (!(regionMask & (regionMask - 1))) {
        const region = 31 - Math.clz32(regionMask);
        const scanData = regionScanData[region] | (shardValueMask << REGION_VALUE_MASK_SHIFT);
        const fixedCount = ((scanData >>> REGION_FIXED_COUNT_SHIFT)
          & REGION_FIXED_COUNT_MASK) + shardSize;
        if (fixedCount > this._regionSize) return false;
        // Roots are scanned in increasing index order, so the first fixed shard
        // seen is the lowest-index one; connectivity reuses it as its seed.
        if (fixedCount === shardSize) firstFixedRootByRegion[region] = root;
        regionScanData[region] = (scanData & ~(REGION_FIXED_COUNT_MASK << REGION_FIXED_COUNT_SHIFT))
          | (fixedCount << REGION_FIXED_COUNT_SHIFT);
        const fixedValueMask = shardFixedValueMasks[root];
        if (fixedValueMask) {
          if (fixedValueMasks[region] & fixedValueMask) return false;
          fixedValueMasks[region] |= fixedValueMask;
        }
      } else {
        hasPossibleRegionCells = true;
        let regionValues = regionMask;
        while (regionValues) {
          const regionBit = regionValues & -regionValues;
          regionValues ^= regionBit;
          const region = 31 - Math.clz32(regionBit);
          regionScanData[region] = (regionScanData[region]
            | (shardValueMask << REGION_VALUE_MASK_SHIFT)) + shardSize;
        }
      }
    }

    for (let region = 0; region < numRegions; region++) {
      const possibleCount = regionScanData[region] & REGION_POSSIBLE_COUNT_MASK;
      // Dirty labels accumulate across local rescans until connectivity runs.
      if (grid[possibleCountCacheOffset + region] !== possibleCount) {
        connectivityDirtyRegionsMask |= 1 << region;
      }
      grid[possibleCountCacheOffset + region] = possibleCount;
    }
    if (!hasPossibleRegionCells) {
      connectivityDirtyRegionsMask |= this._regionMask;
    }
    this._connectivityDirtyRegionsMask = connectivityDirtyRegionsMask;

    return true;
  }

  // Phase 1: restricts region labels so label k may first appear only after label k−1,
  // breaking the label-permutation symmetry (§4 in CHAOS_CONSTRUCTION.md).
  _enforceCanonicalOrder(grid, handlerAccumulator) {
    const regionCellOffset = this._regionCellOffset;
    const regionMask = this._regionMask;
    const regionCellLimit = regionCellOffset + this._numGridCells;
    let allowedMask = ((this._canonicalSeedMask << 1) | 1) & regionMask;

    // Labels may introduce only the next unseen region number. This is based
    // on possible labels, not fixed labels, so it remains sound mid-search.
    for (let regionCell = regionCellOffset;
      regionCell < regionCellLimit && allowedMask !== regionMask;
      regionCell++) {
      const oldMask = grid[regionCell];
      const newMask = oldMask & allowedMask;
      if (!newMask) return false;
      if (newMask !== oldMask) {
        grid[regionCell] = newMask;
        handlerAccumulator.addForCell(regionCell);
      }
      allowedMask |= newMask << 1;
    }

    return true;
  }

  // Phase 3: for each dirty region, prunes shards that cannot reach a connected s-cell
  // component, forces uniquely-determined components, and checks door bottlenecks.
  _enforceConnectivity(grid, handlerAccumulator, shards, regions) {
    // Phase 3: connectivity runs on the current shard graph for dirty labels only.
    const numGridCells = this._numGridCells;
    const regionCellOffset = this._regionCellOffset;
    const stack = this._scratchGridCells0;
    const shardSizes = shards.sizes;
    const shardMasks = shards.masks;
    const regionScanData = regions.scanData;
    const fixedValueMasks = regions.fixedValueMasks;
    const firstFixedRootByRegion = regions.firstFixedRoot;
    const fixedSizeByRegion = regions.fixedSize;
    const visitMarks = this._visitMarks;
    const regionSize = this._regionSize;
    const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
    if (!dirtyRegionsMask) return true;

    shardMasks.set(
      grid.subarray(regionCellOffset, regionCellOffset + numGridCells));
    // Seed live fixed weights from the scan; the helpers keep them current as
    // the pass fixes more shards, replacing the old per-region rescan.
    for (let region = 0; region < this._numRegions; region++) {
      fixedSizeByRegion[region] = (regionScanData[region] >>> REGION_FIXED_COUNT_SHIFT)
        & REGION_FIXED_COUNT_MASK;
    }

    for (let region = 0; region < this._numRegions; region++) {
      const regionBit = 1 << region;
      if (!(dirtyRegionsMask & regionBit)) continue;

      const visitId = this._nextVisitId();
      // Fixed weight reflects both the scan and any shards fixed earlier in this
      // pass; the seed root is a shard currently fixed to the region.
      const fixedSize = fixedSizeByRegion[region];

      if (fixedSize) {
        const fixedRoot = firstFixedRootByRegion[region];
        // Fixed shards choose the component. Everything outside it loses this
        // region label; exact-size components are forced.
        const componentSize = this._growComponentFromCore(
          grid, shards, regionBit, fixedSize, fixedRoot, visitId);
        if (componentSize < regionSize) return false;
        const componentRootCount = this._scratchGridCells0Size;
        const fixedValueMask = fixedValueMasks[region];
        let remainingComponentSize = componentSize;

        for (let root = 0; root < numGridCells; root++) {
          if (!shardSizes[root] || !(shardMasks[root] & regionBit)) continue;
          if (visitMarks[root] !== visitId) {
            this._dropShardRegion(shardMasks, root, regionBit);
          }
        }

        if (remainingComponentSize > regionSize) {
          remainingComponentSize = this._pruneValueInfeasibleShards(
            shards, regionBit, componentRootCount, componentSize, fixedSize, fixedValueMask);
        }

        if (remainingComponentSize < regionSize) return false;
        if (remainingComponentSize === regionSize) {
          for (let i = 0; i < componentRootCount; i++) {
            const root = stack[i];
            if (!(shardMasks[root] & regionBit)) continue;
            this._fixShardRegion(shardMasks, root, regionBit);
          }
        }
      } else {
        // With no fixed shard, do not choose among viable components. Only
        // reject or prune components that cannot host a full region.
        let hasViableComponent = false;

        for (let startRoot = 0; startRoot < numGridCells; startRoot++) {
          if (!shardSizes[startRoot]) continue;
          if (!(shardMasks[startRoot] & regionBit)) continue;
          if (visitMarks[startRoot] === visitId) continue;

          const componentSize = this._collectShardComponent(
            grid, shards, startRoot, regionBit, visitId);
          const componentRootCount = this._scratchGridCells0Size;

          if (componentSize >= regionSize) {
            const remainingComponentSize = this._pruneValueInfeasibleShards(
              shards, regionBit, componentRootCount, componentSize, 0, 0);

            if (remainingComponentSize >= regionSize) {
              hasViableComponent = true;
            } else {
              for (let i = 0; i < componentRootCount; i++) {
                const root = stack[i];
                if (!(shardMasks[root] & regionBit)) continue;
                this._dropShardRegion(shardMasks, root, regionBit);
              }
            }
          } else {
            for (let i = 0; i < componentRootCount; i++) {
              this._dropShardRegion(shardMasks, stack[i], regionBit);
            }
          }
        }

        if (!hasViableComponent) return false;
      }
    }

    let bottleneckRegionsMask = this._connectivityDirtyRegionsMask;
    for (let region = 0; region < this._numRegions; region++) {
      const fixedCount = (regionScanData[region] >>> REGION_FIXED_COUNT_SHIFT)
        & REGION_FIXED_COUNT_MASK;
      // A bottleneck needs a door plus at least one cell beyond it (two free
      // cells). With zero or one free cell the connectivity traversal already
      // decides the region, so skip the check even for dirty labels.
      if (fixedCount + 2 > regionSize) {
        bottleneckRegionsMask &= ~(1 << region);
      } else if ((fixedCount << 1) >= regionSize) {
        // Dirty labels always run; clean labels wait until regions are half-fixed.
        bottleneckRegionsMask |= (1 << region);
      }
    }
    if (!this._forceComponentDoors(grid, shards, bottleneckRegionsMask)) return false;

    for (let root = 0; root < numGridCells; root++) {
      if (!shardSizes[root] || shardMasks[root] === grid[regionCellOffset + root]) continue;
      this._writeShardRegion(grid, root, shardMasks[root], handlerAccumulator);
    }

    return true;
  }

  // When a region's active value set equals s, places any value confined to one cell
  // and fixes that cell's shard; returns true if a placement fired (caller must rescan).
  _enforceHiddenRegionValueSingles(
    grid, handlerAccumulator, shards, regions, checkRegionsMask,
    hiddenDuplicateValueMasks) {
    // Apply at most one precomputed shard-level witness after confirming the member cell.
    const firstRootByRegionValue = this._scratchRoots0;
    const fixedValueMasks = regions.fixedValueMasks;
    const nextCells = shards.nextCells;
    const regionCellOffset = this._regionCellOffset;
    const numValues = this._numValues;
    const regionSize = this._regionSize;
    const regionScanData = regions.scanData;

    while (checkRegionsMask) {
      const regionBit = checkRegionsMask & -checkRegionsMask;
      checkRegionsMask ^= regionBit;
      const region = 31 - Math.clz32(regionBit);
      // Use the per-region accumulated value mask: only values present in some
      // non-fixed candidate cell of this region, rebuilt by the shard scan above.
      const regionValueMask = regionScanData[region] >>> REGION_VALUE_MASK_SHIFT;
      // Hidden single is only valid when the region's active value set is
      // exactly regionSize: then AllDifferent forces every active value to
      // appear, so a value confined to one cell really must go there.
      if (countOnes16bit(regionValueMask | fixedValueMasks[region]) !== regionSize) continue;
      let hiddenValues = regionValueMask & ~(fixedValueMasks[region] | hiddenDuplicateValueMasks[region]);
      while (hiddenValues) {
        const valueBit = hiddenValues & -hiddenValues;
        hiddenValues ^= valueBit;
        const valueIndex = 31 - Math.clz32(valueBit);
        const root = firstRootByRegionValue[region * numValues + valueIndex];

        let cell = NO_CELL;
        let cellCount = 0;
        for (let candidateCell = root; candidateCell !== NO_CELL; candidateCell = nextCells[candidateCell]) {
          if (!(grid[candidateCell] & valueBit)) continue;
          cell = candidateCell;
          if (++cellCount > 1) break;
        }
        if (cellCount !== 1) continue;

        const oldRegionMask = grid[regionCellOffset + root];
        const regionChanged = oldRegionMask !== regionBit;
        let changed = false;
        if (grid[cell] !== valueBit) {
          grid[cell] = valueBit;
          handlerAccumulator.addForCell(cell);
          changed = true;
        }
        if (regionChanged) this._writeShardRegion(grid, root, regionBit, handlerAccumulator);
        if (changed || regionChanged) return true;
      }
    }

    return false;
  }

  // Phase 2b: fixed-point loop — scan shard summaries, apply size/value/full-region
  // pruning rules, then attempt a hidden-region-value single (§6 in CHAOS_CONSTRUCTION.md).
  _enforceShardHouseRules(grid, handlerAccumulator, shards, regions) {
    // Phase 2: scan summaries, prune shard labels, then use stable witnesses.
    const regionScanData = regions.scanData;
    const fixedValueMasks = regions.fixedValueMasks;
    // Hidden-single duplicate masks live here until connectivity reuses it.
    const hiddenDuplicateValueMasks = this._scratchRegions0;
    const firstRootByRegionValue = this._scratchRoots0;
    const shardSizes = shards.sizes;
    const shardValueMasks = shards.masks;
    const shardFixedValueMasks = shards.fixedValueMasks;
    const regionSize = this._regionSize;
    const numValues = this._numValues;
    const numGridCells = this._numGridCells;
    const regionCellOffset = this._regionCellOffset;

    while (true) {
      // This pass intentionally combines the old size, value-pair, completed
      // region, and shard fixed-value rules so they share one shard scan.
      if (!this._scanRegionCandidates(grid, shards, regions)) return false;

      let fullRegionsMask = 0;
      let fixedValueRegionsMask = 0;
      let hiddenRegionsMask = 0;
      for (let region = 0; region < this._numRegions; region++) {
        const regionBit = 1 << region;
        const scanData = regionScanData[region];
        const fixedCount = (scanData >>> REGION_FIXED_COUNT_SHIFT) & REGION_FIXED_COUNT_MASK;
        const possibleCount = scanData & REGION_POSSIBLE_COUNT_MASK;
        if (fixedCount > regionSize || fixedCount + possibleCount < regionSize) return false;
        if (countOnes16bit(scanData >>> REGION_VALUE_MASK_SHIFT) < regionSize) return false;
        if (fixedValueMasks[region]) fixedValueRegionsMask |= regionBit;
        // Hidden singles are opportunistic; only enforce after regions are half-fixed
        if ((fixedCount << 1) >= regionSize && countOnes16bit(fixedValueMasks[region]) < regionSize) {
          hiddenRegionsMask |= regionBit;
          regionScanData[region] = scanData & REGION_COUNT_MASK;
        }
        if (fixedCount === regionSize && possibleCount) {
          fullRegionsMask |= regionBit;
        }
      }

      let changed = false;
      if (hiddenRegionsMask) {
        hiddenDuplicateValueMasks.fill(0);
      }
      if (fullRegionsMask || fixedValueRegionsMask || hiddenRegionsMask) {
        for (let root = 0; root < numGridCells; root++) {
          const shardSize = shardSizes[root];
          if (!shardSize) continue;

          const regionMask = grid[regionCellOffset + root];
          let keepMask = regionMask;
          if (hiddenRegionsMask && !changed) {
            let candidateRegions = regionMask & hiddenRegionsMask;
            if (candidateRegions) {
              const shardValueMask = shardValueMasks[root];
              while (candidateRegions) {
                const regionBit = candidateRegions & -candidateRegions;
                candidateRegions ^= regionBit;
                const region = 31 - Math.clz32(regionBit);
                const valueBits = shardValueMask & ~fixedValueMasks[region];
                const hiddenSeenValueMask = regionScanData[region] >>> REGION_VALUE_MASK_SHIFT;
                let firstSeenValues = valueBits & ~hiddenSeenValueMask;
                while (firstSeenValues) {
                  const valueBit = firstSeenValues & -firstSeenValues;
                  firstSeenValues ^= valueBit;
                  const valueIndex = 31 - Math.clz32(valueBit);
                  firstRootByRegionValue[region * numValues + valueIndex] = root;
                }
                hiddenDuplicateValueMasks[region] |= hiddenSeenValueMask & valueBits;
                regionScanData[region] |= valueBits << REGION_VALUE_MASK_SHIFT;
              }
            }
          }

          const fixedValueMask = shardFixedValueMasks[root];
          if (fixedValueMask && (regionMask & (regionMask - 1))) {
            let regionValues = regionMask & fixedValueRegionsMask;
            while (regionValues) {
              const regionBit = regionValues & -regionValues;
              regionValues ^= regionBit;
              const region = 31 - Math.clz32(regionBit);
              if (fixedValueMasks[region] & fixedValueMask) {
                keepMask &= ~regionBit;
              }
            }
          }

          if ((keepMask & fullRegionsMask) && (keepMask & (keepMask - 1))) {
            keepMask &= ~fullRegionsMask;
          }

          if (!keepMask) return false;
          if (keepMask === regionMask) continue;
          this._writeShardRegion(grid, root, keepMask, handlerAccumulator);
          changed = true;
        }
      }

      if (changed) continue;

      if (hiddenRegionsMask) {
        if (this._enforceHiddenRegionValueSingles(
          grid, handlerAccumulator, shards, regions, hiddenRegionsMask,
          hiddenDuplicateValueMasks)) return DEFER_CONNECTIVITY;
      }

      return true;
    }
  }

  enforceConsistency(grid, handlerAccumulator) {
    this._connectivityDirtyRegionsMask = 0;
    const shards = this._shards;
    const regions = this._regions;

    // Phase order keeps derived summaries local and avoids stale connectivity input.
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;
    if (!this._rebuildShards(grid, handlerAccumulator, shards)) return false;

    const shardConsistencyResult =
      this._enforceShardHouseRules(grid, handlerAccumulator, shards, regions);
    if (!shardConsistencyResult) return false;
    if (shardConsistencyResult === DEFER_CONNECTIVITY) {
      return true;
    }

    if (!this._enforceConnectivity(grid, handlerAccumulator, shards, regions)) return false;

    return true;
  }
}

export class ChaosArrow extends SudokuConstraintHandler {
  constructor(controlCell, regionArms, regionRunArms, offset) {
    const startCell = regionArms[0][0];
    if (regionArms.some(arm => arm[0] !== startCell)) {
      throw new InvalidConstraintError('ChaosArrow arms must share their first region cell.');
    }
    let activeRegionArms = regionArms.filter(arm => arm.length > 1);
    let activeRegionRunArms = regionRunArms.filter((_, index) => regionArms[index].length > 1);
    if (!activeRegionArms.length) {
      activeRegionArms = [regionArms[0]];
      activeRegionRunArms = [regionRunArms[0]];
    }

    super([controlCell, ...activeRegionArms.flat()]);

    this._controlCell = controlCell;
    this._regionArms = activeRegionArms.map(arm => Uint16Array.from(arm));
    this._duplicateStartCount = activeRegionArms.length - 1;
    // Scratch is per-enforcement: possible lengths per arm, and guaranteed
    // same-shard prefix length per physical arm.
    this._armLengthMasks = new Uint16Array(activeRegionArms.length);
    this._armMinLengths = new Uint8Array(activeRegionArms.length);
    // Per arm position, the region labels that support a run ending there.
    this._armRunSupportMasks = activeRegionArms.map(arm => new Uint16Array(arm.length));
    this._regionRunArms = activeRegionRunArms.map(arm => Uint16Array.from(arm));
    this._canMergeRegionShards = false;
    this._regionShardState = null;
    this._offset = +offset;
    if (this._offset !== 0 && this._offset !== 1) {
      throw new InvalidConstraintError('ChaosArrow offset must be 0 or 1.');
    }
  }

  attachRegionShardState(regionShardState) {
    this._regionShardState = regionShardState;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._offset += shape.valueOffset;
    const maxArmCells = this._regionArms.reduce((sum, arm) => sum + arm.length, 0)
      - this._duplicateStartCount;
    const maxValueCount = Math.min(shape.numValues, maxArmCells - this._offset);
    if (maxValueCount < 1) return false;

    this._canMergeRegionShards = this._regionRunArms.every(arm => {
      for (let i = 1; i < arm.length; i++) {
        if (!cellsAreAdjacent(arm[i - 1], arm[i], shape.numCols)) return false;
      }
      return true;
    });

    // Connectivity: If every orthogonal/ neighbour is the first step of an arm
    // (e.g. arrows in all four directions),
    // the run must extend into that arm, so the run length is >= 2. Unlike a
    // count, a run length has no per-cell growth, so this is purely static.
    const neighbors = neighborTable(shape.numRows, shape.numCols);
    const armSteps = new Set();
    for (const arm of this._regionRunArms) {
      if (arm.length >= 2) armSteps.add(arm[1]);
    }
    const enclosed = enclosingNeighbors(
      neighbors, this._regionRunArms[0][0], armSteps) !== null;

    // Keep only feasible run lengths [minLength, maxValueCount]
    const minLength = enclosed ? 2 : 1;
    const loBit = Math.max(0, minLength - 1 - this._offset);
    if (loBit >= maxValueCount) return false;
    const rangeMask = (1 << maxValueCount) - (1 << loBit);
    return !!(initialGridCells[this._controlCell] &= rangeMask);
  }

  _lengthMaskForRegion(grid, arm, regionBit, maxControlLength, minLength) {
    // A length is valid when the prefix can be this region and the next cell,
    // if any, is not fixed to the same region.
    const maxLength = Math.min(maxControlLength, arm.length);
    let lengthMask = 0;
    for (let length = minLength; length <= maxLength; length++) {
      if (length > minLength && !(grid[arm[length - 1]] & regionBit)) break;
      if (length < arm.length && grid[arm[length]] === regionBit) continue;
      lengthMask |= 1 << (length - 1);
    }
    return lengthMask;
  }

  _updateSingleArmRunSupport(controlMask, regionBit) {
    let lengths = this._armLengthMasks[0] & controlMask;
    this._supportedControlMask |= lengths;
    const runSupportMasks = this._armRunSupportMasks[0];
    while (lengths) {
      const lengthBit = lengths & -lengths;
      lengths ^= lengthBit;
      runSupportMasks[LookupTables.toValue(lengthBit) - 1] |= regionBit;
    }
  }

  _updateMultiArmRunSupport(controlMask, regionBit) {
    // For multi-arm arrows, the control is the total run length across all
    // arms, with the shared start cell counted once.
    let totalMin = 0;
    let totalMax = 0;
    for (let armIndex = 0; armIndex < this._regionArms.length; armIndex++) {
      const lengthMask = this._armLengthMasks[armIndex];
      const minLength = LookupTables.minValue(lengthMask);
      const maxLength = LookupTables.maxValue(lengthMask);
      totalMin += minLength;
      totalMax += maxLength;
    }

    totalMin -= this._duplicateStartCount;
    totalMax -= this._duplicateStartCount;
    const totalRangeMask = (1 << totalMax) - (1 << (totalMin - 1));
    const supportedControlMask = controlMask & totalRangeMask;
    if (!supportedControlMask) return;
    this._supportedControlMask |= supportedControlMask;

    for (let armIndex = 0; armIndex < this._regionArms.length; armIndex++) {
      let lengths = this._armLengthMasks[armIndex];
      const minLength = LookupTables.minValue(lengths);
      const maxLength = LookupTables.maxValue(lengths);
      const otherMin = totalMin - minLength;
      const otherMax = totalMax - maxLength;
      const runSupportMasks = this._armRunSupportMasks[armIndex];
      while (lengths) {
        const lengthBit = lengths & -lengths;
        lengths ^= lengthBit;
        const length = LookupTables.toValue(lengthBit);
        const minControl = otherMin + length;
        const maxControl = otherMax + length;
        const rangeMask = (1 << maxControl) - (1 << (minControl - 1));
        if (controlMask & rangeMask) {
          runSupportMasks[length - 1] |= regionBit;
        }
      }
    }
  }

  _updateRunSupportMasks(grid, controlMask) {
    const maxControlLength = LookupTables.maxValue(controlMask);
    const shardState = this._regionShardState;
    const startRoot = shardState.findRoot(grid, this._regionRunArms[0][0]);
    let regions = grid[this._regionArms[0][0]];
    // Same-shard prefixes are already forced to share a region. Their region
    // mask intersection gives a lower bound and removes impossible labels up front.
    for (let armIndex = 0; armIndex < this._regionRunArms.length; armIndex++) {
      const runArm = this._regionRunArms[armIndex];
      const regionArm = this._regionArms[armIndex];
      let minLength = 1;
      let minRegionMask = grid[regionArm[0]];
      while (minLength < runArm.length && shardState.findRoot(grid, runArm[minLength]) === startRoot) {
        minRegionMask &= grid[regionArm[minLength]];
        minLength++;
      }
      this._armMinLengths[armIndex] = minLength;
      regions &= minRegionMask;
    }

    while (regions) {
      const regionBit = regions & -regions;
      regions ^= regionBit;

      let supported = true;
      for (let armIndex = 0; armIndex < this._regionArms.length; armIndex++) {
        const lengthMask = this._lengthMaskForRegion(
          grid, this._regionArms[armIndex], regionBit, maxControlLength,
          this._armMinLengths[armIndex]);
        this._armLengthMasks[armIndex] = lengthMask;
        if (!lengthMask) {
          supported = false;
          break;
        }
      }
      if (!supported) continue;

      if (this._regionArms.length === 1) {
        this._updateSingleArmRunSupport(controlMask, regionBit);
      } else {
        this._updateMultiArmRunSupport(controlMask, regionBit);
      }
    }
  }

  _applySupportedCellMasks(grid, handlerAccumulator) {
    // Apply the supported run lengths back to CC candidates, and persist any
    // newly forced prefixes into the shared shard state.
    for (let armIndex = 0; armIndex < this._regionArms.length; armIndex++) {
      const arm = this._regionArms[armIndex];
      const runSupportMasks = this._armRunSupportMasks[armIndex];

      let minSupportedLength = 0;
      for (let i = this._armMinLengths[armIndex] - 1; i < arm.length; i++) {
        if (runSupportMasks[i]) {
          minSupportedLength = i + 1;
          break;
        }
      }
      if (!minSupportedLength) return false;

      const appliedCount = this._armMinLengths[armIndex];
      if (this._canMergeRegionShards && minSupportedLength > appliedCount) {
        const runArm = this._regionRunArms[armIndex];
        const startCell = runArm[0];
        for (let i = appliedCount; i < minSupportedLength; i++) {
          this._regionShardState.merge(grid, startCell, runArm[i], handlerAccumulator);
        }
      }

      let suffixRunSupport = 0;
      for (let i = arm.length - 1; i >= 0; i--) {
        const regionCell = arm[i];
        const cellMask = grid[regionCell];
        suffixRunSupport |= runSupportMasks[i];
        let supportedMask = suffixRunSupport;

        if (minSupportedLength < i) {
          supportedMask |= cellMask;
        }

        if (i > 0) {
          const boundaryRunSupport = runSupportMasks[i - 1];
          if (boundaryRunSupport) {
            supportedMask |= (boundaryRunSupport & (boundaryRunSupport - 1))
              ? cellMask
              : cellMask & ~boundaryRunSupport;
          }
        }

        const newMask = cellMask & supportedMask;
        if (!newMask) return false;
        if (newMask !== cellMask) {
          grid[regionCell] = newMask;
          handlerAccumulator.addForCell(regionCell);
        }
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const controlCell = this._controlCell;
    let controlMask = grid[controlCell];
    this._supportedControlMask = 0;
    for (const runSupportMasks of this._armRunSupportMasks) {
      runSupportMasks.fill(0);
    }

    // Shift control mask so internal arm length = control value + offset.
    // The combined offset can be negative, so shift either direction.
    const offset = this._offset;
    const internalControlMask =
      offset >= 0 ? controlMask << offset : controlMask >>> -offset;
    this._updateRunSupportMasks(grid, internalControlMask);

    // Shift supported mask back to external control value space.
    const supportedControlMask = offset >= 0
      ? this._supportedControlMask >>> offset : this._supportedControlMask << -offset;
    if (!(controlMask &= supportedControlMask)) return false;
    if (controlMask !== grid[controlCell]) {
      grid[controlCell] = controlMask;
      handlerAccumulator.addForCell(controlCell);
    }

    return this._applySupportedCellMasks(grid, handlerAccumulator);
  }
}

export class ChaosCount extends SudokuConstraintHandler {
  constructor(controlCell, regionCells, regionRunCells, offset) {
    super([controlCell, ...regionCells]);
    this._controlCell = controlCell;
    this._regionCells = Uint16Array.from(regionCells);
    // Counted cells as raw grid positions (region-lane index minus the region
    // offset).
    this._regionRunCells = Uint16Array.from(regionRunCells);
    // Single-function scratch (only enforceConsistency): named by size, not role,
    // and aliased to a descriptive local at the use site.
    this._scratchRegionCells0 = new Uint16Array(regionCells.length);
    this._regionShardMergePairs = null;
    this._regionShardState = null;
    this._firstCellEnclosed = false;
    this._firstCellNeighbors = null;  // its neighbours, as region-lane cells
    this._offset = +offset;
    if (this._offset !== 0 && this._offset !== 1) {
      throw new InvalidConstraintError('ChaosCount offset must be 0 or 1.');
    }
  }

  attachRegionShardState(regionShardState) {
    this._regionShardState = regionShardState;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._offset += shape.valueOffset;
    const maxCount = Math.min(shape.numValues, this._regionCells.length - this._offset);

    const regionRunCells = this._regionRunCells;
    const mergePairs = [];
    for (let i = 1; i < regionRunCells.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!cellsAreAdjacent(regionRunCells[i], regionRunCells[j], shape.numCols)) continue;
        mergePairs.push(j, i);
      }
    }
    this._regionShardMergePairs = Uint8Array.from(mergePairs);

    // The first counted cell is always in its own region, so the count is >= 1.
    // Regions have size >= 2, so it also shares its region with
    // an orthogonal neighbour; if every neighbour is itself a counted cell that
    // neighbour is counted, so the count is >= 2. The neighbours (as region-lane
    // cells) are kept for the stronger per-region check in enforceConsistency.
    const neighbors = neighborTable(shape.numRows, shape.numCols);
    const counted = new Set(regionRunCells);
    const regionCellOffset = this._regionCells[0] - regionRunCells[0];
    const enclosingCells = enclosingNeighbors(neighbors, regionRunCells[0], counted);
    this._firstCellEnclosed = enclosingCells !== null;
    this._firstCellNeighbors = Uint16Array.from(
      enclosingCells ? enclosingCells.map(c => c + regionCellOffset) : []);
    const minCount = this._firstCellEnclosed ? 2 : 1;

    // Keep only the feasible counts [minCount, maxCount].
    const loBit = Math.max(0, minCount - 1 - this._offset);
    if (loBit >= maxCount) return false;
    const rangeMask = (1 << maxCount) - (1 << loBit);
    return !!(initialGridCells[this._controlCell] &= rangeMask);
  }

  enforceConsistency(grid, handlerAccumulator) {
    const controlCell = this._controlCell;
    const controlMask = grid[controlCell];
    const regionCells = this._regionCells;
    const firstRegionCell = regionCells[0];
    const firstRegionMask = grid[firstRegionCell];
    let supportedControlMask = 0;
    let supportedFirstRegionMask = 0;
    const supportedRegionCellMasks = this._scratchRegionCells0;
    supportedRegionCellMasks.fill(0);
    let regionValues = firstRegionMask;
    const numRegionCells = regionCells.length;
    // Shift control mask so internal count = control value + offset.
    // The combined offset can be negative, so shift either direction.
    const offset = this._offset;
    const internalControlMask =
      offset >= 0 ? controlMask << offset : controlMask >>> -offset;
    // Union of the regions a neighbour is already fixed to (singleton masks), so
    // the per-region connectivity check below is a single bit test.
    let fixedNeighborMask = regionValues;
    if (this._firstCellEnclosed) {
      fixedNeighborMask = 0;
      const firstCellNeighbors = this._firstCellNeighbors;
      for (let k = 0; k < firstCellNeighbors.length; k++) {
        const m = grid[firstCellNeighbors[k]];
        if (!(m & (m - 1))) fixedNeighborMask |= m;
      }
    }

    while (regionValues) {
      const regionBit = regionValues & -regionValues;
      regionValues ^= regionBit;
      let minCount = 1;
      let maxCount = 1;

      for (let i = 1; i < numRegionCells; i++) {
        const regionCell = regionCells[i];
        const regionMask = grid[regionCell];
        if (regionMask === regionBit) minCount++;
        if (regionMask & regionBit) maxCount++;
      }

      let countMask = internalControlMask & ((1 << maxCount) - (1 << (minCount - 1)));

      // Connectivity: an enclosed first cell needs a same-region neighbour.
      if (!(fixedNeighborMask & regionBit)) {
        countMask &= ~(1 << (minCount - 1));
      }

      if (!countMask) continue;
      supportedControlMask |= offset <= 0 ? countMask << -offset : countMask >>> offset;
      supportedFirstRegionMask |= regionBit;
      // Drop the lowest supported count (== minCount) to learn if an optional
      // cell may match, and the highest (== maxCount) to learn if one may not.
      const includeCountMask = countMask & ~(1 << (minCount - 1));
      const excludeCountMask = countMask & ~(1 << (maxCount - 1));

      for (let i = 1; i < numRegionCells; i++) {
        const regionCell = regionCells[i];
        const cellMask = grid[regionCell];
        if (cellMask === regionBit) {
          supportedRegionCellMasks[i] |= regionBit;
        } else {
          if (excludeCountMask || !(cellMask & regionBit)) supportedRegionCellMasks[i] |= cellMask & ~regionBit;
          if (includeCountMask && (cellMask & regionBit)) supportedRegionCellMasks[i] |= regionBit;
        }
      }
    }

    if (!supportedControlMask) return false;
    if (supportedControlMask !== controlMask) {
      grid[controlCell] = supportedControlMask;
      handlerAccumulator.addForCell(controlCell);
    }
    if (supportedFirstRegionMask !== firstRegionMask) {
      grid[firstRegionCell] = supportedFirstRegionMask;
      handlerAccumulator.addForCell(firstRegionCell);
    }

    for (let i = 1; i < regionCells.length; i++) {
      const regionCell = regionCells[i];
      const cellMask = grid[regionCell];
      const supportedMask = supportedRegionCellMasks[i] & cellMask;
      if (!supportedMask) return false;
      if (supportedMask !== cellMask) {
        grid[regionCell] = supportedMask;
        handlerAccumulator.addForCell(regionCell);
      }
    }

    const firstRegionBit = grid[firstRegionCell];
    if (this._regionShardMergePairs.length > 0 && this._regionShardState
      && !(firstRegionBit & (firstRegionBit - 1))) {
      const mergePairs = this._regionShardMergePairs;
      for (let i = 0; i < mergePairs.length; i += 2) {
        const indexA = mergePairs[i];
        const indexB = mergePairs[i + 1];
        if (grid[regionCells[indexA]] === firstRegionBit && grid[regionCells[indexB]] === firstRegionBit) {
          this._regionShardState.merge(
            grid, this._regionRunCells[indexA], this._regionRunCells[indexB], handlerAccumulator);
        }
      }
    }

    return true;
  }
}

export class ChaosFixedValueRegionExclusion extends SudokuConstraintHandler {
  static SINGLETON_HANDLER = true;

  constructor(sourceIndex, triggerCell, numGridCells, regionCellOffset) {
    super([triggerCell]);
    this._sourceIndex = sourceIndex;
    this._numGridCells = numGridCells;
    this._regionCellOffset = regionCellOffset;
    this.idStr = [this.constructor.name, sourceIndex, triggerCell].join('|');
  }

  enforceConsistency(grid, handlerAccumulator) {
    const sourceIndex = this._sourceIndex;
    const regionCellOffset = this._regionCellOffset;
    const value = grid[sourceIndex];
    if (value & (value - 1)) return true;

    const regionBit = grid[regionCellOffset + sourceIndex];
    if (regionBit & (regionBit - 1)) return true;

    const keepRegionMask = ~regionBit;
    const keepValueMask = ~value;

    const numGridCells = this._numGridCells;
    for (let i = 0; i < numGridCells; i++) {
      if (i === sourceIndex) continue;

      const otherRegionCell = regionCellOffset + i;
      const cellValue = grid[i];
      const otherRegionMask = grid[otherRegionCell];

      if (cellValue === value && (otherRegionMask & regionBit)) {
        if (!(grid[otherRegionCell] &= keepRegionMask)) return false;
        handlerAccumulator.addForCell(otherRegionCell);
      }

      if (otherRegionMask === regionBit && (cellValue & value)) {
        if (!(grid[i] &= keepValueMask)) return false;
        handlerAccumulator.addForCell(i);
      }
    }

    return true;
  }

  priority() {
    return 0;
  }
}
