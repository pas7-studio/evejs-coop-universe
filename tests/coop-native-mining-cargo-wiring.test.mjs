import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("native pinned overlay applies only the existing cargo writer patch and supports removal",()=>{
 const overlay=read("scripts/patch-evejs-coop.cjs");
 assert.match(overlay,/coop-native-mining-cargo-integrity-patch\.cjs/);
 assert.match(overlay,/\.patchMiningCargo\(text,remove\)/);
 assert.match(overlay,/endsWith\("miningNpcOperations\.js"\)/);
});
test("strict opt-in cannot override vanilla default and does not add a second value path",()=>{
 const patch=read("scripts/coop-native-mining-cargo-integrity-patch.cjs");
 assert.match(patch,/EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY/);
 assert.match(patch,/nativeNpcStore\.allocateCargoID/);
 assert.match(patch,/ensureNpcCargoStoreEntry\(entity,candidate\)/);
 assert.match(patch,/listNativeCargoForEntity/);
 assert.doesNotMatch(patch,/setInterval|setTimeout|marketDaemon|creditISK|walletGrant|itemStore\.create/);
});
test("source preflight hashes clean upstream blob, parses without executing, restores exact bytes",()=>{
 const preflight=read("scripts/verify-alife-mining-cargo-source.cjs");
 assert.match(preflight,/80e8aa4e43afc4665a2a885d03c2fd81e7171eee/);
 assert.match(preflight,/patchMiningCargo\(patched,true\)!==original/);
 assert.match(preflight,/new Function\("require","module","exports",patched\)/);
 assert.doesNotMatch(preflight,/writeFileSync|fs\.writeFile|execSync|spawnSync|docker/);
});
test("all native allocator, write, restart, downstream and client scenarios remain NOT_RUN",()=>{
 const manifest=JSON.parse(read("tests/scenarios/native-mining-cargo-integrity-e2e.json"));
 assert.equal(manifest.schema,"evejs-coop/native-mining-cargo-integrity-e2e/v1");
 assert.equal(manifest.execution,"DISPOSABLE_LOCAL_ONLY");
 assert.equal(manifest.preserveDockerVolume,"evejs-data");
 assert.equal(manifest.featureFlag,"EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY");
 assert.equal(manifest.scenarios.length,8);
 assert.equal(new Set(manifest.scenarios.map(s=>s.id)).size,8);
 for(const x of manifest.scenarios){
  assert.match(x.id,/^ALIFE-CARGO-00[1-8]$/);
  assert.equal(x.status,"NOT_RUN");
  assert.equal(x.mode,"LOCAL_E2E");
  assert.equal(x.destructive,false);
  assert.ok(x.steps.length>=2&&x.expected.length>=2&&x.requiredEvidence.length>=2);
 }
});
