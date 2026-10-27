# Night plan — 2026-10-28 (approved by the owner)

Owner's words: "це все що ти написав плануй і розпиши". Everything below is
authorised to be planned and worked overnight. Nothing here is evidence: each
task is done only when its acceptance criteria are measured and cited.

## Operating rules for the night

1. **Work stack only.** All development, restarts and proofs happen on compose
   project `evejs-agents` (`scripts/Start-Agents-Stack.ps1 -Action Up|Status`).
   The play stack (`evejs`) is **not restarted overnight**; exactly one deploy is
   allowed at the end (~06:30 local) so the owner wakes to a running war.
2. **Do not touch mining files.** Another agent works on
   `miningNpcOperations.js` / `mining` runtime in the fork. War/FW files only.
3. **One change = one commit.** Repo commit + `scripts/log-change.cjs`, and for
   engine changes a commit in the fork (`C:\Games\EveCoop\upstream-evejs`).
   `node scripts/coop-engine-audit.cjs` must print `AUDIT_OK` after each engine
   change.
4. **No invented evidence.** A task is DONE only with a real event line, a real
   DB row or a real measured number. "Server accepted the order" is not combat.
5. **Fail closed and report.** If a precondition is missing, write the exact
   blocker into `.opencode/state.md` and move to the next task; never guess a
   value, never fabricate a kill, never reset volumes.

## Queue (ordered; later items may move earlier if blocked)

### N1. Territory capture on real evidence  ← highest value
Goal: a contested system really changes military controller when the defending
garrison is destroyed, with native wrecks as the only proof.
How: extend the objective adjudicator so a campaign in ASSAULT whose defender
side has **zero alive registered hulls in the target system** *and* at least one
confirmed casualty wreck of that side in that system commits a capture through
`coopFactionWarCore.execute({type:"CAPTURE"})` (receipt + revision bump).
Acceptance: `living-native-war-objective-captured` with receipt; territory row
`militaryControllerFactionID` = attacker, `state` = OCCUPIED, revision +1; unit
tests for refuse paths (no wrecks → refuse, live defender → refuse, wrong
campaign → refuse).
Risk: flipping too eagerly. Mitigate: require ≥1 real wreck **and** 60 s of an
empty defender side, both measured.

### N2. Formation warp proven live
Goal: a side of 2+ hulls that must close on the enemy warps **together** in
formation.
How: on the agents stack, spawn two hulls of one faction in the campaign source
system, let the assault open, capture the FW-030 batch call.
Acceptance: `living-native-war-engagement-warp` order with `formation >= 2` and
`status NATIVE_FORMATION_WARP_STARTED`; the two ships land at distinct points.
If the native batch refuses, record the exact error and fall back to per-ship
warps with a documented reason.

### N3. Restart resilience of a live war
Goal: killing the server mid-battle must not duplicate, lose or freeze the war.
How: with a battle running, `docker restart` the agents server; verify after boot:
campaign still ASSAULT, territory rows unchanged, war fleet registry has no
duplicate hull per pilot, no duplicate casualty for the same wreck, garrison
refills only what is missing.
Acceptance: written before/after diff (campaign, territories, registry, casualty
count) with no unexplained delta; one event per real action, no replay storm.

### N4. The player is one ship in the fleet
Goal: an enemy war fleet issues a real attack order against the enlisted player's
ship when it is in the contested system, using the same target logic it uses for
NPCs.
How: verify the battle director's player candidate path end to end on the agents
stack with a second authenticated client if one is available; otherwise prepare
the exact precondition and leave `BLOCKED_CLIENT_CHECK` with the required human
action.
Acceptance: `living-native-war-attack-orders` naming the player's shipID, or an
explicit `BLOCKED_CLIENT_CHECK` with the one action the owner must take.

### N5. Real war economy (no free fleets)
Goal: a spawned war hull and its charges are paid from the faction's **earned**
ledger; a side that cannot pay stops reinforcing instead of printing hulls.
How: wire the existing treasury/chest authority into the FW-033 garrison so a
spawn is refused with `WAR_CHEST_INSUFFICIENT` when the balance is below the hull
cost; every spawn writes a debit receipt.
Acceptance: garrison spawn produces a debit row and a reduced balance; with the
balance forced to 0 the spawn is refused and the skip is published; no ISK is
invented anywhere.

### N6. Roster truth
Goal: stop the dead `NOT_IN_ROSTER` path.
How: either make `spawn_war_fleet` write the war fleet roster, or delete the
roster dependency from FW-032 and document the registry as the only custody.
Acceptance: one of the two, with tests; `living-native-war-loss-reconciled`
never reports `NOT_IN_ROSTER` for a hull that was spawned by the sanctioned path.

### N7. Ammo endurance
Goal: a war hull that runs dry releases its slot instead of standing dead.
How: measure `EVEJS_COOP_WAR_PATROL_AMMO_DEPTH` consumption over a long fight on
the agents stack; confirm FW-003D relief fires.
Acceptance: `living-native-war-battle-line-relief` (or the ammo event) with the
real charge count, and the dry hull replaced by a fresh one.

### N8. Wreck and loot hygiene
Goal: wrecks do not accumulate forever.
How: measure wreck count over the run; add a bounded cleanup that only removes
wrecks whose loot was already claimed (never unclaimed evidence).
Acceptance: before/after counts, and a test that an unclaimed wreck is never
removed.

### N9. Militia rank visible in the client
Goal: the militia tab shows the real rank (recruit → pilot → wingman) from the
merit ledger instead of zeros.
How: check `facWarMgr.GetMyCharacterRankOverview` / `GetMyCharacterRankInfo`
return the real merit and rank for the owner's character; fix the payload if it
is empty.
Acceptance: response contains the real rank and merit for character 140000005;
no invented rank.

### N10. Eight-hour soak with a written report
Goal: prove the war runs unattended.
How: start the agents stack war and leave it; every hour record kills, garrison
spawns, campaign state, CPU, event-file growth, memory.
Acceptance: `.opencode/night-soak-20261028.md` with the hourly table and a clear
verdict (STABLE / DEGRADING / BLOCKED with the exact cause).

### N11. Extraction debt for the FW hooks
Goal: keep the engine audit clean.
How: move the hook bodies currently inside
`server/src/services/map/fwWarzoneSolarsystemService.js` into a
`server/src/space/coopFwWarzoneView.js` module with a one-statement env-gated
hook, the same pattern as the rest.
Acceptance: `AUDIT_OK`, stock-file co-op surface for that file drops, front-tab
payload byte-identical before/after (diff the JSON).

### N12. Operator guide
Goal: the owner can inspect the war without an agent.
How: `docs/WAR_OPERATOR_GUIDE.md` — the exact admin-bridge requests
(`war_state`, `war_fleet_state`, `war_combat_diagnose`, `npc_pair_diagnose`), how
to read `living-native-war-*` events, and how to tell a real kill from an order.
Acceptance: every command in the guide was executed once and its real output is
quoted.

### N13. Morning handover
Goal: the owner wakes to a working war and a short list.
How: one play-stack deploy (~06:30), refresh `state/NOW.md`, `docs/WORKLOG.md`,
and write `.opencode/MORNING_20261028.md` with: what changed, what to look at in
the client (front tab counts 47–71, one contested system, advantage numbers), and
the one next decision for him.
Acceptance: deploy prints `OVERLAY_OK`/`AUDIT_OK`, the war is alive after it, and
the morning file lists exactly what to check.

## Explicitly out of scope tonight
- Second faction pair (Amarr/Minmatar). Keep Caldari/Gallente.
- Shipcaster, native sovereignty, incursions — known blockers, no design decision.
- Any change to the owner's play stack before the morning deploy.
- Mining modules (parallel agent).
