import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {assertTables}=require("../integration/coopGameStoreAtomic.cjs");

test("NPC escrow can atomically share item transaction only with explicit table scope",()=>{
 assert.deepEqual(assertTables(["items","marketEscrow"]),["items","marketEscrow"]);
});
test("unknown or reentrant table list is still rejected",()=>{
 assert.throws(()=>assertTables(["items","marketEscrow","wallets"]),/ALLOWLIST/);
 assert.throws(()=>assertTables(["items","items"]),/ALLOWLIST/);
});
test("atomic market escrow is not a general-purpose arbitrary SQL escape",()=>{
 assert.throws(()=>assertTables(["market_orders"]),/ALLOWLIST/);
 assert.throws(()=>assertTables(["_persistence_outbox"]),/ALLOWLIST/);
});
