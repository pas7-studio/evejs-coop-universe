# NPC personal memory and faction chronicle — delivery contract

Status (2026-10-24): **implementation in feature branch; server/client gameplay not verified**.

This is an optional layer over the pinned EveJS native simulation. It does not replace
EveJS standings, ship physics, combat damage, inventory or patrol controllers.
The deferred P0 (real server + two clients, fleet combat/warp/loot and ship-safe
reconnection) remains separate. Physical inter-system NPC gates and real NPC
market orders are also separate P1 blocks; neither is claimed implemented here.

## 1. Individual NPC remembers a specific player (P1)

- Identity key: **persistent `coop-pilot-NNN` + authenticated EveJS
  `characterID`**. Never key memory by transient ship entity ID, account display
  name, IP, or a synthetic NPC character.
- Evidence only: an **applied** native standing transaction from a verified mining
  fleet assault, player-attributed pirate wreck or confirmed convoy defense.
  Replaying an already-applied transaction after restart may reconstruct a missing
  NPC memory entry, but may not apply standings again.
- Membership proof: the target ship/pilot must resolve through the existing
  `coop-npc-links.json` identity registry in the actual solar system.
- One event is remembered at most once **per named NPC** across restarts.
  Other players and other NPCs must not inherit personal memory.
- The stored score is bounded to [-100, 100]; up to six recent incidents per
  NPC/player pair are retained. This is a relationship signal, not currency,
  damage, a new standings ledger or authorization to attack.
- Save atomically to `coop-npc-memory.json` in the persistent EveJS volume.
  Malformed save state fails closed; missing optional registry yields no memory.
  The 50,000-event cap fails closed instead of silently forgetting dedupe keys.

The first gameplay consequence is **native NPC reinforcement escalation**:
if an authenticated player is recognized as a repeated hostile actor (score <= -30)
by the actual NPC victim, its help request may involve **one additional existing
same-faction patrol**, maximum three. A real patrol must be in the scene, free of
another fight, and issue a successful EveJS attack/warp order. No fake ship,
instant damage, scripted wave or teleport is ever created.

Existing native EveJS standings continue to determine mining fleet's defense
strength. For example, memory must never directly add or overwrite standings.

### Important qualification

Currently recorded events depend on the native standing application succeeding
or already existing with APPLIED status and on a named NPC registry link being
available. Not every attack, trade, conversation, or pirate encounter is remembered.
There is no NPC dialogue system or player-facing memory UI yet. Both require a
separate verified client/gameplay slice. The deployed game must be tested to prove
that remembered aggression actually produces a different **physical** patrol response.

## 2. Persistent faction stories (P2 foundation)

`coopFactionDirector` owns virtual faction readiness, losses, replacement demand,
threat and patrol priority. Existing physical patrol spawning remains in
`coopFactionPatrolRuntime`, backed by native EveJS ships.

The extended v1 state now stores a bounded `chronicle` of:
- `CONFIRMED_NPC_LOSS` — after a real EveJS wreck that passes the existing
  persistent loss bridge; affects replacement demand and patrol priority.
- `NATIVE_ATTACK_ORDER` — after a native same-system NPC reinforcement issues a
  successful attack order against a *different known named-NPC faction*.
  It is **not** proof of damage, kill, victory, territory capture, or war.

Faction-pair tension phases are `CONTACT`, `ESCALATING`, and
`SUSTAINED_TENSION`; these describe increasing evidence of hostile orders,
not fabricated battles. They are persisted across restarts and retrievable per
system. Recorded tension increases the threatened defender's patrol priority
and threat, but does not create resources or spawn an unearned replacement ship.
A new patrol can materialize only under the existing native resource/readiness
and patrol caps.

The chronicle holds the last 1,000 factual entries. The existing processed-event
ledger retains idempotency. Existing v1 faction saves are read without resetting
their losses and economy. Never conflate our narrative faction tags
(`frontier`/`independent`) with numeric authoritative EveJS owner IDs.

### Not implemented yet — full historical faction warfare

- Verified attacker-of-record for every NPC wreck and inter-faction combat
  result, including combat after the helper's native attack order.
- Resource-backed cross-system offensive expeditions through **real stargates**.
- Actual station ownership, war declarations, territorial conquest, sovereignty,
  diplomacy and player-led ceasefires. Those must not be faked by changing text.
- NPC trading with live EveJS sell/buy orders and stock transfers.
- In-game delivery of a filtered timeline and meaningful named-NPC dialogue.

## Additional slice: visible recognition and headless physical NPC boot

- `coopNpcRecognition.cjs` checks authenticated player sessions, a native
  player ship and an actual named NPC within 80 km before sending one
  private EveJS system notice. It is not a simulated NPC chat message.
  Per-player and per-NPC cooldowns avoid spamming. The response text
  depends on persisted memory; unknown players get no notification.
- The LivingCoop server may bootstrap both configured native scenes
  independently of client login with at most six bounded attempts and
  truthful per-system evidence. It must never count a successful flag
  check, a virtual pilot, or an empty scene as an actual NPC ship.
- Native pirate attack orders are now included in the factual faction
  chronicle when both physical NPCs have persistent named identities.
  A warp order is not a battle; even a successful attack order does not
  certify a kill or territorial change.
- The code remains unverified in the actual Docker container and game
  client. No remote CI automation is permitted by the repository owner.

### Existing-world faction migration

The original `coopVirtualWorld` initialization used the same index parity
for both the system route and the faction, so the default two-system layout
had only one faction per system. New worlds distribute named NPC factions
independently of the route. For an old world, this is a **one-time opt-in**
migration (`EVEJS_COOP_FACTION_LAYOUT_V2=1` in LivingCoop) and saves an
unaltered `.pre-faction-layout-v2.bak` adjacent to the world JSON first.
It preserves all pilot IDs, names, travel history and ship link identities;
only recognized legacy faction assignments are remapped. Existing native
EveJS owner/standing values are not rewritten. A conflicting prior backup
causes the migration to refuse to proceed rather than overwrite evidence.
Existing virtual faction history remains in its existing file and should
be reviewed after a migration.

### NPC-vs-NPC hostility is now opt-in and faction-restricted

Pinned EveJS previously treated NPC-vs-NPC targeting as friendly, even when
the server had accepted an attack order. A reversible conditional hook now
checks both ship entities, both native controllers, named persistent identities,
same-system links, actual faction mismatch, and a current manual attack order.
Retaliation permission requires a native recorded aggressor within five minutes.
It never enables universal NPC friendly fire.

Named pirates select only cross-faction linked stock miner/hauler targets.
The native combat evidence also records genuine successful missile launches
or weapon module activations; neither constitutes confirmed damage or final
killer credit. The strict manual Combat gate joins that exact attacker/victim
pair to observed HP loss and a native physical wreck with stored loot. Source
modules and native patch are tracked in
`docs/HEADLESS_NPC_VALIDATION.md`. No remote CI is permitted.

## 3. Review and verification checklist

1. Run `node --test tests/coop-npc-memory.test.mjs tests/coop-npc-tactics.test.mjs tests/coop-faction-director.test.mjs`.
   Do not mark live gameplay verified based on unit tests.
2. With a pinned, permitted EveJS local server, turn on `LivingCoop`.
   Verify `EVEJS_COOP_NPC_MEMORY=1` and the memory file is inside the
   persistent named volume; restart without `docker down -v`.
3. Attack a real mining ship with authenticated character A. Confirm exactly
   one native standing penalty and one matching named-pilot incident per
   dedupe window. Restart; duplicate evidence must not double count.
4. Character B must remain `UNKNOWN` to that named pilot. Character A must
   retain a `WARY`/later `HOSTILE` memory after restart.
5. Trigger two independent evidenced incidents against that pilot and repeat
   a genuine attack while three idle same-faction patrol NPCs already exist
   in the same real scene. Verify up to three **native** responder orders,
   physical warp and native engagement. No new NPC is spawned.
6. For faction history, record a genuine cross-faction successful native
   attack order and separately a verified wreck. Confirm they are labeled
   differently, deduped and survive restart. Unknown attackers must not
   be credited a fictional victory.
7. Capture sanitized event logs, native NPC entity IDs, scene state, save
   snapshots, server build SHA, test results and rollback evidence.
8. Keep non-game / remote network exposure disabled until the independent
   legal and security gates are satisfied.

## 4. Next reviewable slices for agents

| Task | Status | Acceptance |
| --- | --- | --- |
| NPC-MEM-001: durable per-player memory ledger | Code complete; local isolated tests PASS | Persist, dedupe, isolate, reject invented events |
| NPC-MEM-002: hook verified native standings | In PR, server unverified | Assault/defense/kill correctly resolve real named identities |
| NPC-MEM-003: reinforcement response to repeat attacker | In PR, server unverified | Existing patrol is issued a third native order, no spawns |
| NPC-MEM-004: player-visible NPC recognition and dialogue | TODO | Real NPC presence, attributable memories, rate limits, no fake reports |
| NPC-FACTION-001: factual chronicle and tension | In PR, server unverified | Named inter-faction attack orders and real losses persist |
| NPC-FACTION-002: complete ongoing faction campaigns | TODO | Resource ownership, real travel, attributed combat outcomes and meaningful consequences |

The final block is **not DONE** until both server evidence and meaningful
player-visible outcomes pass the real-client gates. P0 is deliberately deferred,
not silently marked green.
