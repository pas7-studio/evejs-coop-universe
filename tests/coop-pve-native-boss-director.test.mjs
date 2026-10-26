import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeBossDirector,explicitBoss,phaseFor}=require("../integration/coopPveNativeBossDirector.cjs");
const systemID=30000144;
function fixture(opts={}){
 let now=1000000, hp=opts.hp??.9, alive=true;
 const beacon={itemID:7001,kind:"universeAnomalySite",dungeonSiteID:7001,
  dungeonSiteInstanceID:6001,position:{x:0,y:0,z:0}};
 const boss={itemID:101,typeID:30001,kind:"ship",systemID,
  nativeNpc:true,corporationID:5001,position:{x:5000,y:0,z:0}};
 const player={itemID:901,typeID:700,kind:"ship",systemID,nativeNpc:false,
  position:{x:9000,y:0,z:0}};
 const entities=new Map([beacon,boss,player].map(e=>[e.itemID,e]));
 const session={characterID:77,_space:{shipID:901,systemID,initialStateSent:true},
  socket:{destroyed:false}};
 const scene={systemID,sessions:new Map([[77,session]]),
  getEntityByID:id=>entities.get(id)};
 const wave={waveIndex:3,spawnedAtMs:900000,
  label:opts.label??"Overseer",
  lootTags:opts.tags??["overseer"],
  spawnedEntityIDs:[101]};
 const instance={instanceID:6001,solarSystemID:systemID,instanceScope:"shared",
  lifecycleState:"active",siteKind:"anomaly",templateID:"native-authored",
  siteKey:"native:7001",metadata:{siteID:7001},
  spawnState:{encounterStatesByKey:{"wave-boss":wave}}};
 const original={entityID:101,typeID:30001,nativeNpc:true,transient:true,
  systemID,corporationID:5001,createdAtMs:899999};
 const controller={entityID:101,systemID,runtimeKind:"nativeCombat",
  lastAggressorID:901,lastAggressedAtMs:now-1000};
 let wrecks=[],items=[];
 const calls=[];
 const dir=createNativeBossDirector({clock:()=>now,
  getNativeEntity:id=>alive&&id===101?original:null,
  getController:id=>alive&&id===101?controller:null,
  resolveVerifiedPlayer:(s,e)=>e===player?77:null,
  getHealth:()=>({shield:1,armor:hp,structure:hp}),
  issueAttack:(npcID,targetID,options)=>{
   calls.push({npcID,targetID,options});
   return opts.unknown?{}:{success:true};},
  listWrecks:()=>wrecks,listWreckItems:()=>items});
 const tick=(excludedIDs=[])=>dir.tick({systemID,scene,instances:[instance],excludedIDs});
 const kill=({badType=false,duplicate=false,foreignItem=false,noRuntime=false,empty=false}={})=>{
  alive=false;entities.delete(101);
  const nativeWreck={wreckID:9551,sourceEntityID:101,systemID,launcherID:101,
   sourceTypeID:badType?42:30001,transient:true,createdAtMs:now+10};
  wrecks=duplicate?[nativeWreck,{...nativeWreck,wreckID:9552}]:[nativeWreck];
  if(!noRuntime)entities.set(9551,{itemID:9551,nativeNpcWreck:true,kind:"wreck"});
  items=empty?[]:[{wreckItemID:9901,wreckID:foreignItem?99:9551,
   locationID:9551,typeID:91001,quantity:1}];
 };
 return {tick,kill,dir,calls,scene,wave,boss,player,original,controller,instance,
  setHP:x=>{hp=x},setNow:x=>{now=x},now:()=>now,session,entities};
}
test("only an explicitly authored overseer, officer or boss encounters qualify",()=>{
 assert.equal(explicitBoss({label:"Default wave",lootTags:[]}),false);
 assert.equal(explicitBoss({label:"Overseer waves",lootTags:[]}),true);
 assert.equal(explicitBoss({label:"Wave 3",lootTags:["officer"]}),true);
 assert.equal(explicitBoss({label:"wave",lootTags:["regular"]}),false);
 assert.equal(phaseFor(.9),"GUARD");assert.equal(phaseFor(.60),"PRESSURE");
 assert.equal(phaseFor(.29),"LAST_STAND");
});
test("an original unique native boss records HP-phase evidence but never spawns loot",()=>{
 const f=fixture(),a=f.tick();
 assert.equal(a.bosses,1);assert.equal(a.orders,0);
 assert.equal(a.events[0].phase,"GUARD");
 assert.equal(f.tick().events.length,0);
 assert.equal(f.calls.length,0);
});
test("real HP thresholds trigger one native attack order for valid aggression",()=>{
 const f=fixture();
 f.tick();f.setHP(.62);
 const a=f.tick();
 assert.equal(a.orders,1);
 assert.equal(a.events.find(e=>e.status==="NATIVE_BOSS_HP_PHASE_OBSERVED").phase,"PRESSURE");
 assert.deepEqual(f.calls.map(x=>[x.npcID,x.targetID]),[[101,901]]);
 assert.equal(f.tick().orders,0);
 f.setHP(.28);
 const b=f.tick();assert.equal(b.orders,1);
 assert.equal(b.events.find(e=>e.status==="NATIVE_BOSS_HP_PHASE_OBSERVED").phase,"LAST_STAND");
 assert.equal(f.calls.length,2);
});
test("death observes original native wreck and real source item records only",()=>{
 const f=fixture();f.tick();f.kill();
 const r=f.tick();assert.equal(r.status,"ORIGINAL_BOSS_WRECK_WITNESSED");
 assert.equal(r.wrecksVerified,1);assert.equal(r.itemsVerified,1);
 assert.equal(r.events[0].wreckID,9551);assert.deepEqual(r.events[0].itemIDs,[9901]);
 assert.equal(f.tick().wrecksVerified,0);
 assert.equal(f.calls.length,0);
});
test("valid empty wreck is observable but not misreported as loot",()=>{
 const f=fixture();f.tick();f.kill({empty:true});
 const r=f.tick();assert.equal(r.wrecksVerified,1);
 assert.equal(r.itemsVerified,0);
 assert.equal(r.events[0].status,"ORIGINAL_BOSS_WRECK_EMPTY_VERIFIED");
});
test("no fake, duplicate, wrong type, or cross-wreck cargo receipt",()=>{
 for(const o of [{badType:true},{duplicate:true},{foreignItem:true},{noRuntime:true}]){
  const f=fixture();f.tick();f.kill(o);assert.equal(f.tick().wrecksVerified,0);
 }
});
test("a never-observed boss corpse does not grant evidence after restart",()=>{
 const f=fixture();f.kill();assert.equal(f.tick().wrecksVerified,0);
 assert.equal(f.dir.snapshot().length,0);
});
test("another NPC in the same boss-labelled wave is ambiguous and blocked",()=>{
 const f=fixture();f.wave.spawnedEntityIDs.push(102);
 const ship={...f.boss,itemID:102,position:{x:5001,y:0,z:0}};
 f.entities.set(102,ship);
 assert.equal(f.tick().bosses,0);
});
test("wrong scene beacon, source, or old native birth block boss selection",()=>{
 const modifications=[
  f=>{f.original.createdAtMs=700000},
  f=>{f.original.corporationID=5002},
  f=>{f.original.typeID=42},
  f=>{f.boss.nativeNpc=false},
  f=>{f.instance.lifecycleState="completed"},
  f=>{f.instance.metadata.siteID=8888},
  f=>{f.wave.lootTags=[];f.wave.label="Regular wave"}
 ];
 for(const m of modifications){const f=fixture();m(f);assert.equal(f.tick().bosses,0);}
});
test("stale or unauthenticated player and occupied controller block native attack",()=>{
 for(const mutate of [
  f=>{f.controller.lastAggressedAtMs=800000},
  f=>{f.session.socket.destroyed=true},
  f=>{f.scene.sessions.set(2,{...f.session,socket:{destroyed:false}})},
  f=>{f.controller.currentTargetID=99},
  f=>{f.player.position.x=300000}
 ]){
  const f=fixture();mutate(f);f.setHP(.45);assert.equal(f.tick().orders,0);
 }
});
test("unknown native attack result is fenced, never repeated",()=>{
 const f=fixture({unknown:true});f.setHP(.40);
 assert.equal(f.tick().orders,0);
 assert.equal(f.dir.snapshot().length,1);
 assert.equal(f.tick().orders,0);
 assert.equal(f.calls.length,1);
});
test("protected helper or invalid scene blocks native boss orders",()=>{
 const f=fixture();f.setHP(.2);
 assert.equal(f.tick([101]).orders,0);
 assert.equal(f.dir.tick({systemID,scene:{systemID},instances:[f.instance]}).status,"INVALID_NATIVE_CONTEXT");
 assert.equal(f.calls.length,0);
});

test("completed or rotated original anomaly still reconciles a previously witnessed native boss wreck",()=>{
 for(const removeActive of [false,true]){
  const f=fixture();f.tick();f.kill();
  if(removeActive)f.instance.lifecycleState="completed";
  else f.instance.spawnState.encounterStatesByKey={};
  const r=f.tick();assert.equal(r.wrecksVerified,1);
  assert.equal(r.events[0].bossEntityID,101);
 }
});
test("completed source after restart cannot fabricate an unwitnessed boss kill",()=>{
 const f=fixture();f.kill();f.instance.lifecycleState="completed";
 assert.equal(f.tick().wrecksVerified,0);
});
