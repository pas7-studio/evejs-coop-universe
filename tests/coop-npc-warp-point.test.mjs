import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarpPoint,DEFAULT_CANDIDATE_TYPE_IDS}=
 require("../integration/coopNpcWarpPoint.cjs");

// Real shapes only: a point module is category 7 / group 52 and carries a dogma
// effect the native hostile-module runtime already maps to the warpScrambler or
// warpDisruptor family. The slot comes from the native auto-fit authority.
const DISRUPTOR=3242,SCRAMBLER=447,WEB=5268,BOGUS=999999;
const ITEMS=new Map([
 [DISRUPTOR,{typeID:DISRUPTOR,groupID:52,categoryID:7,name:"Warp Disruptor I"}],
 [SCRAMBLER,{typeID:SCRAMBLER,groupID:52,categoryID:7,name:"Warp Scrambler I"}],
 [WEB,{typeID:WEB,groupID:52,categoryID:7,name:"Stasis Webifier I"}],
]);
const EFFECTS=new Map([
 [DISRUPTOR,["warpDisrupt","medPower"]],
 [SCRAMBLER,["warpScrambleBlockMWDWithNPCEffect","medPower"]],
 [WEB,["remoteWebifierFalloff","medPower"]],
]);
function fixture(){
 const written=[];
 const modules=new Map();
 let nextModuleID=980100000001;
 const scrambled=new Set();
 const pirate={itemID:501,kind:"ship",nativeNpc:true,typeID:11917,
  corporationID:1000135,systemID:30000145,position:{x:0,y:0,z:0},fittedItems:[
   {itemID:980100056948,typeID:13884,flagID:27,categoryID:7},
  ]};
 const prey={itemID:201,kind:"ship",nativeNpc:true,position:{x:8800,y:0,z:0}};
 const ships=new Map([[501,pirate],[201,prey]]);
 const store={
  getNativeEntity:id=>id===501?{entityID:501,typeID:11917,ownerID:1000135,
   corporationID:1000135,transient:false}:null,
  buildNativeFittedItems:id=>{
   const list=(modules.get(Number(id))||[]).map(m=>({...m}));
   return list.length?list:[{itemID:980100056948,typeID:13884,flagID:27,categoryID:7}];
  },
  buildNativeSlimModuleTuples:id=>(modules.get(Number(id))||[]).map(m=>[m.itemID,m.typeID]),
  allocateModuleID:()=>({success:true,data:nextModuleID++}),
  upsertNativeModule:(record,options)=>{
   written.push({...record,transient:options&&options.transient===true});
   const list=modules.get(Number(record.entityID))||[];
   list.push(record);modules.set(Number(record.entityID),list);
   return {success:true,data:record.moduleID};
  },
 };
 const scene={systemID:30000145,getEntityByID:id=>ships.get(Number(id))||null,
  broadcastSlimItemChanges:()=>{},
  activateGenericModule:(session,moduleItem,effectName,options)=>{
   if(!options||Number(options.targetID)!==201)return {success:false,errorMsg:"TARGET_REQUIRED"};
   scrambled.add(Number(options.targetID));
   return {success:true,data:{targetEntity:prey}};
  }};
 const point=createWarpPoint({
  resolveItemByTypeID:id=>ITEMS.get(Number(id))||null,
  typeHasEffectName:(typeID,name)=>(EFFECTS.get(Number(typeID))||[]).includes(name),
  resolveHostileDefinition:effect=>{
   const name=String(effect&&effect.name||"");
   if(name==="warpDisrupt")return {family:"warpDisruptor"};
   if(name==="warpScrambleBlockMWDWithNPCEffect")return {family:"warpScrambler"};
   return null;
  },
  selectAutoFitFlag:(shipItem,fitted,typeID)=>{
   const taken=new Set((fitted||[]).map(x=>Number(x.flagID)));
   for(let flag=19;flag<=26;flag+=1)if(!taken.has(flag))return flag;
   return null;
  },
  maxRangeOf:typeID=>Number(typeID)===DISRUPTOR?24000:9000,
  normalizeModuleState:state=>state,
  store,
  isScrambled:entity=>scrambled.has(Number(entity&&entity.itemID)),
  observe:()=>{},
  clock:()=>1000000,
 });
 return {point,written,scrambled,pirate,prey,scene,ships,modules};
}

test("the longest real point that validates is chosen, never a web or an unknown type",()=>{
 const f=fixture();
 const decision=f.point.choose({hullTypeID:11917,fittedItems:f.pirate.fittedItems});
 assert.equal(decision.status,"CHOSEN");
 assert.equal(decision.typeID,DISRUPTOR,"the disruptor reaches further than a scrambler");
 assert.equal(decision.family,"warpDisruptor");
 assert.equal(decision.flagID,19,"the native auto-fit puts it in the first free mid slot");
 assert.equal(decision.maxRangeMeters,24000);
 for(const typeID of [WEB,BOGUS])assert.equal(f.point.verify(typeID).ok,false,String(typeID));
});

test("a hull that already carries a verified point keeps exactly that module",()=>{
 const f=fixture();
 f.pirate.fittedItems.push({itemID:980100099999,typeID:SCRAMBLER,flagID:19,categoryID:7});
 const decision=f.point.choose({hullTypeID:11917,fittedItems:f.pirate.fittedItems});
 assert.equal(decision.status,"PRESENT");
 assert.equal(decision.typeID,SCRAMBLER);
 assert.equal(decision.moduleID,980100099999);
});

test("a hull with no free slot is refused, never forced",()=>{
 const f=fixture();
 const full=[];
 for(let flag=19;flag<=26;flag+=1)full.push({itemID:flag,typeID:13884,flagID:flag,categoryID:7});
 const decision=f.point.choose({hullTypeID:11917,fittedItems:full});
 assert.equal(decision.status,"REFUSED");
 assert.equal(decision.reason,"NO_VERIFIED_POINT");
 for(const typeID of [DISRUPTOR,SCRAMBLER])
  assert.ok(decision.reasons.includes(typeID+":NO_FREE_SLOT"),JSON.stringify(decision.reasons));
});

test("the fit is a real native module record and is idempotent",()=>{
 const f=fixture();
 const first=f.point.fit({scene:f.scene,entity:f.pirate,
  entityRecord:{entityID:501,typeID:11917,ownerID:1000135,transient:false}});
 assert.equal(first.status,"FITTED");
 assert.equal(first.typeID,DISRUPTOR);
 assert.equal(f.written.length,1);
 const record=f.written[0];
 assert.equal(record.entityID,501);
 assert.equal(record.ownerID,1000135);
 assert.equal(record.categoryID,7);
 assert.equal(record.flagID,19);
 assert.equal(record.singleton,true);
 assert.equal(record.moduleState.online,true);
 assert.equal(record.transient,false);
 assert.ok(f.pirate.fittedItems.some(x=>Number(x.typeID)===DISRUPTOR),
  "the live hull projection carries the fitted module");
 const second=f.point.fit({scene:f.scene,entity:f.pirate,
  entityRecord:{entityID:501,typeID:11917,ownerID:1000135,transient:false}});
 assert.equal(second.status,"PRESENT");
 assert.equal(f.written.length,1,"a second fit never duplicates the module");
});

test("engaging activates the real module on the prey and reports the measured scramble",()=>{
 const f=fixture();
 const outcome=f.point.engage({scene:f.scene,pirateID:501,targetID:201,
  entityRecord:{entityID:501,typeID:11917,ownerID:1000135,transient:false}});
 assert.equal(outcome.status,"ENGAGED");
 assert.equal(outcome.targetID,201);
 assert.equal(outcome.typeID,DISRUPTOR);
 assert.equal(outcome.scrambled,true);
 assert.equal(f.scrambled.has(201),true);
 assert.equal(outcome.distanceMeters,8800);
});

test("an activation the native runtime refuses is reported, never called success",()=>{
 const f=fixture();
 f.scene.activateGenericModule=()=>({success:false,errorMsg:"TARGET_NOT_LOCKED"});
 const outcome=f.point.engage({scene:f.scene,pirateID:501,targetID:201,
  entityRecord:{entityID:501,typeID:11917,ownerID:1000135,transient:false}});
 assert.equal(outcome.status,"REFUSED");
 assert.equal(outcome.reason,"TARGET_NOT_LOCKED");
 assert.equal(outcome.scrambled,false);
});

test("a hull outside the scene is refused instead of activating on nothing",()=>{
 const f=fixture();
 assert.equal(f.point.engage({scene:f.scene,pirateID:501,targetID:999}).reason,
  "HULL_NOT_IN_SCENE");
 assert.equal(f.written.length,0);
});

test("a real scramble is never re-activated on every tick",()=>{
 const f=fixture();
 f.scrambled.add(201);
 const outcome=f.point.engage({scene:f.scene,pirateID:501,targetID:201});
 assert.equal(outcome.status,"ENGAGED");
 assert.equal(outcome.alreadyScrambled,true);
 assert.equal(f.written.length,0,"nothing is fitted when the prey is already held");
});

test("the candidate seeds are real warp disruption type ids, verified at runtime",()=>{
 assert.ok(DEFAULT_CANDIDATE_TYPE_IDS.includes(3242));
 assert.ok(DEFAULT_CANDIDATE_TYPE_IDS.includes(447));
 const f=fixture();
 for(const typeID of [DISRUPTOR,SCRAMBLER]){
  const verified=f.point.verify(typeID);
  assert.equal(verified.ok,true,String(typeID));
  assert.ok(["warpDisruptor","warpScrambler"].includes(verified.family));
 }
 // A seed the registry cannot resolve is refused, never trusted because it is
 // on the list: the list is a seed, the registry is the authority.
 for(const typeID of DEFAULT_CANDIDATE_TYPE_IDS.filter(id=>![DISRUPTOR,SCRAMBLER].includes(id)))
  assert.equal(f.point.verify(typeID).reason,"TYPE_UNVERIFIED",String(typeID));
});

test("the overlay deploys the module and the raid director keeps a pinned order",async()=>{
 const fs=await import("node:fs");
 const path=await import("node:path");
 const root=path.join(import.meta.dirname,"..");
 const spec=fs.readFileSync(path.join(root,"scripts","overlay-spec.cjs"),"utf8");
 assert.match(spec,/"coopNpcWarpPoint"/,"the module must be in names or it is never deployed");
 const wiring=fs.readFileSync(path.join(root,"integration","coopVirtualWorldRuntime.cjs"),"utf8");
 assert.match(wiring,/EVEJS_COOP_NPC_WARP_POINT\s*===\s*"1"/,
  "the runtime wiring must be opt-in and default OFF");
 const raids=fs.readFileSync(path.join(root,"integration","coopNativeRaids.cjs"),"utf8");
 assert.match(raids,/preyScrambled/);
 assert.match(raids,/ensurePoint/);
});
