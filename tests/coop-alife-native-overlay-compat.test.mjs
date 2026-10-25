import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const root=path.resolve(import.meta.dirname,"..");
const specs=[
 ["coopAlifeStationAuthorityRuntime",["coopAlifeStationAuthority"]],
 ["coopAlifeNativeBuyerRuntime",["coopAlifeNativeBuyerDispatch"]],
 ["coopNpcBuyerNativeBindings",["coopNpcCorporateBuyerAtomic","coopNpcBuyerCoordinator"]],
 ["coopNpcBuyerCoordinator",["coopNpcMarketPolicy"]],
 ["coopNpcBuyerNativeBindings",["coopNpcRustOrderAuthority","coopNpcSellerTaxAuthority","coopNpcBuyerRecoveryAudit","coopNpcMarketCompletionNotify"]],
 ["coopNpcNativeEconomyDirector",["coopNpcDemandAuthority"]]
];
for(const [file,needs] of specs){
 for(const ext of [".js",".cjs"]){
  test("COOP-049 portable dependency resolution "+file+ext,()=>{
   const source=fs.readFileSync(path.join(root,"integration",file+".cjs"),"utf8");
   const calls=[],sandbox={module:{exports:{}},exports:{},
    __filename:"/disposable/server/src/space/"+file+ext,
    process:{env:{}},
    require:name=>{calls.push(name);return {}}
   };
   vm.runInNewContext(source,sandbox,{filename:file+ext});
   for(const need of needs){
    const expected="./"+need+(ext===".cjs"?".cjs":"");
    assert.ok(calls.includes(expected),
     "Missing native dependency "+expected+" from "+JSON.stringify(calls));
   }
   assert.equal(calls.some(x=>x.endsWith(".cjs")&&ext===".js"),false);
  });
 }
}
test("overlay copies each native buyer dependency into EveJS .js filenames",()=>{
 const src=fs.readFileSync(path.join(root,"scripts/patch-evejs-coop.cjs"),"utf8");
 for(const [file,needs] of specs){
  assert.ok(src.includes('"'+file+'"'),file);
  for(const need of needs)assert.ok(src.includes('"'+need+'"'),need);
 }
 assert.match(src,/name\+"\.js"/);
});

test("COOP-056 seller login hook is reversible and bound only to native session index",()=>{
 const src=fs.readFileSync(path.join(root,"scripts/patch-evejs-coop.cjs"),"utf8");
 assert.match(src,/server\/src\/services\/chat\/sessionRegistry\.js/);
 assert.match(src,/addToIndex\(session, characterID\)/);
 assert.ok(src.split("notifyPendingSellerOnLogin(characterID)").length>=3,
  "login hook must be in both install and rollback strip list");
 assert.match(src,/EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP/);
 assert.doesNotMatch(src,/slash.*notifyPendingSellerOnLogin/);
});
test("COOP-056 login catch-up stays bounded with separate explicit opt-in",()=>{
 const src=fs.readFileSync(path.join(root,"integration/coopNpcMarketCompletionNotify.cjs"),"utf8");
 assert.match(src,/maxNotifications=4/);
 assert.match(src,/maxNotifications>8/);
 assert.match(src,/rows\.length>20000/);
 assert.match(src,/hits\.length>128/);
 assert.match(src,/loginBusy=new Set\(\)/);
 assert.match(src,/EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP/);
 assert.doesNotMatch(src,/setInterval\(/);
});

test("COOP-059 host-only operator control is deployed as a portable .js overlay",()=>{
 const source=fs.readFileSync(path.join(root,"scripts/patch-evejs-coop.cjs"),"utf8");
 assert.ok(source.includes('"coopNpcBuyerAdminControl"'),
  "operator module absent from reversible overlay registry");
 const runtime=fs.readFileSync(path.join(root,
  "integration/coopAlifeNativeBuyerRuntime.cjs"),"utf8");
 assert.ok(runtime.includes('EVEJS_COOP_NPC_BUY_ADMIN_LOCAL'));
 assert.match(runtime,/coopNpcBuyerAdminControl/);
 assert.ok(runtime.includes('authorizeRecoveryOperator:adminControl?'));
 const admin=fs.readFileSync(path.join(root,
  "integration/coopNpcBuyerAdminControl.cjs"),"utf8");
 assert.match(admin,/127\.0\.0\.1/);
 assert.match(admin,/timingSafeEqual/);
 assert.doesNotMatch(admin,/0\.0\.0\.0/);
});
