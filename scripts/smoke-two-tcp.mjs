#!/usr/bin/env node
// Real TCP listener probe: two overlapping connections, A disconnect/reconnect,
// and B remaining connected. No EVE protocol messages are transmitted.
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.EVEJS_TEST_HOST || '127.0.0.1';
const port = Number(process.env.EVEJS_TEST_PORT || 26000);
const timeoutMs = Number(process.env.EVEJS_TEST_TIMEOUT_MS || 5000);
const holdMs = Number(process.env.EVEJS_TEST_HOLD_MS || 500);
if (!['127.0.0.1','::1'].includes(host)) throw new Error('Loopback only');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid timeout');
if (!Number.isInteger(holdMs) || holdMs < 100 || holdMs > 10000) throw new Error('Invalid hold');
const sockets = new Set();
const closed = new WeakSet();
function connect(label) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host,port});
    sockets.add(socket);
    socket.on('end',()=>closed.add(socket));
    socket.on('close',()=>{closed.add(socket);sockets.delete(socket);});
    // Always retain an error listener after connect to avoid unhandled errors.
    socket.on('error',err=>{if (!settled) fail(err); else closed.add(socket);});
    let settled=false;
    const timer=setTimeout(()=>fail(new Error(label+': timeout')),timeoutMs);
    function fail(err){if(settled)return;settled=true;clearTimeout(timer);socket.destroy();reject(err);}
    socket.once('connect',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve(socket);});
  });
}
function assertActive(socket,label){
  if (!socket || socket.destroyed || closed.has(socket) || socket.writableEnded || socket.readableEnded)
    throw new Error(label+': socket closed unexpectedly');
}
try {
  const [a,b] = await Promise.all([connect('A'),connect('B')]);
  assertActive(a,'A');assertActive(b,'B');
  await delay(holdMs);
  assertActive(a,'A');assertActive(b,'B');
  a.destroy();
  const replacement=await connect('A-reconnect');
  assertActive(replacement,'A-reconnect');
  assertActive(b,'B-survivor');
  await delay(holdMs);
  assertActive(replacement,'A-reconnect');assertActive(b,'B-survivor');
  console.log(JSON.stringify({
    status:'TRANSPORT_RECONNECT_PASS',host,port,
    concurrentSessions:2,replacements:1,holdMs,
    disclaimer:'TCP only: no EVE handshake, authentication, in-world movement or NPC'
  },null,2));
} catch(err){
  console.error('TRANSPORT_SMOKE_FAIL:',err?.message||err);
  process.exitCode=1;
} finally {for(const s of sockets)s.destroy();}
