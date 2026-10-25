import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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

test('official EFT sections, offline modules and cargo never become bogus subsystem or drone slots',()=>{
 const {parseEft}=require('../scripts/coop-community-fit-eft.cjs');
 const types=new Map([...sde.types,
  [201,{published:true,groupID:2,name:{en:'Damage Control I'}}],
  [202,{published:true,groupID:2,name:{en:'Shield Booster I'}}],
  [203,{published:true,groupID:2,name:{en:'Small Missile Launcher I'}}],
  [204,{published:true,groupID:2,name:{en:'Scourge Rocket'}}],
  [205,{published:true,groupID:3,name:{en:'Warrior I'}}],
  [206,{published:true,groupID:4,name:{en:'Sisters Core Scanner Probe'}}],
  [207,{published:true,groupID:2,name:{en:'Small Shield Extender I'}}],
 ]);
 const groups=new Map([...sde.groups,[3,{categoryID:18}],[4,{categoryID:8}]]);
 const local={types,groups,ships:[hull]};
 const raw='[Merlin, EFT official sections]\nDamage Control I /offline\n\nShield Booster I\n\nSmall Missile Launcher I, Scourge Rocket\n\nSmall Shield Extender I\n\n\n\n\nWarrior I x2\n\nSisters Core Scanner Probe x8\n';
 const fit=parseEft(raw,local,{sourceURL:'https://eveworkbench.com/fit/123',author:'Author',kind:'public-workbench'});
 assert.deepEqual(fit.fitData,[[201,11,1],[202,19,1],[203,27,1],[204,5,1],[205,87,2],[206,5,8],[207,92,1]].sort((a,b)=>a[1]-b[1]||a[0]-b[0]));
 assert.ok(fit.fitData.some(x=>x[1]===87&&x[0]===205));
 assert.ok(!fit.fitData.some(x=>x[1]===125));
});

test('EVE Workbench public listing schema and hull selection are explicit',()=>{
 const {validatePublicPage,selectHulls}=require('../scripts/coop-community-fit-workbench.cjs');
 assert.deepEqual(validatePublicPage({error:false,numberOfPages:2,fits:[]}),{fits:[],pages:2});
 assert.throws(()=>validatePublicPage({error:true,fits:[]}),/SCHEMA/);
 assert.deepEqual(selectHulls({...sde,ships:[hull]},'Merlin'),[hull]);
 assert.throws(()=>selectHulls({...sde,ships:[hull]},'Unknown'),/SHIP_NOT_FOUND/);
});

test('EVE Workbench wins over field reports but author-permissioned EFT wins over both',()=>{
 const {merge}=require('../scripts/coop-community-fit-merge.cjs');
 const extended={...sde,ships:[hull]};
 const named={...candidate,source:{kind:'public-workbench',url:'https://eveworkbench.com/fit/example',author:'Pilot'},name:'[PVE] Merlin'};
 const sourceField=buildCatalog([hull],[candidate],extended,3);
 const sourceWorkbench=buildCatalog([hull],[named],extended,3);
 const output=merge(extended,[sourceField,sourceWorkbench],3);
 assert.equal(output.records.length,1);
 assert.equal(output.records[0].provenance.kind,'public-workbench');
});
test('accepts the live PascalCase EVE Workbench schema as well as the legacy fixture shape',()=>{
 const {validatePublicPage}=require('../scripts/coop-community-fit-workbench.cjs');
 const live={Error:false,NumberOfPages:387,CurrentPage:1,PageSize:100,TotalFits:38647,Fits:[{Id:'x',ShipId:600,CharacterName:'pilot'}]};
 const parsed=validatePublicPage(live);
 assert.equal(parsed.pages,387);assert.equal(parsed.fits.length,1);assert.equal(parsed.fits[0].ShipId,600);
 assert.deepEqual(validatePublicPage({fits:[],numberOfPages:1}),{fits:[],pages:1});
 assert.throws(()=>validatePublicPage({Error:true,Fits:[]}),/SCHEMA/);
});
test('seed arguments accept hash and boundary flags containing digits',()=>{
 const {args}=require('../scripts/coop-community-fit-seed.cjs');
 const base=['--mode','plan','--sde','s','--db','d','--code-path','c','--catalog','k'];
 assert.equal(args(base).mode,'plan');
 const apply=args([...base,'--allow-over-600','yes','--approve-sha256','a'.repeat(64),'--confirm-stopped','yes','--backup-dir','b']);
 assert.equal(apply['approve-sha256'],'a'.repeat(64));
 assert.equal(apply['allow-over-600'],'yes');
});
test('workbench politeness and fetch limits are explicit and bounded',()=>{
 const {args}=require('../scripts/coop-community-fit-workbench.cjs');
 const parsed=args(['--sde','s','--out','o','--cache','c','--concurrency','3','--spacing','150']);
 assert.equal(parsed['max-fits'],2000);assert.equal(parsed.concurrency,3);assert.equal(parsed.spacing,150);
 assert.throws(()=>args(['--sde','s','--out','o','--cache','c','--concurrency','99']),/BAD_INTEGER/);
 assert.throws(()=>args(['--sde','s','--out','o','--cache','c','--spacing','5']),/BAD_INTEGER/);
});