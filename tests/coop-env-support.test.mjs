import test from 'node:test';
import assert from 'node:assert/strict';
import {swapEnv, withEnv} from './_support/env.mjs';

// The helper exists because the hand-written idiom had two silent failure modes:
// assigning `undefined` (which stores the string "undefined") and restoring
// without deleting a flag that was originally unset. Both are asserted here.
const NAME = 'EVEJS_COOP_TEST_SUPPORT_SENTINEL';

test('a value is applied and unset names come back unset', () => {
  delete process.env[NAME];
  const restore = swapEnv({[NAME]: '1'});
  assert.equal(process.env[NAME], '1');
  restore();
  assert.equal(NAME in process.env, false, 'an originally unset name must be deleted, not "undefined"');
});

test('an existing value is restored exactly', () => {
  process.env[NAME] = 'original';
  try {
    const restore = swapEnv({[NAME]: 'changed'});
    assert.equal(process.env[NAME], 'changed');
    restore();
    assert.equal(process.env[NAME], 'original');
  } finally {
    delete process.env[NAME];
  }
});

test('undefined really deletes for the duration', () => {
  process.env[NAME] = 'present';
  try {
    const restore = swapEnv({[NAME]: undefined});
    assert.equal(NAME in process.env, false);
    restore();
    assert.equal(process.env[NAME], 'present');
  } finally {
    delete process.env[NAME];
  }
});

test('numbers are stored as strings, never as the string "undefined"', () => {
  delete process.env[NAME];
  const restore = swapEnv({[NAME]: 0});
  assert.equal(process.env[NAME], '0');
  restore();
  assert.equal(NAME in process.env, false);
});

test('[name, value] pairs work, so a flag list can be mapped straight in', () => {
  delete process.env[NAME];
  const restore = swapEnv([NAME, '1'].map((name) => [name, '1']).slice(0, 1));
  assert.equal(process.env[NAME], '1');
  restore();
  assert.equal(NAME in process.env, false);
});

test('withEnv registers the undo on the test context', () => {
  delete process.env[NAME];
  const registered = [];
  withEnv({after: (fn) => registered.push(fn)}, {[NAME]: '1'});
  assert.equal(process.env[NAME], '1');
  assert.equal(registered.length, 1, 'the restore must be registered with t.after');
  registered[0]();
  assert.equal(NAME in process.env, false);
});

test('restoring twice is harmless', () => {
  delete process.env[NAME];
  const restore = swapEnv({[NAME]: '1'});
  restore();
  restore();
  assert.equal(NAME in process.env, false);
});
