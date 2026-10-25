# COOP P0: lethal native NPC hit evidence

**Status:** regression fix committed as a dependent branch of P0 cross-stream integration PR #7. No live Windows/EveJS deployment, two-client gameplay, market, wallet, quest reward or persistent-volume changes were performed.

## Verified root cause in pinned upstream

EveJS upstream SHA `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`:

- `server/src/space/runtime.js` `applyWeaponDamageToTarget` synchronously applies native damage and, on lethal structure HP loss, calls `destroyCombatEntity` **before returning**.
- Turret and missile flows subsequently call `noteKillmailDamage` / `killmailTracker.noteDamage` **after** the damage function returns.
- `server/src/space/npc/nativeNpcWreckService.js` removes the NPC's native ship entity and then spawns its physical native wreck with `nativeNpcWreck:true` and `launcherID` pointing to the destroyed NPC's ship ID.
- Previous `coopPlayerCombatWitness` only accepted `scene.getEntityByID(victimID) === targetEntity`, which necessarily missed genuine one-shot/final-blow receipts after target removal.

This is an evidence **false negative**, not a reason to change EveJS native damage or manufacture kill credit.

## Change

The witness preserves the strict original route for still-visible live NPCs (`victimProof=LIVE_NATIVE_SHIP`). If a native NPC has already been removed, it additionally requires **all** of:

1. Exact, positive applied native damage from `killmailTracker.noteDamage`.
2. Existing native `kind:"ship"`, `nativeNpc:true` target with terminal `conditionState.damage===1`.
3. The target ID is absent from the same native scene (not replaced by another physical entity).
4. A physically present `nativeNpcWreck:true` entity in the same `dynamicEntities` Map, whose `launcherID` is exactly the old target ID and whose identity is confirmed by `scene.getEntityByID(wreck.itemID) === wreck`.
5. Exactly one authenticated, connected, initialized player session with the **same physical attacking ship object** in that scene, matching pilot ID and system.

Such a verified hit now carries `victimProof=TERMINAL_NATIVE_WRECK`. The code **never** creates a wreck, damages NPCs, awards bounty/loot, credits missions, pretends the client displayed the hit, or bypasses original game authority. If native death did not produce a physical wreck, the report remains blocked rather than inventing evidence.

## Verification

```powershell
node --test tests/coop-player-combat-witness.test.mjs tests/coop-native-lethal-hit-evidence.test.mjs
# Optional, on an authorized pinned checkout: verify actual native upstream source ordering too
$env:EVEJS_COOP_CODE_PATH='C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-native-lethal-hit-evidence.test.mjs
```

Local Node 22 result: **19/19 PASS** for original + new witness suites, plus one optional pinned-source test SKIP where upstream checkout was unavailable. Broader independent workstream regression: **62 PASS / 1 SKIP / 0 FAIL (63 tests)**. These are not real Docker or client acceptance results.

For live proof, first resolve the current headless telemetry gate with PR #9's read-only diagnostics, update the installed overlay only after operator approval, and confirm actual turret and missile event receipts in `coop-events.jsonl` with real two-client play. Compare `victimProof` values to physical wreck IDs and independently verify both clients' UI, native mission progress, loot debits, reconnect and authoritative inventory.

The new `tests/coop-native-lethal-hit-evidence.test.mjs` is wired into the existing local Windows `Verify-Local-Coop.ps1`. This PR is stacked onto PR #7, and **must not be merged independently into `main` as a duplicate copy of PR #7**. No CI, merge, build, Docker restart, or modification of `evejs-data` is included.
