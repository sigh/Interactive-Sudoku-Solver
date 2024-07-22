class SudokuConstraintOptimizer {
  // Maximum number of cells in some sums generated by the optimizers.
  _MAX_SUM_SIZE = 6;

  constructor(debugLogger) {
    this._debugLogger = null;
    if (debugLogger.enableLogs) {
      this._debugLogger = debugLogger;
    }
  }

  optimize(handlerSet, cellExclusions, shape) {
    const hasBoxes = handlerSet.getAllofType(SudokuConstraintHandler.NoBoxes).length == 0;

    this._addHouseHandlers(handlerSet, shape);

    this._optimizeSums(handlerSet, cellExclusions, hasBoxes, shape);

    this._addSumComplementCells(handlerSet);

    this._optimizeJigsaw(handlerSet, hasBoxes, shape);

    this._optimizeFullRank(handlerSet, shape);

    if (hasBoxes) {
      this._addHouseIntersections(handlerSet, shape);
    }
  }

  _addHouseIntersections(handlerSet, shape) {
    const houseHandlers = handlerSet.getAllofType(SudokuConstraintHandler.House);
    const numHandlers = houseHandlers.length;
    for (let i = 1; i < numHandlers; i++) {
      for (let j = 0; j < i; j++) {
        const intersectionSize = arrayIntersectSize(
          houseHandlers[i].cells, houseHandlers[j].cells);
        if (intersectionSize !== shape.boxWidth && intersectionSize !== shape.boxHeight) continue;
        const newHandler = new SudokuConstraintHandler.SameValues(
          arrayDifference(houseHandlers[i].cells, houseHandlers[j].cells),
          arrayDifference(houseHandlers[j].cells, houseHandlers[i].cells),
          true);
        handlerSet.addAux(newHandler);
        if (this._debugLogger) {
          this._debugLogger.log({
            loc: '_addHouseIntersections',
            msg: `Add: ${newHandler.constructor.name} (aux)`,
            cells: newHandler.cells,
          });
        }
      }
    }
  }

  _optimizeJigsaw(handlerSet, hasBoxes, shape) {
    const jigsawHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Jigsaw);
    if (jigsawHandlers.length == 0) return;
    if (jigsawHandlers.length > 1) throw ('Multiple jigsaw handlers');
    const jigsawHandler = jigsawHandlers[0];


    handlerSet.addNonEssential(
      ...this._makeJigsawIntersections(handlerSet));

    handlerSet.addNonEssential(
      ...this._makeJigsawLawOfLeftoverHandlers(jigsawHandler, hasBoxes, shape));
  }

  // Find a non-overlapping set of handlers.
  _findNonOverlappingSubset(handlers, fullHandlerSet) {
    const handlerIndexes = new Set(
      handlers.map(h => fullHandlerSet.getIndex(h)));

    // Sort handers by number of overlapping handlers.
    const handlersByOverlaps = [];
    for (const h of handlers) {
      const overlapIndexes = fullHandlerSet.getIntersectingIndexes(h);
      const numOverlap = setIntersection(overlapIndexes, handlerIndexes);
      handlersByOverlaps.push([h, numOverlap]);
    }
    handlersByOverlaps.sort((a, b) => a[1] - b[1]);

    // Find a set of mutually non-overlapping handlers.
    // Start with the handlers with the least overlaps as they restrict future
    // choices the least.
    // i.e. greedy bin-packing.
    const cellsIncluded = new Set();
    const nonOverlappingHandlers = [];
    for (const [h, _] of handlersByOverlaps) {
      if (h.cells.some(c => cellsIncluded.has(c))) continue;
      nonOverlappingHandlers.push(h);
      h.cells.forEach(c => cellsIncluded.add(c));
    }

    return [nonOverlappingHandlers, cellsIncluded];
  }

  _optimizeSums(handlerSet, cellExclusions, hasBoxes, shape) {
    // TODO: Consider how this interacts with fixed cells.
    const allSumHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Sum);
    if (allSumHandlers.length == 0) return;
    // Exclude any handlers with duplicate cells from any of the optimizations.
    // TODO: Check which optimizations are still valid.
    const safeSumHandlers = allSumHandlers.filter(
      h => h.cells.length == new Set(h.cells).size);

    const [filteredSumHandlers, sumCells] =
      this._findNonOverlappingSubset(safeSumHandlers, handlerSet);

    handlerSet.addNonEssential(
      ...this._fillInSumGap(filteredSumHandlers, sumCells, shape));

    handlerSet.addNonEssential(
      ...this._makeInnieOutieSumHandlers(filteredSumHandlers, hasBoxes, shape));

    handlerSet.addNonEssential(
      ...this._makeHiddenCageHandlers(handlerSet, safeSumHandlers, shape));

    this._replaceSizeSpecificSumHandlers(handlerSet, cellExclusions, shape);

    return;
  }

  _addSumComplementCells(handlerSet) {
    const houseHandlers = (
      handlerSet.getAllofType(SudokuConstraintHandler.House).map(
        h => handlerSet.getIndex(h)));
    const cellMap = handlerSet.getOrdinaryHandlerMap();

    const findCommonHandler = (cells) => {
      let commonHandlers = houseHandlers;
      for (const c of cells) {
        commonHandlers = arrayIntersect(commonHandlers, cellMap[c]);
        if (commonHandlers.length == 0) return;
      }
      return handlerSet.getHandler(commonHandlers[0]);
    };

    const process = (type, cellsFn) => {
      for (const h of handlerSet.getAllofType(type)) {
        if (h.hasComplementCells()) continue;
        // If there are any repeated cells, then we can't infer the complement
        // sum.
        if (h.cells.length !== new Set(h.cells).size) continue;

        const cells = cellsFn(h);
        const commonHandler = findCommonHandler(cells);
        if (!commonHandler) continue;

        const complementCells = arrayDifference(commonHandler.cells, cells);
        h.setComplementCells(complementCells);
      }
    };

    process(SudokuConstraintHandler.Sum, h => h.cells);
  }

  _fillInSumGap(sumHandlers, sumCells, shape) {
    // Fill in a gap if one remains.
    const numNonSumCells = shape.numCells - sumCells.size;
    if (numNonSumCells == 0 || numNonSumCells >= shape.gridSize) return [];

    const sumHandlersSum = sumHandlers.map(h => h.sum()).reduce((a, b) => a + b);
    const remainingSum = shape.gridSize * shape.maxSum - sumHandlersSum;

    const remainingCells = new Set(shape.allCells);
    sumHandlers.forEach(h => h.cells.forEach(c => remainingCells.delete(c)));
    const newHandler = new SudokuConstraintHandler.Sum(
      new Uint8Array(remainingCells), remainingSum);

    sumHandlers.push(newHandler);
    remainingCells.forEach(c => sumCells.add(c));

    if (this._debugLogger) {
      this._debugLogger.log({
        loc: '_fillInSumGap',
        msg: 'Add: ' + newHandler.constructor.name,
        args: { sum: remainingSum },
        cells: newHandler.cells,
      });
    }

    return [newHandler];
  }

  // Add house handlers for any AllDifferentHandler which have numValues cells.
  _addHouseHandlers(handlerSet, shape) {
    for (const h of
      handlerSet.getAllofType(SudokuConstraintHandler.AllDifferent)) {
      const cells = h.exclusionCells();
      if (cells.length == shape.numValues) {
        handlerSet.addNonEssential(
          new SudokuConstraintHandler.House(cells));
      }
    }
  }

  // Find {1-2}-cell sum constraints and replace them dedicated handlers.
  _replaceSizeSpecificSumHandlers(handlerSet, cellExclusions, shape) {
    const sumHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Sum);
    for (const h of sumHandlers) {
      let newHandler;
      switch (h.cells.length) {
        case 1:
          newHandler = new SudokuConstraintHandler.GivenCandidates(
            new Map([[h.cells[0], h.sum()]]));
          break;

        case 2:
          const mutuallyExclusive = (
            cellExclusions.isMutuallyExclusive(...h.cells));
          newHandler = new SudokuConstraintHandler.BinaryConstraint(
            h.cells[0], h.cells[1],
            SudokuConstraint.Binary.fnToKey(
              (a, b) => a + b == h.sum() && (!mutuallyExclusive || a != b),
              shape.numValues));
          break;
      }

      if (newHandler) {
        handlerSet.replace(h, newHandler);
        if (this._debugLogger) {
          this._debugLogger.log({
            loc: '_replaceSizeSpecificSumHandlers',
            msg: 'Replace with: ' + newHandler.constructor.name,
            cells: newHandler.cells,
          });
        }
      }
    }
  }

  // Create a Sum handler out of all the cages sticking out of a house.
  _addSumIntersectionHandler(
    houseHandler, intersectingSumHandlers, intersectingHouseHandlers,
    allHouseHandlers, shape) {
    const gridSize = shape.gridSize;

    let totalSum = 0;
    let cells = new Set();
    let uncoveredCells = new Set(houseHandler.cells);
    for (const h of intersectingSumHandlers) {
      totalSum += h.sum();
      h.cells.forEach(c => cells.add(c));
      h.cells.forEach(c => uncoveredCells.delete(c));
    }

    // If we haven't filled up the entire house then try to greedily fill the
    // holes with house handlers.
    let usedExtraHouses = false;
    if (uncoveredCells.size > 0) {
      for (const h of intersectingHouseHandlers) {
        // Ignore any houses which intersect with the existing cells.
        if (setIntersectSize(cells, h.cells) > 0) continue;
        // Ignore any houses which don't cover the uncovered cells.
        const intersectSize = setIntersectSize(uncoveredCells, h.cells);
        if (intersectSize == 0) continue;
        // Ignore handlers which only intersect in one square. This is likely
        // a row crossing a column, and is generally not useful.
        if (intersectSize == 1) continue;
        // Ensure the intersection only covers the uncovered cells.
        if (intersectSize != arrayIntersectSize(houseHandler.cells, h.cells)) {
          continue;
        }
        // This handler fills in an existing gap.
        totalSum += shape.maxSum;
        h.cells.forEach(c => cells.add(c));
        h.cells.forEach(c => uncoveredCells.delete(c));
        usedExtraHouses = true;
        if (uncoveredCells.size == 0) break;
      }
    }

    // If we still haven't covered all the cells, then give up.
    if (uncoveredCells.size > 0) return null;

    // Remove the current house cells, as we care about the cells outside the
    // house.
    houseHandler.cells.forEach(c => cells.delete(c));
    totalSum -= shape.maxSum;

    // While it's possible that there could be a house completely contained
    // within the cells, then try to find and remove them.
    // Note that houses used to construct the cells won't match as we have
    // already removed the cells in the current house.
    let removedExtraHouses = false;
    if (cells.size >= gridSize) {
      for (const h of allHouseHandlers) {
        // Ignore any houses which don't cover the cells.
        const intersectSize = setIntersectSize(cells, h.cells);
        if (intersectSize != gridSize) continue;
        // This house is completely contained within the cells.
        totalSum -= shape.maxSum;
        h.cells.forEach(c => cells.delete(c));
        removedExtraHouses = true;
        if (cells.size < gridSize) break;
      }
    }

    if (cells.size == 0) return null;

    // Don't add sums with too many cells, as they are less likely to be
    // restrictive and useful.
    // Make an exception for when the total sum is closer to an extreme
    // (large or small) as that will restrict its values more.
    if (cells.size > this._MAX_SUM_SIZE) {
      // If the average value of the sum is close to the middle, then the
      // values have more leeway. Use this to determine if the sum is worth
      // keeping.
      const avgVal = totalSum / cells.size;
      const sumSkew = Math.abs(avgVal - shape.numValues / 2);

      const MIN_SUM_SKEW = 2;
      if (sumSkew < MIN_SUM_SKEW) {
        if (this._debugLogger) {
          const cellsArray = Array.from(cells);
          const cellString = cellsArray.map(c => shape.makeCellIdFromIndex(c)).join('~');
          this._debugLogger.log({
            loc: '_addSumIntersectionHandler',
            msg: 'Discarded inferred handler: ' +
              `.Sum~${totalSum}~${cellString}`,
            args: { sumSkew: +sumSkew.toFixed(2) },
            cells: cellsArray,
          });
        }

        return null;
      }
    }

    const handler = new SudokuConstraintHandler.Sum(
      Array.from(cells), totalSum);

    if (this._debugLogger) {
      let args = { sum: handler.sum(), size: handler.cells.length };
      if (usedExtraHouses) args.usedExtraHouses = usedExtraHouses;
      if (removedExtraHouses) args.removedExtraHouses = removedExtraHouses;
      this._debugLogger.log({
        loc: '_addSumIntersectionHandler',
        msg: 'Add: ' + handler.constructor.name,
        args: args,
        cells: handler.cells
      });
    }

    return handler;
  }

  // Find sets of cells which we can infer have a known sum and unique values.
  _makeHiddenCageHandlers(handlerSet, allSumHandlers, shape) {
    const houseHandlers = handlerSet.getAllofType(SudokuConstraintHandler.House);
    const newHandlers = [];

    const allSumHandlerIndexes = new Set(
      allSumHandlers.map(h => handlerSet.getIndex(h)));
    const houseHandlerIndexes = new Set(
      houseHandlers.map(h => handlerSet.getIndex(h)));

    for (const h of houseHandlers) {
      // Find sum constraints which overlap this house.
      let intersectingHandlers = handlerSet.getIntersectingIndexes(h);
      const currentHouseSumIndexes = setIntersection(
        intersectingHandlers, allSumHandlerIndexes);
      if (!currentHouseSumIndexes.size) continue;

      // For the sum intersection, we need to ensure that the sum handlers don't
      // overlap themselves.
      // We do this separately for each house so that we can don't have to
      // force the same handle to be used in every house it intersects.
      const [filteredSumHandlers, _] = this._findNonOverlappingSubset(
        Array.from(currentHouseSumIndexes).map(
          i => handlerSet.getHandler(i)),
        handlerSet);

      {
        const intersectingHouseHandlers = Array.from(
          setIntersection(intersectingHandlers, houseHandlerIndexes)).map(
            i => handlerSet.getHandler(i));
        const sumIntersectionHandler = this._addSumIntersectionHandler(
          h, filteredSumHandlers, intersectingHouseHandlers, houseHandlers,
          shape);
        if (sumIntersectionHandler) newHandlers.push(sumIntersectionHandler);
      }

      // Outies are cages which stick out of the house by 1 cell.
      const outies = [];
      // Constrained cells are those from cages which are fully contained within
      // the house.
      const constrainedCells = [];
      let constrainedSum = 0;
      for (const k of filteredSumHandlers) {
        const overlapSize = arrayIntersectSize(h.cells, k.cells);
        if (overlapSize == k.cells.length) {
          constrainedCells.push(...k.cells);
          constrainedSum += k.sum();
          k.setComplementCells(arrayDifference(h.cells, k.cells));
        } else if (k.cells.length - overlapSize == 1) {
          outies.push(k);
        }
      }

      // Short-circuit the common case where there is nothing special in the
      // house.
      if (outies.length == 0 && constrainedCells.length == 0) continue;

      const complementCells = arrayDifference(h.cells, constrainedCells);
      const complementSum = shape.maxSum - constrainedSum;

      // If a cage sticks out of a house by 1 cell, then we can form the
      // equivalent of an arrow sum (with offset). That is, the value of the
      // cell outside house is direct offset of the sum of the remaining
      // cells in the house outside the cage. The sum can be further reduced
      // by any other cages (i.e. known sums) in the house.
      for (const o of outies) {
        const remainingCells = arrayDifference(complementCells, o.cells);
        // Don't add sums with too many cells.
        if (remainingCells.length + 1 > this._MAX_SUM_SIZE) continue;

        const extraCells = arrayDifference(o.cells, h.cells);
        const remainingSum = complementSum - o.sum();
        const handler = new SudokuConstraintHandler.SumWithNegative(
          remainingCells, extraCells, remainingSum);
        newHandlers.push(handler);

        if (this._debugLogger) {
          this._debugLogger.log({
            loc: '_makeHiddenCageHandlers',
            msg: 'Add: ' + handler.constructor.name,
            args: { offset: remainingSum, negativeCells: extraCells },
            cells: handler.cells
          });
        }
      }

      // No constraints within this house.
      if (constrainedCells.length == 0) continue;
      // The remaining 8-cell will already be constrained after the first
      // pass.
      if (constrainedCells.length == 1) continue;
      // Nothing left to constrain.
      if (constrainedCells.length == shape.gridSize) continue;

      const complementHandler = new SudokuConstraintHandler.Sum(
        complementCells, complementSum);
      complementHandler.setComplementCells(constrainedCells);
      newHandlers.push(complementHandler);
      if (this._debugLogger) {
        this._debugLogger.log({
          loc: '_makeHiddenCageHandlers',
          msg: 'Add: ' + complementHandler.constructor.name,
          args: { sum: complementSum },
          cells: complementCells
        });
      }
    }

    return newHandlers;
  }

  // Add same value handlers for the intersections between houses.
  _makeJigsawIntersections(handlerSet) {
    const houseHandlers = handlerSet.getAllofType(SudokuConstraintHandler.House);
    const newHandlers = [];

    // Add constraints due to overlapping regions.
    for (const h0 of houseHandlers) {
      for (const h1 of houseHandlers) {
        if (h0 === h1) continue;

        const diff0 = arrayDifference(h0.cells, h1.cells);
        if (diff0.length > this._MAX_SUM_SIZE || diff0.length == 0) continue;

        // We have some overlapping cells!
        // This means diff0 and diff1 must contain the same values.
        const diff1 = arrayDifference(h1.cells, h0.cells);

        // TODO: Optimize the diff0.length == 1 case (and 2?).
        const handler = new SudokuConstraintHandler.SameValues(
          diff0, diff1, true);
        newHandlers.push(handler);
        if (this._debugLogger) {
          this._debugLogger.log({
            loc: '_makeJigsawIntersections',
            msg: 'Add: SameValues',
            cells: handler.cells,
          });
        }
      }
    }

    return newHandlers;
  }

  _overlapRegions = memoize((shape) => {
    const rowRegions = SudokuConstraintBase.rowRegions(shape);
    const colRegions = SudokuConstraintBase.colRegions(shape);
    return [
      rowRegions,
      rowRegions.slice().reverse(),
      colRegions,
      colRegions.slice().reverse(),
    ];
  });

  _overlapRegionsWithBox = memoize((shape) => {
    return [
      ...this._overlapRegions(shape),
      SudokuConstraintBase.boxRegions(shape),
    ];
  });

  _generalRegionOverlapProcessor(regions, pieces, gridSize, callback) {
    const superRegion = new Set();
    const remainingPieces = new Set(pieces);
    const usedPieces = [];
    const piecesRegion = new Set();

    let i = 0;
    for (const r of regions) {
      i++;
      if (i == gridSize) break;

      // Add r to our super-region.
      r.forEach(e => superRegion.add(e));

      // Add any remaining pieces with enough overlap to our super-region.
      for (const p of remainingPieces) {
        const intersectionSize = setIntersectSize(superRegion, p);
        if (intersectionSize > p.length / 2) {
          remainingPieces.delete(p);
          for (const c of p) piecesRegion.add(c);
          usedPieces.push(p);
        }
      }

      // Don't process the first region, as that usually doubles up work from
      // elsewhere.
      if (i == 1) continue;

      callback(superRegion, piecesRegion, usedPieces);
    }
  }

  _makeJigsawLawOfLeftoverHandlers(jigsawHandler, hasBoxes, shape) {
    const newHandlers = [];

    const handleOverlap = (superRegion, piecesRegion, usedPieces) => {
      // We can only match when regions are the same size.
      if (superRegion.size != piecesRegion.size) return;

      const diffA = setDifference(superRegion, piecesRegion);
      if (diffA.size == 0) return;
      const diffB = setDifference(piecesRegion, superRegion);
      // Ignore diff that too big, they are probably not very well
      // constrained.
      if (diffA.size >= shape.gridSize) return;

      // All values in the set differences must be the same.
      const newHandler = new SudokuConstraintHandler.SameValues(
        [...diffA], [...diffB], false);
      newHandlers.push(newHandler);
      if (this._debugLogger) {
        this._debugLogger.log({
          loc: '_makeJigsawLawOfLeftoverHandlers',
          msg: 'Add: ' + newHandler.constructor.name,
          cells: newHandler.cells,
        });
      }
    }

    const overlapRegions = (
      hasBoxes ? this._overlapRegionsWithBox(shape) : this._overlapRegions(shape));
    for (const r of overlapRegions) {
      this._generalRegionOverlapProcessor(
        r, jigsawHandler.regions, shape.gridSize, handleOverlap);
    }

    return newHandlers;
  }

  _makeInnieOutieSumHandlers(sumHandlers, hasBoxes, shape) {
    const newHandlers = [];
    const gridSize = shape.gridSize;

    const pieces = sumHandlers.map(h => h.cells);
    const piecesMap = new Map(sumHandlers.map(h => [h.cells, h.sum()]));

    const cellsInSum = new Set();
    sumHandlers.forEach(h => h.cells.forEach(c => cellsInSum.add(c)));
    const hasCellsWithoutSum = (cells) => {
      for (const c of cells) {
        if (!cellsInSum.has(c)) return true;
      }
      return false;
    };

    const handleOverlap = (superRegion, piecesRegion, usedPieces) => {
      let diffA = setDifference(superRegion, piecesRegion);
      let diffB = setDifference(piecesRegion, superRegion);

      // No diff, no new constraints to add.
      if (diffA.size == 0 && diffB.size == 0) return;
      // Don't use this if the diff is too large.
      if (diffA.size + diffB.size > gridSize) return;

      // We can only do negative sum constraints when the diff is 1.
      // We can only do sum constraints when the diff is 0.
      if (diffA.size > 2 && diffB.size > 2) return;

      if (!(hasCellsWithoutSum(diffA) || hasCellsWithoutSum(diffB))) {
        // If all cells in the diff overlap with a piece, then limit the size of
        // the sum.
        if (diffA.size + diffB.size > this._MAX_SUM_SIZE) return;
        // Otherwise we are adding a sum constraint to a cell which doesn't
        // currently have one, so we'll take all the help we can get!
      }

      let sumDelta = -superRegion.size * shape.maxSum / gridSize;
      for (const p of usedPieces) sumDelta += piecesMap.get(p);

      // Ensure diffA is the smaller.
      if (diffA.size > diffB.size) {
        [diffA, diffB] = [diffB, diffA];
        sumDelta = -sumDelta;
      }

      let newHandler;
      let args;
      if (diffA.size == 0) {
        newHandler = new SudokuConstraintHandler.Sum([...diffB], sumDelta);
        args = { sum: sumDelta };
      } else {
        const negativeCells = [...diffA];
        newHandler = new SudokuConstraintHandler.SumWithNegative(
          [...diffB], negativeCells, sumDelta);
        args = { sum: sumDelta, negativeCells: negativeCells };
      }

      newHandlers.push(newHandler);
      if (this._debugLogger) {
        this._debugLogger.log({
          loc: '_makeInnieOutieSumHandlers',
          msg: 'Add: ' + newHandler.constructor.name,
          args: args,
          cells: newHandler.cells,
        });
      }
    };

    const overlapRegions = (
      hasBoxes ? this._overlapRegionsWithBox(shape) : this._overlapRegions(shape));
    for (const r of overlapRegions) {
      this._generalRegionOverlapProcessor(
        r, pieces, shape.gridSize, handleOverlap);
    }

    return newHandlers;
  }

  _optimizeFullRank(handlerSet, shape) {
    const rankHandlers = handlerSet.getAllofType(SudokuConstraintHandler.FullRank);
    if (rankHandlers.length == 0) return;

    const clues = [];
    for (const h of rankHandlers) {
      clues.push(...h.clues());
      handlerSet.replace(h, new SudokuConstraintHandler.True());
    }

    const handler = new SudokuConstraintHandler.FullRank(
      shape.numCells, clues);
    handlerSet.add(handler);

    if (this._debugLogger) {
      this._debugLogger.log({
        loc: '_optimizeFullRank',
        msg: 'Combine: ' + handler.constructor.name,
        args: { numHandlers: rankHandlers.length },
        cells: handler.cells
      });
    }

  }
}