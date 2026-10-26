# Upstream patch series — ownership and layering

This repository owns the **exact** set of changes applied to the pinned EveJS
checkout. Nothing lives only as an edit inside `C:\Games\EveCoop\upstream-evejs`.

## Three layers, one rule each

| Layer | Where | Rule |
|---|---|---|
| **L1 native fixes** | `patches/upstream/*.patch` | A real bug or omission in stock EveJS. Reviewable diff, `git apply`, applies to the pin, reverseible. |
| **L2 co-op overlay** | `integration/*` + `scripts/patch-evejs-coop.cjs` | Our gameplay rules. Env-gated, default OFF, one call into a module. |
| **L3 new mechanisms** | `integration/*` runtime phases | Something stock EveJS has no concept of (durable slot journal, boot reconcile). Never a string patch. |

A change goes **L1** when it fixes stock behaviour and would be wrong to own
privately; **L2** when it is a co-op policy; **L3** when it needs its own state.

## The series

`patches/upstream/MANIFEST.json` lists every patch with `pin`, `sha256`,
touched files and its `status`. The applier refuses a patch whose hash does not
match the manifest, and refuses a checkout whose `HEAD` is not the pin.

```bash
node scripts/apply-upstream-patches.cjs --checkout 'C:\Games\EveCoop\upstream-evejs\Code'            # dry run (default)
node scripts/apply-upstream-patches.cjs --checkout '...' --apply                                     # apply the series
node scripts/apply-upstream-patches.cjs --checkout '...' --apply --branch coop/pas7std --commit       # our own branch, one commit per patch
node scripts/apply-upstream-patches.cjs --checkout '...' --reverse                                    # roll the series back
```

Order is always **L1 then L2**: the patch series first, then
`node scripts/patch-evejs-coop.cjs --code-path ...` (confirm `OVERLAY_OK`
before building).

## Our own branch, even if upstream never merges

`--branch coop/pas7std --commit` creates a private branch in the checkout with
one commit per upstream patch, rebased onto the pin. That branch is our
complete, reproducible native state. Upstream receives only atomic proposals
(one patch = one commit message, with the pin and the reproduction in the body);
a merged proposal changes `status` in `MANIFEST.json` to `merged` and the patch
is dropped from the series once the pin advances.

Nothing in this series changes a client binary, authentication or CCP assets.

## Current entries

| Patch | What | Why not L2 |
|---|---|---|
| `0001` `nativeNpcStore: export listNativeCargo` | `listNativeCargo()` existed but was never exported. | Stock omission; a caller cannot scan cargo rows whose entity is gone. |
| `0002` `nativeNpcService: NPC capacitor recharge rate` | Native NPC hulls got `capacitorCapacity` but never `capacitorRechargeRate`, so CCP passive recharge never ran and a cap-hungry module worked once. | Replacing it in L2 meant topping up the capacitor before every module activation — a symptom fix. |
