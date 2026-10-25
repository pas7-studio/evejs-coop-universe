"use strict";
// Read-only server proof, not a gameplay or on-screen verification.
const fs=require("node:fs");
const pos=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
function parse(input,{now=Date.now(),windowMinutes=120}={}){
 if(!Number.isFinite(now)||!Number.isInteger(windowMinutes)||windowMinutes<1||windowMinutes>1440)
  throw Error("invalid evidence window");
 let bad=0,seq=0;const rows=[];
 for(const line of String(input||"").split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const e=JSON.parse(line),at=Date.parse(e?.at);
   if(!e||typeof e.event!=="string"||!Number.isFinite(at)){bad++;continue;}
   if(at>=now-windowMinutes*60000&&at<=now+60000)rows.push({...e,_time:at,_seq:seq});
  }catch{bad++;}
  seq++;
 }
 rows.sort((a,b)=>a._time-b._time||a._seq-b._seq);
 return {rows,bad};
}
const precedes=(a,b)=>a._time<b._time||(a._time===b._time&&a._seq<b._seq);
function crew(e){
 if(e.event!=="coop-shared-scene"||e.mutualVisibility!==true||!pos(e.systemID)||
  !Array.isArray(e.pilots)||e.pilots.length!==2)return null;
 const members=e.pilots.map(p=>({characterID:pos(p?.characterID),shipID:pos(p?.shipID),shipExists:p?.shipExists===true}));
 if(members.some(x=>!x.characterID||!x.shipID||!x.shipExists)||
  members[0].characterID===members[1].characterID||members[0].shipID===members[1].shipID)return null;
 return {systemID:pos(e.systemID),members};
}
function currentCrew(rows,at,systemID){
 const snapshot=[...rows].reverse().find(e=>e.event==="coop-shared-scene"&&precedes(e,at));
 if(!snapshot||at._time-snapshot._time>15*60000||pos(snapshot.systemID)!==systemID)return null;
 const pair=crew(snapshot);
 if(!pair)return null;
 if(rows.some(e=>e.event==="disconnect-after-persist"&&precedes(snapshot,e)&&precedes(e,at)&&
  pair.members.some(x=>x.characterID===pos(e.characterID))))return null;
 return pair;
}
function report(input,options={}){
 const {rows,bad}=parse(input,options);
 const base={source:"SERVER_NATIVE_EVIDENCE_ONLY",actualGameplayVerified:false,clientRenderingVerified:false,
  bothPlayerDamageVerified:false,missionRewardsVerified:false,invalidLines:bad};
 const blocked=(reason,extra={})=>({...base,status:"BLOCKED",reason,...extra});
 if(bad)return blocked("MALFORMED_JSONL");
 const boot=[...rows].reverse().find(e=>e.event==="living-headless-boot-requested");
 if(!boot)return blocked("MISSING_CURRENT_NATIVE_BOOT");
 const current=rows.filter(e=>!precedes(e,boot));
 const snapshots=current.filter(e=>e.event==="coop-shared-scene"&&crew(e));
 if(!snapshots.length)return blocked("NO_VERIFIED_NATIVE_TWO_PLAYER_SCENE");
 const damages=current.filter(e=>e.event==="coop-native-player-damage"&&
  e.status==="APPLIED_NATIVE_PLAYER_DAMAGE"&&
  e.source==="NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE"&&
  pos(e.systemID)&&pos(e.characterID)&&pos(e.shipID)&&pos(e.victimEntityID)&&
  Number.isFinite(e.appliedDamage)&&e.appliedDamage>0);
 const evidenceByTarget=new Map();
 for(const row of damages){
  const pair=currentCrew(current,row,pos(row.systemID));
  if(!pair||!pair.members.some(x=>x.characterID===pos(row.characterID)&&x.shipID===pos(row.shipID)))continue;
  const key=row.systemID+":"+row.victimEntityID;
  const records=evidenceByTarget.get(key)||[];
  records.push(row);
  evidenceByTarget.set(key,records);
 }
 const wrecks=current.filter(e=>e.event==="living-native-wreck-evidence"&&
  e.status==="PHYSICAL_NATIVE_WRECK_VERIFIED"&&
  pos(e.wreckID)&&pos(e.victimEntityID)&&pos(e.systemID)&&
  e.lootStatus==="ITEMS_STORED"&&Number(e.storedItemCount)>0);
 let strongest={count:0,wreck:false,damageEvents:0};
 for(const [key,entries] of evidenceByTarget){
  for(const e of entries){
   const witness= currentCrew(current,e,pos(e.systemID));
   if(!witness)continue;
   const valid=entries.filter(x=>x._time>=e._time-20*60000&&x._time<=e._time+20*60000&&
    witness.members.some(m=>m.characterID===pos(x.characterID)&&m.shipID===pos(x.shipID)));
   const participants=new Set(valid.map(x=>pos(x.characterID)));
   const matched=wrecks.some(w=>w.systemID+":"+w.victimEntityID===key&&
    valid.some(x=>precedes(x,w)&&w._time-x._time<=20*60000));
   const candidate={count:participants.size,wreck:matched,damageEvents:valid.length,
    systemID:pos(e.systemID),playerIDs:witness.members.map(x=>x.characterID),
    lastHitAt:Math.max(...valid.map(x=>x._time))};
   if(candidate.count>strongest.count||(candidate.count===strongest.count&&candidate.wreck&&!strongest.wreck)) strongest=candidate;
  }
 }
 const mission=current.filter(e=>e.event==="coop-fleet-dungeon-objective"&&
  e.status==="TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED"&&pos(e.systemID)&&
  pos(e.fleetID)&&pos(e.sourceInstanceID)&&pos(e.agentID)&&
  Array.isArray(e.characterIDs)&&e.characterIDs.length===2&&
  pos(e.characterIDs[0])&&pos(e.characterIDs[1])&&e.characterIDs[0]!==e.characterIDs[1]);
 // A native dungeon credit can be independent of a given NPC kill.
 // Even the server-only correlation needs the SAME two characters, same
 // system, and a credit after their shared damage in a bounded window.
 const matchedMission=strongest.count===2&&mission.some(m=>{
  const pair=currentCrew(current,m,pos(m.systemID));
  return pair&&pos(m.systemID)===strongest.systemID&&
   m._time>=strongest.lastHitAt&&m._time-strongest.lastHitAt<=30*60000&&
   pair.members.every(x=>strongest.playerIDs.includes(x.characterID)&&
    m.characterIDs.includes(x.characterID));
 });
 const coDamage=strongest.count===2;
 return {...base,status:coDamage&&matchedMission?"SERVER_TWO_PLAYER_DAMAGE_AND_MISSION_CREDIT":"INCOMPLETE_NATIVE_COOP_EVIDENCE",
  damage:{status:coDamage?"BOTH_PLAYERS_NATIVE_DAMAGE_SAME_TARGET":strongest.count===1?"ONE_PLAYER_NATIVE_DAMAGE":"NO_SHARED_NATIVE_DAMAGE",
   distinctDamagers:strongest.count,matchedPhysicalWreck:strongest.wreck,damageEvents:strongest.damageEvents},
  mission:{status:matchedMission?"TWO_NATIVE_DUNGEON_OBJECTIVES_CREDITED":"NO_INDEPENDENT_NATIVE_MISSION_PROOF"},
  // Real damage is server-proven; a wreck match doesn't imply the players made the final blow.
  bothPlayerDamageVerified:coDamage,
  nextAction:coDamage&&matchedMission?
   "Verify native reward settlement, fleet combat and mission tracker on two authorized clients; no automatic gameplay PASS":
   "Collect real native player hit receipts for each pilot and a separate persisted two-recipient dungeon objective event"};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2);
  if(args.length&&!(args.length===2&&args[0]==="--window-minutes"))throw Error("usage: [--window-minutes N]");
  const result=report(fs.readFileSync(0,"utf8"),{windowMinutes:args.length?Number(args[1]):120});
  console.log(JSON.stringify(result,null,2));
  if(result.status==="BLOCKED")process.exitCode=2;
 }catch(error){console.error("Native co-op report failed:",error.message);process.exitCode=2;}
}
module.exports={parse,crew,currentCrew,report};
