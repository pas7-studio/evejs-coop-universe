#!/usr/bin/env node
// Non-authenticated transport smoke test: two concurrent TCP connections to the
// actual EveJS port. Does NOT claim game protocol, login or co-op is operational.
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.EVEJS_TEST_HOST || '127.0.0.1';
const port = Number(process.env.EVEJS_TEST_PORT || 26000);
const timeoutMs = Number(process.env.EVEJS_TEST_TIMEOUT_MS || 5000);
if (host !== '127.0.0.1' && host !== '::1') {
  throw new Error('Local test only: set EVEJS_TEST_HOST to a loopback address');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid timeout');
const clients = [];
function connectOne(label) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    clients.push(socket);
    let settled = false;
    const timer = setTimeout(() => fail(new Error(label + ': connect timeout')), timeoutMs);
    function cleanup() { clearTimeout(timer); }
    function fail(err) {
      if (settled) return;
      settled = true; cleanup(); socket.destroy(); reject(err);
    }
    socket.on('error', fail);
    socket.once('connect', () => {
      if (settled) return;
      settled = true; cleanup(); resolve(socket);
    });
  });
}
try {
  // Open both connections before either is closed: tests simultaneous accepts.
  const a = await connectOne('client A');
  const b = await connectOne('client B');
  if (a.destroyed || b.destroyed) throw new Error('Server closed one TCP session immediately');
  await delay(250);
  if (a.destroyed || b.destroyed) throw new Error('Server closed a TCP session during idle smoke');
  console.log(JSON.stringify({
    status: 'TRANSPORT_ONLY_PASS',
    host, port,
    simultaneousSockets: 2,
    disclaimer: 'No EVE protocol, login, player state, visibility or persistence validated'
  }, null, 2));
} catch (err) {
  console.error('TRANSPORT_SMOKE_FAIL:', err?.message || err);
  process.exitCode = 1;
} finally {
  for (const socket of clients) socket.destroy();
}
