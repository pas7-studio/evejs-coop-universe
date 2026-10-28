import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {expireStalledCampaigns,stallMs,liveCampaignFor,coolingDown}=require("../integration/coopFactionWarOpening.cjs");

// A PREPARING campaign holds its target CONTESTED. When the assault deployment proof
// never arrives, that claim starves every other front: measured on 2026-10-28, one
// stalled campaign on 30045344 refused the whole frontier with
// TARGET_ALREADY_CONTESTED and the client's war map had no front to draw.
const TTL=45*60*1000;
const at=(ms)=>ms;

function state(overrides={}){
 return {
  version:1,
  wars:{
   "war:500001-500004":{warID:"war:500001-500004",state:"ACTIVE",
    attackerFactionID:500001,defenderFactionID:500004}
  },
  territories:{
   "30003837":{systemID:30003837,state:"CONTESTED",militaryControllerFactionID:500004,revision:4},
   "30045344":{systemID:30045344,state:"SECURE",militaryControllerFactionID:500004,revision:1}
  },
  campaigns:{
   "war:500001-500004:campaign:30003837":{campaignID:"war:500001-500004:campaign:30003837",
    warID:"war:500001-500004",targetSystemID:30003837,state:"PREPARING",
    startedAt:at(1000),revision:2,objectiveEvidence:[]}
  },
  ...overrides
 };
}

test("a PREPARING campaign with no assault proof expires after the stall window",()=>{
 const s=state();
 const result=expireStalledCampaigns(s,{nowMs:1000+TTL+1});
 assert.deepEqual(result.campaignIDs,["war:500001-500004:campaign:30003837"]);
 const campaign=s.campaigns["war:500001-500004:campaign:30003837"];
 assert.equal(campaign.state,"EXPIRED");
 assert.equal(campaign.expiredReason,"NO_ASSAULT_DEPLOYMENT_PROOF");
 assert.equal(campaign.revision,3,"an expired claim is a new revision");
 // The border it was squatting is released, so the next tick can plan it again.
 assert.equal(s.territories["30003837"].state,"SECURE");
 assert.equal(s.territories["30003837"].revision,5);
 assert.equal(liveCampaignFor(s,30003837),null,"no live campaign holds the target now");
});

test("nothing expires inside the window, and a fresh claim is never touched",()=>{
 const s=state();
 assert.deepEqual(expireStalledCampaigns(s,{nowMs:1000+TTL-1}).campaignIDs,[]);
 assert.equal(s.campaigns["war:500001-500004:campaign:30003837"].state,"PREPARING");
 assert.equal(s.territories["30003837"].state,"CONTESTED");
});

test("a campaign that already produced evidence is never expired",()=>{
 const s=state();
 s.campaigns["war:500001-500004:campaign:30003837"].objectiveEvidence=[
  {objectiveID:"gate",proofID:"p1",at:2000}
 ];
 assert.deepEqual(expireStalledCampaigns(s,{nowMs:1000+TTL+1}).campaignIDs,[]);
 assert.equal(s.campaigns["war:500001-500004:campaign:30003837"].state,"PREPARING");
});

test("an ASSAULT campaign is left alone: it has already proved its deployment",()=>{
 const s=state();
 s.campaigns["war:500001-500004:campaign:30003837"].state="ASSAULT";
 assert.deepEqual(expireStalledCampaigns(s,{nowMs:1000+TTL+1}).campaignIDs,[]);
});

test("a border held by another live campaign is not released",()=>{
 const s=state();
 s.campaigns["war:500001-500004:campaign:30003837b"]={
  campaignID:"war:500001-500004:campaign:30003837b",warID:"war:500001-500004",
  targetSystemID:30003837,state:"ASSAULT",startedAt:at(500),revision:1,objectiveEvidence:[],
 };
 expireStalledCampaigns(s,{nowMs:1000+TTL+1});
 assert.equal(s.campaigns["war:500001-500004:campaign:30003837"].state,"EXPIRED");
 assert.equal(s.territories["30003837"].state,"CONTESTED",
  "the assault campaign still holds the border");
});

test("the stall window is a real setting, with a documented default",()=>{
 const before=process.env.EVEJS_COOP_WAR_OPENING_STALL_MS;
 try{
  delete process.env.EVEJS_COOP_WAR_OPENING_STALL_MS;
  assert.equal(stallMs(),TTL);
  process.env.EVEJS_COOP_WAR_OPENING_STALL_MS="5000";
  assert.equal(stallMs(),5000);
  process.env.EVEJS_COOP_WAR_OPENING_STALL_MS="not-a-number";
  assert.equal(stallMs(),TTL,"garbage falls back to the default, never to zero");
 }finally{
  if(before===undefined)delete process.env.EVEJS_COOP_WAR_OPENING_STALL_MS;
  else process.env.EVEJS_COOP_WAR_OPENING_STALL_MS=before;
 }
});

test("a border released a moment ago is not re-planned every tick",()=>{
 // Live symptom: an opening that did not survive its own write was re-opened every
 // 30 seconds and the world published "war opened" forever.
 const s=state();
 expireStalledCampaigns(s,{nowMs:1000+TTL+1});
 assert.equal(coolingDown(30003837,1000+TTL+2),true,
  "the released target is cooling down right after expiry");
 assert.equal(coolingDown(30003837,1000+TTL+TTL+2),false,
  "and it is available again after the window, so the frontier cannot stay frozen");
 assert.equal(coolingDown(99999,1000+TTL+2),false,"an untouched target never cools down");
});

test("the durable EXPIRED record arms the cooldown across a restart",()=>{
 // The in-memory map dies with the process. Without consulting the record, a restarted
 // world re-planned and re-announced the same front every tick (measured: "war opened"
 // every 30 seconds while the durable row still held the expired campaign).
 const s=state();
 s.campaigns["c:424242"]={campaignID:"c:424242",warID:"war:500001-500004",
  targetSystemID:424242,state:"EXPIRED",startedAt:1000,expiredAt:2000,revision:2,
  objectiveEvidence:[],expiredReason:"NO_ASSAULT_DEPLOYMENT_PROOF"};
 assert.equal(coolingDown(424242,2001,TTL,null),false,"memory knows nothing about it");
 assert.equal(coolingDown(424242,2001,TTL,s),true,
  "the expired record still says: not this window");
 assert.equal(coolingDown(424242,2000+TTL+1,TTL,s),false,
  "and the border is available again after the window");
});
