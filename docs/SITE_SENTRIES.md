# Site batteries that really shoot

Status: **code complete and enabled on the work stack; the in-client damage
measurement is still open** (it needs a player inside a site).

## What was wrong, measured step by step

Every step below was measured on the running stack, not reasoned about:

1. **The batteries a client sees in a site are scenery.** "Light/Heavy/Cruise
   Missile Battery" site structures are `categoryID 23`; their type records carry
   hit points and nothing else - no `damageMultiplier`, no em/thermal/kinetic/
   explosive attribute. `dungeonUniverseSiteService.buildKillableStructureEntity`
   materialises them as static site content (`kind: "siteKillableStructure"`),
   which has no controller, so no code path can ever make them fire.
2. **Spawning a native category 11 sentry *battery* profile produces a real
   entity that still cannot fire.** Live probe on `evejs-agents`: entity
   `980000051686`, typeID 17575 "Angel Cruise Missile Battery", `kind: "ship"`,
   `nativeNpc: true`, controller with the retail behaviour profile
   `retail_destructible_sentry_guns_17575_angel_cruise_missile_battery` - and
   `getNpcWeaponModules()` returned **0** modules, because the profile's loadout is
   `retail_empty_npc_entity_loadout` and those types carry zero damage
   attributes in this build (their damage lives in a missile charge the data does
   not name; the rate-of-fire attribute reads 20 000 000 ms).
3. **The faction's own `<Faction> Sentry Gun` type does carry a complete weapon
   profile** and has a native profile as well:

   | type | damage | multiplier | cycle | range |
   | --- | --- | --- | --- | --- |
   | 13114 Angel Sentry Gun | em 1 / exp 4 / kin 4 / th 1 | x1.25 | 2 500 ms | 500 km |
   | 13116 Blood Raider Sentry Gun | em 4 / exp 1 / kin 1 / th 4 | x8 | 8 000 ms | 500 km |
   | 13068 Guristas Sentry Gun | em 1 / exp 1 / kin 4 / th 4 | x1.25 | 2 500 ms | 500 km |
   | 13113 Sansha Sentry Gun | em 4 / exp 1 / kin 1 / th 4 | x1.25 | 2 500 ms | 500 km |
   | 13115 Serpentis Sentry Gun | em 1 / exp 1 / kin 4 / th 4 | x1.25 | 2 500 ms | 500 km |
   | 1194 Amarr Sentry Gun | em16 / exp16 / kin28 / th28 | x5 | 2 500 ms | 500 km |

## What the co-op layer now does

Two phases on the existing living-world tick, both behind **one** switch,
`EVEJS_COOP_SITE_SENTRIES=1` (default OFF):

* `native-site-sentries` - `space/coopSiteSentrySpawn.js`. For every battery
  structure of a **live** site instance, in a scene that really has a player,
  spawn exactly one native sentry of the site's faction, at the battery's own
  position, once per battery. Nothing is spawned in an empty system, and a
  failed native spawn is reported once instead of retried into a spawn storm.
* `native-site-sentry-fire` - `space/coopSiteSentryFire.js`. Fire that sentry
  type's **own** damage vector and cycle at the nearest player ship in range,
  through `space/runtime` `droneInterop.applyWeaponDamageToTarget` - the same
  path native weapons use, so client damage notifications, destruction, wrecks
  and kill attribution stay native. A type without damage attributes never
  fires; range and cycle are clamped to 500 m..250 km and 1..60 s.

The faction is read from the structure label first ("Sansha Defense Battery"),
then the template's encounter spawn query (`sanshas_deadspace_pve`), then the
template's real `factionID` through the faction record - a template usually has
only one of the three.

## Measured coverage (work stack, 2026-11-05)

Four real systems, real site instances, real battery labels:

| system | instances | batteries | resolved | skipped |
| --- | --- | --- | --- | --- |
| Jita 30000142 | 3 | 2 | 1 (Angel) | 1 |
| Perimeter 30000144 | 5 | 4 | 3 (Sansha) | 1 |
| New Caldari 30000145 | 5 | 2 | 2 (Sansha) | - |
| Maurasi 30000140 | 4 | 4 | 3 (Sansha, Serpentis, Guristas) | 1 |

**9 of 12** batteries resolve to a real faction sentry gun. The three skipped
ones are all `Sleeper Defense Battery`: this build has no Sleeper sentry gun
type, so those batteries stay inert on purpose instead of borrowing another
faction's numbers.

The damage path itself was proven live: the Blood Raider Sentry Gun vector
(em 32 / exp 8 / kin 8 / th 32) applied through the native path dropped a
spawned ship's shield `725 -> 706.679975`, `success: true`, not destroyed.

## What is still unproven, and how to prove it

The only missing measurement is a **player-visible** one: that a player standing
in a site sees the sentry, is hit, and sees the damage on the client. That needs
the owner inside a site after the next restart window.

Evidence to collect then:

1. server log: `[CoopLivingWorld] site sentries in <system>: battery <id> -> <type> #<entityID>`;
2. `coop-events.jsonl`: `coop-site-sentry-spawned` and `coop-site-sentry-fired`
   (`evidence: SENTRY_TYPE_ATTRIBUTES_APPLIED_THROUGH_NATIVE_DAMAGE_PATH`);
3. the client's own damage readout, and - if the ship dies - the killmail
   naming the sentry entity as the attacker.

Until then the feature must not be described as "verified in game".

## Related

* Site structures that hold loot (warehouses, depots, caches): [SITE_LOOT_STRUCTURES.md](SITE_LOOT_STRUCTURES.md).

## Related decisions from the same work

* The earlier idea of adding a category 11 *battery* spawn entry to the co-op
  site variants was reverted: it would have produced two sentries per co-op
  battery and still no weapon, because those types have no damage data.
* `space/coopSiteSentries.js` is the pure decision half (label/query/faction to
  type name) and is pinned by `tests/coop-site-sentries.test.mjs`.
