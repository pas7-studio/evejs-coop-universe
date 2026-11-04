"use strict";

// Faction-war subsystem, moved verbatim out of coopVirtualWorldRuntime.js on 2026-11-04.
//
// Why a module: the runtime file had grown to ~6 000 lines in one scope, and the war
// half of it (registry, treasury, bounty board, navy capability, mobiliser, garrison,
// gate staging, objectives, diagnostics) was a contiguous block that shared almost
// nothing with the world tick beside it.
//
// How it is wired: this subsystem OWNS its singletons - the war mirror, the chest,
// navy capability, the merit ledger, the settlement, the mobiliser, garrison, battle
// director, engagement posture, gate staging/handoff, demobiliser, objective director,
// opening, relief, the opening/garrison tick stamps, the memo cache, the casualty seed
// flag. They are declared here and nowhere else. The parent does not keep a copy: the
// 2026-10-28 split broke the live stack precisely because 23 names ended up declared
// in two modules and kept equal by hand (docs/FORK_PATCH_AUDIT_20261028.md).
//
// Everything the slice needs from the parent is an explicit, read-only dependency:
//   getWorld()                     the world handle start() creates and replaces
//   getIdentityRegistry()          the native pilot-identity registry
//   getTacticsDirector()           fleet tactics director (isTactical/idle probes)
//   getNativeAmmoSupply()          native ammo supply authority (retreat probes)
//   getCasualtyLedger()            the parent still CREATES the casualty ledger
//   bootstrapTerritoriesFromPresence  territory derivation stays with the parent
//   npcOrderBridge                 the NPC order bridge the war phases issue through
//   ensureMarketTrader             the market trader the chest and levy settle against
//
// Re-exported for the parent: currentWarGateHandoff(), because syncWarRuntime() hands
// that instance to the pure-layer mirror. The handoff itself is owned here.
const {visitedSystems,destroyedNativeShips,nativeWarFleetRegistry,warSkipReasons,warSkip,warFrontChat,warTreasuryStore,warPresencePilots,warFactionCorporation,pickFundingCorporation,presenceSummary,ensureWarRecoverySocket,releaseSpawnedIdentity} = require("./coopVirtualWorldRuntime.pure");

function createWarRuntime({ getWorld, getIdentityRegistry, getTacticsDirector, getNativeAmmoSupply,
 getCasualtyLedger, bootstrapTerritoriesFromPresence, npcOrderBridge, ensureMarketTrader }) {
 for (const [name, value] of Object.entries({ getWorld, getIdentityRegistry, getTacticsDirector,
  getNativeAmmoSupply, getCasualtyLedger, bootstrapTerritoriesFromPresence, npcOrderBridge,
  ensureMarketTrader })) {
  if (typeof value !== "function") throw Error("WAR_RUNTIME_DEPENDENCY_MISSING:" + name);
 }
 let warDoctrineInstance=null,warBattleDirector=null,warEngagement=null,warPosture=null,warGarrison=null,
  warMobilizer=null,warGateStaging=null,warGateHandoff=null,warDemobilizer=null,warObjectiveDirector=null,
  warOpening=null,warRelief=null,gateStagingSkipKey=null,followOrderReason=null;
 // Native wreck IDs this process confirmed (and, after a restart, the durable
 // casualty ledger): the only proof that a registered warship is really gone.
 let casualtySeedDone=false;
 // Real merit per pilot (coop-pilot-XXX -> record). Nothing promotes a pilot yet,
 // so it is empty and every commander is a recruit; the career phase fills it.
 // FW-009B: the durable merit ledger is the real source; it is read here so a
 // promotion earned by a confirmed kill immediately enlarges the command.
 let warMeritLedger=null;
 // A short-lived memo for values a world phase re-reads on every tick. Measured 2026-11-02: the garrison phase cost
 // 1.0-2.3 s per tick just to read the war state and clone the fleet registry, twice a minute, while the data it
 // reads changes at most once a cycle. Staleness is bounded by the TTL and never delays a real decision.
 const memoCache=new Map();

 function warHullRole(entityID){
  try{
   const native=require("./npc/nativeNpcStore").getNativeEntity(Number(entityID));
   const typeID=Number(native&&(native.shipTypeID||native.typeID))||0;
   if(!typeID)return "";
   if(!warDoctrineInstance)warDoctrineInstance=
    require("./coopWarDoctrine").createWarDoctrine();
   return String(warDoctrineInstance.roleForHullType(typeID)||"");
  }catch(_error){return ""}
 }
 function warMeritRecords(){
  if(!warMeritLedger){
   try{
    warMeritLedger=require("./coopWarMeritLedger").createWarMeritLedger({
     gameStore:require("../gameStore")});
   }catch(error){
    console.warn("[CoopWarMerit]",String(error&&error.message||error));
    return {};
   }
  }
  try{return warMeritLedger.records();}catch{return {}}
 }
 function memoFor(ttlMs,key,loader,options={}){
  const ttl=Math.max(0,Number(ttlMs)||0);
  const now=Date.now();
  const cached=memoCache.get(key);
  if(cached&&now-cached.at<ttl)return cached.value;
  if(options.wrap==="snapshot"){
   const real=loader();
   // Never Object.create(real) here: a frozen registry makes the snapshot
   // assignment throw and the whole phase dies (that is exactly what happened to
   // the garrison). The helper returns a writable copy, or the raw object.
   const wrapper=require("./coopMemoSnapshot").wrapSnapshot(real,source=>{
    const snapshotKey=key+":snapshot";
    const hit=memoCache.get(snapshotKey);
    if(hit&&Date.now()-hit.at<ttl)return hit.value;
    const value=typeof source.snapshot==="function"?source.snapshot():{};
    memoCache.set(snapshotKey,{at:Date.now(),value});
    return value;
   });
   memoCache.set(key,{at:now,value:wrapper});
   return wrapper;
  }
  const value=loader();
  memoCache.set(key,{at:now,value});
  return value;
 }
 function advanceNativeWarDemobilization(){
  const {enabled,createWarDemobilizer}=require("./coopWarDemobilizer");
  if(!enabled(process.env)||!visitedSystems.size||!getIdentityRegistry())return;
  const registry=nativeWarFleetRegistry(),guard=npcOrderBridge();
  if(!registry||!guard)return;
  if(!warDemobilizer){
   warDemobilizer=createWarDemobilizer({
    registry,
    readWarState:()=>warStateStore().read(),
    readLinks:()=>Object.values(getIdentityRegistry().snapshot()?.links||{}),
    getOrderLeases:()=>guard.snapshot().leases
   });
  }
  const result=warDemobilizer.tick({
   systemIDs:[...visitedSystems].slice(0,12)
  });
  if(result.demobilized.length)
   require("./coopRuntimeProbe").observe(
    "living-native-war-demobilized",null,null,{
     status:result.status,ships:result.demobilized,
     evidence:"TERMINAL_NATIVE_WAR_FLEET_RELEASE_NO_HULL_OR_CARGO_MUTATION"
    });
 }
 // FW-003C: real patrol mobilization on the SAME existing A-Life tick. Any
 // failed source proof results in zero military assignments, never free ships.
 // A war phase that returns silently cannot be diagnosed from the outside: the
 // reason is reported once per change instead, with a real event.
 // FW-050: the legacy namespace copy of the war state is a separate storage view
 // inside a ROW GROUP. Writing one member of a group can rebuild every member from
 // the cache on the next flush, which silently reverted the real treasury row
 // (escrow rows lost, journal counter rewound, wallet debits left unbacked). The
 // file mirror plus the atomic row restore the war without ever touching a sibling
 // row, so the dangerous copy is opt-in only.
 function legacyWarStateMirrorEnabled(env={}){
  // Only the exact "1" opt-in: a typo or a stray "true" must not re-arm a writer
  // that can revert a sibling atomic row.
  return String(env.EVEJS_COOP_WAR_STATE_LEGACY_MIRROR??"")==="1";
 }
 function warStateStore(){
  const {TABLE,KEY}=require("./coopFactionWarStore"),core=require("./coopFactionWarCore"),
   gameStore=require("../gameStore");
  const rows=gameStore.coopAtomicNativeRows;
  if(!rows||typeof rows.transact!=="function")throw Error("WAR_STORE_UNAVAILABLE");
  return {
   TABLE,KEY,
   read(){
    const value=rows.transact([TABLE],tx=>tx.get(TABLE,KEY));
    if(value==null)return null;
    core.validateState(value);
    return value;
   },
   write(state){
    core.validateState(state);
    // Every phase writes the WHOLE state after reading it, so a write that is not
    // merged can erase a record another phase just added (core.mergeWarRecords has the
    // measurement and the reasoning).
    let committed=state;
    rows.transact([TABLE],tx=>{
     committed=core.mergeWarRecords(tx.get(TABLE,KEY)||null,state);
     tx.put(TABLE,KEY,committed);
    });
    mirrorWarState(committed);
    // FW-042: keep the SECOND view in sync. Measured in the SQLite file: the legacy
    // namespace blob ("coop-faction-war", 9018 B) held treasury-v1 and merit-v1 but an
    // EMPTY state-v1, and the blob is what survives a container recreate, so the war
    // (wars + campaigns + territories) was erased while real ISK stayed in escrow.
    // Writing the same validated document into the legacy path means whichever view
    // the boot reconciliation prefers, it now contains the real war.
    // FW-050: this second copy is now OFF by default, because it was destroying real
    // money. `corporationRuntime` stores "coop-faction-war" as a row GROUP, so a write
    // to one member marks the whole group dirty and the next flush rebuilds EVERY
    // member from the in-memory cache - including `treasury-v1`, which the atomic
    // write path updates in SQLite without refreshing that cache. Measured at 22:2xZ:
    // the treasury row came back with 3 reservations and `nextJournalID` 3 while the
    // live events had already used escrow journals 8000000000000004..6, and two
    // ASSAULT campaigns lost their HELD escrow while the wallets kept the debits
    // (1000120 journal -25 000 ISK, no reservation behind it).
    // The legacy copy was never read back either: `warStateStore.read` reads the flat
    // atomic row, and boot recovery prefers the live record and otherwise the
    // validated FILE mirror (FW-041), which cannot touch a sibling row.
    if(legacyWarStateMirrorEnabled(process.env)){
     try{gameStore.write(TABLE,"/coop-faction-war/state-v1",committed);}
     catch(_error){/* the atomic row stays authoritative; this is a second copy */}
    }
   }
  };
 }
 // FW-041: the war record must survive a container recreate.
 //
 // Measured repeatedly on the work stack: the fleet registry, the casualty ledger,
 // the merit ledger and the treasury row all survived, while the war state row came
 // back EMPTY - so the campaign disappeared, the escrow kept holding real ISK and
 // no bounty could ever pay. A validated mirror on the data volume is a copy of the
 // authoritative record, never an invention: it is written after every successful
 // write and restored only when the atomic row is missing or unreadable, and it must
 // pass the core's own validateState before it is used.
 const WAR_MIRROR_FILE=()=>process.env.EVEJS_COOP_WAR_STATE_MIRROR_FILE||
  "/var/lib/evejs/coop-faction-war-mirror.json";
 function warMirrorEnabled(){
  return String(process.env.EVEJS_COOP_WAR_STATE_MIRROR??"1")!=="0";
 }
 // FW-051: the mirror now lives in its own SQLite table (space/coopWarMirror.js).
 // The JSON file is read once per install and then healed into the store, so it
 // is a migration source, not a second writer. A dedicated table cannot rebuild
 // a sibling row group, which is exactly what made the file necessary in FW-041.
 let warMirrorInstance=null;
 function warMirror(){
  if(warMirrorInstance)return warMirrorInstance;
  const core=require("./coopFactionWarCore");
  warMirrorInstance=require("./coopWarMirror").createWarMirror({
   gameStore:require("../gameStore"),
   validate:state=>core.validateState(state),
   file:WAR_MIRROR_FILE(),
   onHeal:()=>console.log("[CoopFactionWar] war mirror migrated from JSON file into coopWarMirror")
  });
  return warMirrorInstance;
 }
 function mirrorWarState(state){
  if(!warMirrorEnabled())return;
  try{warMirror().write(state);}
  catch(_error){/* a mirror is best effort, never a reason to fail a war write */}
 }
 function readWarMirror(){
  if(!warMirrorEnabled())return null;
  try{return warMirror().read();}
  catch(_error){return null}
 }
 // Pure: which record to use on boot. A mirror may only replace an ABSENT or EMPTY
 // record - it can never overwrite a live war with an older copy.
 function chooseWarRestore({current,mirror}={}){
  const liveSides=(state)=>Object.keys((state&&state.wars)||{}).length+
   Object.keys((state&&state.campaigns)||{}).length+
   Object.keys((state&&state.territories)||{}).length;
  if(!mirror)return {use:current||null,reason:"NO_MIRROR"};
  if(liveSides(mirror)===0)return {use:current||null,reason:"MIRROR_EMPTY_TOO"};
  if(current&&liveSides(current)>0)return {use:current,reason:"LIVE_RECORD_WINS"};
  return {use:mirror,reason:"RESTORED_FROM_MIRROR"};
 }
 // The war domain needs a valid state record to exist at all. Without it every
 // phase answers NO_WAR_STATE, which looks like a broken feature instead of an
 // empty world. One documented factory (`core.empty()`) owns the bootstrap, and
 // every war phase may call it - it is idempotent and never overwrites a record.
 function ensureWarState(){
  const store=warStateStore(),core=require("./coopFactionWarCore");
  const current=store.read();
  if(current)return current;
  // FW-041: restore the validated mirror instead of publishing an empty war.
  const restored=chooseWarRestore({current,mirror:readWarMirror()});
  if(restored.use&&restored.reason==="RESTORED_FROM_MIRROR"){
   store.write(restored.use);
   try{
    require("./coopRuntimeProbe").observe("living-native-war-state",null,null,
     {status:"RESTORED",version:core.VERSION,
      wars:Object.keys(restored.use.wars||{}).length,
      campaigns:Object.keys(restored.use.campaigns||{}).length,
      evidence:"VALIDATED_MIRROR_ON_DATA_VOLUME_NOT_AN_INVENTED_WAR"});
   }catch(_error){/* probe is best effort */}
   return restored.use;
  }
  const state=core.empty();
  store.write(state);
  console.log("[CoopFactionWar] empty war state created (version "+core.VERSION+")");
  try{
   require("./coopRuntimeProbe").observe("living-native-war-state",null,null,
    {status:"CREATED",version:core.VERSION,
     evidence:"DOCUMENTED_EMPTY_STATE_FACTORY_NO_CAMPAIGN_YET"});
  }catch(_error){/* probe is best effort */}
  return state;
 }
 // FW-010: open the first real war. The mobiliser can only reserve ships for a
 // campaign that already exists in the state, so this phase derives the war from
 // real presence + real reciprocal gates + real held ground, and writes it through
 // the authoritative core. One faction pair = one war; every open border under it
 // is its own campaign, so a war is multi-front by construction.
 // Front chat reports. Only real transitions call this, the text comes from
 // coopWarClientView.frontReport (built from real state), and each event is sent
 // once per process so a player is never spammed by a repeating tick.
 let warChestInstance=null,warTreasuryInstance=null,warBountyInstance=null;
 function warChestStore(){
  if(warChestInstance)return warChestInstance;
  const gameStore=require("../gameStore"),factions=require("../services/faction/factionState"),
   nativeRows=require("./coopNativeRowPath");
  const trader=ensureMarketTrader();
  if(!trader||typeof trader.adjustEarned!=="function")
   throw Error("WAR_CHEST_EARNED_LEDGER_UNAVAILABLE");
  warChestInstance=require("./coopWarChestFunding").createWarChestFunding({
   gameStore,
   journalFile:process.env.EVEJS_COOP_WAR_CHEST_JOURNAL||
    "/var/lib/evejs/coop-war-chest-journal.json",
   readWarState:()=>warStateStore().read(),
   adjustEarned:args=>trader.adjustEarned(args),
   verifyCorporation({corporationID,factionID},stored){
    if(!Number.isSafeInteger(corporationID)||!Number.isSafeInteger(factionID)||!stored||
     (stored.corporationID!==undefined&&stored.corporationID!==corporationID))return false;
    try{
     const corporation=require("../services/corporation/corporationState")
       .getCorporationRecord(corporationID),
      faction=factions.getFactionRecord(factionID);
     return corporation?.corporationID===corporationID&&
      corporation.isNPC===true&&faction?.factionID===factionID&&
      factions.getFactionIDForCorporation(corporationID)===factionID;
    }catch(_error){return false}
   }
  });
  void nativeRows;
  return warChestInstance;
 }
 function warEarnedLedger(){
  try{
   const trader=ensureMarketTrader();
   return trader?trader.snapshot():{version:1,pilots:{}};
  }catch(_error){return {version:1,pilots:{}}}
 }

 // FW-036: which factions can really field a navy, read from the same doctrine
 // composition the sanctioned spawn path uses. Never invents a hull, a doctrine
 // row or a charge; a mining laser is not a weapon family, so ORE is NO_NAVY.
 let warNavyCapabilityInstance=null;
 function warNavyCapability(){
  if(warNavyCapabilityInstance)return warNavyCapabilityInstance;
  try{
   const npcData=require("./npc/npcData"),
    itemTypes=require("../services/inventory/itemTypeRegistry"),
    dogma=require("./combat/weaponDogma"),
    authorities=require("./coopAdminBridgeActions").warFleetAuthorities();
   warNavyCapabilityInstance=require("./coopWarNavyCapability").createNavyCapability({
    compose:args=>authorities.composition.compose(args),
    getLoadout:id=>npcData.getNpcLoadout(id),
    isWeapon:typeID=>{
     const item=itemTypes.resolveItemByTypeID(Number(typeID));
     return Boolean(item&&dogma.resolveWeaponFamily(item));
    }
   });
  }catch(_error){warNavyCapabilityInstance=null}
  return warNavyCapabilityInstance;
 }
 // Read-only: the capability of every faction that appears in a live war, plus the
 // decision for each war, so "this border cannot be fought" is a measurement.
 function diagnoseNavy(){
  const capability=warNavyCapability();
  if(!capability)return {status:"UNAVAILABLE",factions:[],wars:[]};
  let state=null;
  try{state=warStateStore().read()}catch(_error){state=null}
  const factions=new Set();
  for(const war of Object.values(state?.wars||{})){
   if(!war||war.state!=="ACTIVE")continue;
   for(const id of [Number(war.attackerFactionID),Number(war.defenderFactionID)])
    if(Number.isSafeInteger(id)&&id>0)factions.add(id);
  }
  const rows=[...factions].sort((a,b)=>a-b).map(id=>{
   const r=capability.faction(id);
   return {factionID:id,status:r.status,armedHulls:r.armedHulls,
    loadouts:r.hulls.slice(0,3).map(h=>h.loadoutID)};
  });
  const wars=Object.values(state?.wars||{}).filter(w=>w&&w.state==="ACTIVE").map(w=>({
   warID:w.warID,attackerFactionID:Number(w.attackerFactionID),
   defenderFactionID:Number(w.defenderFactionID),
   decision:capability.decide({attackerFactionID:w.attackerFactionID,
    defenderFactionID:w.defenderFactionID}),
  }));
  return {status:"OK",factions:rows,wars};
 }
 function warBountyStore(){
  if(warBountyInstance)return warBountyInstance;
  const gameStore=require("../gameStore"),
   factions=require("../services/faction/factionState"),
   npcStore=require("./npc/nativeNpcStore"),
   casualtyStore=require("./coopWarCasualtyLedger"),
   nativeRows=require("./coopNativeRowPath");
  warBountyInstance=require("./coopWarBounty").createWarBounty({
   gameStore,
   treasury:warTreasuryStore(),
   chest:warChestStore(),
   readWarState:()=>warStateStore().read(),
   readLinks:()=>Object.values(getIdentityRegistry()?.snapshot()?.links||{}),
   getNativeEntity:id=>npcStore.getNativeEntity(id),
   getFactionForCorporation:id=>factions.getFactionIDForCorporation(id),
   readCasualties:()=>nativeRows.readRow(gameStore,casualtyStore.TABLE,
    casualtyStore.KEY,casualtyStore.validate),
   // FW-078: which campaign this exact hull was mobilised for, straight from the war
   // fleet registry - the casualty ledger is not written yet when the kill is decided.
   readCampaignForEntity:(entityID)=>{
    try{
     const ships=nativeWarFleetRegistry()?.snapshot?.()?.ships||{};
     const row=ships[String(Number(entityID))]||ships[Number(entityID)];
     return row&&row.campaignID?{campaignID:String(row.campaignID)}:null;
    }catch(_error){return null}
   },
   // FW-104: the pilot's own registry row is the same proven assignment the mobiliser
   // wrote (native ship + campaign verified at ASSIGN), so a kill stays attributable
   // after its identity link is released with the confirmed wreck.
   readFleet:()=>{
    try{return nativeWarFleetRegistry()?.snapshot?.()||null}catch(_error){return null}
   },
   // FW-105 (owner decision 2026-10-30): a real kill may be backed by the faction's real
   // native corporation wallet instead of only by a levy its pilots never earned. The
   // escrow is taken by coopWarTreasury RESERVE, which verifies the corporation, debits
   // division 1000 with a real journal entry and refuses when the money is not there.
   reserveFromWallet:({campaignID,factionID,needCents,proofID})=>{
    try{
     const state=warStateStore().read();
     const campaign=state?.campaigns?.[campaignID];
     if(!campaign)return {status:"BLOCKED",reason:"CAMPAIGN_NOT_FOUND"};
     const pilots=warPresencePilots(),ledger=warEarnedLedger();
     const corporationID=warFactionCorporation(factionID,pilots,ledger);
     if(!(Number(corporationID)>0))return {status:"BLOCKED",reason:"NO_FACTION_CORPORATION"};
     // FW-109: ONE escrow per KILL, not one per faction per campaign. The old fixed ids
     // meant the second kill of a campaign reused the first reservation, and the treasury
     // correctly answered a conflict - so a faction could never pay two bounties in one war.
     // The proof is hashed because a treasury id may not exceed 96 characters.
     let tag="";
     try{
      tag=require("node:crypto").createHash("sha1")
       .update(String(proofID||"event")).digest("hex").slice(0,10);
     }catch(_error){tag="";}
     if(!tag)return {status:"BLOCKED",reason:"BOUNTY_PROOF_UNHASHABLE"};
     return warTreasuryStore().execute({type:"RESERVE",purpose:"BOUNTY",
      eventID:"fw:wallet-reserve:"+campaignID+":"+factionID+":"+tag,
      reservationID:"bounty:"+campaignID+":"+factionID+":"+tag,
      corporationID,factionID,warID:campaign.warID,campaignID,
      amountCents:needCents,minRemainingCents:0});
    }catch(error){
     return {status:"BLOCKED",reason:String(error&&error.message||error)};
    }
   },
   emit:(event,detail)=>{
    try{require("./coopRuntimeProbe").observe(event,null,null,detail);}
    catch(_error){/* probe is best effort */}
   }
  });
  return warBountyInstance;
 }
 // FW-067 (validation): why is there no payout, answered once from the live record.
 //
 // A payout needs five things at the same time: a campaign that is still fightable, a
 // HELD escrow for the side that will make the kill, a real hull of that side inside the
 // campaign's own systems, a real native kill with an attributed attacker, and a credit
 // leg that can reach the pilot. Any one of them missing looks identical from outside -
 // nothing arrives - so this reports each of them with its own status and the blockers
 // as plain sentences.
 function diagnoseWarPayout(){
  const out={status:"UNKNOWN",campaigns:[],blockers:[],checkedAt:Date.now()};
  let state=null,treasury=null;
  try{state=warStateStore().read();}catch(error){
   out.status="WAR_STATE_UNAVAILABLE";
   out.blockers.push("the war record could not be read: "+String(error&&error.message||error).slice(0,120));
   return out;
  }
  try{treasury=warTreasuryStore().snapshot();}catch(error){
   out.status="TREASURY_UNAVAILABLE";
   out.blockers.push("the treasury could not be read: "+String(error&&error.message||error).slice(0,120));
   return out;
  }
  const wars=new Map(Object.entries((state&&state.wars)||{}));
  const campaigns=Object.values((state&&state.campaigns)||{});
  const reservations=Object.values((treasury&&treasury.reservations)||{});
  let presencePilots=[];
  try{presencePilots=warPresencePilots()||[];}catch(_error){presencePilots=[];}
  const lastAttribution=lastWarAttributionStatus();
  for(const campaign of campaigns){
   const war=wars.get(campaign.warID)||null;
   const theatre=[Number(campaign.sourceSystemID),Number(campaign.targetSystemID)].filter(id=>id>0);
   const rows=reservations.filter(row=>row&&row.campaignID===campaign.campaignID);
   const sides=[];
   for(const factionID of [Number(war&&war.attackerFactionID),Number(war&&war.defenderFactionID)]){
    if(!(factionID>0))continue;
    const escrow=rows.find(row=>Number(row.factionID)===factionID)||null;
    const hulls=presencePilots.filter(pilot=>Number(pilot.factionID)===factionID&&
     theatre.includes(Number(pilot.systemID))).length;
    sides.push({factionID,escrowStatus:String(escrow&&escrow.status||"NONE"),
     reservationID:String(escrow&&escrow.reservationID||""),
     hullsInTheatre:hulls,
     canCollectNow:Boolean(escrow&&escrow.status==="HELD"&&hulls>0)});
   }
   const live=["PREPARING","ASSAULT"].includes(String(campaign.state));
   const payable=sides.filter(side=>side.canCollectNow===true);
   const entry={campaignID:campaign.campaignID,state:String(campaign.state),
    targetSystemID:Number(campaign.targetSystemID)||0,
    sourceSystemID:Number(campaign.sourceSystemID)||0,sides,
    payoutReady:live&&payable.length>0,
    blockers:[]};
   if(!live)entry.blockers.push("campaign is "+String(campaign.state)+", no further kill can be paid");
   for(const side of sides){
    if(side.escrowStatus!=="HELD"&&side.escrowStatus!=="PAID")
     entry.blockers.push("faction "+side.factionID+" has no escrow ("+side.escrowStatus+")");
    else if(side.hullsInTheatre<1)
     entry.blockers.push("faction "+side.factionID+" has escrow but no hull in systems "+
      theatre.join("/"));
   }
   if(entry.payoutReady&&lastAttribution&&lastAttribution.status!=="NATIVE_DESTRUCTION_ATTACKER_PROVIDED")
    entry.blockers.push("last destruction attribution answered "+lastAttribution.status);
   out.campaigns.push(entry);
   for(const line of entry.blockers)out.blockers.push(campaign.campaignID+": "+line);
  }
  const ready=out.campaigns.filter(entry=>entry.payoutReady);
  out.payoutPossible=ready.length>0;
  out.status=ready.length?"PAYOUT_POSSIBLE":(out.campaigns.length?"NOTHING_PAYABLE":"NO_CAMPAIGN");
  out.lastAttribution=lastAttribution;
  if(!out.payoutPossible&&!out.blockers.length)out.blockers.push("no campaign needs money right now");
  return out;
 }
 // The most recent destruction attribution the world recorded, from its own event log.
 // Read-only, bounded, and never a reason to fail the diagnostic.
 function lastWarAttributionStatus(){
  const file=process.env.EVEJS_COOP_EVENTS_FILE||"/var/lib/evejs/coop-events.jsonl";
  try{
   const fs=require("node:fs");
   const LF=String.fromCharCode(10);
   const raw=fs.readFileSync(file,"utf8").trim().split(LF).slice(-400);
   for(let index=raw.length-1;index>=0;index-=1){
    let row=null;
    try{row=JSON.parse(raw[index]);}catch(_error){continue;}
    if(!row||row.event!=="living-native-destruction-attacker")continue;
    return {at:row.at||"",status:String(row.status||""),
     victimPilotID:String(row.victimPilotID||""),attackerPilotID:String(row.attackerPilotID||"")};
   }
  }catch(_error){/* an unreadable log is simply unknown */}
  return null;
 }
 // FW-088: the durable casualty ledger as a read-only snapshot, so attribution can name a
 // victim whose hull every other cache has already pruned.
 function warCasualtySnapshot(){
  try{
   if(!getCasualtyLedger())return null;
   return getCasualtyLedger().snapshot();
  }catch(_error){return null}
 }
 // FW-053: escrow of an expired campaign must go back to the corporation that paid it.
 //
 // A campaign that never produced an assault proof is expired by the opener (that is
 // how a squatted target is released), but nothing released its money: the treasury
 // only refunded a war that ENDED or a campaign that was CANCELLED, and the live
 // runtime supplied no authorizeRefund at all, so the default refused every refund.
 // Measured 22:5xZ: `war:500011-500020:campaign:30045343` was EXPIRED while its
 // 2 500 000-cent reservation stayed HELD. The refund is idempotent per campaign side
 // (eventID `fw:refund:<campaignID>:<factionID>`), returns the exact cents the
 // reservation holds, and is recorded with a status either way.
 //
 // FW-053B: a campaign can also expire BEFORE this process starts, and the tick that
 // expires it has already passed, so the same refund is reconciled from the state.
 function refundExpiredCampaigns(campaignIDs){
  const ids=Array.isArray(campaignIDs)?campaignIDs.filter(x=>typeof x==="string"&&x):[];
  if(!ids.length)return [];
  let treasury=null;
  try{treasury=warTreasuryStore()}catch(_error){return []}
  const out=[];
  for(const campaignID of ids){
   let snapshot=null;
   try{snapshot=treasury.snapshot()}catch(_error){snapshot=null}
   const held=Object.values((snapshot&&snapshot.reservations)||{})
    .filter(row=>row&&row.status==="HELD"&&row.campaignID===campaignID);
   for(const row of held){
    let refunded=null;
    try{
     refunded=treasury.execute({type:"REFUND",
      eventID:"fw:refund:"+campaignID+":"+row.factionID,
      reservationID:row.reservationID,corporationID:row.corporationID,
      proofID:"expire:"+campaignID});
    }catch(error){
     refunded={status:"BLOCKED",reason:String(error&&error.message||error).slice(0,120)};
    }
    const detail={status:String(refunded&&refunded.status||"UNKNOWN"),
     reason:String(refunded&&refunded.reason||""),
     campaignID,factionID:Number(row.factionID)||0,
     corporationID:Number(row.corporationID)||0,
     reservationID:row.reservationID,amountCents:Number(row.cents)||0,
     refundJournalID:Number(refunded&&refunded.receipt&&refunded.receipt.journalID)||0,
     evidence:"REAL_ESCROW_RETURNED_TO_THE_CORPORATION_THAT_PAID_IT"};
    out.push(detail);
    try{require("./coopRuntimeProbe").observe("living-native-war-bounty-refunded",null,null,detail);}
    catch(_error){/* probe is best effort */}
   }
  }
  return out;
 }
 // The same refund for an expiry this process never witnessed.
 function reconcileTerminalEscrow(){
  let treasury=null,state=null;
  try{treasury=warTreasuryStore();state=warStateStore().read();}
  catch(_error){return []}
  if(!treasury||!state)return [];
  const terminal=(row)=>{
   const campaign=(state.campaigns||{})[row.campaignID];
   const war=(state.wars||{})[row.warID];
   if(war&&war.state==="ENDED")return true;
   // FW-066: a won campaign has no further kill to pay for, so its escrow is terminal.
   return ["CANCELLED","EXPIRED","OCCUPIED"].includes(String(campaign&&campaign.state||""));
  };
  let snapshot=null;
  try{snapshot=treasury.snapshot()}catch(_error){return []}
  const stale=Object.values((snapshot&&snapshot.reservations)||{})
   .filter(row=>row&&row.status==="HELD"&&terminal(row))
   .map(row=>row.campaignID);
  return stale.length?refundExpiredCampaigns([...new Set(stale)]):[];
 }
 // FW-059 (review): the payout has two legs - release the escrow, then credit the
 // pilot - and a failure between them left `ESCROW_RELEASED_NOT_CREDITED` with no
 // retry: the ISK had left the escrow and never reached the pilot. The credit is
 // keyed by `war-bounty:<campaign>:<proof>`, so replaying it is safe and exact; this
 // pass finishes any payout whose credit really did not happen, on every war tick,
 // and records what it did. Nothing here creates ISK: the escrow was already released.
 function reconcileBountyCredits(){
  let treasury=null,chest=null;
  try{treasury=warTreasuryStore();chest=warChestStore();}
  catch(_error){return []}
  if(!treasury||!chest)return [];
  let snapshot=null;
  try{snapshot=treasury.snapshot()}catch(_error){return []}
  const paid=Object.values((snapshot&&snapshot.reservations)||{})
   .filter(row=>row&&row.status==="PAID"&&row.paidToPilotID&&row.payoutProofID&&
    Number(row.cents)>0);
  const out=[];
  for(const row of paid){
   const eventID="war-bounty:"+row.campaignID+":"+row.payoutProofID;
   let credited=null;
   try{
    credited=chest.creditPilot({pilotID:row.paidToPilotID,cents:Number(row.cents),
     eventID,reason:"war bounty credit reconcile "+String(row.campaignID||"")});
   }catch(error){
    credited={status:"FAILED",reason:String(error&&error.message||error).slice(0,120)};
   }
   if(String(credited&&credited.status||"")!=="APPLIED")continue;
   const detail={status:"APPLIED",pilotID:String(row.paidToPilotID),
    campaignID:String(row.campaignID||""),reservationID:row.reservationID,
    amountCents:Number(row.cents)||0,creditEventID:eventID,
    evidence:"SECOND_PAYOUT_LEG_FINISHED_FROM_THE_PAID_ESCROW_ROW"};
   out.push(detail);
   try{require("./coopRuntimeProbe").observe("living-native-war-bounty-credit-reconciled",
    null,null,detail);}catch(_error){/* probe is best effort */}
  }
  return out;
 }
 // FW-085: give back escrow that was reserved for a border that was then refused, so a
 // funded side is never left holding HELD ISK for a campaign that does not exist.
 function warBountyRelease({campaignID,reservationID,corporationID,factionID=0}={}){
  try{
   if(!reservationID||!corporationID)return {status:"BLOCKED",reason:"INVALID_RELEASE"};
   const treasury=warTreasuryStore();
   // The event id must stay inside the treasury's 96-character key budget, so it names the
   // campaign and the side, never the whole reservation id (measured: the long form was
   // refused with INVALID_TREASURY_COMMAND).
   const refunded=treasury.execute({type:"REFUND",
    eventID:"fw:release:"+String(campaignID||"unknown")+":"+String(Number(factionID)||0),
    reservationID:String(reservationID),corporationID:Number(corporationID),
    proofID:"unfunded:"+String(campaignID||"unknown")});
   try{
    require("./coopRuntimeProbe").observe("living-native-war-bounty-released",null,null,{
     status:String(refunded&&refunded.status||"UNKNOWN"),
     reason:String(refunded&&refunded.reason||""),campaignID:String(campaignID||""),
     reservationID:String(reservationID),corporationID:Number(corporationID),
     evidence:"ESCROW_RETURNED_FOR_A_BORDER_THAT_NEVER_OPENED"});
   }catch(_error){/* probe is best effort */}
   return refunded;
  }catch(error){
   return {status:"BLOCKED",reason:String(error&&error.message||error).slice(0,120)};
  }
 }
 // One real reservation per campaign side, taken before START_CAMPAIGN.
 //
 // FW-046: this used to RETURN on the first side it could fund, so a war had a
 // bounty only for the attacker. Measured on the work stack at 19:15Z: the real
 // kill that decided the battle was made by a DEFENDER (coop-pilot-027, faction
 // 500011) while the only HELD escrow belonged to 500004, so `coopWarBounty`
 // correctly refused with NO_HELD_ESCROW_FOR_FACTION and no ISK could move - a
 // funded war where half the fighters can never be paid is not a bounty, and the
 // comment above already promised one reservation per side.
 // Each side now funds its OWN bounty out of its OWN wallet; a side that cannot
 // pay is refused per side (its own reason is kept) and never blocks the other.
 // Env-gated because it takes a second real escrow: EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES=1.
 // FW-093 (measured 2026-10-29): the side was asked to pay from the corporation its
 // PILOTS belong to, and that is not where a faction's money lives. Measured on the
 // work stack: faction 500001 fields pilots whose corporation is 1000180 (0 ISK),
 // while the same faction's corporation 1000035 really held 90 000 ISK that only
 // real mercenary settlements ever put there; faction 500004 had 0 ISK at its
 // militia corporation and 530 000 ISK at 1000120. Every border was therefore
 // refused `WAR_TREASURY_FUNDS_UNAVAILABLE` with the money sitting in the same
 // faction, and the war could not fund itself at all.
 //
 // The money is still real and still the faction's: `coopWarTreasury` verifies the
 // corporation belongs to that faction and debits its native wallet atomically, so
 // this only chooses WHICH of the faction's own corporations pays. Order is the
 // historical corporation first (identity), then the declared militia corporation,
 // then the faction's corporations richest first - and the pilot corporation is
 // kept when nothing can pay, so a refusal still names the same corporation.
 function warFactionCorporationCandidates(factionID,pilots,ledger){
  const ordered=[],push=id=>{const n=Number(id);
   if(Number.isSafeInteger(n)&&n>0&&!ordered.includes(n))ordered.push(n)};
  push(warFactionCorporation(factionID,pilots,ledger));
  let factions=null;
  try{factions=require("../services/faction/factionState")}catch(_error){factions=null}
  if(factions){
   try{push(factions.getFactionRecord(factionID)?.militiaCorporationID)}catch(_error){/* optional */}
   try{
    const read=require("../gameStore").read("corporations","/");
    const table=read&&read.success&&read.data
     ?(read.data.records&&typeof read.data.records==="object"?read.data.records:read.data):{};
    for(const key of Object.keys(table)){
     const record=table[key];
     if(!record||typeof record!=="object")continue;
     if(Number(record.factionID)!==Number(factionID))continue;
     push(Number(record.corporationID)||Number(record._key)||Number(key));
    }
   }catch(_error){/* an unreadable corporation table is not a funding decision */}
  }
  return ordered;
 }
 function warCorporationBalanceISK(corporationID){
  try{
   const read=require("./coopCorpWallet").readWallet({gameStore:require("../gameStore"),
    corporationID:Number(corporationID)});
   const division=read&&read.status==="OK"&&read.divisions?read.divisions["1000"]:null;
   const isk=Number(division&&division.balance);
   return Number.isFinite(isk)?isk:null;
  }catch(_error){return null}
 }
 function warFundingCorporation(factionID,pilots,ledger,needCents){
  // The DECISION is pure (coopVirtualWorldRuntime.pure) so it is testable without a
  // world; this function only reads the real wallets it needs.
  return pickFundingCorporation({ordered:warFactionCorporationCandidates(factionID,pilots,ledger),
   needCents,readBalance:warCorporationBalanceISK});
 }

 function warBountyReserve({war,campaign,campaignID,warID,persist}){
  if(process.env.EVEJS_COOP_WAR_BOUNTY_ISK==="0")return {status:"REFUSED",reason:"WAR_BOUNTY_OFF"};
  const bountyISK=Math.max(1,Math.round(Number(process.env.EVEJS_COOP_WAR_BOUNTY_ISK)||25000));
  const needCents=bountyISK*100;
  // The declaration must be durable before an escrow can name this war.
  try{if(typeof persist==="function")persist();}
  catch(error){return {status:"REFUSED",reason:"WAR_STATE_PERSIST_FAILED"};}
  const pilots=warPresencePilots(),ledger=warEarnedLedger(),refusals=[];
  const chest=warChestStore(),treasury=warTreasuryStore();
  const reserveSide=(factionID)=>{
   if(!Number.isSafeInteger(factionID)||factionID<=0)
    return {status:"REFUSED",reason:"NO_FACTION",factionID:0};
   const payer=warFundingCorporation(factionID,pilots,ledger,needCents);
   const corporationID=Number(payer.corporationID)||0;
   if(!Number.isSafeInteger(corporationID)||corporationID<=0){
    refusals.push({factionID,reason:"NO_MILITIA_CORPORATION"});
    return {status:"REFUSED",reason:"NO_MILITIA_CORPORATION",factionID};
   }
   if(payer.fallback)refusals.push({factionID,reason:"FUNDED_BY_FACTION_CORPORATION",
    corporationID,walletISK:payer.walletISK,candidates:payer.candidates});
   let funded=null;
   try{
    funded=chest.fund({factionID,corporationID,warID,campaignID,needCents,pilots,ledger,
     eventID:"bounty:"+campaignID+":"+factionID});
   }catch(error){
    const reason="WAR_CHEST_THROW:"+String(error&&error.message||error);
    refusals.push({factionID,reason});
    return {status:"REFUSED",reason,factionID};
   }
   if(funded.status!=="APPLIED"&&funded.status!=="DUPLICATE"){
    const reason=String(funded.reason||funded.status);
    // The levy reads PILOT earned balances, but this world already sweeps those
    // into the corporation wallet on every refinery tick
    // (`living-corp-treasury-swept`, 250 000 ISK moved by a pilot-earned debit).
    // So a war party can hold real ISK in its native wallet and still plan a levy
    // of zero: measured on the work stack, war_funding_diagnose answered
    // NO_REAL_FACTION_INCOME on every side while that wallet held 125 M ISK that
    // only real settlements ever put there. With this opt-in the escrow is backed
    // by that same wallet: `coopWarTreasury` RESERVE verifies the corporation,
    // debits division 1000 with a real journal entry and refuses when the money is
    // not there, so no ISK is invented, only spent from where it already is.
    const walletBacked=process.env.EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK==="1"&&
     ["NO_REAL_FACTION_INCOME","INSUFFICIENT_REAL_INCOME"].includes(reason);
    if(!walletBacked){
     refusals.push({factionID,reason});
     return {status:"REFUSED",reason,factionID};
    }
    refusals.push({factionID,reason:"BOUNTY_BACKED_BY_NATIVE_CORP_WALLET",chestRefusal:reason});
   }
   const reservationID="bounty:"+campaignID+":"+factionID;
   let reserved;
   try{
    reserved=treasury.execute({type:"RESERVE",
     eventID:"fw:reserve:"+campaignID+":"+factionID,reservationID,
     corporationID,factionID,warID,campaignID,amountCents:needCents,
     minRemainingCents:0});
   }catch(error){
    const reason="WAR_TREASURY_THROW:"+String(error&&error.message||error);
    refusals.push({factionID,reason});
    return {status:"REFUSED",reason,factionID};
   }
   if(reserved.status!=="APPLIED"&&reserved.status!=="DUPLICATE"){
    const reason=String(reserved.reason||reserved.status);
    refusals.push({factionID,reason});
    return {status:"REFUSED",reason,factionID};
   }
   try{
    require("./coopRuntimeProbe").observe("living-native-war-bounty-reserved",null,null,{
     status:"RESERVED",factionID,corporationID,campaignID,warID,
     amountCents:needCents,reservationID,
     chestJournalID:String(funded.entry?.journalID||""),
     walletAfterCents:Number(funded.entry?.walletAfterCents)||0,
     sources:(funded.entry?.sources||[]).map(s=>s.pilotID),
     escrowJournalID:Number(reserved.receipt?.journalID)||0,
     evidence:"REAL_EARNED_ISK_TO_NATIVE_CORP_WALLET_TO_HELD_ESCROW"});
   }catch(_error){/* probe is best effort */}
   return {status:"RESERVED",reservationID,factionID,corporationID,
    amountCents:needCents,chestJournalID:String(funded.entry?.journalID||""),
    escrowJournalID:Number(reserved.receipt?.journalID)||0};
  };
  const sides=[Number(war.attackerFactionID),Number(war.defenderFactionID)];
  const both=String(process.env.EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES||"0")==="1";
  const planned=require("./coopWarBountyEscrowSides")
   .planSideReservations({sides,both,attackerFactionID:war.attackerFactionID,reserveSide});
  if(!planned.funded.length)
   return {status:"REFUSED",reason:refusals.length?
    refusals.map(r=>r.factionID+":"+r.reason).join("|"):"NO_WAR_PARTY",refusals};
  // The campaign is oriented attacker -> defender, so the attacker's escrow is the
  // one that names this campaign's supply. A defender-only escrow still opens the
  // war (unchanged fallback), it simply is not the supply proof.
  const primary=planned.primary;
  return {...primary,status:"RESERVED",refusals,
   otherSideReservationID:(planned.funded.find(r=>r!==primary)||{}).reservationID||"",
   sides:planned.funded.map(r=>({factionID:r.factionID,
    reservationID:r.reservationID,corporationID:r.corporationID}))};
 }
 // Read-only: what the chest can really see, so a refusal names its own cause.
 function diagnoseWarFunding(){
  const pilots=warPresencePilots(),ledger=warEarnedLedger();
  const need=Math.max(1,Math.round(Number(process.env.EVEJS_COOP_WAR_BOUNTY_ISK)||25000))*100;
  let state=null;
  try{state=warStateStore().read()}catch(_error){state=null}
  const plan=require("./coopWarChestFunding").planLevy;
  const wars=Object.values(state?.wars||{}).filter(w=>w.state==="ACTIVE");
  return {
   flags:{factionWar:process.env.EVEJS_COOP_FACTION_WAR==="1",
    treasury:process.env.EVEJS_COOP_WAR_TREASURY==="1",
    atomicRows:process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"},
   needCents:need,
   pilots:pilots.length,
   earned:{pilots:Object.keys(ledger.pilots||{}).length,
    balances:Object.entries(ledger.pilots||{}).map(([id,row])=>({pilotID:id,
     balance:Number(row?.balance)||0}))},
   wars:wars.map(w=>({warID:w.warID,attackerFactionID:w.attackerFactionID,
    defenderFactionID:w.defenderFactionID,
    sides:[Number(w.attackerFactionID),Number(w.defenderFactionID)].map(factionID=>({
     factionID,corporationID:warFactionCorporation(factionID,pilots,ledger),
     plan:plan({factionID,pilots,ledger,needCents:need})}))})),
   // FW-038: money and navies can sit on opposite sides. Report which faction
   // could hire which, with the real wallet balance that would pay for it.
   mercenary:diagnoseMercenary(wars,pilots,ledger,need),
  };
 }
 // FW-038B: the settlement that actually pays a mercenary contract. Both wallets
 // are real native corporation wallets (division 1000) and the transfer is a
 // journaled two-leg operation - see coopWarMercenarySettlement.
 let warMercenarySettlementInstance=null;
 function warMercenarySettlement(){
  if(warMercenarySettlementInstance)return warMercenarySettlementInstance;
  // FW-038C: the wallet is the idempotency anchor, so the settlement needs only
  // the GameStore pointer API - the same one the corporation wallet itself uses.
  warMercenarySettlementInstance=require("./coopWarMercenarySettlement")
   .createMercenarySettlement({gameStore:require("../gameStore")});
  return warMercenarySettlementInstance;
 }
 function executeMercenaryContract(request){
  try{
   return warMercenarySettlement().execute({
    eventID:String(request&&request.eventID||""),
    payerCorporationID:Number(request&&request.payerCorporationID),
    payeeCorporationID:Number(request&&request.payeeCorporationID),
    amountCents:Number(request&&request.amountCents),
    dryRun:request&&request.dryRun===true
   });
  }catch(error){
   return {status:"BLOCKED",reason:"WAR_MERCENARY_UNAVAILABLE",
    detail:String(error&&error.message||error).slice(0,120)};
  }
 }
 function diagnoseMercenarySettlement(){
  try{return warMercenarySettlement().snapshot()}
  catch(error){return {status:"UNAVAILABLE",reason:String(error&&error.message||error)}}
 }
 // FW-038 read-only: pair a funded faction with a navy-capable faction using the
 // real corporation wallets (division 1000). Proposes only; moves no ISK.
 function diagnoseMercenary(wars,pilots,ledger,needCents){
  try{
   const capability=warNavyCapability();
   if(!capability)return {status:"UNAVAILABLE",proposals:[]};
   const factions=new Set();
   for(const w of Array.isArray(wars)?wars:[]){
    for(const id of [Number(w.attackerFactionID),Number(w.defenderFactionID)])
     if(Number.isSafeInteger(id)&&id>0)factions.add(id);
   }
   const capabilities=[...factions].map(factionID=>({
    factionID,status:capability.faction(factionID).status}));
   const wallet=require("./coopCorpWallet");
   const treasuries=[];
   for(const factionID of factions){
    const corporationID=warFactionCorporation(factionID,pilots,ledger);
    if(!Number.isSafeInteger(corporationID)||corporationID<=0)continue;
    let balanceCents=0;
    try{
     const read=wallet.readWallet({gameStore:require("../gameStore"),
      corporationID});
     const division=read&&read.status==="OK"&&read.divisions?read.divisions["1000"]:null;
     const isk=Number(division&&division.balance);
     balanceCents=Number.isFinite(isk)&&isk>0?Math.round(isk*100):0;
    }catch(_error){balanceCents=0}
    treasuries.push({factionID,corporationID,balanceCents});
   }
   return require("./coopWarMercenaryContract").proposeContracts({
    capabilities,treasuries,needCents});
  }catch(error){
   return {status:"UNAVAILABLE",reason:String(error&&error.message||error),proposals:[]};
  }
 }
 // FW-011A: read-only sovereignty projection. Military control is always
 // reported; a native sov claim is reported only where a real sov structure and
 // a real native claim exist. Nothing is written, so no claim is fabricated.
 let warSovProjection=null;
 function advanceNativeWarSovereigntyProjection(){
  if(process.env.EVEJS_COOP_WAR_SOVEREIGNTY_PROJECTION!=="1")return;
  let state=null;
  try{state=warStateStore().read()}catch(_error){state=null}
  if(!state||!state.territories)return;
  // FW-043: an empty map is a bootstrap, not an answer.
  try{
   const boot=bootstrapTerritoriesFromPresence(state);
   if(boot.status==="REGISTERED_FROM_PRESENCE"||boot.status==="CORRECTED_FROM_PRESENCE"){
    require("./coopRuntimeProbe").observe("living-native-war-territory-bootstrap",null,null,
     {status:boot.status,added:boot.added,corrected:boot.corrected,
      released:boot.released,kept:boot.kept,systems:boot.systems,
      evidence:"REAL_PRESENCE_STRICT_MAJORITY_ARMED_OWNER_NO_INVENTED_OWNER"});
    state=warStateStore().read();
    if(!state||!state.territories)return;
   }
  }catch(_error){/* a bootstrap failure must never break the phase */}
  let structures=[];
  try{
   const worldData=require("./worldData");
   for(const systemID of Object.keys(state.territories)){
    const rows=worldData.getStructuresForSystem(Number(systemID));
    if(Array.isArray(rows))structures=structures.concat(rows);
   }
  }catch(_error){structures=[]}
  let sovState=null;
  try{sovState=require("../services/sovereignty/sovState")}catch(_error){sovState=null}
  const plan=require("./coopWarSovereigntyProjection").planProjection({
   warState:state,structures,
   getSystemSovClaim:sovState&&typeof sovState.getSystemSovClaim==="function"?
    id=>sovState.getSystemSovClaim(id):null
  });
  if(plan.status!=="PLANNED")return;
  const signature=JSON.stringify(plan.systems.map(s=>[s.systemID,s.factionID,s.mode]));
  if(warSovProjection===signature)return;
  warSovProjection=signature;
  require("./coopRuntimeProbe").observe("living-native-war-sovereignty-projection",null,null,{
   status:"PROJECTED_VIEW",counts:plan.counts,
   systems:plan.systems.map(s=>({systemID:s.systemID,factionID:s.factionID,
    state:s.state,mode:s.mode,reason:s.reason})),
   evidence:"MILITARY_CONTROL_REPORTED_NATIVE_CLAIM_ONLY_WHEN_STRUCTURE_BACKED"
  });
 }
 let warOpeningTicks=0;
 function advanceNativeWarOpening(){
  // Opening a war is a slow strategic action, but it was evaluated on every 30 s
  // tick and measured 658 ms of blocked loop (it reads the 1 MB war state and
  // walks every campaign). Once every four ticks (2 min) is the same decision at a
  // quarter of the price.
  warOpeningTicks=(warOpeningTicks+1)%4;
  if(warOpeningTicks!==1)return;
  const {enabled}=require("./coopWarMobilizer");
  if(!enabled(process.env))return warSkip("opening","WAR_FLAGS_OFF");
  // A kill can only pay a bounty once the chest payer is installed.
  try{require("./coopWarKillMerit").setBountyPayer(args=>warBountyStore().pay(args));}
  catch(error){warSkip("bounty","WAR_BOUNTY_UNAVAILABLE:"+String(error&&error.message||error));}
  if(!visitedSystems.size)return warSkip("opening","NO_VISITED_SYSTEMS");
  if(!getIdentityRegistry())return warSkip("opening","NO_IDENTITY_REGISTRY");
  try{ensureWarState()}catch(error){
   return warSkip("opening","WAR_STATE_WRITE_FAILED:"+String(error&&error.message||error));
  }
  const store=warStateStore();
  const readWarState=()=>store.read();
  if(!warOpening){
   const npcStore=require("./npc/nativeNpcStore"),
    factions=require("../services/faction/factionState"),
    worldData=require("./worldData");
   warOpening=require("./coopFactionWarOpening").createWarOpening({
    readLinks:()=>Object.values(getIdentityRegistry().snapshot()?.links||{}),
    getNativeEntity:id=>npcStore.getNativeEntity(id),
    getFactionForCorporation:id=>factions.getFactionIDForCorporation(id),
    getStargatesForSystem:id=>worldData.getStargatesForSystem(id),
    getGate:id=>worldData.getStargateByID(id),
    // FW-112: the SDE faction owner of a system nobody has taken yet. Used ONLY when no
    // border between two registered territories exists any more, so a faction that holds
    // its whole frontier pushes into the next system instead of freezing the whole world.
    ownerOfSystem:systemID=>{
     try{
      const row=worldData.getSolarSystemByID(Number(systemID));
      return Number(row&&row.factionID)||0;
     }catch(_error){return 0}
    },
    readWarState,
    writeWarState:state=>store.write(state),
    reserveBounty:warBountyReserve,
    releaseBounty:warBountyRelease,warCasualtySnapshot,
    navyCapability:({attackerFactionID,defenderFactionID})=>{
     try{
      const capability=warNavyCapability();
      if(!capability)return {open:false,reason:"NO_NAVY_CAPABILITY:UNAVAILABLE"};
      return capability.decide({attackerFactionID,defenderFactionID});
     }catch(_error){return {open:false,reason:"NO_NAVY_CAPABILITY:UNAVAILABLE"}}
    },
    // FW-027: a real war fleet is presence too (the roster proves the hulls).
    fleetPresence:args=>{
     try{return require("./coopWarFleetRoster").sharedRoster().presence(args)}
     catch{return []}
    },
    // FW-092 (measured): a faction only earns from a kill it can SELL. The scenes
    // carry the real stations of each system, so market access is a measured fact,
    // not a guess. It is a preference for the planner (an unreachable market is
    // planned last, never refused) and unknown when the scene cannot be built.
    marketAccess:systemID=>{
     try{
      const scene=require("./runtime").ensureScene(Number(systemID),{refreshStargates:false});
      return (scene?.staticEntities||[]).some(x=>x&&x.kind==="station"&&Number(x.itemID)>0);
     }catch(_error){return null}
    },
    minShips:Math.max(1,Number(process.env.EVEJS_COOP_WAR_TERRITORY_MIN_SHIPS)||1)
   });
  }
  // The war domain already knows its own systems. Measured: the frontier refused to
  // open while the territory map clearly held 30003837 (500004) next to 30045344
  // (500011), because the tick only ever saw systems the A-Life walker had visited
  // this process. A system the war state already owns is a real system for the
  // planner, so the two sets are unioned instead of trusting one of them.
  let knownSystems=[...visitedSystems];
  let known=null;
  try{
   known=store.read();
   for(const id of Object.keys((known&&known.territories)||{})){
    const systemID=Number(id);
    if(Number.isSafeInteger(systemID)&&systemID>0&&!knownSystems.includes(systemID))
     knownSystems.push(systemID);
   }
  }catch(_error){/* the war state is optional here */}
  // FW-080: the opener only sees the systems in this list, and the list was cut at
  // twelve while the world legitimately owns more. Measured 15:50Z: 30003829 was
  // registered as a 500001 territory (FW-045) and every hull was standing there, yet the
  // tick list ended at 30045341 - the new front was invisible, and the only refusal the
  // world could publish was an empty map. Owned systems are ordered newest-change first
  // so a freshly taken or freshly registered system is never the one that falls off.
  const ownedIDs=Object.keys((known&&known.territories)||{}).map(Number).filter(id=>Number.isSafeInteger(id)&&id>0);
  const ordered=[...ownedIDs.reverse(),...knownSystems];
  const tickSystems=[...new Set(ordered)].slice(0,24);
  let result;
  // FW-062: hand the opener the real funding state. A live campaign whose escrow
  // vanished (measured: the treasury row reverted and two ASSAULT campaigns kept
  // running with nothing behind them) cannot pay anybody, so it is expired instead of
  // squatting its target forever. Unreadable money is NOT treated as missing.
  let isCampaignFunded=null;
  try{
   const treasury=warTreasuryStore(),snapshot=treasury.snapshot();
   const rows=Object.values((snapshot&&snapshot.reservations)||{});
   const funded=new Set(rows.filter(row=>row&&(row.status==="HELD"||row.status==="PAID"))
    .map(row=>String(row.campaignID||"")));
   isCampaignFunded=campaign=>funded.has(String(campaign&&campaign.campaignID||""));
  }catch(_error){isCampaignFunded=null}
  try{result=warOpening.tick({systemIDs:tickSystems,isCampaignFunded})}
  catch(error){
   warSkip("opening","OPENING_THROW:"+String(error&&error.message||error));
   return;
  }
  // FW-053/053B/059: an expired campaign releases its escrow, a payout left with an
  // unreleased second leg is finished, and the same reconciliation runs for state a
  // previous process left behind.
  if(Array.isArray(result.expiredCampaignIDs)&&result.expiredCampaignIDs.length){
   try{refundExpiredCampaigns(result.expiredCampaignIDs);}
   catch(error){
    console.warn("[CoopFactionWar] expired escrow refund failed",String(error&&error.message||error));
   }
  }
  try{reconcileTerminalEscrow();}
  catch(error){
   console.warn("[CoopFactionWar] terminal escrow reconcile failed",String(error&&error.message||error));
  }
  try{reconcileBountyCredits();}
  catch(error){
   console.warn("[CoopFactionWar] bounty credit reconcile failed",String(error&&error.message||error));
  }
  if(result.status!=="OPENED"){
   const reason=String(result.reason||result.status||"UNKNOWN");
   // The refusal can come from the planner (plan.skipped) or from the applier, which
   // names each border it refused to fund (result.skipped). Both must be published.
   const skips=[].concat(Array.isArray(result.plan?.skipped)?result.plan.skipped:[],
    Array.isArray(result.skipped)?result.skipped:[]);
   // Deduplicate on the reason AND the per-border detail. Measured: a border that
   // changed from "no navy" to "no money" kept the same top-level reason
   // NO_OPENABLE_FRONT, so the new precondition was never published and the world
   // looked frozen for an hour. Every distinct refusal now gets its own event.
   const key=reason+"|"+String(result.refusedCommand||"")+"|"+String(result.refusedEdge?JSON.stringify(result.refusedEdge):"")+"|"+JSON.stringify(skips).slice(0,600);
   if(warSkipReasons["opening"]!==key){
    try{
     require("./coopRuntimeProbe").observe("living-native-war-opening-blocked",null,null,{
      status:"BLOCKED",reason,
      // FW-084: the applier's refusal now carries the planner's own view too.
      territories:result.territories||result.plan?.territories||{},
      presence:result.plan?.summary||result.presence||{},
      fronts:Number(result.fronts)||(result.plan?.fronts||[]).length,
      // FW-081: which command and which border the state machine refused.
      refusedCommand:String(result.refusedCommand||""),
      refusedWarID:String(result.refusedWarID||""),
      refusedCampaignID:String(result.refusedCampaignID||""),
      refusedEdge:result.refusedEdge||null,
      skipped:skips.slice(0,8),
      tickSystems,
      visitedSystems:[...visitedSystems].slice(0,12),
      evidence:"REAL_PRESENCE_DERIVED_NO_FRONT_INVENTED"
     });
    }catch(_error){/* probe is best effort */}
    warSkipReasons["opening"]=key;
   }
   return warSkip("opening",reason);
  }
  console.log("[CoopFactionWar] war opened "+result.warIDs.join(",")+
   " campaigns "+result.campaignIDs.join(","));
  require("./coopRuntimeProbe").observe("living-native-war-opened",null,null,{
   status:result.status,warIDs:result.warIDs,campaignIDs:result.campaignIDs,
   presence:result.presence,territories:result.territories,fronts:result.fronts,
   funding:result.fundings,
   evidence:"REAL_PRESENCE_REAL_RECIPROCAL_GATE_PAPER_TREASURY"
  });
  // One front report per real opening, to the systems it really touches.
  for(const campaignID of result.campaignIDs||[]){
   const campaign=result.state&&result.state.campaigns&&result.state.campaigns[campaignID];
   if(!campaign)continue;
   warFrontChat("war-opened",{
    eventKey:campaignID,
    attackerFactionID:Number(result.state.wars?.[campaign.warID]?.attackerFactionID)||0,
    defenderFactionID:Number(result.state.wars?.[campaign.warID]?.defenderFactionID)||0,
    targetSystemID:campaign.targetSystemID,
   },[campaign.sourceSystemID,campaign.targetSystemID]);
  }
 }
 // FW-010B: PREPARING becomes ASSAULT only when the mobiliser has really put
 // native ships on both sides of that border. No muster, no assault.
 function advanceNativeWarAssault(){
  const {enabled}=require("./coopWarMobilizer");
  if(!enabled(process.env))return warSkip("assault","WAR_FLAGS_OFF");
  const registry=nativeWarFleetRegistry();
  if(!registry)return warSkip("assault","NO_WAR_FLEET_REGISTRY");
  try{ensureWarState()}catch(_error){return warSkip("assault","NO_WAR_STATE")}
  const core=require("./coopFactionWarCore"),assault=require("./coopFactionWarAssault");
  const store=warStateStore();
  let state;
  try{state=store.read()}
  catch(_error){return warSkip("assault","INVALID_WAR_STATE")}
  if(!state)return warSkip("assault","NO_WAR_STATE");
  const readiness=assault.campaignReadiness({state,ships:registry.snapshot()?.ships});
  if(readiness.status!=="READY")return warSkip("assault",String(readiness.reason||readiness.status));
  const begun=assault.beginAssault({state,readiness});
  if(begun.status!=="ASSAULT_BEGUN")return warSkip("assault",String(begun.reason||begun.status));
  store.write(begun.state);
  console.log("[CoopFactionWar] assault begun "+begun.campaignID+
   " attacker="+begun.attackerShips.length+" defender="+begun.defenderShips.length);
  require("./coopRuntimeProbe").observe("living-native-war-assault",null,null,{
   status:begun.status,campaignID:begun.campaignID,warID:begun.warID,
   attackerShips:begun.attackerShips,defenderShips:begun.defenderShips,
   evidence:"REAL_NATIVE_MUSTER_ON_BOTH_SIDES"
  });
  const begunCampaign=begun.state&&begun.state.campaigns&&begun.state.campaigns[begun.campaignID];
  warFrontChat("assault-begun",{
   eventKey:begun.campaignID,
   targetSystemID:Number(begunCampaign&&begunCampaign.targetSystemID)||0,
   attackerShips:begun.attackerShips.length,
   defenderShips:begun.defenderShips.length,
  },[
   Number(begunCampaign&&begunCampaign.sourceSystemID)||0,
   Number(begunCampaign&&begunCampaign.targetSystemID)||0,
  ]);
 }
 // FW-102: the mobiliser is created lazily by the phase that runs inside the world
 // cycle, and every other reader of it answered MOBILIZER_NOT_INITIALIZED. MEASURED on
 // the play stack 2026-10-30: `war_diagnose` - the one read-only action whose whole job
 // is to explain an empty side - returned MOBILIZER_NOT_INITIALIZED while the phase kept
 // ticking, so the operator could not see a single per-side rejection reason. The
 // factory is shared, so the diagnostic dry-runs the exact same authorities the phase
 // uses (a dry run never writes, reserves or orders anything).
 function warMobilizerInstance(registry,guard){
  if(warMobilizer)return warMobilizer;
  if(!registry||!guard||!getIdentityRegistry())return null;
  const {createWarMobilizer}=require("./coopWarMobilizer");
  const native=require("./runtime"),npcStore=require("./npc/nativeNpcStore"),
   controllers=require("./npc/npcRegistry"),
   factions=require("../services/faction/factionState"),
   dogma=require("./combat/weaponDogma"),
   capability=require("./npc/npcCapabilityResolver");
  const readiness=require("./coopWarMusterReadiness").createWarMusterReadiness({
   store:npcStore,resolveFamily:dogma.resolveWeaponFamily,
   isOptional:dogma.isChargeOptionalTurretWeapon,
   compatible:capability.isNpcChargeCompatibleWithModule
  });
  warMobilizer=createWarMobilizer({
   registry,
   readWarState:()=>warStateStore().read(),
   readLinks:()=>Object.values(getIdentityRegistry().snapshot().links||{}),
   // Existing scenes only: a military director must never manufacture an
   // enemy or force NPC materialization by observing an unvisited system.
   sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
   getNativeEntity:id=>npcStore.getNativeEntity(id),
   getController:id=>controllers.getControllerByEntityID(id),
   getFactionForCorporation:id=>factions.getFactionIDForCorporation(id),
   inspectReadiness:context=>readiness.inspect(context),
   getOrderLeases:()=>guard.snapshot().leases,
   isTactical:id=>getTacticsDirector()?.activeIDs()?.has(id)===true,
   // Command size comes from real rank. No pilot has earned merit yet, so every
   // side starts at a recruit's single ship instead of the old blanket two.
   // FW-129: the mobiliser obeys the same squadron floor as the garrison, so adopting
   // existing patrols can never shrink a front back to a single hull.
   commandCap:({assignedPilotIDs})=>Math.max(3,require("./coopFactionWarMerit")
    .sideCommandCap({pilotIDs:assignedPilotIDs,records:warMeritRecords()}))
  });
  return warMobilizer;
 }
 function advanceNativeWarMobilization(){
  const {enabled,createWarMobilizer}=require("./coopWarMobilizer");
  if(!enabled(process.env))return warSkip("mobilization","WAR_FLAGS_OFF");
  if(!visitedSystems.size)return warSkip("mobilization","NO_VISITED_SYSTEMS");
  if(!getIdentityRegistry())return warSkip("mobilization","NO_IDENTITY_REGISTRY");
  const registry=nativeWarFleetRegistry(),guard=npcOrderBridge();
  if(!registry)return warSkip("mobilization","NO_WAR_FLEET_REGISTRY");
  if(!guard)return warSkip("mobilization","NO_ORDER_BRIDGE");
  // The war domain needs a valid state record to exist at all. Without it every
  // mobilisation answers INVALID_MOBILIZATION_STATE, which looks like a broken
  // feature instead of an empty world. One shared, idempotent bootstrap owns it.
  try{ensureWarState()}catch(error){
   warSkip("mobilization","WAR_STATE_WRITE_FAILED:"+String(error&&error.message||error));
   return;
  }
  const mobilizer=warMobilizerInstance(registry,guard);
  if(!mobilizer)return warSkip("mobilization","MOBILIZER_CREATE_FAILED");
  const result=mobilizer.tick({systemIDs:[...visitedSystems].sort((a,b)=>a-b).slice(0,20)});
  // FW-110: custody of a hull the pilot provably left is released, and the release is
  // published. MEASURED 2026-10-30: a restart re-materialized the front fleet with new
  // entity ids while the registry kept the old ones, so every muster answered PILOT_IN_USE
  // and five campaigns expired with assigned 0. Silent custody changes would hide that.
  if(Array.isArray(result.released)&&result.released.length)
   require("./coopRuntimeProbe").observe("living-native-war-custody-stale",null,null,
    {status:"RELEASED",rows:result.released.slice(0,8),
     evidence:"REGISTRY_HULL_NO_LONGER_THE_PILOTS_PHYSICAL_SHIP"});
  if(result.mobilized.length)require("./coopRuntimeProbe").observe(
   "living-native-war-mobilization",null,null,
   {status:result.status,ships:result.mobilized,
    evidence:"EXISTING_NATIVE_PATROLS_RESERVED_NO_SPAWN_OR_FUNDS"});
  else if(Array.isArray(result.blocked)&&result.blocked.length){
   // The native fleet registry refused the real hull. Its own reason is the only
   // honest explanation of an empty side, so publish it once per distinct set.
   const signature=JSON.stringify(result.blocked.map(x=>x.entityID+":"+x.reason));
   if(warSkipReasons["mobilization-blocked"]!==signature){
    warSkipReasons["mobilization-blocked"]=signature;
    require("./coopRuntimeProbe").observe("living-native-war-mobilization-blocked",
     null,null,{status:"BLOCKED",ships:result.blocked.slice(0,8),
      evidence:"NATIVE_FLEET_REGISTRY_REFUSED_ASSIGN"});
   }
  } else{
   // FW-102: "OBSERVED" with an empty mobilized[] is exactly what a stalled front
   // looks like, and the phase published nothing but the word OBSERVED. The per-side
   // report (system tracked? how many candidates passed every native gate? the first
   // rejection reasons) is published once per distinct set, so the reason a side stays
   // empty is visible without attaching an inspector to the live server.
   const report=Array.isArray(result.campaigns)?result.campaigns:[];
   const signature=JSON.stringify(report.map(c=>[c.campaignID,Array.isArray(c.sides)?
    c.sides.map(s=>[s.factionID,s.systemID,s.status,s.assigned,
     (s.rejected||[]).map(r=>r.reason)]):[]]));
   if(report.length&&warSkipReasons["mobilization-idle"]!==signature){
    warSkipReasons["mobilization-idle"]=signature;
    require("./coopRuntimeProbe").observe("living-native-war-mobilization-idle",
     null,null,{status:String(result.status||"UNKNOWN"),campaigns:report.slice(0,4),
      activeCampaignCount:Number(result.activeCampaignCount)||0,
      evidence:"NO_CANDIDATE_PASSED_EVERY_NATIVE_GATE"});
   } else warSkip("mobilization","NO_MOBILIZED_SHIP:"+String(result.status||"UNKNOWN"));
  }
 }
 // FW-003D: a registered battle-line hull that has no compatible charge left can
 // never fire again, and the mobiliser counts every registered hull of a side, so
 // one dry hull would block that side for the rest of the campaign. Release only
 // war custody (native RELEASE proof), never the hull, its modules or its cargo.
 function advanceNativeWarBattleLineRelief(){
  if(process.env.EVEJS_COOP_FACTION_WAR_RELIEF!=="1")return;
  if(!visitedSystems.size)return warSkip("relief","NO_VISITED_SYSTEMS");
  const registry=nativeWarFleetRegistry();
  if(!registry)return warSkip("relief","NO_WAR_FLEET_REGISTRY");
  try{
   if(!warRelief){
    const native=require("./runtime"),npcStore=require("./npc/nativeNpcStore"),
     dogma=require("./combat/weaponDogma"),capability=require("./npc/npcCapabilityResolver"),
     npc=require("./npc/npcRuntime");
    // Restart safety: a hull whose wreck is already in the durable casualty ledger
    // stays out of the battle line even though this process never saw the wreck.
    if(!casualtySeedDone){
     casualtySeedDone=true;
     try{
      const row=require("./coopNativeRowPath").readRow(
       require("../gameStore"),"corporationRuntime","coop-faction-war\u001fcasualties-v1");
      for(const entry of Object.values(row?.byWreck||{})){
       const id=Number(entry?.entityID);
       if(Number.isSafeInteger(id)&&id>0)destroyedNativeShips.add(id);
      }
     }catch(error){
      console.warn("[CoopWarRelief] casualty seed",String(error&&error.message||error));
     }
    }
    // The dry verdict is the mobiliser's own rule, never a second opinion.
    const readiness=require("./coopWarMusterReadiness").createWarMusterReadiness({
     store:npcStore,resolveFamily:dogma.resolveWeaponFamily,
     isOptional:dogma.isChargeOptionalTurretWeapon,
     compatible:capability.isNpcChargeCompatibleWithModule
    });
    warRelief=require("./coopWarBattleLineRelief").createWarBattleLineRelief({
     registry,
     sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
     getNativeEntity:id=>npcStore.getNativeEntity(id),
     inspectReadiness:context=>readiness.inspect(context),
     // A hull this process confirmed as a real native wreck is not merely idle:
     // it is gone, and its slot must not stay occupied by a corpse.
     isDestroyed:id=>destroyedNativeShips.has(Number(id)),
     // Both calls are the same native manual-order API the battle director uses:
     // stop clears the live target, resumeBehavior clears the manual order, which
     // is exactly what the registry's native release proof requires.
     clearOrder:({entityID})=>{npc.issueOrder(entityID,{type:"stop"});
      npc.resumeBehavior(entityID);}
    });
   }
   const result=warRelief.tick({systemIDs:[...visitedSystems].slice(0,12)});
   if(result.released.length)require("./coopRuntimeProbe").observe(
    "living-native-war-battle-line-relief",null,null,
    {status:result.status,ships:result.released,
     evidence:"NO_COMPATIBLE_CHARGE_LEFT_SLOT_RELEASED_HULL_PRESERVED"});
   else if(result.dry.length)warSkip("relief","RELEASE_BLOCKED:"+
    String(result.blocked[0]&&result.blocked[0].reason||"UNKNOWN"));
  }catch(error){
   warSkip("relief","RELIEF_FAILED:"+String(error&&error.message||error));
  }
 }
 // Read-only operator diagnostic: what would mobilization do right now, and why
 // not. Uses the same live authorities and the mobilizer's own dry run, so it can
 // never reserve, order or mutate anything.
 // Read-only: the war state as the phases really see it. Territories, wars and
 // campaigns are the exact rows the opening/assault phases read, so "no front" and
 // "0 campaigns" stop being guesses. It never writes, reserves or plans.
 function diagnoseWarState(){
  let state;
  try{state=warStateStore().read();}
  catch(error){return {status:"WAR_STATE_UNAVAILABLE",
   reason:String(error&&error.message||error).slice(0,120)};}
  if(!state||typeof state!=="object")return {status:"NO_WAR_STATE"};
  const territories=state.territories&&typeof state.territories==="object"?
   state.territories:{};
  const wars=Object.values(state.wars||{}).map(war=>({
   warID:String(war?.warID||""),
   attackerFactionID:Number(war?.attackerFactionID)||0,
   defenderFactionID:Number(war?.defenderFactionID)||0,
   // The war record carries `state` (the value every phase gates on). Reporting
   // only a `status` field that the record does not have made every war look
   // stateless to an operator.
   state:String(war?.state||""),
   status:String(war?.state||war?.status||""),
   startedAt:Number(war?.startedAt)||0,
  }));
  const campaigns=Object.values(state.campaigns||{}).map(campaign=>({
   campaignID:String(campaign?.campaignID||""),
   warID:String(campaign?.warID||""),
   sourceSystemID:Number(campaign?.sourceSystemID)||0,
   targetSystemID:Number(campaign?.targetSystemID)||0,
   state:String(campaign?.state||""),
   status:String(campaign?.state||campaign?.status||""),
   startedAt:Number(campaign?.startedAt)||0,
   structureID:Number(campaign?.structureID)||0,
  }));
  const campaignStates={};
  for(const campaign of campaigns)
   campaignStates[campaign.state||"UNKNOWN"]=
    (campaignStates[campaign.state||"UNKNOWN"]||0)+1;
  return {status:"OK",version:Number(state.version)||0,
   territories,wars,campaigns,campaignStates,
   counts:{territories:Object.keys(territories).length,wars:wars.length,
    campaigns:campaigns.length},
   presence:presenceSummary()};
 }
 // The same presence the opening phase derives territories from: per system, how
 // many linked pilots resolve to a real faction, and why a link was skipped. A
 // funded faction with no territory here can never get a front.
 function diagnoseMobilization(){
  if(!visitedSystems.size)return {status:"NO_VISITED_SYSTEMS"};
  // FW-102: build the mobiliser with the same factory the phase uses instead of
  // reporting NOT_INITIALIZED whenever the phase has not ticked in this process yet.
  let runtimeMobilizer=null,why="";
  try{
   const registry=nativeWarFleetRegistry(),guard=npcOrderBridge();
   if(!registry)why="NO_WAR_FLEET_REGISTRY";
   else if(!guard)why="NO_ORDER_BRIDGE";
   else if(!getIdentityRegistry())why="NO_IDENTITY_REGISTRY";
   else runtimeMobilizer=warMobilizerInstance(registry,guard);
  }catch(error){why="MOBILIZER_CREATE_THREW:"+String(error&&error.message||error)}
  if(!runtimeMobilizer)return {status:"MOBILIZER_NOT_INITIALIZED",reason:why||"UNKNOWN"};
  try{
   // Every tracked system is offered to the planner, sorted so the set never
   // depends on the order the world happened to visit systems in. The mobiliser
   // itself reports one block per LIVE campaign (campaigns[]), so a second war
   // can no longer be hidden behind the first one.
   const systemIDs=[...visitedSystems].sort((a,b)=>a-b).slice(0,20);
   const result=runtimeMobilizer.tick({systemIDs,dryRun:true});
   return Object.assign({},result,{systemIDs,
    campaignCount:Array.isArray(result.campaigns)?result.campaigns.length:0});
  }catch(error){
   return {status:"DIAGNOSE_FAILED",reason:String(error&&error.message||error)};
  }
 }
 // Read-only operator diagnostic for the battle leg. For every registered war
 // hull it reports the physical scene, the native controller and the exact
 // pairing verdict the director would get, so a silent "no attack order" tick is
 // explained instead of guessed at. It never issues an order, reserves a ship,
 // writes a row or spends ammo.
 function diagnoseCombat(){
  const api=require("./coopWarCombatAuthority");
  const flags={combat:api.combatEnabled(),ammo:api.ammoEnabled()};
  if(!visitedSystems.size)return {status:"NO_VISITED_SYSTEMS",flags};
  let war,fleet;
  try{
   war=warStateStore().read();
   fleet=nativeWarFleetRegistry()?.snapshot();
  }catch(error){
   return {status:"NATIVE_STATE_UNAVAILABLE",flags,
    reason:String(error&&error.message||error)};
  }
  if(war?.version!==1||fleet?.version!==1)
   return {status:"WAR_OR_FLEET_STATE_INVALID",flags};
  const runtime=require("./runtime"),controllers=require("./npc/npcRegistry"),
   entityStore=require("./npc/nativeNpcStore");
  let authority=null;
  try{
   authority=api.createWarCombatAuthority({
    gameStore:require("../gameStore"),
    getController:id=>controllers.getControllerByEntityID(id),
    getNativeEntity:id=>entityStore.getNativeEntity(id),
    getFactionForCorporation:id=>
     require("../services/faction/factionState").getFactionIDForCorporation(id)
   });
  }catch(error){
   return {status:"AUTHORITY_UNAVAILABLE",flags,
    reason:String(error&&error.message||error)};
  }
  const vec=x=>x&&["x","y","z"].every(k=>typeof x[k]==="number"&&
   Number.isFinite(x[k]));
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const ships=[],entities=new Map();
  for(const row of Object.values(fleet.ships)
   .sort((a,b)=>a.entityID-b.entityID).slice(0,32)){
   const scene=runtime.scenes instanceof Map?
    runtime.scenes.get(row.systemID):null;
   const entity=scene?.getEntityByID?.(row.entityID)||null;
   let ctrl=null,native=null,hp=null;
   try{ctrl=controllers.getControllerByEntityID(row.entityID)}catch{}
   try{native=entityStore.getNativeEntity(row.entityID)}catch{}
   try{
    // The same authoritative native health layers the combat evidence sampler
    // uses: a reported activation is not damage, a measured layer loss is.
    const damage=require("./combat/damage");
    const max=damage.getEntityMaxHealthLayers(entity);
    if(entity&&Object.values(max).some(n=>n>0))
     hp=damage.getEntityCurrentHealthLayers(entity,max);
   }catch{hp=null}
   const campaign=war.campaigns[row.campaignID]||null,
    factionID=Number(row.factionID)||0;
   const opponentSystem=Number(campaign?.targetSystemID)||0;
   ships.push({entityID:row.entityID,pilotID:row.pilotID,
    factionID,systemID:row.systemID,campaignID:row.campaignID,
    warID:row.warID,
    campaignState:String(campaign?.state||"UNKNOWN"),
    warState:String(war.wars[row.warID]?.state||"UNKNOWN"),
    // The battle can only happen in the campaign's target system.
    inBattleSystem:opponentSystem===0||row.systemID===opponentSystem,
    nativeSystemID:Number(native?.systemID)||0,
    nativeTransient:native?.transient===true,
    sceneSystemID:Number(scene?.systemID)||0,
    inScene:Boolean(entity),kind:String(entity?.kind||""),
    nativeNpc:entity?.nativeNpc===true,
    playerSession:Number(entity?.session?.characterID)||0,
    mode:String(entity?.mode||""),
    position:vec(entity?.position)?entity.position:null,
    hp,
    controllerSystemID:Number(ctrl?.systemID)||0,
    currentTargetID:Number(ctrl?.currentTargetID)||0,
    manualOrder:ctrl?.manualOrder?
     {type:String(ctrl.manualOrder.type||""),
      targetID:Number(ctrl.manualOrder.targetID)||0}:null,
    ammoRetreat:getNativeAmmoSupply()?.activeIDs(row.systemID)?.has(row.entityID)===true,
    tacticalBusy:getTacticsDirector()?.activeIDs()?.has(row.entityID)===true});
   if(entity)entities.set(row.entityID,entity);
  }
  const pairs=[];
  for(const attacker of ships)for(const target of ships){
   if(attacker.entityID>=target.entityID)continue;
   if(attacker.campaignID!==target.campaignID||
    attacker.factionID===target.factionID)continue;
   const a=entities.get(attacker.entityID),b=entities.get(target.entityID);
   const shared=a&&b&&a.position&&b.position?
    Math.round(dist(a.position,b.position)):null;
   let verdict;
   try{
    verdict=authority.evaluatePair(a,b,{requireAttackIntent:false});
   }catch(error){verdict={status:"BLOCKED",
    reason:String(error&&error.message||error)}}
   pairs.push({attackerID:attacker.entityID,targetID:target.entityID,
    sameSystem:attacker.systemID===target.systemID,
    distanceMeters:shared,
    inRange:shared!==null&&shared<=250000,
    verdict:String(verdict?.status||"UNKNOWN"),
    reason:String(verdict?.reason||""),
    warID:String(verdict?.warID||"")});
  }
  return {status:"OBSERVED",flags,
   visitedSystems:[...visitedSystems].slice(0,12).sort((a,b)=>a-b),
   campaigns:Object.values(war.campaigns).slice(0,16).map(c=>({
    campaignID:c.campaignID,warID:c.warID,state:c.state,
    sourceSystemID:c.sourceSystemID,targetSystemID:c.targetSystemID})),
   ships,pairs};
 }
 // A PREPARED ammo-bank journal can only be recovered OUTSIDE the native fire
 // cycle: a transaction is not re-entrant there, so the hot path can refuse but
 // must not repair. This bounded phase recovers journals that the SQLite replay
 // fence proves never committed, so one failed transaction cannot leave a real
 // warship permanently unable to fire. Nothing is refunded and nothing is
 // invented: a fence at the boundary keeps the ship in operator repair.
 function ensureNativeWarGateHandoff(runtime){
  if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER!=="1")return;
  const {flag,createWarGateHandoff}=require("./coopWarGateHandoff");
  if(!flag(process.env))
   throw Error("WAR_GATE_HANDOFF_FLAGS_INCOMPLETE");
  if(warGateHandoff){
   const audit=warGateHandoff.auditStartup();
   if(audit.status!=="CLEAN")
    throw Error("WAR_GATE_HANDOFF_REQUIRES_REPAIR:"+audit.status);
   return;
  }
  if(!getIdentityRegistry())throw Error("WAR_GATE_IDENTITY_MISSING");
  const worldData=require("./worldData"),controllers=require("./npc/npcRegistry"),
   store=require("./npc/nativeNpcStore"),service=require("./npc/nativeNpcService"),
   scramble=require("./modules/hostileModuleRuntime");
  const instance=createWarGateHandoff({
   gameStore:require("../gameStore"),identityRegistry:getIdentityRegistry(),
   sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
   getGate:id=>worldData.getStargateByID(id),
   nativeStore:store,service,
   getController:id=>controllers.getControllerByEntityID(id),
   isScrambled:ship=>scramble.isEntityWarpScrambled(ship),
   journalDir:process.env.EVEJS_COOP_WAR_TRANSFER_JOURNAL_DIR||
    "/var/lib/evejs/coop-war-native-transfers"
  });
  // Keep the controller available to the privileged local operator
  // even if startup is intentionally blocked by an unresolved warship.
  warGateHandoff=instance;
  // The protected recovery channel must stay reachable after quarantine
  // blocks normal world materialization.
  ensureWarRecoverySocket();
  const audit=instance.auditStartup();
  if(audit.status!=="CLEAN")
   throw Error("WAR_GATE_HANDOFF_REQUIRES_REPAIR:"+audit.status);
 }
 function advanceNativeWarGateStaging(){
  if(process.env.EVEJS_COOP_FACTION_WAR_GATE_APPROACH!=="1")
   return warSkip("gate-staging","GATE_APPROACH_FLAG_OFF");
  if(!visitedSystems.size)return warSkip("gate-staging","NO_VISITED_SYSTEMS");
  const {createWarGateStaging,gateReason}=require("./coopWarGateStaging");
  const flags=gateReason(process.env);
  if(flags)return warSkip("gate-staging",flags);
  const guard=npcOrderBridge();
  if(!guard)return warSkip("gate-staging","NO_ORDER_BRIDGE");
  if(!nativeWarFleetRegistry())return warSkip("gate-staging","NO_WAR_FLEET_REGISTRY");
  if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER==="1"){
   ensureNativeWarGateHandoff(require("./runtime"));
   const finished=warGateHandoff?.retireCompleted({max:2});
   if(finished?.retired?.length)
    require("./coopRuntimeProbe").observe(
     "living-native-war-transit-retired",null,null,{
      status:finished.status,retired:finished.retired,
      evidence:"PROVEN_TERMINAL_TRANSFER_ARCHIVED_NO_SHIP_MOVEMENT"
     });
  }
  if(!warGateStaging){
   const native=require("./runtime"),npc=require("./npc/npcRuntime"),
    controllers=require("./npc/npcRegistry"),worldData=require("./worldData"),
    gameStore=require("../gameStore"),
    warStore=require("./coopFactionWarStore"),
    fleetStore=require("./coopWarFleetRegistry"),
    treasuryStore=require("./coopWarTreasury"),
    warCore=require("./coopFactionWarCore"),
    nativeRows=require("./coopNativeRowPath");
   function readRow(table,key,validate){
    // War rows live in the atomic-rows keyspace, whose JSON cache path is nested
    // at the \u001f separator; the raw key read reports ENTRY_NOT_FOUND.
    const row=nativeRows.readRow(gameStore,table,key,validate);
    return row||null;
   }
   warGateStaging=createWarGateStaging({
    readWar:()=>readRow(warStore.TABLE,warStore.KEY,warCore.validateState),
    readFleet:()=>readRow(fleetStore.TABLE,fleetStore.KEY,fleetStore.validate),
    readTreasury:()=>readRow(treasuryStore.TABLE,treasuryStore.KEY,treasuryStore.validate),
    sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
    getGate:id=>worldData.getStargateByID(id),
    warpToEntity:(id,targetID,opts)=>npc.warpToEntity(id,targetID,opts),
    getController:id=>controllers.getControllerByEntityID(id),
    bridge:guard,
    transfer:warGateHandoff?(args=>warGateHandoff.transfer(args)):null,
    // The durable, behaviour-loop-respecting form: a native manual movement order
    // on the real gate entity. A one-shot follow loses to the NPC's own loop.
    orderFollow:(entityID,targetID,options)=>{
     try{
      const answer=require("./npc/npcService").issueManualOrder(entityID,{
       type:"follow",targetID,followRangeMeters:Number(options?.rangeMeters)||1000,
       allowWeapons:false});
      if(answer?.success!==true)followOrderReason=String(answer?.errorMsg||"MANUAL_FOLLOW_ORDER_REFUSED");
      return answer?.success===true;
     }catch(error){
      followOrderReason="MANUAL_FOLLOW_ORDER_THROW:"+String(error?.message||error).slice(0,80);
      return false;
     }
    },
    isTactical:id=>getTacticsDirector()?.activeIDs()?.has(id)===true,
    isAmmoRetreat:(systemID,id)=>getNativeAmmoSupply()?.activeIDs(systemID)?.has(id)===true
   });
  }
  const result=warGateStaging.tick({systemIDs:[...visitedSystems].slice(0,12)});
  for(const moved of result.orders){
   if(moved.action==="VERIFIED_NATIVE_GATE_TRANSFER")
    visitedSystems.add(Number(moved.targetSystemID));
  }
  // An order is real evidence and is always published. A refusal is published
  // once per distinct set so a front whose attacker never arrives names the
  // exact precondition instead of looking like a silent no-op.
  const skips=Array.isArray(result.skips)?result.skips:[];
  const key=JSON.stringify(skips);
  if(result.orders.length){
   gateStagingSkipKey=key;
   require("./coopRuntimeProbe").observe("living-native-war-gate-staging",
    null,null,{status:result.status,orders:result.orders,
     observations:result.observations,skips,followOrderReason,
     evidence:"PHYSICAL_GATE_APPROACH_ONLY_NO_SYSTEM_TRANSFER"});
  }else if(result.observations.length){
   require("./coopRuntimeProbe").observe("living-native-war-gate-staging",
    null,null,{status:result.status,orders:[],observations:result.observations,
     skips,followOrderReason,evidence:"PHYSICAL_GATE_APPROACH_ONLY_NO_SYSTEM_TRANSFER"});
  }else if(skips.length&&key!==gateStagingSkipKey){
   gateStagingSkipKey=key;
   require("./coopRuntimeProbe").observe("living-native-war-gate-staging",
    null,null,{status:"SKIPPED",reason:skips[0].reason,skips,followOrderReason,
     evidence:"EXPLICIT_PRECONDITION_NOT_MET"});
  }
 }
 // FW-033: a front that cannot refill is not a war. After real losses a side can
 // hold zero hulls while the campaign stays in ASSAULT, and nothing ever puts a
 // navy back. This refills a side through the SAME sanctioned spawn path an
 // operator uses (`spawn_war_fleet`: real doctrine row, real native ship, real
 // free pilot identity) and reports the native status of every attempt.
 let warGarrisonTicks=0;
 function advanceNativeWarGarrison(){
  // The garrison really spawns formations now (it threw on every tick before, so
  // this work never ran). One formation costs ~1.4 s of blocked loop, so it runs
  // on every second tick, offset from war-opening so the two never collide.
  warGarrisonTicks=(warGarrisonTicks+1)%2;
  if(warGarrisonTicks!==0)return;
  const garrison=require("./coopWarGarrison");
  if(!garrison.enabled(process.env))return warSkip("garrison","FLAG_OFF");
  if(!nativeWarFleetRegistry())return warSkip("garrison","NO_WAR_FLEET_REGISTRY");
  if(!getIdentityRegistry())return warSkip("garrison","NO_IDENTITY_REGISTRY");
  if(!warGarrison)warGarrison=garrison.createWarGarrison({
   // FW-132 (measured 2026-10-31T15:25Z): one side per tick meant a fresh front needed two
   // full cycles before BOTH sides existed, so five PREPARING fronts sat WAITING while the
   // single slot rotated between them and the assault never began. Two sides per tick is
   // still one sanctioned spawn per side, and it lets a front muster in one cycle.
   maxSpawnsPerTick:2,
   // A formation is ~0.7 s of real spawn work. Whatever does not fit in this
   // budget is continued on the next garrison tick, so one tick can never hold the
   // loop for two full formations.
   maxMsPerTick:600,
   // FW-134: the hulls this exact side already lost in this campaign, straight from the
   // casualty ledger - the only record that survives a released identity link.
   lossCount:({campaignID,factionID})=>{
    try{
     const snapshot=warCasualtySnapshot();
     return Object.values((snapshot&&snapshot.byWreck)||{})
      .filter(row=>row&&row.campaignID===campaignID&&
       Number(row.victimFactionID)===Number(factionID)).length;
    }catch(_error){return 0}
   },
   // FW-033 measured 2026-11-02: this phase cost 1.0-2.3 s on EVERY world tick (perf sample "native-faction-war-
   // garrison"), because readWarState() reads the whole war state out of the game store and the fleet registry clones
   // every hull, twice per minute, for a refill that changes at most once a cycle. A 20 s cache cannot delay a real
   // garrison refill in any way that matters.
   readWarState:()=>memoFor(20000,"garrison-war-state",()=>warStateStore().read()),
   registry:memoFor(20000,"garrison-fleet-registry",()=>nativeWarFleetRegistry(),{
    wrap:"snapshot"
   }),
   // FW-115: a commander spawns the formation its EARNED merit allows (recruit 1, pilot 2,
   // wingman 3, squad-lead 5 ...), so a veteran side brings tackle, EWAR and logistics
   // instead of the single identical frigate every side used to field.
   meritOf:pilotID=>{
    try{
     // records() already answers the per-pilot map, not the whole ledger state.
     const row=warMeritRecords()?.[String(pilotID)];
     // FW-129 (measured 2026-10-31): every fresh side mustered at merit 0, which the
     // composition reads as a recruit's SINGLE frigate - two lone frigates per front,
     // so a whole war was one hull against one hull and a kill took an hour. The earned
     // rank still raises the gang (25/70/150/300/600/1200 merit), but a side now starts
     // as a real squadron instead of a duel.
     const floor=Number(process.env.EVEJS_COOP_WAR_MIN_MERIT||70);
     return Math.max(Number.isFinite(floor)&&floor>=0?floor:70,
      Number(row&&row.merit)||0);
    }catch(_error){return 70}
   },
   // N5: a replacement hull must be paid for by the campaign chest, which only
   // ever holds ISK a real market fill paid to an NPC pilot (FW-005B). An unfunded
   // front stops buying navies, which is the only way a force-captured system
   // ever holds zero live defender hulls for the full sustain window (FW-035).
   chestCommitment:({factionID,warID,campaignID})=>{
    try{
     const snapshot=warChestStore().snapshot();
     if(!snapshot||snapshot.status!=="OK")
      return {status:"UNAVAILABLE",reason:"GARRISON_CHEST_UNAVAILABLE"};
     const entry=(snapshot.committed||[]).find(e=>
      Number(e.factionID)===Number(factionID)&&e.warID===warID&&
      e.campaignID===campaignID&&Number(e.totalCents)>0);
     if(!entry)return {status:"UNFUNDED",reason:"GARRISON_CHEST_EMPTY"};
     return {status:"FUNDED",totalCents:Number(entry.totalCents),journalID:entry.journalID};
    }catch(_error){return {status:"UNAVAILABLE",reason:"GARRISON_CHEST_UNAVAILABLE"}}
   },
   // A hull destroyed or despawned without a confirmed wreck keeps its custody
   // row (absence is never destruction), but its identity must not stay bound to
   // a ghost: that starved the garrison of commanders and froze the war with
   // NO_FREE_PILOT_IDENTITY. A link whose ship is in no live scene is reclaimed
   // here, and only then offered as a free pilot.
   listFreePilots:()=>{
    const native=require("./runtime");
    const links=Object.values(getIdentityRegistry().snapshot()?.links||{});
    const linked=new Set(links.map(l=>String(l?.pilotID)));
    const free=(getWorld()?.snapshot?.().pilots||[])
     .map(p=>String(p?.id||"")).filter(id=>id&&!linked.has(id));
    for(const link of links){
     const pilotID=String(link?.pilotID||"");
     if(!pilotID)continue;
     const systemID=Number(link?.systemID),entityID=Number(link?.entityID);
     let live=false;
     try{
      const scene=native.scenes instanceof Map?native.scenes.get(systemID):null;
      live=Boolean(scene&&typeof scene.getEntityByID==="function"&&
       scene.getEntityByID(entityID));
     }catch{live=false}
     if(live)continue;
     try{
      const released=releaseSpawnedIdentity({pilotID,entityID,
       reason:"GHOST_HULL_NO_SCENE"});
      if(released?.status==="RELEASED")free.push(pilotID);
     }catch{}
    }
    return free;
   },
   isHullLive:(systemID,entityID)=>{
    try{
     const native=require("./runtime");
     const scene=native.scenes instanceof Map?native.scenes.get(Number(systemID)):null;
     return Boolean(scene&&typeof scene.getEntityByID==="function"&&
      scene.getEntityByID(Number(entityID)));
    }catch{return false}
   },
   spawnFleet:({factionID,systemID,commanderPilotID,merit})=>
    require("./coopAdminBridge").executeRequest({
     action:"spawn_war_fleet",factionID,systemID,merit,commanderPilotID})
  });
  const result=warGarrison.tick();
  if(result.applied.length)require("./coopRuntimeProbe").observe(
   "living-native-war-garrison",null,null,{
    status:result.status,applied:result.applied,
    evidence:"SANCTIONED_WAR_FLEET_SPAWN_NO_INVENTED_HULL"});
  else if(result.skips.length)warSkip("garrison",
   String(result.skips[0].reason||result.status));
 }
 function advanceNativeWarCombat(){
  const api=require("./coopWarCombatAuthority");
  if(!api.combatEnabled())return warSkip("combat","COMBAT_FLAGS_OFF");
  if(!api.ammoEnabled())return warSkip("combat","AMMO_FLAGS_OFF");
  if(!visitedSystems.size)return warSkip("combat","NO_VISITED_SYSTEMS");
  const guard=npcOrderBridge();
  if(!guard)return warSkip("combat","NO_ORDER_BRIDGE");
  if(!nativeWarFleetRegistry())return warSkip("combat","NO_WAR_FLEET_REGISTRY");
  const runtime=require("./runtime");
  if(!warBattleDirector){
   const npc=require("./npc/npcRuntime");
   const authority=api.createWarCombatAuthority({
    gameStore:require("../gameStore"),
    getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
    getNativeEntity:id=>require("./npc/nativeNpcStore").getNativeEntity(id),
    getFactionForCorporation:id=>
     require("../services/faction/factionState").getFactionIDForCorporation(id)
   });
   warBattleDirector=require("./coopWarBattleDirector").createWarBattleDirector({
    authority,bridge:guard,
    sceneForSystem:id=>runtime.scenes instanceof Map?runtime.scenes.get(id):null,
    issueNativeAttack:(id,targetID,options)=>npc.issueAttackOrder(id,targetID,options),
    getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
    isAmmoDepleted:(sys,id)=>getNativeAmmoSupply()?.activeIDs(sys)?.has(id)===true,
    isTactical:id=>getTacticsDirector()?.activeIDs()?.has(id)===true,
    // FW-117: the role a hull flies, so a destroyer hunts enemy tackle and an EWAR ship
    // hunts enemy support instead of everyone shooting the nearest hull.
    roleOfEntity:warHullRole
   });
  }
  // FW-031: a war hull spawned at a belt anchor sits 150 km from home with a 90 km
  // native leash, so the behaviour loop cleared its combat state every think and an
  // accepted attack order never became a target. Clear the leash and orbit inside
  // the real gun range BEFORE the director issues the order.
  try{
   if(!warPosture)warPosture=require("./coopWarEngagementPosture")
    .createWarEngagementPosture({
     readWarState:()=>warStateStore().read(),
     registry:nativeWarFleetRegistry(),
     getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
     setBehaviorOverrides:(id,overrides)=>
      require("./npc/npcService").setBehaviorOverrides(id,overrides),
     // FW-118: each role keeps its own engagement range instead of one 500 m ball.
     roleOfEntity:warHullRole,
     // FW-129: two orders per tick with a two-minute re-order meant at most two hulls of a
     // ten-hull front were ever shooting. Three per tick every 45 s lets a squadron engage
     // and keep engaging, which is the difference between a duel and a battle.
     maxOrders:3,cooldownMs:45000
    });
   const posture=warPosture.tick();
   if(posture.applied.length)require("./coopRuntimeProbe").observe(
    "living-native-war-engagement-posture",null,null,{
     status:posture.status,applied:posture.applied,
     skips:posture.skips.slice(0,4),
     evidence:"NATIVE_BEHAVIOUR_OVERRIDES_NO_LEASH_GUN_ORBIT"
    });
  }catch(error){
   warSkip("combat-posture","THREW:"+String(error?.message||error).slice(0,120));
  }
  const result=warBattleDirector.tick({systemIDs:[...visitedSystems].sort((a,b)=>a-b).slice(0,12)});
  // FW-030: a warp started here is what puts the two sides inside the native
  // 250 km firing envelope at all; the next tick's director can then fire.
  try{
   if(!warEngagement){
    const native=require("./runtime");
    warEngagement=require("./coopWarEngagementWarp")
     .createWarEngagementWarp({
      readWarState:()=>warStateStore().read(),
      registry:nativeWarFleetRegistry(),
      sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
      getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
      warpToPoint:(id,point,options)=>
       require("./npc/npcRuntime").warpToPoint(id,point,options),
      warpBatchToPoints:(requests,options)=>
       require("./npc/npcRuntime").warpBatchToPoints(requests,options)
     });
   }
   const engagement=warEngagement.tick({
    systemIDs:[...visitedSystems].sort((a,b)=>a-b).slice(0,12)});
   if(engagement.orders.length)require("./coopRuntimeProbe").observe(
    "living-native-war-engagement-warp",null,null,{
     status:engagement.status,orders:engagement.orders,
     skips:engagement.skips.slice(0,4),
     evidence:"REAL_NATIVE_WARP_TO_ENEMY_NO_DAMAGE"
    });
  }catch(error){
   warSkip("combat-warp","THREW:"+String(error?.message||error).slice(0,120));
  }
  if(result.orders.length)require("./coopRuntimeProbe").observe(
   "living-native-war-attack-orders",null,null,{
    status:result.status,orders:result.orders,
    evidence:"ACK_ONLY_NOT_DAMAGE_OR_KILL"
   });
  // Owner requirement: an enlisted player is one ship in a fleet, so the ranking
  // itself is published - who was considered, at what range, in which order and
  // why the chosen target won. A player who is only one of several candidates is
  // visible here instead of being inferred from the order list.
  if(Array.isArray(result.selections)&&result.selections.length){
   const signature=JSON.stringify(result.selections.map(s=>s.shipID+":"+
    s.candidates.map(c=>c.entityID+(c.chosen?"*":"")).join(",")));
   if(warSkipReasons["battle-selection"]!==signature){
    warSkipReasons["battle-selection"]=signature;
    require("./coopRuntimeProbe").observe("living-native-war-target-selection",
     null,null,{status:"RANKED",ships:result.selections.slice(0,8),
      evidence:"SAME_DISTANCE_RULE_FOR_NPC_AND_PLAYER"});
   }
  }
 }
 // FW-009B: original stocked native structures, real killmail combat
 // proof, fully enumerated physical ships. No independent scheduler and
 // no virtual capture. A missing source, unknown scene or absent explicit
 // objective-type allowlist keeps military control unchanged.
 function advanceNativeWarObjectives(){
  const {enabled,createWarObjectiveDirector}=require("./coopWarObjectiveDirector");
  if(!enabled(process.env)||!visitedSystems.size)return;
  if(!require("./coopWarObjectiveDirector").typesFromEnv(process.env).size)return;
  if(!warObjectiveDirector){
   const gameStore=require("../gameStore"),
    worldData=require("./worldData"),
    runtime=require("./runtime"),
    controllers=require("./npc/npcRegistry"),
    npcStore=require("./npc/nativeNpcStore"),
    factions=require("../services/faction/factionState"),
    structure=require("./coopWarNativeStructureControl"),
    proofApi=require("./coopWarNativeStructureCombatProof"),
    adjudicatorApi=require("./coopWarObjectiveAdjudicator");
   const getNativeStructure=id=>worldData.getStructureByID(id),
    getFactionForCorporation=id=>factions.getFactionIDForCorporation(id);
   const proof=proofApi.createWarStructureCombatProof({
    gameStore,getNativeStructure,getFactionForCorporation,
    getNativeKillmail:id=>
     require("../services/killmail/killmailState").getKillmailRecord(id)
   });
   const occupancy=structure.createNativeStructureControlWitness({
    sceneForSystem:id=>runtime.scenes instanceof Map?
     runtime.scenes.get(id):null,
    listAllPhysicalShips:structure.listPinnedSceneShips,
    getNativeEntity:id=>npcStore.getNativeEntity(id),
    getController:id=>controllers.getControllerByEntityID(id),
    getFactionForCorporation,
    allowMilitiaPlayers:process.env.EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE==="1",
    getLivePlayerSessions:()=>require("../services/chat/sessionRegistry").getSessions()
   });
   const adjudicator=adjudicatorApi.createWarObjectiveAdjudicator({
    gameStore,getNativeStructure,getFactionForCorporation,
    verifyNativeCombatDestruction:d=>
     proof.verifyNativeCombatDestruction(d),
    observeNativeControl:d=>occupancy.observe(d)
   });
   warObjectiveDirector=createWarObjectiveDirector({
    adjudicator,combatProof:proof,
    getFactionForCorporation,
    listNativeStructures:systemID=>worldData.getStructuresForSystem(systemID),
    readWarState:()=>warStateStore().read()
   });
  }
  const result=warObjectiveDirector.tick({
   systemIDs:[...visitedSystems].slice(0,12)
  });
  if(result.events?.length)
   require("./coopRuntimeProbe").observe(
    "living-native-war-objectives",null,null,{
     status:result.status,events:result.events,
     evidence:"PHYSICAL_STRUCTURE_COMBAT_KILLMAIL_AND_UNCONTESTED_NATIVE_OCCUPANCY"
    });
  // A captured system is a real front event: report it once, to that system.
  for(const event of result.events||[]){
   if(!event||event.kind!=="MILITARY_CONTROL_CAPTURED")continue;
   let capturerFactionID=0;
   try{
    const warState=warStateStore().read();
    const campaign=warState&&warState.campaigns&&warState.campaigns[event.campaignID];
    capturerFactionID=Number(warState?.wars?.[campaign?.warID]?.attackerFactionID)||0;
   }catch(_error){capturerFactionID=0}
   warFrontChat("objective-captured",{
    eventKey:String(event.campaignID||"")+":"+String(event.systemID||"")+":"+String(event.revision||""),
    systemID:event.systemID,
    factionID:capturerFactionID,
   },[event.systemID]);
  }
 }

 return {warHullRole,warMeritRecords,memoFor,advanceNativeWarDemobilization,legacyWarStateMirrorEnabled,warStateStore,warMirrorEnabled,warMirror,mirrorWarState,readWarMirror,chooseWarRestore,ensureWarState,warChestStore,warEarnedLedger,warNavyCapability,diagnoseNavy,warBountyStore,diagnoseWarPayout,lastWarAttributionStatus,warCasualtySnapshot,refundExpiredCampaigns,reconcileTerminalEscrow,reconcileBountyCredits,warBountyRelease,warFactionCorporationCandidates,warCorporationBalanceISK,warFundingCorporation,warBountyReserve,diagnoseWarFunding,warMercenarySettlement,executeMercenaryContract,diagnoseMercenarySettlement,diagnoseMercenary,advanceNativeWarSovereigntyProjection,advanceNativeWarOpening,advanceNativeWarAssault,warMobilizerInstance,advanceNativeWarMobilization,advanceNativeWarBattleLineRelief,diagnoseWarState,diagnoseMobilization,diagnoseCombat,ensureNativeWarGateHandoff,advanceNativeWarGateStaging,advanceNativeWarGarrison,advanceNativeWarCombat,advanceNativeWarObjectives,
  // the pure-layer mirror needs the live handoff instance; the state stays here
  currentWarGateHandoff:()=>warGateHandoff};
}

module.exports = { createWarRuntime };
