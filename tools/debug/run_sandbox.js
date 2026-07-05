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
//   node tools/debug/run_sandbox.js (--file <path> | --code <string>) [options]
//
// Source (pick one):
//   --file <path>      Read the script from a file.
//   --code <string>    Inline script source.
//
// Options:
//   --current <str>    Constraint string exposed to currentConstraint() /
//                      currentCellGeometry() (for scripts that transform the loaded
//                      puzzle). Defaults to none.
//   --raw              Print the return value as-is (via console.log) instead of
//                      serializing it to a constraint string.
//   -h, --help         Print this help and exit.
//
// Examples:
//   node tools/debug/run_sandbox.js --file js/sandbox/inset.js
//   node tools/debug/run_sandbox.js --file gen.js | node tools/debug/solve.js \
//       --max-backtracks none --input-file /dev/stdin --solutions 2

import { readFileSync } from 'node:fs';
import { runAsCli } from '../lib/cli_entry.js';
import { runSandboxScript, serialize } from '../lib/sandbox_runner.js';

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
Usage: node tools/debug/run_sandbox.js (--file <path> | --code <string>) [options]

Source (pick one):
  --file <path>      Read the script from a file.
  --code <string>    Inline script source.

Options:
  --current <str>    Constraint string for currentConstraint()/currentCellGeometry().
  --raw              Print the return value as-is instead of serializing it.
  -h, --help         Print this help and exit.`);

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }

  let source;
  if (args.code !== null) source = args.code;
  else if (args.file !== null) source = readFileSync(args.file, 'utf8');
  else throw new Error('No script specified. Use --file or --code (or --help).');

  const result = await runSandboxScript(source, args.current);

  if (args.raw) {
    console.log(result);
    return;
  }

  const str = serialize(result);
  if (str) console.log(str);
  else console.error('(script returned no constraints; use --raw to see the value)');
};

runAsCli(import.meta.url, main);
