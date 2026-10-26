import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makeSettlementFence}=require("../integration/coopPlayerMarketSettlementFence.cjs");
const makeProof=({id="23",volumeBefore=7,filledQuantity=3}={})=>Object.freeze({
 orderID:id,ownerID:201,stationID:60001234,typeID:34,bid:false,
 priceCents:1234,volumeBefore,filledQuantity,
 volumeAfter:volumeBefore-filledQuantity,counterpartyID:301,
 sellerSourceLocationID:9200000000+Number(id)
});
const ack=proof=>({order_id:proof.orderID,owner_id:201,is_corp:false,
 station_id:60001234,type_id:34,bid:false,price:12.34,
 filled_quantity:proof.filledQuantity,vol_remaining:proof.volumeAfter,
 state:proof.volumeAfter===0?"filled":"open",invalidated:true});
function fixture(){
 const disk=new Map(),handles=new Map();
 let next=0,fsyncs=0;
 const storage={
  mkdirSync(){},
  openSync(name,mode){
   if(mode==="wx"&&disk.has(name)){
    const e=Error("EEXIST");e.code="EEXIST";throw e;
   }
   const fd=++next;handles.set(fd,{name,mode});
   if(mode==="wx")disk.set(name,"");
   return fd;
  },
  writeSync(fd,content){
   const h=handles.get(fd);if(!h)throw Error("bad fd");
   const val=String(content);
   disk.set(h.name,(h.mode==="a"?(disk.get(h.name)||""):"")+val);
   return Buffer.byteLength(val,"utf8");
  },
  fsyncSync(fd){if(!handles.has(fd))throw Error("bad fd");fsyncs++},
  closeSync(fd){handles.delete(fd)},
  unlinkSync(name){if(!disk.delete(name))throw Error("ENOENT")},
  readFileSync(name){
   if(!disk.has(name)){const e=Error("ENOENT");e.code="ENOENT";throw e}
   return disk.get(name);
  }
 };
 const native={wallet:{201:500,301:1000},stock:{201:7,301:0},
  escrow:{orderId:"23",ownerId:201,stationId:60001234,typeId:34,
    escrowType:"sell",remainingQuantity:7}};
 const provider={
  wallet:id=>native.wallet[id],
  quantity:id=>native.stock[id],
  escrow:()=>native.escrow
 };
 const file="/var/lib/evejs/p2p-native-settlement.jsonl";
 const make=(extra={})=>makeSettlementFence({file,storage,readNative:provider,
  clock:()=>123456,platform:"linux",...extra});
 const applyNative=(proof,tax=1)=>{
  const gross=proof.priceCents*proof.filledQuantity/100;
  const buyer=301,seller=201;
  native.wallet[buyer]-=gross;
  native.wallet[seller]+=gross-tax;
  native.stock[buyer]+=proof.filledQuantity;
  native.stock[seller]-=proof.filledQuantity;
  native.escrow=proof.volumeAfter>0?
    {...native.escrow,remainingQuantity:proof.volumeAfter}:null;
 };
 return {make,disk,storage,native,file,applyNative,get fsyncs(){return fsyncs}};
}
test("original P2P fill settles only after original Rust ACK and physical ISK/item changes",()=>{
 const x=fixture(),fence=x.make(),proof=makeProof(),ticket=fence.begin(proof);
 assert.throws(()=>fence.complete(ticket,{salesTax:1}),/NOT_RUST_ACKED/);
 // A refusal at this critical phase poisons this process; restart recovers
 // durable PREPARED and refuses replay, not a second market fill.
 const restarted=x.make();
 assert.throws(()=>restarted.begin(proof),/EXISTING_FILL_UNRECONCILED/);
 assert.equal(restarted.inspect()[0].phase,"PREPARED");
});
test("durable partial settlement allows a new genuine paid cycle with new volume",()=>{
 const x=fixture(),one=x.make(),proof=makeProof();
 const ticket=one.begin(proof);
 assert.equal(one.confirmRust(ticket,ack(proof)),true);
 x.applyNative(proof);
 assert.equal(one.complete(ticket,{salesTax:1}),true);
 assert.equal(one.inspect()[0].phase,"SETTLED");
 const two=x.make(),nextProof=makeProof({volumeBefore:4,filledQuantity:3});
 assert.equal(two.begin(nextProof).cycle,2);
 assert.ok(x.fsyncs>=8);
});
test("restart with in-flight Rust ACK locks order, participants and station",()=>{
 const x=fixture(),one=x.make(),proof=makeProof(),ticket=one.begin(proof);
 one.confirmRust(ticket,ack(proof));
 const restarted=x.make();
 assert.throws(()=>restarted.assertClear(proof.orderID),/MANUAL_RECONCILIATION/);
 assert.throws(()=>restarted.assertStationClear(proof.stationID),/STATION_HAS_UNRECONCILED/);
 assert.throws(()=>restarted.begin(proof),/EXISTING_FILL_UNRECONCILED/);
 const other=makeProof({id:"24"});
 assert.throws(()=>restarted.begin(other),/PARTICIPANT_IN_FLIGHT/);
 assert.equal(restarted.inspect()[0].phase,"RUST_ACK");
});
test("bad Rust ACK never completes the journal or repays the seller twice",()=>{
 const x=fixture(),one=x.make(),proof=makeProof(),ticket=one.begin(proof);
 assert.throws(()=>one.confirmRust(ticket,{...ack(proof),filled_quantity:2}),/FILL_ACK_NOT_MATCHED/);
 const after=x.make();
 assert.equal(after.inspect()[0].phase,"PREPARED");
 assert.throws(()=>after.begin(proof),/EXISTING_FILL_UNRECONCILED/);
});
test("missing wallet credit, cargo move, escrow update or tax evidence block SETTLED",()=>{
 for(const broken of ["wallet","cargo","escrow","tax"]){
  const x=fixture(),f=x.make(),proof=makeProof(),ticket=f.begin(proof);
  f.confirmRust(ticket,ack(proof));x.applyNative(proof);
  if(broken==="wallet")x.native.wallet[201]-=1;
  if(broken==="cargo")x.native.stock[301]-=1;
  if(broken==="escrow")x.native.escrow.remainingQuantity=7;
  assert.throws(()=>f.complete(ticket,{salesTax:broken==="tax"?-1:1}),
   /P2P_SETTLEMENT_/);
  assert.equal(x.make().inspect()[0].phase,"RUST_ACK");
 }
});
test("truncated and forged journal fails closed after restart, never resets cycles",()=>{
 const x=fixture(),f=x.make(),proof=makeProof();f.begin(proof);
 x.disk.set(x.file,x.disk.get(x.file).trimEnd());
 assert.throws(()=>x.make().assertClear("23"),/JOURNAL_TRUNCATED/);
});
test("persistent journal lock is process exclusive; stale locks are not removed",()=>{
 const x=fixture();x.disk.set(x.file+".lock","stale");
 assert.throws(()=>x.make().begin(makeProof()),/LOCK_UNAVAILABLE/);
 assert.equal(x.disk.get(x.file+".lock"),"stale");
});
test("Windows requires an existing durable journal before accepting first fill",()=>{
 const x=fixture();
 assert.throws(()=>x.make({platform:"win32"}),/WIN32_PRECREATED_JOURNAL_REQUIRED/);
 x.disk.set(x.file,"");
 const f=x.make({platform:"win32"}),ticket=f.begin(makeProof());
 assert.equal(ticket.cycle,1);
});
test("preflight rejects an invalid or unverifiable source proof before journaling",()=>{
 const x=fixture(),f=x.make();
 assert.throws(()=>f.begin(Object.freeze({...makeProof(),sellerSourceLocationID:0})),
  /PROOF_INVALID/);
 assert.equal(x.disk.get(x.file)||"","");
});
