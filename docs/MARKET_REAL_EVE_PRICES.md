# Real EVE price reference (for market balancing)

Snapshot taken 2026-10-26 from public market trackers (evetrade.ru, eve-kill,
eveboosters), Jita sell / buy, 2026-10-24 data.

## Skill trading (the owner's first concern)

| Item | TypeID | Jita sell | Jita buy | Source in real EVE |
| --- | --- | --- | --- | --- |
| Skill Extractor | 40519 | ~465-467 M ISK | ~454.6 M | **NES only**, 440-449 PLEX; players resell on the market |
| Large Skill Injector | 40520 | ~731-734 M ISK | ~704.7 M | made by players (extractor -> injector) |
| Small Skill Injector | 40521 | ~148.6 M ISK | ~148.4 M | made by players |
| Daily Alpha Injector | 40522 | ~36 M ISK | ~32.6 M | NES |
| PLEX | 44992 | ~4.7-4.9 M ISK | — | NES / market |

Two facts that matter more than the numbers:

1. **A Skill Extractor is not seeded on the market in real EVE.** It enters
   only through the NES for PLEX, and the market supply is players reselling.
   If ours sits cheap on the market, the bug is the *source*, not the price -
   pricing it correctly without fixing the source just makes an unlimited
   cheap supply slightly less cheap.
2. **Extractor and injector are a conversion pair**, and the spread between
   them (~230-265 M) is the entire skill-farming margin. Seeding both cheaply
   breaks that relationship and makes SP effectively free.

## Other "imba" candidates worth checking the same way

These are items in real EVE that are **not** ordinary market stock, so a
seeded cheap supply distorts the economy the same way:

| Item | Why it matters |
| --- | --- |
| PLEX | NES currency; a cheap seeded PLEX makes everything NES-gated free |
| Skill Extractor / Injector | conversion pair, above |
| Cerebral Accelerators | NES / event only |
| Ship skins and SKIN licenses | NES / event only |
| Apparel and character apparel | NES only |
| Implants (attribute, hardwiring) | LP store / market, but price-sensitive to LP |
| Faction and deadspace modules | LP store / DED sites, not bulk seeded |
| Capital and supercapital hulls | build cost is the balance, not the seed |
| Blueprints (originals) | invention/LP, a cheap seeded BPO removes industry |
| Boosters and drugs | LP store / exploration |

## What to check in our own market before changing anything

1. Is the item seeded as a **sell order with infinite supply**, or is there a
   real stock that depletes?
2. Does its price come from the SDE `basePrice`, from the seeder's formula, or
   from a hand-written table?
3. Does the NPC economy trade it (which would then need the same fix on both
   sides)?

Answering those three decides whether the fix is a price change, a supply
change, or removing the item from the seed entirely.
