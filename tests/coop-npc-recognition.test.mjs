import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRecognition}=require("../integration/coopNpcRecognition.cjs");
const npc=(itemID,x,name="Rook Voss")=>({itemID,kind:"ship",itemName:name,position:{x,y:0,z:0}});
const link={pilotID:"coop-pilot-001",entityID:901,systemID:30000142};
const player=(characterID,shipID)=>({characterID,_space:{
 shipID,systemID:30000142,initialStateSent:true
}});
function setup({now=1000000,recognized=true,shipPresent=true,npcDistance=20000,sendError=false}={}){
 let clockNow=now;const messages=[];
 const entities=new Map([[700,npc(700,0,"Player A")],[701,npc(701,0,"Player B")]]);
 if(shipPresent)entities.set(901,npc(901,npcDistance));
 const scene={getEntityByID:id=>entities.get(id)};
 const adapter=createRecognition({
  clock:()=>clockNow,
  lookup:({pilotID,characterID})=>pilotID===link.pilotID&&characterID===42&&recognized
   ?{status:"KNOWN",score:-50,attitude:"HOSTILE"}:{status:"UNKNOWN"},
  send:(session,message)=>{if(sendError)throw Error("chat down");messages.push({characterID:session.characterID,message});}
 });
 return {adapter,messages,scene,advance:ms=>{clockNow+=ms},entities};
}
test("real physically present NPC recognizes only the player who attacked it",()=>{
 const a=setup();
 assert.equal(a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]}).status,"DELIVERED");
 assert.equal(a.messages.length,1);
 assert.match(a.messages[0].message,/Rook Voss.*remembers your hostile actions/);
 assert.equal(a.adapter.tick({session:player(43,701),scene:a.scene,links:[link]}).status,"NO_NEW_RECOGNITION");
 assert.deepEqual(a.messages.map(m=>m.characterID),[42]);
});
test("no fictional recognition from off-grid, vanished NPC or unloaded client",()=>{
 const far=setup({npcDistance:500000});
 assert.equal(far.adapter.tick({session:player(42,700),scene:far.scene,links:[link]}).status,"NO_NEW_RECOGNITION");
 const missing=setup({shipPresent:false});
 assert.equal(missing.adapter.tick({session:player(42,700),scene:missing.scene,links:[link]}).status,"NO_NEW_RECOGNITION");
 const near=setup();
 assert.equal(near.adapter.tick({session:player(42,700),scene:near.scene,
  links:[{...link,systemID:30000144}]}).status,"NO_NEW_RECOGNITION");
 const unloaded=player(42,700);unloaded._space.initialStateSent=false;
 assert.equal(near.adapter.tick({session:unloaded,scene:near.scene,links:[link]}).status,"PLAYER_NOT_READY");
});
test("recognition cooldown resists spam while preserving other players' isolation",()=>{
 const a=setup();
 assert.equal(a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]}).status,"DELIVERED");
 assert.equal(a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]}).status,"PLAYER_COOLDOWN");
 a.advance(181000);
 assert.equal(a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]}).status,"NO_NEW_RECOGNITION");
 a.advance(1620000);
 assert.equal(a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]}).status,"DELIVERED");
 assert.equal(a.messages.length,2);
});
test("chat failure does not consume notification budget",()=>{
 const a=setup({sendError:true});
 const r=a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]});
 assert.equal(r.status,"DELIVERY_FAILED");
 assert.equal(a.adapter.tick({session:player(42,700),scene:a.scene,links:[link]}).status,"DELIVERY_FAILED");
 assert.equal(a.messages.length,0);
});
