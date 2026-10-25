import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvageCustody}=require("../integration/coopSalvageAtomicCustody.cjs");
const old=process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER;
process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER="1";
const args={manifestKey:"30000144-77-1000000",cargoID:5501,
 wreckItemID:9001,stationID:60001,corporationID:10001,quantity:5};
function setup(fn){
 let moved=false,calls=0,uncertain=false,receiptValid=true;
 const custody=createSalvageCustody({
  readSalvageProof:()=>({status:"SALVAGE_ORIGIN_VERIFIED",wreckID:8001,
   rows:[{cargoID:5501,wreckItemID:9001,quantity:5}]}),
  readManifest:()=>({status:"READY",record:{key:args.manifestKey,
   stationID:60001,corporationID:10001}}),
  readNativeWreckItem:()=>moved?null:{wreckItemID:9001,quantity:5},
  readWarehouseItem:()=>moved?{nativeWarehouseItemID:777,
   sourceCargoID:5501,sourceWreckItemID:9001,quantity:5}:null,
  inspectAtomicReceipt:()=>moved?{
   status:"ATOMIC_NATIVE_ITEM_MOVED",nativeDurable:true,
   sourceDebited:true,destinationCredited:true,wreckID:8001,
   ...args,nativeWarehouseItemID:777,
   ...(receiptValid?{}:{nativeDurable:false})}:{status:"NOT_FOUND"},
  atomicallyMoveOriginalItem:()=>{calls++;
   if(uncertain)throw Error("crash after commit");
   moved=true;return {status:"ATOMIC_NATIVE_ITEM_MOVED"}}
 });
 fn({custody,getCalls:()=>calls,setCommitted:()=>moved=true,
  setUncertain:()=>uncertain=true,badReceipt:()=>receiptValid=false});
}
test("one atomic provider move plus independent native custody receipt",()=>setup(f=>{
 assert.equal(f.custody.deliver(args).status,"SALVAGE_NATIVE_CUSTODY_VERIFIED");
 assert.equal(f.getCalls(),1);
}));
test("repeat transfer checks durable receipt and does not recredit",()=>setup(f=>{
 f.custody.deliver(args);
 assert.equal(f.custody.deliver(args).replayed,true);
 assert.equal(f.getCalls(),1);
}));
test("crash after atomic commit can be verified without a second transfer",()=>setup(f=>{
 f.setCommitted();
 assert.equal(f.custody.deliver(args).status,"SALVAGE_NATIVE_CUSTODY_VERIFIED");
 assert.equal(f.getCalls(),0);
}));
test("uncertain write cannot be called a completed rescue",()=>setup(f=>{
 f.setUncertain();
 assert.equal(f.custody.deliver(args).status,"SALVAGE_NATIVE_ATOMIC_MOVE_UNCERTAIN");
 assert.equal(f.getCalls(),1);
}));
test("receipt without durable native transfer cannot certify goods",()=>setup(f=>{
 f.setCommitted();f.badReceipt();
 assert.equal(f.custody.verify(args).status,
  "SALVAGE_ATOMIC_NATIVE_TRANSFER_NOT_VERIFIED");
}));
test("feature disabled never touches native inventory",()=>setup(f=>{
 process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER="0";
 try{assert.equal(f.custody.deliver(args).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER="1"}
 assert.equal(f.getCalls(),0);
}));
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER;
 else process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER=old});
