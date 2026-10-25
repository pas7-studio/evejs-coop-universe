# COOP-059 — Native economy CI and authenticated operator recovery

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

## CI

.github/workflows/coop-native-economy-gate.yml runs on PRs to main, pushes to main and the COOP-059 branch, plus manual workflow_dispatch.
Node 22 gate verifies real node:sqlite, then executes Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests including real loopback HMAC/nonce/recovery tests.
Rust gate checks out pinned gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f in a disposable directory, applies native Rust overlays, executes cargo test --locked --all-targets and verifies reverse-patch diffs.

Acceptance for closing CI: BOTH Node/SQLite and Rust jobs green on the exact final merged main SHA (not an ancestor).
Real two-client gameplay, physical market settlement and process crash/restart remain separate disposable-world E2E gates and must not be claimed from code tests.

All flags remain OFF in permanent gameplay and the protected evejs-data volume is untouched.