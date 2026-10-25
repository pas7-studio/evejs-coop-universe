import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const read=require('../scripts/coop-moon-extraction-read-patch.cjs');
const fuel=require('../scripts/coop-moon-fuel-output-patch.cjs');
const sourceAudit=require('../scripts/coop-moon-native-audit.cjs');
const code=process.env.EVEJS_COOP_CODE_PATH||process.env.EVEJS_CODE_PATH||'';
const present=code&&existsSync(join(code,read.FILE))&&existsSync(join(code,fuel.FILE));
test('real pinned moon extraction access patch/unpatch', {skip:!present?'Pinned Code checkout unavailable':false},()=>{
 const source=readFileSync(join(code,read.FILE),'utf8');
 assert.equal(read.patch(read.patch(source,read.FILE),read.FILE,{remove:true}),source);
});
test('real pinned Metenox fuel patch/unpatch', {skip:!present?'Pinned Code checkout unavailable':false},()=>{
 const source=readFileSync(join(code,fuel.FILE),'utf8');
 assert.equal(fuel.patch(fuel.patch(source,fuel.FILE),fuel.FILE,{remove:true}),source);
});
test('actual pinned moon server source contracts', {skip:!present?'Pinned Code checkout unavailable':false},()=>{
 const audit=sourceAudit.auditSources(sourceAudit.readSources(code));
 assert.deepEqual(Object.values(audit.evidence).filter(x=>x.state!=='PINNED_SOURCE_PRESENT'),[]);
 assert.equal(audit.nativeAutoMoonGrantProven,false);
 assert.equal(audit.playerInventoryDeliveryProven,false);
});
