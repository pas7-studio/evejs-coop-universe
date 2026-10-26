import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createWarFleetRegistry}=require('../integration/coopWarFleetRegistry.cjs');
const env={EVEJS_COOP_FACTION_WAR:'1',EVEJS_COOP_FACTION_WAR_FLEETS:'1',
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1'};
const native={verifyNativeShip:()=>true,verifyCampaign:()=>true,verifyRelease:()=>true};
const base=(entityID=501,pilotID='coop-pilot-001',extra={})=>({
 type:'ASSIGN',eventID:'assign:'+entityID,entityID,pilotID,systemID:101,
 corporationID:31,factionID:11,warID:'w1',campaignID:'c1',
 fleetID:'fleet-a',proofID:'native-verified',...extra});
function fixture(proofs=native){
 const rows=new Map();
 const db={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,['corporationRuntime']);
  const staged=new Map(rows);
  const tx={get:(table,key)=>staged.get(table+':'+key),
   put:(table,key,row)=>staged.set(table+':'+key,row)};
  const result=fn(tx);rows.clear();for(const [key,v] of staged)rows.set(key,v);
  return result;
 }}};
 const make=()=>createWarFleetRegistry({gameStore:db,...proofs,clock:()=>1000,env});
 return {rows,make};
}
test('atomic registration, exclusive native ship and pilot IDs survive registry reopening',()=>{
 const f=fixture(),s=f.make();
 assert.equal(s.execute(base()).status,'APPLIED');
 assert.equal(f.make().claim({entityID:501,pilotID:'coop-pilot-001',systemID:101}),'ASSIGNED');
 assert.equal(f.make().execute(base()).status,'DUPLICATE');
 assert.equal(f.make().execute(base(501,'coop-pilot-009',{eventID:'new-command'})).reason,
  'FLEET_IDENTITY_OR_CAP_CONFLICT');
 assert.equal(f.make().execute(base(502,'coop-pilot-001')).reason,'FLEET_IDENTITY_OR_CAP_CONFLICT');
 assert.equal(f.make().claim({entityID:501,pilotID:'coop-pilot-002',systemID:101}),'UNKNOWN');
 assert.equal(f.make().claim({entityID:502,pilotID:'coop-pilot-002',systemID:101}),'UNASSIGNED');
});
test('native proof denial and transaction throw never acknowledge membership',()=>{
 const f=fixture({...native,verifyNativeShip:()=>false}),s=f.make();
 assert.equal(s.execute(base()).reason,'NATIVE_SHIP_OR_CAMPAIGN_UNVERIFIED');
 assert.deepEqual(s.snapshot().ships,{});
 const bad=createWarFleetRegistry({gameStore:{coopAtomicNativeRows:{transact:()=>{throw Error('sqlite busy')}}},
  ...native,env});
 assert.throws(()=>bad.execute(base()),/sqlite busy/);
 assert.equal(bad.claim(base()),'UNKNOWN');
});
test('release requires exact pilot/fleet ID and verified idle/physical loss',()=>{
 const f=fixture({...native,verifyRelease:()=>false}),s=f.make();
 assert.equal(s.execute(base()).status,'APPLIED');
 const leave={type:'RELEASE',eventID:'rel:1',entityID:501,
  pilotID:'coop-pilot-001',fleetID:'fleet-a',proofID:'idle-proof'};
 assert.equal(s.execute(leave).reason,'NATIVE_RELEASE_UNVERIFIED');
 const ok=createWarFleetRegistry({gameStore:{
  coopAtomicNativeRows:{transact:(tables,fn)=>{
   const v=f.rows;const tx={get:(t,k)=>v.get(t+':'+k),put:(t,k,s)=>v.set(t+':'+k,s)};
   return fn(tx);
  }}},...native,env});
 assert.equal(ok.execute({...leave,pilotID:'coop-pilot-999'}).reason,'SHIP_NOT_IN_FLEET');
 assert.equal(ok.execute(leave).status,'APPLIED');
 assert.equal(s.claim({entityID:501,pilotID:'coop-pilot-001',systemID:101}),'UNASSIGNED');
 assert.equal(s.execute(leave).status,'DUPLICATE');
});
test('feature OFF performs no SQLite calls and unknown/corrupt state blocks',()=>{
 const f=fixture();const off={...env,EVEJS_COOP_FACTION_WAR_FLEETS:'0'};
 const s=createWarFleetRegistry({gameStore:{coopAtomicNativeRows:{transact:()=>{throw Error('called')}}},
  ...native,env:off});
 assert.equal(s.execute(base()).status,'DISABLED');
 assert.equal(s.claim(base()),'DISABLED');
 const db=f.make();assert.equal(db.execute(base()).status,'APPLIED');
 const [[key]]=[...f.rows];f.rows.set(key,{version:2,ships:{},processed:{},history:[]});
 assert.throws(()=>db.snapshot(),/FW_FLEET_REGISTRY_INVALID/);
 assert.equal(db.claim(base()),'UNKNOWN');
});

test('hot warship claim uses cached GameStore reads, not SQLite writer per NPC',()=>{
 let count=0,reads=0;
 const row={version:1,ships:{'501':{entityID:501,systemID:101,
  pilotID:'coop-pilot-001',corporationID:31,factionID:11,
  fleetID:'fleet-a',warID:'w1',campaignID:'c1'}},processed:{},history:[]};
 const nativeStore={read:()=>{reads++;return {success:true,data:row}},
  coopAtomicNativeRows:{transact:()=>{count++;throw Error('no SQLite for read')}}};
 const fleet=createWarFleetRegistry({gameStore:nativeStore,...native,env});
 for(let i=0;i<25;i++)assert.equal(fleet.claim({entityID:501,systemID:101,
  pilotID:'coop-pilot-001'}),'ASSIGNED');
 assert.equal(count,0);assert.equal(reads,25);
 row.version=999;
 assert.equal(fleet.claim({entityID:501,systemID:101,pilotID:'coop-pilot-001'}),'UNKNOWN');
});
