// Constraint-type tags from a serialized constraint string. Tooling / on-demand
// UI only (tests, the dev fixer, the debug puzzle selector) — not the core app.
const { SudokuConstraint, SudokuConstraintBase } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { CellGeometry, GEOMETRY_9x9 } = await import('../cell_geometry.js' + self.VERSION_PARAM);

// These serialize as `.Type~key~_<name>~cells`; a named one is surfaced as a
// distinct type (e.g. `Pair: non-consecutive`).
const NAMED_CONSTRAINT_TYPES = new Set(['NFA', 'Pair', 'PairX', 'Binary', 'BinaryX']);

export const extractConstraintTypes = (str) => {
  const shapeTypes = [];
  const types = new Set();
  const namedTypes = new Set();  // last, since these can be numerous

  for (const rawSegment of str.split('.')) {
    const segment = rawSegment.trim();  // constraints may be newline-joined
    const end = segment.indexOf('~');
    const type = end === -1 ? segment : segment.slice(0, end);
    if (type === 'End' || !SudokuConstraint[type]) continue;

    if (type === 'Shape') {
      if (end === -1) continue;  // bare Shape is the default grid
      const geometry = CellGeometry.fromShapeSpec(segment.slice(end + 1));
      if (geometry.gridType === CellGeometry.RAW_GRID_TYPE) {
        shapeTypes.push(`Raw ${geometry.gridDimsStr}`);
      } else if (geometry.gridDimsStr !== GEOMETRY_9x9.gridDimsStr) {
        shapeTypes.push(geometry.gridDimsStr);
      }
      const defaultNumValues = CellGeometry.defaultNumValues(
        geometry.numRows, geometry.numCols);
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
