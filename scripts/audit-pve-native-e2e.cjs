"use strict";
// Read-only timeline correlation of LIVE original-source runtime receipts.
// Never mint gameplay proof from synthetic scenario files, inferred loot,
// native dialogue ACKs, or source-only tests.
const fs=require("node:fs");
const positive=n=>Number.isSafeInteger(n)&&n>0;
const numeric=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const pair=xs=>Array.isArray(xs)&&xs.length===2&&xs.every(positive)&&xs[0]!==xs[1];
function normalize(input){
 let records;
 try{records=String(input||"").split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))}
 catch{return {status:"INVALID_NATIVE_EVENT_LOG",records:[]}}
 if(records.length>100000)return {status:"EVENT_LOG_TOO_LARGE",records:[]};
 const filtered=[];
 for(const [i,row] of records.entries()){
  if(!row||typeof row.event!=="string")return {status:"INVALID_NATIVE_EVENT_LOG",records:[]};
  const t=Date.parse(row.at);
  if(!Number.isFinite(t))return {status:"INVALID_NATIVE_EVENT_LOG",records:[]};
  filtered.push({...row,_t:t,_seq:i});
 }
 filtered.sort((a,b)=>a._t-b._t||a._seq-b._seq);
 return {status:"PARSED",records:filtered};
}
function receiptsMatch(b,c,t){
 const char=t.characterIDs,seq=t.missionSequences;
 if(!pair(char)||!pair(seq)||!Array.isArray(b.recipients)||
    !Array.isArray(c.recipients)||b.recipients.length!==2||
    c.recipients.length!==2)return false;
 const seenWallet=new Set(),seenChar=new Set();
 for(let i=0;i<2;i++){
  const player=char[i],sequence=seq[i];
  const reward=b.recipients.find(x=>x?.characterID===player),
   custody=c.recipients.find(x=>x?.characterID===player);
  if(!reward||!custody||seenChar.has(player)||
     reward.missionSequence!==sequence||custody.missionSequence!==sequence||
     !numeric(reward.iskDelta)||!numeric(reward.lpDelta)||
     !positive(reward.corporationID)||!positive(reward.missionWalletTransactionID)||
     seenWallet.has(reward.missionWalletTransactionID)||
     custody.itemCount<0||!Number.isSafeInteger(custody.itemCount)||
     !positive(custody.stationID)||!Array.isArray(custody.expectedTypes)||
     !Array.isArray(custody.newItemIDs)||
     !Array.isArray(custody.standingTransactions))return false;
  const total=custody.expectedTypes.reduce((n,x)=>
   positive(x?.typeID)&&Number.isSafeInteger(x.quantity)&&x.quantity>0?n+x.quantity:NaN,0);
  if(!Number.isSafeInteger(total)||total!==custody.itemCount||
     new Set(custody.newItemIDs).size!==custody.newItemIDs.length||
     custody.newItemIDs.some(x=>!positive(x)))return false;
  for(const standing of custody.standingTransactions)
   if(!positive(standing?.ownerID)||!positive(standing?.eventTypeID)||
      !Number.isFinite(standing?.rawModification)||
      typeof standing.eventDateTime!=="string"||
      !standing.eventDateTime)return false;
  seenWallet.add(reward.missionWalletTransactionID);
  seenChar.add(player);
 }
 return seenWallet.size===2&&seenChar.size===2;
}
function analyze(input){
 const parsed=normalize(input);
 const base={status:"NO_NATIVE_DUO_SOURCE_RECEIPTS",
  bossWreckLinked:false,duoPayoutSourceLinked:false,
  originalNativeItemStandingLinked:false,
  genuineClientsVerified:false,gameplayVerified:false,
  actualRareDropVerified:false,serverRestartVerified:false};
 if(parsed.status!=="PARSED")return {...base,status:parsed.status};
 const logs=parsed.records;
 const deaths=logs.filter(x=>x.event==="living-pve-native-boss-death"&&
  x.status==="ORIGINAL_BOSS_WRECK_CONFIRMED"&&positive(x.systemID)&&
  positive(x.instanceID)&&positive(x.wreckID)&&
  Number.isSafeInteger(x.itemCount)&&x.itemCount>=0);
 const turnins=logs.filter(x=>x.event==="living-pve-duo-native-mission-turnin"&&
  x.status==="TWO_NATIVE_PERSONAL_MISSION_RECORDS_CLEARED"&&
  positive(x.sourceInstanceID)&&positive(x.fleetID)&&positive(x.agentID)&&
  positive(x.systemID)&&pair(x.characterIDs)&&pair(x.missionSequences));
 if(!deaths.length||!turnins.length)return {...base,
  status:!deaths.length?"NATIVE_BOSS_WRECK_NOT_OBSERVED":"NATIVE_DUO_MISSION_TURNIN_NOT_OBSERVED",
  bossWreckLinked:deaths.length>0};
 const evidence=logs.filter(x=>x.event==="living-pve-duo-native-reward-evidence"&&
  x.status==="TWO_INDEPENDENT_NATIVE_WALLET_LP_AND_HISTORY_VERIFIED");
 const custody=logs.filter(x=>x.event==="living-pve-duo-native-reward-custody"&&
  x.status==="TWO_ORIGINAL_REWARD_ITEMS_AND_STANDING_TRANSACTIONS_VERIFIED");
 let duoWithoutBoss=false;
 for(const turnin of [...turnins].reverse()){
  const matching=(row)=>row.sourceInstanceID===turnin.sourceInstanceID&&
   row.fleetID===turnin.fleetID&&row.agentID===turnin.agentID&&
   row.systemID===turnin.systemID&&row._t<=turnin._t&&
   turnin._t-row._t<=3*60*60*1000;
  const reward=evidence.findLast(x=>matching(x));
  const cargo=custody.findLast(x=>matching(x));
  if(!reward||!cargo||!receiptsMatch(reward,cargo,turnin))continue;
  duoWithoutBoss=true;
  const kill=deaths.findLast(x=>x.instanceID===turnin.sourceInstanceID&&
   x.systemID===turnin.systemID&&x._t<=cargo._t&&
   cargo._t-x._t<=3*60*60*1000);
  if(!kill)continue;
  if(cargo._t>reward._t||reward._t>turnin._t)continue;
  return {...base,status:"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED",
   bossWreckLinked:true,duoPayoutSourceLinked:true,
   originalNativeItemStandingLinked:true,
   distinctNativeRecipients:2,linkedNativeBossWrecks:1,
   // A server event is not evidence of real connected/rendering clients.
   runtimeEvidence:"ORIGINAL_NATIVE_BOSS_WRECK_AND_TWO_PERSONAL_SOURCE_WALLET_LP_ITEM_STANDING_RECEIPTS",
   genuineClientsVerified:false,gameplayVerified:false};
 }
 return {...base,status:duoWithoutBoss?
  "NATIVE_BOSS_WRECK_NOT_LINKED_TO_DUO_MISSION":
  "TWO_PERSONAL_REWARD_SOURCE_CHAINS_NOT_MATCHED",
  duoPayoutSourceLinked:duoWithoutBoss};
}
function main(){
 if(process.argv.length!==4||process.argv[2]!=="--events")
  throw Error("Usage: node scripts/audit-pve-native-e2e.cjs --events <live-native-JSONL>");
 const file=process.argv[3];if(!fs.statSync(file).isFile())throw Error("Not a file");
 const value=analyze(fs.readFileSync(file,"utf8"));
 console.log(JSON.stringify(value,null,2));
 if(value.status!=="SERVER_NATIVE_DUO_CAUSALITY_CORRELATED")process.exitCode=2;
}
if(require.main===module)try{main()}catch(err){
 console.error("[PVE_NATIVE_E2E_AUDIT]",err.message);process.exitCode=2;
}
module.exports={analyze,normalize,receiptsMatch};
