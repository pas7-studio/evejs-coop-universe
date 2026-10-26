import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {pickFront,planOpeningCampaign}=require('../integration/coopFactionWarBootstrap.cjs');

const front=(frontID,edges)=>({frontID,edgeCount:edges.length,edges});

test('the biggest real front becomes the opening war',()=>{
 const fronts=[
  front('front:small',[{fromSystemID:1,toSystemID:2,fromOwner:500001,toOwner:500002}]),
  front('front:big',[
   {fromSystemID:10,toSystemID:11,fromOwner:500003,toOwner:500004},
   {fromSystemID:11,toSystemID:12,fromOwner:500003,toOwner:500004},
  ]),
 ];
 const plan=planOpeningCampaign({fronts,nowMs:1000});
 assert.equal(plan.status,'PLANNED');
 assert.equal(plan.frontID,'front:big');
 assert.equal(plan.war.attackerFactionID,500003);
 assert.equal(plan.war.defenderFactionID,500004);
 assert.equal(plan.campaign.state,'PREPARING');
 assert.equal(plan.campaign.sourceSystemID,10);
 assert.equal(plan.campaign.targetSystemID,11);
 assert.equal(plan.campaign.warID,plan.war.warID);
});

test('a front whose owners are not numeric factions is never used',()=>{
 const fronts=[front('front:bad',[{fromSystemID:1,toSystemID:2,fromOwner:'caldari',toOwner:'gallente'}])];
 assert.equal(planOpeningCampaign({fronts,nowMs:1}).reason,'NO_FRONT_WITH_TWO_REAL_FACTIONS');
 assert.equal(pickFront(fronts),null);
});

test('no fronts means no war, instead of an invented one',()=>{
 assert.equal(planOpeningCampaign({fronts:[],nowMs:1}).reason,'NO_FRONT_WITH_TWO_REAL_FACTIONS');
 assert.equal(planOpeningCampaign({nowMs:1}).reason,'NO_FRONT_WITH_TWO_REAL_FACTIONS');
});

test('a same-owner edge is not a border and cannot start a war',()=>{
 const fronts=[front('front:self',[{fromSystemID:1,toSystemID:2,fromOwner:500001,toOwner:500001}])];
 assert.equal(planOpeningCampaign({fronts,nowMs:1}).reason,'NO_FRONT_WITH_TWO_REAL_FACTIONS');
});

test('war and campaign ids are stable for the same input',()=>{
 const fronts=[front('f',[{fromSystemID:1,toSystemID:2,fromOwner:7,toOwner:8}])];
 const a=planOpeningCampaign({fronts,nowMs:5});
 const b=planOpeningCampaign({fronts,nowMs:5});
 assert.equal(a.war.warID,b.war.warID);
 assert.equal(a.campaign.campaignID,b.campaign.campaignID);
 assert.equal(a.war.state,'ACTIVE');
});
