# Chat 42 — independent EveJS Co-op Universe gameplay acceptance audit

**Verdict: NO-GO / NOT PROVEN COMPLETE.** This is an evidence-grade decision, **not** a claim that every mechanic is broken. This QA pass cannot reach the private Windows host, native Docker/EveJS runtime or two authorized EVE clients. No two-client gameplay trial was executed by this chat. No public listeners, live volumes, market rebuild, CI, client binaries or upstream were touched.

**Pin:** `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. **Audited co-op source tree:** `81b6469b463afd7d6add891bc0458d73c732a222` as of 2026-10-25T21:38:53.000Z. **Last published host snapshot:** `da549fd29841676e6f0c96d347ee93acbfe2d08a` at 2026-10-25T14:27:42.404Z. These revisions differ; never reuse historical runtime PASS for the audited tree or future commits. Further commits on main invalidate current-revision code acceptance until rebased/retested.

## Evidence ladder — what independently passed

| Evidence level | QA observation | Verdict |
| --- | --- | --- |
| Pinned source review | GitHub manifest, native RPC/service findings in prior owners' sources; 11 FW contracts and 7 anchors reviewed during Chat 35; 9 PvE, 10 moon contracts reviewed during prior work | SOURCE REVIEW ONLY — does not show a deployed runtime or clients |
| Isolated unit | QA42 reran local snapshots of Chats 03/10/21/28/35 on Node v22.16.0: **89 pass, 0 fail, 10 skip across 17 files**. The tested Chat 21 objective file differs from current GitHub blob. | PASS only for the exact unchanged local copies; Chat 21 current test not fully revalidated |
| Earlier host regressions | `state/status.json` reports 83 files, 542 pass, 0 fail, 18 skip for `da549fd29841676e6f0c96d347ee93acbfe2d08a`. | HISTORICAL ONLY — not a PASS at inspected head |
| Earlier overlay runtime | Published `OVERLAY_OK` recorded 22 patched files / 73 modules at the older revision; server event file held **3918 events**, of which 1800 were `native-npc-combat-sample` samples. | HISTORICAL EVENT OBSERVATION; not verification of physical NPC kill, cargo or current image |
| Historical one-client evidence | Redacted game logs show Manifest undock, autopilot/gate movement to Yulai. Three log files exist, but identity correlation for two independently authenticated characters is absent; another log shows an incorrect-password message. | PARTIAL SINGLE-CLIENT LOG EVIDENCE, not current or duo PASS |
| Deployed current overlay | No current on-host hash, file snapshot, flag state or effective image from QA42. | NOT TESTED |
| Actual two-player co-op | No matched pair of authorized client A/B logs, independent session IDs, real fleet ID, shared-grid and game-world receipts at same current SHA. | BLOCKED / NOT TESTED |
| Crash/restart with GameStore and Rust | No isolated, revision-bound before/after conservation and replay witnesses for full linked economy. | NOT TESTED |

**Audit integrity failures:** `state/manifest.json` references `state/digests/20261025-142742.md` but that digest is missing from GitHub's tracked tree; the published state SHA is old. The tracked workflows `.github/workflows/alife11-native-cargo.yml` and `.github/workflows/alife12-native-station-restart.yml` have push/PR triggers despite the explicit no-CI rule in `AGENTS.md`. QA42 did not run them or edit the workflows.

### Independent re-execution caveat

Unit snapshots for Chats 03, 10, 28 and 35 match the exact blob SHAs of their corresponding test files at the audited tree. Chat 21 has a changed test (local `658e3461efa64cca9b8e5083e40233dabf1b1576`, main `d161f92a8a374595efef9bfd02271c8c46081b22`); its 13 PASS are historical isolated results, **not** proof that the changed current file passed. Tests skipped for absence of an EveJS/Code checkout were not counted as PASS. All local test evidence must be repeated for any later version that changes source or tests.

## Complete 41-owner evidence matrix

Every row requires a separate, authentic **two-client** acceptance (where applicable). No source/fixture/test pass automatically advances the game to runtime or dual-client PASS. Historical means a previous, non-current host observation, never current acceptance.

| Owner | Native subsystem | Unit at reviewed snapshot | Integration at current head | Runtime/current | Two clients/current |
| --- | --- | --- | --- | --- | --- |
| 01 | Central overlay, runtime and integration | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | historical only | **NOT TESTED** |
| 02 | Pinned EveJS / EVE 2026 compatibility | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 03 | Authentication and independent multiplayer sessions | PASS_ISOLATED_SNAPSHOT_HASH_MATCH (17 pass, 0 skip) | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 04 | Authoritative ballpark, Destiny and world replication | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 05 | Native fleet and cooperative navigation | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 06 | Inter-system travel and gate transitions | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | historical only | **NOT TESTED** |
| 07 | Stations, docking, ship and hangar services | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | historical only | **NOT TESTED** |
| 08 | Fitting, attributes and Dogma | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 09 | Weapons, targeting and combat damage | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 10 | EWAR, neutralizers and remote assistance | PASS_ISOLATED_SNAPSHOT_HASH_MATCH (16 pass, 2 skip) | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 11 | Drones and fighters | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 12 | Wrecks, salvage and loot custody | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 13 | Crimewatch, PvP aftermath and insurance | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 14 | Single autonomous NPC AI director | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | historical only | **NOT TESTED** |
| 15 | NPC combat tactics, ammo and physical kills | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | historical only | **NOT TESTED** |
| 16 | Autonomous NPC miners and haulers | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | historical only | **NOT TESTED** |
| 17 | NPC production and industrial economy | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 18 | NPC faction affiliation and reputation | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 19 | Cooperative agent missions and rewards | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 20 | Storyline missions and Epic Arcs | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 21 | Native anomalies, dungeons and extended PvE | HISTORICAL_LOCAL_ONLY_CHANGED_TEST (13 pass, 2 skip) | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 22 | Exploration, scanning and hacking | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 23 | Wormhole travel, mass and polarization | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 24 | Player ore, ice and gas mining | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 25 | Cargo transport, compression and reprocessing | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 26 | Planetary industry | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 27 | Player manufacturing and industry jobs | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 28 | Moon extraction and industrial structures | PASS_ISOLATED_SNAPSHOT_HASH_MATCH (23 pass, 3 skip) | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 29 | Native market, escrow and trade | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 30 | Contracts, couriers and paid jobs | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 31 | Corporations, offices and shared assets | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 32 | Citadels, alliances, war and sovereignty | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 33 | Skills, queue, Alpha/Omega and offline training | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 34 | Medical clones, jump clones and implants | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 35 | Faction Warfare and military campaigns | PASS_ISOLATED_SNAPSHOT_HASH_MATCH (20 pass, 3 skip) | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 36 | Pochven, Triglavian and special regions | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 37 | SDE, ships, modules and balance | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 38 | New-player experience, starter rewards and tutorials | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 39 | Chat, mail, contacts, map and notifications | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 40 | SQLite, GameStore and economic recovery | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |
| 41 | Private multiplayer transport, deployment and backup | NOT_REEXECUTED_AT_CURRENT_HEAD | NOT VERIFIED | NOT TESTED | **NOT TESTED** |

## 45 independent gameplay acceptance cases

Each case has required native evidence kinds and a counterexample/conservation invariant in [CHAT42_ACCEPTANCE_MATRIX.json](../qa/CHAT42_ACCEPTANCE_MATRIX.json). All 45 are currently **NOT_TESTED at this audit head**; the entries below are a mandatory checklist, **not** scenario executions.

| Gate | Owning chats | Tier | Required evidence | What must be true |
| --- | --- | --- | --- | --- |
| QA42-REVISION | 01, 02, 40, 41 | integration | overlay, server | Reject any evidence from another project SHA, source pin, Docker image or environment |
| QA42-BOOT | 01, 14, 41 | runtime | server | Event writer is current and process logs match running image, not source code |
| QA42-CLIENT_A | 03, 07, 38, 41 | oneClient | server, clientA | Authenticated char and ship, not a TCP socket or launcher window |
| QA42-CLIENT_B | 03, 41 | twoClient | server, clientA, clientB | Distinct client hosts, accounts, sessions and character records |
| QA42-SCENE | 03, 04 | twoClient | server, clientA, clientB | A sees B and B sees A, one ordered Destiny stream each |
| QA42-MOVE | 04, 06 | twoClient | server, clientA, clientB | Visible updates to both eligible observers; none to hidden/disconnected |
| QA42-FLEET | 05, 39 | twoClient | server, clientA, clientB | Actual native fleetID and current members, not virtual team link |
| QA42-FLEET_WARP | 05, 06 | twoClient | server, clientA, clientB | Same real target/grid, no phantom follower or cross-system teleport |
| QA42-TRAVEL | 06, 04 | twoClient | server, clientA, clientB | Two real ships transition separately; identity and modules persist |
| QA42-STATIONS | 07, 03 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Cross-character ownership/permissions and fees preserved |
| QA42-DOGMA | 08, 33, 37 | twoClient | server, clientA, clientB | Actual fitted bonuses and anti-illegal-fit restrictions |
| QA42-COMBAT | 09, 13 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Native HP delta, ammo debit, no speculative hit or free ammo |
| QA42-EWAR | 10 | twoClient | server, clientA, clientB | Module activation changes real native target state and UI |
| QA42-DRONES | 11 | twoClient | server, clientA, clientB | No ghost drones across reconnect and bandwidth limits |
| QA42-WRECK | 12, 13 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Original cargo custody from victim to wreck to player exactly once |
| QA42-CRIME | 13 | twoClient | server, clientA, clientB, walletBefore, walletAfter | No duplicate claims or fabricated final blow |
| QA42-NPC_DIRECTOR | 14 | runtime | server | Scene NPC entity and controller observed, not virtual faction logs |
| QA42-NPC_COMBAT | 15, 09 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Witness the same native victim, weapon debit, HP delta and wreck |
| QA42-NPC_MINING | 16, 14 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | No virtual ore or teleporting shipment |
| QA42-NPC_INDUSTRY | 17, 40 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter, walletBefore, walletAfter | Exactly once source->output and funded NPC wallet |
| QA42-FACTION_REPUTATION | 18, 35 | twoClient | server, clientA, clientB | True standings transactions, NPC reacts to affiliation |
| QA42-AGENT_MISSIONS | 19, 21 | twoClient | server, clientA, clientB, walletBefore, walletAfter | No duplicate LP, ISK, mission or personal progress |
| QA42-EPIC_ARC | 20, 38 | twoClient | server, clientA, clientB | No skipped stage or repeated unique reward after restart |
| QA42-PVE_SITES | 21, 22 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Only authored native sites, no fabricated escalations/abyss |
| QA42-EXPLORATION | 22, 05 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Real signature/site IDs and original data/relic loot |
| QA42-WORMHOLES | 23, 06 | twoClient | server, clientA, clientB | Mass decreases, polarization timers and paired system identity |
| QA42-PLAYER_MINING | 24, 11 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Total ore conservation and cargo capacity |
| QA42-HAUL_REFINE | 25, 27 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter, walletBefore, walletAfter | Actual item custody and real material yield without double-debit |
| QA42-PI | 26, 27 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Character ownership and only actual launched materials available |
| QA42-PLAYER_INDUSTRY | 27, 40 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter, walletBefore, walletAfter | No duplicate job settlement on concurrent delivery/restart |
| QA42-MOON | 28, 32 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | No fuel burn without physically backed/atomic material output |
| QA42-MARKET | 29, 40 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter, walletBefore, walletAfter, rust | Order+ISK+item conservation on partial fill, cancel and replay |
| QA42-CONTRACTS | 30, 29 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter, walletBefore, walletAfter | Real contract completion and funded wallets |
| QA42-CORPORATIONS | 31, 32 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | B cannot access assets without assigned role |
| QA42-STRUCTURES | 32, 28 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | Native timers, protection, fuel use, asset-safety receipts |
| QA42-SKILLS | 33, 37 | restart | serverBefore, serverAfter, clientA, clientB | Actual SP delta bounded, no stale training/clone loophole |
| QA42-CLONES | 34, 07 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | No lost ship on jump or free duplicate implants |
| QA42-FACTION_WARFARE | 35, 18 | twoClient | server, clientA, clientB, walletBefore, walletAfter | Only actual sites, territory updates and earned LP |
| QA42-SPECIAL_REGIONS | 36, 23 | twoClient | server, clientA, clientB | Native supported regions/assets, no synthetic access |
| QA42-SDE_BALANCE | 37, 02 | oneClient | server, clientA | Types must have client assets; no invented unsupported hulls |
| QA42-STARTER | 38, 20 | twoClient | server, clientA, clientB, inventoryBefore, inventoryAfter | No double starter reward under reconnect |
| QA42-SOCIAL | 39, 05 | twoClient | server, clientA, clientB | Messages reach only authorized recipients exactly once |
| QA42-PERSISTENCE | 40, 29 | restart | serverBefore, serverAfter, inventoryBefore, inventoryAfter, walletBefore, walletAfter, rust | Never test destructive faults on live evejs-data; conservation survives restart |
| QA42-PRIVATE_CONNECT | 41, 03 | twoClient | server, clientA, clientB | Two authenticated sessions over approved private tunnel, firewall closed externally |
| QA42-BACKUP_RESTORE | 41, 40 | restart | serverBefore, serverAfter, inventoryBefore, inventoryAfter, walletBefore, walletAfter, rust | Restore disposable copy, no unbacked item or escrow delta |

## Defects and owner handoff

A missing proof is **not** an assertion of broken code. Source-confirmed gaps and policy inconsistencies are called out separately from untested gameplay. Full machine-readable handoff: [CHAT42_DEFECT_HANDOFF.json](../qa/CHAT42_DEFECT_HANDOFF.json).

| Priority | Defect / blocker | Owners | Required next outcome |
| --- | --- | --- | --- |
| P0 | [Q42-001](https://github.com/pas7-studio/evejs-coop-universe/issues/172): Published evidence is stale and newest digest is not tracked (EVIDENCE_INTEGRITY) | 01, 40 | Publish a new redacted, revision-bound evidence bundle from actual host and include its manifest-linked digest. Run read-only state verifier on the exact deployed revision; do not rewrite old events. |
| P0 | [Q42-002](https://github.com/pas7-studio/evejs-coop-universe/issues/174): No current authenticated two-client co-op proof (MISSING_GAMEPLAY_PROOF) | 03, 04, 05, 41 | On authorized private connection, prove two distinct accounts/characters/sessions/ships, shared grid bidirectional visibility, native fleet invite/warp and disconnect/rejoin with correlated server + client A/B redacted event hashes. |
| P0 | [Q42-003](https://github.com/pas7-studio/evejs-coop-universe/issues/173): Two workflow YAMLs present despite explicit project-wide no-CI rule (PROCESS_VIOLATION) | 01, 40, 41 | Owner confirms policy, removes or disables workflows through their own approved change, checks protected branch history and ensures tests remain manual. QA42 did not run CI or modify workflow files. |
| P0 | [Q42-004](https://github.com/pas7-studio/evejs-coop-universe/issues/175): Pinned native corrections published but installer/deploy acceptance missing (INTEGRATION_GAP) | 01, 21, 28, 35 | Chat 01 merges compatible one-statement source hooks with owner-approved flags OFF, runs isolated pinned dry-run and roundtrip, then operator verifies actual deployed overlay/client. Do not count file presence as installation. |
| P0 | [Q42-005](https://github.com/pas7-studio/evejs-coop-universe/issues/175): Moon fracture has no proven physical chunks and Metenox fuel lacks atomic output (NATIVE_FUNCTIONAL_GAP) | 28, 27, 40 | Source-backed native chunk mining/depletion and durable fuel+material settlement or explicitly block productive state until supported; verify both player inventories on disposable data. |
| P0 | [Q42-006](https://github.com/pas7-studio/evejs-coop-universe/issues/175): Faction Warfare VP/occupation and Military Campaign reward loops not implemented end-to-end (NATIVE_FUNCTIONAL_GAP) | 35, 32, 29 | Do not display static fake campaign state as dynamic. Integrate only compatible, native battle objective, VP/LP/standing and persistent territory receipts; test two ships. Unsupported 2026 client RPC remains explicitly unavailable. |
| P1 | [Q42-007](https://github.com/pas7-studio/evejs-coop-universe/issues/175): Extended PvE modes cannot be claimed as implemented (NATIVE_FUNCTIONAL_GAP) | 21, 02 | Keep unsupported content off, verify genuine authored native instances and client assets before promoting each mode. No synthetic awards. |
| P0 | Q42-008: Full item/ISK/LP conservation across market, contracts and industry lacks current crash/restart evidence (MISSING_ECONOMY_PROOF) | 17, 25, 27, 29, 30, 40 | Use only isolated copies of native GameStore and Rust market; test lost ACK/duplicate settlement/partial writes/restart/restore and two genuine clients. Verify source/debit/output exactly once. |
| P1 | [Q42-009](https://github.com/pas7-studio/evejs-coop-universe/issues/175): Local PvE unit-test snapshot differs from current main blob (QA_SOURCE_DRIFT) | 21, 01 | Re-run current main PvE test on pinned checkout and record exact SHA. Historical 13 local PASS must not be reused for the changed file. |
| P0 | [Q42-010](https://github.com/pas7-studio/evejs-coop-universe/issues/174): Live native host/container and two game clients not accessible to independent QA (ENVIRONMENT_BLOCK) | 41, 01 | Operator performs approved manual read-only DiagnoseWorld, native World, one-client and Party checks, exports redacted correlated evidence; keep listener private and never grant the auditor raw credentials. |

## Correct manual acceptance order on the owner's authorized PC

1. Record `git rev-parse HEAD`, the actual pinned EveJS SHA, container image ID/hash, effective overlay hash and private listener bindings. Check `node scripts/coop-state.cjs --verify` (read-only). Re-publish a **new** state bundle with its referenced digest tracked; do not fill gaps by copying old PASS labels. Coordinate changes with Chat 01, Chat 40 and Chat 41.
2. Use `.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'` in the approved Windows environment. Inspect startup event writer and the existing NPC entity IDs; never restart/delete persistent volumes simply for diagnostics. Then test `-Action World -WorldSystemID 30000144` (Perimeter's real belts) only when source/head is matched.
3. Launch **two distinct authorized game clients** on two computers/private link. Prove authenticated A/B with different account, character, session and ship fingerprints; retain redacted server/client screenshots or logs **privately**, hashes/IDs only in shared report. Verify shared grid reciprocal visibility, native fleet invite/accept/warp and separate jumping/docking; then reconnect A while B stays in-grid.
4. Exercise original authored native PvE sites, NPC combat/mining and one cooperative mission. Compare the same server-native instance, NPC entity, applied damage, itemID/owner/location and before/after wallets to each client view. Do not grant synthetic rewards or imply a client handled unsupported RPC.
5. On isolated copies **only**, run two-party inventory trades, mining transport, player industry and Rust market/escrow/partial-fill/ACK-replay/crash/restart/restore; assert item/ISK/LP quantity conservation, owner permissions and no duplicate settlement. Do not run destructive failures on live `evejs-data`.
6. Only after accepted native execution and the exact same live revision, enable owner-approved flags following `docs/DEVELOPMENT_DOCTRINE.md`. Verify every feature separately; any missing gameplay evidence remains BLOCKED. A source code commit is not a deploy.

### Read-only QA tool

`node scripts/coop-qa42-acceptance.cjs` produces JSON status (defaults to 45 `NOT_TESTED`, `NO_GO_NOT_PROVEN_COMPLETE`). `node scripts/coop-qa42-acceptance.cjs --claims <private-redacted-claims.json> --current-rev <40-character SHA> --strict` exits nonzero unless independently verified (this script intentionally **never self-asserts gameplay PASS**). It checks revision/pin, evidence reference digests, independent clients, shared systems, and distinct boot witnesses; structurally valid claims receive only `REVIEW_REQUIRED` until an authorized reviewer examines the true underlying native client/server observations. **Do not commit** private claims, player identifiers, credentials or raw client/server logs.

## Final independent conclusion

**Not acceptable yet as a fully verified cooperative game.** This does **not** prove that the game cannot work, and it does not roll back other chats' implementations. It proves that the current set of available, revision-bound evidence does not demonstrate two independent playable clients completing the requested economy/combat/persistence loops. First actionable step: **Chat 01/40/41 publish a current, complete host evidence bundle and verify the two-client native scene/fleet gate**. Then Chat 42 can inspect independent real observations and update only proven cells. No source hook, test assertion, CI workflow or server port was modified by this QA package.
