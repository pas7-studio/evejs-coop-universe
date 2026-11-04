# Site defence: "they should warp into his face"

Owner report, 2026-11-05: *"Sanya cleared one of our anomalies (x2.5) and felt no threat at all — they
did not react because they could not see him. He sat at 150 km and sniped. They should warp into his
face and clean him up."*

## What was actually wrong (two separate defects)

### 1. Site defenders had no response at all on the play stack

`space/coopPveNativeSiteDefense.js` is the only director that issues orders to **site/anomaly**
defenders, and it is gated by `EVEJS_COOP_PVE_SITE_DEFENSE`. That flag was **absent** from
`Code/compose.coop-probe.yaml`, so on the live stack a dungeon NPC only did what stock EveJS AI does
with what it can already see. At 150 km: nothing.

`EVEJS_COOP_PVE_NPC_RETALIATION=1` was on, but it belongs to the **named/linked** NPC tactics director
(`space/coopNpcTactics.js`), which never touches dungeon-spawned site defenders.

Fixed: the flag is set, with a comment explaining what it enables.

### 2. Even with retaliation on, "far" was a fixed 250 km

`coopPveNativeSiteDefense` and `coopNpcTactics` both treated only `> 250 000 m` as far. A sniper at
150 km therefore got a **plain native attack order**: the defender turns toward him, burns at subwarp
speed, and never fires — the player feels nothing at all. That matches the report exactly.

Fixed: "far" is now the hull's **own lock range** (`entity.maxTargetRange`, derived from dogma by
`space/npc/nativeNpcService.js`, 65 km fallback when a hull carries none):

| defender situation | what happens |
|---|---|
| can lock the attacker (`gap ≤ its lock range`) | native attack order, stays where it is — a real sentry with 150 km reach keeps shooting at 150 km |
| cannot lock him (`gap > lock range`, up to 250 km) | **real native warp to the attacker** (`npc.warpToEntity`, `forceImmediateStart`), then the attack order only after the **same physical hull** is out of warp and inside reach |

A native ACK is a command, not a position: the follow-up attack order is gated on the actual arrival,
never on the acknowledgement. Without a warp capability the director leaves a far defender alone
instead of issuing an order that cannot work.

The same reach rule replaces the 250 km constant in `coopNpcTactics.js`, so named NPC rescue
responders also warp at 150 km instead of stalling out of range.

## Aggressor source

The director reads the native controller's `lastAggressorID` / `lastAggressedAtMs` and, when the
controller recorded no aggressor, the **verified damage witness** (`space/coopNpcAggressionLedger.js`,
fed by `space/coopPlayerCombatWitness.js`, `EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE=1`). That path names
itself in the log: `NATIVE_SITE_DEFENSE_FROM_WITNESS`.

## Events (in `coop-events.jsonl`)

| status | meaning |
|---|---|
| `NATIVE_SITE_DEFENSE_FROM_WITNESS` | the witness supplied the attacker the controller did not record |
| `NATIVE_SITE_DEFENSE_WARP_ISSUED` | defender is out of its own lock range → real warp at the attacker (`gapMeters`, `reachMeters`) |
| `NATIVE_SITE_DEFENSE_ORDER_ACCEPTED` | native attack order accepted (in reach, or after physical arrival) |
| `NATIVE_ATTACK_OUTCOME_UNKNOWN` | ambiguous native ACK — permanently fenced, never retried |

## How to verify live

1. Warp into one of our anomalies, kill nothing, sit **150 km** off the pack and shoot one NPC.
2. Expect in the client: THAT pack warps on top of you (2 defenders per tick at most), then opens fire.
3. On the server:
   `grep NATIVE_SITE_DEFENSE /var/lib/evejs/coop-events.jsonl | tail -6`
   * `NATIVE_SITE_DEFENSE_WARP_ISSUED` with `gapMeters≈150000`, `reachMeters≈your rat's lock range`;
   * then `NATIVE_SITE_DEFENSE_ORDER_ACCEPTED` a few seconds later — that is the arrival;
   * if you see only the first line and no second, the warp never landed (check that the NPC is not
     warp-disrupted and that it really moved in the client).
4. Kill nothing and stop shooting: the response stops when the 120 s aggressor window expires — no
   infinite chase, no synthetic spawns.

## Boundaries kept

* no NPC is spawned by the response, no damage or kill is invented, no reward is paid;
* only exact native dungeon encounter spawns (beacon identity + one wave owner) may be ordered;
* at most 2 defenders per site and 4 orders per tick, with a 120 s attack cooldown and a 30 s warp
  cooldown, and an `UNKNOWN` outcome is never retried;
* a defender that is already fighting, already warping or explicitly excluded keeps its own order.

## Files

* `Code/server/src/space/coopPveNativeSiteDefense.js` — reach rule, warp-then-attack, witness source
* `Code/server/src/space/coopNpcTactics.js` — same reach rule for named-NPC rescues
* `Code/server/src/space/coopVirtualWorldRuntime.pure.js` — wires `warpToAttacker` + `aggressionFor`
* `Code/compose.coop-probe.yaml` — `EVEJS_COOP_PVE_SITE_DEFENSE: '1'`
* `tests/coop-pve-native-site-defense.test.mjs` — 7 new cases (warp vs order, arrival gate, no fake
  warp without capability, fenced unknown ACK, witness source, stale witness)
