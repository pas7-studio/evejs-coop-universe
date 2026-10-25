import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {patch,FILE,HOOK}=require('../scripts/coop-native-fitting-slot-patch.cjs');
function fixture(eol='\n'){
 return ['function getSlotFlagsForFamily(family, shipTypeID = null) {',
 '  if (!shipTypeID) return [...baseFlags];',
 '  const slotCounts = getShipSlotCounts(shipTypeID);',
 '  const limit = toInt(slotCounts[family], 0);',
 '  return limit > 0 ? baseFlags.slice(0, limit) : [...baseFlags];',
 '}',
 'function sortFittedItems(left, right) { return 0; }',''].join(eol);
}
for(const eol of ['\n','\r\n']){
 test(`apply twice, remove and roundtrip preserve ${eol==='\n'?'LF':'CRLF'} checkout`,()=>{
  const source=fixture(eol),patched=patch(source,FILE,false);
  assert.equal(patch(patched,FILE,false),patched);
  assert.equal(patch(patched,FILE,true),source);
  assert.equal(patched.split(HOOK).length-1,1);
  assert.equal(patch(source,FILE,true),source);
 });
}
test('unknown function and repeated anchors refuse to patch',()=>{
 assert.throws(()=>patch(fixture().replace('getSlotFlagsForFamily','other'),FILE),/FUNCTION_DRIFT/);
 assert.throws(()=>patch(fixture().replace('  const limit =','  const limit =')+'  const limit = toInt(slotCounts[family], 0);',FILE),/ANCHOR_DRIFT/);
 assert.throws(()=>patch(fixture(), 'wrong.js'),/WRONG_SOURCE/);
});
