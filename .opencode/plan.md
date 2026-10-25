# plan — world liveliness (owner asked for all five)

## Live now (config only, applied via Deploy-Coop-RuntimeProbe -LivingCoop)
1. Population/route: `-VirtualPopulation 100 -VirtualRouteSystems '30100032,30000144,30000142,30000145'`
   `-VirtualTravelSeconds 60 -MaterializeLimit 14`.
3. `-EnableFactionPatrols` (demand for patrols; watch `virtual-faction-patrol` status change from NO_DEMAND).
5. Convoy tempo: `EVEJS_COOP_HAULER_HOLD_MS` 120000 -> 45000 in the deploy script.

Verify after deploy: `virtual-world-presence.residentCount` per system,
`living-native-materialization-attempt.requestedSpawns`,
`living-native-activity.physicalNpcShips/observedMovement`,
`living-native-industry.status=ACTIVE` in Perimeter,
`virtual-faction-patrol` no longer NO_DEMAND.

## 2. NPC chatter in local chat (code, next)
- L2 module `integration/coopNpcChatter.cjs`: picks a resident that already has a physical
  native ship in the scene, builds one role-appropriate line (miner/hauler/pirate/patrol),
  respects per-system cooldown and a hard cap per minute.
- One L1 hook in the world tick path, `EVEJS_COOP_NPC_CHATTER=1`, default OFF.
- Delivery through existing `chatHub` local channel; never invent ships, kills or ISK.
- Tests: cooldown, cap, role text, no message when no physical ship, no message for other systems.
- Wire the flag in `Deploy-Coop-RuntimeProbe.ps1` next to `EVEJS_COOP_AGENT_DIALOGUE`.

## 4. Native NPC market (separate gate, NOT enabled by default)
Per `docs/NATIVE_NPC_MARKET.md`: only real seeded-market stock, exact native cargo,
NPC's own earned-ISK ledger, empty allowlist means no trades, ambiguous RPC halts trading.
- Needs a disposable live server first (owner-verified), never the main world.
- Do not enable in `-LivingCoop` until that gate passes and the owner confirms.

### Disposable-world runbook (not yet executed)
1. Separate compose project name and separate volumes so the live world is untouched:
   `docker compose -p evejs-npcmkt-test -f compose.yaml -f compose.coop-probe.yaml up -d --build`
   with `EVEJS_COOP_NATIVE_NPC_MARKET=1`, `EVEJS_COOP_NPC_MARKET_SELL_TYPES=<seeded ore typeIDs>`,
   `EVEJS_COOP_NPC_MARKET_BUY_TYPES=<seeded typeIDs>`, `MAX_QTY=1`, `MAX_PRICE=1000`.
2. Only type IDs that the target station's region really buys (`source="seed"`) in that seed.
3. Expected evidence: `living-native-npc-market` probe events only after an NPC with real cargo
   sells; buys only from earned ISK; no duplicate fill after restart; `RPC_OUTCOME_UNKNOWN`
   stops trading instead of retrying.
4. Tear down the test project and volumes afterwards; never copy its DB into the live world.

## Evidence to report (no claims without these)
- Server events listed above, `-Action World -WorldSystemID 30100032`,
  `-Action Party` after the owner logs in, and a human-visible screenshot of an NPC in the
  owner's system.
