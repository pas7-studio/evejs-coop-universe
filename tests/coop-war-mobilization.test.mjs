import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarMobilizer,enabled}=require("../integration/coopWarMobilizer.cjs");
const flags=()=>({
 EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_MOBILIZE:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_ALIFE:"1",EVEJS_COOP_NPC_STRICT_AMMO:"1",
 EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE:"1",EVEJS_COOP_NPC_BANK_ATOMIC:"1"
});
function fixture(){
 const env=flags();
 const war={version:1,wars:{war1:{state:"ACTIVE",attackerFactionID:11,defenderFactionID:22}},
  campaigns:{battle1:{campaignID:"battle1",warID:"war1",state:"PREPARING",
   sourceSystemID:101,targetSystemID:202,startedAt:50}}};
 const links=[
  {pilotID:"coop-pilot-001",entityID:501,systemID:101,role:"patrol"},
  {pilotID:"coop-pilot-002",entityID:502,systemID:101,role:"patrol"},
  {pilotID:"coop-pilot-003",entityID:503,systemID:202,role:"patrol"},
  {pilotID:"coop-pilot-004",entityID:504,systemID:101,role:"trader"},
  {pilotID:"coop-pilot-005",entityID:505,systemID:202,role:"miner"}
 ];
 const entities=new Map(),native=new Map(),controllers=new Map();
 for(const l of links){
  const corporationID=l.systemID===202?32:31;
  entities.set(l.entityID,{itemID:l.entityID,kind:"ship",nativeNpc:true,
   corporationID,ownerID:corporationID,position:{x:0,y:0,z:0}});
  native.set(l.entityID,{entityID:l.entityID,systemID:l.systemID,
   corporationID,ownerID:corporationID});
  controllers.set(l.entityID,{entityID:l.entityID,systemID:l.systemID,
   manualOrder:null,currentTargetID:0});
 }
 const scenes=new Map([101,202].map(systemID=>[systemID,{
  systemID,sessions:new Map(),getEntityByID:id=>entities.get(id)}]));
 const registered={version:1,ships:{},processed:{},history:[]};
 const calls=[];let rejects=false,ammo=false,lease=[],now=100000;
 const registry={snapshot:()=>structuredClone(registered),execute:command=>{
  calls.push(command);
  if(rejects)return {status:"BLOCKED",reason:"NATIVE_SHIP_OR_CAMPAIGN_UNVERIFIED"};
  registered.ships[String(command.entityID)]={...command};
  return {status:"APPLIED",receipt:{entityID:command.entityID}};
 }};
 const mobilizer=createWarMobilizer({
  registry,readWarState:()=>war,readLinks:()=>links,
  sceneForSystem:id=>scenes.get(id),getNativeEntity:id=>native.get(id),
  getController:id=>controllers.get(id),
  getFactionForCorporation:corp=>corp===31?11:corp===32?22:null,
  inspectReadiness:()=>({ready:!ammo}),
  getOrderLeases:()=>lease,isTactical:()=>false,
  clock:()=>now,env,maxPerTick:2,maxPerSide:1});
 return {env,war,links,entities,native,controllers,scenes,registered,calls,
  mobilizer,deny:x=>rejects=x,noAmmo:x=>ammo=x,lease:x=>lease=x,
  tick:()=>mobilizer.tick({systemIDs:[101,202]})};
}
test("physical defender and attacker patrols mobilize once, no hull spawn",()=>{
 const f=fixture(),one=f.tick();
 assert.equal(one.status,"OBSERVED");assert.equal(one.mobilized.length,2);
 assert.deepEqual(one.mobilized.map(x=>x.entityID),[503,501]);
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].fleetID,"fw-battle1-22");
 assert.equal(f.calls[1].fleetID,"fw-battle1-11");
 assert.equal(f.tick().mobilized.length,0);
 assert.equal(f.registered.ships["504"],undefined);
 assert.equal(f.registered.ships["505"],undefined);
});
test("no original war, no native assault and no local scene never spawn an enemy",()=>{
 const f=fixture();f.war.wars.war1.state="ENDED";
 assert.equal(f.tick().mobilized.length,0);assert.equal(f.calls.length,0);
 f.war.wars.war1.state="ACTIVE";
 f.war.campaigns.battle1.state="ASSAULT";
 // Assault attacker must actually have transferred to target, no teleport.
 const r=f.tick();
 assert.deepEqual(r.mobilized.map(x=>x.entityID),[503]);
 assert.equal(f.registered.ships["501"],undefined);
});
test("live player control, native manual order, prior lease and ammo denial",()=>{
 const f=fixture();
 f.scenes.get(202).sessions.set("p",{_space:{shipID:503}});
 f.controllers.get(501).manualOrder={type:"orbit",targetID:900};
 f.controllers.get(502).currentTargetID=900;
 assert.equal(f.tick().mobilized.length,0);
 f.scenes.get(202).sessions.clear();
 f.controllers.get(501).manualOrder=null;
 f.controllers.get(502).currentTargetID=0;
 f.lease([{entityID:501,systemID:101,phase:"OUTCOME_UNKNOWN"}]);
 f.noAmmo(true);
 assert.equal(f.tick().mobilized.length,0);
 f.noAmmo(false);
 const result=f.tick();
 assert.deepEqual(result.mobilized.map(x=>x.entityID),[503,502]);
});
test("physical native corporate affiliation and duplicated pilot IDs fail closed",()=>{
 const f=fixture();
 f.entities.get(503).corporationID=31;
 f.links.push({...f.links[0],entityID:510});
 assert.deepEqual(f.tick().mobilized.map(x=>x.entityID),[502]);
});
test("native writer refusal causes no fabricated fleet registration",()=>{
 const f=fixture();f.deny(true);
 const x=f.tick();
 assert.equal(x.mobilized.length,0);
 assert.deepEqual(f.registered.ships,{});
});
test("disabled or incomplete safety flags do not consult game world",()=>{
 const f=fixture();
 f.env.EVEJS_COOP_FACTION_WAR_MOBILIZE="0";
 assert.equal(f.tick().status,"DISABLED");assert.equal(f.calls.length,0);
 f.env.EVEJS_COOP_FACTION_WAR_MOBILIZE="1";
 delete f.env.EVEJS_COOP_NPC_BANK_ATOMIC;
 assert.equal(enabled(f.env),false);
 assert.equal(f.tick().status,"DISABLED");
});

test("a stranded source-system hull never occupies an assault battle slot",()=>{
 const f=fixture();
 // Real live shape: the attacker side was mobilized during PREPARING from the
 // campaign source system and never physically transferred. The assault then
 // happens in the target system, where a real armed attacker patrol is present.
 f.war.campaigns.battle1.state="ASSAULT";
 f.registered.ships["501"]={entityID:501,systemID:101,pilotID:"coop-pilot-001",
  factionID:11,campaignID:"battle1",warID:"war1"};
 // A second real attacker patrol that is physically in the target system.
 f.links.push({pilotID:"coop-pilot-006",entityID:506,systemID:202,role:"patrol"});
 const corporationID=31;
 f.entities.set(506,{itemID:506,kind:"ship",nativeNpc:true,corporationID,
  ownerID:corporationID,position:{x:0,y:0,z:0}});
 f.native.set(506,{entityID:506,systemID:202,corporationID,ownerID:corporationID});
 f.controllers.set(506,{entityID:506,systemID:202,manualOrder:null,currentTargetID:0});
 const result=f.tick();
 // maxPerSide is 1 in this fixture: the co-located hull fills the assault slot.
 assert.deepEqual(result.mobilized.map(x=>x.entityID),[503,506]);
 const attacker=result.mobilized.find(x=>x.role==="ATTACKER");
 assert.equal(attacker.entityID,506);
 assert.equal(attacker.systemID,202);
 // The stranded hull is untouched: no release, no rewrite, no teleport.
 assert.equal(f.registered.ships["501"].systemID,101);
 assert.equal(f.calls.every(c=>c.entityID!==501),true);
});

test("a dry run reports what would mobilize and never writes",()=>{
 const f=fixture();
 const dry=f.mobilizer.tick({systemIDs:[101,202],dryRun:true});
 assert.equal(dry.status,"DRY_RUN");
 assert.equal(f.calls.length,0);                       // no ASSIGN was executed
 assert.deepEqual(dry.mobilized.map(x=>x.entityID),[503,501]);
 assert.equal(dry.mobilized.every(x=>x.status==="DRY_RUN_MOBILIZABLE"),true);
 assert.equal(f.registered.ships && Object.keys(f.registered.ships).length,0);
});

test("a dry run names the first failed check per candidate",()=>{
 const f=fixture();
 f.noAmmo(true);                                      // real ammo gate stays in force
 const dry=f.mobilizer.tick({systemIDs:[101,202],dryRun:true});
 assert.equal(dry.status,"DRY_RUN");
 assert.equal(dry.mobilized.length,0);
 assert.equal(dry.rejected.length>=1,true);
 // The ammo gate is the real blocker: it is named, not swallowed.
 assert.equal(dry.rejected.some(x=>x.reason==="NOT_READY:UNKNOWN"),true);
 assert.equal(dry.rejected.every(x=>typeof x.reason==="string"&&x.reason.length>0),true);
 assert.equal(f.calls.length,0);
});

test("command size is a rank, not a global constant",()=>{
 const merit=require("../integration/coopFactionWarMerit.cjs");
 assert.equal(merit.commandCapFor({merit:0}),1);          // recruit
 assert.equal(merit.commandCapFor({merit:150}),5);        // squad-lead
 assert.equal(merit.commandCapFor({merit:1200}),25);      // admiral
 assert.equal(merit.commandCapFor(undefined),1);          // no record = recruit
 assert.equal(merit.RANK_BY_NAME["squad-lead"].command,5);
 // a side is commanded by its highest-ranked assigned pilot
 assert.equal(merit.sideCommandCap({pilotIDs:[],records:{}}),1);
 assert.equal(merit.sideCommandCap({pilotIDs:["coop-pilot-001"],
  records:{"coop-pilot-001":{merit:70}}}),3);
 assert.equal(merit.sideCommandCap({pilotIDs:["coop-pilot-001","coop-pilot-002"],
  records:{"coop-pilot-001":{merit:0},"coop-pilot-002":{merit:1200}}}),25);
});

test("a recruit commander caps a side at one ship, an admiral at the hard cap",()=>{
 const f=fixture();
 const recruit=createWarMobilizer({
  registry:{snapshot:()=>structuredClone(f.registered),execute:c=>{f.calls.push(c);
   f.registered.ships[String(c.entityID)]={...c};return {status:"APPLIED"}}},
  readWarState:()=>f.war,readLinks:()=>f.links,
  sceneForSystem:id=>f.scenes.get(id),getNativeEntity:id=>f.native.get(id),
  getController:id=>f.controllers.get(id),
  getFactionForCorporation:corp=>corp===31?11:corp===32?22:null,
  inspectReadiness:()=>({ready:true}),getOrderLeases:()=>[],
  isTactical:()=>false,clock:()=>100000,env:f.env,maxPerTick:4,maxPerSide:4,
  commandCap:()=>1});
 const one=recruit.tick({systemIDs:[101,202]});
 assert.equal(one.mobilized.length,2);                    // one per side, not four
 assert.equal(f.calls.length,2);
 const f2=fixture();
 const admiral=createWarMobilizer({
  registry:{snapshot:()=>structuredClone(f2.registered),execute:c=>{f2.calls.push(c);
   f2.registered.ships[String(c.entityID)]={...c};return {status:"APPLIED"}}},
  readWarState:()=>f2.war,readLinks:()=>f2.links,
  sceneForSystem:id=>f2.scenes.get(id),getNativeEntity:id=>f2.native.get(id),
  getController:id=>f2.controllers.get(id),
  getFactionForCorporation:corp=>corp===31?11:corp===32?22:null,
  inspectReadiness:()=>({ready:true}),getOrderLeases:()=>[],
  isTactical:()=>false,clock:()=>100000,env:f2.env,maxPerTick:4,maxPerSide:4,
  commandCap:()=>25});
 const many=admiral.tick({systemIDs:[101,202]});
 assert.equal(many.mobilized.length>=2,true);             // a fleet, still bounded by maxPerSide
 assert.equal(many.mobilized.length<=4,true);
});

test("a hull released from a campaign can be mobilized into it again",()=>{
 const f=fixture();
 // First real assignment, then a proven RELEASE receipt: the hull is free again.
 const one=f.tick();
 assert.equal(one.mobilized.length,2);
 assert.match(f.calls[0].eventID,/^wm:battle1:503:0$/);
 f.registered.history.push({type:"ASSIGN",entityID:503,campaignID:"battle1"});
 delete f.registered.ships["503"];
 const again=f.tick();
 assert.equal(again.mobilized.length>=1,true,"the released defender is claimable again");
 const defender=f.calls.filter(c=>c.entityID===503).pop();
 assert.equal(defender.eventID,"wm:battle1:503:1","the event ID identifies the real attempt");
});

// FW-028: one live campaign must never hide or starve another. The world really
// runs several wars at once (two pirate wars plus an empire front), and only the
// first PREPARING campaign used to be reported.
function twoCampaignFixture(){
 const f=fixture();
 // battle1 keeps its real, un-winnable shape: its defender side system has only
 // wrong-faction hulls. battle2 is a second border with real patrols on both
 // sides, in its own systems (301 source / 302 target).
 f.war.wars.war2={state:"ACTIVE",attackerFactionID:11,defenderFactionID:22};
 f.war.campaigns.battle2={campaignID:"battle2",warID:"war2",state:"PREPARING",
  sourceSystemID:301,targetSystemID:302,startedAt:60};
 const add=(pilotID,entityID,systemID,corp)=>{
  f.links.push({pilotID,entityID,systemID,role:"patrol"});
  f.entities.set(entityID,{itemID:entityID,kind:"ship",nativeNpc:true,
   corporationID:corp,ownerID:corp,position:{x:0,y:0,z:0}});
  f.native.set(entityID,{entityID,systemID,corporationID:corp,ownerID:corp});
  f.controllers.set(entityID,{entityID,systemID,manualOrder:null,currentTargetID:0});
  f.scenes.set(systemID,{systemID,sessions:new Map(),
   getEntityByID:id=>f.entities.get(id)});
 };
 add("coop-pilot-101",601,301,31);   // battle2 attacker (its source system)
 add("coop-pilot-102",602,302,32);   // battle2 defender (its target system)
 // battle1's defender hull is now a real patrol of the wrong faction, which is
 // exactly the live ORE border shape: the side can never muster.
 f.entities.get(503).corporationID=31;
 f.native.get(503).corporationID=31;
 return f;
}
test("every live campaign is planned and reported, not only the first one",()=>{
 const f=twoCampaignFixture();
 const dry=f.mobilizer.tick({systemIDs:[101,202,301,302],dryRun:true});
 assert.equal(dry.status,"DRY_RUN");
 assert.equal(dry.activeCampaignCount,2);
 assert.equal(Array.isArray(dry.campaigns),true);
 assert.equal(dry.campaigns.length,2);
 assert.deepEqual(dry.campaigns.map(c=>c.campaignID).sort(),["battle1","battle2"]);
 const second=dry.campaigns.find(c=>c.campaignID==="battle2");
 assert.equal(second.sides.length,2);
 const defender=second.sides.find(s=>s.role==="DEFENDER");
 const attacker=second.sides.find(s=>s.role==="ATTACKER");
 assert.equal(defender.systemID,302);
 assert.equal(attacker.systemID,301);
 assert.deepEqual(defender.mobilizable,[602]);
 assert.deepEqual(attacker.mobilizable,[601]);
 assert.equal(defender.status,"SIDE_MUSTERED");
 // The un-winnable first campaign explains itself per side instead of hiding
 // the second one behind a global rejection cap.
 const first=dry.campaigns.find(c=>c.campaignID==="battle1");
 const firstDefender=first.sides.find(s=>s.role==="DEFENDER");
 assert.equal(firstDefender.mobilizable.length,0);
 assert.equal(firstDefender.rejected.some(r=>r.reason==="WRONG_FACTION"),true);
 assert.equal(firstDefender.status,"NO_ELIGIBLE_PATROL");
 assert.equal(f.calls.length,0,"a diagnosis never writes");
});
test("a second campaign musters on the next tick instead of starving",()=>{
 const f=twoCampaignFixture();
 const onePerTick=createWarMobilizer({
  registry:{snapshot:()=>structuredClone(f.registered),execute:c=>{
   f.calls.push(c);f.registered.ships[String(c.entityID)]={...c};
   return {status:"APPLIED"}}},
  readWarState:()=>f.war,readLinks:()=>f.links,
  sceneForSystem:id=>f.scenes.get(id),getNativeEntity:id=>f.native.get(id),
  getController:id=>f.controllers.get(id),
  getFactionForCorporation:corp=>corp===31?11:corp===32?22:null,
  inspectReadiness:()=>({ready:true}),getOrderLeases:()=>[],
  isTactical:()=>false,clock:()=>100000,env:f.env,
  maxPerTick:1,maxPerSide:1});
 const first=onePerTick.tick({systemIDs:[101,202,301,302]});
 assert.equal(first.mobilized.length,1);
 assert.equal(first.mobilized[0].campaignID,"battle1","the older campaign goes first");
 const second=onePerTick.tick({systemIDs:[101,202,301,302]});
 assert.equal(second.mobilized.length,1);
 assert.equal(second.mobilized[0].campaignID,"battle2",
  "the campaign with the bigger deficit is served before the older one repeats");
 const report=second.campaigns.find(c=>c.campaignID==="battle1");
 assert.equal(report.sides.some(s=>s.assigned<s.limit),true);
});
test("per-campaign sides name the real blocker and the real limit",()=>{ const f=twoCampaignFixture();
 // battle2's attacker hull is a real patrol but of the wrong faction.
 f.entities.get(601).corporationID=32;
 f.native.get(601).corporationID=32;
 const dry=f.mobilizer.tick({systemIDs:[101,202,301,302],dryRun:true});
 const second=dry.campaigns.find(c=>c.campaignID==="battle2");
 const attacker=second.sides.find(s=>s.role==="ATTACKER");
 assert.equal(attacker.mobilizable.length,0);
 assert.equal(attacker.rejected.some(r=>r.reason==="WRONG_FACTION"),true);
 assert.equal(attacker.limit,1);
 assert.equal(attacker.assigned,0);
 const defender=second.sides.find(s=>s.role==="DEFENDER");
 assert.equal(defender.status,"SIDE_MUSTERED");
});
test("a native registry refusal publishes its own reason instead of silence",()=>{
 const f=fixture();
 f.deny(true);
 const result=f.tick();
 assert.equal(result.mobilized.length,0);
 assert.equal(Array.isArray(result.blocked),true);
 assert.equal(result.blocked.length>=1,true);
 assert.equal(result.blocked[0].reason,"NATIVE_SHIP_OR_CAMPAIGN_UNVERIFIED");
 assert.equal(result.blocked[0].campaignID,"battle1");
 // The per-campaign side keeps the refusal as its explanation.
 const defender=result.campaigns[0].sides.find(s=>s.role==="DEFENDER");
 assert.equal(defender.rejected.some(r=>r.reason==="REGISTRY_NATIVE_SHIP_OR_CAMPAIGN_UNVERIFIED"),true);
});
