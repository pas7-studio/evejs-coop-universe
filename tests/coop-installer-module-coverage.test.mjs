import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=readFileSync(resolve(root,"scripts/patch-evejs-coop.cjs"),"utf8");
const specSource=readFileSync(resolve(root,"scripts/overlay-spec.cjs"),"utf8");
// One module registry: every bundled integration module must be registered there,
// or the overlay ships a source file nobody installs. That mistake is invisible at
// runtime - a hook requiring the missing module throws inside stock code - so it is
// checked from the source tree on every run.
const names=Array.from(require(resolve(root,"scripts/overlay-spec.cjs")).names,String);
const bundled=readdirSync(resolve(root,"integration"))
 .filter(name=>/^coop[A-Za-z0-9]+\.cjs$/.test(name))
 .map(name=>name.slice(0,-4));

test("every bundled coop integration source is installed by the native overlay",()=>{
 assert.equal(new Set(names).size,names.length,"duplicate installer modules");
 assert.deepEqual(names.slice().sort(),bundled.slice().sort(),
  "some native integration modules are missing from the installer or source tree");
});

test("native NPE and Living World copies keep original hook dependencies",()=>{
 for(const required of ["coopNpeSafety","coopLivingAgentRuntime","coopNativeAgentMotion"])
  assert.equal(names.filter(x=>x===required).length,1,"missing or duplicate native module "+required);
 for(const file of [
  "server/src/services/npe/airNpeService.js",
  "server/src/services/npe/nesIntroService.js",
  "server/src/services/account/tutorialSvcService.js",
  "server/src/services/character/achievementTrackerMgrService.js"
 ])assert.ok(specSource.includes('file:"'+file+'"'),"native NPE source hook missing: "+file);
});

test("critical atomic buyer, salvage and seller login modules are shipped",()=>{
 for(const required of [
  "coopNpcBuyerCoordinator","coopNpcCorporateBuyerAtomic",
  "coopNpcDemandAuthority","coopNpcMarketPolicy","coopNpcNativeEconomyDirector",
  "coopNpcPartialFillAtomic","coopNpcMarketCompletionNotify",
  "coopSalvageProvenance","coopRescueNativeGame","coopCourierNotices"
 ])assert.ok(names.includes(required),"missing native module: "+required);
 assert.match(specSource,/notifyPendingSellerOnLogin/);
});
