import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const gate=require("../scripts/lw04d-native-readiness.cjs");
test("source is default mode and cannot implicitly select a financial live run",()=>{
 assert.deepEqual(gate.parse([]),{mode:"source"});
 assert.equal(gate.parse(["--source"]).mode,"source");
 assert.equal(gate.parse(["--native-preflight"]).mode,"native-preflight");
 assert.equal(gate.main(["--help"]).realNativeE2E,false);
});
test("only explicit documented read-only options are allowed",()=>{
 assert.throws(()=>gate.parse(["--finance-act"]),/LW04D_UNKNOWN_ARGUMENT/);
 assert.throws(()=>gate.parse(["--native-preflight","--upstream"]),/OPTION_VALUE_MISSING/);
 assert.throws(()=>gate.parse(["--rust-source","--unsafe"]),/OPTION_VALUE_MISSING/);
});
test("original pinned commit and RPC source inventory is explicit",()=>{
 assert.equal(gate.PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 assert.ok(gate.RUST.includes("ClaimNpcSellOrder"));
 assert.ok(gate.RUST.includes("FinalizeNpcSellOrder"));
 assert.ok(gate.RUST.includes("ReserveNpcSellOrder"));
 assert.equal(gate.OVERLAY.filter(x=>x==="coopLivingWorldNativeChainProof").length,1);
});
test("relative or absent upstream cannot accidentally open production game data",()=>{
 assert.throws(()=>gate.preflight({}),/EXPLICIT_ABSOLUTE/);
 assert.throws(()=>gate.preflight({upstream:"./evejs",rustSource:"./evejs/rust"}),/EXPLICIT_ABSOLUTE/);
});
test("Rust source preflight detects all six exact seller RPC symbols",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lw04d-rust-source-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,"nativeMarket.rs"),
  gate.RUST.map(x=>"fn "+x+"() {}").join("\n"));
 const result=gate.scanRust(dir);
 assert.equal(result.files,1);assert.deepEqual(result.found,gate.RUST);
 assert.deepEqual(result.missing,[]);
});
test("incomplete Rust market cannot be considered integrated",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lw04d-rust-missing-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,"nativeMarket.rs"),"fn GetNpcSellOrder() {}");
 assert.equal(gate.scanRust(dir).missing.length,gate.RUST.length-1);
});
test("Rust scan rejects symlinked or unbounded source trees",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lw04d-rust-link-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,"nativeMarket.rs"),"fn ClaimNpcSellOrder() {}");
 fs.writeFileSync(path.join(dir,"other.rs"),"fn FinalizeNpcSellOrder() {}");
 assert.throws(()=>gate.scanRust(dir,1),/RUST_SCAN_BUDGET_EXCEEDED/);
});
test("readiness report never claims native SQLite or two-client PASS",()=>{
 const out=gate.main(["--help"]);
 assert.equal(out.noMutation,true);
 assert.equal(out.realNativeE2E,false);
 assert.equal(gate.TESTS.some(n=>n.includes("original-native-chain-proof")),true);
});
