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

  // Ask for a state update every 2**14 iterations.
  // Using a non-power of 10 makes the display loook faster :)
  static UPDATE_FREQUENCY = 16384;

  async solveAllPossibilities() {
    return this._callWorker('solveAllPossibilities');
  }

  async nextSolution() {
    return this._callWorker('nextSolution');
  }

  async goToStep(n) {
    return this._callWorker('goToStep', n);
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

  static unusedWorkers = [];

  static async make(constraints, stateHandler) {
    if (!this.unusedWorkers.length) {
      this.unusedWorkers.push(new Worker('worker.js'));
    }
    let worker = this.unusedWorkers.pop();
    let solverProxy = new SolverProxy(stateHandler, worker);

    await solverProxy._init(constraints, this.UPDATE_FREQUENCY);

    return solverProxy;
  }

  async _init(constraint, updateFrequency) {
    this._initialized = true;
    await this._callWorker('initFast', {
      jsonConstraint: JSON.stringify(constraint),
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
      SolverProxy.unusedWorkers.push(this._worker);
    }
    this._worker = null;
  }
};


