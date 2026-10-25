# P0 cooperative integration review — 2026-10-25

**Review branch:** `integration/coop-p0-review-20261025`, based on main `30ba3dbe90399637667554f2938c9e2d8fc718cf` (preserving agent-dialogue native hooks and most recent state evidence).

## Integrated unchanged upstream PR work

- PR #12: read-only World reliability evidence after long server uptime (without borrowing data from another system), 5 files.
- PR #13: native looter must belong to active Ballpark session with physical owned ship; telemetry writer acknowledgement, 4 files.
- PR #14: native wreck inventory residue conservation across two independent loot participants, 3 files.
- PR #16: fail-closed durable journal before experimental wingman's native mission payout; ambiguous reward cannot automatically retry, 3 files.
- PR #17: passive native NPC fleet destination brief only to genuine ready teammates; independently **OFF** unless `EVEJS_COOP_FLEET_BRIEF=1`, fleet-wide 2-minute cooldown, 4 files.
- PR #18: unique, live native scene-session admission before co-op world/party/NPC side effects on login/reconnect, 3 files.

**One intentional integration resolution:** DO NOT bring `scripts/Verify-Local-Coop.ps1` from PR #13. It modifies the obsolete manually enumerated test list; main now globs all `tests/*.test.mjs`. The new `tests/coop-native-loot-session-proof.test.mjs` runs through that glob automatically. No CI or GitHub Actions.

## Cross-feature acceptance (new)

`tests/coop-p0-integrated-identity.test.mjs` proves four combined fake-client/native-scene situations with the *exact integrated modules*:

1. Two distinct Ballpark-ready player sessions -> native fleet membership -> real physical NPC brief -> actual source-debit loot receipt -> separately accepted native mission readiness.
2. Disconnect invalidates native admission, NPC target notice, looter receipt and shared mission eligibility.
3. Reconnect is only accepted after replacing the old session in the **authoritative scene**, after which the same ship and source-debited loot belong to the new actual session.
4. Duplicate active character identity cannot authorize native admission, loot proof or shared mission turn-in.

**Verification:** all **4/4** cross-feature contract cases PASS in a V8 JavaScript isolate with the exact GitHub-committed source modules. This is not Node `--test`, a native EveJS checkout, the Docker runtime, or both real EVE clients. Earlier individual PR isolated harnesses were also green, but their evidence is not a new aggregate Node/Windows green run.

## Excluded concurrent branches

- PR #15: P1 exploration scan/share; changes `scripts/patch-evejs-coop.cjs`, deployment and historical verifier. Keep independent until native hook roundtrip reviewed against *latest main*.
- PR #19: P0 native trade atomicity (item/ship settlement). It changes the same native installer and `scripts/patch-evejs-coop.cjs` as #15 and new main agent-dialogue. **Do not overwrite any one of these three versions with another.** Native hook rebase, exact pinned upstream roundtrip and explicit failure-injection tests are required before inclusion.
- PR #20: P1 real ore depot custody and native economy reconciliation; independent review.

## Manual acceptance plan

No deployment, `main` merge, Docker restart or persistent volume mutation is authorized by this review branch.

1. On authorized Windows checkout, record both project and pinned upstream SHAs. Run `node scripts/patch-evejs-coop.cjs --check --code-path C:\Games\EveCoop\upstream-evejs\Code` and `node scripts/coop-test-baseline.cjs`. First verify module count/staleness and new failing cases, and run `node --test tests/coop-p0-integrated-identity.test.mjs`.
2. Only after the owner authorizes a planned deployment, use the ordinary transactional installer; no hand edits in the native server code.
3. Check real World (Perimeter 30000144), login A+B, real fleet join, fleet warp **arrival**, same NPC damage, actual wreck source debit/item custody, mission journal per player, disconnect/reconnect and no duplicate award.
4. Keep automated two-person mission turn-in and fleet target brief **default-OFF**, until there is actual client and native reward/journal evidence. An inconclusive reward `PREPARED` / `UNKNOWN` journal requires human/native-ledger reconciliation, not another native payout.
5. `state/status.json` at main's earlier snapshot reported 234 native server events and 525 PASS local tests at an **earlier revision**. It is useful operational context, not validation of this integration branch or real client rendering.

**Stop condition:** no release or main merge should be described as gameplay-complete until explicit owner/agent local verification at the exact integrated revision. The project development doctrine prohibits CI and unauthorized volume/server modifications.
