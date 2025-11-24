const { memoize, MultiMap, arrayRemoveValue, groupSortedBy, Base64Codec } = await import('./util.js' + self.VERSION_PARAM);
const { GridShape, SHAPE_9x9, SHAPE_MAX } = await import('./grid_shape.js' + self.VERSION_PARAM);

export class CellArgs {
  constructor(args, type) {
    const numArgs = args.length;
    if (!numArgs) {
      throw ('No cells provided for ' + type);
    }

    this._isLoop = false;
    if (args[numArgs - 1] == 'LOOP') {
      if (!SudokuConstraint[type].LOOPS_ALLOWED) {
        throw ('Loops are not allowed for ' + type);
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

  constructor(...args) {
    this.args = args;
    this.type = this.constructor.name;
  }

  static *makeFromArgs(...args) {
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
    if (this == SudokuConstraint.Given) type = '';
    const arr = [type, ...args];
    return '.' + arr.join('~');
  }

  toString() {
    return this.constructor.serialize([this]);
  }

  forEachTopLevel(fn) {
    if (this.type === 'Set') {
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
    if (!shape) throw ('Unknown shape: ' + shape);
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

  // Get the cells associated with this constraints.
  // Mainly for display purposes.
  getCells(shape) {
    return this.cells || [];
  }

  static _makeRegions(fn, gridSize) {
    const regions = [];
    for (let r = 0; r < gridSize; r++) {
      const cells = [];
      for (let i = 0; i < gridSize; i++) {
        cells.push(fn(r, i));
      }
      regions.push(cells);
    }
    return regions;
  }

  static rowRegions = memoize((shape) => {
    const gridSize = shape.gridSize;
    return this._makeRegions((r, i) => r * gridSize + i, gridSize);
  });
  static colRegions = memoize((shape) => {
    const gridSize = shape.gridSize;
    return this._makeRegions((c, i) => i * gridSize + c, gridSize);
  });
  static boxRegions = memoize((shape) => {
    if (shape.noDefaultBoxes) return [];

    const gridSize = shape.gridSize;
    const boxWidth = shape.boxWidth;
    const boxHeight = shape.boxHeight;

    return this._makeRegions(
      (r, i) => ((r / boxHeight | 0) * boxHeight + (i % boxHeight | 0)) * gridSize
        + (r % boxHeight | 0) * boxWidth + (i / boxHeight | 0), gridSize);
  });
  static disjointSetRegions = memoize((shape) => {
    const gridSize = shape.gridSize;
    const boxWidth = shape.boxWidth;
    const boxHeight = shape.boxHeight;
    return this._makeRegions(
      (r, i) => ((i / boxHeight | 0) * boxHeight + (r % boxHeight | 0)) * gridSize
        + (i % boxHeight | 0) * boxWidth + (r / boxHeight | 0), gridSize);
  });
  static square2x2Regions = memoize((shape) => {
    const gridSize = shape.gridSize;
    const regions = [];

    for (let i = 0; i < gridSize - 1; i++) {
      for (let j = 0; j < gridSize - 1; j++) {
        regions.push([
          shape.cellIndex(i, j),
          shape.cellIndex(i, j + 1),
          shape.cellIndex(i + 1, j),
          shape.cellIndex(i + 1, j + 1),
        ]);
      }
    }

    return regions;
  });

  static fullLineCellMap = memoize((shape) => {
    let map = new Map();
    const gridSize = shape.gridSize;

    const rowRegions = this.rowRegions(shape);
    for (let row = 0; row < gridSize; row++) {
      const cells = rowRegions[row].map(c => shape.makeCellIdFromIndex(c));
      map.set(`R${row + 1},1`, cells);
      map.set(`R${row + 1},-1`, cells.slice().reverse());
    }
    const colRegions = this.colRegions(shape);
    for (let col = 0; col < gridSize; col++) {
      const cells = colRegions[col].map(c => shape.makeCellIdFromIndex(c));
      map.set(`C${col + 1},1`, cells);
      map.set(`C${col + 1},-1`, cells.slice().reverse());
    }

    return map;
  });

  static _hasAdjacentCells(cells, shape) {
    // Convert all cells to row/col coordinates
    const coords = cells.map(c => shape.parseCellId(c));
    const seen = new Array(coords.length).fill(false);

    // For each cell, check if it has at least one adjacent cell
    for (let i = 0; i < coords.length; i++) {
      if (seen[i]) continue;

      const ci = coords[i];

      for (let j = 0; j < coords.length; j++) {
        if (i === j) continue;
        const cj = coords[j];
        if (Math.abs(ci.row - cj.row) + Math.abs(ci.col - cj.col) === 1) {
          seen[i] = true;
          seen[j] = true;
          break;
        }
      }

      if (!seen[i]) return false;
    }

    return true;
  }

  static _adjacentCellPairs(cells, shape) {
    const coords = cells.map(c => shape.parseCellId(c));
    const pairs = [];
    for (let i = 0; i < coords.length; i++) {
      const ci = coords[i];
      for (let j = i + 1; j < coords.length; j++) {
        const cj = coords[j];
        if (Math.abs(ci.row - cj.row) + Math.abs(ci.col - cj.col) === 1) {
          pairs.push([ci.cell, cj.cell]);
        }
      }
    }
    return pairs;
  }

  static _cellsAre2x2Square(cells, shape) {
    if (cells.length != 4) return false;
    cells = cells.map(
      c => shape.parseCellId(c)).sort((a, b) => a.cell - b.cell);
    let { row, col } = cells[0];
    return (
      (cells[1].row == row && cells[1].col == col + 1) &&
      (cells[2].row == row + 1 && cells[2].col == col) &&
      (cells[3].row == row + 1 && cells[3].col == col + 1));
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
  static MEDIUM_FULL_CIRCLE_MARKER = 5;
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
    arrowId = arrowId.toUpperCase();

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
      if (arrowId[0] == 'C') {
        dirStr = dir > 0 ? '↓' : '↑';
      } else {
        dirStr = dir > 0 ? '→' : '←';
      }

      return `${this.constructor.displayName()} [${this.id} ${dirStr}${this.value}]`;
    } else {
      return super.chipLabel();
    }
  }

  static *makeFromArgs(...args) {
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

    if (clueType != this.CLUE_TYPE_DOUBLE_LINE) {
      return constraints.map(
        c => this._argsToString(c.value, c.id)).join('');
    }

    // Combine double line parts.
    const seenIds = new Map();
    for (const part of constraints) {
      const { id, arrowId, value } = part;
      let [_, dir] = arrowId.split(',');
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
    opacity: 0.35,
    dashed: true,
  };

  // Create an allow-list for the types of constraints that can be inside a
  // composite.
  // Other types of constraints either:
  //  - Don't make sense to next inside one (such as Shape)
  //  - Interact with other constraints that make them difficult to implement
  //    such as StrictKropki or constraints that define regions.
  //  - Or would just be a bit confusing to include given the above two caveats
  //    (such as Anti-knight). It is easier to ban everything in the layout
  //    panel.
  static _ALLOWED_CATEGORIES = new Set(
    ['LinesAndSets', 'GivenCandidates', 'OutsideClue', 'Composite', 'CustomBinary']);

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

  static _isSingleConstraint(constraints, serialized) {
    // Check if we only had one constraint to serialize.
    // This handles nested composites.
    if (constraints.length === 1 && constraints[0].constraints.length === 1) {
      return true;
    }

    // Otherwise check if there is a new constraint that is started after the
    // first one.
    // This handles ordinary constraints which have been combined.
    if (serialized.length > 1 && serialized.indexOf('.', 1) === -1) {
      return true;
    }

    return false;
  }
}

export class SudokuConstraint {

  static Set = class Set extends SudokuConstraintBase {
    static DESCRIPTION = "Container for constraints. Do not use directly.";
    static CATEGORY = null;
    static IS_COMPOSITE = true;
    static CAN_ABSORB = ['Set', 'And'];

    constructor(constraints) {
      super(constraints);
      this.constraints = constraints;
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
    static CAN_ABSORB = ['Or'];

    static _serializeSingle(constraint) {
      const parts = [];
      // We can't combine any constraints within an 'Or'.
      for (const c of constraint.constraints) {
        parts.push(c.constructor.serialize([c]));
      }

      const innerStr = parts.join('');
      if (this._isSingleConstraint([constraint], innerStr)) {
        return innerStr;
      }
      return `.${this.name}${innerStr}.End`;
    }

    static serialize(constraints) {
      return constraints.map(c => this._serializeSingle(c)).join('');
    }
  }

  static And = class And extends CompositeConstraintBase {
    static DESCRIPTION = (
      "All the contained constraints must be satisfied.");
    static CAN_ABSORB = ['Set', 'And'];

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

      const innerStr = parts.join('');
      if (this._isSingleConstraint(constraints, innerStr)) {
        return innerStr;
      }
      return `.${this.name}${innerStr}.End`;
    }
  }

  static End = class End extends SudokuConstraintBase {
    static DESCRIPTION = (
      "Marks the end of a composite constraint group.");
  }

  static Jigsaw = class Jigsaw extends SudokuConstraintBase {
    static DESCRIPTION = (
      "An irregular region which must contain all digits without repetition.");
    static CATEGORY = 'Jigsaw';
    static DISPLAY_CONFIG = { displayClass: 'Jigsaw' };
    static UNIQUENESS_KEY_FIELD = 'cells';

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    chipLabel() { return ''; }

    static *makeFromArgs(...args) {
      const grid = args[0];
      const shape = GridShape.fromNumCells(grid.length);
      if (!shape) throw Error('Invalid jigsaw regions');

      const map = new MultiMap();
      for (let i = 0; i < grid.length; i++) {
        map.add(grid[i], i);
      }

      for (const [_, region] of map) {
        if (region.length === shape.gridSize) {
          yield new this(
            ...region.map(c => shape.makeCellIdFromIndex(c)));
        }
      }
    }

    static serialize(parts) {
      if (!parts.length) return [];

      const shape = GridShape.fromGridSize(parts[0].cells.length);

      // Fill parts grid such that each cell has a reference to the part.
      const partsGrid = new Array(shape.numCells).fill(null);
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

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey((a, b) => a < b, numValues)
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
      if (difference != +difference) {
        cells.unshift(difference);
        difference = 5;
      }
      super(difference, ...cells);
      this.cells = cells;
      this.difference = +difference;
    }

    static fnKey = memoize((difference, numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a >= b + difference || a <= b - difference,
        numValues)
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

    static fnKey = memoize((numCells, numValues) =>
      SudokuConstraint.BinaryX.fnToKey(
        (a, b) => Math.abs(a - b) < numCells && a != b,
        numValues)
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
      this.mod = mod;
    }

    static displayName() {
      return 'Modular Line';
    }

    chipLabel() {
      return `Modular (${this.mod})`;
    }

    static fnKey = memoize((mod, numValues) =>
      SudokuConstraint.BinaryX.fnToKey(
        (a, b) => (a % mod) != (b % mod),
        numValues)
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

    constructor(...cells) {
      super(...cells);
      this.cells = cells;
    }

    static displayName() {
      return 'Entropic Line';
    }

    static fnKey = memoize((numValues) =>
      SudokuConstraint.BinaryX.fnToKey(
        (a, b) => (((a - 1) / 3) | 0) != (((b - 1) / 3) | 0),
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

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey((a, b) => a == b, numValues)
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
      Digits along the line, read in order, must match the provided regular expression.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'RegexLine',
      startMarker: LineOptions.MEDIUM_FULL_CIRCLE_MARKER,
    };
    static ARGUMENT_CONFIG = {
      label: 'pattern',
    };

    constructor(pattern, ...cells) {
      pattern = String(pattern ?? '');
      super(pattern, ...cells);
      this.pattern = pattern;
      this.cells = cells;
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
        throw ('Invalid encoded regex pattern. ' + err);
      }
      return decoded;
    }

    static *makeFromArgs(patternToken, ...items) {
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

  static NoBoxes = class NoBoxes extends SudokuConstraintBase {
    static DESCRIPTION = (`
      No standard box regions.`);
    static CATEGORY = 'LayoutCheckbox';
    static DISPLAY_CONFIG = { displayClass: 'DefaultRegionsInverted' };
    static UNIQUENESS_KEY_FIELD = 'type';
  }

  static StrictKropki = class StrictKropki extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Only explicitly marked cell pairs satisfy Kropki (black/white dot)
      constraints.`);
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a != b * 2 && b != a * 2 && b != a - 1 && b != a + 1,
        numValues)
    );
  }
  static StrictXV = class StrictXV extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Only explicitly marked cell pairs satisfy XV constraints.`);
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a + b != 5 && a + b != 10,
        numValues)
    );
  }
  static Shape = class Shape extends SudokuConstraintBase {
    static DESCRIPTION = (`The size of the grid.`);
    static CATEGORY = 'Shape';
    static UNIQUENESS_KEY_FIELD = 'type';
    static DEFAULT_SHAPE = SHAPE_9x9;

    constructor(gridSpec) {
      super(gridSpec);
      this.gridSpec = gridSpec;
    }

    static serialize(constraints) {
      if (constraints.length != 1) {
        throw Error('Only one Shape constraint is allowed');
      }
      if (constraints[0].gridSpec === this.DEFAULT_SHAPE.name) {
        return '';
      }

      return super.serialize(constraints);
    }

    static getShapeFromGridSpec(gridSpec) {
      if (!gridSpec) return this.DEFAULT_SHAPE;
      return GridShape.fromGridSpec(gridSpec);
    }
  }

  static Windoku = class Windoku extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values in the 3x3 windoku boxes must be uniques.`);
    static CATEGORY = 'LayoutCheckbox';
    static DISPLAY_CONFIG = { displayClass: 'Windoku' };
    static UNIQUENESS_KEY_FIELD = 'type';

    static regions = memoize((shape) => {
      const gridSize = shape.gridSize;
      const boxWidth = shape.boxWidth;
      const boxHeight = shape.boxHeight;

      const regions = [];

      for (let i = 1; i + boxWidth < gridSize; i += boxWidth + 1) {
        for (let j = 1; j + boxHeight < gridSize; j += boxHeight + 1) {
          const cells = [];
          for (let k = 0; k < gridSize; k++) {
            const row = j + (k % boxHeight | 0);
            const col = i + (k / boxHeight | 0);
            cells.push(shape.cellIndex(row, col));
          }
          regions.push(cells);
        }
      }

      return regions;
    });
  }

  static DisjointSets = class DisjointSets extends SudokuConstraintBase {
    static DESCRIPTION = (`
      No digit may appear in the same position in any two boxes.`);
    static CATEGORY = 'LayoutCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';
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
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static displayName() {
      return 'Anti-Taxicab';
    }

    static taxicabCells(row, col, dist, shape) {
      const cells = [];
      const gridSize = shape.gridSize;

      for (let r = 0; r < gridSize; r++) {
        const rDist = Math.abs(r - row);
        if (rDist === 0 || rDist >= dist) continue;

        const cDist = dist - rDist;
        if (col - cDist >= 0) {
          cells.push(shape.cellIndex(r, col - cDist));
        }
        if (col + cDist < gridSize) {
          cells.push(shape.cellIndex(r, col + cDist));
        }
      }

      return cells;
    }
  }

  static AntiConsecutive = class AntiConsecutive extends SudokuConstraintBase {
    static DESCRIPTION = (`
      No adjacent cells can have consecutive values.`);
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => (a != b + 1 && a != b - 1 && a != b),
        numValues)
    );

    static displayName() {
      return 'Anti-Consecutive';
    }
  }

  static GlobalEntropy = class GlobalEntropy extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Each 2x2 box in the grid has to contain a low digit (1, 2, 3),
      a middle digit (4, 5, 6) and a high digit (7, 8, 9).`);
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';
  }

  static GlobalMod = class GlobalMod extends SudokuConstraintBase {
    // NOTE: This is just called GlobalMod so it can be expanded to other
    //       moduli in backward-compatible way.
    static DESCRIPTION = (`
      Each 2x2 box in the grid has to contain a digit from (1, 4, 7),
      a digit from (2, 5, 8) and a digit from (3, 6, 9).`);
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';

    static displayName() {
      return 'Global Mod 3';
    }
  }

  static DutchFlatmates = class DutchFlatmates extends SudokuConstraintBase {
    static DESCRIPTION = (`
      All 5's in the grid must have a 1 directly above it or a 9 directly below
      it. It may have both, but it doesn't need both.
      For non-9x9 grids, the 5 is replaced by the middle number and 9 by the
      maximum number.`);
    static CATEGORY = 'GlobalCheckbox';
    static UNIQUENESS_KEY_FIELD = 'type';
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

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a == b + 1 || a == b - 1,
        numValues)
    );

    static displayName() {
      return '○ ±1';
    }

    chipLabel() {
      if (this.cells.length == 2) {
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
      if (this.cells.length == 2) {
        return `● [${this.cells}]`;
      } else {
        return `● (${this.cells.length} cells)`;
      }
    }

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a == b * 2 || b == a * 2,
        numValues)
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

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey((a, b) => a > b, numValues)
    );

    adjacentPairs(shape) {
      return this.constructor._adjacentCellPairs(this.cells, shape);
    }

    chipLabel() {
      if (this.cells.length == 2) {
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
      if (this.cells.length == 2) {
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
      if (this.cells.length == 2) {
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
      this.sum = sum;
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
      For a grid size N, cages must have an equal number of low (<= N/2) and
      high (>= N/2+1) digits AND an equal number of even and odd digits.
      Equality cages can never contain the middle digit (N/2) when N is odd.
      Digits may not repeat in a cage.`);
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
      this.sum = sum;
    }

    chipLabel() {
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

    chipLabel() {
      return `Little Killer (${this.value})`;
    }

    static cellMap = memoize((shape) => {
      let map = {};
      const gridSize = shape.gridSize;

      const addLittleKiller = (row, col, dr, dc) => {
        let cells = [];
        for (; row >= 0 && col >= 0 && col < gridSize && row < gridSize;
          row += dr, col += dc) {
          cells.push(shape.makeCellId(row, col));
        }
        if (cells.length > 1) map[cells[0]] = cells;
      };

      // Left side.
      for (let row = 0; row < gridSize - 1; row++) addLittleKiller(row, 0, 1, 1);
      // Right side.
      for (let row = 1; row < gridSize - 1; row++) addLittleKiller(row, gridSize - 1, -1, -1);
      // Top side.
      for (let col = 1; col < gridSize; col++) addLittleKiller(0, col, 1, -1);
      // Bottom side.
      for (let col = 1; col < gridSize - 1; col++) addLittleKiller(gridSize - 1, col, -1, 1);

      return map;
    });
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
      given sum.`);
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
      row / column from the clue's direction of view.`);
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
  }

  static FullRank = class FullRank extends OutsideConstraintBase {
    static DESCRIPTION = (`
      Considering all rows and columns as numbers read from the direction
      of the clue and ranked from lowest (1) to highest, a clue represents
      where in the ranking that row/column lies.`);
    static CATEGORY = 'OutsideClue';
    static DISPLAY_CONFIG = {
      displayClass: 'OutsideClue',
      clueTemplate: '#$CLUE',
    };
    static CLUE_TYPE = OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE;
  }

  static AllDifferent = class AllDifferent extends SudokuConstraintBase {
    static DESCRIPTION = (`
      Values must be unique.`);
    static CATEGORY = 'LinesAndSets';
    static DISPLAY_CONFIG = {
      displayClass: 'ShadedRegion',
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
      splitFn: (constraint) => constraint.splitCells(),
    };
    static ARGUMENT_CONFIG = {
      label: 'num sets',
      default: 2,
      options: (cells) => {
        const options = [];
        for (let i = 2; i <= cells.length; i++) {
          if (cells.length % i == 0) {
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
        throw ('Number of cells must be a multiple of the number of sets');
      }
      const sets = [];
      for (let i = 0; i < this.numSets; i++) {
        sets.push(this.cells.slice(i * setSize, (i + 1) * setSize));
      }
      return sets;
    }

    static fnKey = memoize((numValues) => {
      return SudokuConstraint.Binary.fnToKey((a, b) => a == b, numValues);
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
      "Applies a custom binary relationship between consecutive pairs of cells.");
    static CATEGORY = 'CustomBinary';
    static DISPLAY_CONFIG = {
      displayClass: 'CustomBinary',
      startMarker: LineOptions.SMALL_EMPTY_CIRCLE_MARKER,
    };

    constructor(key, name, ...cells) {
      super(key, name, ...cells);
      this.key = key;
      this.name = name;
      this.cells = cells;
    }

    groupId() {
      return `${this.type}-${this.key}`;
    }

    chipLabel() {
      if (this.name) return `"${this.name}"`;
      return 'Custom';
    }

    static serialize(constraints) {
      const parts = [];

      // Sort so that all keys appear together, and names within keys.
      constraints.sort(
        (a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name));

      for (const keyGroup of groupSortedBy(constraints, c => c.key)) {
        const key = keyGroup[0].key;
        const items = [];

        for (const nameGroup of groupSortedBy(keyGroup, c => c.name)) {
          let first = true;
          for (const part of nameGroup) {
            if (first) {
              items.push('_' + this.encodeName(part.name));
              first = false;
            } else {
              items.push('');
            }
            items.push(...part.cells);
          }
        }

        parts.push(this._argsToString(key, ...items));
      }

      return parts.join('');
    }

    static *makeFromArgs(...args) {
      const [key, ...items] = args;

      let currentName = '';
      let currentCells = [];
      for (const item of items) {
        if (item.length && 'R' === item[0].toUpperCase()) {
          // This is a cell.
          currentCells.push(item);
          continue;
        }
        // Otherwise we are starting a new group. Yield the current one.
        if (currentCells.length) {
          yield new this(key, currentName, ...currentCells);
        }

        // Update the name if it has been replaced.
        if (item.length) {
          currentName = this.decodeName(item.substring(1));
        }

        currentCells = [];
      }

      if (currentCells.length) {
        yield new this(key, currentName, ...currentCells);
      }
    }

    static _binaryFnTo6BitArray(fn, numValues) {
      const NUM_BITS = 6;
      const array = [];

      let v = 0;
      let vIndex = 0;
      for (let i = 1; i <= numValues; i++) {
        for (let j = 1; j <= numValues; j++) {
          v |= (!!fn(i, j)) << vIndex;
          if (++vIndex == NUM_BITS) {
            array.push(v);
            vIndex = 0;
            v = 0;
          }
        }
      }
      array.push(v);

      // Trim trailing zeros.
      while (array.length && !array[array.length - 1]) array.pop();

      return array;
    }

    static fnToKey(fn, numValues) {
      const array = this._binaryFnTo6BitArray(fn, numValues);
      return Base64Codec.encode6BitArray(array);
    }

    static encodeName(displayName) {
      const name = encodeURIComponent(displayName);
      return name.replace(/\./g, '%2E').replace(/~/g, '%7E');
    }

    static decodeName(name) {
      let displayName = name;
      try {
        displayName = decodeURIComponent(name);
      } catch (e) { }
      return displayName;
    }
  }

  static BinaryX = class BinaryX extends SudokuConstraint.Binary {
    static DESCRIPTION = (
      "Applies a custom binary relationship between all pairs of the given cells.");
    static CATEGORY = 'CustomBinary';
    static DISPLAY_CONFIG = {
      displayClass: 'CustomBinary',
      startMarker: LineOptions.SMALL_FULL_CIRCLE_MARKER,
    };

    static fnToKey(fn, numValues) {
      // Make the function symmetric.
      return super.fnToKey(
        (a, b) => fn(a, b) && fn(b, a),
        numValues);
    }

    static displayName() {
      return 'Binary: Pairwise';
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

    static *makeFromArgs(...args) {
      const shape = SHAPE_MAX;
      for (const valueId of args) {
        const { cellId, values } = shape.parseValueId(valueId);
        yield new this(cellId, ...values);
      }
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
}