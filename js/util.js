export const clamp = (value, min, max) => {
  return Math.min(Math.max(value, min), max);
};

export const formatTimeMs = (timeMs) => {
  if (timeMs < 1e3) {
    return timeMs.toPrecision(3) + ' ms';
  } else if (timeMs < 60e3) {
    return (timeMs / 1000).toPrecision(3) + ' s';
  } else {
    const timeS = timeMs / 1e3 | 0;
    return (timeS / 60 | 0) + ' min ' + (timeS % 60) + ' s';
  }
};

export const formatNumberMetric = (value) => {
  if (value == 0) return value;
  if (value < 0.001) return value.toExponential(1);
  if (value < 1e3) return value;
  if (value < 1e6) return (value / 1e3) + 'k';
  if (value < 1e9) return (value / 1e6) + 'M';
  if (value < 1e12) return (value / 1e9) + 'G';
  if (value < 1e15) return (value / 1e12) + 'T';
  return value.toExponential(1);
};

export const createSvgElement = (tag) => {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
};

export const camelCaseToWords = (text) => {
  text = text.replace(/([A-Z])/g, " $1").toLowerCase();
  return text[0].toUpperCase() + text.slice(1);
};

export const arrayDifference = (a, b) => {
  return a.filter(v => !b.includes(v));
};

export const arrayIntersect = (a, b) => {
  return a.filter(v => b.includes(v));
};

export const arrayIntersectSize = (a, b) => {
  return a.reduce((p, v) => p + b.includes(v), 0);
}

export const arrayRemoveValue = (a, value) => {
  const index = a.indexOf(value);
  if (index > -1) a.splice(index, 1);
  return a;
}

export const arraysAreEqual = (a, b) => {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

// `a` must be a set, `b` must be iterable.
export const setIntersectionToArray = (a, b) => {
  const intersection = [];
  for (const elem of b) {
    if (a.has(elem)) {
      intersection.push(elem)
    }
  }
  return intersection;
};

// `a` must be a set, `b` must be iterable.
export const setIntersectSize = (a, b) => {
  let count = 0;
  for (const elem of b) {
    count += a.has(elem);
  }
  return count;
}

export const setDifference = (a, b) => {
  const diff = new Set(a);
  for (const elem of b) {
    diff.delete(elem);
  }
  return diff;
};

export const setPeek = (a) => {
  for (const elem of a) {
    return elem;
  }
  return null;
}

export const countOnes16bit = (x) => {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  x += x >> 8;

  return x & 0x1f;
};

export const requiredBits = (n) => {
  return 32 - Math.clz32(n);
}

export const deferUntilAnimationFrame = (fn) => {
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
export const COUNT = () => { _count++; };

// A timer which can be paused and unpaused and accumulates the elapsed time.
// Start paused.
export class Timer {
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

export class IteratorWithCount {
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

const loadJSFile = (path) => {
  const script = document.createElement('script');
  script.src = path;
  script.async = false;
  document.head.append(script);

  return new Promise(resolve => {
    script.onload = resolve;
  });
};

export const dynamicJSFileLoader = (path) => {
  let loaded = false;
  return async () => {
    if (loaded) return;
    loaded = true;
    await loadJSFile(path);
  };
};

export const withDeadline = (promise, delay, reason) => {
  const awaitTimeout = new Promise(
    (resolve, reject) => setTimeout((() => reject(reason)), delay));

  return Promise.race([promise, awaitTimeout]);
};

export const memoize = (f) => {
  const map = new Map();
  return (...a) => {
    const key = a.length <= 1 ? a[0] : JSON.stringify(a);
    let result = map.get(key);
    if (result) return result;

    result = f(...a);
    map.set(key, result);
    return result;
  };
};

export const clearDOMNode = (node) => {
  node.replaceChildren();
};

export const toggleDisabled = (element, disabled) => {
  if (disabled) {
    element.setAttribute('disabled', '');
  } else {
    element.removeAttribute('disabled');
  }
};

export const isIterable = (obj) => {
  return obj && typeof obj[Symbol.iterator] === 'function';
};

export const isPlainObject = (obj) => {
  return obj && obj.constructor === Object;
};

export const localTimestamp = () => {
  const tzOffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
  return (new Date(Date.now() - tzOffset)).toISOString().slice(0, -1);
};

export const shuffleArray = (arr, randomGenerator) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomGenerator.randomInt(i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

export class BitWriter {
  constructor() {
    this._bytes = [];
    this._bitLength = 0;
  }

  writeBits(value, bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 0) {
      throw new Error('Bit count must be a non-negative integer');
    }
    if (bitCount === 0) return;
    const normalized = value >>> 0;
    for (let i = bitCount - 1; i >= 0; i--) {
      const bit = (normalized >>> i) & 1;
      const byteIndex = this._bitLength >> 3;
      if (byteIndex === this._bytes.length) {
        this._bytes.push(0);
      }
      const bitIndex = 7 - (this._bitLength & 7);
      if (bit) {
        this._bytes[byteIndex] |= (1 << bitIndex);
      }
      this._bitLength++;
    }
  }

  toUint8Array() {
    if (!this._bytes.length) {
      return new Uint8Array(0);
    }
    return Uint8Array.from(this._bytes);
  }
}

export class BitReader {
  constructor(bytes) {
    this._bytes = bytes;
    this._bitOffset = 0;
    this._totalBits = bytes.length * 8;
  }

  readBits(bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 0) {
      throw new Error('Bit count must be a non-negative integer');
    }
    if (bitCount === 0) return 0;
    if (this._bitOffset + bitCount > this._totalBits) {
      throw new Error('Unexpected end of bit stream');
    }
    let value = 0;
    for (let i = 0; i < bitCount; i++) {
      const byteIndex = this._bitOffset >> 3;
      const bitIndex = 7 - (this._bitOffset & 7);
      const bit = (this._bytes[byteIndex] >> bitIndex) & 1;
      value = (value << 1) | bit;
      this._bitOffset++;
    }
    return value >>> 0;
  }

  remainingBits() {
    return this._totalBits - this._bitOffset;
  }

  skipPadding() {
    while (this.remainingBits() > 0) {
      const chunk = Math.min(32, this.remainingBits());
      if (this.readBits(chunk) !== 0) {
        throw new Error('Bit stream contains unexpected trailing data');
      }
    }
  }
}

export const groupSortedBy = function* (iterable, keyFunc) {
  let group = [];
  let currentKey;

  for (const item of iterable) {
    const key = keyFunc(item);
    if (key !== currentKey) {
      if (group.length > 0) {
        yield group;
        group = [];
      }
      currentKey = key;
    }
    group.push(item);
  }

  if (group.length > 0) {
    yield group;
  }
};

export const autoSaveField = (element, field) => {
  const elementId = element.getAttribute('id');

  if (!elementId) {
    console.error('Auto-save field must have an ID.');
    return;
  }

  const keySuffix = field ? `-${field}` : '';
  const key = `autoSave-${elementId}${keySuffix}`;
  const savedValue = sessionStorage.getItem(key);

  const input = field ? element[field] : element;
  if (savedValue) {
    input.value = savedValue;
  }

  element.addEventListener('change', () => {
    sessionStorage.setItem(key, input.value);
  });
};

export const sessionAndLocalStorage = {
  getItem: (key) => {
    const sessionValue = sessionStorage.getItem(key);
    if (sessionValue !== null) return sessionValue;

    const localValue = localStorage.getItem(key);
    if (localValue !== null) {
      // Make sure the value is persisted in the current session.
      sessionStorage.setItem(key, localValue);
      return localValue;
    }

    return null;
  },
  setItem: (key, value) => {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  }
};

// Random number generator which allows seeding.
// It has 32-bits of state which is sufficient for the current uses in
// this solver.
export class RandomIntGenerator {
  constructor(seed) {
    this._state = seed || 0;
  }

  // Advance the state and generate a random 32-bit integer.
  _next() {
    // SplitMix32 PRNG.
    // From https://github.com/bryc/code/blob/master/jshash/PRNGs.md#splitmix32
    let state = this._state | 0;
    state = (state + 0x9e3779b9) | 0;
    this._state = state;

    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  }

  // Random integer in the range [0, max].
  randomInt(max) {
    return this._next() % (max + 1);
  }
}

export class Base64Codec {
  // NOTE: The last two characters are in the wrong order but we keep it for
  // backward-compatibility.
  static BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  static BASE64_INDEX = (() => {
    const lookup = new Uint8Array(127);
    for (let i = 0; i < this.BASE64_CHARS.length; i++) {
      lookup[this.BASE64_CHARS.charCodeAt(i)] = i;
    }
    return lookup;
  })();

  static encodeString(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  static decodeToString(b64str) {
    // Pad the string to a multiple of 4.
    const padLength = (4 - (b64str.length % 4)) % 4;
    b64str += '='.repeat(padLength);
    const decoded = atob(b64str.replace(/-/g, '+').replace(/_/g, '/'));
    return decoded;
  }

  static encode6BitArray(array) {
    return array.map((v) => this.BASE64_CHARS[v]).join('');
  };

  static decodeTo6BitArray(str, array) {
    array ||= new Uint8Array(str.length);
    if (array.length < str.length) {
      throw ('Array is too short.');
    }

    for (let i = 0; i < str.length; i++) {
      array[i] = this.BASE64_INDEX[str.charCodeAt(i)];
    }

    return array;
  }

  static lengthOf6BitArray(numBits) {
    return Math.ceil(numBits / 6);
  }
};

export class MultiMap {
  constructor() {
    this._map = new Map();
  }

  add(key, value) {
    let values = this._map.get(key);
    if (values === undefined) {
      values = [];
      this._map.set(key, values);
    }
    values.push(value);
  }

  get(key) {
    return this._map.get(key) || [];
  }

  delete(key, value) {
    const values = this._map.get(key);
    if (values === undefined) return;
    arrayRemoveValue(values, value);
    if (values.length === 0) {
      this._map.delete(key);
    }
  }

  clear() {
    this._map.clear();
  }

  getMap() {
    return this._map;
  }

  [Symbol.iterator]() {
    return this._map[Symbol.iterator]();
  }
}
