const {
  memoize,
  MultiMap,
  arrayRemoveValue,
  groupSortedBy,
  Base64Codec
} = await import('./util.js' + self.VERSION_PARAM);
const { GridShape, SHAPE_9x9, SHAPE_MAX } = await import('./grid_shape.js' + self.VERSION_PARAM);
const { NFASerializer, javascriptSpecToNFA, nfaToJavascriptSpec } = await import('./nfa_builder.js' + self.VERSION_PARAM);

export class CellArgs {
  constructor(args, type) {
    const numArgs = args.length;
    if (!numArgs) {
      throw new Error('No cells provided for ' + type);
    }

    this._isLoop = false;
    if (args[numArgs - 1] === 'LOOP') {
      if (!SudokuConstraint[type].LOOPS_ALLOWED) {
        throw new Error('Loops are not allowed for ' + type);
      }
      args.pop();
      this._isLoop = true;
    }

    this._cells = args;
  }

  isLoop() {
    return this._isLoop;
  }

  cells() {
    return this._cells;
  }

  cellIds(shape) {
    return this._cells.map(c => shape.parseCellId(c).cell);
  }
}

export class SudokuConstraintBase {
  static DESCRIPTION = '';
  static CATEGORY = 'Experimental';
  static DISPLAY_CONFIG = null;
  static LOOPS_ALLOWED = false;
  static IS_COMPOSITE = false;
  // A puzzle can't have multiple constraints with the same
  // uniquenessKey. Uniqueness keys are specific to a constraint
  // type.
  // The UNIQUENESS_KEY_FIELD is a field that is used to generate the
  // uniqueness key for this constraint.
  // Use null if there are no uniqueness requirements.
  static UNIQUENESS_KEY_FIELD = null;

  // Determine if a list of cells is valid for this constraint class.
  // Used by LinesAndSets constraints. Takes (cells, shape) arguments.
  static VALIDATE_CELLS_FN = null;

  // Determine if a shape is valid for this constraint class.
  // Takes (shape) argument, returns true if valid.
  static VALIDATE_SHAPE_FN = null;

  constructor(...args) {
    this.args = args;
    this.type = this.constructor.name;
  }

  static *makeFromArgs(args, shape) {
    yield new this(...args);
  }

  // Generate a string for all the passed in constraints combined.
  // All constraints will be of the current type.
  // IMPORTANT: Serialize should not return more constraints than the input, as
  //            the output maybe included in an 'Or'.
  static serialize(constraints) {
    return constraints.map(
      c => this._argsToString(...c.args)).join('');
  }

  static _argsToString(...args) {
    let type = this.name;
    if (this === SudokuConstraint.Given) type = '';
    const arr = [type, ...args];
    return '.' + arr.join('~');
  }

  static uriEncodeArg(displayName) {
    const name = encodeURIComponent(displayName);
    return name.replace(/\./g, '%2E').replace(/~/g, '%7E');
  }

  static uriDecodeArg(name) {
    let displayName = name;
    try {
      displayName = decodeURIComponent(name);
    } catch (e) { }
    return displayName;
  }

  toString() {
    return this.constructor.serialize([this]);
  }

  forEachTopLevel(fn) {
    if (this.type === SudokuConstraint.Container.name) {
      this.constraints.forEach(c => c.forEachTopLevel(fn));
    } else {
      fn(this);
    }
  }

  toMap() {
    const cMap = new MultiMap();

    this.forEachTopLevel(c => {
      cMap.add(c.type, c);
    });

    return cMap.getMap();
  }

  getShape() {
    let gridSpec = null;
    this.forEachTopLevel(c => {
      if (c.type === 'Shape') gridSpec = c.gridSpec;
    });

    const shape = SudokuConstraint.Shape.getShapeFromGridSpec(gridSpec);
    if (!shape) throw new Error('Unknown shape: ' + shape);
    return shape;
  }

  static displayName() {
    return this.name.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  chipLabel() {
    let label = this.constructor.displayName();
    if (this.constructor.CATEGORY === 'Experimental') {
      label += ' (Experimental)';
    }
    return label;
  }

  uniquenessKeys() {
    const field = this.constructor.UNIQUENESS_KEY_FIELD;
    if (field === null) return [];
    const key = this[field];
    return Array.isArray(key) ? key : [key];
  }

  // Merge two constraints with the same uniqueness key.
  // Default: last one wins. Subclasses can override for custom behavior
  // (e.g. intersection).
  static mergeConstraints(existing, incoming) {
    return incoming;
  }

  // Get the cells associated with this constraints.
  // Mainly for display purposes.
  getCells(shape) {
    return this.cells || [];
  }

  getVarCellGroups(shape) {
    return [];
  }

  static _makeRegions(fn, numRegions, regionSize) {
    const regions = [];
    for (let r = 0; r < numRegions; r++) {
      const cells = [];
      for (let i = 0; i < regionSize; i++) {
        cells.push(fn(r, i));
      }
      regions.push(cells);
    }
    return regions;
  }

  static rowRegions = memoize(
    (shape) => {
      const numRows = shape.numRows;
      const numCols = shape.numCols;
      return this._makeRegions((r, i) => r * numCols + i, numRows, numCols);
    },
    (shape) => shape.gridDimsStr);
  static colRegions = memoize(
    (shape) => {
      const numRows = shape.numRows;
      const numCols = shape.numCols;
      return this._makeRegions((c, i) => i * numCols + c, numCols, numRows);
    },
    (shape) => shape.gridDimsStr);
  static boxRegions = memoize((shape, size = null) => {
    const numRows = shape.numRows;
    const numCols = shape.numCols;
    const effectiveSize = size ?? GridShape.defaultNumValues(numRows, numCols);

    const [boxHeight, boxWidth] = GridShape.boxDimsForSize(
      numRows, numCols, effectiveSize);
    if (!boxHeight) return [];

    const boxesPerRow = numCols / boxWidth;
    const numBoxes = shape.numGridCells / effectiveSize;

    return this._makeRegions(
      (r, i) => {
        // r = box index, i = cell index within box
        const boxRow = Math.floor(r / boxesPerRow);
        const boxCol = r % boxesPerRow;
        const cellRow = Math.floor(i / boxWidth);
        const cellCol = i % boxWidth;
        return (boxRow * boxHeight + cellRow) * numCols + (boxCol * boxWidth + cellCol);
      }, numBoxes, effectiveSize);
  }, (shape, size = null) => `${shape.gridDimsStr}~${size ?? GridShape.defaultNumValues(shape.numRows, shape.numCols)}`);
  static disjointSetRegions = memoize((shape, size = null) => {
    const numCols = shape.numCols;
    const effectiveSize = size ?? GridShape.defaultNumValues(shape.numRows, numCols);
    const [boxHeight, boxWidth] = GridShape.boxDimsForSize(
      shape.numRows, numCols, effectiveSize);
    if (!boxHeight) return [];

    const numSets = effectiveSize;
    const numBoxes = shape.numGridCells / effectiveSize;
    const boxesPerRow = numCols / boxWidth;
    // r = position within box (0 to effectiveSize-1)
    // i = box index (0 to numBoxes-1)
    return this._makeRegions(
      (r, i) => {
        const boxRow = (i / boxesPerRow) | 0;
        const boxCol = i % boxesPerRow;
        const posRow = (r / boxWidth) | 0;
        const posCol = r % boxWidth;
        return (boxRow * boxHeight + posRow) * numCols + boxCol * boxWidth + posCol;
      }, numSets, numBoxes);
  }, (shape, size = null) => `${shape.gridDimsStr}~${size ?? GridShape.defaultNumValues(shape.numRows, shape.numCols)}`);
  static square2x2Regions = memoize(
    (shape) => {
      const numRows = shape.numRows;
      const numCols = shape.numCols;
      const regions = [];

      for (let i = 0; i < numRows - 1; i++) {
        for (let j = 0; j < numCols - 1; j++) {
          regions.push([
            shape.cellIndex(i, j),
            shape.cellIndex(i, j + 1),
            shape.cellIndex(i + 1, j),
            shape.cellIndex(i + 1, j + 1),
          ]);
        }
      }

      return regions;
    },
    (shape) => shape.gridDimsStr);

  static fullLineCellMap = memoize(
    (shape) => {
      let map = new Map();
      const numRows = shape.numRows;
      const numCols = shape.numCols;

      const rowRegions = this.rowRegions(shape);
      for (let row = 0; row < numRows; row++) {
        const cells = rowRegions[row].map(c => shape.makeCellIdFromIndex(c));
        map.set(`R${row + 1},1`, cells);
        map.set(`R${row + 1},-1`, cells.slice().reverse());
      }
      const colRegions = this.colRegions(shape);
      for (let col = 0; col < numCols; col++) {
        const cells = colRegions[col].map(c => shape.makeCellIdFromIndex(c));
        map.set(`C${col + 1},1`, cells);
        map.set(`C${col + 1},-1`, cells.slice().reverse());
      }

      return map;
    },
    (shape) => shape.gridDimsStr);

  static _hasAdjacentCells(cells, shape) {
    const graph = shape.cellGraph();
    const cellIndices = cells.map(c => shape.parseCellId(c).cell);
    const cellSet = new Set(cellIndices);

    for (const cell of cellIndices) {
      if (graph.neighborCountIn(cell, cellSet) === 0) return false;
    }

    return true;
  }

  static _adjacentCellPairs(cells, shape) {
    const graph = shape.cellGraph();
    const cellIndices = cells.map(c => shape.parseCellId(c).cell);
    const cellSet = new Set(cellIndices);
    const pairs = [];
    for (const cell of cellIndices) {
      cellSet.delete(cell);
      for (const adj of graph.cellEdges(cell)) {
        if (cellSet.has(adj)) {
          pairs.push([cell, adj]);
        }
      }
    }
    return pairs;
  }

  static _cellsAre2x2Square(cells, shape) {
    if (cells.length !== 4) return false;
    const graph = shape.cellGraph();
    const cellIndices = new Set(cells.map(c => shape.parseCellId(c).cell));

    for (const cell of cellIndices) {
      if (graph.neighborCountIn(cell, cellIndices) !== 2) return false;
    }
    return true;
  }

  static _cellsAreValidCage(cells, shape) {
    return cells.length > 1 && cells.length <= shape.numValues;
  }
}

export class LineOptions {
  color = 'rgb(200, 200, 200)';
  width = 5;
  startMarker;
  endMarker;
  nodeMarker;
  arrow = false;
  dashed = false;

  static DEFAULT_COLOR = 'rgb(200, 200, 200)';
  static THIN_LINE_WIDTH = 2;
  static THICK_LINE_WIDTH = 15;

  static FULL_CIRCLE_MARKER = 1;
  static EMPTY_CIRCLE_MARKER = 2;
  static SMALL_FULL_CIRCLE_MARKER = 3;
  static SMALL_EMPTY_CIRCLE_MARKER = 4;
  static DIAMOND_MARKER = 6;

  constructor(options) {
    Object.assign(this, options);
  }
}

export class ShadedRegionOptions {
  labelField;
  pattern;

  static DIAGONAL_PATTERN = 'diagonal-pattern';
  static SQUARE_PATTERN = 'square-pattern';
  static CHECKERED_PATTERN = 'checked-pattern';
  static HORIZONTAL_LINE_PATTERN = 'horizontal-line-pattern';

  constructor(options) {
    Object.assign(this, options);
  }
}

export class OutsideConstraintBase extends SudokuConstraintBase {
  static CLUE_TYPE_DOUBLE_LINE = 'double-line';
  static CLUE_TYPE_DIAGONAL = 'diagonal';
  static CLUE_TYPE_SINGLE_LINE = 'single-line';

  static ZERO_VALUE_OK = false;
  static UNIQUENESS_KEY_FIELD = 'arrowId';
  static CLUE_TYPE = '';

  constructor(arrowId, value) {
    super(arrowId, value);
    this.arrowId = arrowId;
    this.value = parseInt(value);

    if (!Number.isInteger(this.value)) {
      throw Error('Invalid clue value: ' + value);
    }
    if (!this.constructor.ZERO_VALUE_OK && this.value === 0) {
      throw Error("Clue value can't be 0");
    }

    const idParts = arrowId.split(',');
    this.id = idParts[0];
    this.dir = idParts.length > 1 ? +idParts[1] : 0;
  }

  getCells(shape) {
    const cls = this.constructor;
    switch (cls.CLUE_TYPE) {
      case cls.CLUE_TYPE_DOUBLE_LINE:
        return cls.fullLineCellMap(shape).get(this.arrowId);
      case cls.CLUE_TYPE_DIAGONAL:
        return cls.cellMap(shape)[this.id];
      case cls.CLUE_TYPE_SINGLE_LINE:
        return cls.fullLineCellMap(shape).get(this.arrowId);
      default:
        throw Error('Unknown clue type');
    }
  }

  chipLabel() {
    if (this.constructor.CLUE_TYPE === this.constructor.CLUE_TYPE_DOUBLE_LINE) {
      const dir = this.dir;
      const arrowId = this.arrowId;

      let dirStr = '';
      if (arrowId[0] === 'C') {
        dirStr = dir > 0 ? '↓' : '↑';
      } else {
        dirStr = dir > 0 ? '→' : '←';
      }

      return `${this.constructor.displayName()} [${this.id} ${dirStr}${this.value}]`;
    } else {
      return super.chipLabel();
    }
  }

  static *makeFromArgs(args, shape) {
    switch (this.CLUE_TYPE) {
      case this.CLUE_TYPE_DOUBLE_LINE:
        const rowCol = args[0];
        if (args[1]) {
          yield new this(rowCol + ',1', args[1]);
        }
        if (args[2]) {
          yield new this(rowCol + ',-1', args[2]);
        }
        break;
      case this.CLUE_TYPE_DIAGONAL:
        yield new this(args[1], args[0]);
        break;
      case this.CLUE_TYPE_SINGLE_LINE:
        yield new this(args[1] + ',1', args[0]);
        break;
      default:
        throw Error('Unknown clue type');
    }
  }

  static serialize(constraints) {
    const clueType = this.CLUE_TYPE;

    if (clueType !== this.CLUE_TYPE_DOUBLE_LINE) {
      return constraints.map(
        c => this._argsToString(c.value, c.id)).join('');
    }

    // Combine double line parts.
    const seenIds = new Map();
    for (const part of constraints) {
      const { id, arrowId, value } = part;
      const [, dir] = arrowId.split(',');
      const index = dir === '1' ? 1 : 2;

      if (seenIds.has(id)) {
        seenIds.get(id)[index] = value;
      } else {
        const args = [id, '', ''];
        args[index] = value;
        seenIds.set(id, args);
      }
    }

    return [...seenIds.values()].map(
      args => this._argsToString(...args)).join('');
  }
}

export class CompositeConstraintBase extends SudokuConstraintBase {
  static CATEGORY = 'Composite';
  static IS_COMPOSITE = true;
  static DISPLAY_CONFIG = {
    displayClass: 'BorderedRegion',
    inset: 2,
    opacity: 0.35,
    dashed: true,
  };

  // Create an allow-list for the types of constraints that can be inside a
  // composite.
  // Other types of constraints either:
  //  - Don't make sense to nest inside one (such as Shape)
  //  - Interact with other constraints that make them difficult to implement
  //    such as StrictKropki or constraints that define regions.
  //  - Or would just be a bit confusing to include given the above two caveats
  //    (such as Anti-knight). It is easier to ban everything in the layout
  //    panel.
  static _ALLOWED_CATEGORIES = new Set(
    ['LinesAndSets', 'GivenCandidates', 'OutsideClue', 'Composite', 'Pairwise', 'StateMachine']);

  static allowedConstraintClass(constraintClass) {
    return this._ALLOWED_CATEGORIES.has(constraintClass.CATEGORY);
  }

  constructor(constraints) {
    super(constraints);
    this.constraints = constraints || [];
    for (const c of this.constraints) {
      if (!this.constructor.allowedConstraintClass(c.constructor)) {
        throw Error(
          `Invalid constraint type in '${this.constructor.name}': ${c.type}`);
      }
    }
  }

  addChild(constraint) {
    this.constraints.push(constraint);
  }

  removeChild(constraint) {
    arrayRemoveValue(this.constraints, constraint);
  }

  getCells(shape) {
    return this.constraints.flatMap(c => c.getCells(shape));
  }

}

export class SudokuConstraint {

  static Container = class Container extends SudokuConstraintBase {
    static DESCRIPTION = "Container for constraints. Do not use directly.";
    static CATEGORY = null;
    static IS_COMPOSITE = true;

    constructor(constraints) {
      super(constraints);
      this.constraints = constraints;
    }

    static allowedConstraintClass(constraintClass) {
      return true;
    }

    static serialize(constraints) {
      const constraintMap = new MultiMap();
      for (const c of constraints) {
        for (const cc of c.constraints) {
          constraintMap.add(cc.constructor, cc);
        }
      }

      const parts = [];
      for (const [cls, constraints] of constraintMap) {
        parts.push(cls.serialize(constraints));
      }
      return parts.join('');
    }

    getCells(shape) {
      return this.constraints.flatMap(c => c.cells(shape));
    }
  }

  static Or = class Or extends CompositeConstraintBase {
    static DESCRIPTION = (
      "At least one of the contained constraints must be satisfied.");

    static _serializeSingle(constraint) {
      const parts = [];
      // We can't combine any constraints within an 'Or'.
      for (const c of constraint.constraints) {
        parts.push(c.constructor.serialize([c]));
      }

      return `.${this.name}${parts.join('')}.End`;
    }

    static serialize(constraints) {
      return constraints.map(c => this._serializeSingle(c)).join('');
    }
  }

  static And = class And extends CompositeConstraintBase {
    static DESCRIPTION = (
      "All the contained constraints must be satisfied.");

    static serialize(constraints) {
      // For 'And' we can combine all the constraints.
      const constraintMap = new MultiMap();
      for (const c of constraints) {
        for (const cc of c.constraints) {
          constraintMap.add(cc.constructor, cc);
        }
      }

      const parts = [];
      for (const [cls, constraints] of constraintMap) {
        parts.push(cls.serialize(constraints));
      }

      return `.${this.name}${parts.join('')}.End`;
    }
  }

  static End = class End extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Marks the end of a composite constraint group.");
  }

  static Jigsaw = class Jigsaw extends SudokuConstraintBase {
    static DESCRIPTION = (
      "An irregular region which must contain all digits without repetition.");
    static CATEGORY = 'Region';
    static DISPLAY_CONFIG = { displayClass: 'Jigsaw' };
    static UNIQUENESS_KEY_FIELD = 'cells';

    constructor(gridSpec, ...cells) {
      super(gridSpec, ...cells);
      this.gridSpec = gridSpec;
      this.cells = cells;
    }

    chipLabel() { return ''; }

    static *makeFromArgs(args, shape) {
      // Legacy format: .Jigsaw~<gridSpec>~<layout>
      // New format:    .Jigsaw~<layout>
      // Ignore any legacy leading argument(s) and take the layout as the last
      // argument.
      if (args.length < 1 || args.length > 2) {
        throw Error('Invalid jigsaw constraint args');
      }
      const layoutStr = args[args.length - 1];

      if (layoutStr.length !== shape.numGridCells) {
        throw Error(
          `Jigsaw layout expects ${shape.numGridCells} cells, ` +
          `but layout has ${layoutStr.length}`);
      }

      const map = new MultiMap();
      for (let i = 0; i < layoutStr.length; i++) {
        map.add(layoutStr[i], i);
      }

      // If all the cells in the grid are in one region, then no constraint
      // is needed.
      if (map.size === 1) return;

      const maxRegionSize = shape.numValues;
      const minRegionSize = GridShape.defaultNumValues(
        shape.numRows, shape.numCols);

      let sawOtherRegionSize = false;
      for (const [, region] of map) {
        const len = region.length;
        if (len >= minRegionSize && len <= maxRegionSize) {
          yield new this(
            shape.name,
            ...region.map(c => shape.makeCellIdFromIndex(c)));
        } else if (!sawOtherRegionSize) {
          // Allow one region to have a different size for partially filled grids.
          sawOtherRegionSize = true;
        } else {
          throw Error('Inconsistent region sizes in jigsaw layout');
        }
      }
    }

    static serialize(parts) {
      if (!parts.length) return [];

      // Get shape from the first constraint's gridSpec.
      const gridSpec = parts[0].gridSpec;
      const shape = GridShape.fromGridSpec(gridSpec);

      // Fill parts grid such that each cell has a reference to the part.
      const partsGrid = new Array(shape.numGridCells).fill(null);
      for (const part of parts) {
        for (const cellId of part.cells) {
          const { cell } = shape.parseCellId(cellId);
          partsGrid[cell] = part;
        }
      }

      // Create an indexMap by iterating the cells in order.
      // This ensures that we create a consistent index independent of the
      // order of the parts or cells inside the parts.
      const indexMap = new Map();
      const baseCharCode = GridShape.baseCharCode(shape);
      partsGrid.forEach((part) => {
        // Create a new index when we first encounter a part.
        if (!indexMap.has(part)) {
          const char = String.fromCharCode(baseCharCode + indexMap.size);
          indexMap.set(part, char);
        }
      });

      const layoutStr = partsGrid.map(part => indexMap.get(part)).join('');
      return this._argsToString(layoutStr);
    }
  }

  static Thermo = class Thermo extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Values must be in increasing order starting at the bulb.");
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Thermo',
      color: 'rgb(220, 220, 220)',
      width: LineOptions.THICK_LINE_WIDTH,
      startMarker: LineOptions.FULL_CIRCLE_MARKER,
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey((a, b) => a < b, numValues, valueOffset)
    );

    static displayName() {
      return 'Thermometer';
    }
  }

  static Whisper = class Whisper extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Adjacent values on the line must differ by at least the given difference.");
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(255, 200, 255)',
    };
    static ARGUMENT_CONFIG = {
      label: 'difference',
      default: 5,
    };

    constructor(difference, ...cells) {
      // German whisper lines omit the difference, so the
      // first argument is actually a cell
      if (!Number.isFinite(+difference)) {
        cells.unshift(difference);
        difference = 5;
      }
      super(difference, ...cells);
      this.cells = cells;
      this.difference = +difference;
    }

    static fnKey = memoize((difference, numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => a >= b + difference || a <= b - difference,
        numValues, valueOffset)
    );

    chipLabel() {
      return `Whisper (${this.difference})`;
    }
  }

  static Renban = class Renban extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Digits on the line must be consecutive and non-repeating, in any order.");
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(230, 190, 155)',
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static fnKey = memoize((numCells, numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => Math.abs(a - b) < numCells && a !== b,
        numValues, valueOffset)
    );
  }

  static Modular = class Modular extends SudokuConstraintBase {
    static DESCRIPTION = (
      `Every sequential group of 'mod' cells on a the line must have
       different values when taken modulo 'mod'.
       If mod = 3, then every group of three cells on the line must contain a
       digit from the group 147, one from 258, and one from 369.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(230, 190, 155)',
      dashed: true,
    };
    static ARGUMENT_CONFIG = {
      label: 'mod',
      default: 5,
    };

    constructor(mod, ...cells) {
      super(mod, ...cells);
      this.cells = cells;
      this.mod = +mod;
    }

    static displayName() {
      return 'Modular Line';
    }

    chipLabel() {
      return `Modular (${this.mod})`;
    }

    static neqFnKey = memoize((mod, numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => (a % mod) !== (b % mod),
        numValues, valueOffset)
    );

    static eqFnKey = memoize((mod, numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => (a % mod) === (b % mod),
        numValues, valueOffset)
    );
  }

  static Entropic = class Entropic extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Every sequential group of 3 cells on a the line must have different
      values from the groups {1,2,3}, {4,5,6}, and {7,8,9}.`)
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(255, 100, 255)',
      dashed: true,
    };
    static VALIDATE_CELLS_FN = (cells, shape) => (
      shape.numValues === 9 && shape.valueOffset === 0);

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static displayName() {
      return 'Entropic Line';
    }

    static fnKey = memoize((numValues) =>
      fnToBinaryKey(
        (a, b) => (((a - 1) / 3) | 0) !== (((b - 1) / 3) | 0),
        numValues)
    );
  }

  static RegionSumLine = class RegionSumLine extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values on the line have an equal sum N within each
      box it passes through. If a line passes through the
      same box more than once, each individual segment of
      such a line within that box sums to N separately.

      If the grid has no boxes, then jigsaw regions are used instead.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(100, 200, 100)',
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }

  static Between = class Between extends SudokuConstraintBase {
    static DESCRIPTION = (`
        Values on the line must be strictly between the values in the circles.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(200, 200, 255)',
      startMarker: LineOptions.EMPTY_CIRCLE_MARKER,
      endMarker: LineOptions.EMPTY_CIRCLE_MARKER
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }

  static Lockout = class Lockout extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values on the line must be not be between the values in the diamonds.
      The values in the diamonds must differ by the difference given.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(200, 200, 255)',
      startMarker: LineOptions.DIAMOND_MARKER,
      endMarker: LineOptions.DIAMOND_MARKER
    };
    static ARGUMENT_CONFIG = {
      label: 'min diff',
      default: 4,
    };

    constructor(minDiff, ...cells) {
      super(minDiff, ...cells);
      this.cells = cells;
      this.minDiff = minDiff;
    }

    static displayName() {
      return 'Lockout Line';
    }

    chipLabel() {
      return `Lockout (${this.minDiff})`;
    }
  }

  static Palindrome = class Palindrome extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The values along the line form a palindrome.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(200, 200, 255)',
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey((a, b) => a === b, numValues, valueOffset)
    );
  }

  static Zipper = class Zipper extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Digits which are equal distance from the center of the zipper have the
      same sum. For odd length lines, the center digit is the sum.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(180, 180, 255)',
      dashed: true,
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }

  static SumLine = class SumLine extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The line can be divided into segments that each sum to the given sum.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      color: 'rgb(100, 200, 100)',
      dashed: true,
    };
    static ARGUMENT_CONFIG = {
      label: 'sum',
      default: 10,
    };

    static LOOPS_ALLOWED = true;

    constructor(sum, ...cells) {
      super(sum, ...cells);
      this.cells = cells;
      this.sum = sum;
    }

    chipLabel() {
      return `Sum Line (${this.sum})`;
    }
  }

  static Regex = class Regex extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Digits along the line, read in order, must match the provided regular
      expression. Grouping '()', alternation '|', wildcard '.', and the
      quantifiers '*', '+', '?', and '{n}', '{n,}', '{n,m}' are supported.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'CustomLine',
      nodeMarker: LineOptions.SMALL_EMPTY_CIRCLE_MARKER,
      dashed: '0.5 2 2 2',
    };
    static ARGUMENT_CONFIG = {
      label: 'pattern',
      long: true,
    };

    constructor(pattern, ...cells) {
      pattern = String(pattern ?? '').replace(/\s/g, '');
      super(pattern, ...cells);
      this.pattern = pattern;
      this.cells = cells;
    }

    displayKey() {
      return this.pattern;
    }

    chipLabel() {
      return `Regex (${this.pattern})`;
    }

    static encodePattern(pattern) {
      // Use Base64 encoding for the pattern.
      // This creates shorter URLs. They aren't human readable, but any
      // escaping scheme would have the same issue.
      return Base64Codec.encodeString(pattern);
    }

    static decodePattern(encodedPattern) {
      let decoded = '';
      try {
        if (encodedPattern.includes('%') || encodedPattern.includes('.')) {
          // For backward compatibility, keep the old URL-encoded format.
          decoded = decodeURIComponent(encodedPattern);
        } else {
          decoded = Base64Codec.decodeToString(encodedPattern);
        }
      } catch (err) {
        throw new Error('Invalid encoded regex pattern. ' + err);
      }
      return decoded;
    }

    static *makeFromArgs(args, shape) {
      const [patternToken, ...items] = args;
      const pattern = this.decodePattern(patternToken);

      let cells = [];
      const flush = () => {
        if (cells.length) {
          const constraint = new this(pattern, ...cells);
          cells = [];
          return constraint;
        }
        return null;
      };

      for (const item of items) {
        if (!item.length) {
          const constraint = flush();
          if (constraint) yield constraint;
          continue;
        }
        cells.push(item);
      }

      const constraint = flush();
      if (constraint) yield constraint;
    }

    static serialize(constraints) {
      const sortedConstraints = [...constraints].sort();

      const parts = [];
      for (const group of groupSortedBy(sortedConstraints, c => c.pattern)) {
        const pattern = group[0].pattern;
        const encodedPattern = this.encodePattern(pattern);

        const items = [];
        let first = true;
        for (const constraint of group) {
          if (!first) items.push('');
          items.push(...constraint.cells);
          first = false;
        }

        parts.push(this._argsToString(encodedPattern, ...items));
      }

      return parts.join('');
    }
  }

  static NFA = class NFA extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Digits along the line, read in order, must be accepted by the provided
      Non-deterministic finite automaton (NFA).`);
    static CATEGORY = 'StateMachine';
    static DISPLAY_CONFIG = {
      displayClass: 'CustomLine',
      nodeMarker: LineOptions.SMALL_EMPTY_CIRCLE_MARKER,
      dashed: '0.5 2 2 2',
    };
    static ARGUMENT_CONFIG = {
      label: 'definition',
      long: true,
    };

    constructor(encodedNFA, name, ...cells) {
      super(encodedNFA, name, ...cells);
      this.encodedNFA = encodedNFA;
      this.name = name;
      this.cells = cells;
    }

    displayKey() {
      return this.encodedNFA;
    }

    static _countStates = memoize((encodedNFA) => {
      return NFASerializer.deserialize(encodedNFA).numStates();
    });

    static displayName() {
      return 'State Machine';
    }

    chipLabel() {
      const name = this.name ? ` "${this.name}"` : '';
      const numStates = this.constructor._countStates(this.encodedNFA);
      return `NFA${name} (${numStates} states)`;
    }

    static encodeSpec(spec, numValues, valueOffset = 0) {
      const nfa = javascriptSpecToNFA(spec, numValues, valueOffset);
      return NFASerializer.serialize(nfa);
    }

    static *makeFromArgs(args, shape) {
      const [encodedNFA, ...items] = args;

      for (const group of parseNamedCellGroups(items, this.uriDecodeArg)) {
        yield new this(encodedNFA, group.name, ...group.cells);
      }
    }

    static serialize(constraints) {
      return serializeNamedCellGroups(
        constraints,
        c => c.encodedNFA,
        name => this.uriEncodeArg(name),
        (encodedNFA, items) => this._argsToString(encodedNFA, ...items));
    }
  }

  static NoBoxes = class NoBoxes extends SudokuConstraintBase {
    static DESCRIPTION = (`
      No standard box regions.`);
    static CATEGORY = 'LayoutCheckbox';
    static DISPLAY_CONFIG = { displayClass: 'DefaultRegions' };
    static UNIQUENESS_KEY_FIELD = 'type';
  }

  static RegionSize = class RegionSize extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The size of default boxes. Jigsaw pieces must be of this size.`);
    static CATEGORY = 'Region';
    static DISPLAY_CONFIG = { displayClass: 'DefaultRegions' };
    static UNIQUENESS_KEY_FIELD = 'type';

    constructor(size) {
      super(size);
      this.size = +size;
    }
  }

  static RegionSameValues = class RegionSameValues extends SudokuConstraintBase {
    static DESCRIPTION = (`
      All the largest-size regions (which could include rows, columns, boxes and
      jigsaw pieces) must contain the same set of values.`);
    static CATEGORY = 'Region';
    static UNIQUENESS_KEY_FIELD = 'type';
  }

  static StrictKropki = class StrictKropki extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Only explicitly marked cell pairs satisfy Kropki (black/white dot)
      constraints.`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => a !== b * 2 && b !== a * 2 && b !== a - 1 && b !== a + 1,
        numValues, valueOffset)
    );
  }

  static StrictXV = class StrictXV extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Only explicitly marked cell pairs satisfy XV constraints.`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => a + b !== 5 && a + b !== 10,
        numValues, valueOffset)
    );
  }

  static Shape = class Shape extends SudokuConstraintBase {
    static DESCRIPTION = (`The number of rows and columns in the grid.`);
    static CATEGORY = 'Shape';
    static UNIQUENESS_KEY_FIELD = 'type';
    static _DEFAULT_SPECS = new Set([
      SHAPE_9x9.name,
      `${SHAPE_9x9.gridDimsStr}~${SHAPE_9x9.numValues}`,
      `${SHAPE_9x9.gridDimsStr}~1-${SHAPE_9x9.numValues}`,
    ]);

    constructor(gridDims, ...optionalValueRange) {
      super(gridDims, ...optionalValueRange);

      this.gridSpec = gridDims;

      if (optionalValueRange.length) this.gridSpec += `~${optionalValueRange[0]}`;
    }

    static *makeFromArgs(args, shape) {
      // Reconstruct gridSpec from args the same way the constructor does,
      // and verify it matches the already-parsed shape.
      const constraint = new this(...args);
      if (GridShape.fromGridSpec(constraint.gridSpec).name !== shape.name) {
        throw Error('Inconsistent Shape constraints.');
      }

      yield constraint;
    }

    static serialize(constraints) {
      if (constraints.length !== 1) {
        throw Error('Only one Shape constraint is allowed');
      }

      const c = constraints[0];
      if (this._DEFAULT_SPECS.has(c.gridSpec)) {
        return '';
      }

      return super.serialize(constraints);
    }

    static getShapeFromGridSpec(gridSpec) {
      if (!gridSpec) {
        return GridShape.fromGridSize(
          SHAPE_9x9.numRows, SHAPE_9x9.numCols);
      }
      return GridShape.fromGridSpec(gridSpec);
    }
  }

  static Windoku = class Windoku extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values in the 3x3 windoku boxes must be uniques.`);
    static CATEGORY = 'LayoutCheckbox';
    static DISPLAY_CONFIG = { displayClass: 'Windoku' };
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) => shape.isSquare();

    static regions = memoize((shape, size = null) => {
      const numRows = shape.numRows;
      const numCols = shape.numCols;
      const effectiveSize = size ?? shape.numValues;
      const [boxHeight, boxWidth] = GridShape.boxDimsForSize(
        numRows, numCols, effectiveSize);
      if (!boxHeight) return [];

      const regions = [];

      for (let i = 1; i + boxWidth < numCols; i += boxWidth + 1) {
        for (let j = 1; j + boxHeight < numRows; j += boxHeight + 1) {
          const cells = [];
          for (let k = 0; k < effectiveSize; k++) {
            const row = j + (k % boxHeight | 0);
            const col = i + (k / boxHeight | 0);
            cells.push(shape.cellIndex(row, col));
          }
          regions.push(cells);
        }
      }

      return regions;
    }, (shape, size = null) => `${shape.gridDimsStr}~${size ?? shape.numValues}`);
  }

  static DisjointSets = class DisjointSets extends SudokuConstraintBase {
    static DESCRIPTION = (`
      No digit may appear in the same position in any two boxes.`);
    static CATEGORY = 'LayoutCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) => shape.isSquare();
  }

  static AntiKnight = class AntiKnight extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Cells which are a knight's move away cannot have the same value.`);
    static CATEGORY = 'LayoutCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static displayName() {
      return 'Anti-Knight';
    }
  }

  static Doppelganger = class Doppelganger extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Every region (row, column, box) contains 0 and all but one of the digits
      1-N.
      No two regions of the same type may miss the same digit.
      At each 0, the missing digits from each region differs.
      Only square grids with values 0-N are supported.`);
    static CATEGORY = 'LayoutCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) =>
      shape.isSquare()
      && shape.valueOffset === -1
      && shape.numValues === shape.numRows + 1;

    getVarCellGroups(shape) {
      const defaultSize = GridShape.defaultNumValues(
        shape.numRows, shape.numCols);
      const [boxHeight, boxWidth] = GridShape.boxDimsForSize(
        shape.numRows, shape.numCols, defaultSize);
      const boxCount = boxHeight ? boxHeight * boxWidth : 0;
      return [
        { prefix: 'DGZ', label: 'Doppelganger zero', count: 1, hidden: true },
        { prefix: 'DGR', label: 'Doppelganger row', count: shape.numCols },
        { prefix: 'DGC', label: 'Doppelganger column', count: shape.numRows },
        { prefix: 'DGB', label: 'Doppelganger box', count: boxCount, columns: boxWidth || 0 },
      ];
    }
  }

  static AntiKing = class AntiKing extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Cells which are a king's move away cannot have the same value.`);
    static CATEGORY = 'LayoutCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static displayName() {
      return 'Anti-King';
    }
  }

  static AntiTaxicab = class AntiTaxicab extends SudokuConstraintBase {
    static DESCRIPTION = (`
      A cell that contains a digit x can't have a taxicab distance of

      exactly x from another cell with the digit x.
      A taxicab distance from cell A to cell B is the minimum
      possible distance from cell A to cell B when traversed only through
      adjacent cells.`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) => shape.valueOffset === 0;

    static displayName() {
      return 'Anti-Taxicab';
    }

    static taxicabCells(row, col, dist, shape) {
      const cells = [];
      const numRows = shape.numRows;
      const numCols = shape.numCols;

      for (let r = 0; r < numRows; r++) {
        const rDist = Math.abs(r - row);
        if (rDist === 0 || rDist >= dist) continue;

        const cDist = dist - rDist;
        if (col - cDist >= 0) {
          cells.push(shape.cellIndex(r, col - cDist));
        }
        if (col + cDist < numCols) {
          cells.push(shape.cellIndex(r, col + cDist));
        }
      }

      return cells;
    }
  }

  static AntiConsecutive = class AntiConsecutive extends SudokuConstraintBase {
    static DESCRIPTION = (`
      No adjacent cells can have consecutive values.`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => (a !== b + 1 && a !== b - 1 && a !== b),
        numValues, valueOffset)
    );

    static displayName() {
      return 'Anti-Consecutive';
    }
  }

  static GlobalEntropy = class GlobalEntropy extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Each 2x2 box in the grid has to contain a low digit (1, 2, 3),
      a middle digit (4, 5, 6) and a high digit (7, 8, 9).`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) =>
      shape.numValues === 9 && shape.valueOffset === 0;
  }

  static GlobalMod = class GlobalMod extends SudokuConstraintBase {
    // NOTE: This is just called GlobalMod so it can be expanded to other
    //       moduli in backward-compatible way.
    static DESCRIPTION = (`
      Each 2x2 box in the grid has to contain a digit from (1, 4, 7),
      a digit from (2, 5, 8) and a digit from (3, 6, 9).`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';

    static displayName() {
      return 'Global Mod 3';
    }
  }

  static FullRankTies = class FullRankTies extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Configures when ties are allowed for Full Rank ordering, where all rows
      and columns are ranked in order when read as numbers, with the forward
      and reverse directions considered separately.
      Note that "No ranks can tie" affects the grid even when there are no
      FullRank clues present.`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) => shape.isSquare();
    static ARGUMENT_CONFIG = {
      inputType: 'select',
      label: 'FullRank ties',
      default: 'only-unclued',
      options: [
        { value: 'none', text: 'No ranks' },
        { value: 'only-unclued', text: 'Unclued ranks only' },
        { value: 'any', text: 'Any rank' },
      ],
    };

    constructor(ties) {
      super(ties);
      this.ties = ties;

      if (!this.constructor.ARGUMENT_CONFIG.options.map(o => o.value).includes(ties)) {
        throw new Error('Invalid FullRankTies: ' + ties);
      }
    }
  }

  static DutchFlatmates = class DutchFlatmates extends SudokuConstraintBase {
    static DESCRIPTION = (`
      All 5's in the grid must have a 1 directly above it or a 9 directly below
      it. It may have both, but it doesn't need both.
      Only supported for when the allowed values are 1-9.`);
    static CATEGORY = 'Global';
    static UNIQUENESS_KEY_FIELD = 'type';
    static VALIDATE_SHAPE_FN = (shape) =>
      shape.numValues === 9 && shape.valueOffset === 0;
  }

  static Diagonal = class Diagonal extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values along the diagonal must be unique.`);
    static CATEGORY = 'LayoutCheckbox';
    static DISPLAY_CONFIG = { displayClass: 'Diagonal' };
    static ARGUMENT_CONFIG = {
      options: [
        { value: 1, text: '╱' },
        { value: -1, text: '╲' },
      ],
    };
    static UNIQUENESS_KEY_FIELD = 'direction';
    static VALIDATE_SHAPE_FN = (shape) => shape.isSquare();

    constructor(direction) {
      super(direction);
      this.direction = +direction;
    }
  }

  static WhiteDot = class WhiteDot extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Kropki white dot: values must be consecutive. Adjacent cells only.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Dot',
      color: 'white',
    };
    static VALIDATE_CELLS_FN = this._hasAdjacentCells;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => a === b + 1 || a === b - 1,
        numValues, valueOffset)
    );

    static displayName() {
      return '○ ±1';
    }

    chipLabel() {
      if (this.cells.length === 2) {
        return `○ [${this.cells}]`;
      } else {
        return `○ (${this.cells.length} cells)`;
      }
    }

    adjacentPairs(shape) {
      return this.constructor._adjacentCellPairs(this.cells, shape);
    }
  }

  static BlackDot = class BlackDot extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Kropki black dot: one value must be double the other. Adjacent cells only.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Dot',
      color: 'black',
    };
    static VALIDATE_CELLS_FN = this._hasAdjacentCells;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static displayName() {
      return '● ×÷2';
    }

    chipLabel() {
      if (this.cells.length === 2) {
        return `● [${this.cells}]`;
      } else {
        return `● (${this.cells.length} cells)`;
      }
    }

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey(
        (a, b) => a === b * 2 || b === a * 2,
        numValues, valueOffset)
    );

    adjacentPairs(shape) {
      return this.constructor._adjacentCellPairs(this.cells, shape);
    }
  }

  static GreaterThan = class GreaterThan extends SudokuConstraintBase {
    static DESCRIPTION = (
      `A cell must be greater than any later adjacent cells.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GreaterThan',
    };

    static VALIDATE_CELLS_FN = this._hasAdjacentCells;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static fnKey = memoize((numValues, valueOffset = 0) =>
      fnToBinaryKey((a, b) => a > b, numValues, valueOffset)
    );

    adjacentPairs(shape) {
      return this.constructor._adjacentCellPairs(this.cells, shape);
    }

    chipLabel() {
      if (this.cells.length === 2) {
        return `> [${this.cells}]`;
      } else {
        return `> (${this.cells.length} cells)`;
      }
    }

  }

  static X = class X extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values must add to 10. Adjacent cells only.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Letter',
    };
    static VALIDATE_CELLS_FN = this._hasAdjacentCells;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static displayName() {
      return 'X: 10Σ';
    }

    chipLabel() {
      if (this.cells.length === 2) {
        return `X [${this.cells}]`;
      } else {
        return `X (${this.cells.length} cells)`;
      }
    }

    adjacentPairs(shape) {
      return this.constructor._adjacentCellPairs(this.cells, shape);
    }
  }

  static ValueIndexing = class ValueIndexing extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Arrows point from a cell with digit X towards the same digit X,
      where the digit in the second cell on the line indicates how many cells
      away the digit X is on the line.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      startMarker: LineOptions.SMALL_FULL_CIRCLE_MARKER,
      arrow: true,
      dashed: true,
    };
    static VALIDATE_CELLS_FN = (cells, shape) => cells.length > 2;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }


  static V = class V extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values must add to 5. Adjacent cells only.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Letter',
    };
    static VALIDATE_CELLS_FN = this._hasAdjacentCells;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static displayName() {
      return 'V: 5Σ';
    }

    chipLabel() {
      if (this.cells.length === 2) {
        return `V [${this.cells}]`;
      } else {
        return `V (${this.cells.length} cells)`;
      }
    }

    adjacentPairs(shape) {
      return this.constructor._adjacentCellPairs(this.cells, shape);
    }
  }

  static Arrow = class Arrow extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values along the arrow must sum to the value in the circle.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      startMarker: LineOptions.EMPTY_CIRCLE_MARKER,
      arrow: true
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }

  static DoubleArrow = class DoubleArrow extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The sum of the values along the line equal the sum of the values in the
      circles.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'GenericLine',
      startMarker: LineOptions.EMPTY_CIRCLE_MARKER,
      endMarker: LineOptions.EMPTY_CIRCLE_MARKER
    };
    static VALIDATE_CELLS_FN = (cells, shape) => cells.length > 2;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }

  static PillArrow = class PillArrow extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The sum of the values along the line equal the 2-digit or 3-digit
      number in the pill.
      Numbers in the pill are read from left to right, top to bottom.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'PillArrow',
    };
    static ARGUMENT_CONFIG = {
      options: [
        { value: 2, text: '2-digit' },
        { value: 3, text: '3-digit' },
      ],
    };
    static VALIDATE_CELLS_FN = (cells, shape) => cells.length > 2;

    constructor(pillSize, ...cells) {
      super(pillSize, ...cells);
      this.pillSize = +pillSize;
      this.cells = cells;
    }

    chipLabel() {
      return `Pill Arrow (${this.pillSize}-digit)`;
    }
  }

  static Cage = class Cage extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values must add up to the given sum. All values must be unique.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
      labelField: 'sum',
    };
    static ARGUMENT_CONFIG = {
      label: 'sum',
    };
    static VALIDATE_CELLS_FN = this._cellsAreValidCage;

    constructor(sum, ...cells) {
      super(sum, ...cells);
      this.cells = cells;
      this.sum = +sum;
    }

    chipLabel() {
      return `Cage (${this.sum})`;
    }
  }

  static RellikCage = class RellikCage extends SudokuConstraintBase {
    static DESCRIPTION = (
      `Any combination of one or more digits within the cage cannot sum to the given value.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
      labelField: 'displayLabel',
    };
    static ARGUMENT_CONFIG = {
      label: 'sum',
    };
    static VALIDATE_CELLS_FN = this._cellsAreValidCage;

    constructor(sum, ...cells) {
      super(sum, ...cells);
      this.cells = cells;
      this.sum = sum;
      this.displayLabel = `≠${sum}`;
    }

    chipLabel() {
      return `Rellik Cage (${this.displayLabel})`;
    }
  }

  static EqualityCage = class EqualityCage extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Cages much have an equal number of even and odd digits, and an equal
      number of low and high digits. If the digit range is odd, then the
      middle digit cannot be included in the cage. All digits must be unique.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
      pattern: ShadedRegionOptions.HORIZONTAL_LINE_PATTERN,
    };
    static VALIDATE_CELLS_FN = this._cellsAreValidCage;

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    chipLabel() {
      return `Equality Cage`;
    }
  }

  static Sum = class Sum extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values must add up to the given sum.
      Values don't need to be unique (use 'Cage' for uniqueness).`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
      pattern: ShadedRegionOptions.CHECKERED_PATTERN,
      labelField: 'sum',
    };
    static ARGUMENT_CONFIG = {
      label: 'sum',
    };

    constructor(sum, ...cells) {
      super(sum, ...cells);
      this.cells = cells;

      const parts = String(sum).split('_');
      this.sum = +parts[0];
      if (!Number.isInteger(this.sum)) {
        throw Error('Sum must be an integer: ' + parts[0]);
      }

      if (parts.length > 1) {
        this.coeffs = parts.slice(1).map(Number);
        for (const c of this.coeffs) {
          if (!Number.isInteger(c) || Math.abs(c) > 100) {
            throw Error('Coefficients must be integers between -100 and 100: ' + c);
          }
        }
        if (this.coeffs.length !== cells.length) {
          throw Error(
            `Coefficient count (${this.coeffs.length}) must match ` +
            `cell count (${cells.length})`);
        }
      } else {
        this.coeffs = null;
      }
    }

    chipLabel() {
      if (this.coeffs) {
        return `Sum (${this.sum}) [${this.coeffs.join(',')}]`;
      }
      return `Sum (${this.sum})`;
    }
  }

  static LittleKiller = class LittleKiller extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Values along diagonal must add to the given sum. Values may repeat.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '$CLUE',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DIAGONAL;
    static ZERO_VALUE_OK = true;

    chipLabel() {
      return `Little Killer (${this.value})`;
    }

    static cellMap = memoize(
      (shape) => {
        let map = {};
        const numRows = shape.numRows;
        const numCols = shape.numCols;

        const seen = new Set();

        const addLittleKiller = (row, col, dr, dc) => {
          let cells = [];
          for (; row >= 0 && col >= 0 && col < numCols && row < numRows;
            row += dr, col += dc) {
            cells.push(shape.makeCellId(row, col));
          }
          if (cells.length <= 1) return;
          const sorted = [...cells].sort().join(',');
          if (seen.has(sorted)) return;

          seen.add(sorted);
          map[cells[0]] = cells;
        };

        // Left side.
        for (let row = 0; row < numRows - 1; row++) addLittleKiller(row, 0, 1, 1);
        // Right side.
        for (let row = 1; row < numRows - 1; row++) addLittleKiller(row, numCols - 1, -1, -1);
        // Top side.
        for (let col = 1; col < numCols; col++) addLittleKiller(0, col, 1, -1);
        // Bottom side.
        for (let col = 1; col < numCols - 1; col++) addLittleKiller(numRows - 1, col, -1, 1);

        return map;
      },
      (shape) => shape.gridDimsStr);
  }

  static XSum = class XSum extends OutsideConstraintBase {
    static DESCRIPTION = (`
      The sum of the first X numbers must add up to the given sum.
      X is the number in the first cell in the direction of the row or
      column.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '⟨$CLUE⟩',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE;

    static displayName() {
      return 'X-Sum';
    }
  }

  static Sandwich = class Sandwich extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Values between the 1 and the 9 in the row or column must add to the
      given sum. Clues can only be applied to the top or the left of the
      grid.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '$CLUE',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_SINGLE_LINE;
    static ZERO_VALUE_OK = true;

    chipLabel() {
      return `Sandwich [${this.id} ${this.value}]`;
    }
  }

  static Lunchbox = class Lunchbox extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The numbers sandwiched between the smallest number and the largest
      number of the lunchbox adds up to the given sum. Numbers must be
      distinct.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
      lineConfig: { color: 'rgba(100, 100, 100, 0.2)' },
      labelField: 'sum',
    };
    static ARGUMENT_CONFIG = {
      label: 'sum',
      default: 0,
    };

    constructor(sum, ...cells) {
      super(sum, ...cells);
      this.cells = cells;
      this.sum = sum;
    }

    chipLabel() {
      return `Lunchbox (${this.sum})`;
    }
  }

  static Skyscraper = class Skyscraper extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Digits in the grid represent skyscrapers of that height.
      Higher skyscrapers obscure smaller ones.
      Clues outside the grid show the number of visible skyscrapers in that
      row / column from the clue's direction of view. 0-valued cells do not
      count as skyscrapers.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '[$CLUE]',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE;
  }

  static HiddenSkyscraper = class HiddenSkyscraper extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Digits in the grid represent skyscrapers of that height.
      Higher skyscrapers obscure smaller ones.
      Clues outside the grid show the first hidden skyscraper in that
      row/column from the clue's direction of view.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '|$CLUE|',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE;
    static ZERO_VALUE_OK = true;
  }

  static NumberedRoom = class NumberedRoom extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Clues outside the grid indicate the digit which has to be placed in
      the Nth cell in the corresponding direction, where N is the digit
      placed in the first cell in that direction.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: ':$CLUE:',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE;
    static ZERO_VALUE_OK = true;
  }

  static FullRank = class FullRank extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Considering all rows and columns as numbers read from the direction
      of the clue and ranked from lowest (1) to highest, a clue represents
      where in the ranking that row/column lies. For tie handling, set the
      Full Rank Mode in the Global constraints.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '#$CLUE',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE;
    static VALIDATE_SHAPE_FN = (shape) => shape.isSquare();
  }

  static AllDifferent = class AllDifferent extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values must be unique.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'BorderedRegion',
      inset: 1.5,
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }
  }

  static ContainAtLeast = class ContainAtLeast extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The comma-separated values must be present in the selected squares.
      If value is must be contained at least as many times as is
      repeated in the list.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
      pattern: ShadedRegionOptions.DIAGONAL_PATTERN,
      labelField: 'valueStr',
    };
    static ARGUMENT_CONFIG = {
      label: 'values',
    };

    constructor(values, ...cells) {
      super(values, ...cells);
      this.cells = cells;
      this.values = values;
      this.valueStr = values.replace(/_/g, ',');
    }

    chipLabel() {
      return `ContainAtLeast (${this.valueStr})`;
    }
  }

  static ContainExact = class ContainExact extends SudokuConstraint.ContainAtLeast {
    static DESCRIPTION = (`
      The comma-separated values must be present in the selected squares.
      If value is must be contained exactly as many times as is
      repeated in the list.`);

    chipLabel() {
      return `ContainExact (${this.valueStr})`;
    }
  };

  static SameValues = class SameValues extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The cells are taken as a series of sets of the same size.
      Each set must contain the same values, including counts if values are
      repeated.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'BorderedRegion',
      fillOpacity: 0.1,
      inset: 2,
      splitFn: (constraint) => constraint.splitCells(),
    };
    static ARGUMENT_CONFIG = {
      label: 'num sets',
      default: 2,
      options: (cells) => {
        const options = [];
        for (let i = 2; i <= cells.length; i++) {
          if (cells.length % i === 0) {
            options.push({ text: `${i} sets`, value: i });
          }
        }
        return options;
      },
    };

    constructor(numSets, ...cells) {
      super(numSets, ...cells);
      this.cells = cells;
      this.numSets = numSets;
    }

    static displayName() {
      return 'Same Value Sets';
    }

    chipLabel() {
      return `Same Value Sets (${this.numSets} sets)`;
    }

    splitCells() {
      const setSize = this.cells.length / this.numSets;
      if (!Number.isInteger(setSize)) {
        throw new Error('Number of cells must be a multiple of the number of sets');
      }
      const sets = [];
      for (let i = 0; i < this.numSets; i++) {
        sets.push(this.cells.slice(i * setSize, (i + 1) * setSize));
      }
      return sets;
    }

    static fnKey = memoize((numValues, valueOffset = 0) => {
      return fnToBinaryKey((a, b) => a === b, numValues, valueOffset);
    });
  }

  static Quad = class Quad extends SudokuConstraintBase {
    static DESCRIPTION = (`
      All the given values must be present in the surrounding 2x2 square.
      Select a 2x2 square to enable.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Quad',
    };
    static ARGUMENT_CONFIG = {
      label: 'values',
    };
    static VALIDATE_CELLS_FN = this._cellsAre2x2Square;
    static UNIQUENESS_KEY_FIELD = 'topLeftCell';

    constructor(topLeftCell, ...values) {
      super(topLeftCell, ...values);
      this.topLeftCell = topLeftCell;
      this.values = values;
    }

    chipLabel() {
      return `Quad (${this.values.join(',')})`;
    }

    static cells(topLeftCell) {
      const shape = SHAPE_MAX;
      const { row, col } = shape.parseCellId(topLeftCell);
      return [
        topLeftCell,
        shape.makeCellId(row, col + 1),
        shape.makeCellId(row + 1, col),
        shape.makeCellId(row + 1, col + 1),
      ];
    }

    getCells(shape) {
      return this.constructor.cells(this.topLeftCell);
    }
  }

  static Binary = class Binary extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Legacy: Applies a custom binary relationship between consecutive pairs of cells.");
    static CATEGORY = null;
    static DISPLAY_CONFIG = null;

    static *makeFromArgs(args, shape) {
      const [key, ...rest] = args;
      // Convert base64url encoding by swapping - and _
      const convertedKey = key.replace(/[-_]/g, c => c === '-' ? '_' : '-');
      yield* SudokuConstraint.Pair.makeFromArgs([convertedKey, ...rest], shape);
    }
  }

  static BinaryX = class BinaryX extends SudokuConstraint.Binary {
    static DESCRIPTION = (
      "Legacy: Applies a custom binary relationship between all pairs of the given cells.");
    static CATEGORY = null;
    static DISPLAY_CONFIG = null;

    static *makeFromArgs(args, shape) {
      const [key, ...rest] = args;
      // Convert base64url encoding by swapping - and _
      const convertedKey = key.replace(/[-_]/g, c => c === '-' ? '_' : '-');
      yield* SudokuConstraint.PairX.makeFromArgs([convertedKey, ...rest], shape);
    }
  }

  // Pair uses the correct Base64Codec encoding.
  static Pair = class Pair extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Applies a custom binary relationship between consecutive pairs of cells.");
    static CATEGORY = 'Pairwise';
    static DISPLAY_CONFIG = {
      displayClass: 'CustomLine',
      nodeMarker: LineOptions.SMALL_EMPTY_CIRCLE_MARKER,
    };

    constructor(key, name, ...cells) {
      super(key, name, ...cells);
      this.key = key;
      this.name = name;
      this.cells = cells;
    }

    displayKey() {
      return this.key;
    }

    groupId() {
      return `${this.type}-${this.key}`;
    }

    chipLabel() {
      let label = 'Pairwise';
      if (this.name) label += ` "${this.name}"`;
      return label;
    }

    static serialize(constraints) {
      return serializeNamedCellGroups(
        constraints,
        c => c.key,
        name => this.uriEncodeArg(name),
        (key, items) => this._argsToString(key, ...items));
    }

    static *makeFromArgs(args, shape) {
      const [key, ...items] = args;

      for (const group of parseNamedCellGroups(items, this.uriDecodeArg)) {
        yield new this(key, group.name, ...group.cells);
      }
    }

    static fnToKey(fn, numValues, valueOffset = 0) {
      return fnToBinaryKey(fn, numValues, valueOffset);
    }

    static displayName() {
      return 'Pairwise: Consecutive pairs';
    }
  }

  // PairX applies the constraint to all pairs of cells.
  static PairX = class PairX extends SudokuConstraint.Pair {
    static DESCRIPTION = (
      "Applies a custom binary relationship between all pairs of the given cells.");
    static DISPLAY_CONFIG = {
      displayClass: 'CustomLine',
      nodeMarker: LineOptions.SMALL_FULL_CIRCLE_MARKER,
    };

    static fnToKey(fn, numValues, valueOffset = 0) {
      // Make the function symmetric.
      return fnToBinaryKey(
        (a, b) => fn(a, b) && fn(b, a),
        numValues, valueOffset);
    }

    chipLabel() {
      let label = 'Pairwise*';
      if (this.name) label += ` "${this.name}"`;
      return label;
    }

    static displayName() {
      return 'Pairwise: All pairs';
    }
  }

  static Indexing = class Indexing extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Column indexing: For a cell in column C, the value (V) of the cell
      tells where the value C is placed in that row. Specifically, if the
      cell has coordinates (R, C) and value V, then cell (R, V) has the
      value C.Row indexing is the same, but for rows.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'Indexing',
    };
    static VALIDATE_CELLS_FN = (cells, shape) => cells.length > 0;

    static ROW_INDEXING = 'R';
    static COL_INDEXING = 'C';
    static ARGUMENT_CONFIG = {
      options: [
        { value: this.COL_INDEXING, text: 'Column' },
        { value: this.ROW_INDEXING, text: 'Row' },
      ],
    }

    constructor(indexType, ...cells) {
      super(indexType, ...cells);
      this.indexType = indexType;
      this.cells = cells;
    }

    chipLabel() {
      return `${this.indexTypeStr()} Indexing`;
    }

    indexTypeStr() {
      const option = this.constructor.ARGUMENT_CONFIG.options.find(
        opt => opt.value === this.indexType);
      return option ? option.text : 'Unknown';
    }
  }

  static CountingCircles = class CountingCircles extends SudokuConstraintBase {
    static DESCRIPTION = (`
      The value in a circles counts the number of circles with the same
      value. Each set of circles is independent.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'CountingCircles',
    };

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    chipLabel() {
      return `Counting Circles (${this.cells.length})`;
    }
  }

  static Given = class Given extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Constrains the initial values for the given cell.");
    static CATEGORY = 'GivenCandidates';
    static DISPLAY_CONFIG = { displayClass: 'Givens' };
    static UNIQUENESS_KEY_FIELD = 'cell';

    constructor(cell, ...values) {
      super(cell, ...values);
      this.cell = cell;
      this.values = values;
    }

    static *makeFromArgs(args, shape) {
      for (const valueId of args) {
        const { cellId, values } = shape.parseValueId(valueId);
        yield new this(cellId, ...values);
      }
    }

    static mergeConstraints(existing, incoming) {
      const intersected = existing.values.filter(
        v => incoming.values.includes(v));
      return new this(existing.cell, ...intersected);
    }

    static serialize(constraints) {
      const args = constraints.map(
        c => `${c.cell}_${c.values.join('_')}`);
      return this._argsToString(...args);
    }

    chipLabel() {
      let valueStr = this.values.join(',');
      if (this.values.length !== 1) valueStr = `[${valueStr}]`;
      return `${this.cell}: ${valueStr}`;
    }

    getCells(shape) {
      return [this.cell];
    }
  }

  static Priority = class Priority extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Assigns a priority level to cells for solving order.");
    constructor(priority, ...cells) {
      super(priority, ...cells);
      this.cells = cells;
      this.priority = priority;
    }
  }

  static Var = class Var extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Adds variables to use as extra cells outside the grid.");
    static CATEGORY = 'Experimental';
    static UNIQUENESS_KEY_FIELD = 'prefix';

    constructor(prefix, label, count) {
      super(prefix, label, count);
      if (!/^[A-Z]+$/.test(prefix)) {
        throw new Error(
          `Var prefix must be upper-case letters A-Z, got: ${prefix}`);
      }
      this.prefix = prefix;
      this.label = label || '';
      this.count = +count || 1;
      this.groups = [
        { prefix: 'V' + this.prefix, label: this.label, count: this.count }
      ];
    }

    static *makeFromArgs(args, shape) {
      const [prefix, encodedLabel, count] = args;
      const label = this.uriDecodeArg(encodedLabel || '');
      yield new this(prefix, label, count);
    }

    static serialize(constraints) {
      return constraints.map(c => {
        if (c.count === 1 && !c.label) {
          return this._argsToString(c.prefix);
        }
        const encodedLabel = this.uriEncodeArg(c.label);
        if (c.count === 1) {
          return this._argsToString(c.prefix, encodedLabel);
        }
        return this._argsToString(c.prefix, encodedLabel, c.count);
      }).join('');
    }

    getVarCellGroups(shape) {
      return this.groups;
    }

    chipLabel() {
      return `Var: $${this.prefix} (${this.count})`;
    }
  }
}

export class UserScriptExecutor {
  constructor() {
    this._nextId = 1;
    this._pending = new Map();
    this._initWorker();
  }

  _initWorker() {
    this._worker = new Worker('js/user_script_worker.js' + self.VERSION_PARAM);
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    this._worker.onmessage = (e) => {
      const { type, id, result, error } = e.data;

      if (type === 'ready') {
        this._resolveReady();
        return;
      }

      if (type === 'initError') {
        this._rejectReady(new Error(error));
        return;
      }

      const p = this._pending.get(id);
      if (!p) return;

      // Handle streaming messages (don't remove from pending).
      if (type === 'log') {
        p.onLog?.(e.data.segments);
        return;
      }
      if (type === 'status') {
        p.onStatus?.(e.data.segments);
        return;
      }

      // Final result - remove from pending.
      this._pending.delete(id);
      clearTimeout(p.timer);
      if (error) {
        const err = new Error(error);
        if (e.data.helpUrl) err.helpUrl = e.data.helpUrl;
        if (e.data.helpText) err.helpText = e.data.helpText;
        p.reject(err);
      } else {
        p.resolve(result);
      }
    };
  }

  _resetTimer(id, ms) {
    const p = this._pending.get(id);
    if (!p) return;

    clearTimeout(p.timer);
    if (!Number.isFinite(ms)) {
      p.timer = null;
      return;
    }
    p.timer = setTimeout(() => {
      if (this._pending.has(id)) {
        this._pending.delete(id);
        p.reject(new Error('Execution timed out.'));
        this._restartWorker();
      }
    }, ms);
  }

  _restartWorker(reason = 'Execution aborted') {
    this._worker.terminate();
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this._pending.clear();
    this._initWorker();
  }

  async _call(type, payload, timeoutMs, callbacks = {}) {
    await this._readyPromise;

    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, {
        resolve,
        reject,
        timer: null,
        onLog: callbacks.onLog,
        onStatus: callbacks.onStatus,
      });
      this._resetTimer(id, self.USER_SCRIPT_TIMEOUT || timeoutMs);
      this._worker.postMessage({ id, type, payload: { ...payload, id } });
    });
  }

  compilePairwise(type, fnStr, numValues, valueOffset) {
    return this._call('compilePairwise', { type, fnStr, numValues, valueOffset }, 1000);
  }

  compileStateMachine(spec, numValues, numCells, isUnified, valueOffset) {
    return this._call('compileStateMachine', { spec, numValues, numCells, isUnified, valueOffset }, 3000);
  }

  convertUnifiedToSplit(code) {
    return this._call('convertUnifiedToSplit', { code }, 100);
  }

  runSandboxCode(code, callbacks, currentConstraintStr) {
    return this._call(
      'runSandboxCode',
      { code, currentConstraintStr },
      null,
      callbacks);
  }

  abort() {
    // Abort all pending sandbox executions by restarting the worker.
    this._restartWorker();
  }
}

export const fnToBinaryKey = (fn, numValues, valueOffset = 0) => {
  const NUM_BITS = 6;
  const array = [];

  let v = 0;
  let vIndex = 0;
  for (let i = 1; i <= numValues; i++) {
    for (let j = 1; j <= numValues; j++) {
      v |= (!!fn(i + valueOffset, j + valueOffset)) << vIndex;
      if (++vIndex === NUM_BITS) {
        array.push(v);
        vIndex = 0;
        v = 0;
      }
    }
  }
  array.push(v);

  // Trim trailing zeros.
  while (array.length && !array[array.length - 1]) array.pop();

  return Base64Codec.encode6BitArray(array);
};

export const binaryKeyToFnString = (key, numValues, valueOffset = 0) => {
  const NUM_BITS = 6;
  const array = Base64Codec.decodeTo6BitArray(key);
  const lookup = {};

  let keyIndex = 0;
  let vIndex = 0;
  for (let i = 1; i <= numValues; i++) {
    for (let j = 1; j <= numValues; j++) {
      if (array[keyIndex] & 1) {
        (lookup[i + valueOffset] ||= []).push(j + valueOffset);
      }
      array[keyIndex] >>= 1;
      if (++vIndex === NUM_BITS) {
        vIndex = 0;
        keyIndex++;
      }
    }
  }

  // Format as a JavaScript lookup expression.
  const entries = Object.entries(lookup)
    .map(([a, bs]) => `${a}:[${bs.join(',')}]`)
    .join(',');
  return `({${entries}})[a]?.includes(b)`;
};

export const encodedNFAToJsSpec = (encodedNFA, valueOffset = 0) => {
  const nfa = NFASerializer.deserialize(encodedNFA);
  return nfaToJavascriptSpec(nfa, valueOffset);
};

function* parseNamedCellGroups(items, decodeName) {
  let currentName = '';
  let currentCells = [];

  const flush = () => {
    if (!currentCells.length) return null;
    const group = { name: currentName, cells: currentCells };
    currentCells = [];
    return group;
  };

  for (const item of items) {
    if (!item.length) {
      const group = flush();
      if (group) yield group;
      continue;
    }

    if (item[0] === '_') {
      const group = flush();
      if (group) yield group;
      currentName = decodeName(item.substring(1));
      continue;
    }

    currentCells.push(item);
  }

  const group = flush();
  if (group) yield group;
}

function serializeNamedCellGroups(constraints, keyOf, encodeName, argsForGroup) {
  const parts = [];
  const sorted = [...constraints].sort(
    (a, b) => keyOf(a).localeCompare(keyOf(b)) || a.name.localeCompare(b.name));

  for (const keyGroup of groupSortedBy(sorted, keyOf)) {
    const key = keyOf(keyGroup[0]);
    const items = [];

    for (const nameGroup of groupSortedBy(keyGroup, c => c.name)) {
      let first = true;
      for (const part of nameGroup) {
        if (first) {
          items.push('_' + encodeName(part.name));
          first = false;
        } else {
          items.push('');
        }
        items.push(...part.cells);
      }
    }

    parts.push(argsForGroup(key, items));
  }

  return parts.join('');
}