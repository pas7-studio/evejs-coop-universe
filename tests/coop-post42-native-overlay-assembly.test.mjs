import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(import.meta.url);
const installer=require("../scripts/patch-evejs-coop.cjs");
const nativeModules=[
 "coopCloneNativeGuard","coopCloneNativeReceipts",
 "coopPlayerIndustryGuard","coopPlayerIndustryReceipts"
];

test("native installer copies every delivered coop source exactly once",()=>{
 const bundled=fs.readdirSync(path.join(root,"integration"))
  .filter(n=>/^coop[A-Za-z0-9]+\\.cjs$/.test(n))
  .map(n=>n.slice(0,-4)).sort();
 assert.equal(new Set(installer.names).size,installer.names.length);
 assert.deepEqual(installer.names.slice().sort(),bundled);
});

test("native clone and industry receipts load both source CJS and deployed JS siblings",t=>{
 assert.equal(typeof require("../integration/coopCloneNativeReceipts.cjs").createCloneReceipts,"function");
 assert.equal(typeof require("../integration/coopPlayerIndustryReceipts.cjs").makePlayerIndustryReceipts,"function");
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"coop-native-overlay-assembly-"));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 for(const name of nativeModules)fs.copyFileSync(
  path.join(root,"integration",name+".cjs"),path.join(tmp,name+".js"));
 const load=createRequire(path.join(tmp,"native-bootstrap.js"));
 assert.equal(typeof load("./coopCloneNativeReceipts.js").createCloneReceipts,"function");
 assert.equal(typeof load("./coopPlayerIndustryReceipts.js").makePlayerIndustryReceipts,"function");
 assert.equal(fs.existsSync(path.join(tmp,"coopCloneNativeGuard.cjs")),false);
 assert.equal(fs.existsSync(path.join(tmp,"coopPlayerIndustryGuard.cjs")),false);
});

test("remote CI remains absent: manual/local tests only",()=>{
 const workflows=path.join(root,".github","workflows");
 assert.deepEqual(fs.existsSync(workflows)?fs.readdirSync(workflows):[],[]);
});
