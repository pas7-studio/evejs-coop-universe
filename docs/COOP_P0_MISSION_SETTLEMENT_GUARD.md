# P0: crash-safe cooperative mission second-recipient guard

**Base:** merged main `1d71e7fac47ab28dfead53ba7b63482d37e1df41`. Runtime source change: `integration/coopFleetMissionTurnin.cjs`; tests are appended to the already registered `tests/coop-fleet-p0-cooperative-actions.test.mjs`.

**Previously:** automatic two-person mission turn-in was OFF by default. When experimentally opted in, `finish()` issued an ordinary native `missionRuntime.doAgentAction(peer)` after captain completion, without a persisted BEFORE record. If the process died after native ISK/LP/item side effects but before the caller observed success, retry could duplicate or misattribute the payout.

**New:** only when operator deliberately sets `EVEJS_COOP_FLEET_MISSION_TURNIN=1`, the peer settlement goes through a synchronized, append-only JSONL journal at `/var/lib/evejs/coop-mission-turnin.jsonl` (override `EVEJS_COOP_MISSION_TURNIN_JOURNAL_FILE` to an absolute persistent path).
- The key includes native fleet, both character IDs, agent, each mission sequence, content and mission template. A stale mission cannot borrow another attempt.
- The source-of-truth native mission/fleet/station/session checks still run first. No free payout or peer journal cloning.
- `PREPARED` is durably appended **and fsync'd before** the native peer `doAgentAction`. Journal read/write errors block that action.
- After native result SUCCESS and the peer's accepted mission no longer exists, journal appends and fsyncs `AWARDED`. Only then is `TWO_NATIVE_MISSIONS_COMPLETED` reported.
- Unexpected native errors, uncertain mission state, journal fsync/write errors, interruption after `PREPARED`, malformed/partial file or a previous `UNKNOWN` remain **blocked for explicit manual reconciliation**. NEVER automatically rerun a potentially paid recipient.
- `AWARDED` same key cannot be replayed. The vanilla/leader native DoAction remains the only authoritative reward mechanism; no new wallet/LP/item writer is introduced.

**Scope:** this is a P0 **safety prerequisite** for the experimental peer payout, **not a complete end-to-end exactly-once joint reward transaction**. The leader's normal native action happens before this guard; native reward transactional semantics and persistence across forced process kill must be verified separately. If the journal says ambiguous, an operator must compare native owner-specific wallet, inventory, standings and mission history before any manual repair. No automatic "fix" command is provided.

**Tests:** 18/18 full cooperative-action contracts PASS in an isolated V8 compatibility harness (including four new durable journal cases with in-memory fs). Official Node and Windows/Docker tests are still required:

```powershell
node --test tests/coop-fleet-p0-cooperative-actions.test.mjs
```

**Acceptance:** two authorized accounts, completed same native mission, one peer payout on first authorized experimental turn-in, inspect journal on persistent named volume, then deliberately stop/restart only with operator approval; verify no second reward on reconnect, and UNKNOWN blocks duplicate attempts. Observe both real client mission journals and each wallet/LP/item award. **Feature remains disabled by default**; do not enable or deploy based on unit tests alone. No Docker restart, main merge, CI, data deletion or volume mutation performed in this PR.