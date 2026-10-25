# EveJS Co-op: in-game Living Opportunity Board

DRAFT. Feature default OFF. No Docker, main merge, GitHub Actions, live evejs-data writes, true client notification or real ISK change in this PR.

## Player-facing gameplay

This adds native EveJS chat commands through a pinned, reversible overlay patch:

- /events and /events list: real active NPC opportunities in current solar system
- /events all: verified opportunities across systems
- /events info <eventID>: physical NPC/system/route details and how to reach the activity
- /events interest <eventID>: voluntary interest; **not** a native fleet join, teleport, combat credit or ISK reward
- /events watch local|all|off: local notifications, global notifications, or opt out
- /alerts local|all|off: quick alias for notification preferences

Events derive from verified server-side NPC actions. A new actual native attack is a RAID; a real hauler warp accepted for a native station route is a CONVOY. Actual terminal native DELIVERED closes the convoy event. No market, salvaging, shortages or NPC jobs are invented.

## Native EVE notifications

Pinned upstream EveJS provides services/mail/mailState.sendMail and notificationState.createNewMailNotification, which are its actual in-game EVEmail and new-mail mechanisms. This board uses the existing API and sender resolution, not an unrecognized custom notification type.

When operator explicitly enables BOTH flags:

    EVEJS_COOP_OPPORTUNITY_BOARD=1
    EVEJS_COOP_OPPORTUNITY_MAIL=1

the board creates a durable claim once per event and online interested player BEFORE invoking native sendMail. A lost ACK or process crash cannot trigger blind retries or duplicate messages. Event storage and mail claims persist under EVEJS_DATA_ROOT/coop-opportunities. A problem with mail cannot mint ISK or change cargo.

Default preferences target only real online characters in the matching system. A user may opt into all systems or mute this feature via /events watch. This feature does not promise offline mail delivery or a new EVE client window. Earlier Living Universe raid-chat warnings are independent and are not controlled by this mute.

## Verified source and fraud controls

RAID: coopWorldSignals confirms actual in-scene pirate and hauler NPC ships, real accepted action and excludes player ships. CONVOY: coopNativeStationArrival accepted real native warp, identified one NPC ship, real station/fleet and actual saved route. Finished convoy is removed from active listing only after native terminal DELIVERED. Unavailable/corrupt event files fail closed, source event identities cannot be replayed into new messages, expired events are omitted, and no untrusted client publishes events. Interest does NOT authorize a financial payout, spawn NPCs, create native missions or issue warp orders.

## Test evidence

- 17/17 isolated in-memory V8 scenarios passed against the committed board module: native raid/convoy, local/global notices, duplicate prevention, persisted preferences, chat UI, interest, restart, expiry and flag OFF.
- Reversible exact pinned upstream chat patch verified: original -> patched -> original exact bytes, patched -> restored -> patched exact bytes, classifier PATCHED.
- 16 official Node 22 test cases committed but full Node test runner on a repository checkout, real EveJS better-sqlite3, Docker and 2-client visual test were NOT executed in this environment.
- Do not enable production flags on this evidence alone.

## Remaining implementation roadmap (for agents)

### P0: complete paid escort integration
- Reconcile current main and all dependency ancestry for PR #53, #59, #64, #69 and #77. Do not cherry-pick already-merged work blindly.
- Bind two authenticated native characters and a genuine EVE fleet before corporate ISK reservation; interest is not contract acceptance.
- Implement refundAtomic on exactly still RESERVED, never SETTLED escrow; require actual no-delivery or verified loss evidence and native corporate credit in the same SQLite GameStore transaction. Lock ambiguous crash states for reconciliation.
- Expose acceptance and lifecycle in an actually supported native client contract UI, or use accurate slash-command fallback.
- Two-client E2E verifies actual physical ship movement, cargo, pirate attack/wreck, corp and two player balances, restart, double settlement/refund prevention and client wallet journal.

### P0: NPC demand-driven dispatcher
- Publish opportunity only from a native inventory shortage, committed refinery output, real industry job or authoritative native market order. No virtual or synthetic commodities.
- Never advertise a cash reward unless native NPC corporation really has available and reserved balance.
- Put correct system/station/stock IDs on every signal, with durable source-dedup keys.

### P1: gameplay and participation
- Make /events interest upgrade to true ACCEPTED only after verifying same genuine live native character/session/fleet and actual source opportunity. Do not fake fleet join.
- Add real hold/continue/retreat native NPC orders, validated by server-side corporation/fleet authority.
- Emit lifecycle messages: new, accepting, urgent pirate attack, delivered, lost, paid, refunded, completed.
- Actual wreck/cargo salvage missions and possible rescue of lost material; pay only from an authorized, funded escrow.
- Prioritize urgent local events, rate-limit mail, leave offline subscription and digests to opt-in.

### P2: history/reputation/UX
- Persistent reputation per NPC corporation with meaningful rewards, loss reports, history and auditable real money.
- Dedicated EVE UI only after confirming pinned client API support; never imply an untested window exists.
- Optional bounded login catch-up of still-active events and relevant activity by user preference.

Release gates: official Node tests + pinned GameStore worker restart; installer dry-run; actual two-client mail/chat acceptance; real native payout/refund conservation; no virtual ISK or free inventory; user owner-approved backup and manual Docker/gameplay verification.

No main merge, CI or server deployment was performed.
