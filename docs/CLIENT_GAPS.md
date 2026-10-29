# What the client can ask for that we do not implement

Generated from the pinned client's own bytecode, not from guesswork: `docs/client-contracts/gateway-types.json`
holds every `eve_public.*Request` string the client (V24.01, compiled 2026-06-16) can send —
**217** of them. The local gateway knows **161** names (gateway services plus four inline handlers:
`user.license.api.Get`, `plex.vault.api.Balance`, `cosmetic.ship.api.Get`,
`cosmetic.ship.api.GetAllInBubble`). The remaining **56** have no handler at all.

They are not fatal any more: since fork `f256261` an unknown `eve_public.*Request` is answered with
a default-encoded empty message and a warning that names the type, so the client gets a valid
"no data" answer instead of a 404 it cannot decode. What that means in game is that the surface
opens and shows nothing (or zeros) — it does not throw.

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
| **SKIN market** (`cosmetic.market.*`, 10) | broker/buyer fees, tax rate, listings, transactions | **fees done** (`1ec0b15`): broker 1/2/3/5 % by 1/3/7/14-day duration, 2.5 % tax and the tiered buyer fee all read one policy module. **listings done** (`931cb17`): create/cancel/get/get-all/get-all-owned/set-expiration with real escrow of the sold copies (only the seller may cancel, an expired listing returns its copies). **purchase done** (`27d9c09`): the native wallet transfer moves the price, the seller pays the 2.5 % tax, the escrowed copies change hands, and every failure after the transfer rolls the ISK back. **transaction record done** (`0595472`): a purchase writes a row into both the buyer's and the seller's record, and `transaction.Get`/`GetAll` read it back with the client's own successful status. Still missing: the buyer's loyalty-point fee (quoted but not charged) and `component.listing.InitiatePurchaseListing` | the skin market window shows no listings and zero fees | listings table with escrowed SKIN items, an ISK settlement path (the native market already has one for items), fee/tax rules and a transaction log |
| **Character titles** (`cosmetic.character.title.*`, 6 state + 1 definitions) | GetOwned/Equip/Unequip/GetEquippedForCharacter, admin Grant/Revoke; definitions come from a CDN checkpoint | **state done** (`738b145`): per-character rows, an ungranted title cannot be worn, a revoked worn title clears the slot; the catalogue is client content served from a checkpoint our server can host. Not visible yet: the client gates the whole feature behind the LaunchDarkly flag `character_titles_feature_enabled` | **our own catalogue served** (`7d93168`, `0a7b8d1`): TitleData flatbuffer with 4 titles, CRC-checked; a separate HTTP/1.1 content host on 127.0.0.2:443 serves it exactly as the client's httplib asks (verified from the host: 200, 368 bytes, CRC matches, 'CHTI'). The only thing left for the titles window is the client-side LaunchDarkly flag `character_titles_feature_enabled`, which our gateway cannot set |
| **Achievements** (`achievement.*`, 9) | progress/complete/reset (admin), Get, category score, unclaimed rewards + Claim, showcase score; definitions from a CDN checkpoint | **state done** (`aaebf64`): per-character rows, a zero delta is refused, Complete unlocks exactly one reward, Reset withdraws it, Claim moves it without minting anything, checklist deltas are refused instead of dropped. Missing: `definition.api.cdn.GetLatest` (our own flatbuffer catalogue) | next: serve our own achievement definitions |
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