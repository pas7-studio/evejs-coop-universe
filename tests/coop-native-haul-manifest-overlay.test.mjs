import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
test("full native cargo manifest is an ordinary L2 module, not a new pinned native patch",()=>{
 const src=read("../scripts/patch-evejs-coop.cjs");
 assert.match(src,/"coopNativeHaulCargo","coopNativeHaulManifest","coopNativeRaids"/);
 assert.match(src,/coop-native-station-arrival-patch\.cjs/);
 assert.doesNotMatch(src,/coop-native-haul-manifest-patch\.cjs/);
});
test("operator has to expressly enable FULL manifest with physical warehouse delivery",()=>{
 const ps=read("../scripts/Deploy-Coop-RuntimeProbe.ps1");
 assert.match(ps,/\[switch\]\$EnableFullHaulManifest/);
 assert.match(ps,/if \(\$EnableFullHaulManifest -and \(-not \$LivingCoop -or -not \$EnableNpcStationDelivery\)\)/);
 const part=ps.match(/if \(\$EnableFullHaulManifest\) \{([\s\S]*?)\}/);
 assert.ok(part);
 assert.match(part[1],/EVEJS_COOP_NATIVE_HAUL_MANIFEST: '1'/);
});
test("pinned physical route uses fsynced full manifest strictly before native warp",()=>{
 const src=read("../integration/coopNativeStationArrival.cjs");
 assert.ok(src.indexOf("manifestDirector.prepare(")<src.indexOf("warpToPoint(id,target"));
 assert.match(src,/manifestProof\?\.status!=="MANIFEST_DURABLY_PREPARED"/);
 assert.match(src,/manifestDirector\.verify\(\{/);
 assert.match(src,/manifestVerified\?\.status!=="FULL_NATIVE_CARGO_DELIVERY_VERIFIED"/);
 assert.match(src,/MANIFEST_NEW_UNDECLARED_CARGO/);
});
test("manifest proof reads authoritative committed warehouse source and every actual itemStore stock item",()=>{
 const src=read("../integration/coopNativeHaulManifest.cjs");
 assert.match(src,/receipt\.phase!=="COMMITTED"/);
 assert.match(src,/store\.listNativeCargoForEntity/);
 assert.match(src,/items\.findWarehouseItem/);
 assert.match(src,/io\.fsyncSync\(fd\)/);
 assert.match(src,/io\.openSync\(manifestPath\(key\),"wx",0o600\)/);
 assert.doesNotMatch(src,/grantUniqueNpcDepotItem|grantItemToOwnerLocation|adjustCharacterBalance|removeNativeCargo/);
});
