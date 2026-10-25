# Escort Stage F — predeparture native event and voluntary crew

Status: DRAFT, default OFF. No real world or Docker/client gameplay acceptance. Stacked on PR #89 and PR #81; paid native wallet runtime remains separately in PR #86 / PR #91.

## What players see

A real, cargo-bearing in-scene NPC hauler announces a PREPARING convoy BEFORE warp with a stable event ID:

    convoy-<nativeSystemID>-<nativeNpcFleetID>-<firstOriginalCargoID>

This identity is tied to original persistent native cargo, NOT a new Date.now() on every retry. Reconnecting the server with the same cargo does not create another unrelated offer or duplicate EVEmail.

For an online player who opted into notifications, the existing stock EVEmail body and /events info show:
- /events info convoy-...
- /events interest convoy-...
- /events volunteer convoy-...

Both players must independently opt in, enter the SAME genuine native EVE fleet, stay online with real ships in the same NPC scene, and type /events volunteer for the specific source event. Their persisted pair receipt is a VOLUNTEER proof, NOT contract acceptance, warp authorization, or ISK money authority.

## Server route logic

The actual source-shaped coopNativeStationArrival.start() (when BOTH paid escort route and Opportunity Board are enabled):
1. Verifies actual in-scene NPC hauler, authoritative NPC station and non-transient native cargo.
2. Flushes existing native NPC entity and cargo state.
3. Publishes/reuses exactly one PREPARING board notice by original sourceCargoID.
4. Reads the durable verified two-person volunteer receipt. Missing consent returns ESCORT_AWAITING_TWO_NATIVE_VOLUNTEERS. NO immutable departure manifest yet, no corporate escrow debit, no native warp.
5. On a later source check, if both are verified, Stage C proceeds with the native immutable pre-warp manifest and invokes the separate trusted Stage E escrow gate. This gate independently verifies native GameStore, budget, live fleet and approved server-issued contract; the volunteer receipt alone can never debit money.
6. Before submitting any native warp, it sets a volatile warp-unknown fence. A missing/false warp ACK leaves ESCORT_WARP_OUTCOME_NEEDS_OPERATOR_REPAIR and forbids in-process retries or a second corporate debit. Only confirmed native warp ACK clears the fence.
7. After actual warp ACK, board closes PREPARING as RESOLVED/DEPARTED, links to the true native manifest, and normal EN_ROUTE event publishing takes over.
8. The existing station checkReturn() can re-evaluate pending predeparture authorization when it is polled. This must be verified against the exact local native NPC hauling loop. This is not a promise that the stock loop re-calls checkReturn reliably.

With the flags OFF, the original native station route is unchanged.

## Remaining blockers for live player experience

- The two sources are in different open Draft PR stacks. PR #91 is based on the P0 native wallet/escrow chain PR #86. This Stage F is based on PR #89 (which depends on PR #81 event board). They must be cross-merged carefully; do NOT blindly overwrite the native station director or installer lists. The Stage E runtime can only be mounted once its server-owned readAuthorizedOffer, readPilotConsent and readNativeFailure callbacks are provided. The PREPARING volunteer receipt created here is a potential source for user intent but is NOT itself a signed/authorized corporation financial contract.
- Use a durable contractID anchored to the source predeparture event, and persist server-owned reward/beneficiaries before a first debit; never generate new contractIDs blindly after a crash with unchanged cargo.
- Restart recovery after a successful debit and unknown warp outcome must use native ship / warehouse / GameStore receipts and manual operator reconciliation, not replay. The in-memory warp-unknown fence alone does not survive restart.
- Actual native NPC return loop must be observed retrying pending predeparture state; otherwise add a dedicated native recurring retry trigger with a proper read-only source authority. Do not invent a new timer pretending physical NPC behaviour.
- Actual native wreck/cargo/rescue/dual wallet payout and refund evidence still need two authenticated EVE clients, pinned better-sqlite3, GameStore restart and the operator's disposable approved world to pass.
- No client changes, no new GUI type, no Github Actions, no production feature flags turned on, no evejs-data mutations.

## Evidence

- 10/10 isolated V8 source checks PASS on committed Opportunity Board: actual predeparture event, stable original cargo ID, exactly one email, /events info actionable volunteer instructions, duplicate/restart safe ready state, missing ship rejection, true DEPARTED terminal linked to actual trip.
- 8/8 isolated V8 checks PASS on committed real station director with controlled native scene/manifest/escrow/warp providers: no volunteer = no manifest, money or warp; real persisted duo triggers exact source path; predeparture event closed only after native warp ACK.
- 11 Node board event scenarios and 6 Node station predeparture scenarios committed, syntax PASS. Full official Node runner and real pinned EveJS client/Docker NOT RUN.
- Reversible overlay remains the existing installer mechanism (no additional upstream source patch in this branch).

Release state: READY FOR CODE REVIEW, NOT LIVE GAMEPLAY GO.
