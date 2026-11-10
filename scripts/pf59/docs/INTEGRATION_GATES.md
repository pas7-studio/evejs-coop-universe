# PF59 native removal protection — remaining P0 gates

| Critical requirement | State |
| --- | --- |
| Find original generic NPC cleanup path | Verified from `pas7-studio/EveJS` branch `coop/pas7std` source |
| Guard service destroy and dematerialize | Source-pinned patch candidate; NOT installed |
| Guard native store cascade and direct entity/controller deletion | Source-pinned patch candidate; NOT installed |
| Check marker and durable original PF58 ship lock | Pure code + mocked original GameStore transaction tested |
| Native bootstrap authority from actual original GameStore | NOT installed; no real runtime evidence |
| PF56 verified docking, PF57 confirmed loss to terminal cleanup permit | NOT implemented; PF cleanup forbidden |
| Original inventory/market/Mining/Exploration/WAR writer fencing | NOT complete |
| Modified/native source compile + full fork integration | NOT RUN (EveJS GitHub write API 403) |
| WORK crash/restore with real ItemStore + NPC persistence | NOT RUN |
| EVE client / two-client shared WORK gameplay | NOT RUN |

**Do not treat `removeNativeEntityCascade` as original ItemStore destruction.** Its NPC-module/controller/entity cleanup is separate from ItemStore ship title. The risk is erasing the native identity while original stock ship or its custody is unresolved. PF59 prohibits that generic route until verified terminal settlement exists.

Security invariants: marked original player ships cannot be cleaned by ordinary NPC destructor; orphan PF lock remains protected even with no native rows (if original read authority installed); unknown lock state fails closed; with flag OFF stock NPC cleanup remains unchanged only when there is no PF marker; no auto-release after timeout or process restart.

**Known gaps:** Other direct native mutation calls (`removeNativeModule`, `removeNativeCargo`, `upsertNativeEntity`, scene-only destroy and source-specific combat death paths) still require reciprocal integration review. No automated GitHub Actions, no main merge, no PLAY changes.
