import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {TYPES,ARMS,patch}=require("../scripts/coop-rust-p2p-claim-patch.cjs");
const source=readFileSync(new URL("../rust/coop_p2p_market_claim.rs",import.meta.url),"utf8");
test("Rust claim schema stores released state with native GameStore receipt",()=>{
 assert.match(source,/phase TEXT NOT NULL CHECK\(phase IN \('claimed','finalized','released'\)\)/);
 assert.match(source,/native_receipt_key TEXT/);
 assert.match(source,/P2P_RELEASE_DURABLE|P2P_RELEASE_MUST_FOLLOW_FINALIZED_RUST_FILL/);
});
test("Rust finalize stores receipt while order stays settling",()=>{
 const i=source.indexOf("fn coop_p2p_finalize_db(");
 const j=source.indexOf("fn coop_p2p_release_db(",i);
 assert.ok(i>0&&j>i);
 const fn=source.slice(i,j);
 assert.match(fn,/UPDATE market_orders SET vol_remaining=\?3,updated_at=\?4/);
 assert.equal(fn.includes("UPDATE market_orders SET vol_remaining=?3,state=?4"),false);
 assert.match(fn,/"release_pending":true/);
 assert.match(fn,/phase='finalized'/);
});
test("Rust release returns saved ACK and does not apply a second fill",()=>{
 const i=source.indexOf("fn coop_p2p_release_db(");
 const j=source.indexOf("fn coop_p2p_get_claim_db(",i);
 assert.ok(i>0&&j>i);
 const fn=source.slice(i,j);
 assert.match(fn,/phase=="released"/);
 assert.match(fn,/old_key\.as_deref\(\)!=Some\(receipt_key\.as_str\(\)\)/);
 assert.match(fn,/WHERE order_id=\?1 AND state='settling' AND vol_remaining=\?4/);
 assert.match(fn,/phase='released',native_receipt_key=\?3/);
 assert.equal(fn.includes("filled_quantity -"),false);
});
test("native Rust RPC dispatch exposes release with exact order identity and receipt key",()=>{
 assert.match(TYPES,/struct CoopP2pReleaseParams/);
 assert.match(TYPES,/native_receipt_key:String/);
 assert.match(ARMS,/"ReleasePlayerFill"/);
 assert.match(ARMS,/runtime\.coop_p2p_release/);
});
