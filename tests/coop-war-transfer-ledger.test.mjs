import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarTransferLedger,fingerprint}=require("../integration/coopWarTransferLedger.cjs");
const {KEY:FLEET_KEY,TABLE}=require("../integration/coopWarFleetRegistry.cjs");
const {KEY:WAR_KEY}=require("../integration/coopFactionWarStore.cjs");
const {KEY:TREASURY_KEY}=require("../integration/coopWarTreasury.cjs");
const flags=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});
function fixture(){
 const env=flags();
 const physical=new Map([[101,new Set([501])],[202,new Set()]]);
 const ship={itemID:501,kind:"ship",nativeNpc:true,corporationID:31};
 const native={entityID:501,systemID:101,corporationID:31,ownerID:31};
 const controller={entityID:501,systemID:101,manualOrder:null};
 const links={"coop-pilot-001":{pilotID:"coop-pilot-001",entityID:501,systemID:101}};
 const identityRegistry={
  snapshot:()=>({version:1,links:structuredClone(links)}),
  relocate:(pilot,source,id,dest)=>{
   if(physical.get(source).has(id)||!physical.get(dest).has(id))
    return {status:"PROOF_REQUIRED"};
   if(links[pilot]?.entityID!==id||links[pilot]?.systemID!==source)
    return {status:"INVALID_IDENTITY"};
   links[pilot]={...links[pilot],systemID:dest};
   return {status:"RELOCATED"};
  }
 };
 const row={entityID:501,systemID:101,pilotID:"coop-pilot-001",
  corporationID:31,factionID:11,fleetID:"fw-c1-11",warID:"w1",campaignID:"c1"};
 const fleet={version:1,ships:{"501":row},processed:{},history:[]};
 const war={version:1,wars:{w1:{warID:"w1",state:"ACTIVE",
  attackerFactionID:11,defenderFactionID:22}},
  campaigns:{c1:{campaignID:"c1",warID:"w1",state:"PREPARING",
   sourceSystemID:101,targetSystemID:202,supplyReservationID:"r1"}}};
 const treasury={version:1,reservations:{r1:{reservationID:"r1",
  warID:"w1",campaignID:"c1",factionID:11,status:"HELD",cents:10000}}};
 const rows=new Map([[FLEET_KEY,structuredClone(fleet)],
  [WAR_KEY,structuredClone(war)],[TREASURY_KEY,structuredClone(treasury)]]);
 let writes=0,uncertain=false,modules=[{moduleID:801,entityID:501,ownerID:31,typeID:900}],
  cargo=[{cargoID:901,entityID:501,ownerID:31,moduleID:801,typeID:902,quantity:10}];
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,[TABLE]);
  if(uncertain)throw Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN");
  const next=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(table,key)=>{assert.equal(table,TABLE);return next.get(key)||null},
   put:(table,key,val)=>{assert.equal(table,TABLE);next.set(key,structuredClone(val));writes++}};
  const out=fn(tx);rows.clear();for(const [k,v] of next)rows.set(k,v);return out;
 }}};
 const store={getNativeEntity:()=>native,getNativeController:()=>controller,
  listNativeModulesForEntity:()=>modules,
  listNativeCargoForEntity:()=>cargo};
 const ledger=createWarTransferLedger({
  gameStore,identityRegistry,env,clock:()=>1234567,
  sceneForSystem:systemID=>({systemID,
   getEntityByID:id=>physical.get(systemID)?.has(id)?ship:null}),
  nativeStore:store,getController:()=>controller
 });
 const cmd={transferID:"fw:501:101:202",entityID:501,
  sourceSystemID:101,destinationSystemID:202};
 function move(to){
  physical.get(to===202?101:202).delete(501);physical.get(to).add(501);
  native.systemID=to;controller.systemID=to;
 }
 return {ledger,cmd,rows,links,ship,native,controller,identityRegistry,
  move,changeCargo:q=>{cargo[0].quantity=q},invalidFunds:()=>{rows.get(TREASURY_KEY).reservations.r1.status="REFUNDED"},
  changeWar:()=>{rows.get(WAR_KEY).wars.w1.state="ENDED"},
  failSql:()=>{uncertain=true},get writes(){return writes},
  fleet:()=>rows.get(FLEET_KEY)};
}
test("physical source intent is a durable SQL fence, not a fleet teleport",()=>{
 const f=fixture(),receipt=f.ledger.begin(f.cmd);
 assert.equal(receipt.status,"PREPARED");
 assert.equal(f.fleet().ships["501"].systemID,101);
 assert.equal(f.ledger.pending().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.ledger.begin(f.cmd).reason,"WAR_HANDOFF_ALREADY_RECORDED");
});
test("native destination then SQL + JSON relocation finish exactly once",()=>{
 const f=fixture();
 assert.equal(f.ledger.begin(f.cmd).status,"PREPARED");
 f.move(202);
 assert.equal(f.ledger.nativeCommit(f.cmd).status,"NATIVE_COMMITTED");
 assert.equal(f.fleet().ships["501"].systemID,202);
 assert.equal(f.ledger.pending().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.identityRegistry.relocate("coop-pilot-001",101,501,202).status,"RELOCATED");
 assert.equal(f.ledger.finish(f.cmd).status,"COMPLETE");
 assert.equal(f.ledger.pending().status,"CLEAN");
 assert.equal(f.ledger.auditPersisted().status,"CLEAN");
 assert.equal(f.ledger.finish(f.cmd).status,"BLOCKED");
 assert.equal(f.fleet().ships["501"].systemID,202);
});
test("different fitted charges after transfer block native commit, no fake arrival",()=>{
 const f=fixture();f.ledger.begin(f.cmd);f.move(202);f.changeCargo(99);
 assert.equal(f.ledger.nativeCommit(f.cmd).reason,"WAR_HANDOFF_CUSTODY_CHANGED");
 assert.equal(f.fleet().ships["501"].systemID,101);
 assert.equal(f.ledger.pending().pending[0].phase,"PREPARED");
});
test("safe rollback can abort source intent or restore destination SQL after rollback",()=>{
 const f=fixture();f.ledger.begin(f.cmd);
 assert.equal(f.ledger.abort(f.cmd).status,"ABORTED");
 assert.equal(f.ledger.pending().status,"CLEAN");
 const g=fixture();g.ledger.begin(g.cmd);g.move(202);
 g.ledger.nativeCommit(g.cmd);
 g.move(101);
 assert.equal(g.ledger.restore(g.cmd).status,"ABORTED");
 assert.equal(g.fleet().ships["501"].systemID,101);
});
test("cannot abort an actual destination ship or finish while identity is source",()=>{
 const f=fixture();f.ledger.begin(f.cmd);f.move(202);
 assert.equal(f.ledger.abort(f.cmd).reason,"WAR_HANDOFF_SOURCE_NOT_RESTORED");
 f.ledger.nativeCommit(f.cmd);
 assert.equal(f.ledger.finish(f.cmd).reason,"WAR_HANDOFF_IDENTITY_NOT_COMMITTED");
});
test("ended campaign or refunded funds refuse intent and do not write SQL",()=>{
 const f=fixture();f.invalidFunds();
 assert.equal(f.ledger.begin(f.cmd).reason,"WAR_HANDOFF_CAMPAIGN_OR_FUNDS_UNVERIFIED");
 assert.equal(f.writes,0);
 const g=fixture();g.changeWar();
 assert.equal(g.ledger.begin(g.cmd).reason,"WAR_HANDOFF_CAMPAIGN_OR_FUNDS_UNVERIFIED");
});
test("native SQL exception does not acknowledge prepared, operator audit blocks",()=>{
 const f=fixture();f.failSql();
 assert.throws(()=>f.ledger.begin(f.cmd),/NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN/);
 assert.equal(f.fleet().ships["501"].systemID,101);
});
test("corrupt fingerprint input and unverified filesystem links reject handoff",()=>{
 assert.equal(fingerprint([{moduleID:4},{moduleID:4}],"moduleID"),null);
 const f=fixture();f.links["coop-pilot-002"]={entityID:501,systemID:101};
 assert.equal(f.ledger.begin(f.cmd).reason,"WAR_HANDOFF_SOURCE_UNVERIFIED");
});
test("a previously completed transfer is not safe after pilot or native drift",()=>{
 const f=fixture();f.ledger.begin(f.cmd);f.move(202);
 f.ledger.nativeCommit(f.cmd);
 f.identityRegistry.relocate("coop-pilot-001",101,501,202);
 f.ledger.finish(f.cmd);
 assert.equal(f.ledger.auditPersisted().status,"CLEAN");
 f.native.systemID=101;
 assert.equal(f.ledger.auditPersisted().status,"NEEDS_OPERATOR_REPAIR");
});
test("an incomplete handoff is an explicit restart repair blocker",()=>{
 const f=fixture();
 assert.equal(f.ledger.begin(f.cmd).status,"PREPARED");
 assert.equal(f.ledger.auditPersisted().status,"NEEDS_OPERATOR_REPAIR");
});
