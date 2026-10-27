import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const ROOT=path.join(import.meta.dirname,"..");
const require=createRequire(import.meta.url);
const {SEP,cachePath,readRow}=require("../integration/coopNativeRowPath.cjs");

// A row written through coopAtomicNativeRows is nested in the GameStore JSON
// cache at the \u001f separator, while the SQLite key is one flat string. The
// live probe proved gameStore.read(TABLE,"/"+KEY) answers ENTRY_NOT_FOUND for a
// row that really exists, which silently disabled the whole war battle leg.
// This fake store reproduces that exact shape.
function nestedStore(rows){
 return {read(table,pathKey){
  if(table!=="corporationRuntime")return {success:false,errorMsg:"TABLE_NOT_FOUND",data:null};
  const segments=String(pathKey||"/").split("/").filter(Boolean);
  let current=rows;
  for(const segment of segments){
   if(current===null||typeof current!=="object"||!(segment in current))
    return {success:false,errorMsg:"ENTRY_NOT_FOUND",data:null};
   current=current[segment];
  }
  return {success:true,errorMsg:null,data:current};
 }};
}
const KEY="coop-faction-war"+SEP+"state-v1";
const ROW={version:1,wars:{},campaigns:{}};
const nested=nestedStore({"coop-faction-war":{"state-v1":ROW}});
const flat=nestedStore({[KEY]:ROW});

test("the cache path converts the separator instead of keeping it raw",()=>{
 assert.equal(cachePath(KEY),"/coop-faction-war/state-v1");
 assert.equal(cachePath("coop-faction-war"),"/coop-faction-war");
 assert.throws(()=>cachePath(""),/NATIVE_ROW_KEY_REQUIRED/);
 assert.throws(()=>cachePath(null),/NATIVE_ROW_KEY_REQUIRED/);
});

test("the raw key really is invisible in the nested cache",()=>{
 assert.equal(nested.read("corporationRuntime","/"+KEY).success,false);
});

test("readRow finds the nested row the raw key cannot see",()=>{
 assert.deepEqual(readRow(nested,"corporationRuntime",KEY),ROW);
});

test("readRow still reads a legacy flat row",()=>{
 assert.deepEqual(readRow(flat,"corporationRuntime",KEY),ROW);
});

test("a missing row is null, a corrupt row throws",()=>{
 assert.equal(readRow(nested,"corporationRuntime","coop-faction-war"+SEP+"absent"),null);
 assert.throws(()=>readRow(nested,"corporationRuntime",KEY,()=>{throw Error("CORRUPT")}),/CORRUPT/);
 assert.equal(readRow(null,"corporationRuntime",KEY),null);
});

test("the war consumers read through the shared conversion",()=>{
 const files={
  "coopWarCombatAuthority.cjs":[/const \{readRow\}=moduleName\("coopNativeRowPath"\)/,
   /const a=readRow\(gameStore,war\.TABLE,war\.KEY\)/],
  "coopWarFleetRegistry.cjs":[/readRow\(gameStore,TABLE,KEY\)/],
  "coopWarTransferLedger.cjs":[/readRow\(gameStore,fleet\.TABLE,fleet\.KEY\)/],
  "coopVirtualWorldRuntime.cjs":[/nativeRows\.readRow\(gameStore,table,key,validate\)/],
 };
 for(const [file,patterns] of Object.entries(files)){
  const source=fs.readFileSync(path.join(ROOT,"integration",file),"utf8");
  for(const pattern of patterns) assert.match(source,pattern,file+" must use the shared reader");
  assert.ok(!source.includes('gameStore.read(war.TABLE,"/"+war.KEY)'),file+" must not read a war row by raw key");
 }
});

test("the new module is deployed by the overlay spec",()=>{
 const spec=fs.readFileSync(path.join(ROOT,"scripts","overlay-spec.cjs"),"utf8");
 assert.match(spec,/names\.splice\(names\.indexOf\("coopFactionWarCore"\)\+1,0,"coopNativeRowPath"\)/);
});
