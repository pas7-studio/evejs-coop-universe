import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const {createPlanner}=require('../integration/coopNpcManufacturingPlanner.cjs');
const {createJournal}=require('../integration/coopNpcManufacturingJournal.cjs');
const OWNER=1000010,STATION=60000001,AMMO=215,BP=1234;
function fixture({stock=0,minerals=100,blueprint=true,busy=false,corp=true,facility=true,jobs=[],category=8,material=20}={}){
 const items=[{itemID:56,ownerID:OWNER,locationID:STATION,flagID:4,typeID:35,categoryID:4,quantity:minerals},
  {itemID:72,ownerID:OWNER,locationID:STATION,flagID:4,typeID:AMMO,categoryID:8,quantity:stock}];
 if(blueprint)items.push({itemID:91,ownerID:OWNER,locationID:STATION,flagID:4,typeID:BP,categoryID:9,singleton:1,quantity:1});
 return createPlanner({getCorporation:id=>corp?{corporationID:id}:null,isNpcCorporation:()=>corp,
  getStation:id=>({stationID:id,solarSystemID:30000144}),
  getFacility:id=>facility?{facilityID:id,solarSystemID:30000144,online:true,activities:{1:[]}}:null,
  getBlueprintDefinition:id=>id===AMMO?{blueprintTypeID:BP,productTypeID:AMMO,activities:{manufacturing:{}}}:null,
  getIndustryActivity:()=>({products:[{typeID:AMMO,quantity:100}],materials:[{typeID:35,quantity:material}]}),
  buildMaterials:()=>[{typeID:35,quantity:material}],getBlueprintStates:()=>({records:{91:{typeID:BP,original:true,jobID:busy?5:null,materialEfficiency:0}}}),
  listOwnerItems:()=>items,listJobs:()=>jobs,getType:()=>({typeID:AMMO,categoryID:category})});
}
const args=overrides=>({ownerID:OWNER,stationID:STATION,productTypeIDs:[AMMO],targetStock:{[AMMO]:500},marketStock:{[AMMO]:0},...overrides});
test('real native blueprint + available minerals gives one starter-ammo proposal',()=>{
 const p=fixture().plan(args());assert.equal(p.status,'PLAN_READY');assert.equal(p.jobs.length,1);
 assert.deepEqual(p.jobs[0].materials,[{typeID:35,quantity:20}]);assert.equal(p.jobs[0].blueprintItemID,91);
 assert.equal(p.remainingMaterials[35],80);
});
test('proposal is read-only and does not use stock as sellable products',()=>{
 const p=fixture({stock:480}).plan(args());assert.equal(p.jobs.length,1);assert.equal(p.jobs[0].shortage,20);
 assert.equal(p.jobs[0].outputQuantity,100);
});
test('missing minerals yields no jobs, never free goods',()=>{
 const p=fixture({minerals:19}).plan(args());assert.equal(p.status,'NO_ELIGIBLE_JOB');assert.equal(p.blocked[0].reason,'NEEDS_MINERALS');
});
test('missing blueprint blocks manufacturing',()=>{
 const p=fixture({blueprint:false}).plan(args());assert.equal(p.blocked[0].reason,'REAL_ORIGINAL_BLUEPRINT_REQUIRED');
});
test('already installed blueprint blocks',()=>{
 const p=fixture({busy:true}).plan(args());assert.equal(p.blocked[0].reason,'REAL_ORIGINAL_BLUEPRINT_REQUIRED');
});
test('unverified owner blocks',()=>assert.equal(fixture({corp:false}).plan(args()).status,'NPC_CORPORATION_UNVERIFIED'));
test('offline facility blocks',()=>assert.equal(fixture({facility:false}).plan(args()).status,'NATIVE_FACTORY_UNAVAILABLE'));
test('only native ammo category is supported',()=>assert.equal(fixture({category:6}).plan(args()).blocked[0].reason,'NOT_AMMUNITION'));
test('finished stock covers target',()=>assert.equal(fixture({stock:510}).plan(args()).blocked[0].reason,'SUFFICIENT_STOCK'));
test('native work-in-progress reduces shortage',()=>{
 const jobs=[{jobID:970000000000001,ownerID:OWNER,stationID:STATION,activityID:1,productTypeID:AMMO,productQuantity:500,status:1}];
 const p=fixture({jobs}).plan(args());assert.equal(p.blocked[0].reason,'SUFFICIENT_STOCK');
});
test('delivered job status 4 is NOT unfilled supply; NPC starts next batch after sale',()=>{
 const jobs=[{jobID:970000000000002,ownerID:OWNER,stationID:STATION,activityID:1,
  productTypeID:AMMO,productQuantity:500,status:4}];
 const p=fixture({jobs,stock:0}).plan(args());
 assert.equal(p.status,'PLAN_READY');
 assert.equal(p.jobs[0].shortage,500);
});
test('native READY status 3 still reserves output until actual delivery',()=>{
 const jobs=[{jobID:970000000000003,ownerID:OWNER,stationID:STATION,activityID:1,
  productTypeID:AMMO,productQuantity:500,status:3}];
 const p=fixture({jobs}).plan(args());
 assert.equal(p.jobs.length,0);
 assert.equal(p.blocked[0].reason,'SUFFICIENT_STOCK');
});
test('cancelled and unrelated-station jobs do not fabricate local inventory',()=>{
 const jobs=[
  {jobID:970000000000004,ownerID:OWNER,stationID:STATION,activityID:1,productTypeID:AMMO,productQuantity:500,status:5},
  {jobID:970000000000005,ownerID:OWNER,stationID:STATION+1,activityID:1,productTypeID:AMMO,productQuantity:500,status:1},
  {jobID:970000000000006,ownerID:OWNER,stationID:STATION,activityID:5,productTypeID:AMMO,productQuantity:500,status:1}
 ];
 const p=fixture({jobs}).plan(args());
 assert.equal(p.status,'PLAN_READY');
 assert.equal(p.jobs[0].shortage,500);
});
test('missing station or manufacturing activity on an active native job prevents speculative job install',()=>{
 const cases=[
  {jobID:970000000000012,ownerID:OWNER,activityID:1,productTypeID:AMMO,productQuantity:100,status:1},
  {jobID:970000000000013,ownerID:OWNER,stationID:STATION,productTypeID:AMMO,productQuantity:100,status:3}
 ];
 for(const job of cases){
  const p=fixture({jobs:[job]}).plan(args());
  assert.equal(p.status,'NATIVE_ACTIVE_JOB_SCOPE_UNVERIFIED');
  assert.equal(p.jobs.length,0);
 }
});
test('ambiguous active job with malformed output cannot trigger an extra paid install',()=>{
 const jobs=[{jobID:970000000000007,ownerID:OWNER,stationID:STATION,activityID:1,
  productTypeID:AMMO,productQuantity:-2,status:1}];
 const p=fixture({jobs}).plan(args());
 assert.equal(p.status,'NO_ELIGIBLE_JOB');
 assert.equal(p.blocked[0].reason,'NATIVE_ACTIVE_JOB_PROOF_INVALID');
});
test('duplicate native active job IDs fail closed, instead of counting same output twice',()=>{
 const row={jobID:970000000000008,ownerID:OWNER,stationID:STATION,activityID:1,
  productTypeID:AMMO,productQuantity:50,status:1};
 const p=fixture({jobs:[row,{...row}]}).plan(args());
 assert.equal(p.status,'NO_ELIGIBLE_JOB');
 assert.equal(p.blocked[0].reason,'NATIVE_ACTIVE_JOB_PROOF_INVALID');
});
test('reserved minerals cannot be double consumed',()=>{
 const p=fixture().plan(args({reservedMaterials:{35:90}}));assert.equal(p.blocked[0].reason,'NEEDS_MINERALS');
});
test('invalid external material reservation blocks entirely',()=>{
 assert.equal(fixture().plan(args({reservedMaterials:{35:101}})).status,'RESERVATION_UNVERIFIED');
});
test('planner allows no more than two jobs per station',()=>assert.equal(fixture().plan(args({maxJobs:3})).status,'INVALID_CONTEXT'));
test('native materials cannot be allocated twice across two ammo blueprints',()=>{
 const fp=fixture({minerals:100});
 // Two distinct real blueprint instances share the same mineral pool.
 const bpItems=[{itemID:91,ownerID:OWNER,locationID:STATION,flagID:4,typeID:1234,categoryID:9,singleton:1},
  {itemID:92,ownerID:OWNER,locationID:STATION,flagID:4,typeID:1235,categoryID:9,singleton:1},
  {itemID:71,ownerID:OWNER,locationID:STATION,flagID:4,typeID:35,categoryID:4,quantity:100}];
 const maker=createPlanner({getCorporation:()=>({corporationID:OWNER}),isNpcCorporation:()=>true,
  getStation:()=>({stationID:STATION,solarSystemID:30000144}),
  getFacility:()=>({facilityID:STATION,solarSystemID:30000144,online:true,activities:{1:[]}}),
  getBlueprintDefinition:t=>({productTypeID:t,blueprintTypeID:t===215?1234:1235}),
  getIndustryActivity:def=>({products:[{typeID:def.productTypeID,quantity:100}]}),
  buildMaterials:()=>[{typeID:35,quantity:60}],
  getBlueprintStates:()=>({records:{91:{typeID:1234,original:true,jobID:null},92:{typeID:1235,original:true,jobID:null}}}),
  listOwnerItems:()=>bpItems,listJobs:()=>[],getType:()=>({categoryID:8})});
 const p=maker.plan(args({productTypeIDs:[215,216],targetStock:{215:100,216:100},marketStock:{215:0,216:0}}));
 assert.equal(p.jobs.length,1);assert.equal(p.jobs[0].productTypeID,215);
 assert.deepEqual(p.blocked,[{typeID:216,reason:'NEEDS_MINERALS'}]);
});
test('native production adapter uses actual EveJS server/src/space-relative paths',()=>{
 const source=fs.readFileSync(path.join(import.meta.dirname,'../integration/coopNpcManufacturingNative.cjs'),'utf8');
 for(const required of ["require('./worldData')","require('../services/industry/industryStaticData')",
   "require('../services/industry/industryParityHelpers')","require('../services/inventory/itemStore')",
   "require('../gameStore')"])assert.ok(source.includes(required),required);
 assert.ok(!source.includes('installIndustryJob('),'no unsafe forged-session native call');
});
function journalFixture(atomic=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-industry-')),
  file=path.join(dir,'industry.json');let job=null,delivered=false,called=0;
 const native={supportsAtomicInstall:atomic,supportsAtomicDelivery:atomic,
  revalidate:()=>true,installOnce:(plan,id)=>{called++;job={jobID:17001,ownerID:OWNER,blueprintID:91,facilityID:STATION,productTypeID:AMMO,status:1};return {jobID:17001}},
  getJobByOperation:()=>job,deliverOnce:()=>{called++;delivered=true},
  verifyDelivered:()=>({delivered,items:[{itemID:8001,typeID:AMMO,quantity:100,ownerID:OWNER,locationID:STATION}]})};
 const make=(enabled=true)=>createJournal({file,planner:fixture(),native,enabled});
 return {file,dir,make,native,getCalls:()=>called,setJob:(v)=>{job=v},setDelivered:v=>{delivered=v},clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('journal disabled: no write and no stock changes',()=>{
 const f=journalFixture();try{const a=f.make(false);assert.equal(a.prepare(args()).status,'NPC_INDUSTRY_DISABLED');assert.equal(fs.existsSync(f.file),false)}finally{f.clean()}
});
test('preparation writes durable receipt but cannot create native job by itself',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());assert.equal(p.status,'PREPARED');assert.ok(p.operationID);assert.equal(a.inspect(p.operationID).status,'PREPARED');assert.equal(f.getCalls(),0);
 }finally{f.clean()}
});
test('no atomic native install capability never debits materials or wallet',()=>{
 const f=journalFixture(false);try{const a=f.make(),p=a.prepare(args());assert.equal(a.install(p.operationID).status,'ATOMIC_NATIVE_INSTALL_UNAVAILABLE');assert.equal(f.getCalls(),0);assert.equal(a.inspect(p.operationID).status,'PREPARED')}finally{f.clean()}
});
test('atomic install produces one verified native job, replay cannot reinstall',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());assert.equal(a.install(p.operationID).status,'INSTALLED');assert.equal(a.install(p.operationID).status,'INSTALLED');assert.equal(f.getCalls(),1);}finally{f.clean()}
});
test('existing active operation reserves a blueprint across restart',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());assert.equal(f.make().prepare(args()).status,'BLUEPRINT_JOB_ALREADY_RESERVED');assert.equal(a.inspect(p.operationID).status,'PREPARED')}finally{f.clean()}
});
test('manual file-lock contention fails closed, never removes stale lock',()=>{
 const f=journalFixture();try{fs.writeFileSync(f.file+'.lock','taken');assert.equal(f.make().prepare(args()).status,'INDUSTRY_LOCKED_NEEDS_REVIEW');assert.equal(fs.readFileSync(f.file+'.lock','utf8'),'taken')}finally{f.clean()}
});
test('cannot manufacture ammo before native job has READY status',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());a.install(p.operationID);assert.equal(a.deliver(p.operationID).status,'JOB_NOT_READY');assert.equal(f.getCalls(),1);}finally{f.clean()}
});
test('native-ready job delivers once with verified native output IDs',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());a.install(p.operationID);f.native.getJobByOperation=()=>({jobID:17001,ownerID:OWNER,blueprintID:91,status:3});
  assert.equal(a.deliver(p.operationID).status,'DELIVERED');assert.equal(f.make().deliver(p.operationID).status,'DELIVERED');assert.equal(f.getCalls(),2);
 }finally{f.clean()}
});
test('uncertain install is never silently replayed',()=>{
 const f=journalFixture();try{f.native.installOnce=()=>{throw Error('simulated process death')};const a=f.make(),p=a.prepare(args());assert.equal(a.install(p.operationID).status,'INSTALL_OUTCOME_UNKNOWN');assert.equal(f.make().install(p.operationID).status,'INSTALL_OUTCOME_UNKNOWN');assert.equal(a.audit().status,'NEEDS_OPERATOR_RECONCILIATION')}finally{f.clean()}
});
test('uncertain delivery is never silently replayed',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());a.install(p.operationID);
  f.native.getJobByOperation=()=>({jobID:17001,ownerID:OWNER,blueprintID:91,status:3});f.native.deliverOnce=()=>{throw Error('disk failed')};
  assert.equal(a.deliver(p.operationID).status,'DELIVERY_OUTCOME_UNKNOWN');assert.equal(f.make().deliver(p.operationID).status,'DELIVERY_OUTCOME_UNKNOWN');
 }finally{f.clean()}
});
test('stale job identity prevents any output grant',()=>{
 const f=journalFixture();try{const a=f.make(),p=a.prepare(args());a.install(p.operationID);f.native.getJobByOperation=()=>({jobID:17001,ownerID:42,blueprintID:91,status:3});
  assert.equal(a.deliver(p.operationID).status,'JOB_IDENTITY_MISMATCH');assert.equal(f.getCalls(),1);
 }finally{f.clean()}
});
test('mismatched native output quantity or owner never confirms delivery',()=>{
 const f=journalFixture();try{
  const a=f.make(),p=a.prepare(args());a.install(p.operationID);
  f.native.getJobByOperation=()=>({jobID:17001,ownerID:OWNER,blueprintID:91,status:3});
  f.native.verifyDelivered=()=>({delivered:true,items:[{itemID:8001,typeID:AMMO,quantity:999,ownerID:OWNER,locationID:STATION}]});
  assert.equal(a.deliver(p.operationID).status,'DELIVERY_OUTCOME_UNKNOWN');
  assert.equal(f.make().deliver(p.operationID).status,'DELIVERY_OUTCOME_UNKNOWN');
 }finally{f.clean()}
});
test('job identity mismatch after install never advances PREPARED into success',()=>{
 const f=journalFixture();try{
  f.native.getJobByOperation=()=>({jobID:17001,ownerID:OWNER,blueprintID:9999,facilityID:STATION,productTypeID:AMMO,status:1});
  const a=f.make(),p=a.prepare(args());
  assert.equal(a.install(p.operationID).status,'INSTALL_OUTCOME_UNKNOWN');
  assert.equal(a.inspect(p.operationID).status,'INSTALL_OUTCOME_UNKNOWN');
 }finally{f.clean()}
});