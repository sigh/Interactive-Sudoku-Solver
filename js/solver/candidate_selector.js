class CandidateSelector {
  constructor(shape, handlerSet, debugLogger) {
    this._shape = shape;
    this._cellOrder = new Uint8Array(shape.numCells);
    this._backtrackTriggers = null;
    this._debugLogger = debugLogger;

    this._candidateSelectionStates = this._initCandidateSelectionStates(shape);
    // _candidateSelectionFlags is used to track whether the
    // _candidateSelectionStates entry is valid.
    this._candidateSelectionFlags = new Uint8Array(shape.numCells);

    this._candidateFinderSet = new CandidateSelector.CandidateFinderSet(handlerSet, shape);
  }

  reset(backtrackTriggers) {
    // Re-initialize the cell indexes in the cellOrder.
    // This is not required, but keeps things deterministic.
    const numCells = this._cellOrder.length;
    for (let i = 0; i < numCells; i++) {
      this._cellOrder[i] = i;
    }

    this._backtrackTriggers = backtrackTriggers;

    this._candidateSelectionFlags.fill(0);
  }

  getCellOrder(upto) {
    if (upto === undefined) return this._cellOrder;
    return this._cellOrder.subarray(0, upto);
  }

  // selectNextCandidate find the next candidate to try.
  // Returns [nextCells, value, count]:
  //   nextCells[0]: The cell which contains the next candidate.
  //   value: The candidate value in the nextCells[0].
  //   count: The number of options we selected from:
  //      - If `count` == 1, then this is a known value and the solver will
  //        not return to this node.
  //      - Most of the time, `count` will equal the number of values in
  //        nextCells[0], but it may be less if we are branching on something
  //        other than the cell (e.g. a digit within a house).
  //   nextCells[1:]: Singleton cells which can be enforced at the same time.
  selectNextCandidate(cellDepth, grid, stepState, isNewNode) {
    const cellOrder = this._cellOrder;
    let [cellOffset, value, count] = this._selectBestCandidate(
      grid, cellOrder, cellDepth, isNewNode);

    // Adjust the value for step-by-step.
    if (stepState) {
      if (this._debugLogger.enableStepLogs) {
        this._logSelectNextCandidate(
          'Best candidate:', cellOrder[cellOffset], value, count, cellDepth);
      }

      let adjusted = false;
      [cellOffset, value, adjusted] = this._adjustForStepState(
        stepState, grid, cellOrder, cellDepth, cellOffset, value);

      if (adjusted) {
        count = countOnes16bit(grid[cellOrder[cellOffset]]);
        this._candidateSelectionFlags[cellDepth] = 0;
        if (this._debugLogger.enableStepLogs) {
          this._logSelectNextCandidate(
            'Adjusted by user:', cellOrder[cellOffset], value, count, cellDepth);
        }
      }
    }

    const nextCellDepth = this._updateCellOrder(
      cellDepth, cellOffset, count, grid);

    if (nextCellDepth === 0) {
      return [cellOrder, 0, 0];
    }

    if (this._debugLogger.enableStepLogs) {
      if (nextCellDepth != cellDepth + 1) {
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

    return [cellOrder.subarray(cellDepth, nextCellDepth), value, count];
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

    // If count was greater than 1, there were no singletons.
    if (count > 1) return frontOffset;

    // Move all singletons to the front of the cellOrder.
    const numCells = grid.length;

    // First skip past any values which are already at the front.
    while (cellOffset == frontOffset && cellOffset < numCells) {
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

  _logSelectNextCandidate(msg, cell, value, count, cellDepth) {
    this._debugLogger.log({
      loc: 'selectNextCandidate',
      msg: msg,
      args: {
        cell: this._shape.makeCellIdFromIndex(cell),
        value: LookupTables.toValue(value),
        numOptions: count,
        cellDepth: cellDepth,
        state: (
          this._candidateSelectionFlags[cellDepth] ?
            this._candidateSelectionStates[cellDepth] : null),
      },
      cells: [cell],
    });
  }

  _selectBestCandidate(grid, cellOrder, cellDepth, isNewNode) {
    // If we have a special candidate state, then use that.
    // TODO: Try relax the condition that we *must* use this when it is not a singleton.
    if (this._candidateSelectionFlags[cellDepth]) {
      const state = this._candidateSelectionStates[cellDepth];
      const count = state.cells.length;
      if (count === 1) {
        this._candidateSelectionFlags[cellDepth] = 0;
      }
      return [cellOrder.indexOf(state.cells.pop()), state.value, count];
    }

    // Quick check - if the first value is a singleton, then just return without
    // the extra bookkeeping.
    {
      const firstValue = grid[cellOrder[cellDepth]];
      if ((firstValue & (firstValue - 1)) === 0) {
        return [cellDepth, firstValue, firstValue !== 0 ? 1 : 0];
      }
    }

    // Find the best cell to explore next.
    let cellOffset = this._selectBestCell(grid, cellOrder, cellDepth);
    const cell = cellOrder[cellOffset];

    // Find the next smallest value to try.
    // NOTE: We will always have a value because:
    //        - we would have returned earlier on domain wipeout.
    //        - we don't add to the stack on the final value in a cell.
    let values = grid[cell];
    let value = values & -values;
    let count = countOnes16bit(values);

    // Wait until our first guess to initialize the candidate finder set.
    if (count > 1 && !this._candidateFinderSet.initialized) {
      this._candidateFinderSet.initialize(grid);
    }

    // Optionally explore custom candidates nominated by constraints.
    //  - Exploring this node for the first time. If we have backtracked here
    //    it is less likely that this will yield a better candidate.
    //  - Currently exploring a cell with more than 2 values.
    //  - Have non-zero backtrackTriggers (and thus score). If the score is 0,
    //    that means that no other cells have a non-zero score.
    if (isNewNode && count > 2 && this._backtrackTriggers[cell] > 0) {
      let score = this._backtrackTriggers[cell] / count;

      const state = this._candidateSelectionStates[cellDepth];
      state.score = score;
      if (this._findCustomCandidates(grid, cellOrder, cellDepth, state)) {
        count = state.cells.length;
        value = state.value;
        cellOffset = cellOrder.indexOf(state.cells.pop());
        this._candidateSelectionFlags[cellDepth] = 1
      }
    }

    return [cellOffset, value, count];
  }

  _selectBestCell(grid, cellOrder, cellDepth) {
    // Choose cells based on value count and number of backtracks it caused.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts (0 values), so we should never find them here. Even if they
    // exist, it just means we do a few more useless forced cell resolutions.
    // NOTE: If the scoring is more complicated, it can be useful
    // to do an initial pass to detect 1 or 0 value cells (!(v&(v-1))).

    const numCells = grid.length;
    const backtrackTriggers = this._backtrackTriggers;

    // Find the cell with the minimum score.
    let maxScore = -1;
    let bestOffset = 0;

    for (let i = cellDepth; i < numCells; i++) {
      const cell = cellOrder[i];
      const count = countOnes16bit(grid[cell]);
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

      let score = backtrackTriggers[cell] / count;

      if (score > maxScore) {
        bestOffset = i;
        maxScore = score;
      }
    }

    if (maxScore === 0) {
      // It's rare that maxScore is 0 since all backtrack triggers must be 0.
      // However, in this case we can run a special loop to find the cell with
      // the min count.
      //
      // Looping over the cells again is not a concern since this is rare. It is
      // better to take it out of the main loop.
      bestOffset = this._minCountCellIndex(grid, cellOrder, cellDepth);
    }

    return bestOffset;
  }

  // Find the cell index with the minimum score. Return the index into cellOrder.
  _minCountCellIndex(grid, cellOrder, cellDepth) {
    let minCount = 1 << 16;
    let bestOffset = 0;
    for (let i = cellDepth; i < grid.length; i++) {
      const count = countOnes16bit(grid[cellOrder[i]]);
      if (count < minCount) {
        bestOffset = i;
        minCount = count;
      }
    }
    return bestOffset;
  }

  _adjustForStepState(stepState, grid, cellOrder, cellDepth, cellOffset, value) {
    const step = stepState.step;
    const guide = stepState.stepGuides.get(step) || {};
    let adjusted = false;

    // If there is a cell guide, then use that.
    if (guide.cell) {
      const newCellOffset = cellOrder.indexOf(guide.cell, cellDepth);
      if (newCellOffset !== -1) {
        cellOffset = newCellOffset;
        adjusted = true;
      }
    }

    const cellValues = grid[cellOrder[cellOffset]];

    if (guide.value) {
      // Use the value from the guide.
      value = LookupTables.fromValue(guide.value);
      adjusted = true;
    } else if (guide.cell) {
      // Or if we had a guide cell then choose a value which is valid for that
      // cell.
      value = cellValues & -cellValues;
      adjusted = true;
    }

    return [cellOffset, value, adjusted];
  }

  _findCustomCandidates(grid, cellOrder, cellDepth, result) {
    const cellScores = this._backtrackTriggers;
    const finderSet = this._candidateFinderSet;
    finderSet.clearMarks();

    // Determine the minimum value that the cellScore can take to beat the
    // current score.
    let minCS = Math.ceil(result.score * 2) | 0;

    const numCells = cellOrder.length;
    let foundCandidate = false;
    for (let i = cellDepth; i < numCells; i++) {
      const cell = cellOrder[i];
      // Ignore cells which are too low in priority.
      if (cellScores[cell] < minCS) continue;

      // Score finders for this cell.
      const indexes = finderSet.getIndexesForCell(cell);
      for (let j = 0; j < indexes.length; j++) {
        if (!finderSet.isMarked(indexes[j])) {
          const finder = finderSet.getAndMark(indexes[j]);
          if (finder.maybeFindCandidate(grid, cellScores, result)) {
            minCS = Math.ceil(result.score * 2) | 0;
            foundCandidate = true;
          }
        }
      }
    }

    if (!foundCandidate) return false;

    // Sort cells so that the highest scoring cells are last,  and hence
    // searched first.
    result.cells.sort((a, b) => cellScores[a] - cellScores[b]);
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

CandidateSelector.CandidateFinderSet = class CandidateFinderSet {
  constructor(handlerSet, shape) {
    this._handlerSet = handlerSet;
    this._shape = shape;
    this.initialized = false;

    const indexesByCell = [];
    for (let i = 0; i < shape.numCells; i++) indexesByCell.push([]);
    this._indexesByCell = indexesByCell;
    this._marked = null;
  }

  initialize(grid) {
    const shape = this._shape;
    const finders = [];
    for (const h of this._handlerSet) {
      finders.push(...h.candidateFinders(grid, shape));
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
}

CandidateSelector.CandidateFinderBase = class CandidateFinderBase {
  constructor(cells) {
    this.cells = cells;
  }

  maybeFindCandidate(grid, cellScores, result) {
    return false;
  }
}

class CandidateFinders {
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

CandidateFinders.RequiredValue = class RequiredValue extends CandidateSelector.CandidateFinderBase {
  constructor(cells, value, multiplier) {
    super(cells);
    this._multiplier = multiplier || 1;
    this._value = value;
  }

  maybeFindCandidate(grid, cellScores, result) {
    const cells = this.cells;
    const numCells = cells.length;
    const value = this._value;

    // Count the valid cells (ones which contain the value).
    // Track the maximum cellScore for determining the score.
    let count = 0;
    let maxCS = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & value) {
        count++;
        const cellScore = cellScores[cells[i]];
        if (cellScore > maxCS) maxCS = cellScore;
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
}

CandidateFinders.House = class House extends CandidateSelector.CandidateFinderBase {
  constructor(cells) {
    super(cells);
  }

  _scoreValue(grid, v, cellScores, result) {
    const cells = this.cells;
    const numCells = cells.length;
    let cell0 = 0;
    let cell1 = 0;
    let maxCS = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & v) {
        [cell0, cell1] = [cell1, cells[i]];
        if (cellScores[cell1] > maxCS) {
          maxCS = cellScores[cell1];
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

  maybeFindCandidate(grid, cellScores, result) {
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
      foundCandidate = this._scoreValue(grid, v, cellScores, result) || foundCandidate;
    }
    return foundCandidate;
  }
}