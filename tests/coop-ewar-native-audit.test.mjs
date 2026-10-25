import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {CONTRACTS,auditSourceFiles}=require('../scripts/coop-ewar-native-audit.cjs');
test('native source contract explicitly tracks hostile, ECM, assistance, bursts, NPC AI',()=>{
 assert.equal(Object.keys(CONTRACTS).length,5);
 assert.ok(CONTRACTS['space/modules/hostileModuleRuntime.js'].includes('energyNosferatu'));
 assert.ok(CONTRACTS['space/modules/commandBurstRuntime.js'].includes('isInSameFleet'));
});
test('read-only audit distinguishes SOURCE_ONLY_PRESENT from gameplay',()=>{
 const result=auditSourceFiles(file=>CONTRACTS[file].join('\n'));
 assert.equal(result.status,'SOURCE_ONLY_PRESENT');
 assert.equal(result.liveGameplayVerified,false);
});
test('missing any native service is a reported blocker, not a silently ignored claim',()=>{
 const result=auditSourceFiles(file=>file.includes('jammer')?null:CONTRACTS[file].join('\n'));
 assert.equal(result.status,'BLOCKED_SOURCE_CONTRACT');
 assert.ok(result.files.some(f=>f.file.includes('jammer')&&f.missing.includes('ecmJammer')));
});
test('partial semantics are reported as missing',()=>{
 const result=auditSourceFiles(file=>CONTRACTS[file].filter(s=>s!=='isInSameFleet').join('\n'));
 assert.equal(result.status,'BLOCKED_SOURCE_CONTRACT');
 assert.ok(result.files.find(x=>x.file.includes('commandBurst')).missing.includes('isInSameFleet'));
});
