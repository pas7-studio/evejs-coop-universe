import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarFleetRegistry,KEY,TABLE}=require("../integration/coopWarFleetRegistry.cjs");
const WAR_KEY="coop-faction-war\u001fstate-v1";
const env=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_DEMOBILIZE:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});
function fixture(){
 const flags=env();let physicallyPresent=true,idle=true,ordersIdle=true;
 const war={version:1,wars:{w1:{state:"ACTIVE",
  attackerFactionID:11,defenderFactionID:22}},
  campaigns:{c1:{warID:"w1",state:"OCCUPIED",revision:7},
   c2:{warID:"w1",state:"PREPARING",revision:1}}};
 const initial={version:1,ships:{"501":{entityID:501,
  systemID:202,pilotID:"coop-pilot-001",corporationID:31,
  factionID:11,fleetID:"fw-c1-11",warID:"w1",campaignID:"c1",
  proofID:"native-muster:501",assignedAt:50}},
  processed:{},history:[]};
 const db=new Map([[KEY,structuredClone(initial)],[WAR_KEY,war]]);
 const gameStore={coopAtomicNativeRows:{transact:([table],fn)=>{
  assert.equal(table,TABLE);
  const cloned=new Map([...db].map(([key,value])=>[key,structuredClone(value)]));
  const tx={get:(_,key)=>cloned.get(key)||null,
   put:(_,key,value)=>cloned.set(key,structuredClone(value))};
  const result=fn(tx);
  db.clear();for(const [key,value] of cloned)db.set(key,value);
  return result;
 }}};
 let nativeChecks=0;
 const registry=createWarFleetRegistry({gameStore,env:flags,clock:()=>100000,
  verifyNativeShip:details=>{nativeChecks++;return physicallyPresent&&idle&&
   details.entityID===501&&details.systemID===202&&
   details.corporationID===31&&details.factionID===11},
  verifyCampaign:(details,tx)=>tx.get(TABLE,WAR_KEY)?.campaigns?.[details.campaignID]?.state==="PREPARING"&&
   details.campaignID==="c2"&&details.systemID===202,
  verifyRelease:()=>physicallyPresent&&idle,
  verifyDemobOrderIdle:()=>ordersIdle});
 const old={type:"DEMOBILIZE",eventID:"wd:c1:501:7",entityID:501,
  systemID:202,pilotID:"coop-pilot-001",fleetID:"fw-c1-11",
  warID:"w1",campaignID:"c1",campaignRevision:7,
  proofID:"native-demob:c1:501"};
 const newMission={type:"ASSIGN",eventID:"wm:c2:501",entityID:501,
  systemID:202,pilotID:"coop-pilot-001",corporationID:31,
  factionID:11,fleetID:"fw-c2-11",warID:"w1",campaignID:"c2",
  proofID:"native-muster:501"};
 return {flags,war,db,registry,old,newMission,
  get nativeChecks(){return nativeChecks},
  physical:x=>physicallyPresent=x,idle:x=>idle=x,
  orderIdle:x=>ordersIdle=x,
  get ships(){return db.get(KEY).ships}};
}
test("native SQLite demobilization preserves the original physical NPC",()=>{
 const f=fixture(),r=f.registry.execute(f.old);
 assert.equal(r.status,"APPLIED");assert.equal(r.receipt.nativeShipPreserved,true);
 assert.deepEqual(f.ships,{});
 assert.equal(f.registry.execute(f.old).status,"DUPLICATE");
 assert.equal(f.db.get(KEY).history.length,1);
 assert.equal(f.nativeChecks,1);
});
test("the same original idle native hull may enroll in a separate campaign",()=>{
 const f=fixture();
 assert.equal(f.registry.execute(f.old).status,"APPLIED");
 const reassigned=f.registry.execute(f.newMission);
 assert.equal(reassigned.status,"APPLIED");
 assert.equal(f.ships["501"].entityID,501);
 assert.equal(f.ships["501"].campaignID,"c2");
 assert.equal(f.ships["501"].fleetID,"fw-c2-11");
 assert.equal(f.db.get(KEY).history.length,2);
});
test("stale campaign revision or active war assault blocks demobilization",()=>{
 const f=fixture();
 assert.equal(f.registry.execute({...f.old,campaignRevision:6}).reason,
  "WAR_CAMPAIGN_NOT_TERMINAL");
 f.war.campaigns.c1.state="ASSAULT";
 assert.equal(f.registry.execute(f.old).reason,"WAR_CAMPAIGN_NOT_TERMINAL");
 assert.equal(f.ships["501"].entityID,501);
});
test("native controller busy, missing ship, and order arbiter deny release",()=>{
 const f=fixture();f.idle(false);
 assert.equal(f.registry.execute(f.old).reason,"WAR_DEMOB_NATIVE_HULL_BUSY_OR_UNVERIFIED");
 f.idle(true);f.physical(false);
 assert.equal(f.registry.execute(f.old).reason,"WAR_DEMOB_NATIVE_HULL_BUSY_OR_UNVERIFIED");
 f.physical(true);f.orderIdle(false);
 assert.equal(f.registry.execute(f.old).reason,"WAR_DEMOB_NATIVE_HULL_BUSY_OR_UNVERIFIED");
 assert.equal(f.ships["501"].entityID,501);
});
test("pending or terminal-but-not-retired native transfer never releases",()=>{
 const f=fixture();
 f.db.get(KEY).transfers={"501":{transferID:"fw:501:101:202:1",
  entityID:501,pilotID:"coop-pilot-001",warID:"w1",campaignID:"c1",
  phase:"COMPLETE",sourceSystemID:101,destinationSystemID:202}};
 assert.equal(f.registry.execute(f.old).reason,"WAR_DEMOB_TRANSFER_NOT_RETIRED");
 assert.equal(f.ships["501"].entityID,501);
});
test("CANCELLED is legal only after its actual native war ended",()=>{
 const f=fixture();f.war.campaigns.c1.state="CANCELLED";
 assert.equal(f.registry.execute(f.old).reason,"WAR_CAMPAIGN_NOT_TERMINAL");
 f.war.wars.w1.state="ENDED";
 assert.equal(f.registry.execute(f.old).status,"APPLIED");
});
test("wrong fleet identity and missing default-off feature gate deny mutation",()=>{
 const f=fixture();
 assert.equal(f.registry.execute({...f.old,fleetID:"forged"}).reason,
  "WAR_DEMOB_IDENTITY_OR_PROOF_INVALID");
 f.flags.EVEJS_COOP_FACTION_WAR_DEMOBILIZE="0";
 assert.equal(f.registry.execute(f.old).status,"DISABLED");
 assert.equal(f.ships["501"].entityID,501);
});
