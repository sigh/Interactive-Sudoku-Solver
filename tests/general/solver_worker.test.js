import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({ locationValue: { search: '' } });

const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

// Load the worker in this process: its messages are recorded, and messages are
// sent to it by calling its onmessage.
const messages = [];
self.postMessage = (message) => messages.push(message);
const log = console.log;
console.log = () => { };
await import('../../js/solver_worker.js');
console.log = log;

const send = async (method, payload) => {
  messages.length = 0;
  await self.onmessage({ data: { method, payload } });
  return messages.slice();
};

// Constraints reach the worker as structured clones, not class instances.
const init = (constraint, logUpdateFrequency = 0) => send('init', {
  constraint: structuredClone(constraint), logUpdateFrequency,
});

const empty4x4 = () => new SudokuConstraint.Container([new SudokuConstraint.Shape('4x4')]);

await runTest('init builds the solver and replies with a result', async () => {
  const replies = await init(empty4x4());
  assert.deepEqual(replies.at(-1), { type: 'result', result: true });
});

await runTest('a call sends the solver state, then its result', async () => {
  await init(empty4x4());
  const replies = await send('nthSolution', 0);

  assert.deepEqual(replies.map(m => m.type), ['state', 'result']);
  assert.equal(replies[0].state.counters.solutions, 1);
  assert.equal(replies[1].result.length, 16);
});

await runTest('progress states are sent while the call runs', async () => {
  await init(empty4x4(), 1);
  const replies = await send('countSolutions');

  assert.ok(replies.length > 2, 'progress states precede the final state');
  assert.ok(replies.slice(0, -1).every(m => m.type === 'state'));
  assert.deepEqual(replies.at(-1), { type: 'result', result: 288 });
});

await runTestCases('reporting frequency preserves final worker results and stats', [
  ['count', 'countSolutions'],
  ['estimate', 'estimatedCountSolutions'],
  ['possibilities', 'solveAllPossibilities', { candidateSupportThreshold: 2 }],
  ['solutions', 'nthSolution', 2],
  ['steps', 'nthStep', [5, new Map()]],
  ['layout', 'validateLayout'],
], async (method, payload) => {
  const run = async (frequency) => {
    const constraint = empty4x4();
    constraint.constraints.push(new SudokuConstraint.Given('R1C1', 1));
    await init(constraint, frequency);
    const replies = await send(method, payload);
    assert.equal(replies.at(-1).type, 'result');
    assert.equal(replies.at(-2).type, 'state', 'the worker must send final stats before the result');
    const state = replies.at(-2).state;
    return {
      result: replies.at(-1).result,
      counters: state.counters,
      estimate: state.estimate,
      done: state.done,
      updates: replies.filter(m => m.type === 'state').length,
    };
  };

  const { updates: frequentUpdates, ...frequent } = await run(1);
  const { updates: sparseUpdates, ...sparse } = await run(25);
  assert.ok(frequentUpdates > sparseUpdates, 'periodic stats must still arrive during search');
  assert.deepEqual(sparse, frequent);
});

await runTest('an error is sent as an exception with its name, message and stack', async () => {
  // A jigsaw piece of the wrong size fails to build.
  const replies = await init(new SudokuConstraint.Jigsaw('R1C1', 'R1C2'));

  assert.equal(replies.length, 1);
  const [reply] = replies;
  assert.equal(reply.type, 'exception');
  assert.equal(reply.method, 'init');
  assert.equal(reply.error.name, 'InvalidConstraintError');
  assert.equal(typeof reply.error.message, 'string');
  assert.equal(typeof reply.error.stack, 'string');
});

await runTest('an unknown method is sent as an exception', async () => {
  const [reply] = await send('noSuchMethod');
  assert.equal(reply.type, 'exception');
  assert.match(reply.error.message, /Unknown method noSuchMethod/);
});

// Remove what the worker installed, so later test files don't see it.
for (const name of ['onmessage', 'postMessage', 'debugCount', 'debugSet']) {
  delete globalThis[name];
}

logSuiteComplete('solver_worker');
