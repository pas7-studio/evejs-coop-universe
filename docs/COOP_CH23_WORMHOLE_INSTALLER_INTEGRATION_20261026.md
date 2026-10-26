# CH23-WIRE — Native Wormhole Transit Fence integration (2026-10-26)

**Status: SOURCE_WIRED_ON_BRANCH / NOT_MERGED / NOT_DEPLOYED / LIVE_UNVERIFIED.**
Related source: `docs/CHAT23_WORMHOLE_NATIVE_TRANSITION_CONTRACT.md`. Exact EveJS pin: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, EVE client build `3396210`.

## Why this change
- Current `main` at the branch point `003b97380dbf73e3c3f5aa5ecdd1fdf7d7d4b4b4` introduced literal `\\n` text **outside strings** at two places inside `scripts/patch-evejs-coop.cjs`, preventing Node from parsing the **single central installer**. This branch restores real newlines and adds an unconditional syntax regression test.
- A full opt-in wormhole mass/departure journal and reversible pinned source patch already existed as `coopWormholeJumpFence.cjs` + `coop-wormhole-jump-fence-patch.cjs`, but the central installer omitted their native registration. Add them to the **existing** `names`, `specs` and `transform`, not a second installer.
- The module remains default **OFF**. No changes to `compose.yaml`, Docker volumes, persisted character state, market, world, client binaries or existing native transit when disabled.

## Reused original EveJS authority
- `wormholeMgrService.Handle_WormholeJump` remains the sole client RPC.
- `wormholeRuntime.prepareJump/commitJump/buildJumpSpawnState` own mass, pair visibility, polarization, collapse and native wormhole exit.
- `wormholeRuntimeState` and original `gameStore.flushTableSync("wormholeRuntimeState")` are authoritative; file tickets are only anti-replay/quarantine, not a replacement database.
- `jumpSessionToSolarSystem`, real session/ship/scene and native system-wide effects own the physical transition. This does not fabricate bookmarks or warp, and does not route through stargates.

## Safety / limitations
- No automatic mass refund if the original mass debit commits but character transfer fails. The operation becomes `NEEDS_OPERATOR_REPAIR`, and the same character cannot re-enter until original authoritative state is reconciled.
- Production data and any `evejs-data` volume must remain untouched.
- Pinned native source, actual Node/SQLite, real two-client wormhole entry, exit client FX and cross-process crash behavior still require owner-side acceptance.
- A source roundtrip proves the installer can apply/remove the patch byte-for-byte, not that the two game clients display a successful transit.

## Manual local acceptance (disposable checkout and data only)
1. `node --check scripts/patch-evejs-coop.cjs`
2. `node --test tests/coop-wormhole-jump-fence.test.mjs tests/coop-wormhole-jump-fence-patch.test.mjs tests/coop-wormhole-installer-integration.test.mjs`
3. Point `EVEJS_COOP_CODE_PATH` to the exact pinned **authorized** EveJS `Code` checkout and rerun the tests.
4. `node scripts/patch-evejs-coop.cjs --code-path <pinned/Code> --dry-run`, followed by review of the changed file list. The transaction is intentionally **not executed here**.
5. In disposable test runtime only, configure `EVEJS_COOP_WORMHOLE_JUMP_FENCE=1` and `EVEJS_COOP_WORMHOLE_JOURNAL_DIR=/var/lib/evejs/coop-wormhole-jump-tickets` with one authoritative writer and persistent directory permissions; never enable by default.
6. Two independent authorized clients: native probe -> permissioned bookmark -> real ship within 5 km of native endpoint -> A and B traverse the same pair. Verify original paired mass before/after, 5-minute polarization, actual destination scene, same hull IDs, cargo/fittings, collapse and replay safety. Force a disposable crash between mass flush and destination jump; expect quarantine, not free travel.

**Definition of done:** replay/collapse/polarization/ownership negative cases + native Node/SQLite/Gamestore restart acceptance + actual two-client destination visibility. No `GAMEPLAY_READY` claim before this.
