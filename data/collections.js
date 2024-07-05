// Sets of puzzles, used for testing, benchmarks, etc.

const SKYSCRAPERS = [
  'Skyscraper',
  'Skyscraper - all 5',
  'Skyscraper - all 6',
  'Renban skyscrapers',
];

const GLOBAL_ENTROPY = [
  'Global entropy',
  'Heat up - global entropy',
  'Miracle - skyscraper entropy',
];

// From https://sudokutheory.com/wiki/index.php?title=Snipes#Thermo
// Also see this thread: 'http://forum.enjoysudoku.com/minimal-futoshiki-sudoshiki-puzzles-t32904-30.html#p322490'
const HARD_THERMOS = [
  {
    input: `
    .Thermo~r1c2~r2c3.Thermo~r3c2~r2c1.Thermo~r4c2~r5c1.Thermo~r6c2~r5c3
    .Thermo~r7c2~r8c3.Thermo~r9c2~r8c1.Thermo~r1c6~r2c6.Thermo~r3c5~r2c4
    .Thermo~r3c5~r2c5.Thermo~r6c5~r5c4.Thermo~r7c5~r8c4.Thermo~r9c6~r8c6
    .Thermo~r1c8~r2c9.Thermo~r3c8~r2c7.Thermo~r4c8~r5c9.Thermo~r6c8~r5c7
    .Thermo~r7c8~r8c9.Thermo~r9c8~r8c7`,
    solution: '953874162816235497472916538265398741794621385138457629387169254529743816641582973',
  },
  {
    input: `
    .Thermo~R1C2~R2C3.Thermo~R3C2~R2C1.Thermo~R4C2~R5C1.Thermo~R6C2~R5C3
    .Thermo~R7C2~R8C1.Thermo~R9C2~R8C3.Thermo~R9C4~R8C4.Thermo~R9C6~R8C5
    .Thermo~R9C7~R8C6.Thermo~R9C8~R8C9.Thermo~R7C8~R8C7.Thermo~R7C6~R7C7
    .Thermo~R6C6~R5C5.Thermo~R6C8~R5C9.Thermo~R4C8~R5C7.Thermo~R3C8~R2C9
    .Thermo~R1C8~R2C7.Thermo~R3C6~R2C5.Thermo~R1C4~R2C4.`,
    solution: '953218746816374529274956381621749835385162497749835162132687954497523618568491273',
  },
  {
    input: `
    .Thermo~R1C2~R2C1.Thermo~R3C2~R2C3.Thermo~R4C2~R5C3.Thermo~R4C3~R5C4
    .Thermo~R6C2~R5C1.Thermo~R7C2~R8C3.Thermo~R9C2~R8C1.Thermo~R9C4~R8C5
    .Thermo~R7C7~R8C6.Thermo~R7C8~R8C7.Thermo~R9C8~R8C9.Thermo~R6C7~R5C6
    .Thermo~R6C8~R5C7.Thermo~R4C8~R5C9.Thermo~R3C8~R2C7.Thermo~R1C8~R2C9
    .Thermo~R1C7~R2C6.Thermo~R3C4~R2C5.Thermo~R6C4~R5C5.`,
    solution: '561798243784263915239541687472916538618352794953487162146825379395174826827639451'
  }
];

const EXTREME_KILLERS = [
  'Wecoc #1',
  'Wecoc #1 mod A',
  'Wecoc #1 mod B',
  'Wecoc #2',
  'tarek unsolvable #41',
];

const HARD_RENBAN = [
  {
    input: '.Renban~R2C1~R1C2.Renban~R3C2~R2C3~R1C4.Renban~R3C4~R2C5~R1C6.Renban~R3C6~R2C7~R1C8.Renban~R2C8~R3C9.Renban~R3C7~R4C8~R5C9.Renban~R3C5~R4C6~R5C7.Renban~R3C3~R4C4~R5C5.Renban~R3C1~R4C2~R5C3.Renban~R6C1~R5C2.Renban~R7C1~R8C2~R9C3.Renban~R7C2~R6C3~R5C4.Renban~R7C3~R8C4~R9C5.Renban~R7C5~R8C6~R9C7.Renban~R7C7~R8C8~R9C9.Renban~R6C8~R7C9.Renban~R7C6~R6C7~R5C8.Renban~R5C6~R6C5~R7C4.~R6C4_1~R4C5_2',
    solution: '521863974387941625469275381953726148176384592842159763215698437638417259794532816',
  },
  {
    input: '.Renban~R2C1~R1C2.Renban~R3C2~R2C3~R1C4.Renban~R3C4~R2C5~R1C6.Renban~R3C6~R2C7~R1C8.Renban~R2C8~R3C9.Renban~R3C7~R4C8~R5C9.Renban~R3C5~R4C6~R5C7.Renban~R3C3~R4C4~R5C5.Renban~R3C1~R4C2~R5C3.Renban~R6C1~R5C2.Renban~R7C1~R8C2~R9C3.Renban~R7C2~R6C3~R5C4.Renban~R7C3~R8C4~R9C5.Renban~R7C5~R8C6~R9C7.Renban~R7C7~R8C8~R9C9.Renban~R6C8~R7C9.Renban~R7C6~R6C7~R5C8.Renban~R5C6~R6C5~R7C4.Thermo~R9C1~R8C1.AntiKing.',
    solution: '827519346396274581145836729531492867982367415764158293259643178618725934473981652',
  },
  {
    input: '.Renban~R2C1~R2C2~R2C3~R3C4~R3C5~R3C6.Renban~R4C1~R3C2~R4C3~R4C4~R5C3~R6C4.Renban~R4C2~R5C2~R6C2~R7C3~R8C3~R9C3~R9C4.Renban~R1C4~R2C4~R1C5.Renban~R1C6~R1C7~R2C7~R3C7~R4C8~R5C8~R6C8.Renban~R6C9~R7C8~R6C7~R6C6~R5C7~R4C6.Renban~R8C9~R8C8~R8C7~R7C6~R7C5~R7C4.Renban~R9C6~R8C6~R9C5.Thermo~R9C2~R8C2.',
    solution: '123564897654789312978231546586412973249357168731896425465978231897123654312645789',
  },
];

const FAST_RENBAN = [
  'Renban',
  'Renban skyscrapers',
];

const NABNER = [
  'Nabner',
  'Nabner thermo',
];

const ZERO_SOLUTION_PUZZLES = [
  '.Renban~R7C2~R8C1~R9C2~R8C3.Renban~R7C5~R8C6~R9C5~R8C4.Renban~R8C7~R9C8~R8C9~R7C8.Renban~R6C8~R5C9~R4C8~R5C7.Renban~R3C2~R2C1~R1C2~R2C3.Renban~R3C5~R2C4~R1C5~R2C6.Renban~R2C7~R1C8~R2C9~R3C8.Renban~R5C4~R4C5~R5C6~R6C5.Renban~R4C2~R5C1~R6C2~R5C3.',
  '.LittleKiller~49~R1C9.LittleKiller~49~R1C8.LittleKiller~49~R9C2.LittleKiller~49~R9C3.LittleKiller~49~R7C9.LittleKiller~49~R1C1.LittleKiller~49~R2C1.LittleKiller~49~R3C1.',
];

const PENCILMARKS = [
  {
    src: 'http://forum.enjoysudoku.com/pencilmark-sudoku-t36694-45.html#p297310',
    input: '123456789.2345678...3456...123456..912345.7.9123456.89123456.89123456789123456.89.234..78..2345678...34.678.123456789123456789123456.89123456789.234.678..2345678..2345678...345678..23456789123456..91234567.9123456.8912345678912.4.67891234567891234567891234567891.34.6..91234.6...1234.678.1234.6.8.12345678912.4.....12345678.1.3456789..34567891.34567891234567891234567891234567891234567891234567891234567891.3456789..345678.1.345678912345678912345678912345678912.456789123456789123456789123456789.234567891234567891234567.9123456789123456.89123456789123456789123456789123456789.2.456789..3456789123456789.23456789123456789123456789123456789.23456789123456789.234567891.3456789123456789123456789123456.891234567891234.678.123456789',
    solution: '124356879356789124789412563213678945697541382548293617832964751465137298971825436',
  },
  {
    src: 'http://forum.enjoysudoku.com/pencilmark-sudoku-t36694-45.html#p286504',
    input: '1.3.5.7.91234567891234567891234567891.3.5.78.1.3.567891.34567..123.56789123456789..345.7.9123456..9.234567891234567.9123456789..345...9123456789.2345.7.912345.7891234567891..4.6..9.2.4.6.8912.456.89123456789.23456789123456.8.12345678912.4.678.12345678912.456.89.2.456.89123456789123456789..34567.9..34567.9.23...789123456789123.5678912...6...12.456.8912.45...91234567891.3456.891234.6.89123.5678912...6789123.5.78.12345678912345678912345.78912345678.1234567891234.6789..3....89123...7891.34567..12345678912345678912345678912345678.1.345678....456...1234567891...5678.12345678912.4.6.89.2.4.6.89.2.4...891234..78912345678912345678912345678912.456789123.567891234.6789.234.678912345.789123...78.123456789..345678..23.56789123456789',
    solution: '123456789456789123798132546215893674364271958879564231531628497682947315947315862',
  },
];

// From the CTC discord, sum constraints which have more than 16 cells.
const LONG_SUMS = [
  {
    'input': '.PillArrow~2~R7C4~R7C5~R8C5~R8C6~R9C6~R9C7~R9C8~R9C9~R8C9~R7C9~R7C8~R6C8~R6C9~R5C9~R5C8~R5C7~R4C7~R4C8~R4C9~R3C9~R3C8~R3C7~R3C6~R2C6~R2C5~R2C4~R3C4~R4C4~R4C3~R5C3~R5C2~R6C2~R7C2~R7C1.AntiKing.',
    'solution': '231869574457321689896475321672198453913547268548236917125984736364712895789653142',
  },
  {
    'input': '.PillArrow~2~R6C5~R5C5~R4C5~R4C4~R5C4~R5C3~R5C2~R6C2~R6C3~R7C3~R7C4~R8C4~R9C4~R9C5~R8C5~R7C5~R7C6~R8C6~R8C7~R7C7~R6C7~R5C7~R5C8~R4C8~R4C9~R3C9~R2C9~R2C8~R3C8~R3C7~R2C7~R2C6~R3C6~R3C5.DisjointSets.',
    'solution': '123465987965873421478921635859316742634297518712584396591638274386742159247159863',
  },
  {
    'input': '.PillArrow~2~R1C9~R1C8~R1C7~R1C6~R1C5~R2C4~R2C3~R2C2~R2C1~R3C1~R4C1~R4C2~R5C2~R5C1~R6C1~R6C2~R7C2~R7C1~R8C1~R8C2~R8C3~R7C3~R7C4~R6C4~R6C3~R5C3~R5C4~R5C5~R6C5~R7C5~R7C6~R6C6~R6C7~R6C8.',
    'solution': '765432198432198765198765432219876543543219876876543219654321987321987654987654321',
  }
];

const INDEXING_PUZZLES = [
  'Indexing',
  {
    'src': 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=000EJJ',
    'input': '.Renban~R1C1~R2C1.Renban~R2C3~R3C3~R4C3.Renban~R6C1~R7C1~R8C1.Renban~R8C3~R9C3.Renban~R9C4~R8C5~R7C5.Renban~R4C6~R4C5~R4C4~R5C4~R6C4~R6C5~R6C6.Renban~R3C5~R2C5~R1C6.Renban~R1C7~R2C7~R3C7.Renban~R6C7~R7C7.Renban~R5C8~R5C9.Renban~R9C9~R8C9~R7C9..Indexing~C~R1C1~R1C2~R1C3~R2C3~R2C2~R2C1~R3C1~R3C2~R3C3~R4C3~R4C2~R4C1~R5C1~R5C2~R5C3~R6C3~R6C2~R6C1~R7C1~R7C2~R7C3~R8C3~R8C2~R8C1~R9C1~R9C2~R9C3',
    'solution': '321984567467152398985637421596713842132498756748265139879546213653821974214379685',
  },
  {
    'src': 'https://app.crackingthecryptic.com/2ng0dky96e',
    'input': '.Cage~12~R1C1~R2C1~R3C1.Cage~12~R3C2~R3C3.Cage~8~R1C5~R1C6.Cage~18~R4C5~R5C5~R6C5.Cage~12~R4C4~R5C4.Cage~6~R4C2~R4C3.Cage~10~R5C1~R5C2.Cage~9~R7C1~R7C2.Cage~11~R9C1~R9C2.Cage~13~R7C4~R8C4~R9C4.Cage~8~R1C8~R2C8.Cage~13~R5C8~R5C9.Cage~17~R7C9~R8C9~R9C9..Indexing~C~R9C9~R8C9~R7C9~R6C9~R5C9~R4C9~R3C9~R2C9~R1C9~R1C5~R2C5~R3C5~R4C5~R5C5~R6C5~R7C5~R8C5~R9C5~R9C1~R8C1~R7C1~R6C1~R5C1~R4C1~R3C1~R2C1~R1C1',
    'solution': '758926134162384957493157862924865371371492685685731429546213798219678543837549216',
  },
  {
    'src': 'https://www.youtube.com/watch?v=R6eWBSTcBOE',
    'input': '.BlackDot~R3C1~R3C2.BlackDot~R2C5~R3C5.BlackDot~R3C8~R3C9.BlackDot~R6C2~R6C1.BlackDot~R7C1~R6C1.BlackDot~R9C2~R9C3.BlackDot~R8C3~R8C4.BlackDot~R8C6~R8C7.BlackDot~R6C7~R6C8.BlackDot~R6C9~R7C9.~R2C7_5.Indexing~R~10~R3C1~R3C2~R2C5~R3C5~R3C8~R3C9~R6C7~R6C8~R6C9~R7C9~R8C7~R8C6~R8C4~R8C3~R9C3~R9C2~R7C1~R6C1~R6C2',
    'solution': '715634892693728541482519763369841257857263419241957638176385924538492176924176385',
  },
  {
    'src': 'https://www.reddit.com/r/sudoku/comments/t5t825/my_second_sudoku_variant_puzzle_a_bit_more/',
    'input': '.Thermo~R3C1~R4C1~R5C1~R6C1~R7C1..Indexing~R~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9~R5C1~R5C2~R5C3~R5C4~R5C5~R5C6~R5C7~R5C8~R5C9~R9C1~R9C2~R9C3~R9C4~R9C5~R9C6~R9C7~R9C8~R9C9.Indexing~C~R1C1~R2C1~R3C1~R4C1~R5C1~R6C1~R7C1~R8C1~R9C1~R1C5~R2C5~R3C5~R4C5~R5C5~R6C5~R7C5~R8C5~R9C5~R1C9~R2C9~R3C9~R4C9~R5C9~R6C9~R7C9~R8C9~R9C9',
    'solution': '934852671675431298218976534341289756582617349796543182829765413453128967167394825',
  },
];

const NUMBERED_ROOMS_PUZZLES = [
  '6x6: Numbered rooms',
  {
    'src': 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000CR0',
    'input': '.Modular~2~R1C2~R2C2~R3C2~R4C2~R5C2~R6C2~R7C2.Modular~2~R1C8~R2C8~R3C8~R4C8~R5C8~R6C8~R7C8.Modular~2~R1C3~R2C4~R1C5~R2C6~R1C7.Modular~2~R5C3~R4C4~R5C5~R4C6~R5C7.Modular~2~R6C3~R7C3~R8C4~R7C5~R6C5.Modular~2~R6C7~R7C7~R8C6~R7C5.NumberedRoom~C1~1~1.NumberedRoom~R1~1~1.NumberedRoom~R4~1~1.NumberedRoom~C9~1~1.NumberedRoom~C3~2~.NumberedRoom~C5~2~.NumberedRoom~C7~2~.NumberedRoom~C4~~8.NumberedRoom~R5~5~9.',
    'solution': '924365871813947526567182934752498163481536792396721485245679318639814257178253649',
  },
  {
    'src': 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000B8L',
    'input': '.NumberedRoom~C1~1~1.NumberedRoom~C2~1~5.NumberedRoom~C3~3~7.NumberedRoom~C4~3~.NumberedRoom~C5~5~.NumberedRoom~R1~4~4.NumberedRoom~R3~8~.NumberedRoom~R4~2~.NumberedRoom~R9~6~6.NumberedRoom~C6~7~.NumberedRoom~C7~7~7.NumberedRoom~C8~9~5.NumberedRoom~C9~9~9.NumberedRoom~R7~~2.NumberedRoom~R6~~8.',
    'solution': '817593642532416879496827513658172394974365281321984765783249156145638927269751438',
  }
];

const FULL_RANK_PUZZLES = [
  'Full rank',
  {
    'src': 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000DHO',
    'input': '.FullRank~C1~33~.FullRank~C2~30~.FullRank~C3~26~.FullRank~C4~24~.FullRank~C5~13~.FullRank~R4~1~.FullRank~R5~17~.FullRank~R6~~36.FullRank~C6~~35.',
    'solution': '987642153621835974345971628179283546568794312234156789852367491496518237713429865',
  },
  {
    'src': 'https://discord.com/channels/709370620642852885/709373384437268530/1249572584211611688',
    'input': '.FullRank~C2~9~.FullRank~C3~1~.FullRank~R6~24~..Shape~6x6',
    'solution': '531246426315342561165432214653653124',
  },
  {
    'src': 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=0001RM',
    'input': '.FullRank~C1~6~20.FullRank~C2~22~9.FullRank~R1~5~11.FullRank~R2~26~8.FullRank~R5~4~18.FullRank~R8~33~3.FullRank~R9~17~27.FullRank~C5~19~13.FullRank~C8~15~7.FullRank~C9~10~25.~R4C5_7~R6C5_3',
    'solution': '268957143715483692349216758652174839183692475497538216871329564924765381536841927',
  },
  {
    'src': 'https://www.youtube.com/watch?v=74G7E0EW3-o',
    'input': '.FullRank~C1~10~23.FullRank~C2~16~34.FullRank~C3~22~27.FullRank~C4~35~2.FullRank~C5~3~12.FullRank~C6~18~32.FullRank~C7~30~5.FullRank~C8~8~17.FullRank~C9~25~15.FullRank~R1~9~26.FullRank~R2~20~4.FullRank~R3~33~19.FullRank~R4~28~6.FullRank~R5~7~11.FullRank~R6~14~31.FullRank~R7~1~36.FullRank~R8~29~21.FullRank~R9~24~13.~R3C4_7~R4C4_8~R5C5_9~R6C6_6~R7C6_4',
    'solution': '346915827572683491918742635763851942281497563459326178135264789824579316697138254',
  },
  {
    // Full rank snipe by sigh: https://sudokutheory.com/wiki/index.php?title=Snipes#Full_Rank
    'src': 'https://discord.com/channels/709370620642852885/721090566481510732/1258800235594125352',
    'input': '.FullRank~R5~17~.FullRank~R4~1~.FullRank~C2~32~.FullRank~C3~28~.FullRank~C4~23~.FullRank~R1~34~.',
    'solution': '987624153654381972231975648179842536568793214423156789845267391396518427712439865',
  }
];

// 1 to 42 from: http://rcbroughton.co.uk/sudoku/forum/viewtopic.php?f=3&t=434#p2453
const TAREK_ALL = [
  'G<<L<K<L<^G>^>^E^^>^IJ<G^<G^>^^I^<>^HC<C^<B^N^^G^<>^>^^E^<DF<^PG^<>^^J<^^<H<<>^>^',
  'G<<M<L<M<^O>^>^C^^>^FF<G^<C^>^^H^<>^FE<E^<C^M^^H^<>^>^^E^<FH<^MH^<>^^L<^^<D<<>^>^',
  'G<<N<J<H<^O>^>^K^^>^GI<A^<L^>^^E^<>^FF<E^<C^I^^E^<>^>^^C^<GH<^QF^<>^^E<^^<J<<>^>^',
  'G<<P<N<H<^N>^>^E^^>^GH<B^<K^>^^I^<>^IC<G^<C^L^^A^<>^>^^C^<EK<^KJ^<>^^I<^^<D<<>^>^',
  'L<<H<N<L<^L>^>^D^^>^BJ<I^<I^>^^G^<>^FF<F^<C^H^^I^<>^>^^I^<FE<^MD^<>^^H<^^<G<<>^>^',
  'L<<Q<J<G<^N>^>^J^^>^C8<H^<F^>^^I^<>^FC<D^<I^L^^H^<>^>^^E^<AG<^PG^<>^^I<^^<G<<>^>^',
  'M<<L<O<F<^J>^>^H^^>^KE<C^<M^>^^I^<>^CC<C^<E^K^^I^<>^>^^E^<FA<^OH^<>^^J<^^<E<<>^>^',
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
  'D<D<IB<9<^N<<^R<<^D^K<^S<^D^^^^^^^^^E<<N0^C<<6R>^KN<MD^^^^^^^^^F^<<^>>^G^<D<^6<>^',
  'H<B<J8<C<^K<<^U<<^7^K<^Q<^G^^^^^^^^^K<<N0^C<<6P>^OM<PB^^^^^^^^^M^<<^>>^9^<9<^9<>^',
  'D<A<GD<I<^S<<^H<<^B^P<^D<^B^^^^^^^F^E<N<<<<^<7^O<KO<NB^F^^^^^^^G^<<^>>^F^<D<^A<>^',
  'D<A<MC<D<^N<<^M<<^A^N<^F<^E^^^^^^^C^G<N<<<<^<7^K<MR<LA^F^^^^^^^L^<<^>>^E^<B<^9<>^',
  'G<9<M9<I<^T<<^J<<^A^G<^G<^9^^^^^^^E^E<T<<<<^<A^M<JK<OD^H^^^^^^^G^<<^>>^E^<9<^B<>^',
  'K<B<GA<A<^Q<<^M<<^8^G<^L<^B^^^^^^^G^E<P<<<<^<7^K<PO<I8^M^^^^^^^E^<<^>>^K^<A<^B<>^',
  'C<C<9C<I<^J<<^O<<^B^R<^Y<^A^^^^>^^^^P<<C<^9<<B^R<^M<QB^>^^L^^^^K<^>^>>^F^^A<^8<>^',
  'C<5<ED<H<^R<<^K<<^C^N<^J<^8^^^^P^^N^I<<>^<>^<B^O<^F<Q9^G^^F^^^^E^<<^>>^I^<D<^8<>^',
  'D<B<EE<B<^R<<^G<<^B^G<^J<^H^^^^P^^I^N<<>^<>^<B^J<^M<R8^I^^D^^^^H^<<^>>^D^<B<^B<>^',
  'E<9<D9<K<^P<<^G<<^C^K<^N<^9^^^^K^^P^K<<>^<>^<7^O<^L<K8^K^^I^^^^E^<<^>>^F^<E<^9<>^',
  'H<A<DE<B<^P<<^N<<^A^L<^F<^B^^^^J^^K^P<<>^<>^<9^L<^L<VC^F^^I^^^^C^<<^>>^F^<E<^3<>^',
  'RJJDEPGD<H```````^F````D```D``````9`L````HE``L`L`SJ```C```I````A``B`````^<```````',
  'ORH9GOCG<I```````^I````N```8``````9`I````DA``K`O`OL```C```L````I``3`````^<```````',
  'KNLDDMBC<M```````^J````L```A``````F`I````JF``D`I`IP```E```D````I``C`````^<```````',
  'QQH7IGID<H```````^N````O```8``````8`F````LG``M`S`IG```E```D````D``8`````^<```````',
  'H<S<<K<<LO^<<^<^>^^<R<<<Y^F^O^V>>^^^>^K^<<^>^^P^<<^S^M^^^>>>^>^>^IM<T<<^^>^<^<<^<',
  'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<',
  'M<S<<H<<OM^<<^<^>^^<O<<<N^R^K^X>>^^^>^I^<<^>^^P^<<^I^N^^^>>>^>^>^RU<O<<^^>^<^<<^<',
];

// Hard killers generated using this solver by user Mathemagic:
// http://forum.enjoysudoku.com/the-hardest-killers-t39601.html#p313003
const MATHEMAGIC_KILLERS = [
  'R<<<M<<<U^M<<<^J>^R<<^S<^R^^P>>^>^^^^^<R5^>^MP^>^V<<^^^^^>^L>>^^<^K>^<<R^>>^<>>>^',
  'R<<<M<<<U^M<<<^J>^R<<^S<^R^^O>>^>^^^^^<R6^>^MP^>^V<<^^^^^>^L>>^^<^K>^<<R^>>^<>>>^',
  'S<<<K<<<U^N<<<^K>^P<<^U<^P^^O>>^>^^^^^<Q7^>^NL^>^V<<^^^^^>^N>>^^<^O>^<<P^>>^<>>>^',
  'R<<<M<<<U^M<<<^J>^R<<^S<^Q^^P>>^>^^^^^<R5^>^NP^>^V<<^^^^^>^L>>^^<^K>^<<R^>>^<>>>^',
  'R<<<M<<<U^M<<<^J>^R<<^S<^S^^P>>^>^^^^^<R5^>^LP^>^V<<^^^^^>^L>>^^<^K>^<<R^>>^<>>>^',
  'S<<<K<<<U^N<<<^L>^P<<^U<^O^^O>>^>^^^^^<Q7^>^NL^>^V<<^^^^^>^N>>^^<^O>^<<P^>>^<>>>^',
  'S<<<K<<<V^N<<<^K>^P<<^U<^P^^O>>^>^^^^^<Q7^>^NL^>^V<<^^^^^>^N>>^^<^O>^<<O^>>^<>>>^',
  'S<<<K<<<U^N<<<^K>^P<<^U<^O^^O>>^>^^^^^<Q7^>^NL^>^V<<^^^^^>^N>>^^<^P>^<<P^>>^<>>>^',
  'S<<<K<<<U^O<<<^K>^P<<^U<^P^^O>>^>^^^^^<Q7^>^NL^>^U<<^^^^^>^N>>^^<^O>^<<P^>>^<>>>^',
  'M<<<R<<<N^N<<<^Q>^N<<^O<^S^^L>>^>^^^^^<T6^>^NR^>^R<<^^^^^>^U>>^^<^N>^<<N^>>^<>>>^',
  'S<<<K<<<U^N<<<^K>^P<<^U<^P^^O>>^>^^^^^<Q7^>^NK^>^V<<^^^^^>^O>>^^<^O>^<<P^>>^<>>>^',
  'R<<<P<<<S^L<<<^V>^P<<^K<^M^^Q>>^>^^^^^<R7^>^ML^>^L<<^^^^^>^Q>>^^<^U>^<<Q^>>^<>>>^',
  'M<<<R<<<N^O<<<^Q>^N<<^O<^S^^L>>^>^^^^^<T6^>^NR^>^Q<<^^^^^>^U>>^^<^N>^<<N^>>^<>>>^',
  'M<<<T<<<O^O<<<^R>^N<<^N<^N^^N>>^>^^^^^<U7^>^OO^>^M<<^^^^^>^U>>^^<^R>^<<N^>>^<>>>^',
];

// See http://forum.enjoysudoku.com/human-solvable-zero-t33357.html for
// definition.
const HS_KILLERS = [
  ['3x3:d:k:3841:7705:7705:7705:7705:7705:26:3847:3847:3841:27:3846:3846:3846:7705:4361:3847:3848:3841:3843:4621:4876:28:4361:4361:4619:3848:29:3843:4621:4876:4876:5395:5395:4619:3848:3844:3843:4621:4114:4114:5395:4619:30:3850:3844:4878:4880:31:4114:3605:3605:3850:3850:3844:4878:4880:4880:4372:3350:3605:4632:32:4367:4878:33:4625:4372:3350:3350:4632:4632:4367:4367:4625:4625:4372:34:4375:4375:4375:',
    '875329146312674958469815372146298735253746819798153624687432591521987463934561287'],
  ['3x3:d:k:3587:14:15:16:17:18:19:3586:3586:3587:1543:1543:20:21:22:23:1544:24:25:26:3338:27:28:3337:3337:1544:29:30:31:3338:32:33:34:35:36:37:38:39:40:41:42:43:44:45:46:47:48:49:4365:4365:50:3596:51:52:53:1541:3339:3339:54:55:3596:56:57:58:1541:59:60:61:62:1542:1542:3585:3588:3588:63:64:65:66:67:68:3585:',
    '872314695615972843394586721569241387487635219231897564146758932723469158958123476'],
  ['3x3::k:3595:3595:3844:3844:3090:3336:3336:2575:2575:3595:4620:4620:3348:3090:5:5648:5648:2575:3350:4620:4620:3348:3090:23:5648:5648:3841:3350:2581:24:3348:25:26:27:2579:3841:28:2581:29:30:4625:4625:4625:2579:31:3843:2581:32:33:34:35:36:2579:3335:3843:4878:4878:37:38:39:4618:4618:3335:3341:4878:4878:40:41:42:4618:4618:3593:3341:3341:3334:3334:43:3842:3842:3593:3593:',
    '279648531581739426463251798956483217128975643734162859812597364697324185345816972'],
  ['3x3:d:k:18:4619:4619:4619:8451:3850:3850:3850:19:5388:5388:8451:8451:8451:8451:8451:6671:6671:5388:5388:3076:3076:8451:3333:3333:6671:6671:6414:6414:3076:3076:7937:3333:3333:5904:5904:6414:6414:7937:7937:7937:7937:7937:5904:5904:4109:4109:5382:5382:7937:5895:5895:5137:5137:4109:4109:5382:5382:8194:5895:5895:5137:5137:20:21:8194:8194:8194:8194:8194:22:23:24:4873:4873:4873:8194:4616:4616:4616:25:',
    '527938614439621578681574329872465193914387256365219487256893741793142865148756932'],
  ['3x3:d:k:7707:21:28:4880:4880:4880:29:30:5401:31:7707:3339:3339:5140:3338:3338:5401:32:33:3084:7707:5140:5140:5140:5401:3337:34:5137:3084:7707:7707:5140:2586:5401:3337:6158:5137:3858:3858:3352:3352:3352:2586:2586:6158:5137:3334:3858:3858:4631:4886:4886:3335:6158:35:3334:5139:4631:4631:4886:36:3335:6158:37:5139:3333:3333:4886:3336:3336:38:39:5139:40:41:6927:6927:6927:6927:42:43:',
    '934865127256714983187239465843651279519427638762398541475182396398546712621973854'],
  ['3x3:d:k:9730:9730:9730:9730:9:6150:9987:9987:9987:9730:10:11:12:13:6150:6150:6150:9987:9730:14:15:16:17:6150:18:19:9987:5895:5895:5895:5895:5895:20:6150:21:9987:5895:22:23:24:25:5640:26:8453:8453:9985:27:28:29:5640:30:31:8453:8453:9985:32:33:5640:5640:5640:34:8453:9220:9985:35:36:37:5640:38:39:8453:9220:9985:9985:9985:40:41:9220:9220:9220:9220:',
    '396721845571864239824395617183547926265983471947216583639472158712658394458139762'],
  ['3x3:d:k:6926:6926:6926:7697:7697:7697:6676:6676:6676:6926:6171:797:797:7697:2078:2078:7450:6676:6926:1564:6171:6171:7697:7450:7450:1311:6676:7952:1564:6171:6171:7701:7450:7450:1311:6674:7952:7952:7952:7701:7701:7701:6674:6674:6674:7952:4119:6409:6409:7701:6412:6412:3862:6674:6927:4119:6409:6409:6419:6412:6412:3862:6925:6927:6409:4119:4119:6419:3862:3862:6412:6925:6927:6927:6927:6419:6419:6419:6925:6925:6925:',
    '539827641682145397417396528754268139168739452923451786846572913371984265295613874'],
  ['3x3::k:4369:3849:3849:3849:4111:6918:6918:6918:3858:7434:4369:3849:5141:4111:4111:6918:3858:2841:7434:7434:4369:5141:5141:4111:3858:2841:2841:7434:5910:5910:26:5141:27:28:29:2841:3854:3854:5910:5910:30:31:32:3341:3341:2824:3854:3854:33:7192:34:3341:3341:6924:2824:2824:3860:3600:7192:7192:4371:6924:6924:2824:3860:6919:3600:3600:7192:4363:4371:6924:3860:6919:6919:6919:3600:4363:4363:4363:4371:',
    '621953784873264951954871623746132895198547362532698147215786439369415278487329516'],
  ['3x3:d:k:26:27:3585:3586:3587:3588:4360:5129:5642:28:3585:3586:3587:3588:4360:5129:5642:29:3585:3586:3587:3588:4360:5129:5642:30:31:32:3585:3586:3587:3588:4360:5129:5642:33:2578:2578:2578:34:35:36:4633:4633:4633:37:4632:7191:6934:4373:5396:5651:2577:38:39:40:4632:7191:6934:4373:5396:5651:2577:41:4632:7191:6934:4373:5396:5651:2577:42:4632:7191:6934:4373:43:5396:5651:2577:44:',
    '894637125725418369316259487952143678163872594478965231631784952589321746247596813'],
];

// From https://github.com/t-dillon/pencilmark_sudoku/tree/master/hard
const HARD_PENCILMARKS = [
  '..34..7.91.34567..1.34567.91234567891.3..6...1.34567....3.56.8.1.3..67891234567891234.67891234.67.9123..67891234567891.345678.123456789123456789123..678.12..56.891.345.7.912....7..12345678912345.7.91.34567..1..456789123456789123.5.78912..56789..34.....12345.7...2345678..234567891234567891234567891.3456789.23...7..12345678912345.7.912345678912345.78912345.7891.3456789.2...6.891.345.789123...7891234.67891234567.91234567...2.4567...2.456..9123456789.2.456789..345678.123456789.2.4567.912345678912345678.12..56.8.12345.7891234567..12.4567891.34.....123.5678912.456...12345.7..12345.78.12345678..2345.7.9123456789.2.4567891234567891234567.91234567891.345..891234567891.3456789...45...91.345678912345.789..345...91234567891..456.89',
  '12..5678912.4567..123.56.8912.4...891234567.912.456789.23...78912.4.678912.4....91234567891..456...1234567891.34.6.8.1234567891.34.6.891234567891.3456.8.123456789.2..567..123456789.23.5.7.912345678912..5.7.91.3456789.23.5.78912345678912345.78912.....89123.56789123.5678912345678912..567.91.3456789123.5.78912.45678912.45..8912345678912345678912345.789.2345.7.9.2345...91234567.91234567891..45....12345....1234567891.34.6.8..234.6.8..23456789.234567....34567.9.234.678.12345678.123456.8.1234567891..456...1.3456..912345678.12.45....12345678912345678912.4567..12.4567.9....56..91.3456789..345678.123456789123456789...45.7891234567891..4567.....45.7..123..67891.34567891234567891234..78912345678912345.789123..678912.4567891234..789',
  '123456789123456789.2345.789.2.4567891.345..891234.678...3.56789..3.56.8912345678912.456..912.45.78912.45.78912.45.7891..4...8.12.4567.9123456789123.56.891234567891.3.56...1234567.91234567891234567891234....91234.67..123.56789123456789.23.5....12345678.12345.789.2.45.78..2..5.78.123.56789.2345678.1.3.567891.3456789123.5.7..1234567891..45.7...2.45.7.9.2..5678912345678912.4567..1.....7891234567891234567891.3.567891.34567.9123456789123.567891.3..6.891234567891.3.56.891.3..6..91234567891.3456.8.1..4.678.123456789.2.45678.12345678.1.34567.....45.78.123456.8912345678.1234567891.3..67.9.234.678912345678912345.789.23..67...23.567891234.67.91234567.91.3.56.891.3456789123456.8912345678912345..8912345678.12345678912.4...8912.45..8.',
  '123456.89.2.4.67...234...891.345.78.123456789123456789.2.4.67891234.67891234567891.34.6.89123456789..34.6.891.34567891234567891.3456.89123456789.234.6.891234567.91.345678912345678.1234567891.3...7..1234567..12345.789123.567.912345678912345.7..12345678912.456789.234.6789123456789.2.4.67.9.2345678912.4.67891234.67891234..7..1...56..91..4567..1234567891.3456789.2.4567.91234567891234567891234.6.891234567891...56..9123456789123456.89123.56789.23456789..3.56.89123..6.89123....8.1234567891.3.56.8912.456789123456789123456789.2...6..91234567891...56.89123.5..891234567891234567891...5.78.12345.78912.45.78.12.45678912345678912345678912..5..8.12345..8.1.34567891234.6789.234..789123..6789.2.4.67...2345678912345678912345678912345.7..',
  '1.3.56789123456789123456789.234.6.89.2345..89.23456789.23456789123456789.234...891234567891...567..12..567.912345678912345678..2.4567.9123.5678.1234567..1234567891.3.567.91...5678.1...56..9123..6789123.567891234567891.3.5678.123456789123.5.789123.56789123.56789123456789.23..6.8.123456789123456789.23..678.123456789.23..67891.345..89123456789123456.891234.6.891.345..8.123456789123456789123456.8.123....891..45...91..45678912.456..91.34567891234567891..45.7.9....567891.34567..12345678912345.789.23.5.78.1234567.91.3..6.8.123456.891234.6789123..678912345678912...6.89123456789123456789.2..5...9123456789123456..91..4567.91234567891234567.91234567891.345.789...45.78..2345...91234..7891.345..8.1.345.7891234567891234567891234...89',
  '1.......91234567891.3.56.891234567891..45..89123456.891...567891234567891234567891.345...912345.789123456.8912345678.12345678..234...89123456789.2345.7.9.234567..1234567.9123456789123.567.912..5678.1234567.9123456789123.567..12345.7.9..3.567..123456789.234..789.23456789123456789123456789.2.4..7891234..789.2.4....9123456789123456789.23...789.23.56789123.56789123456789.23...789123...7891234..7.91234567891..456.891234567891234567.91...5678.1..4567..123456789123456789123456789123456...1.3456.891234567891234567891....678.1.3.567.91234567891...56789123456789123.56789123456789.234..78.12345678.1234567891234567891234..78912345678912.4..78.12345678.123456.89.2345678..23456...1234567891.3456...123456789123456789123456..9123456789',
  '1......8.12.4.6.8912345.7891.34.6.891234567891234.67891234567891234567891..456.891234...8.12345678912345.789123456789123456789.234..789.2345.78..234567..12345678912345678912.45678.12345678912345678.1..4567.9123456789123.5678..2.4567..12.4567..1234.6.8912345678912345.789123456.8.1..456.891234567891234567891234567891..45..891234567.91234567.9123.5.7.91234567.91.3456789123.5.7891.3.5.7891234567.91234567891234.6789.234.67..123456789123..6.8.12345678912345678912345678.12345678.1234567891.34.6...1234567891234567891.3456...1..456..9123456.891234567891234.67..123456789123456789.23456789.23.5.789123456789123456789.23.5.789..3...78.123456789123...789123456789.2.456789....5.78..2345678912.456789.2..5.789123.5.78912345678912..5.789',
];

const SHAPE_6x6_PUZZLES = [
  '6x6',
  '6x6: Numbered rooms',
  {
    src: 'https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=000ED6',
    input: '.Between~R6C3~R5C2~R4C2.Between~R3C1~R2C2~R3C3~R3C4.Between~R1C3~R2C4~R3C3~R4C3.Between~R4C6~R4C5~R5C4~R5C3~R6C4.~R4C3_2_4_6~R1C3_2_4_6~R6C4_2_4_6~R4C6_2_4_6~R2C2_2_4_6~R2C3_2_4_6~R3C1_1_3_5~R3C4_1_3_5~R2C4_1_3_5~R2C5_1_3_5~R4C2_1_3_5~R6C3_1_3_5.Shape~6x6',
    solution: '314625526314163542452136235461641253'
  },
  {
    src: 'https://www.youtube.com/watch?v=V-iY2ISw6tE',
    input: '.LittleKiller~8~R1C4.LittleKiller~9~R3C1.LittleKiller~26~R5C6.LittleKiller~17~R6C2..Shape~6x6',
    solution: '462135513624236541145362321456654213',
  },
]