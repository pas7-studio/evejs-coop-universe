import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {record,authorize,fastFleetBookmarkAccess}=require("../integration/coopNativeScanProof.cjs");
const {patch}=require("../scripts/coop-native-exploration-patch.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const nativePath=process.env.EVEJS_COOP_CODE_PATH||"";

const systemID=30000144;
const now=100000;
const sites=[
 {siteID:71001,targetID:"ABC-001",actualPosition:{x:5,y:2,z:1}},
 {siteID:71002,targetID:"DEF-002",actualPosition:{x:6,y:2,z:1}}
];
function pilot(characterID=101,solarSystemID=systemID){
 return {characterID,_space:{shipID:91000+characterID,systemID:solarSystemID}};
}
function keyVal(id,certainty){
 return {type:"object",name:"util.KeyVal",args:{type:"dict",entries:[
  ["id",id],["certainty",certainty],["pos",{type:"list",items:[12,14,18]}]
 ]}};
}
const scan=(...entries)=>({results:entries});
const origin=(characterID=101,solarSystemID=systemID)=>({characterID,systemID:solarSystemID});

test("perfect native probe result authorizes only scanner's real string or numeric site ID",()=>{
 const a=pilot();
 const out=record({session:a,scanResult:scan(keyVal("ABC-001",1)),origin:origin(),sites,nowMs:now});
 assert.deepEqual(out,{status:"NATIVE_PROBE_SCAN_RECORDED",count:1});
 assert.deepEqual(authorize({session:a,locationID:systemID,resultID:"abc-001",sites,nowMs:now+100}),
  {ok:true,siteID:71001,targetID:"ABC-001"});
 assert.equal(authorize({session:a,locationID:systemID,resultID:71001,sites,nowMs:now+100}).ok,true);
 assert.equal(authorize({session:a,locationID:systemID,resultID:"DEF-002",sites,nowMs:now+100}).ok,false);
 assert.equal(authorize({session:pilot(102),locationID:systemID,resultID:"ABC-001",sites,nowMs:now+100}).ok,false);
 assert.equal(authorize({session:a,locationID:30000142,resultID:"ABC-001",sites,nowMs:now+100}).ok,false);
});

test("incomplete, fake, duplicate or mismatched probe scan results cannot grant exact coordinates",()=>{
 const a=pilot();
 const bad=record({session:a,scanResult:scan(
  keyVal("ABC-001",0.999),keyVal("DEF-002",0.42),
  keyVal("ABC-001",Number.NaN),keyVal("DEF-002",Number.POSITIVE_INFINITY),
  {type:"object",name:"util.KeyVal",args:{type:"dict",entries:[["id","ABC-001"]]}},
  {type:"object",name:"fake",args:{type:"dict",entries:[["id","ABC-001"],["certainty",1]]}}
 ),origin:origin(),sites,nowMs:now});
 assert.equal(bad.count,0);
 assert.equal(authorize({session:a,locationID:systemID,resultID:"ABC-001",sites,nowMs:now}).ok,false);
 const denied=record({session:a,scanResult:scan(keyVal("ABC-001",1)),
  origin:origin(102),sites,nowMs:now});
 assert.equal(denied.status,"INVALID_NATIVE_SCAN_ORIGIN");
 const ambiguous=[...sites,{siteID:80001,targetID:"ABC-001"}];
 record({session:a,scanResult:scan(keyVal("ABC-001",1)),origin:origin(),sites:ambiguous,nowMs:now});
 assert.equal(authorize({session:a,locationID:systemID,resultID:"ABC-001",sites:ambiguous,nowMs:now}).ok,false);
});

test("receipt expires, requires same catalog target and ends on reconnect/system switch",()=>{
 const a=pilot();
 record({session:a,scanResult:scan(keyVal("ABC-001",1)),origin:origin(),sites,nowMs:now});
 assert.equal(authorize({session:a,locationID:systemID,resultID:"ABC-001",sites,
  nowMs:now+15*60*1000-1}).ok,true);
 assert.equal(authorize({session:a,locationID:systemID,resultID:"ABC-001",sites,
  nowMs:now+15*60*1000}).ok,false);
 assert.equal(authorize({session:a,locationID:systemID,resultID:"ABC-001",
  sites:[{...sites[0],targetID:"NEW-001"}],nowMs:now+1}).ok,false);
 assert.equal(authorize({session:pilot(101),locationID:systemID,resultID:"ABC-001",
  sites,nowMs:now+1}).ok,false);
 a._space.systemID=30000142;
 assert.equal(authorize({session:a,locationID:systemID,resultID:"ABC-001",
  sites,nowMs:now+1}).ok,false);
});

test("receipt storage capped; stale and mismatched native origins cannot fill cache",()=>{
 const a=pilot();
 const many=Array.from({length:100},(_,i)=>({siteID:100000+i,targetID:"SIG-"+i}));
 const result=record({session:a,scanResult:scan(...many.map(s=>keyVal(s.targetID,1))),
  origin:origin(),sites:many,nowMs:now});
 assert.equal(result.count,100);
 assert.equal(a._coopNativeScanProof.receipts.length,64);
 assert.equal(authorize({session:a,locationID:systemID,resultID:"SIG-0",sites:many,nowMs:now+1}).ok,false);
 assert.equal(authorize({session:a,locationID:systemID,resultID:"SIG-99",sites:many,nowMs:now+1}).ok,true);
 assert.equal(record({session:a,scanResult:scan(keyVal("ABC-001",1)),origin:origin(101,30000142),
  sites,nowMs:now}).status,"INVALID_NATIVE_SCAN_ORIGIN");
});

test("fresh shared bookmark permits only actual fleet peers with native folder access",()=>{
 const fleet={members:new Map([[101,{}],[102,{}]])};
 const fleets={getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(group,id)=>group.members.get(id)||null};
 const shared={bookmark:{creatorID:101,folderID:2},folder:{isPersonal:false},
  isActive:true,accessLevel:1};
 assert.equal(fastFleetBookmarkAccess({session:pilot(102),bookmarkView:shared,fleetRuntime:fleets}),true);
 assert.equal(fastFleetBookmarkAccess({session:pilot(103),bookmarkView:shared,fleetRuntime:fleets}),false);
 assert.equal(fastFleetBookmarkAccess({session:pilot(102),bookmarkView:{
  ...shared,folder:{isPersonal:true}
 },fleetRuntime:fleets}),false);
 assert.equal(fastFleetBookmarkAccess({session:pilot(102),bookmarkView:{
  ...shared,isActive:false
 },fleetRuntime:fleets}),false);
 fleet.members.delete(101);
 assert.equal(fastFleetBookmarkAccess({session:pilot(102),bookmarkView:shared,fleetRuntime:fleets}),false);
});

test("exact pinned EveJS explorer source is reversible with existing fleet overlay",t=>{
 if(!nativePath){t.skip("Set EVEJS_COOP_CODE_PATH to pinned Code");return;}
 for(const file of [
  "server/src/services/exploration/scanMgrService.js",
  "server/src/services/ship/beyonceService.js"
 ]){
  const spec=specs.find(s=>s.file===file);
  assert.ok(spec,"Missing transactional overlay spec for "+file);
  const local=fs.readFileSync(path.join(nativePath,file),"utf8");
  const pristine=transform(local,spec,true);
  const applied=transform(pristine,spec,false);
  assert.notEqual(pristine,applied);
  assert.equal(transform(applied,spec,false),applied,"reapply "+file);
  assert.equal(transform(applied,spec,true),pristine,"rollback "+file);
  assert.equal(patch(patch(pristine,file),file,true),pristine);
  new vm.Script(applied,{filename:file});
 }
});
test("stock scanner proof is written ONLY after completed RequestScans notification",t=>{
 if(!nativePath){t.skip("Set EVEJS_COOP_CODE_PATH to pinned Code");return;}
 const file="server/src/services/exploration/scanMgrService.js";
 const spec=specs.find(s=>s.file===file);
 const src=transform(fs.readFileSync(path.join(nativePath,file),"utf8"),spec,false);
 const before=src.indexOf("function emitProbeScanStoppedNotification(");
 const delivered=src.indexOf('session.sendNotification("OnSystemScanStopped"',before);
 const noted=src.indexOf('require("../../space/coopNativeScanProof").record(',delivered);
 const end=src.indexOf("function clearPendingProbeScanStop(",before);
 assert.ok(before>=0&&before<delivered&&delivered<noted&&noted<end);
 const nativeRequest=src.indexOf("const startResolvedScan = () => {");
 const originTag=src.indexOf('_coopNativeProbeOrigin",{',nativeRequest);
 const delivery=src.indexOf("emitProbeScanLifecycleNotifications(session, scanResult",nativeRequest);
 assert.ok(nativeRequest>0&&originTag>nativeRequest&&originTag<delivery);
 assert.match(src.slice(nativeRequest,delivery),/EVEJS_COOP_EXPEDITION_SCAN_PROOF/);
});
