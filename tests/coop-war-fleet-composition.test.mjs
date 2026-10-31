import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarFleetComposition,requirementsFor}=
 require("../integration/coopWarFleetComposition.cjs");

// The real merit ladder (coopFactionWarMerit.RANKS): recruit 1, pilot 2, wingman 3,
// squad-lead 5, wing-lead 8, front-commander 14, admiral 25.
const CAPS={0:1,25:2,70:3,150:5,300:8,600:14,1200:25};
const MERIT_TO_CAP=merit=>{
 let cap=1;
 for(const [threshold,value] of Object.entries(CAPS)) if(merit>=Number(threshold)) cap=value;
 return cap;
};
const AVAILABLE=new Set(["tackle","brawler","sniper","logistics","ewar","heavy"]);
function fixture(options={}){
 const missing=new Set(options.missing||[]);
 return createWarFleetComposition({
  commandCapFor:({merit})=>MERIT_TO_CAP(Number(merit)||0),
  resolveDoctrine:({factionID,role})=>missing.has(role)
   ?{status:"REFUSED",reason:"DOCTRINE_UNSUPPORTED",factionID,role}
   :{status:"RESOLVED",doctrineID:"coop_war_doctrine_"+factionID+"_"+role,
     loadoutID:"coop_war_doctrine_"+factionID+"_"+role,profileID:"profile_"+role,
     hullClass:"cruiser",hull:{typeID:1,name:"Hull "+role},ammoDepth:60,
     modules:[{typeID:2,quantity:1}],charges:[{typeID:3,quantityPerModule:60}]},
 });
}

test("the doctrine authority is required",()=>{
 assert.throws(()=>createWarFleetComposition({}),/WAR_FLEET_COMPOSITION_DOCTRINE_AUTHORITY_REQUIRED/);
});

test("fleet size follows the real command cap",()=>{
 const api=fixture();
 for(const [merit,cap] of Object.entries(CAPS)){
  const plan=api.compose({factionID:500001,merit:Number(merit)});
  assert.equal(plan.status,"COMPOSED",`merit ${merit}`);
  assert.equal(plan.size,cap,`merit ${merit} -> cap ${cap}`);
  assert.equal(plan.commandCap,cap);
 }
});

test("a recruit fields a tackle and a squad-lead a role-complete gang",()=>{
 const api=fixture();
 const recruit=api.compose({factionID:500001,merit:0});
 assert.deepEqual(recruit.counts,{tackle:1});
 const squad=api.compose({factionID:500001,merit:150});
 assert.equal(squad.size,5);
 assert.ok(squad.counts.tackle>=1);
 assert.ok(squad.counts.ewar>=1);
 assert.ok(squad.counts.logistics>=1);
 assert.ok(squad.counts["anti-tackle"]>=1,"FW-116: two hulls or more always include an anti-tackle destroyer");
 assert.deepEqual(squad.required,["tackle","anti-tackle","ewar","logistics"]);
 const wing=api.compose({factionID:500004,merit:300});
 assert.equal(wing.size,8);
 assert.ok(wing.counts.heavy>=1);
 assert.ok(wing.counts.logistics>=1);
 assert.ok(wing.counts.tackle>=1);
});

test("every ship names a real doctrine row and hull, never a bare count",()=>{
 const api=fixture();
 const plan=api.compose({factionID:500001,merit:150});
 for(const ship of plan.ships){
  assert.equal(ship.doctrineID,"coop_war_doctrine_500001_"+ship.role);
  assert.equal(ship.loadoutID,ship.doctrineID);
  assert.ok(ship.profileID.startsWith("profile_"));
  assert.ok(ship.hullTypeID>0);
  assert.ok(ship.ammoDepth>1);
 }
});

test("role completeness is verified, and a broken plan is caught",()=>{
 const api=fixture();
 const plan=api.compose({factionID:500001,merit:150});
 const verdict=api.verify(plan);
 assert.equal(verdict.ok,true);
 assert.deepEqual(verdict.missing,[]);
 const broken=api.verify({status:"COMPOSED",commandCap:5,required:["tackle","logistics"],
  ships:[{role:"tackle"}]});
 assert.equal(broken.ok,false);
 assert.deepEqual(broken.missing,["logistics"]);
 assert.equal(api.verify(null).ok,false);
});

test("a faction without a doctrine is refused with the doctrine reason",()=>{
 const api=fixture({missing:["logistics"]});
 const plan=api.compose({factionID:500004,merit:150});
 assert.equal(plan.status,"REFUSED");
 assert.equal(plan.reason,"DOCTRINE_UNAVAILABLE");
 assert.equal(plan.role,"logistics");
 assert.equal(plan.doctrineReason,"DOCTRINE_UNSUPPORTED");
 const small=api.compose({factionID:500004,merit:25});
 assert.equal(small.status,"COMPOSED");
 assert.equal(small.size,2);
});

test("requirements grow with the cap and never shrink",()=>{
 assert.deepEqual(requirementsFor(1),["tackle"]);
 assert.deepEqual(requirementsFor(2),["tackle","anti-tackle"]);
 assert.deepEqual(requirementsFor(3),["tackle","anti-tackle","ewar"]);
 assert.deepEqual(requirementsFor(5),["tackle","anti-tackle","ewar","logistics"]);
 assert.deepEqual(requirementsFor(25),["tackle","anti-tackle","ewar","logistics","heavy"]);
});

// FW-116: the new destroyer role is real, not a label - it resolves to a destroyer hull.
// (The hull class itself is verified against the live SDE: see the doctrine resolve check in
// .opencode/state.md - Condor/Arcus/Defacer/Trooper are the real destroyer profiles.)
test("an anti-tackle slot exists from two hulls and carries a real fitting",()=>{
 const api=fixture();
 const plan=api.compose({factionID:500004,merit:25});
 assert.equal(plan.size,2);
 assert.deepEqual(plan.counts,{tackle:1,"anti-tackle":1});
 const destroyer=plan.ships.find((ship)=>ship.role==="anti-tackle");
 assert.ok(destroyer.doctrineID.endsWith("_anti-tackle"));
 assert.ok(destroyer.moduleCount>=1,"the slot carries a real fitting, never a bare count");
});
