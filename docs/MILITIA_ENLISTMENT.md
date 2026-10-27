# Faction militia enlistment — what really passes the gate

The stock Agent dialogue hook (`integration/coopFactionWarAgent.cjs`, deployed as
`coopFactionWarAgent.js`) refuses to enlist a character unless **every** one of
these is a real native record:

1. `getAgentByID(agentID)` returns that agent, `isInSpace !== true`,
   `stationID`, `solarSystemID` and `corporationID` all positive.
2. The character session is docked at exactly that agent's `stationID`
   (`getDockedLocationKind === "station"`).
3. `getFactionForCorporation(agent.corporationID)` resolves the agent's
   corporation to a faction that has a **real `militiaCorporationID`** and that
   faction is listed in `EVEJS_COOP_MILITIA_FACTION_IDS`.
4. `getFaction(factionID)` returns the same faction with the same
   `militiaCorporationID`.
5. `getEffectiveStanding(characterID, factionID).standing >= 0`.

No station, corporation, agent or standing is created by the co-op layer. If one
is missing, the agent answers with the stock refusal and nothing is written.

## Measured SDE state (live container, read-only probe, 2026-10-27)

| faction | name | `militiaCorporationID` | agents at a real station | can enlist |
|---|---|---|---|---|
| 500001 | Caldari State | **1000180** | 3041 in 12+ systems | **yes** |
| 500002 | Minmatar Republic | 1000182 | 1384 | yes |
| 500003 | Amarr Empire | 1000179 | 2332 | yes |
| 500004 | Gallente Federation | 1000181 | 2297 | yes |
| 500010 | Guristas Pirates | 1000437 | 70 | yes (no live front) |
| 500011 | Angel Cartel | 1000436 | 193 in 39 systems | yes |
| 500020 | Serpentis | `null` | 82 | **no** — rule 3 fails |
| 500014 | ORE | `null` | 22 | **no** — rule 3 fails |

So the live allowlist is exactly the six factions with a real militia
corporation: `500001,500002,500003,500004,500010,500011`. Serpentis and ORE
cannot recruit in this SDE at all: their `factions` row has
`militiaCorporationID: null`, and the agent gate requires a positive value. That
is a data fact, not a missing feature.

## The owner's faction (from his own character record)

`characters.140000005` "Sasunok1488": `raceID 1` (Caldari/Civire),
`bloodlineID 2`, `corporationID 98000001`, **`factionID 500001` Caldari State**.
Caldari State carries `militiaCorporationID 1000180`, and its wartime opponent in
the game's own faction-warfare pairing is **Gallente Federation 500004**
(`fwWarzoneSolarsystemService.js`, `WARZONE_CALDARI_GALLENTE = 2 ->
[500001, 500004]`).

## The nearest real Caldari enlistment desk (1 jump from Jita)

```
faction          500001 Caldari State   militiaCorporationID 1000180
agent            3010879  Okamainen Niuranto  corporationID 1000004 (Ytiri)
station          60000358  Perimeter VI - Ytiri Storage
system           30000144  Perimeter (the same station the mining fleet uses)
```

Other verified desks in the same neighbourhood: 3010986 "Inikko Samanuni" at
60000682 (New Caldari), 3012018 "Ogyura Unao" at 60003754 (Perimeter), 3008416
"Antaken Kamola" at 60000004 (Muvolailen, 1 jump).

## The Angel Cartel desk (for the pirate war)

```
faction          500011 Angel Cartel      militiaCorporationID 1000436
agent            3010015  Edilkam Silera  corporationID 1000124 (Archangels)
station          60012235  G-0Q86 V - Moon 5 - Archangels Logistic Support
system           30001041  G-0Q86          region 10000012 (Curse)  sec -0.02
```

14 real stargate jumps from Jita:

```
30000142 Jita > 30000143 Niyabainen > 30001379 Tunttaras > 30001376 Nourvukaiken
> 30002813 Tama > 30045346 Kedama > 30045345 Hirri > 30045353 Pynekastoh
> 30045338 Hikkoken > 30045344 Nennamaila > 30003837 Aldranette
> 30003836 Vlillirier > 30003841 Alsavoinon > 30100000 Zarzakh > 30001041 G-0Q86
```

Every hop is a real reciprocal stargate from the loaded SDE (`worldData.getStargatesForSystem`).

## What the client shows

* Docked at 60012235, the station agent list contains **Edilkam Silera** (level 1,
  agent type 2). Talking to it opens the stock agent dialogue with the
  `[Militia] Enlist with Angel Cartel?` prompt; **Accept** writes the enlistment.
* After Accept the same dialogue reports `[Militia] Enlistment recorded for Angel
  Cartel. No items or ISK granted.` and, with
  `EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE=1`, the live front line text.
* The enlistment is one `corporationRuntime` row
  (`coop-faction-war\u001fstate-v1` → `enlistments.<characterID>`), status
  `ACTIVE`, `factionID 500011`, plus a `history` entry. No ISK, item or
  corporation membership changes.

## Why the allowlist is exactly those six

`EVEJS_COOP_MILITIA_FACTION_IDS` is an operator allowlist on top of the native
proofs, so it may only contain factions that can actually satisfy all five
rules. Adding 500020 or 500014 would change nothing except the error path: the
gate refuses them before the allowlist is even reached.

## Enemy selection is data, never a list

`integration/coopMilitiaWarData.cjs` resolves the opponent in this order:

1. **A war that is really declared in this world** (`warState.wars`), which is
   only ever opened from real territories and real reciprocal stargates. This is
   the war the player can actually join, so it wins.
2. **The game's own faction-warfare pairing** when no war is declared yet:
   Amarr 500003 <-> Minmatar 500002, Caldari 500001 <-> Gallente 500004
   (mirrored from `fwWarzoneSolarsystemService.js`; a test re-reads that service
   source and fails on drift).

A pirate pair such as 500011/500020 is not in the warzone table, but it is a real
declared war in this world, so it still works — the declared war is authoritative.
