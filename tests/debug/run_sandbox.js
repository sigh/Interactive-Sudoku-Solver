// run_sandbox.js — execute a sandbox script outside the browser.
//
// Runs a JS sandbox script (the kind written for sandbox.html) against the real
// sandbox globals from js/sandbox/env.js, then serializes whatever it returns
// into a constraint string. Use it to generate/regenerate puzzle definitions
// (e.g. .iss files) or to check a script's output without opening the browser.
//
// The script body runs as the sandbox runs it: top-level `return` is allowed,
// `await` is allowed, and all SANDBOX_GLOBALS (constraint classes, makeCellId,
// makeSolver, solverLink, help, …) are in scope. console output is printed.
//
// Usage:
//   node tests/debug/run_sandbox.js (--file <path> | --code <string>) [options]
//
// Source (pick one):
//   --file <path>      Read the script from a file.
//   --code <string>    Inline script source.
//
// Options:
//   --current <str>    Constraint string exposed to currentConstraint() /
//                      currentShape() (for scripts that transform the loaded
//                      puzzle). Defaults to none.
//   --raw              Print the return value as-is (via console.log) instead of
//                      serializing it to a constraint string.
//   -h, --help         Print this help and exit.
//
// Examples:
//   node tests/debug/run_sandbox.js --file js/sandbox/inset.js
//   node tests/debug/run_sandbox.js --file gen.js | node tests/debug/solve.js \
//       --max-backtracks none --input-file /dev/stdin --solutions 2

import { readFileSync } from 'node:fs';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runAsCli } from '../helpers/cli_entry.js';

ensureGlobalEnvironment();

const env = await import('../../js/sandbox/env.js' + self.VERSION_PARAM);

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

const parseArgs = (argv) => {
  const args = { file: null, code: null, current: null, raw: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split(/=(.*)/s);
    const next = () => inlineValue ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--file': args.file = next(); break;
      case '--code': args.code = next(); break;
      case '--current': args.current = next(); break;
      case '--raw': args.raw = true; break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tests/debug/run_sandbox.js (--file <path> | --code <string>) [options]

Source (pick one):
  --file <path>      Read the script from a file.
  --code <string>    Inline script source.

Options:
  --current <str>    Constraint string for currentConstraint()/currentShape().
  --raw              Print the return value as-is instead of serializing it.
  -h, --help         Print this help and exit.`);

// Serialize a returned value into a constraint string. Constraints (and arrays
// of them, and raw strings) are accepted; each constraint's toString() defers to
// its class serializer. One constraint per line (the parser ignores whitespace).
const serialize = (value) => {
  const flatten = (v) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.flatMap(flatten);
    if (typeof v === 'string') return [v];
    if (typeof v.toString === 'function') return [v.toString()];
    return [];
  };
  return flatten(value).join('\n');
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }

  let source;
  if (args.code !== null) source = args.code;
  else if (args.file !== null) source = readFileSync(args.file, 'utf8');
  else throw new Error('No script specified. Use --file or --code (or --help).');

  const globals = {
    ...env.SANDBOX_GLOBALS,
    ...env.getSandboxExtraGlobals(args.current),
  };

  const fn = new AsyncFunction(...Object.keys(globals), source);
  const result = await fn(...Object.values(globals));

  if (args.raw) {
    console.log(result);
    return;
  }

  const str = serialize(result);
  if (str) console.log(str);
  else console.error('(script returned no constraints; use --raw to see the value)');
};

runAsCli(import.meta.url, main);
