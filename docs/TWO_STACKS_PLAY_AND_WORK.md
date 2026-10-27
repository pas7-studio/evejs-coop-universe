# Two stacks: the owner's PLAY server and the agents' WORK server

**Status: live on this machine (2026-10-27).** Both stacks run from the same
image `evejs-local` and the same source tree, but they are **separate Docker
Compose projects with separate volumes**. They never share a port and never
share a database.

## The rule in one sentence

The play stack is the owner's game: **deploy, rebuild, recreate, restart or
merge into it only when the owner explicitly asks for a restart window.**
Everything else — live proofs, experiments, breakage — happens on the work
stack.

## Which is which

| | PLAY (owner + his friend) | WORK (coding agents) |
| --- | --- | --- |
| Compose project | `evejs` | `evejs-agents` |
| Containers | `evejs-server-1`, `evejs-market-1`, `evejs-init-1` | `evejs-agents-server-1`, `-market-1`, `-init-1` |
| Host ports (loopback only) | `443`, `5222`, `26000`, `26001`, `26002`, `40110` | `28443`, `25222`, `28000`, `28001`, `28002`, `41110` |
| Volumes | `evejs-data`, `evejs-images` | `evejs-agents-data`, `evejs-agents-images` |
| Compose files | `compose.yaml` + `compose.coop-probe.yaml` | same + `compose/compose.agents.yaml` |
| Remote access | SSH tunnel for the friend: ProtonVPN forwarded port → `sshd` (user `evefriend`, key only) → `127.0.0.1` game ports | none |
| Who may touch it | only the owner's explicit request | agents, freely |

## Work stack pacing: x5 by default

The work stack runs the same code with **real durations shortened five times**,
so a test cycle that needs 2 minutes of travel needs 24 seconds. Only knobs the
code already reads are used — nothing fakes a state change:

| Knob | Play stack | Work stack |
| --- | --- | --- |
| `EVEJS_COOP_VIRTUAL_TRAVEL_MS` | `120000` | `24000` |
| `EVEJS_COOP_CLONE_RECOVERY_MS` | `1800000` | `360000` |
| `EVEJS_COOP_MANUFACTURING_TIME_MULTIPLIER` | unset (1.0) | `0.2` (the module's floor = 5x) |
| `EVEJS_COOP_TIME_SCALE` | unset | `5` (marker for new code that wants the factor) |

Weapon cycles, dogma, market settlement and every native timer stay real: a
faster gun would change combat outcomes and invalidate the proof. If a new
mechanism needs a duration, it should read `EVEJS_COOP_TIME_SCALE` instead of
hard-coding milliseconds.

## Forbidden on the play stack

```powershell
# NEVER, unless the owner asked for a restart window:
docker compose up -d --force-recreate server
docker compose restart server
docker compose down
docker volume rm evejs-data evejs-images
```

`docker build -t evejs-local .` is **safe while he plays**: a running container
keeps the image ID it started with. The new image only takes effect on the next
recreate — which is exactly the step that needs his permission.

## Work stack commands

```powershell
cd R:\GitRepository\pas7std\evejs-coop-universe

.\scripts\Start-Agents-Stack.ps1 -Action Status   # read-only
.\scripts\Start-Agents-Stack.ps1 -Action Seed     # ONCE per fresh volume
.\scripts\Start-Agents-Stack.ps1 -Action Up
.\scripts\Start-Agents-Stack.ps1 -Action Down
```

`Seed` runs the documented one-time market rebuild
(`market-tools rebuild v1 --preset jita_new_caldari`) inside the `evejs-agents`
project. Without it `evejs-agents-market-1` exits 1 with
`No market database exists`, and the server never starts.

`compose/compose.agents.yaml` uses `!override` for `ports` and rewrites the
volume `name:` entries. This is not cosmetic: plain Compose merging would
**append** `26000-26002` to the port list (colliding with the play stack) and
would **reuse** `evejs-data` (corrupting the owner's world).

## What an agent does when a proof needs the play stack

1. Prove it on `evejs-agents` first. A proof is only real on the stack it ran on.
2. If the change can only be validated against the owner's live world, do not
   restart it. Append `NEEDS_OWNER_RESTART_WINDOW` to `.opencode/state.md` with
   the exact commit, the exact command that would be needed, and why the work
   stack cannot answer it.
3. Merging into the branch the play stack is built from is also the owner's
   decision, not the agent's.

## Why this exists

On 2026-10-27 the play stack was recreated twice inside a playing session
because an agent deploy and the owner's session shared one project. The owner's
words: *"this server that exists now you will not restart until I say so"*.
Splitting the projects is the structural fix; the sentence above is the rule.
