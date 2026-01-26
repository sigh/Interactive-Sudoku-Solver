import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';

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
    }, 10);
  }
  postMessage(msg) {
    // Echo back with a delay
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({ data: { id: msg.id, result: 'success', type: 'response' } });
      }
    }, 50);
  }
  terminate() { }
}
globalThis.Worker = MockWorker;

// Import UserScriptExecutor
const { UserScriptExecutor } = await import('../../js/sudoku_constraint.js');

// Test
{
  console.log('Test: UserScriptExecutor timeout override');
  const executor = new UserScriptExecutor();

  // Default timeout is passed as argument.
  // Let's try a call with a short timeout that should pass (mock worker takes 50ms)
  await executor._call('test', {}, 100);
  console.log('Normal call passed');

  // Now set global timeout to be very short to force timeout
  self.USER_SCRIPT_TIMEOUT = 10;
  try {
    await executor._call('test', {}, 100);
    assert.fail('Should have timed out due to global override');
  } catch (e) {
    assert.match(e.message, /Execution timed out/);
    console.log('Global override caused timeout as expected');
  }

  // Reset
  delete self.USER_SCRIPT_TIMEOUT;
}

console.log('user_script_executor.test.js passed!');
