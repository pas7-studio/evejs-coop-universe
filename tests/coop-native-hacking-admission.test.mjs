import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeHackingAdmission}=require("../integration/coopNativeHackingAdmission.cjs");
const {patch,DOGMA,HACK}=require("../scripts/coop-native-hacking-admission-patch.cjs");
const sid=30000142;
function fixture(){
 let now=1000000;
 const session={characterID:42,_space:{shipID:321,systemID:sid},socket:{destroyed:false}};
 const ship={itemID:321,kind:"ship",nativeNpc:false,
  position:{x:0,y:0,z:0},radius:10,lockedTargets:new Set([900])};
 const target={itemID:900,dungeonMaterializedContainer:true,
  dungeonMaterializedSiteContent:true,dungeonSiteContentAnalyzer:"relic",
  dungeonSiteContentHackingState:0,dungeonSiteInstanceID:7,
  position:{x:1000,y:0,z:0},radius:10};
 const scene={systemID:sid,getShipEntityForSession:()=>ship,
  getEntityByID:id=>id===900?target:null};
 const guard=createNativeHackingAdmission({getSceneForSession:()=>scene,clock:()=>now});
 const request={targetID:900,targetEntity:target,gameType:1,moduleTypeID:231,
  difficulty:4.5,coherence:50,strength:30,slots:2};
 const rpc={targetID:900,gameType:1,moduleTypeID:231};
 return {session,ship,target,scene,guard,request,rpc,advance:ms=>{now+=ms}};
}
test("real analyzer initiation returns one-use, session-bound canonical stats",()=>{
 const f=fixture();
 assert.equal(f.guard.issue(f.session,f.request).status,"ISSUED");
 const entry=f.guard.consume(f.session,f.rpc);
 assert.ok(entry);assert.equal(entry.difficulty,4.5);
 assert.equal(entry.coherence,50);assert.equal(entry.strength,30);
 assert.equal(f.guard.validate(f.session,entry),true);
 assert.equal(f.guard.consume(f.session,f.rpc),null);
});
test("direct RPC never fabricates an analyzer admission",()=>{
 const f=fixture();assert.equal(f.guard.consume(f.session,f.rpc),null);
});
test("valid hacking continues after 5s admission but not beyond 3min",()=>{
 const f=fixture();assert.equal(f.guard.issue(f.session,f.request).status,"ISSUED");
 const entry=f.guard.consume(f.session,f.rpc);assert.ok(entry);
 f.advance(6000);assert.equal(f.guard.validate(f.session,entry),true);
 f.advance(175000);assert.equal(f.guard.validate(f.session,entry),false);
});
test("wrong module or game type consumes ticket and prevents replay",()=>{
 const f=fixture();f.guard.issue(f.session,f.request);
 assert.equal(f.guard.consume(f.session,{...f.rpc,moduleTypeID:232}),null);
 assert.equal(f.guard.consume(f.session,f.rpc),null);
 const g=fixture();g.guard.issue(g.session,g.request);
 assert.equal(g.guard.consume(g.session,{...g.rpc,gameType:0}),null);
});
test("different authenticated session cannot steal another ticket",()=>{
 const f=fixture();f.guard.issue(f.session,f.request);
 assert.equal(f.guard.consume({...f.session},f.rpc),null);
 assert.ok(f.guard.consume(f.session,f.rpc));
});
test("expired or backward clock admits no hacking",()=>{
 const f=fixture();f.guard.issue(f.session,f.request);f.advance(6000);
 assert.equal(f.guard.consume(f.session,f.rpc),null);
 const g=fixture();g.guard.issue(g.session,g.request);g.advance(-5);
 assert.equal(g.guard.consume(g.session,g.rpc),null);
});
test("missing lock, remote target, spoofed NPC or player identity fail closed",()=>{
 const cases=[
  f=>f.ship.lockedTargets.clear(),
  f=>{f.ship.position.x=20000},
  f=>{f.ship.nativeNpc=true},
  f=>{f.session.characterID=0},
  f=>{f.session._space.shipID=0},
  f=>{f.target.dungeonMaterializedContainer=false}
 ];
 for(const mutate of cases){const f=fixture();mutate(f);
  assert.notEqual(f.guard.issue(f.session,f.request).status,"ISSUED");}
});
test("data vs relic analyzer type and negative client stats rejected",()=>{
 const f=fixture();
 assert.equal(f.guard.issue(f.session,{...f.request,gameType:0}).status,"ANALYZER_TARGET_KIND_MISMATCH");
 assert.notEqual(f.guard.issue(f.session,{...f.request,difficulty:-1}).status,"ISSUED");
 assert.notEqual(f.guard.issue(f.session,{...f.request,slots:999}).status,"ISSUED");
});
test("physically changing ships, losing lock or target drift blocks completion",()=>{
 for(const mutate of [
  f=>{f.session._space.shipID=666},
  f=>f.ship.lockedTargets.clear(),
  f=>{f.target.position.x=25000},
  f=>{f.ship.pendingWarp={}},
  f=>{f.session.socket.destroyed=true}
 ]){
  const f=fixture();assert.equal(f.guard.issue(f.session,f.request).status,"ISSUED");
  const entry=f.guard.consume(f.session,f.rpc);assert.ok(entry);
  mutate(f);assert.equal(f.guard.validate(f.session,entry),false);
 }
});
const dogmaAnchor="        const hackingMgr = new HackingMgrService();";
const startAnchor="    const nowMs = Date.now();\n    const target = resolveContainerTarget(targetID, session);";
const clickAnchor=`  Handle_ClickedOnTile(args = [], session = null) {
    const [tileCoord] = normalizeCallArgs(args);
    const key = getAttemptKey(session);
    const attempt = ACTIVE_ATTEMPTS.get(key);
    if (!attempt || attempt.completed) {
      emitHackingTurn(session, [buildEvent(HACKING_CONSTANTS.EVENT_ACK, {})]);
      return null;
    }`;
function hackingFixture(){
 return [
 "class HackingMgrService {",
 "  Handle_StartNewGameInstance(args = [], session = null) {",
 "    const [targetID,gameType,moduleTypeID,difficulty,virusInitialCoherence,virusInitialStrength,virusSlots]=normalizeCallArgs(args);",
 startAnchor,
 "    const normalizedDifficulty = Math.max(1,roundNumber(toFiniteNumber(difficulty, 1), 6));",
 "    const attempt = {",
 "      key: getAttemptKey(session),",
 "      targetID: toPositiveInt(targetID, 0),",
 "      gameType: toInt(",
 "        gameType,",
 "        0",
 "      ),",
 "      moduleTypeID: toPositiveInt(moduleTypeID, 0) || null,",
 "      virusCoherence: Math.max(1, toInt(virusInitialCoherence, 200)),",
 "      virusStrength: Math.max(1, toInt(virusInitialStrength, 30)),",
 "      virusSlots: Math.max(0, toInt(virusSlots, 3)),",
 "    };",
 "  }",
 clickAnchor,
 "  }",
 "}"
 ].join("\n");
}
test("source patch is anchored, idempotent and reversible",()=>{
 const dogma="class Dogma {\n  run(session,contextData){\n"+dogmaAnchor+"\n  }\n}";
 const hack=hackingFixture();
 for(const [file,src] of [[DOGMA,dogma],[HACK,hack]]){
  const applied=patch(src,file,false);
  assert.notEqual(applied,src);
  assert.equal(patch(applied,file,false),applied);
  assert.equal(patch(applied,file,true),src);
  assert.equal(patch(src,file,true),src);
  assert.doesNotThrow(()=>new Function(applied));
 }
});
test("all full upstream source hooks parse, if pinned checkout available",()=>{
 const code=process.env.EVEJS_COOP_CODE_PATH;
 if(!code)return;
 for(const file of [DOGMA,HACK]){
  const raw=fs.readFileSync(path.join(code,file),"utf8");
  const changed=patch(raw,file,false);
  assert.doesNotThrow(()=>new Function("require","module","exports",changed));
  assert.equal(patch(changed,file,true),raw);
 }
});
test("installer keeps security feature opt-in and copies server module",()=>{
 const installer=fs.readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 const overlay=fs.readFileSync(new URL("../scripts/overlay-spec.cjs",import.meta.url),"utf8");
 assert.match(installer,/coop-native-hacking-admission-patch\.cjs/);
 assert.match(overlay,/"coopNativeScanProof","coopNativeHackingAdmission"/);
 assert.match(overlay,/server\/src\/services\/dogma\/dogmaService\.js/);
 assert.match(overlay,/server\/src\/services\/exploration\/hackingMgrService\.js/);
});
