class SudokuGridGenerator {
  constructor() {
    this.allValues = SudokuGridGenerator._allValues();
  }

  randomGrid(numSquares) {
    SudokuGridGenerator._shuffle(this.allValues);
    return this.allValues.slice(0, numSquares);
  }

  static _allValues() {
    let values = [];

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        for (let n = 0; n < GRID_SIZE; n++) {
          values.push(toValueId(i, j, n+1));
        }
      }
    }

    return values;
  }

  static _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

// Note: The notes here are historical. None of these are slow now.
const sampleGrids = ({
  // Adding "R7C2#7" breaks it.
  a: '.~R1C1_8~R1C2_4~R1C5_6~R1C7_5~R1C9_1~R2C6_3~R2C8_4~R3C3_6~R3C4_9~R3C9_7~R4C2_2~R4C4_7~R4C5_1~R4C9_6~R5C4_6~R5C5_3~R6C1_9~R6C8_5~R7C5_4~R7C8_6~R8C1_2~R8C7_1~R8C8_8',
  // Unique solution:
  b: '.~R1C1_4~R1C3_5~R1C4_7~R2C1_9~R2C2_2~R3C7_1~R3C8_5~R3C9_8~R4C8_6~R4C9_9~R5C2_8~R5C6_6~R5C7_7~R6C2_9~R6C9_1~R7C1_6~R7C5_9~R7C9_3~R8C6_7~R8C7_6~R9C1_5~R9C4_1~R9C9_2',
  // Very hard (2s+) from norvig.com/sudoku to find all values.
  // Requires ~4.2M nodes searched to solveAll.
  c: '.~R1C6_6~R2C2_5~R2C3_9~R2C9_8~R3C1_2~R3C6_8~R4C2_4~R4C3_5~R5C3_3~R6C3_6~R6C6_3~R6C8_5~R6C9_4~R7C4_3~R7C5_2~R7C6_5~R7C9_6',
  // Very hard (2s+)
  // Requires ~4.4M nodes searched to solveAll.
  d: '.~R1C6_5~R1C8_8~R2C4_6~R2C6_1~R2C8_4~R2C9_3~R4C2_1~R4C4_5~R5C4_1~R5C6_6~R6C1_3~R6C9_5~R7C1_5~R7C2_3~R7C8_9~R7C9_1~R8C9_4',
});

const benchmarkSolve = (squares, iterations) => {
  let generator = new SudokuGridGenerator();
  let totalTime = 0;
  let totalSolved = 0;
  let totalBacktracks = 0;
  for (let i = 0; i < iterations; i++) {
    let values = generator.randomGrid(squares);

    let constraint = new SudokuConstraint.FixedValues(...values);
    let solver = SudokuBuilder.build(constraint);

    let result = solver.nextSolution();
    let state = solver.state();
    totalTime += state.timeMs;
    totalSolved += (result != null);
    totalBacktracks += state.counters.backtracks;
  }

  return {
    averageTime: totalTime/iterations,
    averageBacktracks: totalBacktracks/iterations,
    fractionSolved: totalSolved/iterations,
  };
};

const benchmarkSolveAll = (squares, iterations) => {
  let generator = new SudokuGridGenerator();
  let totalTime = 0;
  let totalSolved = 0;
  let totalBacktracks = 0;
  for (let i = 0; i < iterations; i++) {
    let values = generator.randomGrid(squares);

    let constraint = new SudokuConstraint.FixedValues(...values);
    let solver = SudokuBuilder.build(constraint);

    let result = solver.solveAllPossibilities();
    let state = solver.state();
    totalTime += state.timeMs;
    totalSolved += result.length > 0
    totalBacktracks += state.counters.backtracks;
  }

  return {
    averageTime: totalTime/iterations,
    averageBacktracks: totalBacktracks/iterations,
    fractionSolved: totalSolved/iterations,
  };
}

const testBrokenKiller = () => {
  // Partial taken from https://en.wikipedia.org/wiki/Killer_sudoku
  // If you remove the constraint R7C1#8 it used to fail to find a solution!
  config = `
    .~R2C1_3~R6C1_9~R7C1_8
    .Sum~3~R1C1~R1C2
    .Sum~15~R1C3~R1C4~R1C5
    .Sum~25~R2C1~R2C2~R3C1~R3C2
    .Sum~17~R2C3~R2C4
    .Sum~9~R3C3~R3C4~R4C4
    .Sum~22~R1C6~R2C5~R2C6~R3C5
    .Sum~4~R1C7~R2C7
    .Sum~16~R1C8~R2C8
    .Sum~15~R1C9~R2C9~R3C9~R4C9
    .Sum~20~R3C7~R3C8~R4C7
    .Sum~8~R3C6~R4C6~R5C6
    .Sum~17~R4C5~R5C5~R6C5
    .Sum~20~R5C4~R6C4~R7C4
    .Sum~14~R4C2~R4C3
    .Sum~6~R4C1~R5C1
    .Sum~13~R5C2~R5C3~R6C2
    .Sum~6~R6C3~R7C2~R7C3
    .Sum~17~R4C8~R5C7~R5C8
    .Sum~27~R6C1~R7C1~R8C1~R9C1
  `
  constraintManager.loadFromText(config);
}


// Slow thermo 0.2s (used to be 1.14s)
const testSlowThermo = () => {
  let config = `
    .~R4C6_1~R5C3_2~R9C5_1
    .Thermo~R7C5~R7C6~R7C7~R6C7~R5C7~R4C7
    .Thermo~R4C8~R3C8~R3C7~R3C6~R3C5
    .Thermo~R2C5~R2C4~R3C4~R4C4~R5C4
    .Thermo~R2C1~R2C2~R2C3
  `
  constraintManager.loadFromText(config);
}

const loadSlowKnight = () => {
  // Slow ambiguous anti-knight. Faster to count solutions than all
  // possibilities.
  let config = '.AntiKnight.~R1C2_3~R1C9_7~R3C6_9~R3C7_2~R4C1_6~R4C4_4~R5C9_5~R6C2_4~R7C1_3~R8C5_6~R8C8_5~R9C2_6~R9C3_4~R9C4_3';
  constraintManager.loadFromText(config);
}

const testCases = [
  {  // 0: From https://www.youtube.com/watch?v=lgJYOuVk910
    name: 'Thermo 1',
    input:
      '.~R1C2_4~R1C8_1~R2C1_2~R2C9_6~R8C1_9~R8C9_2~R9C2_1~R9C8_9.Thermo~R9C4~R8C3~R7C2~R6C1~R5C2~R4C3.Thermo~R4C1~R3C2~R2C3~R1C4~R2C5~R3C6.Thermo~R1C6~R2C7~R3C8~R4C9~R5C8~R6C7.Thermo~R6C9~R7C8~R8C7~R9C6~R8C5~R7C4',
    expected: '847632519295471386631598247129743865486259173753816924368924751974185632512367498',
  },
  { // 1: From https://en.wikipedia.org/wiki/Sudoku
    name: 'Classic sudoku, no backtrack',
    input:
      '.~R1C1_5~R1C2_3~R1C5_7~R2C1_6~R2C4_1~R2C5_9~R2C6_5~R3C2_9~R3C3_8~R3C8_6~R4C1_8~R4C5_6~R4C9_3~R5C1_4~R5C4_8~R5C6_3~R5C9_1~R6C1_7~R6C5_2~R6C9_6~R7C2_6~R7C7_2~R7C8_8~R8C4_4~R8C5_1~R8C6_9~R8C9_5~R9C5_8~R9C8_7~R9C9_9',
    expected: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
  },
  { // 2: From https://www.telegraph.co.uk/news/science/science-news/9359579/Worlds-hardest-sudoku-can-you-crack-it.html
    name: 'Classic sudoku, hard',
    input:
      '.~R1C1_8~R2C3_3~R2C4_6~R3C2_7~R3C5_9~R3C7_2~R4C2_5~R4C6_7~R5C5_4~R5C6_5~R5C7_7~R6C4_1~R6C8_3~R7C3_1~R7C8_6~R7C9_8~R8C3_8~R8C4_5~R8C8_1~R9C2_9~R9C7_4',
    expected: '812753649943682175675491283154237896369845721287169534521974368438526917796318452',
  },
  { // 3: https://www.youtube.com/watch?v=mTdhTfAhOI8
    name: 'Anti knights move',
    input:
      '.AntiKnight.~R1C2_3~R1C5_4~R1C6_1~R1C9_7~R2C4_5~R3C4_8~R3C6_9~R4C1_6~R4C8_7~R5C9_4~R6C2_4~R7C1_3~R8C5_6~R8C8_5~R9C2_6~R9C3_4~R9C4_3',
    expected: '536241897978536241421879635613485972789623514245917368357198426892764153164352789',
  },
  { // 4: https://en.wikipedia.org/wiki/Killer_sudoku
    name: 'Easy killer',
    input:
      '.Sum~3~R1C1~R1C2.Sum~15~R1C3~R1C4~R1C5.Sum~25~R2C1~R2C2~R3C1~R3C2.Sum~17~R2C3~R2C4.Sum~9~R3C3~R3C4~R4C4.Sum~22~R1C6~R2C5~R2C6~R3C5.Sum~4~R1C7~R2C7.Sum~16~R1C8~R2C8.Sum~15~R1C9~R2C9~R3C9~R4C9.Sum~20~R3C7~R3C8~R4C7.Sum~8~R3C6~R4C6~R5C6.Sum~17~R4C5~R5C5~R6C5.Sum~20~R5C4~R6C4~R7C4.Sum~14~R4C2~R4C3.Sum~6~R4C1~R5C1.Sum~13~R5C2~R5C3~R6C2.Sum~6~R6C3~R7C2~R7C3.Sum~17~R4C8~R5C7~R5C8.Sum~27~R6C1~R7C1~R8C1~R9C1.Sum~8~R8C2~R9C2.Sum~16~R8C3~R9C3.Sum~10~R7C5~R8C4~R8C5~R9C4.Sum~12~R5C9~R6C9.Sum~6~R6C7~R6C8.Sum~20~R6C6~R7C6~R7C7.Sum~15~R8C6~R8C7.Sum~14~R7C8~R7C9~R8C8~R8C9.Sum~13~R9C5~R9C6~R9C7.Sum~17~R9C8~R9C9',
    expected: '215647398368952174794381652586274931142593867973816425821739546659428713437165289',
  },
  { // 5: http://forum.enjoysudoku.com/the-hardest-sudokus-new-thread-t6539-645.html (2061 backtracks)
    name: 'Hard sudoku x',
    input:
      '.Diagonal~1.Diagonal~-1.~R1C3_1~R1C7_2~R2C3_2~R2C4_3~R2C9_4~R3C1_4~R4C1_5~R4C3_3~R4C8_6~R5C2_1~R5C9_5~R6C3_6~R7C5_7~R7C6_8~R8C5_9~R9C2_7~R9C6_1~R9C8_9',
    expected: '681945237792316584435827619523784961817639425946152873369478152158293746274561398',
  },
  {  // 6: https://www.reddit.com/r/sudoku/comments/gk8si6/antiking_antiknight_sudoku_to_compliment_the/
    name: 'Anti-knight Anti-king',
    input:
      '.AntiKnight.AntiKing.~R1C1_1~R1C7_5~R1C8_6~R1C9_7~R2C1_2~R2C2_3~R2C3_4~R2C9_8',
    expected: '198234567234567198567198234982345671345671982671982345823456719456719823719823456',
  },
  {  // 7: http://rishipuri.blogspot.com/2013/02/antiknight-nonconsecutive-sudoku-2013-2.html
    name: 'Anti-consecutive',
    input:
      '.AntiConsecutive.~R3C4_4~R3C6_7~R4C3_6~R4C7_5~R6C3_4~R6C7_3~R7C4_2~R7C6_5',
    expected: '973518264425963718861427953316842597758396142294751386649275831182639475537184629',
  }
];

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const loadInput = (input) => {
  constraintManager.loadFromText(input);
}

const toShortSolution = (valueIds) => {
  let result = new Array(81);
  const DEFAULT_VALUE = '.'
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

const runTestCases = () => {
  const fail = (tc, result) => {
    console.log('Test failed: ' + tc.name);
    console.log('Expected', tc.expected);
    console.log('Got     ', result);
    throw('Test failed: ' + tc.name);
  };

  for (const tc of testCases) {
    let constraint = SudokuConstraint.fromString(tc.input);
    let solver = SudokuBuilder.build(constraint);
    let result = solver.solveAllPossibilities();

    if (result.length != 81) fail(tc, result);

    let shortSolution;
    try {
      shortSolution = toShortSolution(result);
    } catch(e) {
      console.log(e);
      fail(tc, result);
    }
    if (shortSolution != tc.expected) fail(tc, shortSolution);
  }
  console.log('Tests passed');
};
