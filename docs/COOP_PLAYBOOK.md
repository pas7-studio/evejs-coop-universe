# Co-op playbook — how to bring up a working client + server pair

**Audience: someone who has this repository, the EveJS fork and an EVE client
copy, and wants two people flying in one world.**
Everything below was executed on the owner's machine on 2026-10-28/29; the
numbers quoted are measured, not estimated. Where something is still unproven it
says so.

---

## 0. What "works" means

| level | proof |
| --- | --- |
| server up | `evejs-market-1` and `evejs-server-1` healthy, `/health` 200 on `26002` |
| world running | `coop-events.jsonl` grows (`state/NOW.md`, `evejs-server status`) |
| one client in game | client window appears, gamelog gains lines, server log shows the session |
| two clients in one world | two distinct sessions, both see the same ship/NPC, chat works |
| remote player | the friend reaches **chat and market**, not just flight |

Anything below the level you actually observed is not "done".

---

## 1. Pieces

| piece | where | notes |
| --- | --- | --- |
| engine (fork) | `C:\Games\EveCoop\upstream-evejs` branch `coop/pas7std` | image `evejs-local` = the fork's `Code/` |
| orchestration (this repo) | `R:\...\evejs-coop-universe` | scripts, docs, tests |
| EVE client copy | e.g. `W:\EVE Online - 3396210` | needs `tq\`, `ResFiles\`, `index_tranquility.txt` |
| compose stacks | `evejs` (play), `evejs-agents` (work) | never mix them |

---

## 2. Server, first time

```powershell
# 1. engine image from the current fork commit
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local .

# 2. market data (optional but required for a working market)
#    see §6 — a build from the public TQ snapshot, then the invariant pass

# 3. bring the play stack up (stack + remote-player relay)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Start-Play-Stack.ps1 -Action Up
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Start-Play-Stack.ps1 -Action Status
```

Stack ports stay on loopback: `443`, `5222`, `26000-26002`, market `40110`.

**Rule that cost us a session:** do not recreate `evejs` with a bare
`docker compose up -d` while a remote player is expected — use the script, which
also keeps the SSH relay alive.

---

## 3. Client on the host machine

1. `tq\start.ini`: `server = 127.0.0.1`, `port = 26000`, `cryptoPack = Placebo`.
2. `%LOCALAPPDATA%\CCP\EVE\w_eve_online_-_3396210_tq_127.0.0.1\settings\prefs.ini`:
   `port=26000`. This file **overrides** `start.ini`.
3. Launch through the launcher (`Play.bat`, or a shell that exports the same
   environment). If `Play.bat` is missing from the client copy, start
   `bin64\exefile.exe` with the launcher environment, at minimum:

   ```
   EO_REMOTEFILECACHEFOLDER = <client>\ResFiles
   LD_OFFLINE = true
   EVE_CLIENT_SENTRY_DSN = (empty)
   no_proxy = 127.0.0.1,localhost,::1
   ```

   Without `EO_REMOTEFILECACHEFOLDER` the client stays alive with **zero windows**
   and ~1 core of CPU — it looks like a GPU problem and is not one.
4. Gamelog appears in `Documents\EVE\logs\Gamelogs\` when the character loads.

---

## 4. Remote player (second person)

One forwarded TCP port is enough **if it carries SSH**; everything else rides
the tunnel. Full detail: [PUBLIC_ENDPOINT_PROTONVPN.md](PUBLIC_ENDPOINT_PROTONVPN.md).

Host:

```powershell
docker run -d --name evejs-ssh-relay --restart unless-stopped `
  -p 0.0.0.0:61730:61730 alpine/socat `
  tcp-listen:61730,fork,reuseaddr tcp-connect:host.docker.internal:55346
```

(sshd must listen on `55346` and allow key-only `evefriend` with `PermitOpen` on
`127.0.0.1:443 127.0.0.1:5222 127.0.0.1:26000 127.0.0.1:26001 127.0.0.1:26002`.)

Friend:

```
ssh -N -T -p 61730 evefriend@<public-ip> ^
  -L 443:127.0.0.1:443 -L 5222:127.0.0.1:5222 ^
  -L 26000:127.0.0.1:26000 -L 26001:127.0.0.1:26001 ^
  -L 26002:127.0.0.1:26002
```

then the same `start.ini`/`prefs.ini` as §3 — **`127.0.0.1`, not the public IP**.

Why: the EVE client asks the server for chat/market/image endpoints and gets
`localhost`. With the tunnel they resolve to the host's own loopback ports. A
direct public game port therefore gives flight only: chat fails with
`Could not connect to the chat server at localhost:5222`, market and portraits
stay empty.

---

## 5. Verification order (stop at the first failure)

1. `Start-Play-Stack.ps1 -Action Status` — stack healthy, relay up, SSH banner.
2. `curl http://127.0.0.1:26002/health` → 200.
3. Host client logs in, flies, gamelog grows.
4. Friend tunnel connects (key auth, no password prompt), then logs in.
5. Chat window shows both pilots; market opens with real prices.
6. `docs/COOP_LOOP_ACCEPTANCE.md` for the mining → haul → sell loop.

---

## 6. Market seed, so the economy is not broken

The seed is a **snapshot of real Tranquility prices**, then normalised. Tools in
`scripts/market/`.

```powershell
# 1. build from the public TQ snapshot (fork tool, config outside the fork)
#    tools\market-seederv2\config: order_filter = market_scope_with_npc,
#    market_solar_system_ids = [30000142,30000145,30100032]
market-seederv2.exe --config seed.toml build --yes

# 2. never ship a crossed book: max(bid) must stay below min(ask) per system
python scripts\market\normalize_market_seed.py market.sqlite 5.6 --apply

# 3. depth: bulk goods deep, ships/SKINs/implants scarce
python scripts\market\volume_policy.py market.sqlite --apply

# 4. faction sectors: own faction cheaper and deeper, rivals dearer and thinner
python scripts\market\sector_policy.py market.sqlite <gameStoreDataDir> --apply
python scripts\market\normalize_market_seed.py market.sqlite 5.6 --apply   # re-clamp

# 5. audit before deploying
python scripts\market\audit_market_seed.py market.sqlite
```

Deploy the file into the `evejs-data` volume (market stopped), `chown 1000:1000`,
delete stale `-wal`/`-shm`, start the market. Measured after reseed: 0 crossed
pairs, Tritanium 3.93 ISK × 4 000 000 at Jita 4-4, a Caldari Navy X-Large Shield
Booster 175.95 M × 2 in Caldari space.

Design and invariants: [MARKET_SEED_ECONOMY_DESIGN.md](MARKET_SEED_ECONOMY_DESIGN.md).

---

## 7. Failure map (what we actually hit)

| Symptom | Real cause |
| --- | --- |
| client runs, no window, one core busy | started `exefile.exe` without `EO_REMOTEFILECACHEFOLDER` |
| "Connection failed … port 26000" though `start.ini` says otherwise | stale `prefs.ini` |
| friend `SynSent`, timeout | forwarded port not listening (relay stopped or stack recreated bare) |
| friend in game, no chat/market | no SSH tunnel — those services are `localhost`-only |
| public endpoint "works" from the host | Proton hairpin answers the handshake; only an external test counts |
| market prices look synthetic/flat | old v1 seed still in the volume, reseed needed |

---

## 8. Deliberate limits

- Two-client gameplay is **not** claimed as verified here beyond the friend
  reaching the world; record your own evidence per
  [GAMEPLAY_TESTING.md](GAMEPLAY_TESTING.md).
- The market is a static snapshot: correct and arbitrage-free inside a station or
  system, but it does not yet react to mining, war or losses (see §7 of the
  design doc).
- No CI, no remote automation. Everything above is a local, repeatable command.
