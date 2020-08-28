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
    .Cage~3~R1C1~R1C2
    .Cage~15~R1C3~R1C4~R1C5
    .Cage~25~R2C1~R2C2~R3C1~R3C2
    .Cage~17~R2C3~R2C4
    .Cage~9~R3C3~R3C4~R4C4
    .Cage~22~R1C6~R2C5~R2C6~R3C5
    .Cage~4~R1C7~R2C7
    .Cage~16~R1C8~R2C8
    .Cage~15~R1C9~R2C9~R3C9~R4C9
    .Cage~20~R3C7~R3C8~R4C7
    .Cage~8~R3C6~R4C6~R5C6
    .Cage~17~R4C5~R5C5~R6C5
    .Cage~20~R5C4~R6C4~R7C4
    .Cage~14~R4C2~R4C3
    .Cage~6~R4C1~R5C1
    .Cage~13~R5C2~R5C3~R6C2
    .Cage~6~R6C3~R7C2~R7C3
    .Cage~17~R4C8~R5C7~R5C8
    .Cage~27~R6C1~R7C1~R8C1~R9C1
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
      '.Cage~3~R1C1~R1C2.Cage~15~R1C3~R1C4~R1C5.Cage~25~R2C1~R2C2~R3C1~R3C2.Cage~17~R2C3~R2C4.Cage~9~R3C3~R3C4~R4C4.Cage~22~R1C6~R2C5~R2C6~R3C5.Cage~4~R1C7~R2C7.Cage~16~R1C8~R2C8.Cage~15~R1C9~R2C9~R3C9~R4C9.Cage~20~R3C7~R3C8~R4C7.Cage~8~R3C6~R4C6~R5C6.Cage~17~R4C5~R5C5~R6C5.Cage~20~R5C4~R6C4~R7C4.Cage~14~R4C2~R4C3.Cage~6~R4C1~R5C1.Cage~13~R5C2~R5C3~R6C2.Cage~6~R6C3~R7C2~R7C3.Cage~17~R4C8~R5C7~R5C8.Cage~27~R6C1~R7C1~R8C1~R9C1.Cage~8~R8C2~R9C2.Cage~16~R8C3~R9C3.Cage~10~R7C5~R8C4~R8C5~R9C4.Cage~12~R5C9~R6C9.Cage~6~R6C7~R6C8.Cage~20~R6C6~R7C6~R7C7.Cage~15~R8C6~R8C7.Cage~14~R7C8~R7C9~R8C8~R8C9.Cage~13~R9C5~R9C6~R9C7.Cage~17~R9C8~R9C9',
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

  let output = [];

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

    let state = solver.state();
    output.push({name: tc.name, ...state.counters, timeMs: state.timeMs});
  }
  console.log('Tests passed');
  runAll(testCases);
};

const runAll = (puzzles) => {
  const sumObjectValues = (a, b) => {
    let result = {...a};
    for (const [k, v] of Object.entries(b)) {
      if (!v) continue;
      if (!result[k]) result[k] = 0;
      result[k] += v;
    }
    return result;
  };

  let rows = [];
  let total = {};
  for (let puzzle of puzzles) {
    if (typeof puzzle == 'string') {
      puzzle = {input: puzzle, name: ''};
    }

    let constraint = SudokuConstraint.fromText(puzzle.input);
    let solver = SudokuBuilder.build(constraint);
    solver.nthSolution(2); // Find a solution an prove uniqueness.

    let state = solver.state();
    let row = {name: puzzle.name, ...state.counters, timeMs: state.timeMs};
    rows.push(row);
    total = sumObjectValues(total, row);
    // Log a fixed string so the progress gets collapsed to a single line.
    console.log('done');
  }
  rows.total = total;
  console.table(rows);
};
const runHardKillers = () => {
  // From: http://www.rcbroughton.co.uk/sudoku/forum/viewtopic.php?f=3&t=434
  // Choose 20 of the faster ones for running a quick comparison.
  runAll([
    'G<<L<K<L<^G>^>^E^^>^IJ<G^<G^>^^I^<>^HC<C^<B^N^^G^<>^>^^E^<DF<^PG^<>^^J<^^<H<<>^>^',
    'G<<P<N<H<^N>^>^E^^>^GH<B^<K^>^^I^<>^IC<G^<C^L^^A^<>^>^^C^<EK<^KJ^<>^^I<^^<D<<>^>^',
    'L<<Q<J<G<^N>^>^J^^>^C8<H^<F^>^^I^<>^FC<D^<I^L^^H^<>^>^^E^<AG<^PG^<>^^I<^^<G<<>^>^',
    'N<<K<H<I<^I>^>^J^^>^CL<C^<L^>^^G^<>^9H<G^<C^J^^I^<>^>^^G^<IF<^LK^<>^^K<^^<7<<>^>^',
    'A<H<MA<A<^P<<^N<<^E^E<^L<^E^^^^^^^^^M<<9<K<<<G^N<^F<SB^<^^L^^^^I<E>^>>^D^^^<^F<>^',
    'E<8<ID<E<^N<<^L<<^A^Q<^K<^D^^^^^^^^^L<<G<I<<<K^C<^O<FB^<^^N^^^^M<C>^>>^K^^^<^B<>^',
    'F<9<IF<K<^L<<^I<<^C^N<^N<^6^^^^^^^^^H<<I<I<<<9^K<^O<OA^<^^L^^^^R<F>^>>^G^^^<^6<>^',
    'F<B<HB<K<^U<<^I<<^C^E<^I<^E^^^^^^^^^H<<G<M<<<C^R<^O<L6^<^^O^^^^K<A>^>>^F^^^<^B<>^',
    'C<5<KD<I<^O<<^P<<^F^R<^C<^9^^^^^^^^^K<<H<I<<<A^X<^Q<IB^>^^I^^^^I<^>^>>^J^^6<^B<>^',
    'C<9<L8<I<^P<<^L<<^C^J<^L<^E^^^^^^^^^N<<H<H<<<7^S<^J<PC^>^^G^^^^Q<^>^>>^G^^A<^9<>^',
    'C<A<O7<G<^K<<^R<<^C^O<^G<^C^^^^^^^^^P<<B<M<<<B^V<^N<M8^>^^J^^^^J<^>^>>^F^^7<^C<>^',
    'D<6<KH<C<^Q<<^P<<^E^M<^G<^9^^^^^^^^^H<<E<J<<<7^U<^Q<V8^>^^N^^^^K<^>^>>^C^^D<^5<>^',
    'E<8<KF<F<^T<<^J<<^6^O<^F<^F^^^^^^^^^D<<E<R<<<A^W<^J<P9^>^^N^^^^N<^>^>>^E^^9<^7<>^',
    'E<D<KA<H<^J<<^O<<^E^I<^J<^C^^^^^^^^^F<<K<M<<<B^X<^I<R9^>^^I^^^^K<^>^>>^F^^A<^7<>^',
    'G<A<G6<M<^S<<^L<<^7^Q<^L<^7^^^^^^^^^J<<E<M<<<9^S<^J<T7^>^^J^^^^O<^>^>>^E^^9<^C<>^',
    'I<A<E9<H<^Q<<^U<<^9^H<^F<^F^^^^^^^^^L<<I<G<<<9^S<^I<WC^>^^M^^^^O<^>^>>^9^^9<^7<>^',
    'J<B<G9<G<^R<<^H<<^6^J<^R<^D^^^^^^^^^G<<E<O<<<9^T<^J<L9^>^^O^^^^N<^>^>>^F^^C<^A<>^',
    'B<7<JF<B<^T<<^V<<^A^L<^R<^8^^^^^^^^^G<<M0^C<<AS>^OF<SB^^^^^^^^^H^<<^>>^E^<9<^8<>^',
    'D<5<JE<H<^S<<^L<<^A^J<^M<^D^^^^^^^^^H<<N0^C<<CS>^KN<QD^^^^^^^^^9^<<^>>^A^<G<^9<>^',
    'D<C<OF<C<^K<<^R<<^7^P<^N<^A^^^^^^^^^C<<N0^C<<DV>^EI<NF^^^^^^^^^E^<<^>>^I^<A<^7<>^',
  ]);
};
const runHSKillers = () => {
  // See http://forum.enjoysudoku.com/human-solvable-zero-t33357.html for
  // definition.
  runAll([
    '3x3:d:k:3841:7705:7705:7705:7705:7705:26:3847:3847:3841:27:3846:3846:3846:7705:4361:3847:3848:3841:3843:4621:4876:28:4361:4361:4619:3848:29:3843:4621:4876:4876:5395:5395:4619:3848:3844:3843:4621:4114:4114:5395:4619:30:3850:3844:4878:4880:31:4114:3605:3605:3850:3850:3844:4878:4880:4880:4372:3350:3605:4632:32:4367:4878:33:4625:4372:3350:3350:4632:4632:4367:4367:4625:4625:4372:34:4375:4375:4375:',
    '3x3:d:k:3587:14:15:16:17:18:19:3586:3586:3587:1543:1543:20:21:22:23:1544:24:25:26:3338:27:28:3337:3337:1544:29:30:31:3338:32:33:34:35:36:37:38:39:40:41:42:43:44:45:46:47:48:49:4365:4365:50:3596:51:52:53:1541:3339:3339:54:55:3596:56:57:58:1541:59:60:61:62:1542:1542:3585:3588:3588:63:64:65:66:67:68:3585:',
    '3x3::k:3595:3595:3844:3844:3090:3336:3336:2575:2575:3595:4620:4620:3348:3090:5:5648:5648:2575:3350:4620:4620:3348:3090:23:5648:5648:3841:3350:2581:24:3348:25:26:27:2579:3841:28:2581:29:30:4625:4625:4625:2579:31:3843:2581:32:33:34:35:36:2579:3335:3843:4878:4878:37:38:39:4618:4618:3335:3341:4878:4878:40:41:42:4618:4618:3593:3341:3341:3334:3334:43:3842:3842:3593:3593:',
    '3x3:d:k:18:4619:4619:4619:8451:3850:3850:3850:19:5388:5388:8451:8451:8451:8451:8451:6671:6671:5388:5388:3076:3076:8451:3333:3333:6671:6671:6414:6414:3076:3076:7937:3333:3333:5904:5904:6414:6414:7937:7937:7937:7937:7937:5904:5904:4109:4109:5382:5382:7937:5895:5895:5137:5137:4109:4109:5382:5382:8194:5895:5895:5137:5137:20:21:8194:8194:8194:8194:8194:22:23:24:4873:4873:4873:8194:4616:4616:4616:25:',
    '3x3:d:k:7707:21:28:4880:4880:4880:29:30:5401:31:7707:3339:3339:5140:3338:3338:5401:32:33:3084:7707:5140:5140:5140:5401:3337:34:5137:3084:7707:7707:5140:2586:5401:3337:6158:5137:3858:3858:3352:3352:3352:2586:2586:6158:5137:3334:3858:3858:4631:4886:4886:3335:6158:35:3334:5139:4631:4631:4886:36:3335:6158:37:5139:3333:3333:4886:3336:3336:38:39:5139:40:41:6927:6927:6927:6927:42:43:',
    '3x3:d:k:9730:9730:9730:9730:9:6150:9987:9987:9987:9730:10:11:12:13:6150:6150:6150:9987:9730:14:15:16:17:6150:18:19:9987:5895:5895:5895:5895:5895:20:6150:21:9987:5895:22:23:24:25:5640:26:8453:8453:9985:27:28:29:5640:30:31:8453:8453:9985:32:33:5640:5640:5640:34:8453:9220:9985:35:36:37:5640:38:39:8453:9220:9985:9985:9985:40:41:9220:9220:9220:9220:',
    '3x3:d:k:6926:6926:6926:7697:7697:7697:6676:6676:6676:6926:6171:797:797:7697:2078:2078:7450:6676:6926:1564:6171:6171:7697:7450:7450:1311:6676:7952:1564:6171:6171:7701:7450:7450:1311:6674:7952:7952:7952:7701:7701:7701:6674:6674:6674:7952:4119:6409:6409:7701:6412:6412:3862:6674:6927:4119:6409:6409:6419:6412:6412:3862:6925:6927:6409:4119:4119:6419:3862:3862:6412:6925:6927:6927:6927:6419:6419:6419:6925:6925:6925:',
    '3x3::k:4369:3849:3849:3849:4111:6918:6918:6918:3858:7434:4369:3849:5141:4111:4111:6918:3858:2841:7434:7434:4369:5141:5141:4111:3858:2841:2841:7434:5910:5910:26:5141:27:28:29:2841:3854:3854:5910:5910:30:31:32:3341:3341:2824:3854:3854:33:7192:34:3341:3341:6924:2824:2824:3860:3600:7192:7192:4371:6924:6924:2824:3860:6919:3600:3600:7192:4363:4371:6924:3860:6919:6919:6919:3600:4363:4363:4363:4371:',
    '3x3:d:k:26:27:3585:3586:3587:3588:4360:5129:5642:28:3585:3586:3587:3588:4360:5129:5642:29:3585:3586:3587:3588:4360:5129:5642:30:31:32:3585:3586:3587:3588:4360:5129:5642:33:2578:2578:2578:34:35:36:4633:4633:4633:37:4632:7191:6934:4373:5396:5651:2577:38:39:40:4632:7191:6934:4373:5396:5651:2577:41:4632:7191:6934:4373:5396:5651:2577:42:4632:7191:6934:4373:43:5396:5651:2577:44:',
  ]);
};
