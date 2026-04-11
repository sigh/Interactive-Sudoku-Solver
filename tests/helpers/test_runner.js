let _suiteStart = performance.now();
let _suiteCount = 0;
let _totalCount = 0;
const _verbose = process.argv.includes('--verbose');

export const runTest = async (name, fn) => {
  try {
    await fn();
    _suiteCount++;
    _totalCount++;
    if (_verbose) console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const logSuiteComplete = (suiteName, count) => {
  const elapsed = performance.now() - _suiteStart;
  const ms = elapsed.toFixed(0);
  const n = count ?? _suiteCount;
  _totalCount += (count ?? 0);
  console.log(`All ${suiteName} tests passed. (${plural(n, 'test')} in ${ms}ms)`);
  _suiteCount = 0;
  _suiteStart = performance.now();
};

export const getTotalCount = () => _totalCount;
