# Chat 19 + 21 — PvE native verification gates

**State (2026-10-26): code prepared; isolated source receipts/test logic checked.
Real Node CI, actual pinned overlay roundtrip and two connected real clients
remain unverified until their separate jobs execute. No PvE flag enabled
or native server deployed by this PR.**

## Existing source-authoritative architecture

This gate reuses original pinned EveJS (upstream commit
\`c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f\`), the ONE reversible
\`scripts/patch-evejs-coop.cjs\` installer, and the original
agent/dungeon/npc/wallet/itemStore/LP/standing modules.

It does **not** spawn a second server, add a fake mission ledger,
create game entities or run any client.

## 1. CI source tests: genuine Node runner

From this branch of the overlay repository:

\`\`\`sh
node scripts/Run-Pve-Native-Gates.cjs --source
\`\`\`

Runs explicit 25+ actual \`node --test\` source suites covering:
native NPC aggression, authored dungeon site-defense, reinforcements,
boss HP and original wreck, real native loot items and replay barriers,
fleet mission join/provenance, native leader/peer payout fences, two
individual personal reward evidence paths, physical reward station
itemStore/standing custody, and source-only event correlation.
It also checks syntax of the copied integration modules and verifies
all PvE gates remain OFF in \`docs/coop-flags.json\`.

The source runner **never** sets
\`EVEJS_COOP_VIRTUAL_WORLD=1\`, starts headless scenes, invokes actual
client RPCs, writes to a native gameStore or claims a live rare drop.

GitHub Actions: \`.github/workflows/pve-chat19-21-native.yml\`;
a \`push\` event on this PR's feature branch runs the actual Node suite.

## 2. Disposable pinned original EveJS overlay roundtrip

The second CI job checks out **exactly** the pinned upstream into
\`isolated-upstream/Code\` (separate temporary Git directory), then
runs:

\`\`\`sh
EVEJS_PVE_DISPOSABLE_CHECKOUT=1 node scripts/Run-Pve-Native-Gates.cjs \
  --pinned-only --upstream-code isolated-upstream/Code
\`\`\`

The runner refuses missing explicit disposable attestation, wrong
upstream SHA, a non-clean native repo, a directory not literally named
\`isolated-upstream/Code\`, and any attempted use against a live server.

For the disposable checkout only: native dry run → original installer
→ \`--check\` drift audit → second install MUST be no-op → pinned native
source-only tests → original overlay removal → exact unchanged
\`git status --porcelain\`. Any mismatch fails the job.

**Important:** full original overlay roundtrip may uncover unrelated
overlay conflicts from other development streams. Fix those explicitly,
do not suppress a failing CI gate or claim a live game passed.

## 3. Read-only native server event correlation

After a separately authorized, manually launched disposable server
really runs the P0 mission with two authenticated players, use its
persisted \`EVEJS_COOP_EVENTS_FILE\` JSONL:

\`\`\`sh
node scripts/audit-pve-native-e2e.cjs --events /path/to/disposable-native-events.jsonl
\`\`\`

The correlator requires all original-source telemetry to agree on
one native dungeon/sourceInstanceID, one system, one fleet/agent,
two **different** characters and **different** personal mission
sequences, unique native wallet journal transaction IDs, two source
inventory/standing custody receipts, original native boss-wreck and
native two-person completion event, in actual chronological order.

A positive result is **SERVER_NATIVE_DUO_CAUSALITY_CORRELATED**,
never \`gameplayVerified:true\`. Logs alone cannot establish a real
client's target lock, visual rendering or actual user actions. Server
telemetry itself also must be captured in a trustworthy, operator-run
environment; a fabricated JSONL file is not proof of gameplay.

## 4. Actual user-visible gameplay remains NOT_RUN

See the 16 individually auditable scenarios in
\`tests/scenarios/chat19-21-native-two-client-pve-e2e.json\`.
They all deliberately remain \`NOT_RUN\`.

A human operator with an independently authorized client must still
validate original native anomaly and boss, real damage, native warp,
one death/wreck, authentic rare candidate roll, source-debited cargo
collected by both players, separate agent rewards in wallet/LP,
station inventory and standing journal, two-client visuals and
restarts after intentional partial payouts. Never perform destructive
testing on \`evejs-data\`, production \`market.sqlite\`, active
wallets or non-disposable client binaries.

Do not automatically move these to PASS just because source Node tests,
installer roundtrip or telemetry correlation passed. Keep all native
PvE economy/order flags OFF until full live acceptance is independently
recorded, reviewed and the stacked PRs are merged in dependency order.
