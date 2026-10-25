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
 ["coopNpcBuyerNativeBindings",["coopNpcRustOrderAuthority","coopNpcSellerTaxAuthority"]],
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
