# COOP-03 — Native-backed two-pilot session custody

## Scope and provenance

Reviewed pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. This change fences **co-op side effects**; it does not modify native login, socket lifetime, inventory, or the ship-command dispatcher.

### Native contracts reviewed

- `network/clientSession.js` separates `userid`, `characterID`, `shipID`, `_space`, and TCP socket.
- `services/character/charService.js` validates `character.accountId` against `session.userid` on SelectCharacterID. Duplicate login is rejected or invokes eviction depending on `config.loginTakeoverEnabled`.
- `services/chat/sessionRegistry.js` indexes live sessions and can choose a preferred duplicate; preferred does not imply exclusive ownership.
- `services/character/characterState.js` provides authoritative `getCharacterRecord` and `getActiveShipRecord`.
- `services/_shared/sessionDisconnect.js` persists and detaches a native character, removes trade/chat participation. `network/tcp/index.js` calls it on both socket error and close.
- `services/ship/spaceShipSwapRuntime.js` prepares and boards an active physical hull; ownership must be revalidated on swaps.

## Changes

`coopSessionPresence.admission(session, ship, getSceneForSession, authority)` now checks unique in-scene character and hull, exact Ballpark scene membership, attached physical ship/session/pilot (where available), and (when supplied) native registry membership, absence of live global duplicate characters or hulls, `character.accountId === session.userid`, and exact active inventory ship `itemID` and `ownerID`.

`schedule()` always supplies live native authority functions for deployed co-op admissions; an unavailable or inconsistent authority fails closed and prevents co-op world/party/NPC side effects. It never creates alternative identity state or evicts sockets.

`coopDuoCoordinator` requires the same admission when registering and ticking; it discards stale registrations on character change, ship swap, disconnected socket, missing physical ship, or native ownership mismatch. It does not mutate a still-connected peer session.

Both modules already have names in the central overlay installer and existing `transitions.js` schedule hooks. This work intentionally leaves all centrally-owned files untouched.

## Tests and limits

`node --test tests/coop-session-ownership.test.mjs tests/coop-session-party-authority.test.mjs`: 17 isolated PASS, 0 FAIL. Cases cover two distinct players, foreign account/ship, global duplicate character/ship, physical session mismatch, stale registry scene, independent B after A disconnect, A reconnect after native transfer, and ship changes.

Unit contracts are not actual native database, RPC or gameplay E2E: no pinned local checkout, running Docker host, restart evidence or two legally authorized clients are available here. Classification: **CODE_READY / LIVE_UNVERIFIED** (co-op side effects only). Not a guarantee that *every* native movement/module command is secured.

## Central runtime integration request — chat 01

Do not duplicate the co-op admission registry. Review native RPC permission/ship-control paths in `services/ship/beyonceService.js`, `space/runtime`, `space/transitions.js`, and the native character-selection/ship-switch lifecycle. Native dispatch must validate caller session against the actual character/account and currently owned active ship before mutating its authoritative state.

**Suggested API:** `guard(session, requestedShipID, scene, {getSessions,getCharacterRecord,getActiveShipRecord}) -> {allowed,reason}`; fail closed on stale/ambiguous ownership. Reuse native state; no synthetic ship control. **Suggested hook:** smallest unique one-statement reversible native command anchor via `scripts/patch-evejs-coop.cjs`, owned only by chat 01. **Proposed flag:** `EVEJS_COOP_NATIVE_SHIP_COMMAND_GUARD=1` default OFF pending physical client QA.

**Acceptance:** two authenticated accounts with distinct character and ship IDs; stale same-character session, stolen shipID, duplicated cross-scene claims, delayed `close` after takeover, simultaneous reconnect, ship swap during pending Ballpark, A logout while B keeps full controls, native persistence/restart, overlay apply/remove/roundtrip, and actual two-client evidence. Note `shipService._getShipID` includes a fallback literal; verify unauthenticated callers cannot use it for mutations.

No new central integration hooks were added in this Chat 03 commit. Chat 01 should receive this contract before changing native dispatch.
