# Upstream provenance and compatibility register

As of 2026-10-25. Links/documentation inspected; **no local executable test has been performed**.

## Pinned revisions (the only place a pin may be declared)

The installer `scripts/patch-evejs-coop.cjs` refuses to run on any other
revision. A pin change is only valid when this table and the installer `PIN`
change in the same commit — `tests/coop-overlay-drift-check.test.mjs` fails if
they disagree. See [DEVELOPMENT_DOCTRINE.md](DEVELOPMENT_DOCTRINE.md) §5 for the
upgrade runbook.

| Upstream | SHA | Pinned since | Notes |
| --- | --- | --- | --- |
| [gameboys84/EveJS](https://github.com/gameboys84/EveJS) | `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` | 2026-10-24 | 19 native files / 22 hooks / 59 overlay modules; not yet upgraded once |

When a new SHA is adopted, add a row (old → new) with the re-anchor work done and
the evidence file `docs/evidence/overlay-<sha>.md`. Never delete old rows.


| Component | Repository | Important caveats |
| --- | --- | --- |
| EveJS (primary) | https://github.com/gameboys84/EveJS | README targets EVE 24.01 / build 3396210; explicitly localhost-only; entry code under `Code/`, AGPL-3.0-only statement |
| X-Eve Living Universe | https://github.com/kaiwren986/evejs-living-universe | Independent *patch-only* repository; v0.2.2 requires exact compatible EveJS v0.12.3.1 archive, no server/client bundled |
| EveJS-Frontier | https://github.com/melkordoran/EveJS-Frontier | Separate experimental fork, not automatically compatible with X-Eve |
| X Command | https://github.com/kaiwren986/x-command | Separate UI project; X-Eve README states bridge integration is intentionally not bundled |
| EveJS launcher | https://github.com/V0nCleef/evejs-launcher | Community experiment; evaluate independently before installation |
| EveJS automining | https://github.com/V0nCleef/EveJS-Automining | Community extension, **not** confirmed compatible with our chosen baseline |

## Contribution and licensing policy

1. Prefer minimal reproducible fixes with upstream PRs rather than unrelated, diverging rewrites.
2. Pin commit SHAs and tags; check actual licenses, dependencies, forks, patch applicability and provenance before copying code.
3. Never add EVE clients, copyrighted assets, static data of unclear origin, patched DLLs, passwords, keys, certificates, private server configuration, generated DBs or scraped client files.
4. CCP's intellectual-property and client-license restrictions are distinct from open-source licenses attached to emulator files. Seek permission where needed; repository availability is not proof of legal authorization.
5. Keep this repository documentation-only until executable artifacts have undergone source/license/security review and functional tests.

## Before accepting an integration

- License and provenance audit complete.
- Reproducible minimal clean install documented.
- Baseline revision and X-Eve patch hash verified.
- Test covering claimed feature and rollback.
- No private-client installation or proprietary artifacts committed.
- Co-op network exposure explicitly reviewed.
