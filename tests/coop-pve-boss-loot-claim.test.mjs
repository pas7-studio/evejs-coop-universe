import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createFence}=require("../integration/coopPveBossLootClaim.cjs");
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-pve-boss-item-"));
 try{
  const file=path.join(dir,"journal.json"),witness={wreckID:9551,systemID:30000144,
   bossEntityID:101,bossTypeID:30001,initialWreckItems:null,
   originalItems:[{wreckItemID:9901,typeID:91001,quantity:3,singleton:false}]};
  const native={wreckID:9551,sourceEntityID:101,sourceTypeID:30001,
   launcherID:101,systemID:30000144,transient:true};
  const make=opts=>createFence({file,getBossWreck:()=>witness,
   getNativeWreck:()=>native,clock:()=>1_000_000,...opts});
  const args={wreck:native,wreckItem:{wreckID:9551,wreckItemID:9901,
   locationID:9551,typeID:91001,quantity:3},
   characterID:77,destinationLocationID:8001,requestedQuantity:2};
  const confirmed={status:"ORIGINAL_BOSS_ITEM_PICKUP_VERIFIED",wreckID:9551,
   wreckItemID:9901,characterID:77,shipID:8001,quantity:2,remainingQuantity:1};
  return fn({dir,file,witness,native,make,args,confirmed});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test("a source-proven native boss item is durably fenced BEFORE grant",()=>fixture(f=>{
 const one=f.make();
 assert.equal(one.begin(f.args).status,"BOSS_LOOT_CLAIMED");
 const disk=JSON.parse(fs.readFileSync(f.file,"utf8"));
 assert.equal(disk.entries["9551:9901:3"].phase,"PENDING");
 assert.equal(f.make().begin(f.args).status,"BOSS_LOOT_REPLAY_BLOCKED");
 assert.equal(fs.existsSync(f.file+".writer.lock"),false);
}));
test("originally verified native source debit and cargo destination settle claim",()=>fixture(f=>{
 const one=f.make();
 assert.equal(one.begin(f.args).status,"BOSS_LOOT_CLAIMED");
 assert.equal(f.make().settle({verified:f.confirmed,
  sourceBefore:f.args.wreckItem}).status,"BOSS_LOOT_CLAIM_SETTLED");
 const state=JSON.parse(fs.readFileSync(f.file,"utf8"));
 assert.equal(state.entries["9551:9901:3"].phase,"SETTLED");
 assert.equal(f.make().begin(f.args).status,"BOSS_LOOT_REPLAY_BLOCKED");
 // Remaining original item can be legitimately claimed, using NEXT source quantity.
 const after={...f.args,wreckItem:{...f.args.wreckItem,quantity:1},
  requestedQuantity:1};
 assert.equal(f.make().begin(after).status,"BOSS_LOOT_CLAIMED");
 assert.equal(f.make().settle({verified:{...f.confirmed,quantity:1,
  remainingQuantity:0},sourceBefore:after.wreckItem}).status,
  "BOSS_LOOT_CLAIM_SETTLED");
 assert.equal(Object.keys(f.make().snapshot().entries).length,2);
}));
test("a crashed or unknown native grant never gets automatically replayed",()=>fixture(f=>{
 assert.equal(f.make().begin(f.args).status,"BOSS_LOOT_CLAIMED");
 const reopened=f.make();
 assert.equal(reopened.begin({...f.args,requestedQuantity:1}).status,
  "BOSS_LOOT_REPLAY_BLOCKED");
 assert.equal(reopened.settle({verified:{...f.confirmed,status:"UNKNOWN"},
  sourceBefore:f.args.wreckItem}).status,"BOSS_LOOT_SETTLEMENT_NOT_VERIFIED");
 assert.equal(reopened.snapshot().entries["9551:9901:3"].phase,"PENDING");
}));
test("wrong player, hold, amount or source slice may not settle another grant",()=>fixture(f=>{
 const g=f.make();g.begin(f.args);
 for(const changes of [{characterID:88},{shipID:8002},{quantity:1},
  {remainingQuantity:0},{wreckItemID:9902}]){
  assert.equal(g.settle({verified:{...f.confirmed,...changes},
   sourceBefore:f.args.wreckItem}).status,"BOSS_LOOT_CLAIM_NOT_MATCHED");
 }
 assert.equal(g.snapshot().entries["9551:9901:3"].phase,"PENDING");
}));
test("foreign wreck, missing witnessed boss or item not in original drop fail before grant",()=>fixture(f=>{
 const a=f.make();
 f.witness.wreckID=9552;
 assert.equal(a.begin(f.args).status,"BOSS_LOOT_SOURCE_UNVERIFIED");
 f.witness.wreckID=9551;
 f.witness.originalItems=[];
 assert.equal(a.begin(f.args).status,"BOSS_LOOT_SOURCE_UNVERIFIED");
 assert.equal(fs.existsSync(f.file),false);
}));
test("legacy non-boss wreck remains on original native transfer path",()=>fixture(f=>{
 const a=f.make({getBossWreck:()=>null});
 assert.equal(a.begin(f.args).status,"NOT_VERIFIED_BOSS_WRECK");
 assert.equal(fs.existsSync(f.file),false);
}));
test("an unresolved writer lock blocks any new native boss grant",()=>fixture(f=>{
 fs.writeFileSync(f.file+".writer.lock","unresolved crash");
 assert.equal(f.make().begin(f.args).status,"BOSS_LOOT_WRITER_BUSY");
 assert.equal(fs.existsSync(f.file+".writer.lock"),true);
}));
test("uncommitted temp row and corrupt durable data are fail-closed",()=>fixture(f=>{
 fs.writeFileSync(f.file+".tmp-12345","interrupted");
 assert.equal(f.make().begin(f.args).status,"BOSS_LOOT_JOURNAL_UNSAFE");
 fs.unlinkSync(f.file+".tmp-12345");
 fs.writeFileSync(f.file,"{corrupt");
 // A previous unsafe write leaves a non-stealable writer lock in place;
 // this is a stronger block, never an automatic retry.
 assert.equal(f.make().begin(f.args).status,"BOSS_LOOT_WRITER_BUSY");
}));
test("fsync failure before durable claim must not authorize a native item grant",()=>fixture(f=>{
 const store={...fs,fsyncSync:()=>{throw Error("disk unavailable")}};
 assert.equal(f.make({storage:store}).begin(f.args).status,"BOSS_LOOT_JOURNAL_UNSAFE");
 assert.equal(fs.existsSync(f.file+".writer.lock"),true);
}));
test("multiple original loot items cannot bypass the same pending source-item fence",()=>fixture(f=>{
 const one=f.make(),two=f.make();
 assert.equal(one.begin(f.args).status,"BOSS_LOOT_CLAIMED");
 const modified={...f.args,characterID:88,destinationLocationID:9000,
  requestedQuantity:1};
 assert.equal(two.begin(modified).status,"BOSS_LOOT_REPLAY_BLOCKED");
}));


test("two separate players may collect different original item IDs without sharing a claim",()=>fixture(f=>{
 f.witness.originalItems.push({wreckItemID:9902,typeID:91002,quantity:2,singleton:false});
 const a=f.make(),second={
  wreck:f.native,wreckItem:{wreckID:9551,wreckItemID:9902,locationID:9551,
   typeID:91002,quantity:2},characterID:88,destinationLocationID:8002,
  requestedQuantity:1
 };
 assert.equal(a.begin(f.args).status,"BOSS_LOOT_CLAIMED");
 assert.equal(f.make().begin(second).status,"BOSS_LOOT_CLAIMED");
 assert.equal(f.make().begin({...f.args,characterID:88,
  destinationLocationID:8002,requestedQuantity:1}).status,"BOSS_LOOT_REPLAY_BLOCKED");
 assert.equal(f.make().settle({verified:f.confirmed,
  sourceBefore:f.args.wreckItem}).status,"BOSS_LOOT_CLAIM_SETTLED");
 assert.equal(f.make().settle({verified:{...f.confirmed,wreckItemID:9902,
  characterID:88,shipID:8002,quantity:1,remainingQuantity:1},
  sourceBefore:second.wreckItem}).status,"BOSS_LOOT_CLAIM_SETTLED");
 assert.equal(Object.keys(f.make().snapshot().entries).length,2);
}));
test("native source resurrection after a settled debit is refused",()=>fixture(f=>{
 const g=f.make();
 assert.equal(g.begin(f.args).status,"BOSS_LOOT_CLAIMED");
 assert.equal(g.settle({verified:f.confirmed,
  sourceBefore:f.args.wreckItem}).status,"BOSS_LOOT_CLAIM_SETTLED");
 const bad={...f.args,wreckItem:{...f.args.wreckItem,quantity:2},
  requestedQuantity:1};
 assert.equal(f.make().begin(bad).status,"BOSS_LOOT_SOURCE_SEQUENCE_MISMATCH");
 const correct={...bad,wreckItem:{...bad.wreckItem,quantity:1}};
 assert.equal(f.make().begin(correct).status,"BOSS_LOOT_CLAIMED");
}));
test("failure of the FINAL directory fsync cannot return a successful pregrant ACK",()=>fixture(f=>{
 let n=0;
 const broken={...fs,fsyncSync:fd=>{
  n++;
  if(n===5)throw Error("final fsync failed");
  return fs.fsyncSync(fd);
 }};
 const g=f.make({storage:broken});
 assert.equal(g.begin(f.args).status,"BOSS_LOOT_JOURNAL_UNSAFE");
 assert.equal(g.snapshot().status,"BOSS_LOOT_JOURNAL_UNSAFE");
 // A durable source record may exist, but the uncertain final result
 // must never be reported as permission to perform the original grant.
 assert.equal(JSON.parse(fs.readFileSync(f.file,"utf8"))
  .entries["9551:9901:3"].phase,"PENDING");
}));

test("after restart an original overseer wreck cannot bypass strict pregrant without live witness",()=>fixture(f=>{
 const overseer={...f.native,profileID:"deadspace-overseer",
  lootTableID:"parity_deadspace_overseer_pending_loot"};
 const a=f.make({getBossWreck:()=>null,getNativeWreck:()=>overseer});
 assert.equal(a.begin(f.args).status,"BOSS_LOOT_LIVE_WITNESS_REQUIRED");
 assert.equal(fs.existsSync(f.file),false);
}));
test("ordinary original native wreck with no boss evidence continues the unmodified transfer",()=>fixture(f=>{
 const regular={...f.native,profileID:"belt-guristas-frigate",
  lootTableID:"loot_belt_normal_small"};
 const a=f.make({getBossWreck:()=>null,getNativeWreck:()=>regular});
 assert.equal(a.begin(f.args).status,"NOT_VERIFIED_BOSS_WRECK");
}));
test("missing original wreck API does not silently treat a verified boss as an unclassified NPC",()=>fixture(f=>{
 const a=f.make({getNativeWreck:()=>{throw Error("original native db offline")}});
 assert.equal(a.begin(f.args).status,"BOSS_LOOT_AUTHORITY_UNAVAILABLE");
}));
