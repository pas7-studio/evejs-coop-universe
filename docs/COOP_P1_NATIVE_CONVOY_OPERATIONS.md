# P1: native convoy operations — real raid and verified two-player intervention

**Goal:** make the already-organic NPC pirate-versus-hauler raids meaningful shared experiences for two real EVE clients. A raid becomes a persistent **incident**, not a scripted quest or a second combat/economy engine. The incident records native action acceptance, two independently witnessed player contributions, and an actual physical pirate wreck.

## Native chain

1. Existing `coopNativeRaids` schedules only actual native NPC warp/attack orders against a real NPC miner or ore hauler that already carries ore. Its existing `coopWorldSignals.notifyRaid` receives **accepted native actions only**.
2. When **EVEJS_COOP_CONVOY_OPERATIONS=1**, `coopWorldSignals` passes these validated raid actions to `coopConvoyOperations.noteRaid`. The ledger independently checks the scene, actual native NPC hull identities, distinct pirate/hauler IDs, coordinates and no player impersonation.
3. Append and fsync `APPROACH` for an accepted native warp. Only a separate native attack order creates `UNDER_ATTACK` — warp/target selection is **never** treated as damage.
4. Existing `coopPlayerCombatWitness.note` is called after genuine applied damage from the native killmail/damage path. Only after the native telemetry writer accepts that source record does `coopConvoyOperations.noteDamage` cross-check current authoritative scene, attacker session/physical ship, real pirate identity and the actual native fleet.
5. One verified player hit produces one durable `PLAYER_HIT` event for that real character. Two distinct authenticated native fleet members, each with separate real current ships and their own **actual** damage receipts against the **same physical pirate** of the **same native raid**, produce exactly one `DUO_INTERVENED`. Repeated damage, duplicated sessions, disconnects, different fleets/systems or phantom party membership cannot create that status.
6. A real terminal native killmail/wreck witness must match a physical `nativeNpcWreck` with the identical `launcherID` and scene-native `itemID`. Only then can `PIRATE_WRECK_CONFIRMED` close the incident. It means **pirate destroyed**, not convoy saved.
7. At the first actual duo confirmation, both eligible connected players receive **one** stock system message recognizing their intervention. At a verified pirate wreck, a separate native outcome message can be sent. Messages never claim credits, automatic standings, missions, ISK, LP, cargo delivery or a rescued convoy.

The native convoy, loot inventory, ship damage, death, wreck, mineral stocks, market orders and faction standings remain **solely authoritative in stock EveJS / existing native integrations**. There are no new ships, attacks, forced warp, fake event rewards or custom character-owned missions.

## Persistence and safety

- Durable append-only journal: `/var/lib/evejs/coop-native-convoy-incidents.jsonl` by default; test-only absolute file override `EVEJS_COOP_CONVOY_INCIDENTS_FILE`. It must be verified on the mounted, backed-up persistent server data.
- Incident key is `systemID:pirateID:targetID`. A native hull pair is registered once. Repeated orders and restarts cannot invent new incidents or re-award a duo badge.
- Journal transitions are parsed from scratch after every write; a malformed/torn/oversized file, illegal phase, duplicate player witness or impossible transition blocks the feature with a named status. The native combat itself **continues normally**; failure of optional incident telemetry never crashes native combat or grants assets.
- There is **no automatic expiry or victory by timer**. If an incident is unresolved after a process restart, it stays unresolved until a genuinely evidenced terminal wreck. A future revision will need native hull lifecycle/ID-generation evidence before treating reused IDs as a new incident.
- Bounded to 8 MiB. Once exceeded, fails closed rather than deleting history; journal archival must retain unresolved native identities and evidence. Initial file creation relies on filesystem durability, with full power-loss testing still required.
- The journal is an observational record, not an economic escrow or a mission settlement record. The existence of `DUO_INTERVENED` is **never permission to pay**.

## Operator flag

Added `-EnableConvoyOperations` (requires existing `-LivingCoop`) in `scripts/Deploy-Coop-RuntimeProbe.ps1`. It enables `EVEJS_COOP_CONVOY_OPERATIONS=1` and the existing native applied-player-damage witness `EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE=1`. **Both remain off as a new feature by default**; no accidental activation in vanilla or regular LivingCoop profiles.

The standard pinned `scripts/patch-evejs-coop.cjs` simply packages the new `integration/coopConvoyOperations.cjs` as L2. No new native hook is inserted, no second scheduler is created, and `coopVirtualWorldRuntime` / native pirate orders are not modified. This avoids collisions with concurrent NPC scouting, wreck recovery and station-delivery branches.

## Evidence

- `tests/coop-native-convoy-operations.test.mjs`: 12 deterministic source-level incident scenarios passed under isolated JS/V8 with in-memory fsync-compatible storage (real approach ≠ attack; exact attack; two independent damage receipts; dupe prevention; different fleet/ghost; impersonated NPC; physical wreck; missing wreck; wrong system/victim; replay after restart; torn journal; no native asset mutation).
- `tests/coop-native-convoy-operations-wiring.test.mjs`: **4/4 isolated JS/V8 integration scenarios PASS** using the committed `coopWorldSignals.cjs` and `coopPlayerCombatWitness.cjs` source under stubbed native session/scene dependencies: one durable-incident call for two notified pilots, default-OFF behavior, one trusted native damage witness producing a single two-player message, and no incident on failed telemetry.
- `tests/coop-native-convoy-operations-overlay.test.mjs`: permanent Node contract tests ensuring registered L2 packaging, default-OFF activation, actual native raid source wiring and native damage telemetry provenance. Full official Node `--test`, real deployed Docker, and two authenticated clients are **not yet proven** by this review.
- No assertion that a player's ship rendered the announcement on-screen, or that any actual cargo delivery/ISK/market value changed.

### Read-only owner-local checks

```powershell
node --test tests/coop-native-convoy-operations.test.mjs tests/coop-native-convoy-operations-wiring.test.mjs tests/coop-native-convoy-operations-overlay.test.mjs
node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code --dry-run
node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code --check
```

Owner-approved live acceptance: use native Perimeter/Manifest World where real ore-loaded hauler and pirate have spawned, two real fleet members in Ballpark, actual pirate attack order, both players personally apply real damage to the **same** pirate, verify one real duo intervention message and journal event. Verify only a native pirate wreck produces a terminal phase, and that the hauler can still be destroyed, cargo lost, or station delivery blocked independently of `DUO_INTERVENED`. Reconnect and inspect persisted incident identity; no duplicate output. Repeat with solo, disconnected peer and different native fleet.

## Next iteration: consequence proof (NOT implemented)

Wire native **station arrival / warehouse cargo receipt** to the same exact convoy incident identity, and native NPC hauler destruction/loss receipt to close **SAVED_WITH_DURABLE_CARGO** versus **LOST_WITH_NATIVE_WRECK**. Only then consider authorized native contract payouts from a pre-funded NPC/corporation wallet; no balance creation and no payment just for receiving a chat beacon.

No GitHub Actions, main merge, Docker restart, inventory/market mutation or reset of `evejs-data` was performed.
