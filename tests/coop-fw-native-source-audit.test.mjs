import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {CONTRACTS,auditSources}=require('../scripts/coop-fw-native-coverage-audit.cjs');
const pretend=()=>Object.fromEntries(Object.entries(CONTRACTS).map(([name,tokens])=>[name,tokens.join('\n')]));
test('11 pinned source areas tracked; audit is explicitly NOT verified gameplay',()=>{
 const r=auditSources(pretend());
 assert.equal(Object.keys(r.files).length,11);
 assert.equal(Object.values(r.files).filter(x=>x.state!=='SOURCE_CONTRACT_PRESENT').length,0);
 assert.deepEqual(r.evidence,{clientLogin:false,twoClientBattle:false,nativeCapture:false,lpSettlement:false,serverRestart:false});
 for(const p of Object.values(r.paths))assert.equal(p.gameplayVerified,false);
});
test('FW victory, occupation, pirate and campaign UI RPC surfaces are not full mechanics',()=>{
 const r=auditSources(pretend());
 assert.equal(r.paths.victoryPoints.state,'INJECTED_READ_STATE_NO_CAPTURE_SETTLEMENT');
 assert.equal(r.paths.occupation.state,'EMPTY_WARZONE_OCCUPATION');
 assert.equal(r.paths.pirateInsurgencies.state,'STATIC_CAMPAIGN_AND_ZERO_PROGRESS_STUB');
 assert.equal(r.paths.militaryCampaigns2026.state,'EMPTY_GATEWAY_NO_OBJECTIVE_ENGINE');
 assert.equal(r.paths.lpWallets.state,'NATIVE_WALLET_NO_FW_CREDIT_PROVEN');
 assert.equal(r.paths.fwCaptureSites.state,'NO_VERIFIED_PINNED_SITE_COMPLETION_AUTHORITY');
});
test('missing and drifted files do not return native PASS for any dependent system',()=>{
 const source=pretend();
 source['services/map/fwWarzoneSolarsystemService.js']='';
 delete source['_secondary/express/gatewayServices/campaignGatewayService.js'];
 const r=auditSources(source);
 assert.equal(r.files['services/map/fwWarzoneSolarsystemService.js'].state,'DRIFTED');
 assert.equal(r.files['_secondary/express/gatewayServices/campaignGatewayService.js'].state,'MISSING');
 assert.equal(r.paths.occupation.state,'SOURCE_UNVERIFIED');
 assert.equal(r.paths.militaryCampaigns2026.state,'SOURCE_UNVERIFIED');
});
