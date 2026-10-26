# Chat 41 — post-42 merge reconciliation and PR handoff (2026-10-26)

**Purpose:** a reviewable, single-commit handoff for the private two-PC operations
stream. All files are staged source/runbooks/tests. **No public game
listeners, no live deployment, no Docker volume writes, no credential
provisioning, no client or TLS modification.** The current main branch is
changing rapidly due to other agents: use the PR's GitHub commit graph as
canonical history; never assume the snapshot HEAD below remains current.

## Anchors and commit provenance

- Chat 41 original delivery: **`b6e590406658a18d7884051d90d9642713002ea9`** — private Compose/auth/endpoint audit, Windows TCP probes,
  offline backup/restore and pinned source-upgrade preflight.
- Coordination/persistence baseline by Danbalan: **`81b6469b463afd7d6add891bc0458d73c732a222`** — native account persistence and SQLite durability.
- Central follow-up integration by Danbalan: **`e9bc93d28bba`** — post-42 native modules, local-only QA and deployed sibling imports.
- Independent QA filename regression by Danbalan: **`ba8cc94c1289`** — native module match correction.
- Chat 42 independent QA gate: **`f49b05bf41ab`** — not proof of real two-client gameplay.
- Main at last pre-PR recheck: **`f1c61d4f8563c07125f6d7a44b5b27193492d97f`**, already containing a sequence of NPC economy/market/hauling merges including #188–#190. The private ops fixes neither modify those services nor claim they are verified.
- Pinned upstream (not a mutable head): **`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`**.

The PR commit itself and updated base SHA are in the GitHub PR's **Commits** tab and must be copied into any later merged integration report. No second unrecorded overlay changes are included.

## Confirmed defects addressed here

1. Existing private host gate accepted any loopback **port** in the advertised image/proxy URLs. It now validates exactly HTTP/26001 for images and HTTP/26002 for proxy/redirects; this rejects a loopback URL that would redirect the second client to an unforwarded or privileged service.
2. Compose auth-gate rejected `true` but missed the equivalent truthy environment overrides `1`, `yes`, `on`; all now fail closed.
3. A mutable offline backup could emit a green manifest when the character portrait volume was missing. It now requires a deliberate `-AllowMissingPortraitVolume` override for **partial backups**, annotates the manifest, and rechecks stopped volume consumers before and after each archive. This is not a filesystem snapshot/transaction; maintain an exclusive operator maintenance window.
4. Archive SHA-256 does not prove that TAR entries are safe for extraction. A standalone **fail-closed** TAR parser now verifies header checksums, plain ustar regular-file/directory members, relative non-traversing paths, no duplicate paths, no symlinks/hardlinks/devices/PAX/GNU longname, and a zero archive trailer. `Verify-Manifest` invokes it before `RestoreToNew` can create **any** new volume. The validator was exercised against a real BusyBox-generated TAR and negative fixtures; unsupported archive formats require manual migration, not bypass.
5. `Plan-Private-Coop-Update.ps1` accepted caller-controlled `-ExpectedUpstreamSha`, which could defeat pin enforcement. That override is removed; pin is fixed and source validation remains read-only.

Files touched: `integration/coopPrivateHostSafety.cjs`,
`scripts/Coop-Volume-Safeguard.ps1`, `scripts/Plan-Private-Coop-Update.ps1`,
`tests/coop-private-host-safety.test.mjs`, `tests/coop-private-ops-runbooks.test.mjs`,
`docs/COOP_PRIVATE_HOST_CHAT41.md`; new `scripts/coop-private-tar-audit.cjs`,
`tests/coop-private-tar-audit.test.mjs`, and this handoff.

## Tests and limits

- **47/47 Node 22 local tests PASS**, including pre-existing 32 tests, four new auth/advertisement/backup/pin regressions, and ten standalone TAR safety fixtures.
- Real BusyBox-produced uncompressed TAR accepted by the independent safety checker; malicious/ambiguous entries rejected in isolated fixtures.
- **NOT RUN:** Windows PowerShell 5.1 execution, Windows firewall/SSH key policy, remote VPN client, TCP/TLS/XMPP handshake, actual EVE client on two PCs, Docker Desktop Compose config on owner machine, live database restore, snapshot consistency under power loss. No inference from Node tests to gameplay acceptance.

## For parallel owners / integration responsibilities

**Chat 01 — central installer/runtime:** retain the reversible pinned source
installer and current 72+ overlay module selection; do not fold Chat 41
utilities into the game server's runtime or duplicate their names. Keep
`EVEJS_GAME_SERVER_HOST=127.0.0.1`, image HTTP/26001, proxy HTTP/26002,
XMPP localhost and Docker host port bindings loopback-only. Require
`devSkipPasswordValidation=false`, `devAutoCreateAccounts=false`, and two
separate provisioned account IDs. Review the entire effective Compose and
runtime config after new overlay merges. No feature is enabled by this PR.

**Chat 40 — durability/persistence:** confirm GameStore/SQLite account,
wallet, ship, industry, escrow and NPC recovery can be restored from a
**quiesced** `evejs-data` snapshot. Coordinate atomic schema cutovers with
code rollback; never restore over original named volumes. Portaits stored in
`evejs-images` are a second distinct volume, while bind-mounted certs and
local secret config require a separate encrypted operator backup. This PR
adds no database recovery semantics or automatic transaction replay.

**Chat 42 — independent acceptance:** keep G0 unit, G1 runtime, G2 two
independent authenticated clients and G5 private transport distinct.
Require a real VPN/SSH transport, read-only `Verify-Private-Coop.ps1`
PASS, **no** public listeners and dev-auth bypass OFF, then two real client
logins, concurrent scene events, B-only tunnel disconnect/reconnect without
A session loss, cargo/wallet/ship invariants, local source/latency evidence,
and an owner-approved isolated-volume restore rehearsal. Nothing here
satisfies G2/G5 by itself.

**Chat 06/39 and game network owners:** do not interpret a TCP-open tunnel
as functional endpoint advertisement or authenticated client; verify
actual image, HTTPS, XMPP and in-protocol redirects. Existing
`scripts/Start-Friend-Tunnel.ps1` has optional public-peer paths; **this
PR does not approve those paths**, and public port forwarding needs separate
owner permission. No proprietary client binaries or TLS trust roots are
modified.

**Other active PR owners (#164, #167, #170, #177, #179, #183, #185,
#191, #192 at review time):** merge only against live `main`, respect
`Danbalan` central integration commits, and keep source-only safety
flags default OFF. This PR touches neither their runtime code nor
Docker volumes. New code needing additional Docker published ports or
insecure dev login must receive explicit security review instead of
relaxing `coopPrivateHostSafety.cjs`.

## Operator acceptance after merge

```powershell
# Repo tests, then native source / Docker host (read-only):
node --test tests/coop-private-*.test.mjs
.\scripts\Verify-Private-Coop.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Plan-Private-Coop-Update.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -BackupPath 'D:\EveCoopBackups\<verified-backup>'
```

The old `evejs.config.local.json` in pinned source has unsafe `true`
password and auto-create flags; the private-host verification **should
fail** until owner provisions accounts and disables them. On a Windows
host with absent persistent images the operator must recover/preserve
existing portraits before treating backup as complete. Do not run
`docker compose down -v`, public SSH forwarding, live volume restore,
market reseed, or game-server redeploy from this PR.

**Merge criterion:** all platform-independent Node tests pass; the PR
changes only Chat 41-owned operational files; no conflicts with later
`main` updates; Windows/lifecycle checks stay explicitly pending rather
than implied by a green source commit.
