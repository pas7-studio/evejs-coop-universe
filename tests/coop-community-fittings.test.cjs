const test=require('node:test');
const assert=require('node:assert/strict');
const {validateFit,fromKillmail,buildCatalog,propose,OWNER,PIN}=require('../scripts/coop-community-fittings.cjs');
const sde={types:new Map([[600,{published:true,groupID:1,name:{en:'Merlin'}}],[10,{published:true,groupID:2}],[11,{published:true,groupID:2}],[12,{published:false,groupID:2}]]),groups:new Map([[1,{categoryID:6}],[2,{categoryID:7}]])};
const hull={shipTypeID:600,shipName:'Merlin'};
const source={kind:'public-killmail',url:'https://zkillboard.com/kill/111/'};
const candidate={shipTypeID:600,shipName:'Merlin',fitData:[[10,27,1],[11,19,1],[11,87,2]],source};
test('accepts canonical actual ship fitting and merges cargo quantities',()=>{
  const x=validateFit({...candidate,fitData:[...candidate.fitData,[11,87,3]]},sde);
  assert.equal(x.ok,true);assert.deepEqual(x.fitData,[[11,19,1],[10,27,1],[11,87,5]]);
});
test('refuses unavailable, unpublished, duplicated or stacked modules',()=>{
 for(const [data,reason] of [
  [[[12,27,1]],'UNKNOWN_ITEM'],[[[11,27,2]],'DUPLICATE_OR_STACKED_SLOT'],
  [[[10,27,1],[11,27,1]],'DUPLICATE_OR_STACKED_SLOT'],[[[10,900,1]],'BAD_FLAG_OR_QUANTITY']])
  assert.equal(validateFit({...candidate,fitData:data},sde).reason,reason);
});
test('rejects wrong hull and unknown SDE item',()=>{
 assert.equal(validateFit({...candidate,shipTypeID:999},sde).reason,'UNKNOWN_HULL');
 assert.equal(validateFit({...candidate,fitData:[[100,27,1]]},sde).reason,'UNKNOWN_ITEM');
});
test('converts ESI loss to native slot tuples without granting anything',()=>{
 const mail={victim:{ship_type_id:600,items:[{item_type_id:10,flag:27},{item_type_id:11,flag:87,quantity_dropped:2}]}};
 const summary={killmail_id:111,zkb:{hash:'f'.repeat(40)}};
 const x=fromKillmail(hull,summary,mail);
 assert.equal(x.fitData[0][1],27);assert.deepEqual(x.fitData[1],[11,87,2]);assert.equal(x.source.killmailID,111);
});
test('produces explicit shortfall report and dedups equivalent fits',()=>{
 const catalog=buildCatalog([hull], [candidate,candidate],sde,5);
 assert.equal(catalog.records.length,1);assert.equal(catalog.summary.withAtLeast3,0);
 assert.equal(catalog.coverage[0].variants,1);
});
test('seeding is idempotent, preserves unrelated owners and allocated IDs',()=>{
 const catalog=buildCatalog([hull],[candidate],sde,3);
 const initial={_meta:{version:1,nextFittingID:7},owners:{'1000282':{ownerID:OWNER,scope:'community',fittings:{}},'123':{fittings:{'9':{name:'personal'}}}}};
 const once=propose(initial,catalog), twice=propose({_meta:{version:1,nextFittingID:once.next},owners:{...initial.owners,'1000282':once.owner}},catalog);
 assert.equal(once.report.created,1);assert.equal(once.next,11);assert.equal(twice.report.created,0);assert.equal(twice.report.unchanged,1);
 assert.equal(once.owner.fittings['10'].shipTypeID,600);
});
test('rejects stale pin and duplicate managed signatures',()=>{
 const catalog=buildCatalog([hull],[candidate],sde,3);
 assert.throws(()=>propose({_meta:{nextFittingID:1},owners:{}},{...catalog,sdePin:'other'}),/BAD_CATALOG_OR_PIN/);
 assert.throws(()=>propose({_meta:{nextFittingID:1},owners:{}},{...catalog,records:[...catalog.records,...catalog.records]}),/DUPLICATE_INCOMING_SIGNATURE/);
});

test('permissioned EFT is preferred over public killmail on same hull',()=>{
 const {parseEft}=require('../scripts/coop-community-fit-eft.cjs');
 const {merge}=require('../scripts/coop-community-fit-merge.cjs');
 const eft='[Merlin, [PVE] Test]\nDamage Control I\n\nShield Booster I\n\nLight Missile Launcher I\n';
 const extended={types:new Map([...sde.types,[13,{published:true,groupID:2,name:{en:'Damage Control I'}}],[14,{published:true,groupID:2,name:{en:'Shield Booster I'}}],[15,{published:true,groupID:2,name:{en:'Light Missile Launcher I'}}]]),groups:sde.groups,ships:[hull]};
 extended.types.get(600).name={en:'Merlin'};
 const fit=parseEft(eft,extended,{sourceURL:'https://example.org/fit',author:'Public Author',permission:'author-approved'});
 const curated=buildCatalog([hull],[fit],extended,3);
 const field=buildCatalog([hull],[candidate],extended,3);
 const output=merge(extended,[field,curated],3);
 assert.equal(output.records.length,2);assert.equal(output.records[0].provenance.kind,'permissioned-eft');
 assert.equal(output.summary.withAtLeast3,0);
});