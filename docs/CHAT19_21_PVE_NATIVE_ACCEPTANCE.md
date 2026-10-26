# Chat 19 + 21 — PvE native verification gates

**State (2026-10-26): code prepared; isolated source receipts/test logic checked.
Real Node CI, actual pinned overlay roundtrip and two connected real clients
remain unverified until their separate jobs execute. No PvE flag enabled
or native server deployed by this PR.**

## Existing source-authoritative architecture

This gate reuses original pinned EveJS (upstream commit
`c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`), the ONE reversible
`scripts/patch-evejs-coop.cjs` installer, and the original
agent/dungeon/npc/wallet/itemStore/LP/standing modules.

It does **not** spawn a second server, add a fake mission ledger,
create game entities or run any client.


## Final hardening — PR #323 (2026-10-26)

The PVE-005 final dependent PR is intentionally additive and remains
default OFF; it does not merge any staged changes into `main` or
activate a persistent world.

### Fixes and source-backed evidence

- The original `coopRuntimeProbe.observe` now stamps every emitted
  source event with a server-generated UUID v4 `runtimeRunID`, **after**
  all caller fields, so a native event caller cannot override that ID.
  The read-only cross-PvE auditor rejects event logs without a valid
  boot ID, and rejects attempts to combine one prior-boot boss death
  with later-boot personal payout receipts. This deliberately refuses
  to treat a server restart as one already-proven session.
- The opt-in native boss loot fence now examines the *original native
  wreck record* even when the in-process boss witness is missing.
  A native transient wreck whose original `profileID` or
  `lootTableID` explicitly identifies an overseer/boss/officer/
  commander is blocked with `BOSS_LOOT_LIVE_WITNESS_REQUIRED` rather
  than bypassing the durable claim after restart. Ordinary untagged
  native wrecks continue original EveJS item transfer. This is a
  conservative heuristic, NOT globally durable original-boss identity.
- Zero-ISK untimed native bonus item rewards now count toward expected
  station-hangar item quantities, matching original
  `isMissionBonusRewardAvailable`. Timed zero-ISK bonus items cannot
  be inferred from wallet amounts, so the strict audit fails closed
  pending a transaction-scoped source receipt.
- Actual **pinned upstream** source content was read: the 5.39 MB
  `npcProfiles/data.json` has **171 distinct profiles** linked to
  `parity_deadspace_overseer_pending_loot` and that original table
  has **4 positive-weight special/faction/deadspace selectors**.
  This is real catalog data, not a test fixture. It does not prove
  item candidate pools, authored dungeon availability, RNG occurrence
  or live client loot. The source catalog audit is now a hard pinned
  gate; the separate installed native
  `coop-pve-native-rare-candidates.test.mjs` checks that source
  selectors resolve to at least one real native item type in the
  original `npcLoot._testing.getRuleCandidatePool`.

### Verification status

- **PASS, isolated V8 original branch source:** 118 source PvE /
  NPC / native duo-reward unit scenarios, 457 assertions;
  16 durable loot-claim scenarios, 51 assertions (simulated fsync);
  14 native cross-event correlation cases, 40 assertions;
  6 native catalog audit cases, 11 assertions.
  **154/154 cases, 559 assertions**, across those disjoint source suites.
- **PASS, actual pinned data read through GitHub:** 171 original
  authored overseer profile links and 4 rule selectors; catalog
  auditor returned `SOURCE_AUTHORED_BOSS_TABLE_LINK_PRESENT`.
- **NOT VERIFIED:** actual Node22 GitHub Actions / pinned installer
  roundtrip, original item candidate pool test (requires installed
  pinned native data reader), actual on-disk crash fsync, two real
  authenticated clients, native network/RPC loot and payouts, real
  rare roll, native SQLite/Rust and post-restart settlement.
  Those statuses cannot be replaced with PASS from V8 source checks.

### Required final release gates

1. Real Node22 source suite must report PASS, including the server-run
   UUID telemetry test and rare source catalog tests.
2. Disposable original pinned EveJS complete installer dry-run,
   install, reapply, source verification and exact remove must PASS.
   The new native rare candidate pool test must also PASS.
3. Original in-game E2E must complete all **16** independent scenarios
   in `tests/scenarios/chat19-21-native-two-client-pve-e2e.json`,
   with two authenticated real clients, no counterfeit scene/ships,
   original NPCs and source-backed rewards. A server-only JSONL
   correlation is insufficient.
4. Crash/restart mid-grant or between captain/wingman payout must not
   duplicate original native ISK/LP/items/standing; manual recovery
   is mandatory where cross-store atomicity is not provided by EveJS.
5. After these gates, review and merge all stacked PvE PRs in
   dependency order. Do not deploy code and enable all flags in one
   uncontrolled operation.

## 1. CI source tests: genuine Node runner

From this branch of the overlay repository:

```sh
node scripts/Run-Pve-Native-Gates.cjs --source
```

Runs explicit 25+ actual `node --test` source suites covering:
native NPC aggression, authored dungeon site-defense, reinforcements,
boss HP and original wreck, real native loot items and replay barriers,
fleet mission join/provenance, native leader/peer payout fences, two
individual personal reward evidence paths, physical reward station
itemStore/standing custody, and source-only event correlation.
It also checks syntax of the copied integration modules and verifies
all PvE gates remain OFF in `docs/coop-flags.json`.

The source runner **never** sets
`EVEJS_COOP_VIRTUAL_WORLD=1`, starts headless scenes, invokes actual
client RPCs, writes to a native gameStore or claims a live rare drop.

GitHub Actions: `.github/workflows/pve-chat19-21-native.yml`;
a `push` event on this PR's feature branch runs the actual Node suite.

## 2. Disposable pinned original EveJS overlay roundtrip

The second CI job checks out **exactly** the pinned upstream into
`isolated-upstream/Code` (separate temporary Git directory), then
runs:

```sh
EVEJS_PVE_DISPOSABLE_CHECKOUT=1 node scripts/Run-Pve-Native-Gates.cjs \
  --pinned-only --upstream-code isolated-upstream/Code
```

The runner refuses missing explicit disposable attestation, wrong
upstream SHA, a non-clean native repo, a directory not literally named
`isolated-upstream/Code`, and any attempted use against a live server.

For the disposable checkout only: native dry run → original installer
→ `--check` drift audit → second install MUST be no-op → pinned native
source-only tests → original overlay removal → exact unchanged
`git status --porcelain`. Any mismatch fails the job.

**Important:** full original overlay roundtrip may uncover unrelated
overlay conflicts from other development streams. Fix those explicitly,
do not suppress a failing CI gate or claim a live game passed.

## 3. Read-only native server event correlation

After a separately authorized, manually launched disposable server
really runs the P0 mission with two authenticated players, use its
persisted `EVEJS_COOP_EVENTS_FILE` JSONL:

```sh
node scripts/audit-pve-native-e2e.cjs --events /path/to/disposable-native-events.jsonl
```

The correlator requires all original-source telemetry to agree on
one native dungeon/sourceInstanceID, one system, one fleet/agent,
two **different** characters and **different** personal mission
sequences, unique native wallet journal transaction IDs, two source
inventory/standing custody receipts, original native boss-wreck and
native two-person completion event, in actual chronological order.

A positive result is **SERVER_NATIVE_DUO_CAUSALITY_CORRELATED**,
never `gameplayVerified:true`. Logs alone cannot establish a real
client's target lock, visual rendering or actual user actions. Server
telemetry itself also must be captured in a trustworthy, operator-run
environment; a fabricated JSONL file is not proof of gameplay.

## 4. Actual user-visible gameplay remains NOT_RUN

See the 16 individually auditable scenarios in
`tests/scenarios/chat19-21-native-two-client-pve-e2e.json`.
They all deliberately remain `NOT_RUN`.

A human operator with an independently authorized client must still
validate original native anomaly and boss, real damage, native warp,
one death/wreck, authentic rare candidate roll, source-debited cargo
collected by both players, separate agent rewards in wallet/LP,
station inventory and standing journal, two-client visuals and
restarts after intentional partial payouts. Never perform destructive
testing on `evejs-data`, production `market.sqlite`, active
wallets or non-disposable client binaries.

Do not automatically move these to PASS just because source Node tests,
installer roundtrip or telemetry correlation passed. Keep all native
PvE economy/order flags OFF until full live acceptance is independently
recorded, reviewed and the stacked PRs are merged in dependency order.

## Final source-authored boss loot proof and CI status (2026-10-26)

The original pinned EveJS catalogue contains **171** authored NPC profiles
whose `lootTableID` is `parity_deadspace_overseer_pending_loot`.
That rule table has **four** weighted native selectors (special overseer
personal effects, faction ammo, faction modules and deadspace modules),
with a source-authored non-empty expectation. This establishes actual
profile-to-rule configuration; it is not a proof of physical drops.

The pinned-run gate includes
`tests/coop-pve-native-rare-candidates.test.mjs`: it looks up the
original native `npcData` definition, resolves original item-type pools
with `npcLoot._testing.getRuleCandidatePool`, then calls the **original**
`npcLoot.rollNpcLootEntries(table)` 32 times with a deterministic
locally restored random stream and checks selected item IDs against
native candidate pools. This is algorithm/in-memory candidate evidence,
**not** a real spawned wreck, a native inventory grant, or a completed
EVE client pickup. Keep live rare-drop scenario `NOT_RUN` until
original native itemStore + wreck source and two clients are witnessed.

The optional boss-loot pregrant fence additionally blocks native wrecks
whose source profile/rule names unmistakably identify an overseer,
officer, boss or commander after server restart when the in-process
boss witness is lost. It does **not** auto-replay an uncertain item grant;
non-boss wrecks retain their original native transfer path.

For duo personal agent rewards, zero-ISK **untimed** bonus item grants
are now recognized according to the original native reward function.
A timed bonus with zero ISK cannot be inferred from a wallet delta and
is deliberately rejected until explicit native timing/receipt proof is
available. This protects against false payout-success claims.

**Test evidence at this point:** isolated source-executed suites for
personal reward custody (15/15), event correlation (14/14) and static
catalog checks (6/6), **35/35 PASS**; 171 original profile bindings
and four selector rules inspected. GitHub Actions has returned **zero
runs** for the final feature branch, so actual Node22 full source suite,
full disposable original overlay install/reapply/remove, native rare
candidate/RNG execution against pinned checkout, two-client game play,
SQLite/Rust and crash/restart are **NOT_VERIFIED/NOT_RUN**. No claim
of release-readiness or merged code is made. The final PvE PR stays
Draft and all game flags remain OFF by default.
