import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Owner ask (2026-11-05): "I want real LP, and ISK and reputation, so this slowly grows you
// and the barricades give you something and the rank grows." This module turns an ACCEPTED war
// contribution (the merit ledger's own evidence key) into real loyalty points in the pilot's
// wallet and real standing with the militia faction - once per contribution, never twice.
// ISK is deliberately not minted: it can only come from a funded war-treasury escrow.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const rewards = require(path.join(forkRoot, "Code/server/src/space/coopWarRewards.js"));

const ENV = {EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1"};

function memoryStore(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    coopAtomicNativeRows: {
      transact(tables, fn) {
        const tx = {
          get: (table, key) => rows.get(`${table}\u001f${key}`) || null,
          put: (table, key, value) => { rows.set(`${table}\u001f${key}`, value); },
        };
        return fn(tx);
      },
    },
    rows,
  };
}

function wallets() {
  const calls = [];
  const standings = [];
  return {
    calls,
    standings,
    lpWallet: {adjustCharacterWalletLPBalance(characterID, issuer, delta, options) {
      calls.push({characterID, issuer, delta, options});
      return {success: true};
    }},
    standingsRuntime: {
      getCharacterRawStanding: () => 1.5,
      setCharacterStanding(characterID, ownerID, standing, options) {
        standings.push({characterID, ownerID, standing, options});
        return {success: true};
      },
    },
  };
}

function build(env = ENV) {
  const store = memoryStore();
  const w = wallets();
  const instance = rewards.createWarRewards({
    gameStore: store,
    lpWallet: w.lpWallet,
    standings: w.standingsRuntime,
    clock: () => 1_800_000_000_000,
    env,
  });
  return {instance, store, ...w};
}

test("a proven kill pays real LP into the militia wallet and real standing with the faction", () => {
  const {instance, calls, standings} = build();
  const paid = instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: 25, evidenceKey: "warship-kill:coop-player-140000005"});
  assert.equal(paid.status, "PAID");
  assert.equal(paid.lp, 125, "25 merit x 5 LP per merit");
  assert.equal(paid.standing, 0.5, "25 merit x 0.02, clamped per award");
  assert.deepEqual(calls.map((call) => [call.characterID, call.issuer, call.delta]),
    [[140000005, 500001, 125]]);
  assert.equal(standings[0].standing, 2, "1.5 + 0.5, right on the real standing record");
  assert.equal(paid.isk, 0);
  assert.equal(paid.iskStatus, "ISK_UNFUNDED", "ISK is never minted by this module");
});

test("the same contribution is never paid twice", () => {
  const {instance, calls} = build();
  const first = instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: 3, evidenceKey: "kill-confirmed:coop-player-140000005"});
  const again = instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: 3, evidenceKey: "kill-confirmed:coop-player-140000005"});
  assert.equal(first.status, "PAID");
  assert.equal(again.status, "DUPLICATE");
  assert.equal(calls.length, 1, "one wallet write for one contribution");
  // The same evidence key from a DIFFERENT pilot is a conflict, not a payment.
  const conflict = instance.payContribution({characterID: 140000107, factionID: 500001,
    meritDelta: 3, evidenceKey: "kill-confirmed:coop-player-140000005"});
  assert.equal(conflict.status, "BLOCKED");
  assert.equal(conflict.reason, "WAR_REWARD_REPLAY_CONFLICT");
});

test("a negative or empty contribution pays nothing", () => {
  const {instance, calls} = build();
  assert.equal(instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: -10, evidenceKey: "force-lost:coop-player-140000005"}).status, "BLOCKED");
  assert.equal(instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: 0, evidenceKey: "zero:coop-player-140000005"}).status, "BLOCKED");
  assert.equal(calls.length, 0);
});

test("disabled, malformed and unauthorised calls say why and pay nothing", () => {
  const off = build({EVEJS_COOP_FACTION_WAR: "0"});
  assert.equal(off.instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: 5, evidenceKey: "warship-kill:x"}).status, "DISABLED");
  assert.equal(off.calls.length, 0);
  const on = build();
  assert.equal(on.instance.payContribution({characterID: 0, factionID: 500001,
    meritDelta: 5, evidenceKey: "k:x"}).reason, "INVALID_REWARD_IDENTITY");
  assert.equal(on.instance.payContribution({characterID: 140000005, factionID: 500001,
    meritDelta: 5, evidenceKey: "bad key!"}).reason, "INVALID_REWARD_IDENTITY");
});

test("a pilot id maps to a character only for real players", () => {
  assert.equal(rewards.characterIDFromPilotID("coop-player-140000005"), 140000005);
  assert.equal(rewards.characterIDFromPilotID("coop-pilot-003"), 0,
    "a virtual pilot has no wallet and no standing");
  assert.equal(rewards.characterIDFromPilotID("nonsense"), 0);
});

test("the rates are bounded and quotable before any payout", () => {
  assert.deepEqual(rewards.quote({meritDelta: 10}),
    {merit: 10, lp: 50, standing: 0.2, factionID: 0});
  assert.equal(rewards.quote({meritDelta: 1000}).standing, rewards.MAX_STANDING_PER_AWARD,
    "one award can never move standing by more than half a point");
  const capped = rewards.rates({EVEJS_COOP_WAR_LP_PER_MERIT: "9999",
    EVEJS_COOP_WAR_STANDING_PER_MERIT: "50"});
  assert.equal(capped.lpPerMerit, 100, "LP per merit is capped");
  assert.equal(capped.standingPerMerit, 1, "standing per merit is capped");
});
