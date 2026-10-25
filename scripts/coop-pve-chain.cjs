"use strict";
// Correlate one real native raid, destroyed pirate, and physical two-pilot loot.
// This is read-only causality evidence; it cannot prove real client rendering,
// player combat participation, mission payout or full co-op acceptance.
const fs = require("node:fs");
const pos = value => {
 const n = Number(value);
 return Number.isSafeInteger(n) && n > 0 ? n : null;
};
function parse(input, {now = Date.now(), minutes = 120} = {}) {
 if(!Number.isFinite(now) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
  throw Error("invalid reporting window");
 const rows=[];let invalid=0,number=0;
 for(const line of String(input||"").split(/\r?\n/)){
  if(!line.trim())continue;
  number++;
  try{
   const e=JSON.parse(line),at=Date.parse(e?.at);
   if(!e||typeof e.event!=="string"||!e.event||!Number.isFinite(at)){
    invalid++;continue;
   }
   if(at>=now-minutes*60000&&at<=now+60000)rows.push({...e,_at:at,_sequence:number});
  }catch{invalid++;}
 }
 rows.sort((a,b)=>a._at-b._at||a._sequence-b._sequence);
 return {rows,invalid};
}
const before=(a,b)=>a._at<b._at||(a._at===b._at&&a._sequence<b._sequence);
function crew(event){
 if(event?.event!=="coop-shared-scene"||event.mutualVisibility!==true||
  !pos(event.systemID)||!Array.isArray(event.pilots)||event.pilots.length!==2)return null;
 const pilots=event.pilots.map(p=>({characterID:pos(p?.characterID),shipID:pos(p?.shipID),valid:p?.shipExists===true}));
 if(pilots.some(p=>!p.characterID||!p.shipID||!p.valid)||
  pilots[0].characterID===pilots[1].characterID||pilots[0].shipID===pilots[1].shipID)return null;
 return {systemID:pos(event.systemID),pilots};
}
function latestCrew(rows,beforeRow,systemID,requiredIDs=null){
 const recent=[...rows].reverse().find(e=>e.event==="coop-shared-scene"&&before(e,beforeRow));
 if(!recent||beforeRow._at-recent._at>15*60000||pos(recent.systemID)!==systemID)return null;
 const actual=crew(recent);
 if(!actual)return null;
 if(requiredIDs&&!requiredIDs.every(id=>actual.pilots.some(p=>p.characterID===id)))return null;
 // A later disconnect cannot be undone by stale scene telemetry, even when
 // the old scene still lists both ship IDs as present.
 const disconnected=rows.some(e=>e.event==="disconnect-after-persist"&&
  actual.pilots.some(p=>p.characterID===pos(e.characterID))&&
  before(recent,e)&&before(e,beforeRow));
 return disconnected?null:{...actual,observedAt:recent.at};
}
function summarize(input,{now=Date.now(),minutes=120}={}){
 const {rows,invalid}=parse(input,{now,minutes});
 const base={gameplayVerified:false,combatParticipationVerified:false,
  missionProgressVerified:false,clientRenderingVerified:false,
  scope:"SERVER_NATIVE_PVE_CORRELATION_ONLY",invalidLines:invalid,
  evidenceWindowMinutes:minutes};
 const fail=(status,nextAction,details={})=>({...base,status,nextAction,...details});
 if(invalid)return fail("INVALID_EVENT_STREAM","Inspect malformed telemetry; no positive evidence accepted");
 const boot=[...rows].reverse().find(e=>e.event==="living-headless-boot-requested");
 if(!boot)return fail("BLOCKED_TELEMETRY","Establish genuine current headless boot events (DiagnoseWorld) first");
 const current=rows.filter(e=>!before(e,boot));
 const scenes=current.filter(e=>e.event==="coop-shared-scene"&&crew(e));
 if(!scenes.length)return fail("TWO_PILOTS_NOT_EVIDENCED","Observe fresh mutual native scene visibility for two different player ships");
 const raids=current.flatMap(e=>e.event==="living-pirate-raid"&&Array.isArray(e.actions)
  ?e.actions.filter(a=>a?.action==="attack"&&pos(a.pirateID)&&pos(a.targetID)&&
   pos(a.pirateID)!==pos(a.targetID)&&["miner","hauler"].includes(a.targetRole))
   .map(a=>({...a,systemID:pos(e.systemID),_event:e})):[])
  .filter(a=>a.systemID&&latestCrew(current,a._event,a.systemID));
 if(!raids.length)return fail("NATIVE_RAID_NOT_EVIDENCED",
  "Observe a real successful native pirate attack order in the duo's system; warp approach is not combat",{twoPilotSnapshots:scenes.length});
 const wrecks=current.filter(e=>e.event==="living-native-wreck-evidence"&&
  e.status==="PHYSICAL_NATIVE_WRECK_VERIFIED"&&pos(e.wreckID)&&pos(e.victimEntityID)&&
  e.lootStatus==="ITEMS_STORED"&&Number(e.storedItemCount)>0);
 const pickups=current.filter(e=>e.event==="living-native-loot-pickup"&&
  e.status==="VERIFIED_NATIVE_LOOT_PICKUP"&&pos(e.wreckID)&&pos(e.wreckItemID)&&
  pos(e.characterID)&&pos(e.shipID)&&pos(e.quantity)&&pos(e.sourceEntityID));
 let best=null;
 for(const raid of raids){
  const r=raid._event,systemID=raid.systemID;
  const originalCrew=latestCrew(current,r,systemID);
  if(!originalCrew)continue;
  const characters=originalCrew.pilots.map(p=>p.characterID);
  const available=wrecks.filter(w=>pos(w.systemID)===systemID&&
   pos(w.victimEntityID)===pos(raid.pirateID)&&before(r,w)&&w._at-r._at<=20*60000);
  for(const wreck of available){
   const loot=pickups.filter(p=>pos(p.systemID)===systemID&&
    pos(p.wreckID)===pos(wreck.wreckID)&&
    pos(p.sourceEntityID)===pos(raid.pirateID)&&before(wreck,p)&&
    p._at-wreck._at<=30*60000&&characters.includes(pos(p.characterID))&&
    (function(){
     const paired=latestCrew(current,p,systemID,characters);
     return paired&&paired.pilots.some(x=>x.characterID===pos(p.characterID)&&x.shipID===pos(p.shipID));
    })());
   const looters=new Set(loot.map(p=>pos(p.characterID)));
   const candidate={raid:r,wreck,loot,looters:looters.size,pilots:characters,crewAt:originalCrew.observedAt};
   if(!best||candidate.looters>best.looters||
    (candidate.looters===best.looters&&candidate.loot.length>best.loot.length))best=candidate;
  }
 }
 if(!best)return fail("LINKED_WRECK_NOT_EVIDENCED",
  "Confirm the same native attacking pirate's real wreck and persisted items after its raid; an NPC-vs-NPC attack alone is not a player kill",{nativeRaids:raids.length});
 const sequence=[
  {phase:"TWO_NATIVE_PILOTS_IN_SCENE",at:best.crewAt},
  {phase:"NATIVE_PIRATE_ATTACK_ORDER",at:best.raid.at},
  {phase:"PHYSICAL_PIRATE_WRECK_WITH_STORED_ITEMS",at:best.wreck.at},
  ...best.loot.slice(0,6).map(e=>({phase:"NATIVE_LOOT_GRANT_AND_SOURCE_DEBIT",at:e.at}))
 ];
 const details={nativeRaids:raids.length,matchedWrecks:1,
  verifiedNativeLootPickups:best.loot.length,distinctNativeLooters:best.looters,
  twoPilotsAtRaid:true,timeline:sequence};
 if(best.looters===2)return fail("BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK",
  "Record separate authentic client observations of both pilots' combat, mission credit and rewards; native loot is not proof both fought",details);
 if(best.looters===1)return fail("ONE_PILOT_NATIVE_LOOT_OBSERVED",
  "Verify a separate real item pickup by the second pilot from this exact physical wreck; then verify actual two-client combat",details);
 return fail("PHYSICAL_RAID_WRECK_OBSERVED",
  "Use real native wreck inventory UI to loot with both pilots; source-debit must be confirmed for each",details);
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),i=args.indexOf("--window-minutes");
  if(args.length!==0&&(args.length!==2||i!==0))throw Error("usage: node scripts/coop-pve-chain.cjs [--window-minutes 120]");
  const minutes=i>=0?Number(args[i+1]):120;
  const report=summarize(fs.readFileSync(0,"utf8"),{minutes});
  console.log(JSON.stringify(report,null,2));
  if(report.status==="INVALID_EVENT_STREAM")process.exitCode=2;
 }catch(e){console.error("Co-op PvE chain report failed:",e.message);process.exitCode=2;}
}
module.exports={parse,crew,latestCrew,summarize};
