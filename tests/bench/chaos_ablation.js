import { ensureGlobalEnvironment } from '../helpers/test_env.js';

ensureGlobalEnvironment();

const { EXAMPLES } = await import('../../data/collections.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuSolver } = await import('../../js/solver/engine.js' + self.VERSION_PARAM);
const { CandidateSelector } = await import('../../js/solver/candidate_selector.js' + self.VERSION_PARAM);
const { SudokuConstraintOptimizer } = await import('../../js/solver/optimizer.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const {
  Priority,
  SudokuConstraintHandler,
} = await import('../../js/solver/handlers.js' + self.VERSION_PARAM);
const {
  ChaosConstruction,
  ChaosFixedValueRegionExclusion,
  ChaosArrow,
} = await import('../../js/solver/chaos_handler.js' + self.VERSION_PARAM);
const {
  CHAOS_LADDER_ALIAS,
  DEFAULT_CHAOS_LADDER_COUNTS,
  CHAOS_KILLER_LADDER_ALIAS,
  DEFAULT_CHAOS_KILLER_LADDER_COUNTS,
  CHAOS_X_SUMS_LADDER_ALIAS,
  DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS,
  resolveChaosBenchmarkPuzzles,
} = await import('./chaos_benchmark_puzzles.js' + self.VERSION_PARAM);

const DEFAULT_PUZZLES = [
  'Chaos Construction: 6x6',
  'Chaos Construction - easier',
];

const DEFAULT_VARIANTS = [
  'full',
  'canonical-validation-only',
  'size-prescan',
  'no-distance',
  'connectivity-dirty-no-distance',
  'connectivity-no-pruning',
  'connectivity-no-exact-forcing',
  'connectivity-no-small-component-pruning',
  'size-validation-only',
  'connectivity-validation-only',
  'value-validation-only',
  'validation-only',
];

const parseList = (value, fallback) => {
  if (!value) return fallback;
  return value.split(',').map(v => v.trim()).filter(Boolean);
};

const parseArgs = (argv) => {
  const args = {
    puzzles: DEFAULT_PUZZLES,
    variants: DEFAULT_VARIANTS,
    maxBacktracks: 50_000,
    guessProfile: false,
    guessTrace: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--puzzles') {
      args.puzzles = parseList(argv[++i], DEFAULT_PUZZLES);
    } else if (arg.startsWith('--puzzles=')) {
      args.puzzles = parseList(arg.slice('--puzzles='.length), DEFAULT_PUZZLES);
    } else if (arg === '--variants') {
      args.variants = parseList(argv[++i], DEFAULT_VARIANTS);
    } else if (arg.startsWith('--variants=')) {
      args.variants = parseList(arg.slice('--variants='.length), DEFAULT_VARIANTS);
    } else if (arg === '--max-backtracks') {
      args.maxBacktracks = +argv[++i];
    } else if (arg.startsWith('--max-backtracks=')) {
      args.maxBacktracks = +arg.slice('--max-backtracks='.length);
    } else if (arg === '--guess-profile') {
      args.guessProfile = true;
    } else if (arg === '--guess-trace') {
      args.guessTrace = +argv[++i];
      args.guessProfile = true;
    } else if (arg.startsWith('--guess-trace=')) {
      args.guessTrace = +arg.slice('--guess-trace='.length);
      args.guessProfile = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const isFixed = (mask) => mask && !(mask & (mask - 1));

const allFixed = (grid, cells) => {
  for (const cell of cells) {
    if (!isFixed(grid[cell])) return false;
  }
  return true;
};

const allChaosRegionCellsFixed = function (grid) {
  const regionCellOffset = this._regionCellOffset;
  for (let cell = 0; cell < this._numGridCells; cell++) {
    if (!isFixed(grid[regionCellOffset + cell])) return false;
  }
  return true;
};

const countBits = (mask) => {
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count++;
  }
  return count;
};

const validateCanonicalAtFullState = function (grid) {
  if (!allFixed(grid, this.cells)) return true;

  let previousSeen = this._canonicalSeedMask;
  const regionCellOffset = this._regionCellOffset;
  for (let i = 0; i < this._numGridCells; i++) {
    const regionBit = grid[regionCellOffset + i];
    const allowedMask = (previousSeen | (previousSeen << 1)) & this._regionMask;
    if (!(regionBit & allowedMask)) return false;
    previousSeen |= regionBit;
  }
  return previousSeen === this._regionMask;
};

const enforceCanonicalOrderEarlyBail = function (grid, handlerAccumulator) {
  const regionCellOffset = this._regionCellOffset;
  const numGridCells = this._numGridCells;
  const regionMask = this._regionMask;

  let previousPossible = this._canonicalSeedMask;

  for (let i = 0; i < numGridCells; i++) {
    const allowedMask = (previousPossible | (previousPossible << 1)) & regionMask;
    const regionCell = regionCellOffset + i;
    if (!this._restrictCell(grid, regionCell, allowedMask, handlerAccumulator)) {
      return false;
    }
    previousPossible |= grid[regionCell];
    if (previousPossible === regionMask) break;
  }

  return true;
};

const enforceCanonicalOrderCornerAnchors = function (grid, handlerAccumulator) {
  return enforceCanonicalOrderEarlyBail.call(this, grid, handlerAccumulator);
};

const validateRegionSizesAtFullState = function (grid) {
  if (!allChaosRegionCellsFixed.call(this, grid)) return true;

  this._fixedCounts.fill(0);
  const regionCellOffset = this._regionCellOffset;
  for (let cell = 0; cell < this._numGridCells; cell++) {
    this._fixedCounts[LookupTables.toIndex(grid[regionCellOffset + cell])]++;
  }
  for (let region = 0; region < this._numRegions; region++) {
    if (this._fixedCounts[region] !== this._regionSize) return false;
  }
  return true;
};

const enforceRegionSizeCountsOnly = function () {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const regionSize = this._regionSize;

  for (let region = 0; region < this._numRegions; region++) {
    if (fixedCounts[region] > regionSize || fixedCounts[region] + possibleCounts[region] < regionSize) {
      return false;
    }
  }

  return true;
};

const enforceRegionSizeNoFullRegions = function (grid, handlerAccumulator) {
  const possibleCounts = this._possibleCounts;
  const regionCells = this._regionCells;
  const regionCandidateCells = this._regionCandidateCells;
  const numGridCells = this._numGridCells;
  const regionSize = this._regionSize;
  let exactPossibleRegionsMask = 0;

  for (let region = 0; region < this._numRegions; region++) {
    const possibleCount = possibleCounts[region];
    if (this._fixedCounts[region] > regionSize || this._fixedCounts[region] + possibleCount < regionSize) {
      return false;
    }
    if (this._fixedCounts[region] + possibleCount === regionSize) exactPossibleRegionsMask |= 1 << region;
  }

  while (exactPossibleRegionsMask) {
    const regionBit = exactPossibleRegionsMask & -exactPossibleRegionsMask;
    exactPossibleRegionsMask ^= regionBit;
    const region = LookupTables.toIndex(regionBit);
    const offset = region * numGridCells;
    const candidateCount = possibleCounts[region] + this._fixedCounts[region];
    for (let i = 0; i < candidateCount; i++) {
      const regionCell = regionCells[regionCandidateCells[offset + i]];
      if (!this._restrictCell(grid, regionCell, regionBit, handlerAccumulator)) return false;
    }
  }

  return true;
};

const enforceRegionSizeNoExactPossible = function (grid, handlerAccumulator) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionSize = this._regionSize;
  let fullRegionsMask = 0;

  for (let region = 0; region < this._numRegions; region++) {
    const fixedCount = fixedCounts[region];
    const possibleCount = possibleCounts[region];
    if (fixedCount > regionSize || fixedCount + possibleCount < regionSize) return false;
    if (fixedCount === regionSize) fullRegionsMask |= 1 << region;
  }

  if (fullRegionsMask) {
    const keepMask = ~fullRegionsMask;
    for (let cell = 0; cell < numGridCells; cell++) {
      const regionCell = regionCells[cell];
      const values = grid[regionCell];
      if ((values & fullRegionsMask) && (values & (values - 1))) {
        if (!this._restrictCell(grid, regionCell, keepMask, handlerAccumulator)) return false;
      }
    }
  }

  return true;
};

const enforceRegionSizeNoDirtyExactPossible = function (grid, handlerAccumulator) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const regionSize = this._regionSize;
  let fullRegionsMask = 0;

  for (let region = 0; region < this._numRegions; region++) {
    const fixedCount = fixedCounts[region];
    const possibleCount = possibleCounts[region];
    if (fixedCount > regionSize || fixedCount + possibleCount < regionSize) return false;
    if (fixedCount === regionSize && possibleCount) {
      fullRegionsMask |= 1 << region;
    }
  }

  if (fullRegionsMask) {
    const regionCells = this._regionCells;
    const keepMask = ~fullRegionsMask;
    const numGridCells = this._numGridCells;
    for (let cell = 0; cell < numGridCells; cell++) {
      const regionCell = regionCells[cell];
      const values = grid[regionCell];
      if ((values & fullRegionsMask) && (values & (values - 1))) {
        if (!this._restrictCell(grid, regionCell, keepMask, handlerAccumulator)) {
          return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionSizeDirtyExactPossible = function (grid, handlerAccumulator) {
  if (!enforceRegionSizeNoDirtyExactPossible.call(this, grid, handlerAccumulator)) return false;
  if (this._changed) return true;

  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  const possibleCounts = this._possibleCounts;
  const regionCells = this._regionCells;
  const regionCandidateCells = this._regionCandidateCells;
  const numGridCells = this._numGridCells;
  const regionSize = this._regionSize;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit) || possibleCounts[region] + this._fixedCounts[region] !== regionSize) continue;

    const offset = region * numGridCells;
    for (let i = 0; i < regionSize; i++) {
      const regionCell = regionCells[regionCandidateCells[offset + i]];
      if (!this._restrictCell(grid, regionCell, regionBit, handlerAccumulator)) return false;
    }
  }

  return true;
};

const enforceRegionSizeHallSubsetsUpTo = function (grid, handlerAccumulator, maxSubsetSize) {
  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionMask = this._regionMask;
  const regionSize = this._regionSize;

  for (let subset = 1; subset < regionMask; subset++) {
    const subsetSize = countBits(subset);
    if (subsetSize > maxSubsetSize) continue;

    const capacity = subsetSize * regionSize;
    let mustUseCount = 0;
    let canUseCount = 0;

    for (let cell = 0; cell < numGridCells; cell++) {
      const values = grid[regionCells[cell]];
      if (values & subset) canUseCount++;
      if (!(values & ~subset)) mustUseCount++;
    }

    if (mustUseCount > capacity || canUseCount < capacity) return false;

    if (mustUseCount === capacity) {
      for (let cell = 0; cell < numGridCells; cell++) {
        const regionCell = regionCells[cell];
        const values = grid[regionCell];
        if ((values & subset) && (values & ~subset)) {
          if (!this._restrictCell(grid, regionCell, ~subset, handlerAccumulator)) return false;
        }
      }
    }

    if (canUseCount === capacity) {
      for (let cell = 0; cell < numGridCells; cell++) {
        const regionCell = regionCells[cell];
        if (grid[regionCell] & subset) {
          if (!this._restrictCell(grid, regionCell, subset, handlerAccumulator)) return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionSizeHallPairs = function (grid, handlerAccumulator) {
  return enforceRegionSizeHallSubsetsUpTo.call(this, grid, handlerAccumulator, 2);
};

const enforceRegionSizeHallTriples = function (grid, handlerAccumulator) {
  return enforceRegionSizeHallSubsetsUpTo.call(this, grid, handlerAccumulator, 3);
};

const enforceRegionSizeHallSubsets = function (grid, handlerAccumulator) {
  return enforceRegionSizeHallSubsetsUpTo.call(
    this, grid, handlerAccumulator, this._numRegions - 1);
};

const initializeIncrementalHallState = function (initialGridCells, cellExclusions, shape, stateAllocator) {
  if (!originalMethods.initialize.call(this, initialGridCells, cellExclusions, shape, stateAllocator)) {
    return false;
  }
  this._hallInputCacheOffset = stateAllocator.allocate(new Array(this._numGridCells).fill(0));
  this._hallSubsetSizes = new Uint8Array(this._regionMask);
  const activeSubsets = [];
  const maxSubsetSize = this._incrementalHallMaxSubsetSize ?? (this._numRegions - 1);
  for (let subset = 1; subset < this._regionMask; subset++) {
    const subsetSize = countBits(subset);
    this._hallSubsetSizes[subset] = subsetSize;
    if (subsetSize <= maxSubsetSize) activeSubsets.push(subset);
  }
  this._hallSubsets = new Uint16Array(activeSubsets);
  this._hallCanUseCountOffset = stateAllocator.allocate(new Array(activeSubsets.length).fill(0));
  this._hallMustUseCountOffset = stateAllocator.allocate(new Array(activeSubsets.length).fill(0));
  this._hallDirty = true;
  return true;
};

const updateIncrementalHallCounts = function (grid) {
  const regionCells = this._regionCells;
  const inputCacheOffset = this._hallInputCacheOffset;
  const canUseCountOffset = this._hallCanUseCountOffset;
  const mustUseCountOffset = this._hallMustUseCountOffset;
  const hallSubsets = this._hallSubsets;
  let dirty = false;

  for (let cell = 0; cell < this._numGridCells; cell++) {
    const currentMask = grid[regionCells[cell]];
    const previousMask = grid[inputCacheOffset + cell];
    if (currentMask === previousMask) continue;

    for (let i = 0; i < hallSubsets.length; i++) {
      const subset = hallSubsets[i];
      if (previousMask & subset) grid[canUseCountOffset + i]--;
      if (currentMask & subset) grid[canUseCountOffset + i]++;

      if (previousMask && !(previousMask & ~subset)) grid[mustUseCountOffset + i]--;
      if (!(currentMask & ~subset)) grid[mustUseCountOffset + i]++;
    }

    grid[inputCacheOffset + cell] = currentMask;
    dirty = true;
  }

  this._hallDirty = dirty;
};

const enforceRegionSizeIncrementalHallSubsetsUpTo = function (grid, handlerAccumulator, maxSubsetSize) {
  if (!originalMethods._enforceRegionSizes.call(this, grid, handlerAccumulator)) return false;
  if (this._changed) return true;

  updateIncrementalHallCounts.call(this, grid);
  if (!this._hallDirty) return true;

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionSize = this._regionSize;
  const subsetSizes = this._hallSubsetSizes;
  const hallSubsets = this._hallSubsets;
  const canUseCountOffset = this._hallCanUseCountOffset;
  const mustUseCountOffset = this._hallMustUseCountOffset;

  for (let i = 0; i < hallSubsets.length; i++) {
    const subset = hallSubsets[i];
    const subsetSize = subsetSizes[subset];

    const capacity = subsetSize * regionSize;
    const mustUseCount = grid[mustUseCountOffset + i];
    const canUseCount = grid[canUseCountOffset + i];

    if (mustUseCount > capacity || canUseCount < capacity) return false;

    if (mustUseCount === capacity) {
      for (let cell = 0; cell < numGridCells; cell++) {
        const regionCell = regionCells[cell];
        const values = grid[regionCell];
        if ((values & subset) && (values & ~subset)) {
          if (!this._restrictCell(grid, regionCell, ~subset, handlerAccumulator)) return false;
        }
      }
    }

    if (canUseCount === capacity) {
      for (let cell = 0; cell < numGridCells; cell++) {
        const regionCell = regionCells[cell];
        if (grid[regionCell] & subset) {
          if (!this._restrictCell(grid, regionCell, subset, handlerAccumulator)) return false;
        }
      }
    }
  }

  return true;
};

const validateRegionSizeIncrementalHallSubsetsUpTo = function (grid, handlerAccumulator, maxSubsetSize) {
  if (!originalMethods._enforceRegionSizes.call(this, grid, handlerAccumulator)) return false;
  if (this._changed) return true;

  updateIncrementalHallCounts.call(this, grid);
  if (!this._hallDirty) return true;

  const regionSize = this._regionSize;
  const subsetSizes = this._hallSubsetSizes;
  const hallSubsets = this._hallSubsets;
  const canUseCountOffset = this._hallCanUseCountOffset;
  const mustUseCountOffset = this._hallMustUseCountOffset;

  for (let i = 0; i < hallSubsets.length; i++) {
    const subset = hallSubsets[i];
    const subsetSize = subsetSizes[subset];

    const capacity = subsetSize * regionSize;
    if (grid[mustUseCountOffset + i] > capacity
      || grid[canUseCountOffset + i] < capacity) {
      return false;
    }
  }

  return true;
};

const enforceRegionSizeIncrementalHallPairs = function (grid, handlerAccumulator) {
  return enforceRegionSizeIncrementalHallSubsetsUpTo.call(this, grid, handlerAccumulator, 2);
};

const enforceRegionSizeIncrementalHallTriples = function (grid, handlerAccumulator) {
  return enforceRegionSizeIncrementalHallSubsetsUpTo.call(this, grid, handlerAccumulator, 3);
};

const enforceRegionSizeIncrementalHallSubsets = function (grid, handlerAccumulator) {
  return enforceRegionSizeIncrementalHallSubsetsUpTo.call(
    this, grid, handlerAccumulator, this._numRegions - 1);
};

const validateRegionSizeIncrementalHallPairs = function (grid, handlerAccumulator) {
  return validateRegionSizeIncrementalHallSubsetsUpTo.call(this, grid, handlerAccumulator, 2);
};

const validateRegionSizeIncrementalHallTriples = function (grid, handlerAccumulator) {
  return validateRegionSizeIncrementalHallSubsetsUpTo.call(this, grid, handlerAccumulator, 3);
};

const validateRegionSizeIncrementalHallSubsets = function (grid, handlerAccumulator) {
  return validateRegionSizeIncrementalHallSubsetsUpTo.call(
    this, grid, handlerAccumulator, this._numRegions - 1);
};

const installIncrementalHallSizes = (enforceRegionSizes, maxSubsetSize) => {
  ChaosConstruction.prototype._incrementalHallMaxSubsetSize = maxSubsetSize;
  ChaosConstruction.prototype.initialize = initializeIncrementalHallState;
  ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizes;
};

const validateConnectivityAtFullState = function (grid) {
  if (!allChaosRegionCellsFixed.call(this, grid)) return true;

  const seenRegions = new Uint8Array(this._numRegions);
  const regionCellOffset = this._regionCellOffset;
  const stack = this._componentStack;
  const visitMarks = this._visitMarks;
  const neighbors = this._neighbors;
  const noCell = this.constructor._NO_CELL;

  for (let start = 0; start < this._numGridCells; start++) {
    const regionBit = grid[regionCellOffset + start];
    const region = LookupTables.toIndex(regionBit);
    if (seenRegions[region]) continue;
    seenRegions[region] = 1;

    const visitId = this._nextVisitId();
    let stackSize = 0;
    let componentSize = 0;
    stack[stackSize++] = start;
    visitMarks[start] = visitId;

    while (stackSize > 0) {
      const cell = stack[--stackSize];
      componentSize++;
      const neighborOffset = cell * 4;
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighbors[neighborOffset + dir];
        if (neighbor === noCell || visitMarks[neighbor] === visitId) continue;
        if (grid[regionCellOffset + neighbor] !== regionBit) continue;
        visitMarks[neighbor] = visitId;
        stack[stackSize++] = neighbor;
      }
    }

    if (componentSize !== this._regionSize) return false;
  }

  return true;
};

const validateRegionValuePairsAtFullState = function (grid) {
  if (!allFixed(grid, this.cells)) return true;

  const regionValues = this._valuePossibleCounts ??= new Uint16Array(this._numRegions);
  const regionCellOffset = this._regionCellOffset;
  for (let region = 0; region < this._numRegions; region++) {
    regionValues[region] = 0;
  }

  for (let cell = 0; cell < this._numGridCells; cell++) {
    const region = LookupTables.toIndex(grid[regionCellOffset + cell]);
    const valueBit = grid[cell];
    if (regionValues[region] & valueBit) return false;
    regionValues[region] |= valueBit;
  }

  for (let region = 0; region < this._numRegions; region++) {
    if (regionValues[region] !== this._allValues) return false;
  }
  return true;
};

const hasRestrictedGridValue = function (grid) {
  for (let cell = 0; cell < this._numGridCells; cell++) {
    if (grid[cell] !== this._allValues) return true;
  }
  return false;
};

const ensureValueCountBuffers = function () {
  this._valuePossibleCounts ??= new Uint16Array(this._regionSize);
  this._valueFixedCounts ??= new Uint16Array(this._regionSize);
};

const ensureValueWitnessBuffers = function () {
  ensureValueCountBuffers.call(this);
  this._valuePossibleCells ??= new Uint16Array(this._regionSize);
  this._valueFixedCells ??= new Uint16Array(this._regionSize);
};

const ensureFixedPairBuffers = function () {
  this._fixedRegionsByValue ??= new Uint16Array(this._regionSize);
  this._fixedValuesByRegion ??= new Uint16Array(this._numRegions);
};

const validateScanRegionValuePairs = function () {
  const possibleValueMasks = this._possibleValueMasks;
  const allValues = this._allValues;

  for (let region = 0; region < this._numRegions; region++) {
    if (possibleValueMasks[region] !== allValues) return false;
  }

  return true;
};

const enforceRegionValuePairCountsOnly = function (grid) {
  if (!hasRestrictedGridValue.call(this, grid)) return true;
  ensureValueCountBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const numValues = this._regionSize;
  const valuePossibleCounts = this._valuePossibleCounts;
  const valueFixedCounts = this._valueFixedCounts;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];

    valuePossibleCounts.fill(0);
    valueFixedCounts.fill(0);

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      let valueBits = grid[cell];
      while (valueBits) {
        const valueBit = valueBits & -valueBits;
        valueBits ^= valueBit;
        valuePossibleCounts[LookupTables.toIndex(valueBit)]++;
      }

      const cellValues = grid[cell];
      if (grid[regionCells[cell]] === regionBit && !(cellValues & (cellValues - 1))) {
        valueFixedCounts[LookupTables.toIndex(cellValues)]++;
      }
    }

    for (let valueIndex = 0; valueIndex < numValues; valueIndex++) {
      if (valuePossibleCounts[valueIndex] === 0 || valueFixedCounts[valueIndex] > 1) {
        return false;
      }
    }
  }

  return true;
};

const enforceRegionValuePairBitMasks = function (grid) {
  if (!hasRestrictedGridValue.call(this, grid)) return true;

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const allValues = this._allValues;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];
    let possibleValues = 0;
    let fixedValues = 0;

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      const cellValues = grid[cell];
      possibleValues |= cellValues;

      if (grid[regionCells[cell]] === regionBit && !(cellValues & (cellValues - 1))) {
        if (fixedValues & cellValues) return false;
        fixedValues |= cellValues;
      }
    }

    if (possibleValues !== allValues) return false;
  }

  return true;
};

const enforceRegionValuePairsFixedRegionExclusion = function (grid, handlerAccumulator) {
  if (!validateScanRegionValuePairs.call(this)) return false;
  ensureFixedPairBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const fixedRegionsByValue = this._fixedRegionsByValue;
  fixedRegionsByValue.fill(0);

  for (let cell = 0; cell < numGridCells; cell++) {
    const cellValues = grid[cell];
    const regionValues = grid[regionCells[cell]];
    if ((cellValues & (cellValues - 1)) || (regionValues & (regionValues - 1))) continue;
    fixedRegionsByValue[LookupTables.toIndex(cellValues)] |= regionValues;
  }

  for (let cell = 0; cell < numGridCells; cell++) {
    const cellValues = grid[cell];
    if (cellValues & (cellValues - 1)) continue;

    const regionCell = regionCells[cell];
    const regionValues = grid[regionCell];
    if (!(regionValues & (regionValues - 1))) continue;

    const removeRegions = fixedRegionsByValue[LookupTables.toIndex(cellValues)];
    if (regionValues & removeRegions) {
      if (!this._restrictCell(grid, regionCell, ~removeRegions, handlerAccumulator)) return false;
    }
  }

  return true;
};

const enforceRegionValuePairsFixedPairExclusion = function (grid, handlerAccumulator) {
  if (!validateScanRegionValuePairs.call(this)) return false;
  ensureFixedPairBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const fixedRegionsByValue = this._fixedRegionsByValue;
  const fixedValuesByRegion = this._fixedValuesByRegion;
  fixedRegionsByValue.fill(0);
  fixedValuesByRegion.fill(0);

  for (let cell = 0; cell < numGridCells; cell++) {
    const cellValues = grid[cell];
    const regionValues = grid[regionCells[cell]];
    if ((cellValues & (cellValues - 1)) || (regionValues & (regionValues - 1))) continue;
    fixedRegionsByValue[LookupTables.toIndex(cellValues)] |= regionValues;
    fixedValuesByRegion[LookupTables.toIndex(regionValues)] |= cellValues;
  }

  for (let cell = 0; cell < numGridCells; cell++) {
    const cellValues = grid[cell];
    const regionCell = regionCells[cell];
    const regionValues = grid[regionCell];

    if (!(cellValues & (cellValues - 1)) && (regionValues & (regionValues - 1))) {
      const removeRegions = fixedRegionsByValue[LookupTables.toIndex(cellValues)];
      if (regionValues & removeRegions) {
        if (!this._restrictCell(grid, regionCell, ~removeRegions, handlerAccumulator)) return false;
      }
    }

    if (!(regionValues & (regionValues - 1)) && (cellValues & (cellValues - 1))) {
      const removeValues = fixedValuesByRegion[LookupTables.toIndex(regionValues)];
      if (cellValues & removeValues) {
        if (!this._restrictCell(grid, cell, ~removeValues, handlerAccumulator)) return false;
      }
    }
  }

  return true;
};

const enforceRegionValuePairsNoHiddenSingles = function (grid, handlerAccumulator) {
  if (!hasRestrictedGridValue.call(this, grid)) return true;
  ensureValueWitnessBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const numValues = this._regionSize;
  const valuePossibleCounts = this._valuePossibleCounts;
  const valueFixedCounts = this._valueFixedCounts;
  const valueFixedCells = this._valueFixedCells;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];

    let hasRestrictedCandidateValue = false;
    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      if (grid[regionCandidateCells[offset + candidateIndex]] !== this._allValues) {
        hasRestrictedCandidateValue = true;
        break;
      }
    }
    if (!hasRestrictedCandidateValue) continue;

    valuePossibleCounts.fill(0);
    valueFixedCounts.fill(0);

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      let valueBits = grid[cell];
      while (valueBits) {
        const valueBit = valueBits & -valueBits;
        valueBits ^= valueBit;
        valuePossibleCounts[LookupTables.toIndex(valueBit)]++;
      }

      const cellValues = grid[cell];
      if (grid[regionCells[cell]] === regionBit && !(cellValues & (cellValues - 1))) {
        const valueIndex = LookupTables.toIndex(cellValues);
        valueFixedCells[valueIndex] = cell;
        valueFixedCounts[valueIndex]++;
      }
    }

    let fixedValuesMask = 0;
    for (let valueIndex = 0; valueIndex < numValues; valueIndex++) {
      const valueBit = 1 << valueIndex;
      const possibleCount = valuePossibleCounts[valueIndex];
      const fixedCount = valueFixedCounts[valueIndex];

      if (possibleCount === 0 || fixedCount > 1) return false;
      if (fixedCount === 1) fixedValuesMask |= valueBit;
    }

    if (!fixedValuesMask) continue;

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      const regionCell = regionCells[cell];
      const cellValues = grid[cell];

      if (grid[regionCell] === regionBit) {
        let removeValues = cellValues & fixedValuesMask;
        if (removeValues && !(cellValues & (cellValues - 1))) {
          const valueIndex = LookupTables.toIndex(cellValues);
          if (valueFixedCells[valueIndex] === cell) removeValues = 0;
        }
        if (removeValues) {
          if (!this._restrictCell(grid, cell, ~removeValues, handlerAccumulator)) return false;
        }
      }

      if (!(cellValues & (cellValues - 1)) && (cellValues & fixedValuesMask)) {
        const valueIndex = LookupTables.toIndex(cellValues);
        if (valueFixedCells[valueIndex] !== cell) {
          if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) {
            return false;
          }
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsNoFixedValuePruning = function (grid, handlerAccumulator) {
  if (!hasRestrictedGridValue.call(this, grid)) return true;
  ensureValueWitnessBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const numValues = this._regionSize;
  const valuePossibleCounts = this._valuePossibleCounts;
  const valueFixedCounts = this._valueFixedCounts;
  const valuePossibleCells = this._valuePossibleCells;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];

    let hasRestrictedCandidateValue = false;
    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      if (grid[regionCandidateCells[offset + candidateIndex]] !== this._allValues) {
        hasRestrictedCandidateValue = true;
        break;
      }
    }
    if (!hasRestrictedCandidateValue) continue;

    valuePossibleCounts.fill(0);
    valueFixedCounts.fill(0);

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      let valueBits = grid[cell];
      while (valueBits) {
        const valueBit = valueBits & -valueBits;
        valueBits ^= valueBit;
        const valueIndex = LookupTables.toIndex(valueBit);
        valuePossibleCells[valueIndex] = cell;
        valuePossibleCounts[valueIndex]++;
      }

      const cellValues = grid[cell];
      if (grid[regionCells[cell]] === regionBit && !(cellValues & (cellValues - 1))) {
        valueFixedCounts[LookupTables.toIndex(cellValues)]++;
      }
    }

    for (let valueIndex = 0; valueIndex < numValues; valueIndex++) {
      const valueBit = 1 << valueIndex;
      const possibleCount = valuePossibleCounts[valueIndex];
      const fixedCount = valueFixedCounts[valueIndex];

      if (possibleCount === 0 || fixedCount > 1) return false;
      if (fixedCount === 0 && possibleCount === 1) {
        const possibleCell = valuePossibleCells[valueIndex];
        if (!this._restrictCell(grid, possibleCell, valueBit, handlerAccumulator)) return false;
        if (!this._restrictCell(grid, regionCells[possibleCell], regionBit, handlerAccumulator)) {
          return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsGated = function (grid, handlerAccumulator, shouldPruneRegion) {
  if (!hasRestrictedGridValue.call(this, grid)) return true;
  ensureValueWitnessBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const numValues = this._regionSize;
  const valuePossibleCounts = this._valuePossibleCounts;
  const valueFixedCounts = this._valueFixedCounts;
  const valuePossibleCells = this._valuePossibleCells;
  const valueFixedCells = this._valueFixedCells;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];

    let hasRestrictedCandidateValue = false;
    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      if (grid[regionCandidateCells[offset + candidateIndex]] !== this._allValues) {
        hasRestrictedCandidateValue = true;
        break;
      }
    }
    if (!hasRestrictedCandidateValue) continue;

    valuePossibleCounts.fill(0);
    valueFixedCounts.fill(0);

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      let valueBits = grid[cell];
      while (valueBits) {
        const valueBit = valueBits & -valueBits;
        valueBits ^= valueBit;
        const valueIndex = LookupTables.toIndex(valueBit);
        valuePossibleCells[valueIndex] = cell;
        valuePossibleCounts[valueIndex]++;
      }

      const cellValues = grid[cell];
      if (grid[regionCells[cell]] === regionBit && !(cellValues & (cellValues - 1))) {
        const valueIndex = LookupTables.toIndex(cellValues);
        valueFixedCells[valueIndex] = cell;
        valueFixedCounts[valueIndex]++;
      }
    }

    const doPrune = shouldPruneRegion.call(this, region, regionPossibleCount);
    let fixedValuesMask = 0;
    for (let valueIndex = 0; valueIndex < numValues; valueIndex++) {
      const valueBit = 1 << valueIndex;
      const possibleCount = valuePossibleCounts[valueIndex];
      const fixedCount = valueFixedCounts[valueIndex];

      if (possibleCount === 0 || fixedCount > 1) return false;

      if (fixedCount === 1) {
        fixedValuesMask |= valueBit;
      } else if (doPrune && possibleCount === 1) {
        const possibleCell = valuePossibleCells[valueIndex];
        if (!this._restrictCell(grid, possibleCell, valueBit, handlerAccumulator)) return false;
        if (!this._restrictCell(grid, regionCells[possibleCell], regionBit, handlerAccumulator)) {
          return false;
        }
      }
    }

    if (!doPrune || !fixedValuesMask) continue;

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      const regionCell = regionCells[cell];
      const cellValues = grid[cell];

      if (grid[regionCell] === regionBit) {
        let removeValues = cellValues & fixedValuesMask;
        if (removeValues && !(cellValues & (cellValues - 1))) {
          const valueIndex = LookupTables.toIndex(cellValues);
          if (valueFixedCells[valueIndex] === cell) removeValues = 0;
        }
        if (removeValues) {
          if (!this._restrictCell(grid, cell, ~removeValues, handlerAccumulator)) return false;
        }
      }

      if (!(cellValues & (cellValues - 1)) && (cellValues & fixedValuesMask)) {
        const valueIndex = LookupTables.toIndex(cellValues);
        if (valueFixedCells[valueIndex] !== cell) {
          if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsPruneFixedRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsGated.call(
    this, grid, handlerAccumulator, region => this._fixedCounts[region] > 0);
};

const enforceRegionValuePairsPruneTightRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsGated.call(
    this,
    grid,
    handlerAccumulator,
    (region, possibleCount) => this._fixedCounts[region] > 0 || possibleCount <= this._regionSize + 2);
};

const initializeValueInputCache = function (initialGridCells, cellExclusions, shape, stateAllocator) {
  if (!originalMethods.initialize.call(this, initialGridCells, cellExclusions, shape, stateAllocator)) {
    return false;
  }
  this._valueInputCacheOffset = stateAllocator.allocate(new Array(this._numGridCells * 2).fill(0));
  this._valueDirtyRegionsMask = this._regionMask;
  return true;
};

const scanRegionCandidatesWithValueInputCache = function (grid) {
  if (!originalMethods._scanRegionCandidates.call(this, grid)) return false;

  const regionCells = this._regionCells;
  const offset = this._valueInputCacheOffset;
  let dirtyRegionsMask = 0;
  for (let cell = 0; cell < this._numGridCells; cell++) {
    const cellValues = grid[cell];
    const regionValues = grid[regionCells[cell]];
    const valueOffset = offset + (cell << 1);
    const previousCellValues = grid[valueOffset];
    const previousRegionValues = grid[valueOffset + 1];
    if (cellValues !== previousCellValues || regionValues !== previousRegionValues) {
      dirtyRegionsMask |= regionValues | previousRegionValues;
    }
  }
  this._valueDirtyRegionsMask = dirtyRegionsMask & this._regionMask;
  return true;
};

const publishValueInputCache = function (grid) {
  const regionCells = this._regionCells;
  const offset = this._valueInputCacheOffset;
  for (let cell = 0; cell < this._numGridCells; cell++) {
    const valueOffset = offset + (cell << 1);
    grid[valueOffset] = grid[cell];
    grid[valueOffset + 1] = grid[regionCells[cell]];
  }
};

const enforceRegionValuePairsDirtyGated = function (grid, handlerAccumulator, shouldPruneRegion) {
  if (!validateScanRegionValuePairs.call(this)) return false;

  const dirtyRegionsMask = this._valueDirtyRegionsMask;
  if (!dirtyRegionsMask || !hasRestrictedGridValue.call(this, grid)) return true;
  ensureValueWitnessBuffers.call(this);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const numValues = this._regionSize;
  const valuePossibleCounts = this._valuePossibleCounts;
  const valueFixedCounts = this._valueFixedCounts;
  const valuePossibleCells = this._valuePossibleCells;
  const valueFixedCells = this._valueFixedCells;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];
    valuePossibleCounts.fill(0);
    valueFixedCounts.fill(0);

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      let valueBits = grid[cell];
      while (valueBits) {
        const valueBit = valueBits & -valueBits;
        valueBits ^= valueBit;
        const valueIndex = LookupTables.toIndex(valueBit);
        valuePossibleCells[valueIndex] = cell;
        valuePossibleCounts[valueIndex]++;
      }

      const cellValues = grid[cell];
      if (grid[regionCells[cell]] === regionBit && !(cellValues & (cellValues - 1))) {
        const valueIndex = LookupTables.toIndex(cellValues);
        valueFixedCells[valueIndex] = cell;
        valueFixedCounts[valueIndex]++;
      }
    }

    const doPrune = shouldPruneRegion.call(this, region, regionPossibleCount);
    let fixedValuesMask = 0;
    for (let valueIndex = 0; valueIndex < numValues; valueIndex++) {
      const valueBit = 1 << valueIndex;
      const possibleCount = valuePossibleCounts[valueIndex];
      const fixedCount = valueFixedCounts[valueIndex];

      if (possibleCount === 0 || fixedCount > 1) return false;

      if (fixedCount === 1) {
        fixedValuesMask |= valueBit;
      } else if (doPrune && possibleCount === 1) {
        const possibleCell = valuePossibleCells[valueIndex];
        if (!this._restrictCell(grid, possibleCell, valueBit, handlerAccumulator)) return false;
        if (!this._restrictCell(grid, regionCells[possibleCell], regionBit, handlerAccumulator)) {
          return false;
        }
      }
    }

    if (!doPrune || !fixedValuesMask) continue;

    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      const regionCell = regionCells[cell];
      const cellValues = grid[cell];

      if (grid[regionCell] === regionBit) {
        let removeValues = cellValues & fixedValuesMask;
        if (removeValues && !(cellValues & (cellValues - 1))) {
          const valueIndex = LookupTables.toIndex(cellValues);
          if (valueFixedCells[valueIndex] === cell) removeValues = 0;
        }
        if (removeValues) {
          if (!this._restrictCell(grid, cell, ~removeValues, handlerAccumulator)) return false;
        }
      }

      if (!(cellValues & (cellValues - 1)) && (cellValues & fixedValuesMask)) {
        const valueIndex = LookupTables.toIndex(cellValues);
        if (valueFixedCells[valueIndex] !== cell) {
          if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsDirtyPruneFixedRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsDirtyGated.call(
    this, grid, handlerAccumulator, region => this._fixedCounts[region] > 0);
};

const enforceRegionValuePairsDirtyPruneTightRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsDirtyGated.call(
    this,
    grid,
    handlerAccumulator,
    (region, possibleCount) => this._fixedCounts[region] > 0 || possibleCount <= this._regionSize + 2);
};

const enforceConsistencyValueInputCache = function (grid, handlerAccumulator) {
  this._connectivityDirtyRegionsMask = 0;

  while (true) {
    this._changed = false;
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

    if (!this._scanRegionCandidates(grid)) return false;

    this._changed = false;
    if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    this._changed = false;
    if (!this._enforceRegionValuePairs(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    if (this._valueDirtyRegionsMask) publishValueInputCache.call(this, grid);
    this._connectivityDirtyRegionsMask = 0;
    return true;
  }
};

const installValueInputCache = (enforceRegionValuePairs) => {
  ChaosConstruction.prototype.initialize = initializeValueInputCache;
  ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithValueInputCache;
  ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairs;
  ChaosConstruction.prototype.enforceConsistency = enforceConsistencyValueInputCache;
};

const initializeIncrementalValueCounts = function (initialGridCells, cellExclusions, shape, stateAllocator) {
  if (!originalMethods.initialize.call(this, initialGridCells, cellExclusions, shape, stateAllocator)) {
    return false;
  }

  const pairCount = this._numRegions * this._regionSize;
  this._valueInputCacheOffset = stateAllocator.allocate(new Array(this._numGridCells * 2).fill(0));
  this._valuePossibleCountsOffset = stateAllocator.allocate(new Array(pairCount).fill(0));
  this._valueFixedCountsOffset = stateAllocator.allocate(new Array(pairCount).fill(0));
  this._valuePossibleCellXorOffset = stateAllocator.allocate(new Array(pairCount).fill(0));
  this._valueFixedCellXorOffset = stateAllocator.allocate(new Array(pairCount).fill(0));
  this._valueDirtyMasks = new Uint16Array(this._numRegions);
  this._valueDirtyRegionsMask = this._regionMask;
  return true;
};

const updateIncrementalValuePairCounts = function (grid) {
  const regionCells = this._regionCells;
  const inputCacheOffset = this._valueInputCacheOffset;
  const possibleCountsOffset = this._valuePossibleCountsOffset;
  const fixedCountsOffset = this._valueFixedCountsOffset;
  const possibleCellXorOffset = this._valuePossibleCellXorOffset;
  const fixedCellXorOffset = this._valueFixedCellXorOffset;
  const dirtyValueMasks = this._valueDirtyMasks;
  const regionSize = this._regionSize;
  dirtyValueMasks.fill(0);

  let dirtyRegionsMask = 0;
  const updatePossibleValues = (region, valueBits, cell) => {
    while (valueBits) {
      const valueBit = valueBits & -valueBits;
      valueBits ^= valueBit;
      const pairOffset = region * regionSize + LookupTables.toIndex(valueBit);
      grid[possibleCountsOffset + pairOffset]++;
      grid[possibleCellXorOffset + pairOffset] ^= cell;
    }
  };
  const removePossibleValues = (region, valueBits, cell) => {
    while (valueBits) {
      const valueBit = valueBits & -valueBits;
      valueBits ^= valueBit;
      const pairOffset = region * regionSize + LookupTables.toIndex(valueBit);
      grid[possibleCountsOffset + pairOffset]--;
      grid[possibleCellXorOffset + pairOffset] ^= cell;
    }
  };

  for (let cell = 0; cell < this._numGridCells; cell++) {
    const currentCellValues = grid[cell];
    const currentRegionValues = grid[regionCells[cell]];
    const valueOffset = inputCacheOffset + (cell << 1);
    const previousCellValues = grid[valueOffset];
    const previousRegionValues = grid[valueOffset + 1];
    if (currentCellValues === previousCellValues && currentRegionValues === previousRegionValues) {
      continue;
    }

    let affectedRegions = (previousRegionValues | currentRegionValues) & this._regionMask;
    const affectedValues = previousCellValues | currentCellValues;
    dirtyRegionsMask |= affectedRegions;
    while (affectedRegions) {
      const regionBit = affectedRegions & -affectedRegions;
      affectedRegions ^= regionBit;
      const region = LookupTables.toIndex(regionBit);
      dirtyValueMasks[region] = this._incrementalValueDirtyAllValues
        ? this._allValues
        : dirtyValueMasks[region] | affectedValues;
    }

    let removedRegions = previousRegionValues & ~currentRegionValues;
    while (removedRegions) {
      const regionBit = removedRegions & -removedRegions;
      removedRegions ^= regionBit;
      removePossibleValues(LookupTables.toIndex(regionBit), previousCellValues, cell);
    }

    let sharedRegions = previousRegionValues & currentRegionValues;
    const removedValues = previousCellValues & ~currentCellValues;
    const addedValues = currentCellValues & ~previousCellValues;
    while (sharedRegions) {
      const regionBit = sharedRegions & -sharedRegions;
      sharedRegions ^= regionBit;
      const region = LookupTables.toIndex(regionBit);
      removePossibleValues(region, removedValues, cell);
      updatePossibleValues(region, addedValues, cell);
    }

    let addedRegions = currentRegionValues & ~previousRegionValues;
    while (addedRegions) {
      const regionBit = addedRegions & -addedRegions;
      addedRegions ^= regionBit;
      updatePossibleValues(LookupTables.toIndex(regionBit), currentCellValues, cell);
    }

    const previousFixed = previousCellValues && !(previousCellValues & (previousCellValues - 1))
      && previousRegionValues && !(previousRegionValues & (previousRegionValues - 1));
    const currentFixed = !(currentCellValues & (currentCellValues - 1))
      && !(currentRegionValues & (currentRegionValues - 1));
    if (previousFixed) {
      const pairOffset = LookupTables.toIndex(previousRegionValues) * regionSize
        + LookupTables.toIndex(previousCellValues);
      if (!currentFixed || currentCellValues !== previousCellValues
        || currentRegionValues !== previousRegionValues) {
        grid[fixedCountsOffset + pairOffset]--;
        grid[fixedCellXorOffset + pairOffset] ^= cell;
      }
    }
    if (currentFixed) {
      const pairOffset = LookupTables.toIndex(currentRegionValues) * regionSize
        + LookupTables.toIndex(currentCellValues);
      if (!previousFixed || currentCellValues !== previousCellValues
        || currentRegionValues !== previousRegionValues) {
        grid[fixedCountsOffset + pairOffset]++;
        grid[fixedCellXorOffset + pairOffset] ^= cell;
      }
    }

    grid[valueOffset] = currentCellValues;
    grid[valueOffset + 1] = currentRegionValues;
  }

  this._valueDirtyRegionsMask = dirtyRegionsMask;
};

const scanRegionCandidatesWithIncrementalValueCounts = function (grid) {
  if (!originalMethods._scanRegionCandidates.call(this, grid)) return false;
  updateIncrementalValuePairCounts.call(this, grid);
  return true;
};

const enforceRegionValuePairsIncrementalDirtyGated = function (grid, handlerAccumulator, shouldPruneRegion) {
  if (!validateScanRegionValuePairs.call(this)) return false;

  const dirtyRegionsMask = this._valueDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const regionPossibleCounts = this._possibleCounts;
  const regionSize = this._regionSize;
  const dirtyValueMasks = this._valueDirtyMasks;
  const possibleCountsOffset = this._valuePossibleCountsOffset;
  const fixedCountsOffset = this._valueFixedCountsOffset;
  const possibleCellXorOffset = this._valuePossibleCellXorOffset;
  const fixedCellXorOffset = this._valueFixedCellXorOffset;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const doPrune = shouldPruneRegion.call(
      this, region, regionPossibleCounts[region] + this._fixedCounts[region]);
    let dirtyValues = dirtyValueMasks[region] & this._allValues;
    let fixedValuesMask = 0;
    while (dirtyValues) {
      const valueBit = dirtyValues & -dirtyValues;
      dirtyValues ^= valueBit;
      const pairOffset = region * regionSize + LookupTables.toIndex(valueBit);
      const possibleCount = grid[possibleCountsOffset + pairOffset];
      const fixedCount = grid[fixedCountsOffset + pairOffset];

      if (possibleCount === 0 || fixedCount > 1) return false;

      if (fixedCount === 1) {
        fixedValuesMask |= valueBit;
      } else if (doPrune && possibleCount === 1) {
        const possibleCell = grid[possibleCellXorOffset + pairOffset];
        if (!this._restrictCell(grid, possibleCell, valueBit, handlerAccumulator)) return false;
        if (!this._restrictCell(grid, regionCells[possibleCell], regionBit, handlerAccumulator)) {
          return false;
        }
      }
    }

    if (!doPrune || !fixedValuesMask) continue;

    const offset = region * numGridCells;
    const regionPossibleCount = regionPossibleCounts[region] + this._fixedCounts[region];
    for (let candidateIndex = 0; candidateIndex < regionPossibleCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      const regionCell = regionCells[cell];
      const cellValues = grid[cell];

      if (grid[regionCell] === regionBit) {
        let removeValues = cellValues & fixedValuesMask;
        if (removeValues && !(cellValues & (cellValues - 1))) {
          const pairOffset = region * regionSize + LookupTables.toIndex(cellValues);
          if (grid[fixedCellXorOffset + pairOffset] === cell) removeValues = 0;
        }
        if (removeValues) {
          if (!this._restrictCell(grid, cell, ~removeValues, handlerAccumulator)) return false;
        }
      }

      if (!(cellValues & (cellValues - 1)) && (cellValues & fixedValuesMask)) {
        const pairOffset = region * regionSize + LookupTables.toIndex(cellValues);
        if (grid[fixedCellXorOffset + pairOffset] !== cell) {
          if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsIncrementalDirtyPruneFixedRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsIncrementalDirtyGated.call(
    this, grid, handlerAccumulator, region => this._fixedCounts[region] > 0);
};

const enforceRegionValuePairsIncrementalDirtyPruneTightRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsIncrementalDirtyGated.call(
    this,
    grid,
    handlerAccumulator,
    (region, possibleCount) => this._fixedCounts[region] > 0 || possibleCount <= this._regionSize + 2);
};

const enforceRegionValuePairsIncrementalDirtyHiddenSingles = function (grid, handlerAccumulator) {
  if (!validateScanRegionValuePairs.call(this)) return false;

  const dirtyRegionsMask = this._valueDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  const regionCells = this._regionCells;
  const regionSize = this._regionSize;
  const dirtyValueMasks = this._valueDirtyMasks;
  const possibleCountsOffset = this._valuePossibleCountsOffset;
  const fixedCountsOffset = this._valueFixedCountsOffset;
  const possibleCellXorOffset = this._valuePossibleCellXorOffset;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    let dirtyValues = dirtyValueMasks[region] & this._allValues;
    while (dirtyValues) {
      const valueBit = dirtyValues & -dirtyValues;
      dirtyValues ^= valueBit;
      const pairOffset = region * regionSize + LookupTables.toIndex(valueBit);
      const possibleCount = grid[possibleCountsOffset + pairOffset];
      const fixedCount = grid[fixedCountsOffset + pairOffset];

      if (possibleCount === 0 || fixedCount > 1) return false;
      if (fixedCount === 0 && possibleCount === 1) {
        const possibleCell = grid[possibleCellXorOffset + pairOffset];
        if (!this._restrictCell(grid, possibleCell, valueBit, handlerAccumulator)) return false;
        if (!this._restrictCell(grid, regionCells[possibleCell], regionBit, handlerAccumulator)) {
          return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsIncrementalDirtyGatedHiddenSingles = function (
  grid, handlerAccumulator, shouldPruneRegion) {
  if (!validateScanRegionValuePairs.call(this)) return false;

  const dirtyRegionsMask = this._valueDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  const regionCells = this._regionCells;
  const regionSize = this._regionSize;
  const dirtyValueMasks = this._valueDirtyMasks;
  const possibleCountsOffset = this._valuePossibleCountsOffset;
  const fixedCountsOffset = this._valueFixedCountsOffset;
  const possibleCellXorOffset = this._valuePossibleCellXorOffset;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const doPrune = shouldPruneRegion.call(
      this, region, this._possibleCounts[region] + this._fixedCounts[region]);
    let dirtyValues = dirtyValueMasks[region] & this._allValues;
    while (dirtyValues) {
      const valueBit = dirtyValues & -dirtyValues;
      dirtyValues ^= valueBit;
      const pairOffset = region * regionSize + LookupTables.toIndex(valueBit);
      const possibleCount = grid[possibleCountsOffset + pairOffset];
      const fixedCount = grid[fixedCountsOffset + pairOffset];

      if (possibleCount === 0 || fixedCount > 1) return false;
      if (doPrune && fixedCount === 0 && possibleCount === 1) {
        const possibleCell = grid[possibleCellXorOffset + pairOffset];
        if (!this._restrictCell(grid, possibleCell, valueBit, handlerAccumulator)) return false;
        if (!this._restrictCell(grid, regionCells[possibleCell], regionBit, handlerAccumulator)) {
          return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairsIncrementalDirtyHiddenFixedRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsIncrementalDirtyGatedHiddenSingles.call(
    this, grid, handlerAccumulator, region => this._fixedCounts[region] > 0);
};

const enforceRegionValuePairsIncrementalDirtyHiddenTightRegions = function (grid, handlerAccumulator) {
  return enforceRegionValuePairsIncrementalDirtyGatedHiddenSingles.call(
    this,
    grid,
    handlerAccumulator,
    (region, possibleCount) => this._fixedCounts[region] > 0 || possibleCount <= this._regionSize + 2);
};

const installIncrementalValueCounts = (enforceRegionValuePairs, dirtyAllValues = false) => {
  ChaosConstruction.prototype._incrementalValueDirtyAllValues = dirtyAllValues;
  ChaosConstruction.prototype.initialize = initializeIncrementalValueCounts;
  ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithIncrementalValueCounts;
  ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairs;
  ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
};

const initializeConnectivityCellCache = function (initialGridCells, cellExclusions, shape, stateAllocator) {
  if (!originalMethods.initialize.call(this, initialGridCells, cellExclusions, shape, stateAllocator)) {
    return false;
  }
  this._connectivityCellCacheOffset = stateAllocator.allocate(new Array(this._numGridCells).fill(0));
  return true;
};

const scanRegionCandidatesWithConnectivityCellCache = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const possibleValueMasks = this._possibleValueMasks;
  const fixedValueMasks = this._fixedValueMasks;
  fixedCounts.fill(0);
  possibleCounts.fill(0);
  possibleValueMasks.fill(0);
  fixedValueMasks.fill(0);

  const regionCells = this._regionCells;
  const regionCandidateCells = this._regionCandidateCells;
  const numGridCells = this._numGridCells;
  const connectivityCellCacheOffset = this._connectivityCellCacheOffset;
  let connectivityDirtyRegionsMask = this._connectivityDirtyRegionsMask;
  for (let cell = 0; cell < numGridCells; cell++) {
    const regionMask = grid[regionCells[cell]];
    if (!regionMask) return false;
    const previousRegionMask = grid[connectivityCellCacheOffset + cell];
    if (regionMask !== previousRegionMask) {
      connectivityDirtyRegionsMask |= regionMask ^ previousRegionMask;
      if (!(regionMask & (regionMask - 1))) {
        connectivityDirtyRegionsMask |= regionMask & previousRegionMask;
      }
    }
    grid[connectivityCellCacheOffset + cell] = regionMask;

    const cellValues = grid[cell];
    if (!(regionMask & (regionMask - 1))) {
      const region = 31 - Math.clz32(regionMask);
      possibleValueMasks[region] |= cellValues;
      regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]] = cell;
      fixedCounts[region]++;
      if (!(cellValues & (cellValues - 1))) {
        if (fixedValueMasks[region] & cellValues) {
          return false;
        }
        fixedValueMasks[region] |= cellValues;
      }
    } else {
      let regionValues = regionMask;
      while (regionValues) {
        const regionBit = regionValues & -regionValues;
        regionValues ^= regionBit;
        const region = 31 - Math.clz32(regionBit);
        possibleValueMasks[region] |= cellValues;
        regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]++] = cell;
      }
    }
  }
  this._connectivityDirtyRegionsMask = connectivityDirtyRegionsMask & this._regionMask;

  return true;
};

const installConnectivityCellCache = () => {
  ChaosConstruction.prototype.initialize = initializeConnectivityCellCache;
  ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithConnectivityCellCache;
};

const scanRegionCandidatesLazyConnectivity = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const possibleValueMasks = this._possibleValueMasks;
  const fixedValueMasks = this._fixedValueMasks;
  fixedCounts.fill(0);
  possibleCounts.fill(0);
  possibleValueMasks.fill(0);
  fixedValueMasks.fill(0);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  for (let cell = 0; cell < numGridCells; cell++) {
    const regionMask = grid[regionCells[cell]];
    if (!regionMask) return false;
    const cellValues = grid[cell];
    if (!(regionMask & (regionMask - 1))) {
      const region = 31 - Math.clz32(regionMask);
      possibleValueMasks[region] |= cellValues;
      fixedCounts[region]++;
      if (!(cellValues & (cellValues - 1))) {
        if (fixedValueMasks[region] & cellValues) {
          return false;
        }
        fixedValueMasks[region] |= cellValues;
      }
    } else {
      let regionValues = regionMask;
      while (regionValues) {
        const regionBit = regionValues & -regionValues;
        regionValues ^= regionBit;
        const region = 31 - Math.clz32(regionBit);
        possibleCounts[region]++;
        possibleValueMasks[region] |= cellValues;
      }
    }
  }

  const possibleCountCacheOffset = this._possibleCountCacheOffset;
  let dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  for (let region = 0; region < this._numRegions; region++) {
    const possibleCount = possibleCounts[region];
    if (grid[possibleCountCacheOffset + region] !== possibleCount) {
      dirtyRegionsMask |= 1 << region;
    }
    grid[possibleCountCacheOffset + region] = possibleCount;
  }
  this._connectivityDirtyRegionsMask = dirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  const candidateWriteCounts = this._candidateWriteCounts ??= new Uint16Array(this._numRegions);
  const regionCandidateCells = this._regionCandidateCells;
  candidateWriteCounts.fill(0);
  for (let cell = 0; cell < numGridCells; cell++) {
    let regionValues = grid[regionCells[cell]] & dirtyRegionsMask;
    while (regionValues) {
      const regionBit = regionValues & -regionValues;
      regionValues ^= regionBit;
      const region = 31 - Math.clz32(regionBit);
      regionCandidateCells[region * numGridCells + candidateWriteCounts[region]++] = cell;
    }
  }

  return true;
};

const enforceConnectivityAllRegions = function (grid, handlerAccumulator) {
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  this._connectivityDirtyRegionsMask = this._regionMask;
  const result = originalMethods._enforceConnectivity.call(this, grid, handlerAccumulator);
  this._connectivityDirtyRegionsMask = dirtyRegionsMask;
  return result;
};

const enforceConnectivityWithoutDistance = function (grid, handlerAccumulator) {
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  this._connectivityDirtyRegionsMask = this._regionMask;
  const result = enforceConnectivityDeferredRegionMasks.call(
    this, grid, handlerAccumulator, false);
  this._connectivityDirtyRegionsMask = dirtyRegionsMask;
  return result;
};

const enforceConnectivityLimitedDistance = function (grid, handlerAccumulator) {
  return enforceConnectivityAllRegions.call(this, grid, handlerAccumulator);
};

const enforceConnectivityDirtyNoDistance = function (grid, handlerAccumulator) {
  return enforceConnectivityDeferredRegionMasks.call(this, grid, handlerAccumulator, false);
};

const enforceConnectivityNoPruning = function (grid) {
  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const visitMarks = this._visitMarks;
  const regionSize = this._regionSize;
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const visitId = this._nextVisitId();
    const offset = region * numGridCells;
    const candidateCount = fixedCounts[region] + possibleCounts[region];
    if (candidateCount === 0) return false;

    let fixedStart = -1;
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
      const cell = regionCandidateCells[offset + candidateIndex];
      if (grid[regionCells[cell]] === regionBit) {
        fixedStart = cell;
        break;
      }
    }

    if (fixedStart >= 0) {
      const componentSize = this._collectRegionComponent(grid, fixedStart, regionBit, visitId);
      if (componentSize < regionSize) return false;
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const cell = regionCandidateCells[offset + candidateIndex];
        if (grid[regionCells[cell]] === regionBit && visitMarks[cell] !== visitId) return false;
      }
    } else {
      let hasViableComponent = false;
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const start = regionCandidateCells[offset + candidateIndex];
        if (!(grid[regionCells[start]] & regionBit) || visitMarks[start] === visitId) continue;
        const componentSize = this._collectRegionComponent(grid, start, regionBit, visitId);
        if (componentSize >= regionSize) hasViableComponent = true;
      }
      if (!hasViableComponent) return false;
    }
  }

  return true;
};

const enforceConnectivityNoExactForcing = function (grid, handlerAccumulator, useDistancePruning = true) {
  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const stack = this._componentStack;
  const visitMarks = this._visitMarks;
  const regionSize = this._regionSize;
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const visitId = this._nextVisitId();
    const offset = region * numGridCells;
    const candidateCount = fixedCounts[region] + possibleCounts[region];
    if (candidateCount === 0) return false;

    const fixedCount = this._seedFixedRegionCells(
      grid, regionBit, offset, candidateCount, visitId);
    if (fixedCount < 0) return false;

    if (fixedCount) {
      const maxDistance = useDistancePruning ? regionSize - fixedCount : numGridCells;
      const componentSize = this._traverseFixedRegionComponent(
        grid, regionBit, fixedCount, visitId, maxDistance, handlerAccumulator);
      if (!componentSize || componentSize < regionSize) return false;

      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const cell = regionCandidateCells[offset + candidateIndex];
        if (visitMarks[cell] !== visitId
          && !this._restrictCell(grid, regionCells[cell], ~regionBit, handlerAccumulator)) {
          return false;
        }
      }
    } else {
      let hasViableComponent = false;

      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const start = regionCandidateCells[offset + candidateIndex];
        if (!(grid[regionCells[start]] & regionBit)) continue;
        if (visitMarks[start] === visitId) continue;

        const componentSize = this._collectRegionComponent(grid, start, regionBit, visitId);
        if (componentSize >= regionSize) {
          hasViableComponent = true;
        } else {
          for (let i = 0; i < componentSize; i++) {
            if (!this._restrictCell(
              grid, regionCells[stack[i]], ~regionBit, handlerAccumulator)) {
              return false;
            }
          }
        }
      }

      if (!hasViableComponent) return false;
    }
  }

  return true;
};

const enforceConnectivityNoSmallComponentPruning = function (grid, handlerAccumulator, useDistancePruning = true) {
  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  const regionCandidateCells = this._regionCandidateCells;
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const visitMarks = this._visitMarks;
  const regionSize = this._regionSize;
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const visitId = this._nextVisitId();
    const offset = region * numGridCells;
    const candidateCount = fixedCounts[region] + possibleCounts[region];
    if (candidateCount === 0) return false;

    const fixedCount = this._seedFixedRegionCells(
      grid, regionBit, offset, candidateCount, visitId);
    if (fixedCount < 0) return false;

    if (fixedCount) {
      const maxDistance = useDistancePruning ? regionSize - fixedCount : numGridCells;
      const componentSize = this._traverseFixedRegionComponent(
        grid, regionBit, fixedCount, visitId, maxDistance, handlerAccumulator);
      if (!componentSize || componentSize < regionSize) return false;

      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const cell = regionCandidateCells[offset + candidateIndex];
        const regionCell = regionCells[cell];
        if (visitMarks[cell] !== visitId) {
          if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) return false;
        } else if (componentSize === regionSize) {
          if (!this._restrictCell(grid, regionCell, regionBit, handlerAccumulator)) return false;
        }
      }
    } else {
      let hasViableComponent = false;

      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const start = regionCandidateCells[offset + candidateIndex];
        if (!(grid[regionCells[start]] & regionBit)) continue;
        if (visitMarks[start] === visitId) continue;

        const componentSize = this._collectRegionComponent(grid, start, regionBit, visitId);
        if (componentSize >= regionSize) hasViableComponent = true;
      }

      if (!hasViableComponent) return false;
    }
  }

  return true;
};

const manhattanDistance = (cellA, cellB, numCols) => {
  const rowA = cellA / numCols | 0;
  const colA = cellA % numCols;
  const rowB = cellB / numCols | 0;
  const colB = cellB % numCols;
  return Math.abs(rowA - rowB) + Math.abs(colA - colB);
};

const diameterCellLowerBound = (cells, numCols) => {
  const numCells = cells.length;
  if (numCells <= 1) return numCells;

  let maxDistance = 0;
  for (let i = 0; i < numCells; i++) {
    for (let j = i + 1; j < numCells; j++) {
      maxDistance = Math.max(maxDistance, manhattanDistance(cells[i], cells[j], numCols));
    }
  }

  return maxDistance + 1;
};

const collectFixedDiameterExtrema = (grid, regionCellOffset, numGridCells, numCols, regionBit, extrema) => {
  extrema.count = 0;
  extrema.minSum = Infinity;
  extrema.maxSum = -Infinity;
  extrema.minDiff = Infinity;
  extrema.maxDiff = -Infinity;

  for (let cell = 0; cell < numGridCells; cell++) {
    if (grid[regionCellOffset + cell] !== regionBit) continue;
    extrema.count++;
    const row = cell / numCols | 0;
    const col = cell % numCols;
    const sum = row + col;
    const diff = row - col;
    if (sum < extrema.minSum) extrema.minSum = sum;
    if (sum > extrema.maxSum) extrema.maxSum = sum;
    if (diff < extrema.minDiff) extrema.minDiff = diff;
    if (diff > extrema.maxDiff) extrema.maxDiff = diff;
  }
};

const diameterExtremaLowerBound = (extrema) => {
  if (!extrema.count) return 0;
  return Math.max(extrema.maxSum - extrema.minSum, extrema.maxDiff - extrema.minDiff) + 1;
};

const diameterExtremaLowerBoundWithCell = (extrema, cell, numCols) => {
  const row = cell / numCols | 0;
  const col = cell % numCols;
  const sum = row + col;
  const diff = row - col;
  return Math.max(
    Math.max(extrema.maxSum, sum) - Math.min(extrema.minSum, sum),
    Math.max(extrema.maxDiff, diff) - Math.min(extrema.minDiff, diff)) + 1;
};

const enforceConnectivityWithDiameterDistance = function (grid, handlerAccumulator) {
  if (!originalMethods._enforceConnectivity.call(this, grid, handlerAccumulator)) {
    return false;
  }

  const regionCellOffset = this._regionCellOffset;
  const numGridCells = this._numGridCells;
  const numCols = this._neighbors[3];
  const regionSize = this._regionSize;
  const terminals = [];

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    terminals.length = 0;
    for (let cell = 0; cell < numGridCells; cell++) {
      if (grid[regionCellOffset + cell] === regionBit) terminals.push(cell);
    }
    if (terminals.length === 0) continue;
    if (diameterCellLowerBound(terminals, numCols) > regionSize) return false;

    const fixedTerminalCount = terminals.length;
    for (let cell = 0; cell < numGridCells; cell++) {
      const regionCell = regionCellOffset + cell;
      if (grid[regionCell] === regionBit || !(grid[regionCell] & regionBit)) continue;
      terminals.length = fixedTerminalCount;
      terminals.push(cell);
      if (diameterCellLowerBound(terminals, numCols) > regionSize) {
        if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) return false;
      }
    }
  }

  return true;
};

const enforceConnectivityWithFastDiameterDistance = function (grid, handlerAccumulator) {
  if (!originalMethods._enforceConnectivity.call(this, grid, handlerAccumulator)) {
    return false;
  }

  const regionCellOffset = this._regionCellOffset;
  const numGridCells = this._numGridCells;
  const numCols = this._neighbors[3];
  const regionSize = this._regionSize;
  const extrema = {};

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    collectFixedDiameterExtrema(grid, regionCellOffset, numGridCells, numCols, regionBit, extrema);
    if (!extrema.count) continue;
    if (diameterExtremaLowerBound(extrema) > regionSize) return false;

    for (let cell = 0; cell < numGridCells; cell++) {
      const regionCell = regionCellOffset + cell;
      if (grid[regionCell] === regionBit || !(grid[regionCell] & regionBit)) continue;
      const lowerBound = diameterExtremaLowerBoundWithCell(extrema, cell, numCols);
      if (lowerBound > regionSize) {
        if (!this._restrictCell(grid, regionCell, ~regionBit, handlerAccumulator)) return false;
      }
    }
  }

  return true;
};

const enforceConnectivityWithFixedDiameterDistance = function (grid, handlerAccumulator) {
  if (!originalMethods._enforceConnectivity.call(this, grid, handlerAccumulator)) {
    return false;
  }

  const regionCellOffset = this._regionCellOffset;
  const numGridCells = this._numGridCells;
  const numCols = this._neighbors[3];
  const regionSize = this._regionSize;
  const extrema = {};

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    collectFixedDiameterExtrema(grid, regionCellOffset, numGridCells, numCols, regionBit, extrema);
    if (diameterExtremaLowerBound(extrema) > regionSize) {
      return false;
    }
  }

  return true;
};

const scanRegionCandidatesWithFixedRoots = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const possibleValueMasks = this._possibleValueMasks;
  const fixedValueMasks = this._fixedValueMasks;
  const fixedRoots = this._connectivityFixedRoots ??= new Uint16Array(this._numRegions);
  const noCell = ChaosConstruction._NO_CELL;
  fixedCounts.fill(0);
  possibleCounts.fill(0);
  possibleValueMasks.fill(0);
  fixedValueMasks.fill(0);
  fixedRoots.fill(noCell);

  const numGridCells = this._numGridCells;
  const numRegions = this._numRegions;
  const shardSizes = this._regionShardSizes;
  const shardValueMasks = this._regionShardScratchMasks;
  const shardFixedValueMasks = this._regionShardFixedValueMasks;
  const possibleCountCacheOffset = this._possibleCountCacheOffset;
  const regionCellOffset = this._regionCellOffset;
  let connectivityDirtyRegionsMask = this._connectivityDirtyRegionsMask;
  let hasPossibleRegionCells = false;

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
      if (fixedRoots[region] === noCell) fixedRoots[region] = root;
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
};

const enforceConnectivityWithScanFixedRoots = function (grid, handlerAccumulator) {
  const numGridCells = this._numGridCells;
  const regionCellOffset = this._regionCellOffset;
  const stack = this._componentStack;
  const shardSizes = this._regionShardSizes;
  const shardMasks = this._regionShardScratchMasks;
  const fixedCounts = this._fixedCounts;
  const fixedRoots = this._connectivityFixedRoots;
  const fixedValueMasks = this._fixedValueMasks;
  const visitMarks = this._visitMarks;
  const regionSize = this._regionSize;
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  shardMasks.set(
    grid.subarray(regionCellOffset, regionCellOffset + numGridCells));

  let useCachedFixedRoots = true;
  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const visitId = this._nextVisitId();
    let fixedSize = fixedCounts[region];
    let fixedRoot = fixedRoots[region];
    if (!useCachedFixedRoots) {
      fixedSize = 0;
      fixedRoot = ChaosConstruction._NO_CELL;
      for (let root = 0; root < numGridCells; root++) {
        if (!shardSizes[root] || shardMasks[root] !== regionBit) continue;
        if (fixedRoot === ChaosConstruction._NO_CELL) fixedRoot = root;
        fixedSize += shardSizes[root];
        if (fixedSize > regionSize) return false;
      }
    }
    if (fixedSize > regionSize) return false;

    if (fixedSize) {
      if (fixedRoot === ChaosConstruction._NO_CELL) return false;
      const componentSize = this._traverseFixedRegionShardComponent(
        grid, shardMasks, regionBit, fixedSize, fixedRoot, visitId);
      if (componentSize < regionSize) return false;
      const componentRootCount = this._componentStackSize;
      const fixedValueMask = fixedValueMasks[region];
      let remainingComponentSize = componentSize;

      for (let root = 0; root < numGridCells; root++) {
        if (!shardSizes[root] || !(shardMasks[root] & regionBit)) continue;
        if (visitMarks[root] !== visitId) {
          if (!this._restrictConnectivityShardMask(shardMasks, root, ~regionBit)) {
            return false;
          }
        }
      }

      if (remainingComponentSize > regionSize) {
        remainingComponentSize = this._pruneConnectivityValueConflicts(
          shardMasks, regionBit, componentRootCount, componentSize, fixedSize, fixedValueMask);
        if (remainingComponentSize < 0) return false;
      }

      if (remainingComponentSize < regionSize) return false;
      if (remainingComponentSize === regionSize) {
        for (let i = 0; i < componentRootCount; i++) {
          const root = stack[i];
          if (!(shardMasks[root] & regionBit)) continue;
          if (!this._restrictConnectivityShardMask(shardMasks, root, regionBit)) {
            return false;
          }
        }
      }
    } else {
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
          if (remainingComponentSize < 0) return false;

          if (remainingComponentSize >= regionSize) {
            hasViableComponent = true;
          } else {
            for (let i = 0; i < componentRootCount; i++) {
              const root = stack[i];
              if (!(shardMasks[root] & regionBit)) continue;
              if (!this._restrictConnectivityShardMask(shardMasks, root, ~regionBit)) {
                return false;
              }
            }
          }
        } else {
          for (let i = 0; i < componentRootCount; i++) {
            if (!this._restrictConnectivityShardMask(shardMasks, stack[i], ~regionBit)) {
              return false;
            }
          }
        }
      }

      if (!hasViableComponent) return false;
    }

    useCachedFixedRoots = false;
  }

  let bottleneckRegionsMask = this._connectivityDirtyRegionsMask;
  for (let region = 0; region < this._numRegions; region++) {
    const fixedCount = fixedCounts[region];
    if (fixedCount && fixedCount < regionSize) bottleneckRegionsMask |= 1 << region;
  }
  if (!this._enforceFixedComponentBottlenecks(grid, shardMasks, bottleneckRegionsMask)) return false;

  for (let root = 0; root < numGridCells; root++) {
    if (!shardSizes[root] || shardMasks[root] === grid[regionCellOffset + root]) continue;
    if (!this._restrictRegionShard(grid, root, shardMasks[root], handlerAccumulator)) {
      return false;
    }
  }

  return true;
};

const updateFixedRegionShardsSkipKnownMerges = function (grid) {
  const noCell = ChaosConstruction._NO_CELL;
  const neighbors = this._neighbors;
  const regionCellOffset = this._regionCellOffset;
  const shardOffset = this._regionShardOffset;

  for (let cell = 0; cell < this._numGridCells; cell++) {
    const regionMask = grid[regionCellOffset + cell];
    if (!regionMask || (regionMask & (regionMask - 1))) continue;

    const neighborOffset = cell << 2;
    const right = neighbors[neighborOffset + 1];
    if (right !== noCell
      && grid[regionCellOffset + right] === regionMask
      && grid[shardOffset + cell] !== grid[shardOffset + right]) {
      this._mergeRegionShards(grid, cell, right);
    }
    const down = neighbors[neighborOffset + 3];
    if (down !== noCell
      && grid[regionCellOffset + down] === regionMask
      && grid[shardOffset + cell] !== grid[shardOffset + down]) {
      this._mergeRegionShards(grid, cell, down);
    }
  }
};

const restrictDeferredShardMask = (masks, root, mask) => {
  const newMask = masks[root] & mask;
  if (!newMask) return false;
  masks[root] = newMask;
  return true;
};

const traverseFixedRegionShardComponentDeferred = function (
  grid, effectiveMasks, regionBit, fixedSize, startRoot, visitId, useDistancePruning) {
  const noCell = ChaosConstruction._NO_CELL;
  const neighbors = this._neighbors;
  const shardOffset = this._regionShardOffset;
  const stack = this._componentStack;
  const visitMarks = this._visitMarks;
  const rootsByDistance = this._rootScratch;
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

          const neighborRegionMask = effectiveMasks[neighborRoot];
          if (!(neighborRegionMask & regionBit)) continue;

          let neighborDistance = rootDistance;
          const isFixedRoot = neighborRegionMask === regionBit;
          if (!isFixedRoot) {
            const neighborSize = shardSizes[neighborRoot];
            neighborDistance = useDistancePruning ? rootDistance + neighborSize : 0;
            if (neighborSize > maxExtraSize
              || (useDistancePruning && neighborDistance > maxExtraSize)) {
              if (!restrictDeferredShardMask(effectiveMasks, neighborRoot, ~regionBit)) return 0;
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
};

const collectRegionShardComponentDeferred = function (grid, effectiveMasks, startRoot, regionBit, visitId) {
  const noCell = ChaosConstruction._NO_CELL;
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

  for (let componentIndex = 0; componentIndex < stackSize; componentIndex++) {
    const root = stack[componentIndex];
    for (let cell = root; cell !== noCell; cell = nextCells[cell]) {
      const neighborOffset = cell << 2;
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighbors[neighborOffset + dir];
        if (neighbor === noCell) continue;

        const neighborRoot = grid[shardOffset + neighbor];
        if (visitMarks[neighborRoot] === visitId) continue;
        if (!(effectiveMasks[neighborRoot] & regionBit)) continue;

        visitMarks[neighborRoot] = visitId;
        componentSize += shardSizes[neighborRoot];
        stack[stackSize++] = neighborRoot;
      }
    }
  }

  this._componentStackSize = stackSize;
  return componentSize;
};

const enforceConnectivityDeferredRegionMasks = function (
  grid, handlerAccumulator, useDistancePruning = true) {
  const numGridCells = this._numGridCells;
  const regionCellOffset = this._regionCellOffset;
  const stack = this._componentStack;
  const shardSizes = this._regionShardSizes;
  const effectiveMasks = this._deferredConnectivityShardMasks ??= new Uint16Array(numGridCells);
  const shardFixedValueMasks = this._regionShardFixedValueMasks;
  const fixedValueMasks = this._fixedValueMasks;
  const visitMarks = this._visitMarks;
  const regionSize = this._regionSize;
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  effectiveMasks.set(grid.subarray(regionCellOffset, regionCellOffset + numGridCells));

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    if (!(dirtyRegionsMask & regionBit)) continue;

    const visitId = this._nextVisitId();
    let fixedSize = 0;
    let fixedRoot = ChaosConstruction._NO_CELL;
    for (let root = 0; root < numGridCells; root++) {
      if (!shardSizes[root] || effectiveMasks[root] !== regionBit) continue;
      if (fixedRoot === ChaosConstruction._NO_CELL) fixedRoot = root;
      fixedSize += shardSizes[root];
      if (fixedSize > regionSize) return false;
    }

    if (fixedSize) {
      const componentSize = traverseFixedRegionShardComponentDeferred.call(
        this, grid, effectiveMasks, regionBit, fixedSize, fixedRoot,
        visitId, useDistancePruning);
      if (!componentSize || componentSize < regionSize) return false;
      const componentRootCount = this._componentStackSize;
      const fixedValueMask = fixedValueMasks[region];
      let remainingComponentSize = componentSize;

      for (let root = 0; root < numGridCells; root++) {
        if (!shardSizes[root] || !(effectiveMasks[root] & regionBit)) continue;
        if (visitMarks[root] !== visitId
          && !restrictDeferredShardMask(effectiveMasks, root, ~regionBit)) return false;
      }

      if (remainingComponentSize > regionSize) {
        remainingComponentSize = this._pruneConnectivityValueConflicts(
          effectiveMasks, regionBit, componentRootCount, componentSize, fixedSize, fixedValueMask);
        if (remainingComponentSize < 0) return false;
      }

      if (remainingComponentSize < regionSize) return false;
      if (remainingComponentSize === regionSize) {
        for (let i = 0; i < componentRootCount; i++) {
          const root = stack[i];
          if (!(effectiveMasks[root] & regionBit)) continue;
          if (!restrictDeferredShardMask(effectiveMasks, root, regionBit)) return false;
        }
      }
    } else {
      let hasViableComponent = false;

      for (let startRoot = 0; startRoot < numGridCells; startRoot++) {
        if (!shardSizes[startRoot]) continue;
        if (!(effectiveMasks[startRoot] & regionBit)) continue;
        if (visitMarks[startRoot] === visitId) continue;

        const componentSize = collectRegionShardComponentDeferred.call(
          this, grid, effectiveMasks, startRoot, regionBit, visitId);
        const componentRootCount = this._componentStackSize;

        if (componentSize >= regionSize) {
          const remainingComponentSize = this._pruneConnectivityValueConflicts(
            effectiveMasks, regionBit, componentRootCount, componentSize, 0, 0);
          if (remainingComponentSize < 0) return false;

          if (remainingComponentSize >= regionSize) {
            hasViableComponent = true;
          } else {
            for (let i = 0; i < componentRootCount; i++) {
              const root = stack[i];
              if (!(effectiveMasks[root] & regionBit)) continue;
              if (!restrictDeferredShardMask(effectiveMasks, root, ~regionBit)) return false;
            }
          }
        } else {
          for (let i = 0; i < componentRootCount; i++) {
            if (!restrictDeferredShardMask(effectiveMasks, stack[i], ~regionBit)) return false;
          }
        }
      }

      if (!hasViableComponent) return false;
    }
  }

  for (let root = 0; root < numGridCells; root++) {
    if (!shardSizes[root] || effectiveMasks[root] === grid[regionCellOffset + root]) continue;
    if (!this._restrictRegionShard(grid, root, effectiveMasks[root], handlerAccumulator)) return false;
  }

  return true;
};

const enforceConnectivityFixedRegionsOnly = function (grid, handlerAccumulator) {
  const dirtyRegionsMask = this._connectivityDirtyRegionsMask;
  if (!dirtyRegionsMask) return true;

  const shardSizes = this._regionShardSizes;
  const regionCellOffset = this._regionCellOffset;
  let fixedDirtyRegionsMask = 0;
  for (let root = 0; root < this._numGridCells; root++) {
    const regionMask = grid[regionCellOffset + root];
    if (!shardSizes[root] || (regionMask & (regionMask - 1))) continue;
    fixedDirtyRegionsMask |= regionMask & dirtyRegionsMask;
  }
  if (!fixedDirtyRegionsMask) return true;

  this._connectivityDirtyRegionsMask = fixedDirtyRegionsMask;
  const result = originalMethods._enforceConnectivity.call(this, grid, handlerAccumulator);
  this._connectivityDirtyRegionsMask = dirtyRegionsMask;
  return result;
};

const enforceRegionSizeShardCompletePruning = function (grid, handlerAccumulator) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const regionSize = this._regionSize;
  let fullRegionsMask = 0;

  for (let region = 0; region < this._numRegions; region++) {
    const fixedCount = fixedCounts[region];
    const possibleCount = possibleCounts[region];
    if (fixedCount > regionSize || fixedCount + possibleCount < regionSize) return false;
    if (fixedCount === regionSize && possibleCount) {
      fullRegionsMask |= 1 << region;
    }
  }
  if (fullRegionsMask) {
    const shardSizes = this._regionShardSizes;
    const regionCellOffset = this._regionCellOffset;
    const keepMask = ~fullRegionsMask;
    const numGridCells = this._numGridCells;
    for (let root = 0; root < numGridCells; root++) {
      if (!shardSizes[root]) continue;
      const values = grid[regionCellOffset + root];
      if ((values & fullRegionsMask) && (values & (values - 1))) {
        if (!this._restrictRegionShard(grid, root, keepMask, handlerAccumulator)) {
          return false;
        }
      }
    }
  }

  return true;
};

const enforceRegionValuePairScanMasks = function () {
  const possibleValueMasks = this._possibleValueMasks;
  const allValues = this._allValues;

  for (let region = 0; region < this._numRegions; region++) {
    if (possibleValueMasks[region] !== allValues) return false;
  }

  return true;
};

const restrictCell = function (grid, cell, allowedMask, handlerAccumulator) {
  const restrictedMask = grid[cell] & allowedMask;
  if (!restrictedMask) return false;
  if (restrictedMask !== grid[cell]) {
    grid[cell] = restrictedMask;
    this._changed = true;
    handlerAccumulator.addForCell(cell);
  }
  return true;
};

const originalInitialize = ChaosConstruction.prototype.initialize;
const initializeWithRegionCells = function (...args) {
  const result = originalInitialize.call(this, ...args);
  if (result) {
    this._regionCells = Uint16Array.from(
      { length: this._numGridCells }, (_, cell) => this._regionCellOffset + cell);
  }
  return result;
};

const originalMethods = {
  initialize: initializeWithRegionCells,
  selectPriorityAnchorCells: ChaosConstruction.prototype.selectPriorityAnchorCells,
  _updateFixedRegionShards: ChaosConstruction.prototype._updateFixedRegionShards,
  _scanRegionCandidates: ChaosConstruction.prototype._scanRegionCandidates,
  _enforceCanonicalOrder: ChaosConstruction.prototype._enforceCanonicalOrder,
  _enforceRegionSizes: enforceRegionSizeShardCompletePruning,
  _enforceConnectivity: ChaosConstruction.prototype._enforceConnectivity,
  _enforceRegionValuePairs: enforceRegionValuePairScanMasks,
  priority: ChaosConstruction.prototype.priority,
  _restrictCell: restrictCell,
  enforceConsistency: ChaosConstruction.prototype.enforceConsistency,
};

const originalConstraintHandlers = SudokuBuilder._constraintHandlers;
const originalOptimizerMethods = {
  _addChaosFixedValueRegionExclusions: SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions,
};
const originalCandidateSelectorMethods = {
  _selectBestCell: CandidateSelector.prototype._selectBestCell,
  _findCustomCandidates: CandidateSelector.prototype._findCustomCandidates,
};

const restoreChaosPrototype = () => {
  Object.assign(ChaosConstruction.prototype, originalMethods);
  Object.assign(SudokuConstraintOptimizer.prototype, originalOptimizerMethods);
  Object.assign(CandidateSelector.prototype, originalCandidateSelectorMethods);
  delete ChaosConstruction.prototype.addRegionCountLines;
  delete ChaosConstruction.prototype._enforceRegionCountLines;
  delete ChaosConstruction.prototype.addShardRelationLines;
  delete ChaosConstruction.prototype._enforceShardRelations;
  delete ChaosConstruction.prototype._shardRelationProbeControls;
  delete ChaosConstruction.prototype._shardRelationApplyModel;
  delete ChaosConstruction.prototype._shardRelationMinPrefix;
  delete ChaosConstruction.prototype._shardRelationSupportMinPrefix;
  delete ChaosConstruction.prototype._shardRelationBasicModel;
  delete ChaosConstruction.prototype._shardRelationSameOnly;
  delete ChaosConstruction.prototype._shardRelationValueApart;
  delete ChaosConstruction.prototype._shardRelationCapacityModel;
  delete ChaosConstruction.prototype._shardRelationProbeLocalPrefix;
  delete ChaosConstruction.prototype._shardRelationProbeSparseBasic;
  delete ChaosConstruction.prototype._shardRelationProbeMaxValues;
  delete ChaosConstruction.prototype._shardRelationAlsoRegionRuns;
  delete ChaosConstruction.prototype._shardRelationProbeRequiresOverlap;
  delete ChaosConstruction.prototype._shardRelationProbeSparseNoCapacity;
  delete ChaosConstruction.prototype._shardRelationProbePooledNoCapacity;
  delete ChaosConstruction.prototype._shardRelationProbePooledNoCapacityBase;
  delete ChaosConstruction.prototype._shardRelationProbePooledNoCapacityBaseSkipFixed;
  delete ChaosConstruction.prototype._enforceShardRegionInvariants;
  delete ChaosConstruction.prototype._shardRegionInvariantFixedValuesEnabled;
  delete ChaosConstruction.prototype._shardRegionInvariantCapacityEnabled;
  delete ChaosConstruction.prototype._shardRegionInvariantConnectivityEnabled;
  delete ChaosConstruction.prototype._shardRegionInvariantRoots;
  delete ChaosConstruction.prototype._shardRegionInvariantRootCount;
  delete ChaosConstruction.prototype._shardRegionInvariantRootOfCell;
  delete ChaosConstruction.prototype._shardRegionInvariantSizes;
  delete ChaosConstruction.prototype._shardRegionInvariantMasks;
  delete ChaosConstruction.prototype._shardRegionInvariantValueMasks;
  delete ChaosConstruction.prototype._shardRegionInvariantFixedValueMasks;
  delete ChaosConstruction.prototype._shardRegionInvariantFixedWeights;
  delete ChaosConstruction.prototype._shardRegionInvariantPossibleWeights;
  delete ChaosConstruction.prototype._shardRegionInvariantFixedValues;
  delete ChaosConstruction.prototype._shardRegionInvariantVisitMarks;
  delete ChaosConstruction.prototype._shardRegionInvariantVisitId;
  delete ChaosConstruction.prototype._shardRegionInvariantQueue;
  delete ChaosConstruction.prototype._shardRegionInvariantComponentRoots;
  delete ChaosConstruction.prototype._regionRunControlOnly;
  delete ChaosConstruction.prototype._regionRunFixedOnly;
  delete ChaosConstruction.prototype._incrementalHallMaxSubsetSize;
  delete ChaosConstruction.prototype._incrementalValueDirtyAllValues;
  SudokuBuilder._constraintHandlers = originalConstraintHandlers;
};

const defaultAnchorCoords = (shape) => [
  [0, 0],
  [Math.min(1, shape.numRows - 1), shape.numCols - 1],
  [shape.numRows - 1, Math.min(1, shape.numCols - 1)],
];

const ANCHOR_TRANSFORMS = {
  identity: (row, col, shape) => [row, col],
  rot90: (row, col, shape) => [col, shape.numRows - 1 - row],
  rot180: (row, col, shape) => [shape.numRows - 1 - row, shape.numCols - 1 - col],
  rot270: (row, col, shape) => [shape.numCols - 1 - col, row],
  reflectRows: (row, col, shape) => [shape.numRows - 1 - row, col],
  reflectCols: (row, col, shape) => [row, shape.numCols - 1 - col],
  transpose: (row, col, shape) => [col, row],
  antiTranspose: (row, col, shape) => [shape.numCols - 1 - col, shape.numRows - 1 - row],
};

const anchorCellsFromCoords = (coords, shape) => {
  const cells = [];
  const seen = new Set();
  for (const [row, col] of coords) {
    if (row < 0 || row >= shape.numRows || col < 0 || col >= shape.numCols) continue;
    const cell = shape.cellIndex(row, col);
    if (seen.has(cell)) continue;
    seen.add(cell);
    cells.push(cell);
  }
  return cells;
};

const anchorDistance = (shape, cellA, cellB) => {
  const [rowA, colA] = shape.splitCellIndex(cellA);
  const [rowB, colB] = shape.splitCellIndex(cellB);
  return Math.abs(rowA - rowB) + Math.abs(colA - colB);
};

const anchorsAreSeparated = (shape, cells) => {
  for (let i = 1; i < cells.length; i++) {
    for (let j = 0; j < i; j++) {
      if (anchorDistance(shape, cells[i], cells[j]) < shape.numValues) return false;
    }
  }
  return true;
};

const isEdgeCell = (shape, cell) => {
  const [row, col] = shape.splitCellIndex(cell);
  return row === 0 || col === 0 || row + 1 === shape.numRows || col + 1 === shape.numCols;
};

const edgeAnchorCount = (shape, cells) => {
  let count = 0;
  for (const cell of cells) {
    if (isEdgeCell(shape, cell)) count++;
  }
  return count;
};

const edgeCellsForShape = (shape) => {
  const edgeCells = [];
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    if (isEdgeCell(shape, cell)) edgeCells.push(cell);
  }
  return edgeCells;
};

const anchorCellsTieBreak = (cells, bestCells) => {
  if (bestCells == null) return true;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== bestCells[i]) return cells[i] < bestCells[i];
  }
  return false;
};

const addAnchorIfSeparated = (shape, anchors, cell) => {
  if (anchors.includes(cell)) return false;
  for (const anchor of anchors) {
    if (anchorDistance(shape, anchor, cell) < shape.numValues) return false;
  }
  anchors.push(cell);
  return true;
};

const transformedAnchorCells = (shape, transformName) => {
  const transform = ANCHOR_TRANSFORMS[transformName];
  return anchorCellsFromCoords(
    defaultAnchorCoords(shape).map(([row, col]) => transform(row, col, shape)), shape);
};

const completeAnchorSet = (shape, anchors) => {
  const result = [];
  const maxAnchors = Math.min(3, shape.numGridCells);
  for (const anchor of anchors) {
    if (result.length >= maxAnchors) break;
    addAnchorIfSeparated(shape, result, anchor);
  }
  for (const anchor of transformedAnchorCells(shape, 'identity')) {
    if (result.length >= maxAnchors) break;
    addAnchorIfSeparated(shape, result, anchor);
  }
  for (let cell = 0; cell < shape.numGridCells && result.length < maxAnchors; cell++) {
    addAnchorIfSeparated(shape, result, cell);
  }
  return result;
};

const initializeWithAnchorCells = function (
  initialGridCells, cellExclusions, shape, stateAllocator, anchorCells) {
  const scratchGridCells = initialGridCells.slice
    ? initialGridCells.slice()
    : Array.from(initialGridCells);
  if (!originalMethods.initialize.call(
    this, scratchGridCells, cellExclusions, shape, stateAllocator)) {
    return false;
  }

  const regionCellOffset = this._regionCellOffset;
  const initialMask = (1 << this._numRegions) - 1;
  for (let i = 0; i < this._numGridCells; i++) {
    if (!(initialGridCells[regionCellOffset + i] &= initialMask)) return false;
  }

  let numAnchors = 0;
  const seen = new Set();
  for (const cell of anchorCells) {
    if (numAnchors >= this._numRegions || seen.has(cell)) continue;
    if (cell < 0 || cell >= this._numGridCells) continue;
    seen.add(cell);
    if (!(initialGridCells[regionCellOffset + cell] &= (1 << numAnchors++))) return false;
  }
  this._canonicalSeedMask = (1 << numAnchors) - 1;
  return true;
};

const installAnchorSelector = (anchorSelector) => {
  ChaosConstruction.prototype.initialize = function (
    initialGridCells, cellExclusions, shape, stateAllocator) {
    return initializeWithAnchorCells.call(
      this, initialGridCells, cellExclusions, shape, stateAllocator, anchorSelector(shape));
  };
  ChaosConstruction.prototype.selectPriorityAnchorCells = function () {
    return true;
  };
};

const initializedCellPriorities = (constraintMap, shape) => {
  const activeConstraintHandlers = SudokuBuilder._constraintHandlers;
  SudokuBuilder._constraintHandlers = originalConstraintHandlers;
  try {
    const solver = new SudokuSolver(SudokuBuilder._handlers(constraintMap, shape), shape);
    return solver._internalSolver._cellPriorities;
  } finally {
    SudokuBuilder._constraintHandlers = activeConstraintHandlers;
  }
};

const priorityAnchorScores = (
  priorities, chaosHandler, shape, gridWeight = 1, regionWeight = 1) => {
  const scores = new Int32Array(shape.numGridCells);
  const regionCellOffset = chaosHandler?._regionCellOffset;
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    const regionCell = regionCellOffset == null ? cell : regionCellOffset + cell;
    scores[cell] = gridWeight * priorities[cell]
      + regionWeight * priorities[regionCell];
  }
  return scores;
};

const chooseBestScoredSymmetryAnchors = (shape, scores) => {
  const defaultCells = transformedAnchorCells(shape, 'identity');
  let bestCells = defaultCells;
  let bestScore = -1;
  for (const transformName of Object.keys(ANCHOR_TRANSFORMS)) {
    const cells = transformedAnchorCells(shape, transformName);
    if (cells.length !== defaultCells.length) continue;
    if (!anchorsAreSeparated(shape, cells)) continue;
    const score = cells.reduce((sum, cell) => sum + scores[cell], 0);
    if (score > bestScore) {
      bestScore = score;
      bestCells = cells;
    }
  }
  return bestCells;
};

const chooseBestScoredSeparatedTriple = (
  shape, scores, earlyWeight = 0, fixedFirstCell = null, minEdgeAnchors = 0) => {
  const maxAnchors = Math.min(3, shape.numGridCells);
  if (maxAnchors < 3) return completeAnchorSet(shape, []);

  let bestCells = null;
  let bestScore = -Infinity;

  const considerCells = (cells) => {
    const sortedCells = [...cells].sort((x, y) => x - y);
    if (sortedCells[0] === sortedCells[1] || sortedCells[1] === sortedCells[2]) return;
    if (!anchorsAreSeparated(shape, sortedCells)) return;
    const priorityScore = scores[sortedCells[0]] + scores[sortedCells[1]] + scores[sortedCells[2]];
    if (!priorityScore) return;
    const scanPenalty = sortedCells[0] * 4 + sortedCells[1] + sortedCells[2];
    const score = priorityScore * 1024 - scanPenalty * earlyWeight;
    if (score > bestScore
      || (score === bestScore && anchorCellsTieBreak(sortedCells, bestCells))) {
      bestScore = score;
      bestCells = sortedCells;
    }
  };

  const edgeCells = edgeCellsForShape(shape);
  const considerAnyThirdWithEdgePair = () => {
    for (let edgeIndexA = 0; edgeIndexA < edgeCells.length - 1; edgeIndexA++) {
      const edgeA = edgeCells[edgeIndexA];
      for (let edgeIndexB = edgeIndexA + 1; edgeIndexB < edgeCells.length; edgeIndexB++) {
        const edgeB = edgeCells[edgeIndexB];
        for (let cell = 0; cell < shape.numGridCells; cell++) {
          if (cell === edgeA || cell === edgeB) continue;
          considerCells([edgeA, edgeB, cell]);
        }
      }
    }
  };

  const considerEdgePairWithFixedFirst = () => {
    for (let edgeIndexA = 0; edgeIndexA < edgeCells.length - 1; edgeIndexA++) {
      const edgeA = edgeCells[edgeIndexA];
      if (edgeA === fixedFirstCell) continue;
      for (let edgeIndexB = edgeIndexA + 1; edgeIndexB < edgeCells.length; edgeIndexB++) {
        const edgeB = edgeCells[edgeIndexB];
        if (edgeB !== fixedFirstCell) considerCells([fixedFirstCell, edgeA, edgeB]);
      }
    }
  };

  if (fixedFirstCell != null) {
    const fixedEdgeCount = isEdgeCell(shape, fixedFirstCell) ? 1 : 0;
    const requiredEdges = Math.max(0, minEdgeAnchors - fixedEdgeCount);
    if (requiredEdges <= 0) {
      for (let b = 0; b < shape.numGridCells - 1; b++) {
        if (b === fixedFirstCell) continue;
        for (let c = b + 1; c < shape.numGridCells; c++) {
          if (c !== fixedFirstCell) considerCells([fixedFirstCell, b, c]);
        }
      }
    } else if (requiredEdges === 1) {
      for (const edgeCell of edgeCells) {
        if (edgeCell === fixedFirstCell) continue;
        for (let cell = 0; cell < shape.numGridCells; cell++) {
          if (cell !== fixedFirstCell && cell !== edgeCell) {
            considerCells([fixedFirstCell, edgeCell, cell]);
          }
        }
      }
    } else if (requiredEdges === 2) {
      considerEdgePairWithFixedFirst();
    }
  } else if (minEdgeAnchors <= 0) {
    for (let a = 0; a < shape.numGridCells - 2; a++) {
      for (let b = a + 1; b < shape.numGridCells - 1; b++) {
        for (let c = b + 1; c < shape.numGridCells; c++) {
          considerCells([a, b, c]);
        }
      }
    }
  } else if (minEdgeAnchors === 1) {
    for (const edgeCell of edgeCells) {
      for (let b = 0; b < shape.numGridCells - 1; b++) {
        if (b === edgeCell) continue;
        for (let c = b + 1; c < shape.numGridCells; c++) {
          if (c !== edgeCell) considerCells([edgeCell, b, c]);
        }
      }
    }
  } else if (minEdgeAnchors === 2) {
    considerAnyThirdWithEdgePair();
  } else {
    for (let edgeIndexA = 0; edgeIndexA < edgeCells.length - 2; edgeIndexA++) {
      for (let edgeIndexB = edgeIndexA + 1; edgeIndexB < edgeCells.length - 1; edgeIndexB++) {
        for (let edgeIndexC = edgeIndexB + 1; edgeIndexC < edgeCells.length; edgeIndexC++) {
          considerCells([edgeCells[edgeIndexA], edgeCells[edgeIndexB], edgeCells[edgeIndexC]]);
        }
      }
    }
  }

  return completeAnchorSet(shape, bestCells || []);
};

const cellsByScore = (shape, scores, cells = null) => {
  const result = cells ? [...cells] : Array.from({ length: shape.numGridCells }, (_, i) => i);
  result.sort((a, b) => scores[b] - scores[a] || a - b);
  return result;
};

const chooseGreedyScoredAnchors = (shape, scores, minEdgeAnchors = 2) => {
  const anchors = [];
  const rankedEdges = cellsByScore(shape, scores, edgeCellsForShape(shape));
  const rankedCells = cellsByScore(shape, scores);

  for (const cell of rankedEdges) {
    if (edgeAnchorCount(shape, anchors) >= minEdgeAnchors) break;
    addAnchorIfSeparated(shape, anchors, cell);
  }

  for (const cell of rankedCells) {
    if (anchors.length >= Math.min(3, shape.numGridCells)) break;
    addAnchorIfSeparated(shape, anchors, cell);
  }

  return completeAnchorSet(shape, anchors);
};

const chooseBestScoredEdgePairThenThird = (shape, scores) => {
  const edgeCells = edgeCellsForShape(shape);
  let bestPair = null;
  let bestPairScore = -Infinity;

  for (let edgeIndexA = 0; edgeIndexA < edgeCells.length - 1; edgeIndexA++) {
    const edgeA = edgeCells[edgeIndexA];
    for (let edgeIndexB = edgeIndexA + 1; edgeIndexB < edgeCells.length; edgeIndexB++) {
      const edgeB = edgeCells[edgeIndexB];
      if (anchorDistance(shape, edgeA, edgeB) < shape.numValues) continue;
      const pair = [edgeA, edgeB];
      const pairScore = scores[edgeA] + scores[edgeB];
      if (pairScore > bestPairScore
        || (pairScore === bestPairScore && anchorCellsTieBreak(pair, bestPair))) {
        bestPairScore = pairScore;
        bestPair = pair;
      }
    }
  }

  if (!bestPair) return completeAnchorSet(shape, []);

  let bestThird = -1;
  let bestThirdScore = -Infinity;
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    if (cell === bestPair[0] || cell === bestPair[1]) continue;
    if (anchorDistance(shape, cell, bestPair[0]) < shape.numValues
      || anchorDistance(shape, cell, bestPair[1]) < shape.numValues) continue;
    if (scores[cell] > bestThirdScore || (scores[cell] === bestThirdScore && cell < bestThird)) {
      bestThirdScore = scores[cell];
      bestThird = cell;
    }
  }

  return completeAnchorSet(shape, bestThird >= 0 ? [...bestPair, bestThird].sort((a, b) => a - b) : bestPair);
};

const chooseBestFirstEdgePairAnchors = (shape, scores, minEdgeAnchors = 2) => {
  const maxAnchors = Math.min(3, shape.numGridCells);
  for (const cell of cellsByScore(shape, scores)) {
    const anchors = chooseBestScoredSeparatedTriple(shape, scores, 0, cell, minEdgeAnchors);
    if (anchors.length === maxAnchors && anchors.includes(cell)) return anchors;
  }
  return completeAnchorSet(shape, []);
};

const chooseTopKScoredSeparatedTriple = (shape, scores, k, minEdgeAnchors = 2) => {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (cell) => {
    if (seen.has(cell)) return;
    seen.add(cell);
    candidates.push(cell);
  };
  for (const cell of cellsByScore(shape, scores).slice(0, k)) addCandidate(cell);
  for (const cell of cellsByScore(shape, scores, edgeCellsForShape(shape)).slice(0, k)) addCandidate(cell);

  let bestCells = null;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length - 2; i++) {
    for (let j = i + 1; j < candidates.length - 1; j++) {
      for (let kIndex = j + 1; kIndex < candidates.length; kIndex++) {
        const cells = [candidates[i], candidates[j], candidates[kIndex]].sort((a, b) => a - b);
        if (!anchorsAreSeparated(shape, cells)) continue;
        if (edgeAnchorCount(shape, cells) < minEdgeAnchors) continue;
        const score = scores[cells[0]] + scores[cells[1]] + scores[cells[2]];
        if (score > bestScore
          || (score === bestScore && anchorCellsTieBreak(cells, bestCells))) {
          bestScore = score;
          bestCells = cells;
        }
      }
    }
  }

  return completeAnchorSet(shape, bestCells || []);
};

const localAnchorCandidates = (shape, baseCell, radius) => {
  const candidates = [];
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    if (anchorDistance(shape, baseCell, cell) <= radius) candidates.push(cell);
  }
  return candidates;
};

const chooseBestLocalScoredAnchors = (shape, scores, radius, minEdgeAnchors = 0) => {
  const defaultCells = transformedAnchorCells(shape, 'identity');
  let bestCells = null;
  let bestScore = -Infinity;
  for (const transformName of Object.keys(ANCHOR_TRANSFORMS)) {
    const baseCells = transformedAnchorCells(shape, transformName);
    if (baseCells.length !== defaultCells.length) continue;
    const candidateLists = baseCells.map(cell => localAnchorCandidates(shape, cell, radius));
    for (const cell0 of candidateLists[0]) {
      for (const cell1 of candidateLists[1]) {
        if (cell1 === cell0) continue;
        for (const cell2 of candidateLists[2]) {
          const cells = [cell0, cell1, cell2];
          if (cell2 === cell0 || cell2 === cell1) continue;
          if (!anchorsAreSeparated(shape, cells)) continue;
          if (edgeAnchorCount(shape, cells) < minEdgeAnchors) continue;
          const drift = anchorDistance(shape, cell0, baseCells[0])
            + anchorDistance(shape, cell1, baseCells[1])
            + anchorDistance(shape, cell2, baseCells[2]);
          const priorityScore = scores[cell0] + scores[cell1] + scores[cell2];
          const score = priorityScore * 1024 - drift;
          if (score > bestScore) {
            bestScore = score;
            bestCells = cells;
          }
        }
      }
    }
  }
  return completeAnchorSet(shape, bestCells || defaultCells);
};

const installPriorityAwareAnchors = (anchorSelector, gridWeight = 1, regionWeight = 1) => {
  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    const handlers = [...originalConstraintHandlers.call(this, constraintMap, shape)];
    const chaosHandler = handlers.find(handler => handler.constructor === ChaosConstruction);
    const priorities = initializedCellPriorities(constraintMap, shape);
    const scores = priorityAnchorScores(
      priorities, chaosHandler, shape, gridWeight, regionWeight);
    const anchorCells = anchorSelector(shape, scores);
    for (const handler of handlers) {
      if (handler.constructor === ChaosConstruction) handler._anchorCellsOverride = anchorCells;
      yield handler;
    }
  };

  ChaosConstruction.prototype.initialize = function (
    initialGridCells, cellExclusions, shape, stateAllocator) {
    const anchorCells = this._anchorCellsOverride || transformedAnchorCells(shape, 'identity');
    return initializeWithAnchorCells.call(
      this, initialGridCells, cellExclusions, shape, stateAllocator, anchorCells);
  };
  ChaosConstruction.prototype.selectPriorityAnchorCells = function () {
    return true;
  };
};

const fixedValueRegionCells = (handlerSet, shape) => {
  if (handlerSet.getAllofType(ChaosConstruction).length === 0) return null;

  const regionCells = shape.varCellsForGroup('CC');
  if (!regionCells || regionCells.length !== shape.numGridCells) return null;

  return {
    gridCells: Uint8Array.from({ length: shape.numGridCells }, (_, i) => i),
    regionCellArray: new Uint8Array(regionCells),
    regionCellOffset: regionCells[0],
  };
};

const installWithoutFixedValueRegionSingletonHandlers = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function () { };
};

const addRegionCountLines = function (lines) {
  this._regionCountLines ??= [];
  for (const line of lines) {
    if (line.length > 2) this._regionCountLines.push(Uint16Array.from(line));
  }
};

const runLengthHasSupport = function (grid, line, count) {
  if (count < 1 || count >= line.length) return 0;

  const regionCellOffset = this._regionCellOffset;
  let regionMask = this._regionMask;
  for (let i = 1; i <= count; i++) {
    regionMask &= grid[regionCellOffset + line[i]];
  }
  if (!regionMask) return 0;

  if (count + 1 < line.length) {
    const breakMask = grid[regionCellOffset + line[count + 1]];
    if (!(breakMask & (breakMask - 1))) regionMask &= ~breakMask;
  }

  return regionMask;
};

const enforceRegionCountLines = function (grid, handlerAccumulator) {
  const lines = this._regionCountLines;
  if (!lines || lines.length === 0) return true;

  const regionCellOffset = this._regionCellOffset;
  for (const line of lines) {
    const controlCell = line[0];
    const controlValues = grid[controlCell];
    let supportedControlValues = 0;

    let candidateValues = controlValues;
    while (candidateValues) {
      const valueBit = candidateValues & -candidateValues;
      candidateValues ^= valueBit;
      if (runLengthHasSupport.call(this, grid, line, LookupTables.toValue(valueBit))) {
        supportedControlValues |= valueBit;
      }
    }

    if (!supportedControlValues) return false;
    if (!this._restrictCell(grid, controlCell, supportedControlValues, handlerAccumulator)) {
      return false;
    }

    if (this._regionRunControlOnly) continue;

    const controlIsFixed = !(supportedControlValues & (supportedControlValues - 1));
    if (this._regionRunFixedOnly && !controlIsFixed) continue;

    const requiredCount = controlIsFixed
      ? LookupTables.toValue(supportedControlValues)
      : LookupTables.minValue(supportedControlValues);
    let regionMask = this._regionMask;
    for (let i = 1; i <= requiredCount; i++) {
      regionMask &= grid[regionCellOffset + line[i]];
    }
    if (!regionMask) return false;

    if (controlIsFixed && requiredCount + 1 < line.length) {
      const breakRegionCell = regionCellOffset + line[requiredCount + 1];
      const breakMask = grid[breakRegionCell];
      if (!(breakMask & (breakMask - 1))) regionMask &= ~breakMask;
      if (!regionMask) return false;
      if (!(regionMask & (regionMask - 1))
        && !this._restrictCell(grid, breakRegionCell, ~regionMask, handlerAccumulator)) {
        return false;
      }
    }

    for (let i = 1; i <= requiredCount; i++) {
      if (!this._restrictCell(grid, regionCellOffset + line[i], regionMask, handlerAccumulator)) {
        return false;
      }
    }
  }

  return true;
};

const enforceConsistencyNfaRegionRuns = function (grid, handlerAccumulator) {
  this._connectivityDirtyRegionsMask = 0;
  this._changed = false;

  if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;
  if (!this._enforceRegionShards(grid, handlerAccumulator)) return false;
  if (!this._enforceRegionCountLines(grid, handlerAccumulator)) return false;
  if (!this._enforceRegionShards(grid, handlerAccumulator)) return false;

  if (!this._enforceRegionShardConsistency(grid, handlerAccumulator)) return false;

  this._changed = false;
  if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;

  this._connectivityDirtyRegionsMask = 0;
  return true;
};

const addChaosNfaRegionCountLines = function (handlerSet, shape) {
  const chaosHandlers = handlerSet.getAllofType(ChaosConstruction);
  if (chaosHandlers.length === 0) return;

  const regionCells = shape.varCellsForGroup('CC');
  const numGridCells = shape.numGridCells;
  if (!regionCells || regionCells.length !== numGridCells) return;

  const lines = [];
  for (const handler of handlerSet.getAllofType(ChaosArrow)) {
    for (const line of handler._regionRunArms) {
      lines.push([handler._controlCell, ...line]);
    }
  }

  if (lines.length === 0) return;
  for (const handler of chaosHandlers) handler.addRegionCountLines(lines);
};

const installNfaRegionRuns = ({ controlOnly = false, fixedOnly = false } = {}) => {
  ChaosConstruction.prototype.addRegionCountLines = addRegionCountLines;
  ChaosConstruction.prototype._enforceRegionCountLines = enforceRegionCountLines;
  ChaosConstruction.prototype.enforceConsistency = enforceConsistencyNfaRegionRuns;
  ChaosConstruction.prototype._regionRunControlOnly = controlOnly;
  ChaosConstruction.prototype._regionRunFixedOnly = fixedOnly;
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function (handlerSet, shape) {
    originalOptimizerMethods._addChaosFixedValueRegionExclusions.call(this, handlerSet, shape);
    addChaosNfaRegionCountLines.call(this, handlerSet, shape);
  };
};

const addShardRelationLines = function (lines) {
  this._shardRelationLines ??= [];
  for (const line of lines) {
    if (line.length > 2) this._shardRelationLines.push(Uint16Array.from(line));
  }
};

const addRunLineRelations = (line, count, addSame, addDifferent) => {
  if (count < 1 || count >= line.length) return false;

  const start = line[0];
  for (let i = 1; i <= count; i++) addSame(start, line[i]);
  if (count + 1 < line.length) addDifferent(start, line[count + 1]);
  return true;
};

const addRunLineSamePrefix = (line, count, addSame) => {
  if (count < 1 || count >= line.length) return false;

  const start = line[0];
  for (let i = 1; i <= count; i++) addSame(start, line[i]);
  return true;
};

const runPrefixHasValueSupport = function (grid, line, count, valueBit) {
  if (count < 1 || count >= line.length) return false;

  const regionCells = this._regionCells;
  const visitMarks = this._shardRelationVisitMarks ??= new Uint16Array(this._numGridCells);
  this._shardRelationVisitId = (this._shardRelationVisitId ?? 0) + 1;
  if (this._shardRelationVisitId === 65535) {
    visitMarks.fill(0);
    this._shardRelationVisitId = 1;
  }
  const visitId = this._shardRelationVisitId;
  let regionMask = this._regionMask;
  let fixedValueMask = 0;

  const addCell = (cell, cellValues) => {
    if (visitMarks[cell] === visitId) return true;
    visitMarks[cell] = visitId;
    regionMask &= grid[regionCells[cell]];
    if (!regionMask) return false;
    if (isFixed(cellValues)) {
      if (fixedValueMask & cellValues) return false;
      fixedValueMask |= cellValues;
    }
    return true;
  };

  if (!addCell(line[0], valueBit)) return false;
  for (let i = 1; i <= count; i++) {
    if (!addCell(line[i], grid[line[i]])) return false;
  }
  return true;
};

const sparseBasicShardRelationSupports = function (grid, extraLine, extraCount, extraValueBit) {
  const lines = this._shardRelationLines;
  if (!lines || lines.length === 0) return true;
  if (extraCount < 1 || extraCount >= extraLine.length) return false;

  const numGridCells = this._numGridCells;
  const regionCells = this._regionCells;
  const parents = new Int16Array(numGridCells);
  const componentSizes = new Uint16Array(numGridCells);
  const componentMasks = new Int32Array(numGridCells);
  const fixedValueMasks = new Uint16Array(numGridCells);
  parents.fill(-1);

  const activeCells = [];
  const ensureCell = (cell) => {
    if (parents[cell] >= 0) return;
    parents[cell] = cell;
    activeCells.push(cell);
  };
  const find = (cell) => {
    let root = cell;
    while (parents[root] !== root) root = parents[root];
    while (parents[cell] !== cell) {
      const parent = parents[cell];
      parents[cell] = root;
      cell = parent;
    }
    return root;
  };
  const addSame = (cellA, cellB) => {
    ensureCell(cellA);
    ensureCell(cellB);
    const rootA = find(cellA);
    const rootB = find(cellB);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  for (const line of lines) {
    const controlValues = grid[line[0]];
    if (!isFixed(controlValues)) continue;
    if (!addRunLineSamePrefix(line, LookupTables.toValue(controlValues), addSame)) return false;
  }
  if (!addRunLineSamePrefix(extraLine, extraCount, addSame)) return false;
  if (activeCells.length === 0) return true;

  for (const cell of activeCells) {
    const root = find(cell);
    componentSizes[root]++;
    componentMasks[root] = componentMasks[root]
      ? componentMasks[root] & grid[regionCells[cell]]
      : grid[regionCells[cell]];
    if (!componentMasks[root]) return false;
    if (componentSizes[root] > this._regionSize) return false;

    const cellValues = cell === extraLine[0] ? extraValueBit : grid[cell];
    if (isFixed(cellValues)) {
      if (fixedValueMasks[root] & cellValues) return false;
      fixedValueMasks[root] |= cellValues;
    }
  }

  return true;
};

const sparseNoCapacityShardRelationSupports = function (grid, extraLine, extraCount, extraValueBit) {
  const lines = this._shardRelationLines;
  if (!lines || lines.length === 0) return true;
  if (extraCount < 1 || extraCount >= extraLine.length) return false;

  const numGridCells = this._numGridCells;
  const regionCells = this._regionCells;
  const parents = new Int16Array(numGridCells);
  const componentSizes = new Uint16Array(numGridCells);
  const componentMasks = new Int32Array(numGridCells);
  const fixedValueMasks = new Uint16Array(numGridCells);
  const apartA = [];
  const apartB = [];
  parents.fill(-1);

  const activeCells = [];
  const ensureCell = (cell) => {
    if (parents[cell] >= 0) return;
    parents[cell] = cell;
    activeCells.push(cell);
  };
  const find = (cell) => {
    let root = cell;
    while (parents[root] !== root) root = parents[root];
    while (parents[cell] !== cell) {
      const parent = parents[cell];
      parents[cell] = root;
      cell = parent;
    }
    return root;
  };
  const addSame = (cellA, cellB) => {
    ensureCell(cellA);
    ensureCell(cellB);
    const rootA = find(cellA);
    const rootB = find(cellB);
    if (rootA !== rootB) parents[rootB] = rootA;
  };
  const addDifferent = (cellA, cellB) => {
    ensureCell(cellA);
    ensureCell(cellB);
    apartA.push(cellA);
    apartB.push(cellB);
  };

  for (const line of lines) {
    const controlValues = grid[line[0]];
    if (!isFixed(controlValues)) continue;
    if (!addRunLineRelations(line, LookupTables.toValue(controlValues), addSame, addDifferent)) return false;
  }
  if (!addRunLineRelations(extraLine, extraCount, addSame, addDifferent)) return false;
  if (activeCells.length === 0) return true;

  for (const cell of activeCells) {
    const root = find(cell);
    componentSizes[root]++;
    componentMasks[root] = componentMasks[root]
      ? componentMasks[root] & grid[regionCells[cell]]
      : grid[regionCells[cell]];
    if (!componentMasks[root]) return false;
    if (componentSizes[root] > this._regionSize) return false;

    const cellValues = cell === extraLine[0] ? extraValueBit : grid[cell];
    if (isFixed(cellValues)) {
      if (fixedValueMasks[root] & cellValues) return false;
      fixedValueMasks[root] |= cellValues;
    }
  }

  const roots = [];
  const firstRootByValue = new Int16Array(16);
  firstRootByValue.fill(-1);
  for (const cell of activeCells) {
    const root = find(cell);
    if (componentSizes[root] === 0) continue;
    roots.push(root);
    componentSizes[root] = 0;

    let values = fixedValueMasks[root];
    while (values) {
      const valueBit = values & -values;
      values ^= valueBit;
      const valueIndex = LookupTables.toIndex(valueBit);
      const firstRoot = firstRootByValue[valueIndex];
      if (firstRoot < 0) firstRootByValue[valueIndex] = root;
      else {
        apartA.push(firstRoot);
        apartB.push(root);
      }
    }
  }

  const enforceApartEdges = () => {
    let changed = false;
    for (let i = 0; i < apartA.length; i++) {
      const rootA = find(apartA[i]);
      const rootB = find(apartB[i]);
      if (rootA === rootB) return null;

      const maskA = componentMasks[rootA];
      const maskB = componentMasks[rootB];
      if (isFixed(maskA) && isFixed(maskB) && maskA === maskB) return null;
      if (isFixed(maskA) && (maskB & maskA)) {
        componentMasks[rootB] &= ~maskA;
        if (!componentMasks[rootB]) return null;
        changed = true;
      }
      if (isFixed(maskB) && (maskA & maskB)) {
        componentMasks[rootA] &= ~maskB;
        if (!componentMasks[rootA]) return null;
        changed = true;
      }
    }
    return changed;
  };

  const enforceExternalFixedValues = () => {
    let changed = false;
    for (const root of roots) {
      let values = fixedValueMasks[root];
      while (values) {
        const valueBit = values & -values;
        values ^= valueBit;
        for (let cell = 0; cell < numGridCells; cell++) {
          if (parents[cell] >= 0) continue;
          if (grid[cell] !== valueBit) continue;

          const externalMask = grid[regionCells[cell]];
          const mask = componentMasks[root];
          if (isFixed(mask) && isFixed(externalMask) && mask === externalMask) return null;
          if (isFixed(externalMask) && (mask & externalMask)) {
            componentMasks[root] &= ~externalMask;
            if (!componentMasks[root]) return null;
            changed = true;
          }
        }
      }
    }
    return changed;
  };

  let changed = true;
  while (changed) {
    changed = enforceApartEdges();
    if (changed === null) return false;
    const externalChanged = enforceExternalFixedValues();
    if (externalChanged === null) return false;
    changed ||= externalChanged;
  }

  return true;
};

const pooledNoCapacityShardRelationSupports = function (grid, extraLine, extraCount, extraValueBit) {
  const lines = this._shardRelationLines;
  if (!lines || lines.length === 0) return true;

  const numGridCells = this._numGridCells;
  const regionCells = this._regionCells;
  const parents = this._shardPooledParents ??= new Uint16Array(numGridCells);
  const componentSizes = this._shardPooledComponentSizes ??= new Uint16Array(numGridCells);
  const componentMasks = this._shardPooledComponentMasks ??= new Int32Array(numGridCells);
  const fixedValueMasks = this._shardPooledFixedValueMasks ??= new Uint16Array(numGridCells);
  const firstRootByValue = this._shardPooledFirstRootByValue ??= new Int16Array(16);
  const roots = this._shardPooledRoots ??= [];
  const apartA = this._shardPooledApartA ??= [];
  const apartB = this._shardPooledApartB ??= [];

  for (let cell = 0; cell < numGridCells; cell++) parents[cell] = cell;
  componentSizes.fill(0);
  fixedValueMasks.fill(0);
  firstRootByValue.fill(-1);
  roots.length = 0;
  apartA.length = 0;
  apartB.length = 0;
  let relationCount = 0;

  const find = (cell) => {
    let root = cell;
    while (parents[root] !== root) root = parents[root];
    while (parents[cell] !== cell) {
      const parent = parents[cell];
      parents[cell] = root;
      cell = parent;
    }
    return root;
  };
  const addSame = (cellA, cellB) => {
    const rootA = find(cellA);
    const rootB = find(cellB);
    if (rootA !== rootB) {
      parents[rootB] = rootA;
      relationCount++;
    }
  };
  const addDifferent = (cellA, cellB) => {
    apartA.push(cellA);
    apartB.push(cellB);
    relationCount++;
  };

  for (const line of lines) {
    const controlValues = grid[line[0]];
    if (!isFixed(controlValues)) continue;
    if (!addRunLineRelations(line, LookupTables.toValue(controlValues), addSame, addDifferent)) return false;
  }
  if (!addRunLineRelations(extraLine, extraCount, addSame, addDifferent)) return false;
  if (relationCount === 0) return true;

  for (let cell = 0; cell < numGridCells; cell++) {
    const root = find(cell);
    if (componentSizes[root] === 0) componentMasks[root] = this._regionMask;
    componentSizes[root]++;
    componentMasks[root] &= grid[regionCells[cell]];
    if (!componentMasks[root]) return false;

    const cellValues = cell === extraLine[0] ? extraValueBit : grid[cell];
    if (isFixed(cellValues)) {
      if (fixedValueMasks[root] & cellValues) return false;
      fixedValueMasks[root] |= cellValues;
    }
  }

  for (let root = 0; root < numGridCells; root++) {
    const componentSize = componentSizes[root];
    if (!componentSize) continue;
    if (componentSize > this._regionSize) return false;
    roots.push(root);

    let values = fixedValueMasks[root];
    while (values) {
      const valueBit = values & -values;
      values ^= valueBit;
      const valueIndex = LookupTables.toIndex(valueBit);
      const firstRoot = firstRootByValue[valueIndex];
      if (firstRoot < 0) firstRootByValue[valueIndex] = root;
      else {
        apartA.push(firstRoot);
        apartB.push(root);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < apartA.length; i++) {
      const rootA = find(apartA[i]);
      const rootB = find(apartB[i]);
      if (rootA === rootB) return false;

      const maskA = componentMasks[rootA];
      const maskB = componentMasks[rootB];
      if (isFixed(maskA) && isFixed(maskB) && maskA === maskB) return false;
      if (isFixed(maskA) && (maskB & maskA)) {
        componentMasks[rootB] &= ~maskA;
        if (!componentMasks[rootB]) return false;
        changed = true;
      }
      if (isFixed(maskB) && (maskA & maskB)) {
        componentMasks[rootA] &= ~maskB;
        if (!componentMasks[rootA]) return false;
        changed = true;
      }
    }
  }

  return true;
};

const buildPooledNoCapacityFixedBase = function (grid) {
  const lines = this._shardRelationLines;
  if (!lines || lines.length === 0) return true;

  const parents = this._shardPooledBaseParents ??= new Uint16Array(this._numGridCells);
  const apartA = this._shardPooledBaseApartA ??= [];
  const apartB = this._shardPooledBaseApartB ??= [];
  for (let cell = 0; cell < this._numGridCells; cell++) parents[cell] = cell;
  apartA.length = 0;
  apartB.length = 0;
  this._shardPooledBaseFixedLineCount = 0;

  const find = (cell) => {
    let root = cell;
    while (parents[root] !== root) root = parents[root];
    while (parents[cell] !== cell) {
      const parent = parents[cell];
      parents[cell] = root;
      cell = parent;
    }
    return root;
  };
  const addSame = (cellA, cellB) => {
    const rootA = find(cellA);
    const rootB = find(cellB);
    if (rootA !== rootB) parents[rootB] = rootA;
  };
  const addDifferent = (cellA, cellB) => {
    apartA.push(cellA);
    apartB.push(cellB);
  };

  for (const line of lines) {
    const controlValues = grid[line[0]];
    if (!isFixed(controlValues)) continue;
    this._shardPooledBaseFixedLineCount++;
    if (!addRunLineRelations(line, LookupTables.toValue(controlValues), addSame, addDifferent)) {
      return false;
    }
  }

  return true;
};

const pooledNoCapacityShardRelationSupportsFromBase = function (grid, extraLine = null, extraCount = 0, extraValueBit = 0) {
  if (extraLine && (extraCount < 1 || extraCount >= extraLine.length)) return false;

  const numGridCells = this._numGridCells;
  const regionCells = this._regionCells;
  const baseParents = this._shardPooledBaseParents;
  const baseApartA = this._shardPooledBaseApartA;
  const baseApartB = this._shardPooledBaseApartB;
  const parents = this._shardPooledOverlayParents ??= new Uint16Array(numGridCells);
  const componentSizes = this._shardPooledComponentSizes ??= new Uint16Array(numGridCells);
  const componentMasks = this._shardPooledComponentMasks ??= new Int32Array(numGridCells);
  const fixedValueMasks = this._shardPooledFixedValueMasks ??= new Uint16Array(numGridCells);
  const firstRootByValue = this._shardPooledFirstRootByValue ??= new Int16Array(16);
  const roots = this._shardPooledRoots ??= [];
  const apartA = this._shardPooledApartA ??= [];
  const apartB = this._shardPooledApartB ??= [];

  parents.set(baseParents);
  componentSizes.fill(0);
  fixedValueMasks.fill(0);
  firstRootByValue.fill(-1);
  roots.length = 0;
  apartA.length = 0;
  apartB.length = 0;
  for (let i = 0; i < baseApartA.length; i++) {
    apartA.push(baseApartA[i]);
    apartB.push(baseApartB[i]);
  }

  const find = (cell) => {
    let root = cell;
    while (parents[root] !== root) root = parents[root];
    while (parents[cell] !== cell) {
      const parent = parents[cell];
      parents[cell] = root;
      cell = parent;
    }
    return root;
  };
  const addSame = (cellA, cellB) => {
    const rootA = find(cellA);
    const rootB = find(cellB);
    if (rootA !== rootB) parents[rootB] = rootA;
  };
  const addDifferent = (cellA, cellB) => {
    apartA.push(cellA);
    apartB.push(cellB);
  };

  if (extraLine && !addRunLineRelations(extraLine, extraCount, addSame, addDifferent)) return false;

  for (let cell = 0; cell < numGridCells; cell++) {
    const root = find(cell);
    if (componentSizes[root] === 0) componentMasks[root] = this._regionMask;
    componentSizes[root]++;
    componentMasks[root] &= grid[regionCells[cell]];
    if (!componentMasks[root]) return false;

    const cellValues = extraLine && cell === extraLine[0] ? extraValueBit : grid[cell];
    if (isFixed(cellValues)) {
      if (fixedValueMasks[root] & cellValues) return false;
      fixedValueMasks[root] |= cellValues;
    }
  }

  for (let root = 0; root < numGridCells; root++) {
    const componentSize = componentSizes[root];
    if (!componentSize) continue;
    if (componentSize > this._regionSize) return false;
    roots.push(root);

    let values = fixedValueMasks[root];
    while (values) {
      const valueBit = values & -values;
      values ^= valueBit;
      const valueIndex = LookupTables.toIndex(valueBit);
      const firstRoot = firstRootByValue[valueIndex];
      if (firstRoot < 0) firstRootByValue[valueIndex] = root;
      else {
        apartA.push(firstRoot);
        apartB.push(root);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < apartA.length; i++) {
      const rootA = find(apartA[i]);
      const rootB = find(apartB[i]);
      if (rootA === rootB) return false;

      const maskA = componentMasks[rootA];
      const maskB = componentMasks[rootB];
      if (isFixed(maskA) && isFixed(maskB) && maskA === maskB) return false;
      if (isFixed(maskA) && (maskB & maskA)) {
        componentMasks[rootB] &= ~maskA;
        if (!componentMasks[rootB]) return false;
        changed = true;
      }
      if (isFixed(maskB) && (maskA & maskB)) {
        componentMasks[rootA] &= ~maskB;
        if (!componentMasks[rootA]) return false;
        changed = true;
      }
    }
  }

  return true;
};

const prefixOverlapsFixedPrefix = function (grid, line, count) {
  if (count < 2 || count >= line.length) return false;

  const lines = this._shardRelationLines;
  const visitMarks = this._shardRelationVisitMarks ??= new Uint16Array(this._numGridCells);
  this._shardRelationVisitId = (this._shardRelationVisitId ?? 0) + 1;
  if (this._shardRelationVisitId === 65535) {
    visitMarks.fill(0);
    this._shardRelationVisitId = 1;
  }
  const visitId = this._shardRelationVisitId;

  visitMarks[line[0]] = visitId;
  for (let i = 1; i <= count; i++) visitMarks[line[i]] = visitId;

  for (const fixedLine of lines) {
    const controlValues = grid[fixedLine[0]];
    if (!isFixed(controlValues)) continue;
    const fixedCount = LookupTables.toValue(controlValues);
    if (fixedCount < 2 || fixedCount >= fixedLine.length) continue;
    if (visitMarks[fixedLine[0]] === visitId) return true;
    for (let i = 1; i <= fixedCount; i++) {
      if (visitMarks[fixedLine[i]] === visitId) return true;
    }
  }

  return false;
};

const buildShardRelationModel = function (grid, extraLine = null, extraCount = 0, extraValueBit = 0) {
  const lines = this._shardRelationLines;
  if (!lines || lines.length === 0) return null;

  const numGridCells = this._numGridCells;
  const regionCells = this._regionCells;
  const parents = new Uint16Array(numGridCells);
  const componentSizes = new Uint16Array(numGridCells);
  const componentMasks = new Int32Array(numGridCells);
  const fixedValueMasks = new Uint16Array(numGridCells);
  const apartA = [];
  const apartB = [];
  const includeDifferent = this._shardRelationSameOnly !== true;
  const includeValueApart = !this._shardRelationBasicModel && this._shardRelationValueApart !== false;
  const includeCapacity = !this._shardRelationBasicModel && this._shardRelationCapacityModel !== false;
  let relationCount = 0;

  for (let cell = 0; cell < numGridCells; cell++) parents[cell] = cell;

  const find = (cell) => {
    let root = cell;
    while (parents[root] !== root) root = parents[root];
    while (parents[cell] !== cell) {
      const parent = parents[cell];
      parents[cell] = root;
      cell = parent;
    }
    return root;
  };
  const addSame = (cellA, cellB) => {
    const rootA = find(cellA);
    const rootB = find(cellB);
    if (rootA !== rootB) {
      parents[rootB] = rootA;
      relationCount++;
    }
  };
  const addDifferent = (cellA, cellB) => {
    if (!includeDifferent) return;
    apartA.push(cellA);
    apartB.push(cellB);
    relationCount++;
  };

  for (const line of lines) {
    const controlValues = grid[line[0]];
    if (isFixed(controlValues)) {
      if (!addRunLineRelations(line, LookupTables.toValue(controlValues), addSame, addDifferent)) {
        return null;
      }
    } else if (this._shardRelationMinPrefix
      && !addRunLineSamePrefix(line, LookupTables.minValue(controlValues), addSame)) {
      return null;
    }
  }
  if (extraLine && !addRunLineRelations(extraLine, extraCount, addSame, addDifferent)) {
    return null;
  }
  if (relationCount === 0) return { noop: true };

  componentMasks.fill(this._regionMask);
  for (let cell = 0; cell < numGridCells; cell++) {
    const root = find(cell);
    componentSizes[root]++;
    componentMasks[root] &= grid[regionCells[cell]];
    if (!componentMasks[root]) return null;

    const cellValues = extraLine && cell === extraLine[0] ? extraValueBit : grid[cell];
    if (isFixed(cellValues)) {
      if (fixedValueMasks[root] & cellValues) return null;
      fixedValueMasks[root] |= cellValues;
    }
  }

  const roots = [];
  const firstRootByValue = includeValueApart ? new Int16Array(16) : null;
  if (firstRootByValue) firstRootByValue.fill(-1);
  for (let root = 0; root < numGridCells; root++) {
    const componentSize = componentSizes[root];
    if (!componentSize) continue;
    if (componentSize > this._regionSize) return null;
    roots.push(root);

    let values = fixedValueMasks[root];
    while (values) {
      const valueBit = values & -values;
      values ^= valueBit;
      if (!includeValueApart) continue;

      const valueIndex = LookupTables.toIndex(valueBit);
      const firstRoot = firstRootByValue[valueIndex];
      if (firstRoot < 0) firstRootByValue[valueIndex] = root;
      else {
        apartA.push(firstRoot);
        apartB.push(root);
      }
    }
  }

  if (this._shardRelationBasicModel) return { componentMasks, find };

  const enforceApartEdges = () => {
    let apartChanged = false;
    for (let i = 0; i < apartA.length; i++) {
      const rootA = find(apartA[i]);
      const rootB = find(apartB[i]);
      if (rootA === rootB) return null;

      const maskA = componentMasks[rootA];
      const maskB = componentMasks[rootB];
      if (isFixed(maskA) && isFixed(maskB) && maskA === maskB) return null;
      if (isFixed(maskA) && (maskB & maskA)) {
        componentMasks[rootB] &= ~maskA;
        if (!componentMasks[rootB]) return null;
        apartChanged = true;
      }
      if (isFixed(maskB) && (maskA & maskB)) {
        componentMasks[rootA] &= ~maskB;
        if (!componentMasks[rootA]) return null;
        apartChanged = true;
      }
    }
    return apartChanged;
  };

  if (!includeCapacity) {
    let changed = true;
    while (changed) {
      changed = enforceApartEdges();
      if (changed === null) return null;
    }
    return { componentMasks, find };
  }

  const fixedWeights = new Uint16Array(this._numRegions);
  const possibleWeights = new Uint16Array(this._numRegions);
  let changed = true;
  while (changed) {
    changed = false;

    const apartChanged = enforceApartEdges();
    if (apartChanged === null) return null;
    changed ||= apartChanged;

    fixedWeights.fill(0);
    possibleWeights.fill(0);
    for (const root of roots) {
      const mask = componentMasks[root];
      if (isFixed(mask)) {
        fixedWeights[LookupTables.toIndex(mask)] += componentSizes[root];
      } else {
        let values = mask;
        while (values) {
          const regionBit = values & -values;
          values ^= regionBit;
          possibleWeights[LookupTables.toIndex(regionBit)] += componentSizes[root];
        }
      }
    }

    for (let region = 0; region < this._numRegions; region++) {
      if (fixedWeights[region] > this._regionSize) return null;
      if (fixedWeights[region] + possibleWeights[region] < this._regionSize) return null;
    }

    for (const root of roots) {
      const mask = componentMasks[root];
      if (isFixed(mask)) continue;

      let keepMask = mask;
      let requiredMask = 0;
      let values = mask;
      while (values) {
        const regionBit = values & -values;
        values ^= regionBit;
        const region = LookupTables.toIndex(regionBit);
        const componentSize = componentSizes[root];
        if (fixedWeights[region] + componentSize > this._regionSize) {
          keepMask &= ~regionBit;
        } else if (fixedWeights[region] + possibleWeights[region] - componentSize < this._regionSize) {
          requiredMask |= regionBit;
        }
      }
      if (requiredMask) {
        if (requiredMask & (requiredMask - 1)) return null;
        keepMask &= requiredMask;
      }
      if (!keepMask) return null;
      if (keepMask !== mask) {
        componentMasks[root] = keepMask;
        changed = true;
      }
    }
  }

  return { componentMasks, find };
};

const applyShardRelationModel = function (grid, model, handlerAccumulator) {
  if (model.noop) return true;

  const regionCells = this._regionCells;
  for (let cell = 0; cell < this._numGridCells; cell++) {
    const root = model.find(cell);
    if (!this._restrictCell(grid, regionCells[cell], model.componentMasks[root], handlerAccumulator)) {
      return false;
    }
  }
  return true;
};

const enforceShardRelations = function (grid, handlerAccumulator) {
  const lines = this._shardRelationLines;
  if (!lines || lines.length === 0) return true;

  if (this._shardRelationAlsoRegionRuns
    && !this._enforceRegionCountLines(grid, handlerAccumulator)) {
    return false;
  }

  if (this._shardRelationSupportMinPrefix) {
    for (const line of lines) {
      const controlCell = line[0];
      let candidateValues = grid[controlCell];
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        if (runLengthHasSupport.call(this, grid, line, LookupTables.toValue(valueBit))) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  }

  if (this._shardRelationProbePooledNoCapacityBase) {
    if (!buildPooledNoCapacityFixedBase.call(this, grid)) return false;
    if (this._shardRelationProbePooledNoCapacityBaseSkipFixed
      && this._shardPooledBaseFixedLineCount > 0
      && !pooledNoCapacityShardRelationSupportsFromBase.call(this, grid)) {
      return false;
    }
    for (const line of lines) {
      const controlCell = line[0];
      const controlValues = grid[controlCell];
      if (this._shardRelationProbePooledNoCapacityBaseSkipFixed && isFixed(controlValues)) {
        continue;
      }
      let candidateValues = controlValues;
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        const count = LookupTables.toValue(valueBit);
        if (pooledNoCapacityShardRelationSupportsFromBase.call(this, grid, line, count, valueBit)) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  } else if (this._shardRelationProbePooledNoCapacity) {
    for (const line of lines) {
      const controlCell = line[0];
      const controlValues = grid[controlCell];
      if (this._shardRelationProbeMaxValues
        && countBits(controlValues) > this._shardRelationProbeMaxValues) {
        continue;
      }
      let candidateValues = controlValues;
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        const count = LookupTables.toValue(valueBit);
        if (pooledNoCapacityShardRelationSupports.call(this, grid, line, count, valueBit)) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  } else if (this._shardRelationProbeSparseNoCapacity) {
    for (const line of lines) {
      const controlCell = line[0];
      let candidateValues = grid[controlCell];
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        const count = LookupTables.toValue(valueBit);
        if (sparseNoCapacityShardRelationSupports.call(this, grid, line, count, valueBit)) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  } else if (this._shardRelationProbeSparseBasic) {
    for (const line of lines) {
      const controlCell = line[0];
      const controlValues = grid[controlCell];
      if (this._shardRelationProbeMaxValues
        && countBits(controlValues) > this._shardRelationProbeMaxValues) {
        continue;
      }
      let candidateValues = controlValues;
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        const count = LookupTables.toValue(valueBit);
        if (this._shardRelationProbeRequiresOverlap
          && !prefixOverlapsFixedPrefix.call(this, grid, line, count)) {
          supportedValues |= valueBit;
        } else if (sparseBasicShardRelationSupports.call(this, grid, line, count, valueBit)) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  } else if (this._shardRelationProbeLocalPrefix) {
    for (const line of lines) {
      const controlCell = line[0];
      let candidateValues = grid[controlCell];
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        const count = LookupTables.toValue(valueBit);
        if (runPrefixHasValueSupport.call(this, grid, line, count, valueBit)) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  } else if (this._shardRelationProbeControls !== false) {
    for (const line of lines) {
      const controlCell = line[0];
      let candidateValues = grid[controlCell];
      let supportedValues = 0;
      while (candidateValues) {
        const valueBit = candidateValues & -candidateValues;
        candidateValues ^= valueBit;
        const count = LookupTables.toValue(valueBit);
        if (buildShardRelationModel.call(this, grid, line, count, valueBit)) {
          supportedValues |= valueBit;
        }
      }
      if (!supportedValues) return false;
      if (!this._restrictCell(grid, controlCell, supportedValues, handlerAccumulator)) return false;
    }
  }

  if (this._shardRelationApplyModel === false) return true;

  const model = buildShardRelationModel.call(this, grid);
  if (!model) return false;
  return applyShardRelationModel.call(this, grid, model, handlerAccumulator);
};

const enforceConsistencyShardRelations = function (grid, handlerAccumulator) {
  this._connectivityDirtyRegionsMask = 0;
  this._changed = false;

  if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;
  if (!this._enforceShardRelations(grid, handlerAccumulator)) return false;

  if (!this._scanRegionCandidates(grid)) return false;

  this._changed = false;
  if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
  if (this._changed && !this._scanRegionCandidates(grid)) return false;
  if (!this._enforceRegionValuePairs(grid)) return false;

  this._changed = false;
  if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
  if (this._changed && !this._scanRegionCandidates(grid)) return false;

  this._connectivityDirtyRegionsMask = 0;
  return this._enforceRegionValuePairs(grid);
};

const chaosShardRelationLinesFromConstraints = (constraintMap, shape) => {
  if (!constraintMap.has('ChaosConstruction')) return { shardLines: [], regionRunLines: [] };

  const regionCells = shape.varCellsForGroup('CC');
  if (!regionCells || regionCells.length !== shape.numGridCells) {
    return { shardLines: [], regionRunLines: [] };
  }
  const regionCellOffset = regionCells[0];
  const regionCellLimit = regionCellOffset + regionCells.length;

  const shardLines = [];
  const regionRunLines = [];
  for (const constraint of constraintMap.get('ChaosArrow') || []) {
    const cells = constraint.cells.map(cellId => shape.parseCellId(cellId).cell);
    const controlCell = cells[0];
    const chaosCells = cells.slice(1);
    if (chaosCells.length < 2
      || chaosCells.some(cell => cell < regionCellOffset || cell >= regionCellLimit)) {
      continue;
    }
    const line = chaosCells.map(cell => cell - regionCellOffset);
    shardLines.push(line);
    regionRunLines.push([controlCell, ...line]);
  }
  return { shardLines, regionRunLines };
};

const installNfaShardRelations = ({
  probeControls = true,
  applyModel = true,
  minPrefix = false,
  supportMinPrefix = false,
  basicModel = false,
  sameOnly = false,
  valueApart = true,
  capacityModel = true,
  probeLocalPrefix = false,
  probeSparseBasic = false,
  probeMaxValues = 0,
  alsoRegionRuns = false,
  probeRequiresOverlap = false,
  probeSparseNoCapacity = false,
  probePooledNoCapacity = false,
  probePooledNoCapacityBase = false,
  probePooledNoCapacityBaseSkipFixed = false,
} = {}) => {
  ChaosConstruction.prototype.addShardRelationLines = addShardRelationLines;
  ChaosConstruction.prototype._enforceShardRelations = enforceShardRelations;
  ChaosConstruction.prototype.enforceConsistency = enforceConsistencyShardRelations;
  if (alsoRegionRuns) {
    ChaosConstruction.prototype.addRegionCountLines = addRegionCountLines;
    ChaosConstruction.prototype._enforceRegionCountLines = enforceRegionCountLines;
  }
  ChaosConstruction.prototype._shardRelationProbeControls = probeControls;
  ChaosConstruction.prototype._shardRelationApplyModel = applyModel;
  ChaosConstruction.prototype._shardRelationMinPrefix = minPrefix;
  ChaosConstruction.prototype._shardRelationSupportMinPrefix = supportMinPrefix;
  ChaosConstruction.prototype._shardRelationBasicModel = basicModel;
  ChaosConstruction.prototype._shardRelationSameOnly = sameOnly;
  ChaosConstruction.prototype._shardRelationValueApart = valueApart;
  ChaosConstruction.prototype._shardRelationCapacityModel = capacityModel;
  ChaosConstruction.prototype._shardRelationProbeLocalPrefix = probeLocalPrefix;
  ChaosConstruction.prototype._shardRelationProbeSparseBasic = probeSparseBasic;
  ChaosConstruction.prototype._shardRelationProbeMaxValues = probeMaxValues;
  ChaosConstruction.prototype._shardRelationAlsoRegionRuns = alsoRegionRuns;
  ChaosConstruction.prototype._shardRelationProbeRequiresOverlap = probeRequiresOverlap;
  ChaosConstruction.prototype._shardRelationProbeSparseNoCapacity = probeSparseNoCapacity;
  ChaosConstruction.prototype._shardRelationProbePooledNoCapacity = probePooledNoCapacity;
  ChaosConstruction.prototype._shardRelationProbePooledNoCapacityBase = probePooledNoCapacityBase;
  ChaosConstruction.prototype._shardRelationProbePooledNoCapacityBaseSkipFixed = probePooledNoCapacityBaseSkipFixed;

  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    const handlers = [...originalConstraintHandlers.call(this, constraintMap, shape)];
    const { shardLines, regionRunLines } = chaosShardRelationLinesFromConstraints(constraintMap, shape);
    if (shardLines.length || regionRunLines.length) {
      for (const handler of handlers) {
        if (handler.constructor === ChaosConstruction) {
          handler.addShardRelationLines(shardLines);
          if (alsoRegionRuns) handler.addRegionCountLines(regionRunLines);
        }
      }
    }
    yield* handlers;
  };
};

const scanRegionCandidatesWithoutPossibleCountCache = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const possibleValueMasks = this._possibleValueMasks;
  const fixedValueMasks = this._fixedValueMasks;
  fixedCounts.fill(0);
  possibleCounts.fill(0);
  possibleValueMasks.fill(0);
  fixedValueMasks.fill(0);

  const regionCellOffset = this._regionCellOffset;
  const regionCandidateCells = this._regionCandidateCells;
  const numGridCells = this._numGridCells;
  for (let cell = 0; cell < numGridCells; cell++) {
    const regionMask = grid[regionCellOffset + cell];
    if (!regionMask) return false;
    const cellValues = grid[cell];
    if (!(regionMask & (regionMask - 1))) {
      const region = 31 - Math.clz32(regionMask);
      regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]] = cell;
      fixedCounts[region]++;
      possibleValueMasks[region] |= cellValues;
      if (!(cellValues & (cellValues - 1))) {
        if (fixedValueMasks[region] & cellValues) {
          return false;
        }
        fixedValueMasks[region] |= cellValues;
      }
    } else {
      let regionValues = regionMask;
      while (regionValues) {
        const regionBit = regionValues & -regionValues;
        regionValues ^= regionBit;
        const region = 31 - Math.clz32(regionBit);
        possibleValueMasks[region] |= cellValues;
        regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]++] = cell;
      }
    }
  }

  return true;
};

const enforceConsistencyWithoutPossibleCountCache = function (grid, handlerAccumulator) {
  while (true) {
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

    if (!this._scanRegionCandidates(grid)) return false;

    this._changed = false;
    if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
    if (this._changed) {
      continue;
    }

    if (!this._enforceRegionValuePairs(grid)) return false;

    this._connectivityDirtyRegionsMask = this._regionMask;
    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) {
      continue;
    }

    return true;
  }
};

const installWithoutPossibleCountCache = () => {
  ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithoutPossibleCountCache;
  ChaosConstruction.prototype.enforceConsistency = enforceConsistencyWithoutPossibleCountCache;
};

const scanRegionCandidatesWithoutFixedValueMask = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const possibleValueMasks = this._possibleValueMasks;
  fixedCounts.fill(0);
  possibleCounts.fill(0);
  possibleValueMasks.fill(0);

  const regionCells = this._regionCells;
  const regionCandidateCells = this._regionCandidateCells;
  const numGridCells = this._numGridCells;
  const possibleCountCacheOffset = this._possibleCountCacheOffset;
  let connectivityDirtyRegionsMask = this._connectivityDirtyRegionsMask;
  for (let cell = 0; cell < numGridCells; cell++) {
    const regionMask = grid[regionCells[cell]];
    if (!regionMask) return false;
    const cellValues = grid[cell];

    if (!(regionMask & (regionMask - 1))) {
      const region = 31 - Math.clz32(regionMask);
      possibleValueMasks[region] |= cellValues;
      regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]] = cell;
      fixedCounts[region]++;
    } else {
      let regionValues = regionMask;
      while (regionValues) {
        const regionBit = regionValues & -regionValues;
        regionValues ^= regionBit;
        const region = 31 - Math.clz32(regionBit);
        possibleValueMasks[region] |= cellValues;
        regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]++] = cell;
      }
    }
  }

  for (let region = 0; region < this._numRegions; region++) {
    const possibleCount = possibleCounts[region];
    if (grid[possibleCountCacheOffset + region] !== possibleCount) {
      connectivityDirtyRegionsMask |= 1 << region;
    }
    grid[possibleCountCacheOffset + region] = possibleCount;
  }
  this._connectivityDirtyRegionsMask = connectivityDirtyRegionsMask;

  return true;
};

const installFixedValueRegionHandlers = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions =
    originalOptimizerMethods._addChaosFixedValueRegionExclusions;
};

class ChaosFixedValueRegionStateCachedExclusion extends ChaosFixedValueRegionExclusion {
  constructor(sourceIndex, triggerCell, gridCells, regionCells, processedPairs) {
    super(sourceIndex, triggerCell, gridCells, regionCells);
    this._processedPairs = processedPairs;
    this._processedPairOffset = 0;
    this._processedPairBit = 0;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    if (this._processedPairs.offset < 0) {
      this._processedPairs.offset = stateAllocator.allocate(
        new Array(this._processedPairs.numStateCells).fill(0));
    }
    this._processedPairOffset = this._processedPairs.offset + (this._sourceIndex >> 4);
    this._processedPairBit = 1 << (this._sourceIndex & 15);
    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const gridCells = this._gridCells;
    const regionCells = this._regionCells;
    const sourceIndex = this._sourceIndex;
    const value = grid[gridCells[sourceIndex]];
    if (value & (value - 1)) return true;

    const regionBit = grid[regionCells[sourceIndex]];
    if (regionBit & (regionBit - 1)) return true;

    const processedPairOffset = this._processedPairOffset;
    const processedPairBit = this._processedPairBit;
    const processedPairs = grid[processedPairOffset];
    if (processedPairs & processedPairBit) return true;

    const keepRegionMask = ~regionBit;
    const keepValueMask = ~value;

    for (let i = 0; i < gridCells.length; i++) {
      if (i === sourceIndex) continue;

      const otherGridCell = gridCells[i];
      const otherRegionCell = regionCells[i];

      if (grid[otherGridCell] === value
        && !this._restrictCell(grid, otherRegionCell, keepRegionMask, handlerAccumulator)) {
        return false;
      }

      if (grid[otherRegionCell] === regionBit
        && !this._restrictCell(grid, otherGridCell, keepValueMask, handlerAccumulator)) {
        return false;
      }
    }

    grid[processedPairOffset] = processedPairs | processedPairBit;
    return true;
  }
}

const installFixedValueRegionStateCachedHandlers = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function (handlerSet, shape) {
    const cells = fixedValueRegionCells(handlerSet, shape);
    if (!cells) return;

    const { gridCells, regionCellArray } = cells;
    const processedPairs = {
      offset: -1,
      numStateCells: (shape.numGridCells + 15) >> 4,
    };
    for (let i = 0; i < shape.numGridCells; i++) {
      handlerSet.add(
        new ChaosFixedValueRegionStateCachedExclusion(
          i, i, gridCells, regionCellArray, processedPairs),
        new ChaosFixedValueRegionStateCachedExclusion(
          i, regionCellArray[i], gridCells, regionCellArray, processedPairs));
    }
  };
};

class ChaosFixedValueRegionOrdinaryExclusion extends ChaosFixedValueRegionExclusion {
  static SINGLETON_HANDLER = false;

  constructor(sourceIndex, gridCells, regionCells) {
    super(sourceIndex, gridCells[sourceIndex], gridCells, regionCells);
    this.cells = new Uint8Array([gridCells[sourceIndex], regionCells[sourceIndex]]);
    this.idStr = [this.constructor.name, sourceIndex].join('|');
  }
}

const installFixedValueRegionOrdinaryHandlers = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function (handlerSet, shape) {
    const cells = fixedValueRegionCells(handlerSet, shape);
    if (!cells) return;

    const { gridCells, regionCellArray } = cells;
    for (let i = 0; i < shape.numGridCells; i++) {
      handlerSet.add(new ChaosFixedValueRegionOrdinaryExclusion(i, gridCells, regionCellArray));
    }
  };
};

const installFixedValueRegionAuxHandlers = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function (handlerSet, shape) {
    const cells = fixedValueRegionCells(handlerSet, shape);
    if (!cells) return;

    const { regionCellOffset } = cells;
    for (let i = 0; i < shape.numGridCells; i++) {
      handlerSet.addAux(
        new ChaosFixedValueRegionExclusion(i, i, shape.numGridCells, regionCellOffset),
        new ChaosFixedValueRegionExclusion(
          i, regionCellOffset + i, shape.numGridCells, regionCellOffset));
    }
  };
};

const installAdditionalFixedValueRegionOrdinaryHandlers = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function (handlerSet, shape) {
    originalOptimizerMethods._addChaosFixedValueRegionExclusions.call(this, handlerSet, shape);
    const cells = fixedValueRegionCells(handlerSet, shape);
    if (!cells) return;

    const { gridCells, regionCellArray } = cells;
    for (let i = 0; i < shape.numGridCells; i++) {
      handlerSet.add(new ChaosFixedValueRegionOrdinaryExclusion(i, gridCells, regionCellArray));
    }
  };
};

class ChaosFixedValueRegionConflictCheck extends SudokuConstraintHandler {
  constructor(sourceIndex, gridCells, regionCells) {
    super([gridCells[sourceIndex], regionCells[sourceIndex]]);
    this._sourceIndex = sourceIndex;
    this._gridCells = gridCells;
    this._regionCells = regionCells;
    this.idStr = [this.constructor.name, sourceIndex].join('|');
  }

  enforceConsistency(grid) {
    const gridCells = this._gridCells;
    const regionCells = this._regionCells;
    const sourceIndex = this._sourceIndex;
    const value = grid[gridCells[sourceIndex]];
    if (value & (value - 1)) return true;

    const regionBit = grid[regionCells[sourceIndex]];
    if (regionBit & (regionBit - 1)) return true;

    for (let i = 0; i < gridCells.length; i++) {
      if (i === sourceIndex) continue;
      if (grid[gridCells[i]] === value && grid[regionCells[i]] === regionBit) return false;
    }

    return true;
  }
}

const installFixedValueRegionConflictChecks = () => {
  SudokuConstraintOptimizer.prototype._addChaosFixedValueRegionExclusions = function (handlerSet, shape) {
    originalOptimizerMethods._addChaosFixedValueRegionExclusions.call(this, handlerSet, shape);
    const cells = fixedValueRegionCells(handlerSet, shape);
    if (!cells) return;

    const { gridCells, regionCellArray } = cells;
    for (let i = 0; i < shape.numGridCells; i++) {
      handlerSet.add(new ChaosFixedValueRegionConflictCheck(i, gridCells, regionCellArray));
    }
  };
};

class ChaosCompletedRegionExclusion extends SudokuConstraintHandler {
  constructor(triggerCell, regionCells) {
    super([triggerCell]);
    this._triggerCell = triggerCell;
    this._regionCells = regionCells;
    this._regionSize = 0;
    this.idStr = [this.constructor.name, triggerCell].join('|');
  }

  initialize(initialGridCells, cellExclusions, shape) {
    this._regionSize = shape.numValues;
    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const regionBit = grid[this._triggerCell];
    if (regionBit & (regionBit - 1)) return true;

    const regionCells = this._regionCells;
    const regionSize = this._regionSize;
    let fixedCount = 0;

    for (let i = 0; i < regionCells.length; i++) {
      if (grid[regionCells[i]] === regionBit && ++fixedCount > regionSize) return false;
    }

    if (fixedCount !== regionSize) return true;

    const keepMask = ~regionBit;
    for (let i = 0; i < regionCells.length; i++) {
      const cell = regionCells[i];
      const oldValue = grid[cell];
      if (!(oldValue & regionBit) || !(oldValue & (oldValue - 1))) continue;
      const newValue = oldValue & keepMask;
      if (!newValue) return false;
      grid[cell] = newValue;
      handlerAccumulator.addForCell(cell);
    }

    return true;
  }
}

class ChaosCompletedRegionSingletonExclusion extends ChaosCompletedRegionExclusion {
  static SINGLETON_HANDLER = true;
}

const installCompletedRegionHandlers = () => {
  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    yield* originalConstraintHandlers.call(this, constraintMap, shape);
    if (!constraintMap.has('ChaosConstruction')) return;

    const regionCells = shape.varCellsForGroup('CC');
    if (!regionCells || regionCells.length !== shape.numGridCells) return;

    const regionCellArray = new Uint8Array(regionCells);
    for (let i = 0; i < shape.numGridCells; i++) {
      yield new ChaosCompletedRegionExclusion(regionCellArray[i], regionCellArray);
    }
  };
};

const installCompletedRegionSingletonHandlers = () => {
  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    yield* originalConstraintHandlers.call(this, constraintMap, shape);
    if (!constraintMap.has('ChaosConstruction')) return;

    const regionCells = shape.varCellsForGroup('CC');
    if (!regionCells || regionCells.length !== shape.numGridCells) return;

    const regionCellArray = new Uint8Array(regionCells);
    for (let i = 0; i < shape.numGridCells; i++) {
      yield new ChaosCompletedRegionSingletonExclusion(regionCellArray[i], regionCellArray);
    }
  };
};

const installWithoutChaosStateCaches = () => {
  installWithoutPossibleCountCache();
  ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoExactPossible;
  ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityLimitedDistance;
};

const installFixedRegionSingletonHandlers = () => {
  // The fixed value/region singleton handler is now part of production `full`.
};

const installChaosPriorityHandlers = (gridPriority, regionPriority) => {
  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    yield* originalConstraintHandlers.call(this, constraintMap, shape);
    if (!constraintMap.has('ChaosConstruction')) return;

    const gridCells = Array.from({ length: shape.numGridCells }, (_, i) => i);
    const regionCells = shape.varCellsForGroup('CC');
    if (gridPriority !== null) yield new Priority(gridCells, gridPriority);
    if (regionPriority !== null && regionCells) yield new Priority(regionCells, regionPriority);
  };
};

const installChaosHandlerPriority = (priority) => {
  ChaosConstruction.prototype.priority = function () {
    return priority;
  };
};

const installXSumControlPriorityHandlers = (controlPriority, regionPriority = null) => {
  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    yield* originalConstraintHandlers.call(this, constraintMap, shape);
    if (!constraintMap.has('ChaosConstruction')) return;

    const xSumConstraints = constraintMap.get('XSum');
    if (!xSumConstraints?.length) return;

    const controlCells = xSumConstraints.map(
      constraint => shape.parseCellId(constraint.getCells(shape)[0]).cell);
    yield new Priority(controlCells, controlPriority);

    const regionCells = shape.varCellsForGroup('CC');
    if (regionPriority !== null && regionCells) yield new Priority(regionCells, regionPriority);
  };
};

const installNfaGridAnchorPriorityHandlers = (gridPriority, regionPriority = null) => {
  SudokuBuilder._constraintHandlers = function* (constraintMap, shape) {
    yield* originalConstraintHandlers.call(this, constraintMap, shape);
    if (!constraintMap.has('ChaosConstruction')) return;

    const arrowConstraints = constraintMap.get('ChaosArrow');
    if (!arrowConstraints?.length) return;

    const gridAnchors = [];
    const seen = new Set();
    for (const constraint of arrowConstraints) {
      for (const cellId of constraint.cells) {
        const cell = shape.parseCellId(cellId).cell;
        if (cell >= shape.numGridCells || seen.has(cell)) continue;
        seen.add(cell);
        gridAnchors.push(cell);
      }
    }
    if (!gridAnchors.length) return;

    yield new Priority(gridAnchors, gridPriority);

    const regionCells = shape.varCellsForGroup('CC');
    if (regionPriority !== null && regionCells) yield new Priority(regionCells, regionPriority);
  };
};

const installCandidateMinCount = () => {
  CandidateSelector.prototype._selectBestCell = function (gridState, cellOrder, cellDepth) {
    return this._minCountCellIndex(gridState, cellOrder, cellDepth);
  };
};

const installCandidateNoLinkedBoost = () => {
  CandidateSelector.prototype._selectBestCell = function (...args) {
    const linkedCells = this._linkedCells;
    this._linkedCells = null;
    try {
      return originalCandidateSelectorMethods._selectBestCell.apply(this, args);
    } finally {
      this._linkedCells = linkedCells;
    }
  };
};

const installCandidateNoValueScore = () => {
  CandidateSelector.prototype._selectBestCell = function (...args) {
    const conflictScores = this._conflictScores;
    const getMaxValueScore = conflictScores.getMaxValueScore;
    conflictScores.getMaxValueScore = () => ({ value: 0, score: 0 });
    try {
      return originalCandidateSelectorMethods._selectBestCell.apply(this, args);
    } finally {
      conflictScores.getMaxValueScore = getMaxValueScore;
    }
  };
};

const installCandidateNoCustomFinders = () => {
  CandidateSelector.prototype._findCustomCandidates = function () {
    return false;
  };
};

const scanRegionCandidatesAndCheckSizes = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  const possibleValueMasks = this._possibleValueMasks;
  const fixedValueMasks = this._fixedValueMasks;
  fixedCounts.fill(0);
  possibleCounts.fill(0);
  possibleValueMasks.fill(0);
  fixedValueMasks.fill(0);

  const regionCells = this._regionCells;
  const regionCandidateCells = this._regionCandidateCells;
  const numGridCells = this._numGridCells;
  const regionSize = this._regionSize;

  for (let cell = 0; cell < numGridCells; cell++) {
    const regionMask = grid[regionCells[cell]];
    if (!regionMask) return false;
    const cellValues = grid[cell];
    if (!(regionMask & (regionMask - 1))) {
      const region = 31 - Math.clz32(regionMask);
      regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]] = cell;
      if (++fixedCounts[region] > regionSize) return false;
      possibleValueMasks[region] |= cellValues;
      if (!(cellValues & (cellValues - 1))) {
        if (fixedValueMasks[region] & cellValues) {
          return false;
        }
        fixedValueMasks[region] |= cellValues;
      }
    } else {
      let regionValues = regionMask;
      while (regionValues) {
        const regionBit = regionValues & -regionValues;
        regionValues ^= regionBit;
        const region = 31 - Math.clz32(regionBit);
        possibleValueMasks[region] |= cellValues;
        regionCandidateCells[region * numGridCells + fixedCounts[region] + possibleCounts[region]++] = cell;
      }
    }
  }

  for (let region = 0; region < this._numRegions; region++) {
    if (fixedCounts[region] + possibleCounts[region] < regionSize) return false;
  }

  return true;
};

const scanRegionCountsOnly = function (grid) {
  const fixedCounts = this._fixedCounts;
  const possibleCounts = this._possibleCounts;
  fixedCounts.fill(0);
  possibleCounts.fill(0);

  const regionCells = this._regionCells;
  const numGridCells = this._numGridCells;
  for (let cell = 0; cell < numGridCells; cell++) {
    let regionValues = grid[regionCells[cell]];
    if (!regionValues) return false;

    if (!(regionValues & (regionValues - 1))) {
      fixedCounts[31 - Math.clz32(regionValues)]++;
    } else {
      while (regionValues) {
        const regionBit = regionValues & -regionValues;
        regionValues ^= regionBit;
        possibleCounts[31 - Math.clz32(regionBit)]++;
      }
    }
  }

  return true;
};

const enforceConsistencySizePrescan = function (grid, handlerAccumulator) {
  this._connectivityDirtyRegionsMask = 0;

  while (true) {
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

    if (!scanRegionCountsOnly.call(this, grid)) return false;

    this._changed = false;
    if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    if (!this._scanRegionCandidates(grid)) return false;

    if (!this._enforceRegionValuePairs(grid)) return false;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    this._connectivityDirtyRegionsMask = 0;
    return true;
  }
};

const enforceConsistencyScanSizeCombined = function (grid, handlerAccumulator) {
  while (true) {
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

    if (!scanRegionCandidatesAndCheckSizes.call(this, grid)) return false;
    if (!this._enforceRegionValuePairs(grid)) return false;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    return this._enforceRegionValuePairs(grid);
  }
};

const enforceConsistencyCanonicalOnce = function (grid, handlerAccumulator) {
  if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

  while (true) {
    if (!this._scanRegionCandidates(grid)) return false;

    if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
    if (!this._enforceRegionValuePairs(grid)) return false;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    return this._enforceRegionValuePairs(grid);
  }
};

const enforceConsistencyCanonicalOnceScanSizeCombined = function (grid, handlerAccumulator) {
  if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

  while (true) {
    if (!scanRegionCandidatesAndCheckSizes.call(this, grid)) return false;
    if (!this._enforceRegionValuePairs(grid)) return false;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    return this._enforceRegionValuePairs(grid);
  }
};

const enforceConsistencyMutatingPhases = function (grid, handlerAccumulator) {
  while (true) {
    this._changed = false;
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

    if (!this._enforceRegionShards(grid, handlerAccumulator)) return false;

    if (!this._scanRegionCandidates(grid)) return false;

    this._changed = false;
    if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    this._changed = false;
    if (!this._enforceRegionValuePairs(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) continue;

    return true;
  }
};

const enforceConsistencySinglePass = function (grid, handlerAccumulator) {
  this._connectivityDirtyRegionsMask = 0;
  this._changed = false;
  if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

  if (!this._scanRegionCandidates(grid)) return false;

  if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
  if (!this._enforceRegionValuePairs(grid)) return false;

  this._changed = false;
  if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
  if (this._changed && !this._scanRegionCandidates(grid)) return false;

  this._connectivityDirtyRegionsMask = 0;
  return this._enforceRegionValuePairs(grid);
};

const enforceConsistencySingleScan = function (grid, handlerAccumulator) {
  this._changed = false;
  if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;

  if (!this._scanRegionCandidates(grid)) return false;

  if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;
  if (!this._enforceRegionValuePairs(grid)) return false;

  this._changed = false;
  if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;

  return this._enforceRegionValuePairs(grid);
};

const enforceConsistencyConnectivityFixedPoint = function (grid, handlerAccumulator) {
  let needsScan = true;

  while (true) {
    this._changed = false;
    if (!this._enforceCanonicalOrder(grid, handlerAccumulator)) return false;
    needsScan ||= this._changed;

    if (needsScan) {
      if (!this._scanRegionCandidates(grid)) return false;
      needsScan = false;
    }

    if (!this._enforceRegionSizes(grid, handlerAccumulator)) return false;

    this._changed = false;
    if (!this._enforceConnectivity(grid, handlerAccumulator)) return false;
    if (this._changed) {
      needsScan = true;
      continue;
    }

    return this._enforceRegionValuePairs(grid);
  }
};

const collectShardRegionInvariantState = function (grid) {
  if (this._regionShardOffset === undefined) {
    return true;
  }

  this._updateFixedRegionShards(grid);

  const numGridCells = this._numGridCells;
  const regionCellOffset = this._regionCellOffset;
  const roots = this._shardRegionInvariantRoots ??= new Uint16Array(numGridCells);
  const rootOfCell = this._shardRegionInvariantRootOfCell ??= new Uint16Array(numGridCells);
  const shardSizes = this._shardRegionInvariantSizes ??= new Uint16Array(numGridCells);
  const shardMasks = this._shardRegionInvariantMasks ??= new Int32Array(numGridCells);
  const shardValueMasks = this._shardRegionInvariantValueMasks ??= new Uint16Array(numGridCells);
  const shardFixedValueMasks = this._shardRegionInvariantFixedValueMasks ??= new Uint16Array(numGridCells);
  const shardOffset = this._regionShardOffset;
  let rootCount = 0;

  shardSizes.fill(0);
  shardValueMasks.fill(0);
  shardFixedValueMasks.fill(0);

  for (let cell = 0; cell < numGridCells; cell++) {
    let root = grid[shardOffset + cell];
    if (root !== cell) {
      root = grid[shardOffset + root];
      grid[shardOffset + cell] = root;
    }
    rootOfCell[cell] = root;
    if (shardSizes[root] === 0) {
      roots[rootCount++] = root;
      shardMasks[root] = this._regionMask;
    }

    shardSizes[root]++;
    if (shardSizes[root] > this._regionSize) return false;
    shardMasks[root] &= grid[regionCellOffset + cell];
    if (!shardMasks[root]) return false;

    const cellValues = grid[cell];
    shardValueMasks[root] |= cellValues;
    if (isFixed(cellValues)) {
      if (shardFixedValueMasks[root] & cellValues) return false;
      shardFixedValueMasks[root] |= cellValues;
    }
  }

  this._shardRegionInvariantRootCount = rootCount;
  return true;
};

const restrictShardRegionMask = function (grid, rootOfCell, root, mask, handlerAccumulator) {
  const regionCellOffset = this._regionCellOffset;
  for (let cell = 0; cell < this._numGridCells; cell++) {
    if (rootOfCell[cell] !== root) continue;
    if (!this._restrictCell(grid, regionCellOffset + cell, mask, handlerAccumulator)) return false;
  }
  return true;
};

const enforceShardFixedValueInvariants = function (grid, handlerAccumulator) {
  const rootCount = this._shardRegionInvariantRootCount;
  const roots = this._shardRegionInvariantRoots;
  const rootOfCell = this._shardRegionInvariantRootOfCell;
  const shardMasks = this._shardRegionInvariantMasks;
  const shardFixedValueMasks = this._shardRegionInvariantFixedValueMasks;
  const fixedValues = this._shardRegionInvariantFixedValues ??= new Uint16Array(this._numRegions);
  fixedValues.fill(0);

  for (let i = 0; i < rootCount; i++) {
    const root = roots[i];
    const fixedMask = shardFixedValueMasks[root];
    const regionMask = shardMasks[root];
    if (!fixedMask || !isFixed(regionMask)) continue;

    const region = LookupTables.toIndex(regionMask);
    if (fixedValues[region] & fixedMask) return false;
    fixedValues[region] |= fixedMask;
  }

  for (let i = 0; i < rootCount; i++) {
    const root = roots[i];
    const fixedMask = shardFixedValueMasks[root];
    let regionMask = shardMasks[root];
    if (!fixedMask || isFixed(regionMask)) continue;

    let keepMask = regionMask;
    let values = regionMask;
    while (values) {
      const regionBit = values & -values;
      values ^= regionBit;
      if (fixedValues[LookupTables.toIndex(regionBit)] & fixedMask) keepMask &= ~regionBit;
    }

    if (!keepMask) return false;
    if (keepMask === regionMask) continue;
    shardMasks[root] = keepMask;
    if (!restrictShardRegionMask.call(this, grid, rootOfCell, root, keepMask, handlerAccumulator)) {
      return false;
    }
  }

  return true;
};

const enforceShardRegionCapacity = function (grid, handlerAccumulator) {
  const rootCount = this._shardRegionInvariantRootCount;
  const roots = this._shardRegionInvariantRoots;
  const rootOfCell = this._shardRegionInvariantRootOfCell;
  const shardSizes = this._shardRegionInvariantSizes;
  const shardMasks = this._shardRegionInvariantMasks;
  const fixedWeights = this._shardRegionInvariantFixedWeights ??= new Uint16Array(this._numRegions);
  const possibleWeights = this._shardRegionInvariantPossibleWeights ??= new Uint16Array(this._numRegions);
  fixedWeights.fill(0);
  possibleWeights.fill(0);

  for (let i = 0; i < rootCount; i++) {
    const root = roots[i];
    const regionMask = shardMasks[root];
    const shardSize = shardSizes[root];
    if (isFixed(regionMask)) {
      fixedWeights[LookupTables.toIndex(regionMask)] += shardSize;
    } else {
      let values = regionMask;
      while (values) {
        const regionBit = values & -values;
        values ^= regionBit;
        possibleWeights[LookupTables.toIndex(regionBit)] += shardSize;
      }
    }
  }

  for (let region = 0; region < this._numRegions; region++) {
    if (fixedWeights[region] > this._regionSize) return false;
    if (fixedWeights[region] + possibleWeights[region] < this._regionSize) return false;
  }

  for (let i = 0; i < rootCount; i++) {
    const root = roots[i];
    let regionMask = shardMasks[root];
    if (isFixed(regionMask)) continue;

    const shardSize = shardSizes[root];
    let keepMask = regionMask;
    let requiredMask = 0;
    let values = regionMask;
    while (values) {
      const regionBit = values & -values;
      values ^= regionBit;
      const region = LookupTables.toIndex(regionBit);
      if (fixedWeights[region] + shardSize > this._regionSize) {
        keepMask &= ~regionBit;
      } else if (fixedWeights[region] + possibleWeights[region] - shardSize < this._regionSize) {
        requiredMask |= regionBit;
      }
    }

    if (requiredMask) {
      if (!isFixed(requiredMask)) return false;
      keepMask &= requiredMask;
    }
    if (!keepMask) return false;
    if (keepMask === regionMask) continue;

    shardMasks[root] = keepMask;
    if (!restrictShardRegionMask.call(this, grid, rootOfCell, root, keepMask, handlerAccumulator)) {
      return false;
    }
  }

  return true;
};

const nextShardRegionInvariantVisitId = function () {
  let visitId = (this._shardRegionInvariantVisitId ?? 0) + 1;
  if (visitId === this.constructor._NO_CELL) {
    this._shardRegionInvariantVisitMarks.fill(0);
    visitId = 1;
  }
  this._shardRegionInvariantVisitId = visitId;
  return visitId;
};

const collectShardRegionComponent = function (startRoot, regionBit, visitId) {
  const rootOfCell = this._shardRegionInvariantRootOfCell;
  const shardSizes = this._shardRegionInvariantSizes;
  const shardMasks = this._shardRegionInvariantMasks;
  const visitMarks = this._shardRegionInvariantVisitMarks;
  const queue = this._shardRegionInvariantQueue;
  const componentRoots = this._shardRegionInvariantComponentRoots;
  const neighbors = this._neighbors;
  const noCell = this.constructor._NO_CELL;
  let queueStart = 0;
  let queueEnd = 0;
  let componentCount = 0;
  let componentWeight = 0;

  visitMarks[startRoot] = visitId;
  queue[queueEnd++] = startRoot;

  while (queueStart < queueEnd) {
    const root = queue[queueStart++];
    componentRoots[componentCount++] = root;
    componentWeight += shardSizes[root];

    for (let cell = 0; cell < this._numGridCells; cell++) {
      if (rootOfCell[cell] !== root) continue;
      const neighborOffset = cell << 2;
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighbors[neighborOffset + dir];
        if (neighbor === noCell) continue;
        const neighborRoot = rootOfCell[neighbor];
        if (visitMarks[neighborRoot] === visitId) continue;
        if (!(shardMasks[neighborRoot] & regionBit)) continue;
        visitMarks[neighborRoot] = visitId;
        queue[queueEnd++] = neighborRoot;
      }
    }
  }

  return { componentCount, componentWeight };
};

const enforceShardRegionConnectivity = function (grid, handlerAccumulator) {
  const numGridCells = this._numGridCells;
  const rootCount = this._shardRegionInvariantRootCount;
  const roots = this._shardRegionInvariantRoots;
  const rootOfCell = this._shardRegionInvariantRootOfCell;
  const shardMasks = this._shardRegionInvariantMasks;
  this._shardRegionInvariantVisitMarks ??= new Uint16Array(numGridCells);
  this._shardRegionInvariantQueue ??= new Uint16Array(numGridCells);
  this._shardRegionInvariantComponentRoots ??= new Uint16Array(numGridCells);
  const visitMarks = this._shardRegionInvariantVisitMarks;
  const componentRoots = this._shardRegionInvariantComponentRoots;

  for (let region = 0; region < this._numRegions; region++) {
    const regionBit = 1 << region;
    let candidateCount = 0;
    let fixedCount = 0;
    let firstFixedRoot = this.constructor._NO_CELL;
    for (let i = 0; i < rootCount; i++) {
      const root = roots[i];
      const regionMask = shardMasks[root];
      if (!(regionMask & regionBit)) continue;
      candidateCount++;
      if (regionMask === regionBit) {
        fixedCount++;
        if (firstFixedRoot === this.constructor._NO_CELL) firstFixedRoot = root;
      }
    }

    if (!candidateCount) return false;
    const visitId = nextShardRegionInvariantVisitId.call(this);
    if (fixedCount) {
      const { componentWeight } = collectShardRegionComponent.call(
        this, firstFixedRoot, regionBit, visitId);
      if (componentWeight < this._regionSize) return false;

      for (let i = 0; i < rootCount; i++) {
        const root = roots[i];
        if (shardMasks[root] === regionBit && visitMarks[root] !== visitId) return false;
      }

      for (let i = 0; i < rootCount; i++) {
        const root = roots[i];
        const regionMask = shardMasks[root];
        if (!(regionMask & regionBit)) continue;

        if (visitMarks[root] !== visitId) {
          const keepMask = regionMask & ~regionBit;
          if (!keepMask) return false;
          shardMasks[root] = keepMask;
          if (!restrictShardRegionMask.call(
            this, grid, rootOfCell, root, keepMask, handlerAccumulator)) return false;
        } else if (componentWeight === this._regionSize && regionMask !== regionBit) {
          shardMasks[root] = regionBit;
          if (!restrictShardRegionMask.call(
            this, grid, rootOfCell, root, regionBit, handlerAccumulator)) return false;
        }
      }
    } else {
      let hasViableComponent = false;
      for (let i = 0; i < rootCount; i++) {
        const root = roots[i];
        if (!(shardMasks[root] & regionBit)) continue;
        if (visitMarks[root] === visitId) continue;

        const { componentCount, componentWeight } = collectShardRegionComponent.call(
          this, root, regionBit, visitId);
        if (componentWeight >= this._regionSize) {
          hasViableComponent = true;
          continue;
        }

        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
          const componentRoot = componentRoots[componentIndex];
          const keepMask = shardMasks[componentRoot] & ~regionBit;
          if (!keepMask) return false;
          shardMasks[componentRoot] = keepMask;
          if (!restrictShardRegionMask.call(
            this, grid, rootOfCell, componentRoot, keepMask, handlerAccumulator)) return false;
        }
      }

      if (!hasViableComponent) return false;
    }
  }

  return true;
};

const enforceShardRegionInvariants = function (grid, handlerAccumulator) {
  if (!collectShardRegionInvariantState.call(this, grid)) return false;
  if (this._regionShardOffset === undefined) return true;
  if (this._shardRegionInvariantFixedValuesEnabled
    && !enforceShardFixedValueInvariants.call(this, grid, handlerAccumulator)) return false;
  if (this._shardRegionInvariantCapacityEnabled
    && !enforceShardRegionCapacity.call(this, grid, handlerAccumulator)) return false;
  if (this._shardRegionInvariantConnectivityEnabled) {
    return enforceShardRegionConnectivity.call(this, grid, handlerAccumulator);
  }
  return true;
};

const enforceConsistencyShardRegionInvariants = function (grid, handlerAccumulator) {
  if (!originalMethods.enforceConsistency.call(this, grid, handlerAccumulator)) return false;

  while (true) {
    this._changed = false;
    if (!this._enforceShardRegionInvariants(grid, handlerAccumulator)) return false;
    if (!this._changed) return true;
    if (!originalMethods.enforceConsistency.call(this, grid, handlerAccumulator)) return false;
  }
};

const installShardRegionInvariants = ({
  fixedValues = true,
  capacity = true,
  connectivity = true,
} = {}) => {
  ChaosConstruction.prototype._enforceShardRegionInvariants = enforceShardRegionInvariants;
  ChaosConstruction.prototype._shardRegionInvariantFixedValuesEnabled = fixedValues;
  ChaosConstruction.prototype._shardRegionInvariantCapacityEnabled = capacity;
  ChaosConstruction.prototype._shardRegionInvariantConnectivityEnabled = connectivity;
  ChaosConstruction.prototype.enforceConsistency = enforceConsistencyShardRegionInvariants;
};

const applyVariant = (variant) => {
  restoreChaosPrototype();
  switch (variant) {
    case 'full':
      break;
    case 'no-chaos-state-caches':
      installWithoutChaosStateCaches();
      break;
    case 'no-connectivity-input-cache':
    case 'no-possible-count-cache':
      installWithoutPossibleCountCache();
      break;
    case 'connectivity-input-cache':
    case 'possible-count-cache':
      break;
    case 'connectivity-cell-cache':
      installConnectivityCellCache();
      break;
    case 'lazy-connectivity-candidates':
      ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesLazyConnectivity;
      break;
    case 'no-fixed-value-region-singletons':
      installWithoutFixedValueRegionSingletonHandlers();
      break;
    case 'nfa-region-runs':
      installNfaRegionRuns();
      break;
    case 'nfa-region-controls':
      installNfaRegionRuns({ controlOnly: true });
      break;
    case 'nfa-region-runs-fixed':
      installNfaRegionRuns({ fixedOnly: true });
      break;
    case 'nfa-shard-relations':
      installNfaShardRelations();
      break;
    case 'nfa-shard-relations-fixed':
      installNfaShardRelations({ probeControls: false });
      break;
    case 'nfa-shard-relations-min-prefix':
      installNfaShardRelations({
        probeControls: false,
        minPrefix: true,
        supportMinPrefix: true,
      });
      break;
    case 'nfa-shard-relations-min-prefix-basic':
      installNfaShardRelations({
        probeControls: false,
        minPrefix: true,
        supportMinPrefix: true,
        basicModel: true,
        sameOnly: true,
      });
      break;
    case 'nfa-shard-relations-controls':
      installNfaShardRelations({ applyModel: false });
      break;
    case 'nfa-shard-relations-controls-basic':
      installNfaShardRelations({ applyModel: false, basicModel: true });
      break;
    case 'nfa-shard-relations-controls-same-basic':
      installNfaShardRelations({ applyModel: false, basicModel: true, sameOnly: true });
      break;
    case 'nfa-shard-relations-controls-no-capacity':
      installNfaShardRelations({ applyModel: false, capacityModel: false });
      break;
    case 'nfa-shard-relations-controls-no-value-apart':
      installNfaShardRelations({ applyModel: false, valueApart: false });
      break;
    case 'nfa-shard-relations-controls-local-prefix':
      installNfaShardRelations({ applyModel: false, probeLocalPrefix: true });
      break;
    case 'nfa-shard-relations-controls-sparse-basic':
      installNfaShardRelations({ applyModel: false, probeSparseBasic: true });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-max2':
      installNfaShardRelations({ applyModel: false, probeSparseBasic: true, probeMaxValues: 2 });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-max3':
      installNfaShardRelations({ applyModel: false, probeSparseBasic: true, probeMaxValues: 3 });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-max4':
      installNfaShardRelations({ applyModel: false, probeSparseBasic: true, probeMaxValues: 4 });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-runs':
      installNfaShardRelations({ applyModel: false, probeSparseBasic: true, alsoRegionRuns: true });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-max4-runs':
      installNfaShardRelations({
        applyModel: false,
        probeSparseBasic: true,
        probeMaxValues: 4,
        alsoRegionRuns: true,
      });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-overlap':
      installNfaShardRelations({
        applyModel: false,
        probeSparseBasic: true,
        probeRequiresOverlap: true,
      });
      break;
    case 'nfa-shard-relations-controls-sparse-basic-max4-overlap':
      installNfaShardRelations({
        applyModel: false,
        probeSparseBasic: true,
        probeMaxValues: 4,
        probeRequiresOverlap: true,
      });
      break;
    case 'nfa-shard-relations-controls-sparse-no-capacity':
      installNfaShardRelations({ applyModel: false, probeSparseNoCapacity: true });
      break;
    case 'nfa-shard-relations-controls-no-capacity-pooled':
      installNfaShardRelations({ applyModel: false, probePooledNoCapacity: true });
      break;
    case 'nfa-shard-relations-controls-no-capacity-pooled-base':
      installNfaShardRelations({ applyModel: false, probePooledNoCapacityBase: true });
      break;
    case 'nfa-shard-relations-controls-no-capacity-pooled-base-skip-fixed':
      installNfaShardRelations({
        applyModel: false,
        probePooledNoCapacityBase: true,
        probePooledNoCapacityBaseSkipFixed: true,
      });
      break;
    case 'nfa-shard-relations-controls-no-capacity-pooled-base-skip-fixed-runs':
      installNfaShardRelations({
        applyModel: false,
        probePooledNoCapacityBase: true,
        probePooledNoCapacityBaseSkipFixed: true,
        alsoRegionRuns: true,
      });
      break;
    case 'nfa-shard-relations-controls-no-capacity-pooled-max2':
      installNfaShardRelations({
        applyModel: false,
        probePooledNoCapacity: true,
        probeMaxValues: 2,
      });
      break;
    case 'nfa-shard-relations-controls-no-capacity-pooled-max3':
      installNfaShardRelations({
        applyModel: false,
        probePooledNoCapacity: true,
        probeMaxValues: 3,
      });
      break;
    case 'shard-region-invariants':
      installShardRegionInvariants();
      break;
    case 'shard-region-fixed-values':
      installShardRegionInvariants({ capacity: false, connectivity: false });
      break;
    case 'shard-region-capacity':
      installShardRegionInvariants({ fixedValues: false, connectivity: false });
      break;
    case 'shard-region-connectivity':
      installShardRegionInvariants({ fixedValues: false, capacity: false });
      break;
    case 'fixed-value-region-handlers':
      installFixedValueRegionHandlers();
      break;
    case 'fixed-value-region-state-cached-handlers':
      installFixedValueRegionStateCachedHandlers();
      break;
    case 'fixed-value-region-ordinary-handlers':
      installFixedValueRegionOrdinaryHandlers();
      break;
    case 'fixed-value-region-aux-handlers':
      installFixedValueRegionAuxHandlers();
      break;
    case 'size-prescan':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencySizePrescan;
      break;
    case 'scan-size-combined':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyScanSizeCombined;
      break;
    case 'canonical-once':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyCanonicalOnce;
      break;
    case 'canonical-once+scan-size-combined':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyCanonicalOnceScanSizeCombined;
      break;
    case 'single-pass':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencySinglePass;
      break;
    case 'single-scan':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencySingleScan;
      break;
    case 'connectivity-fixed-point':
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyConnectivityFixedPoint;
      break;
    case 'no-distance':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'connectivity-limited-distance':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityLimitedDistance;
      break;
    case 'connectivity-dirty-no-distance':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityDirtyNoDistance;
      break;
    case 'connectivity-deferred-region-masks':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityDeferredRegionMasks;
      break;
    case 'connectivity-fixed-regions-only':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityFixedRegionsOnly;
      break;
    case 'connectivity-no-pruning':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityNoPruning;
      break;
    case 'connectivity-no-exact-forcing':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityNoExactForcing;
      break;
    case 'connectivity-no-small-component-pruning':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityNoSmallComponentPruning;
      break;
    case 'connectivity-diameter-distance':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithDiameterDistance;
      break;
    case 'connectivity-fast-diameter-distance':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithFastDiameterDistance;
      break;
    case 'connectivity-fixed-diameter-distance':
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithFixedDiameterDistance;
      break;
    case 'connectivity-scan-fixed-roots':
      ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithFixedRoots;
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithScanFixedRoots;
      break;
    case 'shards-skip-known-fixed-merges':
      ChaosConstruction.prototype._updateFixedRegionShards = updateFixedRegionShardsSkipKnownMerges;
      break;
    case 'canonical-validation-only':
      ChaosConstruction.prototype._enforceCanonicalOrder = validateCanonicalAtFullState;
      break;
    case 'canonical-early-bail':
      ChaosConstruction.prototype._enforceCanonicalOrder = enforceCanonicalOrderEarlyBail;
      break;
    case 'anchor-sym-identity':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'identity'));
      break;
    case 'anchor-sym-rot90':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'rot90'));
      break;
    case 'anchor-sym-rot180':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'rot180'));
      break;
    case 'anchor-sym-rot270':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'rot270'));
      break;
    case 'anchor-sym-reflect-rows':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'reflectRows'));
      break;
    case 'anchor-sym-reflect-cols':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'reflectCols'));
      break;
    case 'anchor-sym-transpose':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'transpose'));
      break;
    case 'anchor-sym-antitranspose':
      installAnchorSelector(shape => transformedAnchorCells(shape, 'antiTranspose'));
      break;
    case 'anchor-priority-symmetry':
      installPriorityAwareAnchors(chooseBestScoredSymmetryAnchors);
      break;
    case 'anchor-priority-any-triple':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 0));
      break;
    case 'anchor-priority-edge-triple':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2));
      break;
    case 'anchor-priority-edge3-triple':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 3));
      break;
    case 'anchor-priority-edge-triple-early':
      installPriorityAwareAnchors(
        (shape, scores) => chooseBestScoredSeparatedTriple(shape, scores, 1, null, 2));
      break;
    case 'anchor-priority-edge-fixed-first':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 1, transformedAnchorCells(shape, 'identity')[0], 2));
      break;
    case 'anchor-priority-greedy-edge':
      installPriorityAwareAnchors((shape, scores) => chooseGreedyScoredAnchors(shape, scores, 2));
      break;
    case 'anchor-priority-edge-pair-third':
      installPriorityAwareAnchors(chooseBestScoredEdgePairThenThird);
      break;
    case 'anchor-priority-best-first-edge':
      installPriorityAwareAnchors((shape, scores) => chooseBestFirstEdgePairAnchors(shape, scores, 2));
      break;
    case 'anchor-priority-top12-edge':
      installPriorityAwareAnchors((shape, scores) => chooseTopKScoredSeparatedTriple(shape, scores, 12, 2));
      break;
    case 'anchor-priority-top20-edge':
      installPriorityAwareAnchors((shape, scores) => chooseTopKScoredSeparatedTriple(shape, scores, 20, 2));
      break;
    case 'anchor-priority-local2':
      installPriorityAwareAnchors((shape, scores) => chooseBestLocalScoredAnchors(shape, scores, 2, 2));
      break;
    case 'anchor-priority-local3':
      installPriorityAwareAnchors((shape, scores) => chooseBestLocalScoredAnchors(shape, scores, 3, 2));
      break;
    case 'anchor-priority-edge-g1-r0':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2), 1, 0);
      break;
    case 'anchor-priority-edge-g0-r1':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2), 0, 1);
      break;
    case 'anchor-priority-edge-g2-r1':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2), 2, 1);
      break;
    case 'anchor-priority-edge-g1-r2':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2), 1, 2);
      break;
    case 'anchor-priority-edge-g4-r1':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2), 4, 1);
      break;
    case 'anchor-priority-edge-g1-r4':
      installPriorityAwareAnchors((shape, scores) => chooseBestScoredSeparatedTriple(
        shape, scores, 0, null, 2), 1, 4);
      break;
    case 'corner-anchors':
      ChaosConstruction.prototype._enforceCanonicalOrder = enforceCanonicalOrderCornerAnchors;
      break;
    case 'size-validation-only':
      ChaosConstruction.prototype._enforceRegionSizes = validateRegionSizesAtFullState;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-counts-only':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      break;
    case 'size-no-complete-cache':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoExactPossible;
      break;
    case 'size-complete-handlers':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      installCompletedRegionHandlers();
      break;
    case 'size-complete-singletons':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      installCompletedRegionSingletonHandlers();
      break;
    case 'size-no-full':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoFullRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-no-exact':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoExactPossible;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-dirty-exact-possible':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeDirtyExactPossible;
      break;
    case 'size-hall-subsets':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeHallSubsets;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-hall-pairs':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeHallPairs;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-hall-triples':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeHallTriples;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-hall-pairs-incremental':
      installIncrementalHallSizes(enforceRegionSizeIncrementalHallPairs, 2);
      break;
    case 'size-hall-triples-incremental':
      installIncrementalHallSizes(enforceRegionSizeIncrementalHallTriples, 3);
      break;
    case 'size-hall-subsets-incremental':
      installIncrementalHallSizes(enforceRegionSizeIncrementalHallSubsets, null);
      break;
    case 'size-hall-pairs-validation-incremental':
      installIncrementalHallSizes(validateRegionSizeIncrementalHallPairs, 2);
      break;
    case 'size-hall-triples-validation-incremental':
      installIncrementalHallSizes(validateRegionSizeIncrementalHallTriples, 3);
      break;
    case 'size-hall-subsets-validation-incremental':
      installIncrementalHallSizes(validateRegionSizeIncrementalHallSubsets, null);
      break;
    case 'connectivity-validation-only':
      ChaosConstruction.prototype._enforceConnectivity = validateConnectivityAtFullState;
      break;
    case 'value-validation-only':
      ChaosConstruction.prototype._enforceRegionValuePairs = validateRegionValuePairsAtFullState;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-counts-only':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairCountsOnly;
      break;
    case 'value-bitmasks':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairBitMasks;
      break;
    case 'no-fixed-value-mask':
      ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithoutFixedValueMask;
      break;
    case 'no-fixed-value-mask+ordinary-fixed-pair':
      installFixedValueRegionOrdinaryHandlers();
      ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithoutFixedValueMask;
      break;
    case 'no-fixed-value-mask+extra-ordinary-fixed-pair':
      installAdditionalFixedValueRegionOrdinaryHandlers();
      ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithoutFixedValueMask;
      break;
    case 'no-fixed-value-mask+fixed-pair-conflict-check':
      installFixedValueRegionConflictChecks();
      ChaosConstruction.prototype._scanRegionCandidates = scanRegionCandidatesWithoutFixedValueMask;
      break;
    case 'value-fixed-region-exclusion':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedRegionExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-fixed-region-global-only':
      installWithoutFixedValueRegionSingletonHandlers();
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedRegionExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-fixed-region-global+singletons':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedRegionExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-fixed-pair-exclusion':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedPairExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'fixed-region-singletons':
      installFixedRegionSingletonHandlers();
      break;
    case 'candidate-min-count':
      installCandidateMinCount();
      break;
    case 'candidate-no-linked-boost':
      installCandidateNoLinkedBoost();
      break;
    case 'candidate-no-value-score':
      installCandidateNoValueScore();
      break;
    case 'candidate-no-custom-finders':
      installCandidateNoCustomFinders();
      break;
    case 'priority-grid':
      installChaosPriorityHandlers(1000, null);
      break;
    case 'priority-grid-100':
      installChaosPriorityHandlers(100, null);
      break;
    case 'priority-grid-10':
      installChaosPriorityHandlers(10, null);
      break;
    case 'priority-grid-low':
      installChaosPriorityHandlers(1, null);
      break;
    case 'priority-grid-zero':
      installChaosPriorityHandlers(0, null);
      break;
    case 'priority-region':
      installChaosPriorityHandlers(null, 1000);
      break;
    case 'priority-region-100':
      installChaosPriorityHandlers(null, 100);
      break;
    case 'priority-region-10':
      installChaosPriorityHandlers(null, 10);
      break;
    case 'priority-region-low':
      installChaosPriorityHandlers(null, 1);
      break;
    case 'priority-region-zero':
      installChaosPriorityHandlers(null, 0);
      break;
    case 'priority-grid-region-low':
      installChaosPriorityHandlers(1000, 1);
      break;
    case 'priority-grid100-region-low':
      installChaosPriorityHandlers(100, 1);
      break;
    case 'priority-grid10-region-low':
      installChaosPriorityHandlers(10, 1);
      break;
    case 'priority-grid-region-zero':
      installChaosPriorityHandlers(1000, 0);
      break;
    case 'priority-grid-low-region-high':
      installChaosPriorityHandlers(1, 1000);
      break;
    case 'priority-chaos-low':
      installChaosPriorityHandlers(1, 1);
      break;
    case 'priority-chaos-zero':
      installChaosPriorityHandlers(0, 0);
      break;
    case 'priority-chaos-handler-0':
      installChaosHandlerPriority(0);
      break;
    case 'priority-chaos-handler-1':
      installChaosHandlerPriority(1);
      break;
    case 'priority-chaos-handler-10':
      installChaosHandlerPriority(10);
      break;
    case 'priority-chaos-handler-50':
      installChaosHandlerPriority(50);
      break;
    case 'priority-chaos-handler-500':
      installChaosHandlerPriority(500);
      break;
    case 'priority-xsum-controls':
      installXSumControlPriorityHandlers(1000);
      break;
    case 'priority-xsum-controls-region-low':
      installXSumControlPriorityHandlers(1000, 1);
      break;
    case 'priority-nfa-grid-anchors':
      installNfaGridAnchorPriorityHandlers(1000);
      break;
    case 'priority-nfa-grid-anchors-region-low':
      installNfaGridAnchorPriorityHandlers(1000, 1);
      break;
    case 'priority-grid+no-distance':
      installChaosPriorityHandlers(1000, null);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'priority-region+no-distance':
      installChaosPriorityHandlers(null, 1000);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'priority-grid-region-low+no-distance':
      installChaosPriorityHandlers(1000, 1);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'priority-xsum-controls+no-distance':
      installXSumControlPriorityHandlers(1000);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'priority-xsum-controls-region-low+no-distance':
      installXSumControlPriorityHandlers(1000, 1);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'priority-nfa-grid-anchors+no-distance':
      installNfaGridAnchorPriorityHandlers(1000);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'priority-nfa-grid-anchors-region-low+no-distance':
      installNfaGridAnchorPriorityHandlers(1000, 1);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      break;
    case 'value-fixed-region-exclusion+priority-grid-region-low+no-distance':
      installChaosPriorityHandlers(1000, 1);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedRegionExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-fixed-region-exclusion+priority-xsum-controls':
      installXSumControlPriorityHandlers(1000);
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedRegionExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-fixed-region-exclusion+priority-nfa-grid-anchors':
      installNfaGridAnchorPriorityHandlers(1000);
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsFixedRegionExclusion;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-prune-fixed-regions+priority-grid-region-low+no-distance':
      installChaosPriorityHandlers(1000, 1);
      ChaosConstruction.prototype._enforceConnectivity = enforceConnectivityWithoutDistance;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneFixedRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-prune-fixed-regions+priority-xsum-controls':
      installXSumControlPriorityHandlers(1000);
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneFixedRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-prune-fixed-regions+priority-nfa-grid-anchors':
      installNfaGridAnchorPriorityHandlers(1000);
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneFixedRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-no-hidden-singles':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsNoHiddenSingles;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-no-fixed-pruning':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsNoFixedValuePruning;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-prune-fixed-regions':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneFixedRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-prune-tight-regions':
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneTightRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'value-prune-fixed-dirty-regions':
      installValueInputCache(enforceRegionValuePairsDirtyPruneFixedRegions);
      break;
    case 'value-prune-tight-dirty-regions':
      installValueInputCache(enforceRegionValuePairsDirtyPruneTightRegions);
      break;
    case 'value-prune-fixed-dirty-incremental':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyPruneFixedRegions);
      break;
    case 'value-prune-tight-dirty-incremental':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyPruneTightRegions);
      break;
    case 'value-prune-fixed-dirty-counts':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyPruneFixedRegions, true);
      break;
    case 'value-prune-tight-dirty-counts':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyPruneTightRegions, true);
      break;
    case 'value-hidden-dirty-counts':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyHiddenSingles, true);
      break;
    case 'value-hidden-dirty-incremental':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyHiddenSingles);
      break;
    case 'value-hidden-fixed-dirty-counts':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyHiddenFixedRegions, true);
      break;
    case 'value-hidden-tight-dirty-counts':
      installIncrementalValueCounts(enforceRegionValuePairsIncrementalDirtyHiddenTightRegions, true);
      break;
    case 'size-counts-only+value-counts-only':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairCountsOnly;
      break;
    case 'size-counts-only+value-bitmasks':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairBitMasks;
      break;
    case 'size-no-full+value-counts-only':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoFullRegions;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairCountsOnly;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-no-full+value-no-hidden-singles':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoFullRegions;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsNoHiddenSingles;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-no-full+value-no-fixed-pruning':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeNoFullRegions;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsNoFixedValuePruning;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-hall-subsets+value-counts-only':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeHallSubsets;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairCountsOnly;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-hall-pairs+value-counts-only':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeHallPairs;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairCountsOnly;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-hall-triples+value-counts-only':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeHallTriples;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairCountsOnly;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-counts-only+value-prune-fixed-regions':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneFixedRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'size-counts-only+value-prune-tight-regions':
      ChaosConstruction.prototype._enforceRegionSizes = enforceRegionSizeCountsOnly;
      ChaosConstruction.prototype._enforceRegionValuePairs = enforceRegionValuePairsPruneTightRegions;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    case 'validation-only':
      ChaosConstruction.prototype._enforceCanonicalOrder = validateCanonicalAtFullState;
      ChaosConstruction.prototype._enforceRegionSizes = validateRegionSizesAtFullState;
      ChaosConstruction.prototype._enforceConnectivity = validateConnectivityAtFullState;
      ChaosConstruction.prototype._enforceRegionValuePairs = validateRegionValuePairsAtFullState;
      ChaosConstruction.prototype.enforceConsistency = enforceConsistencyMutatingPhases;
      break;
    default:
      throw new Error(`Unknown chaos ablation variant: ${variant}`);
  }
};

const solutionString = (grid, shape) => {
  if (!grid) return '';
  let result = '';
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    const mask = grid[cell];
    result += isFixed(mask) ? String(LookupTables.toOffsetValue(mask, shape.valueOffset)) : '?';
  }
  return result;
};

const installGuessProfiler = (solver, shape, traceLimit) => {
  const guessProfile = {
    gridGuesses: 0,
    extraGuesses: 0,
    guessTrace: [],
  };
  const selector = solver._internalSolver._candidateSelector;
  const selectNextCandidate = selector.selectNextCandidate.bind(selector);
  selector.selectNextCandidate = function (...args) {
    const cellDepth = args[0];
    const gridState = args[1];
    const result = selectNextCandidate(...args);
    const value = result[1];
    const count = result[2];
    if (count > 1) {
      const cell = selector.getCellAtDepth(cellDepth);
      if (cell < shape.numGridCells) {
        guessProfile.gridGuesses++;
      } else {
        guessProfile.extraGuesses++;
      }
      if (guessProfile.guessTrace.length < traceLimit) {
        guessProfile.guessTrace.push([
          shape.makeCellIdFromIndex(cell),
          count,
          gridState[cell].toString(16),
          value.toString(16),
        ].join(':'));
      }
    }
    return result;
  };
  return guessProfile;
};

const solveMode = (maxBacktracks) => {
  const mode = {};
  if (maxBacktracks) mode.maxBacktracks = maxBacktracks;
  return Object.keys(mode).length ? mode : null;
};

const solvePuzzle = (puzzle, variant, maxBacktracks, guessProfileEnabled) => {
  applyVariant(variant);
  const constraint = SudokuParser.parseText(puzzle.input);
  const shape = constraint.getShape();
  const solver = SudokuBuilder.build(constraint);
  const guessProfile = guessProfileEnabled
    ? installGuessProfiler(solver, shape, args.guessTrace)
    : null;
  let solutionGrid = null;
  const start = performance.now();
  solver._internalSolver.run(solveMode(maxBacktracks), (grid) => {
    if (!solutionGrid) solutionGrid = grid.slice(0, shape.numGridCells);
  });
  const elapsedMs = performance.now() - start;
  const counters = { ...solver._internalSolver.counters };
  const exhausted = solver._internalSolver.state === solver._internalSolver.constructor.STATE_EXHAUSTED;
  const found = !!solutionGrid;
  const actualSolution = solutionString(solutionGrid, shape);
  const expectedSolution = puzzle.solution ?? '';
  const matchesExpected = found && (!expectedSolution || actualSolution === expectedSolution);
  const capped = !exhausted && maxBacktracks > 0 && counters.backtracks >= maxBacktracks;
  const status = capped
    ? 'capped'
    : !found
      ? 'no-solution'
      : !matchesExpected
        ? 'wrong'
        : counters.solutions !== 1
          ? 'multiple'
          : 'ok';
  restoreChaosPrototype();
  return { puzzle: puzzle.name, variant, status, exhausted, elapsedMs, ...counters, ...guessProfile };
};

const printUsage = () => {
  console.log(`Usage: node tests/bench/chaos_ablation.js [options]

Options:
  --puzzles <names>         Comma-separated puzzle names.
                            Use "chaos-ladder" for generated 9x9 ladder points.
  --variants <names>        Comma-separated variants.
  --max-backtracks <n>      Stop any run after this many backtracks.
  --guess-profile           Count guesses on grid cells vs extra state cells.
  --guess-trace <n>         Print the first n guesses as cell:count:mask:value.

Default puzzles:
  ${DEFAULT_PUZZLES.join(', ')}

Default variants:
  ${DEFAULT_VARIANTS.join(', ')}

Generated puzzle alias:
  chaos-ladder = ${DEFAULT_CHAOS_LADDER_COUNTS.map(count => `${CHAOS_LADDER_ALIAS} ${count}`).join(', ')}
  chaos-killer-ladder = ${DEFAULT_CHAOS_KILLER_LADDER_COUNTS.map(count => `${CHAOS_KILLER_LADDER_ALIAS} ${count}`).join(', ')}
  chaos-x-sums-ladder = ${DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS.map(count => `${CHAOS_X_SUMS_LADDER_ALIAS} ${count}`).join(', ')}
`);
};

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
  process.exit(0);
}

const puzzles = resolveChaosBenchmarkPuzzles(EXAMPLES, args.puzzles);

const columns = [
  'puzzle',
  'variant',
  'status',
  'solutions',
  'guesses',
  'backtracks',
  'nodes',
  'constraints',
  'ms',
];
if (args.guessProfile) columns.push('gridGuesses', 'extraGuesses');
console.log(columns.join('\t'));

for (const puzzle of puzzles) {
  for (const variant of args.variants) {
    const result = solvePuzzle(puzzle, variant, args.maxBacktracks, args.guessProfile);
    const row = [
      result.puzzle,
      result.variant,
      result.status,
      result.solutions,
      result.guesses,
      result.backtracks,
      result.nodesSearched,
      result.constraintsProcessed,
      result.elapsedMs.toFixed(2),
    ];
    if (args.guessProfile) row.push(result.gridGuesses, result.extraGuesses);
    console.log(row.join('\t'));
    if (args.guessTrace) {
      console.log(['trace', result.puzzle, result.variant, result.guessTrace.join(' ')].join('\t'));
    }
  }
}
