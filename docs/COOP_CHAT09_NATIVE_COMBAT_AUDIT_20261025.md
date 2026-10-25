# Chat 09 — pinned EveJS weapon, damage, ammunition and destruction review

**Baseline:** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, EVE 24.01 build 3396210. **Status:** `CODE_READY / LIVE_UNVERIFIED`. This review is source-level; no authorized graphical client, persistent production SQLite or deployed native combat was available to this chat. Do not interpret unit tests as physical fights.

## Verified native paths and boundaries

| Area | Pinned source | Finding / remaining gate |
| --- | --- | --- |
| Turret hit/tracking/range/wrecking | `Code/server/src/space/combat/laserTurrets.js` | Native `resolveTurretShot` computes angular velocity, signature, range/falloff and hit quality. Two-client turret hit/miss and accurate observer effects NOT_TESTED. |
| Missile application | `Code/server/src/space/combat/missiles/missileSolver.js` | Signature, explosion radius/velocity and damage reduction factor implemented; launch, expiry, point-of-impact, live target velocity and actual HP reduction need gameplay evidence. |
| Fitting/charges/capacitor | `Code/server/src/space/combat/weaponDogma.js`, `Code/server/src/space/npc/npcBehaviorLoop.js`, `Code/server/src/space/modules/localCycleReloads.js` | Native dogma/weapon-family and activation paths exist. Player capacitor debits, ammo reloading on simultaneous bank cycles, changes during disconnect and disconnect-safe cancellation NOT_TESTED. |
| Damage/resistances | `Code/server/src/space/combat/damage.js` | Layer-by-layer EM/thermal/kinetic/explosive resonances and condition-state updates exist. **Confirmed source defect**: a still-present layer with zero susceptibility to all remaining damage leaves `rawRemaining` unchanged and loops into later layers; see Chat 01 integration request. |
| Destruction/wrecks | `Code/server/src/space/shipDestruction.js`, `Code/server/src/space/npc/nativeNpcWreckService.js` | Native physical wreck paths exist. Lethal damage is applied and destruction may occur before `killmailTracker.noteDamage` (existing player evidence witness handles matched terminal native wreck). Server/client race, double-destruction and persistent inventory outcomes NOT_TESTED. |
| Heat | `Code/server/src/services/dogma/activationHeatState.js` | Fixed heat-state tuple alone is NOT proof of real heat accumulation, module damage/burnout, capacitor or damage bonuses. Require source trace + gameplay acceptance before advertising overheating as complete. |
| NPC shot conservation | existing `coopNpcAmmoBankAtomic`, `coopNpcFireOutcomeWitness`, native fire-debit source helper | SQLite/fynced ammo journals are default OFF; a committed ammo debit may not guarantee a physical shot on crash. No automatic refunds, replay or synthetic hit are permitted. |

## Implemented independently in this change

`integration/coopNpcWeaponAmmoGate.cjs` already feeds an opt-in native NPC weapon activation hook. Its `isChargeOptionalTurretWeapon(moduleItem)` shortcut happened **before** any `nativeNpcStore` custody check and before iteration over a multi-module weapon bank. A no-charge/optional master could authorize other barrels with no physical ammunition. It also did not compare the active module's type, flag and supplied owner against the stored fitted module. The opt-in code now:

1. Verifies the native NPC owner/system and exact persisted fitted type/flag/online state before any charge-optional allowance.
2. Validates unique, positive module IDs (max 16) and every member of a bank; evaluates charge requirements per member.
3. Requires one matching, owned native charge stack for every non-optional module, rejects mismatched inventory, duplicate or ambiguous charge stacks, and rejects any charge-optional missile claim.
4. Preserves explicit synthetic hull weapon exception (it is **not** native fitted-cargo fire) and default OFF/players unchanged.
5. Only decides activation/deactivation. No damage, capacitor, cargo debit, reward, ship creation or telemetry is fabricated.

The change uses the existing native hook and has no new flags or central installer edits. Original source-hook test fixture must include the exact native `typeID` now required for custody.

## Integration request to Chat 01 — do NOT silently patch a shared runtime

**Defect:** `applyDamageToEntity` in pinned `Code/server/src/space/combat/damage.js` computes `effectiveRemaining = sum(rawRemaining[type] * resonance[type])`. In `if (effectiveRemaining <= 0)` it pushes a zero-effect result and `continue`s, leaving the same raw vector available against armor/hull despite an intact immune shield (or hull behind immune armor).

**Minimal semantic correction:** when a current layer has `maxHP > 0` and `currentHP > 0` and the *entire remaining hit* has zero effective damage at that layer, consume/discard that raw vector at that layer (set all `rawRemaining` components to zero or terminate the loop), without reducing the layer HP or letting it bleed through. Do **not** change behavior for a depleted layer, regular partial resistance, or a legitimate shield-break overflow. Preserve telemetry as an observation only; never reapply a shot from the witness. Make it a single reversible default-OFF hook in Chat 01's central installer or upstream-authorized fix after pinned-source review, with full LF/CRLF apply/remove tests. No separate damage engine.

**Mandatory native tests:** shield 100 / shield EM resonance 0 / armor 100 / EM 25 must leave armor unchanged; depleted shield must route damage to armor; normal 0.5 resonance and shield-breaking overflow must remain correct; fully immune armor must protect hull; simulated repeat callback must not call native apply twice; client A/B must observe same actual shield/armor/hull and exactly one wreck after lethal hit. A deployment feature gate remains OFF without operator approval.

## Regression and live acceptance

- `node --test tests/coop-npc-weapon-ammo-gate.test.mjs tests/coop-npc-weapon-ammo-custody.test.mjs tests/coop-npc-weapon-source-hook.test.mjs` (Node 22+, local checkout).
- `node scripts/patch-evejs-coop.cjs --check --code-path <pinned Code>` and source roundtrip preflight, after an authorized overlay deployment. No production volume reset.
- For each player→player, player→NPC, NPC→player, NPC→NPC: record real native ship+module+target IDs, fired charge and debit receipt, target shield/armor/structure before/after, wreck ID and repeated event count. Repeat after reconnect/restart, with destroyed/missing source items, capacitor deficit, missed turret, missiles hitting after target demise, loss of module online state and canceled overheat cycles. Correlate two authorized clients' UI with server-native events; telemetry only is not a two-client PASS.

**Unverified:** damage fix depends on Chat 01. Fully applied native ammo conservation, player capacitor/heat behavior, actual two-client rendering and ship destruction replay remain `LIVE_UNVERIFIED` / `BLOCKED_CLIENT_UNAVAILABLE`. No remote CI, destructive database operations or unapproved deployment.
