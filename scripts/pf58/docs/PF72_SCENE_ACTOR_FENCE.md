# PF-72 — existing physical actor ownership fence

**Status: source-pinned review patch only. Feature OFF. No WORK/PLAY install.**

## Defect

In the original EveJS `Code/server/src/space/npc/nativeNpcService.js`,
`materializeNativeRuntimeEntity()` first calls `scene.getEntityByID(entityID)`.
If it finds **any** actor with that numeric ID, the original code registers a
native controller and rewrites its NPC presentation without verifying that the
preexisting actor is the same NPC or even an NPC. PF-71 validates the two
persisted original native records and the GameStore permit but cannot by itself
prove ownership of an independently populated in-memory physical scene actor.

This opens a cross-writer gap: a stale original PF permit + valid native pair
could accidentally rebind a player ship or another director's scene actor if
that actor occupies the original item ID.

## Change

The source-pinned PF58 transform now adds
`pf58OriginalExistingSceneActorValid(actor, entityRecord)` and an admission
fence **after the read-only existing-actor lookup, before `registerNativeRuntimeController`,
`applyNativeRuntimeNpcPresentation`, and any scene side effects**.

For a PF-tagged original, any existing physical actor must have all of:
- exact `itemID`, `kind:'ship'`, `nativeNpc:true`, `nativeNpcOccupied:true`;
- `npcEntityType:'personalFleet'`, `operatorKind:'PERSONAL_FLEET'`,
  `selectionKind:'PERSONAL_FLEET'`, exact assignment `selectionID`;
- original `ownerID`, zero character/pilot character IDs and no attached session.

If any check fails, the materializer denies with
`PF72_FOREIGN_EXISTING_SCENE_ACTOR` **before native controller registration**.
The previous PF69/PF71 GameStore and persisted-pair checks still run first.
Ordinary unmarked NPCs retain their existing behavior. Fresh original actors
with no existing scene entity remain subject to PF71's durable permit and
stock ItemStore checks; no session hijacking bypass is introduced.

## Isolated tests

- `test_pf72_existing_actor_identity.py`: 3 Python tests including 17 genuine
  Node VM scenarios of the transformed low-level materializer (same-ID foreign
  owner, session, type, assignment, original flags, and legal original actor).
- Source drift, duplicate injection and behavior of ordinary native NPCs
  covered. Prior PF58/69/71 source-patch tests and real SQLite PF66/67 tests
  should be rerun before WORK installation.

## Remaining verification

The full 19-file PF62 native review patch must be generated against a local
checkout of `pas7-studio/EveJS` at its exact stock pins, applied only by PF68
into a separate WORK Git worktree, compiled, and validated in two authenticated
clients. The original game engine, reciprocal writers and PF70 full adoption
contract were **not executed** in this isolated environment.

No GitHub engine-fork commits or feature activation. Keep PR #350 Draft.
