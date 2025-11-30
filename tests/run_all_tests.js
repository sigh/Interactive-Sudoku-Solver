import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirUrl = new URL('.', import.meta.url);
const testsDirPath = fileURLToPath(testsDirUrl);

const largeTests = [
  'e2e.test.js',
];

const discoveredTests = (await readdir(testsDirPath))
  .filter((name) => name.endsWith('.test.js'));

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
