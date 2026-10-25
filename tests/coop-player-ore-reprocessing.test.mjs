import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createReprocessor,materializeWithoutSplit}=
 require("../integration/coopPlayerOreReprocessing.cjs");
function fixture(fn,{fee=0,randomized=false,failNative=false,io=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"chat25-ore-"));
 const rows=new Map([[9801,{itemID:9801,ownerID:7001,locationID:6001,
  flagID:4,typeID:1230,quantity:100,stacksize:100,singleton:0}]]);
 let calls=0,ids=9900;
 const items={ITEM_FLAGS:{HANGAR:4},CLIENT_INVENTORY_STACK_LIMIT:2147483647,
  getItemMetadata:()=>({groupID:18,categoryID:4}),
  findItemById:id=>rows.get(id)||null,
  listContainerItems:(o,l,f)=>[...rows.values()].filter(r=>
   r.ownerID===o&&r.locationID===l&&r.flagID===f),
  coopPlayerOreReprocessAtomic(plan){
   calls++;
   if(failNative)throw Error("NATIVE_FLUSH_UNKNOWN");
   const row=rows.get(plan.itemID);
   if(!row||row.quantity!==plan.originalQuantity)return {success:false};
   rows.set(row.itemID,{...row,quantity:plan.leftOvers,stacksize:plan.leftOvers});
   const created=[],outputChanges=[];
   for(const output of plan.outputs){
    const material={itemID:++ids,ownerID:plan.characterID,
     locationID:plan.stationID,flagID:4,typeID:output.typeID,
     quantity:output.quantity,stacksize:output.quantity,
     customInfo:plan.operationID+":mineral:"+output.typeID};
    rows.set(material.itemID,material);
    created.push({itemID:material.itemID,typeID:material.typeID,quantity:material.quantity});
    outputChanges.push({item:material,previousData:{locationID:0}});
   }
   return {success:true,data:{created,inputChanges:[],outputChanges}};
  }};
 const industry={
  resolveReprocessingContext:s=>({success:true,data:{characterID:s.characterID,
   dockedLocationID:6001,dockedKind:"station"}}),
  buildReprocessingQuoteForItem:item=>({
   itemID:item.itemID,typeID:item.typeID,quantityToProcess:90,
   leftOvers:10,portions:3,totalISKCost:fee,
   recoverables:[{typeID:34,client:50,unrecoverable:10}]
  })};
 let activeIO=io||fs;
 const create=()=>createReprocessor({items,industry,staticData:{
  typeHasRandomizedMaterials:()=>randomized
 },root,io:activeIO,clock:()=>1234567});
 const session={characterID:7001,socket:{destroyed:false}};
 const opts={itemIDs:[9801],fromLocationID:6001,ownerID:0,
  outputLocationID:6001,outputFlagID:4};
 try{fn({root,rows,items,create,session,opts,calls:()=>calls,
  setIO:next=>activeIO=next});}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
test("one station ore stack becomes genuine owned mineral rows and durable receipt",()=>fixture(f=>{
 const a=f.create().processItem(f.session,f.opts);
 assert.equal(a.success,true);
 assert.deepEqual(a.data.outputByTypeID,{"34":50});
 assert.equal(a.data.outputOwnerID,7001);
 assert.equal(f.rows.get(9801).quantity,10);
 assert.equal(f.rows.get(9901).typeID,34);
 assert.equal(f.create().review({operationID:a.data.operationID}).status,"COMMITTED_VERIFIED");
 assert.equal(f.calls(),1);
}));
test("native-positive ISK fee hard-blocks before ore debit, no fabricated tax",()=>fixture(f=>{
 const a=f.create().processItem(f.session,f.opts);
 assert.equal(a.errorMsg,"PLAYER_ORE_ATOMIC_WALLET_TAX_REQUIRED");
 assert.equal(a.requiredISK,2.5);
 assert.equal(f.calls(),0);
 assert.equal(f.rows.get(9801).quantity,100);
},{fee:2.5}));
test("foreign owner, wrong output owner and multi-stack source fail closed",()=>fixture(f=>{
 assert.equal(f.create().processItem(f.session,{...f.opts,ownerID:7002}).errorMsg,
  "PLAYER_ORE_OUTPUT_OWNER_MISMATCH");
 assert.equal(materializeWithoutSplit(f.session,[9801,9801]).errorMsg,"PLAYER_ORE_SINGLE_STACK_REQUIRED");
 assert.equal(f.create().processItem(f.session,{...f.opts,itemIDs:[9801,9801]}).errorMsg,
  "PLAYER_ORE_SINGLE_STACK_REQUIRED");
 f.rows.get(9801).ownerID=7002;
 assert.equal(f.create().processItem(f.session,f.opts).errorMsg,
  "PLAYER_ORE_NOT_IN_PERSONAL_STATION_HANGAR");
 assert.equal(f.calls(),0);
}));
test("randomized salvage recipes cannot be guessed or granted",()=>fixture(f=>{
 assert.equal(f.create().processItem(f.session,f.opts).errorMsg,
  "PLAYER_ORE_RANDOMIZED_RECIPE_UNSUPPORTED");
 assert.equal(f.calls(),0);
},{randomized:true}));
test("failed fsync before mutation yields no new items or native debit",()=>fixture(f=>{
 f.setIO({...fs,fsyncSync(){throw Error("CRASH_BEFORE_MUTATION")}});
 const a=f.create().processItem(f.session,f.opts);
 assert.equal(a.errorMsg,"PLAYER_ORE_PREPARE_UNCERTAIN");
 assert.equal(f.calls(),0);
 assert.equal(f.rows.get(9801).quantity,100);
}));
test("unknown native commit is PREPARED after restart and cannot mint twice",()=>fixture(f=>{
 const a=f.create().processItem(f.session,f.opts);
 assert.equal(a.errorMsg,"PLAYER_ORE_NATIVE_MUTATION_UNCERTAIN");
 assert.equal(f.create().processItem(f.session,f.opts).errorMsg,
  "PLAYER_ORE_PENDING_OPERATOR_RECONCILIATION");
 assert.equal(f.calls(),1);
 assert.equal(f.create().review({operationID:a.operationID,authorize:true}).status,
  "NATIVE_READBACK_INCOMPLETE");
},{failNative:true}));
test("crash after native debit requires operator proof-only reconciliation",()=>fixture(f=>{
 let renames=0;
 f.setIO({...fs,renameSync(a,b){
  if(++renames===2)throw Error("CRASH_AFTER_MUTATION");
  return fs.renameSync(a,b);
 }});
 const a=f.create().processItem(f.session,f.opts);
 assert.equal(a.errorMsg,"PLAYER_ORE_COMMIT_RECEIPT_UNCERTAIN");
 assert.equal(f.calls(),1);
 assert.equal(f.create().review({operationID:a.operationID}).status,
  "PENDING_OPERATOR_RECONCILIATION");
 assert.equal(f.create().review({operationID:a.operationID,authorize:true}).status,
  "RECOVERED_NATIVE_COMMIT");
 assert.equal(f.create().review({operationID:a.operationID}).status,"COMMITTED_VERIFIED");
 assert.equal(f.calls(),1);
}));
test("corrupt committed journal and missing mineral row are never repaired by minting",()=>fixture(f=>{
 const a=f.create().processItem(f.session,f.opts);
 f.rows.delete(9901);
 assert.equal(f.create().review({operationID:a.data.operationID}).status,
  "COMMITTED_ITEMS_MOVED_OR_UNVERIFIED");
 const file=path.join(f.root,a.data.operationID+".json");
 fs.writeFileSync(file,"{bad");
 assert.equal(f.create().review({operationID:a.data.operationID}).status,
  "NEEDS_OPERATOR_REPAIR");
 assert.equal(f.calls(),1);
}));
