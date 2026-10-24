# Agent operating agreement

Read `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/UPSTREAM.md`, and `docs/SETUP_WINDOWS.md` before any changes.

## CI prohibition — repository owner decision (2026-10-24)
Do not add, restore, enable or run GitHub Actions workflows or any
other remote CI automation. The entire `.github/workflows` directory
was deliberately removed from `main` and this branch. Testing is
manual/local only, with explicit PASS/FAIL evidence. Never equate
server contract tests with observed EVE client gameplay.

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

## Manual headless native NPC evidence (owner-directed)
Before any claim that autonomous NPCs work without players, consult
`docs/HEADLESS_NPC_VALIDATION.md` and use the local World evidence gate.
Physical ship presence is NOT proof of motion, mining, combat or loot.
Do not invent runtime PASS based on tests alone. No GitHub Actions or
remote CI workflows may be created or executed.

## Current owner-directed NPC feature block (2026-10-24)
Review [NPC memory and faction chronicle](docs/NPC_MEMORY_AND_FACTION_CHRONICLE.md).
Implement and test NPC-MEM-001/002/003 and NPC-FACTION-001 without
substituting fabricated ship events or virtual market orders for native
EveJS outcomes. This is not permission to bypass the P0 network/client
legal and security gates, which are postponed as a separate block.
The real two-client gameplay and NPC inter-system/market-order acceptance
tests remain unverified. Do not mark these systems DONE on unit tests alone.
