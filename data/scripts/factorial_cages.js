// Puzzle: Factorial Cages
// https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?id=000JC4
//
// Each cage's digits multiply to a factorial of the cage size, encoded as an NFA.

const base = `.Sum~~R8C1~R8C2~R8C3~R9C1~R9C2~R9C3~R9C4~R9C5~R9C6~R9C7.Sum~~R7C1~R7C2~R7C3~R7C4~R8C4~R8C5~R8C6.Sum~~R6C4~R6C5~R7C5~R7C6~R7C7~R8C7.Sum~~R4C7~R5C7~R5C6~R6C6~R6C7~R6C8~R5C8~R7C8~R8C8.Sum~~R3C8~R3C9~R4C9~R5C9~R6C9~R7C9~R8C9~R9C9.Sum~~R2C9~R2C8~R2C7~R2C6~R3C6~R4C6.Sum~~R1C8~R1C7~R1C6~R1C5~R2C5~R3C5~R3C4~R4C4~R4C3.Sum~~R1C1~R2C1.Sum~~R1C3~R1C2~R2C2~R2C3~R3C2~R4C2~R4C1~R3C1~R5C1`;

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f = f * i;
  return f;
}

function factorialCageNFA(cageSize) {
  const target = factorial(cageSize);
  return NFA.encodeSpec({
    startState: 1,
    transition: (state, value) => {
      if (state > target) return;
      return state * value;
    },
    accept: state => state === target,
  }, 9);
}

function factorialCage(cells) {
  return new NFA(factorialCageNFA(cells.length),
    `${cells.length} factorial cage`, ...cells
  );
}

const constraints = parseConstraint(base);
return constraints.map(c => c.type === 'Sum' ? factorialCage(c.cells) : c);
