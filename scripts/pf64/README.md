# PF-64 — durable native cleanup attempt and fail-closed bootstrap

**Review candidate only. Personal Fleet remains OFF. No EveJS native fork patch, no WORK E2E, no PLAY change.**

## Findings fixed

1. PF61's in-memory `Set` was not durable. Restarting the Node process erased the only executor-level attempt marker while PF60 remained `ISSUING`. The new PF61 executor commits `coop-personal-fleet\u001fterminal-native-attempt-v1:<assignmentID>` to the ORIGINAL `corporationRuntime` before calling the scoped native store. This is a real original-shaped `coopAtomicNativeRows([corporationRuntime])` transaction; a different process refuses the same attempt after success, failure or crash. Unknown write outcome fails closed and is not retried.
2. PF61 native store's private authorization callback now requires a matching immutable `CONSUMED` attempt receipt as well as the original PF60/PF58 witnesses. A private Symbol without the committed attempt is not sufficient. Any unknown, malformed or foreign receipt refuses cleanup.
3. PF58 `createNativeBootstrap` previously installed process-global native bindings **before** validating the `adoption` and `handoff` constructors. PF64 moves the singleton install to the end of construction, and rejects an unconfirmed install. A failed constructor leaves no exposed native bindings.

All row writes are object-valued; no `tx.put(...,null)` is used. Neither code path deletes an original ItemStore ship, spawns a synthetic NPC, transfers ISK, auto-retries an ambiguous native write or unlocks PF59 generic cleanup. PF60 independent physical reconciliation is still mandatory.

## Tests

```bash
node --test --test-concurrency=1 \
  scripts/pf59/tests/pf59-removal.test.cjs \
  scripts/pf60/tests/pf60-terminal.test.cjs \
  scripts/pf60/tests/pf60-sigkill.test.cjs \
  scripts/pf61/tests/pf61-scoped-cleanup.test.cjs \
  scripts/pf61/tests/pf64-sigkill.test.cjs \
  scripts/pf64/tests/pf64-bootstrap.test.cjs
python3 -m unittest discover -s scripts/pf61/tests -p 'test_*.py' -v
python3 -m unittest discover -s scripts/pf62/tests -p 'test_*.py' -v
```

Windows (without SIGKILL): `scripts/pf64/Test-PF64-Local.ps1`. The two new SIGKILL checks run only on Linux/WSL and target a real on-disk SQLite WAL/FULL DB. They kill a child after durable attempt commit / during a simulated native write, then reopen the same DB in a fresh process and demonstrate no second native write.

Local 2026-11-06: PF59/60/61/64 **71/71 Node PASS**, including 8 SIGKILL tests (6 previous PF60 + 2 PF64), PF62/63 Python **13/13 PASS**, PF61 patch Python **5/5 PASS**. PF58 bootstrap tests use isolated constructor/`require` stubs, not the real native server. Native fork installation, actual ItemStore/scene cleanup, authenticated clients and WORK E2E are **NOT RUN**.

## Remaining release gates

- GitHub connector still cannot create a branch in `pas7-studio/EveJS` (`403 Resource not accessible by integration`). The updated PF58/PF61 source must be included by the PF62/63 single 18-file review patch on an owner-controlled clean WORK checkout.
- Only the PF60 one-shot executor may call PF61 `execute`. Do not expose it via HTTP/WS/socket/retry queue or a startup reconciler. A durable PF64 attempt receipt is **permanent**; it is never auto-cleared or re-issued after loss.
- Reciprocal stock ownership/writer fencing, real player session/contract, stock fitting/ammunition/warp/combat/dock/wreck and real two-client WORK crash E2E remain outstanding. Do not enable flags or merge this PR as gameplay-ready.
