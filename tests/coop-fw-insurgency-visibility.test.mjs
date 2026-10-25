import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
const require=createRequire(import.meta.url);
const {getAuthoritativeVisibleCampaigns}=require('../integration/coopFwInsurgencyVisibility.cjs');
const P=require('../scripts/coop-fw-insurgency-visibility-patch.cjs');
test('unsupported native pirate campaign surface never returns fabricated active raids',()=>{
 assert.deepEqual(getAuthoritativeVisibleCampaigns(),[]);
 assert.deepEqual(getAuthoritativeVisibleCampaigns([{campaignID:145,fsmState:3}]),[]);
});
const fixture=`class InsurgencySolarsystemService {
  Handle_GetAllVisibleCampaigns(args, session) {
    log.debug('visible');
    return buildList(VISIBLE_CAMPAIGN_SNAPSHOTS.map(buildCampaignSnapshot));
  }
  Handle_GetLocalCampaignClientSnapshot(args, session) { return [30000142,null]; }
}
`;
test('Pirate Insurgency native visibility patch reversible LF and CRLF exact',()=>{
 for(const src of [fixture,fixture.replaceAll('\n','\r\n')]){
  const patched=P.patchFwInsurgency(src,P.FILE);
  assert.equal(patched.includes(P.HOOK),true);
  assert.equal(P.patchFwInsurgency(patched,P.FILE),patched);
  assert.equal(P.patchFwInsurgency(patched,P.FILE,{remove:true}),src);
  assert.equal(P.patchFwInsurgency(src,P.FILE,{remove:true}),src);
  new Script(patched);
 }
});
test('insurgency patch fails closed on drift, wrong path or partial insertion',()=>{
 assert.throws(()=>P.patchFwInsurgency(fixture,'server/src/services/faction/no.js'),/UNSUPPORTED/);
 assert.throws(()=>P.patchFwInsurgency(fixture.replace(P.ANCHOR,'return buildList([]);'),P.FILE),/ANCHOR/);
 assert.throws(()=>P.patchFwInsurgency(fixture+fixture,P.FILE),/METHOD/);
 const partial=P.patchFwInsurgency(fixture,P.FILE).replace('getAuthoritativeVisibleCampaigns());','getAuthoritativeVisibleCampaigns())');
 assert.throws(()=>P.patchFwInsurgency(partial,P.FILE),/ANCHOR/);
});
