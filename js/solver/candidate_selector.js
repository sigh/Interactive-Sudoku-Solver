const { countOnes16bit, RandomIntGenerator } = await import('../util.js' + self.VERSION_PARAM);
const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);

export class SeenCandidateSet {
  constructor(numCells, numValues) {
    this.enabledInSolver = false;
    this.candidates = new Uint16Array(numCells);
    this._lastInterestingCell = 0;
    this._dirty = false;

    this._numCells = numCells;
    this._numValues = numValues;
    this._candidateSupportThreshold = 1;
    this._candidateCounts = new Uint8Array(numCells * numValues);
  }

  getCandidateCounts() {
    return this._candidateCounts;
  }

  reset() {
    if (!this._dirty) return;

    this._dirty = false;
    this.enabledInSolver = false;
    this.candidates.fill(0);
    this._candidateCounts.fill(0);
    this._lastInterestingCell = 0;
  }

  resetWithThreshold(candidateSupportThreshold) {
    if (candidateSupportThreshold < 1 || candidateSupportThreshold > 255) {
      throw new Error(
        `candidateSupportThreshold must be between 1 and 255, got ${candidateSupportThreshold}`);
    }
    this._candidateSupportThreshold = candidateSupportThreshold;
    this.reset();
  }

  addSolutionGrid(grid) {
    const candidates = this.candidates;
    const counts = this._candidateCounts;
    const numCells = this._numCells;
    const numValues = this._numValues;
    const threshold = this._candidateSupportThreshold;

    for (let i = 0; i < numCells; i++) {
      const value = grid[i];
      const countIndex = i * numValues + LookupTables.toIndex(value);
      const incrementedCount = counts[countIndex] + 1;
      // Saturate at threshold to avoid overflow.
      if (incrementedCount <= threshold) {
        counts[countIndex] = incrementedCount;
        // Set bitmask when threshold reached (for hasInterestingSolutions).
        if (incrementedCount === threshold) {
          candidates[i] |= value;
        }
      }
    }

    this._dirty = true;
  }

  hasInterestingSolutions(grid) {
    const candidates = this.candidates;

    // Check the last cell which was interesting, in case it is still
    // interesting.
    {
      const cell = this._lastInterestingCell;
      if (grid[cell] & ~candidates[cell]) return true;
    }

    // We need to check all cells because we maybe validating a cell above
    // us, or finding a value for a cell below us.
    const numCells = candidates.length;
    for (let cell = 0; cell < numCells; cell++) {
      if (grid[cell] & ~candidates[cell]) {
        this._lastInterestingCell = cell;
        return true;
      }
    }
    return false;
  }

  // Returns true if any already-fixed cell (those before cellDepth in
  // cellOrder) contains an interesting value.
  hasInterestingPrefix(grid, cellOrder, cellDepth) {
    const candidates = this.candidates;
    for (let i = 0; i < cellDepth; i++) {
      const cell = cellOrder[i];
      if (grid[cell] & ~candidates[cell]) return true;
    }
    return false;
  }
}

export class CandidateSelector {
  constructor(shape, handlerSet, debugLogger, seenCandidateSet) {
    this._shape = shape;
    this._cellOrder = new Uint8Array(shape.numCells);
    this._conflictScores = null;
    this._debugLogger = debugLogger;
    this._numCells = shape.numCells;
    this._optionSelector = null;
    this._seenCandidateSet = seenCandidateSet;

    this._candidateSelectionStates = this._initCandidateSelectionStates(shape);
    // _candidateSelectionFlags is used to track whether the
    // _candidateSelectionStates entry is valid.
    this._candidateSelectionFlags = new Uint8Array(shape.numCells);

    this._candidateFinderSet = new CandidateFinderSet(handlerSet, shape);
  }

  reset(conflictScores) {
    // Re-initialize the cell indexes in the cellOrder.
    // This is not required, but keeps things deterministic.
    const numCells = this._cellOrder.length;
    for (let i = 0; i < numCells; i++) {
      this._cellOrder[i] = i;
    }

    this._conflictScores = conflictScores;

    this._candidateSelectionFlags.fill(0);
  }

  getCellOrder(upto) {
    if (upto === undefined) return this._cellOrder;
    return this._cellOrder.subarray(0, upto);
  }

  getCellAtDepth(cellDepth) {
    return this._cellOrder[cellDepth];
  }

  // selectNextCandidate find the next candidate to try.
  // cellOrder will be updated such that cellOrder[cellDepth] is the next cell
  // to explore.
  // Returns [nextDepth, value, count]:
  //   nextDepth: Index into cellOrder passing all singletons.
  //   value: The candidate value in the nextCells[0].
  //   count: The number of options we selected from:
  //      - If `count` == 1, then this is a known value and the solver will
  //        not return to this node.
  //      - Most of the time, `count` will equal the number of values in
  //        nextCells[0], but it may be less if we are branching on something
  //        other than the cell (e.g. a digit within a house).
  selectNextCandidate(cellDepth, gridState, stepState, isNewNode) {
    const cellOrder = this._cellOrder;
    let [cellOffset, value, count] = this._selectBestCandidate(
      gridState, cellOrder, cellDepth, isNewNode);
    if (cellDepth === 0 && this._debugLogger.logLevel >= 2) {
      this._debugLogger.log({
        loc: 'selectNextCandidate',
        msg: 'Root node',
        args: {
          cell: cellOrder[cellOffset],
          value: LookupTables.toValue(value),
          count
        },
        cells: [cellOrder[cellOffset]],
      }, 2);
    }

    // Adjust the value for step-by-step.
    if (stepState) {
      if (this._debugLogger.enableStepLogs) {
        this._logSelectNextCandidate(
          'Best candidate:', cellOrder[cellOffset], value, count, cellDepth, isNewNode);
      }

      let adjusted = false;
      [cellOffset, value, adjusted] = this._adjustForStepState(
        stepState, gridState, cellOrder, cellDepth, cellOffset, value);

      if (adjusted) {
        count = countOnes16bit(gridState[cellOrder[cellOffset]]);
        this._candidateSelectionFlags[cellDepth] = 0;
        if (this._debugLogger.enableStepLogs) {
          this._logSelectNextCandidate(
            'Adjusted by user:', cellOrder[cellOffset], value, count, cellDepth, isNewNode);
        }
      }
    }

    const nextCellDepth = this._updateCellOrder(
      cellDepth, cellOffset, count, gridState);

    if (nextCellDepth === 0) {
      return [cellOrder, 0, 0];
    }

    if (this._debugLogger.enableStepLogs) {
      if (nextCellDepth !== cellDepth + 1) {
        this._debugLogger.log({
          loc: 'selectNextCandidate',
          msg: 'Found extra singles',
          args: {
            count: nextCellDepth - cellDepth - 1,
          },
          cells: cellOrder.subarray(cellDepth + 1, nextCellDepth),
        });
      }
    }

    return [nextCellDepth, value, count];
  }

  _updateCellOrder(cellDepth, cellOffset, count, grid) {
    const cellOrder = this._cellOrder;
    let frontOffset = cellDepth;

    // Swap cellOffset into the next position, so that it will be processed
    // next.
    [cellOrder[cellOffset], cellOrder[frontOffset]] =
      [cellOrder[frontOffset], cellOrder[cellOffset]];
    frontOffset++;
    cellOffset++;

    // A 0-domain cell is an immediate contradiction.
    if (count === 0) return 0;

    // If count was greater than 1, there were no singletons.
    if (count > 1) return frontOffset;

    // Move all singletons to the front of the cellOrder.
    const numCells = this._numCells;

    // First skip past any values which are already at the front.
    while (cellOffset === frontOffset && cellOffset < numCells) {
      const v = grid[cellOrder[cellOffset++]];
      if ((v & (v - 1)) === 0) {
        frontOffset++;
        if (v === 0) return 0;
      }
    }

    // Find the rest of the values which are singletons.
    while (cellOffset < numCells) {
      const v = grid[cellOrder[cellOffset]];
      if ((v & (v - 1)) === 0) {
        if (v === 0) return 0;
        [cellOrder[cellOffset], cellOrder[frontOffset]] =
          [cellOrder[frontOffset], cellOrder[cellOffset]];
        frontOffset++;
      }
      cellOffset++;
    }

    return frontOffset;
  }

  _logSelectNextCandidate(msg, cell, value, count, cellDepth, isNewNode) {
    const args = {
      cell: this._shape.makeCellIdFromIndex(cell),
      value: LookupTables.toValue(value),
      numOptions: count,
      cellDepth: cellDepth,
      isNewNode: isNewNode,
    };
    if (this._candidateSelectionFlags[cellDepth]) {
      args.state = this._candidateSelectionStates[cellDepth];
    }
    this._debugLogger.log(
      { loc: 'selectNextCandidate', msg, args, cells: [cell] });
  }

  _selectBestCandidate(gridState, cellOrder, cellDepth, isNewNode) {
    if (isNewNode) {
      // Clear any previous candidate selection state.
      this._candidateSelectionFlags[cellDepth] = 0;
    } else {
      // If we have a special candidate state, then use that.
      // TODO: Try relax the condition that we *must* use this when it is not a singleton.
      if (this._candidateSelectionFlags[cellDepth]) {
        const state = this._candidateSelectionStates[cellDepth];
        const count = state.cells.length;
        if (count) {
          return [cellOrder.indexOf(state.cells.pop()), state.value, count];
        }
      }
    }

    // Quick check - if the first value is a singleton, then just return without
    // the extra bookkeeping.
    {
      const firstValue = gridState[cellOrder[cellDepth]];
      if ((firstValue & (firstValue - 1)) === 0) {
        return [cellDepth, firstValue, firstValue !== 0 ? 1 : 0];
      }
    }

    // Find the best cell to explore next.
    const seenCandidateSet = this._seenCandidateSet;

    // Determine if we should only select interesting cells.
    // We only do this on new nodes, otherwise we degrade to probing.
    const selectOnlyInterestingCells = (
      isNewNode &&
      seenCandidateSet.enabledInSolver &&
      seenCandidateSet.hasInterestingPrefix(gridState, cellOrder, cellDepth)
    );

    let cellOffset = this._selectBestCell(
      gridState, cellOrder, cellDepth, selectOnlyInterestingCells);
    const cell = cellOrder[cellOffset];

    // Find the next smallest value to try.
    // NOTE: We will always have a value because:
    //        - we would have returned earlier on domain wipeout.
    //        - we don't add to the stack on the final value in a cell.
    let values = gridState[cell];
    let count = countOnes16bit(values);

    let value = values;
    if (count > 1) {
      // We only need to make choices if there are multiple values.
      if (this._optionSelector !== null) {
        // If we have an option selector, then use it to select a value.
        value = this._optionSelector.selectValue(values, count);
      } else {
        // If we already have solutions, prefer exploring a value that may lead
        // to a new (interesting) solution first.
        let choiceValues = values;
        if (seenCandidateSet.enabledInSolver) {
          const interesting = values & ~seenCandidateSet.candidates[cell];
          if (interesting) choiceValues = interesting;
        }
        value = choiceValues & -choiceValues;
      }

      // Wait until our first guess to initialize the candidate finder set.
      if (!this._candidateFinderSet.initialized) {
        this._candidateFinderSet.initialize(gridState);
      }
    }

    const conflictScores = this._conflictScores.scores;

    // Optionally explore custom candidates nominated by constraints.
    //  - Exploring this node for the first time. If we have backtracked here
    //    it is less likely that this will yield a better candidate.
    //  - Currently exploring a cell with more than 2 values.
    //  - Have non-zero conflict scores (and thus score). If the score is 0,
    //    that means that no other cells have a non-zero score.
    if (isNewNode && count > 2 && conflictScores[cell] > 0 && !this._optionSelector) {
      let score = conflictScores[cell] / count;

      const state = this._candidateSelectionStates[cellDepth];
      state.score = score;
      if (this._findCustomCandidates(gridState, cellOrder, cellDepth, selectOnlyInterestingCells, state)) {
        count = state.cells.length;
        value = state.value;
        if (count > 1 && this._optionSelector !== null) {
          const index = this._optionSelector.selectIndex(count);
          [state.cells[index], state.cells[count - 1]] =
            [state.cells[count - 1], state.cells[index]];
        }

        cellOffset = cellOrder.indexOf(state.cells.pop());
        this._candidateSelectionFlags[cellDepth] = 1
      }
    }

    return [cellOffset, value, count];
  }

  _selectBestCell(gridState, cellOrder, cellDepth, selectOnlyInterestingCells) {
    // Choose cells based on value count and number of backtracks it caused.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts (0 values), so we should never find them here. Even if they
    // exist, it just means we do a few more useless forced cell resolutions.
    // NOTE: If the scoring is more complicated, it can be useful
    // to do an initial pass to detect 1 or 0 value cells (!(v&(v-1))).

    const numCells = this._numCells;
    const conflictScores = this._conflictScores.scores;

    const seenCandidates = selectOnlyInterestingCells
      ? this._seenCandidateSet.candidates
      : null;

    const valueInfo = this._conflictScores.getMaxValueScore();
    const maxValue = valueInfo.value;
    const maxValueScore = valueInfo.score;

    // Find the cell with the minimum score.
    let maxScore = -1;
    let bestOffset = -1;

    for (let i = cellDepth; i < numCells; i++) {
      const cell = cellOrder[i];
      if (seenCandidates !== null) {
        if ((gridState[cell] & ~seenCandidates[cell]) === 0) continue;
      }
      const count = countOnes16bit(gridState[cell]);
      // If we have a single value then just use it - as it will involve no
      // guessing.
      // NOTE: We could use more efficient check for count() < 1, but it's not
      // worth it as this only happens at most once per loop. The full count()
      // will have to occur anyway for every other iteration.
      if (count <= 1) {
        bestOffset = i;
        maxScore = -1;
        break;
      }

      let scoreUnnormalized = conflictScores[cell];

      // If a value has been particularly conflict-prone recently, prefer
      // searching cells that contain that value.
      if (gridState[cell] & maxValue) {
        scoreUnnormalized += (maxValueScore * 0.2);
      }

      if (scoreUnnormalized > maxScore * count) {
        bestOffset = i;
        // Don't divide until we have to.
        maxScore = scoreUnnormalized / count;
      }
    }

    // If we were filtering to interesting cells and found none, fall back to
    // the default selection.
    if (bestOffset === -1) {
      return this._selectBestCell(
        gridState, cellOrder, cellDepth, /* selectOnlyInterestingCells= */ false);
    }

    if (maxScore === 0) {
      // It's rare that maxScore is 0 since all backtrack triggers must be 0.
      // However, in this case we can run a special loop to find the cell with
      // the min count.
      //
      // Looping over the cells again is not a concern since this is rare. It is
      // better to take it out of the main loop.
      bestOffset = this._minCountCellIndex(
        gridState, cellOrder, cellDepth, selectOnlyInterestingCells);
    }

    return bestOffset;
  }

  // Find the cell index with the minimum score. Return the index into cellOrder.
  _minCountCellIndex(gridState, cellOrder, cellDepth, selectOnlyInterestingCells) {
    const seenCandidates = selectOnlyInterestingCells ? this._seenCandidateSet.candidates : null;

    let minCount = 1 << 16;
    // We should always find something. -1 ensures we fail loudly if not.
    let bestOffset = -1;
    const numCells = this._numCells;
    for (let i = cellDepth; i < numCells; i++) {
      if (selectOnlyInterestingCells) {
        const cell = cellOrder[i];
        if ((gridState[cell] & ~seenCandidates[cell]) === 0) continue;
      }
      const count = countOnes16bit(gridState[cellOrder[i]]);
      if (count < minCount) {
        bestOffset = i;
        minCount = count;
      }
    }
    return bestOffset;
  }

  _adjustForStepState(stepState, gridState, cellOrder, cellDepth, cellOffset, value) {
    const guide = stepState.stepGuides.get(stepState.step) || {};
    let adjusted = false;

    if (guide.depth !== cellDepth) {
      return [cellOffset, value, adjusted];
    }

    // If there is a cell guide, then use that.
    if (Number.isInteger(guide.cell)) {
      const newCellOffset = cellOrder.indexOf(guide.cell, cellDepth);
      if (newCellOffset !== -1) {
        cellOffset = newCellOffset;
        adjusted = true;
      }
    }

    const cellValues = gridState[cellOrder[cellOffset]];

    if (Number.isInteger(guide.value)) {
      // Use the value from the guide.
      value = LookupTables.fromValue(guide.value);
      adjusted = true;
    } else if (Number.isInteger(guide.cell)) {
      // Or if we had a guide cell then choose a value which is valid for that
      // cell.
      value = cellValues & -cellValues;
      adjusted = true;
    }

    return [cellOffset, value, adjusted];
  }

  _findCustomCandidates(gridState, cellOrder, cellDepth, selectOnlyInterestingCells, result) {
    const conflictScores = this._conflictScores.scores;
    const finderSet = this._candidateFinderSet;
    const seenCandidates = this._seenCandidateSet.candidates;
    finderSet.clearMarks();

    // Determine the minimum value that the conflictScore can take to beat the
    // current score.
    let minCS = Math.ceil(result.score * 2) | 0;

    const numCells = cellOrder.length;
    let foundCandidate = false;
    for (let i = cellDepth; i < numCells; i++) {
      const cell = cellOrder[i];
      // Ignore cells which are too low in priority.
      if (conflictScores[cell] < minCS) continue;
      if (selectOnlyInterestingCells) {
        if ((gridState[cell] & ~seenCandidates[cell]) === 0) {
          continue;
        }
      }

      // Score finders for this cell.
      const indexes = finderSet.getIndexesForCell(cell);
      for (let j = 0; j < indexes.length; j++) {
        if (!finderSet.isMarked(indexes[j])) {
          const finder = finderSet.getAndMark(indexes[j]);
          if (finder.maybeFindCandidate(gridState, conflictScores, result)) {
            minCS = Math.ceil(result.score * 2) | 0;
            foundCandidate = true;
          }
        }
      }
    }

    if (!foundCandidate) return false;
    // This shouldn't happen, but protect against candidate finder bugs.
    if (result.cells.length < 2) return false;

    // Sort cells so that the highest scoring cells are last,  and hence
    // searched first.
    result.cells.sort((a, b) => conflictScores[a] - conflictScores[b]);


    // If the highest scoring cell and value is not interesting, then discard this candidate.
    // NOTE: The candidate finders can return arbitrary cells, so its hard
    // to pre-filter in the main loop.
    // We could do be smarter about this, but this is sufficient for now.
    if (selectOnlyInterestingCells) {
      let hasInterestingCell = false;

      const value = result.value;
      const lastIndex = result.cells.length - 1;
      for (let i = lastIndex; i >= 0; i--) {
        if (value & ~seenCandidates[result.cells[i]]) {
          hasInterestingCell = true;
          [result.cells[i], result.cells[lastIndex]] =
            [result.cells[lastIndex], result.cells[i]];
          break;
        }
      }
      if (!hasInterestingCell) return false;
    }

    return true;
  }

  // This needs to match the fields populated by the CandidateFinders.
  _initCandidateSelectionStates(shape) {
    const candidateSelectionStates = [];
    for (let i = 0; i < shape.numCells; i++) {
      candidateSelectionStates.push({
        score: 0.0,
        value: 0,
        cells: [],
      });
    }
    return candidateSelectionStates;
  }
}

class CandidateFinderSet {
  constructor(handlerSet, shape) {
    this._handlerSet = handlerSet;
    this._shape = shape;
    this.initialized = false;
    this._finders = [];

    const indexesByCell = [];
    for (let i = 0; i < shape.numCells; i++) indexesByCell.push([]);
    this._indexesByCell = indexesByCell;
    this._marked = null;
  }

  initialize(gridState) {
    const shape = this._shape;
    const finders = [];
    for (const h of this._handlerSet) {
      finders.push(...h.candidateFinders(gridState, shape));
    }
    this._finders = finders;

    const indexesByCell = this._indexesByCell;
    for (let i = 0; i < finders.length; i++) {
      const finder = finders[i];
      for (const cell of finder.cells) {
        indexesByCell[cell].push(i);
      }
    }
    this._marked = new Uint8Array(finders.length);
    this.initialized = true;
  }

  getIndexesForCell(cell) {
    return this._indexesByCell[cell];
  }

  getAndMark(index) {
    this._marked[index] = 1;
    return this._finders[index];
  }

  isMarked(index) {
    return this._marked[index];
  }

  clearMarks() {
    this._marked.fill(0);
  }
};

class CandidateFinderBase {
  constructor(cells) {
    this.cells = cells;
  }

  maybeFindCandidate(grid, conflictScores, result) {
    return false;
  }
};

export class CandidateFinders {
  static filterCellsByValue(cells, grid, valueMask) {
    let numCells = cells.length;
    let result = [];
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      // Include the cell if it is contained in the mask and is not fixed.
      if ((v & valueMask) && (v & (v - 1))) {
        result.push(cells[i]);
      }
    }
    if (result.length === 1) result.pop();
    return result;
  }
}

CandidateFinders.RequiredValue = class RequiredValue extends CandidateFinderBase {
  constructor(cells, value, multiplier) {
    super(cells);
    this._multiplier = multiplier || 1;
    this._value = value;
  }

  maybeFindCandidate(grid, conflictScores, result) {
    const cells = this.cells;
    const numCells = cells.length;
    const value = this._value;

    // Count the valid cells (ones which contain the value).
    // Track the maximum conflictScore for determining the score.
    let count = 0;
    let maxCS = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & value) {
        count++;
        const conflictScore = conflictScores[cells[i]];
        if (conflictScore > maxCS) maxCS = conflictScore;
      }
    }
    // If count is 1, this is value is already resolved.
    // Don't bother limiting the maximum count, as the score will
    // naturally be lower in that case.
    if (count < 2) return false;

    const score = maxCS * this._multiplier / count;
    // NOTE: We replace the result if the score is equal.
    // It is better on the benchmarks.
    if (score < result.score) return false;

    result.score = score;
    result.value = value
    const resultCells = result.cells;
    resultCells.length = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & value) {
        resultCells.push(cells[i]);
      }
    }
    return true;
  }
};

CandidateFinders.House = class House extends CandidateFinderBase {
  constructor(cells) {
    super(cells);
  }

  _scoreValue(grid, v, conflictScores, result) {
    const cells = this.cells;
    const numCells = cells.length;
    let cell0 = 0;
    let cell1 = 0;
    let maxCS = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & v) {
        [cell0, cell1] = [cell1, cells[i]];
        if (conflictScores[cell1] > maxCS) {
          maxCS = conflictScores[cell1];
        }
      }
    }

    const score = maxCS * 0.5;
    // NOTE: We replace the result if the score is equal.
    // It is better on the benchmarks.
    if (score < result.score) return false;

    result.score = score;
    result.value = v;
    result.cells.length = 0;
    result.cells.push(cell1, cell0);
    return true;
  }

  maybeFindCandidate(grid, conflictScores, result) {
    const cells = this.cells;
    const numCells = cells.length;

    let allValues = 0;
    let moreThanOne = 0;
    let moreThanTwo = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      moreThanTwo |= moreThanOne & v;
      moreThanOne |= allValues & v;
      allValues |= v;
    }

    let exactlyTwo = moreThanOne & ~moreThanTwo;
    let foundCandidate = false;
    while (exactlyTwo) {
      let v = exactlyTwo & -exactlyTwo;
      exactlyTwo ^= v;
      foundCandidate = this._scoreValue(grid, v, conflictScores, result) || foundCandidate;
    }
    return foundCandidate;
  }
};

// An extension of the candidate selector which chooses values at random
// from the chosen cell, and only searches a single branch of the tree.
export class SamplingCandidateSelector extends CandidateSelector {
  constructor(shape, handlerSet, debugLogger, seenCandidateSet) {
    super(shape, handlerSet, debugLogger, seenCandidateSet);
    this._totalWeight = new Float64Array(shape.numCells + 1);
    this._totalWeight[0] = 1.0;
    this._optionSelector = new RandomOptionSelector(/* seed = */ 0);
  }

  selectNextCandidate(cellDepth, gridState, stepState, isNewNode) {
    if (!isNewNode) {
      return [0, 0, 0];
    }

    const [nextDepth, value, count] =
      super.selectNextCandidate(cellDepth, gridState, stepState, isNewNode);
    this._totalWeight[nextDepth] = this._totalWeight[cellDepth] * count;

    return [nextDepth, value, count];
  }

  getSolutionWeight() {
    return this._totalWeight[this._numCells];
  }
}

class RandomOptionSelector {
  constructor(randomSeed) {
    this._rnd = new RandomIntGenerator(randomSeed);
  }

  selectValue(values, count) {
    // Pick a random nth bit.
    const n = this._rnd.randomInt(count - 1);
    for (let i = 0; i < n; i++) {
      values = values & (values - 1);
    }
    return values & -values;
  }

  selectIndex(count) {
    return this._rnd.randomInt(count - 1);
  }
}

// ConflictScores counts the the number of times a cell is responsible
// for finding a conflict and causing a backtrack. It is exponentially
// decayed so that the information reflects the most recent search areas.
// Cells with a high count are the best candidates for searching as we
// may find the conflict faster. Ideally, this allows the search to
// learn the critical areas of the grid where it is more valuable to search
// first.
export class ConflictScores {
  DECAY_FREQUENCY = 1 << 14;

  constructor(initialScores, numValues) {
    this.scores = initialScores.slice();
    this._valueScores = new Uint32Array(numValues);

    this._numValues = numValues;
    this._decayCountdown = this.DECAY_FREQUENCY;
  }

  increment(cell, valueMask) {
    this.scores[cell]++;

    this._valueScores[(LookupTables.toIndex(valueMask))]++;

    if (--this._decayCountdown === 0) {
      this.decay();
    }
  }

  decay() {
    const scores = this.scores;
    for (let i = 0; i < scores.length; i++) {
      scores[i] >>= 1;
    }

    // Decay value score faster as they should be more volatile.
    const valueScores = this._valueScores;
    for (let i = 0; i < valueScores.length; i++) {
      valueScores[i] >>= 2;
    }

    this._decayCountdown = this.DECAY_FREQUENCY;
  }

  // Returns { value, score }.
  // value = value bit mask (0 if none / insufficient spread)
  // score = score (0 if none / insufficient spread)
  getMaxValueScore() {
    const valueScores = this._valueScores;
    let max = 0;
    let value = 0;
    let min = 0x7fffffff;
    for (let i = 0; i < valueScores.length; i++) {
      const s = valueScores[i];
      if (s > max) {
        max = s;
        value = 1 << i;
      }
      if (s && s < min) {
        min = s;
      }
    }

    // Only return a value if there is a sufficient spread (max > 1.5 * min),
    // and the max is significant compared to the number of cells.
    if (max < this._numValues || (max << 1) <= min * 3) {
      return { value: 0, score: 0 };
    }

    return { value, score: max };
  }
}