import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCustody,applyRecovery,BASE}=require("../integration/coopNativeTradeCustody.cjs");

function fixture({staged=false,orphan=false,failFlush=false}={}){
 const file="/tmp/coop-trade-custody-test.jsonl";
 const disk=new Map(),handles=new Map();
 let nextFD=2,failWrite=false,now=1000000,flushCount=0,writeCount=0;
 const io={
  readFileSync:p=>{if(!disk.has(p)){const e=new Error("ENOENT");e.code="ENOENT";throw e}
   return disk.get(p)},
  mkdirSync(){},
  openSync:(p)=>{const fd=++nextFD;handles.set(fd,p);return fd},
  writeSync:(fd,data)=>{if(failWrite)throw Error("DISK_FULL");
   const p=handles.get(fd);disk.set(p,(disk.get(p)||"")+data.toString("utf8"));return data.length},
  fsyncSync(){},closeSync(fd){handles.delete(fd)}
 };
 const original={itemID:501,ownerID:11,locationID:60003760,flagID:4,
  typeID:34,stacksize:10,quantity:10,singleton:0};
 const item={...original,...(staged?{locationID:BASE+1,flagID:4}:{})};
 const items={"501":item,"502":{itemID:502,ownerID:11,locationID:501,flagID:27,
   typeID:35,stacksize:1,quantity:1,singleton:1}};
 const inventory={
  getAllItems:()=>JSON.parse(JSON.stringify(items)),
  recoverCoopTradeStaging:changes=>applyRecovery({changes,
   readItems:()=>items,
   writeItems:(newItems)=>{writeCount++;Object.assign(items,newItems);return true},
   normalizeInventoryItem:x=>x?{...x}:null,
   buildInventoryItem:x=>({...x}),
   indexDeltaFromChanges:x=>({upsertedIDs:x.map(y=>y.item.itemID)}),
   cloneValue:x=>structuredClone(x),
   flushItems:()=>{flushCount++;return {success:!failFlush}}
  })
 };
 const service={_tradeOrdinal:1};
 const trade={tradeID:"trade:"+(BASE+1),tradeContainerID:BASE+1,
  dockedLocationID:60003760,traders:[11,22],status:"open"};
 const session={characterID:11};
 const origin={ownerID:11,locationID:60003760,flagID:4};
 const make=()=>createCustody({file,io,clock:()=>now++});
 return {file,make,disk,io,items,inventory,service,trade,session,origin,
  item:items["501"],setFailWrite:x=>{failWrite=x},
  flushes:()=>flushCount,writes:()=>writeCount};
}
function stage(f,c){
 assert.equal(c.start(f.service,f.inventory).ok,true);
 c.beforeStage(f.service,f.trade,f.session,f.item,f.origin,null);
 f.item.locationID=BASE+1;
 c.afterStage(f.service,f.trade,f.item,[501]);
}
test("P0 writes durable PREPARED before native stage and STAGED after successful move",()=>{
 const f=fixture(),c=f.make();
 stage(f,c);
 const log=f.disk.get(f.file).trim().split("\n").map(JSON.parse);
 assert.deepEqual(log.map(e=>e.state),["PREPARED","STAGED"]);
 assert.equal(log[0].ownerID,11);
 assert.equal(log[0].locationID,60003760);
 assert.equal(log[0].itemID,501);
});
test("P0 restart returns exact staged root to native origin, preserving nested cargo",()=>{
 const f=fixture(),old=f.make();stage(f,old);
 const fresh=f.make(),next={_tradeOrdinal:1};
 const r=fresh.start(next,f.inventory);
 assert.equal(r.ok,true);assert.equal(r.recovered,1);assert.equal(r.moved,1);
 assert.equal(f.items["501"].locationID,60003760);
 assert.equal(f.items["501"].ownerID,11);
 assert.equal(f.items["502"].ownerID,11);
 assert.equal(f.items["502"].locationID,501);
 assert.equal(f.flushes(),1);
 assert.equal(next._tradeOrdinal,2);
 assert.equal(fresh.read().entries.get((BASE+1)+":501").state,"RECOVERED");
 const again=f.make(),later={_tradeOrdinal:1};
 assert.equal(again.start(later,f.inventory).recovered,0);
 assert.equal(later._tradeOrdinal,2);
});
test("P0 write failure before transfer blocks staging, leaves original item untouched",()=>{
 const f=fixture(),c=f.make();assert.equal(c.start(f.service,f.inventory).ok,true);
 f.setFailWrite(true);
 assert.throws(()=>c.beforeStage(f.service,f.trade,f.session,f.item,f.origin,null),
  /CUSTODY_JOURNAL_WRITE_FAILED/);
 assert.equal(f.item.locationID,60003760);
 assert.equal(f.disk.has(f.file),false);
 assert.throws(()=>c.assertReady(f.service),/CUSTODY_BLOCKED/);
});
test("P0 partial stack trade and foreign owner blocked BEFORE item moves",()=>{
 const f=fixture(),c=f.make();c.start(f.service,f.inventory);
 assert.throws(()=>c.beforeStage(f.service,f.trade,f.session,f.item,f.origin,3),
  /COOP_TRADE_PARTIAL_OR_FOREIGN_STAGE_BLOCKED/);
 assert.throws(()=>c.beforeStage(f.service,f.trade,{characterID:22},f.item,f.origin,null),
  /COOP_TRADE_PARTIAL_OR_FOREIGN_STAGE_BLOCKED/);
 assert.equal(f.disk.has(f.file),false);
});
test("P0 PREPARED-only crash recovers without moving an original native item",()=>{
 const f=fixture(),c=f.make();c.start(f.service,f.inventory);
 c.beforeStage(f.service,f.trade,f.session,f.item,f.origin,null);
 const res=f.make().start({_tradeOrdinal:1},f.inventory);
 assert.equal(res.ok,true);
 assert.equal(res.recovered,1);assert.equal(res.moved,0);
 assert.equal(f.item.locationID,60003760);
});
test("P0 journal unavailable/corrupt and unjournaled native orphan block trade",()=>{
 const f=fixture({staged:true});
 const first=f.make();
 assert.equal(first.start(f.service,f.inventory).reason,"UNJOURNALED_NATIVE_TRADE_ITEM");
 assert.throws(()=>first.assertReady(f.service),/CUSTODY_BLOCKED/);
 const b=fixture();b.disk.set(b.file,'{"v":1');
 assert.equal(b.make().start(b.service,b.inventory).reason,"CUSTODY_JOURNAL_CORRUPT");
});
test("P0 if item was already moved to different owner, NEVER steal it back",()=>{
 const f=fixture(),c=f.make();stage(f,c);
 f.item.ownerID=22;f.item.locationID=60003760;
 const result=f.make().start({_tradeOrdinal:1},f.inventory);
 assert.equal(result.ok,false);
 assert.equal(result.reason,"AMBIGUOUS_NATIVE_TRADE_CUSTODY");
 assert.equal(f.item.ownerID,22);
 assert.equal(f.writes(),0);
});
test("P0 changing item type, stack or container also blocks recovery",()=>{
 for(const patch of [
  {typeID:35},{stacksize:9},{locationID:BASE+55},
  {ownerID:22},{itemID:599}
 ]){
  const f=fixture(),c=f.make();stage(f,c);
  Object.assign(f.item,patch);
  const next=f.make().start({_tradeOrdinal:1},f.inventory);
  assert.equal(next.ok,false);
  assert.equal(f.writes(),0);
 }
});
test("P0 failed native flush blocks item recovery without claiming success",()=>{
 const f=fixture({failFlush:true}),c=f.make();stage(f,c);
 const next=f.make().start({_tradeOrdinal:1},f.inventory);
 assert.equal(next.reason,"NATIVE_TRADE_RECOVERY_UNCERTAIN");
 assert.equal(f.make().read().entries.get((BASE+1)+":501").state,"STAGED");
});
test("P0 native abort verifies restored item and flushes before closing ledger",()=>{
 const f=fixture(),c=f.make();stage(f,c);
 f.item.locationID=60003760;
 assert.equal(c.finishAbort(f.service,f.trade),true);
 assert.equal(c.read().entries.get((BASE+1)+":501").state,"ABORTED");
 assert.equal(f.flushes(),1);
 assert.equal(f.make().start({_tradeOrdinal:1},f.inventory).recovered,0);
});
test("P0 native completion is only closed after recipient owns item at station",()=>{
 const f=fixture(),c=f.make();stage(f,c);
 f.item.locationID=60003760;f.item.ownerID=22;
 assert.equal(c.finishComplete(f.service,f.trade),true);
 assert.equal(c.read().entries.get((BASE+1)+":501").state,"COMPLETED");
 assert.equal(f.make().start({_tradeOrdinal:1},f.inventory).recovered,0);
});
test("P0 completion with wrong native owner blocks and leaves journal unreconciled",()=>{
 const f=fixture(),c=f.make();stage(f,c);
 f.item.locationID=60003760;f.item.ownerID=33;
 assert.throws(()=>c.finishComplete(f.service,f.trade),/NATIVE_COMPLETION_CUSTODY_UNCERTAIN/);
 assert.equal(c.read().entries.get((BASE+1)+":501").state,"STAGED");
});
test("P0 duplicate precommit for same trade root never overwrites original origin",()=>{
 const f=fixture(),c=f.make();c.start(f.service,f.inventory);
 c.beforeStage(f.service,f.trade,f.session,f.item,f.origin,null);
 assert.throws(()=>c.beforeStage(f.service,f.trade,f.session,f.item,f.origin,null),
  /DUPLICATE_TRADE_STAGE_INTENT/);
 assert.equal(c.read().entries.get((BASE+1)+":501").locationID,60003760);
});
test("P0 recovery adapter validates whole batch before native items write",()=>{
 const root={itemID:501,ownerID:11,typeID:34,stacksize:10,
  locationID:BASE+1,flagID:4};
 const store={"501":root};
 let writes=0;
 const deps={readItems:()=>store,writeItems:()=>{writes++;return true},
  normalizeInventoryItem:x=>x,
  buildInventoryItem:x=>x,
  indexDeltaFromChanges:x=>({}),cloneValue:x=>({...x}),
  flushItems:()=>({success:true})};
 const invalid=applyRecovery({...deps,changes:[{itemID:501,ownerID:22,
  fromLocationID:BASE+1,locationID:60003760,flagID:4,typeID:34,stacksize:10}]});
 assert.equal(invalid.success,false);assert.equal(writes,0);
});
