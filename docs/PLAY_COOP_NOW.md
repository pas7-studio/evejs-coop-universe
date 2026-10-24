# Play EveJS Living Universe with a friend

**No arenas and no scripted PvE waves in the default game mode.** Both
players enter one persistent EveJS world, encounter named, autonomous
NPC pilots and choose whether to hunt pirates, raid civilians, explore,
trade, or use ordinary fleet mechanics.

This integration still requires verification with real EVE clients.

## Setup once

Windows 11, Linux-mode Docker Desktop, Node 22+, Git, the pinned EveJS
server revision c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f, and two
independently authorized compatible EVE client accounts/installations
are required. The project defaults to C:\Games\EveCoopProject and the
upstream checkout to C:\Games\EveCoop\upstream-evejs\Code.

~~~powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Local-Two-Client-Test.ps1 -Action Prepare
~~~

Do not repeat the initial market build each time you play.

## Start the actual persistent NPC universe

~~~powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Install-Coop-RuntimeProbe.ps1 -DryRun
.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart
.\scripts\Local-Two-Client-Test.ps1 -Action Status
~~~

This now enables a world with **20 persistent NPC identities** across
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

**Real mining and haul cargo are now integrated with stock EveJS**,
including physical mineable-rock depletion and ore in native NPC cargo.
However, unloading currently removes cargo into a virtual depot;
it does not debit or credit real EveJS station inventories, contracts,
player wallets or sell orders. Virtual NPC trading and faction
shipbuilding are separate simulations, not stock market transactions. Physical NPC ships remain in their actual solar system; only
non-materialized virtual pilots advance between systems asynchronously.
Native cross-system NPC gate jumps remain unfinished.

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
