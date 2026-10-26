import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {planCampaign,resolveCampaign,rolesForFront,ROLES}=require('../integration/coopFactionWarCampaigns.cjs');

const territories={1:'caldari',2:'gallente',3:'gallente',4:'minmatar'};
const front={frontID:'front:caldari-gallente',factions:['caldari','gallente'],
 edges:[{fromSystemID:1,toSystemID:2,fromOwner:'caldari',toOwner:'gallente'}]};

test('an assault starts on our side and takes an enemy system',()=>{
 const plan=planCampaign({frontID:front.frontID,factions:front.factions,role:'assault',
  originSystemID:1,objectiveSystemID:2,territories,attacker:'caldari',nowMs:1000});
 assert.equal(plan.status,'PLANNED');
 assert.equal(plan.state,'ACTIVE');
 assert.equal(plan.attacker,'caldari');
 assert.equal(plan.defender,'gallente');
 assert.equal(plan.expiresAtMs>1000,true);
});

test('an offensive from an enemy system, or onto our own, is refused',()=>{
 assert.equal(planCampaign({frontID:front.frontID,factions:front.factions,role:'assault',
  originSystemID:2,objectiveSystemID:1,territories,attacker:'caldari',nowMs:1}).reason,'ORIGIN_NOT_OURS');
 assert.equal(planCampaign({frontID:front.frontID,factions:front.factions,role:'assault',
  originSystemID:1,objectiveSystemID:1,territories,attacker:'caldari',nowMs:1}).reason,'SAME_SYSTEM');
});

test('a defence must be fought from and for our own systems',()=>{
 const ok=planCampaign({frontID:front.frontID,factions:front.factions,role:'defence',
  originSystemID:1,objectiveSystemID:1,territories,attacker:'caldari',nowMs:1});
 assert.equal(ok.reason,'SAME_SYSTEM');
 const bad=planCampaign({frontID:front.frontID,factions:front.factions,role:'defence',
  originSystemID:1,objectiveSystemID:2,territories,attacker:'caldari',nowMs:1});
 assert.equal(bad.reason,'DEFENCE_NEEDS_OWN_SYSTEMS');
});

test('a deep op may leave the front and hit a rear system',()=>{
 const deep=planCampaign({role:'deep-op',originSystemID:1,objectiveSystemID:4,
  territories,attacker:'caldari',nowMs:1});
 assert.equal(deep.status,'PLANNED');
 assert.equal(deep.frontID,null);
});

test('unknown roles and unowned systems are refused instead of guessed',()=>{
 assert.equal(planCampaign({role:'raid',originSystemID:1,objectiveSystemID:2,territories,attacker:'caldari'}).reason,'UNKNOWN_ROLE');
 assert.equal(planCampaign({role:'assault',originSystemID:1,objectiveSystemID:99,territories,attacker:'caldari'}).reason,'UNOWNED_SYSTEM');
 assert.equal(ROLES.length,4);
});

test('a campaign only ends on evidence or expiry, never on a timer alone',()=>{
 const plan=planCampaign({frontID:front.frontID,factions:front.factions,role:'assault',
  originSystemID:1,objectiveSystemID:2,territories,attacker:'caldari',nowMs:1000,ttlMs:60000});
 const active=resolveCampaign(plan,{nowMs:2000,evidence:{}});
 assert.equal(active.status,'ACTIVE');
 const won=resolveCampaign(plan,{nowMs:2000,evidence:{objectiveCaptured:true}});
 assert.equal(won.state,'WON');
 const lost=resolveCampaign(plan,{nowMs:2000,evidence:{fleetDestroyed:true}});
 assert.equal(lost.state,'LOST');
 const expired=resolveCampaign(plan,{nowMs:99000,evidence:{}});
 assert.equal(expired.state,'EXPIRED');
 const closed=resolveCampaign(won.campaign,{nowMs:99999,evidence:{objectiveCaptured:true}});
 assert.equal(closed.status,'ALREADY_CLOSED');
});

test('a front offers assault against enemy space and defence inside our own',()=>{
 assert.deepEqual(rolesForFront({front,attacker:'caldari',territories}),['assault']);
 const own={frontID:'f',factions:['caldari'],edges:[{fromSystemID:1,toSystemID:1,fromOwner:'caldari',toOwner:'caldari'}]};
 assert.deepEqual(rolesForFront({front:own,attacker:'caldari',territories}),['defence']);
 assert.deepEqual(rolesForFront({front:null,attacker:'caldari',territories}),[]);
});
