import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const guard=require("../integration/coopMiningTripRetreatGuard.cjs");

// FW-017: the stock retreat ignores its warp result. The guard reads the same
// gate the stock warp uses and publishes it, so "the prey could not leave" is
// measured instead of assumed. It never moves, orders or decides anything.
const hostile={isEntityWarpScrambled:entity=>Boolean(entity&&entity.scrambled),
 getEntityWarpScrambleStatus:entity=>entity&&entity.scrambled?-1:0};

test("a hull really held by a warp point is reported, an unscrambled one is not",()=>{
 const events=[];
 const probe={observe:(event,status,scope,detail)=>events.push({event,detail})};
 guard.reset();
 const scene={getEntityByID:id=>[{itemID:201,scrambled:true},{itemID:202,scrambled:false}]
  .find(x=>x.itemID===id)||null};
 const fleet={fleetID:960004641,systemID:30000145};
 assert.equal(guard.noteRetreatHeld(fleet,scene,[201,202],{hostile,probe}),true);
 assert.equal(events.length,1);
 assert.equal(events[0].event,"living-mining-retreat-held");
 assert.equal(events[0].detail.heldCount,1);
 assert.equal(events[0].detail.hulls[0].hullID,201);
 assert.equal(events[0].detail.status,"HELD_BY_WARP_POINT");
 assert.equal(guard.noteRetreatHeld(fleet,scene,[202],{hostile,probe}),false,
  "nothing held, nothing published");
});

test("a hull outside the scene is skipped instead of invented",()=>{
 const events=[];
 const probe={observe:(event,status,scope,detail)=>events.push({event,detail})};
 guard.reset();
 const scene={getEntityByID:()=>null};
 assert.equal(guard.noteRetreatHeld({fleetID:1,systemID:2},scene,[999],{hostile,probe}),false);
 assert.equal(events.length,0);
});
