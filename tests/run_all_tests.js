import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TestSuiteFailure,
  formatError,
  getTestStats,
  resetCurrentSuite,
} from './helpers/test_runner.js';

const testsDirUrl = new URL('.', import.meta.url);
const testsDirPath = fileURLToPath(testsDirUrl);

const largeTests = [
  'e2e/e2e.test.js',
];

const parseArgs = (argv) => {
  const options = {
    failFast: false,
    filters: [],
    list: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fail-fast') {
      options.failFast = true;
    } else if (arg === '--filter') {
      const filter = argv[++i];
      if (!filter) throw new Error('--filter requires a value');
      options.filters.push(filter);
    } else if (arg.startsWith('--filter=')) {
      options.filters.push(arg.slice('--filter='.length));
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--verbose') {
      // Handled in test_runner.js from process.argv.
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.filters.push(arg);
    }
  }
  return options;
};

const matchesFilters = (testFile, filters) => (
  filters.length === 0 || filters.some(filter => testFile.includes(filter))
);

const indent = (text, spaces = 4) => text
  .split('\n')
  .map(line => `${' '.repeat(spaces)}${line}`)
  .join('\n');

const logFailure = (error) => {
  if (error instanceof TestSuiteFailure) {
    console.error(`  FAIL: ${error.failures.length} ${error.failures.length === 1 ? 'test' : 'tests'} failed`);
    for (const failure of error.failures) {
      const message = failure.error?.message ?? String(failure.error);
      console.error(`    - ${failure.name}: ${message}`);
    }
    return;
  }

  console.error(`  FAIL: ${error.message}`);
  console.error(indent(formatError(error)));
  resetCurrentSuite();
};

const findTests = async (dir, relativePath = '') => {
  const entries = await readdir(dir, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      tests.push(...await findTests(join(dir, entry.name), join(relativePath, entry.name)));
    } else if (entry.name.endsWith('.test.js')) {
      tests.push(join(relativePath, entry.name));
    }
  }
  return tests;
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const discoveredTests = await findTests(testsDirPath);

const orderedTests = [
  ...discoveredTests
    .filter((name) => !largeTests.includes(name))
    .sort(),
  ...largeTests.filter((name) => discoveredTests.includes(name)),
].filter(testFile => matchesFilters(testFile, options.filters));

if (orderedTests.length === 0) {
  console.warn(options.filters.length
    ? 'No test files matched the provided filters.'
    : 'No test files (*.test.js) found under tests/.');
  process.exit(0);
}

if (options.list) {
  for (const testFile of orderedTests) console.log(testFile);
  process.exit(0);
}

const failures = [];
let filesRun = 0;
const totalStart = performance.now();

for (const testFile of orderedTests) {
  filesRun++;
  if (!options.quiet) console.log(`▶ Running ${testFile}`);
  try {
    await import(pathToFileURL(join(testsDirPath, testFile)));
  } catch (error) {
    failures.push({ file: testFile, error });
    logFailure(error);
    if (options.failFast) break;
  }
}

const totalMs = (performance.now() - totalStart).toFixed(0);
const { failed, passed, total } = getTestStats();

if (failures.length > 0) {
  const failureCount = failed || failures.length;
  console.error(`\n✗ ${failureCount} ${failureCount === 1 ? 'failure' : 'failures'} in ${failures.length} file(s):`);
  for (const { file } of failures) {
    console.error(`  - ${file}`);
  }
  console.error(`  (${passed}/${total} tests passed across ${filesRun} file(s), ${totalMs}ms elapsed)`);
  process.exit(1);
}

if (!options.quiet) console.log('\n');
console.log(`✓ All tests passed. (${passed} tests across ${filesRun} files in ${totalMs}ms)`);
