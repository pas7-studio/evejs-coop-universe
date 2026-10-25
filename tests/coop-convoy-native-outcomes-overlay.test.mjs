import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("P1 new convoy outcome module is packaged without a new upstream native patch",()=>{
 const patch=readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 assert.match(patch,/"coopConvoyOperations","coopConvoyOutcomeProof"/);
 assert.match(patch,/"coopNpcChatter"/);
 assert.match(patch,/coop-native-station-arrival-patch\.cjs/);
 assert.doesNotMatch(patch,/coop-convoy-outcome-native-patch\.cjs/);
});
test("P1 only fully native warehouse COMMITTED + source debit + exact target stock can record cargo outcome",()=>{
 const warehouse=readFileSync(new URL("../integration/coopNativeWarehouse.cjs",import.meta.url),"utf8");
 const notifier=warehouse.indexOf('require("./coopConvoyOutcomeProof").noteWarehouse');
 const commit=warehouse.indexOf('phase:statuses.COMMITTED,updatedAt:clock()');
 assert.ok(notifier>commit);
 assert.match(warehouse,/!findCargo\(record\)/);
 assert.match(warehouse,/checkTarget\(record\)/);
 const outcomes=readFileSync(new URL("../integration/coopConvoyOutcomeProof.cjs",import.meta.url),"utf8");
 assert.match(outcomes,/r\?\.phase!=="COMMITTED"/);
 assert.match(outcomes,/sourceAbsent!==true/);
 assert.match(outcomes,/coop-warehouse:v1:cargo:/);
 assert.doesNotMatch(outcomes,/grantUniqueNpcDepotItem|grantItemToOwnerLocation|adjustCharacterBalance/);
});
test("P1 only existing authoritative native STOCK FLEET wreck proof may declare hauler destroyed",()=>{
 const world=readFileSync(new URL("../integration/coopVirtualWorldRuntime.cjs",import.meta.url),"utf8");
 const marker=world.indexOf('require("./coopConvoyOutcomeProof").noteLoss(proof)');
 assert.ok(marker>0);
 assert.ok(marker>world.indexOf('verifyStockFleetWreck('));
 const proof=readFileSync(new URL("../integration/coopConvoyOutcomeProof.cjs",import.meta.url),"utf8");
 assert.match(proof,/PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED/);
 assert.match(proof,/REAL_NATIVE_MINING_FLEET_MEMBERSHIP_AND_WRECK_STORE/);
 assert.match(proof,/victimRole!=="hauler"/);
 assert.doesNotMatch(proof,/recordLoss\(|destroyEntity|spawnWreck|removeNativeCargo/);
});
test("P1 operator diagnosis reads outcome journal without Docker restart or stock mutation",()=>{
 const ps=readFileSync(new URL("../scripts/Inspect-Coop-ConvoyOutcomes.ps1",import.meta.url),"utf8");
 assert.match(ps,/docker compose -f \$compose exec -T server node -e/);
 assert.match(ps,/module\.exports\.createOutcomes\(\)\.snapshot\(\)/);
 assert.match(ps,/out\.status!=="READY"/);
 assert.doesNotMatch(ps,/docker compose\s+(?:up|down|stop|restart)|market-tools rebuild|Remove-Item/);
});
test("P1 optional incident telemetry failure never rewrites actual warehouse or stock-fleet destruction",()=>{
 const warehouse=readFileSync(new URL("../integration/coopNativeWarehouse.cjs",import.meta.url),"utf8");
 const world=readFileSync(new URL("../integration/coopVirtualWorldRuntime.cjs",import.meta.url),"utf8");
 assert.match(warehouse,/try\{require\("\.\/coopConvoyOutcomeProof"\)\.noteWarehouse/);
 assert.match(warehouse,/catch\(error\)\{console\.warn\("\[CoopConvoyOutcomeProof\] stock"/);
 assert.match(world,/try\{require\("\.\/coopConvoyOutcomeProof"\)\.noteLoss/);
 assert.match(world,/catch\(error\)\{console\.warn\("\[CoopConvoyOutcomeProof\] hauler loss"/);
});
