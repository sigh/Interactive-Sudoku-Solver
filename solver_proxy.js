class SolverProxy {
  constructor(stateHandler) {
    this._worker = new Worker('worker.js');
    this._worker.addEventListener('message', (msg) => this._handleMessage(msg));
    this._waiting = null;

    this._initialized = false;
    this._stateHandler = stateHandler || (() => null);
  }

  async init(constraint) {
    if (this._initialized) {
      throw(`SolverProxy already initialized.`);
    }
    this._initialized = true;
    await this._callWorker('init', JSON.stringify(constraint));
  }

  async solveAllPossibilities() {
    return this._callWorker('solveAllPossibilities');
  }

  async nextSolution() {
    return this._callWorker('nextSolution');
  }

  async goToStep(n) {
    return this._callWorker('goToStep', n);
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

  terminate() {
    this._worker.terminate();
    this._worker = null;
  }
};


