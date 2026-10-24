import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/smoke-two-tcp.mjs');

function runProbe(port) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, EVEJS_TEST_HOST: '127.0.0.1',
        EVEJS_TEST_PORT: String(port), EVEJS_TEST_TIMEOUT_MS: '1000', EVEJS_TEST_HOLD_MS: '150' },
      stdio: ['ignore','pipe','pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', x => stdout += x);
    child.stderr.on('data', x => stderr += x);
    child.once('error', reject);
    child.once('close', code => resolveResult({ code, stdout, stderr }));
  });
}
async function withServer(callback, onConnection = () => {}) {
  const server = net.createServer(onConnection);
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  try { return await callback(server.address().port); }
  finally { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
}
test('transport probe accepts A+B and reconnects A while B survives', async () => {
  let count = 0;
  const sockets = new Set();
  await withServer(async port => {
    const result = await runProbe(port);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /TRANSPORT_RECONNECT_PASS/);
    assert.equal(count, 3, 'expected A, B, then A reconnect');
    for (const s of sockets) s.destroy();
  }, socket => { count++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
});
test('transport probe fails when server rejects a connection', async () => {
  let accepted = 0;
  await withServer(async port => {
    const result = await runProbe(port);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /TRANSPORT_SMOKE_FAIL/);
  }, socket => { accepted++; if (accepted === 2) socket.destroy(); });
});
test('transport probe fails for a non-listening port', async () => {
  const reserving = net.createServer();
  await new Promise(ok => reserving.listen(0, '127.0.0.1', ok));
  const port = reserving.address().port;
  await new Promise(ok => reserving.close(ok));
  const result = await runProbe(port);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /TRANSPORT_SMOKE_FAIL/);
});
