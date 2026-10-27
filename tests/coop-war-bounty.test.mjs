import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarBounty,factionOfPilot}=require("../integration/coopWarBounty.cjs");

const flags=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_WAR_TREASURY:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});
const campaignID="war:500011-500014:campaign:30000143";
const links=[
 {pilotID:"coop-pilot-001",entityID:9001,systemID:30000145},
 {pilotID:"coop-pilot-050",entityID:9002,systemID:30000142},
];
const corporations=new Map([[9001,1000129],[9002,1000138]]);
const factions=new Map([[1000129,500014],[1000138,500011]]);

test("a proven kill releases the killer faction's HELD escrow to that pilot",()=>{
 const f=fixture();
 const result=f.bounty.pay({pilotID:"coop-pilot-001",kind:"warship-kill",
  wreckID:980300000006,proofID:"wreck:980300000006"});
 assert.equal(result.status,"PAID",JSON.stringify(result));
 assert.equal(result.factionID,500014);
 assert.equal(result.amountCents,5000000);
 assert.equal(result.reservationID,"bounty:"+campaignID+":500014");
 assert.equal(f.paid.length,1);
 assert.deepEqual(f.credited,[{pilotID:"coop-pilot-001",cents:5000000}]);
 assert.equal(f.events.length,1);
 assert.equal(f.events[0].event,"living-native-war-bounty");
});

test("no HELD escrow means no bounty, and the refusal is explicit",()=>{
 const f=fixture({reservation:null});
 const result=f.bounty.pay({pilotID:"coop-pilot-001",kind:"warship-kill",
  wreckID:980300000006});
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.reason,"NO_HELD_ESCROW_FOR_FACTION");
 assert.equal(f.paid.length,0);
 assert.equal(f.credited.length,0);
});

test("a payout the treasury refuses never credits the pilot",()=>{
 const f=fixture();
 f.refusePayout();
 const result=f.bounty.pay({pilotID:"coop-pilot-001",kind:"warship-kill",
  wreckID:980300000006});
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.reason,"WAR_TREASURY_PAYOUT_NOT_AUTHORIZED");
 assert.equal(f.credited.length,0);
});

test("a pilot with no real faction, or no real campaign, is never paid",()=>{
 const f=fixture();
 assert.equal(f.bounty.pay({pilotID:"coop-pilot-999",kind:"warship-kill",
  wreckID:980300000006}).reason,"BOUNTY_PILOT_FACTION_UNKNOWN");
 assert.equal(f.bounty.pay({pilotID:"coop-pilot-001",kind:"warship-kill",
  wreckID:1}).reason,"NO_REAL_CAMPAIGN_FOR_EVENT");
 assert.equal(f.bounty.pay({pilotID:"coop-pilot-001",kind:"warship-kill",
  wreckID:980300000006,campaignID:"war:9-9:campaign:1"}).status,"BLOCKED");
 assert.equal(f.credited.length,0);
});

test("the pilot faction comes only from a real native ship and corporation",()=>{
 assert.equal(factionOfPilot({pilotID:"coop-pilot-001",links,
  getNativeEntity:id=>({corporationID:corporations.get(id)}),
  getFactionForCorporation:id=>factions.get(id)}),500014);
 assert.equal(factionOfPilot({pilotID:"coop-pilot-404",links,
  getNativeEntity:id=>({corporationID:corporations.get(id)}),
  getFactionForCorporation:id=>factions.get(id)}),0);
 assert.equal(factionOfPilot({pilotID:"coop-pilot-001",links,
  getNativeEntity:()=>null,getFactionForCorporation:()=>500014}),0);
});

test("the feature is off without the war treasury flags",()=>{
 const f=fixture({env:{}});
 assert.equal(f.bounty.pay({pilotID:"coop-pilot-001",kind:"warship-kill",
  wreckID:980300000006}).status,"DISABLED");
 assert.equal(f.credited.length,0);
});

function fixture({reservation={},env=flags()}={}){
 const paid=[],credited=[],events=[];
 let refuse=false;
 const treasury={
  snapshot:()=>({status:"OK",reservations:reservation===null?{}:{
   ["bounty:"+campaignID+":500014"]:{reservationID:"bounty:"+campaignID+":500014",
    corporationID:1000129,factionID:500014,warID:"war:500011-500014",
    campaignID,cents:5000000,status:"HELD",...reservation}}}),
  execute:(command)=>{
   if(refuse)return {status:"BLOCKED",reason:"WAR_TREASURY_PAYOUT_NOT_AUTHORIZED"};
   paid.push(command);
   return {status:"APPLIED",receipt:{type:"PAYOUT",
    reservationID:command.reservationID,corporationID:command.corporationID,
    factionID:500014,warID:"war:500011-500014",campaignID,
    pilotID:command.pilotID,amountCents:5000000,escrowJournalID:8000000000000000,
    payoutProofID:command.proofID,at:100000}};
  }};
 const chest={creditPilot:({pilotID,cents})=>{
  credited.push({pilotID,cents});
  return {status:"APPLIED",receipt:{pilotID,cents,before:0,after:cents/100}};
 }};
 const war={version:1,campaigns:{[campaignID]:{campaignID,warID:"war:500011-500014",
  state:"ASSAULT",targetSystemID:30000143}},wars:{"war:500011-500014":{
  warID:"war:500011-500014",state:"ACTIVE",attackerFactionID:500011,
  defenderFactionID:500014}}};
 const bounty=createWarBounty({env,treasury,chest,
  readWarState:()=>war,readLinks:()=>links,
  getNativeEntity:id=>({corporationID:corporations.get(Number(id))}),
  getFactionForCorporation:id=>factions.get(Number(id)),
  readCasualties:()=>({byWreck:{"980300000006":{wreckID:980300000006,
   campaignID,warID:"war:500011-500014",pilotID:"coop-pilot-050"}}}),
  emit:(event,detail)=>events.push({event,detail}),clock:()=>100000});
 return {bounty,paid,credited,events,refusePayout:()=>{refuse=true}};
}
