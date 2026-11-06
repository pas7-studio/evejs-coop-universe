# PF66 original native dock integration gates

| Gate | Precondition | Result |
|---|---|---|
| Prior owner chain | Durable PF56 DOCK_ISSUING, PF54 ACTIVE, PF58 CONSUMED, matching PF actor claim | Fail closed on any identity/generation drift |
| Original stock asset | Exactly the same original itemID, owned and in space, manifest unchanged | No synthetic ship/module/cargo |
| Arrival | Original in-scene continuous station dwell witness and no owner session | Never trust HTTP/WS assertions |
| Writer exclusion | WAR, mining, exploration, player session, market, inventory, other NPC writers fenced | Abort without attempting |
| One shot | Durable PF66 attempt in original GameStore, BEFORE `dockShipToLocation` | Crash blocks future dispatch |
| Native scene | Source-pinned original NPC service, private capability, exact runtime and durable identity | Only scene actor/controller removed |
| PF59 protection | Generic `destroyNativeNpcController`, `dematerializeNativeController` and cascade never called | Remains enforced |
| Terminal native rows | PF60 prepare/issue then PF61 cleanup after scene vacuum | Independent reconciliation needed |
| Original return | PF56 dock receipt readback and reconcile | Releases PF52 claim only after native rows gone |
| PF60 finish | Native cleared and PF56 DOCKED, original warehouse/ItemStore intact | Atomic lock release / tombstone |
| Manual E2E | Real two authenticated EVE clients on isolated WORK | NOT RUN |

**Risks that remain:** the stock `removeDynamicEntity()` behavior must be reviewed
for any side-effects outside the scene before applying the source patch. Real
station collision geometry, cache invalidation, NPC runtime controller records,
stock fitting/charge writes, player active sessions, PF42 exclusions and
cross-process fencing cannot be proven by the fixture. If a crash leaves stock
ItemStore DOCKED but scene actor still present, operator intervention is required;
automatic retries and arbitrary token deletion are prohibited.
