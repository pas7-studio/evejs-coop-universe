# PF-50 — native handoff acceptance gates

Status: **SOURCE CANDIDATE / NOT INTEGRATED** — November 5, 2026.

| Gate | Current evidence | Needed before activation |
|---|---|---|
| Source pinned | Original ALIFE10 source inspected, SHA `da3f31e6b87663483b324fc0676c913ac9815f88` | Exact original WORK checkout preflight, `git apply --check` |
| ALIFE10 cargo transactional guard | PF50 `assertHaulWriteAuthorized` candidate and patch | Apply to fork and verify `corpRuntime+npcCargo` writer in actual `coopAtomicNativeRows` |
| All mixed transient cargo | Dedicated `haul-transfer-pf` contract, source candidate | Original mixed-transient integration tests against actual cache + persisted state |
| Native crash-safe begin/finish | Callback slots `beginHaulWrite`/`finishHaulWrite` | Trusted PF44/46 real source, receipt verification and postcommit poison semantics |
| Mining startup/recovery | Not patched | Guard all `coopNativeMiningFleetDurable.js` writes and physical materializations |
| WAR / Exploration writers | PF50 only validates snapshots, does not integrate competitors | Add reciprocal checks in every writer path; authoritative coverage proof |
| PAY/HIRE/ASSIGN/DEPLOY | Not present in authoritative engine | Exact physical ItemStore + original native controller and payroll |
| Orders/RETURN_TO_BASE | Not present in authoritative engine | NPC arbiter/controller dispatch and real sessionless docking/custody adapter |
| WORK / two-player E2E | NOT RUN | Original GameStore restart, kill points, two authenticated clients, live ship/ore/ISK evidence |

### Strong failure semantics

1. PF50 optional flag defaults OFF and missing native callback returns `BLOCKED_OWNERSHIP` before any cargo allocation.
2. A durable `PENDING` permit must be committed ahead of the possible partial cargoID allocation. After SIGKILL, repeated op IDs **must not** attempt another physical transfer.
3. In the same `BEGIN IMMEDIATE`, validate both physical actor IDs, original WAR/PF claim projections, exact PF44 ACTIVE lease and PF46 ACTIVE gate+matching pending permit. `corpora­tionRuntime` is read-only for this transaction.
4. Commit original `npcCargo` root and immutable original ALIFE10 receipt in the same transaction. Unknown outcome -> needs operator repair; do not repair by manufacturing a replacement cargoID.
5. ACK pending permit only after verifying the original miner and hauler cargo records. PF46 release refuses any outstanding permits.

**Do not enable the feature based solely on contract tests.** No original WORK runtime has been modified from this session.