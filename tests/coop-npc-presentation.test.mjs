import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {presentVirtualPilot}=require("../integration/coopNpcPresentation.cjs");
function world(){
 const ship={itemID:901,kind:"ship",nativeNpc:true,itemName:"Native Pirate",slimName:"Native Pirate",
  position:{x:10,y:20,z:30},shield:10};
 const ships=new Map([[901,ship]]);
 const observers=[[],[]];
 const scene={getEntityByID:id=>ships.get(id)||null,
  broadcastSlimItemChanges:items=>{for(const messages of observers)messages.push(
   items.map(i=>({id:i.itemID,name:i.slimName})));}};
 const pilot={id:"coop-pilot-005",name:"Nyx Voss",role:"pirate",faction:"independent"};
 return {scene,ship,observers,pilot};
}
test("real EveJS slim-item updates named NPC for both actual observers",()=>{
 const x=world(),oldShipID=x.ship.itemID,oldShield=x.ship.shield;
 const r=presentVirtualPilot(x.scene,901,x.pilot);
 assert.equal(r.status,"UPDATED");
 assert.equal(x.ship.slimName,"Nyx Voss [Pirate]");
 assert.equal(x.ship.coopVirtualPilotID,"coop-pilot-005");
 assert.deepEqual(x.observers.map(o=>o[0][0].name),
  ["Nyx Voss [Pirate]","Nyx Voss [Pirate]"]);
 assert.equal(x.ship.itemID,oldShipID);
 assert.equal(x.ship.shield,oldShield);
});
test("unchanged identity does not flood clients with a new slim notification each tick",()=>{
 const x=world();
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"UPDATED");
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"UNCHANGED");
 assert.equal(x.observers[0].length,1);
});
test("failed broadcast is retried without creating a new NPC or losing identity",()=>{
 const x=world(),original=x.scene.broadcastSlimItemChanges;
 let count=0;
 x.scene.broadcastSlimItemChanges=items=>{
  count++;
  if(count===1)throw Error("TRANSIENT_CLIENT_BROADCAST");
  original(items);
 };
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"BROADCAST_FAILED");
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"UPDATED");
 assert.equal(count,2);
 assert.equal(x.observers[0].length,1);
 assert.equal(x.ship.itemID,901);
});
test("unavailable native broadcaster is never reported as client synchronization success",()=>{
 const x=world();delete x.scene.broadcastSlimItemChanges;
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"BROADCAST_UNAVAILABLE");
 assert.equal(x.ship.coopVirtualPilotID,"coop-pilot-005");
 x.scene.broadcastSlimItemChanges=()=>{};
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"UPDATED");
});
test("cannot steal another named NPC identity or a real player's ship",()=>{
 const x=world();x.ship.coopVirtualPilotID="coop-pilot-088";
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"IDENTITY_CONFLICT");
 x.ship.coopVirtualPilotID=null;x.ship.nativeNpc=false;
 assert.equal(presentVirtualPilot(x.scene,901,x.pilot).status,"NOT_NATIVE_NPC_SHIP");
 assert.equal(x.ship.itemName,"Native Pirate");
});
