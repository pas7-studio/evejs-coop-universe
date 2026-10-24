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

Their virtual economic activity and faction plans run as persistent
background systems. Destroyed named ships are recorded; the pilot has
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

**Native physics and combat are real EveJS functionality**, but virtual
resource production, trade, transport cargo and faction rebuilding are
not yet integrated with the native EVE market or cargo inventory. An
NPC miner orbiting an asteroid belt is not yet extracting a real ore
stack. Physical NPC ships remain in their actual solar system; only
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
