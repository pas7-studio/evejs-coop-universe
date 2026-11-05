# PF-51 source and integration gates

| Gate | Status | Required evidence |
| --- | --- | --- |
| Native original source | Inspected Git blob `2162c82ccdc358b47ef622308de26b7345eeaf43` | Run `git apply --check` against exact unmodified WORK fork |
| Inert source candidate | Implemented | 42/42 local unit/SQLite/SIGKILL/patch fixture tests |
| Original PF44 startup lease | **NOT WIRED** | Same SQLite transaction read; original lease STARTING/ACTIVE token ownership |
| PF46 shutdown/writers | **NOT WIRED** | Full writer coverage; no PENDING cargo permits; verified lifecycle transitions |
| PF45 original native quiescence | **NOT WIRED** | All system slots, unloaded controllers and in-flight manifests; no synthetic empty witness |
| Native startup `start(args)` | **BLOCKED by design** | Trusted internal startupFence binding in EveJS, not public args |
| Native original GameStore crash | **NOT RUN** | Kill WORK process at PREPARING/native create/registration/restore, verify identical original actor IDs |
| Repeat boot handover | **NOT IMPLEMENTED** | Durable old-epoch retirement and independent original native audit (no TTL) |
| Player-facing hire/assign/commands | **NOT IMPLEMENTED in fork** | Physical ItemStore/wallet/scene, real UI and multi-client E2E |

No automatic enablement, no CI, no changes to PLAY. This module cannot close the overall Personal Fleet feature by itself.