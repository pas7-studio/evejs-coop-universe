# Chat 41 — private two-PC EveJS operations and recovery

**Source status (2026-10-25): CODE_READY / LIVE_UNVERIFIED.** The pinned native server is `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. This commit adds *read-only* host/transport diagnostics, strictly opt-in backup and isolated-volume restore, and a source-based upgrade preflight. It does **not** run Docker, change live volumes, install credentials, open firewall ports, modify proprietary clients, or establish two real gameplay clients. The operator must perform the commands below on their own Windows 11 computers.

## 1. Security blockers found in the actual pinned source

**Do not connect a second device yet.** In `Code/evejs.config.local.json` the pinned checkout contains:

- `devAutoCreateAccounts: true` — implicitly creates accounts on first login.
- `devSkipPasswordValidation: true` — allows any password to access existing non-banned accounts.
- `devHandshakeSeedSkillExtractorAccessToken: true` — a development handshake token bypass (warned, not treated as equivalent to password bypass).

For private multiplayer, first create **two distinct accounts by a reviewed native account-management method**, then have the owner explicitly disable **both** account-create and password-validation bypasses. Confirm normal password authentication with two accounts *before* allowing a second PC. No GM session, shared account, debug credentials, or account-store edits are included in this task. Do not commit the local config, password hashes, certificates, JWT keys or account database. A secure VPN does **not** make account impersonation safe.

The read-only audit also requires `devBypassAssetSafetyWrapAccess: false` and `upwellGmBypassRestrictions: false`. A per-container `EVEJS_DEV_SKIP_PASSWORD_VALIDATION=true` or `EVEJS_DEV_AUTO_CREATE_ACCOUNTS=true` is rejected even if the local file looks safe. Review effective runtime values separately: local on-disk checks cannot attest to a running image built from a different revision.

**Pinned Compose container listeners:** `EVEJS_GAME_SERVER_BIND_HOST=0.0.0.0` and analogous service bindings are **internal to the container**. The Docker **host-published** mappings are loopback-only: `127.0.0.1:443→26003`, `5222→5222`, `26000→26000`, `26001→26001`, `26002→26002`, `40110→40110` (market health). Market daemon RPC on internal `40111` is **never published**, and neither `40110` nor `26003` is SSH-forwarded.

**Endpoint advertisement:** native Compose uses `EVEJS_GAME_SERVER_HOST=127.0.0.1`, `EVEJS_IMAGE_SERVER_URL=http://127.0.0.1:26001/`, `EVEJS_MICROSERVICES_PUBLIC_BASE_URL` and `EVEJS_MICROSERVICES_REDIRECT_URL` at `http://127.0.0.1:26002/`, and `EVEJS_XMPP_CONNECT_HOST=localhost`. These can stay unchanged for **symmetric local port forwarding**, but additional in-band redirects, CA trust, launcher resources, HTTPS and XMPP have not been accepted from a genuine remote client. **Do not** replace advertised localhost with a public/VPN URL or bind the game directly to the VPN interface to work around a failure.

## 2. Intended topology — one server, two real independent clients

```
Host Windows 11                                 Friend Windows 11
one authoritative EveJS Docker stack           separately authorized EVE client
server/market GameStore volume                  SSH client only, NO EveJS server
Docker host ports 127.0.0.1:26000/...           local 127.0.0.1:26000/...
                       ^                        |
                       | SSH forwards: 5 TCP ports, loopback -> loopback
                private mesh VPN (Tailscale / WireGuard peer route)
                SSH host key pinned, key-only, friend IP-scoped ACL
```

Use an **actual private VPN peer address** in RFC1918 or Tailscale's `100.64.0.0/10` address range. The default Chat 41 gate refuses arbitrary public IPs, public NAT port forwards, `0.0.0.0` listeners for game ports, weak SSH `StrictHostKeyChecking`, reverse forwards and wildcard local forwards. The legacy [`FRIEND_PC_PRIVATE_TUNNEL.md`](FRIEND_PC_PRIVATE_TUNNEL.md) describes an optional public forwarded-SSH/Proton scenario: **that scenario is OUT OF SCOPE for this task and must not be activated without separate explicit approval**. The project does not provide a public Internet deployment.

The friend validates the SSH host fingerprint **out of band**, checks tailnet ACL/device identity, and supplies their own **public** SSH key to the host. Never transfer the host's private SSH key, password database, TLS CA signing key, `.env`, or local GameStore. For SSH host firewall, use a verified rule limited to **the friend's single VPN IPv4 on the VPN interface**; verify existing broader Windows OpenSSH Allow rules are absent or disabled, and validate actual `sshd -T` / keys. Generic `Get-NetTCPConnection` cannot prove firewall effectiveness.

Friend tunnel script, already present in this repo:

```powershell
# Friend PC, verify VPN and SSH known_hosts identity first
.\scripts\Start-Friend-Tunnel.ps1 -Action Check -HostVpnIPv4 <host PRIVATE VPN IPv4> -SshUser coopguest
.\scripts\Start-Friend-Tunnel.ps1 -Action Start -HostVpnIPv4 <host PRIVATE VPN IPv4> -SshUser coopguest -IdentityFile "$env:USERPROFILE\.ssh\id_ed25519"
# Separate PowerShell window while SSH is connected:
.\scripts\Start-Friend-Tunnel.ps1 -Action Verify
.\scripts\Measure-Private-CoopLink.ps1 -Mode Tunnel -Samples 7
.\scripts\Measure-Private-CoopLink.ps1 -Mode SshPeer -VpnPeerIPv4 <host PRIVATE VPN IPv4> -SshPort 22 -Samples 7
```

This forwards exactly the ports `443, 5222, 26000, 26001, 26002` from the friend's **own** `127.0.0.1` to the host's `127.0.0.1`. It deliberately does not forward market diagnostics, Docker, GM/admin RPC, Docker socket, host SSH agent, or any public-facing game listener. SSH `-N -T`, `ExitOnForwardFailure=yes`, `StrictHostKeyChecking=yes`, `BatchMode=yes`, `GatewayPorts=no`, keepalives and one connection per host are already set by `Start-Friend-Tunnel.ps1`.

`Measure-Private-CoopLink.ps1` reports TCP connect p50/p95, range and timeouts, not EVE engine RTT. For real latency record 30–60 seconds of native EVE client ping/interaction latency and count packet losses/reconnects, plus two-player scene visibility. VPN ICMP blocking does not prove failure; TCP readiness does not prove playable game.

## 3. Host-side read-only diagnostics

```powershell
# Host PC — safe even when Docker is running; never touches live state
.\scripts\Verify-Private-Coop.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Test-ComposeSafety.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Audit-Network.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Check-Backend.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld
```

The new verifier runs `docker compose -f compose.yaml [-f compose.coop-probe.yaml] config --format json` and sends the expanded configuration **only through a Node stdin pipe**, never to disk or logs. It parses native JSON-with-comments, checks required `init/market/server` services, loopback host port mappings and port targets, Docker socket or host-mode escapes, the **same named `evejs-data` GameStore volume** mounted in all three services, auth bypasses, internal market endpoint, image/proxy/XMPP advertised addresses and actual Windows listeners. It warns if generated portraits lack a separately preserved `evejs-images` named volume. Prints sanitized findings and returns nonzero on any blocking violation. Optional `-HostVpnIPv4` checks the private peer; `-RequireSsh` also checks an SSH listener but is **not** a firewall audit.

Avoid `docker compose config` output in public bug reports: it may contain substituted secrets. Only publish the validator's sanitized PASS/FAIL summary. `Docker healthy` / `TCP open` / `World activity` / `one authenticated client` / `two authenticated native clients` are distinct evidence levels.

## 4. Consistent offline backups — no running volume writes

Before **any** overlay update, runtime change, market reseed, engine rebuild or risk-bearing test, capture an immutable backup. `evejs-data` carries GameStore characters, inventory, wallets, contracts, mission progress and NPC/economy state. `evejs-images` holds generated player portraits if it is mounted. Bind-mounted server certificates and local configuration require a **separate protected backup** (never commit them); Docker image hashes, git SHA and Compose override should be recorded separately in a private operator note.

```powershell
# 1. Read-only discovery; FAILS if any source volume is used by a running container
.\scripts\Coop-Volume-Safeguard.ps1 -Action Plan -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'

# 2. With operator approval: make sure no clients are connected, save logs,
#    then STOP ONLY the intended services yourself, no 'down -v':
cd C:\Games\EveCoop\upstream-evejs\Code
docker compose -f compose.yaml -f compose.coop-probe.yaml stop server market
#    (omit -f compose.coop-probe.yaml if it does not exist)

# 3. Owner creates a restricted/encrypted external directory e.g. D:\EveCoopBackups
#    and separately stages the offline busybox:1.36 utility image.
#    Manually review its provenance, then record its actual image ID:
docker image inspect --format '{{.Id}}' busybox:1.36
cd C:\path\to\evejs-coop-universe
.\scripts\Coop-Volume-Safeguard.ps1 -Action Backup -Apply -BackupRoot 'D:\EveCoopBackups' -ExpectedUtilityImageId '<reviewed sha256:image ID>'
```

The script requires an explicitly reviewed, exact local BusyBox **image ID** (`sha256:...`) for actions that create or extract archives; it never downloads images, starts game services, runs reseed/init, or auto-stops containers. It validates the *effective* Compose named-volume sources and calls `docker volume inspect` **before** mounting, preventing Docker from silently creating an empty missing GameStore volume. It refuses backups while **any running container** mounts a source volume. Backup uses an offline `busybox:1.36` disposable container, `--network none`, `--read-only`, source volume mounted **read-only**, and host backup directory as the only writable mount. It writes `evejs-data.tar`, optional `evejs-images.tar`, and `manifest.json` with byte counts, SHA-256 and timestamp. Incomplete archives remain marked by a missing/invalid manifest; do not use them.

Verify backup independently:

```powershell
.\scripts\Coop-Volume-Safeguard.ps1 -Action Verify -BackupPath 'D:\EveCoopBackups\evejs-coop-YYYYMMDDTHHmmssfff'
```

No script can guarantee consistency if another process changes the data after the stopped-consumer check. Use an operator-controlled maintenance window and backups of any external data stores too. Files inside the Docker image or external bind mounts are not included in named-volume archives.

## 5. Restore — fresh isolated volumes only

Never restore over production `evejs-data`, never issue `docker compose down -v`, never run first-time bootstrap on an existing world, and never trust an unverified user-supplied tar archive. Restoration is a separate **explicit** action:

```powershell
# Dry-run, verify archives and plan new volumes; existing world stays untouched
.\scripts\Coop-Volume-Safeguard.ps1 -Action RestoreToNew -BackupPath 'D:\EveCoopBackups\evejs-coop-YYYYMMDDTHHmmssfff' -DestinationSuffix 'recovery-20261025'

# Only after reviewed backup hashes, owner-approved changes and isolated tests
.\scripts\Coop-Volume-Safeguard.ps1 -Action RestoreToNew -BackupPath 'D:\EveCoopBackups\evejs-coop-YYYYMMDDTHHmmssfff' -DestinationSuffix 'recovery-20261025' -ExpectedUtilityImageId '<reviewed sha256:image ID>' -Apply
```

Restored volumes are named, for example, `evejs-data-recovery-20261025`. **Nothing** swaps Compose mappings, imports account data to a running world, overwrites existing volumes or deletes failed restores. Verify contents/permissions (GameStore SQLite integrity, inventories, wallets, portraits), run an isolated scratch stack using only the restored volumes, log in both test accounts after verifying legal client compatibility, and compare IDs/quantities/wallet balances to the backup manifest. Switching a production world's Compose volume mapping is a **separate manually approved operation** with downtime and a tested rollback plan.

## 6. Safe overlay upgrade and rollback workflow

```powershell
# This runs read-only gates: exact pinned upstream SHA, verified backup hashes,
# Compose/auth and observed host listeners, pinned patch source DRY RUN.
.\scripts\Plan-Private-Coop-Update.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -BackupPath 'D:\EveCoopBackups\evejs-coop-YYYYMMDDTHHmmssfff'
```

Approval checklist: record **this overlay Git commit** and pinned EveJS SHA; verify clean planned patch anchors (`PRISTINE`/`PATCHED` rather than `DRIFTED`), no pending two-client sessions, both GameStore and generated-images volume data preserved, and all downtime/cooldown/skill-progress risks reviewed. The owner's existing [`Deploy-Coop-RuntimeProbe.ps1`](../scripts/Deploy-Coop-RuntimeProbe.ps1) remains the only authorized deployment path, with its built-in preflight, `--check`, Compose loopback checks, build and `up -d`. The Chat 41 tools deliberately **do not call deployment**. If the new overlay and running runtime diverge, halt and audit; never force-rebase, force-push or overwrite other agents' source changes.

Rollback after a failed, owner-approved deployment: stop the affected services, preserve the failed world's volumes **as additional forensic backup**, restore previous source/overlay from its pinned commit on a separate worktree, validate `--dry-run` and `--check`, then restart only with the same original volumes **if data schema compatibility is proven**. If an upgrade migrated persistent schema, roll back **both code and data as a matched snapshot** into fresh volumes, verify in an isolated stack, then perform a separate approved cutover. Reverting the source alone does not reverse a data migration. Never delete DB rows, fake ACKs or reinitialize market to fix a broken deployment.

## 7. Two-player acceptance and reconnect / failure drills

Record the exact local shell commands and game observations; neither tunnel status nor this document implies success:

1. Host remains connected to account A; friend connects through private tunnel using distinct account B. Confirm native account IDs and character IDs are different, login password actually validated, no dev/GM bypass, and simultaneous sessions are visible from server authoritative logs.
2. Both characters share one native world and same NPC scene; move, warp, target, shoot, inspect one shared wreck and change cargo. Record real client screenshots and server-native event IDs; no synthetic sessions.
3. Friend closes only their SSH tunnel, without touching Docker. Host A remains online. Reconnect B through the same pinned host key and fresh authenticated login; verify exactly one B session, one active ship and durable inventory/wallet/skills; no duplicate spawns or ghost inventory. Compare after restart **only in a planned maintenance window**.
4. Validate live 443/26001 images, 26002 proxy health, 5222 XMPP, account authorization, endpoint redirects and pinned TLS/certificate trust. Do not bypass TLS verification or install an untrusted CA to make a connection pass.
5. Capture TCP p50/p95 and real client latency, disconnect counts and reconnection time, logout/relogin persistence and a real stopped-volume backup/restore test. Deny other VPN peers and confirm public external networks cannot reach game ports or SSH.

The user-facing state only graduates from `CODE_READY` to `LIVE_TWO_CLIENT_PASS` after those real observations and a verified restore rehearsal. A **failed** security gate is a useful result: keep the existing localhost-only installation and do not open public access.

## Automated isolated regression evidence

`node --test tests/coop-private-host-safety.test.mjs` checks malicious Compose host publishing, wildcard IPv4/IPv6 listeners, extra market RPC port, missing GameStore mounts, source/dev auth bypass, endpoint redirects, hostile peer/SSH options, and valid pinned shape. It is an isolated pure test; PowerShell and Docker on the owner's Windows machine remain unexecuted in this session. No GitHub Actions/CI introduced.


## Chat 41 post-merge reconciliation (2026-10-26)

Changes relative to Chat 41 baseline `b6e590406658a18d7884051d90d9642713002ea9`:

- **Advertising**: private Compose audit now verifies exact host-local TCP target ports `26001` and `26002`, not merely a loopback hostname. This prevents advertising a loopback-only but unforwarded or administrative port to the second client.
- **Auth overrides**: deny `EVEJS_DEV_SKIP_PASSWORD_VALIDATION` / `EVEJS_DEV_AUTO_CREATE_ACCOUNTS` when set to `true`, `1`, `yes` or `on`, in addition to native config checks. Only two distinct, intentionally provisioned accounts may be used.
- **Partial backups**: a missing named `evejs-images` portrait volume now blocks a mutable backup unless the operator explicitly passes `-AllowMissingPortraitVolume`. The manifest records `portraitsIncluded`, and the script checks volume consumers before/after each archive. A read-only planning warning is not complete portrait recovery.
- **Restore archive validation**: the offline `coop-private-tar-audit.cjs` checks checksums, TAR entry paths, types and duplicate names before a new volume is created. Only plain ustar regular files/directories are supported; old archives with links, PAX or GNU extension records are **rejected for manual safe migration**, not silently extracted. Archive SHA-256 alone was insufficient.
- **Upgrade pin**: the preflight no longer accepts a caller-overridden `ExpectedUpstreamSha`; cross-chat overlay upgrades require the fixed audited pinned EveJS commit and a fresh native source/installer review.

**Do not call this a live deployment.** Native Docker Desktop, Windows firewall, SSH/TLS, original client and cross-machine reconnect were not exercised in this change. The central installer is still owned by Chat 01 and deployment remains a separately approved operator action. A backup/restore run must be completed on an isolated Windows test host before release acceptance.
