import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-player-market-buy-settlement-patch.cjs");
const claim='    if (coopPlayerBuyTicket) await require("../../space/coopPlayerMarketRustClaim").claim({ticket:coopPlayerBuyTicket,proof:coopPlayerBuyProof,client:marketDaemonClient});';
function fixture(eol="\n"){
 return [
 'async function matchBuyOrdersForSeller({}={}) {',
 '  for(const buyOrder of []) {',
 '    const isSeedBuyOrder=false;',
 '    const coopPlayerBuyProof=Object.freeze({});',
 '    const coopPlayerBuyTicket={};',
 claim,
 '    const sellerInventoryChanges=[];',
 '  }',
 '}',
 'async function executeBuyRequest({}={}) {}',
 ''
 ].join(eol);
}
for(const eol of ["\n","\r\n"])
test("original BUY seller payout hooks are reversible and repeat safe "+JSON.stringify(eol),()=>{
 const src=fixture(eol),next=patch(src);
 assert.notEqual(next,src);
 assert.equal(patch(next),next);
 assert.equal(patch(next,{remove:true}),src);
 assert.doesNotThrow(()=>new Function(next));
 assert.match(next,/coopPlayerMarketAtomicRuntime.*settleBuy/);
 assert.match(next,/P2P_BUY_PAY_POST_RELEASE_NATIVE_CUSTODY_INVALID/);
 assert.match(next,/continue;/);
 assert.equal((next.match(/settleBuy/g)||[]).length,1);
});
test("wrong prior Rust claim or absent match scope cannot install a payment shortcut",()=>{
 assert.throws(()=>patch(fixture().replace(claim,"")),
  /RUST_CLAIM_HOOK_DRIFT/);
 assert.throws(()=>patch(fixture().replace("async function executeBuyRequest({}={}) {}","")),
  /ORIGINAL_MATCH_SCOPE_DRIFT/);
});
test("native payout branch only issues buyer notifications after receipt-gated settlement",()=>{
 const next=patch(fixture()),p=next.indexOf(".settleBuy("),n=next.indexOf("notifyBuyerDelivery(");
 assert.ok(p>0&&n>p);
 assert.match(next,/ORDER_REASON_FILLED:ORDER_REASON_PARTIAL/);
});
