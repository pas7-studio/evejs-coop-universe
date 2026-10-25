import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify,destinationDelta}=require("../integration/coopNativeLootPickupEvidence.cjs");
function f(){
 const char=51,shipID=71,wreckID=91,itemID=101,systemID=30000144;
 const pilot={characterID:char,_space:{shipID,systemID,initialStateSent:true},socket:{destroyed:false}};
 const ship={kind:"ship",itemID:shipID,ownerID:char,pilotCharacterID:char,session:pilot};
 const wreck={wreckID,systemID,sourceEntityID:89};
 const entities=new Map([[shipID,ship],[wreckID,{nativeNpcWreck:true,itemID:wreckID,launcherID:89}]]);
 const scene={systemID,sessions:new Map([[char,pilot]]),getEntityByID:id=>entities.get(id)||null};
 const sourceBefore={wreckID,wreckItemID:itemID,typeID:34,ownerID:51,quantity:6};
 const grantResult={success:true,data:{quantity:2,changes:[{item:{itemID:200,ownerID:char,
   locationID:shipID,typeID:34,quantity:2},previousData:{locationID:0,flagID:0}}]}};
 const args={scene,wreck,characterID:char,wreckItemID:itemID,
  destinationLocationID:shipID,sourceBefore,sourceAfter:{...sourceBefore,quantity:4},
  availableQuantity:6,requestedQuantity:2,grantResult};
 return {args,pilot,ship,scene,entities};
}
test("a true native partial pickup has exact owner, type and net delta",()=>{
 assert.equal(verify(f().args).status,"VERIFIED_NATIVE_LOOT_PICKUP");
});
test("full source debit and native cargo delta verify without duplicates",()=>{
 const x=f();x.args.sourceAfter=null;x.args.requestedQuantity=6;
 x.args.grantResult.data.quantity=6;x.args.grantResult.data.changes[0].item.quantity=6;
 assert.equal(verify(x.args).status,"VERIFIED_NATIVE_LOOT_PICKUP");
});
test("existing same-type stack with zero delta cannot impersonate a new grant",()=>{
 const x=f(),change=x.args.grantResult.data.changes[0];
 change.previousData={...change.item};
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
test("RPC quantity cannot exceed actual granted delta",()=>{
 const x=f();x.args.grantResult.data.changes[0].item.quantity=1;
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
test("native stack merge accepts exact positive delta",()=>{
 const x=f(),change=x.args.grantResult.data.changes[0];
 change.previousData={...change.item,quantity:5};change.item.quantity=7;
 assert.equal(verify(x.args).status,"VERIFIED_NATIVE_LOOT_PICKUP");
});
test("source quantity mismatch never becomes an authenticated pickup",()=>{
 const x=f();x.args.sourceBefore.quantity=999;
 assert.equal(verify(x.args).status,"INVALID_LOOT_WITNESS");
});
test("source removal failure always takes precedence over disconnect",()=>{
 const x=f();x.args.sourceAfter={...x.args.sourceBefore};x.pilot.socket.destroyed=true;
 assert.equal(verify(x.args).status,"NATIVE_LOOT_SOURCE_NOT_DECREMENTED");
});
test("wrong hull owner or stale session is not accepted",()=>{
 const x=f();x.ship.ownerID=999;
 assert.equal(verify(x.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 x.ship.ownerID=51;x.ship.session={...x.pilot};
 assert.equal(verify(x.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
});
test("a third live pilot sharing the same shipID blocks proof",()=>{
 const x=f();x.scene.sessions.set(999,{characterID:999,
  _space:{shipID:71,systemID:30000144,initialStateSent:true},socket:{destroyed:false}});
 assert.equal(verify(x.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
});
test("no false ship pickup proof for an unverified other destination",()=>{
 const x=f();x.args.destinationLocationID=999;
 x.args.grantResult.data.changes[0].item.locationID=999;
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
test("destination changes must have valid positive item identity",()=>{
 const x=f();delete x.args.grantResult.data.changes[0].item.itemID;
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
test("split stack native grants sum exactly, never double count",()=>{
 const x=f();const changes=x.args.grantResult.data.changes;
 changes[0].item.quantity=1;changes.push({item:{...changes[0].item,itemID:201}});
 assert.equal(verify(x.args).status,"VERIFIED_NATIVE_LOOT_PICKUP");
 changes.push({...changes[1]});
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
test("negative delta is refused even when another item is valid",()=>{
 const x=f();x.args.grantResult.data.changes.push({item:{itemID:201,
  ownerID:51,locationID:71,typeID:34,quantity:1},previousData:{itemID:201,
   ownerID:51,locationID:71,typeID:34,quantity:5}});
 assert.equal(destinationDelta(x.args.grantResult.data.changes,51,71,34),-2);
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});

test("granted quantity must account for any removals from same destination",()=>{
 const x=f();x.args.grantResult.data.changes.push({removed:true,
  previousData:{itemID:301,ownerID:51,locationID:71,typeID:34,quantity:1},item:null});
 assert.equal(destinationDelta(x.args.grantResult.data.changes,51,71,34),1);
 assert.equal(verify(x.args).status,"NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
