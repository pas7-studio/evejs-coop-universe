# Cross-chat reconciliation — Chats 18 / 25 / 32 / 39
**Prepared 2026-10-26; pinned EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.**

## Provenance and original commits

| Source chat | Scope | Already on `main` at inspection | New action |
|---|---|---|---|
| 18 | Native NPC identities, faction relations, memory, hostility | `a57029f759bc6569fef4012adad68c1c04ebb988` | Confirmed original modules are copied by central installer; existing NPC combat integration remains under its own feature flag and native source contracts. No duplicate standing authority introduced. |
| 25 | Real player ore reprocessing, physical item ownership | `bc46aec5dd293282e64b2fb909414572812e8e53` | Integrated three staged native hooks; resolved itemStore export collision with existing NPC warehouse/refinery patch chain. |
| 32 | Native Citadel/deployment, alliance, sovereignty RPC admission | `8e211509022d63287a40b3983adb7bee5dcee424` | Integrated two staged native hook targets; changed denied alliance RPCs from silent `null` to original `CrpAccessDenied` wrapped error. |
| 39 | Scoped corp/fleet/alliance chat, mail/backlog delivery | `530415ee4bc99be04f8b39c6fde985d7141ddc7f` | Integrated three staged native hook targets into one transactional installer. |

## Confirmed gaps found on current main

1. **Source files copied but hooks absent:** `scripts/patch-evejs-coop.cjs` copied `coopPlayerOreReprocessing`, `coopStructureAllianceAuthority` and `coopSocialRoomAuthority` into the EveJS overlay but its `specs`/transform pipeline did not include **seven new native source paths** or the already targeted native `itemStore` ore patch. Consequently the guarded logic was unavailable through the actual pinned native RPC. Corrected using original central installer's `specs` and `transform`. No second installer or client RPC.
2. **Native itemStore patch stacking:** `coop-player-ore-atomic-patch.cjs` inserted an export directly after `module.exports = {`, breaking `coop-native-warehouse-item-patch.cjs`'s invariant that its two exports follow that exact anchor. This produced `WAREHOUSE_PATCH_DRIFT` on reinstallation and/or source rollback. Revised ore export insertion to keep the warehouse export pair contiguous; the existing refinery exports and warehouse helper behavior remain unchanged.
3. **Silent denied alliance mutations:** `coop-structure-alliance-guard-patch.cjs` returned `null` for an unauthorized original alliance mutation RPC. This is indistinguishable from the normal success response for several native clients. Now uses the pinned server's existing `common/machoErrors.throwWrappedUserError("CrpAccessDenied")`. No new method/packet type.
4. **Cross-chat installer ownership:** New hooks apply **last** after existing native source patches, and are detached **first** on removal. One `executePlan` still does transactional preflight and rollback; `classifyFile` validates pristine / patched / drift as before.

## Changed paths in the reconciliation commit

- `scripts/patch-evejs-coop.cjs` — 7 additional native specs; compose Chat25 ore, Chat32 structures/alliance, Chat39 chat/mail guards across **8** original source paths.
- `scripts/coop-player-ore-atomic-patch.cjs` — preserve warehouse/refinery export layout in original itemStore.
- `scripts/coop-structure-alliance-guard-patch.cjs` — explicit native `CrpAccessDenied` for forbidden alliance writes.
- `tests/coop-chat18-25-32-39-merge-contract.test.cjs` — regression contracts for source-spec registration, unique module copying, combined ore/warehouse/refinery reversible exports, explicit denied RPC, original feature flag checks, optional all-eight native pinned source roundtrip.
- This file `docs/CHAT18_25_32_39_CROSS_CHAT_RECONCILIATION.md` — provenance, verified evidence and next-owner handoff.

## Source-backed verification

**Executed in V8 against actual current central installer source, actual five pre-existing itemStore helper-patch modules, three Chat25/32/39 patchers and the original pinned EveJS source**:
- All eight paths registered; the seven paths unaffected by other co-patches passed source parse, idempotent reinstall and byte-for-byte remove.
- Initially the original itemStore chain failed with `WAREHOUSE_PATCH_DRIFT`; fixed as noted. Full itemStore composite source subsequently **installed, reinstalled idempotently and removed byte-for-byte**. This is a reproducible *source-level* test; unrelated installer helper calls were mocked where the eight target paths did not use them.
- Prior Chat39 tests: 8 scoped membership, 4 patch, 6 native chatStore and 6 native mailState checks, using in-memory GameStore. Prior Chat32: 7 role and 4 patch cases; prior Chat25: 8 reprocessing and 4 patch cases. These are **not** a live Node/SQLite/EVE-client certification.

**NOT EXECUTED:** real `node --test` in complete checkout; native `--dry-run` / `--check` under actual host filesystem; two authentic EVE clients; power-loss crash/reconnect; client UI and all RPC payload validations. New integration test offers optional `EVEJS_COOP_CODE_PATH` to run all-eight pinned source roundtrip on authorized checkout.

## Hard safety rules: do NOT overclaim completion

- Original `EVEJS_COOP_PLAYER_ORE_ATOMIC`, `EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD`, and `EVEJS_COOP_SOCIAL_NATIVE_GUARDS` remain **OFF by default**. Hooks do not debit fuel, spawn a free structure, claim sovereignty, or grant items while off.
- Chat25 positive native wallet fees and any non-atomic reprocessing wallet+inventory debit remain **blocked**. Multi-stack/randomized recipes and cross-owner output remain unsupported in the staged guarded path.
- Chat32 native structure creation/deed consumption and war bill/war record writes are **not** a single durable transaction. No unsafe “auto repair” or free resources were added. Structure destruction, asset safety, legitimate access settings and timers need real acceptance.
- Chat39 background chat delivery can still be at-least-once around a crash between durable flush and XMPP fanout; no invented client sequence ID. Original inbox state and native original notifications remain authoritative.
- Chat18 memory/faction standings are not equivalent to verified native player standings, and original NPC hostility must remain subordinate to native corporation/ownership rules.
- No `evejs-data` modifications, CI manipulation, Docker deployment, SDE balance changes, feature-flag activation, force push or proprietary client changes.

## Other-bot PR review / next actions

**Chat 01 (central installer owner):** review composition/order with ongoing Chat 40/41 changes, run:
```sh
node --test tests/coop-chat18-25-32-39-merge-contract.test.cjs
node --test tests/coop-player-ore-atomic-patch.test.mjs tests/coop-player-ore-reprocessing.test.mjs
node --test tests/coop-structure-alliance-authority.test.mjs tests/coop-structure-alliance-guard-patch.test.mjs
node --test tests/coop-social-room-authority.test.mjs tests/coop-social-native-guards-patch.test.mjs
node scripts/patch-evejs-coop.cjs --code-path /path/to/pinned/EveJS/Code --dry-run
node scripts/patch-evejs-coop.cjs --code-path /path/to/pinned/EveJS/Code --check
```
Before actual install, verify original upstream SHA and overlay --dry-run/--remove on a **disposable clone**, and that no central installer edits were merged concurrently. Do not alter live Docker volumes or switch on feature flags.

**Chat 18:** verify NPC aggression witness/event attribution and memory replay from actual two-client native sessions, including restart; independent virtual flags must not override standings.

**Chat 25 & 40:** implement separately reviewed native transaction boundary for wallet taxes, reprocessing receipt fencing and original cargo/jettison; verify A mines -> B collects -> B processes physical ore with native itemIDs after each restart.

**Chat 32 & 31/35:** verify original corp owner transfer, war HQ and bill atomicity, fuel consumption, destruction and asset safety with real client permissions. The new error is an existing wrapped EVE server error, not a new RPC.

**Chat 39 & 04/41:** verify original XMPP chat joins, mail notifications, contacts, broadcasts, bookmarks/map/overview and reconnect. Reconcile unknown flush outcomes explicitly, not by replaying writes.

**Chat 42 QA:** mark full two-client gameplay **UNVERIFIED** until the matrix shows real independent-session PASS. The PR is mergeable code review, not a sign-off for gameplay completion.
