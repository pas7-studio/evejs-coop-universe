import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvageConsent}=require("../integration/coopSalvageNativeConsent.cjs");
const prev=process.env.EVEJS_COOP_SALVAGE_CONSENT;
process.env.EVEJS_COOP_SALVAGE_CONSENT="1";
const key="30000144-77-1000000";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"salvage-duo-"));
 const build=()=>createSalvageConsent({root,clock:()=>1000000,
  readQuote:()=>({status:"SALVAGE_NATIVE_OFFER_READY",manifestKey:key,
   corporationID:10001,amountISK:24,characters:[701,702]}),
  verifyPilot:s=>({status:"SALVAGE_AUTHENTIC_PILOT",characterID:s.characterID})
 });
 const a={characterID:701,socket:{destroyed:false}};
 const b={characterID:702,socket:{destroyed:false}};
 try{fn({a,b,build,root})}finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("first authentic volunteer explicitly accepts but cannot reserve NPC funds",()=>fixture(f=>{
 assert.equal(f.build().accept(f.a,key).status,"SALVAGE_WAITING_FOR_OTHER_ACCEPTOR");
 assert.equal(f.build().readDuo(key).status,"NOT_FOUND");
}));
test("second independent authenticated pilot durably confirms exact same offer",()=>fixture(f=>{
 f.build().accept(f.a,key);
 const result=f.build().accept(f.b,key);
 assert.equal(result.status,"VERIFIED_DUO_SALVAGE_ACCEPT");
 assert.deepEqual(result.characters,[701,702]);
}));
test("restarted consent writer rereads fsynced exact pair without duplicate",()=>fixture(f=>{
 f.build().accept(f.a,key);f.build().accept(f.b,key);
 assert.equal(f.build().accept(f.a,key).status,"VERIFIED_DUO_SALVAGE_ACCEPT");
 assert.equal(fs.readdirSync(path.join(f.root,"salvage-acceptance")).length,3);
}));
test("third character cannot impersonate original crew acceptance",()=>fixture(f=>{
 assert.equal(f.build().accept({characterID:888,socket:{destroyed:false}},key).status,
  "SALVAGE_CONSENT_UNAUTHORIZED_PLAYER");
}));
test("corrupt original acceptance prevents a false two-pilot escrow authorization",()=>fixture(f=>{
 f.build().accept(f.a,key);
 const file=path.join(f.root,"salvage-acceptance",key+"-701.json");
 fs.writeFileSync(file,"bad data");
 assert.equal(f.build().accept(f.b,key).status,"SALVAGE_CONSENT_DUO_CONFLICT");
}));
test("feature OFF means there is no real consent write",()=>fixture(f=>{
 process.env.EVEJS_COOP_SALVAGE_CONSENT="0";
 try{assert.equal(f.build().accept(f.a,key).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_CONSENT="1"}
 assert.equal(fs.existsSync(path.join(f.root,"salvage-acceptance")),false);
}));
process.on("exit",()=>{
 if(prev===undefined)delete process.env.EVEJS_COOP_SALVAGE_CONSENT;
 else process.env.EVEJS_COOP_SALVAGE_CONSENT=prev;
});
