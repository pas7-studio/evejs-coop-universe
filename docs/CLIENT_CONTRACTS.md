# Client contracts we have verified, and how to check one without the client

A cloud or web agent has no game install, so it cannot decompile `code.ccp`. Everything below is
derived from that client once, by a session that had it, and is safe to commit: names, locations
and semantics — never client code (see `AGENTS.md`).

Read this file before changing an answer the client consumes. For the full inventory use:

| file | what it answers |
| --- | --- |
| `docs/client-contracts/calls.json` | every `RemoteSvc('service').Method` the client issues (542 pairs, with the modules that call them) |
| `docs/client-contracts/gateway-types.json` | every `eve_public.*Request` the client can send (216) |
| `docs/client-contracts/field-reads.json` | heuristic: what the client reads off an answer, for the 26 of 513 calls the extractor can follow (hint only, not proof) |
| `docs/CLIENT_CONTRACT_STATUS.md` | generated register: 0 missing handlers, 44 placeholders, 103 nullable, 395 real answers |
| `docs/CLIENT_GAPS.md` | the 99 client request types with no handler, grouped by player-facing surface |

## Verified contracts

Each row is a requirement the client enforces in its own code, the evidence, what the server
answers today, and the fork commit that made it true.

| surface | the client does this | evidence | server answer | state |
| --- | --- | --- | --- | --- |
| warzone tiles | colours a system with `FACTION_ID_TO_COLOR[occupationState.occupierID]` — a faction id, not a corporation | `fwwarzone/client/dashboard/warzoneMap.py` | `GetAllWarzonesOccupationStates` sends factions from the war record | fixed `f291491`, `8fa69e2` |
| warzone tiles | draws the front line with `ADJACENCY_STATE_TO_ICON_PATH[adjacencyState]` (`FL`/`SL`/`BL`), no default | same module | `adjacencyState` computed from the real gate graph and neighbour occupiers | fixed `8fa69e2` |
| advantage gauge | builds two bars from `occupierID` and `attackerID`, both indexed into `FACTION_ID_TO_COLOR` | `fwwarzone/client/dashboard/gauges/advantageWidget.py` | `attackerID` is never 0 or a corporation | fixed `8fa69e2` |
| advantage numbers | refuses points outside 0..100000 and contribution+terrain above 100000 | `factionwarfare/advantageState.py` | scores clamped into that domain | fixed `b919223a` |
| warzone details | reads `victoryPointsState.contestedFraction` for **every** listed system | `fwwarzone/client/dashboard/warzoneStats.py` | victory point states cover exactly the systems the occupation payload lists | fixed `3033ce5` |
| map star colouring | calls `GetVictoryPointState(system)` per occupied system, and that call refetches the whole dict each time | `eve/client/script/ui/shared/maps/starModeHandler.py` | payload kept to the war-touched systems so the pass finishes | fixed `8fa69e2` |
| occupation membership | compares `occupierID` against `_OCCUPIER_FW_FACTIONS` (Amarr/Caldari/Gallente/Minmatar) | `eve/common/script/util/facwarCommon.py` | same four factions only | fixed `8fa69e2` |
| FW dashboard | `cfg.eveowners.Get(GetFactionMilitiaCorporation(faction)).name` — a null is `KeyError(None)` | `fwwarzone/client/dashboard/fwWarzoneDashboard.py` (line 184) | militia corporation read from the native faction record | fixed `331cffa` |
| FW dashboard | reads `factionalWarStatus.startDate` and subtracts it from the wallclock | same module (line 353) | `GetCorpFactionalWarStatus` answers status/factionID/startDate as a FILETIME number | fixed `331cffa` |
| FW statistics | `topStats[0][groupCharacter][key]`, `GetStats_Character().items()`, militia header mapped through `appConst.raceByFaction` | `fwwarzone/client/dashboard/statisticsController.py` | six stats getters, groups 1/2/32, militia table keyed by faction | fixed `9a2a113` |
| corporation war list | `warsInfoMgr.GetWarsByOwnerID(x).Index('warID')` | `corporation` war window callers | rowset keeps `warID` and `againstID` | verified in `coop-client-contract-payloads` |
| map rowsets | `.Index('stationID')`, `GetMyExtraMapInfoAgents().Index('fromID')`, `GetHistory` rows read `solarSystemID/value1/value2` | `eve/client/script/ui/shared/maps/*`, `facWarSvc.py` | columns present | verified in `coop-client-contract-payloads` |
| online status | wraps every entry in `blue.DBRow(self.onlineStatus.header, [...])`, so the header must be a `blue.DBRowDescriptor` | `eve/client/script/ui/shared/comtool/onlineStatus.py` (line 36) | header is a packed descriptor | fixed `b7fa011` |
| campaigns page | sends `campaign.api.GetAllRequest` and unpacks `GetAllResponse`; an empty payload is a decode error | `campaigns/client/messengers/campaigns_messenger.py` | 200 with an empty list, so the page renders empty (no campaigns exist) | stub, `docs/CLIENT_GAPS.md` |
| achievement/ career definitions | downloads a flatbuffer from the checkpoint URL in the answer and verifies its CRC | `content/client/flatbuffer/provider.py` | no checkpoint served yet | gap |
| campaign of the current system | unpacks `(solarSystemID, campaignSnapshot)` and re-asks until the system matches | `eve/client/script/ui/services/insurgencyCampaignSvc.py` | real snapshot when a live campaign covers the system, `null` otherwise | fixed `841345f` |
| career portal progress | iterates its definitions and dereferences `.progress` on the matching `GetAll` row | client alert `AttributeError: 'NoneType' object has no attribute 'progress'` | one row per definition with `progress: 0`, `not_completed: true` (104 bytes, was 0) | fixed `fb6c025` |
| character membership | asks `presence.api.GetCorporation/GetAlliance/GetFaction` with a character id and handles the `membership` oneof | `eve_public/presence/api/request_pb2` | live session → durable character record → corporation record; unknown character is `NOT_FOUND`, no alliance/faction use their explicit empty branch | fixed `0d1205f` |
| faction activity admin | `/advantage` increment/set contribution, then reads the same score back | `eve_public/faction/activity/admin_pb2` | writes one per system+faction ledger that `coopWarAdvantage` applies to the derived score, so the panel and the victory-point bar agree; a pair outside the war is refused with the reason | fixed `0d1205f` |
| skill plans | the newer UI calls `eve_public.skill.plan.*` (create/get/set name/description/requirements/active/delete) | `eve_public/skill/plan/plan_pb2` | the same storage answers both packages; startup compares both shapes and refuses to run if the client changes one | fixed `2b137c5` |
| goal contributors | `goal.contribution.api.*` asks who contributed to a goal and how much this character did | `eve_public/goal/contribution/api/requests_pb2` | read from the one goal store, reported as `total_sum_of_progress_added`; a missing goal id is `INVALID_ARGUMENT` | fixed `2b137c5` |
| daily goals | `GetAllCurrent` then formats each goal: name/description ids, category, career, contribution type, target, active window and a payment whose asset is a 16 byte uuid | `dailygoals/client/utils.pyj` `format_goal_from_payload` | five goals measured from real records (mining ledger, killmails, accepted gate jumps, industry jobs, redeemed goals); combat credit is hull-weighted with partial damage credit; SP reward follows the real progress | fixed `57d0f47`, `c2fdfbf`, `b0f5b5a` |
| career claim | the portal offers Claim only on a completed goal, and the claim pays its reward once | `eve_public/career/goal.proto` (`RewardType.skill_points`), `app/eveonline/career/goal.proto` | completion is an explicit record set by the career admin calls; both claim packages answer, 25 000 SP paid once, an incomplete goal is refused with `n/target` | fixed `bcf632c` |
| New Eden Store | categories, offers (all / by tag / targeted) and products before the window can draw | `eve_public/store/{category,offer,product}.proto` | the real store state the purchase path fulfils from: 15 offers with PLEX prices, 9 categories, products with an item type only when they really have one | fixed `d941ad3` |
| gateway dispatch | a service must answer only its own request types | registry probe that returned a lock list for a store call | `stargateLockGatewayService` falls through with `null` now | fixed `d941ad3` |
| stargate locks | admin `Apply`/`Delete`/`GetAll` create, remove and list restricted gates; a locked gate must refuse the jump | `eve_public/stargate/lock/api/admin/requests_pb2` | persisted lock with expiry, refused by `startStargateJump` as `STARGATE_LOCKED`; an expiry in the past is refused | fixed `f0ff7c1` |
| system/station name | `solarsystem.api.Get` returns name + security as units+nanos, `station.api.Get` returns a name | `eve_public/solarsystem/api/requests_pb2`, `eve_public/station/api/requests_pb2` | real static rows from `space/worldData` (structures too), `NOT_FOUND` when there is no record | fixed `f0ff7c1` |
| third-party skin licences | `GetOwned`/`Get`/`Activate` and admin `Grant`/`Revoke`; an unactivated copy is the only thing that becomes usable | `eve_public/cosmetic/ship/skin/thirdparty/license/*` | a per-character store keyed by skin hex inside the character record: rows exist only because a grant created them, an unknown licence is `NOT_FOUND` | fixed `469cbff` |
| third-party skin apply | `Apply`/`Unapply` put a licence on a ship | same package, `ApplyRequest{license, ship}` | the ship is looked up in the inventory and must belong to the character and be category 6; a licence that is gone drops the applied row on read | fixed `c4fb38b` |
| third-party skin drafts | Save/Update/Delete/Get/GetAllSaved/GetShared/GetSaveCapacity; the editor sends a deep `layout` tree plus per-slot editor configurations | `eve_public/cosmetic/ship/skin/thirdparty/draft/*` | rows per character with the layout bytes taken verbatim off the wire; capacity (`EVEJS_COOP_SKIN_DRAFT_CAPACITY`, default 20) is what save enforces; read answers carry skin hex + configurations only, as the contract defines | fixed `157ed2c` |
| daily goal redeem | redeem pays once and refuses an incomplete goal; `PayForCompletion` is a separate call | `dailygoals/client/goalMessenger.pyj` | `Redeem` marks the claim before paying SP (so it can never pay twice) and answers FAILED_PRECONDITION with `n/target`; pay-for-completion is UNIMPLEMENTED, not faked | fixed `57d0f47` |

## Checking a contract from a cloud session

1. `docs/client-contracts/calls.json` — does some module call the method you are changing? The
   `modules` list names the client files.
2. `docs/CLIENT_CONTRACT_STATUS.md` — is the answer a real one, a placeholder, or nullable?
3. `docs/client-contracts/field-reads.json` — does the extractor know which attributes that call
   site reads? (26 of 513 calls; absent means "not derivable automatically", not "nothing read").
4. `docs/CLIENT_GAPS.md` — is the whole surface simply missing?
5. If the detail is still unknown and you have the game installed:
   `python scripts/coop-client-code.py --grep <symbol>` or `--module <path>` prints just the
   module you need (cached in `%TEMP%`, never committed).

## Refreshing the derived files

On a machine with the client and `uncompyle6`:

```bash
python scripts/coop-client-fields.py --digest   # docs/client-contracts/field-reads.json
node   scripts/coop-client-contracts.cjs --write # register + baseline
```

`--check` on both fails when the committed file no longer matches the client, so a stale digest
shows up as a red test rather than as a wrong assumption.
