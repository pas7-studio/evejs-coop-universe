import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,file,NEW}=require("../scripts/coop-npc-market-fills-table-patch.cjs");

const base="const SQLITE_TABLES = new Set([\n  \"characters\",\n  \"items\",\n  \"marketEscrow\",\n]);\n";
for(const eol of ["LF","CRLF"]){
 test("native market fill receipts register in pinned SQLite allowlist, reversible "+eol,()=>{
  const before=eol==="LF"?base:base.replace(/\n/g,"\r\n");
  const added=patch(before,file);
  assert.match(added,/"npcMarketFills", \/\/ COOP-035 durable NPC buy idempotency receipts/);
  assert.equal(added,patch(added,file));
  assert.equal(before,patch(added,file,true));
  assert.equal(before,patch(before,file,true));
 });
}
test("does not change unrelated GameStore source",()=>{
 assert.equal(patch(base,"server/src/services/market/marketProxyService.js"),base);
});
test("refuses unknown upstream SQLite table registry",()=>{
 assert.throws(()=>patch('const TABLES = ["marketEscrow"]',file),/MISSING_SQLITE_TABLES/);
});
test("refuses an existing unrecognized competing receipt table",()=>{
 const drift=base.replace('  "marketEscrow",','  "marketEscrow",\n  "npcMarketFills",');
 assert.throws(()=>patch(drift,file),/SQLITE_DRIFT/);
});
test("database table is registered after actual stock marketEscrow table",()=>{
 const added=patch(base,file);
 assert.ok(added.indexOf('"npcMarketFills"')>added.indexOf('"marketEscrow"'));
 assert.ok(added.includes(NEW));
});
test("native receipt primary key stays per market order, not per retry",()=>{
 const code=fs.readFileSync(path.join(import.meta.dirname,"../integration/coopNpcCorporateSettlement.cjs"),"utf8");
 assert.match(code,/const fillKey="order"\+String\.fromCharCode\(31\)\+orderKey/);
 assert.match(code,/tx\.get\("npcMarketFills",fillKey\)/);
 assert.match(code,/tx\.put\("npcMarketFills",fillKey,receipt\)/);
});
