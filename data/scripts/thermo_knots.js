// Chaos Construction: Thermo Knots by Myxo
// https://www.youtube.com/watch?v=Er6e0ODkVYg
// https://sudokupad.app/4geira1lnl
//
// Chaos construction (deduce nine 9-cell orthogonally-connected regions). From
// each big circle a thermometer is drawn in every orthogonal direction: it runs
// through the cells that share the circle's region and its digits increase from
// the circle. The run extends to the region's edge, and the next cell (a
// different region) must be SMALLER than the tip. A small white dot joins cells
// in different regions with consecutive digits.

const graph = cellGraph('9x9');
const cc = graph.makeOverlay('CC');

// Big circles (thermo hubs) - each a local minimum of its region.
const HUBS = ['R2C2', 'R6C2', 'R9C1', 'R8C4', 'R8C8', 'R6C7', 'R3C8', 'R2C6', 'R4C4'];
// White dots: different regions + consecutive digits.
const DOTS = [['R4C1', 'R4C2'], ['R6C4', 'R6C5']];

// A thermo ray runs from a hub to the grid edge in one direction; keep only the
// directions with a neighbour (a thermo needs at least two cells).
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const rays = HUBS.flatMap((hub) => DIRS.map(([dr, dc]) => graph.ray(hub, dr, dc)))
  .filter((cells) => cells.length >= 2);

// Thermo-knot machine, reading each ray as an interleaved stream
//   region(hub), value(hub), region(c1), value(c1), region(c2), value(c2), ...
// so it can pair every cell's region label with its digit.
//
// State: { r, prev, stage } while still on the thermo (cells sharing the hub's
// region r, `prev` = last digit); `done` once the run has ended. A cell in region
// r must strictly exceed prev (increasing); the first cell that leaves region r is
// the cell after the tip and must be smaller than prev. Reaching the grid edge
// while still in region is fine (no cell after the tip).
const thermoSpec = {
  startState: { stage: 'hubRegion' },
  transition: ({ done, stage, r, prev, li }, value) => {
    if (done) return { done: true };
    if (stage === 'hubRegion') return { stage: 'hubValue', r: value };
    if (stage === 'hubValue') return { stage: 'cellRegion', r, prev: value };
    if (stage === 'cellRegion') return { stage: 'cellValue', r, prev, li: value };
    // cellValue: `value` is this cell's digit, `li` its region label.
    if (li === r) {                            // still on the thermo
      if (value <= prev) return undefined;     // digits must increase
      return { stage: 'cellRegion', r, prev: value };
    }
    if (value >= prev) return undefined;       // the cell after the tip must be smaller
    return { done: true };
  },
  accept: ({ done, stage }) => done || stage === 'cellRegion',
};
const thermoNFA = NFA.encodeSpec(thermoSpec, 9);
const stream = (cells) => cells.flatMap((g) => [cc.at(g), g]);

return [
  new Shape('9x9'),
  new ChaosConstruction(),
  new NoBoxes(),
  new Given('R9C9', 1),

  ...DOTS.flatMap(([a, b]) => [new WhiteDot(a, b), new AllDifferent(cc.at(a), cc.at(b))]),

  ...rays.map((cells) => new NFA(thermoNFA, 'thermo', ...stream(cells))),

  // The ">= 2 cells" rule: every on-grid neighbour of a hub is in the hub's region.
  // Not enforced by the NFA. Done with SameValues so that the chaos handler
  // can merge the regions.
  ...rays.map((cells) => new SameValues(2, cc.at(cells[0]), cc.at(cells[1]))),
];
