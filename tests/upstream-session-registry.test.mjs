// Tests the REAL upstream EveJS sessionRegistry module, not our lab replica.
// Usage: EVEJS_CODE_PATH=/path/to/EveJS/Code node --test tests/upstream-session-registry.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const root = process.env.EVEJS_CODE_PATH;
if (!root) throw new Error('Set EVEJS_CODE_PATH to a locally checked-out EveJS/Code directory.');
const source = resolve(root, 'server/src/services/chat/sessionRegistry.js');
if (!existsSync(source)) throw new Error('Missing upstream registry: ' + source);
const require = createRequire(import.meta.url);
const registry = require(source);

const makeSession = (clientID, characterID, lastActivity = 100) => ({
  clientID, characterID, lastActivity, connectTime: 100,
  socket: { destroyed: false }
});

test('two distinct EveJS characters remain independently addressable', () => {
  const alice = makeSession(1001, 2001);
  const bob = makeSession(1002, 2002);
  registry.register(alice); registry.register(bob);
  try {
    assert.equal(registry.findSessionByCharacterID(2001), alice);
    assert.equal(registry.findSessionByCharacterID(2002), bob);
    assert.ok(registry.getSessions().includes(alice));
    assert.ok(registry.getSessions().includes(bob));
    alice.socket.destroyed = true;
    registry.unregister(alice);
    assert.equal(registry.findSessionByCharacterID(2001), null);
    assert.equal(registry.findSessionByCharacterID(2002), bob);
  } finally {
    registry.unregister(alice); registry.unregister(bob);
  }
});

test('duplicate character selection prefers the newest live session', () => {
  const older = makeSession(1003, 2003, 100);
  const newer = makeSession(1004, 2003, 200);
  registry.register(older); registry.register(newer);
  try {
    assert.equal(registry.findSessionByCharacterID(2003), newer);
    assert.equal(registry.findSessionByCharacterID(2003, { excludeSession: newer }), older);
    newer.socket.destroyed = true;
    assert.equal(registry.findSessionByCharacterID(2003), older);
  } finally {
    registry.unregister(older); registry.unregister(newer);
  }
});

test('registry re-indexes a character reassignment', () => {
  const session = makeSession(1005, 2004);
  registry.register(session);
  try {
    session.characterID = 2005;
    registry.indexCharacterSession(session);
    assert.equal(registry.findSessionByCharacterID(2004), null);
    assert.equal(registry.findSessionByCharacterID(2005), session);
    registry.deindexCharacterSession(session);
    // Fallback full scan intentionally still locates live sessions with a bound character.
    assert.equal(registry.findSessionByCharacterID(2005), session);
  } finally {
    registry.unregister(session);
  }
});
