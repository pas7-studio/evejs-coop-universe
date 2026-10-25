import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCloneGuard}=require("../integration/coopCloneNativeGuard.cjs");
const {createCloneReceipts}=require("../integration/coopCloneNativeReceipts.cjs");
const {createCloneActionFence}=require("../integration/coopCloneActionFence.cjs");
function scenario(){
 const sessions=[{characterID:101,userid:201,stationID:300,socket:{destroyed:false}},
  {characterID:102,userid:202,stationID:300,socket:{destroyed:false}}];
 const record=id=>({characterID:id,accountId:id+100,activeShipID:id+400,stationID:300,
  homeStationID:300,cloneStationID:300,timeLastCloneJump:"0",boosters:[],implants:[],
  jumpClones:[{jumpCloneID:id+700,ownerID:id,locationID:400,locationKind:"station",
   implants:[]}]});
 const records={101:record(101),102:record(102)};
 const ships={501:{itemID:501,ownerID:101,typeID:670,locationID:300,flagID:4},
  502:{itemID:502,ownerID:102,typeID:670,locationID:300,flagID:4},
  510:{itemID:510,ownerID:101,typeID:3000,locationID:300,flagID:4}};
 const items={960:{itemID:960,typeID:701,ownerID:102,quantity:1,singleton:1}};
 const dogma={101:[],102:[]},boosters={101:[],102:[]},wallets={101:100000,102:100000};
 const stored={files:new Map(),fds:new Map(),i:0};
 const disk={mkdirSync:()=>{},readFileSync:p=>{
  if(!stored.files.has(p)){const e=Error("ENOENT");e.code="ENOENT";throw e}
  return stored.files.get(p)},openSync:(p,mode)=>{
   if(mode==="wx"&&stored.files.has(p))throw Error("EEXIST");
   if(mode==="wx"||mode==="a"&&!stored.files.has(p))stored.files.set(p,"");
   const fd=++stored.i;stored.fds.set(fd,{p,mode});return fd},
  writeSync:(fd,b,offset=0,len=b.length)=>{
   const info=stored.fds.get(fd),s=b.data||b;
   stored.files.set(info.p,(info.mode==="a"?stored.files.get(info.p):"")+s.slice(offset,offset+len));return len},
  fsyncSync:()=>{},closeSync:fd=>stored.fds.delete(fd),
  unlinkSync:p=>stored.files.delete(p)};
 const ownedShips=(id,loc)=>Object.values(ships).filter(s=>s.ownerID===id&&s.locationID===loc);
 const guard=createCloneGuard({getSessions:()=>sessions,getCharacterRecord:id=>records[id],
  getActiveShip:id=>ships[records[id]?.activeShipID],getInventoryItem:id=>items[id]||ships[id],
  getStationByID:id=>({stationID:id,solarSystemID:30000+id}),
  getStructureByID:()=>null,canDockAtStructure:()=>true,hasCloneService:()=>true,
  getCharacterCloneLimit:()=>4,getCloneCooldownHours:()=>24,
  getWalletBalance:id=>wallets[id],getImplantTypeInfo:()=>({slot:1}),
  validateImplantItem:()=>({success:true}),
  getBoosterTypeInfo:()=>({boosterness:1}),validateBoosterItem:()=>({success:true}),
  getOwnedShipsAtLocation:ownedShips,getHomeStationCandidateIDs:()=>[300,400],
  getNativeSchoolHQStationID:()=>300,
  getCloneInstallationFee:()=>10000,getCloneActivationFee:()=>500,
  verifyDeathEvent:()=>true,isAuthorizedAdmin:()=>false,nowFiletime:()=>"134000000000000000",isCapsuleShip:ship=>ship.typeID===670});
 const receipts=createCloneReceipts({getCharacterRecord:id=>records[id],
  getActiveShip:id=>ships[records[id]?.activeShipID],getInventoryItem:id=>items[id]||null,
  getWalletBalance:id=>wallets[id],getNativeDogmaImplants:id=>dogma[id],
  getNativeActiveBoosters:id=>boosters[id],getOwnedShipsAtLocation:ownedShips,
  nowFiletime:()=>"134000000000000000",isCapsuleShip:ship=>ship.typeID===670});
 const fence=createCloneActionFence({file:"/var/lib/evejs/co-op-clones.jsonl",
  storage:disk,clock:()=>12345});
 return {sessions,records,ships,items,dogma,boosters,wallets,guard,receipts,fence};
}
test("two-player native-state clone jump, implant and pod-death continuity",()=>{
 const x=scenario(),a=x.sessions[0],b=x.sessions[1];
 const jump=x.guard.jump(a,{cloneID:801,destLocationID:400});
 assert.equal(jump.ok,true);
 const jumpResult=x.fence.execute({proof:jump,captureNative:p=>x.receipts.capture(p),
  nativeExecute:()=>{
   x.records[101].jumpClones=[{jumpCloneID:802,ownerID:101,locationID:300,implants:[]}];
   x.records[101].stationID=400;
   x.records[101].timeLastCloneJump="133999999999999999";
   x.ships[501].locationID=400;
   x.wallets[101]-=500;
   return null;},
  verifyNative:p=>x.receipts.check(p)});
 assert.equal(jumpResult.status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(x.ships[510].locationID,300);
 assert.equal(x.records[102].stationID,300);
 assert.equal(x.records[102].jumpClones[0].jumpCloneID,802);
 assert.equal(x.fence.inspect(jump).status,"NATIVE_CLONE_ACTION_ALREADY_SETTLED");
 const implant=x.guard.consume(b,{kind:"IMPLANT",itemID:960});
 assert.equal(implant.ok,true);
 const installed=x.fence.execute({proof:implant,captureNative:p=>x.receipts.capture(p),
  nativeExecute:()=>{
   delete x.items[960];x.records[102].implants=[{itemID:960,typeID:701,slot:1}];
   x.dogma[102]=[{itemID:960,typeID:701}];return {success:true};},
  verifyNative:p=>x.receipts.check(p)});
 assert.equal(installed.status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(x.records[101].implants.length,0);
 const death=x.guard.podDeath(b,{deathEventID:"capsule-kill-102-01"});
 assert.equal(death.ok,true);
 const died=x.fence.execute({proof:death,captureNative:p=>x.receipts.capture(p),
  nativeExecute:()=>{
   x.records[102].implants=[];x.dogma[102]=[];
   return {success:true};},
  verifyNative:p=>x.receipts.check(p)});
 assert.equal(died.status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(x.records[102].jumpClones[0].jumpCloneID,802);
 assert.equal(x.records[101].stationID,400);
});
