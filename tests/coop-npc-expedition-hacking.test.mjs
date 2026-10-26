import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-npc-expedition-hacking-patch.cjs");
const FILE="server/src/services/exploration/hackingMgrService.js";
const sourcePath=process.env.EVEJS_PINNED_HACKING_SOURCE;
const pinned=Boolean(sourcePath&&fs.existsSync(sourcePath));
test("EX-03B15 native hacking source patch reversible on both newline variants",()=>{
 const before='class HackingMgrService {};\nHackingMgrService._testing = {};\nmodule.exports=HackingMgrService;\n';
 for(const sep of ["\n","\r\n"]){
  const original=before.replace(/\n/g,sep);
  const changed=patch(original,FILE);
  assert.match(changed,/EX03_NPC_HACK_SOURCE_BEGIN/);
  assert.match(changed,/buildSyntheticBoard/);
  assert.match(changed,/markContainerState/);
  assert.match(changed,/maybeCompleteAttemptSite/);
  assert.equal(patch(changed,FILE),changed);
  assert.equal(patch(changed,FILE,true),original);
  assert.equal(patch(original,"server/src/other.js"),original);
 }
});
test("EX-03B15 source-real original HackingMgr board: physical NPC analyzer -> two turns -> hacked container",
 {skip:!pinned},()=>{
 const source=fs.readFileSync(sourcePath,"utf8");
 const rendered=patch(source,FILE);
 assert.equal(patch(rendered,FILE,true),source);
 const sid=30000142,shipID=980000000322,targetID=620000000322,moduleID=980100000322;
 const ship={itemID:shipID,kind:"ship",nativeNpc:true,ownerID:901,
  corporationID:700,position:{x:0,y:0,z:0}};
 const container={itemID:targetID,ownerID:1,position:{x:2000,y:0,z:0},
  dungeonMaterializedContainer:true,dungeonMaterializedSiteContent:true,
  dungeonSiteContentHackingState:0,dungeonSiteContentAnalyzer:"data",
  dungeonSiteInstanceID:900};
 const entities=new Map([[shipID,ship],[targetID,container]]);
 const scene={systemID:sid,getEntityByID:id=>entities.get(id)};
 const native={getNativeEntity:()=>({entityID:shipID,systemID:sid,ownerID:901,corporationID:700}),
  getNativeController:()=>({entityID:shipID,systemID:sid}),
  listNativeModulesForEntity:()=>[{entityID:shipID,moduleID,
   ownerID:901,typeID:22175,categoryID:7,
   itemName:"Data Analyzer I",moduleState:{online:true}}]};
 const spaces={scenes:new Map([[sid,scene]]),ensureScene:id=>id===sid?scene:null};
 let completions=0;
 const dungeon={maybeCompleteMaterializedDataRelicSite:()=>{completions++;return {success:true}}};
 const shim=p=>{
  if(p==="path")return{join:(...x)=>x.join("/")};
  if(p.includes("baseService"))return class {};
  if(p.includes("space/runtime"))return spaces;
  if(p.includes("dungeonUniverseSiteService"))return dungeon;
  if(p.includes("space/npc/nativeNpcStore"))return native;
  if(p.includes("fitting/liveFittingState"))return{typeHasEffectName:(type,effect)=>type===22175&&effect==="doHacking"};
  if(p.includes("inventory/itemTypeRegistry"))return{resolveItemByTypeID:()=>({name:"Data Analyzer I"})};
  throw Error("EX03_UNEXPECTED_PINNED_IMPORT "+p);
 };
 const m={exports:{}};
 const context={require:shim,module:m,exports:m.exports,__dirname:"/pinned/server/src/services/exploration",
  Map,Set,Date,Number,String,Object,Array,Math,JSON,console};
 vm.runInNewContext(rendered,context);
 const engine=m.exports;
 assert.equal(typeof engine.nativeNpcTurn,"function");
 const args={scene,entityID:shipID,targetID,moduleID};
 assert.equal(engine.nativeNpcTurn(args).status,"NATIVE_NPC_HACK_STARTED");
 assert.equal(container.dungeonSiteContentHackingState,1);
 assert.equal(engine.nativeNpcTurn(args).status,"NATIVE_NPC_HACK_PROGRESS");
 assert.equal(engine.nativeNpcTurn(args).status,"NATIVE_NPC_HACK_SUCCESS");
 assert.equal(container.dungeonSiteContentHackingState,2);
 assert.equal(completions,1);
 assert.equal(engine.nativeNpcTurn(args).status,"BLOCKED","same real container never re-hacks");
 assert.equal(completions,1);
});
test("EX-03B15 native hacking rejects player hull, missing online module and busy container",
 {skip:!pinned},()=>{
 const source=patch(fs.readFileSync(sourcePath,"utf8"),FILE);
 const sid=30000142,shipID=980000000322,targetID=620000000322,moduleID=980100000322;
 const ship={itemID:shipID,kind:"ship",nativeNpc:true,ownerID:901,
  corporationID:700,position:{x:0,y:0,z:0}};
 const container={itemID:targetID,position:{x:0,y:0,z:0},
  dungeonMaterializedContainer:true,dungeonMaterializedSiteContent:true,
  dungeonSiteContentHackingState:0,dungeonSiteContentAnalyzer:"data"};
 const scene={systemID:sid,getEntityByID:id=>id===shipID?ship:id===targetID?container:null};
 let modules=[{entityID:shipID,moduleID,ownerID:901,typeID:22175,
   categoryID:7,itemName:"Data Analyzer I",moduleState:{online:true}}];
 const native={getNativeEntity:()=>({entityID:shipID,systemID:sid,ownerID:901,corporationID:700}),
  getNativeController:()=>({entityID:shipID,systemID:sid}),
  listNativeModulesForEntity:()=>modules};
 const shim=p=>{
  if(p==="path")return{join:(...x)=>x.join("/")};
  if(p.includes("baseService"))return class {};
  if(p.includes("space/runtime"))return{scenes:new Map([[sid,scene]])};
  if(p.includes("dungeonUniverseSiteService"))return{maybeCompleteMaterializedDataRelicSite:()=>({success:true})};
  if(p.includes("space/npc/nativeNpcStore"))return native;
  if(p.includes("fitting/liveFittingState"))return{typeHasEffectName:()=>true};
  if(p.includes("inventory/itemTypeRegistry"))return{resolveItemByTypeID:()=>({name:"Data Analyzer I"})};
  throw Error(p);
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:shim,module:m,exports:m.exports,
  __dirname:"/pinned/server/src/services/exploration",Map,Set,Date,Number,String,Object,Array,Math,JSON,console});
 const turn=()=>m.exports.nativeNpcTurn({scene,entityID:shipID,targetID,moduleID});
 ship.session={characterID:8};assert.equal(turn().status,"BLOCKED");delete ship.session;
 modules[0].moduleState.online=false;assert.equal(turn().status,"BLOCKED");
 modules[0].moduleState.online=true;
 container.dungeonSiteContentHackingState=1;assert.equal(turn().status,"BLOCKED");
 container.dungeonSiteContentHackingState=0;
 ship.position.x=200000;assert.equal(turn().status,"BLOCKED");
});
