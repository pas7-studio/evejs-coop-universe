#!/usr/bin/env node
'use strict';
// COOP-043: opt-in, stopped-server-only SQLite community fitting catalog seeder.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const {OWNER,PIN,loadSde,validateFit,propose}=require('./coop-community-fittings.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function args(argv) {
  const out={};
  for(let i=0;i<argv.length;i++) {
    const m=argv[i].match(/^--([a-z0-9-]+)(?:=(.*))?$/);
    if(!m) throw Error(`UNKNOWN_ARGUMENT ${argv[i]}`);
    out[m[1]]=m[2]===undefined?(argv[++i]||''):m[2];
  }
  for(const key of Object.keys(out))if(!['mode','sde','db','code-path','catalog','container','backup-dir','approve-sha256','allow-over-600','confirm-stopped'].includes(key))throw Error(`UNKNOWN_OPTION ${key}`);
  for(const k of ['mode','sde','db','code-path','catalog'])if(!out[k])throw Error(`REQUIRED --${k}`);
  if(!['plan','apply'].includes(out.mode))throw Error('MODE_MUST_BE_PLAN_OR_APPLY');
  if(out.mode==='apply')for(const k of ['container','backup-dir','approve-sha256','confirm-stopped'])if(!out[k])throw Error(`REQUIRED_ON_APPLY --${k}`);
  return out;
}
function inspectStopped(container) {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/.test(container))throw Error('INVALID_CONTAINER_NAME');
  const state=cp.execFileSync('docker',['inspect','--format','{{.State.Running}}',container],{encoding:'utf8',timeout:15000}).trim();
  if(state!=='false')throw Error(`SERVER_MUST_BE_STOPPED ${state}`);
}
function readCurrent(db) {
  const migrated=db.prepare("SELECT 1 FROM _migrations WHERE table_name='savedFittings'").get();
  if(!migrated)throw Error('SAVED_FITTINGS_NOT_MIGRATED');
  const unresolved=db.prepare("SELECT COUNT(*) AS n FROM _persistence_outbox WHERE table_name='savedFittings'").get();
  if(unresolved.n!==0)throw Error('UNRESOLVED_SAVED_FITTINGS_OUTBOX');
  const get=db.prepare('SELECT json FROM savedFittings WHERE key = ?');
  const meta=get.get('_meta'); const root={_meta:meta?JSON.parse(meta.json):{version:1,nextFittingID:1},owners:{}};
  const rows=db.prepare("SELECT key,json FROM savedFittings WHERE key LIKE 'owners' || char(31) || '%'").all();
  for(const row of rows) {
    const ownerId=row.key.slice('owners\u001f'.length);
    if(!/^\d+$/.test(ownerId))throw Error('CORRUPTED_OWNER_KEY');
    root.owners[ownerId]=JSON.parse(row.json);
  }
  // The legacy single-row owners wrapper is unsupported: fail rather than discard it.
  const skeleton=get.get('owners');
  if(skeleton && Object.keys(JSON.parse(skeleton.json)).length>0)throw Error('UNEXPECTED_OWNERS_WRAPPER_FORMAT');
  return root;
}
function validateCatalog(catalog,sde) {
  if(!Array.isArray(catalog.records)||!catalog.records.length)throw Error('EMPTY_CATALOG');
  if(catalog.records.length>5000)throw Error('CATALOG_HARD_LIMIT');
  for(const fit of catalog.records) {
    const check=validateFit(fit,sde);
    if(!check.ok || JSON.stringify(check.fitData)!==JSON.stringify(fit.fitData))throw Error(`INVALID_FIT ${fit.shipTypeID} ${check.reason||'NON_CANONICAL'}`);
  }
  return true;
}
async function run(opts) {
  const f=fs.readFileSync(path.resolve(opts.catalog));
  if(f.byteLength>10_000_000)throw Error('CATALOG_FILE_TOO_LARGE');
  const catalog=JSON.parse(f.toString('utf8'));
  if(catalog.sdePin!==PIN)throw Error('UPSTREAM_PIN_MISMATCH');
  const digest=hash(f);
  const sde=loadSde(path.resolve(opts.sde));
  validateCatalog(catalog,sde);
  if(catalog.records.length>600 && opts['allow-over-600']!=='yes')throw Error('OVER_600_REQUIRES_EXPLICIT_APPROVAL_AND_CLIENT_QA');
  const codePath=path.resolve(opts['code-path']);
  if(!fs.existsSync(path.join(codePath,'server','src','_secondary','fitting','fittingStore.js')))throw Error('EVEJS_CODE_PATH_INVALID');
  const pinFile=path.join(codePath,'..','.git');
  if(!fs.existsSync(pinFile))throw Error('UPSTREAM_GIT_CHECKOUT_REQUIRED');
  const commit=cp.execFileSync('git',['-C',path.dirname(codePath),'rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
  if(commit!==PIN)throw Error(`PIN_MISMATCH ${commit}`);
  const dbPath=path.resolve(opts.db);
  if(opts.mode==='apply') {
    if(opts['approve-sha256']!==digest||opts['confirm-stopped']!=='yes')throw Error('PLAN_HASH_OR_SERVER_STOP_CONFIRMATION_REQUIRED');
    inspectStopped(opts.container); // Before even opening DB in write mode.
  }
  if(!fs.existsSync(dbPath))throw Error('DB_NOT_FOUND');
  const BetterSqlite3=require(require.resolve('better-sqlite3',{paths:[path.join(codePath,'server')]}));
  const db=new BetterSqlite3(dbPath,{readonly:opts.mode==='plan',fileMustExist:true});
  try {
    const state=readCurrent(db), plan=propose(state,catalog);
    const result={mode:opts.mode,pin:PIN,catalogSha256:digest,source:catalog.source,coverage:catalog.summary,
      dogmaValidated:Boolean(sde.dogma),currentCommunity:plan.report.existing,afterCommunity:Object.keys(plan.owner.fittings).length,changes:plan.report,
      warning:'Native client behavior with >600 entries is unverified; every record passed pinned-SDE dogma validation.'};
    if(opts.mode==='plan') {console.log(JSON.stringify(result,null,2));return result;}
    if(opts['approve-sha256']!==digest||opts['confirm-stopped']!=='yes')throw Error('PLAN_HASH_OR_SERVER_STOP_CONFIRMATION_REQUIRED');
    inspectStopped(opts.container);
    const backupDir=path.resolve(opts['backup-dir']);
    if(backupDir===path.dirname(dbPath)||backupDir.startsWith(path.dirname(dbPath)+path.sep))throw Error('BACKUP_MUST_BE_OUTSIDE_GAMESTORE');
    fs.mkdirSync(backupDir,{recursive:true});
    const backupPath=path.join(backupDir,`coop043-${Date.now()}-${process.pid}.sqlite`);
    await db.backup(backupPath);
    const backup=new BetterSqlite3(backupPath,{readonly:true,fileMustExist:true});
    try{const check=backup.pragma('quick_check');if(check[0]?.quick_check!=='ok')throw Error('BACKUP_QUICK_CHECK_FAILED');}
    finally{backup.close();}
    // Recheck Docker immediately before DB transaction. Abort if it has restarted.
    inspectStopped(opts.container);
    db.pragma('busy_timeout = 1000');
    const txn=db.transaction(()=>{
      const fresh=readCurrent(db), replan=propose(fresh,catalog);
      if(JSON.stringify(replan.report)!==JSON.stringify(plan.report))throw Error('DB_CHANGED_SINCE_PLAN');
      const upsert=db.prepare('INSERT INTO savedFittings(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json');
      upsert.run('owners\u001f'+OWNER,JSON.stringify(replan.owner));
      upsert.run('owners',JSON.stringify({}));
      upsert.run('_meta',JSON.stringify({...fresh._meta,nextFittingID:replan.next}));
    });
    txn.immediate();
    console.log(JSON.stringify({...result,backupPath,applied:true},null,2));
    return {...result,backupPath,applied:true};
  }finally{db.close();}
}
if(require.main===module)run(args(process.argv.slice(2))).catch(e=>{console.error(`SEED_FAILED ${e.message}`);process.exitCode=1;});
module.exports={args,inspectStopped,readCurrent,validateCatalog,run};