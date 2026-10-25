# COOP-024E stage 8 — Authoritative native weapon-cycle ammo debit

**2026-10-25. Status: source patch implemented and isolated tested; pinned runtime transformed and parsed. Live two-client and real DB crash recovery remain unverified.**

Depends on [PR #62](https://github.com/pas7-studio/evejs-coop-universe/pull/62) → #58 → #55 → #52 → #49 → #46 → #45 → #42 → #39.

## Verified pinned EveJS fire-cycle ownership

The actual 1.2-MB pinned `Code/server/src/space/runtime.js`, SHA `e5823733517be37b72688310a54c4010c4187030`, contains native authoritative:
- `executeTurretCycle(...)`: finds locked live target and weapon snapshot; **in vanilla source resolves turret hit and applies damage before attempting ammo debit**.
- `executeMissileCycle(...)`: validates target and weapon snapshot; calls `consumeTurretAmmoCharge` for each loaded missile launcher and **then** `scene.launchMissile`. Vanilla bank handling may still launch after a partial source debit failure.
- `consumeTurretAmmoCharge(...)`: edits the actual `nativeNpcStore` cargo row, but **if the row is absent**, vanilla proceeds to update a cached in-memory charge and report success. It also calculates its next quantity from the cached charge snapshot, which can be stale and could overwrite a smaller real store quantity.

The `localCycleRuntime.consumeLoadedChargeQuantity` helper is for local module cycles and must **not** be wired to turret/missile damage to invent extra debits. Native barrel/cycle scheduling remains authoritative in `space/runtime.js`.

## Source-level implementation (opt-in, vanilla unchanged)

`scripts/coop-native-npc-fire-debit-patch.cjs` transforms **only** three existing functions, via unique anchored, reversible, syntax-verified source edits. `scripts/patch-evejs-coop.cjs` installs the patch and `integration/coopNpcFireDebitProof.cjs` into the existing pinned overlay. All new logic is gated on `EVEJS_COOP_NPC_STRICT_AMMO=1` **and real `nativeNpc:true` ships**.

1. **Exact source preflight:** before every actual `consumeTurretAmmoCharge` debit, verify live native ship owner, one installed matching category-7 module/slot, exact category-8 `cargoID` / `moduleID` / `ownerID` / `typeID` / `flagID`, positive integer quantity, and **exact equality to the runtime charge quantity**. Check SDE charge compatibility through pinned `npcCapabilityResolver`. Genuine transient native cargo is allowed; a virtual reserve without a real row is not.
2. **Persisted result verification:** after native `upsertNativeCargo` or `removeNativeCargo`, read the actual cargo store again. The quantity must be exactly the expected remaining amount (or the original row must be absent after depletion), with matching owner, module and type. A no-op store write that returned `success:true`, a lost source, a storage error or forged cache returns `AMMO_WRITE_UNVERIFIED` / `NO_AMMO` and does not continue to the damage/projectile path.
3. **Turret ordering corrected:** in strict native mode for stack charges, first validate every active bank barrel against native inventory, and run **the existing native `consumeTurretAmmoCharge` once per barrel before `resolveTurretShot` or damage**. The subsequent original charge-result handling reuses that exact debit result; it never debits twice. Missed shots consume a real unit too; invalid targets do not. For crystal/volatility ammo, source is checked before firing, while **native crystal volatility semantics remain unchanged**.
4. **Missile bank validation:** validate all armed launchers before making the first debit; on any failed debit or native DB write, **no missile is launched** in strict native mode. No fabricated `scene.launchMissile` or damage is produced.
5. **Same-process duplicate cycle fence:** on strict native NPC turret and missile fire, the original `effectState` is marked with `_coopStrictAmmoLastBoundaryMs` before debit. A duplicate invocation for the exact same `cycleBoundaryMs` is refused, avoiding duplicate charge spending in the active process. This fence is **not** durable across a process crash; durable native compare-and-swap/cycle receipts remain a separate acceptance gate.

## Evidence and safety boundaries

- **19/19 committed focused tests PASS** (13 source-identity/compatibility/cargo-bank tests and 6 source-patcher semantics and rollback tests) executed in isolated V8 on fetched committed source.
- The **full actual pinned** `space/runtime.js` fetched from GitHub and transformed: parses successfully, patches once, reapplies idempotently, reverts **byte-for-byte**. This checks the real 1.2-MB upstream source, not merely a synthetic fragment.
- Actual upstream `consumeTurretAmmoCharge`, `executeTurretCycle`, `executeMissileCycle` functions were extracted into isolated native-shaped runtime harnesses. Verified **5 turret scenarios** (debit before hit/miss, exactly one charge, no damage on source failure or invalid target), **6 missile scenarios** (debit before spawn, missing source, failed native write, stale cache, same-process duplicate boundary, invalid target), **3 native consumer scenarios** (genuine cargo debit, stale repeat refusal, no-source refusal), plus a direct **no-op-success native store** case which returns `AMMO_WRITE_UNVERIFIED` without modifying cached cargo. These are in-memory harness tests, **not running the full server**.
- Default OFF and players remain unchanged. Source changes do not create items, invent damage, credit ISK, override ammo reload time, or bypass Crimewatch.

### Explicit remaining risks / NOT DONE

1. **Cross-process atomicity and crash replay:** native store currently persists the charge independently of the in-memory cycle marker. A crash after successful debit and before shot can lose ammo; replay across a restart may require a durable receipt keyed by a source-owned cycle ID. There is **no** claim of crash-safe exactly-once firing. Concurrent native writers require atomic compare-and-swap or a source transaction.
2. **Bank partial failure:** if one barrel's debit succeeded and a later barrel's debit failed, no strict turret damage/missile spawn occurs, but the already debited ammo is **not automatically refunded**. Blind refunds risk duplication; this requires source-backed multi-row transaction or operator reconciliation. This avoids free hits but may lose some ammunition in a failed volley.
3. **Missile spawn failure after successful debit:** native EveJS already deducts missile ammo before `scene.launchMissile`. If spawn fails, ammunition can be spent without a projectile. No speculative refund is done.
4. **Crystal breakage:** volatility handling is still performed after shot resolution by the native engine; this branch validates a real crystal before firing but does not reimplement crystal damage/cycle transactions.
5. **No live acceptance:** no pinned `node --test` execution against full EveJS checkout, real persisted SQLite/gameStore crash injection, dual-client weapon visuals, native NPC market/loot/performance concurrency, or deployed gameplay.

### Owner-approved disposable server acceptance gate

Use a new disposable test volume, **not `evejs-data`**. Under `EVEJS_COOP_NPC_STRICT_AMMO=1`, observe real fixed-cycle turret and missile fire with source-before/after inventory and target damage. Cover hit, miss, empty source, stale cached charge, two-barrel bank, source write failure, stalled/missing launcher, missile spawn failure, same-boundary duplicate, restart between debit and launch, simultaneous writers, normal player ship and true charge-optional hull weapon. Verify exactly one native source deduction per completed barrel cycle where applicable, no free damage, and an authentic NPC earned-market ammo purchase/physical rearm after depletion.

**Draft. No main merge, CI, Docker deployment, live game state, or `evejs-data` mutation.**
