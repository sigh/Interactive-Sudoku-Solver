// From https://sudokutheory.com/wiki/index.php?title=Snipes#Thermo
// Also see this thread: 'http://forum.enjoysudoku.com/minimal-futoshiki-sudoshiki-puzzles-t32904-30.html#p322490'
const HARD_THERMOS = [
  [`
    .Thermo~r1c2~r2c3.Thermo~r3c2~r2c1.Thermo~r4c2~r5c1.Thermo~r6c2~r5c3
    .Thermo~r7c2~r8c3.Thermo~r9c2~r8c1.Thermo~r1c6~r2c6.Thermo~r3c5~r2c4
    .Thermo~r3c5~r2c5.Thermo~r6c5~r5c4.Thermo~r7c5~r8c4.Thermo~r9c6~r8c6
    .Thermo~r1c8~r2c9.Thermo~r3c8~r2c7.Thermo~r4c8~r5c9.Thermo~r6c8~r5c7
    .Thermo~r7c8~r8c9.Thermo~r9c8~r8c7`,
    '953874162816235497472916538265398741794621385138457629387169254529743816641582973',
  ],
  [`
    .Thermo~R1C2~R2C3.Thermo~R3C2~R2C1.Thermo~R4C2~R5C1.Thermo~R6C2~R5C3
    .Thermo~R7C2~R8C1.Thermo~R9C2~R8C3.Thermo~R9C4~R8C4.Thermo~R9C6~R8C5
    .Thermo~R9C7~R8C6.Thermo~R9C8~R8C9.Thermo~R7C8~R8C7.Thermo~R7C6~R7C7
    .Thermo~R6C6~R5C5.Thermo~R6C8~R5C9.Thermo~R4C8~R5C7.Thermo~R3C8~R2C9
    .Thermo~R1C8~R2C7.Thermo~R3C6~R2C5.Thermo~R1C4~R2C4.`,
    '953218746816374529274956381621749835385162497749835162132687954497523618568491273',
  ],
  [`
    .Thermo~R1C2~R2C1.Thermo~R3C2~R2C3.Thermo~R4C2~R5C3.Thermo~R4C3~R5C4
    .Thermo~R6C2~R5C1.Thermo~R7C2~R8C3.Thermo~R9C2~R8C1.Thermo~R9C4~R8C5
    .Thermo~R7C7~R8C6.Thermo~R7C8~R8C7.Thermo~R9C8~R8C9.Thermo~R6C7~R5C6
    .Thermo~R6C8~R5C7.Thermo~R4C8~R5C9.Thermo~R3C8~R2C7.Thermo~R1C8~R2C9
    .Thermo~R1C7~R2C6.Thermo~R3C4~R2C5.Thermo~R6C4~R5C5.`,
    '561798243784263915239541687472916538618352794953487162146825379395174826827639451'
  ]
];

// TODO: Rename this file.
const SKYSCRAPERS = [
  'Skyscraper',
  'Skyscraper - all 5',
  'Skyscraper - all 6',
  'Renban skyscrapers',
];