# PF57 native code review / WORK acceptance

## Source pins from `pas7-studio/EveJS` branch `coop/pas7std`

| Native source | Git blob SHA-1 |
| --- | --- |
| `Code/server/src/space/coopGameStoreAtomic.js` | `2b28b48145f3fbc989ce7346384487ee75e52280` |
| `Code/server/src/services/inventory/itemStore.js` | `e992d56ee9cff1911d54247bf46d44d01e5d8060` |
| `Code/server/src/services/account/walletState.js` | `ef4799d896ce8dbb854e75b810057b1208932e13` |
| `Code/server/src/space/npc/nativeNpcWreckService.js` | `600568093f1e356e2b032395fda4e5d9bb7a0a36` |
| `Code/server/src/space/npc/nativeNpcStore.js` | `95724ab4537683e7ee933bc3149d0a891082ce7e` |
| `Code/server/src/space/coopPilotPayroll.js` | `2b7d335779bec961db4d48dfd73a3f534472e98a` |
| `Code/server/src/space/coopWarLossReconcile.js` | `75b865f2dea39e460c4b3a24b1a069328e264588` |

## Required live evidence

- Payment: one unmodified original player character balance, one original corporation division balance, exactly one matching salary transaction ID in the character wallet journal and two employer entries, exactly one operation reservation and sequential due period. Replay must never debit twice, including post-COMMIT SIGKILL and notification failure.
- Release: no PF52 ship reservation, no PF01 actor claim, no outstanding PF54/55/56 unknown external operation, no active combat/warp, and employer confirms original pilot is free with no salary arrears. A dismissed pilot is not deleted from original NPC authority.
- Loss: original wreck's `sourceEntityID` equals destroyed *original player ship* `itemID`; exact original stock ship row no longer exists; original entity, cargo and modules for this ship are no longer active; a durable killmail/death proof and original cargo/module item-title settlement prove no loss or duplication. `DOCK_ISSUING` must be independently settled before loss reconciliation.
- Cross-writer: original market, player ship undock/dock/destroy, War, Exploration, Mining, walletState, payroll, native controller persistence and spawn must all use reciprocal ownership checks. The original `npcRuntimeControllers` cache is outside `coopGameStoreAtomic` allowlist, so callback proof must have a separate native authority and persistently fenced claim.
- End-to-end: on WORK, two independent player sessions hire/assign/command/pay/dock a fleet, force restart mid-operation, then separately test real ship loss, NPC dismissal and rehire; compare before/after original ItemStore + wallets + wrecks. PLAY is explicitly excluded.

## Rollout

Feature OFF until native write access and source-hash preflight. Apply no patch automatically. An original-native PR needs security review and CI first, then manual WORK, then a separately approved PLAY rollout. Any uncertain COMMIT or native outcome remains operator-repair-only, with no automatic compensation.
