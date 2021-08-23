const formatTimeMs = (timeMs) => {
  if (timeMs < 1000) {
    return timeMs.toPrecision(3) + ' ms';
  }
  return (timeMs/1000).toPrecision(3) + ' s';
};

const createSvgElement = (tag) => {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
};

const camelCaseToWords = (text) => {
  text = text.replace(/([A-Z])/g, " $1").toLowerCase();
  return text[0].toUpperCase() + text.slice(1);
};

const deferUntilAnimationFrame = (fn) => {
  let lastArgs = null;
  let promise = null;
  let alreadyEnqueued = false;
  return ((...args) => {
    lastArgs = args;

    if (!alreadyEnqueued) {
      alreadyEnqueued = true;
      promise = new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          try {
            fn(...lastArgs);
          } finally {
            resolve();
            lastArgs = null;
            promise = null;
            alreadyEnqueued = false;
          }
        });
      });
    }

    return promise;
  });
};

// Helper to count operations for debugging.
let _count = 0;
const COUNT = () => { _count++; };

// A timer which can be paused and unpaused and accumulates the elapsed time.
// Start paused.
class Timer {
  constructor() {
    this._elapsedMs = 0;
    // The timestamp for the start of the current periods. If null, the timer
    // is currently paused.
    this._startTimestamp = null;
  }

  unpause() {
    if (this._startTimestamp == null) {
      this._startTimestamp = performance.now();
    }
  }

  pause() {
    if (this._startTimestamp != null) {
      this._elapsedMs += performance.now() - this._startTimestamp;
      this._startTimestamp = null;
    }
  }

  elapsedMs() {
    let elapsedMs = this._elapsedMs;
    if (this._startTimestamp != null) {
      elapsedMs += performance.now() - this._startTimestamp;
    }
    return elapsedMs;
  }

  runTimed(fn) {
    this.unpause();
    fn();
    this.pause();
  }
}

class IteratorWithCount {
  constructor(iter) {
    this._iter = iter;
    this.count = 0;
  }

  next() {
    this.count++;
    return this._iter.next();
  }

  [Symbol.iterator] = () => this;
}
