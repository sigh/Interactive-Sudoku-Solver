export const DEFAULT_CODE = `
// Create a killer cage with sum 15
const sum = 15;
const cells = ['R1C1', 'R1C2', 'R2C1', 'R2C2'];
const constraint = new Cage(sum, ...cells);

console.log('Created cage with', cells.length, 'cells', '\\n');

help();  // Usage instructions

return constraint;`.trim();

export const EXAMPLES = {
  'Default Template': DEFAULT_CODE,

  'Simple Renban': `// Simple Renban line
const cells = ['R1C1', 'R1C2', 'R1C3'];
return new Renban(...cells);`,

  'Killer Cage': `// Killer cage with sum
const sum = 15;
const cells = ['R1C1', 'R1C2', 'R2C1', 'R2C2'];
return new Cage(sum, ...cells);`,

  'Not-Renban NFA': `// Not-Renban: values must NOT be consecutive
// Uses NFA to track min/max
function makeNotRenban(cells) {
  const count = cells.length;
  const spec = {
    startState: { min: 16, max: -1 },
    transition: (state, value) => ({
      min: Math.min(state.min, value),
      max: Math.max(state.max, value),
    }),
    accept: (state) => state.max - state.min !== count - 1,
  };
  const encodedNFA = NFA.encodeSpec(spec, 9);
  return new NFA(encodedNFA, '', ...cells);
}

return makeNotRenban(['R1C1', 'R1C2', 'R1C3']);`,

  'Multiple Constraints': `// Combine multiple constraints
const constraints = [
  new Thermo('R1C1', 'R2C1', 'R3C1'),
  new Thermo('R1C2', 'R2C2', 'R3C2'),
  new AntiKnight(),
];

return new Set(constraints);`,

  'Arithmetic Progression': `// Arithmetic progression NFA
// All differences between consecutive cells must be equal
const cells = ['R1C1', 'R1C2', 'R1C3', 'R1C4'];
const spec = {
  startState: { lastVal: null, diff: null },
  transition: (state, value) => {
    if (state.lastVal === null) {
      return { lastVal: value, diff: null };
    }
    const diff = value - state.lastVal;
    if (state.diff === null || state.diff === diff) {
      return { lastVal: value, diff: diff };
    }
    // Invalid - difference doesn't match
    return undefined;
  },
  accept: () => true,
};

const encodedNFA = NFA.encodeSpec(spec, 9);
return new NFA(encodedNFA, 'AP', ...cells);`,

  'Grid Generation': `// Generate constraints for entire grid
const constraints = [];

// Add thermos for each row's first 3 cells
for (let row = 1; row <= 3; row++) {
  const cells = [];
  for (let col = 1; col <= 3; col++) {
    cells.push(\`R\${row}C\${col}\`);
  }
  constraints.push(new Thermo(...cells));
}

console.log(\`Generated \${constraints.length} thermos\`);
return new Set(constraints);`,
};