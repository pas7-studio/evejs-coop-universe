# PF-57 manual regression evidence — 2026-11-06

- Runner environment: Linux + Node **v22.16.0** (`node:sqlite`), Python 3.13 for the optional PF55 patch builder.
- PF57 own files: `tests/pf57-lifecycle.test.cjs`, `tests/pf57-sqlite-sigkill.test.cjs` — **50 / 50 PASS, 0 FAIL**. Five native Linux Node child-process `SIGKILL` scenarios were executed; the SQLite database uses `PRAGMA synchronous=FULL` and WAL mode in fixtures.
- Full available previous bundle (`personal-fleet-pf46-to-pf56-review-bundle.zip`) PLUS PF57: 20 archived `.test.cjs` files and 2 PF57 `.test.cjs` files, serial Node invocation — **410 / 410 PASS, 0 FAIL**. Reproduced in the current container session.
- PF55 Python patch-builder tests: **6 / 6 PASS**, run directly as Python test script.
- The prior *reported* 428/428 for PF46–56 is **not reproducible from the current supplied bundle**, which contains only 20 archived Node test files, primarily PF49–56. Do not claim 478/478; the reliable current combined reproducible baseline is 410/410.
- All checks are standalone sources with synthetic native API-shaped fixtures. Source-hash Git read of native fork succeeded; modifying the real fork, compiling full server, validating original PF54 item handoff / PF55 controller receipt / PF56 sessionless dock and running two-player WORK E2E have NOT occurred. Native write access previously returned GitHub 403.
- Windows PowerShell runner and actual original server execution are NOT RUN. Windows skips PF57 SIGKILL tests; Linux/WSL is required to repeat that portion.

See `README.md` and `docs/INTEGRATION_GATES.md` for critical payroll-source, item-title, native proof and production rollout constraints.
