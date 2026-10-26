import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {checkConfiguration,validate,checkPeerBeforeNativePayout}=
 require("../integration/coopPveDuoNativeRewardGuard.cjs");
function fixture(){
 const leader=101,peer=102,agent=50,system=30000144,source=71001;
 const ownerSession={characterID:leader,socket:{destroyed:false}};
 const peerSession={characterID:peer,socket:{destroyed:false}};
 const leaderMission={agentID:agent,missionSequence:11,contentID:"pirateOutpost",
  missionTemplateID:"native-pirate",objectiveMode:"dungeon",
  runtimeStatus:"accepted",objectiveCompleted:true,gmCompleted:false,
  missionSystemID:system,dungeonInstanceID:source};
 const peerMission={...leaderMission,missionSequence:29,dungeonInstanceID:71002,
  coopSharedDungeon:{ownerID:leader,agentID:agent,sourceInstanceID:source,
   contentID:"pirateOutpost",missionTemplateID:"native-pirate"}};
 const ticket={ok:true,leader,peerID:peer,fleetID:77,agentID:agent,
  actionID:6,station:60000123,leaderMission,peerMission,
  session:ownerSession,peer:peerSession};
 const instance={instanceID:source,solarSystemID:system,
  lifecycleState:"completed",metadata:{missionAgentID:agent,
   missionCharacterID:leader},ownership:{missionOwnerCharacterID:leader},
  objectiveState:{state:"completed",completedAtMs:100001}};
 const flags={EVEJS_COOP_FLEET_MISSION_TURNIN:"1",
  EVEJS_COOP_FLEET_LEADER_FENCE:"1",
  EVEJS_COOP_MISSION_INSTANCE_LINK:"1"};
 const deps={flags,getInstance:id=>id===source?instance:null,
  verifyLink:()=>({ok:true,status:"LINK_VERIFIED"}),
  sharedObjectiveMatches:()=>true};
 return {ticket,instance,flags,deps,peerMission,leaderMission};
}
test("two independently accepted native completed missions earn only preflight authorization",()=>{
 const f=fixture(),r=validate({ticket:f.ticket,...f.deps});
 assert.equal(r.ok,true);
 assert.equal(r.status,"PVE_DUO_NATIVE_REWARD_PREFLIGHT_READY");
 assert.equal(r.leaderSequence,11);
 assert.equal(r.peerSequence,29);
 assert.equal(r.sourceInstanceID,71001);
 assert.equal(typeof r.rewardISK,"undefined","no synthetic ISK grant");
});
test("strict duo gate requires BOTH existing native durable payout fences and instance link",()=>{
 const f=fixture();
 for(const name of Object.keys(f.flags)){
  const flags={...f.flags,[name]:"0"};
  const r=validate({ticket:f.ticket,...f.deps,flags});
  assert.equal(r.status,"PVE_DUO_NATIVE_SETTLEMENT_DEPENDENCY_MISSING");
  assert.equal(r.ok,false);
 }
 assert.equal(checkConfiguration(f.flags).ok,true);
});
test("missing actual source dungeon or only mission-record completed flag cannot pay",()=>{
 const f=fixture();
 assert.equal(validate({ticket:f.ticket,...f.deps,getInstance:()=>null}).status,
  "PVE_DUO_ORIGINAL_DUNGEON_COMPLETION_UNPROVEN");
 f.instance.lifecycleState="active";f.instance.objectiveState={state:"active"};
 assert.equal(validate({ticket:f.ticket,...f.deps}).ok,false);
});
test("wrong dungeon instance, owner, system or agent never authorizes two rewards",()=>{
 const changes=[
  f=>{f.instance.instanceID=9999},
  f=>{f.instance.solarSystemID=30000999},
  f=>{f.instance.metadata.missionCharacterID=999},
  f=>{f.instance.ownership.missionOwnerCharacterID=999},
  f=>{f.instance.metadata.missionAgentID=51},
  f=>{delete f.instance.metadata.missionCharacterID;delete f.instance.ownership.missionOwnerCharacterID},
  f=>{f.instance.objectiveState={state:"ACTIVE",completedAtMs:0};f.instance.lifecycleState="active"}
 ];
 for(const fn of changes){const f=fixture();fn(f);
  assert.equal(validate({ticket:f.ticket,...f.deps}).status,
   "PVE_DUO_ORIGINAL_DUNGEON_COMPLETION_UNPROVEN");}
});
test("same mission sequence or mismatched native content cannot masquerade as duo",()=>{
 const changes=[
  f=>{f.peerMission.missionSequence=11},
  f=>{f.peerMission.agentID=51},
  f=>{f.peerMission.contentID="other"},
  f=>{f.peerMission.missionTemplateID="other"},
  f=>{f.peerMission.missionSystemID=30000222},
  f=>{f.peerMission.objectiveCompleted=false},
  f=>{f.peerMission.runtimeStatus="offered"},
  f=>{f.leaderMission.gmCompleted=true},
  f=>{f.leaderMission.importantMission=true},
  f=>{f.ticket.actionID=99}
 ];
 for(const fn of changes){const f=fixture();fn(f);
  assert.equal(validate({ticket:f.ticket,...f.deps}).status,
   "PVE_DUO_NOT_TWO_INDEPENDENT_COMPLETED_NATIVE_MISSIONS");}
});
test("native player sessions must remain two distinct connected characters",()=>{
 const changes=[
  f=>{f.ticket.peer=f.ticket.session},
  f=>{f.ticket.peer.characterID=101},
  f=>{f.ticket.session.characterID=999},
  f=>{f.ticket.peer.socket.destroyed=true},
  f=>{f.ticket.session.socket=null}
 ];
 for(const fn of changes){const f=fixture();fn(f);
  assert.equal(validate({ticket:f.ticket,...f.deps}).status,
   "PVE_DUO_NATIVE_RECIPIENT_SESSIONS_INVALID");}
});
test("no durable native same-instance link means no second reward",()=>{
 const f=fixture();
 const r=validate({ticket:f.ticket,...f.deps,
  verifyLink:()=>({ok:false,status:"LINK_MISSING"})});
 assert.equal(r.ok,false);
 assert.equal(r.status,"PVE_DUO_DURABLE_INSTANCE_LINK_UNVERIFIED");
});
test("a separate native objective without peer share receipt cannot qualify",()=>{
 const f=fixture();const result=validate({ticket:f.ticket,...f.deps,
  sharedObjectiveMatches:()=>false});
 assert.equal(result.status,"PVE_DUO_PEER_NATIVE_SHARED_OBJECTIVE_UNVERIFIED");
});
test("native agent authority errors fail closed, not synthetic reward",()=>{
 const f=fixture();
 assert.equal(validate({ticket:f.ticket,...f.deps,
  getInstance:()=>{throw Error("db unavailable")}}).ok,false);
 assert.equal(validate({ticket:f.ticket,...f.deps,
  verifyLink:()=>{throw Error("journal corrupt")}}).status,
  "PVE_DUO_PROVENANCE_AUTHORITY_UNAVAILABLE");
});
test("second native payout remains allowed after first recipient purges dungeon",()=>{
 const f=fixture(),preflight=validate({ticket:f.ticket,...f.deps});
 assert.equal(preflight.ok,true);
 f.deps.getInstance=()=>null; // native owner DoAction has purged dungeon
 const peer=checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer:f.peerMission,
  preflight,...f.deps});
 assert.equal(peer.ok,true);
 assert.equal(peer.status,"PVE_DUO_PEER_NATIVE_REWARD_ALLOWED");
});
test("peer reward fails closed if a different character's mission replaces the peer",()=>{
 const edits=[
  p=>({...p,missionSequence:40}),
  p=>({...p,contentID:"other"}),
  p=>({...p,objectiveCompleted:false}),
  p=>({...p,agentID:51}),
  p=>({...p,missionSystemID:30000000})
 ];
 for(const edit of edits){const f=fixture(),first=validate({ticket:f.ticket,...f.deps});
  const currentPeer=edit(f.peerMission);
  const result=checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer,
   preflight:first,...f.deps});
  assert.equal(result.status,"PVE_DUO_NATIVE_RECIPIENT_CHANGED_AFTER_LEADER");}
});
test("peer reward still checks durable link and native shared receipt AFTER leader payout",()=>{
 const f=fixture(),first=validate({ticket:f.ticket,...f.deps});
 assert.equal(checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer:f.peerMission,
  preflight:first,...f.deps,verifyLink:()=>({ok:false})}).ok,false);
 assert.equal(checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer:f.peerMission,
  preflight:first,...f.deps,sharedObjectiveMatches:()=>false}).status,
  "PVE_DUO_PEER_NATIVE_SHARED_OBJECTIVE_UNVERIFIED");
});
test("a forged preflight or changed fleet blocks paying the wingman",()=>{
 const f=fixture();
 const good=validate({ticket:f.ticket,...f.deps});
 assert.equal(checkPeerBeforeNativePayout({ticket:f.ticket,
  currentPeer:f.peerMission,preflight:{...good,ok:false},...f.deps}).ok,false);
 f.ticket.fleetID=88;
 assert.equal(checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer:f.peerMission,
  preflight:good,...f.deps}).status,
  "PVE_DUO_NATIVE_RECIPIENT_CHANGED_AFTER_LEADER");
});

test("native mission content IDs may be numeric but must match after normalization",()=>{
 const f=fixture();
 f.leaderMission.contentID=9000;f.peerMission.contentID="9000";
 const a=validate({ticket:f.ticket,...f.deps});
 assert.equal(a.ok,true);
 assert.equal(a.contentID,"9000");
 assert.equal(checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer:f.peerMission,
  preflight:a,...f.deps}).ok,true);
});
test("two native sequences with different encodings still refer to one mission and are rejected",()=>{
 const f=fixture();
 f.peerMission.missionSequence="11";
 assert.equal(validate({ticket:f.ticket,...f.deps}).status,
  "PVE_DUO_NOT_TWO_INDEPENDENT_COMPLETED_NATIVE_MISSIONS");
});
test("peer socket disappeared after leader payout cannot authorize second mission payment",()=>{
 const f=fixture(),first=validate({ticket:f.ticket,...f.deps});
 f.ticket.peer.socket=null;
 assert.equal(checkPeerBeforeNativePayout({ticket:f.ticket,currentPeer:f.peerMission,
  preflight:first,...f.deps}).status,"PVE_DUO_NATIVE_RECIPIENT_CHANGED_AFTER_LEADER");
});
