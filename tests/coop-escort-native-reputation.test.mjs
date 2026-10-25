import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createReputation}=require("../integration/coopEscortReputation.cjs");
const old=process.env.EVEJS_COOP_ESCORT_REPUTATION;
process.env.EVEJS_COOP_ESCORT_REPUTATION="1";
const contract={contractID:"escort-perimeter-001",manifestKey:"30000144-77-1111000",
 corporationID:10001,amountISK:20000,characters:[701,702]};
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"escort-reputation-"));
 let phase="SETTLED",paid=true,refund=true,proof=true;
 const opts={root,clock:()=>1200000,
  readContract:id=>({status:"READY",phase,contract:{...contract,contractID:id}}),
  verifySettlement:c=>paid?{status:"SETTLED",nativeDurable:true,contractID:c.contractID,
   corporationID:c.corporationID,amountISK:c.amountISK,
   credits:[{characterID:701,amountISK:10000},{characterID:702,amountISK:10000}]}:{status:"NOT_FOUND"},
  verifyRefund:c=>refund?{status:"REFUNDED",nativeDurable:true,contractID:c.contractID,
   corporationID:c.corporationID,amountISK:c.amountISK,
   failureWitnessID:10007,reason:"NATIVE_HAULER_WRECK"}:{status:"NOT_FOUND"},
  readProof:c=>proof?{status:"NATIVE_ESCORT_EVIDENCE_VERIFIED",contractID:c.contractID,
   nativeWreckID:9007}:{status:"ESCORT_NATIVE_CUSTODY_UNVERIFIED"}};
 try{fn({engine:()=>createReputation(opts),phase:x=>phase=x,paid:x=>paid=x,
  refund:x=>refund=x,proof:x=>proof=x,root})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("real native paid proof creates immutable character reputation",()=>fixture(f=>{
 const e=f.engine();assert.equal(e.recordVerified(contract.contractID).status,
  "VERIFIED_NATIVE_ESCORT_HISTORY_RECORDED");
 const h=f.engine().list({characterID:701});
 assert.equal(h.status,"READY");
 assert.equal(h.reputation.score,10);
 assert.equal(h.reputation.earnedISK,10000);
 assert.equal(h.history[0].nativeWreckID,9007);
}));
test("record cannot mint reputation twice",()=>fixture(f=>{
 const e=f.engine();e.recordVerified(contract.contractID);
 assert.equal(f.engine().recordVerified(contract.contractID).status,"ALREADY_RECORDED");
 assert.equal(f.engine().list({characterID:701}).reputation.score,10);
}));
test("missing native dual wallet payment does not produce reputation",()=>fixture(f=>{
 f.paid(false);assert.equal(f.engine().recordVerified(contract.contractID).status,
  "NATIVE_WALLET_TERMINAL_NOT_VERIFIED");
 assert.equal(f.engine().list({characterID:701}).history.length,0);
}));
test("fake or missing real pirate wreck cannot produce paid history",()=>fixture(f=>{
 f.proof(false);assert.equal(f.engine().recordVerified(contract.contractID).status,
  "NATIVE_ESCORT_PROOF_UNVERIFIED");
}));
test("refund is historical but never earns reputation or player ISK",()=>fixture(f=>{
 f.phase("REFUNDED");const e=f.engine();
 assert.equal(e.recordVerified(contract.contractID).status,"VERIFIED_NATIVE_ESCORT_HISTORY_RECORDED");
 const h=e.list({characterID:701});
 assert.equal(h.reputation.paidContracts,0);
 assert.equal(h.reputation.refundedContracts,1);
 assert.equal(h.reputation.score,0);
 assert.equal(h.history[0].refundWitnessID,10007);
}));
test("unverified corporate refund cannot create a historical refund",()=>fixture(f=>{
 f.phase("REFUNDED");f.refund(false);
 assert.equal(f.engine().recordVerified(contract.contractID).status,
  "NATIVE_WALLET_TERMINAL_NOT_VERIFIED");
}));
test("an OPEN/DRAFT or PREPARED contract cannot create any paid history",()=>fixture(f=>{
 f.phase("SETTLEMENT_PREPARED");
 assert.equal(f.engine().recordVerified(contract.contractID).status,
  "NATIVE_TERMINAL_NOT_CONFIRMED");
}));
test("corrupt historical receipts fail closed, not recalculated from fewer records",()=>fixture(f=>{
 const e=f.engine();e.recordVerified(contract.contractID);
 fs.appendFileSync(path.join(f.root,"escort-reputation",contract.contractID+".json"),"{BAD");
 assert.equal(f.engine().list({characterID:701}).status,
  "HISTORY_CORRUPT_NEEDS_REPAIR");
}));
test("history refuses a universe-wide unscoped player query",()=>fixture(f=>{
 assert.equal(f.engine().list().status,"FILTER_REQUIRED");
}));
test("reputation default OFF even with confirmed native escrow",()=>fixture(f=>{
 process.env.EVEJS_COOP_ESCORT_REPUTATION="0";
 try{assert.equal(f.engine().recordVerified(contract.contractID).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_REPUTATION="1"}
}));
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_ESCORT_REPUTATION;
 else process.env.EVEJS_COOP_ESCORT_REPUTATION=old});
