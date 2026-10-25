import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeMount}=require("../integration/coopEscortNativeMount.cjs");
const {createManifest}=require("../integration/coopNativeHaulManifest.cjs");
const vars=["EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_NATIVE_ESCORT_WALLET"];
const prior=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
for(const k of vars)process.env[k]="1";
const manifestKey="30000144-77-1000000";
const route={manifestKey,systemID:30000144,fleetID:77,
 stationID:60001,corporationID:10001,haulerIDs:[901]};
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"escort-native-mount-"));
 const clone=x=>JSON.parse(JSON.stringify(x));
 let db={corporationRuntime:{"corporations\u001f10001":{
  wallet:{divisions:{"1000":{key:1000,balance:50000,journal:[],transactions:[]}}}}},
  characters:{"701":{characterID:701,balance:500,balanceChange:0,walletJournal:[]},
   "702":{characterID:702,balance:500,balanceChange:0,walletJournal:[]}}};
 let verifiedConsent=false,verifiedParty=true,spoofPrice=false,online=true,now=1000000;
 let txs=0;
 const atomic={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(_,callback)=>{txs++;const before=clone(db);
   const tx={get:(t,k)=>db[t][k]===undefined?null:clone(db[t][k]),
    put:(t,k,v)=>db[t][k]=clone(v)};
   try{return callback(tx)}catch(e){db=before;throw e}
  }};
 const cargo=[{cargoID:5501,entityID:901,coopHaulFleetID:77,
  coopHaulFromMinerID:55,typeID:34,quantity:7,moduleID:0,transient:false}];
 const npcStore={
  getNativeEntity:id=>id===901?{entityID:id,systemID:30000144,transient:false}:null,
  listNativeCargoForEntity:id=>id===901?cargo:[]};
 const items={findWarehouseItem:()=>null};
 const nativeManifest=createManifest({root,store:npcStore,items,
  getNativeEntity:npcStore.getNativeEntity,clock:()=>1000000});
 const prepared=nativeManifest.prepare({systemID:30000144,fleetID:77,
  stationID:60001,corporationID:10001,startedAt:1000000,haulerIDs:[901]});
 assert.equal(prepared.status,"MANIFEST_DURABLY_PREPARED");
 assert.equal(prepared.key,manifestKey);
 const session=id=>({characterID:id,socket:{destroyed:!online},
  _space:{shipID:id+1000,initialStateSent:true,systemID:30000144}});
 const pilots=[session(701),session(702)];
 const scene={systemID:30000144,getEntityByID:id=>id===901?
  {kind:"ship",itemID:901,nativeNpc:true,transient:false}:null};
 const mount=()=>createNativeMount({root,
  gameStore:{coopAtomicNativeRows:atomic},
  corporations:{isNpcCorporationID:id=>id===10001},
  npcStore,items,
  sessions:{getSessions:()=>pilots},
  spaceRuntime:{getSceneForSession:()=>scene},
  fleetRuntime:{getFleetForCharacter:()=>({fleetID:33}),
   getMemberRecord:()=>({characterID:701})},
  readAuthorizedOffer:trip=>({status:"AUTHORIZED_NATIVE_ESCORT_BOOKING",
   manifestKey:trip.manifestKey,systemID:trip.systemID,
   fleetID:trip.fleetID,stationID:trip.stationID,corporationID:trip.corporationID,
   haulerID:trip.haulerIDs[0],contractID:"escort-native-001",
   playerFleetID:33,characters:[701,702],amountISK:spoofPrice?999999:20000,
   quoteExpiresAt:8000000}),
  readPilotConsent:()=>verifiedConsent?{
   status:"DURABLE_TWO_PILOT_CONSENT",manifestKey,
   contractID:"escort-native-001",haulerID:901,
   fleetID:33,characters:[701,702]}:{status:"NOT_FOUND"},
  readNativeFailure:()=>null,
  readIncidents:()=>({status:"READY",incidents:[]}),
  readOutcomes:()=>({status:"READY",outcomes:[]}),
  verifyNativeParty:()=>verifiedParty?{
   ok:true,fleetID:33,systemID:30000144,leaderShipID:1701,
   peerShipID:1702}:{ok:false,reason:"NOT_SAME_NATIVE_FLEET"},
  clock:()=>now});
 try{fn({root,mount,db:()=>db,txs:()=>txs,consent:()=>verifiedConsent=true,
  denyParty:()=>verifiedParty=false,
  disconnect:()=>{pilots[1].socket.destroyed=true},
  price:()=>spoofPrice=true,setTime:t=>now=t})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("native binding never reserves ISK without BOTH pilots' durable consent",()=>fixture(f=>{
 const b=f.mount();
 assert.equal(b.runtime.fundBeforeWarp(route).status,"FLIGHT_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000);
}));
test("two-pilot source and server-approved price funds exact native NPC corporation once",()=>fixture(f=>{
 f.consent();
 const b=f.mount();
 assert.equal(b.runtime.fundBeforeWarp(route).status,"FUNDED_BEFORE_WARP");
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,30000);
 assert.equal(b.runtime.fundBeforeWarp(route).status,"FLIGHT_RESERVATION_NOT_EMPTY");
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,30000);
}));
test("unverified real EVE fleet cannot be paid even with consent",()=>fixture(f=>{
 f.consent();f.denyParty();
 assert.equal(f.mount().runtime.fundBeforeWarp(route).status,"FLIGHT_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000);
}));
test("disconnected duplicate or ghost character session cannot approve native funds",()=>fixture(f=>{
 f.consent();f.disconnect();
 assert.equal(f.mount().runtime.fundBeforeWarp(route).status,"FLIGHT_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000);
}));
test("expired native NPC quote cannot debit a corporation even with two pilots",()=>fixture(f=>{
 f.consent();f.setTime(8000001);
 assert.equal(f.mount().runtime.fundBeforeWarp(route).status,"FLIGHT_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000);
}));
test("native escrow adapter requires the genuine server-internal atomic ownership mode",()=>fixture(f=>{
 assert.throws(()=>createNativeMount({root:f.root}),/ESCORT_PINNED_NATIVE_PROVIDER_AUTHORITIES_REQUIRED/);
}));
test("feature OFF blocks even fully authorized offers",()=>fixture(f=>{
 f.consent();
 process.env.EVEJS_COOP_ESCORT_CONTRACTS="0";
 try{assert.equal(f.mount().runtime.fundBeforeWarp(route).status,"DISABLED");
  assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000)}
 finally{process.env.EVEJS_COOP_ESCORT_CONTRACTS="1"}
}));
process.on("exit",()=>{for(const [k,v] of Object.entries(prior)){
 if(v===undefined)delete process.env[k];else process.env[k]=v
}});
