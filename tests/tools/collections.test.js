// Smoke test: every entry of every data/collections.js collection resolves to a
// usable puzzle config, and its input parses. Collection entries come in three
// shapes — raw constraint strings, PUZZLE_INDEX puzzle names, and inline
// { name, input } objects — and the perf/debug CLIs resolve all three via the
// data layer (resolvePuzzleConfig / PuzzleCollection.configFor). A name-entry
// that doesn't resolve, or an input the parser rejects, previously surfaced only
// when someone benchmarked that collection (EXTREME_KILLERS et al. were broken
// this way for a while); this catches it at test time.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';

ensureGlobalEnvironment();

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const Collections = await import('../../data/collections.js' + self.VERSION_PARAM);
const { resolvePuzzleConfig } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);

for (const [collectionName, collection] of Object.entries(Collections)) {
  if (!Array.isArray(collection)) continue;

  await runTest(`${collectionName}: every entry resolves and parses`, () => {
    collection.forEach((entry, i) => {
      const label = `${collectionName}[${i}]` +
        (typeof entry === 'string' ? ` (${entry.slice(0, 40)})` : '');
      const config = typeof collection.configFor === 'function'
        ? collection.configFor(entry)
        : resolvePuzzleConfig(entry);
      assert.equal(typeof config.input, 'string', `${label}: no input string`);

      if (config.input.startsWith('/')) {
        // Script/file inputs are materialized by the CLIs before parsing; here
        // just check the file exists (running sandbox scripts is too heavy).
        assert.ok(existsSync(join(PROJECT_ROOT, config.input)),
          `${label}: input file missing: ${config.input}`);
      } else {
        assert.doesNotThrow(() => SudokuParser.parseText(config.input),
          `${label}: input does not parse`);
      }
    });
  });
}

logSuiteComplete('Collection resolution smoke');
