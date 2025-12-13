
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
      const { type, id, result, error, logs } = e.data;

      if (type === 'ready') {
        this._resolveReady();
        return;
      }

      if (type === 'initError') {
        this._rejectReady(new Error(error));
        return;
      }

      const p = this._pending.get(id);
      if (p) {
        this._pending.delete(id);
        clearTimeout(p.timer);
        if (error) {
          const err = new Error(error);
          if (logs) err.logs = logs;
          p.reject(err);
        } else {
          p.resolve(result);
        }
      }
    };
  }

  _restartWorker() {
    this._worker.terminate();
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Worker terminated due to timeout'));
    }
    this._pending.clear();
    this._initWorker();
  }

  async _call(type, payload, timeoutMs) {
    await this._readyPromise;

    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error('Execution timed out'));
          this._restartWorker();
        }
      }, self.USER_SCRIPT_TIMEOUT || timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      this._worker.postMessage({ id, type, payload });
    });
  }

  compilePairwise(type, fnStr, numValues) {
    return this._call('compilePairwise', { type, fnStr, numValues }, 1000);
  }

  compileStateMachine(spec, numValues, isUnified) {
    return this._call('compileStateMachine', { spec, numValues, isUnified }, 3000);
  }

  convertUnifiedToSplit(code) {
    return this._call('convertUnifiedToSplit', { code }, 100);
  }

  runSandboxCode(code) {
    return this._call('runSandboxCode', { code }, 10000);
  }
}
