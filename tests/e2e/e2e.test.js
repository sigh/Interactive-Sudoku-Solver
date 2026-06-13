import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete, logInfo } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { SolverStats } = await import('../../js/sandbox/solver_stats.js' + self.VERSION_PARAM);
const { resolvePuzzleConfig } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
await import('../../data/collections.js' + self.VERSION_PARAM);
const {
  VALID_JIGSAW_LAYOUTS,
  EASY_INVALID_JIGSAW_LAYOUTS,
  FAST_INVALID_JIGSAW_LAYOUTS,
} = await import('../../data/jigsaw_layouts.js' + self.VERSION_PARAM);
const { VALID_JIGSAW_BOX_LAYOUTS } = await import('../../data/jigsaw_box_layouts.js' + self.VERSION_PARAM);

const solveCollections = [
  {
    collection: '9x9',
    puzzles: [
      'Thermosudoku',
      'Classic sudoku',
      'Classic sudoku, hard',
      'Anti-knights move',
      'Killer sudoku',
      'Killer sudoku, with overlap',
      'Killer sudoku, with gaps',
      'Killer sudoku, with 0 cage',
      'Killer sudoku, with alldiff',
      'Sudoku X',
      'Anti-knight Anti-king',
      'Anti-knight Anti-consecutive',
      'Arrow sudoku',
      'Double arrow',
      'Pill arrow',
      '3-digit pill arrow',
      'Arrow killer sudoku',
      'Kropki sudoku',
      'Little killer',
      'Little killer - Sum',
      'Little killer 2',
      'Sandwich sudoku',
      'German whispers',
      'International whispers',
      'Renban',
      'Between lines',
      'Lockout lines',
      'Palindromes',
      'Modular lines',
      'Entropic connections',  // Entropic Line, Pair
      'Jigsaw',
      'Jigsaw boxes, disconnected',
      'Windoku',
      'X-Windoku',
      'Region sum lines',
      'XV-sudoku',
      'XV-kropki',
      'Strict kropki',
      'Strict XV',
      'Hailstone (easier) - little killer',
      'X-Sum little killer',
      'Skyscraper',
      'Skyscraper - all 6',
      'Global entropy',  // Global entropy
      'Global mod 3',  // Global mod
      'Odd even',
      'Quadruple X',
      'Quadruple - repeated values',
      'Odd-even thermo',  // Pair
      'Nabner thermo - easy',  // PairX
      'Knight-arrows',  // Binary (backward compatibility)
      'Zipper lines - tutorial',  // Zipper both odd and even length.
      'Sum lines',
      'Sum lines, with loop',
      'Sum lines - long loop',
      'Long sums 3',
      'Indexing',
      '2D 1-5-9',
      'Full rank',
      'Duplicate cell sums',
      'Lunchbox',  // Lunchbox
      'Killer lunchboxes, resolved', // Lunchbox with 0
      'Hidden skyscrapers',
      'Unbidden First Hidden', // And constraint
      'Look-and-say',
      'Counting circles',
      'Bubble Tornado',
      'Anti-taxicab',
      'Dutch Flatmates',  // Dutch Flatmates
      'Fortress sudoku',  // GreaterThan
      'Equality cages',  // EqualityCage
      'Regex line',  // Regex
      'Sequence sudoku', // NFA (simple transitions only)
      'NFA: Equal sum parition', // NFA (with state bifurcation)
      'Full rank - 6 clue snipe',
      'Irregular region sum line',
      'Embedded Squishdoku',
      'Force non-unit coeff', // Sum with non-unit coeff
      'Event horizon', // Duplicate cell in sum, BinaryPairwise optimization.
      'Copycat, easy',  // Same value - 2 sets, repeated values
      'Clone sudoku', // Same value - single cell sets
      'Slingshot sudoku', // ValueIndexing
      'Numbered Rooms vs X-Sums', // Or constraint
      'Count Different',  // CountDistinct
      {  // Or constraint (update watched cells)
        name: 'Or with Givens',
        input: '.~R1C1_5~R1C2_3~R2C1_6~R2C6_5~R3C2_9~R3C3_8~R3C8_6~R7C2_6~R8C6_9~R8C9_5~R9C8_7~R9C5_8~R8C4_4~R7C7_2~R7C8_8~R5C9_1~R4C9_3~R4C5_6~R6C5_2~R5C4_8~R5C1_4~R4C1_8.Or.~R6C1_7.~R6C1_1.End',
        solution: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
      },
      {  // And constraint (with cellExclusions)
        // Note: And needs to be inside an Or to not be elided.
        name: 'And with AllDifferent',
        input: '.~R1C1_5~R1C2_3~R2C1_6~R2C6_5~R3C2_9~R3C3_8~R7C2_6~R8C6_9~R8C9_5~R9C8_7~R9C5_8~R8C4_4~R7C7_2~R7C8_8~R5C9_1~R4C9_3~R4C5_6~R6C5_2~R5C4_8~R5C1_4~R4C1_8~R6C1_7~R1C5_9~R5C8_9~R7C4_5~R3C1_1~R1C4_2.Or.~R1C1_1.And.~R1C1_5.AllDifferent~R3C8~R4C7.End.End',
        solution: '534298617672315948198746532859167423426853791713924856967531284281479365345682179',
      },
      {  // Or constraint (with cellExclusions)
        // Note: Or needs multiple constraints to not be elided.
        name: 'Or with AllDifferent',
        input: '.Or.~R1C1_1.AllDifferent~R3C8~R4C7.End.~R1C1_5~R1C2_3~R2C1_6~R2C6_5~R3C2_9~R3C3_8~R7C2_6~R8C6_9~R8C9_5~R9C8_7~R9C5_8~R8C4_4~R7C7_2~R7C8_8~R5C9_1~R4C9_3~R4C5_6~R6C5_2~R5C4_8~R5C1_4~R4C1_8~R6C1_7~R1C5_9~R5C8_9~R7C4_5~R3C1_1~R1C4_2',
        solution: '534298617672315948198746532859167423426853791713924856967531284281479365345682179',
      },
      {  // And and Or constraint which are both simplified out
        name: 'Elided And and Or',
        input: '.Or.And.AllDifferent~R3C8~R4C7.End.End.~R1C1_5~R1C2_3~R2C1_6~R2C6_5~R3C2_9~R3C3_8~R7C2_6~R8C6_9~R8C9_5~R9C8_7~R9C5_8~R8C4_4~R7C7_2~R7C8_8~R5C9_1~R4C9_3~R4C5_6~R6C5_2~R5C4_8~R5C1_4~R4C1_8~R6C1_7~R1C5_9~R5C8_9~R7C4_5~R3C1_1~R1C4_2',
        solution: '534298617672315948198746532859167423426853791713924856967531284281479365345682179',
      },
      {
        // Randomly added constraints until unique.
        name: 'Contain At Least',  // ContainAtLeast
        input: '.ContainAtLeast~1_1_2_3~R3C4~R3C5~R3C6~R4C6~R5C6~R6C6.ContainAtLeast~1_1_2_3~R7C4~R7C3~R7C2~R6C2~R5C2.ContainAtLeast~1_1_2_3~R5C7~R5C8~R4C9~R3C9~R2C9.ContainAtLeast~1_1_2_3~R8C7~R9C7~R9C6~R9C5.ContainAtLeast~4_4_6_9_5~R2C4~R2C3~R2C2~R2C1~R3C1.ContainAtLeast~4_4_6_9_5~R4C5~R5C5~R6C5~R7C5~R7C6~R7C7~R6C7.ContainAtLeast~2_3_8_7~R5C9~R6C9~R6C8~R7C8~R8C8~R9C8.ContainAtLeast~9_5_4~R7C9~R8C9~R9C9.ContainAtLeast~4_5~R5C3~R6C3.ContainAtLeast~2_3_7_8~R7C1~R8C1~R8C2~R8C3~R8C4.ContainAtLeast~6_8~R1C9~R1C8~R2C8~R3C8.ContainAtLeast~6_2~R4C8~R4C7~R3C7~R2C7.ContainAtLeast~9_3~R1C1~R1C2~R1C3~R1C4.ContainAtLeast~7_9~R9C1~R9C2~R9C3.ContainAtLeast~3_7~R4C2~R3C2~R3C3~R4C3',
        solution: '132985746596437281487126953873541692925673418614298537251364879368759124749812365',
      },
      {
        name: 'Stepped Thermos - nested replicate', // Using nested Replicate
        src: 'https://sudokupad.app/g21db32fo4',
        input: '.Replicate~JBAAIJAAAJB.Replicate~BIAB.NFA~UgMP_CIZCmOhP_CGKlKUpX_CJclKUpX_isbJqUpX_VJhG0UpX_UqbSuqpX_UpVHGfZX_UpSqvPC__UpSlWghP_UpSlKulP_UpSlKUpX_itclKUpX_VJjJqUpX_UqbW0UpX_UpVHOqpX_UpSqvfZX_UpSlWhC__jGKlKUpX_VKUlKUpX_Uqc5qUpX_UpVKUUpX_UpSq1qpX_UpSlWtZX_UpSlKve4~_~R1C1~R1C2~R1C3.End.Replicate~H.NFA~UgMP_CIZCmOhP_CGKlKUpX_CJclKUpX_isbJqUpX_VJhG0UpX_UqbSuqpX_UpVHGfZX_UpSqvPC__UpSlWghP_UpSlKulP_UpSlKUpX_itclKUpX_VJjJqUpX_UqbW0UpX_UpVHOqpX_UpSqvfZX_UpSlWhC__jGKlKUpX_VKUlKUpX_Uqc5qUpX_UpVKUUpX_UpSq1qpX_UpSlWtZX_UpSlKve4~_~R1C1~R2C1~R3C1.End.End.~R8C1_7~R9C3_9.Thermo~R6C4~R7C4~R7C3~R8C3~R8C2~R9C2.Thermo~R6C6~R6C7~R7C7~R7C8~R8C8~R8C9.Thermo~R4C6~R3C6~R3C7~R2C7~R2C8~R1C8.Thermo~R4C4~R4C3~R3C3~R3C2~R2C2~R2C1',
        solution: '541627893982531674376984521625493718137865942498172356813259467754316289269748135',
      },
    ],
  },
  {
    collection: '16x16',
    puzzles: [
      '16x16',
      '16x16: Sudoku X',
      '16x16: Sudoku X, hard',
      '16x16: Jigsaw',
    ],
  },
  {
    collection: 'Other sizes',
    puzzles: [
      '6x6',
      '6x6: Numbered rooms',
      '6x6: Between Odd and Even',
      '6x6: Little Killer',
      '4x4: Counting circles',
      '6x6: Rellik cages',  // Rellik cages
      '6x6: Successor Arrows',  // Regex
      '6x6: Full rank',  // Full rank (requires enforcing no ties)
      '4x4: Full Rank - no ties',
      '4x4: Full Rank - with ties',
      '4x4: Full Rank - unclued ties',
      '4x4: Full Rank - tied clues',
    ],
  },
  {
    collection: 'Non-square grids',
    puzzles: [
      '6x8: Plain',
      '5x10: Killer Sudoku',  // Killer cages (tests sum optimizer on non-square grids)
      '6x9: Postcard',  // Indexing, Anti-knight, Whisper
      '4x7: Jigsaw',  // Jigsaw
      '4x6: Skyscraper',  // Skyscraper
      '9x8: Plain boxless',  // Boxless rectangular grid
      '5x5: Squishtroquadri',  // non-standard numValues, Arrows and Thermo
      '7x7: Killer Squishdoku',  // non-standard numValues
      '6x6: Con-set-cutive',  // non-standard numValues, RegionSize, region-sized boxes
      '7x7: Skyscraper Squishdoku',  // non-standard numValues, Skyscraper
      '7x7: Numbered Rooms Squishdoku',  // non-standard numValues, Numbered Rooms
      '6x6: Hidden Hostility', // non-standard numValues, Diagonal, region-sized boxes
      '6x6: Order from Chaos', // non-standard numValues, Global Entropy, NFA, region-sized boxes
      '6x6: Irregular Quadro Quadri', // non-standard numValues, Jigsaw
      '7x7: Dutch Flat Mate Squishdoku', // non-standard numValues, Dutch Flatmates
      '7x7: Buggy NR Squishdoku',  // non-standard numValues, Numbered Rooms
      '6x6: 9-value disjoint sets',  // non-standard numValues, DisjointSets
    ],
  },
  {
    collection: '0-indexed',
    puzzles: [
      '0-indexed: Classic sudoku',
      '0-indexed: Sudoku X',
      '0-indexed: Anti-knight Anti-king',
      '0-indexed: Jigsaw',
      '0-indexed: Windoku',
      '0-indexed: Odd even',  // Pencilmark
      '0-indexed: 6x6',
      '0-indexed: 4x4 Full Rank',
      '0-indexed: 6x8 Plain',
      '0-indexed: 4x7 Jigsaw',
      '0-indexed: 9x8 Plain boxless',
      '0-indexed: 6x6 9-value disjoint sets',
      '0-indexed: Thermo SameValues',  // Thermo, SameValues
      '0-indexed: Whisper GreaterThan',  // Whisper, GreaterThan
      '0-indexed: 0-sensitive pairwise', // Pair with 0-sensitive fn
      '0-indexed: 0-8 Killer',  // Cage
      '0-indexed: Killer sudoku, with 0 cage, hard',  // Cage (with 0-sum cages)
      '0-indexed: Region sum lines',  // RegionSumLine
      '0-indexed: A very full quiver', // Arrow
      '0-indexed: Lets build a snowman',  // Arrow, BlackDot, WhiteDot, Thermo, Whisper
      '0-indexed: +-Information',  // V, StrictXV, Diagonal
      '0-indexed: Hidden skyscrapers',  // HiddenSkyscraper
      '0-indexed: Quadruple X',  // Quad, Diagonal
      '0-indexed: Look-and-say',  // ContainExact
      '0-indexed: Equality cages',  // EqualityCage
      '0-indexed: Skyscraper',  // Skyscraper
      '0-indexed: Counting circles',  // CountingCircles
      '0-indexed: Sequence sudoku',  // NFA
      '0-indexed: Regex line',  // Regex
      '0-indexed: Sums and indexing',  // SumLine, XSum, Rellik, Lunchbox, Sandwich, Indexing, ValueIndexing, NumberedRoom
      {
        name: 'Jigsaw with extended range',  // Jigsaw with extended value range (0-10) but restricted grid. Tests optimizer.
        input: '.Shape~9x9~0-10.NoBoxes.Jigsaw~AAAAAAABCDEFFAFABCDEFFFFBBCDEFFBBBBCDEEEGGCBCDDEGGGCCCDDEEGGGGHDIIIIHHHHIIIIIHHHH.~R9C9_1_2_3_4_5_6_7_8_9~R7C9_1_2_3_4_5_6_7_8_9~R5C9_1_2_3_4_5_6_7_8_9~R4C9_1_2_3_4_5_6_7_8_9~R3C9_1_2_3_4_5_6_7_8_9~R1C8_1_2_3_4_5_6_7_8_9~R2C8_1_2_3_4_5_6_7_8_9~R3C8_1_2_3_4_5_6_7_8_9~R4C8_1_2_3_4_5_6_7_8_9~R5C8_1_2_3_4_5_6_7_8_9~R6C8_1_2_3_4_5_6_7_8_9~R7C8_1_2_3_4_5_6_7_8_9~R8C8_1_2_3_4_5_6_7_8_9~R9C7_1_2_3_4_5_6_7_8_9~R8C7_1_2_3_4_5_6_7_8_9~R7C7_1_2_3_4_5_6_7_8_9~R6C7_1_2_3_4_5_6_7_8_9~R5C7_1_2_3_4_5_6_7_8_9~R4C7_1_2_3_4_5_6_7_8_9~R3C7_1_2_3_4_5_6_7_8_9~R2C7_1_2_3_4_5_6_7_8_9~R1C7_1_2_3_4_5_6_7_8_9~R1C6_1_2_3_4_5_6_7_8_9~R2C6_1_2_3_4_5_6_7_8_9~R5C6_1_2_3_4_5_6_7_8_9~R6C6_1_2_3_4_5_6_7_8_9~R9C6_1_2_3_4_5_6_7_8_9~R9C5_1_2_3_4_5_6_7_8_9~R7C5_1_2_3_4_5_6_7_8_9~R6C5_1_2_3_4_5_6_7_8_9~R5C5_1_2_3_4_5_6_7_8_9~R2C5_1_2_3_4_5_6_7_8_9~R1C5_1_2_3_4_5_6_7_8_9~R1C4_1_2_3_4_5_6_7_8_9~R2C4_1_2_3_4_5_6_7_8_9~R3C4_1_2_3_4_5_6_7_8_9~R4C4_1_2_3_4_5_6_7_8_9~R6C4_1_2_3_4_5_6_7_8_9~R7C4_1_2_3_4_5_6_7_8_9~R9C4_1_2_3_4_5_6_7_8_9~R9C3_1_2_3_4_5_6_7_8_9~R8C3_1_2_3_4_5_6_7_8_9~R7C3_1_2_3_4_5_6_7_8_9~R6C3_1_2_3_4_5_6_7_8_9~R5C3_1_2_3_4_5_6_7_8_9~R3C3_1_2_3_4_5_6_7_8_9~R2C3_1_2_3_4_5_6_7_8_9~R1C2_1_2_3_4_5_6_7_8_9~R1C3_1_2_3_4_5_6_7_8_9~R2C2_1_2_3_4_5_6_7_8_9~R3C2_1_2_3_4_5_6_7_8_9~R4C2_1_2_3_4_5_6_7_8_9~R5C2_1_2_3_4_5_6_7_8_9~R6C2_1_2_3_4_5_6_7_8_9~R7C2_1_2_3_4_5_6_7_8_9~R8C2_1_2_3_4_5_6_7_8_9~R9C2_1_2_3_4_5_6_7_8_9~R9C1_1_2_3_4_5_6_7_8_9~R8C1_1_2_3_4_5_6_7_8_9~R6C1_1_2_3_4_5_6_7_8_9~R5C1_1_2_3_4_5_6_7_8_9~R4C1_1_2_3_4_5_6_7_8_9~R3C1_1_2_3_4_5_6_7_8_9~R1C1_3~R2C1_1~R1C9_7~R2C9_5~R3C5_6~R3C6_8~R4C5_1~R4C6_9~R4C3_5~R5C4_9~R8C4_2~R8C5_3~R7C6_3~R8C6_5~R7C1_8~R9C8_9~R8C9_1~R6C9_2',
        solution: '364891527189374265542168739625719843213987456937456182876523914498235671751642398',
      },
      {
        name: 'Killer sudoku with extended range',  // Killer sudoku with extended value range (0-10) but restricted grid.
        input: '.Shape~9x9~0-10.Cage~3~R1C1~R1C2.Cage~15~R1C3~R1C4~R1C5.Cage~25~R2C1~R2C2~R3C1~R3C2.Cage~17~R2C3~R2C4.Cage~9~R3C3~R3C4~R4C4.Cage~22~R1C6~R2C5~R2C6~R3C5.Cage~4~R1C7~R2C7.Cage~16~R1C8~R2C8.Cage~15~R1C9~R2C9~R3C9~R4C9.Cage~20~R3C7~R3C8~R4C7.Cage~8~R3C6~R4C6~R5C6.Cage~17~R4C5~R5C5~R6C5.Cage~20~R5C4~R6C4~R7C4.Cage~14~R4C2~R4C3.Cage~6~R4C1~R5C1.Cage~13~R5C2~R5C3~R6C2.Cage~6~R6C3~R7C2~R7C3.Cage~17~R4C8~R5C7~R5C8.Cage~27~R6C1~R7C1~R8C1~R9C1.Cage~8~R8C2~R9C2.Cage~16~R8C3~R9C3.Cage~10~R7C5~R8C4~R8C5~R9C4.Cage~12~R5C9~R6C9.Cage~6~R6C7~R6C8.Cage~20~R6C6~R7C6~R7C7.Cage~15~R8C6~R8C7.Cage~14~R7C8~R7C9~R8C8~R8C9.Cage~13~R9C5~R9C6~R9C7.Cage~17~R9C8~R9C9.~R9C9_1_2_3_4_5_6_7_8_9~R7C9_1_2_3_4_5_6_7_8_9~R5C9_1_2_3_4_5_6_7_8_9~R4C9_1_2_3_4_5_6_7_8_9~R3C9_1_2_3_4_5_6_7_8_9~R1C8_1_2_3_4_5_6_7_8_9~R2C8_1_2_3_4_5_6_7_8_9~R3C8_1_2_3_4_5_6_7_8_9~R4C8_1_2_3_4_5_6_7_8_9~R5C8_1_2_3_4_5_6_7_8_9~R6C8_1_2_3_4_5_6_7_8_9~R7C8_1_2_3_4_5_6_7_8_9~R9C7_1_2_3_4_5_6_7_8_9~R8C7_1_2_3_4_5_6_7_8_9~R7C7_1_2_3_4_5_6_7_8_9~R6C7_1_2_3_4_5_6_7_8_9~R5C7_1_2_3_4_5_6_7_8_9~R4C7_1_2_3_4_5_6_7_8_9~R3C7_1_2_3_4_5_6_7_8_9~R2C7_1_2_3_4_5_6_7_8_9~R1C7_1_2_3_4_5_6_7_8_9~R1C6_1_2_3_4_5_6_7_8_9~R2C6_1_2_3_4_5_6_7_8_9~R5C6_1_2_3_4_5_6_7_8_9~R6C6_1_2_3_4_5_6_7_8_9~R9C6_1_2_3_4_5_6_7_8_9~R9C5_1_2_3_4_5_6_7_8_9~R7C5_1_2_3_4_5_6_7_8_9~R6C5_1_2_3_4_5_6_7_8_9~R5C5_1_2_3_4_5_6_7_8_9~R2C5_1_2_3_4_5_6_7_8_9~R1C5_1_2_3_4_5_6_7_8_9~R1C4_1_2_3_4_5_6_7_8_9~R2C4_1_2_3_4_5_6_7_8_9~R3C4_1_2_3_4_5_6_7_8_9~R4C4_1_2_3_4_5_6_7_8_9~R6C4_1_2_3_4_5_6_7_8_9~R7C4_1_2_3_4_5_6_7_8_9~R9C4_1_2_3_4_5_6_7_8_9~R9C3_1_2_3_4_5_6_7_8_9~R8C3_1_2_3_4_5_6_7_8_9~R7C3_1_2_3_4_5_6_7_8_9~R6C3_1_2_3_4_5_6_7_8_9~R5C3_1_2_3_4_5_6_7_8_9~R3C3_1_2_3_4_5_6_7_8_9~R2C3_1_2_3_4_5_6_7_8_9~R1C2_1_2_3_4_5_6_7_8_9~R1C3_1_2_3_4_5_6_7_8_9~R2C2_1_2_3_4_5_6_7_8_9~R3C2_1_2_3_4_5_6_7_8_9~R4C2_1_2_3_4_5_6_7_8_9~R5C2_1_2_3_4_5_6_7_8_9~R6C2_1_2_3_4_5_6_7_8_9~R7C2_1_2_3_4_5_6_7_8_9~R8C2_1_2_3_4_5_6_7_8_9~R9C2_1_2_3_4_5_6_7_8_9~R9C1_1_2_3_4_5_6_7_8_9~R8C1_1_2_3_4_5_6_7_8_9~R6C1_1_2_3_4_5_6_7_8_9~R5C1_1_2_3_4_5_6_7_8_9~R4C1_1_2_3_4_5_6_7_8_9~R3C1_1_2_3_4_5_6_7_8_9~R3C6_1_2_3_4_5_6_7_8_9~R3C5_1_2_3_4_5_6_7_8_9~R4C5_1_2_3_4_5_6_7_8_9~R4C6_1_2_3_4_5_6_7_8_9~R4C3_1_2_3_4_5_6_7_8_9~R5C4_1_2_3_4_5_6_7_8_9~R7C6_1_2_3_4_5_6_7_8_9~R8C5_1_2_3_4_5_6_7_8_9~R8C6_1_2_3_4_5_6_7_8_9~R8C4_1_2_3_4_5_6_7_8_9~R9C8_1_2_3_4_5_6_7_8_9~R8C8_1_2_3_4_5_6_7_8_9~R8C9_1_2_3_4_5_6_7_8_9~R6C9_1_2_3_4_5_6_7_8_9~R2C9_1_2_3_4_5_6_7_8_9~R1C9_1_2_3_4_5_6_7_8_9~R1C1_1_2_3_4_5_6_7_8_9~R2C1_1_2_3_4_5_6_7_8_9~R7C1_1_2_3_4_5_6_7_8_9',
        solution: '215647398368952174794381652586274931142593867973816425821739546659428713437165289',
      },
      {
        name: 'Killer sudoku (hard) with extended range',  // Killer sudoku with extended value range (0-10) but restricted grid.
        input: '.Shape~9x9~0-10.Cage~28~R1C1~R1C2~R2C2~R2C3~R2C4.Cage~19~R1C3~R1C4~R1C5~R2C5~R2C6.Cage~24~R1C6~R1C7~R1C8~R2C7.Cage~20~R1C9~R2C8~R2C9~R3C8~R4C8.Cage~19~R2C1~R3C1~R3C2~R4C1.Cage~23~R3C3~R3C4~R3C5~R3C6~R4C3.Cage~19~R3C7~R4C5~R4C6~R4C7~R5C7.Cage~26~R3C9~R4C9~R5C8~R5C9~R6C8.Cage~28~R4C2~R5C1~R5C2~R6C1~R7C1.Cage~24~R4C4~R5C4~R5C5~R5C6~R6C6.Cage~32~R5C3~R6C3~R6C4~R6C5~R7C3.Cage~24~R6C2~R7C2~R8C1~R8C2~R9C1.Cage~29~R6C7~R7C4~R7C5~R7C6~R7C7.Cage~19~R6C9~R7C8~R7C9~R8C9.Cage~22~R8C3~R9C2~R9C3~R9C4.Cage~21~R8C4~R8C5~R9C5~R9C6~R9C7.Cage~28~R8C6~R8C7~R8C8~R9C8~R9C9.~R1C9_1_2_3_4_5_6_7_8_9~R2C9_1_2_3_4_5_6_7_8_9~R3C9_1_2_3_4_5_6_7_8_9~R4C9_1_2_3_4_5_6_7_8_9~R5C9_1_2_3_4_5_6_7_8_9~R6C9_1_2_3_4_5_6_7_8_9~R7C9_1_2_3_4_5_6_7_8_9~R8C9_1_2_3_4_5_6_7_8_9~R9C9_1_2_3_4_5_6_7_8_9~R9C8_1_2_3_4_5_6_7_8_9~R7C8_1_2_3_4_5_6_7_8_9~R6C8_1_2_3_4_5_6_7_8_9~R5C8_1_2_3_4_5_6_7_8_9~R4C8_1_2_3_4_5_6_7_8_9~R3C8_1_2_3_4_5_6_7_8_9~R2C8_1_2_3_4_5_6_7_8_9~R1C8_1_2_3_4_5_6_7_8_9~R8C8_1_2_3_4_5_6_7_8_9~R8C7_1_2_3_4_5_6_7_8_9~R9C7_1_2_3_4_5_6_7_8_9~R6C7_1_2_3_4_5_6_7_8_9~R4C7_1_2_3_4_5_6_7_8_9~R3C7_1_2_3_4_5_6_7_8_9~R2C7_1_2_3_4_5_6_7_8_9~R1C7_1_2_3_4_5_6_7_8_9~R5C7_1_2_3_4_5_6_7_8_9~R7C7_1_2_3_4_5_6_7_8_9~R8C6_1_2_3_4_5_6_7_8_9~R9C6_1_2_3_4_5_6_7_8_9~R7C6_1_2_3_4_5_6_7_8_9~R6C6_1_2_3_4_5_6_7_8_9~R5C6_1_2_3_4_5_6_7_8_9~R4C6_1_2_3_4_5_6_7_8_9~R3C6_1_2_3_4_5_6_7_8_9~R2C6_1_2_3_4_5_6_7_8_9~R1C6_1_2_3_4_5_6_7_8_9~R1C5_1_2_3_4_5_6_7_8_9~R2C5_1_2_3_4_5_6_7_8_9~R3C5_1_2_3_4_5_6_7_8_9~R4C5_1_2_3_4_5_6_7_8_9~R5C5_1_2_3_4_5_6_7_8_9~R6C5_1_2_3_4_5_6_7_8_9~R7C5_1_2_3_4_5_6_7_8_9~R8C5_1_2_3_4_5_6_7_8_9~R9C5_1_2_3_4_5_6_7_8_9~R9C4_1_2_3_4_5_6_7_8_9~R8C4_1_2_3_4_5_6_7_8_9~R7C4_1_2_3_4_5_6_7_8_9~R6C4_1_2_3_4_5_6_7_8_9~R5C4_1_2_3_4_5_6_7_8_9~R4C4_1_2_3_4_5_6_7_8_9~R3C4_1_2_3_4_5_6_7_8_9~R1C4_1_2_3_4_5_6_7_8_9~R2C4_1_2_3_4_5_6_7_8_9~R1C3_1_2_3_4_5_6_7_8_9~R2C3_1_2_3_4_5_6_7_8_9~R3C3_1_2_3_4_5_6_7_8_9~R4C3_1_2_3_4_5_6_7_8_9~R5C2_1_2_3_4_5_6_7_8_9~R6C2_1_2_3_4_5_6_7_8_9~R7C2_1_2_3_4_5_6_7_8_9~R8C3_1_2_3_4_5_6_7_8_9~R7C3_1_2_3_4_5_6_7_8_9~R6C3_1_2_3_4_5_6_7_8_9~R5C3_1_2_3_4_5_6_7_8_9~R9C3_1_2_3_4_5_6_7_8_9~R9C2_1_2_3_4_5_6_7_8_9~R8C2_1_2_3_4_5_6_7_8_9~R8C1_1_2_3_4_5_6_7_8_9~R9C1_1_2_3_4_5_6_7_8_9~R7C1_1_2_3_4_5_6_7_8_9~R6C1_1_2_3_4_5_6_7_8_9~R5C1_1_2_3_4_5_6_7_8_9~R4C1_1_2_3_4_5_6_7_8_9~R4C2_1_2_3_4_5_6_7_8_9~R3C2_1_2_3_4_5_6_7_8_9~R2C2_1_2_3_4_5_6_7_8_9~R1C2_1_2_3_4_5_6_7_8_9~R1C1_1_2_3_4_5_6_7_8_9~R2C1_1_2_3_4_5_6_7_8_9~R3C1_1_2_3_4_5_6_7_8_9',
        solution: '283197546967542813415368729591726384876439152324851967149275638752683491638914275',
      }
    ],
  },
  {
    collection: 'Extra Variables',
    puzzles: [
      'Doppelganger',  // Doppelganger
      'Dutch-pelganger - easier',  // Doppelganger, Whisper on state cells
      'Bates Motel',  // Var, ValueIndexing, 6x6
      'The good, the bad and the ugly',  // Var, NFA, SameValues, Arrow, NFA (for sandwich, xsum, skyscraper)
      'Letter Little Killer',  // Var, Sum (with coeffs)
      '6x6 Miracle Sudoku',  // Var, Sum (with coeffs), NFA (comparing sums), Replicate, PerfectAllDifferent optimization
      {  // Var cells inside Or composite
        name: 'Or with extra cells',
        input: '.Var~X~X.Or.And.~R1C1_1~VX_1~R4C4_1.End.And.~R1C1_2~VX_2~R4C4_2.End.End.~R2C5_1~R5C3_3~R7C7_4~R8C2_5~R3C2_6~R1C8_7~R9C9_8~R6C6_9~R5C9_1~R9C3_2~R7C1_3~R6C4_4~R3C6_5~R2C7_6~R7C9_7~R8C5_8~R1C3_9~R5C1_5~R6C8_6~R3C4_8~R9C1_7~R3C7_9',
        solution: '139642875825917634467835912674153289593268741218479563386521497951784326742396158',
      },
      {
        name: 'Extra var with Quad',  // Var, Quad
        input: '.Var~X~X~27.BlackDot~VX1~VX2~VX3~VX10.Quad~VX13~1~2~3~4.AntiKnight.AntiConsecutive.Thermo~VX22~VX13~VX4~R9C4~R8C4~R7C4.Thermo~VX19~VX10~VX1~R9C1~R8C1.Thermo~VX22~VX23~VX24~VX25~VX26~VX27~VX18~VX17.Thermo~VX16~VX15~VX14~VX5~VX6~VX7~VX8~VX9.Thermo~VX12~VX21~VX20~VX11~VX2.~VX12_4~VX16_2~R5C3_1~R2C2_2~R6C7_5~R4C6_6',
        solution: '384629157629157384157384629573846291291573846846291573462915738915738462738462915',
      },
      'Cavernous Construction: 6x6',  // ChaosConstruction, multi-arm ChaosArrow
      'Chaos Construction: 6x6',  // ChaosConstruction, NFA
      {  // ChaosConstruction with numValues > regionSize, cells restricted back to {1..6}
        name: 'Chaos Construction: 6x6 with extra numValues',
        input: '.Shape~6x6~7.ChaosConstruction.NoBoxes.ChaosArrow~R1C2~~CC2~CC3~CC4~CC5~CC6.ChaosArrow~R2C2~~CC8~CC9~CC10~CC11~CC12.ChaosArrow~R3C1~~CC13~CC14~CC15~CC16~CC17~CC18.ChaosArrow~R6C1~~CC31~CC32~CC33~CC34~CC35~CC36.ChaosArrow~R3C2~~CC14~CC20~CC26~CC32.ChaosArrow~R4C2~~CC20~CC19.ChaosArrow~R5C3~~CC27~CC21~CC15~CC9~CC3.ChaosArrow~R6C3~~CC33~CC32~CC31.ChaosArrow~R1C4~~CC4~CC10~CC16~CC22~CC28~CC34.ChaosArrow~R5C4~~CC28~CC22~CC16~CC10~CC4.ChaosArrow~R6C4~~CC34~CC33~CC32~CC31.ChaosArrow~R2C5~~CC11~CC10~CC9~CC8~CC7.ChaosArrow~R4C5~~CC23~CC17~CC11~CC5.ChaosArrow~R6C5~~CC35~CC34~CC33~CC32~CC31.ChaosArrow~R2C6~~CC12~CC6.ChaosArrow~R2C6~~CC12~CC11~CC10~CC9~CC8~CC7.ChaosArrow~R4C6~~CC24~CC18~CC12~CC6.ChaosArrow~R5C6~~CC30~CC29~CC28~CC27~CC26~CC25.~R3C2_1~R4C3_6~R1C1_1_2_3_4_5_6~R1C2_1_2_3_4_5_6~R1C3_1_2_3_4_5_6~R1C4_1_2_3_4_5_6~R1C5_1_2_3_4_5_6~R1C6_1_2_3_4_5_6~R2C1_1_2_3_4_5_6~R2C2_1_2_3_4_5_6~R2C3_1_2_3_4_5_6~R2C4_1_2_3_4_5_6~R2C5_1_2_3_4_5_6~R2C6_1_2_3_4_5_6~R3C1_1_2_3_4_5_6~R3C3_1_2_3_4_5_6~R3C4_1_2_3_4_5_6~R3C5_1_2_3_4_5_6~R3C6_1_2_3_4_5_6~R4C1_1_2_3_4_5_6~R4C2_1_2_3_4_5_6~R4C4_1_2_3_4_5_6~R4C5_1_2_3_4_5_6~R4C6_1_2_3_4_5_6~R5C1_1_2_3_4_5_6~R5C2_1_2_3_4_5_6~R5C3_1_2_3_4_5_6~R5C4_1_2_3_4_5_6~R5C5_1_2_3_4_5_6~R5C6_1_2_3_4_5_6~R6C1_1_2_3_4_5_6~R6C2_1_2_3_4_5_6~R6C3_1_2_3_4_5_6~R6C4_1_2_3_4_5_6~R6C5_1_2_3_4_5_6~R6C6_1_2_3_4_5_6',
        solution: '345126634512213654526431451263162345',
      },
      'Chaos Construction: cell count', // ChaosConstruction, ChaosCount
      {
        name: 'Chaos Construction: cell count - expanded',
        src: 'https://www.gmpuzzles.com/blog/2025/06/chaos-construction-sudoku-cell-count-by-clover/',
        input: '.Shape~6x6.ChaosConstruction.NoBoxes.~R1C2_6~R1C4_4~R1C6_3~R2C1_3~R6C1_4~R6C3_2~R6C5_6~R5C6_5.ChaosCount~R1C2~~CC2~CC1~CC7~CC8~CC9~CC3.ChaosCount~R1C4~~CC4~CC3~CC9~CC10~CC11~CC5.ChaosCount~R1C6~~CC6~CC5~CC11~CC12.ChaosCount~R2C6~~CC12~CC6~CC5~CC11~CC17~CC18.ChaosCount~R5C1~~CC25~CC19~CC20~CC26~CC32~CC31.ChaosCount~R6C1~~CC31~CC25~CC26~CC32.ChaosCount~R6C3~~CC33~CC32~CC26~CC27~CC28~CC34.ChaosCount~R6C5~~CC35~CC34~CC28~CC29~CC30~CC36',
        solution: '265413314652543126126534631245452361',
      },
      {
        name: 'Chaos Construction: Uncovering tunnels - easy',
        src: 'https://sudokupad.app/y323plq5im', // With extra gives to make it faster
        input: '.ChaosConstruction.NoBoxes.ChaosArrow~R6C1~1~CC46~CC37~CC28~CC19~CC10~CC1.ChaosArrow~R3C2~1~CC20~CC29~CC38~CC47~CC56~CC65~CC74.ChaosArrow~R3C3~1~CC21~CC30~CC39~CC48~CC57~CC66~CC75.ChaosArrow~R1C3~1~CC3~CC4~CC5~CC6~CC7~CC8~CC9.ChaosArrow~R1C4~1~CC4~CC12~CC20~CC28.ChaosArrow~R3C5~1~CC23~CC14~CC5.ChaosArrow~R3C5~1~CC23~CC15~CC7.ChaosArrow~R2C8~1~CC17~CC16~CC15~CC14~CC13~CC12~CC11~CC10.ChaosArrow~R4C7~1~CC34~CC33~CC32~CC31~CC30~CC29~CC28.ChaosArrow~R5C4~1~CC40~CC49~CC58~CC67~CC76.ChaosArrow~R7C5~1~CC59~CC68~CC77.ChaosArrow~R7C5~1~CC59~CC67~CC75.ChaosArrow~R8C7~1~CC70~CC71~CC72.ChaosArrow~R7C9~1~CC63~CC54~CC45~CC36~CC27~CC18~CC9.ChaosArrow~R6C6~1~CC51~CC52~CC53~CC54.NFA~UgIn_GQpjoSpdVCEIQqoQhC_4wjCMIwj_7CMIwjCM_5WlaVpWl_7jOM4zjO_53ned53n_8EQRBEEQ_6YpimKYp_8lSVJUlS_65rmua5r_4mCYJgmC_7RtG0bRt_5HEcRxHE_7yvK8ryv_5oGgaBoG_8TxPE8Tx_6JIkiSJI_80zTNM0z~_ParityCount~R6C1~R5C1~R4C1~R3C1~R2C1~R1C1~~R3C2~R4C2~R5C2~R6C2~R7C2~R8C2~R9C2~~R3C3~R4C3~R5C3~R6C3~R7C3~R8C3~R9C3~~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9~~R1C4~R2C3~R3C2~R4C1~~R3C5~R2C5~R1C5~~R3C5~R2C6~R1C7~~R2C8~R2C7~R2C6~R2C5~R2C4~R2C3~R2C2~R2C1~~R4C7~R4C6~R4C5~R4C4~R4C3~R4C2~R4C1~~R5C4~R6C4~R7C4~R8C4~R9C4~~R7C5~R8C5~R9C5~~R7C5~R8C4~R9C3~~R8C7~R8C8~R8C9~~R7C9~R6C9~R5C9~R4C9~R3C9~R2C9~R1C9~~R6C6~R6C7~R6C8~R6C9.Whisper~4~R6C1~R6C2.Whisper~4~R2C7~R3C7.Whisper~4~R3C6~R4C6.Whisper~4~R4C7~R5C6.Whisper~4~R4C9~R5C8.Whisper~4~R6C5~R7C6.Whisper~4~R7C7~R7C8.Whisper~4~R7C3~R8C3.AllDifferent~CC46~CC47.AllDifferent~CC16~CC25.AllDifferent~CC24~CC33.AllDifferent~CC34~CC42.AllDifferent~CC36~CC44.AllDifferent~CC50~CC60.AllDifferent~CC61~CC62.AllDifferent~CC57~CC66.~R2C3_9~R7C7_9~R6C2_9~R3C4_9~R5C6_9~R9C5_9~R8C9_9~R4C1_9~R9C2_1~R7C3_1~R1C6_6~R5C7_6~R4C3_2~R1C1_5~R9C7_5~R6C4_5~R3C8_8~R2C7_7~R7C1_3',
        solution: '524176398159864732643915287932781465785249613496532871371628954268357149817493526',
      }
    ],
  }
];

const layoutCases = [
  ...VALID_JIGSAW_LAYOUTS.slice(0, 20),
  ...EASY_INVALID_JIGSAW_LAYOUTS,
  ...FAST_INVALID_JIGSAW_LAYOUTS.slice(0, 20),
  ...VALID_JIGSAW_BOX_LAYOUTS.slice(0, 10),
  // Add non-standard grid tests.
  { input: '.Shape~7x7', solution: true },
  { input: '.Shape~6x6~9', solution: true },
  { input: '.Shape~6x6~9.NoBoxes', solution: true },
  { input: '.Shape~6x6~9.RegionSize~6', solution: true },
  { input: '.Shape~7x6~9', solution: true },
  { input: '.Shape~7x6~9.RegionSize~7', solution: true },
];

const loadInput = async (puzzle) => {
  if (puzzle.input.startsWith('/')) {
    const filePath = resolvePath(process.cwd(), '.' + puzzle.input);
    return readFile(filePath, 'utf8');
  }
  return puzzle.input;
};

const assertPuzzleSolution = (puzzle, solution, solutionCount) => {
  if (puzzle.solution === undefined) return;
  if (!puzzle.solution) {
    if (solution) throw new Error(`Puzzle ${puzzle.name} failed: ${solution}`);
  } else if (puzzle.solution === true) {
    if (!solution) throw new Error(`Puzzle ${puzzle.name} failed: ${solution}`);
  } else {
    if (solution !== puzzle.solution) {
      throw new Error(`Puzzle ${puzzle.name} failed: ${solution}`);
    }
    if (solutionCount !== undefined && solutionCount !== 1) {
      throw new Error(
        `Puzzle ${puzzle.name} failed: solution is not unique (found ${solutionCount})`);
    }
  }
};

const runCollection = async (puzzles, solveFn, label) => {
  const stats = [];
  for (const puzzleCfg of puzzles) {
    const puzzle = await resolvePuzzleConfig(puzzleCfg);
    await runTest(`${label}: ${puzzle.name}`, async () => {
      const input = await loadInput(puzzle);
      const result = await solveFn(input);

      const solution = result?.solution !== undefined ? result.solution : result;
      const solutionCount = result?.solutionCount;
      assertPuzzleSolution(puzzle, solution?.toString() || null, solutionCount);
    });

    stats.push({
      puzzle: puzzle.name,
      ...solver.latestStats(),
    });
  }

  stats.total = stats.reduce((acc, item) => acc.add(item), new SolverStats());
  return stats;
};

const solver = new SimpleSolver();


const formatNumber = (value) => value.toLocaleString('en-US');
const formatSeconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

const logCollectionSummary = (result, label = result.collection) => {
  const total = result.stats.total || {};
  const parts = [`${label}: ${result.stats.length} puzzles`];
  const runtimeMs = typeof total.rumtimeMs === 'number' ? total.rumtimeMs : total.runtimeMs;
  if (typeof runtimeMs === 'number') {
    parts.push(`runtime ${formatSeconds(runtimeMs)}`);
  }
  if (typeof total.guesses === 'number') {
    parts.push(`guesses ${formatNumber(total.guesses)}`);
  }
  logInfo('  ' + parts.join(' | '));
};

const runSolveResults = [];
for (const { collection, puzzles } of solveCollections) {
  const stats = await runCollection(
    puzzles,
    (input) => {
      const candidates = [...solver.solutions(input, 2)];
      return { solution: candidates[0] || null, solutionCount: candidates.length };
    },
    collection
  );
  runSolveResults.push({ collection, stats });
}
runSolveResults.forEach((result) => logCollectionSummary(result));

const runLayoutResults = [];
{
  const stats = await runCollection(
    layoutCases,
    (input) => solver.validateLayout(input),
    'Layout'
  );
  runLayoutResults.push({ collection: 'Jigsaw layouts', stats });
}
runLayoutResults.forEach((result) => logCollectionSummary(result));

logSuiteComplete('End-to-end');
