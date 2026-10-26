import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createRefinery}=require('../integration/coopNpcRefinery.cjs');
const {HOOK,patch,TARGET}=require('../scripts/coop-native-refinery-item-patch.cjs');
function sample(mutate={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coop-refinery-'));
 let db={'700':{itemID:700,ownerID:1001,locationID:2001,typeID:1230,
     quantity:100,stacksize:100,singleton:0,flagID:4,customInfo:'coop-warehouse:v1:cargo:990'}};
 let disk=JSON.parse(JSON.stringify(db)); let writes=0,flushes=0;
 const state={failWrite:false,failFlush:false,fee:0,invalid:false};
 const repository={flushTableSync:()=>{flushes++;if(state.failFlush)return {success:false};disk=structuredClone(db);return {success:true}}};
 const itemSource=HOOK.slice(HOOK.indexOf('function refineNpcWarehouseOreAtomic('),HOOK.indexOf('// COOP_NATIVE_REFINERY_ATOMIC_END'));
 const setup=new Function('env',`with(env){ ${itemSource}; return refineNpcWarehouseOreAtomic; }`);
 const env={ensureMigrated(){},readItems:()=>structuredClone(db),
   writeItems:n=>{writes++;if(state.failWrite)return false;db=n;return true},
   normalizeInventoryItem:x=>x,
   toNumber:(v,d=0)=>Number.isFinite(Number(v))?Number(v):d,
   getItemMetadata:id=>({typeID:id,groupID:[34,35].includes(id)?18:0,name:'Mineral '+id}),
   ITEM_FLAGS:{HANGAR:4},CLIENT_INVENTORY_STACK_LIMIT:2147483647,
   ITEMS_TABLE:'items',repo:repository,
   buildInventoryItem:x=>({...x,groupID:x.typeID===34?18:6}),
   nextItemID:(_owner,items)=>Math.max(700,...Object.keys(items).map(Number))+1};
 const method=setup(env);
 const items={ITEM_FLAGS:{HANGAR:4},CLIENT_INVENTORY_STACK_LIMIT:2147483647,
   findItemById:id=>structuredClone(db[String(id)]||null),
   listOwnedItems:(id,opt)=>Object.values(db).filter(x=>x.ownerID===id&&x.locationID===opt.locationID&&x.flagID===opt.flagID),
   refineNpcWarehouseOreAtomic:method};
 const reprocessing={buildReprocessingQuoteForItem:(item,context)=>{
    if(state.invalid)return null;
    assert.equal(context.characterID,0);assert.equal(context.dockedKind,'station');
    assert.equal(context.skillMap instanceof Map,true);
    return {typeID:item.typeID,quantityToProcess:90,leftOvers:10,
       portions:9,efficiency:0.5,stationTax:0.03,totalISKCost:state.fee,
       recoverables:[{typeID:34,client:45,unrecoverable:45,iskCost:0},
                     {typeID:35,client:22,unrecoverable:23,iskCost:0}]};
   }};
 const deps={directory:dir,items,reprocessing,
  getStation:id=>id===2001?{stationID:2001,solarSystemID:30000144,reprocessingEfficiency:0.5}:null,
  getCorporation:id=>id===1001?{corporationID:1001,isNPC:true}:null,
  isNpcCorporation:id=>id===1001,
  facilityAvailable:(s,owner)=>s.stationID===2001&&owner===1001};
 Object.assign(state,mutate);
 return {dir,state,items,deps,engine:createRefinery(deps),getDb:()=>structuredClone(db),getDisk:()=>disk,
  mutateItem:(id,patch)=>{db[String(id)]={...db[String(id)],...patch}},
  restore:()=>{db=structuredClone(disk)},writes:()=>writes,flushes:()=>flushes,dispose:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const args={oreItemID:700,ownerID:1001,stationID:2001};
const each=(name,fn)=>test(name,()=>{const fx=sample();try{fn(fx)}finally{fx.dispose()}});
each('preview uses real native quote in zero-skill NPC context',f=>{
 const p=f.engine.preview(args);assert.equal(p.status,'READY');
 assert.equal(p.consumeQuantity,90);assert.equal(p.leftOvers,10);
 assert.deepEqual(p.outputs,[{typeID:34,quantity:45},{typeID:35,quantity:22}]);
 assert.equal(f.writes(),0);
});
each('native ore quantity consumed and minerals persisted through one atomic item write',f=>{
 const x=f.engine.refine(args);assert.equal(x.status,'COMMITTED');
 const rows=Object.values(f.getDisk());assert.equal(rows.length,3);
 assert.equal(f.getDisk()[700].quantity,10);
 assert.deepEqual(rows.filter(x=>x.customInfo.startsWith('coop-refine:')).map(x=>x.quantity),[45,22]);
 assert.equal(f.writes(),1);assert.equal(f.flushes(),1);
});
each('strict corporation and station ownership cannot be bypassed',f=>{
 assert.equal(f.engine.refine({...args,ownerID:5}).status,'NPC_FACILITY_UNAVAILABLE');
 assert.equal(f.engine.refine({...args,stationID:900}).status,'NPC_FACILITY_UNAVAILABLE');
 assert.equal(f.writes(),0);
});
each('NPC refinery does not bypass corporate reprocessing tax/wallet',f=>{
 f.state.fee=2.3;assert.equal(f.engine.refine(args).status,'NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED');
 assert.equal(f.writes(),0);
});
each('missing native SDE recipe never mints mineral',f=>{
 f.state.invalid=true;assert.equal(f.engine.refine(args).status,'NATIVE_REPROCESSING_RECIPE_UNAVAILABLE');
 assert.equal(f.writes(),0);
});
each('failed cache write remains an ambiguous prepared receipt and no mineral grant',f=>{
 f.state.failWrite=true;const a=f.engine.refine(args);
 assert.equal(a.status,'NATIVE_ITEMS_UNCERTAIN');assert.equal(f.getDb()[700].quantity,100);
 assert.equal(f.engine.refine(args).status,'PENDING_RECONCILIATION');
 assert.equal(f.writes(),1);
});
each('failed SQLite flush not acknowledged; no automatic retry after restart',f=>{
 f.state.failFlush=true;const first=f.engine.refine(args);
 assert.equal(first.status,'NATIVE_ITEMS_UNCERTAIN');f.restore();
 const restarted=createRefinery(f.deps);
 assert.equal(restarted.refine(args).status,'PENDING_RECONCILIATION');
 assert.equal(restarted.reconcile(700,100,{authorize:true}).status,'PENDING_OPERATOR_RECONCILIATION');
 assert.equal(f.writes(),1);
});
each('crash after flushed native write but before committed journal can reconcile only with explicit operator auth',f=>{
 const original=f.items.refineNpcWarehouseOreAtomic;
 f.items.refineNpcWarehouseOreAtomic=plan=>{const x=original(plan);assert.equal(x.success,true);return {success:false,errorMsg:'SIMULATED_CRASH'};};
 assert.equal(f.engine.refine(args).status,'NATIVE_ITEMS_UNCERTAIN');
 const restarted=createRefinery(f.deps);
 assert.equal(restarted.reconcile(700,100).status,'REPAIR_AUTHORIZATION_REQUIRED');
 assert.equal(restarted.reconcile(700,100,{authorize:true}).status,'COMMITTED');
 assert.equal(restarted.reconcile(700,100,{authorize:true}).status,'ALREADY_COMMITTED');
 assert.equal(f.writes(),1);
});
each('native atomic hook rejects replayed output operation ID after first write',f=>{
 const plan=f.engine.preview(args);
 const r=f.items.refineNpcWarehouseOreAtomic(plan);
 assert.equal(r.success,true);
 assert.equal(f.items.refineNpcWarehouseOreAtomic(plan).success,false);
});
each('journal survives process restart and source shape cannot double-credit',f=>{
 assert.equal(f.engine.refine(args).status,'COMMITTED');
 const again=createRefinery(f.deps);
 assert.equal(again.reconcile(700,100,{authorize:true}).status,'ALREADY_COMMITTED');
 assert.equal(again.refine({...args,operationID:'coop-refine:v1:700:100'}).status,'ALREADY_COMMITTED');
 assert.equal(f.writes(),1);
});
each('receipt store refuses broken journal and does not write inventory',f=>{
 fs.writeFileSync(path.join(f.dir,'coop-refine:v1:700:100.json'),'INVALID_JSON');
 assert.equal(f.engine.refine(args).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.writes(),0);
});
each('native item patch is reversible including CRLF and idempotent',()=>{
 const template='function nope() {}\nmodule.exports = {\n  getAllItems,\n};\n';
 for(const input of [template,template.replaceAll('\n','\r\n')]){
  const next=patch(input,TARGET);assert.equal(patch(next,TARGET),next);
  assert.equal(patch(next,TARGET,true),input);
 }
});

test('live adapter does not load native stores or create refinery when flag is disabled',()=>{
 const source=fs.readFileSync(new URL('../integration/coopNpcRefineryRuntime.cjs',import.meta.url),'utf8');
 let loaded=0;
 const lib={exports:{}};
 new Function('module','exports','require','process',source)(lib,lib.exports,id=>{
  loaded++;if(id==='node:path')return path;if(id==='./coopNpcRefinery')return {createRefinery:()=>{throw Error('MUST_NOT_INSTANTIATE')}};throw Error('Unexpected import '+id);
 },{env:{}});
 assert.throws(()=>lib.exports.createLiveRefinery({root:'/tmp/warehouse'}),/NPC_REFINERY_DISABLED/);
 assert.equal(loaded,2);
});

test('live adapter uses actual NPC corporation and station service, never impersonates player',()=>{
 const source=fs.readFileSync(new URL('../integration/coopNpcRefineryRuntime.cjs',import.meta.url),'utf8');
 let received;
 const nativeItems={refineNpcWarehouseOreAtomic:()=>true};
 const deps={
  '../services/inventory/itemStore':nativeItems,
  '../services/reprocessing/reprocessingRuntime':{buildReprocessingQuoteForItem:()=>({})},
  './worldData':{getStationByID:id=>({stationID:id,solarSystemID:30000144})},
  '../services/corporation/corporationState':{
   getCorporationRecord:id=>({corporationID:id,isNPC:true}),isNpcCorporationID:id=>id===1001},
  '../services/_shared/stationStaticData':{
   getStationRecord:(_session,id)=>({stationID:id,solarSystemID:30000144}),
   stationServiceIsEnabledForStationRecord:(_station,service)=>service===8192},
 };
 const mod={exports:{}};
 const load=id=>id==='node:path'?path:id==='./coopNpcRefinery'?{
  createRefinery:v=>{received=v;return {trusted:true}}}:deps[id];
 new Function('module','exports','require','process',source)(mod,mod.exports,load,{
  env:{EVEJS_COOP_NPC_REFINERY:'1',EVEJS_COOP_NPC_REFINERY_DIR:'/tmp/coop-test'}});
 assert.deepEqual(mod.exports.createLiveRefinery({root:'/tmp/coop-test'}),{trusted:true});
 assert.equal(received.isNpcCorporation(1001),true);
 assert.equal(received.isNpcCorporation(555),false);
 assert.equal(received.facilityAvailable({stationID:2001,solarSystemID:30000144},1001),true);
 assert.equal(received.getStation(2001).stationID,2001);
});

each('refinery journal lock prevents simultaneous writers from different executor instances',f=>{
 const id='coop-refine:v1:700:100';
 fs.writeFileSync(path.join(f.dir,id+'.json.lock'),'other-instance');
 assert.equal(f.engine.refine(args).status,'REFINERY_LOCKED_NEEDS_REVIEW');
 assert.equal(f.engine.reconcile(700,100,{authorize:true}).status,'REFINERY_LOCKED_NEEDS_REVIEW');
 assert.equal(f.writes(),0);
 assert.equal(fs.existsSync(path.join(f.dir,id+'.json.lock')),true);
});


each('mismatched original ore stacksize rejects refinery preview without issuing native write',f=>{
 f.mutateItem(700,{stacksize:99});
 assert.equal(f.engine.preview(args).status,'NATIVE_ORE_NOT_AVAILABLE');
 assert.equal(f.engine.refine(args).status,'NATIVE_ORE_NOT_AVAILABLE');
 assert.equal(f.writes(),0);
});
each('original raw ore stack mismatched after quote is rejected by native itemStore atomic hook',f=>{
 const plan=f.engine.preview(args);
 assert.equal(plan.status,'READY');
 f.mutateItem(700,{stacksize:99});
 const before=f.getDb(),result=f.items.refineNpcWarehouseOreAtomic(plan);
 assert.equal(result.success,false);
 assert.equal(result.errorMsg,'REFINERY_SOURCE_STACK_UNVERIFIED');
 assert.deepEqual(f.getDb(),before);
 assert.equal(f.writes(),0);
});
each('corrupt leftover original ore stack cannot authorize committed journal replay',f=>{
 assert.equal(f.engine.refine(args).status,'COMMITTED');
 f.mutateItem(700,{stacksize:9});
 const id='coop-refine:v1:700:100';
 assert.equal(f.engine.refine({...args,operationID:id}).status,'COMMITTED_STATE_INVALID');
 assert.equal(f.engine.reconcile(700,100,{authorize:true}).status,
  'PENDING_OPERATOR_RECONCILIATION');
 assert.equal(f.writes(),1);
});
each('corrupt created native mineral stacksize cannot authorize committed journal replay',f=>{
 assert.equal(f.engine.refine(args).status,'COMMITTED');
 const mineral=Object.values(f.getDb()).find(x=>x.typeID===34);
 assert.ok(mineral);
 f.mutateItem(mineral.itemID,{stacksize:999});
 const id='coop-refine:v1:700:100';
 assert.equal(f.engine.refine({...args,operationID:id}).status,'COMMITTED_STATE_INVALID');
 assert.equal(f.writes(),1);
});
each('builder changing original mineral item identity cannot mint unverified output',f=>{
 // Native itemStore callback has the original raw item and output builder.
 const from=HOOK.slice(HOOK.indexOf('function refineNpcWarehouseOreAtomic('),
  HOOK.indexOf('// COOP_NATIVE_REFINERY_ATOMIC_END'));
 const load=new Function('env',`with(env){ ${from}; return refineNpcWarehouseOreAtomic; }`);
 const original=f.getDb(),data=structuredClone(original);
 let writes=0;
 const env={ensureMigrated(){},readItems:()=>structuredClone(data),writeItems:()=>{writes++;return true},
  normalizeInventoryItem:x=>x,toNumber:(v,d=0)=>Number.isFinite(Number(v))?Number(v):d,
  getItemMetadata:id=>({typeID:id,groupID:18}),ITEM_FLAGS:{HANGAR:4},
  CLIENT_INVENTORY_STACK_LIMIT:2147483647,
  ITEMS_TABLE:'items',repo:{flushTableSync:()=>({success:true})},
  buildInventoryItem:x=>({...x,stacksize:x.typeID===34?0:x.stacksize}),
  nextItemID:(_owner,items)=>Math.max(700,...Object.keys(items).map(Number))+1};
 const result=load(env)(f.engine.preview(args));
 assert.equal(result.success,false);assert.equal(result.errorMsg,'REFINERY_OUTPUT_MISMATCH');
 assert.equal(writes,0);
});


test('refinery runtime module imports the real .cjs sibling in source checkout',()=>{
 const entry=require('../integration/coopNpcRefineryRuntime.cjs');
 assert.equal(typeof entry.createLiveRefinery,'function');
});
test('refinery runtime module imports installed .js sibling in pinned overlay',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop-refinery-overlay-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const code=fs.readFileSync(new URL('../integration/coopNpcRefineryRuntime.cjs',import.meta.url),'utf8');
 fs.writeFileSync(path.join(root,'coopNpcRefineryRuntime.js'),code);
 fs.writeFileSync(path.join(root,'coopNpcRefinery.js'),
  'module.exports={createRefinery:()=>({verified:true})};');
 const deployed=createRequire(path.join(root,'index.cjs'))('./coopNpcRefineryRuntime.js');
 assert.equal(typeof deployed.createLiveRefinery,'function');
});
test('refinery runtime does not swallow missing transitive native dependency',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop-refinery-overlay-broken-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const code=fs.readFileSync(new URL('../integration/coopNpcRefineryRuntime.cjs',import.meta.url),'utf8');
 fs.writeFileSync(path.join(root,'coopNpcRefineryRuntime.js'),code);
 fs.writeFileSync(path.join(root,'coopNpcRefinery.js'),
  "require('./missing-original-refinery-implementation');");
 assert.throws(()=>createRequire(path.join(root,'index.cjs'))('./coopNpcRefineryRuntime.js'),
  /missing-original-refinery-implementation/);
});
