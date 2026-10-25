// Executes actual EveJS persistCharacterLogoffState with mocked persistence
// boundaries. No database, network, or proprietary client involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {hasUpstreamCodePath,upstreamSkipReason,upstreamSuiteName} from "./helpers/upstreamCheckout.mjs";

if (!hasUpstreamCodePath) {
  test(upstreamSuiteName, { skip: upstreamSkipReason }, () => {});
} else {
const code=process.env.EVEJS_CODE_PATH;
const require=createRequire(import.meta.url);
const Module=require('node:module');
const sourcePath=resolve(code,'server/src/services/_shared/sessionDisconnect.js');
function loadWithFakes(fakes){
  const original=Module._load;
  Module._load=function(request,parent,isMain){
    if(parent?.filename===sourcePath){
      if(request in fakes)return fakes[request];
      const normalized=String(request).replace(/\\/g,"/");
      const key=Object.keys(fakes).find(x=>normalized.endsWith(x.split('/').slice(-2).join('/')));
      if(key)return fakes[key];
    }
    return original.apply(this,arguments);
  };
  try{delete require.cache[require.resolve(sourcePath)];return require(sourcePath);}
  finally{Module._load=original;delete require.cache[require.resolve(sourcePath)];}
}
function harness({ship=true,liveState=true,shipMoveSuccess=true,emergencyWarp=true}={}){
 const records=[],ships=[],calls=[];
 const activeShip=ship?{itemID:7001,flagID:0,locationID:30000142,spaceState:{systemID:30000142}}:null;
 const fakes={
  '../space/worldData':{getSolarSystemByID:()=>({constellationID:20000020,regionID:10000002}),getStationByID:()=>null},
  '../space/runtime':{getEntitySpaceStateSnapshot:()=>liveState?{systemID:30000142,position:{x:123,y:456,z:789}}:null},
  '../services/chat/chatHub':{},
  '../services/structure/structureState':{getStructureByID:()=>null},
  '../services/chat/xmppStubServer':{unregisterCharacterSession:()=>{}},
  '../services/trade/tradeMgrService':{abortTradesForSession:()=>{}},
  '../services/_shared/serviceHelpers':{currentFileTime:()=>123456789n},
  '../services/_shared/emergencyWarpRuntime':{
    buildEmergencyWarpLogoffState:(state)=>({...state,position:{x:999,y:888,z:777}}),
    shipSuppressesEmergencyWarp:()=>!emergencyWarp
  },
  '../services/_shared/guestLists':{},
  '../services/character/characterState':{
    getActiveShipRecord:()=>activeShip,
    updateCharacterRecord:(id,update)=>{records.push({id,value:update({})});return {success:true};},
    clearCharacterFromSession:()=>{}
  },
  '../services/inventory/itemStore':{
    ITEM_FLAGS:{HANGAR:4},
    moveShipToSpace:(shipID,systemID,state)=>{
      ships.push({shipID,systemID,state});
      return shipMoveSuccess?{success:true}:{success:false,errorMsg:'fixture write failed'};
    }
  },
  '../utils/logger':{warn:(...a)=>calls.push(['warn',a]),debug:()=>{}},
 };
 const target=loadWithFakes(fakes);
 return {target,records,ships,calls};
}
test('logoff persists active ship in space with emergency warp and character metadata',()=>{
 const h=harness();const out=h.target.persistCharacterLogoffState({characterID:101,_space:{shipID:7001,systemID:30000142}});
 assert.equal(out.success,true);
 assert.equal(h.ships.length,1);
 assert.equal(h.ships[0].shipID,7001);
 assert.deepEqual(h.ships[0].state.position,{x:999,y:888,z:777});
 assert.equal(h.records[0].value.solarSystemID,30000142);
 assert.equal(h.records[0].value.stationID,null);
 assert.equal(h.records[0].value.logoffDate,'123456789');
});
test('no emergency warp keeps exact live coordinates',()=>{
 const h=harness({emergencyWarp:false});h.target.persistCharacterLogoffState({characterID:101,_space:{shipID:7001,systemID:30000142}});
 assert.deepEqual(h.ships[0].state.position,{x:123,y:456,z:789});
});
test('missing ship never invents spatial coordinates',()=>{
 const h=harness({ship:false});h.target.persistCharacterLogoffState({characterID:101,_space:{systemID:30000142}});
 assert.equal(h.ships.length,0);assert.equal(h.records.length,1);
});
test('failed ship write logs warning but retains character persistence path',()=>{
 const h=harness({shipMoveSuccess:false});h.target.persistCharacterLogoffState({characterID:101,_space:{shipID:7001,systemID:30000142}});
 assert.equal(h.ships.length,1);assert.equal(h.records.length,1);
 assert.ok(h.calls.some(x=>x[0]==='warn'));
});
test('missing session rejected without mutating persistence',()=>{
 const h=harness();assert.equal(h.target.persistCharacterLogoffState(null).errorMsg,'SESSION_REQUIRED');
 assert.equal(h.records.length,0);assert.equal(h.ships.length,0);
});
}
