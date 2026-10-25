import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCloneReceipts}=require("../integration/coopCloneNativeReceipts.cjs");
const NOW="134000000000000000";
function fixture(){
 const rec={characterID:101,activeShipID:501,stationID:300,homeStationID:300,
  cloneStationID:300,timeLastCloneJump:"0",implants:[],
  boosters:[],jumpClones:[{jumpCloneID:800,ownerID:101,locationID:400,
   implants:[{itemID:980,typeID:990,slot:2}]}]};
 const ships={501:{itemID:501,ownerID:101,typeID:670,locationID:300,flagID:4},
  503:{itemID:503,ownerID:101,typeID:1000,locationID:300,flagID:4}};
 const items={601:{itemID:601,typeID:701,ownerID:101,quantity:1,singleton:1},
  602:{itemID:602,typeID:702,ownerID:101,quantity:2,singleton:0}};
 let dogma=[],boosters=[],wallet=100000;
 const receipts=createCloneReceipts({getCharacterRecord:()=>rec,
  getActiveShip:()=>ships[rec.activeShipID],getInventoryItem:id=>items[id]||null,
  getWalletBalance:()=>wallet,getNativeDogmaImplants:()=>dogma,
  getNativeActiveBoosters:()=>boosters,
  getOwnedShipsAtLocation:(id,loc)=>Object.values(ships).filter(s=>s.ownerID===id&&s.locationID===loc),
  isCapsuleShip:s=>s.typeID===670,nowFiletime:()=>NOW});
 return {rec,ships,items,receipts,setDogma:v=>dogma=v,setBoosters:v=>boosters=v,
  setWallet:v=>wallet=v};
}
const install={ok:true,kind:"INSTALL_CLONE",characterID:101,locationID:300,cost:10000};
const implant={ok:true,kind:"IMPLANT",characterID:101,itemID:601,typeID:701,slot:1};
const booster={ok:true,kind:"BOOSTER",characterID:101,itemID:602,typeID:702};
const jump={ok:true,kind:"CLONE_JUMP",characterID:101,cloneID:800,originalShipID:501,
 destinationLocationID:400,sourceLocationID:300,remote:true,previousLastJump:"0",
 sourceParkedShips:[{itemID:503,ownerID:101,locationID:300,flagID:4}]};
test("installation readback requires a new owned clone and exact wallet debit",()=>{
 const x=fixture(),before=x.receipts.capture(install);
 x.rec.jumpClones.push({jumpCloneID:801,ownerID:101,locationID:300,implants:[]});
 x.setWallet(90000);
 assert.equal(x.receipts.check({proof:install,before}).ok,true);
 x.setWallet(100000);
 assert.equal(x.receipts.check({proof:install,before}).ok,false);
});
test("jump arrival preserves parked ship and transfers target implant to active clone",()=>{
 const x=fixture(),before=x.receipts.capture(jump);
 x.rec.jumpClones=[{jumpCloneID:801,ownerID:101,locationID:300,implants:[]}];
 x.rec.stationID=400;x.rec.implants=[{itemID:980,typeID:990,slot:2}];
 x.rec.timeLastCloneJump=(BigInt(NOW)-1000n).toString();
 x.ships[501].locationID=400;x.setDogma([{itemID:980,typeID:990}]);
 assert.equal(x.receipts.check({proof:jump,before}).ok,true);
});
test("clone jump cannot deliver old fitted ship to destination",()=>{
 const x=fixture(),before=x.receipts.capture(jump);
 x.rec.jumpClones=[];x.rec.stationID=400;x.rec.timeLastCloneJump=NOW;
 x.ships[501].locationID=400;x.ships[503].locationID=400;
 assert.equal(x.receipts.check({proof:jump,before}).reason,"SOURCE_SHIP_MOVED_WITH_CLONE");
});
test("nonexistent clone arrival and cooldown timestamp failure are rejected",()=>{
 const x=fixture(),before=x.receipts.capture(jump);
 x.rec.jumpClones=[];x.rec.stationID=400;x.rec.timeLastCloneJump="0";
 x.ships[501].locationID=400;
 assert.equal(x.receipts.check({proof:jump,before}).reason,"NATIVE_CLONE_TIMER_NOT_UPDATED");
});
test("implant readback requires real inventory consumption and native dogma effect",()=>{
 const x=fixture(),before=x.receipts.capture(implant);
 x.rec.implants.push({itemID:601,typeID:701,slot:1});delete x.items[601];
 assert.equal(x.receipts.check({proof:implant,before}).ok,false);
 x.setDogma([{itemID:601,typeID:701}]);
 assert.equal(x.receipts.check({proof:implant,before}).ok,true);
});
test("implant stacked items must decrement exactly once, not all disappear",()=>{
 const x=fixture();const proof={...implant,itemID:602,typeID:702};
 const before=x.receipts.capture(proof);
 x.rec.implants.push({itemID:602,typeID:702,slot:1});x.items[602].quantity=1;
 x.setDogma([{itemID:602,typeID:702}]);
 assert.equal(x.receipts.check({proof,before}).ok,true);
});
test("booster consumes one real item and appears in persisted active booster state",()=>{
 const x=fixture(),before=x.receipts.capture(booster);
 x.rec.boosters=[{itemID:602,typeID:702,expiryTime:(BigInt(NOW)+1000000n).toString()}];
 x.items[602].quantity=1;x.setBoosters([{itemID:602,typeID:702}]);
 assert.equal(x.receipts.check({proof:booster,before}).ok,true);
 x.setBoosters([]);
 assert.equal(x.receipts.check({proof:booster,before}).ok,false);
});
test("medical home change requires both native home and clone station write",()=>{
 const x=fixture();
 const proof={ok:true,kind:"HOME_STATION",characterID:101,homeStationID:400,remote:true};
 const before=x.receipts.capture(proof);
 x.rec.homeStationID=400;x.rec.cloneStationID=400;
 x.rec.nextRemoteHomeStationChangeTime=(BigInt(NOW)+365n*24n*3600n*10000000n).toString();
 assert.equal(x.receipts.check({proof,before}).ok,true);
 x.rec.cloneStationID=300;
 assert.equal(x.receipts.check({proof,before}).ok,false);
});
test("pod death destroys destructible active implants but not stored jump clones",()=>{
 const x=fixture();x.rec.implants=[{itemID:931,typeID:911,slot:1}];
 const proof={ok:true,kind:"POD_DEATH",characterID:101,homeStationID:300,
  activeImplants:[{itemID:931,typeID:911}],deathEventID:"death-001"};
 const before=x.receipts.capture(proof);x.rec.implants=[];
 assert.equal(x.receipts.check({proof,before}).ok,true);
 x.rec.implants=[{itemID:931,typeID:911,slot:1}];
 assert.equal(x.receipts.check({proof,before}).ok,false);
});
test("one character's clone state cannot be verified as another character",()=>{
 const x=fixture();const before=x.receipts.capture(install);
 assert.equal(x.receipts.check({proof:{...install,characterID:102},before}).ok,false);
});
