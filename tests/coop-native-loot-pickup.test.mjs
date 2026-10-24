import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify}=require("../integration/coopNativeLootPickupEvidence.cjs");
const systemID=30000144,characterID=51001,wreckItemID=82001;
const wreck={wreckID:91001,sourceEntityID:12001,systemID};
const nativeWreck={itemID:wreck.wreckID,nativeNpcWreck:true,launcherID:12001};
const pilotShip={itemID:77001,kind:"ship"};
const session={characterID,clientID:44001,_space:{shipID:77001,systemID}};
const scene={systemID,sessions:new Map([[1,session]]),
 getEntityByID:id=>id===wreck.wreckID?nativeWreck:id===77001?pilotShip:null};
const sourceBefore={wreckID:wreck.wreckID,wreckItemID,typeID:34,quantity:6};
const base=()=>({scene,wreck,characterID,wreckItemID,sourceBefore,
 sourceAfter:null,availableQuantity:6,requestedQuantity:6,
 grantResult:{success:true,data:{changes:[{itemID:99001}]}}});
test("native complete pickup requires authenticated physical player and depleted source",()=>{
 const r=verify(base());
 assert.equal(r.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(r.characterID,characterID);
 assert.equal(r.shipID,77001);
 assert.equal(r.remainingQuantity,0);
 assert.equal(r.wreckID,wreck.wreckID);
});
test("partial native pickup requires exact remaining source quantity",()=>{
 const b={...base(),requestedQuantity:2,
  sourceAfter:{...sourceBefore,quantity:4}};
 const v=verify(b);
 assert.equal(v.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(v.remainingQuantity,4);
 assert.equal(verify({...b,sourceAfter:{...sourceBefore,quantity:5}}).status,
  "NATIVE_LOOT_SOURCE_NOT_DECREMENTED");
});
test("no false pickup proof when upstream granted but wreck source still exists",()=>{
 const b=base();
 assert.equal(verify({...b,sourceAfter:sourceBefore}).status,
  "NATIVE_LOOT_SOURCE_NOT_REMOVED");
 assert.equal(verify({...b,grantResult:{success:false,errorMsg:"OUT_OF_SPACE"}}).status,
  "NATIVE_GRANT_NOT_CONFIRMED");
});
test("reject fake wrecks, fabricated sessions and wrong source records",()=>{
 const b=base();
 assert.equal(verify({...b,scene:{...scene,getEntityByID:()=>null}}).status,
  "NO_PHYSICAL_NATIVE_WRECK");
 assert.equal(verify({...b,scene:{...scene,sessions:new Map()}}).status,
  "NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 assert.equal(verify({...b,scene:{...scene,sessions:new Map([[1,session],[2,{...session}]])}}).status,
  "NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 assert.equal(verify({...b,sourceBefore:{...sourceBefore,wreckItemID:555}}).status,
  "INVALID_LOOT_WITNESS");
 assert.equal(verify({...b,requestedQuantity:7}).status,"INVALID_LOOT_WITNESS");
});
