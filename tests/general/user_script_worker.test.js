import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

// Setup global environment to mock a Worker
const messages = [];
const postMessage = (msg) => {
  messages.push(msg);
};

ensureGlobalEnvironment({
  needWindow: false,
  locationValue: { search: '' },
});

// Mock self and postMessage
globalThis.self = globalThis;
globalThis.postMessage = postMessage;

// Import the worker script
// This will trigger the top-level execution and the async modulesPromise
await import('../../js/user_script_worker.js');

// Helper to wait for a message.
// Most messages arrive synchronously via postMessage, but the initial
// 'ready' message is posted after async module imports, so we yield
// with setTimeout(0) to let those resolve.
const waitForMessage = async (predicate) => {
  for (let i = 0; i < 20; i++) {
    const msg = messages.find(predicate);
    if (msg) return msg;
    await new Promise(r => setTimeout(r, 0));
  }
  throw new Error('Message not found after waiting');
};

// Helper to send a message to the worker and wait for response
// Also collects streaming messages (logs, status) for runSandboxCode
const sendMessage = async (type, payload) => {
  const id = Date.now() + Math.random();
  const streamedLogs = [];
  const streamedStatus = [];

  // For runSandboxCode, include id in payload so worker can send streaming messages
  const fullPayload = type === 'runSandboxCode' ? { ...payload, id } : payload;

  const responsePromise = waitForMessage(m => m.id === id && (m.result !== undefined || m.error !== undefined));

  // Collect streaming messages
  const collectStreaming = () => {
    for (const msg of messages) {
      if (msg.id === id) {
        if (msg.type === 'log' && msg.segments) {
          const text = msg.segments.map(s => typeof s === 'string' ? s : s.text).join(' ');
          if (!streamedLogs.includes(text)) {
            streamedLogs.push(text);
          }
        }
        if (msg.type === 'status' && msg.segments) {
          const text = msg.segments.map(s => typeof s === 'string' ? s : s.text).join(' ');
          if (!streamedStatus.includes(text)) {
            streamedStatus.push(text);
          }
        }
      }
    }
  };

  // Simulate onmessage event
  await globalThis.onmessage({ data: { id, type, payload: fullPayload } });

  const response = await responsePromise;
  collectStreaming();

  // Attach streaming data to response for tests
  response.streamedLogs = streamedLogs;
  response.streamedStatus = streamedStatus;

  return response;
};

// Test Suite
await waitForMessage(m => m.type === 'ready');

await runTest('compilePairwise', async () => {
  const response = await sendMessage('compilePairwise', {
    type: 'Pair',
    fnStr: 'a !== b',
    numValues: 9
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine unified', async () => {
  const spec = `
    const startState = 0;
    const transition = (state, value) => (state + 1) % 4;
    const accept = (state) => state === 3;
  `;
  const response = await sendMessage('compileStateMachine', {
    spec,
    numValues: 9,
    isUnified: true
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine unified with NUM_CELLS', async () => {
  const spec = `
    const startState = 0;
    const transition = (state, value) => state < NUM_CELLS ? state + 1 : undefined;
    const accept = (state) => state === NUM_CELLS;
  `;
  const response = await sendMessage('compileStateMachine', {
    spec,
    numValues: 9,
    numCells: 5,
    isUnified: true
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine unified with maxDepth', async () => {
  const spec = `
    const startState = 0;
    const transition = (state, value) => (state + 1) % 5;
    const accept = (state) => state > 0;
    maxDepth = 10;
  `;
  const response = await sendMessage('compileStateMachine', {
    spec,
    numValues: 9,
    numCells: 5,
    isUnified: true
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine unified with maxDepth using NUM_CELLS', async () => {
  const spec = `
    const startState = 0;
    const transition = (state, value) => (state + 1) % 10;
    const accept = (state) => state > 0;
    maxDepth = NUM_CELLS * 2;
  `;
  const response = await sendMessage('compileStateMachine', {
    spec,
    numValues: 9,
    numCells: 5,
    isUnified: true
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine split with NUM_CELLS', async () => {
  const response = await sendMessage('compileStateMachine', {
    spec: {
      startExpression: '0',
      transitionBody: 'return state < NUM_CELLS ? state + 1 : undefined;',
      acceptBody: 'return state === NUM_CELLS;',
    },
    numValues: 9,
    numCells: 3,
    isUnified: false
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine split with maxDepthExpression', async () => {
  const response = await sendMessage('compileStateMachine', {
    spec: {
      startExpression: '0',
      transitionBody: 'return (state + 1) % 10;',
      acceptBody: 'return state > 0;',
      maxDepthExpression: 'NUM_CELLS + 5',
    },
    numValues: 9,
    numCells: 3,
    isUnified: false
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('compileStateMachine split with empty maxDepthExpression', async () => {
  const response = await sendMessage('compileStateMachine', {
    spec: {
      startExpression: '0',
      transitionBody: 'return (state + 1) % 5;',
      acceptBody: 'return state > 0;',
      maxDepthExpression: '',
    },
    numValues: 9,
    numCells: 3,
    isUnified: false
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
});

await runTest('runSandboxCode', async () => {
  const code = `
    console.log("Hello from sandbox");
    return "ConstraintString";
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr: '' });
  assert.equal(response.error, undefined);
  assert.equal(response.result.constraintStr, "ConstraintString");
  assert.ok(response.streamedLogs.some(l => l.includes("Hello from sandbox")));
});

await runTest('runSandboxCode currentConstraint()', async () => {
  const currentConstraintStr = '.Shape~6x6';
  const code = `
    return currentConstraint();
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr });
  assert.equal(response.error, undefined);
  assert.equal(response.result.constraintStr, currentConstraintStr);
});

await runTest('runSandboxCode currentShape()', async () => {
  const currentConstraintStr = '.Shape~6x6';
  const code = `
    const shape = currentShape();
    if (shape.numRows !== 6 || shape.numCols !== 6) {
      throw new Error('Unexpected shape');
    }
    return currentConstraint();
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr });
  assert.equal(response.error, undefined);
  assert.equal(response.result.constraintStr, currentConstraintStr);
});

await runTest('runSandboxCode with error', async () => {
  const code = `
    console.log("About to fail");
    throw new Error("Sandbox Error");
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr: '' });
  assert.ok(response.error);
  assert.ok(response.error.includes("Sandbox Error"));
  assert.ok(response.streamedLogs.some(l => l.includes("About to fail")));
});

await runTest('convertUnifiedToSplit extracts maxDepth', async () => {
  const code = `
    startState = 0;
    function transition(state, value) {
      return state + 1;
    }
    function accept(state) {
      return state > 0;
    }
    maxDepth = 42;
  `;
  const response = await sendMessage('convertUnifiedToSplit', { code });
  assert.equal(response.error, undefined);
  assert.equal(response.result.startExpression, '0');
  assert.ok(response.result.transitionBody.includes('return state + 1'));
  assert.ok(response.result.acceptBody.includes('return state > 0'));
  assert.equal(response.result.maxDepthExpression, '42');
});

await runTest('convertUnifiedToSplit handles missing maxDepth', async () => {
  const code = `
    startState = "start";
    function transition(state, value) {
      return "next";
    }
    function accept(state) {
      return state === "next";
    }
  `;
  const response = await sendMessage('convertUnifiedToSplit', { code });
  assert.equal(response.error, undefined);
  assert.equal(response.result.maxDepthExpression, '');
});

await runTest('runSandboxCode with console.info for status', async () => {
  const code = `
    console.info("Status update 1");
    console.info("Status update 2");
    return null;
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr: '' });
  assert.equal(response.error, undefined);
  assert.ok(response.streamedStatus.some(s => s.includes("Status update 1")));
  assert.ok(response.streamedStatus.some(s => s.includes("Status update 2")));
});

await runTest('runSandboxCode with null return', async () => {
  const code = `
    console.log("No constraint returned");
    return null;
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr: '' });
  assert.equal(response.error, undefined);
  assert.equal(response.result.constraintStr, null);
});

await runTest('runSandboxCode with undefined return', async () => {
  const code = `
    console.log("Implicit undefined return");
  `;
  const response = await sendMessage('runSandboxCode', { code, currentConstraintStr: '' });
  assert.equal(response.error, undefined);
  assert.equal(response.result.constraintStr, null);
});

logSuiteComplete('UserScriptWorker');
