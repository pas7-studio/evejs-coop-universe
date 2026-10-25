import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {transform,specs}=require("../scripts/patch-evejs-coop.cjs");
const {render,applyToTuple,enter}=require("../integration/coopAgentDialogue.cjs");

const code=process.env.EVEJS_COOP_CODE_PATH;
const FILE="server/src/services/agent/agentMgrService.js";
const spec=specs.find(entry=>entry.file===FILE);
const readPinned=()=>fs.readFileSync(path.join(code,FILE),"utf8");
const count=(text,part)=>text.split(part).length-1;

test("the agent dialogue hooks apply twice as a no-op and reverse byte-for-byte",{skip:!code},()=>{
 const {patch}=require("../scripts/coop-agent-dialogue-patch.cjs");
 const pristine=patch(readPinned(),{remove:true});
 const once=patch(pristine);
 assert.notEqual(once,pristine,"the hooks must actually be inserted");
 assert.equal(patch(once),once,"second apply must change nothing");
 assert.equal(patch(once,{remove:true}),pristine,"remove must restore the source exactly");
 new vm.Script(once,{filename:FILE});
});

test("both hooks are installed once and stay env-gated and default OFF",{skip:!code},()=>{
 const patched=transform(readPinned(),spec,false);
 assert.equal(count(patched,'require("../space/coopAgentDialogue").enter(session)'),1);
 assert.equal(count(patched,'require("../space/coopAgentDialogue").applyToTuple(agentSays)'),1);
 assert.equal(count(patched,'process.env.EVEJS_COOP_AGENT_DIALOGUE === "1"'),2);
 assert.ok(!patched.includes("EVEJS_COOP_AGENT_DIALOGUE = "),"the flag is read, never assigned");
 assert.equal(count(patched,"function buildDoActionResponsePayload(result) {"),1,
  "the upstream signature stays untouched so other call sites keep working");
});

test("the installed module is shipped by the installer, not hand-copied",()=>{
 const script=fs.readFileSync(path.join(import.meta.dirname,"..","scripts","patch-evejs-coop.cjs"),"utf8");
 // The installer ships a long names array; assert membership, not position.
 assert.match(script,/const names=\[[^\]]*"coopAgentDialogue"/);
 assert.match(script,/coop-agent-dialogue-patch\.cjs"\)\.patch\(text,\{remove\}\)/);
});

test("a real DoAction tuple keeps the pilot name and stays reversible",()=>{
 const authored="Good of you to stop by, {[character]player.name}! I have work for you.";
 const tuple={type:"tuple",items:[authored,null]};
 enter({characterID:140000008,characterName:"Antaken Kamola"});
 const out=applyToTuple(tuple);
 assert.equal(out.items[0],"Good of you to stop by, Antaken Kamola! I have work for you.");
 assert.equal(out.items[1],null,"the mission content id must not be touched");
 assert.equal(render(out.items[0],null),out.items[0],"rendered text stays stable");
});
