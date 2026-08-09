// Constraint-type tags from a serialized constraint string. Tooling / on-demand
// UI only (tests, the dev fixer, the debug puzzle selector) — not the core app.
const { SudokuConstraint, SudokuConstraintBase } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { CellGeometry, GEOMETRY_9x9 } = await import('../cell_geometry.js' + self.VERSION_PARAM);

// These serialize as `.Type~key~_<name>~cells`; a named one is surfaced as a
// distinct type (e.g. `Pair: non-consecutive`).
const NAMED_CONSTRAINT_TYPES = new Set(['NFA', 'Pair', 'PairX', 'Binary', 'BinaryX']);

// Declared 'RxC' dimensions of each Var cell group, keyed by cell-id prefix
// ('V' + the Var's prefix). A cell-group shape names one of these as the
// puzzle, and its dimensions live here rather than on the Shape spec.
const varGroupDims = (segments) => {
  const dims = new Map();
  for (const segment of segments) {
    const tokens = segment.split('~');
    if (tokens[0] !== 'Var' || tokens.length < 4) continue;
    const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(tokens[3]);
    if (match) dims.set('V' + tokens[1], [+match[1], +match[2]]);
  }
  return dims;
};

export const extractConstraintTypes = (str) => {
  const shapeTypes = [];
  const types = new Set();
  const namedTypes = new Set();  // last, since these can be numerous

  const segments = str.split('.').map(s => s.trim());
  const groupDims = varGroupDims(segments);

  for (const rawSegment of str.split('.')) {
    const segment = rawSegment.trim();  // constraints may be newline-joined
    const end = segment.indexOf('~');
    const type = end === -1 ? segment : segment.slice(0, end);
    if (type === 'End' || !SudokuConstraint[type]) continue;

    if (type === 'Shape') {
      if (end === -1) continue;  // bare Shape is the default grid
      const geometry = CellGeometry.fromShapeSpec(segment.slice(end + 1));
      // A cell-group shape has no main grid, so its own dims are 0x0 and the
      // board's are on the named group. Tag it 'Raw', as the shape input does:
      // the group is just cells, with no rows, columns or boxes of its own.
      const [rows, cols] =
        groupDims.get(geometry.mainCellGroup) ?? [geometry.numRows, geometry.numCols];
      if (geometry.mainCellGroup) {
        shapeTypes.push(`Raw ${rows}x${cols}`);
      } else if (geometry.gridDimsStr !== GEOMETRY_9x9.gridDimsStr) {
        shapeTypes.push(geometry.gridDimsStr);
      }
      const defaultNumValues = CellGeometry.defaultNumValues(rows, cols);
      if (geometry.numValues !== defaultNumValues || geometry.valueOffset !== 0) {
        shapeTypes.push(`${geometry.minValue()}-${geometry.maxValue()}`);
      }
    } else if (NAMED_CONSTRAINT_TYPES.has(type)) {
      const tokens = segment.split('~');  // [type, key, ...name/cell items]
      let named = false;
      for (let i = 2; i < tokens.length; i++) {
        if (tokens[i][0] !== '_') continue;  // names are '_'-prefixed; cells aren't
        named = true;
        const name = SudokuConstraintBase.uriDecodeArg(tokens[i].slice(1));
        if (name) namedTypes.add(`${type}: ${name}`);
        else types.add(type);
      }
      if (!named) types.add(type);
    } else {
      types.add(type);
    }
  }

  return [...shapeTypes, ...types, ...namedTypes];
};
