# COOP-045 — native demand and manufacturing lifecycle integrity

Status: **Draft / default OFF**. Stacked on COOP-044 PR #101. The separate COOP-043 A-Life reader exists in Draft PR #98; its native station evidence must be integrated after independent verification. The order arbitration integration exists in Draft PR #99.

## Real bugs repaired

1. **Sale is not physical consumption.** Previous director added all 24-hour `NATIVE_MARKET_FILL`, `NATIVE_NPC_PURCHASE` and `NATIVE_WEAPON_CONSUMPTION` quantities to one demand target, double-counting a bought-and-fired ammo stack. `coopNpcDemandAuthority.cjs` retains verified transaction metrics but raises the bounded forecast **only** for canonical actual weapon consumption. It rejects duplicate receipt IDs, duplicate canonical consumptionIDs, future receipts, bad owner/station and impossible quantities.
2. **Passive Rust ask blocked unrelated manufacturing.** Previous director always processed the oldest non-`SOLD` journal operation; an open `LISTED` order could prevent all later native factory jobs at the station. It now prioritizes active durable steps, fairly polls passive `LISTED` orders, and can prepare a distinct product after checking a fresh native stock snapshot. Cooldowns are per owner/station/**product**. It rejects a planner output type that bypasses that product's cooldown.
3. **PAUSED manufacturing was counted in WIP but rejected in the director.** A real native job with `status=2` now yields `WAITING_FOR_NATIVE_RESUME` until the original job resumes. No duplicate paid install, READY or delivery is triggered.
4. **Safe A-Life ACT contract.** `coopAlifeNativeEconomyAct.cjs` is an opt-in dependency-injected bridge for trusted trader intents; it re-resolves actor/corporation/station, refuses attack/warp/player takeover, de-duplicates same-tick intent replay, limits product allowlists, rechecks after async reads, and delegates to the **existing native director**. It owns no wallet, BPO, market writer, independent timer or virtual inventory.

## Safety and limitations

- The bridge is **not registered in the live runtime**. Its `supportsLiveRuntime:false` is deliberate until pinned native GameStore, actual Rust market daemon, complete source-backed actor-to-director runtime bindings and native two-client acceptance are proved. It must not be enabled on persistent data by a separate timer.
- `BUY_SUPPLIES`, `REFINE`, `MINE`, `HAUL` and `RESUPPLY` stages remain handled by their respective existing native authorities or explicitly blocked by this bridge; this bridge only routes manufacturing/listing/delivery intents.
- Partial stack purchase still needs **one atomic GameStore item splitter plus Rust claim/finalize** revision. COOP-035 still requires whole stack. Never remove that guard without native test evidence.
- Dynamic prices, non-synthetic NPC buy orders, bankruptcy resolution and regional specialization require separate source-backed actors and policies. None is claimed as enabled here.
- Unknown install, delivery and market outcomes still fail closed. No second attempt may mint assets when acknowledgments are lost.
- Do not change `main`, Docker, the user's original `evejs-data` volume, or default flags until local native test gates pass.

## Checks

**43/43 isolated V8 regression checks PASS**, using the exact GitHub branch source and deterministic simulated filesystem:
- 24 existing economy director checks + 4 additional director checks.
- 6 new consumption authority checks.
- 9 new A-Life ACT adapter checks.

These are **not** a full Node test runner, native SQLite transaction, compiled Rust daemon or real client evidence.

Windows gate:
```powershell
pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests
```

8 new acceptance cases in `tests/scenarios/coop-045-native-demand-lifecycle.json` are all **NOT_RUN**. Complete them on a disposable pinned EveJS checkout with native GameStore, market SQLite, Rust RPC and two clients. Record before/after wallet + item + BPO + escrow + order + industry job receipts; inject restart and lost-ACK failures. The runner checks manifests but does not pretend to execute E2E from JSON.

## Follow-on development

P0: wire the tested A-Life ACT bridge into a **single** native runtime dispatch only after canonical authority adapters exist and COOP-043 reader/COOP-044 director have been reconciled. P1: native partial-stack transaction, independent buyer restocking, dynamic order pricing and solvency recovery. P2: profitable region-specialized production and trade routes from real physical supply chains; no background item or ISK minting.
