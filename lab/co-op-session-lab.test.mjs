import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import { startLab } from './co-op-session-lab.mjs';

function client(port) {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.setEncoding('utf8');
  let buffer = '';
  const messages = [];
  const waiters = [];
  socket.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const frame = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      if (waiters.length) waiters.shift()(frame);
      else messages.push(frame);
    }
  });
  return {
    socket,
    send: value => socket.write(JSON.stringify(value) + '\n'),
    read: () => new Promise((resolve, reject) => {
      if (messages.length) return resolve(messages.shift());
      const timeout = setTimeout(() => reject(new Error('timed out waiting for message')), 2000);
      waiters.push(value => { clearTimeout(timeout); resolve(value); });
    })
  };
}

test('two accounts see same broadcast with independent identities and disconnect cleanup', async () => {
  const lab = await startLab();
  const alice = client(lab.port);
  const bob = client(lab.port);
  try {
    const [helloA, helloB] = await Promise.all([alice.read(), bob.read()]);
    assert.notEqual(helloA.id, helloB.id);
    alice.send({ type: 'join', user: 'alice' });
    bob.send({ type: 'join', user: 'bob' });
    assert.equal((await alice.read()).user, 'alice');
    assert.equal((await bob.read()).user, 'bob');
    alice.send({ type: 'broadcast', text: 'test-event' });
    assert.deepEqual(await alice.read(), { type: 'message', from: 'alice', text: 'test-event' });
    assert.deepEqual(await bob.read(), { type: 'message', from: 'alice', text: 'test-event' });
    const duplicate = client(lab.port);
    try {
      await duplicate.read();
      duplicate.send({ type: 'join', user: 'alice' });
      assert.equal((await duplicate.read()).code, 'duplicate_user');
    } finally { duplicate.socket.destroy(); }
    bob.socket.destroy();
    await new Promise(resolve => bob.socket.once('close', resolve));
    assert.equal(lab.count(), 1);
  } finally {
    alice.socket.destroy();
    bob.socket.destroy();
    await lab.close();
  }
});

test('reject non-loopback binding', async () => {
  await assert.rejects(startLab({ host: '0.0.0.0' }), /Loopback-only/);
});
