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

## Co-op checkpoint — fly, regroup and reconnect

When the current draft changes have been reviewed and explicitly deployed, you and your friend can test a useful, non-scripted session:

1. **Rendezvous:** log into two separate authorized EVE accounts and join a normal native fleet. Bring both real ships within 250 km in Perimeter (`30000144`); the regular co-op chat acknowledgement is only a convenience, not proof of two rendered clients.
2. **Fleet warp:** use the game's real **Warp Fleet** action toward a genuine belt, station or gate. The native EveJS server handles the movement. `-Action Party` can now show the accepted follower order separately from a server-confirmed physical arrival. If the ship never moved, landed far away, disconnected or got replaced, the physical arrival remains unverified.
3. **Escort or intervene:** look for actual Perimeter miners carrying ore, a loaded hauler and a named pirate pursuing them. Decide whether to protect the convoy or investigate a real NPC fight. Avoid expecting mining fleets in beltless Jita.
4. **Reconnect test:** disconnect the second client (don't reset Docker or remove volumes), log in again with the same character and verify the ship is still the *same physical hull* with the same inventory. The party report will not count an old disconnected session as your second player.
5. **Loot once:** after a real ship is destroyed, try opening the wreck with both clients. Confirm that a legitimate withdrawal updates native inventory and wreck contents for both, without claiming the same item twice.

Read-only diagnostics from the existing running world:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld
.\scripts\Local-Two-Client-Test.ps1 -Action World
.\scripts\Local-Two-Client-Test.ps1 -Action Party
```

If `nativeFleetWarpOrdersAccepted` increases but `nativeFleetWarpPhysicalArrivalsVerified` remains zero, investigate actual scene/wrap state, ship identity and destination rather than assuming a successful transfer. Even a verified physical arrival remains **server-side** evidence; visual behavior in both real EVE clients must be checked directly.

The startup gate also checks the actual configured stock mining-fleet slots. If a fleet fails to materialize, the world continues bounded retries instead of mistakenly marking a partially initialized convoy as ready. This does not spawn fake miners, add arena enemies, or wipe persistent state.

## Native convoy recovery: pirate victories matter, but the world keeps moving

LivingCoop now opts into `EVEJS_COOP_CONVOY_RENEWAL=1`, using **the pinned EveJS real mining-fleet startup machinery** rather than spawning scripted enemies, replacement dummy ships, free ore or player items.

- Your successful defense matters: as long as a genuine native startup convoy has at least one live mining/hauling ship, that convoy is **not replaced**. Damaged or reduced fleets persist until EveJS naturally resolves them.
- If an **entire startup convoy slot** has been destroyed and removed from EveJS's authoritative fleet registry, the system first waits **30 minutes** before authorizing another native convoy attempt. Failed native spawns are retried no sooner than **10 minutes** later. At most **four renewal attempts per system per UTC day** are authorized in one running process.
- The native EveJS startup function still owns the actual ship hulls, spawn selection, ore, hauling and combat. No player commands, artificial target or fake quest encounter are injected.
- New native fleets are only attempted in scenes with a **real asteroid belt**, after native startup configuration permits that system. Jita remains beltless. The repeated check runs during the already existing bounded living-world reconcile, not every combat frame.
- **Runtime limitation:** EveJS's stock mining fleets are transient. The cooldown/cap are process-memory controls, not a separate persistent economy ledger. A deliberate EveJS server restart resets transient fleets and their replacement counters; do not claim that the 30-minute delay survives a reboot. Restarting is not a replacement for testing real spawning and gameplay.
- **Proof:** Native source transform is idempotent and exactly reversible. A source-level integration run against the **exact pinned EveJS `handleSceneCreated` function** verified one initial convoy, no duplicate when it remains alive, no immediate replacement after destruction, and a new native three-ship fleet only after the 30-minute cooldown. Regression tests `coop-native-convoy-renewal.test.mjs` and `coop-native-convoy-evejs-contract.test.mjs` are included in the manual local verifier; the latter reads the operator's pinned checkout and does not write to it.

After an approved deployment, spend a session scouting **Perimeter (30000144)**, watch a real miner/hauler convoy operate, decide whether to escort it or hunt it, then return to the actual belt later to see whether the world has naturally sent a replacement. This is intentionally **not** an immediate endless NPC spawn farm.

## Co-op P0 — native two-player missions, industry and capsuleer development

**New feature-branch code only.** These steps are for the first owner-authorized **isolated** client playtest after applying the approved pinned overlay. They have not passed a live client acceptance round. Do not rerun `Prepare`, rebuild the market, modify persistent volumes, or deploy to the friend's running server to get a test PASS.

1. **Native fleet:** pilot A uses the original EveJS fleet UI to form a fleet and invite B, B explicitly accepts. Confirm both clients show the *same* fleet ID/member list. A may use the actual native **Warp Fleet**; B can refuse with the native **Accept Fleet Warp** preference. A proximity greeting before accepting an invite is NOT fleet membership.
2. **Co-op battle mission:** A and B separately accept the same native dungeon mission from the same agent, enter A's actual mission site in their original ships as the same native fleet, and complete the real authored NPC objective. With `EVEJS_COOP_FLEET_MISSION_SHARE=1`, the existing native dungeon completion tick attempts to credit B's **own accepted journal** only while both genuine ships and authenticated sessions are physically at A's mission location. It does not fake NPC kills, generate cargo, or grant rewards. Reconnect and verify B's completed status is preserved by the native mission normalizer.
3. **Mission turn-in:** Native `agentMgrService` remains responsible for both players' individual objectives, agent conversations, wallet/standing/item rewards and history. The optional `EVEJS_COOP_FLEET_MISSION_TURNIN=1` helper supports two eligible completed dungeon missions, but truly atomic two-person payout on crash has **NOT** been established. Keep it OFF in real economic persistence testing until forced-crash cases are cleared; players can use their own native agent turn-in meanwhile.
4. **Native item/ship gifts:** both dock at the same station, use the original EveJS direct trade window, stage owned tradable items or an **inactive** ship, inspect the exact manifest and both accept. A currently occupied/active ship cannot be transferred. The optional co-op guard rejects stale cargo/ownership and mixed ISK+item trades between fleet members because the upstream completion is not atomic across wallets/items. Check real item IDs/owners before and after reconnect.
5. **Actual Omega and skills:** the explicit `-LivingCoop` overlay now sets `EVEJS_OMEGA_LICENSE=true` and `EVEJS_SKILL_TRAINING_SPEED=6`. Both pilots should observe the **native** Omega status, no Alpha-specific SP cap, the right projected finish time, actual offline SP gain, and persistent trained levels after reconnect/restart. This initial Omega policy is an unlimited *closed-server* stub; individual **30-day** licenses and renewal through ISK are future work, NOT currently wired.
6. **Player production:** the original EveJS Blueprint / Industry UI and `/bpauto` commands use native quotes, materials, ownership, wallet, facilities and job delivery. LivingCoop now applies `EVEJS_COOP_MANUFACTURING_TIME_MULTIPLIER=0.35` to **manufacturing duration only**. For a first test, mine a real player ore stack, dock, reprocess using native Reprocessing UI, install a T1 ammo/module/ship blueprint job, inspect actual consumed minerals and job cost, await/deliver the real manufactured item, and trade or sell it. The existing NPC ore virtual depot is **NOT** player-accessible station stock. Do not transfer the virtual balance into an industry job or manufacture free items.
7. **Market:** use the pinned EveJS native market UI/daemon and actual real player sell/buy orders or finite seed stock. Verify order ID, ISK debit, item owner/location, escrow, taxes and a successful reconnection. The separate independent NPC-owned market-maker feature remains OFF; the existing seed-only NPC trader adapter is guarded and not a substitute for escrow-backed NPC orders.

**Regression suite:** `tests/coop-fleet-p0-cooperative-actions.test.mjs`, `tests/coop-native-fleet-trade-mission-contract.test.mjs`, `tests/coop-fleet-dungeon-objective.test.mjs`, and `tests/coop-native-industry-progression.test.mjs` are now in `Verify-Local-Coop.ps1`, with the pinned source path supplied by the verifier. The state normalizer, reversible overlay and integration methods are covered. Client UI, real mission combat, economic balances and offline skills still need live proofs.
