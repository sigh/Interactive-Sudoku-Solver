// profile.js — per-method profile of a constraint handler during a solve.
//
// Wraps the chosen handler class's methods to count calls, time them, and track
// how often each returns false (a contradiction / failed propagation), then
// solves the given puzzles and prints a per-method breakdown. Works for any
// handler (default ChaosConstruction); use it to find where a handler spends
// its time and which of its rules actually fire.
//
// Usage:
//   node tests/bench/profile.js --max-backtracks <n|none> [options]
//
// Required:
//   --max-backtracks <n|none>  Backtrack cap per solve ("none" = unlimited).
//                              Required and explicit: profiling an unbounded run
//                              on a hard puzzle can hang, and a capped run is a
//                              partial profile — its status is reported as "capped".
//
// Options:
//   --handler <ClassName>  Handler to profile. Default: ChaosConstruction.
//   --methods <a,b,...>    Methods to profile. Default: all of the handler's own
//                          methods. Narrow this (e.g. to the top-level phases) for
//                          clean timing — see the note on inclusive time below.
//   --puzzles <a,b,...>    Names / collections / ladder:<name>. Default: "Chaos Construction".
//   --input <string>       Profile a raw constraint string.
//   --solutions <n|all>    Solutions to search for. Default 2 (proof of uniqueness);
//                          "all" exhausts; "1" is first-solution only (warns).
//   --ablate <a,b,...>     Disable named optimizations during the profiled run.
//   --summary              Only the per-puzzle counter line (no method table).
//   --list-handlers        Print profilable handler names and exit.
//   -h, --help             Print this help and exit.
//
// Note on timing: per-method ms is *inclusive* (a method's time includes time
// spent in any nested method it calls). So times only sum cleanly when the
// profiled methods don't call each other — narrow --methods to the top-level
// phases if you need additive timing. Call counts and false-return counts are
// always exact.
//
// Examples:
//   node tests/bench/profile.js --max-backtracks 50000 --puzzles "Chaos Construction - easier"
//   node tests/bench/profile.js --max-backtracks 50000 --handler Sum --puzzles "Killer sudoku"
//   node tests/bench/profile.js --max-backtracks 50000 --summary --puzzles "ladder:Chaos Construction"

import {
  resolvePuzzles, parseBacktrackLimit, parseSolutionLimit, warnIfFirstSolution,
  runSolve, applyAblations, validateAblations, HANDLERS, handlerMethodNames,
} from './solver_analysis.js';

const parseList = (value) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean);

const parseArgs = (argv) => {
  const args = {
    maxBacktracksRaw: undefined, handler: 'ChaosConstruction', methods: null,
    puzzles: ['Chaos Construction'], solutionsRaw: undefined, ablate: [],
    summary: false, help: false, listHandlers: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split(/=(.*)/s);
    const next = () => inlineValue ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--list-handlers': args.listHandlers = true; break;
      case '--summary': args.summary = true; break;
      case '--max-backtracks': args.maxBacktracksRaw = next(); break;
      case '--handler': args.handler = next(); break;
      case '--methods': args.methods = parseList(next()); break;
      case '--puzzles': args.puzzles = parseList(next()); break;
      case '--input': args.puzzles = ['input:' + next()]; break;
      case '--solutions': args.solutionsRaw = next(); break;
      case '--ablate': args.ablate = parseList(next()); break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
};

const usage = () => console.log(
  `Usage: node tests/bench/profile.js --max-backtracks <n|none> [options]\n\n` +
  `  --max-backtracks <n|none>  REQUIRED. Backtrack cap per solve; "none" = unlimited.\n` +
  `  --handler <ClassName>      Handler to profile (default ChaosConstruction; --list-handlers).\n` +
  `  --methods <a,b,...>        Methods to profile (default: all of the handler's own methods).\n` +
  `  --puzzles <a,b,...>        Names / collections / ladder:<name>. Default: "Chaos Construction".\n` +
  `  --input <string>           Profile a raw constraint string.\n` +
  `  --solutions <n|all>        Default 2 = prove uniqueness; "all" exhausts; "1" = first only (warns).\n` +
  `  --ablate <a,b,...>         Disable optimizations during the run.\n` +
  `  --summary                  Per-puzzle counters only, no method table.\n` +
  `  --list-handlers            List profilable handlers.\n` +
  `\nPer-method ms is inclusive of nested profiled calls; narrow --methods for additive timing.`);

// Wrap each method on the prototype to accumulate call/time/false-return stats.
const installProfiler = (HandlerClass, methods) => {
  const proto = HandlerClass.prototype;
  const stats = Object.fromEntries(methods.map(m => [m, { calls: 0, ms: 0, falseReturns: 0 }]));
  const originals = {};
  for (const name of methods) {
    const orig = proto[name];
    if (typeof orig !== 'function') throw new Error(`${HandlerClass.name} has no method ${name}`);
    originals[name] = orig;
    const s = stats[name];
    proto[name] = function (...callArgs) {
      const t = performance.now();
      let result;
      try { result = orig.apply(this, callArgs); }
      finally { s.ms += performance.now() - t; }
      s.calls++;
      if (result === false) s.falseReturns++;
      return result;
    };
  }
  const restore = () => { for (const name of methods) proto[name] = originals[name]; };
  return { stats, restore };
};

const main = () => {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  if (args.listHandlers) { console.log(Object.keys(HANDLERS).sort().join('\n')); return; }

  const HandlerClass = HANDLERS[args.handler];
  if (!HandlerClass) {
    throw new Error(`unknown handler: ${args.handler} (see --list-handlers)`);
  }
  const maxBacktracks = parseBacktrackLimit(args.maxBacktracksRaw);
  const maxSolutions = parseSolutionLimit(args.solutionsRaw);
  warnIfFirstSolution(maxSolutions);
  validateAblations(args.ablate);
  const methods = args.methods ?? handlerMethodNames(HandlerClass);
  const puzzles = resolvePuzzles(args.puzzles);

  const restoreAblations = args.ablate.length ? applyAblations(args.ablate) : null;
  try {
    for (const puzzle of puzzles) {
      const { stats, restore } = installProfiler(HandlerClass, methods);
      let result;
      try { result = runSolve(puzzle, { maxBacktracks, maxSolutions }); }
      finally { restore(); }

      const c = result.counters;
      console.log(
        `\n${result.name}  [${args.handler}]  status=${result.status} ` +
        `solutions=${c.solutions} guesses=${c.guesses} backtracks=${c.backtracks} ` +
        `nodes=${c.nodesSearched} solveMs=${result.elapsedMs.toFixed(1)}`);
      if (args.summary) continue;

      const rows = methods
        .map(m => ({ m, ...stats[m] }))
        .filter(r => r.calls > 0)
        .sort((a, b) => b.ms - a.ms);
      console.log(['method', 'calls', 'false', 'ms(incl)', 'us/call'].join('\t'));
      for (const r of rows) {
        console.log([r.m, r.calls, r.falseReturns, r.ms.toFixed(1),
        (r.calls ? r.ms * 1000 / r.calls : 0).toFixed(2)].join('\t'));
      }
    }
  } finally { restoreAblations?.(); }
};

try {
  main();
} catch (e) {
  console.error(`error: ${e.message}\n(run with --help for usage)`);
  process.exit(1);
}
