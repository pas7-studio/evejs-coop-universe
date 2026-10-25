"use strict";
// Native EveJS SQLite read-only exporter. Do not require gameStore or write to
// a database: better-sqlite3 opens the actual mounted WAL DB read-only.
const fs=require('node:fs');
const canonical = x => /^[1-9][0-9]*$/.test(String(x)) && Number.isSafeInteger(Number(x));
const positive = x => Number.isSafeInteger(Number(x)) && Number(x)>0;
const sha = x => /^[a-f0-9]{40}$/.test(String(x||''));
const image = x => /^sha256:[a-f0-9]{64}$/.test(String(x||''));
const runtime = x => x && x.volumeName==='evejs-data' && typeof x.containerId==='string' && /^[0-9a-f]{12,64}$/.test(x.containerId) && image(x.imageId) && Number.isFinite(Date.parse(x.containerStartedAt));
const owned = x => canonical(x);
const base = '/var/lib/evejs/gameStore/gamestore.sqlite';

function moneyToCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw Error('Missing native wallet balance');
  const n=Number(value), cents=Math.round(n*100);
  if (!Number.isFinite(n)||n<0||!Number.isSafeInteger(cents)||Math.abs(n*100-cents)>1e-5)
    throw Error('Native wallet balance cannot be represented as exact ISK cents');
  return String(cents);
}
function quantity(item) {
  if (!item || typeof item !== 'object') throw Error('Malformed item record');
  const values=[item.quantity,item.stacksize].filter(x=>x!==undefined && x!==null);
  if(values.some(x=>!Number.isSafeInteger(Number(x)) || Number(x)<0)) throw Error('Invalid native item quantity');
  const n=values.length?Math.max(...values.map(Number)):1;
  // ItemStore represents singleton ships/modules with one item record.
  if(n===0 && item.singleton!==1 && item.singleton!==true) throw Error('Native non-singleton item has zero quantity');
  return String(n>0?n:1);
}
function verifyInput(meta, ids) {
  if(!meta||!sha(meta.projectSha)||!sha(meta.upstreamSha)||!runtime(meta.runtime)) throw Error('Missing exact source revisions and inspected live Docker runtime');
  if(!Array.isArray(ids)||ids.length!==2||!ids.every(canonical)||ids[0]===ids[1]) throw Error('Exactly two distinct canonical player character IDs required');
  return ids;
}
function buildSnapshot({meta,characterIds,readCharacter,iterateItems,now=()=>new Date().toISOString()}) {
  const ids=verifyInput(meta,characterIds.map(String));
  const players=ids.map(id=>{
    const record=readCharacter(id);
    if (!record||typeof record!=='object'||!canonical(record.shipID)||!canonical(record.solarSystemID))
      throw Error('Missing native character/active ship/system record');
    if(!canonical(record.accountId)) throw Error('Missing native character account ownership');
    return {id,accountId:String(record.accountId),shipId:String(record.shipID),systemId:String(record.solarSystemID),isk:moneyToCents(record.balance),items:[]};
  });
  if(new Set(players.map(p=>p.shipId)).size!==2) throw Error('Two characters share the same native active ship');
  if(new Set(players.map(p=>p.accountId)).size!==2) throw Error('Two characters belong to the same native EveJS account');
  const byID=new Map(players.map(p=>[p.id,p]));
  const itemIds=new Set();
  for(const {key,json} of iterateItems()) {
    const item=JSON.parse(json);
    if(!item||typeof item!=='object') throw Error('Corrupt native SQLite items row');
    const owner=String(item.ownerID||'');
    if(!byID.has(owner)) continue;
    if(!canonical(key)||!canonical(item.itemID)||key!==String(item.itemID)||itemIds.has(key)||
       !canonical(item.typeID)||!positive(item.locationID)) throw Error('Invalid native item identity, ownership or location');
    itemIds.add(key);
    const categoryId=positive(item.categoryID)?String(item.categoryID):null;
    byID.get(owner).items.push({id:key,typeId:String(item.typeID),categoryId,quantity:quantity(item),locationId:String(item.locationID)});
  }
  for(const player of players){
    if(!itemIds.has(player.shipId))throw Error('Active player ship missing from authoritative owned items');
    player.items.sort((a,b)=>a.id.localeCompare(b.id));
  }
  const capturedAt=now();
  if(!Number.isFinite(Date.parse(capturedAt))||Date.parse(capturedAt)<Date.parse(meta.runtime.containerStartedAt)) throw Error('Invalid capturedAt vs real Docker start');
  return {source:'native-authoritative-export',projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,capturedAt,runtime:meta.runtime,characters:players};
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!['--meta-base64','--characters'].includes(key)||!argv[i+1]||args[key])throw Error('Invalid native exporter CLI option');args[key]=argv[i+1];}
  if(!args['--meta-base64']||!args['--characters'])throw Error('Expected --meta-base64 and --characters');
  const meta=JSON.parse(Buffer.from(args['--meta-base64'],'base64').toString('utf8'));
  const characterIds=args['--characters'].split(',');
  verifyInput(meta,characterIds);
  return {meta,characterIds};
}
function cli(argv=process.argv.slice(2)){
  const {meta,characterIds}=parseArgs(argv);
  if(!fs.existsSync(base))throw Error('Native EveJS SQLite DB missing at expected mounted volume path');
  const Database=require('/app/server/node_modules/better-sqlite3');
  const db=new Database(base,{readonly:true,fileMustExist:true});
  try{
    db.pragma('query_only = ON');
    // One read transaction guarantees an internally consistent snapshot of
    // both tables even if concurrent player operations are happening.
    db.exec('BEGIN');
    try{
      const charStmt=db.prepare('SELECT json FROM "characters" WHERE key = ?');
      const itemStmt=db.prepare('SELECT key, json FROM "items"');
      const snapshot=buildSnapshot({meta,characterIds,readCharacter:id=>{
        const row=charStmt.get(id);return row?JSON.parse(row.json):null;
      },iterateItems:()=>itemStmt.iterate()});
      process.stdout.write(JSON.stringify(snapshot)+'\n');
    }finally {db.exec('ROLLBACK');}
  }finally{db.close();}
}
// Node's `node -` stdin execution has no require.main; the Windows Docker
// capture runner depends on this explicit, narrowly scoped entrypoint.
if(require.main===module || (process.argv[1]==='-' && !require.main)){
  try{cli();}catch(error){console.error('[NATIVE_SNAPSHOT_BLOCKED]',error.message);process.exitCode=2;}
}
module.exports={buildSnapshot,moneyToCents,quantity,verifyInput,parseArgs};