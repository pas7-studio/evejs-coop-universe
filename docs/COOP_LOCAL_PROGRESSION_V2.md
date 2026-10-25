# EveJS LivingCoop — local progression V2 (2026-10-25)

> **2026-10-26 current source of truth:** The deployment script `scripts/Deploy-Coop-RuntimeProbe.ps1` currently defaults to **100×**, not the historical V2 target 48×. Operator choices are 6, 12, 24, 48, or 100. The tables below are illustrative, not a claim about running server speed. Existing active queues require Chat 33 old-rate SP settlement, durable journal and verified backup **before any speed change**, including decreases.


**Scope:** starter-to-specialist pacing for two friends on a PRIVATE, loopback-only EveJS server. **Source change prepared; not deployed, not live-client verified.** Native EveJS queue is the only authority for SP, prerequisites, characters and offline training. No free SP grants or fake clone/skill state.

## Decision

The legacy LivingCoop override set native `EVEJS_SKILL_TRAINING_SPEED=6`. The **historical V2 design target** was **48× Omega** for new/rebased worlds. Current post-42 deployment source instead defaults to **100×**, and explicitly supports 6, 12, 24, 48 or 100 via `-CoopSkillTrainingSpeed`. Do not interpret a historical target as authorization to change a running world. Omega remains backed by the existing native `EVEJS_OMEGA_LICENSE=true`. Non-LivingCoop and upstream defaults are untouched.

This is a deliberate starting profile, not a claim that a complete ship specialization always takes the listed time. Native prerequisites can involve **many distinct** ranked skills, missing skillbooks, ISK and equipment, and the EVE client may show cumulative queued time. The observed **one-year estimate must be investigated against effective runtime speed and the exact active queue** before calling it fixed.

### Native V-level training comparison (typical Omega 20+20 attributes; *single* skill from IV to V)

| Rank | 6× before | 48× local default |
|---|---:|---:|
| 1 | 19.51 h | 2.44 h |
| 2 | 39.03 h | 4.88 h |
| 4 | 78.05 h | 9.76 h |
| 8 | 156.11 h | 19.51 h |
| 16 | 312.22 h | 39.03 h |

`skillPoints(rank, level) = ceil(rank * 250 * 2 ** (2.5 * (level - 1)))`. Native Omega speed `(primary + secondary/2)*multiplier` SP/min, Alpha remains 0.5×. A 48× skill rank 4 V step thus fits one extended game day rather than a multi-day lock. Ranks are *skill training-time multipliers*, not ship class IDs.

### Play-session pacing targets, not hard entitlement grants

- Starter frigate immediately usable with native ownership / skill checks.
- Initial useful ship-fitting skill I–III during the first evening; starter rank-2–4 skill IV→V over several sessions (about 5–10 hours at 48×).
- Basic destroyer and new fitting roles in one evening when equipment is acquired through native economy; cruiser/mid-tier specialization over several evenings.
- Elite ranks 8–16 remain multi-day for V, and real battleship/carrier paths must still pay for multiple prerequisites and ship losses.
- Manufacturing remains the separately gated native 0.35× time multiplier with original minerals, jobs, blueprint and ISK costs. Market prices, mining output and NPC resources are **not** secretly multiplied by skill speed.

## Critical P0 queue migration fence

**Do NOT simply deploy a 48× server on top of an existing active 6× queue.** Pinned `skillQueueRuntime.buildProjectedQueueEntries` recalculates the elapsed duration from persisted `activeStartTime` using the **current** native multiplier. A restart from 6× to 48× with the same historical start timestamp could credit extra, unearned SP or finish a skill prematurely. `snapshotCache` invalidation alone does NOT solve this.

The updated `Deploy-Coop-RuntimeProbe.ps1` reads the existing `compose.coop-probe.yaml`. If its training speed differs from the requested one, it **fails before writing new Compose, applying overlay or restarting Docker** unless `-ConfirmActiveTrainingRebased` is provided. This switch is an operator assertion, **not an automated migration**. Never use it blindly.

Safe migration prerequisites:

1. Read-only: `powershell -File scripts/Inspect-Coop-Training.ps1` checks effective training speed and Omega of the **running** container (does not expose unrelated environment or account data). Compare with both real client skill-queue remaining times and record the current skill, actual SP, queue and clock for **each active character**.
2. Preserve and back up native character skills and skill queue tables from the **existing** world. Under the old native 6× rate, settle earned progress through the authoritative skill queue logic at the same cutoff timestamp, including completed entries and event/history state. Do not manually grant raw SP or discard unfinished entries.
3. Atomically rebase each remaining active character's native queue `activeStartTime` to the cutoff time, preserving settled SP and remaining queue order. Ensure the authoritative native queue state and skill records persist together. This is a **separate queue migration operation that has not yet been implemented/tested in this project**. A backup alone is NOT that migration.
4. Only after independent old-rate reconciliation, explicit operator approval, and a disposable-copy rehearsal: use `-LivingCoop -CoopSkillTrainingSpeed 48 -ConfirmActiveTrainingRebased`. Keep `evejs-data` intact. For **new** worlds without an existing override the 48× config may be applied using the normal explicitly authorized deployment.
5. Verify native queue ETA and earned SP match the new rate **from the cutoff onward**, offline/relogin/restart, Alpha/Omega parity and both clients. If the server actually runs at 1× or the UI still says a year, diagnose missing override, wrong clone grade or an invalid skill rank first.

**Until migration automation and client validation exist: running existing 6× worlds should use `-CoopSkillTrainingSpeed 6` and remain untouched.** A literal one-year estimate cannot be declared resolved just by a source commit.

## Read-only inspection and regression

- `node scripts/coop-skill-pacing.cjs 48` previews representative rank V estimates using pinned native formulas, no character state.
- `powershell -File scripts/Inspect-Coop-Training.ps1` inspects the actual running server's allowlisted effective flags, not the theoretical Compose source.
- `node --test tests/coop-local-skill-pacing.test.mjs` checks pacing mathematics, opt-in defaults, native queue source contract (when `EVEJS_COOP_CODE_PATH` is set), migration gate and read-only inspection.
- Manual gameplay acceptance requires two authorized clients, native skill training and offline completion. Neither a source-level green check nor a scripted duration table proves runtime ETA.

## Later improvements

Audit whole real prerequisite trees and skillbook accessibility to validate the **entire path** from starter to early combat hull, not just one rank IV→V step. Add an authoritative queue-migration tool with dry-run, backup, transactional rollback and native offline SP settlement *before* enabling 48× on an existing character. Profile player mining/reprocessing/industry downtime separately without fake resources or inventory bypass.
