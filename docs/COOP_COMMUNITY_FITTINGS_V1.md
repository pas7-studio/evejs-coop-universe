# COOP-043 — Native Community Fittings for EveJS Co-op

**Status:** IMPLEMENTED + RUN LOCALLY (real dogma validation, live public harvest, stopped-world staging apply/rollback, native payload probe). **Client (in-game) acceptance and the live-world install are pending the human tester's own clicks and owner approval** — see [COOP_COMMUNITY_FITTINGS_RUN.md](COOP_COMMUNITY_FITTINGS_RUN.md).
**Priority:** P1 gameplay usability (native source verification is complete; client acceptance is not).
**Scope:** Both co-op pilots see the same useful, attributable, compatible ship fittings in the existing native EVE fitting browser.

## Why this is the right integration point

Verified against **pinned** EveJS upstream `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, not just upstream main:

- `Code/server/src/_secondary/fitting/fittingStore.js`: `SAVED_FITTINGS_TABLE="savedFittings"`; `COMMUNITY_FITTING_CORP=1000282`; `OWNER_SCOPE.COMMUNITY`; `MAX_CORP_FITTINGS=600`; `MAX_CHAR_FITTINGS=500`.
- `getCommunityFittingsResponse()` reads that owner's records and returns native client payloads; player `saveFitting`, `saveManyFittings`, update and delete **reject community mutations**.
- Native record: `{fittingID, ownerID, shipTypeID, name, description, fitData:[[typeID,flagID,quantity],...], savedDate}`. Native persistence uses `savedFittings.owners` plus `_meta.nextFittingID`. IDs are globally shared.
- `Code/server/src/services/fitting/liveFittingState.js`: low flags 11–18, medium 19–26, high 27–34, rig 92–99, subsystem 125–132, service 164–171. Cargo 5, drones 87, fighters 158 are separate allowed non-slot flags. Use exported `getSlotFlagsForFamily` and `getRequiredSlotFamily` rather than duplicating slot rules.
- `Code/server/src/services/inventory/itemTypeRegistry.js`: `resolveItemByName` and `resolveItemByTypeID`, backed by the **locally installed** EveJS SDE. Do not resolve names by fuzzy first hit.
- The native fitting store currently has no external provider seeder. An empty community browser does not imply a missing client feature.

**Important:** The native public save API is deliberately read-only for community fits. Do NOT bypass it by calling `saveFitting(1000282,...)`. Build a narrowly trusted seed path with explicit validations and rollback; keep the existing player RPC read-only.

## User-facing outcome

When the player opens the ship fitting browser -> Community Fittings, show curated shared fits (if this client build exposes the native filter). Each entry contains:
- name beginning with a use tag: `[PVE]`, `[PVP]`, `[MINING]`, `[EXPLORATION]`, `[HAUL]`, `[LOGI]`;
- short fit purpose, role, budget tier, skill tier, source/author/link in native description (500 chars max);
- native hull + high/medium/low/rig + drones, cargo, charges and subsystems when supported.

Player should be able to `Save As` / copy into their personal list and fit the modules **only if they own them**. A saved fit is not a grant of modules. Buying missing items must use native market/wallet/inventory settlement and must fail safely when stock is absent. Do not represent clipboard import as auto-install.

**Initial pack:** 24–48 reviewed fits across useful early co-op hulls (Venture, Heron, Merlin, Rifter, Punisher, Tristan, Caracal, Vexor, Osprey, Scythe, Drake, Procurer, etc., only if available in pinned SDE). Favor cheap T1/meta alternatives. Avoid overwhelming the 600-entry browser.

## Sources and rights

1. **EVE Workbench** — primary source of user-published fits. Public API discovered at `https://api.staging.eveworkbench.com/swagger/index.html`: `GET /v1/fits/public`, `GET /v1/fits/{fitId}`, `GET /v1/fits/{fitId}/eft`. This is **staging documentation**, not proof of a reliable or authorized production bulk-download endpoint. Verify production host, API terms, permitted reuse, pagination, quotas and attribution before any automatic synchronization.
2. **Capsuleers.app** — supplementary public browser; it can aggregate EVE Workbench entries. Do not duplicate sources or scrape a site without authorization.
3. **EVE University** — manual instructional reference. Some corporation fits are member-only: NEVER copy restricted corp/alliance fits into public/shared catalog.
4. **User-contributed EFT/XML/DNA** — safe fallback, always with explicit import and provenance.
5. **Elysian FitAll** — research reference only; it seeds per-character slots and has AGPL-3.0 code. It is NOT a substitute for the native read-only community owner and should not be installed blindly, vendored or used to rewrite persistent character files.

Sources: https://developers.eveonline.com/docs/guides/fitting/ ; https://support.eveonline.com/hc/en-us/articles/360017691179-Community-Fittings ; https://api.staging.eveworkbench.com/swagger/index.html ; https://github.com/AmmarSlibi2013/elysian-fitall-eve-online-evejs-saved-fittings .

For every imported fitting retain `source`, `sourceURL`, `author`, `retrievedAt`, `originalFitID`, `licenseOrPermission`, `eftSha256`, `sdePin`, `importerVersion` in an operator-only provenance manifest. Put a compact source credit in the native description, never anonymous bulk copies.

## Required implementation

### P0-A: offline intake / normalization (no world writes)

- Accept explicitly supplied EFT (first), later XML and DNA. Do not execute code from source text and do not trust third-party JSON.
- Input limits (size, entries, name length, quantity, line count); reject malformed, ambiguous or unknown sections without silent truncation.
- Resolve ship and modules by exact local SDE identity; reject missing/ambiguous/unpublished hulls and modules; tolerate new live-game items only as an explicit `UNSUPPORTED_BY_PINNED_SDE` report.
- Translate into native `fitData` flags using actual slot family and hull slot counts. Verify no duplicate slots; cargo/drones/charges are explicit; preserve quantities. Validate category/rig size, turret/launcher limits, CPU, PG, calibration and required skills with native dogma where available. Mark validation stages honestly.
- Produce a non-mutating report: accepted/rejected with reason codes, source attribution, SHA256, unsupported items, price/availability unknowns, and proposed catalog diff.
- Stable dedup key is `source:originalFitID` when available or normalized EFT hash, not display name.

### P0-B: trusted community seeder (opt-in)

- In L3 `scripts/` and an L2 module only where necessary; **overlay, not upstream fork**; no additional npm dependency; follow `DEVELOPMENT_DOCTRINE.md`.
- Explicit `--plan` first; `--apply` only when server is stopped/quiesced, local SQLite backup has been verified, pinned SHA matches, deployed overlay `--check` is clean, and operator opts in. Refuse otherwise.
- Because native community RPC is read-only, create a controlled trusted offline seed path or an upstream-approved admin seed method. Preserve existing `owners`, unrelated character/corp/alliance fittings, and globally unique `nextFittingID`.
- Compare versioned manifest; idempotent upserts; do not delete user-edited or foreign provenance entries. Enforce `<=600` total community records and rollback to exact pre-run bytes on failure. Never reset or replace `evejs-data`.
- Native persistence is SQLite nested-row backed: do not write arbitrary top-level JSON or create a parallel fit store that the native browser cannot read.
- Catalog must be identical and available to two independently authenticated characters. No player endpoint can mutate `1000282`.

### P0-C: gameplay acceptance

1. Offline parser/validator tests PASS on isolated SDE test fixtures: EFT sections, charge/drone quantity, unknown item, wrong slot, overcapacity, duplicate, odd whitespace, malformed input and provenance.
2. Seeder dry-run has no durable writes; repeat application is idempotent; corrupted/mismatched DB/pin fails closed; rollback restores exact state.
3. On disposable server, real native client sees shared Community Fittings entry. Test at least Venture, frigate PvE, exploration and duo logistics (not just direct store JSON reads).
4. Second client in same world sees same results; both can `Save As`, and neither can change source catalog. Restart persistence confirmed.
5. Attempt Fit succeeds when genuine modules and skills are present; otherwise displays meaningful missing-items/skills, never creates ship items, ISK, modules or slots.
6. Missing market stock stays missing; any purchase is a separate real native transaction. No counterfeit stock, dups or ISK loss.
7. Record original fit source, implementation SHA, client build, real client test receipt and rollback command. Do not claim GAMEPLAY PASS on unit-test evidence.

### P1: richer browsing and replenishment

- Add clear categories and budget/skill tiers while keeping native browser usable. Additional source sync is admin-triggered offline, cached and rate-limited, not a gameplay-time HTTP dependency.
- Validate fit relevance for the pinned game version; optional authored replacements for obsolete modules are **new derived fits** with distinct attribution.
- Optional 'Buy missing modules' path checks real market, station, wallet, inventory and race safety; no synthetic market purchase.
- Never install a private mod/EXE, copy unknown binary assets or introduce hidden remote network exposure.

## Definition of done

A merged spec or importer alone is **NOT** feature completion. DONE means both real clients have opened usable community fits from native server state and a fitting action has been proven against real inventory without illicit item creation. Include screenshots/test receipts in the owner's private test record (not public repo) and a redacted report here.

**Current milestone:** source analysis complete; implementation, seed, deployment and client validation remain TODO.
