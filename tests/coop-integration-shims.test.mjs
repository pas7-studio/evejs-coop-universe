import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {missing,correct}=require("../scripts/coop-integration-shims.cjs");

// integration/*.cjs are the deployed .js modules renamed, so they keep the
// engine's extensionless require("./sibling"). Node never resolves that to a
// .cjs, and a throw inside try/catch turns into a plausible pause status, which
// silently rewrites what a test is actually proving. One shim per required name
// keeps the mirror honest; keep it complete instead of testing around it.
test("every extensionless sibling require has a repo shim",()=>{
 const gap=missing();
 assert.deepEqual(gap,[],`missing shims (run scripts/coop-integration-shims.cjs --write): `+
  gap.map(x=>x.name).join(", "));
});

test("no shim forwards to a different module object than the mirrored source",()=>{
 assert.deepEqual(correct(),[],"a shim must re-export the same .cjs module");
});
