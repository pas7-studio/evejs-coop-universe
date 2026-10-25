# COOP-050 — NPC Job Market / Native Agent Code Review

Date: 2026-10-25. Scope: COOP-048/049 work in Draft PR #102, plus its interaction with the OPEN Escort Stage H PR #96. **Source review and constrained V8 execution only: no native EVE gameplay, local Node full suite, SQLite worker, Docker, or populated evejs-data verification has occurred.**

## Confirmed integration findings and patches

| Priority | Finding | Before | Applied correction | Regression evidence |
| --- | --- | --- | --- | --- |
| P0 | **Real escort unpaid after restart** | The original `createNativeMount.duo` depended on the process-local `approved` Map populated during prewarp. Restart before verified cargo arrival emptied the cache, so the peaceful-arrival fleet witness always refused payment, even with independently durable corporation escrow and original signed roster. | Cache is now an optimization ONLY. On miss, re-read the immutable native cargo manifest; verify system, NPC fleet, station, issuer, hauler and nonempty cargo; query the ORIGINAL durable accepted corporate quote via `readAuthorizedOffer`; require exact original contract / two recipients / native player fleet / native consent; then still verify unique online ships, authentic native fleet and surviving hauler. No client-provided price, no new reservation or wallet write in this fallback. | `tests/coop-escort-restart-duo-authority.test.mjs`: nine tests covering recovery and false authority; **9/9 source-executed V8 PASS**. Full local Node and real post-restart wallet proof NOT_RUN. |
| P0 | **Offer email permanently missed after restart** | `offerFromNative` invoked in-game paid-quote mail only on `NATIVE_QUOTE_DURABLY_PREPARED`; if process crashed after persisted quote but before send, subsequent authentic replay was `NATIVE_QUOTE_READY`, which never dispatched mail. | Also notify on `NATIVE_QUOTE_READY`, after original quote issuer/route verification. Notification itself continues to validate active source event and actual corporate SDE agent, and uses a durable per-character/event claim to prevent duplicate mail. Quote or replay does NOT reserve or move money. | `tests/coop-escort-priced-mail-replay.test.mjs`: **5/5 source-executed V8 PASS**. Local Node not run. |
| P1 | **Replayed good email misreported as uncertain** | Mail deduplication stored only `PREPARED`, even on successful native `sendMail`. On every replay the existing claim was counted as a delivery error, hiding genuine lost-ACK uncertainty. | Durable `PREPARED -> SENT` receipt with the native positive mail messageID, file and directory fsync. Already-SENT skips cleanly. PREPARED with unknown ACK remains quarantined, never resent. Corrupt/mismatched claim blocks. Repeated native quote will not spam clients. | Source-executed simulated fs probe: two genuine mails, replay 0 mails and 0 errors; altered source refuses, corrupt claim never resends. Expanded `tests/coop-native-job-notifications.test.mjs` to 16 runnable cases. |
| P1 | **Risk of false "UI is payable" status** | `-EnableNativeJobAgents` configures in-game discovery and mail but intentionally does not enable native quoted Escort authority or financial gates. No genuine paid agent offer may appear until independent trusted quote runtime is enabled. | Keep the non-financial switch explicitly opt-in, clarify in docs and PR that stock Agent UI only presents live, *already independently authorized* corporate quotes; otherwise real A-Life event email fallback exists but **no paid claim**. Do not turn on finance in deployment scripts just to populate UI. | Manual native 2-client protocol and wallet receipt scenarios remain NOT_RUN. |

## Security and economic invariants retained

1. **Authority boundaries:** client stock Agent button `Accept` is an authenticated intent only; never a wallet action. NPC corporate quote and real source cargo are durable native server records, not client fields; fleet members sign independently. Default financial flags OFF.
2. **Durability:** a prewarp cache miss can recover identity only from the original durable manifest and paid quote. Already-failed issuer/ship/roster/consent provenance fails closed. No automatic refund on unknown terminal/wallet ACK, and no silent re-binding of an agent's selected event after restart.
3. **Finite money:** peaceful delivery may credit only from previously reserved native corporate ISK and real warehouse manifest, with one atomic two-character settlement. No payouts from event notifications, EVE Mail, Agent dialogue, slash-command interface or timer.
4. **Visibility:** an NPC agent is real SDE metadata and must match actual quote corporation/system. If no eligible matching agent, do not invent one; preserve truthful A-Life event EVEmail. Watch local/all/off still applies.
5. **Do not call source-only tests gameplay-ready:** live NPC service, stock client rendering and wallet before/after are pending external local validation.

## Outstanding P0 blockers before real release

- **Escort Stage H PR #96 overlap**: reconcile durable warp lost-ACK fence and late-pirate settlement replay with #102; do not parallel-enable payment paths without one release branch and transaction conflict review.
- **Real 2-client EVE UI gate**: check Agent `DoAction` and `GetMissionBriefingInfo` actually render strings and buttons on pinned client build 3396210, while the pilots are able to satisfy the *in-space* fleet authorization. Stock agent may be available only at the station, preventing click-and-fund without additional native interaction or journey flow.
- **Long-lived escort attendance proof**: current peaceful payout verifies both ships only at terminal approach (150 km). It is not a durable route-wide participation history and still could reward station-camping; this must be hardened before gameplay balance release.
- **Unpaid work types**: paid native miner guard shifts, solo escrow and full stock journal Mission/Agency UI are not implemented.
- **Full test gate**: run `scripts/Run-NativeJob-Tests.ps1 -CheckPinned` in an operator-approved local checkout and disposable backup, verify GameStore/better-sqlite3 and two EVE client wallets across crash/reconnect. No GitHub Actions or world reset.

## Reproduction / code locations

- Crash-recovered fleet authority: `integration/coopEscortNativeMount.cjs`.
- Native price mail replay: `integration/coopEscortPricedOffers.cjs`.
- Persisted native EVEmail receipts: `integration/coopNativeJobNotifications.cjs`.
- Tests: `tests/coop-escort-restart-duo-authority.test.mjs`, `tests/coop-escort-priced-mail-replay.test.mjs`, `tests/coop-native-job-notifications.test.mjs`.
- Existing cross-package test runner: `scripts/Run-NativeJob-Tests.ps1`; new suites included.
