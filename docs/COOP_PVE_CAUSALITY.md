# COOP-PVE-CAUSALITY-001 — real co-op PvE encounter correlation

**Status:** read-only code + local tests. No live gameplay result has been asserted.

This tool is deliberately narrower than PR #3's five reliability gates: it tries to prove a **single coherent native PvE story** involving the same pirate, real native wreck, stored items and independently witnessed item transfers to both members of one authenticated-looking, server-side duo. It does not certify any EVE-client rendering, co-op kill credit, combat contribution, actual fleet status or mission reward.

## Why this is needed

A healthy World gate, Party gate, physical wreck elsewhere in the system, and item transfer from an unrelated wreck could otherwise look like a successful PvE loop. Correlation matters. The report only connects genuine `coopRuntimeProbe` JSONL emitted by existing code in the current boot:

1. `living-headless-boot-requested` (boot boundary) followed by a fresh `coop-shared-scene` whose **two different character IDs and ship IDs** both have `shipExists: true` and `mutualVisibility: true`.
2. A **successful real NPC attack order** in `living-pirate-raid` on a physical ore hauler/miner; `warp-to-hauler` alone is not enough.
3. `living-native-wreck-evidence` with `status: PHYSICAL_NATIVE_WRECK_VERIFIED`, with physical pirate `victimEntityID` matching the raid's attacker ID and a positive real `wreckID` with persisted stored items. This is native destruction, **not** automatically a player kill.
4. `living-native-loot-pickup` with `status: VERIFIED_NATIVE_LOOT_PICKUP`, the **same wreck ID and pirate source entity**, after the wreck event, matching a currently connected, physical duo member and the member's observed ship ID. The upstream witness requires both native destination grant and real source-store debit. The second member must have a **separate verified transfer** from that same wreck.
5. Fail closed on malformed logs, stale/old-boot events, wrong systems, changed player ship, stale shared-scene proof, disconnects without a renewed scene, wrong pirate/wreck, unverified item grant or out-of-order events. No synthetic activity or server mutation.

## Run, with an owner-approved deployed overlay

From the co-op repo root in PowerShell, using the **running** existing Docker server and the verified Compose files:

```powershell
$code = 'C:\Games\EveCoop\upstream-evejs\Code'
$compose = @('--project-directory', $code, '-f', (Join-Path $code 'compose.yaml'))
$overlay = Join-Path $code 'compose.coop-probe.yaml'
if (Test-Path -LiteralPath $overlay) { $compose += @('-f', $overlay) }
# Read-only. Do not write, synthesize or commit player event logs.
docker compose @compose exec -T server cat /var/lib/evejs/coop-events.jsonl | node .\scripts\coop-pve-chain.cjs --window-minutes 120
```

Before the tool, **first run** `Local-Two-Client-Test.ps1 -Action DiagnoseWorld` and establish a genuine server boot and physical World activity. No missing file should trigger an automatic rebuild/redeploy; retain `evejs-data` and the owner's local source changes. Avoid printing full raw logs to chat or committing evidence containing character identifiers.

Local deterministic unit tests (no Docker or client needed):

```powershell
node --check .\scripts\coop-pve-chain.cjs
node --test .\tests\coop-pve-chain.test.mjs
```

## Possible statuses — not gameplay PASS

| Status | What it actually means |
| --- | --- |
| `BLOCKED_TELEMETRY` | No current native headless boot events were available |
| `TWO_PILOTS_NOT_EVIDENCED` | No fresh physical 2-pilot reciprocal scene |
| `NATIVE_RAID_NOT_EVIDENCED` | No genuine native pirate attack order after that scene |
| `LINKED_WRECK_NOT_EVIDENCED` | No matching physical pirate wreck with stored items |
| `PHYSICAL_RAID_WRECK_OBSERVED` | Raid and wreck correlated; no real looter accepted yet |
| `ONE_PILOT_NATIVE_LOOT_OBSERVED` | Only one actual member has verified native source-debited loot |
| `BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK` | Two distinct members received real native loot from one matching pirate wreck, **not proof both fought** |
| `INVALID_EVENT_STREAM` | Malformed telemetry; reject positive conclusions |

`gameplayVerified`, `combatParticipationVerified`, `missionProgressVerified` and `clientRenderingVerified` are **always false**, intentionally. The broader real gameplay gate still requires separately confirmed player combat actions, fleet, shared native mission objective, safe payout, reconnect and actual client behavior. This report correlates events but does not patch/instrument missing player combat evidence in upstream EveJS.

### P0 acceptance scenario (manual)

With both permitted clients in Perimeter, observe an actual NPC mining convoy and an organic pirate approaching it. Verify a real in-space pirate attack and, only if that same pirate eventually dies, its native wreck. Both players interact with the same wreck and separately take actual stored items. Capture fresh server JSONL with matching revision/image and observe the status progress from raid to wreck to two verified native looters. Then record **separate** actual fleet, damage, mission reward and restart behavior; without these, co-op gameplay is still partial.

**Operational boundaries:** No new client, spawn, map marker, combat mechanic, loot grant, ISK credit, network exposure or event producer. No GitHub CI. No merge, deploy, container restart or volume modifications. Keep this report in its own PR; it does not alter PR #2's features, PR #3's global reliability gates or PR #4's player-facing intel.