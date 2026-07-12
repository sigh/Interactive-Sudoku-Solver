// sandbox_runner.js — execute a sandbox script and serialize its result.
//
// A sandbox script (the kind written for sandbox.html) runs against the real
// sandbox globals from js/sandbox/env.js and returns constraint objects (or
// strings, or arrays of them). This turns that return value into a constraint
// string — the same text the browser sandbox would produce. Shared by
// run_sandbox.js (the CLI) and the benchmark/profile puzzle loaders, which need
// to resolve a script-file puzzle to its constraint string once, up front.

import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';

ensureGlobalEnvironment();

const env = await import('../../js/sandbox/env.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

// Serialize a returned value into a constraint string. Constraints (and arrays
// of them, and raw strings) are accepted; each constraint's toString() defers to
// its class serializer (the parser ignores whitespace). The combined text is
// then round-tripped through the parser so the class serializers can merge
// repeated constraints -- most importantly, many NFA constraints that share one
// machine emit that machine once instead of per constraint. This matches the
// browser sandbox, which canonicalizes the same way via normalizeToConstraint.
//
// Finally, put each constraint token on its own line for readability.
export const serialize = (value) => {
  const flatten = (v) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.flatMap(flatten);
    if (typeof v === 'string') return [v];
    if (typeof v.toString === 'function') return [v.toString()];
    return [];
  };
  const canonical = SudokuParser.parseString(flatten(value).join('')).toString();
  return canonical.replaceAll('.', '\n.').trim();
};

// Run a sandbox script `source` as the sandbox runs it (top-level return and
// await allowed, all SANDBOX_GLOBALS in scope) and return its raw return value.
// `current` is the constraint string exposed to currentConstraint() for scripts
// that transform the loaded puzzle (null for standalone puzzle scripts).
export const runSandboxScript = async (source, current = null) => {
  const globals = {
    ...env.SANDBOX_GLOBALS,
    ...env.getSandboxExtraGlobals(current),
  };
  const fn = new AsyncFunction(...Object.keys(globals), source);
  return fn(...Object.values(globals));
};

// Run a sandbox script and serialize its result to a constraint string.
export const runSandboxToConstraint = async (source, current = null) =>
  serialize(await runSandboxScript(source, current));
