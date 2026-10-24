# Verification report template

**For initial installation and backend readiness ONLY.** For the current
operator request to test gameplay, use
[GAMEPLAY_TEST_REPORT_TEMPLATE](GAMEPLAY_TEST_REPORT_TEMPLATE.md), which
requires physical NPC evidence, client observations and independent
PASS/BLOCKED statuses. Do not infer gameplay success from this template.


Date/time and timezone:
Operator and OS:
Docker version and engine mode:
EveJS source repo + SHA:
X-Eve source repo + SHA (if used):
Compatible client build available with required authorization? YES/NO/UNKNOWN:
Patch archive SHA matched? YES/NO/NOT_ATTEMPTED:

| Step | Result PASS/FAIL/BLOCKED/NOT_TESTED | Evidence or error | Next task |
| --- | --- | --- | --- |
| Preflight dependencies | NOT_TESTED | | COOP-001 |
| Docker image build | NOT_TESTED | | COOP-002 |
| Market seed | NOT_TESTED | | COOP-002 |
| Server health | NOT_TESTED | | COOP-002 |
| Data persistence across restart | NOT_TESTED | | COOP-002 |
| Authorized client login | NOT_TESTED | | COOP-004 |
| Undock/warp/dock | NOT_TESTED | | COOP-020 |
| X-Eve clean install / verify | NOT_TESTED | | COOP-003 |
| NPC behavior evidence | NOT_TESTED | | COOP-021 |
| Isolated VPN echo test | NOT_TESTED | | COOP-011 |
| Remote game co-op | BLOCKED | Requires permission, security audit, and implementation | COOP-012–014 |

Security checklist: no secrets in logs; localhost binds only; admin/market/db unavailable from network; no proprietary assets committed.

Notes and reproduction steps:
