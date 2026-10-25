"use strict";
// Co-op P1: a real native convoy raid becomes an actionable fleet operation.
// Tags are native fleet target tags; cargo/ships/attack and wallet ownership
// remain exclusively in pinned EveJS. No simulated combat or reward grants.
const id=value=>{
 const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:0;
};
const vector=p=>p&&["x","y","z"].every(k=>Number.isFinite(Number(p[k])));
const distance=(a,b)=>Math.round(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z));
const INTENT_ROLES=new Set(["intercept","escort","salvage","haul"]);
const ACTIONS=new Set(["attack","warp-to-hauler"]);
function oreAmount(rows){
 if(!Array.isArray(rows))return 0;
 let total=0;
 for(const item of rows){
  const quantity=Number(item?.quantity);
  if(Number(item?.moduleID||0)!==0||!id(item?.typeID)||
   !Number.isSafeInteger(quantity)||quantity<=0)continue;
  total=Math.min(Number.MAX_SAFE_INTEGER,total+quantity);
 }
 return total;
}
function defaultDeps(){
 return {
  getScene:session=>require("./runtime").getSceneForSession(session),
  getFleets:()=>require("../services/fleets/fleetRuntime"),
  getMiningFleets:systemID=>
   require("../services/mining/miningNpcOperations").getMiningFleetsForSystem(systemID),
  getCargo:entityID=>require("./npc/nativeNpcStore").listNativeCargoForEntity(entityID),
  getWreck:wreckID=>require("./npc/nativeNpcStore").getNativeWreck(wreckID),
  getItem:itemID=>require("../services/inventory/itemStore").findItemById(itemID),
  getContracts:session=>{
   const native=require("../services/contracts/contractRuntimeState");
   return [...native.filterMyCurrentContracts(session,false,false),
    ...native.filterMyCurrentContracts(session,true,false)];
  },
  send:(session,message,chatHub)=>{
   if(chatHub&&typeof chatHub.sendSystemMessage==="function")
    return chatHub.sendSystemMessage(session,message);
   return require("../services/chat/chatHub").sendSystemMessage(session,message);
  }
 };
}
function createOperations(options={}){
 const {
  clock=()=>Date.now(),maxIncidents=128,ttlMs=10*60*1000,
  getScene=defaultDeps().getScene,getFleets=defaultDeps().getFleets,
  getMiningFleets=defaultDeps().getMiningFleets,
  getCargo=defaultDeps().getCargo,getWreck=defaultDeps().getWreck,
  getContracts=defaultDeps().getContracts,getItem=defaultDeps().getItem,
  send=defaultDeps().send
 }=options;
 if([clock,getScene,getFleets,getMiningFleets,getCargo,getWreck,getContracts,getItem,send]
   .some(fn=>typeof fn!=="function")||
   !Number.isSafeInteger(maxIncidents)||maxIncidents<1||maxIncidents>1024||
   !Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>3600000)
  throw Error("INVALID_COOP_FLEET_OPERATIONS_CONFIG");
 const incidents=new Map(),roleIntents=new Map(),resolved=new Map();
 const now=()=>{const n=Number(clock());return Number.isFinite(n)&&n>=0?n:0;};
 const key=(systemID,pirateID,targetID)=>[systemID,pirateID,targetID].join(":");
 function prune(at){
  for(const [k,inc] of incidents)if(inc.expiresAt<=at)incidents.delete(k);
  for(const [k,row] of roleIntents)if(row.expiresAt<=at||!incidents.has(row.incidentKey))
   roleIntents.delete(k);
  for(const [k,row] of resolved)if(row.expiresAt<=at)resolved.delete(k);
  while(resolved.size>maxIncidents)resolved.delete(resolved.keys().next().value);
  while(incidents.size>maxIncidents){
   const first=incidents.keys().next().value;incidents.delete(first);
  }
  while(roleIntents.size>maxIncidents*3)roleIntents.delete(roleIntents.keys().next().value);
 }
 function liveMiningMembership(systemID,targetID,role){
  const fleets=getMiningFleets(systemID);
  if(!Array.isArray(fleets))return false;
  const field=role==="hauler"?"haulerEntityIDs":"minerEntityIDs";
  return fleets.some(f=>id(f?.systemID)===systemID&&
   Array.isArray(f?.[field])&&f[field].some(v=>id(v)===targetID));
 }
 function physical(scene,entityID){
  const entity=scene?.getEntityByID?.(entityID);
  return entity?.kind==="ship"&&entity.nativeNpc===true&&
   id(entity.itemID)===entityID&&vector(entity.position)?entity:null;
 }
 function recordNativeRaid({scene,systemID,actions=[],fleetShips=[]}={}){
  const system=id(systemID),at=now();
  if(!system||id(scene?.systemID||scene?.solarSystemID)!==system||
    typeof scene?.getEntityByID!=="function"||
    !Array.isArray(actions)||!Array.isArray(fleetShips))
   return {status:"INVALID_NATIVE_SCENE",accepted:0};
  prune(at);
  const targets=new Map(fleetShips.filter(x=>id(x?.id)&&
   ["miner","hauler"].includes(x.role)).map(x=>[id(x.id),x.role]));
  let accepted=0;
  for(const action of actions.slice(0,64)){
   const pirateID=id(action?.pirateID),targetID=id(action?.targetID);
   const role=targets.get(targetID);
   if(!ACTIONS.has(action?.action)||!pirateID||!targetID||
    pirateID===targetID||role!==action.targetRole)continue;
   const pirate=physical(scene,pirateID),target=physical(scene,targetID);
   if(!pirate||!target||!liveMiningMembership(system,targetID,role))continue;
   const ore=oreAmount(getCargo(targetID));
   if(ore<=0)continue; // raid on an empty/fake convoy isn't economic gameplay
   const incidentKey=key(system,pirateID,targetID),previous=incidents.get(incidentKey);
   const phase=action.action==="attack"?"UNDER_ATTACK":
    previous?.phase==="UNDER_ATTACK"?"UNDER_ATTACK":"APPROACHING";
   incidents.delete(incidentKey);
   incidents.set(incidentKey,{
    key:incidentKey,systemID:system,pirateID,targetID,targetRole:role,
    phase,startedAt:previous?.startedAt||at,lastVerifiedAt:at,
    expiresAt:at+ttlMs
   });
   accepted++;
  }
  prune(at);
  return {status:accepted?"RECORDED_NATIVE_ACTION":"NO_ELIGIBLE_NATIVE_ACTION",accepted};
 }
 function recordNativeWreck({systemID,npcID,wreckID}={}){
  const system=id(systemID),victim=id(npcID),wreck=id(wreckID),at=now();
  if(!system||!victim||!wreck)return {status:"INVALID_NATIVE_WRECK",resolved:0};
  const row=getWreck(wreck);
  // Wreck identity comes from the actual native sourceEntityID, NEVER
  // the last ship targeted, a log message or a guessed killer.
  if(!row||id(row.wreckID)!==wreck||id(row.systemID)!==system||
   id(row.sourceEntityID)!==victim)
   return {status:"NATIVE_WRECK_IDENTITY_MISMATCH",resolved:0};
  prune(at);
  let count=0;
  for(const [k,inc] of incidents){
   if(inc.systemID!==system||
     (inc.pirateID!==victim&&inc.targetID!==victim))continue;
   const outcome=inc.pirateID===victim?"PIRATE_DESTROYED":"CONVOY_SHIP_LOST";
   resolved.set(k,{...inc,phase:outcome,wreckID:wreck,
    resolvedAt:at,expiresAt:at+ttlMs});
   incidents.delete(k);
   count++;
  }
  prune(at);
  return {status:count?"REAL_WRECK_RESOLVED_OPERATION":"NO_MATCHING_ACTIVE_OPERATION",
   resolved:count};
 }
 function liveIncident(scene,incident){
  if(id(scene?.systemID||scene?.solarSystemID)!==incident.systemID)return null;
  const pirate=physical(scene,incident.pirateID),target=physical(scene,incident.targetID);
  if(!pirate||!target||!liveMiningMembership(incident.systemID,incident.targetID,incident.targetRole))
   return null;
  const ore=oreAmount(getCargo(incident.targetID));
  return {...incident,pirate,target,ore};
 }
 function incidentsForScene(scene){
  const at=now();prune(at);
  const out=[];
  for(const [k,inc] of incidents){
   const live=liveIncident(scene,inc);
   if(!live){incidents.delete(k);continue;}
   out.push(live);
  }
  return out.sort((a,b)=>Number(b.phase==="UNDER_ATTACK")-Number(a.phase==="UNDER_ATTACK")||
   b.lastVerifiedAt-a.lastVerifiedAt).slice(0,8);
 }
 function fleetContext(session,scene){
  const characterID=id(session?.characterID),space=session?._space;
  const systemID=id(space?.systemID);
  const shipID=id(space?.shipID);
  if(!characterID||!shipID||!systemID||
   id(scene?.systemID||scene?.solarSystemID)!==systemID||
   space.initialStateSent!==true||session.socket?.destroyed===true||
   scene.getEntityByID(shipID)?.kind!=="ship"||
   !scene.sessions?.values||![...scene.sessions.values()].includes(session))
    return {ok:false,reason:"LOGIN_OR_PHYSICAL_SHIP_NOT_READY"};
  const fleets=getFleets();
  const fleet=fleets.getFleetForCharacter(characterID);
  if(!fleet||!fleets.getMemberRecord(fleet,characterID))
   return {ok:false,reason:"JOIN_NATIVE_EVE_FLEET_FIRST"};
  const counted=new Map(),duplicates=new Set();
  for(const member of scene.sessions.values()){
   const cid=id(member?.characterID),sid=id(member?._space?.shipID);
   if(!cid||!sid||id(member?._space?.systemID)!==systemID||
    member._space.initialStateSent!==true||member.socket?.destroyed===true||
    scene.getEntityByID(sid)?.kind!=="ship"||
    !fleets.getMemberRecord(fleet,cid))continue;
   if(counted.has(cid)){duplicates.add(cid);continue;}
   counted.set(cid,{session:member,characterID:cid,shipID:sid});
  }
  const crew=[...counted.values()].filter(x=>!duplicates.has(x.characterID));
  if(!crew.some(x=>x.session===session)||crew.length<2)
   return {ok:false,reason:"NEED_TWO_DISTINCT_READY_FLEET_SHIPS"};
  return {ok:true,scene,fleet,crewmates:crew,characterID,systemID,fleets};
 }
 function convoySummary(scene,systemID){
  const fleets=getMiningFleets(systemID);
  const ships=[],seen=new Set();
  for(const fleet of (Array.isArray(fleets)?fleets:[])){
   if(id(fleet?.systemID)!==systemID)continue;
   for(const [role,field] of [["miner","minerEntityIDs"],["hauler","haulerEntityIDs"]]){
    for(const raw of (Array.isArray(fleet[field])?fleet[field]:[])){
     const entityID=id(raw);
     if(!entityID||seen.has(entityID)||!physical(scene,entityID))continue;
     seen.add(entityID);
     ships.push({entityID,role,ore:oreAmount(getCargo(entityID))});
    }
   }
  }
  return ships.sort((a,b)=>b.ore-a.ore).slice(0,12);
 }
 function execute(session,argumentText="",chatHub=null){
  try{
   const tokens=String(argumentText||"").trim().split(/\s+/).filter(Boolean);
   const command=String(tokens[0]||"status").toLowerCase();
   if(command==="help")return {status:"HELP",message:
    "Co-op operations: /coopops status | convoy | deliveries | escort <contractID> | focus <pirateID> | guard <haulerID> | role <intercept|escort|salvage|haul> [pirateID]. Uses real native ships, fleet tags and contract rewards only."};
   const scene=getScene(session),ctx=fleetContext(session,scene);
   if(!ctx.ok)return {status:ctx.reason,message:"[Co-op] "+ctx.reason+
     ". Two authenticated ships in one native fleet/system are required."};
   const ongoing=incidentsForScene(scene);
   if(command==="status"){
    if(!ongoing.length){
     const recent=[...resolved.values()].filter(x=>x.systemID===ctx.systemID)
      .sort((a,b)=>b.resolvedAt-a.resolvedAt)[0];
     if(recent)return {status:"REAL_WRECK_OPERATION_RESOLVED",
      message:"[Co-op] Confirmed native wreck #"+recent.wreckID+
       ": "+recent.phase+" near convoy #"+recent.targetID+
       ". Use native EVE salvage/loot if you can access the actual wreck."};
     return {status:"NO_NATIVE_RAID",message:
      "[Co-op] Fleet "+ctx.crewmates.length+"/2 ready. No verified native convoy raid here. Use /coopops convoy to inspect real mining cargo."};
    }
    const lines=ongoing.slice(0,3).map(x=>
     x.phase+" pirate #"+x.pirateID+" → "+x.targetRole+" #"+x.targetID+
     " (real ore "+x.ore+", "+Math.round(distance(x.pirate.position,x.target.position)/1000)+" km)");
    const fleetID=id(ctx.fleet.fleetID);
    const roleSummaries=[...roleIntents.values()]
     .filter(row=>row.incidentKey===ongoing[0].key&&row.fleetID===fleetID&&
       ctx.crewmates.some(member=>member.characterID===row.characterID&&
         member.shipID===row.shipID))
     .slice(0,8).map(row=>"#"+row.characterID+"="+row.role);
    return {status:"LIVE_NATIVE_RAID",message:
     "[Co-op] Active native convoy incidents: "+lines.join("; ")+
     (roleSummaries.length?" | Actual fleet role pledges: "+roleSummaries.join(", "):"")+
     ". Commander: /coopops focus <pirateID> and /coopops guard <haulerID>. Each pilot may choose /coopops role <role>."};
   }
   if(command==="convoy"){
    const ships=convoySummary(scene,ctx.systemID);
    return {status:ships.length?"NATIVE_CARGO_VISIBLE":"NO_REAL_MINING_CONVOY",
     message:ships.length
      ?"[Co-op] Native mining convoy: "+ships.map(x=>
       x.role+" #"+x.entityID+" ore="+x.ore).join("; ")+
       ". Cover the hauler while your partner fights; real item exchange/courier contracts and the market handle player earnings."
      :"[Co-op] No verified native mining ships in this system. No virtual cargo or fake rewards."};
   }
   // Courier contracts are NOT virtual work orders. Read only native
   // records that EveJS's own character filter grants to this caller.
   const visibleCourierContracts=()=>{
    const records=getContracts(session);
    if(!Array.isArray(records))return [];
    const selected=new Map();
    for(const contract of records){
     const contractID=id(contract?.contractID);
     if(!contractID||contract?.forCorp===true||Number(contract.type)!==3||
      ![0,1].includes(Number(contract.status))||
      (id(contract.issuerID)!==ctx.characterID&&
       id(contract.acceptorID)!==ctx.characterID))continue;
     selected.set(contractID,contract);
    }
    return [...selected.values()].sort((a,b)=>id(b.contractID)-id(a.contractID));
   };
   if(command==="deliveries"){
    const rows=visibleCourierContracts().slice(0,6);
    return {status:rows.length?"NATIVE_COURIER_CONTRACTS":"NO_NATIVE_COURIER_CONTRACTS",
     message:rows.length
      ?"[Co-op] Authentic EVE courier contracts: "+rows.map(c=>
       "#"+id(c.contractID)+" "+(Number(c.status)===1?"IN_PROGRESS":"OUTSTANDING")+
       " station "+id(c.startStationID)+" → "+id(c.endStationID)+
       " reward="+Math.max(0,Number(c.reward)||0)+" ISK").join("; ")+
       ". The acceptor must carry the actual plastic wrap and finish in the native contract UI."
      :"[Co-op] No own/accepted native courier contract. Create or accept one using EVE's actual contracts UI."};
   }
   if(command==="escort"){
    if(tokens.length!==2||!id(tokens[1]))
     return {status:"INVALID_CONTRACT_ID",message:"Usage: /coopops escort <native contractID>"};
    const contractID=id(tokens[1]);
    const contract=visibleCourierContracts().find(x=>id(x.contractID)===contractID);
    if(!contract||Number(contract.status)!==1)
     return {status:"NOT_AN_ACCEPTED_NATIVE_CONTRACT",message:
      "[Co-op] Contract is not your in-progress personal courier contract."};
    const issuer=id(contract.issuerID),acceptor=id(contract.acceptorID);
    const courier=ctx.crewmates.find(x=>x.characterID===acceptor);
    if(!courier||issuer===acceptor||
       !ctx.crewmates.some(x=>x.characterID===issuer))
     return {status:"CONTRACT_PARTIES_NOT_IN_NATIVE_FLEET",message:
      "[Co-op] The real courier and issuer must both be in this native fleet."};
    const wrapID=id(contract.plasticWrapItemID),wrap=wrapID?getItem(wrapID):null;
    // Only advertise a "live protected courier" when the package is
    // PHYSICALLY in the acceptor's ship cargo. Docked hangar ≠ in transit.
    if(!wrap||id(wrap.itemID)!==wrapID||
       id(wrap.ownerID)!==acceptor||id(wrap.locationID)!==courier.shipID)
     return {status:"NATIVE_COURIER_PACKAGE_NOT_LOADED",message:
      "[Co-op] Courier must move the genuine plastic-wrapped package into the active ship's cargo first."};
    const changed=ctx.fleets.setFleetTargetTag(session,courier.shipID,"3")===true;
    const me=ctx.fleets.getMemberRecord(ctx.fleet,ctx.characterID),fc=ctx.fleets.FLEET;
    const permitted=Boolean(me&&fc&&(
      (Number(me.job||0)&Number(fc.FLEET_JOB_CREATOR||0))!==0||
      Array.isArray(fc.FLEET_CMDR_ROLES)&&fc.FLEET_CMDR_ROLES.includes(Number(me.role))));
    const tag=typeof ctx.fleets.getTargetTagForCharacter==="function"
     ?ctx.fleets.getTargetTagForCharacter(ctx.characterID,courier.shipID):null;
    if(!changed&&(!permitted||tag!=="3"))
     return {status:"NATIVE_COMMAND_PERMISSION_DENIED",message:
      "[Co-op] Only an authorized native fleet commander can tag the courier."};
    for(const member of ctx.crewmates)if(member.characterID!==ctx.characterID){
     try{send(member.session,"[Co-op] Protect courier ship #"+courier.shipID+
      " (native fleet tag 3), contract #"+contractID+" to station #"+
      id(contract.endStationID)+". The actual contract pays rewards only when completed.",chatHub);}catch(_){}
    }
    return {status:changed?"NATIVE_COURIER_ESCORT_TAGGED":"NATIVE_COURIER_ESCORT_ALREADY_TAGGED",
     message:"[Co-op] Real contract #"+contractID+" escort assigned to native ship #"+
      courier.shipID+" (tag 3). Destination station #"+id(contract.endStationID)+
      ". No ISK or cargo created."};
   }
   if(command==="focus"||command==="guard"){
    if(tokens.length!==2||!id(tokens[1]))
     return {status:"INVALID_TARGET",message:"Usage: /coopops "+command+" <native entityID>"};
    const targetID=id(tokens[1]);
    const match=ongoing.find(x=>command==="focus"?x.pirateID===targetID:x.targetID===targetID);
    if(!match)return {status:"NO_VERIFIED_INCIDENT_TARGET",
     message:"[Co-op] Target is not in a verified active NPC convoy incident."};
    const tag=command==="focus"?"1":"2";
    const changed=ctx.fleets.setFleetTargetTag(session,targetID,tag)===true;
    const currentTag=typeof ctx.fleets.getTargetTagForCharacter==="function"
      ?ctx.fleets.getTargetTagForCharacter(ctx.characterID,targetID):null;
    const me=ctx.fleets.getMemberRecord(ctx.fleet,ctx.characterID);
    const fc=ctx.fleets.FLEET;
    const authorized=Boolean(me&&fc&&(
      (Number(me.job||0)&Number(fc.FLEET_JOB_CREATOR||0))!==0||
      Array.isArray(fc.FLEET_CMDR_ROLES)&&fc.FLEET_CMDR_ROLES.includes(Number(me.role))));
    if(!changed&&(!authorized||currentTag!==tag))
     return {status:"NATIVE_COMMAND_PERMISSION_DENIED",
      message:"[Co-op] Only an authorized native EVE fleet commander can tag a target."};
    if(!changed)return {status:"NATIVE_FLEET_TARGET_ALREADY_TAGGED",targetID,tag,
     message:"[Co-op] Native fleet target #"+targetID+" already carries tag "+tag+"."};
    const label=command==="focus"?"INTERCEPT PIRATE":"PROTECT CONVOY";
    for(const member of ctx.crewmates)if(member.characterID!==ctx.characterID){
     try{send(member.session,"[Co-op] Fleet tag "+tag+" "+label+" #"+targetID+
      ". Use real locking/weapons, tackle, remote repair and native warp.",chatHub);}catch(_){}
    }
    return {status:"NATIVE_FLEET_TARGET_TAG_SET",targetID,tag,
     message:"[Co-op] Native fleet target tag "+tag+" set on #"+targetID+
      " ("+label+"). No automated module activation."};
   }
   if(command==="role"){
    if(tokens.length<2||tokens.length>3||!INTENT_ROLES.has(tokens[1]))
     return {status:"INVALID_ROLE",message:
      "Usage: /coopops role <intercept|escort|salvage|haul> [pirateID]"};
    const chosen=tokens[2]?ongoing.find(x=>x.pirateID===id(tokens[2])):ongoing[0];
    if(!chosen)return {status:"NO_NATIVE_RAID",message:
     "[Co-op] No real convoy attack to organize here."};
    const role=tokens[1],roleKey=chosen.key+":"+ctx.characterID;
    roleIntents.set(roleKey,{role,characterID:ctx.characterID,
     fleetID:id(ctx.fleet.fleetID),shipID:id(session._space.shipID),
     incidentKey:chosen.key,expiresAt:now()+ttlMs});
    prune(now());
    const others=ctx.crewmates.filter(x=>x.characterID!==ctx.characterID);
    for(const member of others){
     try{send(member.session,"[Co-op] Fleet pilot #"+ctx.characterID+
      " volunteered "+role+" on real convoy #"+chosen.targetID+
      ". Coordinate a different role; the game still requires real ship actions.",chatHub);}catch(_){}
    }
    const assigned=[...roleIntents.values()].filter(x=>x.incidentKey===chosen.key&&
     x.fleetID===id(ctx.fleet.fleetID)&&
     ctx.crewmates.some(m=>m.characterID===x.characterID&&m.shipID===x.shipID));
    const unique=new Set(assigned.map(x=>x.characterID));
    return {status:unique.size>=2&&new Set(assigned.map(x=>x.role)).size>=2
      ?"COMPLEMENTARY_ROLES_DECLARED":"ROLE_DECLARED",
     message:"[Co-op] Your "+role+" role is noted for real convoy #"+chosen.targetID+
      ". Roles are coordination only: no passive bonuses, synthetic earnings or automatic shots."};
   }
   return {status:"UNKNOWN_COMMAND",message:
    "Usage: /coopops help | status | convoy | deliveries | escort <contractID> | focus <pirateID> | guard <haulerID> | role <role> [pirateID]"};
  }catch(error){
   return {status:"NATIVE_OPERATION_UNAVAILABLE",message:
    "[Co-op] Native fleet/raid validation unavailable: "+
    String(error?.message||error).replace(/[<>\x00-\x1f]/g," ").slice(0,100)};
  }
 }
 function snapshot(){
  prune(now());
  return {incidents:[...incidents.values()].map(x=>({...x})),
   roles:[...roleIntents.values()].map(x=>({...x})),
   resolved:[...resolved.values()].map(x=>({...x}))};
 }
 return {recordNativeRaid,recordNativeWreck,execute,incidentsForScene,snapshot};
}
let singleton=null;
function instance(){
 if(!singleton)singleton=createOperations();
 return singleton;
}
function recordNativeRaid(args){return instance().recordNativeRaid(args);}
function recordNativeWreck(args){return instance().recordNativeWreck(args);}
function execute(session,argumentText,chatHub){return instance().execute(session,argumentText,chatHub);}
module.exports={createOperations,recordNativeRaid,recordNativeWreck,execute,oreAmount};
