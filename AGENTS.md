# Agent operating agreement

For gameplay validation, **read `docs/GAMEPLAY_TESTING.md` first**; it supersedes old setup and backend runbooks for an existing world. For code changes, consult `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` and relevant upstream docs as needed.

## Primary goal for game-test agents (2026-10-25): prove gameplay, NOT scan dependencies

**MANDATORY FIRST:** Read [docs/GAMEPLAY_TESTING.md](docs/GAMEPLAY_TESTING.md)
and use [docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md](docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md).
When the owner requests to **verify the game, actual NPCs, client login, World
or Party**, stop treating backend tests as gameplay acceptance.
The owner's 2026-10-25 report already covered 72 local regression checks,
27 upstream contracts, backend health, two raw TCP sockets and localhost
ports at project commit `cc5ce83`. Its **first unresolved issue** is
`BLOCKED_TELEMETRY`: no `/var/lib/evejs/coop-events.jsonl` in the running
server. With headless boot enabled, the startup event should appear
**before a client connects**. Run **read-only `-Action DiagnoseWorld`**
and investigate the effective running overlay, startup hook and writable
event file before any client inference.

**DO NOT run npm audit, vulnerability scans, dependency upgrades, CI,
market rebuild, repeated backend regressions or upstream fixture fixes**
as substitutes for observing real game activity. The seven npm
advisories are already recorded for a separate security task; maintain
loopback-only bindings. A separately requested security review may
revisit them, but no automatic workflow is authorized.

Progress in order: running telemetry -> actual native NPC scene and
movement (`World`) -> authorized EVE client login and visual NPC
interaction -> two independent authenticated clients and shared world
(`Party`). If the client cannot be used, report
`BLOCKED_CLIENT_UNAVAILABLE` with the required human action; never
manufacture evidence or repeat the audit. Preserve local uncommitted
upstream test fixes and volumes. Earlier backend PASS is valid **only
for the tested revision**, not later commits.

## CI prohibition — repository owner decision (2026-10-24)
Do not add, restore, enable or run GitHub Actions workflows or any
other remote CI automation. The entire `.github/workflows` directory
was deliberately removed from `main` and this branch. Testing is
manual/local only, with explicit PASS/FAIL evidence. Never equate
server contract tests with observed EVE client gameplay.

## Boundaries
- This repository is initially a **documentation and orchestration repository**, not a working EveJS distribution.
- Do not silently vendor/copy external emulator source or copyrighted game client files.
- Do not modify game client binaries, override client authentication/DRM, distribute CCP assets or expose the unsupported game server to a remote network.
- Do not bind EveJS services to `0.0.0.0` or redirect ports into a public/VPN interface by default.
- Avoid claims that any functionality works without reproducible test evidence.
- Do not pretend that `EveJS main` is the exact v0.12.3.1 archive required by X-Eve v0.2.2.
- Treat the original legal and security assessment as a gate for client modifications and remote gameplay.

## Change discipline
- One task ID from `docs/ROADMAP.md` per small reviewable change.
- Prefer native upstream bugfixes with references and attribution over fork-only rewrites.
- Tests and rollback strategy for every functional change.
- Record source URL, revision SHA, local environment and pass/fail evidence.
- Do not change task status to DONE on documentation alone.
- Never commit credentials, client data, dynamic databases, certificates, binaries, screenshots of personal information, or session tokens.

## NPC market: never post unbacked player-style orders

See `docs/NATIVE_NPC_MARKET.md`. The opt-in seed market slice consumes
and purchases **real EveJS seeded-market stock**, updates exact native
cargo, and uses only the NPC's durable earned ISK ledger. Empty
allowlists mean no trades. Do not use `marketDaemonClient.PlaceOrder`
alone to invent independent NPC-owned orders: native EveJS player
settlement requires escrowed inventory, wallet, taxes and owner handling
in both Node and Rust. Ambiguous market RPC results always halt
the NPC's trading, never repeat a potentially completed fill. Keep this
feature OFF until the owner verifies it on a disposable live server.
No GitHub CI.

## NPC system transitions: identity and cargo must survive

See `docs/NATIVE_NPC_GATE_TRAVEL.md`. Do not confuse native warp to a
real reciprocal stargate with a completed solar-system transition. The
opt-in transfer code is OFF by default pending live EveJS QA. Never fake
jump success or change virtual system IDs before the exact same native
ship, controller, modules and cargo are verified at the destination.
Recover in-flight transfer journals **before** pruning persisted NPC
identity links. No GitHub Actions or automatic deployments.

## Stock native mining fleet must not block co-op NPCs

When EveJS native mining is enabled, the two real stock `miner` and
`hauler` hulls are existing NPC identities, not co-op-spawned NPCs.
They must not consume `EVEJS_COOP_MATERIALIZE_LIMIT`; otherwise pirates
can never spawn with the default limit 2. In fallback/non-native-mining
mode, bridge-spawned miners and haulers must still count. Keep both
regression cases in `tests/coop-npc-materializer.test.mjs`.

## Native destruction attacker attribution

Use the native EveJS destruction caller's explicit
`options.attackerEntity` only. If it is absent, never guess from the
controller's last target, a faction assignment or a recent weapon event.
The separate `FinalBlow` manual gate is more strict than `Combat` and
requires actual native wreck, stored loot and matching native weapon/HP
evidence. A passing unit test is not a verified live Docker kill.

## Native NPC faction combat invariant

Pinned upstream `npcBehaviorLoop` defaults NPC-vs-NPC to friendly. The
opt-in `coopNpcHostility` hook allows only named physically linked opposing
factions with a current real native attack order or fresh retaliation. Never
weaken this to unconditional NPC friendly-fire. Require real native weapon
success, measured HP reduction, and actual stored loot on the same victim
before reporting a client-free NPC battle as evidenced. Do not claim
authoritative final killer identity from correlation alone. No GitHub CI.

## Manual headless native NPC evidence (owner-directed)
Before any claim that autonomous NPCs work without players, consult
`docs/HEADLESS_NPC_VALIDATION.md` and use the local World evidence gate.
Physical ship presence is NOT proof of motion, mining, combat or loot.
Do not invent runtime PASS based on tests alone. No GitHub Actions or
remote CI workflows may be created or executed.

## Durable named NPC restart safety (P0)

Read [docs/NATIVE_NPC_DURABILITY.md](docs/NATIVE_NPC_DURABILITY.md)
for the *only* approved persistence/restart QA sequence. A durable named
NPC uses persistent native EveJS entity/controller records, not just
`coop-npc-links.json`. The original `transient:true` records
were never on disk and must not be described as persistent.
`EVEJS_COOP_DURABLE_NPC_SHIPS=1` is enabled only when an authorized
manual `-LivingCoop` overlay deployment is performed.

The pinned `nativeNpcStore` allocator patch prevents collisions between
stock transient miners and newly durable NPC IDs. On startup,
`coopNativeRestore` restores the same physical ID **before**
identity pruning; any corrupt durable records halt this operation
with `NEEDS_OPERATOR_REPAIR`. Only a matching native wreck in the
persistent life ledger **after that exact ship was linked** permits
natural clone recovery. Never wipe the registry, volume or data to
force World PASS. The manual World report now includes
`nativeDurableRecovery`; accepted restoration is **not** proof
that a real client sees the NPC.

## Current headless recovery rule

A real EveJS scene with confirmed static topology is now tracked in
`visitedSystems` even when `actualNamedNpcShips=0`. The periodic
materialization/reconciliation phase must be allowed to retry native
spawn without a logged-in human. **Never** call a tracked scene
"successful gameplay" or create synthetic activity events.
`coopHeadlessScenePolicy.cjs` reports if the startup fleet config
really includes the chosen system and if actual belts exist.
If Perimeter remains without a fleet, use
`systemSiteReadiness.stockMiningStartup.status` and the precise
`nativeMaterializerAttempt.spawnErrors` to fix the real first
blocker. Do not run npm audit, reset Docker volumes or claim a
backend-only pass proves NPC gameplay. Six policy unit tests plus
World regression scenarios are included in the manual suite.

## Current code changes — real visible and stable named NPCs

Use the current `coopNpcPresentation`, `coopNpcMaterializer` and
`coopNativeIndustry` tests. Native NPC naming must call
`scene.broadcastSlimItemChanges`, not
`sendSlimItemChangesToAllSessions`. Failed client notifications must
be retried without double-spawning native ships.

A successful native spawn followed by a failed identity-registry write
must reuse its original physical ship on retry. Reject real player
ships/static entities when counting named NPCs. `World` now reports
`SPAWN_LIMIT_REACHED`, `NATIVE_SPAWN_THROW`,
`IDENTITY_LINK_FAILED` with nativeReason, and
`nativePresentationPending` if names could not be pushed to clients.
If `headlessBootStatus` is null, compare `headlessAttemptCount`
to determine whether the boot timer fired at all.

Do not claim this is live gameplay PASS until the human tester shows
the same named NPC in the actual client. No CI or network scan.

## Immediate World gameplay blocker — real system mining, not generic SDE

2026-10-25 owner test at `a087167` confirmed healthy live overlay and
headless boot events. The first `World` run selected **Jita
(30000142)** which has legitimately zero asteroid belts. **Use
Perimeter (30000144) with real SDE belts for the mining World gate.**
Do not fabricate scene belts or claim Jita must have a belt. A report
with `physicalNpcShipAssignments=0` remains unverified independently.

The new `World -WorldSystemID 30000144` report includes
`systemSiteReadiness` and `nativeMaterializerAttempt.spawnErrors`,
so test agents fix the *actual* next source failure, not random
dependency issues. `DiagnoseWorld` now pipes the full multiline
read-only shell script over stdin; it must not print only a header.
Do not run npm audit, reinitialize market, delete volumes or run CI.

## Current co-op code milestone: shared native fleet warp

See `docs/COOP_FLEET_WARP.md`. The owner wants TWO playable clients,
not extra virtual fleet mechanics. The new opt-in native EveJS follower
guard checks actual same-scene live ships; it never invents session,
warp, landing or in-client success. `-Action Party` now reports native
follower warp command acceptance, failure and skips. Never treat a
server-side accepted order as in-client warp/landing proof. Run only
manual tests and never GitHub Actions.

## Current acceptance goal — 2026-10-25

The owner has already validated the backend at commit `cc5ce83` but not
gameplay. **First prove the installed headless startup path and event
writer**; `living-headless-boot-requested` is expected without clients.
Then prove actual native NPC movement/interaction in `World`. Only
after that ask the operator for one authorized client, then two
characters, and capture separate visual/server evidence.

If the event file is missing, investigate `BLOCKED_TELEMETRY` rather
than asking for a client or running npm audit. If any step is blocked,
record the single next actionable diagnostic and stop; do not repeat
previously passed checks. Apply prior backend PASS only to its exact
recorded project/upstream revision. Follow
`docs/GAMEPLAY_TESTING.md` and `docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md`.

**The two-client gameplay and real native transfer/market activity
remain unverified.** No GitHub CI and no merges without owner consent.
