import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL("../integration/coopNpcNativeEconomyDirector.cjs",import.meta.url),"utf8");
const installer=fs.readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
function installedFixture(t,helpers={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-native-economy-overlay-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,"coopNpcNativeEconomyDirector.js"),source);
 for(const [name,contents]of Object.entries(helpers))
  fs.writeFileSync(path.join(root,name+".js"),contents);
 return {root,load:()=>require(path.join(root,"coopNpcNativeEconomyDirector.js"))};
}
test("source checkout loads original .cjs native economy siblings",()=>{
 const native=require("../integration/coopNpcNativeEconomyDirector.cjs");
 assert.equal(typeof native.createDirector,"function");
});
test("pinned installer deploys .js and registers all native economy helpers",()=>{
 assert.match(installer,/path\.join\(code,"server\/src\/space",name\+"\.js"\)/);
 assert.match(installer,/path\.join\(project,"integration",name\+"\.cjs"\)/);
 for(const name of ["coopNpcNativeEconomyDirector","coopNpcDemandAuthority","coopNpcEconomyUnknownRecovery"])
  assert.ok(installer.includes('"'+name+'"'),"missing installed native helper "+name);
});
test("native economy director loads its real deployed JS siblings without local .cjs files",t=>{
 const f=installedFixture(t,{
  coopNpcDemandAuthority:"module.exports={calculateNativeDemand:()=>({target:1})};",
  coopNpcEconomyUnknownRecovery:"module.exports={reconcileUnknown:()=>({ok:false})};"
 });
 const director=f.load();
 assert.equal(typeof director.createDirector,"function");
 assert.equal(fs.existsSync(path.join(f.root,"coopNpcDemandAuthority.cjs")),false);
 assert.equal(fs.existsSync(path.join(f.root,"coopNpcEconomyUnknownRecovery.cjs")),false);
});
test("broken transitive native import is NOT hidden behind fallback",t=>{
 const f=installedFixture(t,{
  coopNpcDemandAuthority:'require("./real-missing-nested-dependency");',
  coopNpcEconomyUnknownRecovery:"module.exports={reconcileUnknown:()=>({ok:false})};"
 });
 assert.throws(()=>f.load(),/real-missing-nested-dependency/);
});
test("missing deployed JS and CJS helper fails startup, never constructs phantom director",t=>{
 const f=installedFixture(t,{
  coopNpcDemandAuthority:"module.exports={calculateNativeDemand:()=>({target:1})};"
 });
 assert.throws(()=>f.load(),/coopNpcEconomyUnknownRecovery\.cjs/);
});
test("no new scheduler, native factory writer, or feature flag is introduced",()=>{
 assert.doesNotMatch(source,/\bsetInterval\s*\(/);
 assert.doesNotMatch(source,/\bsetTimeout\s*\(/);
 assert.match(source,/supportsLiveRuntime:false/);
});
