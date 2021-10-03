loadJSFile('js/solver/engine.js');
loadJSFile('js/solver/handlers.js');
loadJSFile('data/killers.js');
loadJSFile('data/jigsaw_layouts.js');

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const loadInput = (input) => {
  let puzzle = EXAMPLES[input];
  if (puzzle) input = puzzle.input;
  constraintManager.loadFromText(input);
}

const getShortSolution = () => {
  return toShortSolution(grid.getSolutionValues());
};

const toShortSolution = (valueIds) => {
  let result = new Array(81);
  const DEFAULT_VALUE = '.';
  result.fill(DEFAULT_VALUE);

  for (const valueId of valueIds) {
    let {cell, value} = parseValueId(valueId);
    if (result[cell] != DEFAULT_VALUE) throw('Too many solutions per cell.');
    result[cell] = value;
  }
  return result.join('');
}

const arrayEquals = (a, b) => {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

const puzzleFromCfg = (puzzleCfg) => {
  let puzzleStr, solution, name='';
  if (Array.isArray(puzzleCfg)) {
    [puzzleStr, solution] = puzzleCfg;
  } else {
    puzzleStr = puzzleCfg;
  }
  puzzle = EXAMPLES[puzzleStr];
  if (!puzzle) {
    puzzle = {input: puzzleStr, solution: solution};
  }

  return [puzzleStr, puzzle];
};

const failTest = (name, puzzle, result) => {
  console.log('Test failed: ' + (name || puzzle.input));
  console.log('Expected', puzzle.solution);
  console.log('Got     ', result);
  throw('Test failed: ' + name);
};

const runAllWithChecks = (puzzles) => {
  const sumObjectValues = (a, b) => {
    let result = {...a};
    for (const [k, v] of Object.entries(b)) {
      if (!v) continue;
      if (!result[k]) result[k] = 0;
      result[k] += v;
    }
    return result;
  };

  let solutions = [];
  let rows = [];
  let total = {};
  for (const puzzleCfg of puzzles) {
    const [name, puzzle] = puzzleFromCfg(puzzleCfg);

    // Log a fixed string so the progress gets collapsed to a single line.
    console.log('solving...');

    let constraint = SudokuConstraint.fromText(puzzle.input);
    let solver = SudokuBuilder.build(constraint);
    let result = solver.nthSolution(0);
    solver.nthSolution(1); // Try to find a second solution to prove uniqueness.

    if (puzzle.solution === null) {
      // We expect no solution.
      if (result) {
        const shortSolution = toShortSolution(result);
        failTest(name, puzzle, shortSolution);
      }
      solutions.push(null);
    } else if (!result || result.length != GRID_SIZE*GRID_SIZE) {
      failTest(name, puzzle, result);
    } else {
      let shortSolution;
      try {
        shortSolution = toShortSolution(result);
      } catch(e) {
        console.log(e);
        failTest(name, puzzle, result);
      }
      solutions.push(shortSolution);

      if (puzzle.solution) {
        if (shortSolution != puzzle.solution) failTest(name, puzzle, shortSolution);
      }
    }

    let state = solver.state();
    let row = {name: name, ...state.counters, timeMs: state.timeMs};
    rows.push(row);
    total = sumObjectValues(total, row);
    total.name = null;
  }

  rows.total = total;
  console.table(rows);

  return solutions;
};

const runValidateLayoutTests = () => {
  const cases = VALID_JIGSAW_LAYOUTS.map(l =>['.Jigsaw~'+l, true]);
  cases.push(...INVALID_JIGSAW_LAYOUTS.map(l =>['.Jigsaw~'+l, null]));

  let rows = [];

  const extractJigsawConstraint = (c) => {
    switch (c.type) {
      case 'Jigsaw':
        return c;
      case 'Set':
        return c.constraints.find(extractJigsawConstraint);
    }
    return null;
  };

  for (const puzzleCfg of cases) {
    const [name, puzzle] = puzzleFromCfg(puzzleCfg);

    // Log a fixed string so the progress gets collapsed to a single line.
    console.log('solving...');

    const fullConstraint = SudokuConstraint.fromText(puzzle.input);
    const layoutConstraint = extractJigsawConstraint(fullConstraint) || new SudokuConstraint.Set([]);
    const solver = SudokuBuilder.build(layoutConstraint);
    const result = solver.validateLayout();

    const expectedResult = (puzzle.solution !== null);

    if (result != expectedResult) {
      failTest(name, puzzle, result);
    }

    let state = solver.state();
    let row = {name: name, ...state.counters, timeMs: state.timeMs};
    rows.push(row);
  }

  console.table(rows);
}

const runTestCases = () => {
  runAllWithChecks(TEST_CASES);
};

const runAll = (puzzles) => {
  runAllWithChecks(puzzles);
};

const TEST_CASES = [
  'Thermosudoku',
  'Classic sudoku',
  'Classic sudoku, hard',
  'Anti-knights move',
  'Killer sudoku',
  'Sudoku X',
  'Anti-knight Anti-king',
  'Anti-knight, Anti-consecutive',
  'Arrow sudoku',
  'Arrow killer sudoku',
  'Kropki sudoku',
  'Little killer',
  'Little killer 2',
  'Sandwich sudoku',
  'German whispers',
  'Palindromes',
  'Jigsaw',
];

const printGrid = (grid) => {
  const matrix = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    matrix.push(grid.slice(i*GRID_SIZE, (i+1)*GRID_SIZE));
  }
  console.table(matrix);
}
