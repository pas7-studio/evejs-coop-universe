# Live co-op event integration

This integration modifies **only your local pinned EveJS checkout**. It adds
nonblocking instrumentation to upstream's real disconnect and space-login
attachment paths. No parallel session registry, physics, or persistence is used.

## Prepare on Windows

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Install-Coop-RuntimeProbe.ps1
```

The two modifications are small `observe(...)` calls in:
- `Code/server/src/services/_shared/sessionDisconnect.js` before persistence
- `Code/server/src/space/transitions.js` after live attach attempt

The installer is pinned to EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`,
idempotent, and supports rollback using `-Remove`. It does not alter the
underlying login, logoff, emergency warp, or Destiny implementation.

**You must rebuild the EveJS image**, because `compose.yaml` does not mount
`server/src` into the container:

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code
docker compose build
```

To activate event logging, provide `EVEJS_COOP_EVENTS_FILE` to the `server`
container via a Compose override file (for example:
`EVEJS_COOP_EVENTS_FILE: /var/lib/evejs/coop-events.jsonl`).
This path belongs to EveJS's existing data volume. Restart the server:

```powershell
docker compose up -d
docker compose exec server sh -c 'tail -n 30 /var/lib/evejs/coop-events.jsonl'
```

No events are emitted unless the environment variable is set. The log records
only characterID, shipID, systemID, clientID, event type, timestamp and
attachment success; no credentials or packet payloads. Protect event logs as
operational data. For a private demo, do not publish additional ports.

## Remove

```powershell
cd C:\Games\EveCoopProject
.\scripts\Install-Coop-RuntimeProbe.ps1 -Remove
cd C:\Games\EveCoop\upstream-evejs\Code
docker compose build
docker compose up -d
```

**Acceptance still requires a real run:** the probes demonstrate the code paths
were reached, not that the client successfully rendered a ship or that
persisted state survived a full database restart.
