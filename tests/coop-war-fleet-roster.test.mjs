import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarFleetRoster,TABLE,KEY}=require("../integration/coopWarFleetRoster.cjs");

const ENV={EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1"};

// A real GameStore shape: coopAtomicNativeRows.transact over a durable row, and
// read() answering both the raw key and the cache path (coopNativeRowPath).
function memoryStore(){
 const rows=new Map();
 const key=(table,path)=>{
  let k=String(path||"").replace(/^\//,"");
  if(!k.includes("\u001f"))k=k.split("/").join("\u001f");
  return table+"|"+k;
 };
 return {
  rows,
  read:(table,path)=>{
   const found=rows.get(key(table,path));
   return found?{success:true,data:JSON.parse(JSON.stringify(found))}:
    {success:false,errorMsg:"ENTRY_NOT_FOUND"};
  },
  coopAtomicNativeRows:{
   transact:(tables,fn)=>fn({
    get:(table,k)=>rows.get(table+"|"+k)||null,
    put:(table,k,v)=>rows.set(table+"|"+k,v),
   }),
  },
 };
}
function fixture(options={}){
 const store=memoryStore();
 const alive=new Set(options.alive||[]);
 const free=options.free||[];
 const roster=createWarFleetRoster({
  gameStore:store,
  env:options.env||ENV,
  clock:()=>1793100000000,
  isEntityAlive:id=>alive.has(Number(id)),
  listFreeHulls:()=>free,
 });
 return {roster,store,alive,free};
}
const SHIPS=[
 {entityID:1001,role:"tackle",doctrineID:"coop_war_doctrine_500001_tackle",pilotID:"coop-pilot-001"},
 {entityID:1002,role:"brawler",doctrineID:"coop_war_doctrine_500001_brawler",pilotID:"coop-pilot-002"},
 {entityID:1003,role:"logistics",doctrineID:"coop_war_doctrine_500001_logistics",pilotID:"coop-pilot-003"},
];
const COMPOSE=({merit})=>({status:"COMPOSED",commandCap:merit>=150?3:1,
 ships:merit>=150?[{role:"tackle"},{role:"brawler"},{role:"logistics"}]:[{role:"tackle"}]});

test("the native atomic store is required",()=>{
 assert.throws(()=>createWarFleetRoster({env:ENV}),/WAR_FLEET_ROSTER_NATIVE_AUTHORITIES_REQUIRED/);
});

test("the roster is disabled unless the war fleet flags are on",()=>{
 const {roster}=fixture({env:{}});
 assert.equal(roster.snapshot().status,"DISABLED");
 assert.equal(roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS}).status,"DISABLED");
});

test("a fleet is durable, one owner per hull, and never a bare count",()=>{
 const {roster,store}=fixture();
 const created=roster.createFleet({factionID:500001,systemID:30002780,stagingSystemID:30002780,
  rank:"squad-lead",merit:150,commandCap:3,ships:SHIPS});
 assert.equal(created.status,"CREATED");
 assert.equal(created.size,3);
 assert.deepEqual(created.composition,["tackle","brawler","logistics"]);
 assert.ok(store.rows.has(TABLE+"|"+KEY));
 const again=roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS});
 assert.equal(again.status,"BLOCKED");
 assert.equal(again.reason,"FLEET_SHIP_ALREADY_OWNED");
 const stored=roster.fleet(created.fleetID);
 assert.equal(stored.state,"ACTIVE");
 assert.equal(stored.ships.length,3);
 assert.ok(stored.ships.every(ship=>ship.state==="ALIVE"));
});

test("a real loss is recorded with evidence and returns a merit event",()=>{
 const {roster}=fixture();
 const {fleetID}=roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS});
 const loss=roster.recordLoss({fleetID,entityID:1002,wreckID:980300000099,casualtyID:"cas-1"});
 assert.equal(loss.status,"RECORDED");
 assert.equal(loss.survivors,2);
 assert.equal(loss.fleetState,"DISENGAGED");
 assert.deepEqual(loss.meritEvent,{kind:"force-lost",count:1,fleetID,pilotID:"coop-pilot-002"});
 const duplicate=roster.recordLoss({fleetID,entityID:1002});
 assert.equal(duplicate.status,"DUPLICATE");
 assert.equal(roster.recordLoss({fleetID,entityID:9999}).reason,"SHIP_NOT_IN_FLEET");
 assert.equal(roster.recordLoss({fleetID:"coop-fleet-nope",entityID:1001}).reason,"FLEET_NOT_FOUND");
 const stored=roster.fleet(fleetID);
 assert.equal(stored.losses.length,1);
 assert.equal(stored.losses[0].wreckID,980300000099);
});

test("survivors regroup and real free hulls fill the missing slots",()=>{
 const {roster,alive}=fixture({alive:[1001,1003],free:[
  {entityID:2002,role:"brawler",doctrineID:"coop_war_doctrine_500001_brawler",hullTypeID:15320},
 ]});
 const {fleetID}=roster.createFleet({factionID:500001,systemID:30002780,stagingSystemID:30002780,
  rank:"squad-lead",merit:150,commandCap:3,ships:SHIPS});
 roster.recordLoss({fleetID,entityID:1002,wreckID:980300000098});
 const plan=roster.planReconstitution({fleetID,merit:150,compose:COMPOSE});
 assert.equal(plan.status,"RECONSTITUTED");
 assert.equal(plan.reason,"REAL_SURVIVORS_PLUS_FREE_HULLS");
 assert.deepEqual(plan.survivors.map(s=>s.entityID).sort(),[1001,1003]);
 assert.deepEqual(plan.adopted,[{entityID:2002,role:"brawler"}]);
 assert.equal(plan.size,3);
 assert.deepEqual(plan.ships.map(s=>s.entityID),[1001,2002,1003]);
 assert.ok(plan.ships.every(ship=>[1001,1003,2002].includes(ship.entityID)));
});

test("without a real replacement the fleet stays smaller and says so",()=>{
 const {roster}=fixture({alive:[1001,1003],free:[]});
 const {fleetID}=roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS});
 roster.recordLoss({fleetID,entityID:1002});
 const plan=roster.planReconstitution({fleetID,merit:150,compose:COMPOSE});
 assert.equal(plan.status,"REDUCED");
 assert.equal(plan.reason,"NO_REAL_REPLACEMENT_AVAILABLE");
 assert.deepEqual(plan.missing.map(m=>m.role),["brawler"]);
 assert.equal(plan.adopted.length,0);
 assert.equal(plan.size,2);
});

test("a hull that is gone but was never recorded as lost is reported, not counted",()=>{
 const {roster}=fixture({alive:[1001]});
 const {fleetID}=roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS});
 const plan=roster.planReconstitution({fleetID,merit:0,compose:COMPOSE});
 assert.equal(plan.status,"RECONSTITUTED");
 assert.deepEqual(plan.unrecorded.sort(),[1002,1003]);
 assert.equal(plan.size,1);
 assert.deepEqual(plan.ships.map(s=>s.entityID),[1001]);
});

test("a fleet with no survivor cannot reconstitute",()=>{
 const {roster}=fixture({alive:[]});
 const {fleetID}=roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS});
 const plan=roster.planReconstitution({fleetID,merit:150,compose:COMPOSE});
 assert.equal(plan.status,"BLOCKED");
 assert.equal(plan.reason,"NO_SURVIVOR");
});

test("committing a reconstitution creates a NEW fleet and retires the old one",()=>{
 const {roster}=fixture({alive:[1001,1003],free:[
  {entityID:2002,role:"brawler",doctrineID:"coop_war_doctrine_500001_brawler",hullTypeID:15320},
 ]});
 const first=roster.createFleet({factionID:500001,systemID:30002780,stagingSystemID:30002780,
  rank:"squad-lead",merit:150,commandCap:3,ships:SHIPS});
 roster.recordLoss({fleetID:first.fleetID,entityID:1002,wreckID:980300000097});
 const plan=roster.planReconstitution({fleetID:first.fleetID,merit:150,compose:COMPOSE});
 const done=roster.commitReconstitution({plan,rank:"squad-lead"});
 assert.equal(done.status,"RECONSTITUTED");
 assert.notEqual(done.fleetID,first.fleetID);
 assert.equal(done.size,3);
 assert.equal(done.survivors,2);
 assert.equal(done.adopted,1);
 const parent=roster.fleet(first.fleetID);
 assert.equal(parent.state,"RECONSTITUTED");
 assert.equal(parent.reconstitutedAs,done.fleetID);
 const child=roster.fleet(done.fleetID);
 assert.equal(child.state,"ACTIVE");
 assert.equal(child.parentFleetID,first.fleetID);
 assert.equal(child.ships.filter(ship=>ship.state==="ADOPTED").length,1);
 const snapshot=roster.snapshot();
 assert.equal(snapshot.fleets,2);
 assert.ok(snapshot.state.history.some(entry=>entry.event==="FLEET_RECONSTITUTED"));
});

test("an adopted hull cannot be adopted twice, and a refused plan never commits",()=>{
 const {roster}=fixture({alive:[1001,1002,1003],free:[
  {entityID:2002,role:"brawler",doctrineID:"coop_war_doctrine_500001_brawler"},
 ]});
 const a=roster.createFleet({factionID:500001,systemID:30002780,ships:SHIPS.slice(0,1)});
 const b=roster.createFleet({factionID:500001,systemID:30002780,ships:[
  {entityID:1002,role:"brawler",doctrineID:"coop_war_doctrine_500001_brawler"},
  {entityID:1003,role:"logistics",doctrineID:"coop_war_doctrine_500001_logistics"},
 ]});
 const planA=roster.planReconstitution({fleetID:a.fleetID,merit:150,compose:COMPOSE});
 const committed=roster.commitReconstitution({plan:planA});
 assert.equal(committed.status,"REDUCED");
 const planB=roster.planReconstitution({fleetID:b.fleetID,merit:150,compose:COMPOSE});
 assert.equal(planB.adopted.length,0,`2002 is already owned by ${committed.fleetID}`);
 assert.equal(roster.commitReconstitution({plan:{status:"BLOCKED"}}).reason,"PLAN_NOT_RECONSTITUTABLE");
});

// FW-039: the faction RESERVE is durable and only real facts move it.
test("a faction reserve is declared, spent by a real loss and consumed by a replacement", () => {
 const {roster,store}=fixture();
 const created=roster.createFleet({factionID:500001,systemID:30002780,
  stagingSystemID:30002780,rank:"squad-lead",merit:150,commandCap:3,ships:SHIPS});
 assert.equal(created.status,"CREATED");
 assert.deepEqual(roster.declareReserve({factionID:500001,role:"tackle",
  spawnable:2,equipped:1,source:"REAL_FREE_NATIVE_HULLS"}).status,"DECLARED");
 const before=roster.reserveOf({factionID:500001});
 assert.equal(before.roles.tackle.equipped,1);
 assert.equal(before.roles.tackle.spawnable,2);
 const loss=roster.recordLoss({fleetID:created.fleetID,
  entityID:1001,wreckID:980300000999});
 assert.equal(loss.status,"RECORDED");
 assert.equal(loss.factionID,500001);
 assert.equal(loss.reserve.equipped,0);
 assert.equal(loss.frontChat.kind,"fleet-loss");
 assert.equal(loss.frontChat.eventKey,"loss:"+created.fleetID+":"+1001);
 assert.equal(roster.reserveOf({factionID:500001}).roles.tackle.spawnable,2);
 assert.equal(roster.declareReserve({factionID:500001,role:"titan",
  spawnable:1,equipped:0}).reason,"UNKNOWN_ROLE");
 assert.equal(roster.declareReserve({factionID:0,role:"tackle",
  spawnable:1,equipped:0}).reason,"FACTION_REQUIRED");
 assert.equal(roster.reserveOf({factionID:999}).totals.spawnable,0);
 assert.ok(store.rows.has(TABLE+"|"+KEY));
});
