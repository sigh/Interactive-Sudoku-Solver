import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({
  needWindow: true,
});

const { encodeCodeParam, decodeCodeParam } = await import('../../js/sandbox/embedded_sandbox.js');
const { Base64Codec } = await import('../../js/util.js');

await runTest('encodeCodeParam round-trips through decodeCodeParam', async () => {
  const code = 'const cells = [];\nfor (let i = 0; i < 9; i++) cells.push(i);\n';
  const param = await encodeCodeParam(code);
  assert.equal(await decodeCodeParam(param), code);
});

await runTest('encodeCodeParam round-trips non-ASCII code', async () => {
  const code = '// 日本語コメント — UTF-8 must survive.\nreturn "π";';
  const param = await encodeCodeParam(code);
  assert.equal(await decodeCodeParam(param), code);
});

await runTest('encodeCodeParam marks compressed payloads with "."', async () => {
  const param = await encodeCodeParam('return 1;');
  assert.match(param, /^\.[A-Za-z0-9_-]+$/);
});

await runTest('encodeCodeParam value survives URLSearchParams unchanged', async () => {
  const param = await encodeCodeParam('const x = 1;');
  const url = new URL('https://example.com/');
  url.searchParams.set('code', param);
  assert.equal(new URL(url.toString()).searchParams.get('code'), param);
});

await runTest('encodeCodeParam compresses repetitive code', async () => {
  const code = 'const puzzle = shape(9);\npuzzle.add(cell);\n'.repeat(20);
  const param = await encodeCodeParam(code);
  assert.ok(param.length < Base64Codec.encodeString(code).length / 2);
});

await runTest('decodeCodeParam decodes legacy uncompressed values', async () => {
  const code = 'return "legacy";';
  assert.equal(await decodeCodeParam(Base64Codec.encodeString(code)), code);
});

await runTest('decodeCodeParam rejects corrupt compressed values', async () => {
  await assert.rejects(decodeCodeParam('.not-a-deflate-stream'));
});

logSuiteComplete('code param');
