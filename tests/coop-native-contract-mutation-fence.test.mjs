import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createFence,TABLES}=require("../integration/coopNativeContractMutationFence.cjs");
const uid=()=>Math.floor(980000000+Math.random()*1000000);
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"eve-contract30-"));
 const contracts=new Map(),items=new Map(),calls=[],balances=new Map([[101,1000],[202,1000]]);
 const f=createFence({root,readContract:n=>contracts.get(n)||null,
   readItem:n=>items.get(n)||null,readBalance:n=>balances.get(n),getCreateReward:r=>r?.reward||0,
   flush:table=>{calls.push(["flush",table]);return {success:true}},clock:()=>1000000});
 return {f,root,contracts,items,balances,calls,done:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function setItem(f,id,ownerID,locationID,typeID,quantity){f.items.set(id,{itemID:id,ownerID,locationID,typeID,stacksize:quantity,singleton:quantity===1?1:0})}
function courier(f,id,overrides={}){
 const c={contractID:id,issuerID:101,issuerOwnerID:101,acceptorID:0,type:3,status:0,
  escrowLocationID:9000,packageLocationID:9000,plasticWrapItemID:700,packageItems:[{itemID:900,itemTypeID:34,quantity:5}],
  startStationID:600, endStationID:601,collateral:100,collateralEscrow:0,rewardEscrow:50,...overrides};
 f.contracts.set(id,c);setItem(f,700,101,9000,3468,1);setItem(f,900,1,9000,34,5);return c;
}
function createCall(f,ID=uid()){
 return {operation:"create",characterID:101,request:{contractType:3,itemList:[[900,5]],stationID:600,reward:50},apply:()=>{
   f.balances.set(101,f.balances.get(101)-50);courier(f,ID);return {success:true,contractIDs:[ID]};
 }};
}
test("one real courier issue writes durable PREPARED before moving native items and COMMITTED after flush",t=>{
 const f=setup();t.after(f.done);const req=createCall(f);let sawPrepared=false;
 const orig=req.apply;req.apply=()=>{const receipt=fs.readdirSync(path.join(f.root,"receipts"));assert.equal(receipt.length,1);
   const data=JSON.parse(fs.readFileSync(path.join(f.root,"receipts",receipt[0]),"utf8"));
   sawPrepared=data.phase==="PREPARED";return orig();};
 assert.equal(f.f.run(req).contractIDs.length,1);assert.equal(sawPrepared,true);
 const receipt=fs.readdirSync(path.join(f.root,"receipts"))[0];
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,"receipts",receipt),"utf8")).phase,"COMMITTED");
 assert.deepEqual(f.calls.map(x=>x[1]),TABLES);
 assert.deepEqual(fs.readdirSync(path.join(f.root,"locks")),[]);
});
test("same create request cannot be replayed to create free extra contract",t=>{
 const f=setup();t.after(f.done);const req=createCall(f);f.f.run(req);
 assert.throws(()=>f.f.run({...req,apply:()=>{throw Error("replayed")}}),/REPLAY_REQUIRES_RECONCILIATION/);
});
test("two pilots exchange courier custody on same physical itemIDs then finish only once",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000120);
 const accept={operation:"accept",contractID:c.contractID,characterID:202,request:{forCorp:false},apply:()=>{
  c.status=1;c.acceptorID=202;c.collateralEscrow=100;f.balances.set(202,f.balances.get(202)-100);
  setItem(f,700,202,600,3468,1);return {...c};
 }};
 assert.equal(f.f.run(accept).status,1);
 const complete={operation:"complete",contractID:c.contractID,characterID:202,request:{targetStatus:4},apply:()=>{
  f.balances.set(202,f.balances.get(202)+150);c.status=4;c.collateralEscrow=0;c.rewardEscrow=0;f.items.delete(700);
  setItem(f,900,101,601,34,5);return true;
 }};
 assert.equal(f.f.run(complete),true);
 assert.equal(f.items.get(900).ownerID,101);
 assert.throws(()=>f.f.run(complete),/REPLAY_REQUIRES_RECONCILIATION/);
});
test("invalid delivered item owner or quantity prevents finalized delivery",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000121,{status:1,acceptorID:202,collateralEscrow:100});
 setItem(f,700,202,600,3468,1);
 assert.throws(()=>f.f.run({operation:"complete",contractID:c.contractID,characterID:202,
  request:{targetStatus:4},apply:()=>{f.balances.set(202,f.balances.get(202)+150);c.status=4;c.collateralEscrow=0;c.rewardEscrow=0;f.items.delete(700);
   setItem(f,900,101,601,34,4);return true;}}),/NATIVE_OUTCOME_UNVERIFIED/);
 assert.equal(fs.readdirSync(path.join(f.root,"locks")).length,1);
});
test("native write failure leaves uncertain operation fenced across restart",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000122);
 const req={operation:"accept",contractID:c.contractID,characterID:202,request:{forCorp:false},apply:()=>{
  c.status=1;c.acceptorID=202;f.balances.set(202,f.balances.get(202)-100);setItem(f,700,202,600,3468,1);throw Error("db power loss");}};
 assert.throws(()=>f.f.run(req),/db power loss/);
 const next=createFence({root:f.root,readContract:n=>f.contracts.get(n)||null,readItem:n=>f.items.get(n)||null,readBalance:n=>f.balances.get(n),getCreateReward:r=>r?.reward||0,flush:()=>({success:true})});
 assert.throws(()=>next.run({...req,apply:()=>{throw Error("should never replay");}}),/PENDING_OPERATOR_REPAIR/);
 assert.equal(fs.readdirSync(path.join(f.root,"locks")).length,1);
});
test("native flush failure is uncertain, does not auto-retry any phase",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000123);
 const bad=createFence({root:f.root,readContract:id=>f.contracts.get(id),readItem:id=>f.items.get(id),readBalance:id=>f.balances.get(id),getCreateReward:r=>r?.reward||0,flush:table=>({success:table!=="characters"})});
 assert.throws(()=>bad.run({operation:"accept",contractID:c.contractID,characterID:202,request:{forCorp:false},apply:()=>{
  c.status=1;c.acceptorID=202;f.balances.set(202,f.balances.get(202)-100);setItem(f,700,202,600,3468,1);return {...c}}}),/NATIVE_FLUSH_UNVERIFIED/);
 assert.throws(()=>f.f.run({operation:"delete",contractID:c.contractID,characterID:101,apply:()=>true}),/PENDING_OPERATOR_REPAIR/);
});
test("expired/current source state, nonexistent escrow and wrong wrap cannot finalize creation",t=>{
 const f=setup();t.after(f.done);const req=createCall(f);
 req.apply=()=>{const ID=980000128;const c=courier(f,ID);f.items.delete(900);return {success:true,contractIDs:[ID]}};
 assert.throws(()=>f.f.run(req),/NATIVE_OUTCOME_UNVERIFIED/);
});
test("existing zero escrow item exchange must be physically on contract escrow location",t=>{
 const f=setup();t.after(f.done);const ID=980000129;
 assert.equal(f.f.run({operation:"create",characterID:101,request:{contractType:1,itemList:[[910,4]]},apply:()=>{
  f.contracts.set(ID,{contractID:ID,issuerID:101,type:1,status:0,escrowLocationID:9000,
    items:[{inCrate:true,escrowItemID:910,itemTypeID:34,quantity:4}]});setItem(f,910,1,9000,34,4);
  return {success:true,contractIDs:[ID]}}}).success,true);
});
test("bad identifiers and lack of root fail closed before native calls",t=>{
 const f=setup();t.after(f.done);assert.throws(()=>createFence({root:"relative",flush:()=>{},readContract:()=>{},readItem:()=>{}}),/NATIVE_DEPENDENCIES/);
 assert.throws(()=>f.f.run({operation:"accept",characterID:0,contractID:42,apply:()=>true}),/ACTOR_INVALID/);
 assert.throws(()=>f.f.run({operation:"accept",characterID:101,contractID:0,apply:()=>true}),/ID_INVALID/);
});
test("partial native status change is not an ACK, retained PREPARED after reconnect",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000130);
 assert.throws(()=>f.f.run({operation:"accept",contractID:c.contractID,characterID:202,request:{forCorp:false},apply:()=>{c.status=1;return {...c}}}),/NATIVE_OUTCOME_UNVERIFIED/);
 const files=fs.readdirSync(path.join(f.root,"receipts"));
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,"receipts",files[0]),"utf8")).phase,"PREPARED");
});
test("original issuer can cancel and reclaim physical escrow without a duplicated payout",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000131);
 assert.equal(f.f.run({operation:"delete",contractID:c.contractID,characterID:101,apply:()=>{
  c.status=8;c.rewardEscrow=0;f.balances.set(101,f.balances.get(101)+50);f.items.delete(700);setItem(f,900,101,600,34,5);return true;}}),true);
 assert.equal(f.items.get(900).ownerID,101);
});
test("two independent contractIDs do not share a write lock or receipts",t=>{
 const f=setup();t.after(f.done);const x=courier(f,980000134),y=courier(f,980000135);
 for(const c of [x,y])assert.equal(f.f.run({operation:"accept",contractID:c.contractID,characterID:c===x?101:202,request:{forCorp:false},apply:()=>{
  c.status=1;c.acceptorID=c===x?101:202;f.balances.set(c.acceptorID,f.balances.get(c.acceptorID)-100);setItem(f,700,c.acceptorID,600,3468,1);return {...c}}}).status,1);
 assert.equal(fs.readdirSync(path.join(f.root,"receipts")).length,2);
});
test("item exchange pays real price to issuer and escrow reward to acceptor, once",t=>{
 const f=setup();t.after(f.done);const ID=980000140;
 f.contracts.set(ID,{contractID:ID,issuerID:101,issuerOwnerID:101,type:1,status:0,
  price:200,rewardEscrow:30,escrowLocationID:9000,startStationID:600,
  items:[{inCrate:true,escrowItemID:980,itemTypeID:34,quantity:7}]});
 setItem(f,980,1,9000,34,7);
 const call={operation:"accept",contractID:ID,characterID:202,request:{forCorp:false},apply:()=>{
   const c=f.contracts.get(ID);c.status=4;c.acceptorID=202;c.rewardEscrow=0;
   f.balances.set(202,f.balances.get(202)-170);
   f.balances.set(101,f.balances.get(101)+200);
   setItem(f,980,202,600,34,7);return {...c};
 }};
 assert.equal(f.f.run(call).status,4);assert.equal(f.balances.get(101),1200);
 assert.equal(f.balances.get(202),830);assert.equal(f.items.get(980).ownerID,202);
 assert.throws(()=>f.f.run(call),/REPLAY_REQUIRES_RECONCILIATION/);
});
test("missing issuer price receipt blocks item exchange settlement even with moved goods",t=>{
 const f=setup();t.after(f.done);const ID=980000141;
 f.contracts.set(ID,{contractID:ID,issuerID:101,type:1,status:0,price:50,rewardEscrow:0,
  escrowLocationID:9000,startStationID:600,items:[{inCrate:true,escrowItemID:981,itemTypeID:34,quantity:3}]});
 setItem(f,981,1,9000,34,3);
 assert.throws(()=>f.f.run({operation:"accept",contractID:ID,characterID:202,request:{forCorp:false},apply:()=>{
  const c=f.contracts.get(ID);c.status=4;c.acceptorID=202;
  f.balances.set(202,950);setItem(f,981,202,600,34,3);return {...c};
 }}),/NATIVE_OUTCOME_UNVERIFIED/);
});
test("courier failure returns collateral and unused reward to issuer, never pays acceptor",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000142,{status:1,acceptorID:202,collateralEscrow:100});
 setItem(f,700,202,600,3468,1);
 assert.equal(f.f.run({operation:"complete",contractID:c.contractID,characterID:202,request:{targetStatus:7},apply:()=>{
  c.status=7;c.collateralEscrow=0;c.rewardEscrow=0;f.items.delete(700);
  setItem(f,900,202,600,34,5);f.balances.set(101,f.balances.get(101)+150);return true;
 }}),true);
 assert.equal(f.balances.get(202),1000);assert.equal(f.balances.get(101),1150);
});
test("two simultaneous calls on same contract cannot both mutate native wallet",t=>{
 const f=setup();t.after(f.done);const c=courier(f,980000143);let secondError;
 const first={operation:"accept",contractID:c.contractID,characterID:202,request:{forCorp:false},apply:()=>{
  try{f.f.run({...first,apply:()=>{throw Error("DOUBLE_DEBIT")}})}catch(e){secondError=e.message}
  c.status=1;c.acceptorID=202;f.balances.set(202,900);
  setItem(f,700,202,600,3468,1);return {...c};
 }};
 assert.equal(f.f.run(first).status,1);
 assert.match(secondError,/REPLAY_REQUIRES_RECONCILIATION|PENDING_OPERATOR_REPAIR/);
 assert.equal(f.balances.get(202),900);
});
