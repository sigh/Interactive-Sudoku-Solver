class GridShape {
  static _registry = new Map();
  static _numCellsLookup = new Map();
  static _register(shape) {
    this._registry.set(shape.name, shape);
    this._numCellsLookup.set(shape.numCells, shape);
  }
  static get(name) { return this._registry.get(name); }
  static fromNumCells(numCells) { return this._numCellsLookup.get(numCells); }

  constructor(gridSize, boxSize) {
    this.boxSize = boxSize;
    this.gridSize = gridSize;
    this.numValues = gridSize;
    this.numCells = gridSize * gridSize;

    this.name = `${gridSize}x${gridSize}`;

    this._valueBase = this.numValues + 1;

    this.allCells = [];
    for (let i = 0; i < this.numCells; i++) this.allCells.push(i);

    this.maxSum = this.gridSize * (this.gridSize + 1) / 2;

    Object.freeze(this);
    this.constructor._register(this);
  }

  makeValueId = (cellIndex, n) => {
    const cellId = this.makeCellIdFromIndex(cellIndex);
    return `${cellId}_${n}`;
  }

  makeCellId = (row, col) => {
    return `R${(row + 1).toString(this._valueBase)}C${(col + 1).toString(this._valueBase)}`;
  }

  makeCellIdFromIndex = (i) => {
    return this.makeCellId(...this.splitCellIndex(i));
  }

  cellIndex = (row, col) => {
    return row * this.gridSize + col;
  }

  splitCellIndex = (cell) => {
    return [cell / this.gridSize | 0, cell % this.gridSize | 0];
  }

  parseValueId = (valueId) => {
    let [cellId, ...values] = valueId.split('_');
    return {
      values: values.map(v => parseInt(v)),
      cellId: cellId,
      ...this.parseCellId(cellId),
    };
  }

  parseCellId = (cellId) => {
    let row = parseInt(cellId[1], this._valueBase) - 1;
    let col = parseInt(cellId[3], this._valueBase) - 1;
    return {
      cell: this.cellIndex(row, col),
      row: row,
      col: col,
    };
  }
}

const SHAPE_9x9 = new GridShape(9, 3);
const SHAPE_16x16 = new GridShape(16, 4);
const SHAPE_MAX = SHAPE_16x16;

class SudokuTextParser {
  static parseShortKillerFormat(text) {
    // Reference for format:
    // http://forum.enjoysudoku.com/understandable-snarfable-killer-cages-t6119.html

    const shape = SHAPE_9x9;
    const numCells = shape.numCells;
    const gridSize = shape.gridSize;

    if (text.length != numCells) return null;
    // Note: The second ` is just there so my syntax highlighter is happy.
    if (!text.match(/[<v>^`',`]/)) return null;
    if (!text.match(/^[0-9A-Za-j^<v>`'',.`]*$/)) return null;

    // Determine the cell directions.
    let cellDirections = [];
    for (let i = 0; i < numCells; i++) {
      switch (text[i]) {
        case 'v':
          cellDirections.push(i + gridSize);
          break;
        case '^':
          cellDirections.push(i - gridSize);
          break;
        case '<':
          cellDirections.push(i - 1);
          break;
        case '>':
          cellDirections.push(i + 1);
          break;
        case '`':
          cellDirections.push(i - gridSize - 1);
          break;
        case '\'':
          cellDirections.push(i - gridSize + 1);
          break;
        case ',':
          cellDirections.push(i + gridSize - 1);
          break;
        case '.':
          cellDirections.push(i + gridSize + 1);
          break;
        default:
          cellDirections.push(i);
      }
    }

    let cages = new Map();
    for (let i = 0; i < numCells; i++) {
      let cageCell = i;
      let count = 0;
      while (cellDirections[cageCell] != cageCell) {
        cageCell = cellDirections[cageCell];
        count++;
        if (count > gridSize) {
          throw ('Loop in Killer Sudoku input.');
        }
      }
      if (!cages.has(cageCell)) {
        let c = text[cageCell];
        let sum;
        if (c >= '0' && c <= '9') {
          sum = +c;
        } else if (c >= 'A' && c <= 'Z') {
          sum = c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
        } else if (c >= 'a' && c <= 'j') {
          sum = c.charCodeAt(0) - 'a'.charCodeAt(0) + 36;
        } else {
          // Not a valid cage, ignore.
          continue;
        }
        cages.set(cageCell, {
          sum: sum,
          cells: [],
        });
      }
      cages.get(cageCell).cells.push(shape.makeCellIdFromIndex(i));
    }

    let constraints = [];
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Cage(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Set(constraints);
  }

  static parseLongKillerFormat(text) {
    // Reference to format definition:
    // http://www.sudocue.net/forum/viewtopic.php?f=1&t=519

    if (!text.startsWith('3x3:')) return null;

    const shape = SHAPE_9x9;
    const numCells = shape.numCells;

    let parts = text.split(':');
    if (parts[2] != 'k') return null;
    if (parts.length != numCells + 4) return null;

    let cages = new Map();
    for (let i = 0; i < numCells; i++) {
      let value = +parts[i + 3];
      let cageId = value % 256;
      let cageSum = value / 256 | 0;

      if (!cageSum) continue;

      if (!cages.has(cageId)) {
        cages.set(cageId, { sum: cageSum, cells: [] });
      }
      cages.get(cageId).cells.push(shape.makeCellIdFromIndex(i));
    }

    let constraints = [];
    if (parts[1] == 'd') {
      constraints.push(new SudokuConstraint.Diagonal(1));
      constraints.push(new SudokuConstraint.Diagonal(-1));
    }
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Cage(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Set(constraints);
  }

  static SHAPE_TO_BASE_CHAR_CODE = new Map([
    [SHAPE_9x9, '1'.charCodeAt(0)],
    [SHAPE_16x16, 'A'.charCodeAt(0)],
  ])

  static parsePlainSudoku(text) {
    const shape = GridShape.fromNumCells(text.length);
    if (!shape) return null;

    const numCells = shape.numCells;
    const gridSize = shape.gridSize;

    const baseCharCode = this.SHAPE_TO_BASE_CHAR_CODE.get(shape);

    let fixedValues = [];
    let nonValueCharacters = [];
    for (let i = 0; i < numCells; i++) {
      let c = text.charCodeAt(i);
      if (c >= baseCharCode && c <= baseCharCode + gridSize - 1) {
        fixedValues.push(shape.makeValueId(i, c - baseCharCode + 1));
      } else {
        nonValueCharacters.push(c);
      }
    }
    if (new Set(nonValueCharacters).size > 1) return null;
    return new SudokuConstraint.Set([
      new SudokuConstraint.Shape(shape.name),
      new SudokuConstraint.Givens(...fixedValues),
    ]);
  }

  static parseJigsawLayout(text) {
    const shape = GridShape.fromNumCells(text.length);
    if (!shape) return null;

    const numCells = shape.numCells;
    const gridSize = shape.gridSize;

    const chars = new Set(text);
    if (chars.size != gridSize) return null;

    const counter = {};
    chars.forEach(c => counter[c] = 0);
    for (let i = 0; i < numCells; i++) {
      counter[text[i]]++;
    }

    if (Object.values(counter).some(c => c != gridSize)) return null;

    return new SudokuConstraint.Set([
      new SudokuConstraint.Shape(shape.name),
      new SudokuConstraint.Jigsaw(text),
      new SudokuConstraint.NoBoxes(),
    ]);
  }

  static parseJigsaw(text) {
    if (text.length % 2 !== 0) return null;

    const shape = GridShape.fromNumCells(text.length / 2);
    if (!shape) return null;

    const numCells = shape.numCells;

    const layout = this.parseJigsawLayout(text.substr(numCells));
    if (layout == null) return null;

    const fixedValues = this.parsePlainSudoku(text.substr(0, numCells));
    if (fixedValues == null) return null;

    return new SudokuConstraint.Set([layout, fixedValues]);
  }

  static parseGridLayout(rawText) {
    if (rawText.length < SHAPE_9x9.numCells * 2) return null;

    const parts = [...rawText.matchAll(/[.]|\d+/g)];
    const numParts = parts.length;

    let shape = null;
    if (numParts == SHAPE_9x9.numCells) { shape = SHAPE_9x9; }
    else if (numParts == SHAPE_16x16.numCells) { shape = SHAPE_16x16; }
    else { return; }

    let fixedValues = [];
    for (let i = 0; i < numParts; i++) {
      const cell = parts[i];
      if (cell == '.') continue;
      fixedValues.push(shape.makeValueId(i, cell));
    }

    return new SudokuConstraint.Set([
      new SudokuConstraint.Shape(shape.name),
      new SudokuConstraint.Givens(...fixedValues),
    ]);
  }

  static parseText(rawText) {
    // Remove all whitespace.
    const text = rawText.replace(/\s+/g, '');

    let constraint;

    constraint = this.parseShortKillerFormat(text);
    if (constraint) return constraint;

    constraint = this.parseLongKillerFormat(text);
    if (constraint) return constraint;

    constraint = this.parseJigsaw(text);
    if (constraint) return constraint;

    constraint = this.parseJigsawLayout(text);
    if (constraint) return constraint;

    constraint = this.parsePlainSudoku(text);
    if (constraint) return constraint;

    constraint = this.parseGridLayout(rawText);
    if (constraint) return constraint;

    return null;
  }
}

class SudokuConstraint {
  static DEFAULT_SHAPE = SHAPE_9x9;

  constructor(args) {
    this.args = args ? [...args] : [];
    this.type = this.constructor.name;
  }

  static fromString(str) {
    str = str.replace(/\s+/g, '');
    let items = str.split('.');
    if (items[0]) throw (
      'Invalid constraint string: Constraint must start with a "."');
    items.shift();

    let constraints = [];
    for (const item of items) {
      let args = item.split('~');
      let type = args.shift();
      if (!type) type = this.DEFAULT.name;
      if (!SudokuConstraint[type]) {
        throw ('Unknown constraint type: ' + type);
      }
      constraints.push(new SudokuConstraint[type](...args));
    }
    return new SudokuConstraint.Set(constraints);
  }

  toString() {
    let type = this.type;
    if (this.constructor == this.constructor.DEFAULT) type = '';
    let arr = [type, ...this.args];
    return '.' + arr.join('~');
  }

  static fromText(rawText) {
    const constraints = [];
    // Parse sections separated by a blank line separately,
    // and then merge their constraints.
    for (const part of rawText.split(/\n\s*\n/)) {
      let constraint = SudokuTextParser.parseText(part);
      if (!constraint) {
        constraint = SudokuConstraint.fromString(part);
      }
      constraints.push(constraint);
    }
    if (constraints.length == 1) return constraints[0];
    return new SudokuConstraint.Set(constraints);
  }

  static toLists(constraint) {
    const constraints = [];
    const metaConstraints = [];

    const toListRec = (c) => {
      if (c.type === 'Set') {
        c.constraints.forEach(toListRec);
      } else if (c.isMeta) {
        metaConstraints.push(c);
      } else {
        constraints.push(c);
      }
    };
    toListRec(constraint);

    return [constraints, metaConstraints];
  }

  static getMetaConfig(metaConstraints) {
    const metaConfig = new Map();

    for (const c of metaConstraints) {
      metaConfig.set(c.type, c.args);
    }

    return metaConfig;
  }

  static getShapeFromMeta(metaConstraint) {
    const shapeArgs = metaConstraint.get('Shape');
    const shape = shapeArgs ? GridShape.get(shapeArgs[0]) : this.DEFAULT_SHAPE;
    if (!shape) throw ('Unknown shape: ' + shape);
    return shape;
  }
  static getShape(constraint) {
    const [_, metaConstraints] = this.toLists(constraint);
    return this.getShapeFromMeta(this.getMetaConfig(metaConstraints));
  }

  static Set = class Set extends SudokuConstraint {
    constructor(constraints) {
      super(arguments);
      this.constraints = constraints;
    }

    toString() {
      return this.constraints.map(c => c.toString()).join('');
    }
  }

  static Jigsaw = class Jigsaw extends SudokuConstraint {
    constructor(grid) {
      super(arguments);
      this.grid = grid;
    }
  }

  static Thermo = class Thermo extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey((a, b) => a < b, numValues)
    );
  }

  static Whisper = class Whisper extends SudokuConstraint {
    constructor(difference, ...cells) {
      // German whisper lines omit the difference, so the
      // first argument is actually a cell
      if (difference != +difference) {
        cells.unshift(difference);
        difference = 5;
      }
      super(arguments);
      this.cells = cells;
      this.difference = +difference;
    }

    static fnKey = memoize((difference, numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a >= b + difference || a <= b - difference,
        numValues)
    );
  }

  static Renban = class Renban extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static RegionSumLine = class RegionSumLine extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static Between = class Between extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static Palindrome = class Palindrome extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey((a, b) => a == b, numValues)
    );
  }

  static _Meta = class _Meta extends SudokuConstraint {
    constructor(...args) { super(args); }
    isMeta = true;
  }
  static NoBoxes = class NoBoxes extends SudokuConstraint._Meta { }
  static StrictKropki = class StrictKropki extends SudokuConstraint._Meta {
    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a != b * 2 && b != a * 2 && b != a - 1 && b != a + 1,
        numValues)
    );
  }
  static StrictXV = class StrictXV extends SudokuConstraint._Meta {
    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a + b != 5 && a + b != 10,
        numValues)
    );
  }
  static Shape = class Shape extends SudokuConstraint._Meta {
    toString() {
      if (this.args[0] === SHAPE_9x9.name) return '';
      return super.toString();
    }
  }

  static Windoku = class Windoku extends SudokuConstraint {
    static regions = memoize((shape) => {
      const gridSize = shape.gridSize;
      const boxSize = shape.boxSize;

      const regions = [];

      for (let i = 1; i < gridSize; i += boxSize + 1) {
        for (let j = 1; j < gridSize; j += boxSize + 1) {
          const cells = [];
          for (let k = 0; k < gridSize; k++) {
            const row = i + (k % boxSize | 0);
            const col = j + (k / boxSize | 0);
            cells.push(shape.cellIndex(row, col));
          }
          regions.push(cells);
        }
      }

      return regions;
    });
  }

  static DisjointSets = class DisjointSets extends SudokuConstraint { }

  static AntiKnight = class AntiKnight extends SudokuConstraint { }

  static AntiKing = class AntiKing extends SudokuConstraint { }

  static AntiConsecutive = class AntiConsecutive extends SudokuConstraint {
    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => (a != b + 1 && a != b - 1 && a != b),
        numValues)
    );
  }

  static GlobalEntropy = class GlobalEntropy extends SudokuConstraint {
    static regions = memoize((shape) => {
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
  }

  static Diagonal = class Diagonal extends SudokuConstraint {
    constructor(direction) {
      super(arguments);
      this.direction = direction;
    }
  }

  static WhiteDot = class WhiteDot extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a == b + 1 || a == b - 1,
        numValues)
    );
  }

  static BlackDot = class BlackDot extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }

    static fnKey = memoize((numValues) =>
      SudokuConstraint.Binary.fnToKey(
        (a, b) => a == b * 2 || b == a * 2,
        numValues)
    );
  }

  static X = class X extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static V = class V extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static Arrow = class Arrow extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static Cage = class Cage extends SudokuConstraint {
    constructor(sum, ...cells) {
      super(arguments);
      this.cells = cells;
      this.sum = sum;
    }
  }

  static Sum = class Sum extends SudokuConstraint {
    constructor(sum, ...cells) {
      super(arguments);
      this.cells = cells;
      this.sum = sum;
    }
  }

  static LittleKiller = class LittleKiller extends SudokuConstraint {
    constructor(sum, id) {
      super(arguments);
      this.id = id;
      this.sum = sum;
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
        map[cells[0]] = cells;
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

  static XSum = class XSum extends SudokuConstraint {
    constructor(rowCol, sumInc, sumDec) {
      super(arguments);
      this.rowCol = rowCol.toUpperCase();
      this.sumDec = +sumDec;
      this.sumInc = +sumInc;
    }

    values() {
      return [this.sumInc, this.sumDec];
    }
  }

  static Sandwich = class Sandwich extends SudokuConstraint {
    constructor(sum, id) {
      super(arguments);
      this.id = id;
      this.sum = sum;
    }
  }

  static Skyscraper = class Skyscraper extends SudokuConstraint {
    constructor(rowCol, countInc, countDec) {
      super(arguments);
      this.rowCol = rowCol.toUpperCase();
      this.countInc = +countInc;
      this.countDec = +countDec;
    }

    values() {
      return [this.countInc, this.countDec];
    }
  }

  static AllDifferent = class AllDifferent extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static Quad = class Quad extends SudokuConstraint {
    constructor(topLeftCell, ...values) {
      super(arguments);
      this.topLeftCell = topLeftCell;
      this.values = values;
    }

    cells() {
      const shape = SHAPE_MAX;
      const { row, col } = shape.parseCellId(this.topLeftCell);
      return [
        this.topLeftCell,
        shape.makeCellId(row, col + 1),
        shape.makeCellId(row + 1, col),
        shape.makeCellId(row + 1, col + 1),
      ];
    }
  }

  static Binary = class Binary extends SudokuConstraint {
    constructor(key, ...items) {
      super(arguments);
      this.key = key;
      this.items = items;
    }

    static makeFromGroups(key, groups) {
      const items = [];
      let currentName = '';
      // Sort so that all names appear together.
      groups.sort((a, b) => a.name.localeCompare(b.name));

      for (const group of groups) {
        if (group.name == currentName) {
          items.push('');
        } else {
          currentName = group.name;
          items.push('_' + this.encodeName(currentName));
        }
        items.push(...group.cells);
      }

      return new this(key, ...items);
    }

    static *parseGroups(items, includeNames) {
      let currentName = '';
      let currentGroup = {
        cells: [],
        name: currentName,
      };
      for (const item of items) {
        if (item.length && item[0] == 'R' || item[0] == 'r') {
          // This is a cell.
          currentGroup.cells.push(item);
          continue;
        }
        // Otherwise we are starting a new group. Yield the current one.
        if (currentGroup.cells.length) yield currentGroup;

        // Update the name if it has been replaced.
        if (item.length && includeNames) {
          currentName = this.decodeName(item.substring(1));
        }

        currentGroup = {
          cells: [],
          name: currentName,
        };
      }

      if (currentGroup.cells.length) yield currentGroup;
    }

    static fnToKey(fn, numValues) {
      const array = this._fnTo6BitArray(fn, numValues);
      return Base64Codec.encode6BitArray(array);
    }

    static _fnTo6BitArray(fn, numValues) {
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
    static fnToKey(fn, numValues) {
      // Make the function symmetric.
      return super.fnToKey(
        (a, b) => fn(a, b) && fn(b, a),
        numValues);
    }
  }

  static Givens = class Givens extends SudokuConstraint {
    constructor(...values) {
      super(arguments);
      this.values = values;
    }
  }
  static FixedValues = this.Givens;  // For backwards compatibility.

  static Priority = class Priority extends SudokuConstraint {
    constructor(priority, ...cells) {
      super(arguments);
      this.cells = cells;
      this.priority = priority;
    }
  }

  static DEFAULT = this.Givens;

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
    const gridSize = shape.gridSize;
    const boxSize = shape.boxSize;
    return this._makeRegions(
      (r, i) => ((r / boxSize | 0) * boxSize + (i % boxSize | 0)) * gridSize
        + (r % boxSize | 0) * boxSize + (i / boxSize | 0), gridSize);
  });
  static disjointSetRegions = memoize((shape) => {
    const gridSize = shape.gridSize;
    const boxSize = shape.boxSize;
    return this._makeRegions(
      (r, i) => ((i / boxSize | 0) * boxSize + (r % boxSize | 0)) * gridSize
        + (i % boxSize | 0) * boxSize + (r / boxSize | 0), gridSize);
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
}

class SudokuBuilder {
  static build(constraint, debugOptions) {
    const [constraints, metaConstraints] = SudokuConstraint.toLists(constraint);
    const metaConfig = SudokuConstraint.getMetaConfig(metaConstraints);
    const shape = SudokuConstraint.getShapeFromMeta(metaConfig);

    return new SudokuSolver(
      this._handlers(constraints, shape, metaConfig),
      shape,
      debugOptions);
  }

  // Ask for a state update every 2**14 iterations.
  // NOTE: Using a non-power of 10 makes the display look faster :)
  static LOG_UPDATE_FREQUENCY = 14;

  static _unusedWorkers = [];

  static async buildInWorker(constraints, stateHandler, statusHandler, debugHandler) {
    // Ensure any pending terminations are enacted.
    await new Promise(r => setTimeout(r, 0));

    if (!this._unusedWorkers.length) {
      this._unusedWorkers.push(new Worker('js/worker.js' + VERSION_PARAM));
    }
    const worker = this._unusedWorkers.pop();
    worker.release = () => this._unusedWorkers.push(worker);

    const solverProxy = new SolverProxy(
      worker, stateHandler, statusHandler,
      debugHandler && debugHandler.getCallback());
    await solverProxy.init(
      constraints, this.LOG_UPDATE_FREQUENCY,
      debugHandler && debugHandler.getOptions());
    return solverProxy;
  }

  static *_handlers(constraints, shape, metaConfig) {
    const noBoxes = metaConfig.has('NoBoxes');
    yield* SudokuBuilder._rowColHandlers(shape);
    yield* SudokuBuilder._constraintHandlers(constraints, shape, noBoxes);
    if (noBoxes) {
      yield new SudokuConstraintHandler.NoBoxes();
    } else {
      yield* SudokuBuilder._boxHandlers(shape);
    }
    if (metaConfig.has('StrictKropki')) {
      const types = ['BlackDot', 'WhiteDot'];
      yield* SudokuBuilder._strictAdjHandlers(
        constraints.filter(x => types.includes(x.type)),
        shape,
        SudokuConstraint.StrictKropki.fnKey(shape.numValues));
    }
    if (metaConfig.has('StrictXV')) {
      const types = ['X', 'V'];
      yield* SudokuBuilder._strictAdjHandlers(
        constraints.filter(x => types.includes(x.type)),
        shape,
        SudokuConstraint.StrictXV.fnKey(shape.numValues));
    }
  }

  static *_rowColHandlers(shape) {
    for (const cells of SudokuConstraint.rowRegions(shape)) {
      yield new SudokuConstraintHandler.AllDifferent(cells);
    }
    for (const cells of SudokuConstraint.colRegions(shape)) {
      yield new SudokuConstraintHandler.AllDifferent(cells);
    }
  }

  static *_boxHandlers(shape) {
    for (const cells of SudokuConstraint.boxRegions(shape)) {
      yield new SudokuConstraintHandler.AllDifferent(cells);
    }
  }

  static *_strictAdjHandlers(constraints, shape, fnKey) {
    const numCells = shape.numCells;
    const intCmp = (a, b) => a - b;
    const pairId = p => p[0] + p[1] * numCells;

    // Find all the cell pairs that have constraints.
    const cellPairs = constraints
      .map(x => x.cells.map(c => shape.parseCellId(c).cell));
    cellPairs.forEach(p => p.sort(intCmp));
    const pairIds = new Set(cellPairs.map(pairId));

    // Add negative constraints for all other cell pairs.
    for (const p of this._adjacentCellPairs(shape)) {
      p.sort(intCmp);
      if (pairIds.has(pairId(p))) continue;
      yield new SudokuConstraintHandler.BinaryConstraint(
        p[0], p[1], fnKey);
    }
  }

  static * _constraintHandlers(constraints, shape, noBoxes) {
    const gridSize = shape.gridSize;

    for (const constraint of constraints) {
      let cells;
      switch (constraint.type) {
        case 'AntiKnight':
          yield* this._antiHandlers(shape,
            (r, c) => [[r + 1, c + 2], [r + 2, c + 1], [r + 1, c - 2], [r + 2, c - 1]]);
          break;

        case 'AntiKing':
          yield* this._antiHandlers(shape, (r, c) => [[r + 1, c + 1], [r + 1, c - 1]]);
          break;

        case 'AntiConsecutive':
          yield* this._antiConsecutiveHandlers(shape);
          break;

        case 'Jigsaw':
          const grid = constraint.grid;
          const map = new Map();
          for (let i = 0; i < grid.length; i++) {
            const v = grid[i];
            if (!map.has(v)) map.set(v, []);
            map.get(v).push(i);
          }

          for (const [_, cells] of map) {
            if (cells.length == gridSize) {
              yield new SudokuConstraintHandler.AllDifferent(cells);
            }
          }

          // Just to let the solver know that this is a jigsaw puzzle.
          yield new SudokuConstraintHandler.Jigsaw([...map.values()]);
          break;

        case 'Diagonal':
          cells = [];
          for (let r = 0; r < gridSize; r++) {
            let c = constraint.direction > 0 ? gridSize - r - 1 : r;
            cells.push(shape.cellIndex(r, c));
          }
          yield new SudokuConstraintHandler.AllDifferent(cells);
          break;

        case 'Arrow':
          const [negativeCell, ...positiveCells] = (
            constraint.cells.map(c => shape.parseCellId(c).cell));

          if (constraint.cells.length <= gridSize) {
            yield new SudokuConstraintHandler.SumWithNegative(
              positiveCells, negativeCell, 0);
          } else if (positiveCells.length == gridSize) {
            let valueMap = new Map();
            for (const cell of positiveCells) valueMap.set(cell, 1);
            valueMap.set(negativeCell, gridSize);
            yield new SudokuConstraintHandler.GivenCandidates(valueMap);
          } else {
            // Sum can't handle more than gridSize cells.
            // Arrows can't have more than gridSize cells in the stem
            // to make the final sum.
            yield new SudokuConstraintHandler.False(
              [negativeCell, ...positiveCells]);
          }

          break;

        case 'Cage':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          // A sum of 0 means any sum is ok - i.e. the same as AllDifferent.
          if (constraint.sum != 0) {
            if (cells.length <= gridSize) {
              yield new SudokuConstraintHandler.Sum(cells, constraint.sum);
            } else {
              // Sum can't handle more than gridSize cells.
              yield new SudokuConstraintHandler.False(cells);
            }
          }
          yield new SudokuConstraintHandler.AllDifferent(cells);
          break;

        case 'Sum':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Sum(cells, constraint.sum);
          break;

        case 'LittleKiller':
          cells = SudokuConstraint.LittleKiller
            .cellMap(shape)[constraint.id].map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Sum(cells, constraint.sum);
          break;

        case 'XSum':
          cells = SudokuConstraint.fullLineCellMap(shape)
            .get([constraint.rowCol, 1].toString()).map(
              c => shape.parseCellId(c).cell);
          if (constraint.sumInc) {
            yield new SudokuConstraintHandler.XSum(
              cells, constraint.sumInc);
          }
          if (constraint.sumDec) {
            cells = cells.slice().reverse();
            yield new SudokuConstraintHandler.XSum(
              cells, constraint.sumDec);
          }
          break;

        case 'Sandwich':
          cells = SudokuConstraint.fullLineCellMap(shape)
            .get([constraint.id, 1].toString()).map(
              c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Sandwich(cells, constraint.sum);
          break;

        case 'Skyscraper':
          cells = SudokuConstraint.fullLineCellMap(shape)
            .get([constraint.rowCol, 1].toString()).map(
              c => shape.parseCellId(c).cell);
          if (constraint.countInc) {
            yield new SudokuConstraintHandler.Skyscraper(
              cells, constraint.countInc);
          }
          if (constraint.countDec) {
            cells = cells.slice().reverse();
            yield new SudokuConstraintHandler.Skyscraper(
              cells, constraint.countDec);
          }
          break;

        case 'AllDifferent':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.AllDifferent(cells);
          break;

        case 'Givens':
          let valueMap = new Map();
          for (const valueId of constraint.values) {
            const { cell, values } = shape.parseValueId(valueId);
            valueMap.set(cell, values);
          }
          yield new SudokuConstraintHandler.GivenCandidates(valueMap);
          break;

        case 'Thermo':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          for (let i = 1; i < cells.length; i++) {
            yield new SudokuConstraintHandler.BinaryConstraint(
              cells[i - 1], cells[i],
              SudokuConstraint.Thermo.fnKey(shape.numValues));
          }
          break;

        case 'Whisper':
          let difference = constraint.difference;
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          for (let i = 1; i < cells.length; i++) {
            yield new SudokuConstraintHandler.BinaryConstraint(
              cells[i - 1], cells[i],
              SudokuConstraint.Whisper.fnKey(difference, shape.numValues));
          }
          break;

        case 'Renban':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.AllContiguous(cells);
          break;

        case 'RegionSumLine':
          // Region sum lines only makes sense when we have boxes.
          if (!noBoxes) {
            cells = constraint.cells.map(c => shape.parseCellId(c).cell);
            yield new SudokuConstraintHandler.RegionSumLine(cells);
          }
          break;

        case 'Between':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Between(cells);
          break;

        case 'Palindrome':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          const numCells = cells.length;
          for (let i = 0; i < numCells / 2; i++) {
            yield new SudokuConstraintHandler.BinaryConstraint(
              cells[i], cells[numCells - 1 - i],
              SudokuConstraint.Palindrome.fnKey(shape.numValues));
          }
          break;

        case 'WhiteDot':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.BinaryConstraint(
            cells[0], cells[1],
            SudokuConstraint.WhiteDot.fnKey(shape.numValues));
          break;

        case 'BlackDot':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.BinaryConstraint(
            cells[0], cells[1],
            SudokuConstraint.BlackDot.fnKey(shape.numValues));
          break;

        case 'X':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Sum(cells, 10);
          break;

        case 'V':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Sum(cells, 5);
          break;

        case 'Windoku':
          for (const cells of SudokuConstraint.Windoku.regions(shape)) {
            yield new SudokuConstraintHandler.AllDifferent(cells);
          }
          break;

        case 'DisjointSets':
          for (const cells of SudokuConstraint.disjointSetRegions(shape)) {
            yield new SudokuConstraintHandler.AllDifferent(cells);
          }
          break;

        case 'GlobalEntropy':
          for (const cells of SudokuConstraint.GlobalEntropy.regions(shape)) {
            yield new SudokuConstraintHandler.LocalEntropy(cells);
          }
          break;

        case 'Quad':
          yield new SudokuConstraintHandler.Quadruple(
            shape.parseCellId(constraint.topLeftCell).cell,
            shape.gridSize,
            constraint.values.map(v => +v));
          break;

        case 'Binary':
          for (const g of SudokuConstraint.Binary.parseGroups(constraint.items)) {
            cells = g.cells.map(c => c && shape.parseCellId(c).cell);
            for (let i = 1; i < cells.length; i++) {
              yield new SudokuConstraintHandler.BinaryConstraint(
                cells[i - 1], cells[i],
                constraint.key);
            }
          }
          break;

        case 'BinaryX':
          for (const g of SudokuConstraint.Binary.parseGroups(constraint.items)) {
            cells = g.cells.map(c => c && shape.parseCellId(c).cell);
            if (cells.length == 2) {
              yield new SudokuConstraintHandler.BinaryConstraint(
                ...cells, constraint.key);
            } else {
              yield new SudokuConstraintHandler.BinaryPairwise(
                constraint.key, ...cells);
            }
          }
          break;

        case 'Priority':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SudokuConstraintHandler.Priority(cells, constraint.priority);
          break;

        default:
          throw ('Unknown constraint type: ' + constraint.type);
      }
    }
  }

  static * _antiHandlers(shape, conflictFn) {
    const gridSize = shape.gridSize;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        let cell = shape.cellIndex(r, c);
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        for (const [rr, cc] of conflictFn(r, c)) {
          if (rr < 0 || rr >= gridSize || cc < 0 || cc >= gridSize) continue;
          let conflict = shape.cellIndex(rr, cc);
          yield new SudokuConstraintHandler.AllDifferent([cell, conflict]);
        }
      }
    }
  }

  static _adjacentCellPairs(shape) {
    const pairs = [];

    const gridSize = shape.gridSize;

    // Only look at adjacent cells with larger indexes.
    const adjacentCellsFn = (r, c) => [[r + 1, c], [r, c + 1]];

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        let cell = shape.cellIndex(r, c);
        for (const [rr, cc] of adjacentCellsFn(r, c)) {
          if (rr < 0 || rr >= gridSize || cc < 0 || cc >= gridSize) continue;
          pairs.push([cell, shape.cellIndex(rr, cc)]);
        }
      }
    }

    return pairs;
  }

  static * _antiConsecutiveHandlers(shape) {
    for (const [cell, conflict] of this._adjacentCellPairs(shape)) {
      yield new SudokuConstraintHandler.BinaryConstraint(
        cell, conflict,
        SudokuConstraint.AntiConsecutive.fnKey(shape.numValues));
    }
  }
}

class SolverProxy {
  constructor(worker, stateHandler, statusHandler, debugHandler) {
    if (!worker) {
      throw ('Must provide worker');
    }

    this._worker = worker;
    this._messageHandler = (msg) => this._handleMessage(msg);
    this._worker.addEventListener('message', this._messageHandler);
    this._waiting = null;

    this._initialized = false;
    this._stateHandler = stateHandler || (() => null);
    this._debugHandler = debugHandler || (() => null);
    this._statusHandler = statusHandler || (() => null);
  }

  async solveAllPossibilities() {
    return this._callWorker('solveAllPossibilities');
  }

  async validateLayout() {
    return this._callWorker('validateLayout');
  }

  async nthSolution(n) {
    return this._callWorker('nthSolution', n);
  }

  async nthStep(n, stepGuides) {
    return this._callWorker('nthStep', [n, stepGuides]);
  }

  async countSolutions() {
    return this._callWorker('countSolutions');
  }

  _handleMessage(response) {
    // Solver has been terminated.
    if (!this._worker) return;

    let data = response.data;

    switch (data.type) {
      case 'result':
        this._waiting.resolve(data.result);
        this._statusHandler(false, this._waiting.method);
        this._waiting = null;
        break;
      case 'exception':
        this._waiting.reject(data.error);
        this._statusHandler(false, this._waiting.method);
        this._waiting = null;
        break;
      case 'state':
        this._stateHandler(data.state);
        break;
      case 'debug':
        this._debugHandler(data.data);
        break;
    }
  }

  _callWorker(method, payload) {
    if (!this._initialized) {
      throw (`SolverProxy not initialized.`);
    }
    if (!this._worker) {
      throw (`SolverProxy has been terminated.`);
    }
    if (this._waiting) {
      throw (`Can't call worker while a method is in progress. (${this._waiting.method})`);
    }

    this._statusHandler(true, method);

    let promise = new Promise((resolve, reject) => {
      this._waiting = {
        method: method,
        payload: payload,
        resolve: resolve,
        reject: reject,
      }
    });

    this._worker.postMessage({
      method: method,
      payload: payload,
    });

    return promise;
  }

  async init(constraint, logUpdateFrequency, debugOptions) {
    this._initialized = true;
    await this._callWorker(
      'init',
      { constraint, logUpdateFrequency, debugOptions });
  }

  terminate() {
    if (!this._worker) return;
    const worker = this._worker;
    this._worker = null;

    worker.removeEventListener('message', this._messageHandler);
    // If we are waiting, we have to kill it because we don't know how long
    // we'll be waiting. Otherwise we can just release it to be reused.
    if (this._waiting) {
      worker.terminate();
      this._waiting.reject('Aborted worker running: ' + this._waiting.method);
      this._statusHandler(false, 'terminate');
    } else {
      worker.release();
    }
  }

  isTerminated() {
    return this._worker === null;
  }
};

const toShortSolution = (solution, shape) => {
  const baseCharCode = SudokuTextParser.SHAPE_TO_BASE_CHAR_CODE.get(shape);
  const DEFAULT_VALUE = '.';

  const result = new Array(solution.length).fill(DEFAULT_VALUE);

  for (let i = 0; i < solution.length; i++) {
    result[i] = String.fromCharCode(baseCharCode + solution[i] - 1);
  }
  return result.join('');
}