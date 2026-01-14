import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from './helpers/test_env.js';

ensureGlobalEnvironment({
  needWindow: true,
});

const { SANDBOX_GLOBALS } = await import('../js/sandbox/env.js');
const { parseConstraint, Container } = SANDBOX_GLOBALS;

// Test parseConstraint returns array for single constraint
{
  console.log('Test: parseConstraint returns array for single constraint');
  const result = parseConstraint('.Cage~10~R1C1~R1C2');
  assert.ok(Array.isArray(result), 'Result should be an array');
  assert.equal(result.length, 1, 'Should have one constraint');
  assert.equal(result[0].type, 'Cage', 'Should be a Cage constraint');
}

// Test parseConstraint returns array for multiple constraints
{
  console.log('Test: parseConstraint returns array for multiple constraints');
  const result = parseConstraint('.Cage~10~R1C1~R1C2.Thermo~R3C3~R3C4~R3C5');
  assert.ok(Array.isArray(result), 'Result should be an array');
  assert.equal(result.length, 2, 'Should have two constraints');
  assert.equal(result[0].type, 'Cage', 'First should be Cage');
  assert.equal(result[1].type, 'Thermo', 'Second should be Thermo');
}

// Test parseConstraint unwraps Container properly
{
  console.log('Test: parseConstraint unwraps Container');
  // Multiple constraints get wrapped in a Container by the parser
  const result = parseConstraint('.Given~R1C1_1.Given~R2C2_2');
  assert.ok(Array.isArray(result), 'Result should be an array');
  // Should unwrap Container and return the inner constraints
  assert.ok(result.every(c => c.type !== 'Container'),
    'Should not contain Container in result');
}

// Test parseConstraint with constraint that doesn't become Container
{
  console.log('Test: parseConstraint with single Given');
  const result = parseConstraint('.Given~R1C1_5');
  assert.ok(Array.isArray(result), 'Result should be an array');
  assert.equal(result.length, 1, 'Should have one constraint');
  assert.equal(result[0].type, 'Given', 'Should be a Given constraint');
}

// Test solverLink with string constraint
{
  console.log('Test: solverLink with string constraint');
  const { solverLink } = SANDBOX_GLOBALS;
  const link = solverLink('.Cage~10~R1C1~R1C2', 'Test Link');
  assert.equal(link.constraintStr(), '.Cage~10~R1C1~R1C2', 'constraintStr() should match');
  assert.equal(link.text, 'Test Link', 'text should match');
}

// Test solverLink with constraint object
{
  console.log('Test: solverLink with constraint object');
  const { solverLink, Cage } = SANDBOX_GLOBALS;
  const cage = new Cage(10, 'R1C1', 'R1C2');
  const link = solverLink(cage);
  assert.ok(link.constraintStr().includes('Cage'), 'constraintStr() should include Cage');
  assert.equal(link.text, undefined, 'text should be undefined when not provided');
}

// Test solverLink with array of constraints
{
  console.log('Test: solverLink with array of constraints');
  const { solverLink, Cage, Thermo } = SANDBOX_GLOBALS;
  const constraints = [
    new Cage(10, 'R1C1', 'R1C2'),
    new Thermo('R3C3', 'R3C4'),
  ];
  const link = solverLink(constraints, 'Multiple');
  assert.ok(link.constraintStr().includes('Cage'), 'constraintStr() should include Cage');
  assert.ok(link.constraintStr().includes('Thermo'), 'constraintStr() should include Thermo');
  assert.equal(link.text, 'Multiple', 'text should match');
}

console.log('sandbox_env.test.js passed!');
