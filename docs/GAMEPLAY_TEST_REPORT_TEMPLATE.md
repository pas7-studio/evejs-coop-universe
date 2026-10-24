# EveJS Living Universe — gameplay acceptance report

Date (include timezone):
Operator/host:
Project checkout SHA:
Pinned upstream EveJS SHA:
Running server image/overlay identified by:
Authorized compatible client available? YES / NO / BLOCKED (client build and provenance only, no files)
Persistent data preserved? YES / NO
Existing backend evidence reused (revision/evidence folder):
Existing security advisories (separate scope): 2026-10-25 npm audit, 7 advisories; no scan performed during gameplay verification

**Never use overall PASS to mean gameplay is verified when only server health, TCP, unit tests or a missing client are known.** A phase must have its own source and concrete evidence.

| Gate | PASS / FAIL / BLOCKED / NOT_TESTED | Concrete evidence (timestamp, ship, event, operator-visible observation) | Next action |
| --- | --- | --- | --- |
| A. Backend (existing evidence, do not rerun without need) | | | |
| B. Effective running overlay, event file path and startup hook | | | |
| C. `living-headless-boot-requested` actual log event | | | |
| D. Native topology/real fleet/named NPC `World` | | | |
| E. Real native NPC movement & cargo/target change | | | |
| F. Actual compatible client login/character selection | | | |
| G. Client undock and in-space scene | | | |
| H. Named native NPC visible in client and matched to server | | | |
| I. Same NPC visible behavior and real combat/loot (when encountered) | | | |
| J. Two different authenticated characters in same grid | | | |
| K. Reciprocal visibility/movement and fleet warp | | | |
| L. Reconnect without duplicate ships or losing persistent state | | | |
| M. Later gated features: inter-system NPC transit / seed-market trade | | | |

## Known results before this run

The 2026-10-25 `cc5ce83` run reported **72/72 local tests, 27/27 upstream contracts, healthy init/server/market, localhost-only published ports, flags PASS, two TCP sockets/reconnect PASS**. Those are **only backend/test results**. Do not copy them to a different SHA as fresh PASS.

The event file `/var/lib/evejs/coop-events.jsonl` was **missing**. That is `BLOCKED_TELEMETRY` until diagnosed with read-only `-Action DiagnoseWorld`. The associated actual gameplay is **NOT VERIFIED**. For native headless boot the initial event should be recorded even with **zero clients**.

## Evidence collected

- `DiagnoseWorld` output:
- `World` report and the exact blocking field:
- `Party` report (if two real characters have actually connected):
- Operator-confirmed client observations/screenshots (redacted, **not** committed):
- Relevant redacted server log excerpt:
- Date/time and real solar system / NPC identity and ship (avoid personal account identifiers):

## Final conclusion

**Overall gameplay status:** PASS / PARTIAL / BLOCKED / FAIL

**Earliest unverified or failed gate:**

**Single actionable next step:**

**What was explicitly NOT proven:**

**Security note:** Known npm audit vulnerabilities are documented as a separate task. No additional npm audit or security scan was run for this gameplay acceptance. Keep the server loopback-only. Do not include credentials, tokens, client assets, private DB or unredacted logs in GitHub.

See `docs/GAMEPLAY_TESTING.md`. No GitHub Actions or remote CI.
