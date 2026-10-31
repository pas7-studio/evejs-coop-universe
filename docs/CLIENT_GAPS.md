# What the client can ask for that we do not implement

Generated from the pinned client's own bytecode, not from guesswork: `docs/client-contracts/gateway-types.json`
holds every `eve_public.*Request` string the client (V24.01, compiled 2026-06-16) can send —
**216** of them. The local gateway names **254** types (gateway services plus the inline handlers,
including `user.license.api.Get` and `plex.vault.api.Balance`), and **14** of the client's own types
still get only the default empty answer.

They are not fatal any more: since fork `f256261` an unknown `eve_public.*Request` is answered with
a default-encoded empty message and a warning that names the type, so the client gets a valid
"no data" answer instead of a 404 it cannot decode. What that means in game is that the surface
opens and shows nothing (or zeros) — it does not throw.

## Scanning surfaces are empty in OUR systems, not everywhere

First measurement said "nothing spawns a site"; that was an artefact of probing from a separate process,
where the signature providers have no scene. Measured against the persisted dungeon runtime instead:
**27 dungeon instances are active across 16 systems** (combat anomalies 5610/5684/5687/13338, ice
5497/5500, landmark statics), seeded by `dungeonUniverseRuntime`, whose
`dungeonAuthority.listUniverseSpawnFamilies()` reports 23 enabled persistent families with
highsec/lowsec/nullsec/wormhole bands.

Jita (30000142), Perimeter (30000144) and New Caldari (30000145) have **zero** instances. That is why the
probe scanner, the combat/exploration anomaly lists and the Agency tabs are empty for the owner: the
allocation landed on other systems.

The fix is a seeding scope, not new plumbing: include the systems this world uses (or seed a system when
its desired-definition count is zero and its scene wakes), then
`dungeonUniverseSiteService.handleSceneCreated` materialises the instances and the existing providers
deliver them.

## The 44 RemoteSvc placeholders, classified

`node scripts/coop-placeholder-audit.cjs` reads the pinned server source and groups the placeholders
from `docs/client-contracts/baseline.json` by what they actually return, because that decides what a
client sees: a getter that returns `null` where the view guards for it ("no event", "no pending
something") is correct, while an *action* that returns `null` silently does nothing.

Current split: 31 return `null`, 8 return data from an audit log, 4 return an empty list, 1 returns a
scalar.

Correct by contract, deliberately left alone:
- `pingService.Ping` - the client's idle keepalive (`connectionService.PingLoop`); nothing to return;
- `pvpFilamentMgr.GetMostRecentEvent` / `GetNextEventDate` - the event window checks
  `self._event_info is not None` and shows "no event" for `null`; this world runs no filament events;
- `milestoneMgr.ProcessCharacterLogon` - a logon push the client tolerates as empty;
- `charMgr.GetCohortsForCharacter`, `browserLockdownSvc.GetFlaggedSitesList`,
  `bountyProxy.GMClearBountyCache` - honest empty results (no cohorts, no blocked sites, no cache);
- `node_graph.*`, `keeper.GetLevelEditor`, `publicQaToolsServer.*`,
  `localizationServer.UpdateLocalizationQAWrap`, `clientStatLogger.LogString`,
  `eventLog.LogPlayerRequestedDisconnect` - QA/dev surfaces, not gameplay.

Genuinely unfinished (the call does nothing when a player uses it):
- `survey.PerformSurveyChecks` / `ClaimSurveyRewards`, `milestoneMgr.ClaimRewards`,
  `operationsManager.process_client_event`, `pvpFilamentMgr.GetLeaderboard` / `LeavePVPQueue` -
  features whose backing data this world has never produced (surveys, milestones, client event
  telemetry, PVP queues);
- `bountyProxy.GMReimburseBounties` - GM tooling, not gameplay.

Re-checked 2026-10-31 against the fork - these were listed here as unfinished and now **do** work
(they answer `null` after doing the work, which is why the placeholder audit keeps flagging them):
- `petitioner.*` - durable petition store, categories/queue/create/list/message/close/cancel/delete/
  claim/escalate/rate (fork `6e48b58`, `a61a4fa`; live create/rate/delete measured);
- `structureDeployment.RenameStructure` / `Unanchor` / `CancelUnanchor` - `sovPlayerDeployment` +
  `structureState` unanchor and cancel paths;
- `industryMonitor.DisconnectJob` - fork `5955015`: the monitor row now stores `characterID`, only the
  owner may detach it (`MONITOR_NOT_OWNED`), a vanished id answers `MONITOR_NOT_FOUND`, and
  re-connecting the same blueprint reuses the row instead of leaking an id per refresh;
- `charUnboundMgr.CancelCharacterDeletePrepare` - `characterDeletionRuntime.cancelCharacterDeletePrepare`
  clears `deletePrepareDateTime` for the owner's offline character;
- `crateService.ClaimFitting` / `ClaimLoot` / `ClaimSkillBundle`,
  `overviewPresetMgr.StoreLinkAndGetID` / `GetStoredPreset` - implemented; the industry **window** is
  functional but empty because the character owns no blueprints (content, not code).

`sessionRegistry.register` now stamps `evejsRegisteredAtMs`, so `userSvc.GetSessionPlaytimeMinutes`
answers the real minutes of the current session instead of the constant 0 it used to return.

## Gateway coverage is measured, not remembered

`scripts/coop-gateway-gap-audit.py` compares the request messages in the client's own generated
descriptors (kept only when a non-generated client module names both the proto module and the
request class - that is what an import plus a call looks like) with the types the running server
answers. This audit reads a wider set than `docs/client-contracts/gateway-types.json` (it takes every
request message in every generated descriptor): on `evejs-agents` it finds 1282 client request
messages, of which **213** are really sent, **287** are answered, and **10** are sent but
unanswered. The derived list is `docs/client-contracts/gateway-coverage.json`.

`scripts/coop-verify-client-proto.cjs` decodes bytes we produced with CCP's own FileDescriptorProto,
so a wrong field number cannot pass by agreeing with our own reader. Both new answer sets were
checked that way, and both were proven live on `evejs-agents`:

- `stargate.lock.api.GetRestrictedSystems` / `Get` (fork `ff09ec8`) - a real admin Apply made the
  system appear in the public list and a Delete removed it; `Get` answers the character's own
  system from the live session and answers 404 with a reason when the system is unknown, has no
  lock, or has several locked gates (the response carries one gate);
- `cosmetic.ship.api.Get` / `GetAllInBubble` (fork `ff09ec8`) - a real ship of character 140000004
  got a licence, was activated and was given skin `c0c0ffee12345678`; the gateway's 43 bytes decode
  through CCP's descriptor to that character, that ship and that hex; after unapply+revoke -> 404.
  The bubble comes from `space/runtime.getSceneForSession`, so it lists only ships really in the
  character's scene;
- `achievement.api.admin.ResetAll` (fork `6133d3e`) - clears one character's rows and unclaimed list
  in one write.

Still open (0): every request type the installed client's code really sends now has an explicit
answer (`CONSUMED_NOT_ANSWERED 0`). The last six were closed on 2026-10-31 (fork `8c2213a`), after
the audit was pointed at the *deployed* registry instead of a source scan - three types that looked
open (`achievement.definition...GetLatest`, `user.license..Get`, both listed above as "not ours")
had been answered all along through template-literal type lists a string scan cannot see.

How each of the last six answers, and why it is the truth:

| call | answer | why |
| --- | --- | --- |
| `sequencing.api.GetTierPricing` | 0 PLEX per tier | a sequencing job is paid in component licences, spent by `Initiate`; no PLEX is ever charged |
| `sequencing.api.GetTierDurations` | the store's own duration | the client shows this number and the job completes when it has passed |
| `sequencing.api.GetEarlyCompletionPricing` | 0 PLEX, one window (0 < remaining <= duration) | `CompleteEarly` charges nothing |
| `freelance...itemdelivery.Deliver` | `project_does_not_exist` | there is no freelance project system to deliver into; the client has that exact oneof branch |
| `ai.assistant.chat.api.Query` | `501` + "this world has no AI assistant service" | a friendly fabricated "AI" reply would be a lie |
| `sovereignty.resource.planet.GetAllConfigurations` | empty list (the call is deprecated in the client's own proto) | no planet-level resource configurations exist; the star-level call answers the real ones |

`eve_public.Request` is not a surface: it is the envelope's parent message that every generated
request module names, and `scripts/coop-gateway-gap-audit.py` now excludes it by name instead of
demanding an answer that cannot exist. All 24 `AMBIGUOUS_ATTRIBUTION` types (planet/star, pirate
corruption/suppression, campaign/objective and the licence namespaces) are answered in both forms,
so whichever the client means, it gets a real answer.

## What is still not covered, measured 2026-10-31

Two different registers, do not confuse them:

* **gateway request types** (the gRPC `eve_public.*Request` surface): `CONSUMED_NOT_ANSWERED 0`
  against the deployed registry (297 handled). Nothing here is open.
* **client service calls** (`docs/CLIENT_CONTRACT_STATUS.md`, re-derived by
  `node scripts/coop-client-contracts.cjs --verify`): 542 calls, `MISSING 0`, `STUB 37`,
  `NULLABLE 102`, `OK 403`. A stub is a call that answers a placeholder, not a missing method.

The 37 stubs, by what they can actually reach:

| group | count | what it means |
| --- | --- | --- |
| QA / GM / programmer only | 14 | `node_graph.qa_*`, `keeper.GetLevelEditor`, `publicQaToolsServer.*`, `localizationServer.UpdateLocalizationQAWrap`, `clientStatLogger.LogString`, `bountyProxy.GM*`. A normal player can never send these. |
| logon and housekeeping | 8 | `milestoneMgr.ProcessCharacterLogon`, `eventLog.LogPlayerRequestedDisconnect`, `operationsManager.process_client_event`, `charMgr.GetCohortsForCharacter`, `charUnboundMgr.*`, `browserLockdownSvc.*`, `pingService.Ping`. Fire-and-forget or tolerated by the client. |
| windows | 15 | see the next table: the label over-reports |

The label is **static**: it says "returns only a constant null / empty answer". Reading the 15
handlers one by one (2026-10-31) shows most of them are not gaps at all:

| call | what the handler really does | verdict |
| --- | --- | --- |
| `structureDeployment.RenameStructure`, `CancelUnanchor` | call `renameStructureByID` / `cancelStructureUnanchorByID`; the client watches a notice, so `null` is the protocol | functional |
| `petitioner.MarkAsRead` | `store.markMessageRead(character, messageID)` | functional |
| `petitioner.GetCategoryProperties`, `PropertyPopulationInfo`, `GetClientPickerInfo` | empty lists - a petition here has subject, body, category and nothing else | honest empty |
| `petitioner.GetLog` | empty - the client wants a `DBRowDescriptor` event log this world does not keep | honest empty, documented |
| `pvpFilamentMgr.*` (4) | audit-event only, return `null`: this world runs no PVP filament events | by design |
| `rewardMgr.GetRewardLPLogs` | empty: no LP log store exists | honest empty |
| `survey.ClaimSurveyRewards`, `PerformSurveyChecks` | record an audit event and return `null` - **nothing happens** | the only two real no-ops |

So the honest count of client calls that pretend to work is **2, not 15** - and both need a real
survey reward source before they can do anything that is not invented.

Notices were checked separately: the client subscribes to notices and a domain that never publishes
one stays stale until the window is reopened. `eve_public.dailygoal.api.RedeemedNotice` was exactly
that and is now published on a real redeem only (fork `7e04f8f`, `tests/coop-daily-goals-gateway.test.mjs`).

### The notice surface, measured 2026-10-31

`scripts/coop-gateway-notice-audit.py` (same client-derived method as the request audit, plus
`scripts/coop-published-notices.cjs` for the server side) reports:

```
client notice types       144
subscribed by client code 106
published by this server   41
SUBSCRIBED_NOT_PUBLISHED   66
PUBLISHED_NOT_IN_CLIENT     0
```

77 is the count of *subscribed* types nobody publishes, not 77 defects: most belong to domains this
world does not run (freelance projects, `goal.api`, `tale`, payment schedules, achievements). The
ones that matter are the domains we DO run, because there the client is waiting on us:

| notice | where it should come from | state |
| --- | --- | --- |
| `cosmetic.market.transaction.api.TransactionSucceededNotice` | a real component purchase | **published now** (fork `0f3de0f`, 10/10; live on `evejs-agents`: `BUY=200 txBytes=16`, notice id = answer id) |
| `cosmetic.market.transaction.api.TransactionFailedNotice` | a purchase that fails after a transaction exists | not published - this store mints the transaction id only on a real sale, so a refusal has nothing to announce; the refusal is the answer itself |
| `cosmetic.ship.skin.thirdparty.component.license.api.GrantedNotice` | a component purchase that grants a licence | not published |
| `cosmetic.ship.skin.thirdparty.license.api.Added/Updated/DeletedNotice` | a licence that really changed: grant, activation, revoke, a market purchase | **published now** (fork `69b72f1`, 12/12 and 9/9; live on `evejs-agents`: `CREATE=200 BUY=200`, notice row = the buyer's licence) |
| `cosmetic.ship.skin.thirdparty.sequencing.job.api.StartedNotice` | the sequencing store | **published now** (fork `1bb2ff9`) |
| `cosmetic.ship.skin.thirdparty.sequencing.job.api.CompletedNotice` | a job that came due and minted its copies | **published now** (fork `81af2d9`, 7/7) |
| `cosmetic.ship.skin.thirdparty.sequencing.job.api.FailedNotice` | a job whose mint failed | not published - its `reason` is an enum this store cannot name, and a made-up reason is worse than none |
| `cosmetic.character.title.api.Granted/Revoked/SetNotice` | a real title change (Equip/Unequip, admin Grant/Revoke) | **published now** (fork `3a9ac81`, `tests/coop-character-titles.test.mjs`, 6/6) |
| `dailygoal.api.Progressed/CompletedNotice` | the measured daily-goal progress | **published now** (fork `5385fed`, 9/9; live on `evejs-agents`: baseline silent, `0 -> 1` announced the same goal id, no repeat) |
| `corporationgoal.api.RedeemedNotice` | corp goal redeem | not published |

The war rank title is **still announced by no notice**, and that is deliberate: a rank writes plain
text into the character record (`space/coopWarRankTitle.applyToCharacter`), while every title notice
carries a *catalogue* title id (`definition.Identifier{uuid}`). There is no honest uuid to put in
`SetNotice` for "Fleet Pilot", so the rank would have to become a real catalogue title first - a
content change, not a notice.

The payload of every one of these is a single identifier plus, at most, the new state, so each is a
small addition to the service that already owns the state - the same pattern as `RedeemedNotice`.

Answered since 2026-10-31: `cosmetic.market.component.listing.api.GetAll` and
`InitiatePurchaseListing` (fork `38bea4d`, `3873cf9`). The recorded blocker was wrong - the 924 real
component item types were already in the item-type table; the market itself was missing. Live on
`evejs-agents`: 120 listings, a purchase debits real ISK and grants the real component to the
buyer's station hangar, a failed delivery refunds the money and restores the stock
(`tests/coop-component-market.test.mjs`, 7/7).

## If you have no client: read this instead of decompiling

A web or cloud session cannot run the decompiler - there is no `tq/code.ccp`, usually no Python
and often no Windows machine. Nothing is lost: every client fact the repository relies on is
committed as data, and it can be re-proved without the client.

| what you want to know | read | prove it is still true |
| --- | --- | --- |
| every call the pinned client issues (542) | `docs/client-contracts/calls.json` | `node scripts/coop-client-contracts.cjs --verify` |
| which of them answer a constant or may answer `null` | `docs/CLIENT_CONTRACT_STATUS.md` | same `--verify` (a stale register fails) |
| every `eve_public.*Request` the client can send | `docs/client-contracts/gateway-types.json` | `node scripts/coop-client-contracts.cjs --verify` |
| which response fields the client really reads | `docs/client-contracts/field-reads.json` | same |
| what the client does when the gateway answers nothing | `docs/CLIENT_GAPS.md` (this file) | - |

`--verify` touches only committed data and the server tree: it rebuilds the register and the
baseline and fails with `CONTRACTS_OFFLINE_STALE` when either no longer matches the code, or when a
recorded call has no handler at all. `--write` is the only mode that needs the client, and it is run
by the machine that has it; never commit the decompiled text, only the derived JSON above.

This file is the work queue for those surfaces. Refresh the numbers with
`node scripts/coop-client-contracts.cjs --write` (see `docs/CLIENT_CONTRACT_STATUS.md`).

## Surfaces, in the order a player is likely to meet them

| surface | request types | what the client does today | what building it needs |
| --- | --- | --- | --- |
| **SKINs and third-party skins** (`cosmetic.ship.skin.thirdparty.*`, 19) | licences (finite/infinite), drafts, sequencing jobs, shared drafts | **licences + apply + drafts done** (`469cbff`, `c4fb38b`, `157ed2c`): a per-character store keyed by skin hex; GetOwned/Get/Activate and admin Grant/Revoke answer real rows, an unactivated copy is the only thing that becomes usable, and Apply/Unapply record a skin on a ship the character really owns (item looked up, must be category 6). **drafts done** (`157ed2c`): Save/Update/Delete/Get/GetAllSaved/GetShared/GetSaveCapacity keep the client's layout bytes verbatim (the server does not model the design tree, so it never re-encodes it) and save is refused past the capacity the client is told. **component licences done** (`bc6ee18`): finite (a capacity that is spent down and refuses to go negative) and infinite (free) rows per character, GetOwned/Get + admin Grant/Revoke. **sequencing done** (`645f18a`): Initiate/Get/GetAllActive/CompleteEarly — a design is priced in component licences (validated as a whole, then spent), the job stores its planned completion so a restart cannot lose it, and only a completed job mints the copies (hex derived from the job id, exactly once). **skin record done** (`85041fc`): `thirdparty.api.Get` answers name, line name, creator, tier, sequence state and the design (spliced back as the stored bytes), from what the job wrote into the licence row. **item consume done** (`e18b98d`): `component.license.item.Consume` reads the item from the real inventory, requires an explicit type mapping (`EVEJS_COOP_COMPONENT_LICENCE_ITEMS`), spends the real quantity and only then writes the licence; a singleton counts as one item (it is reported as -1, which used to refuse every consume) | the rest of the designer, per the staged plan in `.opencode/state.md` |
| **SKIN market** (`cosmetic.market.*`, 10) | broker/buyer fees, tax rate, listings, transactions | **fees done** (`1ec0b15`): broker 1/2/3/5 % by 1/3/7/14-day duration, 2.5 % tax and the tiered buyer fee all read one policy module. **listings done** (`931cb17`): create/cancel/get/get-all/get-all-owned/set-expiration with real escrow of the sold copies (only the seller may cancel, an expired listing returns its copies). **purchase done** (`27d9c09`): the native wallet transfer moves the price, the seller pays the 2.5 % tax, the escrowed copies change hands, and every failure after the transfer rolls the ISK back. **transaction record done** (`0595472`): a purchase writes a row into both the buyer's and the seller's record, and `transaction.Get`/`GetAll` read it back with the client's own successful status. Still missing: the buyer's loyalty-point fee (quoted but not charged), and `component.listing.{GetAll,InitiatePurchaseListing}` - **blocked on real component item type ids**: a listing carries `component_item.sequential`, which the client resolves through its own `ComponentsDataLoader` FSD, and the item-type table shipped with the server (`gameStore/data/itemTypes`) contains no SKIN component items (searched: only armour coatings and unrelated 'component' commodity names). Inventing an id would make the market window fail to build that listing in game, so this waits for a way to read the client FSD | the skin market window shows no listings and zero fees | listings table with escrowed SKIN items, an ISK settlement path (the native market already has one for items), fee/tax rules and a transaction log |
| **Character titles** (`cosmetic.character.title.*`, 6 state + 1 definitions) | GetOwned/Equip/Unequip/GetEquippedForCharacter, admin Grant/Revoke; definitions come from a CDN checkpoint | **state done** (`738b145`): per-character rows, an ungranted title cannot be worn, a revoked worn title clears the slot; the catalogue is client content served from a checkpoint our server can host. Not visible yet: the client gates the whole feature behind the LaunchDarkly flag `character_titles_feature_enabled` | **our own catalogue served** (`7d93168`, `0a7b8d1`): TitleData flatbuffer with 4 titles, CRC-checked; a separate HTTP/1.1 content host on 127.0.0.2:443 serves it exactly as the client's httplib asks (verified from the host: 200, 368 bytes, CRC matches, 'CHTI'). The only thing left for the titles window is the client-side LaunchDarkly flag `character_titles_feature_enabled`, which our gateway cannot set |
| **Achievements** (`achievement.*`, 9) | progress/complete/reset (admin), Get, category score, unclaimed rewards + Claim, showcase score; definitions from a CDN checkpoint | **done, all 9 calls** (`aaebf64`, `395cb66`): per-character rows, a zero delta is refused, Complete unlocks exactly one reward, Reset withdraws it, checklist deltas are refused instead of dropped, and `definition.api.cdn.GetLatest` answers a checkpoint for our own catalogue. **Catalogue served** (`395cb66`): an `ACHV` flatbuffer with both roots the client's repository loads (Challenges, TimeLimited), one contribution method, 3 achievements with 4 milestones; names are real localization message ids; every milestone declares an SpReward, and **Claim pays it** through `space/coopSkillPointGrant` before the reward leaves the unclaimed list. Proven live: checkpoint 200 (crc 3362621445) and the TLS GET returned 1912 bytes with `ACHV` and the same CRC; the served bytes parsed by the **client's own** generated reader give targets 1/100 and rewards 1000/2500 (plus 1500, 2000); a real claim moved `freeSkillPoints` 0 -> 3500. The first version wrote `Target`/`SpReward.Quantity` as uint32 while the client reads uint64 and displayed 618475290625 - caught only by running the client's reader (`scripts/coop-verify-flatbuffer-client.cjs`), never by our own | client-side visual confirmation of the achievements window (the owner must open it in game) |
| **Character titles** (`cosmetic.character.title.*`, 6) | owned/equipped titles, definitions, admin grant/revoke | the title picker is empty, equipping does nothing | a title definition list (flatbuffer) plus per-character owned/equipped rows; the character sheet reads them directly |
| **Achievements** (`achievement.*`, 9) | definitions (flatbuffer CDN), progress, completion, rewards, showcase | the achievements page opens empty; the definition fetch fails inside the client (`FlatbufferContentProvider … L500`) because there is no checkpoint URL to download | an achievement definition flatbuffer (schema is in the client at `achievement_system/client/model/flatbuffer`), a progress store updated by real events, and a CDN path that serves the blob with a matching CRC |
| ~~Skill plans~~ (`skill.plan.*`, 7) | create/delete/get/set active/name/description/requirements | **done** (`2b137c5`): both packages answer from the same persisted per-character plan document, with a startup shape guard | - |
| ~~New Eden Store~~ (`store.*`, 7) | categories, offers (all/targeted/by tag), products | **done** (`d941ad3`): drawn from the same store state the existing purchase path fulfils from (9 categories, 15 offers with real PLEX prices); nothing is targeted, so that list is honestly empty | - |
| **Daily goals** (`dailygoal.*`) | goal list, pay-for-completion, redeem, admin progress | **done except pay-for-completion** (`57d0f47`): four goals whose progress is measured from the real mining ledger, the killmail ledger, accepted stargate jumps and goals actually redeemed; rewards are skill points; `PayForCompletion` is refused (UNIMPLEMENTED) because an ISK completion would need a funded account | a funded payout path if instant-completion is ever wanted |
| ~~Goal contributions~~ (`goal.contribution.*`, 2) | contributor summaries, my summary | **done** (`2b137c5`): read from the one goal store, same record the corporation-goal package uses | - |
| ~~Career portal~~ (`career.goal.*`, `app.eveonline.career.goal.*`, 4) | progress, completion, claim reward | **done** (`bcf632c`): state in `space/coopCareerGoals` (admin Complete/Progress writes it), both claim packages answer, the reward is 25 000 SP paid once, incomplete claims are refused with `n/target` | - |
| ~~Assetholding / entitlements~~ (`assetholding.*`, 4) | asset holdings, entitlements, redeem, admin expire | **done as an honest absence** (`95bced3`): a specific row is NOT_FOUND, a redemption is FAILED_PRECONDITION with the reason; nothing pretends to exist | entitlement rows bound to real structures if the ESS/bank is ever built |
| ~~Presence~~ (`presence.api.*`, 3) | corporation/alliance/faction of a character | **done** (`0d1205f`): live session → durable character record → corporation record; unknown character is `NOT_FOUND` | - |
| ~~Stargate locks~~ (`stargate.lock.api.admin.*`, 3) | admin apply/delete/get-all restrictions | **done** (`f0ff7c1`): persisted locks with an expiry, enforced in `startStargateJump` (`STARGATE_LOCKED`). The public `stargate.lock.api.GetRequest` stays an empty default on purpose - it returns one `gate` and carries no fields, so the gateway cannot know which gate the player is at; the jump path knows and refuses there | - |
| ~~Payment schedules / codes~~ (`payment.*`, 3) | active schedules by type, redeem code | **done as an honest absence** (`95bced3`): no schedule is NOT_FOUND, an active-by-type answer leaves the optional schedule unset, a code redemption is refused with the reason | schedule rows and a code store, if ever wanted |
| ~~Faction activity admin~~ (`faction.activity.admin.*`, 2) | increment/set contribution score | **done** (`0d1205f`): writable ledger applied to the derived score on both client surfaces; a pair outside the war is refused | - |
| **Mercenary den / hub / skyhook admin** (`sovereignty.*`, 4) | anarchy/development level, upgrade list, theft window | mercenary den activity list is answered; the admin knobs are not | persisted den/hub state with validated admin actions |
| **Freelance deliveries** (`freelance.contributionmethod.*`, 1) | deliver contributed items | nothing | a contribution method bound to real inventory moves |
| **Community tracks, operations, ship unlocks, AI assistant** (4) | `communitytrack.api.Get`, `operation.recommendation.Get`, `ship.unlock.ClaimReward`, `ai.assistant.chat.Query` | all open empty | each is a content feature; the AI assistant is out of scope (it would call an external model) |
| **Envelopes, not features** (4) | `eve_public.debug.Request`, `eve_public.internal_gateway.*`, `eve_public.auth.*` | irrelevant: these are transport/auth artefacts of the gateway itself | nothing |

## Not gRPC, but equally absent (RemoteSvc side)

`docs/CLIENT_CONTRACT_STATUS.md` lists the 44 `RemoteSvc` answers that are placeholders. Most are
guarded or fire-and-forget; the ones that mean "this data does not exist yet" are:

- `map.GetDeadspaceAgentsMap` / `GetDeadspaceComplexMap` — the map's deadspace star modes have no
  data (the client checks for `None` first, so the layers are simply empty).
- `rewardMgr.GetRewardLPLogs` — the incursion LP log is always an empty list.
- `charMgr.GetCohortsForCharacter` — no cohort metadata for the character.
- `browserLockdownSvc.GetFlaggedSitesList` — the in-game browser has no flagged-site list.
- `warsInfoMgr.GetPublicWarInfo` — answers `null` only for an unknown war id (legitimate).

## Zeros rather than stubs

Two gateway families answer real shapes with zero content, and both are honest zeros because the
world produces no such state: `pirate.corruption` / `pirate.suppression` progress (no insurgency
corruption exists here) and the ESS/dynamic-resource reserve banks (no player-run reserve banks).
If insurgency is ever wanted, those responses are the place the state has to come from.

| **Empty-catalogue reads** (`operation.recommendation.Get`, `communitytrack.api.Get`) | asks for recommended operations and for one community-track instance | **honest answers** (`3166539`): an empty recommendation list (there is no operations catalogue here) and `NOT_FOUND` with the reason for an instance nobody created | nothing to add until operations/tracks exist |