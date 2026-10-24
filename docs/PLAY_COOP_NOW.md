> **Current testing priority (2026-10-25):** See
> [GAMEPLAY_TESTING.md](GAMEPLAY_TESTING.md) first. A healthy Docker backend
> and passing regression suite **do not prove actual NPC gameplay**.
> Missing `/var/lib/evejs/coop-events.jsonl` with headless boot enabled
> means `BLOCKED_TELEMETRY`: use the read-only
> `Local-Two-Client-Test.ps1 -Action DiagnoseWorld`. The headless boot
> request should be logged even with no real client. Do not rerun
> npm audit or rebuild market data to overcome a missing event file.
> A compatible authorized EVE client and human observation are required
> for actual visible gameplay and two-character `Party` acceptance.

## Autonomous NPC battles, retreats and rescue

The default LivingCoop now enables native tactical decisions for
**already existing named NPC ships** alongside stock EveJS mining-fleet
AI. There are no arena waves or scripted fatalities.

When a native EveJS NPC controller records recent aggression, other
physical NPCs of the same faction can respond. Civilian pilots ask
patrols for assistance; attacked pirates can call allied pirates.
At most **two existing allies** are redirected per request. They use
real EveJS warp and attack orders, so a rescuer from a distant grid
must actually arrive before firing.

An injured NPC (armor below 28% or structure below 72%) may initiate
a real warp to an existing station or stargate sufficiently far from
its attacker. Warp scramble prevents the escape. On arrival the NPC
holds out of combat briefly, then returns to normal native EveJS
behavior. Failed warps never count as escapes.

You may notice an NPC call for help or try to retreat in local chat.
These messages describe actual server orders, not guaranteed outcomes:
the ship can still be destroyed while escaping, or the help can
arrive too late. `-Action Party` displays observed calls, retreats,
and genuine reinforcement orders.

The tactical logic is independently unit-verified; the actual EVE
client visuals, damage simulation, warp arrival and shared combat
still need a live client playtest.

**Testing priority:** prove real headless NPC events and activity first; only then the visible EVE client and two-player gates. P1 features stay disabled until separately tested. See [GAMEPLAY_TESTING](GAMEPLAY_TESTING.md).

## Experimental headless native NPC boot## Experimental headless native NPC boot (new code, not live-proven)

The LivingCoop overlay now requests a bounded **server-side bootstrap**
of both configured systems after startup; it no longer needs the
first player's login just to attempt native NPC scene materialization.
It checks actual EveJS asteroid belts, stock mining ships and physically
linked named NPC ships. Missing scene elements remain PENDING and are retried with bounded
backoff, rather than being reported as success.
The server writes `living-headless-boot-requested` and
`living-headless-boot-system` diagnostics into the regular persistent
event log. This code has **not** been verified inside a live EveJS container.

For an already installed overlay, use **read-only** `-Action DiagnoseWorld`
and then `-Action World` without a client to assess native topology and
NPC activity. `-Action CoopStart` is for explicit deployment only. A physical server-side
ready result is only a **READY_FOR_CLIENT_PLAYTEST** gate, not proof
of client rendering, combat, fleet movement, player loot or reconnection.

For established 20-NPC saves, `CoopStart` enables the faction-layout-v2
migration. It creates `coop-virtual-world.json.pre-faction-layout-v2.bak`
before any pilot faction remapping. Pilot names, IDs, travel progress
and live EveJS ship references are retained; old named-NPC narrative
faction allegiance may change. A conflicting backup fails closed.
Review the backup before restoring an older world or making manual edits.

Individual remembered NPCs may also acknowledge a previously encountered
authenticated player in a **private system notification**, but only
when both the real player ship and the named native NPC ship are within
80 km in the same system. These notifications are throttled and are
not fake player chat or a complete dialogue engine. No gameplay
claim until native-client observation confirms actual delivery.

**No GitHub Actions / CI**: automatic workflows were removed by owner request.
Run local tests manually when needed; do not add or trigger remote CI.

## Current operator result — October 25, 2026

The existing run at project commit `cc5ce83` confirmed backend health and
72 local / 27 upstream contract tests, but **no native NPC event file**.
The immediate task is read-only `-Action DiagnoseWorld`, then `World`
after the event stream is fixed. Backend/Powershell/NPM auditing is not
a substitute for verifying the live world. See
[GAMEPLAY_TESTING](GAMEPLAY_TESTING.md).

# Play EveJS Living Universe with a friend# Play EveJS Living Universe with a friend

**No arenas and no scripted PvE waves in the default game mode.** Both
players enter one persistent EveJS world, encounter named, autonomous
NPC pilots and choose whether to hunt pirates, raid civilians, explore,
trade, or use ordinary fleet mechanics.

This integration still requires verification with real EVE clients.

## Test the existing deployed world

Do **not** run `git pull`, `Prepare`, `CoopStart`, a market rebuild,
or patch installation merely to verify an already-running universe.
These commands belong to deliberate setup/update workflows
([FIRST_RUN](FIRST_RUN.md)) and may mutate state or replace local test fixes.

From your existing co-op project checkout, with the already-running
server:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld
.\scripts\Local-Two-Client-Test.ps1 -Action World
```

When `World` has actual physical server evidence, test one authorized
compatible client manually before using `LaunchTwo` and `Party`. A
headless boot event does not require any client. Follow the ordered
[gameplay acceptance matrix](GAMEPLAY_TESTING.md).

## Living Universe behavior to look for

This now enables a world withThis now enables a world with **20 persistent NPC identities** across
two solar systems and at most six native physical NPC ships in each
visited system. NPC roles include **miners, haulers, traders, patrols
and pirates**. Their ship names show their occupation. Pirates retain
native EveJS hostile AI. All native ship movement, targeting, damage,
wreck and looting remains owned by the EveJS server.

**Native mining integration:** the pinned EveJS already implements
real mining NPC fleets. LivingCoop now enables one stock mining fleet
per configured system (two miners and a hauler), automated mining
modules, real asteroid depletion, NPC ore cargo, hauling, and the
native mining fleet's response to aggression. The co-op overlay binds
available named virtual miners and haulers to those genuine stock
ships instead of spawning a second set of fake miner NPCs.

**Hauler gameplay:** on the stock hauling cycle, mined native ore items
are reassigned from the miner's authoritative NPC cargo to the
physical hauler's cargo. The loaded ship remains at the
mining site for **two minutes** before beginning its return warp, giving
you time to defend, chase or intercept it. If destroyed while loaded,
EveJS's own wreck code can drop that cargo. At the return point the
hauler unloads it into a **virtual depot sink**: player-visible market
sell orders and station inventory delivery are NOT implemented yet.

**Organic conflict:** some of our named pirates independently discover
ore-bearing native miners and haulers, warp toward them and issue native
NPC attack orders. Their targets are actual existing ships, and the
mining fleet's stock aggression response can react. There are no
extra enemies created by this event; the fight can happen even if
you and your friend do nothing. Pirate-vs-miner combat effectiveness
must be checked with real EveJS NPC controllers and clients.

The independent virtual economy/faction plans still run as background
bookkeeping rather than real item ownership or market orders.
Destroyed named ships are recorded; the pilot has
a **30-minute clone/ship recovery period**, not instant respawn.
Visited systems are reconciled again in the background after recovery.
There is no co-op NPC arena, scripted round, wave timer or wave cap.

The default simulation route includes solar systems 30000142 and
30000144. A different initial ID can be supplied using the
-NpcSystemID parameter. Keep a backup before changing established
saved world routes.

## Play together

On the host launch one client:

~~~powershell
.\scripts\Local-Two-Client-Test.ps1 -Action LaunchOne -ConfirmClientPermission
~~~

For two independently authorized client instances on the same PC:

~~~powershell
.\scripts\Local-Two-Client-Test.ps1 -Action LaunchTwo -ConfirmClientPermission
~~~

On another PC, see [private tunnel setup](FRIEND_PC_PRIVATE_TUNNEL.md).
It is an experimental Tailscale/SSH connection with authentication and
strict SSH host-key checks. Do not expose Docker publicly.

Once in space, join a normal EveJS fleet if desired, explore belts,
stations and gates, follow existing NPCs or fight pirate ships. NPC
ships are not spawned because you arrive together. You can meet after
warp or fly separately, and each sees the same authoritative world.

Check server-side evidence, including actual living NPC wreck losses:

~~~powershell
.\scripts\Local-Two-Client-Test.ps1 -Action Party
.\scripts\Local-Two-Client-Test.ps1 -Action Logs
~~~

These commands do not certify that both EVE clients render the same
combat, that loot-sharing works, or that network credentials are valid.

## Important limitations

**Real mining and haul cargo are implemented against stock EveJS APIs**,
including physical mineable-rock depletion and ore in native NPC cargo.
However, unloading currently removes cargo into a virtual depot;
it does not debit or credit real EveJS station inventories, contracts,
player wallets or independent NPC-owned sell orders. The separate
seed-market adapter and same-ship stargate transfer are experimental,
**off by default and not live verified**; see
[NATIVE_NPC_MARKET](NATIVE_NPC_MARKET.md) and
[NATIVE_NPC_GATE_TRAVEL](NATIVE_NPC_GATE_TRAVEL.md).
Never claim a virtual route proves real inter-system travel.

Two-client login, loot observation, fleet warp, reconnect and second-PC
TLS/certificate compatibility require a real two-client game test.

## Stop without wiping progress

~~~powershell
.\scripts\Local-Two-Client-Test.ps1 -Action Stop
~~~

Do not run Docker down -v during normal play. The persistent EveJS
named volume and co-op state files are retained. Legacy one-off NPC
demo and scripted wave modes are opt-in development tools, not the
recommended way to play.

### Emergent things to do together

**Protect the miners:** find a native mining fleet at an asteroid belt,
observe ore extraction and assist when pirates approach. EveJS's stock
mining defense AI can react to aggression independently of your party.

**Intercept ore transport:** wait for a hauler to become loaded. The
two-minute loaded staging phase keeps the real ore aboard a physical
ship long enough for a meaningful PvE attack or escort. Its wreck uses
the stock NPC cargo-to-wreck path; there is no fabricated reward chest.

**Follow an actual pirate raid:** when one of our named pirates pursues
an ore-bearing miner or hauler, the server sends a short system message
using EveJS's ordinary local chat delivery. The fight uses native NPC
warp and attack orders, and you may join or ignore it. Signals are
issued only for actual raid orders, not for a scheduled arena event.

The native mining fleet initially waits roughly three minutes before
its first haul, with a 20% fill threshold and at least ten minutes
between hauler runs. These values are intentionally accelerated for
a short two-player session compared with stock EveJS's 90-minute
initial timer. All fleets remain bound by actual mined ore supply.

`-Action Party` now includes ore quantities still on miners and ore
loaded onto physical NPC haulers. These measurements are sampled server
evidence, not a guaranteed live tactical UI.

### Real player consequences: reputation is not just a log entry

When a verified player attacks a real EveJS mining fleet, LivingCoop
records a **combat standing transaction** using the original EveJS
standingRuntime.applyStandingChanges API against the physical NPC's
faction/corporation owner. At most one penalty per player and fleet
per 15-minute window is allowed, with a durable event ledger.

The initial mining-fleet assault records a raw -0.25 standing change.
Stock EveJS standing calculations remain authoritative. A low-standing
aggressor faces four mining-fleet defenders, compared with two for
neutral and zero for friendly players. Autonomous NPC pirate raids do
not penalize synthetic characters: real player sessions are required.

Destroying a named pirate can change standing with its owner **only
when native wreck options prove an authenticated player killer**.
When the pirate was targeting a real mining ship, that player may also
receive +0.18 raw standing with its faction/corporation owner.

The game uses native EveJS standings, not a separate reputation counter.
Durable event IDs prevent duplicate penalties/rewards across restarts.
The game sends targeted local-chat notices for applied changes; the
Party diagnostic includes the recent standings events. Unattributed
kills receive no invented reward.

Actual client standings display and combat kill attribution still
need live Docker verification with both players.

### More playable Living Universe: repairs and useful in-game intel

The deployment script has been completely rebuilt after discovering a
corrupted duplicate of its PowerShell body and an invalid parameter
validation expression. It now preflights the pinned EveJS source, validates
the **effective** Docker Compose configuration including loopback-only
published ports, installs the reversible patch, rebuilds the existing server
and preserves all named persistent data volumes. There is still no
confirmed two-client Docker playthrough.

On a player's first in-space arrival, the server can now send a short
**local intelligence brief through regular EveJS chat** using only
actual server scene data: current miner/hauler activity, a loaded ore
transport and visible pirates. When a real matching POI exists within
300 km of an NPC ship, it names that asteroid belt, station or gate.
It will not fabricate a location, and the same character will not receive
the briefing more than once per 90 seconds in a given system.

When pirates pursue a real ore-bearing NPC, they keep their live combat
or pursuit orders instead of being redirected by the civilian travel
scheduler. Local piracy alerts likewise name a real nearby POI, when
available. You can decide to defend the shipment, intercept it, or
ignore the situation and continue exploring.

Ore transferred to an EveJS hauler now carries a fleet-specific
manifest. Its unloading operation removes **only that fleet's own
loaded ore**; unrelated items already present in the hauler's cargo
are preserved. A destroyed hauler still uses EveJS's real wreck
contents.

Actual delivered ore is recorded once per native cargo ID in
`/var/lib/evejs/coop-native-depot.json`. The existing virtual
system-economy module now imports the **newly delivered** quantity as
goods in that solar system and reduces virtual demand. It persists
how much has already been credited, so a server restart cannot
duplicate the same delivery. This creates measurable world consequences
from real NPC logistics, but it is **not** a real EVE station inventory
deposit, market sell order or player wallet payout.

Use `-Action Party` to inspect recent mined ore, transport loads,
pirate raids, deliveries and the supply changes from those deliveries.
Full in-game client behavior must still be validated before treating
these mechanics as proven.

## Physical encounter placement: Perimeter duo PvE

The lower-level `Deploy-Coop-RuntimeProbe.ps1 -LivingCoop` default now allows **3 named native NPC hulls per visited system**, unless an operator explicitly sets `-MaterializeLimit`. The normal `Local-Two-Client-Test.ps1 -Action CoopStart` workflow **explicitly uses 6** per visited system; this override is retained, so an existing 20-pilot co-op world is not silently reduced to three. Named pirate and patrol hulls start near a **real EveJS asteroid belt** in Perimeter when one exists. Traders prefer real stations. Beltless Jita keeps real stargate/station anchors, with no synthetic belts. Upstream EveJS mining fleets are separate genuine native ships, not dummy co-op miners.

This affects **newly materialized** named NPC ships only: already persistent physical hulls are not relocated or respawned just to follow a new anchor policy. Actual attack, damage, native wreck, two-client loot and NPC movement still require live evidence.

After an owner-approved overlay refresh preserving the `evejs-data` volume and local upstream fixes, first run `-Action DiagnoseWorld`, then `-Action World -WorldSystemID 30000144`. Only after real native NPC activity is confirmed, manually bring two authorized clients to the same physical Perimeter belt. Verify both can see and attack an existing pirate, see actual damage/wreck, and cannot duplicate loot. No CI, unattended deployment, market rebuild or merge is needed for this code change.

## P0 gameplay update — finish real pirate attacks and recognize your wingmate

The default `CoopStart` (`-LivingCoop`) now enables the real two-pilot native scene coordinator and low-noise in-game rendezvous notices. When **two separately authenticated player ships** are physically within 250 km, Ballpark-ready in the same authoritative EveJS scene, both players receive a single ordinary **EveJS system chat** message. This is rate-limited per duo (five-minute cooldown), creates no pseudo-player, no fleet, and no combat entity. Actual native fleet membership and reciprocal client rendering still require a live game check. A one-player or headless server cannot trigger the two-pilot notice.

**Pirate convoy gameplay fix:** An autonomous named pirate now transitions from a genuine EveJS warp toward an ore-bearing stock miner/hauler to an actual EveJS `issueAttackOrder` after landing. The raid keeps the same legitimate convoy target rather than switching to a closer unrelated NPC. It does NOT override active player engagements, other genuine native NPC targets, recent retaliation, explicit external manual orders, or ships already in warp. It never applies synthetic HP loss or creates loot. If there are no real ore-carrying stock hulls, there is no invented pirate raid.

To try one actual cooperative activity **after the approved version has been deployed**:

1. Both players log in with their own authorized EVE accounts and meet within 250 km in one system. Check that the two real ships appear; the chat rendezvous notice is only additional feedback.
2. Fly to **Perimeter (`30000144`)** and locate a stock mining convoy near a genuine asteroid belt. **Jita (`30000142`) has no asteroid belts**, so a belt-focused convoy encounter should not be expected there.
3. Watch real miners collect ore, decide together whether to escort a loaded hauler or investigate a roaming pirate, and engage using the ordinary EVE controls. A real native pirate may warp in and attack the ore-bearing ship; it is not a timed scripted spawn.
4. Use `-Action StockRaid`, `-Action StockRaidLoot`, and `-Action LootPickup` to inspect server evidence. In both clients, check actual shared combat, wreck contents, single withdrawal, normal fleet warp, and reconnect without a ship clone.

All gameplay changes are reversible in the pinned source overlay and tested on isolated native scene fixtures. **This is not yet a live two-EVE-client PASS**; the server deployment and actual in-game acceptance still need a conscious owner-approved test.
