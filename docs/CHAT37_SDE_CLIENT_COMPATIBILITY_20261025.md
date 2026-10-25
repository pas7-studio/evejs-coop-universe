# Chat 37 — pinned EveJS SDE, ships, Dogma and client compatibility (2026-10-25)

**Result:** confirmed `Small Skill Injector` market-seed `typeID` correction and a new read-only native-vs-CCP SDE audit tool. **No mass SDE upgrade; no client asset or RPC compatibility proven.** Tests use synthetic JSONL fixtures, not a real upstream itemStore or game client. `CODE_READY / LIVE_UNVERIFIED` applies only to these changes, **not to all 2026 ships or modules**.

## Baseline and evidence

- Pinned server: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (see `docs/UPSTREAM.md`). Project notes describe EVE 24.01 / build 3396210 client compatibility.
- CCP's Static Data Export: https://developers.eveonline.com/static-data and automation documentation https://developers.eveonline.com/docs/services/static-data/ ; JSONL `_key` and `types`, `groups`, `categories`, `marketGroups`, `typeDogma`, `dogmaAttributes`, `dogmaEffects` are source data, **not** a proof of client or server-side algorithm support.
- 2026 availability: EVE Ref's CCP archive index https://data.everef.net/ccp/sde/ shows a latest SDE archive modified **2026-10-23 11:09 UTC**. A third-party documentation build https://sde.riftforeve.online/ lists SDE build **3632936** from October 20. The official web UI search cache also contains older October 7 build data. **Do not hardcode a current build without reading the official `latest.jsonl` on the operator's host.** The chat execution container cannot reach the official download host; no actual full 2026 SDE or local pinned GameStore snapshot was imported.
- Schema references: https://sde.riftforeve.online/schema/types/ , /groups/ , /marketGroups/ , /typeDogma/ . CCP describes `typeDogma.jsonl` as attribute/effect lists keyed by typeID.
- Confirmed item IDs: `Skill Extractor` 40519, `Large Skill Injector` 40520 and **`Small Skill Injector` 45635**. Evidence: https://everef.net/types/40519 , https://everef.net/types/40520 , https://everef.net/types/45635 . Existing `scripts/balance-skill-market.cjs` incorrectly used **40521** for Small Skill Injector. Fixed **ID only**; original pricing, quantities, backup and `--apply` behavior are unchanged. Does not alter live market rows.

## Existing pinned EveJS support (source review, not live proof)

- `server/src/services/inventory/itemTypeRegistry.js` loads native GameStore static `ITEM_TYPES` keyed by `typeID`, plus explicit group/category, published, mass/volume, market group, icon and graphic IDs.
- `server/src/services/fitting/liveFittingState.js` reads native `TYPE_DOGMA`, effect IDs, ship slot and module restrictions, skill map, and computes CPU/powergrid and attributes. Fitted ammo/charge category is distinct from module category.
- An SDE with an item, attribute, typeBonus, blueprint, icon or graphic record **does not** guarantee that older EveJS server actions, movement, Dogma application, model data or EVE 24.01 client UI support it.
- `scripts/coop-sde-compat-diff.cjs` compares two full SDEs and does not constitute a client support assertion; this work adds an independent narrower **pinned native vs newer SDE** auditor, not a replacement for it.

## Changed files

1. `scripts/balance-skill-market.cjs`: `40521` → `45635` for Small Skill Injector; no price or stock edits.
2. `scripts/coop-sde-supported-audit.cjs`: read-only, default offline, no game mutations. Checks true native item snapshot typeID and group/category, published status, market group and parent integrity, numeric mass/volume/capacity/radius/graphics, item names, and optional exact native typeDogma attributes/effects against the full CCP 2026 JSONL data. **Missing native Dogma is a blocker**, not a success. Unknown/unpublished types and orphan refs fail closed. Returns samples capped at 150 but full issue counts, with explicit client `NOT_ESTABLISHED` result.
3. `tests/coop-sde-supported-audit.test.mjs` and `tests/coop-skill-market-seed-id.test.mjs`: 17 isolated PASS, 0 FAIL; include wrong attributes, missing type/market group, unpublished, insufficient Dogma, duplicate/corrupt SDE and no mutation.

## Running the operator-only read-only audit

Extract the **official** `latest-jsonl.zip` into a disposable directory. Export read-only snapshots from the original pinned native GameStore `itemTypes` and `typeDogma` (one JSON object per line with stable `typeID` or `_key`); do not edit the deployed database, and do not import SDE rows. Example:

```powershell
node scripts/coop-sde-supported-audit.cjs --sde-dir 'D:\EVE\sde-2026-jsonl' --native-items 'D:\EVE\snapshots\native-items.jsonl' --native-dogma 'D:\EVE\snapshots\native-dogma.jsonl'
node --test tests/coop-sde-supported-audit.test.mjs tests/coop-skill-market-seed-id.test.mjs
```

SDE folder requires `types.jsonl`, `groups.jsonl`, `categories.jsonl`, `marketGroups.jsonl`, `typeDogma.jsonl`, `dogmaAttributes.jsonl`, `dogmaEffects.jsonl`. Native item snapshot rows must contain `typeID`, `groupID`, `categoryID`, `published`, relevant optional numeric fields; native Dogma rows must use `_key`, `dogmaAttributes: [{attributeID,value}]`, `dogmaEffects: [{effectID,isDefault}]`, mapped from native `TYPE_DOGMA`. A missing full native Dogma snapshot or current SDE tables returns nonzero and a blocked status.

**Important:** a matched static snapshot still returns `STATIC_DATA_MATCH_CLIENT_UNVERIFIED`; it NEVER enables or adds typeIDs. If an attribute has changed in CCP 2026, inspect the older client's dogma and effects implementations **before** deciding whether to update that field, not from numeric equality alone.

## Validation and remaining blockers

- **Performed:** 17/17 local Node 22 source/fixture tests PASS. New JS parses. No production data, live `/var/lib/evejs`, database, market, player items, client or asset files touched.
- **Not performed:** entire official 2026 CCP export download + native GameStore itemTypes/typeDogma snapshot comparison; inventory of all currently fitted hulls, ammo, skills, published market groups; full Dogma simulation and 2-player regression; real 24.01 client asset IDs, RPC or UI verification. These remain `BLOCKED_SOURCE_DATA_UNAVAILABLE` / `BLOCKED_CLIENT_UNAVAILABLE`.
- **Do not deploy all 2026 data**: preserve pinned EveJS, do not vendor CCP SDE archives or newer client assets, and do not modify central installer. Chat 01 handles shared installer. 
- **If discrepancy found:** add a per-`typeID` regression with old/new attribute and specific native effect support; only then stage opt-in content override in a later change. Avoid global SDE overwrites, live balance changes and synthetic markets.
- No GitHub Actions, CI, default-on behavior, or remote deployments.
