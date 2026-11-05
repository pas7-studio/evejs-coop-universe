# PF-52 authoritative source and integration checklist

## Source evidence (Git blob SHA-1, not raw file SHA-256)

Source branch `pas7-studio/EveJS@coop/pas7std` inspected on 2026-11-05:

| Original module | Git blob ID |
| --- | --- |
| `Code/server/src/space/coopGameStoreAtomic.js` | `2b28b48145f3fbc989ce7346384487ee75e52280` |
| `Code/server/src/services/inventory/itemStore.js` | `e992d56ee9cff1911d54247bf46d44d01e5d8060` |
| `Code/server/src/space/coopWarFleetRegistry.js` | `d8bce76a9d033bf9c33e22b8b9d26852a23c92ed` |
| `Code/server/src/space/coopNpcOrderBridge.js` | `c0f93af3e5a67703a84dc03cab8da29a65afdf3b` |

Original `coopGameStoreAtomic` allowlist includes both `items` and `corporationRuntime`; it obtains `BEGIN IMMEDIATE` with `synchronous=FULL` and invalidates original ItemStore caches after touched `items` transactions. `itemStore.js` defines stock `SHIP_CATEGORY_ID=6`, `ITEM_FLAGS.HANGAR=4`, stores item records in the canonical `items` table; it is the only authoritative item writer. **These observations do not prove the candidate has been installed or that its callbacks are safe.**

## Rejection gates before feature can be enabled

- Prove complete same-process source of original `verifyPaidHire` for personal (not corporation-shift) wage/agent/wallet receipt; no mock callback may be enabled.
- Verify every original ItemStore owner/ship activity writer rejects a PF-52 reservation until proper item custody transfer. This includes sale, repair, dock/un-dock, contracts, direct move, trade, ship switching, repackage, insurance, remote services and old session flows.
- Ensure WAR `coopWarFleetRegistry.validate`, PF01 actor-claims validator and all Mining/Exploration lease writers are wired, not merely present. `checkCompetingClaims` directly inspects basic fields but does not substitute for full native validator.
- Preserve PF-02 roster as the single eventual authoritative roster or perform an explicit, audited one-time migration to PF-52; never simultaneously let two registries assign a pilot or hull.
- On actual deployment: reserve stock ItemStore hull, reserve existing persistent hired NPC, atomically bind new/identical native actor and `PF01` claim; never duplicate a hull ItemStore row, never spawn without a confirmed native reservation, do not reuse a stale generation.
- On RETURN/DOCK: physically navigate the original entity, witness original station arrival, atomically restore original ItemStore title/hangar, then release PF-52 reservation and PF01 actor claim with generation CAS.
- On crash: leave pending/unknown ship reservation inaccessible until independent authoritative native inventory/entity/controller/cargo reconciliation; do not apply TTL or stale-cache guesswork.
- Run syntax, source pins, local tests and multi-process kill/SQLite on WORK; then two-player live WORK E2E with ISK balance, ItemStore inventory, original itemID, fitting, operator, mining/hauling and docking; keep PLAY unchanged.

**Not a native applied patch.** Only the portable adapter and tests exist; original engine source has not been modified, and original source pin may drift after subsequent work.