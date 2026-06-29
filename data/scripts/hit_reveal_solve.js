// Hit, Reveal, Solve by Nurator
// https://www.youtube.com/watch?v=vspwP6DlQik
//
// Each arrow's value counts cells along its directions. Per arrow, the origin is
// one segment and each ray (one direction's cells, in distance order) is another,
// fed to a unified multi-segment state machine.

// Directions, as the (dRow, dCol) step they take.
const N = [-1, 0], E = [0, 1], S = [1, 0], W = [0, -1];

// Origin cell -> the directions its arrow counts along.
const arrows = {
  R1C1: [S],
  R1C5: [S],
  R1C9: [S],
  R2C4: [E],
  R2C6: [W],
  R3C7: [N, E],
  R4C6: [N, E, S, W],
  R5C7: [N, E],
  R6C2: [E],
  R6C9: [W],
  R7C5: [W],
  R7C6: [W],
};

const spec = NFA.encodeSpec({
  startState: { quota: null, distance: 0 },
  transition: ({ quota, distance }, value) => {
    if (quota === null) {
      // The origin segment sets the arrow's quota from its single value.
      return { quota: value, distance };
    }
    if (quota < 0 || distance === 9) return [];
    // A SEGMENT_BREAK starts the next ray, back at the origin's distance.
    if (value === SEGMENT_BREAK) return { quota, distance: 0 };
    const d = distance + 1;   // this cell's distance from the origin
    // A cell contributes its value to the quota only when it equals its distance.
    return { quota: quota - value * (value === d), distance: d };
  },
  accept: ({ quota }) => quota === 0,
}, 9, { multiSegment: true });

const graph = cellGraph("9x9");

return [
  new Shape("9x9"),
  // Each ray (one direction's cells, in distance order) is a segment;
  // the origin is the first segment.
  ...Object.entries(arrows).map(([origin, directions]) =>
    new NFA(
      spec,
      "HPA",
      [origin],
      ...directions.map(dir => graph.ray(origin, ...dir).slice(1))))
];
