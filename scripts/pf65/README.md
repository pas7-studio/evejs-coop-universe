# PF-65 — Native materialization claim-registry integrity and pilot exclusivity

**Review candidate only. Personal Fleet remains disabled. No patch is installed in the actual EveJS engine fork.**

## P0 corrected

`PF58 OriginalNativePermit.verify()` checked only `actorClaims.claims[shipItemID]` during the first `ISSUING` materialization. An unrelated malformed claim (or a valid claim for **the same NPC pilot on another ship**) could be overlooked and interpreted as an available pilot.

PF65 adds `validateOriginalClaimsIndex` to the existing PF58 native verifier. It checks the *entire original* `corporationRuntime` actor-claims registry, with the same canonical data shapes and count limits as `scripts/lib/personal-fleet-claims.cjs`: version, bounded claims/generations/processed, canonical ship IDs, entity/pilot/owner/system identity, monotonic generations, unique pilotIDs and original receipt integrity. Any malformed unrelated row denies authorization. For the **initial** PF54 ISSUING, the ship and the NPC pilot must both have zero claims. For an **ACTIVE** restart, there must be exactly one claim of this pilot and it must match the same original ship, owner, system, assignment and actor generation. `null` is a proven absent registry and is acceptable only before the first claim; `undefined` is an unknown read and is always denied.

The original ship's `itemID` is never changed, no cloned entity is spawned here, and this module has no transaction writes. No flag is enabled by this patch. PF58's existing original GameStore, original stock item, PF54 deployment, PF58 handoff and global writer-fence checks remain required.

## Tests

```bash
node --test scripts/pf65/tests/*.test.cjs
```

19 tests: 16 strict claims/permit tests and 3 original-shaped on-disk SQLite WAL/FULL readback tests (the latter close and reopen the DB). **19/19 PASS on Node 22.16.0.** These are isolated tests, NOT the original EveJS native bootstrap or two-client WORK gameplay.

From the synchronized PR checkout, `scripts/pf65/Test-PF65-Local.ps1` runs all PF65 tests with Node >=22. Run prior PF58–64 suites separately before any engine integration. PF62's 18-file review bundle automatically includes the updated PF58 verifier in the staged 16 modules; no additional native source patch is introduced.

## Mandatory integration gates

- A real ``pas7-studio/EveJS`` WORK fork commit with source-pinned single native review patch and trusted server-only bootstrap authorities (previous GitHub connector branch write attempt returned 403).
- Confirm original GameStore transaction read semantics (`null` verified absent vs `undefined` uncertainty), and actual PF actor claim registry shape against current original writer on WORK.
- Fence all competing original NPC/market/War/Mining/Exploration/ItemStore writers; verify unique ship+pilot claims across two independent clients.
- Real player hire, stock hull/fittings/ammo, orders, docking/loss, payroll and two-client WORK crash recovery with no clone/ISK duplication. PLAY and main remain unchanged.
