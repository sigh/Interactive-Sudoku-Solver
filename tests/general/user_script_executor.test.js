import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({
  needWindow: true,
});

// Mock Worker
class MockWorker {
  constructor(script) {
    this.script = script;
    this.onmessage = null;
    setTimeout(() => {
      // Simulate ready message
      if (this.onmessage) {
        this.onmessage({ data: { type: 'ready' } });
      }
    }, 1);
  }
  postMessage(msg) {
    // Echo back with a delay
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({ data: { id: msg.id, result: 'success', type: 'response' } });
      }
    }, 5);
  }
  terminate() { }
}
globalThis.Worker = MockWorker;

// Import UserScriptExecutor
const { UserScriptExecutor } = await import('../../js/sudoku_constraint.js');

await runTest('UserScriptExecutor timeout override', async () => {
  const executor = new UserScriptExecutor();

  // Default timeout is passed as argument.
  // Mock worker responds in 5ms, so 100ms is plenty.
  await executor._call('test', {}, 100);

  // Now set global timeout to be very short to force timeout.
  // 1ms is shorter than the 5ms mock response delay.
  self.USER_SCRIPT_TIMEOUT = 1;
  try {
    await executor._call('test', {}, 100);
    assert.fail('Should have timed out due to global override');
  } catch (e) {
    assert.match(e.message, /Execution timed out/);
  }

  // Reset
  delete self.USER_SCRIPT_TIMEOUT;
});

logSuiteComplete('UserScriptExecutor');
