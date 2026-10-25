import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvageLedger}=require("../integration/coopSalvageProvenance.cjs");
const previous=process.env.EVEJS_COOP_SALVAGE_PROVENANCE;
process.env.EVEJS_COOP_SALVAGE_PROVENANCE="1";
const key="30000144-77-1000000";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-salvage-witness-"));
 let sourceExists=false,warehouseExists=false,originalID=5501,sourceCount=1,quantity=5;
 let wreckID=8001;
 const rows=()=>sourceCount===0?[]:Array.from({length:sourceCount},
  (_,i)=>({wreckID,wreckItemID:9001+i,sourceCargoID:originalID,
   typeID:34,quantity}));
 const make=()=>createSalvageLedger({root,clock:()=>1000000,
  readManifest:()=>({status:"READY",record:{key,systemID:30000144,
   stationID:60001,corporationID:10001,haulerIDs:[901],
   cargo:[{cargoID:5501,haulerID:901,typeID:34,quantity:8}]}}),
  getWreck:()=>({wreckID,systemID:30000144,sourceEntityID:901}),
  getWreckItems:rows,
  readOriginalCargo:()=>sourceExists,
  readWarehouseItem:()=>warehouseExists});
 try{fn({make,root,exists:()=>sourceExists=true,
  warehouse:()=>warehouseExists=true,
  fakeID:()=>originalID=5555,
  duplicate:()=>sourceCount=2,
  mismatch:()=>quantity=7,
  remove:()=>sourceCount=0,
  changeWreck:()=>wreckID=8002})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
const args={manifestKey:key,wreckID:8001,haulerID:901,systemID:30000144};
test("real unchanged original native cargo-to-wreck is durably witnessed",()=>fixture(f=>{
 assert.equal(f.make().witness(args).status,"SALVAGE_ORIGIN_DURABLE");
 assert.equal(f.make().verify(key).status,"SALVAGE_ORIGIN_VERIFIED");
 assert.equal(f.make().verify(key).quantity,5);
}));
test("restart cannot create a second source or duplicate original cargo receipt",()=>fixture(f=>{
 f.make().witness(args);
 assert.equal(f.make().witness(args).status,"ALREADY_VERIFIED");
 assert.equal(fs.readdirSync(path.join(f.root,"salvage-provenance")).length,1);
}));
test("cannot certify cargo if native hauler inventory still holds it",()=>fixture(f=>{
 f.exists();
 assert.equal(f.make().witness(args).status,"SALVAGE_ORIGINAL_NOT_EXCLUSIVELY_LOST");
}));
test("cannot certify wreck source if original cargo has reached warehouse",()=>fixture(f=>{
 f.warehouse();
 assert.equal(f.make().witness(args).status,"SALVAGE_ORIGINAL_NOT_EXCLUSIVELY_LOST");
}));
test("same-type fake native wreck loot is not enough",()=>fixture(f=>{
 f.fakeID();
 assert.equal(f.make().witness(args).status,"SALVAGE_NO_SOURCE_PROVEN_SURVIVORS");
}));
test("two wreck stacks claiming original cargo ID fail closed",()=>fixture(f=>{
 f.duplicate();
 assert.equal(f.make().witness(args).status,"SALVAGE_DUPLICATE_SOURCE_CARGO");
}));
test("after confirmed loss item changes, persisted origin evidence is not falsely replayed",()=>fixture(f=>{
 f.make().witness(args);f.mismatch();
 assert.equal(f.make().verify(key).status,"SALVAGE_ORIGINAL_ITEM_MISMATCH");
}));
test("unknown/corrupt on-disk evidence never verifies rescue",()=>fixture(f=>{
 f.make().witness(args);
 fs.appendFileSync(path.join(f.root,"salvage-provenance",key+".json"),"BROKEN");
 assert.equal(f.make().verify(key).status,"SALVAGE_JOURNAL_CORRUPT");
}));
test("feature default-off cannot write any witness",()=>fixture(f=>{
 process.env.EVEJS_COOP_SALVAGE_PROVENANCE="0";
 try{assert.equal(f.make().witness(args).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_PROVENANCE="1"}
 assert.equal(f.make().read(key).status,"NOT_FOUND");
}));
process.on("exit",()=>{if(previous===undefined)delete process.env.EVEJS_COOP_SALVAGE_PROVENANCE;
 else process.env.EVEJS_COOP_SALVAGE_PROVENANCE=previous});
