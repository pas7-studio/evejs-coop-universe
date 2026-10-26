# Chat 38 — native NPE identity and onboarding state hardening

**Status: CODE_READY / LIVE_UNVERIFIED.** One final change set for pinned
`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Native capabilities identified (do not replace)

- `charService.Handle_CreateCharacterWithDoll` writes an authenticated account-bound character, resolves race/school and starter region, writes the original wallet and skill state, calls original `rookieShipRuntime.spawnRookieShipForCharacter` and persists relevant native tables.
- `rookieShipRuntime` has `reuseExistingShip` behaviour. Do not add a second rookie-ship grant or synthetic starter ISK/SP/PLEX/items.
- `npe/tutorialRuntime` already manages `tutorialEntryMode`, `airNpeState`, `nesIntroState`, first-login handoff and skip transitions in original character state.
- `tutorialSvcService` already exposes the native school-based career agent list. Original `agentMissionRuntime` owns mission rewards and first mission status; `fleetRuntime` owns actual in-game fleet membership.
- Supported Starter Space is **not confirmed** from this pin. No fake Rookie Dungeon, synthetic scene or client protocol invented.

## Confirmed issues addressed

1. `airNpeService` / `nesIntroService` accepted arbitrary positive IDs in RPC arguments and used those IDs to read or mutate the tutorial state without checking selected character/account. CH38 now optionally enforces selected authenticated character, matching aliases, live socket and original character `accountId`.
2. `tutorialSvc.Handle_GetCharacterTutorialState` always returned `0` even with an active native tutorial. Under the same flag, this now returns the actual `tutorialRuntime.getCharacterTutorialSnapshot` category state, with no write.
3. `achievementTrackerMgr` replied with a hardcoded list of dozens of completed achievements and event counts when no persisted record existed, and assumed `HasEverWarped=true` without evidence. Under the same flag, missing progress resolves to empty lists and warp=false; genuine persisted records are retained. The client achievement-update RPC remains native/no-op; **not** counted as progress or reward proof.

`EVEJS_COOP_NPE_NATIVE_SAFETY=1` is OFF by default until the exact client's UI state shapes are tested. All changes are reversible in `scripts/coop-npe-native-state-patch.cjs`, installed via the normal pinned `scripts/patch-evejs-coop.cjs` and `integration/coopNpeSafety.cjs`. No external dependency and no alternative onboarding storage.

## Verification

Local `node --test tests/coop-npe-native-state.test.mjs` covers independent players, cross-character spoofing, account ownership, disconnected session, incorrect alias, native state lookup, default-off semantics, and four reversible patches with CRLF. Native reward state is deliberately not modified.

**Not tested:** actual dual authorized client login, character creation/school selection, starter vessel in client and native cargo after restart, tutorial UI return value and cinematics, novice mission completion, combat kill, legitimate career-agent reward once, achievements event provenance, Starter Space client/assets support, real fleet invitations and joining, full end-to-end item/ISK persistence. No Docker server, original GameStore worker, or deployed world was available in this session. Do not claim gameplay PASS from unit tests.

## Live acceptance on disposable preserved-world copy, operator controlled

1. Verify overlay installed at the pinned upstream SHA with safety flag ON (only after compatible-client protocol check); capture actual server and client revisions.
2. Create **two distinct accounts/characters** selecting schools; assert each has one real race-appropriate rookie ship, correct station, one native starter wallet/SP balance, independently persisted tutorial state. Reconnect/restart; assert no duplicate starter resources.
3. As character A, attempt B's `air_npe` / `nes_intro` get/skip RPC; ensure no state change. As B confirm independent state, school career agents and content/UI. Test skipping only B's tutorial then reconnect.
4. First session: tutorial + career-agent dialogue without GM commands, first accepted mission, objective, actual native space combat, first mission delivery, reward exactly once (ISK, native item inventory, LP and standings). Test retry/disconnect around reward; existing mission payout path is **not proven crash-atomic**.
5. Invite B into an **actual native fleet** via in-game fleet RPC; verify both pilots, warp to the mission/site, first combat target, XP/mission rights without duplicate rewards or accidental corp membership.
6. Evaluate whether Starter Space and achievements/titles are really supported by pinned client RPC/assets. Any gap must be reported as `UNSUPPORTED` rather than fabricating authority.

No wipes of `evejs-data`, marketplace resets, bypassed tutorial state, client modification or auto-created rewards.
