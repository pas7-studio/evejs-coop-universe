import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { auditEconomyEvidence, SOURCES } = require("../integration/coopEconomyConservationAudit.cjs");
function tempDb(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coop40-disposable-"));
  const sqlite = path.join(directory, "game.sqlite");
  let db = new DatabaseSync(sqlite);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    db.exec("CREATE TABLE items(key TEXT PRIMARY KEY, json TEXT NOT NULL);");
    db.exec("CREATE TABLE characters(key TEXT PRIMARY KEY, json TEXT NOT NULL);");
    db.exec("CREATE TABLE marketReceipts(key TEXT PRIMARY KEY, json TEXT NOT NULL);");
    const row = (table, key) => { const v = db.prepare(`SELECT json FROM ${table} WHERE key=?`).get(key);return v ? JSON.parse(v.json) : null; };
    const put = (table, key, value) => db.prepare(`INSERT INTO ${table}(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(key,JSON.stringify(value));
    const reopen = () => {db.close();db = new DatabaseSync(sqlite);};
    const fixture = () => {
      const items = db.prepare("SELECT json FROM items").all().map(x => JSON.parse(x.json));
      const receipts = db.prepare("SELECT json FROM marketReceipts").all().map(x => JSON.parse(x.json));
      return Object.fromEntries(SOURCES.map(s => [s, s === "nativeItems" ? items : s === "gameStoreReceipts" ? receipts : []]));
    };
    fn({ get db() {return db;}, row, put, reopen, fixture });
  } finally {
    try {db.close();} catch {} fs.rmSync(directory,{recursive:true,force:true});
  }
}
test("precommit crash/rollback never leaks partial wallet or inventory transfer",()=>tempDb(f=>{
  f.put("characters","101",{balance:1000});
  f.put("items","55",{itemID:55,ownerID:101,locationID:9000,typeID:35,quantity:4,stacksize:4});
  const first=f.row("items","55");
  f.db.exec("BEGIN IMMEDIATE");
  f.put("characters","101",{balance:500});
  f.put("items","55",{...first,ownerID:102});
  f.db.exec("ROLLBACK");f.reopen();
  assert.equal(f.row("characters","101").balance,1000);
  assert.equal(f.row("items","55").ownerID,101);
}));
test("lost client acknowledgement after COMMIT: idempotent claim prevents double debit across reopen",()=>tempDb(f=>{
  const claimKey="claim-20";
  f.put("characters","101",{balance:1000});
  f.put("items","55",{itemID:55,ownerID:101,locationID:9000,typeID:35,quantity:4,stacksize:4});
  function once() {
    const existing=f.row("marketReceipts",claimKey);
    if(existing)return "ALREADY_SETTLED";
    f.db.exec("BEGIN IMMEDIATE");
    try {
      if(f.row("marketReceipts",claimKey)){f.db.exec("ROLLBACK");return "ALREADY_SETTLED";}
      f.put("characters","101",{balance:f.row("characters","101").balance-200});
      f.put("items","55",{...f.row("items","55"),ownerID:102});
      f.put("marketReceipts",claimKey,{claimKey,fillID:20,orderID:21,itemID:55,ownerID:102,typeID:35,quantity:4,locationID:9000});
      f.db.exec("COMMIT");return "COMMITTED";
    } catch(e) {try{f.db.exec("ROLLBACK");}catch{}throw e}
  }
  assert.equal(once(),"COMMITTED");
  // The client did not receive COMMIT acknowledgment. The process restarts;
  // no call to `once` is made until the original native receipt is inspected.
  f.reopen();
  assert.equal(f.row("characters","101").balance,800);
  assert.equal(f.row("items","55").ownerID,102);
  assert.equal(once(),"ALREADY_SETTLED");
  assert.equal(f.row("characters","101").balance,800);
  const snapshot=f.fixture();
  snapshot.rustClaims=[{claimKey,fillID:20,orderID:21,state:"filled"}];
  const audit=auditEconomyEvidence(snapshot);
  assert.equal(audit.status,"SNAPSHOT_CONSISTENT",JSON.stringify(audit));
}));
test("cross-database torn settlement is HOLD_MANUAL, not an invented new payout",()=>tempDb(f=>{
  const snapshot=f.fixture();
  snapshot.rustClaims=[{claimKey:"claim-30",fillID:30,orderID:31,state:"filled"}];
  const audit=auditEconomyEvidence(snapshot);
  assert.equal(audit.status,"HOLD_MANUAL");
  assert.ok(audit.issues.some(x=>x.code==="RUST_FILLED_WITHOUT_NATIVE_RECEIPT"));
  assert.equal(f.row("marketReceipts","claim-30"),null);
}));
