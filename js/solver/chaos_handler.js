const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SudokuConstraintHandler, InvalidConstraintError } = await import('./handlers.js' + self.VERSION_PARAM);

export class ChaosConstruction extends SudokuConstraintHandler {
  static _NO_CELL = 0xffff;

  constructor(numGridCells, regionCellOffset) {
    const cells = new Uint8Array(numGridCells * 2);
    for (let cell = 0; cell < numGridCells; cell++) {
      cells[cell * 2] = cell;
      cells[cell * 2 + 1] = regionCellOffset + cell;
    }
    super(cells);

    this._numGridCells = numGridCells;
    this._regionCellOffset = regionCellOffset;
    this._canonicalAnchorCells = [0];
    this._regionRunLines = [];
    this.idStr = [this.constructor.name, this._numGridCells].join('|');
  }

  linkedSearchCells() {
    return this.cells;
  }

  addRegionLink(line, control) {
    if (line.length < 2) return;

    const regionLink = new Uint16Array(line.length + 1);
    regionLink[0] = control ?? this.constructor._NO_CELL;
    regionLink.set(line, 1);
    this._regionRunLines.push(regionLink);
  }

  _selectPriorityAnchorCells(shape, cellPriorities) {
    if (this._numRegions < 3 || this._numGridCells < 3) return [0];

    const { numRows, numCols, numValues } = shape;
    const regionCellOffset = this._regionCellOffset;
    const anchorScore = cell => cellPriorities[cell] + cellPriorities[regionCellOffset + cell];

    // Anchors break region-label symmetry; keeping them separated avoids
    // over-constraining one local corner of the layout.
    const separated = (cellA, cellB) => {
      const rowDistance = Math.abs((cellA / numCols | 0) - (cellB / numCols | 0));
      const colDistance = Math.abs((cellA % numCols) - (cellB % numCols));
      return rowDistance + colDistance >= numValues;
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
    this._regionSize = shape.numValues;
    this._numRegions = shape.numValues;
    if (shape.numGridCells !== shape.numValues * shape.numValues) {
      throw new InvalidConstraintError(
        'ChaosConstruction requires the number of regions to equal the number of values.');
    }
    // Region labels reuse the normal value bitmask representation.
    this._regionMask = (1 << this._numRegions) - 1;
    this._allValues = this._regionMask;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._configureShape(shape);

    const numGridCells = shape.numGridCells;
    const neighbors = new Uint16Array(numGridCells * 4);
    neighbors.fill(this.constructor._NO_CELL);
    for (let cell = 0; cell < numGridCells; cell++) {
      const row = cell / shape.numCols | 0;
      const col = cell % shape.numCols;
      const offset = cell * 4;
      if (col > 0) neighbors[offset] = cell - 1;
      if (col + 1 < shape.numCols) neighbors[offset + 1] = cell + 1;
      if (row > 0) neighbors[offset + 2] = cell - shape.numCols;
      if (row + 1 < shape.numRows) neighbors[offset + 3] = cell + shape.numCols;
    }
    this._neighbors = neighbors;

    // Per-region scan summaries. `_possibleCounts` and `_possibleValueMasks`
    // are reused as hidden-single scratch after scan validation consumes them.
    this._fixedCounts = new Uint16Array(this._numRegions);
    this._possibleCounts = new Uint16Array(this._numRegions);
    this._possibleValueMasks = new Uint16Array(this._numRegions);
    this._fixedValueMasks = new Uint16Array(this._numRegions);
    // Traversal scratch; `_rootScratch` also stores hidden-single witness roots.
    this._componentStack = new Uint8Array(numGridCells);
    this._visitMarks = new Uint16Array(numGridCells);
    this._rootScratch = new Uint8Array(this._regionSize * numGridCells);
    // Branch-state cache for connectivity: region labels are dirty when their
    // non-fixed candidate weight changes since the last stable scan.
    this._possibleCountCacheOffset = stateAllocator.allocate(
      new Uint16Array(this._numRegions).fill(this.constructor._NO_CELL));
    this._connectivityDirtyRegionsMask = 0;
    this._visitId = 0;
    // Branch-state union-find for cells that are known to occupy one region.
    const regionShardRoots = Uint16Array.from({ length: numGridCells }, (_, cell) => cell);
    const regionRunLines = this._regionRunLines;
    const noCell = this.constructor._NO_CELL;
    this._regionShardOffset = 0;
    let runLineCount = 0;
    for (let i = 0; i < regionRunLines.length; i++) {
      const line = regionRunLines[i];
      if (line[0] === noCell) {
        const root = line[1];
        for (let lineIndex = 2; lineIndex < line.length; lineIndex++) {
          this._mergeRegionShards(regionShardRoots, root, line[lineIndex]);
        }
      } else {
        regionRunLines[runLineCount++] = line;
      }
    }
    regionRunLines.length = runLineCount;
    // Dynamic run-line prefixes only grow within a branch, so each implied
    // merge is applied once and restored naturally by backtracking.
    this._regionRunProgressOffset = stateAllocator.allocate(new Uint8Array(runLineCount).fill(1));
    this._regionShardOffset = stateAllocator.allocate(regionShardRoots);
    // Per-shard summaries rebuilt from the branch-state union-find roots.
    this._regionShardSizes = new Uint8Array(numGridCells);
    this._regionShardScratchMasks = new Uint16Array(numGridCells);
    this._regionShardFixedValueMasks = new Uint16Array(numGridCells);
    this._regionShardRestrictedValueFlags = new Uint8Array(numGridCells);
    this._regionShardNextCells = new Uint16Array(numGridCells);
    const regionCellOffset = this._regionCellOffset;

    for (let i = 0; i < numGridCells; i++) {
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
    const anchorCells = this._selectPriorityAnchorCells(shape, cellPriorities);
    const numAnchors = Math.min(anchorCells.length, this._numRegions);
    this._canonicalAnchorCells = anchorCells.slice(0, numAnchors);
  }

  priority() {
    return 2;
  }

  _nextVisitId() {
    this._visitId++;
    if (this._visitId === this.constructor._NO_CELL) {
      this._visitMarks.fill(0);
      this._visitId = 1;
    }
    return this._visitId;
  }

  _setRegionShardMask(grid, root, mask, handlerAccumulator) {
    const regionCellOffset = this._regionCellOffset;
    const nextCells = this._regionShardNextCells;
    const noCell = this.constructor._NO_CELL;

    // A shard is one same-region unit, so every member's CC cell gets the same mask.
    for (let cell = root; cell !== noCell; cell = nextCells[cell]) {
      const regionCell = regionCellOffset + cell;
      if (grid[regionCell] === mask) continue;
      grid[regionCell] = mask;
      handlerAccumulator.addForCell(regionCell);
    }
  }

  _removeConnectivityShardRegion(shardMasks, root, regionBit) {
    // Connectivity only removes labels from roots with at least one other candidate.
    const oldMask = shardMasks[root];
    shardMasks[root] = oldMask & ~regionBit;
    this._connectivityDirtyRegionsMask |= oldMask;
  }

  _setConnectivityShardRegion(shardMasks, root, regionBit) {
    this._connectivityDirtyRegionsMask |= shardMasks[root];
    shardMasks[root] = regionBit;
  }

  _mergeRegionShards(grid, cellA, cellB) {
    const offset = this._regionShardOffset;
    let rootA = grid[offset + cellA];
    let rootB = grid[offset + cellB];
    if (rootA === rootB) return;
    while (rootA !== cellA) {
      cellA = rootA;
      rootA = grid[offset + cellA];
    }
    while (rootB !== cellB) {
      cellB = rootB;
      rootB = grid[offset + cellB];
    }
    if (rootA === rootB) return;
    // Keep roots monotonic so shard member lists can be rebuilt in cell order.
    if (rootB < rootA) [rootA, rootB] = [rootB, rootA];
    grid[offset + rootB] = rootA;
  }

  _updateRegionRunLineShards(grid) {
    const regionRunLines = this._regionRunLines;
    const progressOffset = this._regionRunProgressOffset;
    for (let i = 0; i < regionRunLines.length; i++) {
      const line = regionRunLines[i];
      const count = LookupTables.minValue(grid[line[0]]);
      const appliedCount = grid[progressOffset + i];
      if (count <= appliedCount || count >= line.length) continue;

      // minValue gives the prefix that is already guaranteed even before the
      // run control is fixed.
      const startCell = line[1];
      for (let lineIndex = appliedCount + 1; lineIndex <= count; lineIndex++) {
        this._mergeRegionShards(grid, startCell, line[lineIndex]);
      }
      grid[progressOffset + i] = count;
    }
  }

  _updateFixedRegionShards(grid) {
    const noCell = this.constructor._NO_CELL;
    const neighbors = this._neighbors;
    const regionCellOffset = this._regionCellOffset;

    // Adjacent cells fixed to the same region label are already one connected
    // part of that final region.
    for (let cell = 0; cell < this._numGridCells; cell++) {
      const regionMask = grid[regionCellOffset + cell];
      if (!regionMask || (regionMask & (regionMask - 1))) continue;

      const neighborOffset = cell << 2;
      const right = neighbors[neighborOffset + 1];
      if (right !== noCell && grid[regionCellOffset + right] === regionMask) {
        this._mergeRegionShards(grid, cell, right);
      }
      const down = neighbors[neighborOffset + 3];
      if (down !== noCell && grid[regionCellOffset + down] === regionMask) {
        this._mergeRegionShards(grid, cell, down);
      }
    }
  }

  _enforceRegionShards(grid, handlerAccumulator) {
    // Phase 1: materialize same-region facts into shards and rebuild summaries.
    this._updateRegionRunLineShards(grid);
    this._updateFixedRegionShards(grid);

    const regionCellOffset = this._regionCellOffset;
    const shardSizes = this._regionShardSizes;
    const shardValueMasks = this._regionShardScratchMasks;
    const shardFixedValueMasks = this._regionShardFixedValueMasks;
    const shardRestrictedValueFlags = this._regionShardRestrictedValueFlags;
    const nextCells = this._regionShardNextCells;
    const multiCellRoots = this._componentStack;
    const noCell = this.constructor._NO_CELL;
    const shardOffset = this._regionShardOffset;
    let multiCellRootCount = 0;

    // Roots only move toward lower indexes, so a non-root's parent has already
    // been flattened to the true root in this scan.
    for (let cell = 0; cell < this._numGridCells; cell++) {
      let root = grid[shardOffset + cell];
      shardSizes[cell] = 0;
      if (cell === root) {
        shardValueMasks[root] = 0;
        shardFixedValueMasks[root] = 0;
        shardRestrictedValueFlags[root] = 0;
        nextCells[root] = noCell;
      } else {
        root = grid[shardOffset + root];
        grid[shardOffset + cell] = root;
        nextCells[cell] = nextCells[root];
        nextCells[root] = cell;
      }
      const shardSize = shardSizes[root] + 1;
      if (shardSize > this._regionSize) return false;
      shardSizes[root] = shardSize;
      if (shardSize === 2) multiCellRoots[multiCellRootCount++] = root;

      const cellValues = grid[cell];
      shardValueMasks[root] |= cellValues;
      if (cellValues !== this._regionMask) shardRestrictedValueFlags[root] = 1;
      if (cellValues && !(cellValues & (cellValues - 1))) {
        if (shardFixedValueMasks[root] & cellValues) return false;
        shardFixedValueMasks[root] |= cellValues;
      }
    }

    for (let rootIndex = 0; rootIndex < multiCellRootCount; rootIndex++) {
      const root = multiCellRoots[rootIndex];
      const rootRegionMask = grid[regionCellOffset + root];
      let regionMask = rootRegionMask;
      let regionUnionMask = rootRegionMask;
      for (let cell = nextCells[root]; cell !== noCell; cell = nextCells[cell]) {
        const cellRegionMask = grid[regionCellOffset + cell];
        regionMask &= cellRegionMask;
        regionUnionMask |= cellRegionMask;
      }
      if (!regionMask) return false;
      if (regionUnionMask !== regionMask) {
        this._setRegionShardMask(grid, root, regionMask, handlerAccumulator);
      }
    }

    return true;
  }

  _collectRegionShardComponent(grid, shardMasks, startRoot, regionBit, visitId) {
    const noCell = this.constructor._NO_CELL;
    const neighbors = this._neighbors;
    const shardOffset = this._regionShardOffset;
    const stack = this._componentStack;
    const visitMarks = this._visitMarks;
    const shardSizes = this._regionShardSizes;
    const nextCells = this._regionShardNextCells;
    let componentSize = 0;
    let stackSize = 0;
    stack[stackSize++] = startRoot;
    visitMarks[startRoot] = visitId;
    componentSize += shardSizes[startRoot];

    // Component size is weighted by shard size, not root count.
    for (let componentIndex = 0; componentIndex < stackSize; componentIndex++) {
      const root = stack[componentIndex];
      for (let cell = root; cell !== noCell; cell = nextCells[cell]) {
        const neighborOffset = cell << 2;
        for (let dir = 0; dir < 4; dir++) {
          const neighbor = neighbors[neighborOffset + dir];
          if (neighbor === noCell) continue;

          const neighborRoot = grid[shardOffset + neighbor];
          if (visitMarks[neighborRoot] === visitId) continue;
          if (!(shardMasks[neighborRoot] & regionBit)) continue;

          visitMarks[neighborRoot] = visitId;
          componentSize += shardSizes[neighborRoot];
          stack[stackSize++] = neighborRoot;
        }
      }
    }

    this._componentStackSize = stackSize;
    return componentSize;
  }

  _traverseFixedRegionShardComponent(
    grid, shardMasks, regionBit, fixedSize, startRoot, visitId) {
    const noCell = this.constructor._NO_CELL;
    const neighbors = this._neighbors;
    const shardOffset = this._regionShardOffset;
    const stack = this._componentStack;
    const visitMarks = this._visitMarks;
    const rootsByDistance = this._rootScratch;
    // Connectivity runs after possible-count summaries have been consumed.
    const rootCountsByDistance = this._possibleCounts;
    const shardSizes = this._regionShardSizes;
    const nextCells = this._regionShardNextCells;
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

        for (let cell = root; cell !== noCell; cell = nextCells[cell]) {
          const neighborOffset = cell << 2;
          for (let dir = 0; dir < 4; dir++) {
            const neighbor = neighbors[neighborOffset + dir];
            if (neighbor === noCell) continue;

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
                this._removeConnectivityShardRegion(shardMasks, neighborRoot, regionBit);
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

    this._componentStackSize = componentRootCount;
    if (reachedFixedSize < fixedSize) return 0;
    return componentSize;
  }

  _pruneConnectivityValueConflicts(
    shardMasks, regionBit, componentRootCount, componentSize, baseSize, baseFixedValueMask) {
    const stack = this._componentStack;
    const shardSizes = this._regionShardSizes;
    const shardFixedValueMasks = this._regionShardFixedValueMasks;
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
        this._removeConnectivityShardRegion(shardMasks, root, regionBit);
        remainingComponentSize -= shardSizes[root];
      }
    }

    return remainingComponentSize;
  }

  _enforceFixedComponentBottlenecks(grid, shardMasks, checkRegionsMask) {
    const noCell = this.constructor._NO_CELL;
    const numGridCells = this._numGridCells;
    const neighbors = this._neighbors;
    const shardOffset = this._regionShardOffset;
    const visitMarks = this._visitMarks;
    const stack = this._componentStack;
    const shardSizes = this._regionShardSizes;
    const nextCells = this._regionShardNextCells;
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
        let doorRoot = noCell;
        let doorCount = 0;
        stack[stackSize++] = startRoot;
        visitMarks[startRoot] = visitId;

        // Work on the whole connected fixed component. A single fixed shard may
        // have one apparent exit even when adjacent fixed shards give the
        // component several ways out.
        for (let componentIndex = 0; componentIndex < stackSize; componentIndex++) {
          const root = stack[componentIndex];
          componentSize += shardSizes[root];

          for (let cell = root; cell !== noCell; cell = nextCells[cell]) {
            const neighborOffset = cell << 2;
            for (let dir = 0; dir < 4; dir++) {
              const neighbor = neighbors[neighborOffset + dir];
              if (neighbor === noCell) continue;

              const neighborRoot = grid[shardOffset + neighbor];
              if (neighborRoot === root) continue;

              const neighborMask = shardMasks[neighborRoot];
              if (neighborMask === regionBit) {
                if (visitMarks[neighborRoot] !== visitId) {
                  visitMarks[neighborRoot] = visitId;
                  stack[stackSize++] = neighborRoot;
                }
              } else if (doorCount < 2 && (neighborMask & regionBit)) {
                if (doorRoot === noCell) {
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
        this._setConnectivityShardRegion(shardMasks, root, regionBit);
      }
    }

    return true;
  }

  _scanRegionCandidates(grid) {
    const fixedCounts = this._fixedCounts;
    const possibleCounts = this._possibleCounts;
    const possibleValueMasks = this._possibleValueMasks;
    const fixedValueMasks = this._fixedValueMasks;
    fixedCounts.fill(0);
    possibleCounts.fill(0);
    possibleValueMasks.fill(0);
    fixedValueMasks.fill(0);

    const numGridCells = this._numGridCells;
    const numRegions = this._numRegions;
    const shardSizes = this._regionShardSizes;
    const shardValueMasks = this._regionShardScratchMasks;
    const shardFixedValueMasks = this._regionShardFixedValueMasks;
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
        possibleValueMasks[region] |= shardValueMask;
        fixedCounts[region] += shardSize;
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
          possibleValueMasks[region] |= shardValueMask;
          possibleCounts[region] += shardSize;
        }
      }
    }

    for (let region = 0; region < numRegions; region++) {
      const possibleCount = possibleCounts[region];
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

  _enforceConnectivity(grid, handlerAccumulator) {
    // Phase 3: connectivity runs on the current shard graph for dirty labels only.
    const numGridCells = this._numGridCells;
    const regionCellOffset = this._regionCellOffset;
    const stack = this._componentStack;
    const shardSizes = this._regionShardSizes;
    const shardMasks = this._regionShardScratchMasks;
    const fixedCounts = this._fixedCounts;
    const fixedValueMasks = this._fixedValueMasks;
    const visitMarks = this._visitMarks;
    const regionSize = this._regionSize;
    const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
    if (!dirtyRegionsMask) return true;

    shardMasks.set(
      grid.subarray(regionCellOffset, regionCellOffset + numGridCells));

    for (let region = 0; region < this._numRegions; region++) {
      const regionBit = 1 << region;
      if (!(dirtyRegionsMask & regionBit)) continue;

      const visitId = this._nextVisitId();
      let fixedSize = 0;
      let fixedRoot = this.constructor._NO_CELL;
      // Fixed shards are exactly the roots whose effective region mask is the
      // region bit. Their total cell weight is the connectivity target.
      for (let root = 0; root < numGridCells; root++) {
        if (!shardSizes[root] || shardMasks[root] !== regionBit) continue;
        if (fixedRoot === this.constructor._NO_CELL) fixedRoot = root;
        fixedSize += shardSizes[root];
        if (fixedSize > regionSize) return false;
      }

      if (fixedSize) {
        // Fixed shards choose the component. Everything outside it loses this
        // region label; exact-size components are forced.
        const componentSize = this._traverseFixedRegionShardComponent(
          grid, shardMasks, regionBit, fixedSize, fixedRoot, visitId);
        if (componentSize < regionSize) return false;
        const componentRootCount = this._componentStackSize;
        const fixedValueMask = fixedValueMasks[region];
        let remainingComponentSize = componentSize;

        for (let root = 0; root < numGridCells; root++) {
          if (!shardSizes[root] || !(shardMasks[root] & regionBit)) continue;
          if (visitMarks[root] !== visitId) {
            this._removeConnectivityShardRegion(shardMasks, root, regionBit);
          }
        }

        if (remainingComponentSize > regionSize) {
          remainingComponentSize = this._pruneConnectivityValueConflicts(
            shardMasks, regionBit, componentRootCount, componentSize, fixedSize, fixedValueMask);
        }

        if (remainingComponentSize < regionSize) return false;
        if (remainingComponentSize === regionSize) {
          for (let i = 0; i < componentRootCount; i++) {
            const root = stack[i];
            if (!(shardMasks[root] & regionBit)) continue;
            this._setConnectivityShardRegion(shardMasks, root, regionBit);
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

          const componentSize = this._collectRegionShardComponent(
            grid, shardMasks, startRoot, regionBit, visitId);
          const componentRootCount = this._componentStackSize;

          if (componentSize >= regionSize) {
            const remainingComponentSize = this._pruneConnectivityValueConflicts(
              shardMasks, regionBit, componentRootCount, componentSize, 0, 0);

            if (remainingComponentSize >= regionSize) {
              hasViableComponent = true;
            } else {
              for (let i = 0; i < componentRootCount; i++) {
                const root = stack[i];
                if (!(shardMasks[root] & regionBit)) continue;
                this._removeConnectivityShardRegion(shardMasks, root, regionBit);
              }
            }
          } else {
            for (let i = 0; i < componentRootCount; i++) {
              this._removeConnectivityShardRegion(shardMasks, stack[i], regionBit);
            }
          }
        }

        if (!hasViableComponent) return false;
      }
    }

    let bottleneckRegionsMask = this._connectivityDirtyRegionsMask;
    for (let region = 0; region < this._numRegions; region++) {
      const fixedCount = fixedCounts[region];
      if (fixedCount && fixedCount < regionSize) bottleneckRegionsMask |= 1 << region;
    }
    if (!this._enforceFixedComponentBottlenecks(grid, shardMasks, bottleneckRegionsMask)) return false;

    for (let root = 0; root < numGridCells; root++) {
      if (!shardSizes[root] || shardMasks[root] === grid[regionCellOffset + root]) continue;
      this._setRegionShardMask(grid, root, shardMasks[root], handlerAccumulator);
    }

    return true;
  }

  _enforceHiddenRegionValueSingles(
    grid, handlerAccumulator, checkRegionsMask, restrictedRegionsMask, hiddenDuplicateValueMasks) {
    // Apply one precomputed shard-level witness after confirming the member cell.
    const firstRootByRegionValue = this._rootScratch;
    const fixedValueMasks = this._fixedValueMasks;
    const nextCells = this._regionShardNextCells;
    const regionCellOffset = this._regionCellOffset;
    const noCell = this.constructor._NO_CELL;
    const regionSize = this._regionSize;
    const allValues = this._regionMask;

    checkRegionsMask &= restrictedRegionsMask;

    while (checkRegionsMask) {
      const regionBit = checkRegionsMask & -checkRegionsMask;
      checkRegionsMask ^= regionBit;
      const region = 31 - Math.clz32(regionBit);
      let hiddenValues = allValues & ~(fixedValueMasks[region] | hiddenDuplicateValueMasks[region]);
      while (hiddenValues) {
        const valueBit = hiddenValues & -hiddenValues;
        hiddenValues ^= valueBit;
        const valueIndex = 31 - Math.clz32(valueBit);
        const root = firstRootByRegionValue[region * regionSize + valueIndex];

        let cell = noCell;
        let cellCount = 0;
        for (let candidateCell = root; candidateCell !== noCell; candidateCell = nextCells[candidateCell]) {
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
        if (regionChanged) this._setRegionShardMask(grid, root, regionBit, handlerAccumulator);
        if (changed || regionChanged) {
          this._connectivityDirtyRegionsMask |= oldRegionMask | regionBit;
          return true;
        }
      }
    }

    return true;
  }

  _enforceRegionShardConsistency(grid, handlerAccumulator) {
    // Phase 2: scan summaries, prune shard labels, then use stable witnesses.
    const fixedCounts = this._fixedCounts;
    const possibleCounts = this._possibleCounts;
    const possibleValueMasks = this._possibleValueMasks;
    const fixedValueMasks = this._fixedValueMasks;
    // Hidden-single scratch lives between region scanning and connectivity.
    const hiddenSeenValueMasks = possibleCounts;
    const hiddenDuplicateValueMasks = possibleValueMasks;
    const firstRootByRegionValue = this._rootScratch;
    const shardSizes = this._regionShardSizes;
    const shardValueMasks = this._regionShardScratchMasks;
    const shardFixedValueMasks = this._regionShardFixedValueMasks;
    const shardRestrictedValueFlags = this._regionShardRestrictedValueFlags;
    const regionSize = this._regionSize;
    const numGridCells = this._numGridCells;
    const regionCellOffset = this._regionCellOffset;

    while (true) {
      // This pass intentionally combines the old size, value-pair, completed
      // region, and shard fixed-value rules so they share one shard scan.
      if (!this._scanRegionCandidates(grid)) return false;

      let fullRegionsMask = 0;
      let fixedValueRegionsMask = 0;
      let hiddenRegionsMask = 0;
      for (let region = 0; region < this._numRegions; region++) {
        const regionBit = 1 << region;
        const fixedCount = fixedCounts[region];
        const possibleCount = possibleCounts[region];
        if (fixedCount > regionSize || fixedCount + possibleCount < regionSize) return false;
        if (possibleValueMasks[region] !== this._regionMask) return false;
        if (fixedValueMasks[region]) fixedValueRegionsMask |= regionBit;
        if ((fixedCount << 1) >= regionSize && fixedValueMasks[region] !== this._regionMask) {
          hiddenRegionsMask |= regionBit;
        }
        if (fixedCount === regionSize && possibleCount) {
          fullRegionsMask |= regionBit;
        }
      }

      let changed = false;
      let hiddenRestrictedRegionsMask = 0;
      if (hiddenRegionsMask) {
        hiddenSeenValueMasks.fill(0);
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
              if (shardRestrictedValueFlags[root]) hiddenRestrictedRegionsMask |= candidateRegions;
              while (candidateRegions) {
                const regionBit = candidateRegions & -candidateRegions;
                candidateRegions ^= regionBit;
                const region = 31 - Math.clz32(regionBit);
                const valueBits = shardValueMask & ~fixedValueMasks[region];
                let firstSeenValues = valueBits & ~hiddenSeenValueMasks[region];
                while (firstSeenValues) {
                  const valueBit = firstSeenValues & -firstSeenValues;
                  firstSeenValues ^= valueBit;
                  const valueIndex = 31 - Math.clz32(valueBit);
                  firstRootByRegionValue[region * regionSize + valueIndex] = root;
                }
                hiddenDuplicateValueMasks[region] |= hiddenSeenValueMasks[region] & valueBits;
                hiddenSeenValueMasks[region] |= valueBits;
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
          this._setRegionShardMask(grid, root, keepMask, handlerAccumulator);
          changed = true;
        }
      }

      if (changed) continue;

      if (hiddenRegionsMask) {
        if (!this._enforceHiddenRegionValueSingles(
          grid, handlerAccumulator, hiddenRegionsMask, hiddenRestrictedRegionsMask,
          hiddenDuplicateValueMasks)) return false;
      }

      return true;
    }
  }

  enforceConsistency(grid, handlerAccumulator) {
    this._connectivityDirtyRegionsMask = 0;

    // Phase order keeps derived summaries local and avoids stale connectivity input.
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;
    if (!this._enforceRegionShards(grid, handlerAccumulator)) return false;

    if (!this._enforceRegionShardConsistency(grid, handlerAccumulator)) return false;

    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;

    this._connectivityDirtyRegionsMask = 0;
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
