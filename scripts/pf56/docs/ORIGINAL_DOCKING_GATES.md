# PF-56 — ORIGINAL EveJS station docking integration (blocked; default OFF)

**Scope:** personal-fleet source candidate. Nothing in this folder is installed
in `pas7-studio/EveJS` or WORK/PLAY. No GitHub Actions, no main merge.

## Confirmed native source contracts (original fork `coop/pas7std`)

| Original authority | Source pin, Git blob SHA-1 | Actual behavior |
|---|---|---|
| `services/inventory/itemStore.js` | `e992d56ee9cff1911d54247bf46d44d01e5d8060` | `dockShipToLocation(shipID,locationID)` moves the **original** ship item to flag 4 and clears `spaceState`, but does not authorize an NPC controller or preserve/migrate `npcCargo`. |
| `space/npc/npcRuntime.js` | `8ee3d4f82db1600094df8de1060a9aa8e575af1a` | `warpToPoint(shipItemID,point,options)` issues actual NPC warp. Its return is not a persisted arrival proof. |
| `space/npc/nativeNpcService.js` | `ca039daaaad2839d17f7109de2f3834cec0373a8` | `dematerializeNativeController(...)` can leave durable native controller/entity records; **not** proof of complete docking. |
| `space/npc/nativeNpcStore.js` | `95724ab4537683e7ee933bc3149d0a891082ce7e` | **NEVER** call `removeNativeEntityCascade` until every original NPC module and cargo item has had exact original ItemStore custody verified: cascade deletes modules and cargo. |
| `space/coopNativeStationArrival.js` | `308af8e09def7fdba7fd248b3eba65f6054789ea` | Mining/hauling arrival gate; it is **not** a sessionless personal ship docking gate. |
| `space/transitions.js` | `f53a3439fd361294a52f733085f0455c79cc1a7b` | `dockSession(session,stationID)` mutates a real character session and cannot be invoked using a fabricated NPC session. |
| `space/coopGameStoreAtomic.js` | `2b28b48145f3fbc989ce7346384487ee75e52280` | Original `corporationRuntime` + `items` can commit together, but stock `npcRuntimeControllers` is not in this atomic allowlist. |
| `space/coopNpcOrderBridge.js` | `c0f93af3e5a67703a84dc03cab8da29a65afdf3b` | Owner `PERSONAL_FLEET` needs the source-pinned PF55 reciprocal ownership patch and a live original registry binding. |

## PF56 implemented state machine

- `RETURN_ISSUING` durable in `corporationRuntime` before original `npcRuntime.warpToPoint`; no automatic redispatch after SIGKILL or unknown native ACK.
- `RETURNING` only after independently persisted controller Return-order witness (same operation ID, actor generation and station).
- `ARRIVAL_OBSERVED` requires **live** scene entity, controller, canonical station, stopped velocity, no warp, surface gap <= 2500m, with a verifiable native **scene epoch**.
- `DOCK_ISSUING` only after **continuous** native per-tick dwell evidence >= 2000ms in the same scene epoch **and** a full original fitting/cargo/title manifest; durable before external physical dock.
- `DOCKED` only after original `items` root confirms the same `shipItemID` owned by the player at the same station with flag 4 and `spaceState=null`, an independently persisted sessionless dock completion witness proves no live entity/controller (or duplicates), and an original ItemStore/Native cargo witness matches the frozen manifest.
- In **one** original `corporationRuntime` + `items` SQLite commit, release the PF01 active actor claim, mark PF54 original deployment `DOCKED`, release the PF52 global hangar reservation, return the pilot to `CONTRACTED`, append durable processed receipts and mark PF56 `DOCKED`.

## Missing / must exist before any runtime enablement

1. PF52, PF53, PF54 and PF55 **actually installed** in the original EveJS fork, default OFF. All original stock ItemStore, wallet, Mining, WAR, Exploration and NPC controller writers must consult global owner fences, not local mock predicates.
2. `executeNativeReturn`: use original `npcRuntime.warpToPoint` through patched `coopNpcOrderBridge.issue({owner:'PERSONAL_FLEET'})`; persist original Return-order ACK with exact operation identity. A warp ACK itself is not arrival.
3. Source-backed canonical station dock access check, **native continuously updated dwell monitor** (not two snapshots) with restart-specific scene epoch. For an interrupted dwell, reset the 2-second window. Native station authorization must not accept guessed station/corp data.
4. `executeNativeDock`: new explicitly authorized **sessionless** native path. Do **not** spoof a character session or call stock `dockSession(fakeSession,stationID)`.
5. Before NPC entity cleanup, transfer/verify **same original** native module, fitting and cargo item IDs into appropriate original ItemStore custody. Never fabricate new item IDs, accept title transfer based on a checksum alone, or delete cargo on failed transfer. Original native `removeNativeEntityCascade` blindly deletes cargo and modules; not a suitable primitive.
6. No original live NPC controller, scene entity, in-flight warp, duplicate physical ship, unsettled PF55 command, unresolved PF49/50 haul receipt, or reserved WAR/Exploration owner may remain at release.
7. Persist `ORIGINAL_EVEJS_DOCK_COMPLETION_V1` independently in original server authority; callback must reconstruct proof from committed ItemStore + native store/controller states, not trust client JSON or an immediate `success:true`.
8. Proof that original `items` owner, `shipID`, type, fitting, cargo and all nested item IDs survive both crash and normal docking. Test re-undocking and transferring ship ownership after release, in WORK only.
9. Explicit local WORK E2E: owner hires and pays, reserves ship, deploys, orders Return, arrives (dwell), docks, sees identical ship/cargo and can use it. Negative cases: 2-player lease race, lost ship, restart at each intent, fallback owner conflict. No PLAY deployment until signed off.

`createPersonalFleetReturnDock` is *not* a complete stock docking implementation. If any required native proof source is unavailable, it blocks instead of pretending to complete.