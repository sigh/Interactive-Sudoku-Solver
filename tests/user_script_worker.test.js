import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from './helpers/test_env.js';

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
console.log('Importing user_script_worker.js...');
await import('../js/user_script_worker.js');

// Helper to wait for a message
const waitForMessage = async (predicate, timeout = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const msg = messages.find(predicate);
    if (msg) return msg;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Timeout waiting for message');
};

// Helper to send a message to the worker and wait for response
const sendMessage = async (type, payload) => {
  const id = Date.now() + Math.random();
  const responsePromise = waitForMessage(m => m.id === id);

  // Simulate onmessage event
  await globalThis.onmessage({ data: { id, type, payload } });

  return responsePromise;
};

// Test Suite
console.log('Waiting for worker ready...');
await waitForMessage(m => m.type === 'ready');
console.log('Worker is ready.');

// Test 1: compilePairwise
{
  console.log('Test: compilePairwise');
  const response = await sendMessage('compilePairwise', {
    type: 'Pair',
    fnStr: 'a !== b',
    numValues: 9
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result);
  // Pair constraint key for a !== b with 9 values should be a specific string or structure
  // We just check it returns something truthy and looks like a constraint key (usually a string or object)
}

// Test 2: compileStateMachine (Unified)
{
  console.log('Test: compileStateMachine (Unified)');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 2b: compileStateMachine (Unified) with NUM_CELLS
{
  console.log('Test: compileStateMachine (Unified) with NUM_CELLS');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 2c: compileStateMachine (Unified) with maxDepth
{
  console.log('Test: compileStateMachine (Unified) with maxDepth');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 2d: compileStateMachine (Unified) with maxDepth using NUM_CELLS
{
  console.log('Test: compileStateMachine (Unified) with maxDepth using NUM_CELLS');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 2e: compileStateMachine (Split) with NUM_CELLS
{
  console.log('Test: compileStateMachine (Split) with NUM_CELLS');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 2f: compileStateMachine (Split) with maxDepthExpression
{
  console.log('Test: compileStateMachine (Split) with maxDepthExpression');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 2g: compileStateMachine (Split) with empty maxDepthExpression defaults to Infinity
{
  console.log('Test: compileStateMachine (Split) with empty maxDepthExpression');
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
  if (response.error) console.error('StateMachine Error:', response.error);
  assert.equal(response.error, undefined);
  assert.ok(response.result);
}

// Test 3: runSandboxCode
{
  console.log('Test: runSandboxCode');
  const code = `
    console.log("Hello from sandbox");
    return "ConstraintString";
  `;
  const response = await sendMessage('runSandboxCode', { code });
  assert.equal(response.error, undefined);
  assert.equal(response.result.constraintStr, "ConstraintString");
  assert.ok(response.result.logs.some(l => l.includes("Hello from sandbox")));
}

// Test 4: runSandboxCode with error
{
  console.log('Test: runSandboxCode with error');
  const code = `
    console.log("About to fail");
    throw new Error("Sandbox Error");
  `;
  const response = await sendMessage('runSandboxCode', { code });
  assert.ok(response.error);
  assert.ok(response.error.includes("Sandbox Error"));
  assert.ok(response.logs.some(l => l.includes("About to fail")));
}

// Test 5: convertUnifiedToSplit extracts maxDepth
{
  console.log('Test: convertUnifiedToSplit extracts maxDepth');
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
}

// Test 6: convertUnifiedToSplit handles missing maxDepth
{
  console.log('Test: convertUnifiedToSplit handles missing maxDepth');
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
}

console.log('user_script_worker.test.js passed!');
