import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,"..");
const require=createRequire(import.meta.url);
const state=require("../scripts/coop-state.cjs");

const fakeState={
 updatedAt:"2026-10-25T12:00:00.000Z",
 runId:"20261025-120000",
 projectRev:"1d71e7f0000000000000000000000000000000000",
 upstreamPin:"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f",
 note:"started LivingCoop on Perimeter",
 next:"run the World gate on 30000144",
 tests:{status:"BASELINE_MATCH",totals:{files:78,pass:518,fail:0,skipped:16,crashed:0},newFailures:[]},
 overlay:{status:"OVERLAY_OK",counts:{pristine:0,patched:19,anchorMismatch:0,moduleCurrent:59,moduleStale:0,moduleMissing:0},problems:[]},
 server:{rows:42,firstAt:"2026-10-25T11:00:00Z",lastAt:"2026-10-25T11:59:00Z",types:{"living-headless-boot-requested":1,"living-native-mining-startup-slot":41},truncatedTypes:0,error:null},
 client:[{name:"20261025_113000_123.txt",bytes:2048,lines:120,tail:["undock: Ok","warp: Perimeter"]}],
 gates:{telemetry:"PASS (boot event)",world:"not-run",client:"BLOCKED_CLIENT_UNAVAILABLE",party:"not-run"}
};

test("redaction removes personal paths, public IPs, tokens and pilot names",()=>{
 const raw="C:\\Users\\nazarpes7\\AppData pilot=Kadet Nazar ip=192.168.1.44 token="+"A".repeat(48)+" local=127.0.0.1:26000";
 const clean=state.redact(raw,["Kadet Nazar"]);
 assert.ok(!clean.includes("nazarpes7"),clean);
 assert.ok(!clean.includes("192.168.1.44"),clean);
 assert.ok(!clean.includes("A".repeat(48)),clean);
 assert.ok(clean.includes("PILOT_A"),clean);
 assert.ok(clean.includes("127.0.0.1"),"loopback stays readable");
 assert.deepEqual(state.leaks(clean),[]);
 assert.ok(state.leaks(raw).length>=3);
});

test("server events are summarized, never copied",()=>{
 const rows=[];
 for(let i=0;i<40;i++)rows.push({event:i%2?"mining":"warp",at:"2026-10-25T10:0"+(i%10)+":00Z"});
 const summary=state.summarizeEvents(rows);
 assert.equal(summary.rows,40);
 assert.equal(summary.types.mining,20);
 assert.ok(summary.firstAt<=summary.lastAt);
 assert.ok(!JSON.stringify(summary).includes("2026-10-25T10:00:00Z\"}"),"no raw rows");
 const many=state.summarizeEvents(Array.from({length:30},(_,i)=>({event:"e"+i})));
 assert.equal(Object.keys(many.types).length,state.budgets.eventTypes);
 assert.equal(many.truncatedTypes,30-state.budgets.eventTypes);
});

test("client logs keep only a short redacted tail",()=>{
 const lines=Array.from({length:100},(_,i)=>i%2?"undock ok":"boring line "+i);
 lines.push("pilot Nazar docked at Perimeter IX");
 const out=state.summarizeClientLogs([{name:"20261025.txt",bytes:10,lines:101,lines_sample:lines}],["Nazar"]);
 assert.equal(out.length,1);
 assert.ok(out[0].tail.length<=state.budgets.clientTailLines);
 assert.ok(out[0].tail.length>0,"a filtered tail must not be empty when matching lines exist");
 assert.ok(out[0].tail.every(line=>/undock|dock|warp|target|module|damage|destroyed|wreck|loot|cargo|ore|fleet|disconnect|reconnect|error|exception|\((error|warning|question)\)/i.test(line)));
 assert.ok(!JSON.stringify(out).includes("Nazar"));
});

test("localized client action lines are recognized",()=>{
 const out=state.summarizeClientLogs([{name:"x.txt",lines_sample:[
  "[ 2026.10.25 12:59:15 ] (None) Выход из дока <localized hint=\"Manifest\">",
  "[ 2026.10.25 12:57:15 ] Сеанс начат"
 ]}]);
 assert.equal(out[0].tail.length,1,"only the action line is kept");
 assert.match(out[0].tail[0],/Выход из дока/);
});

test("real gamelog headers never leak the pilot name or character id",()=>{
 const lines=[
  "------------------------------------------------------------",
  "  Gamelog",
  "  Listener: Sasunok1488",
  "  Session Started: 2026.10.25 12:45:43",
  "[ 2026.10.25 12:48:52 ] (question) All your choices will be lost.",
  "[ 2026.10.25 12:59:15 ] (warning) Elevated roles detected."
 ];
 const out=state.summarizeClientLogs([{name:"20261025_124543_140000005.txt",bytes:688,lines:6,lines_sample:lines}]);
 const text=JSON.stringify(out);
 assert.ok(!text.includes("Sasunok1488"),text);
 assert.ok(!text.includes("140000005"),"character id must be masked");
 assert.match(out[0].name,/20261025_124543_<charid>\.txt/);
 assert.ok(out[0].tail.length>=2,"dialog lines are kept as evidence");
 assert.deepEqual(state.leaks(text),[]);
 assert.ok(state.leaks("  Listener: Sasunok1488").includes("pilot-name"));
});

test("roadmap parsing stays in sync with the ledger",()=>{
 const roadmap=fs.readFileSync(path.join(project,"docs","ROADMAP.md"),"utf8");
 const tasks=state.parseRoadmap(roadmap);
 assert.ok(tasks.length>=12,"expected the full task list");
 assert.ok(tasks.some(t=>t.id==="COOP-023"),"the current task must be present");
 assert.equal(tasks.length,new Set(tasks.map(t=>t.id)).size,"duplicate roadmap ids");
 assert.ok(tasks.every(t=>t.id.startsWith("COOP-")&&t.status.length>0));
 const ledger=state.buildLedger(roadmap);
 assert.deepEqual(ledger.tasks.map(t=>t.id),tasks.map(t=>t.id));
 assert.ok(ledger.tasks.find(t=>t.id==="COOP-010").evidence.length>=1,"evidence is linked");
});

test("NOW.md and digests respect the token budget",()=>{
 const now=state.renderNow(fakeState);
 const digest=state.renderDigest(fakeState);
 assert.ok(now.split("\n").length<=state.budgets.nowLines,now.split("\n").length+" lines");
 assert.ok(Buffer.byteLength(now)<=state.budgets.nowBytes);
 assert.ok(digest.split("\n").length<=state.budgets.digestLines);
 assert.ok(Buffer.byteLength(digest)<=state.budgets.digestBytes);
 assert.match(now,/## NEXT/);
 assert.match(now,/run the World gate/);
 assert.deepEqual(state.leaks(now),[]);
});

test("published bundle on disk is complete and leak-free",()=>{
 const nowFile=path.join(project,"state","NOW.md");
 assert.ok(fs.existsSync(nowFile),"state/NOW.md must be committed for cloud sessions");
 const now=fs.readFileSync(nowFile,"utf8");
 assert.deepEqual(state.leaks(now),[]);
 assert.match(now,/# COOP STATE/);
 const status=JSON.parse(fs.readFileSync(path.join(project,"state","status.json"),"utf8"));
 assert.ok(status.projectRev&&status.upstreamPin&&status.runId);
 const ledger=JSON.parse(fs.readFileSync(path.join(project,"state","ledger.json"),"utf8"));
 assert.ok(ledger.tasks.length>=12);
 const report=state.verify();
 const hard=report.problems.filter(p=>!/STATE_STALE/.test(p));
 assert.deepEqual(hard,[],JSON.stringify(report.problems));
});

test("state is fresh as long as only state/ changed after publishing",()=>{
 const rev=state.changedSince("HEAD");
 assert.ok(rev!==null);
 assert.ok(Array.isArray(rev));
 assert.ok(!rev.some(file=>file.startsWith("state/")),"state/ must never count as staleness");
});
