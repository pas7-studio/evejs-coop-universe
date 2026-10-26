# Chats 09 / 15 / 22 / 29 / 36 — cross-stream reconciliation handoff

**Date:** 2026-10-26. **Status:** source-level integration and regression; **LIVE_UNVERIFIED**. Pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` only. This is a single-commit review package on top of the moving `pas7-studio/evejs-coop-universe` main; it is not an authorized deployment. Do not edit L0 upstream or active `evejs-data`, `market.sqlite`, Docker volumes, or proprietary clients.

## Original delivered commits (all already ancestors of main)

| Owner | Commit | Existing implementation and limitation |
| --- | --- | --- |
| Chat 09 — NPC weapons/ammunition | `ec400ebe0a334f9e6bc6565611ce63cf345f662e` | Real fitted module/charge source and strict ammo preflight; it is not proof of live native damage, final blow or loot |
| Chat 15 — NPC combat tactics | `1861f709456c9875df582371fbaf80b0d2b4ea90` | Physical NPC/controller checks, response/retreat guard and native commands; `authorizePlayerDefense` defaults to deny; no unauthorized NPC→player attack enabled |
| Chat 22 — exploration | `3b9b0cbc2fe379a81f7f1131ba1a500d850bbf8a` | Ship-, signature-, position-bound 100% probe scan proof and native fleet-bookmark arrival witness; hacking game and container loot E2E unverified |
| Chat 29 — market | `70c24d66268ef45e115e19dbe05a2425b5bfb7d5` | Native player BUY cancellation escrow identity/refund guard, default OFF; consistency is not independent payment receipt nor a Rust+GameStore distributed transaction |
| Chat 36 — Pochven | `003b97380dbf73e3c3f5aa5ecdd1fdf7d7d4b4b4` | Native SDE-backed Conduit restrictions, 6.0 raw Triglavian Home standing, reciprocal gates, ship class; no fabricated Pochven NPC, filaments or rewards |

## Integration findings, reconciliation and test evidence

- All five original commits were confirmed as ancestors of shared `main` by GitHub compare. **Do not cherry-pick or re-merge them**. Later concurrent commits also registered Chat 23's independent wormhole fence and native NPC/player-market settlement guards; preserve those owners' hooks.
- **Verified source defect:** original COOP-034 buyer skip (`coop-npc-market-buy-safety-patch.cjs`) ran before COOP-035 corporate adapter. The corporate adapter replaces the original skip line with its own gated native branch; a second central apply previously inserted the old skip *again*. Another contributor fixed the general repeat-apply before this review. This commit **strengthens the fail-closed condition**: only a byte-exact complete COOP-035 source block authorizes skipping the legacy insertion. A truncated or marker-only branch must raise `NPC_BUY_GUARD_CORPORATE_PATCH_DRIFT`, not silently proceed.
- **Confirmed merge artifact:** central `scripts/patch-evejs-coop.cjs` retained `if(spec.file==="server/src/space/runtime.js")if(spec.file==="server/src/space/runtime.js")`. This commit reduces it to the single intended condition without changing any feature flag, hook ordering or native target. The repeated adjacent comment is deduplicated.
- The central original market source was executed through the actual current patch modules (catalog, legacy NPC guard, corporate NPC adapter, buyer cancel, seller return and P2P fill). Full native market patch output parsed; repeat apply, rollback and reapply after rollback preserved exact source. These are **source-executed JavaScript checks**, not Rust compilation, live SQLite transaction or a two-client acceptance result.
- Original Pochven stargate, Chat 23 wormhole jump, native scan and Beyonce scan/bookmark transforms were independently exercised on the exact pinned upstream strings: reversible and idempotent at their individual patch boundaries. The central `EVEJS_COOP_CODE_PATH` roundtrip covering ALL specs still requires a legitimate local checkout and remains an explicit acceptance gate.
- Earlier isolated tests were rerun against the retained chat artifacts with Node v22.16.0: Chat 09 **13/13**, Chat 15 **16/16**, Chat 22 **13/13**, Chat 29 **10/11 with 1 skipped host-dependent case**, Chat 36 **14/14**, totaling **67 tests, 66 pass, 1 skip, 0 fail**. This run predates further unrelated main changes; never re-label as repository-wide acceptance.

## Instructions for the other bots (PR handoff)

**Chat 01 / central installer owner:** Review this one-commit rebase against **current** `main`, run `node --check scripts/patch-evejs-coop.cjs`, the new cross-stream regression and `tests/coop-crossstream-overlay-roundtrip.test.mjs`, then on a **disposable pinned source checkout** run `--dry-run`, `--check`, apply twice and `--remove` byte-for-byte. Preserve existing other-chat specs, `EVEJS_COOP_*` defaults and the original native service. Do not add GitHub Actions.

**Chat 09 and 15 / combat:** With original native ship/controller objects, check weapon charge conservation, ammo debit and native damage/kill/wreck observability. Chat 15's defensive NPC→player authorization remains default-deny; only Chat 01/native Crimewatch owner can supply a legal authority callback. An attack-order ACK is not a hit.

**Chat 22 and 23 / exploration and wormholes:** Validate 100% physical scan → native fleet bookmark ACL → two distinct ship arrivals; keep wormhole mass/collapse/polarization with the Chat 23 original service (not the Pochven stargate path). Verify genuine analyzer module and site loot under restart before claiming hacking completion.

**Chat 29 and 40 / settlement:** Revalidate native Rust and GameStore after crash windows on disposable copies. Both buy- and sell-order escrow guards plus new P2P fill guard are policy fences, **not** an exactly-once end-to-end cross-database claim. Prove ordinary seller wallet credit, tax, split stacks, cancel+expiry after partial fills, ack loss and both clients' original inventory/ISK deltas; never rebuild the active market database.

**Chat 36 and 42 / Pochven acceptance:** Verify original persisted 27-system topology and native Conduit pairs, entry/exit restrictions for two authenticated ships and raw standing after restart. Current pinned source still lacks independently verified region-specific Triglavian/EDENCOM roaming PvE, real filaments, special-site rewards, station standing restrictions and 2026 gameplay parity. If data/assets/native RPCs are absent, report BLOCKED rather than invent a feature.

**Host-required proof:** no live Docker, active Rust daemon, authenticated EVE sessions or authorized disposable GameStore/market copy were available during this reconciliation. `state/NOW.md` is an older published snapshot and **cannot** attest later `main` or live two-client results. Unit tests, source guards and a review PR do not constitute `GAMEPLAY_READY`.

## Revert and release gate

Review/merge this PR as exactly one source-only commit. To revert, revert that commit; it has no data migrations. All feature flags are still default OFF. Do not deploy without the native pinned full roundtrip, isolated database recovery proof, client A/B actions and explicit owner authorization.
