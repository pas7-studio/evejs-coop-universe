import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,"..");
const require=createRequire(import.meta.url);
const {check,classifyFile,transform,strip,specs,PIN}=require("../scripts/patch-evejs-coop.cjs");

// A synthetic source reusing a real hook line, so it exercises the same
// strip()/anchor machinery as the pinned overlay without a checkout.
const realPatch=specs.flatMap(spec=>spec.patches).find(patch=>patch.after===true);
const synthetic={file:"server/src/space/synthetic.js",patches:[realPatch]};
const anchorLine=realPatch.anchor.split("\n").pop();
const pristineText=["function run(){",anchorLine,"  return true;","}",""].join("\n");
const patchedText=["function run(){",anchorLine,realPatch.line,"  return true;","}",""].join("\n");

test("classifyFile distinguishes pristine, patched and unknown native sources",()=>{
 assert.equal(classifyFile(pristineText,synthetic),"PRISTINE");
 assert.equal(classifyFile(patchedText,synthetic),"PATCHED");
 assert.equal(classifyFile("function run(){\n  const other = compute();\n}\n",synthetic),"ANCHOR_MISMATCH");
 assert.equal(classifyFile("function run(){\n"+anchorLine+"\n"+anchorLine+"\n}\n",synthetic),"ANCHOR_MISMATCH");
});

test("classifyFile reports DRIFTED when a hand edit accompanies the hook",()=>{
 const tampered=patchedText.replace(realPatch.line,realPatch.line+" // hand edited");
 assert.notEqual(tampered,patchedText);
 assert.equal(classifyFile(tampered,synthetic),"DRIFTED");
});

test("every injected hook line is strippable, so --remove stays byte-exact",()=>{
 for(const spec of specs)for(const patch of spec.patches){
  assert.ok(patch.line.trim().length>0,spec.file+" has an empty hook line");
  assert.equal(strip(patch.line),"",spec.file+" hook line missing from oldLines: "+patch.line.slice(0,80));
 }
});

test("patching is idempotent on a synthetic source",()=>{
 const once=transform(pristineText,synthetic,false);
 assert.equal(once,patchedText);
 assert.equal(transform(once,synthetic,false),once);
 assert.equal(transform(once,synthetic,true),pristineText);
});

test("pinned upstream revision is documented in the provenance register",()=>{
 const register=fs.readFileSync(path.join(project,"docs","UPSTREAM.md"),"utf8");
 assert.match(PIN,/^[0-9a-f]{40}$/,"PIN must be a full commit SHA");
 assert.ok(register.includes(PIN),"docs/UPSTREAM.md must record the current pin "+PIN);
});

test("--check reports overlay state without writing to the checkout",t=>{
 const native=process.env.EVEJS_COOP_CODE_PATH;
 if(!native){t.skip("Set EVEJS_COOP_CODE_PATH to a pinned EveJS Code checkout");return;}
 const before=fs.readFileSync(path.join(native,specs[0].file),"utf8");
 const result=check({codePath:native});
 assert.ok(["OVERLAY_OK","OVERLAY_DRIFT","WRONG_PIN"].includes(result.status),result.status);
 assert.equal(result.pin,PIN);
 assert.equal(result.files.length,specs.length);
 assert.equal(result.counts.moduleCurrent+result.counts.moduleStale+result.counts.moduleMissing,result.modules.length);
 assert.equal(result.problems.length,0,JSON.stringify(result.problems.slice(0,5)));
 assert.equal(fs.readFileSync(path.join(native,specs[0].file),"utf8"),before,"--check must be read-only");
});
