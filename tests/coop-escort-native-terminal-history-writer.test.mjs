import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createReputation}=require("../integration/coopEscortReputation.cjs");
const prev=process.env.EVEJS_COOP_ESCORT_REPUTATION;
process.env.EVEJS_COOP_ESCORT_REPUTATION="1";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-escort-history-"));
 const a={contractID:"escort-30000144-77-5501",corporationID:10001,
  characters:[701,702],amountISK:20000};
 const b={...a,contractID:"escort-30000144-77-5502",
  characters:[702,703],amountISK:40000};
 let validProof=true;
 let phase=new Map([[a.contractID,"SETTLED"],[b.contractID,"REFUNDED"]]);
 const rep=()=>createReputation({root,clock:()=>1000000,
  readContract:id=>phase.has(id)?{status:"READY",phase:phase.get(id),
   contract:id===a.contractID?a:b}:{status:"CONTRACT_NOT_FOUND"},
  verifySettlement:c=>({status:"SETTLED",nativeDurable:true,
   contractID:c.contractID,corporationID:c.corporationID,
   amountISK:c.amountISK,credits:c.characters.map(characterID=>({
    characterID,amountISK:c.amountISK/2}))}),
  verifyRefund:c=>({status:"REFUNDED",nativeDurable:true,
   contractID:c.contractID,corporationID:c.corporationID,
   amountISK:c.amountISK,reason:"NATIVE_HAULER_WRECK",failureWitnessID:9001}),
  readProof:c=>validProof?{
   status:"NATIVE_ESCORT_EVIDENCE_VERIFIED",
   contractID:c.contractID,nativeWreckID:9001}:{status:"UNVERIFIED"}
 });
 try{fn({root,a,b,rep,invalidProof:()=>validProof=false})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("confirmed two-wallet native settlement writes exact immutable PAID history",()=>fixture(f=>{
 assert.equal(f.rep().recordVerified(f.a.contractID).status,
  "VERIFIED_NATIVE_ESCORT_HISTORY_RECORDED");
 const p=f.rep().list({characterID:701});
 assert.equal(p.history.length,1);
 assert.equal(p.history[0].outcome,"PAID");
 assert.equal(p.reputation.earnedISK,10000);
 assert.equal(p.reputation.score,10);
}));
test("real NPC corporate refund records loss but awards zero player ISK or score",()=>fixture(f=>{
 f.rep().recordVerified(f.b.contractID);
 const p=f.rep().list({characterID:703});
 assert.equal(p.reputation.paidContracts,0);
 assert.equal(p.reputation.refundedContracts,1);
 assert.equal(p.reputation.earnedISK,0);
 assert.equal(p.reputation.score,0);
}));
test("a third player cannot see the signed paid history for someone else's character",()=>fixture(f=>{
 f.rep().recordVerified(f.a.contractID);
 assert.deepEqual(f.rep().list({characterID:703}).history,[]);
}));
test("server restart and duplicate settlement never duplicate the history receipt",()=>fixture(f=>{
 f.rep().recordVerified(f.a.contractID);
 assert.equal(f.rep().recordVerified(f.a.contractID).status,"ALREADY_RECORDED");
 assert.equal(fs.readdirSync(path.join(f.root,"escort-reputation")).length,1);
}));
test("a payment-like message without native pirate proof awards no reputation",()=>fixture(f=>{
 f.invalidProof();
 assert.equal(f.rep().recordVerified(f.a.contractID).status,
  "NATIVE_ESCORT_PROOF_UNVERIFIED");
 assert.equal(f.rep().list({characterID:701}).history.length,0);
}));
test("audit history depends on the real native settlement flag",()=>fixture(f=>{
 process.env.EVEJS_COOP_ESCORT_REPUTATION="0";
 try{assert.equal(f.rep().recordVerified(f.a.contractID).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_REPUTATION="1"}
}));
process.on("exit",()=>{if(prev===undefined)delete process.env.EVEJS_COOP_ESCORT_REPUTATION;
 else process.env.EVEJS_COOP_ESCORT_REPUTATION=prev});
