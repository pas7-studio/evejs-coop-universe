# EveJS Co-op Stage J — Native Rescue & Salvage Economy

Date: 2026-10-25. Status: **DRAFT / NO LIVE GAMEPLAY GO**. Overlay strictly pinned to upstream EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Based on native Escort P1/P2 PR #100, also reconciles **Stage H PR #96** into the same integration branch. This branch preserves all current main A-Life, NPC manufacturing, market, weapon, chat and game-state modules. It does **not** merge PRs, touch live Docker or alter `evejs-data`.

## End-to-end player experience

1. A real NPC hauler dies and pinned nativeNpcWreckService creates a **real wreck** from its actual cargo. Only true co-op-mined cargo (`coopHaulFleetID > 0`, `coopHaulFromMinerID > 0`) obtains `sourceCargoID` and `sourceOriginalQuantity` in native NPC wreck items. Generic loot is unchanged. All new hooks gated and OFF by default.
2. `/events list` or `/events all` can show a **real RESCUE offer** only when a PREPARING convoy actually departed, immutable original manifest and verified terminal native hauler loss exist, the correct stock wreck/source IDs match and two original pilot identities are authenticated. Original wreck offer is fsynced and immutable even if the wreck is later emptied or despawns.
3. `/events rescue offer <event-id>` displays NPC corporation-funded reward (configured by the server), quantity, original cargo, and exact two-pilot pair. Each original authenticated pilot separately uses `/events rescue accept <event-id>`; only after both durable acceptances does **one** authentic GameStore NPC corporate wallet escrow reserve real ISK.
4. `/events rescue <event-id>` physically directs the authenticated player's actual EVE ship toward an original source-verified wreck with stock EVE `warpToPoint` (far) or `FollowBall` (near), never teleports or fabricates items. The existing native wreck inventory UI owns the loot RPC; for original co-op cargo its transfer dispatches to `coopRescueNativeTransfer`.
5. The true native SQLite transactor `gameStore.coopAtomicNativeRows.transact` consumes/decrements the real `npcWreckItems` source, verifies the original `npcCargo` source was removed by the hauler destruction, allocates a real unique `identityState.nextItemID`, and grants ONE provenance-tagged player ship cargo stack in the **same SQL BEGIN IMMEDIATE/COMMIT**. Partial pickup with immutable source-conservation is supported. A failed/uncertain COMMIT is NEVER retried blindly. `items` cache/index invalidation belongs to existing GameStore adapter.
6. Player docks at actual destination NPC station and uses `/events rescue deliver <original-manifest-key> <itemID>`. Atomic `items` ownership movement transfers the SAME itemID and quantity to the real corporation's station inventory; no mint. Multiple source-tagged partial player items may all be delivered if total does not exceed original source quantity.
7. `/events rescue claim <event-id>` checks EVERY original wreck source, type and quantity at the correct native NPC corp warehouse. Without all original cargo physically present, NO player payout. Only then it consumes existing NPC-funded escrow and credits the two real player wallets atomically, exactly once. On reboot/duplicate claim: read already native SETTLED, no double credit.
8. `/events history` / `reputation` show only individual, read-only native-wallet-confirmed outcomes: original escort PAID/REFUNDED plus rescue PAID (+5 rescue score, actual half ISK) / RIVAL_REFUNDED (+0 points, no earned ISK). For same corporation, both characters with 5/20 confirmed PAID rescues earn a new NPC-financed loyalty quotation of +10%/+20%; once the quote is fsynced the amount is immutable even across server configuration changes.
9. **Living NPC rivals**: already materialized real independent `trader` NPC in the same solar system may physically warp/orbit to a native wreck after independently verified NPC convoy-loss witness. Using the same `npcWreckItems` original source and native `npcCargo`, it atomically consumes that cargo (player cannot then loot it), creates a real linked cargo ID inside the rival ship, physically returns to its own corporation's native station and after dwell atomically transfers stock to `items` for its owner. This is wired to the existing A-Life world tick, controller, order-arbiter and telemetry, without a new artificial NPC or production.
10. If the rival has irreversibly captured part of the original source, the claimed NPC rescue payout is blocked; only independent original source-linked native rival cargo or native corp warehouse proof permits returning the RESERVED NPC rescue ISK to its original corporate wallet. `/events rescue cancel <event-id>` uses this exact native proof; arbitrary timeout, chat text or fake loss does not release money. Duplicate refund is idempotently verified against wallet.

## Safety policy

- All Stage J features default OFF: `EVEJS_COOP_RESCUE_PROVENANCE`, `EVEJS_COOP_RESCUE_ATOMIC`, `EVEJS_COOP_RESCUE_WAREHOUSE`, `EVEJS_COOP_RESCUE_CONTRACTS`, `EVEJS_COOP_RESCUE_NPC_RIVALS`. The reward amount `EVEJS_COOP_RESCUE_REWARD_ISK` must be server configured (positive EVEN integer <= 1e9); it is not client-supplied.
- Original co-op source provenance ON but atomic writer OFF -> item transfer FAILS CLOSED. Ordinary unrelated NPC wreck loot remains on stock code.
- Native wallet requires original `EVEJS_COOP_NATIVE_ESCORT_WALLET`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS` and existing original Escort authorities.
- Cargo and ISK are *never* created from the mere presence of a chat message, elapsed timer, journal filename or NPC intent.
- Stage H P0 protection integrated: actual prewarp source fence, late pirate settlement replay, exact native WALLET terminal checks and immutable history writer. `EVEJS_COOP_ESCORT_WARP_FENCE=1` and `EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY=1` only during isolated QA, never silently on production.
- Only reversible installer `scripts/patch-evejs-coop.cjs` changes pinned native EveJS source; no upstream fork, default flags OFF. For `nativeNpcWreckService.js`, checked against exact fetched upstream: PRISTINE -> PATCHED -> source byte-for-byte original upon reversal.

## Tests / evidence from this development turn

Source-executed V8 tests with mock in-memory transactional adapters, NOT real-game PASS:
- 11/11 atomic partial player salvage, source conservation, mock rollback and replay checks PASS.
- 8/8 original physical player dock/warehouse transfer, source item ID, mock rollback, duplicate denial PASS; added official test for two partial stacks.
- 11/11 + 12/12 source-executed real-corp funded offers/duo acceptance, full delivery, payout idempotency, immutable quote after wreck removal, rival refund and replay PASS (before small loyalty changes).
- 9/9 NPC rival native source-to-station loop with physically modeled proximity and mock SQLite PASS; 7/7 after repair to real pinned GameStore `npcEntities` wrapped key `entities\u001f<ID>` PASS.
- Pinned source installer PRISTINE/PATCHED/reversal exact bytes PASS; actual Node tests of complete latest branch and two EVE clients NOT RUN here.
- Native underlying SQLite row-shapes independently inspected at `Code/server/src/gameStore/sqliteStore.js`: `npcEntities` is wrapped `entities\u001f<ID>`, while `npcCargo` and `npcWreckItems` contain a flat `cargo` and `items` top-level row.

New official runnable tests (must run locally on complete branch):
- `node --test tests/coop-rescue-native-atomic-custody.test.mjs` (9 cases)
- `node --test tests/coop-rescue-native-contract-wallet.test.mjs` (8 cases)
- `node --test tests/coop-rescue-native-npc-rivalry.test.mjs` (5 cases)
- `node --test tests/coop-escort-*.test.mjs` (entire inherited stages + Stage H P0)
- Also run existing full repo `node --test` or project test scripts and `node scripts/patch-evejs-coop.cjs --code-path <DISPOSABLE_PINNED_COPY> --dry-run`, then apply/revert byte-exact on isolated copy; project doctrine supersedes any command that could modify real volume.

### Mandatory two-client EVE gameplay QA (NOT TESTED HERE)

1. Disposable cloned world; original Study / real NPC corporation wallets and native two pilot ship inventory baseline recorded. Actual authenticated client login/undock, two `/events interest|volunteer|accept`, real native pilot fleet+NPC hull/warp.
2. True pirate kill of original hauler, stock native wreck and `sourceCargoID` matched to original stored cargo manifest; no wreck while NPC original goods still exist should transfer.
3. Two players salvage same native wreck: sequential 3+5 and two competing concurrent pickup RPCs; one real item cannot be credited twice; crash after SQL COMMIT before client reply -> no duplicate item on reconnect.
4. Player docks and transfers 3+5 authentic same-cargo source pieces. Original player cargo becomes zero, native corporation station gets exactly 8; no extra market-visible stock or new NPC goods.
5. Both pilots' individual quote accept, native corporate -reward escrow only ONCE, full cargo at station, exact 50/50 native player wallet settlement only ONCE after claim; verify restart and lost ACK.
6. Real NPC rival from existing A-Life trader approaches wreck via actual native warp/orbit, atomically removes the same native source, heads to own station after physical travel/dwell, gets correct inventory. Native pilot now cannot claim lost cargo, escrow full refund original corporation once, nobody gets player ISK or positive rep.
7. Genuine stock EVE HOLD/CONTINUE/RETREAT effect on NPC; Stage H physical warp uncertain recovery; actual pirate wreck *after* warehouse delivery still triggers delayed payout idempotently; no duplicated warp or ISK after crash.
8. Verify market, wallet, warehouse, player score and history through actual EVE client, and baseline performance. No fake teleport/loot/ISK in telemetry.
9. Only after gates pass: rebase/update PR #96 and PR #100 safely and merge one tested integration chain to main. Never overwrite main's recently integrated A-Life, economy, weapons, installer, real data.

## Known release blockers

- **BLOCKED_LIVE_TESTS:** current GitHub connector can author/source-inspect PR but container cannot resolve github.com to clone latest private branch. No full native Node/better-sqlite3 real GameStore worker run, pinned overlay dry-run on disk, Docker or two real EVE clients yet.
- **BLOCKED_NATIVE_E2E:** after upstream source hook, native wreck inventory UI and concurrent actual loot transfer need verification, as do NPC default physical movement and account persistence across restart.
- **BLOCKED_APPROVAL:** Stage J is DRAFT. No main merge, no feature flags enabled and no live evejs-data mutations.
