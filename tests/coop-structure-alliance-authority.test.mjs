import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {admitAlliance,admitStructure,nativeMembership}=require("../integration/coopStructureAllianceAuthority.cjs");
function setup(){
 const CEO=1701,ALT=1702,EXEC=9800013,OTHER=9800014,ENEMY=9800015,ALLIANCE=9900001,HQ=1030001;
 const session={characterID:CEO,corporationID:EXEC,allianceID:ALLIANCE,socket:{destroyed:false}};
 const characters=new Map([[CEO,{characterID:CEO,corporationID:EXEC}],[ALT,{characterID:ALT,corporationID:OTHER}]]);
 const corporations=new Map([[EXEC,{corporationID:EXEC,ceoID:CEO,allianceID:ALLIANCE}],
  [OTHER,{corporationID:OTHER,ceoID:ALT,allianceID:ALLIANCE}],
  [ENEMY,{corporationID:ENEMY,ceoID:1900,allianceID:null}]]);
 const members=new Map([[EXEC+":"+CEO,{characterID:CEO,roles:"1"}],
  [OTHER+":"+ALT,{characterID:ALT,roles:"1"}]]);
 const alliances=new Map([[ALLIANCE,{allianceID:ALLIANCE,executorCorporationID:EXEC}]]);
 const hq={structureID:HQ,ownerCorpID:EXEC,solarSystemID:30000144};
 const base={session,readCharacter:id=>characters.get(id)||null,
 readCorporation:id=>corporations.get(id)||null,
 readMember:(corp,id)=>members.get(corp+":"+id)||null,
 readAlliance:id=>alliances.get(id)||null,
 readAllianceMembers:id=>id===ALLIANCE?[EXEC,OTHER]:[],
 readAllianceRuntime:()=>({applications:{[ENEMY]:{state:1}}}),
 readStructure:id=>id===HQ?hq:null};
 return {base,session,characters,corporations,members,hq,CEO,ALT,EXEC,OTHER,ENEMY,ALLIANCE,HQ};
}
test("native executor director can manage alliance and own structure",()=>{
 const f=setup();
 assert.equal(admitAlliance({...f.base,action:"UpdateAlliance"}).ok,true);
 assert.equal(admitAlliance({...f.base,action:"SetPrimeHour"}).ok,true);
 assert.equal(admitAlliance({...f.base,action:"DeclareWarAgainst",args:[f.ENEMY,f.HQ]}).ok,true);
 assert.equal(admitAlliance({...f.base,action:"UpdateApplication",args:[f.ENEMY,"",2]}).ok,true);
 for(const action of ["deploy","manage","decommission"])
  assert.equal(admitStructure({...f.base,action,structure:f.hq}).ok,true);
});
test("two independent allied players do not share structure or executor privileges",()=>{
 const f=setup(),other={...f.base,session:{...f.session,characterID:f.ALT,corporationID:f.OTHER}};
 for(const action of ["SetPrimeHour","DeleteMember","DeclareWarAgainst","UpdateApplication","UpdateAlliance"])
  assert.equal(admitAlliance({...other,action,args:[f.ENEMY,f.HQ]}).reason,
   "EXECUTOR_CORPORATION_DIRECTOR_REQUIRED");
 assert.equal(admitStructure({...other,action:"manage",structure:f.hq}).reason,
  "STRUCTURE_NATIVE_OWNER_MISMATCH");
});
test("canonical membership defeats stale session IDs and client isCEO spoofing",()=>{
 const f=setup();
 assert.equal(nativeMembership({...f.base,session:{...f.session,corporationID:f.OTHER}}).ok,false);
 assert.equal(admitAlliance({...f.base,action:"SetPrimeHour",
  session:{...f.session,allianceID:999}}).ok,false);
 f.members.set(f.EXEC+":"+f.CEO,{characterID:f.CEO,roles:"0"});
 f.corporations.get(f.EXEC).ceoID=1900;
 assert.equal(admitAlliance({...f.base,action:"SetPrimeHour",session:{...f.session,isCEO:true,corprole:"999999"}}).ok,false);
 assert.equal(admitStructure({...f.base,action:"decommission",
  structure:f.hq,session:{...f.session,isCEO:true,corprole:"999999"}}).ok,false);
});
test("attack war invalid target and alien or destroyed HQ blocked before bill",()=>{
 const f=setup();
 assert.equal(admitAlliance({...f.base,action:"DeclareWarAgainst",args:[f.ENEMY,0]}).ok,false);
 assert.equal(admitAlliance({...f.base,action:"DeclareWarAgainst",args:[f.ALLIANCE,f.HQ]}).ok,false);
 f.hq.ownerCorpID=f.OTHER;
 assert.equal(admitAlliance({...f.base,action:"DeclareWarAgainst",args:[f.ENEMY,f.HQ]}).reason,
  "WAR_HQ_NOT_EXECUTOR_OWNED_ACTIVE");
 f.hq.ownerCorpID=f.EXEC;f.hq.destroyedAt=123;
 assert.equal(admitAlliance({...f.base,action:"DeclareWarAgainst",args:[f.ENEMY,f.HQ]}).ok,false);
});
test("native application and alliance membership cannot be fabricated",()=>{
 const f=setup();
 assert.equal(admitAlliance({...f.base,action:"UpdateApplication",args:[f.OTHER,"",2]}).reason,
  "ALLIANCE_APPLICATION_NOT_DURABLE");
 assert.equal(admitAlliance({...f.base,action:"UpdateApplication",args:[f.ENEMY,"",6]}).ok,false);
 assert.equal(admitAlliance({...f.base,action:"GMForceAcceptApplication",args:[f.ENEMY,"",2]}).reason,
  "GM_ONLY_UNVERIFIED");
 assert.equal(admitAlliance({...f.base,action:"DeleteMember",args:[f.EXEC]}).ok,false);
 assert.equal(admitAlliance({...f.base,action:"DeleteMember",args:[f.ENEMY]}).ok,false);
 assert.equal(admitAlliance({...f.base,action:"DeleteMember",args:[f.OTHER]}).ok,true);
});
test("allied director can choose only a real ally for executor support",()=>{
 const f=setup(),other={...f.base,session:{...f.session,characterID:f.ALT,corporationID:f.OTHER}};
 assert.equal(admitAlliance({...other,action:"DeclareExecutorSupport",args:[f.EXEC]}).ok,true);
 assert.equal(admitAlliance({...other,action:"DeclareExecutorSupport",args:[f.ENEMY]}).ok,false);
});
test("disconnected sessions and deleted corporation reject actions",()=>{
 const f=setup();
 assert.equal(admitAlliance({...f.base,action:"SetPrimeHour",
  session:{...f.session,socket:{destroyed:true}}}).ok,false);
 f.corporations.get(f.EXEC).deleted=1;
 assert.equal(admitAlliance({...f.base,action:"SetPrimeHour"}).ok,false);
});
