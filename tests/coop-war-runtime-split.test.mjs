import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const ROOT=path.join(import.meta.dirname,"..");

// The faction-war half of coopVirtualWorldRuntime.js moved into its own module on
// 2026-11-04 (docs/FORK_PATCH_AUDIT_20261028.md: one file above the budget cannot be
// tested or edited safely). The 2026-10-28 split of the same file broke the live stack
// with `ReferenceError: warpPointDirector is not defined`: moved code referenced state
// that stayed behind, and nothing caught it until a real phase ran. These guards are
// that missing net, and they cost nothing:
//
//  1. every singleton the war phases mutate is declared in ONE file,
//  2. nothing the slice needs from the parent is read as a free variable,
//  3. calling every export with stubs raises no ReferenceError.
const warFile="integration/coopVirtualWorldRuntime.war.cjs";
const parentFile="integration/coopVirtualWorldRuntime.cjs";
const warSource=fs.readFileSync(path.join(ROOT,warFile),"utf8");
const parentSource=fs.readFileSync(path.join(ROOT,parentFile),"utf8");
const {createWarRuntime}=require(path.join(ROOT,warFile));

const OWNED_STATE=["warMirrorInstance","WAR_MIRROR_FILE","warChestInstance","warNavyCapabilityInstance",
 "warMeritLedger","warMercenarySettlementInstance","warMobilizer","warGarrison","warBattleDirector",
 "warEngagement","warPosture","warGateStaging","warGateHandoff","warDemobilizer","warObjectiveDirector",
 "warOpening","warRelief","warDoctrineInstance","warSovProjection","warOpeningTicks","warGarrisonTicks",
 "casualtySeedDone","memoCache","gateStagingSkipKey","followOrderReason"];

test("the war singletons have exactly one owner",()=>{
 for(const name of OWNED_STATE){
  assert.match(warSource,new RegExp(`(?:let|const|var)[^;]*\\b${name}\\s*=`,"s"),`${name} is declared in the war module`);
  assert.doesNotMatch(parentSource,new RegExp(`^let [^\\n]*\\b${name}\\b`,"m"),
   `${name} must not also be declared by the parent: two copies of one state is what broke the 2026-10-28 split`);
 }
});

test("the slice reads the parent's handles through getters, never free variables",()=>{
 for(const [bare,getter] of [["world","getWorld()"],["identityRegistry","getIdentityRegistry()"],
  ["tacticsDirector","getTacticsDirector()"],["nativeAmmoSupply","getNativeAmmoSupply()"],
  ["warCasualtyLedger","getCasualtyLedger()"]]){
  const codeLines=warSource.split("\n").filter((line)=>!line.trim().startsWith("//"));
  const free=codeLines.filter((line)=>new RegExp(`(?<![.\\w$])${bare}\\b(?!\\s*:)`).test(line));
  assert.deepEqual(free,[],`${bare} must be read as ${getter}`);
 }
});

test("every war export survives a call with stubs without a free variable",()=>{
 const world={snapshot:()=>({pilots:[],ships:[],systems:[],tick:0}),getEntityByID:()=>null};
 const runtime=createWarRuntime({
  getWorld:()=>world,getIdentityRegistry:()=>null,getTacticsDirector:()=>null,
  getNativeAmmoSupply:()=>null,getCasualtyLedger:()=>null,
  bootstrapTerritoriesFromPresence:()=>null,npcOrderBridge:()=>null,ensureMarketTrader:()=>null});
 const exports=Object.keys(runtime).filter((name)=>typeof runtime[name]==="function");
 assert.ok(exports.length>=45,`the war runtime exports its whole surface (got ${exports.length})`);
 const shapes=[[],[0],[null],["x"],[{}],[1,2],[[],{}],[{systemIDs:[]}]];
 const failures=[];
 for(const name of exports)for(const args of shapes){
  try{runtime[name](...args)}catch(error){
   if(error instanceof ReferenceError)failures.push(`${name}(${args.length} args): ${error.message}`);
  }
 }
 assert.deepEqual([...new Set(failures)],[], "moved code must not reference a name it cannot see");
});
