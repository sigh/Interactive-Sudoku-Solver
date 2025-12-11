import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirUrl = new URL('.', import.meta.url);
const testsDirPath = fileURLToPath(testsDirUrl);

const largeTests = [
  'e2e.test.js',
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

for (const testFile of orderedTests) {
  console.log(`\n▶ Running ${testFile}`);
  await import(pathToFileURL(join(testsDirPath, testFile)));
}

console.log('\n✓ All tests completed successfully');
