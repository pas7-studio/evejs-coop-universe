import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const opening=require('../integration/coopFactionWarOpening.cjs');
const core=require('../integration/coopFactionWarCore.cjs');
const treasury=require('../integration/coopFactionWarTreasury.cjs');

// Two systems that really touch through one reciprocal stargate pair.
const STAR_GATES={
 1:[{itemID:11,destinationID:12,destinationSolarSystemID:2,solarSystemID:1}],
 2:[{itemID:12,destinationID:11,destinationSolarSystemID:1,solarSystemID:2}],
};
const GATES={
 11:{itemID:11,destinationID:12,solarSystemID:1},
 12:{itemID:12,destinationID:11,solarSystemID:2},
};
const getStargatesForSystem=(id)=>STAR_GATES[id]||[];
const getGate=(id)=>GATES[id]||null;

const CORP_FACTION={1000:500001,2000:500002};
const NATIVES={
 101:{entityID:101,corporationID:1000,systemID:1},
 102:{entityID:102,corporationID:1000,systemID:1},
 201:{entityID:201,corporationID:2000,systemID:2},
 202:{entityID:202,corporationID:2000,systemID:2},
};
const getNativeEntity=(id)=>NATIVES[id]||null;
const getFactionForCorporation=(id)=>CORP_FACTION[id]||null;

const LINKS=[
 {pilotID:'coop-pilot-001',entityID:101,systemID:1,role:'patrol'},
 {pilotID:'coop-pilot-002',entityID:102,systemID:1,role:'patrol'},
 {pilotID:'coop-pilot-003',entityID:201,systemID:2,role:'patrol'},
 {pilotID:'coop-pilot-004',entityID:202,systemID:2,role:'patrol'},
];
const presence=(links=LINKS)=>
 opening.collectPresence({links,getNativeEntity,getFactionForCorporation});
const firstOpening=(plan)=>plan.openings[0];

test('presence maps a real corporation to a real faction and ignores in-flight ships',()=>{
 const real=presence();
 assert.equal(real.status,'PRESENCE');
 assert.equal(real.pilots.length,4);
 assert.equal(real.pilots[0].factionID,'500001');
 assert.equal(real.pilots[2].factionID,'500002');
 // FW-051: a link whose system disagrees with the hull is NOT dropped and does NOT
 // create a claim where the link pointed; the hull counts where it physically is.
 const moved=opening.collectPresence({
  links:[{pilotID:'coop-pilot-001',entityID:101,systemID:9,role:'patrol'}],
  getNativeEntity,getFactionForCorporation,
 });
 assert.equal(moved.pilots.length,1);
 assert.equal(moved.pilots[0].systemID,1,'the native record decides the system, not the link');
 assert.equal(moved.pilots[0].positionDrifted,true);
 assert.equal(moved.drifted,1);
 assert.equal(moved.pilots.some((p)=>p.systemID===9),false,'a drifted link never claims its stale system');
 // a corporation without a faction is not a territory claim
 const unknown=opening.collectPresence({
  links:[{pilotID:'coop-pilot-009',entityID:999,systemID:1,role:'patrol'}],
  getNativeEntity:(id)=>({entityID:id,corporationID:7777,systemID:1}),
  getFactionForCorporation,
 });
 assert.equal(unknown.pilots.length,0);
 // bounded input, never an unbounded scan
 assert.equal(opening.collectPresence({links:[{pilotID:'x',entityID:101,systemID:1}],
  getNativeEntity,getFactionForCorporation,maxLinks:0}).status,'INVALID_LINKS');
});

test('registered military control outranks ships that are only passing through',()=>{
 const state=core.empty();
 state.territories['2']={systemID:2,originalOwnerFactionID:500002,
  militaryControllerFactionID:500001,state:'OCCUPIED',revision:2,changedAt:1};
 const merged=opening.territoriesForFronts({state,presence:presence()});
 assert.equal(merged.territories['1'],'500001');
 assert.equal(merged.territories['2'],'500001');   // captured, not handed back by traffic
 assert.equal(merged.registeredCount,1);
});

test('a one-way or unresolved gate is not a route',()=>{
 assert.equal(opening.gateBetween(1,2,getStargatesForSystem,getGate).fromGateID,11);
 assert.equal(opening.gateBetween(2,1,getStargatesForSystem,getGate).fromGateID,12);
 assert.equal(opening.gateBetween(1,2,getStargatesForSystem,()=>null),null);
 // the far side must really point back
 assert.equal(opening.gateBetween(1,2,
  ()=>[{itemID:11,destinationID:12,destinationSolarSystemID:2}],
  ()=>({itemID:12,destinationID:99,solarSystemID:2})),null);
 // and the gate must really lead to the claimed system
 assert.equal(opening.gateBetween(1,2,
  ()=>[{itemID:11,destinationID:12,destinationSolarSystemID:3}],getGate),null);
 assert.equal(opening.gateBetween(1,1,getStargatesForSystem,getGate),null);
});

test('a faction pays for an operation only from ground it really holds',()=>{
 assert.equal(treasury.fundOperation({heldSystemIDs:[]}).status,'REFUSED_UNFUNDED');
 const held=treasury.fundOperation({heldSystemIDs:[1]});
 assert.equal(held.status,'FUNDED');
 assert.equal(held.paper,true);
 assert.equal(held.sectorIncomeISK,treasury.DEFAULT_RATES.sectorIncomeISK);
 assert.equal(held.evidence,'PAPER_OPERATION_BUDGET_NO_MARKET_ORDER_NO_CARGO');
 assert.equal(opening.paperFunding({heldSystemIDs:[1,2]}).status,'FUNDED');
 assert.equal(opening.paperFunding({heldSystemIDs:[]}).status,'REFUSED_UNFUNDED');
});

test('the opening plan is built from real presence, real gates and real ground',()=>{
 const plan=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 assert.equal(plan.status,'READY');
 const planned=firstOpening(plan);
 assert.equal(planned.plan.war.attackerFactionID,500001);
 assert.equal(planned.plan.war.defenderFactionID,500002);
 assert.equal(planned.plan.campaign.sourceSystemID,1);
 assert.equal(planned.plan.campaign.targetSystemID,2);
 assert.equal(planned.funding.paper,true);
 assert.equal(plan.fronts.length,1);
 // the proof really is evaluated, not assumed
 assert.equal(planned.proofs.declaration({attackerFactionID:500001,defenderFactionID:500002}),true);
 assert.equal(planned.proofs.declaration({attackerFactionID:500001,defenderFactionID:500003}),false);
 assert.equal(planned.proofs.adjacency({sourceSystemID:1,targetSystemID:2}),true);
 assert.equal(planned.proofs.adjacency({sourceSystemID:2,targetSystemID:1}),true);
 assert.equal(planned.proofs.adjacency({sourceSystemID:1,targetSystemID:3}),false);
});

test('an operator-approved unfunded opening is labelled and pays no bounty',()=>{
 const env={EVEJS_COOP_WAR_REQUIRE_FUNDING:'0'};
 const refused={status:'REFUSED_UNFUNDED',paper:true,heldSystemIDs:0};
 const supplied=opening.supplyFor({funding:refused,env});
 assert.equal(supplied.status,'PAPER_UNFUNDED_EXPLICIT');
 assert.equal(supplied.paper,true);
 assert.equal(supplied.reason,'WAR_FUNDING_NOT_REQUIRED_BY_OPERATOR');
 // a funded opening keeps its real status
 assert.equal(opening.supplyFor({funding:{status:'FUNDED',paper:true},env}).status,'FUNDED');
 // the default stays strict: no operator opt-out means no supply
 assert.equal(opening.supplyFor({funding:refused,env:{}}).status,'REFUSED_UNFUNDED');
 assert.equal(opening.fundingRequired({}),true);
 assert.equal(opening.fundingRequired({EVEJS_COOP_WAR_REQUIRE_FUNDING:'0'}),false);
});
test('no presence, one faction, or no gate means no war instead of an invented one',()=>{
 const empty=opening.planWars({state:core.empty(),presence:presence([]),
  getStargatesForSystem,getGate,nowMs:1});
 assert.equal(empty.status,'REFUSED');
 assert.equal(empty.reason,'NO_TERRITORY_FROM_PRESENCE');
 const oneSided=opening.planWars({state:core.empty(),
  presence:presence(LINKS.filter((l)=>l.systemID===1)),
  getStargatesForSystem,getGate,nowMs:1});
 assert.equal(oneSided.status,'REFUSED');
 assert.equal(oneSided.reason,'NO_FRONT');
 const noGates=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem:()=>[],getGate,nowMs:1});
 assert.equal(noGates.status,'REFUSED');
 assert.equal(noGates.reason,'NO_FRONT');
 assert.equal(opening.planWars({presence:presence()}).reason,'NO_WAR_STATE');
});

test('the applied war state is the exact shape the mobiliser reads',()=>{
 const plan=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 const opened=opening.applyOpening({state:core.empty(),plan,nowMs:1000});
 assert.equal(opened.status,'OPENED');
 core.validateState(opened.state);
 const war=opened.state.wars[opened.warID];
 assert.equal(war.state,'ACTIVE');
 assert.equal(war.attackerFactionID,500001);
 assert.equal(war.defenderFactionID,500002);
 const campaign=opened.state.campaigns[opened.campaignID];
 assert.equal(campaign.state,'PREPARING');
 assert.equal(campaign.sourceSystemID,1);
 assert.equal(campaign.targetSystemID,2);
 assert.equal(campaign.warID,war.warID);
 assert.equal(opened.state.territories['1'].militaryControllerFactionID,500001);
 assert.equal(opened.state.territories['2'].state,'CONTESTED');
 assert.deepEqual(opened.applied.map((entry)=>entry.type),
  ['DECLARE_WAR','REGISTER_TERRITORY','REGISTER_TERRITORY','START_CAMPAIGN']);
 assert.equal(opened.state.history.length,4);
});

test('one faction pair can fight on two borders at once - one war, two campaigns',()=>{
 // 1 (caldari) borders 2 (gallente) and 3 (gallente)
 const gates={
  1:[{itemID:11,destinationID:12,destinationSolarSystemID:2,solarSystemID:1},
     {itemID:13,destinationID:31,destinationSolarSystemID:3,solarSystemID:1}],
  2:[{itemID:12,destinationID:11,destinationSolarSystemID:1,solarSystemID:2}],
  3:[{itemID:31,destinationID:13,destinationSolarSystemID:1,solarSystemID:3}],
 };
 const byId={
  11:{itemID:11,destinationID:12,solarSystemID:1},
  12:{itemID:12,destinationID:11,solarSystemID:2},
  13:{itemID:13,destinationID:31,solarSystemID:1},
  31:{itemID:31,destinationID:13,solarSystemID:3},
 };
 const natives={
  101:{entityID:101,corporationID:1000,systemID:1},
  201:{entityID:201,corporationID:2000,systemID:2},
  301:{entityID:301,corporationID:2000,systemID:3},
 };
 const links=[
  {pilotID:'coop-pilot-001',entityID:101,systemID:1,role:'patrol'},
  {pilotID:'coop-pilot-003',entityID:201,systemID:2,role:'patrol'},
  {pilotID:'coop-pilot-005',entityID:301,systemID:3,role:'patrol'},
 ];
 const plan=opening.planWars({
  state:core.empty(),
  presence:opening.collectPresence({links,getNativeEntity:(id)=>natives[id]||null,
   getFactionForCorporation}),
  getStargatesForSystem:(id)=>gates[id]||[],getGate:(id)=>byId[id]||null,nowMs:1000,
 });
 assert.equal(plan.status,'READY');
 assert.equal(plan.openings.length,2);
 const opened=opening.applyOpenings({state:core.empty(),plan,nowMs:1000});
 assert.equal(opened.status,'OPENED');
 core.validateState(opened.state);
 assert.equal(opened.warIDs.length,1);              // same faction pair, one war
 assert.equal(opened.campaignIDs.length,2);         // two fronts
 assert.equal(Object.keys(opened.state.wars).length,1);
 assert.equal(Object.keys(opened.state.campaigns).length,2);
 assert.deepEqual(opened.campaignIDs.map((id)=>opened.state.campaigns[id].targetSystemID).sort(),
  [2,3]);
});

test('a border that already has a live campaign is never reopened',()=>{
 const first=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 const opened=opening.applyOpening({state:core.empty(),plan:first,nowMs:1000});
 const again=opening.planWars({state:opened.state,presence:presence(),
  getStargatesForSystem,getGate,nowMs:2000});
 assert.equal(again.status,'REFUSED');
 assert.equal(again.reason,'NO_OPENABLE_FRONT');
 assert.equal(again.skipped[0].reason,'TARGET_ALREADY_CONTESTED');
});

test('a false proof blocks the war even when the plan says READY',()=>{
 const plan=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 const broken=Object.assign({},plan,{openings:[Object.assign({},plan.openings[0],{
  proofs:Object.assign({},plan.openings[0].proofs,{declaration:()=>false})})]});
 const result=opening.applyOpenings({state:core.empty(),plan:broken,nowMs:1000});
 assert.equal(result.status,'REFUSED');
 assert.equal(result.reason,'NATIVE_WAR_AUTHORITY_MISSING');
 assert.deepEqual(result.applied,[]);
});

test('one tick opens the war, and the next tick reports it instead of duplicating',()=>{
 let state=core.empty(),writes=0;
 const warOpening=opening.createWarOpening({
  readLinks:()=>LINKS,getNativeEntity,getFactionForCorporation,
  getStargatesForSystem,getGate,
  readWarState:()=>state,
  writeWarState:(next)=>{state=next;writes++;},
  now:()=>1000,
 });
 const first=warOpening.tick({systemIDs:[1,2]});
 assert.equal(first.status,'OPENED');
 assert.equal(writes,1);
 const second=warOpening.tick({systemIDs:[1,2]});
 assert.equal(second.status,'NO_OPENING');
 assert.equal(second.reason,'NO_OPENABLE_FRONT');
 assert.equal(writes,1);
 assert.equal(Object.keys(state.wars).length,1);
 assert.equal(Object.keys(state.campaigns).length,1);
});

test('two borders of one faction pair share the war orientation instead of being denied',()=>{ // Four systems, two real reciprocal borders between the SAME two factions.
 const gates={
  1:[{itemID:11,destinationID:33,destinationSolarSystemID:3,solarSystemID:1}],
  2:[{itemID:22,destinationID:44,destinationSolarSystemID:4,solarSystemID:2}],
  3:[{itemID:33,destinationID:11,destinationSolarSystemID:1,solarSystemID:3}],
  4:[{itemID:44,destinationID:22,destinationSolarSystemID:2,solarSystemID:4}],
 };
 const gateByID={11:gates[1][0],22:gates[2][0],33:gates[3][0],44:gates[4][0]};
 const pilots=[
  {systemID:1,factionID:'500001'},{systemID:1,factionID:'500001'},
  {systemID:2,factionID:'500001'},{systemID:2,factionID:'500001'},
  {systemID:3,factionID:'500004'},{systemID:3,factionID:'500004'},
  {systemID:4,factionID:'500004'},{systemID:4,factionID:'500004'},
 ];
 const plan=opening.planWars({
  state:core.empty(),
  presence:{status:'PRESENCE',pilots,skipped:0},
  getStargatesForSystem:(id)=>gates[id]||[],
  getGate:(id)=>gateByID[id]||null,
  nowMs:1000,
  maxOpenings:4,
 });
 assert.equal(plan.status,'READY');
 const wars=new Set(plan.openings.map(o=>o.plan.war.warID));
 assert.equal(wars.size,1);
 const orientations=new Set(plan.openings.map(o=>o.plan.war.attackerFactionID));
 assert.equal(orientations.size,1,'one war, one orientation');
 const applied=opening.applyOpenings({state:core.empty(),plan,nowMs:1000});
 assert.equal(applied.status,'OPENED');
 assert.equal(Object.keys(applied.state.campaigns).length,plan.openings.length);
 for(const campaign of Object.values(applied.state.campaigns)){
  const war=applied.state.wars[campaign.warID];
  const src=applied.state.territories[String(campaign.sourceSystemID)];
  const dst=applied.state.territories[String(campaign.targetSystemID)];
  assert.equal(src.militaryControllerFactionID,war.attackerFactionID);
  assert.equal(dst.militaryControllerFactionID,war.defenderFactionID);
 }
});

test('a second border naming the same target is skipped, not fatal to the batch',()=>{
 const plan=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 assert.equal(plan.status,'READY');
 const first=plan.openings[0];
 const duplicate={...first,plan:{...first.plan,
  campaign:{...first.plan.campaign,campaignID:first.plan.campaign.campaignID+':dup'}}};
 const applied=opening.applyOpenings({state:core.empty(),
  plan:{...plan,openings:[first,duplicate]},nowMs:1000});
 assert.equal(applied.status,'OPENED');
 assert.equal(Object.keys(applied.state.campaigns).length,1);
 assert.equal(applied.campaignIDs.length,1);
});

test('a real war fleet is presence too, so a fleet-only front can open',()=>{
 let state=core.empty(),writes=0;
 const warOpening=opening.createWarOpening({
  readLinks:()=>[],getNativeEntity,getFactionForCorporation,
  getStargatesForSystem,getGate,
  fleetPresence:()=>[
   {entityID:9001,systemID:1,factionID:500001,corporationID:1000030,role:'patrol'},
   {entityID:9002,systemID:1,factionID:500001,corporationID:1000030,role:'patrol'},
   {entityID:9003,systemID:2,factionID:500004,corporationID:1000032,role:'patrol'},
   {entityID:9004,systemID:2,factionID:500004,corporationID:1000032,role:'patrol'},
  ],
  readWarState:()=>state,
  writeWarState:(next)=>{state=next;writes++;},
  now:()=>1000,
 });
 const first=warOpening.tick({systemIDs:[1,2]});
 assert.equal(first.status,'OPENED');
 assert.equal(first.presence.fleetShips,4);
 assert.equal(writes,1);
 const open=Object.values(state.campaigns)[0];
 assert.ok(open);
 assert.equal(open.targetSystemID,2);
});

test('a tick with no real faction presence writes nothing',()=>{
 let state=core.empty(),writes=0;
 const warOpening=opening.createWarOpening({
  readLinks:()=>[],getNativeEntity,getFactionForCorporation,
  getStargatesForSystem,getGate,
  readWarState:()=>state,
  writeWarState:(next)=>{state=next;writes++;},
  now:()=>1000,
 });
 const result=warOpening.tick({systemIDs:[1,2]});
 assert.equal(result.status,'NO_OPENING');
 assert.equal(result.reason,'NO_TERRITORY_FROM_PRESENCE');
 assert.equal(writes,0);
});

test('a broken store is reported, never patched over',()=>{
 let writes=0;
 const warOpening=opening.createWarOpening({
  readLinks:()=>LINKS,getNativeEntity,getFactionForCorporation,
  getStargatesForSystem,getGate,
  readWarState:()=>{throw Error('store down');},
  writeWarState:()=>{writes++;},
  now:()=>1000,
 });
 assert.equal(warOpening.tick({systemIDs:[1,2]}).status,'NATIVE_AUTHORITIES_UNAVAILABLE');
 assert.equal(writes,0);
 assert.throws(()=>opening.createWarOpening({}),/WAR_OPENING_AUTHORITIES_REQUIRED/);
});

test('a contested system is reported, not silently dropped',()=>{
 const pilots=[
  {systemID:1,factionID:'500001'},{systemID:1,factionID:'500001'},
  {systemID:1,factionID:'500002'},{systemID:1,factionID:'500002'},
  {systemID:2,factionID:'500003'},{systemID:2,factionID:'500003'},{systemID:2,factionID:'500004'},
 ];
 const summary=opening.presenceSummary({pilots});
 assert.equal(summary.systems['1'].reason,'TIE_CONTESTED');
 assert.equal(summary.systems['1'].owner,null);
 assert.equal(summary.systems['2'].owner,'500003');
 assert.deepEqual(summary.contested,[1]);
 assert.deepEqual(summary.systems['2'].factions,[{factionID:'500003',ships:2},{factionID:'500004',ships:1}]);
 assert.equal(opening.presenceSummary({pilots,minShips:3}).systems['2'].reason,'BELOW_MIN_SHIPS');
 // and the refusal carries the reason
 const plan=opening.planWars({state:core.empty(),
  presence:{status:'PRESENCE',pilots,skipped:0},
  getStargatesForSystem,getGate,nowMs:1});
 assert.equal(plan.reason,'NO_FRONT');
 assert.equal(plan.summary.systems['1'].reason,'TIE_CONTESTED');
});

// FW-037: a front is one gate pair, not one direction. The derived edge keeps
// the orientation of whichever system the territory map listed first, so a
// different war squatting on that target froze the whole pair forever. Attack
// across the same real gate from the other end instead.
test('a different war on the target does not freeze the border - attack from the far side',()=>{
 const state=core.empty();
 state.wars['war:500002-500009']={warID:'war:500002-500009',state:'ACTIVE',
  attackerFactionID:500009,defenderFactionID:500002,startedAtMs:1,frontID:'front:500002-500009'};
 state.campaigns['war:500002-500009:campaign:2']={campaignID:'war:500002-500009:campaign:2',
  warID:'war:500002-500009',state:'ASSAULT',sourceSystemID:9,targetSystemID:2,startedAt:1};
 const plan=opening.planWars({state,presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 assert.equal(plan.status,'READY');
 const planned=firstOpening(plan);
 assert.equal(planned.plan.war.attackerFactionID,500002);
 assert.equal(planned.plan.war.defenderFactionID,500001);
 assert.equal(planned.plan.campaign.sourceSystemID,2);
 assert.equal(planned.plan.campaign.targetSystemID,1);
 assert.equal(planned.plan.war.warID,'war:500001-500002');
});

test('the same faction pair never reopens its own border from the far side',()=>{
 const first=opening.planWars({state:core.empty(),presence:presence(),
  getStargatesForSystem,getGate,nowMs:1000});
 const opened=opening.applyOpening({state:core.empty(),plan:first,nowMs:1000});
 const again=opening.planWars({state:opened.state,presence:presence(),
  getStargatesForSystem,getGate,nowMs:2000});
 assert.equal(again.status,'REFUSED');
 assert.equal(again.reason,'NO_OPENABLE_FRONT');
 assert.equal(again.skipped[0].reason,'TARGET_ALREADY_CONTESTED');
});

// FW-037 guard: one border nobody can pay for must not abort the whole batch.
// Measured on the work stack 2026-10-28: the frontier answered
// SUPPLY_UNFUNDED and threw the whole plan away, so a single broke faction pair
// stopped every other border from opening in the same tick.
test('an unfunded border is skipped by name instead of aborting the batch', () => {
  const plan = opening.planWars({ state: core.empty(), presence: presence(),
    getStargatesForSystem, getGate, nowMs: 1000 });
  assert.equal(plan.status, 'READY');
  const opened = opening.applyOpenings({
    state: core.empty(), plan, nowMs: 1000,
    reserveBounty: () => ({ status: 'REFUSED', reason: '500004:WAR_TREASURY_FUNDS_UNAVAILABLE' }),
  });
  // Nothing opened is a refusal, never a success with empty lists.
  assert.equal(opened.status, 'REFUSED');
  assert.equal(opened.reason, 'NO_FUNDED_FRONT');
  assert.equal(opened.skipped.length >= 1, true);
  assert.ok(opened.skipped.length >= 1);
  assert.match(opened.skipped[0].reason, /^SUPPLY_UNFUNDED:/);
  assert.equal(opened.skipped[0].warID, plan.openings[0].plan.war.warID);
});

test('a front whose campaign expired really reopens instead of announcing it forever',()=>{
 // The campaign id is deterministic (war + target), so the second attempt produced the same
 // id and the same processed eventID: the core answered DUPLICATE, the state did not change,
 // and the runtime still published "war opened" every tick. Measured live: six such lines in
 // ten minutes for war:500001-500004:campaign:30003837 while the durable record stayed EXPIRED.
 const banks={500001:{balance:1000000},500002:{balance:1000000}};
 const treasuryFor=()=>treasury.createWarTreasury({
  gameStore:null,
  readBalance:(factionID)=>banks[factionID].balance,
  moveIsk:(factionID,amount)=>{banks[factionID].balance-=amount;},
 });
 const plan=opening.planWars({
  state:core.empty(),
  presence:presence(),
  getStargatesForSystem,
  getGate,
  nowMs:1000,
  readWarState:()=>core.empty(),
 });
 assert.equal(plan.status,'READY');
 const first=opening.applyOpenings({state:core.empty(),plan,nowMs:1000});
 assert.equal(first.status,'OPENED');
 const campaignID=first.campaignIDs[0];
 // the reaper's verdict
 const expired=structuredClone(first.state);
 expired.campaigns[campaignID]=Object.assign({},expired.campaigns[campaignID],
  {state:'EXPIRED',expiredAt:1000,expiredReason:'NO_ASSAULT_DEPLOYMENT_PROOF',revision:2});
 const later=1000+60*60*1000;                       // past the reopen cooldown
 const replan=opening.planWars({
  state:expired,presence:presence(),getStargatesForSystem,getGate,nowMs:later,
  readWarState:()=>expired,
 });
 assert.equal(replan.status,'READY','the front is plannable again after the cooldown');
 assert.notEqual(replan.openings[0].plan.campaign.campaignID,campaignID,
  'a terminal campaign must not be reused, or the core answers DUPLICATE and nothing happens');
 const second=opening.applyOpenings({state:expired,plan:replan,nowMs:later});
 assert.equal(second.status,'OPENED');
 assert.equal(second.campaignIDs.length,1);
 assert.equal(Object.keys(second.state.campaigns).length,2,'history keeps the expired record');
 assert.equal(second.state.campaigns[second.campaignIDs[0]].state,'PREPARING');
});
