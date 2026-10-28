import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {names,PIN}=require("../scripts/patch-evejs-coop.cjs");
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("single pinned reversible overlay carries all Stage J salvage market dependencies",()=>{
 assert.equal(PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 for(const module of ["coopSalvageNpcRivals","coopSalvageNpcStationDelivery",
  "coopSalvageNpcPendingMarket","coopAlifeSalvageMarket",
  "coopAlifeSalvageMarketRuntime","coopNpcPendingMarketEscrow",
  "coopNpcCorporateBuyRuntime","coopNpcCorporateSettlement"])
  assert.equal(names.filter(x=>x===module).length,1,module);
 assert.equal(new Set(names).size,names.length);
});
test("A-Life executes salvage market inside the existing tick and has no new timers",()=>{
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 assert.match(runtime,/runPhase\("native-salvage-rivals",advanceNativeSalvageRivals\)/);
 assert.match(runtime,/EVEJS_COOP_ALIFE_SALVAGE_MARKET/);
 assert.match(runtime,/coopAlifeSalvageMarketRuntime"\)\.advance/);
 for(const module of ["integration/coopAlifeSalvageMarket.cjs",
  "integration/coopAlifeSalvageMarketRuntime.cjs",
  "integration/coopSalvageNpcPendingMarket.cjs"])
  assert.doesNotMatch(read(module),/setInterval\s*\(|setTimeout\s*\(/);
});
test("native Rust pending orders accept only independently gated original salvage identity",()=>{
 const rust=read("rust/coop_npc_market_pending.rs");
 assert.match(rust,/strip_prefix\("npc-manufacture:"\)/);
 assert.match(rust,/strip_prefix\("npc-salvage:"\)/);
 assert.match(rust,/EVEJS_COOP_RUST_NPC_SALVAGE_MARKET/);
 const finance=read("integration/coopNpcCorporateSettlement.cjs");
 assert.match(finance,/verifySalvageOriginal/);
 assert.match(finance,/SALVAGE_SETTLEMENT_DISABLED/);
 assert.match(finance,/confirmSalvageSold/);
});
test("native salvage market uses original stock, Rust escrow and a separate confirmed finance receipt",()=>{
 const market=read("integration/coopSalvageNpcPendingMarket.cjs");
 assert.match(market,/ReserveNpcSellOrder/);
 assert.match(market,/ActivateNpcSellOrder/);
 assert.match(market,/GetNpcSellClaim/);
 assert.match(market,/FinalizeNpcSellOrder/);
 assert.match(market,/NATIVE_SALVAGE/);
 assert.match(market,/RUST_PAID_FINALIZE_UNKNOWN/);
 assert.match(market,/row\.source==="coop-npc"/);
 const alife=read("integration/coopAlifeSalvageMarket.cjs");
 assert.match(alife,/source==="seed"/);
 assert.match(alife,/readOps\(\)/);
 assert.match(alife,/market\.reconcile/);
});
test("salvage A-Life telemetry never claims native settlement for blocked attempts",()=>{
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 // Anchored on the phase labels, not on the dispatch helper's name: the Living
 // World tick moved from safeNpcPhase() to the phase coordinator's runPhase(),
 // and the slice silently became empty (so every match below was vacuous).
 const telemetry=runtime.slice(runtime.indexOf('runPhase("native-salvage-market"'),
  runtime.indexOf('runPhase("native-wreck-custody"'));
 assert.ok(telemetry.length>200,"the salvage-market phase block must be found");
 assert.match(telemetry,/nativeEscrowVerified:result\.result\?\.nativeEscrowVerified===true/);
 assert.match(telemetry,/corporationWalletCredited:result\.result\?\.walletCredited===true/);
 assert.doesNotMatch(telemetry,/nativeRustAndGameStore:true/);
});
