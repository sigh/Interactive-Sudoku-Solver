const { memoize, MultiMap, countOnes16bit } = await import('../util.js' + self.VERSION_PARAM);
const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SudokuConstraintHandler } = await import('./sudoku_constraint_handler.js' + self.VERSION_PARAM);
const { SHAPE_MAX, SHAPE_9x9 } = await import('../grid_shape.js' + self.VERSION_PARAM);

SudokuConstraintHandler.Sum = class Sum extends SudokuConstraintHandler {
  _sum = 0;
  _coeffGroups = [];
  _exclusionGroupIds = null;
  _cellExclusions = null;
  _complementCells = null;
  _sumData = null;
  _flags = 0;

  static _FLAG_ONLY_ABS_UNIT_COEFF = 0b1;
  static _FLAG_CAGE = 0b10;

  static makeEqual(cells0, cells1) {
    // Make cell0 the longer array, as it will be the positive cells.
    if (cells0.length < cells1.length) [cells0, cells1] = [cells1, cells0];
    const cells = [...cells0, ...cells1];
    const coeffs = cells.map((_, i) => i < cells0.length ? 1 : -1);
    return new this(cells, 0, coeffs);
  }

  constructor(cells, sum, coeffs) {
    const cellSet = new Set(cells);
    super(cellSet);
    this._sum = +sum;

    if (cellSet.size === cells.length && !coeffs) {
      // Shortcut the common case.
      this._coeffGroups.push(
        { coeff: 1, cells: [...cells], exclusionGroups: [] });
    } else {
      coeffs = coeffs || Array(cells.length).fill(1);

      if (coeffs.length !== cells.length) {
        throw new Error('Invalid number of coefficients: ' + coeffs.length);
      }
      if (!coeffs.every(c => Number.isInteger(c))) {
        throw new Error('Coefficients must be integers');
      }

      // If there are duplicates, then update the coefficients.
      // Not as efficient as it could be, but this is a rare case.
      if (cellSet.size !== cells.length) {
        const cellMap = new Map();
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          cellMap.set(
            cell, (cellMap.get(cell) || 0) + coeffs[i]);
        }
        cells = [...cellMap.keys()];
        coeffs = cells.map(c => cellMap.get(c));
      }

      // Group coefficients by value.
      const coeffMap = new MultiMap();
      for (let i = 0; i < cells.length; i++) {
        coeffMap.add(coeffs[i], cells[i]);
      }
      for (let [coeff, coeffCells] of coeffMap) {
        this._coeffGroups.push({ coeff, cells: coeffCells, exclusionGroups: [] });
      }
    }

    // Sort cells for consistent idStr and exclusion cell performance.
    this._coeffGroups.forEach(g => g.cells.sort((a, b) => a - b));

    this.idStr = [
      this.constructor.name,
      sum,
      ...this._coeffGroups.map(g => g.coeff + ':' + g.cells.join(','))
    ].join('|');
  }

  onlyUnitCoeffs() {
    return this._coeffGroups.every(g => g.coeff === 1);
  }

  setComplementCells(cells) {
    if (!this.onlyUnitCoeffs()) {
      throw Error("Can't use complementCells with non-unit coefficients.");
    }
    this._complementCells = cells;
  }

  coefficients() {
    const cells = this.cells;
    const coeffs = new Array(this.cells.length);
    this._coeffGroups.forEach(
      g => g.cells.forEach(
        c => { coeffs[cells.indexOf(c)] = g.coeff; }));
    return coeffs;
  }

  sum() {
    return this._sum;
  }

  priority() {
    // We want smaller cages to have higher priority, but we still want all sums
    // to have a high priority.
    const numValues = this._sumData.numValues;
    return Math.max(numValues * 2 - this.cells.length, numValues);
  }

  static _GROUP_HAS_UNIT_COEFF = 1 << 13;
  static _GROUP_HAS_ABS_UNIT_COEFF = 1 << 14;
  // Note: This is set up so the value is negative in 16 bits.
  static _GROUP_HAS_NEGATIVE_COEFF = -1 << 15;
  static _COEFF_GROUP_MASK = (1 << 8) - 1;

  static _makeExclusionGroupId(coeffGroupIndex, exclusionGroupIndex, coeff) {
    // Coefficient index is 8 bits (max 256, one per grid cell).
    // Exclusion group index is 4 bits (max 15 cells per coeff group).
    // The last 4 bits are for flags.
    let exclusionGroupId = coeffGroupIndex | (exclusionGroupIndex << 8);
    if (coeff === 1) {
      exclusionGroupId |= this._GROUP_HAS_UNIT_COEFF;
    }
    if (Math.abs(coeff) === 1) {
      exclusionGroupId |= this._GROUP_HAS_ABS_UNIT_COEFF;
    }
    if (coeff < 0) {
      exclusionGroupId |= this._GROUP_HAS_NEGATIVE_COEFF;
    }
    return exclusionGroupId;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._sumData = SudokuConstraintHandler.Sum._SumData.get(shape.numValues);

    for (const g of this._coeffGroups) {
      g.exclusionGroups = SudokuConstraintHandler._Util.findExclusionGroups(
        g.cells, cellExclusions);
    }

    // Maximum of 15 cells per coefficient group to ensure we don't overflow the
    // rangeInfo values.
    {
      const originalNumGroup = this._coeffGroups.length;
      const MAX_GROUP_SIZE = 15;
      for (let i = 0; i < originalNumGroup; i++) {
        const g = this._coeffGroups[i];
        if (g.cells.length <= MAX_GROUP_SIZE) continue;

        const cellSet = new Set(g.cells);
        const egs = g.exclusionGroups;

        while (cellSet.size > MAX_GROUP_SIZE) {
          // We want to keep exclusion groups together.
          let newCells = [];
          let newEgs = [];
          while (egs[egs.length - 1].length <= MAX_GROUP_SIZE - newCells.length) {
            const eg = egs.pop();
            newCells.push(...eg);
            newEgs.push(eg);
          }
          if (newCells.length === 0) {
            // This can only happen when the last exclusion group is exactly 16
            // cells.
            const eg = egs[egs.length - 1];
            newEgs = newCells = eg.splice(0, MAX_GROUP_SIZE);
          }
          this._coeffGroups.push({ coeff: g.coeff, cells: newCells, exclusionGroups: newEgs });
          newCells.forEach(c => cellSet.delete(c));
        }

        g.cells = [...cellSet];
      }
    }

    // Coefficients are sorted from largest to smallest (absolute value).
    // Calculations need to look at the largest values first since they are
    // the most restrictive.
    this._coeffGroups.sort((a, b) => Math.abs(b.coeff) - Math.abs(a.coeff));

    {
      this._exclusionGroupIds = new Int16Array(this.cells.length);
      const cellLookup = new Uint8Array(shape.numCells);
      this.cells.forEach((c, i) => cellLookup[c] = i);

      for (let i = 0; i < this._coeffGroups.length; i++) {
        const { exclusionGroups, coeff } = this._coeffGroups[i];
        for (let j = 0; j < exclusionGroups.length; j++) {
          const exclusionGroupId = this.constructor._makeExclusionGroupId(
            i, j, coeff);
          for (const cell of exclusionGroups[j]) {
            const index = cellLookup[cell];
            this._exclusionGroupIds[index] = exclusionGroupId;
          }
        }
      }
    }

    const onlyUnitCoeffs = this._coeffGroups.every(g => g.coeff === 1);
    if (this._coeffGroups.every(g => Math.abs(g.coeff) === 1)) {
      this._flags |= this.constructor._FLAG_ONLY_ABS_UNIT_COEFF;
    }
    if (
      onlyUnitCoeffs
      && this._coeffGroups.length == 1
      && this._coeffGroups[0].exclusionGroups.length == 1) {
      this._flags |= this.constructor._FLAG_CAGE;
    }

    const hasNegative = this._coeffGroups.some(g => g.coeff < 0);
    if (!hasNegative) {
      // We can't use cell exclusions because the cell values have been changed.
      // Thus it can't be used to exclude the value from other cells.
      // (This is only relevant for calls to _enforceFewRemainingCells).
      this._cellExclusions = cellExclusions;
    }

    // Check for valid sums.
    const sum = this._sum;
    if (!Number.isInteger(sum)) return false;
    if (this._isCage && sum > this._sumData.maxCageSum) {
      return false;
    }

    return true;
  }

  static _exclusionIdsBuffer = new Int16Array(3);
  static _reversedCellsBuffer = new Uint8Array(3);
  // Create a cellBuffer for each possible number of unfixed cells that
  // _enforceFewRemainingCells() can be called with.
  // This allows calls to functions like restrictCellsSingleExclusionGroup()
  // to rely on the array length.
  static _cellBuffers = [...Array(4).keys()].map(i => new Uint8Array(i));

  // Determines if _enforceFewRemainingCells() can be run.
  _hasFewRemainingCells(numUnfixed) {
    if (this._flags & this.constructor._FLAG_ONLY_ABS_UNIT_COEFF) {
      return numUnfixed <= (this._sumData.pairwiseSums ? 3 : 2);
    } else {
      // Treat this as a special case as we can handle any coefficients.
      return numUnfixed === 1;
    }
  }

  _enforceOneRemainingCell(grid, targetSum) {
    const cells = this.cells;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const v = grid[cell];
      if (!(v & (v - 1))) continue;


      // We have found the single unfixed value.
      // Enforce it to the required value and return.
      const exclusionGroupId = this._exclusionGroupIds[i];
      // Fast path for c=1 and c=-1, otherwise the general case.
      if (exclusionGroupId & this.constructor._GROUP_HAS_UNIT_COEFF) {
        return targetSum > 0 && !!(grid[cell] = v & (1 << (targetSum - 1)));
      } else if (exclusionGroupId & this.constructor._GROUP_HAS_ABS_UNIT_COEFF) {
        return targetSum < 0 && !!(grid[cell] = v & (1 << (-targetSum - 1)));
      } else {
        const coeff = this._coeffGroups[
          exclusionGroupId & this._COEFF_GROUP_MASK].coeff;
        if (targetSum % coeff) return false;
        const targetValue = targetSum / coeff | 0;
        return targetValue > 0 && !!(grid[cell] = v & LookupTables.fromValue(targetValue));
      }
    }
  }

  _enforceTwoRemainingCells(grid, cells, targetSum, exclusionIds) {
    let v0 = grid[cells[0]];
    let v1 = grid[cells[1]];

    // Remove any values which don't have their counterpart value to add to
    // targetSum.
    const reverse = this._sumData.lookupTables.reverse;
    const numValues = this._sumData.numValues;
    v1 &= (reverse[v0] << (targetSum - 1)) >> numValues;
    v0 &= (reverse[v1] << (targetSum - 1)) >> numValues;

    // If the cells are in the same exclusion group, also ensure the sum
    // uses distinct values.
    if ((targetSum & 1) == 0 &&
      exclusionIds[0] === exclusionIds[1]) {
      // targetSum/2 can't be valid value.
      const mask = ~(1 << ((targetSum >> 1) - 1));
      v0 &= mask;
      v1 &= mask;
    }

    if (!(v1 && v0)) return false;

    grid[cells[0]] = v0;
    grid[cells[1]] = v1;

    // If there are two remaining values, and they can be in either cell
    // (both cells have the same candidates) then they are both required
    // values.
    // NOTE: We can also do this for count == 1, but it results are slightly
    //       worse.
    if (v0 === v1 && this._cellExclusions && countOnes16bit(v0) == 2) {
      if (!SudokuConstraintHandler._Util.enforceRequiredValueExclusions(
        grid, cells, v0, this._cellExclusions)) {
        return false;
      }
    }

    return true;
  }

  _enforceThreeRemainingCells(grid, cells, sum, exclusionIds) {
    const numValues = this._sumData.numValues;

    let v0 = grid[cells[0]];
    let v1 = grid[cells[1]];
    let v2 = grid[cells[2]];

    // Find each set of pairwise sums.
    const pairwiseSums = this._sumData.pairwiseSums;
    let sums2 = pairwiseSums[(v0 << numValues) | v1] << 2;
    let sums1 = pairwiseSums[(v0 << numValues) | v2] << 2;
    let sums0 = pairwiseSums[(v1 << numValues) | v2] << 2;

    // If the cell values are possibly repeated, then handle that.
    if (exclusionIds[0] !== exclusionIds[1] || exclusionIds[0] !== exclusionIds[2]) {
      if (exclusionIds[0] != exclusionIds[1]) {
        sums2 |= this._sumData.doubles[v0 & v1];
      }
      if (exclusionIds[0] != exclusionIds[2]) {
        sums1 |= this._sumData.doubles[v0 & v2];
      }
      if (exclusionIds[1] != exclusionIds[2]) {
        sums0 |= this._sumData.doubles[v1 & v2];
      }
    }

    // Constrain each value based on the possible sums of the other two.
    // NOTE: We don't care if a value is reused in the result, as that will
    // be removed in one of the other two cases.
    const shift = sum - 1;
    const allValues = this._sumData.allValues;
    const reverse = this._sumData.lookupTables.reverse;
    v2 &= reverse[((sums2 << numValues) >> shift) & allValues];
    v1 &= reverse[((sums1 << numValues) >> shift) & allValues];
    v0 &= reverse[((sums0 << numValues) >> shift) & allValues];

    if (!(v0 && v1 && v2)) return false;

    grid[cells[0]] = v0;
    grid[cells[1]] = v1;
    grid[cells[2]] = v2;

    return true;
  }

  // Solve small cases exactly and efficiently.
  // Call hasFewRemainingCells() to determine if it can be run.
  // REQUIRES that:
  //  - The number of unfixed cells is accurate.
  //  - None of the values are zero.
  //  - The targetSum is bounds-consistent with the current values.
  //    This is mostly to ensure that the targetSum is not negative after
  //    adjusting for negative coefficients.
  _enforceFewRemainingCells(grid, targetSum, numUnfixed) {
    if (numUnfixed === 1) {
      return this._enforceOneRemainingCell(grid, targetSum);
    }

    const cellBuffer = this.constructor._cellBuffers[numUnfixed];
    const exclusionIdsBuffer = this.constructor._exclusionIdsBuffer;

    // Track how many cells are reversed, for handing negative cells.
    //
    // If a cell has a negative coefficient, we reverse the bitset `b` to get
    // the values:
    //   B = N+1 - b where `N` is the number of values.
    // If we then adjust the targetSum by (N+1), then the rest of the code
    // can work the same as for positive coefficients since the set of valid
    // values is the same.
    //
    // The cells are reversed back at the end.
    // (We do this even if enforcement fails to ensure the step-by-step view
    //  looks sensible).
    let numReversed = 0;

    let j = 0;
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const v = grid[c];
      if (v & (v - 1)) {
        const exclusionGroupId = this._exclusionGroupIds[i];
        exclusionIdsBuffer[j] = exclusionGroupId;
        cellBuffer[j] = c;
        // A negative exclusionGroupId means that the coefficient is negative.
        if (exclusionGroupId < 0) {
          grid[c] = this._sumData.lookupTables.reverse[v];
          targetSum += (this._sumData.numValues + 1);
          this.constructor._reversedCellsBuffer[numReversed++] = c;
        } else if (!(exclusionGroupId & this.constructor._GROUP_HAS_UNIT_COEFF)) {
          throw Error('enforceFewRemainingCells only handles +-1 coefficients');
        }

        j++;
      }
    }

    // numUnfixed must be 2 or 3. Call the appropriate enforcement function.
    const result = numUnfixed === 2
      ? this._enforceTwoRemainingCells(
        grid, cellBuffer, targetSum, exclusionIdsBuffer)
      : this._enforceThreeRemainingCells(
        grid, cellBuffer, targetSum, exclusionIdsBuffer);

    // Un-reverse the reversed cells.
    for (let i = 0; i < numReversed; i++) {
      const c = this.constructor._reversedCellsBuffer[i];
      grid[c] = this._sumData.lookupTables.reverse[grid[c]];
    }

    return result;
  }

  _enforceCombinationsWithComplement(grid, handlerAccumulator) {
    const set0 = this.cells;
    const set1 = this._complementCells;
    const sum = this._sum;

    let values0 = 0;
    for (let i = set0.length - 1; i >= 0; i--) {
      values0 |= grid[set0[i]];
    }
    let values1 = 0;
    for (let i = set1.length - 1; i >= 0; i--) {
      values1 |= grid[set1[i]];
    }

    // NOTE: The following have been left out as I couldn't get them to show
    // a measurable improvement.
    //   - Calculating the fixedSum and reduce the target some.
    //   - Short-circuiting this by checking if the sum has already been
    //     reached.

    const cageSums = this._sumData.killerCageSums[set0.length][sum];
    let possibilities0 = 0;
    let possibilities1 = 0;

    const allValues = this._sumData.allValues;
    for (let j = 0; j < cageSums.length; j++) {
      const option = cageSums[j];
      // Branchlessly check that the option is consistent with both set1 and
      // set0.
      const includeOption = -(!(option & ~values0) & !(~option & ~values1 & allValues));
      possibilities0 |= option & includeOption;
      possibilities1 |= ~option & includeOption;
    }
    if (!possibilities0) return false;

    // Remove any values that aren't part of any solution.
    // Same as for sum handler.
    const valuesToRemove0 = values0 & ~possibilities0;
    if (valuesToRemove0) {
      for (let i = 0; i < set0.length; i++) {
        if (grid[set0[i]] & valuesToRemove0) {
          if (!(grid[set0[i]] &= ~valuesToRemove0)) return false;
          handlerAccumulator.addForCell(set0[i]);
        }
      }
    }
    const valuesToRemove1 = values1 & ~possibilities1;
    if (valuesToRemove1) {
      for (let i = 0; i < set1.length; i++) {
        if (grid[set1[i]] & valuesToRemove1) {
          if (!(grid[set1[i]] &= ~valuesToRemove1)) return false;
          handlerAccumulator.addForCell(set1[i]);
        }
      }
    }

    // NOTE: Seems like require uniques doesn't help much here.

    return true;
  }

  _restrictValueRange(grid, cells, coeff, sumMinusMin, maxMinusSum) {
    if (coeff !== 1) {
      // Scale the dof limits by the coefficient.
      // We always take the floor since we need to stay with the range.
      // Truncation (| 0) is fine here since the result is always positive.
      if (coeff > 0) {
        const invCoeff = 1 / coeff;
        sumMinusMin = (sumMinusMin * invCoeff) | 0;
        maxMinusSum = (maxMinusSum * invCoeff) | 0;
      } else {
        const invCoeff = -1 / coeff;
        [maxMinusSum, sumMinusMin] = [
          (sumMinusMin * invCoeff) | 0,
          (maxMinusSum * invCoeff) | 0];
      }
    }

    // Remove any values which aren't possible because they would cause the sum
    // to be too high.
    for (let i = 0; i < cells.length; i++) {
      let v = grid[cells[i]];
      // If there is a single value, then the range is always fine.
      if (!(v & (v - 1))) continue;

      // range = LookupTables.maxValue(v) - LookupTables.minValue(v);
      const clz32v = Math.clz32(v);
      const range = Math.clz32(v & -v) - clz32v;

      if (sumMinusMin < range) {
        // minValue(x) = sumMinusMin + LookupTables.minValue(v);
        const x = v << sumMinusMin;
        // Remove any values GREATER than x. Even if all other squares
        // take their minimum values, these are too big.
        if (!(v &= ((x & -x) << 1) - 1)) return false;
        grid[cells[i]] = v;
      }

      if (maxMinusSum < range) {
        // Remove any values LESS than x. Even if all other squares
        // take their maximum values, these are too small.
        //  where x = maxValue(v) - maxMinusSum;
        // NOTE: Inline calls since this is a heavily used function.
        // NOTE: -0x80000000 = -1 << 31
        if (!(v &= -0x80000000 >> (clz32v + maxMinusSum))) return false;
        grid[cells[i]] = v;
      }
    }

    return true;
  }

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMinMaxs = new Uint32Array(SHAPE_MAX.numCells);

  // Restricts cell values to only the ranges that are possible taking into
  // account uniqueness constraints between values.
  _restrictCellsWithCoefficients(grid, sum, coeffGroups) {
    let seenMinMaxs = this.constructor._seenMinMaxs;
    let strictMin = 0;
    let strictMax = 0;

    const numValues = this._sumData.numValues;
    const allValues = this._sumData.allValues;
    const sumTable = this._sumData.lookupTables.sum;
    const reverseTable = this._sumData.lookupTables.reverse;

    let index = 0;
    for (let i = 0; i < coeffGroups.length; i++) {
      let { coeff, exclusionGroups } = coeffGroups[i];
      for (let s = 0; s < exclusionGroups.length; s++) {
        const set = exclusionGroups[s];

        const v0 = grid[set[0]];
        let seenMin = v0 & -v0;
        // NOTE: seenMax is reversed.
        let seenMax = (allValues + 1) >> (32 - Math.clz32(v0));

        for (let j = 1; j < set.length; j++) {
          const v = grid[set[j]];

          // Set the smallest unset value >= min.
          // i.e. Try to add min to seenMin, but it if already exists then find
          // the next smallest value.
          let x = ~(seenMin | ((v & -v) - 1));
          seenMin |= x & -x;
          // Set the largest unset value <= max.
          // NOTE: seenMax will be reversed.
          x = ~seenMax & (-1 << (numValues - (32 - Math.clz32(v))));
          seenMax |= x & -x;
        }

        // Check if seenMin or seenMax have exceeded the bounds. This means
        // that they require values that are not possible.
        if ((seenMin | seenMax) > allValues) return false;

        seenMax = reverseTable[seenMax];
        const minSum = sumTable[seenMin];
        const maxSum = sumTable[seenMax];

        if (coeff === 1) {
          strictMax += maxSum;
          strictMin += minSum;
        } else if (coeff > 0) {
          strictMax += coeff * maxSum;
          strictMin += coeff * minSum;
        } else {
          strictMin += coeff * maxSum;
          strictMax += coeff * minSum;
        }

        // Save for later to determine which values can be removed.
        // If seenMin == seenMax, then this is already constrained, so set it to
        // 0  so we can easily skip it.
        seenMinMaxs[index] = (
          (seenMin != seenMax) ? seenMin | (seenMax << 16) : 0);
        index++;
      }
    }

    // Calculate degrees of freedom in the cell values.
    // i.e. How much leeway is there from the min and max value of each cell.
    let minDof = sum - strictMin;
    let maxDof = strictMax - sum;
    if (minDof < 0 || maxDof < 0) return false;

    index = 0;
    for (let i = 0; i < coeffGroups.length; i++) {
      const { coeff, exclusionGroups } = coeffGroups[i];
      // TODO: Can we be even more restrictive by subtracting the min set size.
      //       This didn't seem to work. Why?
      //       Also consider if the check below should use > instead.
      //       This also interacts with the bounds on the mask generation.
      const dofLim = (numValues - 1) * Math.abs(coeff);
      // If dofLim is too small, then we can stop, because the ceoffs are
      // ordered from largest to smallest.
      if (minDof >= dofLim && maxDof >= dofLim) break;

      let minDofSet = minDof;
      let maxDofSet = maxDof;
      if (coeff !== 1) {
        // Scale the dof limits by the coefficient.
        // We always take the floor since we need to stay with the range.
        // Truncation (| 0) is fine here since the result is always positive.
        if (coeff > 0) {
          const invCoeff = 1 / coeff;
          minDofSet = (minDofSet * invCoeff) | 0;
          maxDofSet = (maxDofSet * invCoeff) | 0;
        } else {
          const invCoeff = -1 / coeff;
          [maxDofSet, minDofSet] = [
            (minDofSet * invCoeff) | 0,
            (maxDofSet * invCoeff) | 0];
        }
      }

      for (let s = 0; s < exclusionGroups.length; s++) {
        const seenMinMax = seenMinMaxs[index];
        index++;

        // This entry has already been marked as not interesting.
        if (seenMinMax === 0) continue;

        let seenMin = seenMinMax;  // Upper bits are not valid.
        let seenMax = seenMinMax >> 16;

        let valueMask = -1;

        if (minDofSet < numValues - 1) {
          for (let j = minDofSet; j--;) seenMin |= seenMin << 1;
          valueMask = seenMin;
        }

        if (maxDofSet < numValues - 1) {
          for (let j = maxDofSet; j--;) seenMax |= seenMax >> 1;
          valueMask &= seenMax;
        }

        // If the value mask could potentially remove some values, then apply
        // the mask to the values in the set.
        if (~valueMask & allValues) {
          const set = exclusionGroups[s];
          for (let i = 0; i < set.length; i++) {
            if (!(grid[set[i]] &= valueMask)) {
              return false;
            }
          }
        }
      }
    }

    return true;
  }

  _restrictCellsSingleExclusionGroup(grid, sum, cells, handlerAccumulator) {
    const numCells = cells.length;

    // Check that we can make the current sum with the unfixed values remaining.
    let fixedValues = 0;
    let allValues = 0;
    let nonUniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v; // Avoid branching.
    }
    const fixedSum = this._sumData.lookupTables.sum[fixedValues];
    // Note: We have already check that this is fine earlier, but be defensive
    //       here because we use it to index into killerCageSums.
    if (fixedSum > sum) {
      return false;
    }

    // Check if we have enough unique values.
    if (countOnes16bit(allValues) < numCells) return false
    // Check if we have fixed all the values.
    if (allValues == fixedValues) {
      return fixedSum == sum;
    }

    const unfixedValues = allValues & ~fixedValues;
    let requiredUnfixed = unfixedValues;
    const numUnfixed = cells.length - countOnes16bit(fixedValues);

    let possibilities = 0;
    const options = this._sumData.killerCageSums[numUnfixed][sum - fixedSum];
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      if (!(o & ~unfixedValues)) {
        possibilities |= o;
        requiredUnfixed &= o;
      }
    }
    if (!possibilities) return false;

    // Remove any values that aren't part of any solution.
    const valuesToRemove = unfixedValues & ~possibilities;
    if (valuesToRemove) {
      for (let i = 0; i < numCells; i++) {
        // Safe to apply to every cell, since we know that none of the
        // fixedValues are in unfixedValues.
        if (!(grid[cells[i]] &= ~valuesToRemove)) return false;
      }
    }

    // requiredValues are values that appear in all possible solutions.
    // Those that are unique are hidden singles.
    const hiddenSingles = requiredUnfixed & ~nonUniqueValues;
    if (hiddenSingles) {
      if (!SudokuConstraintHandler._Util.exposeHiddenSingles(
        grid, cells, hiddenSingles)) {
        return false;
      }
    }

    // Only enforce required value exclusions if we have pairwise exclusions
    // passed in.
    if (!this._cellExclusions) return true;

    const nonUniqueRequired = requiredUnfixed & nonUniqueValues;
    if (nonUniqueRequired) {
      if (!SudokuConstraintHandler._Util.enforceRequiredValueExclusions(
        grid, cells, nonUniqueRequired, this._cellExclusions, handlerAccumulator)) {
        return false;
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const sum = this._sum;
    const coeffGroups = this._coeffGroups;
    const rangeInfo = this._sumData.lookupTables.rangeInfo;

    // Calculate stats. Each set is limited to 15 cells to avoid overflowing
    // rangeInfoSum.
    let maxSum = 0;
    let minSum = 0;
    let numUnfixed = this.cells.length;
    let fixedSum = 0;
    for (let g = 0; g < coeffGroups.length; g++) {
      const { coeff, cells } = coeffGroups[g];

      let rangeInfoSum = 0;
      for (let i = 0; i < cells.length; i++) {
        rangeInfoSum += rangeInfo[grid[cells[i]]];
      }

      numUnfixed -= rangeInfoSum >> 24;

      if (coeff === 1) {
        maxSum += (rangeInfoSum & 0xff);
        minSum += ((rangeInfoSum >> 8) & 0xff);
        fixedSum += ((rangeInfoSum >> 16) & 0xff);
      } else if (coeff < 0) {
        maxSum += coeff * ((rangeInfoSum >> 8) & 0xff);
        minSum += coeff * (rangeInfoSum & 0xff);
        fixedSum += coeff * ((rangeInfoSum >> 16) & 0xff);
      } else {
        maxSum += coeff * (rangeInfoSum & 0xff);
        minSum += coeff * ((rangeInfoSum >> 8) & 0xff);
        fixedSum += coeff * ((rangeInfoSum >> 16) & 0xff);
      }
    }

    // It is impossible to make the target sum.
    if (sum < minSum || maxSum < sum) return false;
    // We've reached the target sum exactly.
    // NOTE: Uniqueness constraint is already enforced by the solver via
    //       exclusionCells.
    if (minSum == maxSum) return true;

    // A large fixed value indicates a cell has a 0, hence is already
    // unsatisfiable.
    // If all cells were fixed, then we would have returned already - so this
    // can also only occur when there is a 0.
    if (numUnfixed <= 0) return false;

    const hasFewUnfixed = this._hasFewRemainingCells(numUnfixed);

    if (hasFewUnfixed) {
      // If there are few remaining cells then handle them explicitly.
      const targetSum = sum - fixedSum;
      if (!this._enforceFewRemainingCells(grid, targetSum, numUnfixed)) {
        return false;
      }
    } else {
      const numValues = this._sumData.numValues;
      // Restrict the possible range of values in each cell based on whether they
      // will cause the sum to be too large or too small.
      const sumMinusMin = sum - minSum;
      const maxMinusSum = maxSum - sum;

      for (let g = 0; g < coeffGroups.length; g++) {
        const { coeff, cells } = coeffGroups[g];
        const dofLim = numValues * Math.abs(coeff);
        // If dofLim is too small, then we can stop, because the ceoffs are
        // ordered from largest to smallest.
        if (sumMinusMin >= dofLim && maxMinusSum >= dofLim) break;

        if (!this._restrictValueRange(grid, cells, coeff,
          sumMinusMin, maxMinusSum)) {
          return false;
        }
      }
    }

    if (this._complementCells !== null) {
      return this._enforceCombinationsWithComplement(grid, handlerAccumulator);
    }

    // If _enforceFewRemainingCells has run, then we've already done all we can.
    if (hasFewUnfixed) return true;

    if (this._flags & this.constructor._FLAG_CAGE) {
      if (!this._restrictCellsSingleExclusionGroup(
        grid, this._sum, this.cells, handlerAccumulator)) return false;
    } else {
      if (!this._restrictCellsWithCoefficients(
        grid, sum, this._coeffGroups)) return false;
    }

    return true;
  }
}

// Common data shared between instances of the Sum handler.
SudokuConstraintHandler.Sum._SumData = class _SumData {

  static get = memoize((numValues) => {
    return new SudokuConstraintHandler.Sum._SumData(true, numValues);
  });

  constructor(do_not_call, numValues) {
    if (!do_not_call) throw ('Use SudokuConstraintHandler.Sum._SumData.get(shape.numValues)');

    this.numValues = numValues;
    this.lookupTables = LookupTables.get(numValues);
    this.allValues = this.lookupTables.allValues;

    const combinations = this.lookupTables.combinations;
    this.maxCageSum = numValues * (numValues + 1) / 2;

    this.killerCageSums = (() => {
      let table = [];
      for (let n = 0; n < numValues + 1; n++) {
        let totals = [];
        table.push(totals);
        for (let i = 0; i < this.maxCageSum + 1; i++) {
          totals.push([]);
        }
      }

      const sums = this.lookupTables.sum;
      for (let i = 0; i < combinations; i++) {
        table[countOnes16bit(i)][sums[i]].push(i);
      }

      return table;
    })();

    // Precompute the sums for all pairs of cells. Assumes cells must be unique.
    //
    // For cell values a and b:
    // pairwiseSums[(a<<numValues)|b] = sum>>2;
    // (The shift is so the result fits in 16 bits).
    this.pairwiseSums = (() => {
      if (numValues > SHAPE_9x9.numValues) return;
      const table = new Uint16Array(combinations * combinations);

      for (let i = 0; i < combinations; i++) {
        for (let j = i; j < combinations; j++) {
          let result = 0;
          for (let k = 1; k <= numValues; k++) {
            // Check if j contains k.
            const kInJ = (j >> (k - 1)) & 1;
            if (kInJ) {
              // Add k to all values in i.
              let s = i << k;
              // Remove 2*k, as we require the values to be unique.
              s &= ~(1 << (2 * k - 1));
              // Store s-2, so we don't overrun 16 bits.
              // (Note, we have an extra one from the sum already).
              s >>= 2;
              result |= s;
            }
          }
          table[(i << numValues) | j] = table[(j << numValues) | i] = result;
        }
      }

      return table;
    })();

    // Store the sum of a+a for all combinations of a.
    this.doubles = (() => {
      const table = new Uint32Array(combinations);

      for (let j = 0; j < combinations; j++) {
        let result = 0;
        for (let k = 1; k <= numValues; k++) {
          // Check if j contains k.
          const kInJ = (j >> (k - 1)) & 1;
          if (kInJ) {
            const s = 1 << (2 * k - 1);
            result |= s;
          }
        }
        table[j] = result;
      }
      return table;
    })();
  }
}
