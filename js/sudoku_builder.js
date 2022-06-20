var ENABLE_DEBUG_LOGS = false;

class GridShape {
  constructor(gridSize, boxSize) {
    this.boxSize = boxSize;
    this.gridSize = gridSize;
    this.numValues = gridSize;
    this.numCells = gridSize * gridSize;

    this.name = `${gridSize}x${gridSize}`;

    this._valueBase = this.numValues+1;

    this.allCells = new Array(this.numCells);
    for (let i = 0; i < this.numCells; i++) this.allCells[i] = i;

    Object.freeze(this);
  }

  makeValueId = (cellIndex, n) => {
    const cellId = this.makeCellId(...this.splitCellIndex(cellIndex));
    return `${cellId}_${n}`;
  }

  makeCellId = (row, col) => {
    return `R${(row+1).toString(this._valueBase)}C${(col+1).toString(this._valueBase)}`;
  }

  cellIndex = (row, col) => {
    return row*this.gridSize+col;
  };

  splitCellIndex = (cell) => {
    return [cell/this.gridSize|0, cell%this.gridSize|0];
  };
  parseValueId = (valueId) => {
    let cellId = valueId.substr(0, 4);
    return {
      value: parseInt(valueId.substr(5)),
      cellId: cellId,
      ...this.parseCellId(cellId),
    };
  };

  parseCellId = (cellId) => {
    let row = parseInt(cellId[1], this._valueBase)-1;
    let col = parseInt(cellId[3], this._valueBase)-1;
    return {
      cell: this.cellIndex(row, col),
      row: row,
      col: col,
    };
  };
}

const SHAPE_9x9 = new GridShape(9, 3);
const SHAPE_16x16 = new GridShape(16, 4);
const SHAPE_MAX = SHAPE_16x16;

const SHAPE = SHAPE_9x9;

const BOX_SIZE = SHAPE.boxSize;
const GRID_SIZE = SHAPE.gridSize;
const NUM_CELLS = SHAPE.numCells;

class SudokuTextParser {
  static parseShortKillerFormat(text) {
    // Reference for format:
    // http://forum.enjoysudoku.com/understandable-snarfable-killer-cages-t6119.html

    const numCells = SHAPE_9x9.numCells;
    const gridSize = SHAPE_9x9.gridSize;

    if (text.length != numCells) return null;
    // Note: The second ` is just there so my syntax highlighter is happy.
    if (!text.match(/[<v>^`',`]/)) return null;
    if (!text.match(/^[0-9A-Za-j^<v>`'',.`]*$/)) return null;

    // Determine the cell directions.
    let cellDirections = [];
    for (let i = 0; i < numCells; i++) {
      switch (text[i]) {
        case 'v':
          cellDirections.push(i+gridSize);
          break;
        case '^':
          cellDirections.push(i-gridSize);
          break;
        case '<':
          cellDirections.push(i-1);
          break;
        case '>':
          cellDirections.push(i+1);
          break;
        case '`':
          cellDirections.push(i-gridSize-1);
          break;
        case '\'':
          cellDirections.push(i-gridSize+1);
          break;
        case ',':
          cellDirections.push(i+gridSize-1);
          break;
        case '.':
          cellDirections.push(i+gridSize+1);
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
          throw('Loop in Killer Sudoku input.');
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
      cages.get(cageCell).cells.push(SHAPE.makeCellId(...SHAPE.splitCellIndex(i)));
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

    const numCells = SHAPE_9x9.numCells;

    let parts = text.split(':');
    if (parts[2] != 'k') return null;
    if (parts.length != numCells + 4) return null;

    let cages = new Map();
    for (let i = 0; i < numCells; i++) {
      let value = +parts[i + 3];
      let cageId = value%256;
      let cageSum = value/256|0;

      if (!cageSum) continue;

      if (!cages.has(cageId)) {
        cages.set(cageId, {sum: cageSum, cells: []});
      }
      cages.get(cageId).cells.push(SHAPE.makeCellId(...SHAPE.splitCellIndex(i)));
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

  static _parsePlainSudoku(text, gridSize, baseChar) {
    const numCells = gridSize*gridSize;

    if (text.length != numCells) return null;

    const baseCharCode = baseChar.charCodeAt(0);

    let fixedValues = [];
    let nonValueCharacters = [];
    for (let i = 0; i < numCells; i++) {
      let c = text.charCodeAt(i);
      if (c >= baseCharCode && c <= baseCharCode+gridSize-1) {
        fixedValues.push(SHAPE.makeValueId(i, c-baseCharCode+1));
      } else {
        nonValueCharacters.push(c);
      }
    }
    if (new Set(nonValueCharacters).size > 1) return null;
    return new SudokuConstraint.FixedValues(...fixedValues);
  }

  static parsePlain9x9(text) {
    return this._parsePlainSudoku(text, SHAPE_9x9.gridSize, '1');
  }

  static parsePlain16x16(text) {
    return this._parsePlainSudoku(text, SHAPE_16x16.gridSize, 'A');
  }

  static parseJigsawLayout(text) {
    const numCells = SHAPE_9x9.numCells;
    const gridSize = SHAPE_9x9.gridSize;

    if (text.length != numCells) return null;

    const chars = new Set(text);
    if (chars.size != gridSize) return null;

    const counter = {};
    chars.forEach(c => counter[c] = 0);
    for (let i = 0; i < numCells; i++) {
      counter[text[i]]++;
    }

    if (Object.values(counter).some(c => c != gridSize)) return null;

    return new SudokuConstraint.Set([
      new SudokuConstraint.Jigsaw(text),
      new SudokuConstraint.NoBoxes(),
    ]);
  }

  static parseJigsaw(text) {
    const numCells = SHAPE_9x9.numCells;
    const gridSize = SHAPE_9x9.gridSize;

    if (text.length == numCells) {
      return this.parseJigsawLayout(text);
    }

    if (text.length != numCells*2) return null;

    const layout = this.parseJigsawLayout(text.substr(numCells));
    if (layout == null) return null;

    const fixedValues = this.parsePlain9x9(text.substr(0, numCells));
    if (fixedValues == null) return null;

    return new SudokuConstraint.Set([layout, fixedValues]);
  }

  static parseGridLayout(rawText) {
    if (rawText.length < SHAPE_9x9.numCells*2) return null;

    const parts = [...rawText.matchAll(/[.]|\d+/g)];
    const numParts = parts.length;
    if (numParts != SHAPE_9x9.numCells && numParts != SHAPE_16x16.numCells) {
      return;
    }

    let fixedValues = [];
    for (let i = 0; i < numParts; i++) {
      const cell = parts[i];
      if (cell == '.') continue;
      fixedValues.push(SHAPE.makeValueId(i, cell));
    }

    return new SudokuConstraint.FixedValues(...fixedValues);
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

    constraint = this.parsePlain9x9(text);
    if (constraint) return constraint;

    constraint = this.parsePlain16x16(text);
    if (constraint) return constraint;

    constraint = this.parseGridLayout(rawText);
    if (constraint) return constraint;

    return null;
  }
}

class SudokuConstraint {
  constructor(args) {
    this.args = args ? [...args] : [];
    this.type = this.constructor.name;
  }

  static fromString(str) {
    str = str.replace(/\s+/g, '');
    let items = str.split('.');
    if (items[0]) throw('Invalid constraint string.');
    items.shift();

    let constraints = [];
    for (const item of items) {
      let args = item.split('~');
      let type = args.shift();
      if (!type) type = this.DEFAULT.name;
      if (!SudokuConstraint[type]) {
        throw('Unknown constraint type: ' + type);
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
    let constraint = SudokuTextParser.parseText(rawText);
    if (constraint) return constraint;

    return SudokuConstraint.fromString(rawText);
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
  }

  static Whisper = class Whisper extends SudokuConstraint {
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
  }

  static NoBoxes = class NoBoxes extends SudokuConstraint {}

  static Windoku = class Windoku extends SudokuConstraint {
    static REGIONS = (() => {
      const regions = [];

      const offsets = [
        [1, 1],
        [1, 5],
        [5, 1],
        [5, 5],
      ];
      for (const [r, c] of offsets) {
        let cells = [];
        for (let i = 0; i < GRID_SIZE; i++) {
          const row = r+(i%BOX_SIZE|0);
          const col = c+(i/BOX_SIZE|0);
          cells.push(SHAPE.cellIndex(row, col));
        }
        regions.push(cells);
      }

      return regions;
    })();
  }

  static AntiKnight = class AntiKnight extends SudokuConstraint {}

  static AntiKing = class AntiKing extends SudokuConstraint {}

  static AntiConsecutive = class AntiConsecutive extends SudokuConstraint {}

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
  }

  static BlackDot = class BlackDot extends SudokuConstraint {
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

  static LittleKiller = class LittleKiller extends SudokuConstraint {
    constructor(sum, id) {
      super(arguments);
      this.id = id;
      this.sum = sum;
    }

    static CELL_MAP = (() => {
      let map = {};

      const addLittleKiller = (row, col, dr, dc) => {
        let cells = [];
        for (; row >= 0 && col >= 0 && col < GRID_SIZE && row < GRID_SIZE;
               row+=dr, col+=dc) {
          cells.push(SHAPE.makeCellId(row, col));
        }
        map[cells[0]] = cells;
      };

      // Left side.
      for (let row=0; row < GRID_SIZE-1; row++) addLittleKiller(row, 0, 1, 1);
      // Right side.
      for (let row=1; row < GRID_SIZE-1; row++) addLittleKiller(row, GRID_SIZE-1, -1, -1);
      // Top side.
      for (let col=1; col < GRID_SIZE; col++) addLittleKiller(0, col, 1, -1);
      // Bottom side.
      for (let col=1; col < GRID_SIZE-1; col++) addLittleKiller(GRID_SIZE-1, col, -1, 1);

      return map;
    })();
  }

  static Sandwich = class Sandwich extends SudokuConstraint {
    constructor(sum, id) {
      super(arguments);
      this.id = id;
      this.sum = sum;
    }

    static CELL_MAP = (() => {
      let map = {};

      const addSandwich = (name, row, col, dr, dc) => {
        let cells = [];
        for (; col < GRID_SIZE && row < GRID_SIZE;
               row+=dr, col+=dc) {
          cells.push(SHAPE.makeCellId(row, col));
        }
        map[name] = cells;
      };

      for (let row=0; row < GRID_SIZE; row++) {
        addSandwich(`R${row+1}`, row, 0, 0, 1);
      }
      for (let col=0; col < GRID_SIZE; col++) {
        addSandwich(`C${col+1}`, 0, col, 1, 0);
      }

      return map;
    })();
  }

  static AllDifferent = class AllDifferent extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static FixedValues = class FixedValues extends SudokuConstraint {
    constructor(...values) {
      super(arguments);
      this.values = values;
    }
  }

  static DEFAULT = this.FixedValues;
}

class SudokuBuilder {
  static build(constraint) {
    return new SudokuSolver(SudokuBuilder._handlers(constraint));
  }

  // GLobal vars to pass to the worker.
  static GLOBAL_VARS = [
    'EXPORT_CONFLICT_HEATMAP',
    'ENABLE_DEBUG_LOGS',
  ];

  // Ask for a state update every 2**14 iterations.
  // NOTE: Using a non-power of 10 makes the display loook faster :)
  static LOG_UPDATE_FREQUENCY = 14;

  static _unusedWorkers = [];

  static getGlobalVars() {
    const options = new Map();

    for (const v of this.GLOBAL_VARS) {
      options.set(v, window[v]);
    }

    return options;
  }

  static async buildInWorker(constraints, stateHandler, statusHandler, debugHandler) {
    // Ensure any pending terminations are enacted.
    await new Promise(r => setTimeout(r, 0));

    if (!this._unusedWorkers.length) {
      this._unusedWorkers.push(new Worker('js/worker.js' + VERSION_PARAM));
    }
    const worker = this._unusedWorkers.pop();
    worker.release = () => this._unusedWorkers.push(worker);

    const solverProxy = new SolverProxy(worker, stateHandler, statusHandler, debugHandler);
    const globalVars = this.getGlobalVars();

    await solverProxy.init(constraints, this.LOG_UPDATE_FREQUENCY, globalVars);
    return solverProxy;
  }

  static hasNoBoxes(constraint) {
    switch (constraint.type) {
      case 'NoBoxes':
        return true;
      case 'Set':
        return constraint.constraints.some(c => this.hasNoBoxes(c));
    }
    return false;
  }

  static *_handlers(constraint) {
    yield* SudokuBuilder._rowColHandlers();
    yield* SudokuBuilder._constraintHandlers(constraint);
    if (!this.hasNoBoxes(constraint)) {
      yield* SudokuBuilder._boxHandlers();
    }
  }

  static *_rowColHandlers() {
    // Row constraints.
    for (let row = 0; row < GRID_SIZE; row++) {
      let cells = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cells.push(SHAPE.cellIndex(row, col));
      }
      yield new SudokuConstraintHandler.AllDifferent(cells);
    }

    // Column constraints.
    for (let col = 0; col < GRID_SIZE; col++) {
      let cells = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        cells.push(SHAPE.cellIndex(row, col));
      }
      yield new SudokuConstraintHandler.AllDifferent(cells);
    }
  }

  static *_boxHandlers() {
    for (let b = 0; b < GRID_SIZE; b++) {
      let bi = b/BOX_SIZE|0;
      let bj = b%BOX_SIZE|0;
      let cells = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let row = BOX_SIZE*bi+(c%BOX_SIZE|0);
        let col = BOX_SIZE*bj+(c/BOX_SIZE|0);
        cells.push(SHAPE.cellIndex(row, col));
      }
      yield new SudokuConstraintHandler.AllDifferent(cells);
    }
  }

  static *_constraintHandlers(constraint) {
    let cells;
    switch (constraint.type) {
      case 'NoBoxes':
        yield new SudokuConstraintHandler.NoBoxes();
        break;

      case 'AntiKnight':
        yield* this._antiHandlers(
          (r, c) => [[r+1, c+2], [r+2, c+1], [r+1, c-2], [r+2, c-1]]);
        break;

      case 'AntiKing':
        yield* this._antiHandlers((r, c) => [[r+1, c+1], [r+1, c-1]]);
        break;

      case 'AntiConsecutive':
        yield* this._antiConsecutiveHandlers();
        break;

      case 'Jigsaw':
        const grid = constraint.grid;
        const map = new Map();
        for (let i = 0; i < NUM_CELLS; i++) {
          const v = grid[i];
          if (!map.has(v)) map.set(v, []);
          map.get(v).push(i);
        }

        for (const [_, cells] of map) {
          if (cells.length == GRID_SIZE) {
            yield new SudokuConstraintHandler.AllDifferent(cells);
          }
        }

        // Just to let the solver know that this is a jigsaw puzzle.
        yield new SudokuConstraintHandler.Jigsaw([...map.values()]);
        break;

      case 'Diagonal':
        cells = [];
        for (let r = 0; r < GRID_SIZE; r++) {
          let c = constraint.direction > 0 ? GRID_SIZE-r-1 : r;
          cells.push(SHAPE.cellIndex(r, c));
        }
        yield new SudokuConstraintHandler.AllDifferent(cells);
        break;

      case 'Arrow':
        const [negativeCell, ...positiveCells] = constraint.cells.map(
          c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.SumWithNegative(
          positiveCells, negativeCell, 0);
        break;

      case 'Cage':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        if (constraint.sum > 0 && cells.length < GRID_SIZE) {
          yield new SudokuConstraintHandler.Sum(cells, constraint.sum);
        }
        if (cells.length == GRID_SIZE && constraint.sum != 45) {
          yield new SudokuConstraintHandler.False(cells);
        }
        yield new SudokuConstraintHandler.AllDifferent(cells);
        break;

      case 'LittleKiller':
        cells = SudokuConstraint.LittleKiller
          .CELL_MAP[constraint.id].map(c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.Sum(cells, constraint.sum);
        break;

      case 'Sandwich':
        cells = SudokuConstraint.Sandwich
          .CELL_MAP[constraint.id].map(c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.Sandwich(cells, constraint.sum);
        break;

      case 'AllDifferent':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.AllDifferent(cells);
        break;

      case 'FixedValues':
        let valueMap = new Map();
        for (const valueId of constraint.values) {
          let {cell, value} = SHAPE.parseValueId(valueId);
          valueMap.set(cell, value);
        }
        yield new SudokuConstraintHandler.FixedCells(valueMap);
        break;

      case 'Thermo':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        for (let i = 1; i < cells.length; i++) {
          yield new SudokuConstraintHandler.BinaryConstraint(
            cells[i-1], cells[i], (a, b) => a < b);
        }
        break;

      case 'Whisper':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        for (let i = 1; i < cells.length; i++) {
          yield new SudokuConstraintHandler.BinaryConstraint(
            cells[i-1], cells[i], (a, b) => a >= b+5 || a <= b-5);
        }
        break;

      case 'Between':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.Between(cells);
        break;

      case 'Palindrome':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        const numCells = cells.length;
        for (let i = 0; i < numCells/2; i++) {
          yield new SudokuConstraintHandler.BinaryConstraint(
            cells[i], cells[numCells-1-i], (a, b) => a == b);
        }
        break;

      case 'Set':
        for (const c of constraint.constraints) {
          yield* this._constraintHandlers(c);
        }
        break;

      case 'WhiteDot':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.BinaryConstraint(
          cells[0], cells[1], (a, b) => a == b+1 || a == b-1);
        break;

      case 'BlackDot':
        cells = constraint.cells.map(c => SHAPE.parseCellId(c).cell);
        yield new SudokuConstraintHandler.BinaryConstraint(
          cells[0], cells[1], (a, b) => a == b*2 || b == a*2);
        break;

      case 'Windoku':
        for (const cells of SudokuConstraint.Windoku.REGIONS) {
          yield new SudokuConstraintHandler.AllDifferent(cells);
        }
        break;

      default:
        throw('Unknown constraint type: ' + constraint.type);
    }
  }

  static *_antiHandlers(conflictFn) {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        let cell = SHAPE.cellIndex(r, c);
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        for (const [rr, cc] of conflictFn(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = SHAPE.cellIndex(rr, cc);
          yield new SudokuConstraintHandler.AllDifferent([cell, conflict]);
        }
      }
    }
  }

  static *_antiConsecutiveHandlers() {
    const adjacentCellsFn = (r, c) => [[r+1, c], [r, c+1]];
    const constraintFn = (a, b) => (a != b+1 && a != b-1 && a != b);

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        let cell = SHAPE.cellIndex(r, c);
        for (const [rr, cc] of adjacentCellsFn(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = SHAPE.cellIndex(rr, cc);
          yield new SudokuConstraintHandler.BinaryConstraint(
            cell, conflict, constraintFn);
        }
      }
    }
  }
}

class SolverProxy {
  constructor(worker, stateHandler, statusHandler, debugHandler) {
    if (!worker) {
      throw('Must provide worker');
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

  async nthStep(n) {
    return this._callWorker('nthStep', n);
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
      throw(`SolverProxy not initialized.`);
    }
    if (!this._worker) {
      throw(`SolverProxy has been terminated.`);
    }
    if (this._waiting) {
      throw(`Can't call worker while a method is in progress. (${this._waiting.method})`);
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

  async init(constraint, logUpdateFrequency, globalVars) {
    this._initialized = true;
    await this._callWorker('init', {
      constraint: constraint,
      logUpdateFrequency: logUpdateFrequency,
      globalVars,
    });
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
