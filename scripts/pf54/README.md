# PF-54: Original Personal Fleet Ship Deployment (review candidate)

**Status: source candidate / DEFAULT OFF / NOT GAMEPLAY READY.**

PF54 is the next integration seam after the PF53 real-ISK hire and PF52 original
player-owned hangar reservation. It writes one durable single-flight intent into
original `corporationRuntime`, calls **one** injected original native handoff
executor after the intent commits, and independently reconciles original
`items`/ship entity/controller evidence before adding the real PF01 actor claim.

It does **not** spawn a ship, create a controller, mint an item or install a new
ownership database. The test fixture uses synthetic original API-shaped scene
and SQLite rows; that is not the EveJS runtime.

## Verified original native API observations

- `Code/server/src/services/inventory/itemStore.js`: items root, hangar flag 4,
  space flag 0, category 6; original itemID and `spaceState.systemID`.
- `Code/server/src/space/npc/nativeNpcService.js`: the ordinary NPC spawn path
  calls `nativeNpcStore.allocateEntityID()` and thus is **not** a safe way to
  deploy the player's original ship. Its materializer calls
  `runtime.spawnDynamicShip()` and requires stored native entity/controller.
- `Code/server/src/space/coopNpcOrderArbiter.js`: PERSONAL_FLEET owner is not
  yet integrated. Do not issue gameplay commands using an unrecognized owner.
- `Code/server/src/space/coopGameStoreAtomic.js`: permitted transaction tables
  include `items`, `corporationRuntime`, but not `npcRuntimeControllers`, so a
  one-step ItemStore + NPC-controller atomic commit is **not currently possible**
  with the reviewed native API. The two-phase sticky ISSUING fence is necessary.

## State diagram

```
PF53 PAID -> PF52 HANGAR_RESERVED
              |
              v
PF54 PREPARED -- durable commit before native attempt --> ISSUING
                                                         |
                          independent original item+entity+controller proof
                                                         |
                                                         v
                                                        ACTIVE
```

- `prepare`: reads original PF52 reservation and original ship item under a
  `corporationRuntime + items` transaction, verifies global WAR/PF claims,
  original NPC capabilities, and captures native fitting/cargo hashes.
- `dispatch`: verifies original item still in station and equipment unchanged,
  commits `ISSUING` with `dispatchCount=1`, then invokes the authorized native
  executor once. `ISSUING` survives crashes and is **never automatically retried**.
- `reconcile`: independently verifies the original item moved in-space **under
  the same itemID**, original scene entity/controller use that same ID and
  immutable cargo/fitting attestations, then atomically writes a single PF01
  actor claim plus an ACTIVE deployment receipt. No synthesized evidence.
- `inspect`: read-only status (does not perform recovery or spawn).

## Local verification

From this directory:

```powershell
node --test tests/pf54-deploy.test.cjs tests/pf54-sigkill.test.cjs
```

Or run `Test-PF54-Local.ps1` to check the SHA256 manifest and optionally rerun
all tests. Run on a disposable WORK/WSL checkout; NEVER PLAY.

Local Node 22.16.0 result: **48/48 PASS** (43 functional + 5 actual child-process
SIGKILL). Combined PF46-54 manual local source/SQLite regression:
**325/325 PASS**, zero failed. This is **not** an engine gameplay E2E.

## Unresolved gates

`docs/NATIVE_HANDOFF_GATES.md` lists the exact native integration prerequisites.
In particular, PF54 has **no live EveJS `executeOriginalHandoff` binding** and
cannot be enabled safely on WORK until native ItemStore writers, controllers,
scene lifetime, and PF42/PF44/PF46 ownership rules are verified.

PR #350 remains Draft; `pas7-studio/EveJS` fork GitHub writes returned 403.
No merge, deployment, PLAY changes, CI or enabling flags.