# P1 / P2 — Verified native escort volunteers, tactics, rescue, reputation

DRAFT, ALL NEW FLAGS DEFAULT OFF. This PR is stacked on event-board PR #81; paid native escrow journal is separately extended by PR #86. Do not claim live gameplay; these server kernels are not yet end-to-end activated.

## What the player can request in game
- /events interest <id> — individually register interest.
- /events volunteer <id> — verifies both live characters in one real native EVE fleet and actual same-scene ships, genuine still-active NPC event. Both pilots separately register interest and volunteer, with fsynced per-pilot consent and an immutable pair receipt. This is volunteer intent ONLY: not accepting a funded contract, not warp, not money.
- /events history — read-only audit of verified native paid/refunded contracts, filtered by the actual logged-in character. It does not create historical payouts by querying.

## P1 server-only tactics
- coopEscortNativeTactics.cjs checks a real two-pilot volunteer receipt, live real convoy ship, real route/fleet identity, server-authorized commander, command cooldown and independent native movement acknowledgment PLUS observed applied state for HOLD/CONTINUE/RETREAT.
- The native EveJS movement dispatcher is NOT yet attached. Never expose a player control that falsely reports a stopped or retreated hauler.

## P1 genuine rescue proof
- coopEscortNativeRescue.cjs verifies actual hauler native wreck, durable original cargo manifest, genuine wreck itemStore stacks linked by sourceCargoID and real warehouse transfer receipts. Same type ID alone is insufficient proof.
- No item creation, no money payouts, no virtual rewards. rewardISK=0. Actual salvage interaction needs native itemStore and a separately funded rescue contract before release.

## P2 provenance-only reputation
- coopEscortReputation.cjs requires Stage A native SETTLED or REFUNDED journal and the actual atomic native wallet receipt, exact corporation/contract/two recipient identity. Paid success also requires actual two-pilot combat and nativeWreckID proof.
- One immutable audit row per contract. +10 score per paid successful escort, 5 paid contracts TRUSTED, 20 VETERAN. Refunds appear with 0 earned ISK and no reputation points.
- Corrupt audit record fails closed; history cannot be queried for an arbitrary player via the chat interface. An authoritative server-side receipt writer must still be wired after actual SETTLED/REFUNDED.
- Stage A proof is extended in PR #86 to return the actual verified pirate nativeWreckID and permit post-settlement read-only audit.

## Flags
EVEJS_COOP_OPPORTUNITY_BOARD=1 (PR #81)
EVEJS_COOP_EVENT_VOLUNTEERS=1
EVEJS_COOP_ESCORT_REPUTATION=1
EVEJS_COOP_ESCORT_TACTICS=1 (kernel ONLY, no live dispatch)
EVEJS_COOP_ESCORT_RESCUE=1 (proof ONLY, no item transfer)

## Verification
- 6/6 V8 isolated checks passed on committed volunteer module: both consents, restart, duplicate, fake event and disconnect.
- 11/11 V8 isolated checks passed on committed audit/tactics/rescue kernels: verified payout history, native ACK + effect, cooldown, real wreck/source cargo/warehouse and no unearned ISK.
- 29 new standard Node test cases committed across three files, parsed but NOT run using official Node runner.
- No actual two EVE clients, Docker, real better-sqlite3, operator dry-run or live source/item/wallet changes in this session.
- No remote CI; no direct upstream edits; do not modify evejs-data without an approved local test plan.

## Integration blockers
1. Compose PR #81 and #86 plus native manifest, flight gate, atomic wallet and actual pirate outcome in one inspected runtime; no fake contract acceptance.
2. Wire authorized prewarp NPC-funded contract booking to real two-player consent, then verify deposit, damage, full cargo, payment and real wallet journal.
3. Wire real native movement controller and real salvage itemStore transfer; never simulate HOLD/RETREAT, rescue or payment.
4. After exact native settlement/refund, invoke reputation.recordVerified with verified server-only proof and persist native audit receipt.
5. Run pinned overlay dry-run, real worker crash tests and TWO client EVE gameplay before enabling flags or claiming COMPLETE.
