# Chat 35 — native Faction Warfare and Military Campaigns (2026)

**Pinned upstream:** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
**Outcome:** `ISOLATED_CODE_PREPARED / INSTALLER_INTEGRATION_PENDING / LIVE_UNVERIFIED / CAPTURE_AND_REWARD_ENGINE_UNAVAILABLE`.
**No synthetic FW factions, solar systems, capture-site victory, LP, ISK, or campaign reward claims.**

## Current EVE Online 2026 is not the pinned emulator

Official CCP Cradle of War expansion material (June 2026) introduces Military Campaigns. Objectives are time-limited, may require militia enrollment for PvP, may be open to any pilot for other objectives, and reward ISK, militia LP for PvP or navy LP for PvE, and direct faction standings; some require minimum contribution.
- CCP Singularity announcement, May 20, 2026: https://forums.eveonline.com/t/singularity-mass-test-cradle-of-war-edition/511850
- CCP ESI development announcement, August 4, 2026: https://developers.eveonline.com/blog/military-campaigns-on-esi-joining-the-war-effort
- New ESI routes include `/military-campaigns`, campaign/objective details, and character objective participation (`esi.activity.char:read`). Campaign **and objective IDs are UUIDs**. Static data sections `militaryCampaigns` and `militaryCampaignObjectives` contain localized descriptions and reward/contribution definitions. A live ESI route does not make its server logic appear in the pinned EveJS world.

The pinned EveJS server has its own limited V23.02-compatible response surface. Cradle of War (2026) introduced content and potential client protocol differences not established as compatible with this snapshot. Do not substitute real-world ESI campaign data for server-authoritative native world events or attempt to enable campaign rewards by duplicating CCP progression.

## Actual pinned server support matrix

| Requested mechanic | Pinned code | Source verdict | Two-client verdict |
| --- | --- | --- | --- |
| Direct empire/pirate enlistment | `services/corporation/fwCharacterEnlistmentMgrService.js` calls native `updateCharacterRecord`, session change; `corporationRuntimeState` stores corp allowed list | **Native mutation path exists, but originally accepts arbitrary positive factionIDs, ignores raw standings and cooldown, and has no corp-leadership guard** | NOT_TESTED |
| Faction standings | `services/character/standingRuntime.js` has `getCharacterRawStanding`, `applyStandingChanges`, and notifications | Native standings available, but no FW capture/kill attribution to a standings change shown | NOT_TESTED |
| FW ranks | `services/faction/facWarMgrService.js` | Getter for ranks, not rank progression from conquests | NOT_TESTED |
| Capture sites / NPC capture timer | No verified authoritative FW complex lifecycle in the reviewed source contracts; common dungeon sites do not constitute FW plexes | **Capture site gameplay and unique completion receipt unverified** | NOT_TESTED |
| Victory points | `services/faction/fwVictoryPointMgrService.js` | Reads values from explicit `stateBySolarSystemID` and session-injected maps. No verified persistent site→VP engine or faction-owned conquest transaction | NOT_TESTED |
| Occupation, warzones | `services/map/fwWarzoneSolarsystemService.js` | Two warzone enumerations and HQs. `GetAllWarzonesOccupationStates*` returns **empty dict shells**; `GetLocalOccupationState` returns `(solarSystemID, null)` | NOT_TESTED |
| LP & LP Store | `services/corporation/lpWalletState.js`, `services/evermarks/lpStoreMgrService.js` | Native wallet and purchase/offer logic exist, but **not** a legitimate FW plex/campaign payout source | NOT_TESTED |
| Pirate Insurgencies | `services/map/insurgencySolarsystemService.js`, `gatewayServices/insurgencyGatewayService.js` | Static `VISIBLE_CAMPAIGN_SNAPSHOTS` are presented as active while local snapshot is null and public corruption/suppression progress is stubbed at zero | NOT_TESTED |
| Military Campaigns (2026) | `gatewayServices/campaignGatewayService.js` | Request type names present, `statusCode:200` plus **empty response payload** for Commit, Resign, Redeem, read requests. No native UUID objective registry, commitment/contribution, expiry or reward escrow | NOT_TESTED |
| Faction world impact and rewards | No authoritative capture site completion→persistent VP→occupation takeover→LP/ISK/standing pipeline established | **Unsupported**; no credits/territory may be minted from client claims or RPC success | NOT_TESTED |

## Native bug fixes prepared in this commit (OFF by default)

1. `integration/coopFwEnlistmentGate.cjs`: pure validation and lazy server-authority bridge. Guards six **known empire/pirate militia IDs** (500001/2/3/4 and 500010/500011); only exact authenticated character and persisted corp affiliation; native RAW faction standings >= 0 (not Social/Diplomacy adjusted); persisted FILETIME 24h retirement cooldown via `BigInt`; prevents switching directly between militias without retirement. For player corporations, the native `fw.allowedEnlistmentFactions` list must explicitly contain the selected faction; empty/unavailable list is **not** wildcard permission. NPC starter corporations use native identity and raw standing instead of member-admin list. Corporate policy changes require the actual corp CEO or native persisted member with Director bit. Guards also require **read-back of native character/corporation persisted state before the handler sends a session change or returns success**. No independent reputation/wallet table.
2. `scripts/coop-fw-native-enlistment-patch.cjs`: six single-line hooks in the pinned native FW enlistment handler, scoped to each method, unique anchors, reversible, idempotent, supports LF and CRLF, rejects drift. Flag `EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD=1` defaults **OFF**.
3. `integration/coopFwInsurgencyVisibility.cjs` + `scripts/coop-fw-insurgency-visibility-patch.cjs`: optional `EVEJS_COOP_FW_AUTHENTIC_CAMPAIGNS_ONLY=1` returns an empty native visible-campaign list rather than advertising fixed/hardcoded campaign IDs as active. This does **not** claim there are zero live campaigns in EVE Online; it only refuses to assert fake activity in this pinned emulator. Also default **OFF**.
4. `scripts/coop-fw-native-coverage-audit.cjs`: read-only source token checks for 11 pinned files; does **not** claim server/client success. Tests cover eligibility, anti-spoof corp roles, exact cooldowns, stale write refusal, LF/CRLF transformation, restore and missing-authority cases.

**Security and migration caution:** Existing malformed directFactionID or illegally configured corp allowed lists are **not silently rewritten**. Preserve live character/company data and let the owner inspect the exact native state. Existing active illegal memberships must be repaired through a separate owner-approved migration that retains LP and other real assets. Do not enable guards without verifying client error handling and corp whitelist defaults on a disposable world.

## Integration handoff — Chat 01 owns the sole installer

**No change was made** to `scripts/patch-evejs-coop.cjs`, `state/`, the upstream pinned checkout, the installed server or client binaries. Do not use a second patching mechanism.

Add to central installer `names` copy map:
- `integration/coopFwEnlistmentGate.cjs` -> `Code/server/src/space/coopFwEnlistmentGate.js`;
- `integration/coopFwInsurgencyVisibility.cjs` -> `Code/server/src/space/coopFwInsurgencyVisibility.js`.

Add native spec entries (or coordinate one existing spec) for:
- `server/src/services/corporation/fwCharacterEnlistmentMgrService.js`: call `require('./coop-fw-native-enlistment-patch.cjs').patchFwNative(text, spec.file, {remove})` from central `transform()` exactly once;
- `server/src/services/map/insurgencySolarsystemService.js`: call `require('./coop-fw-insurgency-visibility-patch.cjs').patchFwInsurgency(text, spec.file, {remove})` from the **same** transform mechanism.

Retain both flags OFF for first deploy. `--dry-run`, `--check`, `--remove`, exact pinned SHA, crossstream overlay roundtrip, rollback, and controlled Docker deployment must be performed by installer/operator owners. A source patch that was not integrated or deployed does **nothing** to live gameplay. Do not enable a feature merely because a unit test passes.

## Two independent player acceptance gates

1. Pin and installed overlay verified, real authorized client present. Record server event receipts, characterID, corpID (privately). No login or claim is inferred from TCP sockets.
2. Pilot A (CEO/Director) sets explicit corp allowed factions. Pilot B lacking Director must fail. Re-login and restart: allowed list persists, neither character changes corporation ownership.
3. Pilot B's RAW faction standing below 0 must prevent enlistment even if adjusted standing is above zero; raw 0 may enlist. Unknown or rival factionID, bypass attempts, spoofed corp/session, and changes to the wrong character must fail without a persisted write or emitted success notification.
4. Pilot A enlists to a distinct supported militia. Pilot B legitimately enlists only to an approved faction. Both receive real session militia states and persistent character record after reconnect; do not equate same corp with same militia.
5. A pilot retires and cannot re-enlist for 24h measured by native FILETIME. Exact boundary test on disposable simulated time; no manual SP, wallet, or standings adjustments.
6. Inspect real enemy flagging, actual FW plex spawns and capture timer, NPC presence and qualifying physical combat. Without authentic native event and objective completion **mark FW_CAPTURE_BLOCKED**.
7. For eligible captures only: independently verify native VP debit/credit, authoritative occupation transition, LP to correct issuer corp, raw faction standing transaction, participant eligibility, no duplicate reward on replay/reconnect/restart. Without all receipts **mark FW_SETTLEMENT_BLOCKED**.
8. Pirate Insurgency must not display expired static campaign IDs as live; no fake corruption/suppression. Military Campaigns must not show `200 emptyPayload` as evidence of successful contribution or reward. A recent client UI additionally requires protocol+UUID objective compatibility. **Mark MILITARY_CAMPAIGNS_UNSUPPORTED** until it is established.

## Evidence and tests

- Source review: 11/11 pinned file contract tokens found via GitHub at exact pin. All six enlistment and one insurgency insertion points found uniquely in exact pinned sources, read-only checked.
- Local isolated Node tests: **20 PASS, 0 FAIL, 3 SKIP** (optional pin checkout unavailable in this environment). These tests are not gameplay acceptance.
- No real EveJS executable server, EVE client(s), runtime `Code/` checkout, local Docker volume, gameplay screenshots or NPC combat event receipts were available here. **No human-visible claim of finished FW or campaigns.**
- To repeat: `node --test tests/coop-fw-*.test.mjs`, `node scripts/coop-fw-native-coverage-audit.cjs --code-path <pinned EveJS/Code>`, then central deploy gates and owner two-client test.
