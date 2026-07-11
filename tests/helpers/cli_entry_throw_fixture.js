// Fixture for the CLI exit-code contract (tests/tools/tools.test.js). Imports
// ONLY the shared cli_entry helper — no solver module graph — so spawning it is
// cheap. runAsCli must map a thrown error to a non-zero exit with a clean
// message; this throws unconditionally to exercise that path.
import { runAsCli } from '../../tools/lib/cli_entry.js';

runAsCli(import.meta.url, () => {
  throw new Error('fixture: intentional failure');
});
