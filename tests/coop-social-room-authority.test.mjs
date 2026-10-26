import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verifyScopedRoom}=require("../integration/coopSocialRoomAuthority.cjs");
const A=7001,B=7002,CORP=9800012,OTHER=9800013,ALLIANCE=9900002,FLEET=100007;
function fixture(){
 const character=new Map([[A,{characterID:A,corporationID:CORP}],[B,{characterID:B,corporationID:OTHER}]]);
 const corporation=new Map([[CORP,{corporationID:CORP,allianceID:ALLIANCE}],[OTHER,{corporationID:OTHER,allianceID:null}]]);
 const alliances=new Map([[ALLIANCE,{allianceID:ALLIANCE}]]);
 const fleets=new Map([[A,{fleetID:FLEET,members:new Map([[A,{charID:A}],[B,{charID:B}]])}],
  [B,{fleetID:FLEET,members:new Map([[A,{charID:A}],[B,{charID:B}]])}]]);
 const deps={getCharacter:id=>character.get(id),
  getCorporation:id=>corporation.get(id),
  getAlliance:id=>alliances.get(id),
  getAllianceMembers:id=>id===ALLIANCE?[CORP]:[],
  getFleetForCharacter:id=>fleets.get(id)};
 const sessionA={characterID:A,corporationID:CORP,allianceID:ALLIANCE,fleetid:FLEET,socket:{destroyed:false}};
 const sessionB={characterID:B,corporationID:OTHER,allianceID:null,fleetid:FLEET,socket:{destroyed:false}};
 return {deps,sessionA,sessionB,character,corporation,alliances,fleets};
}
test("canonical player A joins original corporation, alliance and fleet rooms",()=>{
 const f=fixture();
 for(const [type,entityID] of [["corp",CORP],["alliance",ALLIANCE],["fleet",FLEET]])
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionA,record:{type,entityID}}).ok,true);
});
test("player B cannot join A corporation or alliance by forged session fields",()=>{
 const f=fixture();
 const faked={...f.sessionB,corporationID:CORP,allianceID:ALLIANCE};
 assert.equal(verifyScopedRoom({...f.deps,session:faked,record:{type:"corp",entityID:CORP}}).ok,false);
 assert.equal(verifyScopedRoom({...f.deps,session:faked,record:{type:"alliance",entityID:ALLIANCE}}).ok,false);
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionB,record:{type:"fleet",entityID:FLEET}}).ok,true);
});
test("reconnect stale fleet ID cannot preserve old room access",()=>{
 const f=fixture();
 f.fleets.delete(A);
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionA,record:{type:"fleet",entityID:FLEET}}).ok,false);
 f.fleets.set(A,{fleetID:FLEET+1,members:new Map([[A,{}]])});
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionA,record:{type:"fleet",entityID:FLEET}}).ok,false);
});
test("corporation change invalidates chat membership without reconnect",()=>{
 const f=fixture();
 f.character.get(A).corporationID=OTHER;
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionA,record:{type:"corp",entityID:CORP}}).ok,false);
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionA,record:{type:"alliance",entityID:ALLIANCE}}).ok,false);
});
test("lost alliance membership index or stale executor alliance denies messages",()=>{
 const f=fixture();
 f.deps.getAllianceMembers=()=>[];
 assert.equal(verifyScopedRoom({...f.deps,session:f.sessionA,record:{type:"alliance",entityID:ALLIANCE}}).ok,false);
});
test("logged-out account userid never substitutes for selected character",()=>{
 const f=fixture();
 assert.equal(verifyScopedRoom({...f.deps,
  session:{userid:A,corporationID:CORP,allianceID:ALLIANCE},
  record:{type:"corp",entityID:CORP}}).ok,false);
});
test("native local and public XMPP channels retain existing authority",()=>{
 assert.equal(verifyScopedRoom({record:{type:"local",entityID:30000142}}).ok,true);
 assert.equal(verifyScopedRoom({record:{type:"player",entityID:5000}}).ok,true);
});
test("disconnected or missing character authority fails closed",()=>{
 const f=fixture();
 assert.equal(verifyScopedRoom({...f.deps,session:{...f.sessionA,socket:{destroyed:true}},
  record:{type:"fleet",entityID:FLEET}}).ok,false);
 assert.equal(verifyScopedRoom({...f.deps,getCharacter:null,
  session:f.sessionA,record:{type:"corp",entityID:CORP}}).ok,false);
});
