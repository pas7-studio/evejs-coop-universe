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

**Work order:** finish this NPC combat block first. Treat real
two-client/fleet/loot/reconnect as a later *single P0 block*. After
that, integrate physical NPC gate travel and authentic player-visible
market trading as another block. Finally build individual NPC memories
and long-running faction stories.


## Experimental headless native NPC boot (new code, not live-proven)

The LivingCoop overlay now requests a bounded **server-side bootstrap**
of both configured systems after startup; it no longer needs the
first player's login just to attempt native NPC scene materialization.
It checks actual EveJS asteroid belts, stock mining ships and physically
linked named NPC ships. Missing scene elements remain PENDING and are
retried a limited number of times, rather than being reported as success.
The server writes `living-headless-boot-requested` and
`living-headless-boot-system` diagnostics into the regular persistent
event log. This code has **not** been verified inside a live EveJS container.

With the updated overlay installed, use `-Action CoopStart`, inspect the
server logs, then `-Action World` even without a client to assess
real server-side topology and NPC entities. A physical server-side
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

## October 24: verified backend is not yet verified Living Universe

A client-free verifier run demonstrated 44 passing local tests, 27
passing pinned EveJS upstream contract tests, a healthy backend, two
concurrent TCP sockets, reconnect and loopback-only Compose ports.
These prove useful *server contracts*; they do not prove that compatible
EVE clients can log in, see each other's ships or interact with NPCs.

The upstream contract log prints \`Loaded 0 systems, 0 asteroid belts\`
under its isolated fixture. That is **not** proof the actual container
has no star systems. A separate live runtime check is required.

The verifier now uses a separate attested temporary EveJS gameStore for
each upstream test. It never runs \`node --test\` against the persistent
live server database. It also starts the complete installed
\`compose.coop-probe.yaml\` overlay rather than silently starting only
the base EveJS Compose file.

For an **opt-in native Living Universe configuration gate**, first
deploy the world, then run:

~~~powershell
cd H:\projects\evejs-coop-universe
git pull
.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Verify-Local-Coop.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -IncludeUpstreamTests -RequireLivingUniverse
~~~

\`-RequireLivingUniverse\` checks that the *running* server container has
the required virtual-world, native-mining, pirate-raid and intel flags.
It does not count NPC ships or claim any client-side gameplay pass.

**After starting an actual compatible game client, logging in and
undocking**, run:

~~~powershell
.\scripts\Local-Two-Client-Test.ps1 -Action World -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Local-Two-Client-Test.ps1 -Action Party -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
~~~

\`World\` requires fresh server-side evidence from the real game scene:
at least one authentic asteroid belt, a physical EveJS mining fleet
with a miner and hauler, and at least one physical NPC assignment.
It displays exactly what is missing and does not accept virtual
resident counts or TCP reconnect as substitutes.

Only once this is confirmed should you attempt both real client
windows, mutual ship visibility, fleet warp, actual NPC engagement,
wreck looting, disconnect/reconnect and a test from a second PC.

No game data volumes are wiped by these commands. Keep all server
ports bound to loopback and use only an authenticated private tunnel
for a remote authorized client.

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
