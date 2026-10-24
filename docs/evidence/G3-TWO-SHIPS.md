# G3 source finding: existing two-session ship-prime regression

Inspected on 2026-10-24 in [gameboys84/EveJS, Code/server/scripts/verifyDestinyAuthorityDropAndFx.js](https://github.com/gameboys84/EveJS/blob/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/scripts/verifyDestinyAuthorityDropAndFx.js#L260-L295).

This existing upstream test already goes further than our previous single-object removal tests:
- Instantiates two separate synthetic sessions and inserts both into one scene's `sessions` Map.
- Calls `broadcastRemoveStaticEntity` to verify teardown notification delivery.
- Creates a ship entity, inserts it into `scene.dynamicEntities`, then calls `broadcastShipPrimeUpdates`.
- Asserts both APIs report at least one delivery, and verifies the Destiny authority contract audit log.

**Important limitation:** `deliveredCount >= 1` does not assert that *each* player receives a valid, matching update. The upstream test is not proof of simultaneous client multiplayer, command replication, or real combat. It is an existing, concrete scene-level integration seam we should strengthen rather than building another fake transport.

Our CI now invokes this exact upstream script after installing server dependencies. The configured test has not been observed passing as of this note.

Next implementation: introduce a direct multi-observer assertion at the scene dispatch boundary that distinguishes A and B, checks authorization/visibility, and verifies each recipient receives the proper ship-prime or movement payload; test A disconnect then B continued delivery. Validate on the pinned SHA before changing game transport. Real player login, client licensing, and VPN networking remain separate gates.
