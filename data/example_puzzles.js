// Example puzzles shown in the main page's example selector,
// one group per dropdown optgroup.
//
// See data/README.md ("Puzzle entry") for the field spec. `name` is the real
// puzzle name where known (and the stable lookup key); `displayName` is the
// dropdown label when it differs.

export const DISPLAYED_EXAMPLE_GROUPS = [
  {
    name: 'Givens & pencilmarks',
    puzzles: [
      {
        name: 'Classic sudoku',
        src: 'https://en.wikipedia.org/wiki/Sudoku#/media/File:Sudoku_Puzzle_by_L2G-20050714_standardized_layout.svg',
        input: '.~R1C1_5~R1C2_3~R1C5_7~R2C1_6~R2C4_1~R2C5_9~R2C6_5~R3C2_9~R3C3_8~R3C8_6~R4C1_8~R4C5_6~R4C9_3~R5C1_4~R5C4_8~R5C6_3~R5C9_1~R6C1_7~R6C5_2~R6C9_6~R7C2_6~R7C7_2~R7C8_8~R8C4_4~R8C5_1~R8C6_9~R8C9_5~R9C5_8~R9C8_7~R9C9_9',
        solution: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
      },
      {
        name: 'Odd & even',
        src: ['https://www.youtube.com/watch?v=Q7hhVgE8zGM', 'https://sudokupad.app/8bNmDd4J9G'],
        input: '.~R1C6_7~R1C7_2~R1C8_1~R1C9_6~R2C9_5~R2C8_7~R2C7_9~R2C6_4~R8C1_2~R8C2_7~R8C3_4~R8C4_5~R9C1_9~R9C2_5~R9C3_8~R9C4_2~R4C7_2_4_6_8~R4C8_2_4_6_8~R5C6_2_4_6_8~R6C6_2_4_6_8~R6C7_2_4_6_8~R6C8_2_4_6_8~R7C6_2_4_6_8~R8C7_2_4_6_8~R8C8_2_4_6_8~R2C3_1_3_5_7_9~R3C2_1_3_5_7_9~R4C4_1_3_5_7_9~R4C2_1_3_5_7_9~R5C4_1_3_5_7_9~R5C2_1_3_5_7_9~R3C4_1_3_5_7_9~R6C3_1_3_5_7_9',
        solution: '549837216823614975716925348635149827492786153187352469361478592274593681958261734',
      },
      {
        name: 'Pencilmark sudoku',
        src: 'https://sudokupad.app/v7oVqMfjTs',
        input: '.~R1C1_1_2~R2C2_1_2_9~R2C4_1_3~R1C5_1_4_6~R2C5_8_9~R4C2_2_3~R5C2_7_9~R9C1_2_3~R7C3_8_9~R8C3_1_2_3_8_9~R6C3_6_7~R3C3_5_6_9~R4C4_3_4_5~R4C5_4_9~R5C5_6_7_8~R8C5_1_2~R7C4_4_6~R9C5_5_6~R1C6_6_9~R3C6_5_7~R4C6_6_9~R6C6_1_4_7~R8C6_1_8~R9C9_3_4_5~R8C8_2_8_9~R7C7_6_7_8~R6C8_4_8~R5C9_4_6~R4C7_5_6~R3C7_7_9~R2C8_1_2_3_5_8_9~R1C8_1_9~R1C9_1_3',
        solution: '278569413916384752435127968123496587894275136567831249759643821642718395381952674',
      },
    ],
  },
  {
    name: 'Lines',
    puzzles: [
      {
        name: 'Thermo',
        src: ['https://www.youtube.com/watch?v=lgJYOuVk910', 'https://sudokupad.app/TtTmqGMBDR'],
        input: '.~R1C2_4~R1C8_1~R2C1_2~R2C9_6~R8C1_9~R8C9_2~R9C2_1~R9C8_9.Thermo~R9C4~R8C3~R7C2~R6C1~R5C2~R4C3.Thermo~R4C1~R3C2~R2C3~R1C4~R2C5~R3C6.Thermo~R1C6~R2C7~R3C8~R4C9~R5C8~R6C7.Thermo~R6C9~R7C8~R8C7~R9C6~R8C5~R7C4',
        solution: '847632519295471386631598247129743865486259173753816924368924751974185632512367498',
      },
      {
        name: 'German Whispers',
        displayName: 'German whispers',
        src: ['https://www.youtube.com/watch?v=nH3vat8z9uM', 'https://sudokupad.app/QM8RdBLBb9'],
        input: '.Whisper~R8C1~R7C1~R7C2~R8C3~R9C3~R9C2.Whisper~R9C6~R8C7~R7C7~R7C8~R6C9~R5C8.Whisper~R6C3~R5C2~R4C3~R3C4~R2C5~R1C6~R1C7~R2C8~R3C8~R4C7~R5C6~R6C6~R7C6~R8C5~R7C4.Whisper~R4C5~R4C6~R3C7.~R1C5_1~R2C2_5~R5C1_6~R5C9_9~R7C3_3~R8C8_3~R9C1_5~R9C5_3',
        solution: '796413852352689417184275693247591386615348279839762541923857164478126935561934728',
      },
      {
        name: 'Elementary',
        displayName: 'International whispers',
        src: ['https://www.youtube.com/watch?v=5xu7OpQogfo', 'https://sudokupad.app/jbJ8PNDgR7'],
        input: '.WhiteDot~R8C9~R9C9.WhiteDot~R7C9~R7C8.WhiteDot~R8C4~R8C5.WhiteDot~R5C2~R5C1.WhiteDot~R5C2~R6C2.WhiteDot~R6C6~R6C5.WhiteDot~R5C8~R5C7.WhiteDot~R2C4~R2C5.WhiteDot~R2C2~R2C1.Whisper~6~R1C2~R2C2~R3C2.Whisper~6~R2C1~R3C2~R4C3.Whisper~6~R2C3~R3C2~R4C1.Whisper~4~R7C2~R8C2~R9C2.Whisper~4~R8C1~R8C2~R8C3.Whisper~4~R9C1~R9C2~R9C3.Whisper~2~R9C7~R9C8~R8C8~R7C8~R6C8.Whisper~2~R7C7~R7C8~R8C9.Whisper~2~R8C7~R7C8~R6C9.Whisper~4~R4C7~R3C8~R4C9.Whisper~4~R3C8~R2C8~R1C8.Whisper~4~R1C7~R1C8~R1C9.Whisper~4~R2C7~R2C8~R2C9.Whisper~3~R4C5~R5C5~R6C5~R7C5.Whisper~3~R5C4~R5C5~R5C6.Whisper~3~R6C4~R5C5~R6C6.~R1C3_6~R4C4_3~R7C1_4~R9C9_2~R4C8_4',
        solution: '536971284897234516214856793768392145342518679951467328485123967629785431173649852',
      },
      {
        name: '\'Leven',
        displayName: 'Renban',
        src: ['https://www.youtube.com/watch?v=XouRUgRsVSA', 'https://sudokupad.app/jtgN8Hd7f6'],
        input: '.Renban~R4C8~R4C9~R5C9~R6C9.Renban~R7C9~R8C9~R9C9~R9C8.Renban~R6C7~R7C7~R8C7~R8C6.Renban~R2C6~R1C6~R1C5~R1C4.Renban~R2C1~R1C1~R1C2~R1C3.Renban~R2C3~R2C4~R3C4~R4C4.Renban~R5C5~R5C6~R6C6~R7C6.Renban~R5C4~R5C3~R6C3~R7C3.Renban~R3C1~R4C1~R5C1~R5C2.Renban~R7C1~R8C1~R9C1~R9C2.Renban~R7C4~R8C4~R9C4~R9C3.~R3C7_1.BlackDot~R2C9~R3C9.BlackDot~R1C7~R1C8.BlackDot~R3C6~R3C5.BlackDot~R4C7~R5C7',
        solution: '132769845496518723758342196815473269963285417274196358521937684389624571647851932',
      },
      {
        name: 'Sudoku Variants Series (173) - Between Lines Sudoku',
        displayName: 'Between lines',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=0002KO',
        input: '.Between~R9C5~R8C6~R7C7~R6C8~R5C9.Between~R9C3~R8C4~R7C5~R6C6~R5C7~R4C8~R3C9.Between~R1C9~R2C8~R3C7~R4C6~R5C5~R6C4~R7C3~R8C2~R9C1.Between~R5C1~R4C2~R3C3~R2C4~R1C5.Between~R7C1~R6C2~R5C3~R4C4~R3C5~R2C6~R1C7.~R1C2_9~R2C1_2~R2C7_1~R4C3_6~R4C5_7~R4C8_5~R5C2_3~R5C8_8~R6C5_5~R6C7_2~R8C3_9~R8C9_8~R9C8_1',
        solution: '697531842258497163314862579846273951532149786971658234125386497469715328783924615',
      },
      {
        name: 'Lockout Lines (DSM 23 Quali Training)',
        displayName: 'Lockout lines',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000CM1',
        input: '.Lockout~4~R1C2~R2C2~R3C2~R4C2.Lockout~4~R4C2~R3C3~R2C3~R1C2.Lockout~4~R2C5~R2C4~R3C4~R3C5~R4C5~R4C4.Lockout~4~R4C6~R3C6~R2C6~R1C6~R2C7~R1C8~R2C8~R3C8~R4C8.Lockout~4~R6C3~R6C4~R7C4~R7C3~R8C3~R8C4.Lockout~4~R8C5~R8C6~R8C7~R7C6~R6C7~R6C6~R6C5.~R3C1_2~R3C9_8~R5C4_5~R6C1_3~R9C7_9~R9C2_1',
        solution: '563814729489752316271693548627189453148536297395427861934271685752968134816345972',
      },
      {
        name: 'Sudoku Variants Series (013) - Palindrome Sudoku',
        displayName: 'Palindromes',
        src: ['https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=0001WP', 'https://sudokupad.app/0eqtn1ibko'],
        input: '.Palindrome~R7C1~R6C2~R5C1~R4C2~R3C3~R2C4~R1C5~R2C6~R1C7.Palindrome~R9C3~R8C4~R9C5~R8C6~R7C7~R6C8~R5C9~R4C8~R3C9.Palindrome~R7C4~R7C5~R7C6~R6C7~R5C7~R4C7.Palindrome~R3C6~R3C5~R3C4~R4C3~R5C3~R6C3.~R1C1_6~R1C9_5~R2C3_8~R2C5_5~R2C7_9~R4C1_8~R4C5_1~R4C9_3~R5C5_4~R6C5_2~R8C1_9~R8C3_7~R8C7_8~R8C9_2~R9C2_5~R9C8_6',
        solution: '694178235128453976375296481842619753719345628536827149283761594967534812451982367',
      },
      {
        name: 'The Zip that Zips the Zips',
        displayName: 'Zipper lines',
        src: ['https://www.youtube.com/watch?v=qP_oxUzGD5g', 'https://sudokupad.app/k9mm1xgca5'],
        input: '.Zipper~R1C2~R1C1~R2C1~R2C2~R3C2~R3C1~R4C1~R5C1~R4C2.Zipper~R2C3~R1C3~R1C4~R2C4~R3C4.Zipper~R2C6~R3C5~R3C6~R2C7~R1C6~R1C5.Zipper~R9C3~R8C2~R7C1~R6C1~R5C2~R4C3~R4C4~R5C4~R6C3.Zipper~R8C3~R7C3~R6C4~R6C5~R5C5~R4C5~R4C6~R5C6~R6C6~R6C7~R6C8~R6C9.Zipper~R5C7~R5C8~R4C7~R3C7~R2C8.Zipper~R7C5~R7C6~R8C6~R8C7~R7C7~R7C8~R7C9~R8C9~R9C9~R9C8~R9C7~R9C6~R9C5~R8C5.',
        solution: '354897126672451839189632574231564987597328641846719352415973268968245713723186495',
      },
      {
        name: 'Raw Spaghetti',
        displayName: 'Region sum lines',
        src: ['https://www.youtube.com/watch?v=7UZKP82Em14', 'https://sudokupad.app/jsm6fxl03y'],
        input: '.RegionSumLine~R1C2~R2C2~R3C2~R4C2~R5C2.RegionSumLine~R1C3~R2C4~R3C5.RegionSumLine~R6C1~R7C1~R8C1.RegionSumLine~R7C2~R6C3~R5C4~R4C5~R3C6~R2C7~R1C8.RegionSumLine~R2C8~R3C7~R4C6~R5C5~R6C4~R7C3~R8C2.RegionSumLine~R3C8~R4C7~R5C6~R6C5~R7C4~R8C3~R9C2.RegionSumLine~R3C9~R4C8~R5C7~R6C6~R7C5~R8C4~R9C3.RegionSumLine~R5C9~R6C8~R7C7~R8C6~R9C5.',
        solution: '847925163965137284312468579693854712421376895758219346586743921274591638139682457',
      },
      {
        name: '10 Lines',
        displayName: 'Sum lines, with loop',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0009MN',
        input: '.SumLine~10~R1C3~R1C2~R1C1~R2C1~R3C1.SumLine~10~R3C4~R3C3~R3C2~R2C2~R2C3~R1C4.SumLine~10~R1C5~R1C6~R2C6~R3C6.SumLine~10~R1C7~R2C7~R3C7~R3C8~R3C9.SumLine~10~R4C4~R3C5~R4C6~R5C7.SumLine~10~R7C1~R6C1~R6C2~R6C3.SumLine~10~R8C2~R7C2~R7C3~R7C4.SumLine~10~R6C6~R7C5~R8C4~R9C3.SumLine~10~R9C5~R9C6~R8C6~R7C6.SumLine~10~R8C7~R7C8~R7C9~R6C8~R6C7.SumLine~10~R4C5~R5C6~R6C5~R5C4~LOOP.',
        solution: '582437619136592478479168532768241953925683147341975286297354861814726395653819724',
      },
      {
        name: 'Modular Lines 1',
        displayName: 'Modular lines',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0009I1',
        input: '.Modular~3~R2C5~R2C4~R2C3~R2C2~R3C2~R4C2~R5C2.Modular~3~R7C1~R8C1~R8C2~R7C2.Modular~3~R4C3~R5C3~R6C3~R7C3~R8C3~R9C3~R9C2.Modular~3~R6C4~R5C4~R4C4~R4C5~R4C6~R5C6~R6C6.Modular~3~R5C8~R6C8~R7C8~R8C8~R8C7~R8C6~R8C5.Modular~3~R3C8~R2C8~R2C9~R3C9.Modular~3~R1C9~R1C8~R1C7~R2C7~R3C7~R4C7~R5C7~R6C7.Cage~21~R1C1~R1C2~R2C2~R2C1.Cage~22~R4C1~R5C1~R6C1.Cage~3~R4C4~R4C3.Cage~3~R6C3~R6C4.Cage~10~R6C5~R7C5~R8C5.Cage~22~R2C5~R3C5~R4C5.Cage~7~R4C6~R4C7.Cage~8~R6C6~R6C7.Cage~15~R4C9~R5C9~R6C9.Cage~13~R8C8~R8C9~R9C9~R9C8.',
        solution: '359427168764891523128356974972183456536974812841265397415632789293718645687549231',
      },
      {
        name: 'Entropic connections',
        displayName: 'Entropic lines',
        src: ['https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000EA3', 'https://sudokupad.app/ov06jl2z3j'],
        input: '.Cage~9~R1C1~R2C1.Cage~20~R2C3~R3C3~R3C2.Cage~12~R1C9~R1C8.Cage~15~R2C7~R3C7~R3C8.Cage~20~R7C2~R7C3~R8C3.Cage~10~R9C1~R9C2.Cage~9~R8C9~R9C9.Cage~18~R7C8~R7C7~R8C7.Whisper~5~R9C1~R8C2~R7C3.Whisper~5~R4C2~R5C3~R6C2.Whisper~5~R1C1~R2C2~R3C3.Whisper~5~R7C7~R8C8~R9C9.Entropic~R3C1~R4C1~R5C1~R6C1~R7C1~R8C1.Entropic~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7.Entropic~R2C9~R3C9~R4C9~R5C9~R6C9.Entropic~R9C8~R9C7~R9C6~R9C5~R9C4~R9C3~R9C2.Entropic~R6C8~R5C7~R4C6~R3C5~R2C4~R3C4~R4C4~R5C5~R6C4~R7C4~R8C4.Pair~EAEBEAAQAAAAE~_1%3A3~R2C6~R3C6.',
        solution: '642751839315986427978342561581493276263175948794268153459617382136824795827539614',
      },
      {
        name: '159 Sudoku',
        displayName: 'Indexing',
        src: ['https://www.youtube.com/watch?v=J0OVDew3Hg4', 'https://sudokupad.app/8rrr3nrDqF'],
        input: '.~R2C2_4~R2C3_9~R2C4_7~R1C6_3~R1C8_5~R3C6_5~R3C7_1~R3C8_2~R4C2_2~R4C4_6~R5C3_7~R7C2_6~R7C3_3~R7C4_8~R6C6_8~R5C7_8~R6C8_6~R8C6_9~R8C7_5~R8C8_3~R9C2_7~R9C4_2.Indexing~C~R1C1~R2C1~R3C1~R4C1~R5C1~R6C1~R7C1~R8C1~R9C1~R1C5~R2C5~R3C5~R4C5~R5C5~R6C5~R7C5~R8C5~R9C5~R1C9~R2C9~R3C9~R4C9~R5C9~R6C9~R7C9~R8C9~R9C9',
        solution: '216483957549712683738965124824697315657321849391548762963854271482179536175236498',
      },
      {
        name: 'Slingshot sudoku',
        displayName: 'Slingshot (value indexing)',
        src: 'https://www.reddit.com/r/sudoku/comments/ueeocq/logic_wiz_slingshot_sudoku_rules_and_links_in/',
        input: '.ValueIndexing~R1C4~R2C4~R2C3~R2C2~R2C1.ValueIndexing~R1C6~R2C6~R2C7~R2C8~R2C9.ValueIndexing~R6C9~R7C9~R7C8~R7C7~R7C6~R7C5~R7C4~R7C3~R7C2~R7C1.ValueIndexing~R5C7~R5C8~R6C8~R7C8~R8C8~R9C8.ValueIndexing~R4C7~R4C6~R5C6~R6C6~R7C6~R8C6~R9C6.ValueIndexing~R4C3~R4C4~R5C4~R6C4~R7C4~R8C4~R9C4.ValueIndexing~R5C3~R5C2~R6C2~R7C2~R8C2~R9C2.ValueIndexing~R6C1~R7C1~R7C2~R7C3~R7C4~R7C5~R7C6~R7C7~R7C8~R7C9.~R2C4_3~R2C2_5~R3C3_6~R4C3_9~R6C3_1~R8C2_8~R9C1_2~R9C9_8~R8C8_1~R6C7_3~R4C7_2~R3C7_8~R2C8_2~R2C6_1.V~R7C8~R7C9.V~R7C1~R7C2.V~R4C5~R5C5.X~R5C5~R6C5.X~R4C6~R5C6.X~R4C4~R5C4.X~R2C5~R3C5.X~R1C6~R1C7.X~R1C9~R1C8.X~R1C4~R1C3.X~R1C2~R1C1',
        solution: '372859164854361927916247853769134285538926741421785396147598632683472519295613478',
      },
    ],
  },
  {
    name: 'Cages & sums',
    puzzles: [
      {
        name: 'Killer',
        src: 'https://en.wikipedia.org/wiki/Killer_sudoku#/media/File:Killersudoku_color.svg',
        input: '.Cage~3~R1C1~R1C2.Cage~15~R1C3~R1C4~R1C5.Cage~25~R2C1~R2C2~R3C1~R3C2.Cage~17~R2C3~R2C4.Cage~9~R3C3~R3C4~R4C4.Cage~22~R1C6~R2C5~R2C6~R3C5.Cage~4~R1C7~R2C7.Cage~16~R1C8~R2C8.Cage~15~R1C9~R2C9~R3C9~R4C9.Cage~20~R3C7~R3C8~R4C7.Cage~8~R3C6~R4C6~R5C6.Cage~17~R4C5~R5C5~R6C5.Cage~20~R5C4~R6C4~R7C4.Cage~14~R4C2~R4C3.Cage~6~R4C1~R5C1.Cage~13~R5C2~R5C3~R6C2.Cage~6~R6C3~R7C2~R7C3.Cage~17~R4C8~R5C7~R5C8.Cage~27~R6C1~R7C1~R8C1~R9C1.Cage~8~R8C2~R9C2.Cage~16~R8C3~R9C3.Cage~10~R7C5~R8C4~R8C5~R9C4.Cage~12~R5C9~R6C9.Cage~6~R6C7~R6C8.Cage~20~R6C6~R7C6~R7C7.Cage~15~R8C6~R8C7.Cage~14~R7C8~R7C9~R8C8~R8C9.Cage~13~R9C5~R9C6~R9C7.Cage~17~R9C8~R9C9',
        solution: '215647398368952174794381652586274931142593867973816425821739546659428713437165289',
      },
      {
        name: 'Killing with flowers',
        displayName: 'Killer, hard',
        src: 'http://forum.enjoysudoku.com/killing-with-flowers-t36181-15.html#p279032',
        input: 'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<',
        solution: '283197546967542813415368729591726384876439152324851967149275638752683491638914275',
        constraintTypes: ['Cage'],
      },
      {
        name: 'Normal Lunchbox',
        displayName: 'Lunchbox',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0003H4',
        input: '.Lunchbox~11~R1C2~R1C1~R2C1~R3C1~R4C1.Lunchbox~7~R1C3~R1C4~R1C5~R1C6~R1C7.Lunchbox~4~R1C9~R2C9~R2C8~R3C8~R4C8.Lunchbox~8~R2C7~R2C6~R3C6~R4C6~R5C6.Lunchbox~23~R2C4~R2C3~R3C3~R3C2~R4C2~R5C2.Lunchbox~0~R6C1~R7C1~R7C2~R8C2.Lunchbox~0~R8C4~R8C3~R9C3.Lunchbox~7~R9C6~R9C5~R8C5~R7C5~R7C6~R7C7~R6C7~R6C8.Lunchbox~2~R5C7~R5C8~R5C9.Lunchbox~14~R6C2~R6C3~R6C4~R5C4.Lunchbox~17~R3C5~R4C5~R5C5~R6C5~R6C6.',
        solution: '812436597375912648964785213581243769437569821296871435648397152759124386123658974',
      },
      {
        name: 'Equality cages',
        src: 'https://sudokupad.app/qftcbycmyg',
        input: '.EqualityCage~R1C1~R1C2~R2C2~R2C1.EqualityCage~R3C2~R3C3.EqualityCage~R4C2~R4C3~R5C3~R5C2.EqualityCage~R9C2~R9C3~R8C3~R8C4.EqualityCage~R4C4~R4C5~R5C5~R5C6.EqualityCage~R3C4~R3C5~R3C6~R3C7.EqualityCage~R2C6~R2C7~R2C8~R2C9.EqualityCage~R3C8~R3C9.EqualityCage~R6C9~R7C9.EqualityCage~R7C7~R7C8~R8C8~R8C7.~R3C2_4~R3C8_7.BlackDot~R4C1~R4C2~R8C1~R9C1~R7C6~R8C6~R8C7.BlackDot~R6C6~R6C7~R9C3~R9C2~R8C5~R9C5.WhiteDot~R8C1~R8C2~R1C7~R1C6~R7C7~R7C8.V~R2C7~R2C8~R2C2~R2C1~R8C3~R9C3',
        solution: '781492356326578149549631872634825917298317564175964283917256438452783691863149725',
      },
      {
        name: '6x6: Rellik cages',
        src: 'https://sudokupad.app/adventure/480-rellik',
        input: '.Shape~6x6.RellikCage~5~R1C3~R2C3~R2C2.RellikCage~9~R1C2~R1C1~R2C1.RellikCage~6~R1C4~R2C4~R2C5.RellikCage~4~R3C3~R3C4.RellikCage~4~R4C3~R5C3~R6C3~R5C2.RellikCage~7~R5C1~R6C1~R6C2.RellikCage~5~R6C4~R6C5~R6C6.RellikCage~3~R5C4~R5C5~R5C6~R4C6.RellikCage~8~R1C5~R1C6~R2C6~R3C6',
        solution: '213564564321641235325146136452452613',
      },
      {
        name: 'Neighbor Sums',
        displayName: 'Sum cages',
        src: ['https://www.youtube.com/watch?v=gxuYWm8Unss', 'https://tinyurl.com/59b9nba9'],
        input: '.Sum~3~R1C5~R1C6 .Sum~4~R2C6~R1C6 .Sum~5~R2C7~R2C6 .Sum~3~R3C7~R2C7 .Sum~4~R3C8~R3C7 .Sum~5~R4C8~R3C8 .Sum~3~R4C9~R4C8 .Sum~4~R5C9~R4C9 .Sum~5~R6C1~R5C1 .Sum~7~R6C1~R6C2 .Sum~6~R6C2~R7C2 .Sum~5~R7C3~R7C2 .Sum~7~R8C3~R7C3 .Sum~6~R8C4~R8C3 .Sum~5~R8C4~R9C4 .Sum~7~R9C5~R9C4 .Sum~10~R2C4~R3C4 .Sum~11~R3C4~R3C5 .Sum~10~R4C5~R3C5 .Sum~11~R4C5~R4C6 .Sum~12~R4C6~R5C6 .Sum~10~R5C7~R5C6 .Sum~11~R6C7~R5C7 .Sum~12~R6C8~R6C7 .Sum~15~R6C4~R6C5 .Sum~14~R6C5~R7C5 .Sum~14~R5C4~R6C4 .Sum~13~R5C3~R5C4 .Sum~15~R7C6~R7C5 .Sum~13~R8C6~R7C6 .Sum~14~R4C3~R5C3 .Sum~15~R4C3~R4C2 .Sum~13~R6C9~R7C9 .Sum~9~R7C8~R7C9 .Sum~5~R7C8~R8C8 .Sum~4~R8C8~R8C7 .Sum~11~R9C7~R8C7 .Sum~17~R9C6~R9C7 .Sum~13~R3C1~R4C1 .Sum~14~R3C2~R3C1 .Sum~11~R2C2~R3C2 .Sum~12~R2C2~R2C3 .Sum~16~R1C3~R2C3 .Sum~17~R1C4~R1C3',
        solution: '439821756157693284862475139596738421278514693341962578623187945984256317715349862',
      },
      {
        name: 'Arrow',
        src: 'https://sugarroad.blogspot.com/search/label/sudoku',
        input: '.Arrow~R1C5~R2C4~R3C3~R4C2~R5C1.Arrow~R3C7~R2C6~R3C5~R4C4~R5C3.Arrow~R6C2~R7C3~R6C4~R5C5~R4C6.Arrow~R7C4~R7C5~R7C6.Arrow~R6C7~R5C7~R4C7.Arrow~R5C9~R6C8~R7C7~R8C6~R9C5.~R1C2_6~R1C9_9~R2C1_9~R8C9_3~R9C1_4~R9C8_7',
        solution: '167584329985362417342719856718293645253647198694158732571936284829471563436825971',
      },
      {
        name: 'Double arrow',
        src: 'https://sudokupad.app/v2m1f8gtlp',
        input: '.DoubleArrow~R1C4~R1C5~R1C6~R1C7.DoubleArrow~R2C3~R2C4~R2C5~R2C6.DoubleArrow~R3C2~R3C3~R3C4~R3C5.DoubleArrow~R4C1~R4C2~R4C3~R4C4.DoubleArrow~R4C5~R5C5~R6C5.DoubleArrow~R6C6~R6C7~R6C8~R6C9.DoubleArrow~R7C5~R7C6~R7C7~R7C8.DoubleArrow~R8C4~R8C5~R8C6~R8C7.DoubleArrow~R9C3~R9C4~R9C5~R9C6.~R9C1_3~R4C1_1~R4C4_5~R3C2_2~R2C3_3~R1C4_4~R1C7_8~R2C6_7~R3C5_6~R6C6_9~R6C9_1~R7C5_8~R8C4_7~R9C3_6~R9C6_4~R8C7_4~R7C8_1',
        solution: '561493872493827165827165943142538697689271354735649281954382716218756439376914528',
      },
      {
        name: 'Pill Arrow Sudoku',
        displayName: 'Pill arrow',
        src: ['https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0007D1', 'https://sudokupad.app/k672pxo3r9'],
        input: '.PillArrow~2~R1C3~R1C2~R1C1~R2C1~R3C1.PillArrow~2~R1C8~R1C7~R1C6~R1C5~R1C4.PillArrow~2~R2C7~R2C6~R2C5~R2C4~R2C3.PillArrow~2~R4C1~R5C1~R6C1~R7C1~R8C1.PillArrow~2~R3C2~R4C2~R5C2~R6C2~R7C2.PillArrow~2~R9C1~R9C2~R9C3~R9C4~R9C5.PillArrow~2~R5C9~R4C9~R3C9~R2C9~R1C9.PillArrow~2~R8C6~R9C6~R9C7~R9C8~R9C9.Arrow~R3C3~R4C4~R5C5.Arrow~R7C3~R6C4~R5C5~R4C6.Arrow~R3C8~R4C7.',
        solution: '514896237679231485328745196235684971491327658786159342967418523853962714142573869',
      },
      {
        name: 'Magic square',
        src: ['https://www.youtube.com/watch?v=hAyZ9K2EBF0', 'https://sudokupad.app/2QM8JHJ4HB'],
        input: '.AntiKnight.Diagonal~1.Diagonal~-1.EqualSum~R4C4~R4C5~R4C6~-~R5C4~R5C5~R5C6~-~R6C4~R6C5~R6C6~-~R4C4~R5C4~R6C4~-~R4C5~R5C5~R6C5~-~R4C6~R5C6~R6C6~-~R4C4~R5C5~R6C6~-~R4C6~R5C5~R6C4.~R4C1_3~R4C2_8~R4C3_4~R9C9_2',
        solution: '843567219275913846619428375384672951726159483951834627537286194462791538198345762',
      },
      {
        name: 'Look-and-Say Killer',
        displayName: 'Look-and-say',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0007CP',
        input: '.LookAndSay~1617~R3C1~R2C1~R1C1.LookAndSay~1324~R1C3~R2C3~R2C4~R1C4.LookAndSay~11~R1C7~R1C8.LookAndSay~1913~R2C9~R2C8~R3C8~R3C7~R3C6.LookAndSay~3518~R3C9~R4C9~R5C9~R5C8~R5C7~R6C7~R6C6.LookAndSay~1112~R7C9~R7C8~R8C8~R8C7~R9C7.LookAndSay~2311~R7C4~R8C4~R8C3~R8C2~R7C2.LookAndSay~26~R7C5~R6C5~R6C4~R5C4.LookAndSay~2113~R6C2~R6C1~R7C1.LookAndSay~28~R7C7~R7C6~R8C6~R9C6.LookAndSay~1422~R5C5~R4C5~R4C4~R4C3.LookAndSay~39~R5C1~R6C2~R7C3~R8C4~R9C5.LookAndSay~26~R6C9~R7C8~R8C7~R9C6.',
        solution: '893456712654217983721839465562741398948623571317985246179362854435178629286594137',
      },
      {
        name: 'Quadruple X',
        src: ['https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=00040T', 'https://sudokupad.app/20mp1nw1lh'],
        input: '.Diagonal~1.Diagonal~-1..Quad~R1C1~1~4~6~7.Quad~R5C1~2~3.Quad~R6C1~1~2.Quad~R3C3~1~2~4~8.Quad~R6C3~3~5~8~9.Quad~R2C4~6~7.Quad~R7C5~3~6.Quad~R3C6~4~5~8~9.Quad~R6C6~2~3~6~7.Quad~R3C8~1~2.Quad~R4C8~1~5.Quad~R8C8~2~3~4~5',
        solution: '762384591415729368398165427654278913837691245129543786543812679971436852286957134',
      },
      {
        name: 'Clockwork',
        displayName: 'Counting circles',
        src: ['https://www.youtube.com/watch?v=J_3SltyIJ1I', 'https://sudokupad.app/QbPRdNNRMH'],
        input: '.CountingCircles~R1C1~R1C5~R1C9~R2C7~R2C3~R3C2~R3C8~R4C6~R4C7~R4C4~R5C1~R5C2~R6C3~R6C4~R6C6~R7C8~R8C7~R9C9~R9C5~R7C2~R8C3~R9C1~R5C8.~R1C5_1~R2C8_2~R2C2_8~R5C9_3~R5C1_7~R8C2_6~R9C5_5~R7C3_8~R6C5_9~R7C7_2~R8C6_1~R8C8_4',
        solution: '623514897584379621971268354219436785745182963836795412158643279367921548492857136',
      },
    ],
  },
  {
    name: 'Dots & pairs',
    puzzles: [
      {
        name: 'XV Kropki Sudoku',
        displayName: 'XV & kropki',
        src: ['https://www.youtube.com/watch?v=TT-6BfDeCdc', 'https://sudokupad.app/LTR8GR7D84'],
        input: '.X~R2C1~R2C2.X~R3C1~R3C2.X~R1C8~R1C7.X~R2C7~R2C8.X~R7C8~R8C8.X~R7C9~R8C9.X~R8C3~R9C3.X~R8C2~R9C2.X~R5C4~R5C5.V~R8C2~R8C3.V~R8C8~R8C9.V~R2C1~R3C1.V~R1C7~R2C7.BlackDot~R2C5~R2C6.BlackDot~R4C6~R5C6.BlackDot~R5C6~R6C6.BlackDot~R3C1~R4C1.WhiteDot~R3C3~R3C2.WhiteDot~R4C3~R5C3.WhiteDot~R8C4~R8C5.WhiteDot~R8C6~R8C7.WhiteDot~R5C2~R6C2',
        solution: '195287463284536197376149825657912384918374256423658719532461978741895632869723541',
      },
      {
        name: 'Merry X/V-mas',
        displayName: 'Strict XV',
        src: ['https://www.youtube.com/watch?v=VL6qPIWAmBs', 'https://sudokupad.app/gtbtt6llob'],
        input: '.StrictXV .Whisper~5~R1C1~R2C2~R3C3 .Whisper~5~R3C1~R2C2~R1C3 .Whisper~5~R6C2~R5C2~R4C2~R5C3~R4C4~R5C4~R6C4 .Whisper~5~R6C7~R5C7~R6C6~R5C5~R4C6~R5C7 .Whisper~5~R6C9~R6C8~R7C8~R8C9~R9C8~R8C7 .Whisper~5~R1C5~R2C6~R3C7~R2C7~R1C8',
        solution: '162795483897134256354862971429317568578926134613458792936271845781543629245689317',
      },
      {
        name: 'Fortress',
        src: 'https://sudokupad.app/N7fqrL2gtD',
        input: '.~R1C1_4~R1C4_1~R1C6_2~R3C6_4~R3C4_3~R4C3_8~R6C1_7~R7C4_6~R7C6_7~R9C6_9~R9C4_8~R9C9_2~R6C9_3~R4C7_1~R3C7_7.GreaterThan~R1C8~R2C8~R1C7~R1C9.GreaterThan~R2C5~R2C4~R1C5~R2C6~R3C5.GreaterThan~R5C8~R4C8~R5C9~R6C8~R5C7.GreaterThan~R4C5~R3C5~R4C4~R4C6~R5C5.GreaterThan~R6C5~R5C5~R6C4~R6C6~R7C5.GreaterThan~R8C5~R7C5~R8C4~R8C6~R9C5.GreaterThan~R9C2~R8C2~R9C1~R9C3.GreaterThan~R5C2~R5C1~R4C2~R5C3~R6C2.GreaterThan~R4C1~R4C2~R3C1~R5C1',
        solution: '437182596681795324295364718328576149164938275759241863843627951912453687576819432',
      },
      {
        name: 'Dutch Flat Mates (Kropki)',
        displayName: 'Dutch flatmates',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=000FYS',
        input: '.DutchFlatmates.BlackDot~R5C1~R6C1.BlackDot~R6C1~R7C1.BlackDot~R7C1~R8C1.BlackDot~R4C2~R4C3.BlackDot~R2C5~R3C5.BlackDot~R3C7~R4C7.BlackDot~R4C8~R4C9.BlackDot~R5C9~R6C9.BlackDot~R6C9~R7C9.BlackDot~R7C9~R8C9.BlackDot~R7C7~R7C8.WhiteDot~R8C7~R9C7.WhiteDot~R9C5~R9C4.WhiteDot~R9C3~R9C4.WhiteDot~R5C3~R6C3.WhiteDot~R5C1~R5C2.WhiteDot~R4C4~R4C5.WhiteDot~R2C2~R3C2.WhiteDot~R1C3~R1C4.WhiteDot~R1C7~R1C8.WhiteDot~R1C8~R1C9',
        solution: '618792345352864719947531826721985463896243571435617982279158634163479258584326197',
      },
    ],
  },
  {
    name: 'Outside clues',
    puzzles: [
      {
        name: 'Little Killer Sudoku',
        displayName: 'Little killer',
        src: ['https://www.youtube.com/watch?v=y4eKdI3ZJ78', 'https://sudokupad.app/nQHjr7Ggpg'],
        input: '.~R3C2_5~R3C7_2~R5C4_3~R5C5_7.LittleKiller~22~R1C1.LittleKiller~28~R2C1.LittleKiller~26~R3C1.LittleKiller~23~R1C5.LittleKiller~34~R1C7.LittleKiller~40~R1C8.LittleKiller~42~R1C9',
        solution: '198235764427968531653714289732186945541379826986542173865421397279653418314897652',
      },
      {
        name: 'The Barbed Cross',
        displayName: 'Disjoint little killer',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=0006TM',
        input: '.DisjointSets.LittleKiller~62~R1C9.LittleKiller~33~R1C1.LittleKiller~12~R1C3.LittleKiller~14~R3C9.LittleKiller~21~R9C7.LittleKiller~36~R9C5.LittleKiller~8~R7C1.LittleKiller~9~R1C2.',
        solution: '325784169719625483684319725843297651592861347167543298478932516236158974951476832',
      },
      {
        name: 'Between 1 and 9 Sudoku',
        displayName: 'Sandwich',
        src: ['https://www.youtube.com/watch?v=2wfR6QIvNn4&t=4s', 'https://sudokupad.app/p8fFp3hT96'],
        input: '.Sandwich~8~C1.Sandwich~4~C2.Sandwich~17~C3.Sandwich~35~C4.Sandwich~14~C5.Sandwich~13~C6.Sandwich~3~C7.Sandwich~10~C8.Sandwich~25~C9.Sandwich~4~R1.Sandwich~33~R2.Sandwich~20~R3.Sandwich~17~R4.Sandwich~26~R5.Sandwich~10~R6.Sandwich~16~R7.Sandwich~24~R8.Sandwich~0~R9.~R3C3_1~R5C5_5~R7C7_9',
        solution: '236941875954378612871625439182439756397856124645217398413562987569783241728194563',
      },
      {
        name: 'Skyscraper',
        src: ['https://www.youtube.com/watch?v=rLlZA5ZND00', 'https://sudokupad.app/mMFtMNMMqg'],
        input: '.~R1C1_1~R1C6_2~R1C9_8~R3C1_3~R3C4_6~R3C7_4~R5C1_5~R5C3_2~R5C6_3~R7C1_7~R7C4_8~R7C7_2~R9C9_6~R9C6_4~R9C1_9.Skyscraper~C5~5.Skyscraper~R2~2.Skyscraper~R4~4.Skyscraper~R6~6.Skyscraper~R8~8',
        solution: '147932658826145937359678412678419325592783164413256789765891243234567891981324576',
      },
      {
        name: 'X-Sum',
        src: ['https://www.youtube.com/watch?v=fnCzYnsC4Ow', 'https://sudokupad.app/PtjJbFhttP'],
        input: '.XSum~C2~27~27.XSum~C4~11~11.XSum~C6~21~.XSum~C7~16~16.XSum~R2~8~8.XSum~R4~17~17.XSum~R6~30~30.XSum~R8~28~28.',
        solution: '856214379341975862792863541417529683985631724623487195274156938539748216168392457',
      },
      {
        name: 'DSM 2023 Leftover: Full Rank Sudoku',
        displayName: 'Full rank',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=000EDA',
        input: '.FullRank~C2~26~.FullRank~C4~32~.FullRank~C6~6~.FullRank~C8~35~.FullRank~R1~17~.FullRank~R3~13~.FullRank~R5~10~.FullRank~R7~21~.FullRank~C3~~12.FullRank~C5~~19.FullRank~C7~~2.FullRank~C9~~14.FullRank~R8~~23.FullRank~R6~~20.FullRank~R4~~34.FullRank~R2~~11.',
        solution: '576832491829514763431769852768125349354698217192473685615347928247981536983256174',
      },
      {
        name: '6x6: Numbered rooms',
        src: 'https://discord.com/channels/709370620642852885/721090566481510732/1253331176685568112',
        input: '.NumberedRoom~C1~1~6.NumberedRoom~R1~1~6.NumberedRoom~C2~6~1.NumberedRoom~C3~1~3.NumberedRoom~C4~6~6.NumberedRoom~C5~3~1.NumberedRoom~C6~3~6.NumberedRoom~R2~3~1.NumberedRoom~R4~3~6.NumberedRoom~R5~3~1.NumberedRoom~R6~3~6.NumberedRoom~R3~1~3..Shape~6x6',
        solution: '143562625143351426462315234651516234',
      },
    ],
  },
  {
    name: 'Global & layout',
    puzzles: [
      {
        name: 'Sudoku X',
        src: 'http://forum.enjoysudoku.com/the-hardest-sudokus-new-thread-t6539-645.html',
        input: '.Diagonal~1.Diagonal~-1.~R1C3_1~R1C7_2~R2C3_2~R2C4_3~R2C9_4~R3C1_4~R4C1_5~R4C3_3~R4C8_6~R5C2_1~R5C9_5~R6C3_6~R7C5_7~R7C6_8~R8C5_9~R9C2_7~R9C6_1~R9C8_9',
        solution: '681945237792316584435827619523784961817639425946152873369478152158293746274561398',
      },
      {
        name: 'X-Windoku',
        src: 'http://forum.enjoysudoku.com/x-sudoku-extreme-t34714-30.html?hilit=windoku#p309418',
        input: '.Diagonal~1.Diagonal~-1.Windoku.~R1C8_1~R2C5_2~R2C9_3~R4C1_4~R4C6_3~R5C5_5~R5C9_6~R6C5_1~R7C6_7~R7C7_8~R8C5_6~R9C5_3~R9C6_2',
        solution: '932674518678521943541398267469283751217459386853716429326147895794865132185932674',
      },
      {
        name: 'I just like colours',
        displayName: 'Anti-everything',
        src: ['https://www.youtube.com/watch?v=WcxLHy4Wfuw', 'https://sudokupad.app/5vtqvi9v5y'],
        input: '.AntiKing .AntiKnight .AntiConsecutive .BlackDot~R2C2~R2C3 .BlackDot~R3C5~R3C6 .BlackDot~R1C8~R1C9 .BlackDot~R2C7~R3C7 .BlackDot~R4C5~R5C5 .BlackDot~R5C3~R5C4 .BlackDot~R1C4~R2C4 .BlackDot~R6C1~R7C1 .BlackDot~R7C1~R7C2 .BlackDot~R8C4~R8C5 .BlackDot~R7C6~R8C6 .BlackDot~R6C6~R6C7 .BlackDot~R5C8~R6C8 .BlackDot~R3C9~R4C9 .BlackDot~R8C9~R9C9 .BlackDot~R9C7~R9C8 .StrictKropki',
        solution: '372615948948372615615948372837261594594837261261594837483726159159483726726159483',
      },
      {
        name: 'Anti-Taxi Sudoku X',
        displayName: 'Anti-taxicab',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0003OG',
        input: '.Diagonal~1.Diagonal~-1.AntiTaxicab.~R1C1_2~R2C1_3~R1C3_4~R2C3_1~R4C4_1~R5C2_2~R5C1_4~R7C1_6~R7C3_9~R9C2_4~R9C5_3~R8C6_4~R6C6_9~R1C6_1~R1C5_8~R2C5_9~R4C8_8~R7C9_7',
        solution: '264581793351697248798423165975146382426378951813259674639815427182764539547932816',
      },
      {
        name: '[New Constraint] Entropy Sudoku',
        displayName: 'Global entropy',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0008G7',
        input: '.~R1C1_8~R1C9_7~R3C4_9~R3C6_5~R4C6_8~R4C4_6~R4C3_5~R6C3_6~R6C4_1~R7C4_7~R7C6_3~R6C6_9~R6C7_4~R4C7_9~R9C9_4~R9C1_2.GlobalEntropy',
        solution: '891234567534867291672915348315648972948372615726159483459783126183426759267591834',
      },
      {
        name: 'Global mod 3',
        src: 'https://sudokupad.app/l74hg3flzp',
        input: '.GlobalMod.Cage~15~R1C1~R1C2.Cage~6~R1C4~R2C4.Cage~7~R3C1~R4C1.Cage~12~R8C6~R9C6.Cage~8~R8C7~R8C8.X~R1C7~R2C7.X~R5C4~R6C4.X~R5C5~R6C5.X~R8C3~R9C3.V~R4C4~R4C5.V~R5C7~R6C7',
        solution: '879162354621543798435987216387419562196235487254876139943621875518794623762358941',
      },
      {
        name: 'Dutch-pelgänger',
        displayName: 'Doppelganger',
        src: ['https://www.youtube.com/watch?v=1FmCBfKV2hE', 'https://sudokupad.app/t4fevoplnv'],
        input: '.Shape~9x9~0-9 .Doppelganger .Whisper~4~R9C4~R8C5~R7C6 .Whisper~4~R1C3~R2C2~R3C1 .Whisper~4~R7C2~R8C2~R7C3~R7C2 .Whisper~4~R8C7~R9C7~R8C8~R7C7~R8C7 .Whisper~4~R5C9~R6C8~R5C8~R5C9 .Whisper~4~R5C1~R6C1~R6C2~R5C1 .Whisper~4~R2C5~R2C6~R3C6~R2C5 .Whisper~4~R2C9~R3C9~R3C8~R2C9 .Whisper~4~R1C8~R2C7~R1C7~R1C8 .Whisper~4~R7C5~R8C4~R7C4~R7C5 .Whisper~4~R8C6~R9C6~R9C5~R8C6 .Whisper~4~R3C2~R3C3~R2C3~R3C2 .Whisper~4~R1C2~R2C1~R1C1~R1C2 .Whisper~4~R5C6~R6C6~R5C5~R5C6 .Whisper~4~R5C5~R4C4~R5C4~R5C5 .Whisper~4~DGC2~DGC3~DGC4 .Whisper~4~DGR6~DGR7~DGR8 .Whisper~4~DGR5~DGR4~DGR3 .Whisper~4~DGB2~DGB5~DGB4~DGB2',
        solution: '916837042520649831784210659172563480863904715045728396351082967298475103607391524',
      },
    ],
  },
  {
    name: 'Regions & chaos',
    puzzles: [
      {
        name: 'Jigsaw',
        src: ['https://www.youtube.com/watch?v=wuduuLVGKDQ', 'https://sudokupad.app/fTbNFPQ44g'],
        input: '.NoBoxes.Jigsaw~000000021453303021453333221453322221455566121445666111445566667488887777888887777.~R1C1_3~R1C9_7~R2C1_1~R2C9_5~R3C5_6~R3C6_8~R4C3_5~R4C5_1~R4C6_9~R5C4_9~R6C9_2~R7C1_8~R7C6_3~R8C4_2~R8C5_3~R8C6_5~R8C9_1~R9C8_9',
        solution: '364891527189374265542168739625719843213987456937456182876523914498235671751642398',
      },
      {
        name: 'Stretching',
        displayName: 'Chaos construction',
        src: ['https://www.youtube.com/watch?v=jbPgYWIe-n4', 'https://sudokupad.app/dd1oxg0w6b'],
        input: '.NoBoxes .ChaosConstruction .ChaosArrow~R1C1~0~CC1~-~CC1~CC10~CC19~CC28~CC37~CC46~CC55~CC64~CC73 .ChaosArrow~R1C2~0~CC2~-~CC2~CC11~CC20~CC29~CC38~CC47~CC56~CC65~CC74 .ChaosArrow~R1C3~0~CC3~-~CC3~CC12~CC21~CC30~CC39~CC48~CC57~CC66~CC75 .ChaosArrow~R1C4~0~CC4~-~CC4~CC13~CC22~CC31~CC40~CC49~CC58~CC67~CC76 .ChaosArrow~R1C5~0~CC5~-~CC5~CC14~CC23~CC32~CC41~CC50~CC59~CC68~CC77 .ChaosArrow~R1C6~0~CC6~-~CC6~CC15~CC24~CC33~CC42~CC51~CC60~CC69~CC78 .ChaosArrow~R1C7~0~CC7~-~CC7~CC16~CC25~CC34~CC43~CC52~CC61~CC70~CC79 .ChaosArrow~R1C8~0~CC8~-~CC8~CC17~CC26~CC35~CC44~CC53~CC62~CC71~CC80 .ChaosArrow~R1C9~0~CC9~-~CC9~CC18~CC27~CC36~CC45~CC54~CC63~CC72~CC81 .ChaosArrow~R5C4~0~CC40~CC31~CC22~CC13~CC4~-~CC40~CC49~CC58~CC67~CC76 .ChaosArrow~R2C1~0~CC10~CC11~CC12~CC13~CC14~CC15~CC16~CC17~CC18~-~CC10 .ChaosArrow~R2C2~0~CC11~CC12~CC13~CC14~CC15~CC16~CC17~CC18~-~CC11~CC10 .ChaosArrow~R2C5~0~CC14~CC15~CC16~CC17~CC18~-~CC14~CC13~CC12~CC11~CC10 .ChaosArrow~R3C1~0~CC19~CC20~CC21~CC22~CC23~CC24~CC25~CC26~CC27~-~CC19 .ChaosArrow~R5C1~0~CC37~CC38~CC39~CC40~CC41~CC42~CC43~CC44~CC45~-~CC37 .ChaosArrow~R8C5~0~CC68~CC69~CC70~CC71~CC72~-~CC68~CC67~CC66~CC65~CC64 .ChaosArrow~R8C8~0~CC71~CC72~-~CC71~CC70~CC69~CC68~CC67~CC66~CC65~CC64 .ChaosArrow~R9C1~0~CC73~CC74~CC75~CC76~CC77~CC78~CC79~CC80~CC81~-~CC73 .ChaosArrow~R9C6~0~CC78~CC79~CC80~CC81~-~CC78~CC77~CC76~CC75~CC74~CC73 .ChaosArrow~R2C6~0 .ChaosArrow~R3C3~0 .ChaosArrow~R6C4~0 .ChaosArrow~R6C7~0 .ChaosArrow~R8C6~0',
        solution: '624135789139726854245879361961384572357418296872641935713592648486957123598263417',
      },
      {
        name: 'Let there be chaos',
        displayName: 'Chaos counting',
        src: ['https://www.youtube.com/watch?v=uYq9eYSRZRs', 'https://sudokupad.app/qs5gewd34w'],
        input: '.ChaosConstruction .NoBoxes .CountingCircles~R1C1~R2C1~R2C4~R2C5~R3C7~R3C8~R4C3~R4C4~R5C1~R5C2~R5C3~R5C7~R6C5~R6C8~R7C1~R7C7~R7C8~R8C6~R9C2~R9C4~R9C7 .ChaosCount~R1C1~0~CC1~CC2~CC10~CC11 .ChaosCount~R2C1~0~CC10~CC1~CC2~CC11~CC19~CC20 .ChaosCount~R2C4~0~CC13~CC3~CC4~CC5~CC12~CC14~CC21~CC22~CC23 .ChaosCount~R2C5~0~CC14~CC4~CC5~CC6~CC13~CC15~CC22~CC23~CC24 .ChaosCount~R3C7~0~CC25~CC15~CC16~CC17~CC24~CC26~CC33~CC34~CC35 .ChaosCount~R3C8~0~CC26~CC16~CC17~CC18~CC25~CC27~CC34~CC35~CC36 .ChaosCount~R4C3~0~CC30~CC20~CC21~CC22~CC29~CC31~CC38~CC39~CC40 .ChaosCount~R4C4~0~CC31~CC21~CC22~CC23~CC30~CC32~CC39~CC40~CC41 .ChaosCount~R5C1~0~CC37~CC28~CC29~CC38~CC46~CC47 .ChaosCount~R5C2~0~CC38~CC28~CC29~CC30~CC37~CC39~CC46~CC47~CC48 .ChaosCount~R5C3~0~CC39~CC29~CC30~CC31~CC38~CC40~CC47~CC48~CC49 .ChaosCount~R5C7~0~CC43~CC33~CC34~CC35~CC42~CC44~CC51~CC52~CC53 .ChaosCount~R6C5~0~CC50~CC40~CC41~CC42~CC49~CC51~CC58~CC59~CC60 .ChaosCount~R6C8~0~CC53~CC43~CC44~CC45~CC52~CC54~CC61~CC62~CC63 .ChaosCount~R7C1~0~CC55~CC46~CC47~CC56~CC64~CC65 .ChaosCount~R7C7~0~CC61~CC51~CC52~CC53~CC60~CC62~CC69~CC70~CC71 .ChaosCount~R7C8~0~CC62~CC52~CC53~CC54~CC61~CC63~CC70~CC71~CC72 .ChaosCount~R8C6~0~CC69~CC59~CC60~CC61~CC68~CC70~CC77~CC78~CC79 .ChaosCount~R9C2~0~CC74~CC64~CC65~CC66~CC73~CC75 .ChaosCount~R9C4~0~CC76~CC66~CC67~CC68~CC75~CC77 .ChaosCount~R9C7~0~CC79~CC69~CC70~CC71~CC78~CC80 .WhiteDot~R1C3~R1C4 .WhiteDot~R5C5~R5C6 .X~R8C1~R8C2',
        solution: '238946517361754829192863745647532198574198263823471956489615372915287634756329481',
      },
      {
        name: 'Easy as a Quattroquadri',
        displayName: 'Quattroquandri',
        src: ['https://www.youtube.com/watch?v=i4Ru0mdIwsE', 'https://sudokupad.app/z7cztf0wsy'],
        input: '.Shape~6x6~9 .NoBoxes .RegionSize~9 .Jigsaw~001111200101220001233011223333222333 .BlackDot~R2C4~R2C5 .BlackDot~R1C1~R1C2 .BlackDot~R3C3~R3C4 .BlackDot~R5C3~R5C4 .BlackDot~R5C3~R6C3 .BlackDot~R4C6~R5C6 .BlackDot~R4C1~R4C2 .WhiteDot~R4C3~R4C4 .WhiteDot~R5C5~R5C6 .WhiteDot~R5C4~R6C4 .WhiteDot~R2C2~R3C2 .WhiteDot~R3C5~R4C5 .WhiteDot~R5C2~R6C2 .WhiteDot~R1C3~R2C3 .WhiteDot~R4C5~R5C5 .WhiteDot~R4C1~R5C1 .Regex~WzEyNDU3OF0qMy4q~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~~R5C1~R5C2~R5C3~R5C4~R5C5~R5C6~~R6C6~R6C5~R6C4~R6C3~R6C2~R6C1 .Regex~WzEyNDU3OF0qNi4q~R6C1~R5C1~R4C1~R3C1~R2C1~R1C1~~R6C6~R5C6~R4C6~R3C6~R2C6~R1C6 .Regex~WzEyNDU3OF0qOS4q~R1C2~R2C2~R3C2~R4C2~R5C2~R6C2~~R1C6~R1C5~R1C4~R1C3~R1C2~R1C1~~R1C6~R2C6~R3C6~R4C6~R5C6~R6C6',
        solution: '427139798216983675216584352498641357',
      },
      {
        name: 'Clone',
        src: 'https://sudokupad.app/jjmjLT7GqH',
        input: '.SameValues~6~R1C1~R2C8~R3C4~R7C2~R9C5~R8C7.SameValues~6~R9C6~R8C8~R2C9~R3C5~R1C2~R7C3.SameValues~4~R2C1~R8C3~R4C9~R1C6.SameValues~4~R2C6~R3C1~R5C9~R9C3.SameValues~3~R3C9~R6C8~R1C5.SameValues~3~R3C8~R6C7~R1C4.~R2C3_1~R2C5_2~R2C7_3~R5C7_6~R5C8_7~R5C5_5~R5C2_3~R5C3_4~R8C5_8~R8C1_7~R8C9_9',
        solution: '463915827591728346872463591189674235234159678657832914346597182725381469918246753',
      },
    ],
  },
  {
    name: 'Custom & composite',
    puzzles: [
      {
        name: 'Odd/Even Thermo Sudoku',
        displayName: 'Odd-even thermo',
        src: ['https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0003V5', 'https://sudokupad.app/dmax9sth7b'],
        input: '.Pair~UFVQFUAFQAE~_Odd-Even%20Thermo~r1c2~r1c3~r1c4~r1c5~~r1c8~r1c9~r2c9~r3c9~~r2c8~r2c7~~r3c4~r3c3~~r3c2~r4c2~r4c1~~r6c3~r5c3~r5c4~r4c4~~r5c6~r4c6~r4c5~~r6c8~r6c9~r5c9~~r7c2~r7c3~~r7c8~r7c9~r8c9~~r8c2~r9c2~r9c1~~r8c4~r9c4~~r8c5~r9c5~r9c6',
        solution: '613798524298145736457362198971853642384621975562479813139286457726514389845937261',
      },
      {
        name: 'Cold Sauerkraut',
        displayName: 'Nabner thermo',
        src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000EX5',
        input: '.Thermo~R3C2~R3C3~R3C4.Thermo~R3C7~R4C8~R5C7~R6C8.Thermo~R9C6~R8C6~R7C6.Thermo~R7C2~R8C2~R9C2.Thermo~R6C2~R7C3~R6C4~R7C5.WhiteDot~R9C7~R9C8.WhiteDot~R9C9~R9C8.BlackDot~R4C2~R5C2.PairX~8H_xf8H_xf8H_B~_Nabner~R4C1~R5C1~R6C1~R7C2~~R4C4~R5C4~R6C5~R6C6~~R2C4~R3C5~R3C6~R2C7~~R3C8~R4C9~R5C9~R6C9~~R6C8~R7C7~R7C8~R7C9~~R8C9~R8C8~R8C7~R9C6~~R3C2~R4C3~R5C3~R6C3.~R1C8_9',
        solution: '814576293379142586256938174741653829928417365563829741437295618182364957695781432',
      },
      {
        name: 'Regex line',
        src: 'https://sudokupad.app/8fy259rt01',
        input: '.Regex~KFteMS0zXVs0N11bNjldfFs0N10xMjNbNjldKSo~R5C2~R4C1~R3C1~R2C1~R1C1~R1C2~R2C3~R3C3~R4C3~R4C4~R4C5~R4C6~R4C7~R3C7~R2C7~R1C8~R1C9~R2C9~R3C9~R4C9~R5C8~R6C8.Regex~KFteMjU4XS5bMTM0Nl0uWzE0Nl18WzEzNF0uLjUuLlszNDZdKSouPw=~R5C8~R6C9~R7C9~R8C9~R9C9~R9C8~R9C7~R8C7~R7C7~R6C7~R6C6~R6C5~R6C4~R6C3~R7C3~R8C3~R9C3~R9C2~R9C1~R8C1~R7C1~R6C1~R5C2~R4C2.Regex~Lj8oW140N118NDcxKSo~R5C1~R4C1~R3C2~R2C3~R2C4~R2C5~R2C6~R2C7~R3C8~R4C9~R5C9.WhiteDot~R4C6~R5C6',
        solution: '981524376357169824246873951138795462479216538625348197563487219892631745714952683',
      },
      {
        name: 'Sequence sudoku',
        displayName: 'Sequence (state machine)',
        src: 'https://www.reddit.com/r/sudoku/comments/ef278g/sequence_sudoku_oc/',
        input: '.NFA~VgGv_wQgxBRhyCf_RTVW0UUUV_ypZp4Siiiv-UXFHI0UUV_yilH4ISiiv-UUWm680UV_yiilkm3Civ-UUUWqiy0V_yiiill0GCv-UUUUWYaceAACUBCggqQEIAeIEQgkCEwIoAiwIWAigQsgGCAzAChA2gGgg6QHAQ-IHkAUBIghAQGgFKCIxBCAaAJMEJCAUA~_Arithmetic%20series~R7C4~R8C4~R9C4~R9C5~R9C6~R8C6~R7C6~R7C7~~R1C5~R2C4~R3C3~R3C4~~R4C3~R5C2~R5C3~R6C2~R7C1~R7C2~~R3C5~R4C5~R5C5~R6C5~~R4C7~R5C8~R5C7~~R6C8~R7C9~R7C8~~R2C6~R3C7~R3C6.~R7C5_1~R8C5_9~R3C1_1~R3C2_2~R5C9_2~R6C9_4',
        solution: '594631728863572491127984356248163579976845132351729684435218967612397845789456213',
      },
      {
        name: 'Either/Or',
        src: ['https://www.youtube.com/watch?v=j-60lxKeWJI', 'https://tinyurl.com/npamysvs'],
        input: '.Or.~R1C2_1.~R1C1_1.End.Or.~R1C2_2.~R1C3_2.End.Or.~R1C3_3.~R1C4_3.End.Or.~R1C5_4.~R1C4_4.End.Or.~R1C6_5.~R1C5_5.End.Or.~R1C6_6.~R1C7_6.End.Or.~R1C7_7.~R1C8_7.End.Or.~R1C8_8.~R1C9_8.End.Or.~R9C1_1.~R9C2_1.End.Or.~R9C3_2.~R9C2_2.End.Or.~R9C4_3.~R9C3_3.End.Or.~R9C4_4.~R9C5_4.End.Or.~R9C6_5.~R9C5_5.End.Or.~R9C7_6.~R9C6_6.End.Or.~R9C7_7.~R9C8_7.End.Or.~R9C9_8.~R9C8_8.End.Or.~R3C3_3.~R3C2_3.End.Or.~R3C8_9.~R3C9_9.End.Or.~R3C5_6.~R3C6_6.End.Or.~R3C1_4.~R3C2_4.End.Or.~R3C4_7.~R3C5_7.End.Or.~R3C7_1.~R3C8_1.End.Or.~R7C3_5.~R7C4_5.End.Or.~R7C2_6.~R7C3_6.End.Or.~R5C2_6.~R5C3_6.End.Or.~R5C1_4.~R5C2_4.End.Or.~R7C6_4.~R7C7_4.End.Or.~R7C8_3.~R7C7_3.End.Or.~R5C7_3.~R5C8_3.End.Or.~R5C9_7.~R5C8_7.End.Or.~R7C4_7.~R7C5_7.End.Or.~R7C6_1.~R7C5_1.End.Or.~R5C5_3.~R4C5_3.End.Or.~R6C5_8.~R5C5_8.End.Or.~R5C5_9.~R5C6_9.End.Or.~R5C4_2.~R5C5_2.End',
        solution: '912345678657198243438762195281637954546289317379514826865971432794823561123456789',
      },
    ],
  },
  {
    name: 'Other shapes',
    puzzles: [
      {
        name: '16x16',
        src: 'http://forum.enjoysudoku.com/symmertic-16x16-grid-t38266.html#p295157',
        input: '.Shape~16x16 .~R1C4_5~R1C6_9~R1C7_10~R1Cb_2~R1Ce_15~R2C7_16~R2C8_3~R2C9_9~R2Cc_15~R2Cf_1~R2Cg_10~R3C2_13~R3C5_2~R3Ca_14~R3Cd_3~R3Ce_5~R3Cf_12~R3Cg_9~R4C1_12~R4C2_15~R4C7_4~R4C8_7~R4Cd_8~R4Cf_6~R5C1_1~R5C5_3~R5C7_2~R5C8_15~R5Cb_14~R5Cd_10~R5Ce_8~R6C5_1~R6Ca_10~R6Cf_7~R6Cg_16~R7C1_2~R7C4_3~R7C6_16~R7C7_12~R7Cb_8~R7Cc_4~R8C1_7~R8C3_5~R8C4_13~R8C6_10~R8C9_12~R8Ca_15~R9C1_10~R9C2_11~R9C5_9~R9C8_8~R9Ca_2~R9Cb_6~R9Cd_16~R9Ce_13~R9Cg_14~RaC2_7~RaC6_1~RaCb_9~RaCc_13~RbC4_9~RbC5_16~RbC6_13~RbCa_7~RbCd_2~RbCe_11~RbCg_1~RcC3_13~RcC4_6~RcC5_14~RcC9_10~RcCa_11~RcCb_3~RcCg_5~RdC1_5~RdC2_2~RdC4_16~RdCc_12~RdCf_11~RdCg_15~ReC2_4~ReC3_7~ReC9_6~ReCb_1~ReCd_14~RfC2_9~RfC5_12~RfC6_11~RfC8_14~RfCb_13~RfCc_2~RgC4_12~RgC7_7~RgC8_5~RgCd_6~RgCe_2~RgCf_3',
        solution: 'FCPEMIJLAHBGKONDNHKBEFPCILDOMGAJDMJGBOHAKNPFCELILOIAKNDGCMJEHPFBAPDKCEBOGFNIJHMLILNHADKMBJECOFGPBJOCGPLFMAHDENIKGFEMHJNILOKPADBCJKLDIGCHEBFAPMONOGBNJAEKDPIMLCHFHECIPMFDOGLNBKJAPAMFNLOBJKCHGIDEEBHPFCMJNDGLIAKOMDGJOBIPFCAKNLEHCIFOLKANHEMBDJPGKNALDHGEPIOJFBCM',
      },
      {
        name: '16x16: Jigsaw',
        src: 'http://forum.enjoysudoku.com/16x16-jigsaw-sudoku-t38676.html#p300550',
        input: '..E..K..MI....P.K....P....L.MF.B....HM.D....O..FJI.....KG.DB.C.O.OD...NAE.HM.K..........P.I....GIF.HL.B....AC..JCE.P...L.M............I.O...P.HDN..IM....E.PB.DCD....G.P..........A.CI.OHF...JL.E.F.GA.HI.....OKF..N....A.PL....H.PJ.C....M....I.C....MI..K..G.. AAAAABBBBBCDDDDDAAEAABBBBBCDDDDDAAEAAABBFCCDDDDGAAEBBBBFFCCCDDGGHHEEEEEEFCCCIGGGHHHEEEEEFFCCIGGGHHHHEFEFFICCIGGGHHHHHFFFIICCIIGGHJJHJJFFIIIIIIKGJJJJJFFLIIKKKKKGJJJJJJLLLLLKKKKKJMLLLLLLLNLLKKKKMMLMNNNNNNOPPPPKMMMMMNNOOOOOPPPPMMMMNNNOOOOOPPPPMMMNNNNOOOOOPPPP',
        solution: 'OLECFKGBMIJHNDPAKNHADPCEJOLIMFGBGPIBHMADCNEJOLKFJIMLNHFKGPDBECAOBODGPFNAECHMJKILLDNEJOKCPAIFHMBGIFGHLDBMNKOACPEJCEJPABOLDMGKFINHMJCKELIFOBAGPNHDNAKIMJHGLEFPBODCDHBFOGJPKLNCIAMEPKAMCIEOHFBDGJLNEMFDGAPHIJCNLBOKFBONIEDJAGPLKHCMHGPJKCLNBDMOAEFIACLOBNMIFHKEDGJP',
        constraintTypes: ['16x16', 'Jigsaw', 'NoBoxes'],
      },
      {
        name: '6x6',
        src: 'http://forum.enjoysudoku.com/6x6-su-dokus-how-hard-can-they-be-t2053.html',
        input: '.~R1C5_4~R2C2_1~R2C4_3~R2C6_5~R3C4_2~R4C3_3~R5C1_6~R5C3_2~R5C5_5~R6C2_5.Shape~6x6',
        solution: '325146416325541263263514632451154632',
      },
      {
        name: 'Answers on a Postcard',
        displayName: '6x9: Postcard',
        src: ['https://www.youtube.com/watch?v=0HDv7XZzeuw', 'https://sudokupad.app/wxge3tm0qt'],
        input: '.Shape~6x9.Whisper~5~R2C4~R2C5.Whisper~5~R3C5~R4C6~R4C5~R4C4~R5C5.Indexing~C~R1C5~R2C5~R3C5~R4C5~R5C5~R6C5.Indexing~C~R1C1~R2C1~R3C1.AntiKnight',
        solution: '762894135438165729159723864215938647876541293943672581',
      },
    ],
  },
];

export const DISPLAYED_EXAMPLES = DISPLAYED_EXAMPLE_GROUPS.flatMap(
  (group) => group.puzzles);

// Index the puzzles by their name in puzzles.
export const PUZZLE_INDEX = new Map(
  DISPLAYED_EXAMPLES.map(puzzle => [puzzle.name, puzzle]));

const resolveInlineExtraConstraints = (puzzle) => {
  if (!puzzle?.extraConstraints) return puzzle;
  if (typeof puzzle.input !== 'string' || puzzle.input.startsWith('/')) return puzzle;
  return {
    ...puzzle,
    input: puzzle.input + puzzle.extraConstraints,
  };
};

// Resolve a puzzle configuration.
// Supports:
// - Plain objects: treated as full puzzle configs.
// - String names: looked up in PUZZLE_INDEX.
// - Other strings: treated as raw puzzle input.
export const resolvePuzzleConfig = (puzzleCfg) => {
  if (puzzleCfg && typeof puzzleCfg === 'object' && !Array.isArray(puzzleCfg)) {
    return resolveInlineExtraConstraints({ name: puzzleCfg.input, ...puzzleCfg });
  }

  const puzzle = PUZZLE_INDEX.get(puzzleCfg);
  if (puzzle) return resolveInlineExtraConstraints({ name: puzzleCfg, ...puzzle });

  return { name: puzzleCfg, input: puzzleCfg };
};
