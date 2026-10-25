import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
const require=createRequire(import.meta.url);
const installer=require("../scripts/patch-evejs-coop.cjs");
const nativeFile="server/src/services/market/marketProxyService.js";
test("P0 combined installer preserves stock EveJS trading, custody and dialogue while adding the market",()=>{
 assert.equal(installer.PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 const names=installer.specs.map(x=>x.file);
 assert.ok(names.includes(nativeFile));
 assert.ok(names.includes("server/src/services/trade/tradeMgrService.js"));
 assert.ok(names.includes("server/src/services/inventory/itemStore.js"));
 const source=readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 for(const hook of ["coop-market-catalog-patch.cjs","coop-atomic-trade-patch.cjs",
  "coop-native-trade-custody-patch.cjs","coop-agent-dialogue-patch.cjs"])
  assert.ok(source.includes(hook),"latest main hook overwritten: "+hook);
 for(const module of ["coopMarketCatalog","coopNativeTradeAtomic","coopNativeTradeCustody","coopAgentDialogue"])
  assert.ok(source.includes('"'+module+'"'),"latest overlay module overwritten: "+module);
});
test("P0 catalog and SQLite stock import are independently default-OFF",()=>{
 const ps=readFileSync(new URL("../scripts/Deploy-Coop-RuntimeProbe.ps1",import.meta.url),"utf8");
 assert.match(ps,/\[switch\]\$EnableMarketCatalog/);
 assert.match(ps,/if \(\$EnableMarketCatalog -and -not \$LivingCoop\)/);
 assert.match(ps,/if \(\$EnableMarketCatalog\)/);
 assert.match(ps,/EVEJS_COOP_MARKET_CATALOG: '1'/);
 assert.match(ps,/EVEJS_COOP_NPC_CHATTER: '1'/);
 assert.match(ps,/EVEJS_COOP_ATOMIC_TRADE: '1'/);
 const seed=readFileSync(new URL("../scripts/coop-market-additive-seed.cjs",import.meta.url),"utf8");
 assert.match(seed,/EVEJS_COOP_MARKET_OFFLINE_LOCK_HELD/);
 assert.match(seed,/IMPORT_MANIFEST_WITH_BACKUP/);
 assert.doesNotMatch(seed,/market-tools rebuild/);
});
test("P0 exact-station operator inspection is read-only, no Docker restart or external upload",()=>{
 const ps=readFileSync(new URL("../scripts/Inspect-Coop-MarketStation.ps1",import.meta.url),"utf8");
 assert.match(ps,/query_only|READ-ONLY/);
 assert.match(ps,/docker compose -f \$compose exec -T server node -e/);
 assert.match(ps,/StationID=0/);
 const invocations=ps.split(/\r?\n/).filter(x=>/^\s*&\s+docker\s+compose\b/.test(x));
 assert.equal(invocations.length,1);
 assert.doesNotMatch(invocations[0],/\b(?:stop|down|restart|up|rebuild)\b/);
});
const codePath=process.env.EVEJS_COOP_CODE_PATH||"";
test("P0 full integrated native catalog transform applies idempotently and reverses byte-exact on pinned source",
 {skip:!codePath||!existsSync(path.join(codePath,nativeFile))},()=>{
  const source=readFileSync(path.join(codePath,nativeFile),"utf8");
  const spec=installer.specs.find(x=>x.file===nativeFile);
  const patched=installer.transform(source,spec,false);
  assert.notEqual(patched,source);
  assert.equal(installer.transform(patched,spec,false),patched);
  assert.equal(installer.transform(patched,spec,true),source);
 });
