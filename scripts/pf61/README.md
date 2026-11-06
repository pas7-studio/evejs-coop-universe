# PF61 — Scoped Original Native Controller Cleanup (review-only)

**Personal Fleet is OFF. No fork patch applied, no WORK gameplay verified.**

PF59 correctly forbids generic NPC cleanup for the player's original ship. PF60 provides a durable, single-shot `ISSUING` intent for terminal custody, but requires a trusted scoped removal of only its native NPC controller/entity. PF61 is a source-pinned native-store patch candidate plus a capability-bound server-only executor to implement this missing narrow endpoint.

- `native/coopPersonalFleetScopedNativeCleanup.cjs`: consumes PF60's committed ISSUING record and immutable signature, PF58 original ship lock, terminal witness, independent scene absence, exclusive original writers, and an opaque per-process Symbol capability. It consumes its local attempt BEFORE the native call; failures/unknown results never retry.
- `build_native_scoped_cleanup_patch.py`: exact Git blob pinned nativeStore patch on original fork source (`95724ab4537683e7ee933bc3149d0a891082ce7e`), outputs **review diff only**, no source mutation. Adds `installScopedOriginalTerminalCleanupAuthority` and a dedicated `removeScopedPersonalFleetTerminalNativeRows` original-store method. NativeStore checks opaque capability, real PF60 authority and native entity/controller tags; refuses stock cargo/modules; uses private low-level removes rather than PF59-blocked generic functions.
- Controller/entity are **NOT in one original GameStore transaction**: `npcRuntimeControllers` is absent from `coopGameStoreAtomic`'s allowlist. A crash between two removals is `OUTCOME_UNKNOWN` and requires original readback/operator repair, never automatic duplicate cleanup. Do not hide this as atomic.
- Requires native fork placement and explicit bootstrap installation, genuine original scene/wreck/ItemStore authority, complete reciprocal writer fences, and PF58/59/60 patch composition before enabling. Neither the command nor the capability may be exposed to players or RPC routes.

The unmodified original `nativeNpcStore.js` and PF59 patch touch the **same** file; never apply both diff candidates blindly. Compose and review a single patch against the actual fork branch, then commit directly in `pas7-studio/EveJS`. The GitHub installation still returns 403 to this integration. No engine/WORK/PLAY runtime has been changed.

## Local-only checks

```bash
node --test scripts/pf61/tests/pf61-scoped-cleanup.test.cjs
python3 -m unittest discover -s scripts/pf61/tests -p 'test_*.py' -v
```

2026-11-06 isolated Node 22.16.0: **12/12 PASS**. Python 3.13: **5/5 PASS** including synthetic `git apply --check`. Real fork native compile, physical ItemStore/scene, post-SIGKILL native controller rows, client and two-player E2E are NOT RUN. See `docs/INTEGRATION_GATES.md`.
