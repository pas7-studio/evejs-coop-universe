# Chat 39 — native social channels, mail, notifications and client UI compatibility

**2026-10-25 | Pinned EveJS:** `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`
**Status:** `CODE_READY / LIVE_UNVERIFIED`; all guards OFF by default; no proprietary client binaries, new RPC names, account/session impersonation or alternative messaging stores.

## Native capability matrix — actual pinned server implementation

| System | Actual server surfaces and observed handlers | Status |
| --- | --- | --- |
| Local chat | `_secondary/chat/chatRuntime.js`, `services/chat/channelRules.js`, `xmppStubServer.js`; wormhole/delayed local, room membership, local movement | Native server path present; full retail-client visual confirmation NOT_RUN |
| Fleet / corp / alliance chat | `chatRuntime.joinChannel/sendChannelMessage`, `sessionChatSync.synchronizeSessionChatState`, `xmppStubServer.syncSessionScopedRoomMembership`; `fleetRuntime` | Native server path present; source-bound scoped authorization hardening staged |
| EVEmail | `mailMgr.Handle_SyncMail/GetBody/SendMail/MarkAsRead/DeleteMail`, `mailState.sendMail/getSyncMailbox` | Native server path present; no-shadow mailbox flush-before-live-event hardening staged |
| Contacts | `services/corporation/contactLabelState.js`, alliance `Handle_GetAllianceContacts/AddAllianceContact/SetRelationship`; character contact services in pinned source | Native server surface present; no extra fake contact or standings RPC |
| Notifications | `notificationMgr.GetAllNotifications/GetUnprocessed/MarkAsProcessed/DeleteNotifications`, `notificationState.createNotification` and `mailNotifications` | Persisted notification APIs and native `OnNotificationReceived` present; offline/reconnect sync NOT_RUN |
| Fleet broadcasts | `fleetObjectHandlerService.Handle_SendBroadcast` and `fleetRuntime` | Native fleet RPC present; command/role and target-delivery client UI NOT_RUN |
| Bookmarks | `bookmarkService.GetBookmarks/CreateFolder/GetBookmarksInFolder`, `bookmarkRuntimeAccess` membership and `bookmarkRuntimeState` | Native bookmark folders, personal/corp sharing access present; Chat 22 owns scanning/bookmark creation rules |
| Maps, Intel | `mapService.GetHistory/GetCurrentSovData/GetRecentSovActivity/GetSolarsystemItems/GetMyExtraMapInfo`; existing `coopSystemIntel` / `coopNpcIntelLedger` | Native read-only map RPC, existing opted-in world intel; no new UI overlays |
| Overview | `overviewPresetMgrService.StoreLinkAndGetID/GetStoredPreset` | Native preset read/write path present; local client overview presentation NOT_RUN |

The proprietary client source/assets were not available to inspect/modify. The presence of server handlers does **not** mean all menus, tooltips, broadcasts, map markers, overview presets, or status notifications have been verified in the actual client. Nothing here edits the client or guesses unimplemented message schemas.

## Confirmed source issues and safe changes

**1. Scoped chat ownership** — `chatRuntime.getChannelAccessFailure` derives corp/alliance/fleet identifiers from mutable session fields. A stale reconnect after leaving a fleet or switching corp may still present an old room identifier. New `integration/coopSocialRoomAuthority.cjs` checks selected character (no account userid fallback), canonical current character and corporation, real alliance membership index, and real fleet `members` Map. Non-scoped local/private/player channels are left to existing native access/moderation rules. Hook happens in the existing `getChannelAccessFailure` for join and message paths, not a new RPC.

**2. Non-durable chat event** — original `chatStore.writeBacklogEntries` changes backlog cache before checking `database.write` result. `appendBacklogEntry` then returns true regardless, and `chatRuntime.sendChannelMessage` publishes a live `channel-message` even on failure. Strict hook performs copy-on-write to original `chatBacklog` table, uses native `database.flushTableSync` before cache publish, and throws an existing XMPP-handler-catchable error if persistence is uncertain. All subsequent strict sends fail closed until operator reconciliation. No message is announced as durable based only on memory.

**3. Non-durable mail announcement** — `mailState.sendMail` originally calls `repo.write` and then `sendMailSentNotification/createNewMailNotification` without a synchronous flush of the original mail table. Strict hook clones the original mailbox state and confirms `repo.flushTableSync("mail")` before EVEmail/notification fan-out. On uncertain flush it emits no mail-sent notification and keeps subsequent sends blocked until operator reconciliation; ordinary client `mailMgr` return shapes remain unchanged.

**Important:** Chat message stanzas have no universally proven original immutable client request ID in these source paths, and a host crash between a successful SQLite flush and XMPP delivery cannot guarantee exactly-once delivery; recipient may need backlog replay. A live database write followed by failed fsync is ambiguous: this code **does not** roll back or delete potentially committed mail. Review original tables/receipts manually before re-enabling strict mode. Atomic mail + new-notification write across two original service tables is **not** implemented. Room writes in single GameStore owner-process are assumed; multiple concurrent OS writers need a coordinated durable transaction.

## Files and Chat 01 central installer handoff

- `integration/coopSocialRoomAuthority.cjs` — read-only canonical corp/alliance/fleet membership proof.
- `scripts/coop-social-native-guards-patch.cjs` — reversible source transformations (three target paths):
  - `server/src/_secondary/chat/chatRuntime.js`
  - `server/src/_secondary/chat/chatStore.js`
  - `server/src/services/mail/mailState.js`
- `tests/coop-social-room-authority.test.mjs`, `tests/coop-social-native-guards-patch.test.mjs`, `tests/scenarios/coop39-two-client-social-native-e2e.json`.

**No edit to `scripts/patch-evejs-coop.cjs`** (owned by Chat 01). It must copy helper to original `Code/server/src/space/coopSocialRoomAuthority.js`, chain this patch in the existing transaction, confirm pin and overlap/drift with Chat 31 / Chat 04 / Chat 21, and run dry-run and byte-exact remove roundtrip on the pinned source. Enable `EVEJS_COOP_SOCIAL_NATIVE_GUARDS=1` only in a disposable EveJS world after successful native Node/sqlite/client validation. Default remains OFF. The XMPP service only uses original `sendChannelMessage`; thrown errors take the **existing** `formatChannelAccessError` response, not invented notifications.

## Source-level verification in this chat

- **8/8** original helper-source tests in an isolated V8 harness: A/B corp isolation, alliance index, native fleet membership, stale reconnect, account-vs-selected-character mismatch, and public/local preservation.
- **4/4** reversible patch tests in the same harness: LF/CRLF, source drift, default-OFF flag, idempotence and byte-exact removal.
- **6/6** durability assertions executed against actual pinned `chatStore.js` source after the patch in a mock GameStore: initial commit, readback, synchronous flush, failure suppresses delivery, local cache not prematurely advanced and fail-closed quarantine.
- **6/6** tests executed against actual pinned `mailState.js` source after the patch with original modules' interface/mocked GameStore: mail emitted only after successful flush, no phantom notification on failure, further send blocked after unknown commit.
- All three pinned original source files were syntax-parsed after transformation and exactly restored on remove.

These are source-backed but **simulated GameStore**, not real SQLite durability, actual post-power-loss restart, runtime XMPP server delivery or actual client UI. Official `node --test tests/coop-social-room-authority.test.mjs tests/coop-social-native-guards-patch.test.mjs` was NOT executed in a full repository checkout in this chat. Always run in disposable original source before deployment.

## Two-player gameplay gate — NOT_RUN

See `tests/scenarios/coop39-two-client-social-native-e2e.json`. Requires actual A/B sessions, fleet/corp/alliance changes, local system jumps including delayed local, shared bookmarks, EVEmail read/unread, notification read/deletion, map/overview settings changes, legitimate broadcast, reconnect and server restart between phases. For each compare real mail/notification/chat/Bookmark/Map state, original item/identity authorities and client UI—not server emit calls alone.

**Result:** scoped native chat access and durable mail/backlog acknowledgement guards are staged, rather than pretending this commit completes all client-visible social interactions. UI, service setting persistence and two-client delivery still require live evidence.
