import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getTotalCount } from './helpers/test_runner.js';

const testsDirUrl = new URL('.', import.meta.url);
const testsDirPath = fileURLToPath(testsDirUrl);

const largeTests = [
  'e2e/e2e.test.js',
];

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

const discoveredTests = await findTests(testsDirPath);

const orderedTests = [
  ...discoveredTests
    .filter((name) => !largeTests.includes(name))
    .sort(),
  ...largeTests.filter((name) => discoveredTests.includes(name)),
];

if (orderedTests.length === 0) {
  console.warn('No test files (*.test.js) found under tests/.');
  process.exit(0);
}

const quiet = process.argv.includes('--quiet');
const failures = [];
const totalStart = performance.now();

for (const testFile of orderedTests) {
  if (!quiet) console.log(`\u25b6 Running ${testFile}`);
  try {
    await import(pathToFileURL(join(testsDirPath, testFile)));
  } catch (error) {
    failures.push({ file: testFile, error });
    console.error(`  FAIL: ${error.message}`);
  }
}

const totalMs = (performance.now() - totalStart).toFixed(0);
const totalTests = getTotalCount();

if (failures.length > 0) {
  console.error(`\n\u2717 ${failures.length} file(s) failed:`);
  for (const { file } of failures) {
    console.error(`  - ${file}`);
  }
  console.error(`  (${totalTests} tests passed before failure, ${totalMs}ms elapsed)`);
  process.exit(1);
}

if (!quiet) console.log('\n');
console.log(`\u2713 All tests passed. (${totalTests} tests across ${orderedTests.length} files in ${totalMs}ms)`);
