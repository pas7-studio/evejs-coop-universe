import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildSnapshot,moneyToCents,quantity,parseArgs}=require('../scripts/coop-native-snapshot.cjs');
const meta={projectSha:'a'.repeat(40),upstreamSha:'b'.repeat(40),runtime:{volumeName:'evejs-data',containerId:'f'.repeat(64),imageId:'sha256:'+'c'.repeat(64),containerStartedAt:'2026-10-25T09:00:00Z'}};
const chars={'101':{accountId:201,shipID:3001,solarSystemID:30000142,balance:1000.25},'102':{accountId:202,shipID:3002,solarSystemID:30000142,balance:200}};
const rows=[{key:'3001',json:JSON.stringify({itemID:3001,ownerID:101,typeID:603,categoryID:6,locationID:30000142,quantity:-1,stacksize:1,singleton:1})},{key:'3002',json:JSON.stringify({itemID:3002,ownerID:102,typeID:604,categoryID:6,locationID:30000142,quantity:-1,stacksize:1,singleton:1})},{key:'4101',json:JSON.stringify({itemID:4101,ownerID:101,typeID:34,categoryID:18,locationID:3001,quantity:500,stacksize:500})},{key:'9999',json:JSON.stringify({itemID:9999,ownerID:999,typeID:34,categoryID:18,locationID:1,quantity:999})}];
function snap({items=rows,records=chars,metadata=meta,ids=['101','102']}={}){return buildSnapshot({meta:metadata,characterIds:ids,readCharacter:id=>records[id],iterateItems:()=>items,now:()=> '2026-10-25T10:00:00Z'});}
test('native SQLite export reflects exact two real pilots and only their assets',()=>{const s=snap();assert.equal(s.source,'native-authoritative-export');assert.equal(s.characters.length,2);assert.equal(s.characters[0].isk,'100025');assert.equal(s.characters[1].isk,'20000');assert.equal(s.characters[0].items.length,2);assert.equal(s.characters[1].items.length,1);assert.equal(s.characters.some(c=>c.items.some(i=>i.id==='9999')),false);});
test('wallet uses integer ISK cents, not whole-ISK rounded figures',()=>{assert.equal(moneyToCents('0.01'),'1');assert.equal(moneyToCents(4.75),'475');assert.equal(moneyToCents(0),'0');});
test('native wallets reject missing, negative, fractional-cent and unsafe values',()=>{for(const x of [undefined,-0.01,'10.123','NaN',Number.MAX_SAFE_INTEGER])assert.throws(()=>moneyToCents(x));});
test('ship must exist in native owned inventory, not just character pointer',()=>assert.throws(()=>snap({items:rows.slice(1)}),/ship missing/));
test('same native ship ID in two character rows is not valid',()=>{const c=structuredClone(chars);c['102'].shipID=3001;assert.throws(()=>snap({records:c}),/same native active ship/);});
test('duplicate item IDs must not silently override native custody',()=>assert.throws(()=>snap({items:[...rows,rows[0]]}),/Invalid native item identity/));
test('mismatched SQLite key and JSON item identity fails',()=>{const items=structuredClone(rows);items[0].key='3003';assert.throws(()=>snap({items}),/Invalid native item identity/);});
test('missing character native record fails rather than fabricating',()=>assert.throws(()=>snap({records:{'101':chars['101']}}),/Missing native character/));
test('bad owner IDs do not contaminate pilot inventory',()=>{const items=structuredClone(rows);items[2].json=JSON.stringify({...JSON.parse(items[2].json),ownerID:999});assert.equal(snap({items}).characters[0].items.length,1);});
test('negative stack quantity and fractional item quantity reject export',()=>{for(const v of [-2,1.5]){const items=structuredClone(rows);items[2].json=JSON.stringify({...JSON.parse(items[2].json),quantity:v});assert.throws(()=>snap({items}),/quantity/);}});
test('a singleton without explicit quantity is one asset',()=>assert.equal(quantity({singleton:1}),'1'));
test('no real volume/start/provenance blocks export',()=>{for(const key of ['imageId','volumeName','containerStartedAt']){const metadata=structuredClone(meta);delete metadata.runtime[key];assert.throws(()=>snap({metadata}),/Missing exact/);}});
test('require precisely two distinct canonical character IDs',()=>{for(const ids of [['101'],['101','101'],['00101','102'],['101','x']])assert.throws(()=>snap({ids}),/Exactly two/);});
test('parser accepts provenance and two IDs without needing database access',()=>{const s=Buffer.from(JSON.stringify(meta)).toString('base64');assert.deepEqual(parseArgs(['--meta-base64',s,'--characters','101,102']).characterIds,['101','102']);});

test('exported native snapshots feed the independent restart QA gate unchanged',()=>{
  const {checkPersistence}=require('../scripts/coop-reliability-gates.cjs');
  const first=snap();
  const m=structuredClone(meta);m.runtime.containerStartedAt='2026-10-25T10:05:00Z';
  const second=buildSnapshot({meta:m,characterIds:['101','102'],readCharacter:id=>chars[id],iterateItems:()=>rows,now:()=> '2026-10-25T10:15:00Z'});
  const qaMeta={projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,imageId:meta.runtime.imageId,containerStartedAt:meta.runtime.containerStartedAt};
  assert.equal(checkPersistence(first,second,qaMeta,['101','102']).status,'PASS_SNAPSHOT');
});
test('zero-quantity stack cannot become a fake extra item',()=>{
  assert.throws(()=>quantity({quantity:0,stacksize:0}),/zero quantity/);
  assert.throws(()=>quantity({quantity:0,stacksize:0,singleton:1}),/singleton quantity/);
});

test('real node - stdin execution invokes exporter instead of silently exiting',()=>{
  const {spawnSync}=require('node:child_process');
  const fs=require('node:fs'),path=require('node:path');
  const script=fs.readFileSync(path.join(import.meta.dirname,'../scripts/coop-native-snapshot.cjs'),'utf8');
  const m=Buffer.from(JSON.stringify(meta)).toString('base64');
  const out=spawnSync(process.execPath,['-','--meta-base64',m,'--characters','101,102'],{input:script,encoding:'utf8'});
  assert.equal(out.status,2);
  assert.match(out.stderr,/\[NATIVE_SNAPSHOT_BLOCKED\]/);
  assert.match(out.stderr,/SQLite DB missing/);
});

test('native exporter rejects two characters belonging to one account',()=>{
 const same=structuredClone(chars);same['102'].accountId=201;
 assert.throws(()=>snap({records:same}),/same native EveJS account/);
});
test('native exporter binds actual account and item category for custody tests',()=>{
 const report=snap();
 assert.equal(report.characters[0].accountId,'201');
 assert.equal(report.characters[0].items.find(item=>item.id==='3001').categoryId,'6');
});

test('pinned upstream EveJS native ship singleton quantity -1 and stacksize 1 is accepted',()=>{
  assert.equal(quantity({singleton:1,quantity:-1,stacksize:1}),'1');
  assert.equal(quantity({singleton:2,quantity:-2,stacksize:1}),'1');
  assert.equal(snap().characters[0].items.find(i=>i.id==='3001').quantity,'1');
});
test('negative native non-singleton quantities and malformed singleton sentinels are rejected',()=>{
  for(const item of [{singleton:0,quantity:-1,stacksize:1},{singleton:1,quantity:-2,stacksize:1},
    {singleton:1,quantity:-1,stacksize:2},{singleton:2,quantity:-1,stacksize:1}]) {
    assert.throws(()=>quantity(item));
  }
});