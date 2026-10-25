import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {contracts,auditSources}=require('../scripts/coop-moon-native-audit.cjs');
test('symbol contract audit never claims actual moon chunks or native products',()=>{
 const sources=Object.fromEntries(Object.entries(contracts).map(([p,t])=>[p,t.join('\n')]));
 const a=auditSources(sources);
 assert.ok(Object.values(a.evidence).every(x=>x.state==='PINNED_SOURCE_PRESENT'));
 assert.equal(a.nativeAutoMoonGrantProven,false);
 assert.equal(a.physicalMoonChunkProven,false);
 assert.equal(a.playerInventoryDeliveryProven,false);
 assert.equal(a.clientTested,false);
});
test('missing/changed pinned source is not claimed supported',()=>{
 const a=auditSources({'structure/structureState.js':'not-the-pin'});
 assert.equal(a.evidence['structure/structureState.js'].state,'DRIFTED');
 assert.equal(a.evidence['structure/moonExtractionsService.js'].state,'MISSING');
});
