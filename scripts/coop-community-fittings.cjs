'use strict';
// COOP-043. Original native fitting record validation, harvesting and seed planning.
// Deliberately contains no client modifications, market mutations or default-on hooks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 1000282;
const PREFIX = 'COOP043#';
const FLAGS = new Set([5, 87, 158]);
for (const [a, b] of [[11, 34], [92, 99], [125, 132], [164, 171]]) {
  for (let i = a; i <= b; i++) FLAGS.add(i);
}
const SLOTS = new Set([...FLAGS].filter(v => ![5, 87, 158].includes(v)));
const PIN = 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f';
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const text = value => String(value == null ? '' : value);
const typeName = row => typeof row?.name === 'string' ? row.name : (row?.name?.en || '');

function readJsonl(file, limit = 100000) {
  const items = new Map();
  const content = fs.readFileSync(file, 'utf8');
  if (content.length > 50_000_000) throw Error('SDE_FILE_TOO_LARGE');
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length > limit) throw Error('SDE_ROW_LIMIT');
  for (const line of lines) {
    const row = JSON.parse(line);
    const id = Number(row._key ?? row.typeID ?? row.groupID);
    if (positive(id)) items.set(id, row);
  }
  return items;
}
function loadSde(dir) {
  const types = readJsonl(path.join(dir, 'types.jsonl'));
  const groups = readJsonl(path.join(dir, 'groups.jsonl'));
  const ships = [...types.entries()].filter(([id, t]) => {
    const g = groups.get(Number(t.groupID));
    return t.published === true && Number(g?.categoryID) === 6 && typeName(t);
  }).map(([shipTypeID, t]) => ({shipTypeID, shipName:typeName(t), groupID:Number(t.groupID)}));
  ships.sort((a,b)=>a.shipTypeID-b.shipTypeID);
  return {types, groups, ships};
}
function fitHash(shipTypeID, fitData) {
  const ordered = fitData.map(x=>x.map(Number)).sort((a,b)=>a[1]-b[1] || a[0]-b[0] || a[2]-b[2]);
  return HASH(JSON.stringify([Number(shipTypeID),ordered]));
}
function validateFit(record, sde) {
  if (!record || typeof record !== 'object') return {ok:false,reason:'BAD_RECORD'};
  if (!positive(record.shipTypeID) || !Array.isArray(record.fitData) || record.fitData.length > 200 || !record.fitData.length) return {ok:false,reason:'BAD_FIT'};
  const ship = sde.types.get(Number(record.shipTypeID));
  if (!ship || ship.published !== true || Number(sde.groups.get(Number(ship.groupID))?.categoryID) !== 6) return {ok:false,reason:'UNKNOWN_HULL'};
  const occupied=new Set(); let slots=0;
  const merged = new Map();
  for (const entry of record.fitData) {
    if (!Array.isArray(entry) || entry.length !== 3) return {ok:false,reason:'BAD_TUPLE'};
    const [id, flag, qty] = entry.map(Number);
    if (![id, flag, qty].every(positive) || !FLAGS.has(flag) || qty > 100000) return {ok:false,reason:'BAD_FLAG_OR_QUANTITY'};
    const t=sde.types.get(id);
    if (!t || t.published !== true) return {ok:false,reason:'UNKNOWN_ITEM',itemID:id};
    if (SLOTS.has(flag)) {
      if (qty !== 1 || occupied.has(flag)) return {ok:false,reason:'DUPLICATE_OR_STACKED_SLOT'};
      occupied.add(flag);slots++;
    } else {
      const key=`${id}:${flag}`;
      merged.set(key,(merged.get(key)||0)+qty);
    }
  }
  if (slots===0) return {ok:false,reason:'NO_FITTED_MODULES'};
  const fitData=[...record.fitData.filter(x=>SLOTS.has(Number(x[1]))).map(x=>x.map(Number)), ...[...merged.entries()].map(([key,qty])=>[...key.split(':').map(Number),qty])];
  fitData.sort((a,b)=>a[1]-b[1] || a[0]-b[0]);
  return {ok:true,fitData,slots,signature:fitHash(record.shipTypeID,fitData),warning:'DOGMA_CPU_PG_SKILLS_NOT_CHECKED'};
}
function fromKillmail(hull, summary, mail) {
  const victim=mail?.victim;
  if (Number(victim?.ship_type_id)!==hull.shipTypeID || !Array.isArray(victim?.items)) return null;
  const tuples=[];
  function walk(items, parent=null, depth=0) {
    if (depth>8) return;
    for (const item of items) {
      if (!item || !positive(item.item_type_id)) continue;
      const flag=Number(item.flag), id=Number(item.item_type_id);
      const count=Number(item.quantity_destroyed || 0)+Number(item.quantity_dropped || 0) || 1;
      const mapped=parent ?? ([159,160,161,162,163].includes(flag)?158:flag);
      if (FLAGS.has(mapped) && positive(count)) tuples.push([id,mapped,SLOTS.has(mapped)?1:Math.min(count,100000)]);
      const childFlag=SLOTS.has(mapped)?5:(FLAGS.has(mapped)?mapped:5);
      if (Array.isArray(item.items)) walk(item.items, childFlag, depth+1);
    }
  }
  walk(victim.items);
  if (!tuples.length) return null;
  const id=Number(summary.killmail_id), hash=text(summary?.zkb?.hash);
  if (!positive(id)||!/^[a-f0-9]{20,80}$/i.test(hash)) return null;
  return {shipTypeID:hull.shipTypeID,shipName:hull.shipName,fitData:tuples,source:{kind:'public-killmail',url:`https://zkillboard.com/kill/${id}/`,killmailID:id,hash}};
}
function buildCatalog(hulls, candidates, sde, perHull = 5) {
  if (!Number.isInteger(perHull) || perHull<1 || perHull>5) throw Error('INVALID_PER_HULL');
  const byHull=new Map(); const invalid=[];
  for (const candidate of candidates) {
    const result=validateFit(candidate,sde);
    if (!result.ok) {invalid.push({shipTypeID:candidate?.shipTypeID,reason:result.reason});continue;}
    const shipTypeID=Number(candidate.shipTypeID);
    if (!byHull.has(shipTypeID)) byHull.set(shipTypeID,new Map());
    if (byHull.get(shipTypeID).has(result.signature)) continue;
    const source=candidate.source || {};
    if (source.kind==='permissioned-eft' && (!source.permission || !source.author || text(candidate.name).includes('@@'))) {invalid.push({shipTypeID,reason:'INVALID_CURATED_ATTRIBUTION_OR_NAME'});continue;}
    if (!text(source.url).startsWith('https://')) {invalid.push({shipTypeID,reason:'INVALID_SOURCE_URL'});continue;}
    if (source.kind!=='public-killmail' && source.kind!=='permissioned-eft' && source.kind!=='public-workbench') {invalid.push({shipTypeID,reason:'UNSUPPORTED_SOURCE'});continue;}
    byHull.get(shipTypeID).set(result.signature,{...candidate,fitData:result.fitData,signature:result.signature,slots:result.slots});
  }
  const records=[], coverage=[];
  for (const hull of hulls) {
    const priority=k=>k==='permissioned-eft'?3:k==='public-workbench'?2:1;
    const variants=[...(byHull.get(hull.shipTypeID)?.values()||[])].sort((a,b)=>priority(b.source.kind)-priority(a.source.kind) || b.slots-a.slots || a.signature.localeCompare(b.signature)).slice(0,perHull);
    coverage.push({shipTypeID:hull.shipTypeID,shipName:hull.shipName,variants:variants.length,target:perHull});
    for (const [i,fit] of variants.entries()) {
      const sourceURL=text(fit.source.url);
      const id=fit.signature.slice(0,16);
      const curated=fit.source.kind==='permissioned-eft';
      const workbench=fit.source.kind==='public-workbench';
      const name=curated?text(fit.name||`[COMMUNITY] ${hull.shipName} ${i+1}`):workbench?`[EWB] ${text(fit.name||hull.shipName)}`:`[FIELD] ${hull.shipName} ${i+1}`;
      const origin=curated?`Shared EFT by ${text(fit.source.author).slice(0,70)}`:workbench?`Public EVE Workbench fit by ${text(fit.source.author).slice(0,60)}`:'Public combat-loss fit; not vetted';
      records.push({shipTypeID:hull.shipTypeID,shipName:hull.shipName,fitData:fit.fitData,
        name:name.slice(0,50),
        description:`${PREFIX}${id} ${origin}. ${sourceURL}`.slice(0,500),
        provenance:{kind:fit.source.kind,url:sourceURL,signature:fit.signature,author:curated||workbench?fit.source.author:undefined,permission:curated?fit.source.permission:undefined}});
    }
  }
  return {schema:1,source:'public-killmail-esi',sdePin:PIN,records,coverage,invalid,
    summary:{hulls:hulls.length,fits:records.length,withAtLeast3:coverage.filter(x=>x.variants>=3).length,zero:coverage.filter(x=>!x.variants).length}};
}
function propose(current, input, maxCatalog = 5000) {
  if (!input || input.schema !== 1 || input.sdePin !== PIN || !Array.isArray(input.records) || input.records.length > maxCatalog) throw Error('BAD_CATALOG_OR_PIN');
  const community=current?.owners?.[String(OWNER)] || {ownerID:OWNER,scope:'community',fittings:{}};
  if (community.scope!=='community' || Number(community.ownerID)!==OWNER) throw Error('COMMUNITY_OWNER_CONFLICT');
  const original=community.fittings || {};
  const used=new Set();let highest=0;
  for (const obj of Object.values(current?.owners||{})) for (const key of Object.keys(obj?.fittings||{})) {
    const numeric=Number(key);if(positive(numeric)){used.add(numeric);highest=Math.max(highest,numeric);}
  }
  let next=Math.max(Number(current?._meta?.nextFittingID||1),highest+1);
  if (!Number.isSafeInteger(next)||next<1) throw Error('INVALID_NEXT_ID');
  const indexed=new Map();
  for (const [id,f] of Object.entries(original)) {
    const match= text(f.description).match(/^COOP043#([0-9a-f]{16})\b/);
    if (match) {if(indexed.has(match[1])) throw Error('DUPLICATE_MANAGED_KEY');indexed.set(match[1],Number(id));}
  }
  const updated={...original}, report={created:0,updated:0,unchanged:0,existing:Object.keys(original).length};
  const ids=new Set();
  for (const f of input.records) {
    const match=text(f.description).match(/^COOP043#([0-9a-f]{16})\b/);
    if (!match || !positive(f.shipTypeID) || !Array.isArray(f.fitData) || text(f.name).length>50 || text(f.description).length>500) throw Error('INVALID_SEED_RECORD');
    if(ids.has(match[1])) throw Error('DUPLICATE_INCOMING_SIGNATURE');ids.add(match[1]);
    const id=indexed.get(match[1])||next++;
    const record={fittingID:id,ownerID:OWNER,shipTypeID:Number(f.shipTypeID),name:text(f.name),description:text(f.description),fitData:f.fitData,savedDate:((BigInt(Date.now())+11644473600000n)*10000n).toString()};
    if (updated[String(id)]) {
      // Do not overwrite the saved timestamp when unchanged.
      record.savedDate=updated[String(id)].savedDate||'0';
      if (JSON.stringify(updated[String(id)])===JSON.stringify(record)) report.unchanged++;
      else {updated[String(id)]=record;report.updated++;}
    } else {updated[String(id)]=record;report.created++;}
  }
  if(Object.keys(updated).length>maxCatalog) throw Error('CATALOG_TOO_LARGE');
  return {owner:{...community,fittings:updated},next,report};
}
module.exports={OWNER,PIN,PREFIX,FLAGS,SLOTS,loadSde,fitHash,validateFit,fromKillmail,buildCatalog,propose};