# COOP-059 — Manual native economy validation and authenticated operator recovery

## Security model

This is an opt-in, server-host-only recovery control, never a player-facing RPC, slash command, GM chat action or public game route.
Implementation: integration/coopNpcBuyerAdminControl.cjs, called from the real coopAlifeNativeBuyerRuntime.cjs native buyer binding.

Four required switches (all OFF by default):
- EVEJS_COOP_NPC_BUY_ADMIN_LOCAL=1
- EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR=1
- EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
- EVEJS_COOP_NPC_BUY_PLAYER_ASK=1

Additional server configuration:
- EVEJS_COOP_NPC_BUY_ADMIN_PORT=17171 (binds 127.0.0.1 only)
- EVEJS_COOP_NPC_BUY_ADMIN_SECRET_FILE=/var/lib/evejs/ops/npc-recovery.key
- EVEJS_COOP_NPC_BUY_ADMIN_AUDIT_FILE=/var/lib/evejs/ops/npc-recovery-audit.jsonl

The secret must be a 32–4096 byte, non-symlink regular file, owned by the EveJS process user with no group/other permission bits on POSIX (chmod 600). Never supply a literal secret as a CLI argument. Run on an isolated test server or over a trusted SSH session to the same host; do not configure a reverse proxy or external port mapping.

Create a test key, as the EveJS Linux user:
    mkdir -p /var/lib/evejs/ops
    chmod 700 /var/lib/evejs/ops
    umask 077
    head -c 48 /dev/urandom > /var/lib/evejs/ops/npc-recovery.key
    chmod 600 /var/lib/evejs/ops/npc-recovery.key

## Two-step operator workflow

1. On the EveJS server host, inspect one claim:
    node scripts/coop-npc-buyer-admin.cjs audit --claim-key=npc-corpbuy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

2. Inspect the returned action and 90-second one-time ticket. A HOLD_MANUAL, lock, or missing Rust/GameStore proof never yields a ticket.

3. Only after human review run, substituting genuine values:
    node scripts/coop-npc-buyer-admin.cjs recover --claim-key=npc-corpbuy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --ticket=THE_AUDIT_TICKET --action=ACK_JOURNAL_SAME_CLAIM --actor-id=REAL_NPC_ENTITY_ID --reason='Verified Rust finalize and GameStore payment'

Each request uses HMAC-SHA256 over timestamp, unique nonce, method-specific path and hash of the JSON body. The key never traverses the wire. Server enforces a 60-second timestamp window, nonce replay protection, exact pre-audit status and one-use ticket/approval.

Before any recovery write the server fsyncs an APPROVED operator audit record. It then mints a one-time approval ID, invokes the existing recoverApproved with the SAME durable claimKey and re-audits the original Rust order/history, GameStore item/ISK/tax receipt and write-ahead journal. The RESULT is also fsynced. Uncertain results must be inspected with a new audit, never a blind retry. The NPC entity/station/controller is re-attested against a maximum 30-second recent A-Life snapshot and actual physical world state.

The server does not delete a preexisting lock, grant a player session operator privileges, directly manipulate market/history, or move ISK/items outside the existing native settlement writer.

## Local/manual verification (no GitHub Actions)

The repository's binding `AGENTS.md` policy prohibits GitHub Actions and
remote CI. The originally proposed workflow was deliberately removed before
merge. **No CI runs or green checks are claimed.**

1. On Node.js 22+ / PowerShell 7, in a disposable checkout:
   `./scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests`.
   This includes the localhost HMAC/replay/recovery tests and real node:sqlite
   source-based tests. Record the exact project SHA and PASS/FAIL output.
2. On a separate clean pinned checkout of
   `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`,
   apply native Rust overlays using the existing repo scripts in order:
   `coop-rust-npc-pending-patch.cjs`,
   `coop-rust-npc-settlement-patch.cjs`,
   `coop-rust-npc-partial-patch.cjs`,
   `coop-rust-npc-corp-buy-patch.cjs`.
   Run `cargo test --locked --all-targets` from
   `Code/externalservices/market-server`. Remove overlays in reverse order
   and confirm the pinned source returns byte-identically. Never run these
   patch commands against the live upstream checkout.
3. Verify the reversible Node overlay with a pinned disposable CodePath and
   run a separate two-client physical/financial E2E on an **isolated copy**
   before enabling any finance or operator feature flag.

The Node/SQLite and Rust commands are **NOT_RUN** for the exact integrated
main revision unless a local operator supplies results. Actual two-client
gameplay, wallet settlement and process crash/restart remain distinct acceptance
gates; do not infer PASS from code review or from prior SHAs.

All flags remain OFF by default. Do not modify the protected `evejs-data`
volume or expose the localhost recovery interface through Docker/VPN ports.
