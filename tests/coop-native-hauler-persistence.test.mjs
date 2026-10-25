import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../integration/coopNativeHaulCargo.cjs',import.meta.url),'utf8');
function fixture({enabled=true,failFlush=false}={}){
 const result={exports:{}};
 new Function('module','exports','require','process',source)(result,result.exports,
  id=>{throw Error(`Unexpected test require ${id}`)},
  {env:{EVEJS_COOP_NPC_STATION_DELIVERY:enabled?'1':'0'}});
 let row={cargoID:1009,entityID:91,typeID:34,quantity:13,moduleID:0,transient:true};
 const miner={itemID:91,kind:'ship',nativeCargoItems:[{itemID:1009,volume:0.1}]};
 const hauler={itemID:92,kind:'ship',ownerID:1000035,transient:false,nativeCargoItems:[]};
 const scene={getEntityByID:id=>id===92?hauler:id===91?miner:null};
 const operations=[];
 const store={listNativeCargoForEntity:id=>row.entityID===id?[row]:[],
  upsertNativeCargo:(value,opts)=>{row={...value};operations.push({type:'upsert',options:opts});return {success:true}},
  buildNativeCargoItems:()=>[]};
 const database={setTransientPath:(table,path,enabled)=>operations.push({type:'clearTransient',table,path,enabled}),
  flushTableSync:table=>{operations.push({type:'flush',table});return {success:!failFlush}}};
 const probe={observe:(event)=>operations.push({type:'telemetry',event})};
 return {result:result.exports,scene,miner,store,database,probe,operations,hauler,source:()=>row};
}
test('real cargo ID promoted once from transient miner into persisted native hauler',()=>{
 const f=fixture();const moved=f.result.transferCargo(f.scene,{fleetID:80,systemID:30000144,haulerEntityIDs:[92]},f.miner,f);
 assert.equal(moved,1.3);assert.equal(f.source().cargoID,1009);
 assert.equal(f.source().entityID,92);assert.equal(f.source().transient,false);
 assert.equal(f.source().coopHaulFleetID,80);assert.equal(f.source().coopHaulFromMinerID,91);
 assert.deepEqual(f.operations.filter(x=>x.type==='clearTransient'),[{type:'clearTransient',table:'npcCargo',path:'/cargo/1009',enabled:false}]);
 assert.ok(f.operations.some(x=>x.type==='flush'&&x.table==='npcCargo'));
 assert.equal(f.miner.nativeCargoItems.length,0);
});
test('uncertain native flush never reports successful hauled quantity',()=>{
 const f=fixture({failFlush:true});const moved=f.result.transferCargo(f.scene,{fleetID:80,systemID:30000144,haulerEntityIDs:[92]},f.miner,f);
 assert.equal(moved,0);assert.equal(f.miner.nativeCargoItems.length,1);
 assert.equal(f.source().cargoID,1009);
 assert.ok(f.operations.some(x=>x.event==='living-hauler-cargo-persist-failed'));
});
test('feature OFF preserves old native hauler path',()=>{
 const f=fixture({enabled:false});f.result.transferCargo(f.scene,{fleetID:80,systemID:30000144,haulerEntityIDs:[92]},f.miner,f);
 assert.equal(f.operations.some(x=>x.type==='clearTransient'),false);
 assert.equal(f.operations.some(x=>x.type==='flush'),false);
});