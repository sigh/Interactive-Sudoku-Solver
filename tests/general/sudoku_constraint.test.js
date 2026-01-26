import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../../js/grid_shape.js');
const { SudokuConstraintBase, SudokuConstraint } = await import('../../js/sudoku_constraint.js');

// ============================================================================
// Region generation
// ============================================================================

await runTest('rowRegions returns correct number of regions', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.rowRegions(shape);
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('rowRegions contains correct cells', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.rowRegions(shape);
  // First row should be cells 0-8
  assert.deepEqual(regions[0], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // Second row should be cells 9-17
  assert.deepEqual(regions[1], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

await runTest('colRegions returns correct number of regions', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.colRegions(shape);
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('colRegions contains correct cells', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.colRegions(shape);
  // First column should be cells 0, 9, 18, ...
  assert.deepEqual(regions[0], [0, 9, 18, 27, 36, 45, 54, 63, 72]);
  // Second column should be cells 1, 10, 19, ...
  assert.deepEqual(regions[1], [1, 10, 19, 28, 37, 46, 55, 64, 73]);
});

await runTest('boxRegions returns correct number of regions', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.boxRegions(shape);
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('boxRegions contains correct cells for 9x9', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.boxRegions(shape);
  // First box (top-left) should contain cells in rows 0-2, cols 0-2
  assert.deepEqual(regions[0].sort((a, b) => a - b), [0, 1, 2, 9, 10, 11, 18, 19, 20]);
});

await runTest('boxRegions works for 6x6', () => {
  const shape = GridShape.fromGridSize(6);
  const regions = SudokuConstraintBase.boxRegions(shape);
  assert.equal(regions.length, 6);
  for (const region of regions) {
    assert.equal(region.length, 6);
  }
  // First box is 2 rows x 3 cols for 6x6
  assert.deepEqual(regions[0].sort((a, b) => a - b), [0, 1, 2, 6, 7, 8]);
});

// Rectangular grid tests for boxRegions
await runTest('boxRegions for 4x6 grid has correct structure', () => {
  const shape = GridShape.fromGridSize(4, 6);
  // 4 rows, 6 cols, numValues=6, boxes are 2x3

  const regions = SudokuConstraintBase.boxRegions(shape);
  // 4 boxes: (4/2) * (6/3) = 2 * 2 = 4
  assert.equal(regions.length, 4);
  for (const region of regions) {
    assert.equal(region.length, 6, 'Each box should have 6 cells');
  }
});

await runTest('boxRegions for 4x6 grid cells are in bounds', () => {
  const shape = GridShape.fromGridSize(4, 6);
  const regions = SudokuConstraintBase.boxRegions(shape);

  for (const region of regions) {
    for (const cell of region) {
      assert.ok(cell >= 0 && cell < shape.numCells,
        `Cell ${cell} out of bounds [0, ${shape.numCells})`);
    }
  }
});

await runTest('boxRegions for 4x6 grid first box is correct', () => {
  const shape = GridShape.fromGridSize(4, 6);
  const regions = SudokuConstraintBase.boxRegions(shape);
  // Box 0 (top-left): rows 0-1, cols 0-2 => cells 0,1,2,6,7,8
  assert.deepEqual(regions[0].sort((a, b) => a - b), [0, 1, 2, 6, 7, 8]);
});

await runTest('boxRegions for 4x6 grid second box is correct', () => {
  const shape = GridShape.fromGridSize(4, 6);
  const regions = SudokuConstraintBase.boxRegions(shape);
  // Box 1 (top-right): rows 0-1, cols 3-5 => cells 3,4,5,9,10,11
  assert.deepEqual(regions[1].sort((a, b) => a - b), [3, 4, 5, 9, 10, 11]);
});

await runTest('boxRegions for 6x4 grid has correct structure', () => {
  const shape = GridShape.fromGridSize(6, 4);
  // 6 rows, 4 cols, numValues=6, boxes are 3x2

  const regions = SudokuConstraintBase.boxRegions(shape);
  // 4 boxes: (6/3) * (4/2) = 2 * 2 = 4
  assert.equal(regions.length, 4);
  for (const region of regions) {
    assert.equal(region.length, 6, 'Each box should have 6 cells');
  }
});

await runTest('boxRegions for 6x4 grid cells are in bounds', () => {
  const shape = GridShape.fromGridSize(6, 4);
  const regions = SudokuConstraintBase.boxRegions(shape);

  for (const region of regions) {
    for (const cell of region) {
      assert.ok(cell >= 0 && cell < shape.numCells,
        `Cell ${cell} out of bounds [0, ${shape.numCells})`);
    }
  }
});

await runTest('boxRegions for rectangular grids cover all cells exactly once', () => {
  for (const [rows, cols] of [[4, 6], [6, 4], [6, 8], [8, 6]]) {
    const shape = GridShape.fromGridSize(rows, cols);

    const regions = SudokuConstraintBase.boxRegions(shape);
    const allCells = regions.flat().sort((a, b) => a - b);
    const expected = Array.from({ length: shape.numCells }, (_, i) => i);
    assert.deepEqual(allCells, expected, `boxRegions for ${rows}x${cols}`);
  }
});

await runTest('all regions cover all cells exactly once', () => {
  for (const size of [4, 6, 9]) {
    const shape = GridShape.fromGridSize(size);
    for (const regionFn of [
      SudokuConstraintBase.rowRegions,
      SudokuConstraintBase.colRegions,
      SudokuConstraintBase.boxRegions
    ]) {
      const regions = regionFn(shape);
      const allCells = regions.flat().sort((a, b) => a - b);
      const expected = Array.from({ length: shape.numCells }, (_, i) => i);
      assert.deepEqual(allCells, expected, `${regionFn.name} for size ${size}`);
    }
  }
});

// ============================================================================
// Disjoint set regions
// ============================================================================

await runTest('disjointSetRegions for 9x9 has correct structure', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  // 9 positions per box => 9 sets
  assert.equal(regions.length, 9);
  // 9 boxes => 9 cells per set
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('disjointSetRegions for 9x9 covers all cells exactly once', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  const allCells = regions.flat().sort((a, b) => a - b);
  const expected = Array.from({ length: 81 }, (_, i) => i);
  assert.deepEqual(allCells, expected);
});

await runTest('disjointSetRegions for 9x9 each set has one cell per box', () => {
  const shape = GridShape.fromGridSize(9);
  const disjointSets = SudokuConstraintBase.disjointSetRegions(shape);
  const boxes = SudokuConstraintBase.boxRegions(shape);

  for (const disjointSet of disjointSets) {
    for (const box of boxes) {
      const boxSet = new Set(box);
      const intersection = disjointSet.filter(c => boxSet.has(c));
      assert.equal(intersection.length, 1,
        `Each disjoint set should have exactly 1 cell from each box`);
    }
  }
});

await runTest('disjointSetRegions for 9x9 cells are at same position in their box', () => {
  const shape = GridShape.fromGridSize(9);
  const disjointSets = SudokuConstraintBase.disjointSetRegions(shape);

  // Helper to get position within box (0-8 for 3x3 box)
  const getPositionInBox = (cell) => {
    const row = Math.floor(cell / 9);
    const col = cell % 9;
    const posRow = row % 3;
    const posCol = col % 3;
    return posRow * 3 + posCol;
  };

  for (let setIdx = 0; setIdx < disjointSets.length; setIdx++) {
    const positions = disjointSets[setIdx].map(getPositionInBox);
    // All cells in the set should be at the same position in their box
    assert.ok(positions.every(p => p === positions[0]),
      `Set ${setIdx}: all cells should be at same position, got ${positions}`);
  }
});

await runTest('disjointSetRegions for 6x6 has correct structure', () => {
  const shape = GridShape.fromGridSize(6);
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  // 6 positions per box => 6 sets
  assert.equal(regions.length, 6);
  // 6 boxes => 6 cells per set
  for (const region of regions) {
    assert.equal(region.length, 6);
  }
});

await runTest('disjointSetRegions for 6x6 covers all cells exactly once', () => {
  const shape = GridShape.fromGridSize(6);
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  const allCells = regions.flat().sort((a, b) => a - b);
  const expected = Array.from({ length: 36 }, (_, i) => i);
  assert.deepEqual(allCells, expected);
});

await runTest('disjointSetRegions for 4x6 rectangular grid', () => {
  const shape = GridShape.fromGridSize(4, 6);
  // 4x6 grid, numValues=6, boxes are 2x3
  // 6 positions per box => 6 sets
  // 4 boxes => 4 cells per set
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  assert.equal(regions.length, 6);
  for (const region of regions) {
    assert.equal(region.length, 4);
  }

  // Should cover all 24 cells exactly once
  const allCells = regions.flat().sort((a, b) => a - b);
  const expected = Array.from({ length: 24 }, (_, i) => i);
  assert.deepEqual(allCells, expected);
});

await runTest('disjointSetRegions for 6x4 rectangular grid', () => {
  const shape = GridShape.fromGridSize(6, 4);
  // 6x4 grid, numValues=6, boxes are 3x2
  // 6 positions per box => 6 sets
  // 4 boxes => 4 cells per set
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  assert.equal(regions.length, 6);
  for (const region of regions) {
    assert.equal(region.length, 4);
  }

  // Should cover all 24 cells exactly once
  const allCells = regions.flat().sort((a, b) => a - b);
  const expected = Array.from({ length: 24 }, (_, i) => i);
  assert.deepEqual(allCells, expected);
});

await runTest('disjointSetRegions with custom size parameter', () => {
  // 6x6 grid with size=4 => 2x2 boxes
  const shape = GridShape.fromGridSize(6, 6);
  const regions = SudokuConstraintBase.disjointSetRegions(shape, 4);
  // 4 positions per box => 4 sets
  // 9 boxes (6/2 * 6/2) => 9 cells per set
  assert.equal(regions.length, 4);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }

  // Should cover all 36 cells exactly once
  const allCells = regions.flat().sort((a, b) => a - b);
  const expected = Array.from({ length: 36 }, (_, i) => i);
  assert.deepEqual(allCells, expected);
});

await runTest('disjointSetRegions with custom size: cells at same position', () => {
  // 6x6 grid with size=4 => 2x2 boxes
  const shape = GridShape.fromGridSize(6, 6);
  const disjointSets = SudokuConstraintBase.disjointSetRegions(shape, 4);
  const boxes = SudokuConstraintBase.boxRegions(shape, 4);

  // Each disjoint set should have exactly one cell from each box
  for (const disjointSet of disjointSets) {
    for (const box of boxes) {
      const boxSet = new Set(box);
      const intersection = disjointSet.filter(c => boxSet.has(c));
      assert.equal(intersection.length, 1,
        `Each disjoint set should have exactly 1 cell from each box`);
    }
  }

  // Helper to get position within 2x2 box
  const getPositionInBox = (cell) => {
    const row = Math.floor(cell / 6);
    const col = cell % 6;
    const posRow = row % 2;
    const posCol = col % 2;
    return posRow * 2 + posCol;
  };

  // All cells in each set should be at the same position
  for (let setIdx = 0; setIdx < disjointSets.length; setIdx++) {
    const positions = disjointSets[setIdx].map(getPositionInBox);
    assert.ok(positions.every(p => p === positions[0]),
      `Set ${setIdx}: all cells should be at same position, got ${positions}`);
  }
});

await runTest('disjointSetRegions returns empty for invalid box size', () => {
  // 5x7 grid cannot have valid boxes
  const shape = GridShape.fromGridSize(5, 7);
  const regions = SudokuConstraintBase.disjointSetRegions(shape);
  assert.deepEqual(regions, []);
});

// ============================================================================
// Jigsaw parsing and serialization
// ============================================================================

// 9x9 jigsaw layout with 9 regions
const JIGSAW_9x9_LAYOUT = '000111222000111222000111222333444555333444555333444555666777888666777888666777888';

await runTest('Jigsaw.makeFromArgs parses square grid without gridSpec', () => {
  const shape9x9 = GridShape.fromGridSize(9);
  const jigsaws = [...SudokuConstraint.Jigsaw.makeFromArgs([JIGSAW_9x9_LAYOUT], shape9x9)];
  assert.equal(jigsaws.length, 9, 'should have 9 jigsaw regions');

  // Check first region has 9 cells
  assert.equal(jigsaws[0].cells.length, 9, 'each region should have 9 cells');

  // Each region should store the inferred gridSpec
  for (const jigsaw of jigsaws) {
    assert.equal(jigsaw.gridSpec, '9x9', 'should store gridSpec');
  }
});

await runTest('Jigsaw.makeFromArgs parses rectangular grid with gridSpec prefix', () => {
  // 4x6 grid layout (24 cells, 4 regions of 6 cells each)
  // Layout: 4 rows x 6 cols = 24 cells
  const layout4x6 = '000111000111222333222333';
  const shape4x6 = GridShape.fromGridSpec('4x6');
  const jigsaws = [...SudokuConstraint.Jigsaw.makeFromArgs(['4x6', layout4x6], shape4x6)];

  assert.equal(jigsaws.length, 4, 'should have 4 jigsaw regions');
  assert.equal(jigsaws[0].cells.length, 6, 'each region should have 6 cells');

  for (const jigsaw of jigsaws) {
    assert.equal(jigsaw.gridSpec, '4x6', 'should store gridSpec');
  }
});

await runTest('Jigsaw.serialize omits gridSpec for square grids', () => {
  const shape9x9 = GridShape.fromGridSize(9);
  const jigsaws = [...SudokuConstraint.Jigsaw.makeFromArgs([JIGSAW_9x9_LAYOUT], shape9x9)];
  const serialized = SudokuConstraint.Jigsaw.serialize(jigsaws);

  // Should be .Jigsaw~LAYOUT (no gridSpec in the middle)
  assert.ok(!serialized.includes('~9x9~'), 'should not include gridSpec for square grid');
  assert.ok(serialized.startsWith('.Jigsaw~'), 'should start with constraint type');
});

await runTest('Jigsaw.serialize omits gridSpec for rectangular grids', () => {
  // 4x6 = 24 cells, 4 regions of 6 cells each
  const layout4x6 = '000111000111222333222333';
  const shape4x6 = GridShape.fromGridSpec('4x6');
  const jigsaws = [...SudokuConstraint.Jigsaw.makeFromArgs(['4x6', layout4x6], shape4x6)];
  const serialized = SudokuConstraint.Jigsaw.serialize(jigsaws);

  // Should be .Jigsaw~LAYOUT (no gridSpec token)
  assert.ok(!serialized.includes('~4x6~'), 'should not include gridSpec for rectangular grid');
});

await runTest('Jigsaw round-trips for square grid', () => {
  const shape9x9 = GridShape.fromGridSize(9);
  const jigsaws = [...SudokuConstraint.Jigsaw.makeFromArgs([JIGSAW_9x9_LAYOUT], shape9x9)];
  const serialized = SudokuConstraint.Jigsaw.serialize(jigsaws);
  // serialized is '.Jigsaw~LAYOUT', extract just the args after '.Jigsaw~'
  const argsStr = serialized.replace('.Jigsaw~', '');
  const reparsed = [...SudokuConstraint.Jigsaw.makeFromArgs([argsStr], shape9x9)];

  assert.equal(reparsed.length, jigsaws.length, 'should have same number of regions');
  for (let i = 0; i < jigsaws.length; i++) {
    assert.deepEqual(
      reparsed[i].cells.sort(),
      jigsaws[i].cells.sort(),
      `region ${i} should have same cells`
    );
  }
});

await runTest('Jigsaw round-trips for rectangular grid', () => {
  // 4x6 grid: 24 cells, numValues=6, so 4 regions of 6 cells each
  const layout4x6 = '000111000111222333222333';
  const shape4x6 = GridShape.fromGridSpec('4x6');
  const jigsaws = [...SudokuConstraint.Jigsaw.makeFromArgs(['4x6', layout4x6], shape4x6)];
  const serialized = SudokuConstraint.Jigsaw.serialize(jigsaws);
  // serialized is '.Jigsaw~LAYOUT', extract args after '.Jigsaw~'
  const argsStr = serialized.replace('.Jigsaw~', '');
  const reparsed = [...SudokuConstraint.Jigsaw.makeFromArgs([argsStr], shape4x6)];

  assert.equal(reparsed.length, jigsaws.length, 'should have same number of regions');
  for (let i = 0; i < jigsaws.length; i++) {
    assert.deepEqual(
      reparsed[i].cells.sort(),
      jigsaws[i].cells.sort(),
      `region ${i} should have same cells`
    );
  }
});

await runTest('Jigsaw.makeFromArgs throws when gridSpec does not match layout length', () => {
  // 4x6 = 24 cells, but provide a 9x9 layout (81 cells)
  const shape4x6 = GridShape.fromGridSpec('4x6');
  assert.throws(
    () => [...SudokuConstraint.Jigsaw.makeFromArgs(['4x6', JIGSAW_9x9_LAYOUT], shape4x6)],
    /expects 24 cells.*but layout has 81/
  );
});

logSuiteComplete('SudokuConstraintBase');
