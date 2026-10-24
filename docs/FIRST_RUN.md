# First-run operator runbook

This is a **backend-first** runbook. No complete game has been tested in this repository; EVE-client-dependent gameplay is blocked until compatible, permitted client availability is established.

## 1. Clone the orchestration project

```powershell
git clone https://github.com/pas7-studio/evejs-coop-universe.git C:\Games\EveCoopProject
cd C:\Games\EveCoopProject
powershell -ExecutionPolicy Bypass -File .\scripts\Preflight.ps1 -CheckPorts
```

Resolve missing Git/Docker/Linux containers and occupied ports before building. These scripts do not need elevation.

## 2. Fetch sources into a separate directory

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Fetch-Upstream.ps1
```

The script will clone EveJS and X-Eve into `C:\Games\EveCoop\`; it prints exact revision IDs. It neither modifies your official client nor applies a patch. Record these SHAs in a private notebook (do not commit any secrets). Re-running deliberately leaves existing repositories alone.

## 3. Backend Docker only

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code
docker info --format '{{.OSType}}'
docker compose build init
docker compose run --rm --no-deps market-tools engines
docker compose run --rm --no-deps market-tools rebuild v1 --preset jita_new_caldari
docker compose up --detach
docker compose ps --all
docker compose logs --tail=150 init market server
```

Do not run Docker for the same game at the same time as native Windows server processes. If a command fails, stop and inspect the exact error; do not erase volumes or databases to troubleshoot reflexively.

## 4. Health criteria
- Docker uses Linux containers.
- `init` ends with exit code 0.
- `server` and `market` become healthy.
- No restart loop; durable data survives `docker compose down` followed by `up -d`.
- No unexpected listener on `0.0.0.0`; validate with `Get-NetTCPConnection -State Listen` and `docker compose ps`.

## 5. Only then review gameplay path

Read `docs/SETUP_WINDOWS.md` plus upstream `README.md` and `Code/doc/SETUP.md`. The target client is build 3396210; **do not assume the current official launcher supplies it**. Changes to a proprietary client and private multiplayer hosting require review of terms and relevant permissions.

## 6. X-Eve is a separate gated experiment

Do not run the X-Eve installer against the repository cloned in step 2. Find a legitimate source for the **exact** v0.12.3.1 compatible server archive, validate SHA-256 from README, use a disposable copy, back up runtime state, and follow X-Eve's installer/verifier documentation.

## 7. Report back

Use `docs/TEST_REPORT_TEMPLATE.md`. Include anonymized output of `docker compose ps --all`, selected log lines, SHA of upstream checkouts, actual client-build availability, and any failures.

## Extra: compatibility guard and backend diagnostic

To validate **only** the X-Eve documented archive identity (not a server checkout):
```powershell
.\scripts\Test-XEveBaseline.ps1 -ArchivePath 'C:\Downloads\EveJS-v0.12.3.1.zip'
```

It exits nonzero on a mismatch, and does not modify the archive or install anything. Never substitute a different hash merely to bypass this check.

When Docker is started, run the backend state check **from the orchestration repository**:
```powershell
.\scripts\Check-Backend.ps1
```

Failure means the prerequisite services are absent or unhealthy. It is not proof of an EVE client login or of co-op play.

To discover upstream network dependencies:
```powershell
.\scripts\Audit-Network.ps1 -OutputPath '.\network-audit.csv'
```

Treat this generated report as local investigation, not as permission to expose game ports.

## Docker security verification before deployment

From this orchestration repository, after fetching upstream:
```powershell
.\scripts\Test-ComposeSafety.ps1
```

The script runs `docker compose config --format json` against the upstream `Code/compose.yaml` and fails if a required service is missing or a published port is not explicitly bound to the host loopback interface. This is an intentionally strict *local-only* gate: it must **not** be weakened to enable VPN access. Future permitted remote access requires a separate, reviewed gateway design.
