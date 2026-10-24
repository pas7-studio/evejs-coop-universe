# Agent operating agreement

Read `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/UPSTREAM.md`, and `docs/SETUP_WINDOWS.md` before any changes.

## Boundaries
- This repository is initially a **documentation and orchestration repository**, not a working EveJS distribution.
- Do not silently vendor/copy external emulator source or copyrighted game client files.
- Do not modify game client binaries, override client authentication/DRM, distribute CCP assets or expose the unsupported game server to a remote network.
- Do not bind EveJS services to `0.0.0.0` or redirect ports into a public/VPN interface by default.
- Avoid claims that any functionality works without reproducible test evidence.
- Do not pretend that `EveJS main` is the exact v0.12.3.1 archive required by X-Eve v0.2.2.
- Treat the original legal and security assessment as a gate for client modifications and remote gameplay.

## Change discipline
- One task ID from `docs/ROADMAP.md` per small reviewable change.
- Prefer native upstream bugfixes with references and attribution over fork-only rewrites.
- Tests and rollback strategy for every functional change.
- Record source URL, revision SHA, local environment and pass/fail evidence.
- Do not change task status to DONE on documentation alone.
- Never commit credentials, client data, dynamic databases, certificates, binaries, screenshots of personal information, or session tokens.

## Current highest priority
COOP-001 upstream source audit; COOP-002 backend-only Docker verification; COOP-004 permissions; COOP-010 listener/session audit. `COOP-011` may use only a disposable TCP test server, not EveJS exposed endpoints.
