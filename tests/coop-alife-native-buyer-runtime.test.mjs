import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRuntimeAlifeBuyer}=require("../integration/coopAlifeNativeBuyerRuntime.cjs");
const SYS=30000142,STATION=60000001,OWNER=1000010,ENTITY=100,AT=1000000;
const env={EVEJS_COOP_ALIFE:"1",EVEJS_COOP_ALIFE_ECONOMY:"1",
 EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY:"1",EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",
 EVEJS_COOP_ALIFE_NATIVE_BUYER:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1",EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER:"1"};
const pilot=()=>({pilotID:"coop-pilot-100",entityID:ENTITY,
 systemID:SYS,ownerID:OWNER,role:"trader",stationID:STATION,
 nativeVerified:true,atStation:true,playerControlled:false,inWarp:false,
 underAttack:false,activeNativeOrder:false,
 economy:{authoritativeNative:true,ownerID:OWNER,stationID:STATION,systemID:SYS,
  observedAt:AT,materialNeeds:[{typeID:34,required:80,available:10,shortage:70}]}});
const snapshot=()=>({authoritativeNative:true,systemID:SYS,observedAt:AT,
 stations:[{stationID:STATION,nativeVerified:true}],pilots:[pilot()]});
const intent=()=>({pilotID:"coop-pilot-100",entityID:ENTITY,
 systemID:SYS,stationID:STATION,stage:"BUY_SUPPLIES",
 resource:"station:"+STATION+":supplies",provenance:"NATIVE_READ_ONLY",
 nativeMutation:false,intentID:SYS+":"+AT+":"+ENTITY+":BUY_SUPPLIES"});
const decision=()=>({status:"OBSERVED",systemID:SYS,observedAt:AT,intents:[intent()]});
function fixture(){
 let physical=true,owner=OWNER,warp=false,danger=false,sessionOccupied=false,
  distant=false,calls=0,release=null,resolver=null;
 const scene={
  getEntityByID:id=>physical?({kind:"ship",nativeNpc:true,itemID:id,
   position:{x:distant?50000:500,y:0,z:0},radius:50,
   pendingWarp:warp,mode:warp?"WARP":"IDLE"}):null,
  staticEntities:[{kind:"station",itemID:STATION,
   position:{x:0,y:0,z:0},radius:500}],
  sessions:{values:()=>sessionOccupied?[{_space:{shipID:ENTITY}}]:[]}
 };
 const deps={
  sceneForSystem:()=>scene,
  npcStore:{getNativeEntity:id=>({entityID:id,systemID:SYS,ownerID:owner})},
  controllers:{getControllerByEntityID:id=>({entityID:id,systemID:SYS,
   currentTargetID:danger?200:0,manualOrder:null})},
  worldData:{getStationByID:()=>({stationID:STATION,solarSystemID:SYS})}
 };
 const createBinding=opts=>{
  resolver=opts;
  return {mode:"ALIFE_NATIVE_RUST_GAMESTORE_BUYER",
   tick:async args=>{
    calls++;
    const actor=await opts.resolveActor(args.actorID);
    const materials=opts.readNeeds(OWNER,STATION,args.typeID);
    if(!actor||!actor.nativeVerified||!materials)
     return {status:"BLOCKED",reason:"NATIVE_RECHECK_FAILED"};
    if(release)await release;
    return {status:"NPC_PLAYER_PURCHASE_SETTLED",fillID:930000000000001,itemID:1990000200};
   }};
 };
 const r=createRuntimeAlifeBuyer({file:"/tmp/coop049-buyer-journal.json",
  env:{...env},deps,createBinding,clock:()=>AT});
 const registry={snapshot:()=>({links:{"coop-pilot-100":{
  pilotID:"coop-pilot-100",entityID:ENTITY,systemID:SYS}}})};
 const world={snapshot:()=>({pilots:[{id:"coop-pilot-100",role:"trader"}]})};
 const tick=(snap=snapshot(),dec=decision())=>r.tick({snapshot:snap,
  decision:dec,registry,world});
 return {tick,r,deps,registry,world,get calls(){return calls},
  get binding(){return resolver},setOwner:v=>owner=v,
  setDistant:v=>distant=v,setWarp:v=>warp=v,
  setDanger:v=>danger=v,setOccupied:v=>sessionOccupied=v,
  setPhysical:v=>physical=v,
  stall:()=>{let unlock;release=new Promise(done=>{unlock=done});return()=>{unlock();release=null}}};
}
test("native actor and SDE material are independently rechecked before paid writer",async()=>{
 const f=fixture(),r=await f.tick();
 assert.equal(r.status,"ALIFE_BUY_DISPATCHED");
 assert.equal(r.nativeMutation,true);
 assert.equal(f.calls,1);
 assert.equal(f.binding.readNeeds(OWNER,STATION,34),null);
});
test("foreign NPC owner cannot spend claimed corporation wallet",async()=>{
 const f=fixture();f.setOwner(OWNER+1);
 const r=await f.tick();
 assert.equal(r.nativeMutation,false);
 assert.equal(r.purchases[0].reason,"NATIVE_RECHECK_FAILED");
});
test("NPC physically outside docking range cannot purchase",async()=>{
 const f=fixture();f.setDistant(true);
 const r=await f.tick();
 assert.equal(r.nativeMutation,false);
});
test("NPC in native warp cannot purchase even if old snapshot claimed stationary",async()=>{
 const f=fixture();f.setWarp(true);
 const r=await f.tick();
 assert.equal(r.nativeMutation,false);
});
test("NPC under live combat attack cannot make economic claim",async()=>{
 const f=fixture();f.setDanger(true);
 const r=await f.tick();
 assert.equal(r.nativeMutation,false);
});
test("player-controlled physical ship never impersonates NPC",async()=>{
 const f=fixture();f.setOccupied(true);
 const r=await f.tick();
 assert.equal(r.nativeMutation,false);
});
test("missing physical hull blocks native corporate wallet access",async()=>{
 const f=fixture();f.setPhysical(false);
 const r=await f.tick();
 assert.equal(r.nativeMutation,false);
});
test("one existing master A-Life tick fences overlapping buyer dispatch",async()=>{
 const f=fixture();const release=f.stall();
 const first=f.tick();
 for(let i=0;i<8&&f.calls===0;i++)await Promise.resolve();
 assert.equal(f.calls,1);
 const second=await f.tick();
 assert.equal(second.reason,"ALIFE_NATIVE_BUYER_TICK_BUSY");
 release();assert.equal((await first).nativeMutation,true);
});
test("buyer remains dormant when dedicated opt-in flag is absent",async()=>{
 const f=fixture();
 const absent=createRuntimeAlifeBuyer({file:"/tmp/coop049-disabled.json",
  env:{...env,EVEJS_COOP_ALIFE_NATIVE_BUYER:"0"}});
 assert.equal((await absent.tick()).status,"DISABLED");
 assert.equal(f.calls,0);
});
