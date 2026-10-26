import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcProbeSceneTransition}=require("../integration/coopNativeNpcProbeSceneTransition.cjs");
function fixture(){
 const systemID=30000142,cargoID=980200000001,ownerID=901;
 const row={cargoID,entityID:980000000111,ownerID,quantity:0,singleton:false,typeID:30013,
  deployedProbe:{status:"IN_SPACE",probeID:cargoID,entityID:980000000111,
   ownerID,typeID:30013,systemID,rangeStep:4,scanRange:1e10,
   position:{x:1e10,y:0,z:3e10}}};
 const old={itemID:cargoID,kind:"probe",ownerID,systemID,typeID:30013,
  nativeNpcProbe:true,nativeNpcCargoID:cargoID,
  position:{x:1000,y:0,z:2000}};
 const objects=new Map([[cargoID,old]]);
 const notices=[],receivers=[{id:"player-1"},{id:"player-2"}];
 let failRemove=false,failSpawn=false;
 const scene={systemID,getEntityByID:id=>objects.get(id),
  spawnDynamicEntity:(entity,opts)=>{
   assert.equal(opts.broadcast,true);
   if(failSpawn)return {success:false};
   if(objects.has(entity.itemID))return {success:false};
   objects.set(entity.itemID,entity);
   for(const peer of receivers)notices.push({peer:peer.id,type:"ADD",id:entity.itemID,
    x:entity.position.x});
   return {success:true};
  }};
 const api=createNativeNpcProbeSceneTransition({
  removeDynamicEntity:(sys,id,opts)=>{
   assert.equal(sys,systemID);assert.equal(opts.allowSessionOwned,false);
   assert.equal(opts.broadcast,true);
   if(failRemove)return {success:false};
   objects.delete(id);
   for(const peer of receivers)notices.push({peer:peer.id,type:"REMOVE",id});
   return {success:true};
  },
  buildProbeSceneEntity:(probe,{ownerID:owner,systemID:sys})=>({
   itemID:probe.probeID,kind:"probe",ownerID:owner,systemID:sys,
   typeID:probe.typeID,position:{x:probe.pos[0],y:probe.pos[1],z:probe.pos[2]}
  })
 });
 return {row,objects,notices,api,
  failRemove:()=>{failRemove=true},failSpawn:()=>{failSpawn=true},
  restoreSpawn:()=>{failSpawn=false}};
}
test("same original cargoID is removed and re-added to both native clients",()=>{
 const f=fixture(),r=f.api.move({scene:{systemID:30000142,
  getEntityByID:id=>f.objects.get(id),
  spawnDynamicEntity:(e,o)=>{ // exercise same two-client native broadcast model
   assert.equal(o.broadcast,true);f.objects.set(e.itemID,e);
   for(const peer of ["player-1","player-2"])f.notices.push({peer,type:"ADD",id:e.itemID});
   return {success:true};
  }},row:f.row});
 assert.equal(r.success,true);
 assert.equal(r.status,"NATIVE_SCENE_BROADCAST_REPLACED");
 assert.equal(f.objects.get(f.row.cargoID).itemID,f.row.cargoID);
 assert.equal(f.objects.get(f.row.cargoID).position.x,1e10);
 assert.equal(f.notices.filter(n=>n.type==="REMOVE").length,2);
 assert.equal(f.notices.filter(n=>n.type==="ADD").length,2);
});
test("already projected original probe is an exact idempotent no-op",()=>{
 const f=fixture();
 f.objects.get(f.row.cargoID).position={...f.row.deployedProbe.position};
 const r=f.api.move({scene:{systemID:30000142,getEntityByID:id=>f.objects.get(id),
  spawnDynamicEntity:()=>{throw Error("SHOULD_NOT_SPAWN")}},row:f.row});
 assert.equal(r.status,"ALREADY_PROJECTED");
 assert.equal(f.notices.length,0);
});
test("foreign item with collision ID is never removed",()=>{
 const f=fixture();
 f.objects.get(f.row.cargoID).nativeNpcProbe=false;
 const r=f.api.move({scene:{systemID:30000142,getEntityByID:id=>f.objects.get(id),
  spawnDynamicEntity:()=>{throw Error("SHOULD_NOT_SPAWN")}},row:f.row});
 assert.equal(r.success,false);assert.equal(r.reason,"NPC_PROBE_SCENE_FOREIGN_ID_COLLISION");
 assert.equal(f.notices.length,0);
});
test("failed native removal cannot spawn a phantom or mutate original inventory",()=>{
 const f=fixture();f.failRemove();
 const scene={systemID:30000142,getEntityByID:id=>f.objects.get(id),
  spawnDynamicEntity:()=>{throw Error("SHOULD_NOT_SPAWN")}};
 const r=f.api.move({scene,row:f.row});
 assert.equal(r.success,false);
 assert.equal(f.notices.length,0);
 assert.equal(f.row.quantity,0);
});
test("failed spawn leaves cargo source intact and same original itemID recoverable",()=>{
 const f=fixture(),events=[];
 const scene={systemID:30000142,getEntityByID:id=>f.objects.get(id),
  spawnDynamicEntity:(entity,{broadcast})=>{
   assert.equal(broadcast,true);
   if(events.length===0){events.push("FAILED_ONCE");return{success:false};}
   f.objects.set(entity.itemID,entity);return{success:true};
  }};
 const one=f.api.move({scene,row:f.row});
 assert.equal(one.success,false);assert.equal(f.objects.has(f.row.cargoID),false);
 assert.equal(f.row.quantity,0);
 const two=f.api.move({scene,row:f.row});
 assert.equal(two.success,true);assert.equal(f.objects.get(f.row.cargoID).itemID,f.row.cargoID);
});
test("missing or undurable original cargo probe ticket cannot create any scene item",()=>{
 const f=fixture(),before=f.objects.size;
 f.row.deployedProbe.probeID+=100;
 const scene={systemID:30000142,getEntityByID:id=>f.objects.get(id),
  spawnDynamicEntity:()=>{throw Error("MINTED")}};
 assert.equal(f.api.move({scene,row:f.row}).success,false);
 assert.equal(f.objects.size,before);
});
