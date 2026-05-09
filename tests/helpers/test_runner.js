let _suiteStart = performance.now();
let _suiteCount = 0;
let _totalCount = 0;
let _totalFailures = 0;
let _suiteFailures = [];
const _verbose = process.argv.includes('--verbose');
const _quiet = process.argv.includes('--quiet');

export class TestSuiteFailure extends Error {
  constructor(suiteName, failures, testCount, elapsedMs) {
    super(`${suiteName}: ${failures.length} ${failures.length === 1 ? 'test' : 'tests'} failed`);
    this.name = 'TestSuiteFailure';
    this.suiteName = suiteName;
    this.failures = failures;
    this.testCount = testCount;
    this.elapsedMs = elapsedMs;
  }
}

export const formatError = (error) => {
  if (error?.stack) return error.stack;
  if (error?.message) return error.message;
  return String(error);
};

const resetSuiteState = () => {
  _suiteCount = 0;
  _suiteFailures = [];
  _suiteStart = performance.now();
};

export const runTest = async (name, fn) => {
  _suiteCount++;
  _totalCount++;

  try {
    await fn();
    if (_verbose) console.log(`  ✓ ${name}`);
  } catch (error) {
    _totalFailures++;
    _suiteFailures.push({ name, error });
    console.error(`  ✗ ${name}`);
    if (_verbose) console.error(formatError(error));
  }
};

export const runTestCases = async (name, cases, fn) => {
  for (const testCase of cases) {
    const [label, ...args] = testCase;
    await runTest(`${name}: ${label}`, () => fn(...args));
  }
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const logSuiteComplete = (suiteName, count) => {
  const elapsed = performance.now() - _suiteStart;
  const ms = elapsed.toFixed(0);
  if (count !== undefined) {
    _totalCount += count - _suiteCount;
    _suiteCount = count;
  }
  const n = count ?? _suiteCount;

  if (_suiteFailures.length > 0) {
    const failures = _suiteFailures;
    resetSuiteState();
    throw new TestSuiteFailure(suiteName, failures, n, elapsed);
  }

  if (!_quiet) console.log(`All ${suiteName} tests passed. (${plural(n, 'test')} in ${ms}ms)`);
  resetSuiteState();
};

export const getTotalCount = () => _totalCount;

export const getTestStats = () => ({
  total: _totalCount,
  failed: _totalFailures,
  passed: _totalCount - _totalFailures,
});

export const resetCurrentSuite = () => {
  resetSuiteState();
};

export const logInfo = (...args) => {
  if (!_quiet) console.log(...args);
};
