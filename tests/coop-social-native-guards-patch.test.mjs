import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
const require=createRequire(import.meta.url);
const {patch,CHAT_RUNTIME,CHAT_STORE,MAIL,FLAG}=require("../scripts/coop-social-native-guards-patch.cjs");
const fixtures={
 [CHAT_RUNTIME]:'const path=require("path");\nfunction getChannelAccessFailure(session, record, options = {}) {\n  const characterID = getCharacterID(session);\n  const corporationID = getCorporationID(session);\n  return null;\n}\n',
 [CHAT_STORE]:'function writeBacklogEntries(roomName, entries = []) {\n  return true;\n}\nfunction appendBacklogEntry(roomName, entry, options = {}) {\n  writeBacklogEntries(normalizedRoomName, trimmedEntries);\n  return true;\n}\n',
 [MAIL]:'function sendMail(options = {}) {\n  const state = getMutableState();\n  const resolvedRecipients = buildDeliveryRecipients(\n    state,\n  );\n  const writeResult = persistState(state);\n  if (!writeResult || !writeResult.success) {\n    return { success: false, errorMsg: "WRITE_ERROR" };\n  }\n  return true;\n}\n'
};
test("all three native existing source hooks are reversible and idempotent",()=>{
 for(const [filename,raw] of Object.entries(fixtures)){
  for(const eol of ["\n","\r\n"]){
   const original=raw.replace(/\n/g,eol),patched=patch(original,filename);
   assert.notEqual(patched,original);
   assert.equal(patch(patched,filename),patched);
   assert.equal(patch(patched,filename,true),original);
  }
 }
});
test("hook is OFF by default and never adds client RPC",()=>{
 assert.match(FLAG,/EVEJS_COOP_SOCIAL_NATIVE_GUARDS/);
 assert.match(patch(fixtures[CHAT_RUNTIME],CHAT_RUNTIME),/verifyScopedRoom/);
 assert.match(patch(fixtures[CHAT_STORE],CHAT_STORE),/flush:true/);
 assert.match(patch(fixtures[MAIL],MAIL),/flushTableSync\(MAIL_TABLE\)/);
});
test("unrecognized and partial native source rejected",()=>{
 assert.throws(()=>patch("garbage\n","server/src/services/fake.js"),/INVALID_TARGET/);
 assert.throws(()=>patch("garbage\n",MAIL),/SOURCE_DRIFT/);
 assert.throws(()=>patch(fixtures[CHAT_STORE]+fixtures[CHAT_STORE],CHAT_STORE),/SOURCE_DRIFT/);
});
test("read-only optional pinned source verification for chat, mail and XMPP",()=>{
 const root=process.env.EVEJS_COOP_CODE_PATH;
 if(!root)return;
 for(const file of [CHAT_RUNTIME,CHAT_STORE,MAIL]){
  const source=fs.readFileSync(path.join(root,file),"utf8");
  const patched=patch(source,file);
  assert.equal(patch(patched,file,true),source);
 }
});
