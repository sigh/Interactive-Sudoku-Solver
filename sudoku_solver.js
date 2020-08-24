class SudokuBuilder {
  static build(constraint) {
    return new SudokuSolver(SudokuBuilder._handlers(constraint));
  }

  // Ask for a state update every 2**14 iterations.
  // Using a non-power of 10 makes the display loook faster :)
  static UPDATE_FREQUENCY = 16384;

  static _unusedWorkers = [];

  static async buildInWorker(constraints, stateHandler) {
    if (!this._unusedWorkers.length) {
      this._unusedWorkers.push(new Worker('worker.js'));
    }
    let worker = this._unusedWorkers.pop();
    worker.release = () => this._unusedWorkers.push(worker);

    let solverProxy = new SolverProxy(stateHandler, worker);

    await solverProxy.init(constraints, this.UPDATE_FREQUENCY);

    return solverProxy;
  }

  static *_handlers(constraint) {
    yield* SudokuBuilder._baseHandlers();
    yield* SudokuBuilder._constraintHandlers(constraint);
  }

  static *_baseHandlers() {
    // Row constraints.
    for (let row = 0; row < GRID_SIZE; row++) {
      let cells = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cells.push(toCellIndex(row, col));
      }
      yield new SudokuSolver.NonetHandler(cells);
    }

    // Column constraints.
    for (let col = 0; col < GRID_SIZE; col++) {
      let cells = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        cells.push(toCellIndex(row, col));
      }
      yield new SudokuSolver.NonetHandler(cells);
    }

    // Box constraints.
    for (let b = 0; b < GRID_SIZE; b++) {
      let bi = b/BOX_SIZE|0;
      let bj = b%BOX_SIZE|0;
      let cells = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let row = BOX_SIZE*bi+(c%BOX_SIZE|0);
        let col = BOX_SIZE*bj+(c/BOX_SIZE|0);
        cells.push(toCellIndex(row, col));
      }
      yield new SudokuSolver.NonetHandler(cells);
    }
  }

  static *_constraintHandlers(constraint) {
    let cells;
    switch (constraint.type) {
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

      case 'Diagonal':
        cells = [];
        for (let r = 0; r < GRID_SIZE; r++) {
          let c = constraint.direction > 0 ? GRID_SIZE-r-1 : r;
          cells.push(toCellIndex(r, c));
        }
        yield *this._allDifferentHandlers(cells);
        break;

      case 'Sum':
        cells = constraint.cells.map(c => parseCellId(c).cell);
        yield new SudokuSolver.SumHandler(cells, constraint.sum);
        break;

      case 'AllDifferent':
        cells = constraint.cells.map(c => parseCellId(c).cell);
        yield *this._allDifferentHandlers(cells);
        break;

      case 'FixedValues':
        let valueMap = new Map();
        for (const valueId of constraint.values) {
          let {cell, value} = parseValueId(valueId);
          valueMap.set(cell, value);
        }
        yield new SudokuSolver.FixedCellsHandler(valueMap);
        break;

      case 'Thermo':
        cells = constraint.cells.map(c => parseCellId(c).cell);
        for (let i = 1; i < cells.length; i++) {
          yield new SudokuSolver.BinaryConstraintHandler(
            cells[i-1], cells[i], (a, b) => a < b);
        }
        break;

      case 'Set':
        for (const c of constraint.constraints) {
          yield* this._constraintHandlers(c);
        }
        break;

      default:
        throw('Unknown constraint type: ' + constraint.type);
    }
  }

  static *_allDifferentHandlers(cells) {
    cells.sort((a, b) => a-b);
    if (cells.length > GRID_SIZE) throw('Too many cells for AllDifferent');
    if (cells.length < GRID_SIZE) {
      yield new SudokuSolver.AllDifferentHandler(cells);
      return;
    }

    // Exactly 9 cells.
    yield new SudokuSolver.NonetHandler(cells);
  }

  static *_antiHandlers(conflictFn) {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        let cell = toCellIndex(r, c);
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        for (const [rr, cc] of conflictFn(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = toCellIndex(rr, cc);
          yield new SudokuSolver.AllDifferentHandler([cell, conflict]);
        }
      }
    }
  }

  static *_antiConsecutiveHandlers() {
    const adjacentCellsFn = (r, c) => [[r+1, c], [r, c+1]];
    const constraintFn = (a, b) => (a != b+1 && a != b-1 && a != b);

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        let cell = toCellIndex(r, c);
        for (const [rr, cc] of adjacentCellsFn(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = toCellIndex(rr, cc);
          yield new SudokuSolver.BinaryConstraintHandler(
            cell, conflict, constraintFn);
        }
      }
    }
  }
}

class SolverProxy {
  constructor(stateHandler, worker) {
    if (!worker) {
      throw('Call SolverProxy.make()');
    }

    this._worker = worker;
    this._messageHandler = (msg) => this._handleMessage(msg);
    this._worker.addEventListener('message', this._messageHandler);
    this._waiting = null;

    this._initialized = false;
    this._stateHandler = stateHandler || (() => null);
  }

  async solveAllPossibilities() {
    return this._callWorker('solveAllPossibilities');
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
    let data = response.data;

    switch (data.type) {
      case 'result':
        this._waiting.resolve(data.result);
        this._waiting = null;
        break;
      case 'exception':
        this._waiting.reject(data.error);
        this._waiting = null;
        break;
      case 'state':
        this._stateHandler(data.state);
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

  async init(constraint, updateFrequency) {
    this._initialized = true;
    await this._callWorker('init', {
      constraint: constraint,
      updateFrequency: updateFrequency,
    });
  }

  terminate() {
    if (!this._worker) return;

    this._worker.removeEventListener('message', this._messageHandler);
    // If we are waiting, we have to kill it because we don't know how long
    // we'll be waiting. Otherwise we can just release it to be reused.
    if (this._waiting) {
      this._worker.terminate();
      this._waiting.reject('Aborted');
    } else {
      this._worker.release();
    }
    this._worker = null;
  }
};
