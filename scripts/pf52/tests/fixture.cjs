'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPersonalFleetHangarBridge,REGISTRY_KEY}=require('../native/coopPersonalFleetHangarBridge.cjs');
function openFixture(file){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS corporationRuntime (key TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS items (key TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS characters (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const statement=(table)=>{if(!['items','corporationRuntime','characters'].includes(table))throw Error('FOREIGN_TABLE');return '"'+table+'"'};
 let poison=false;
 const gameStore={coopAtomicNativeRows:{isPoisoned:()=>poison,transact(tables,fn){
  if(tables.length!==new Set(tables).size||!tables.every(x=>['items','corporationRuntime','characters'].includes(x)))throw Error('BAD_TABLES');
  db.exec('BEGIN IMMEDIATE');try{
   const tx={get(t,k){const r=db.prepare('SELECT json FROM '+statement(t)+' WHERE key=?').get(k);return r?JSON.parse(r.json):null;},put(t,k,value){db.prepare('INSERT INTO '+statement(t)+'(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(value));},scan(t){return db.prepare('SELECT key,json FROM '+statement(t)).all().map(x=>({key:x.key,value:JSON.parse(x.json)}));}};
   const outcome=fn(tx);if(outcome&&typeof outcome.then==='function')throw Error('ASYNC_NOT_SUPPORTED');
   db.exec('COMMIT');return outcome;
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }}};
 const get=(table,key)=>{let v=db.prepare(`SELECT json FROM ${statement(table)} WHERE key=?`).get(key);return v?JSON.parse(v.json):null;};
 const put=(table,key,data)=>db.prepare(`INSERT INTO ${statement(table)}(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(key,JSON.stringify(data));
 const permissions={isOwner:(session,owner)=>session?.characterID===owner&&session?.userid===77};
 const options={gameStore,access:permissions,enabled:()=>true,allWritersFenced:()=>true,
 verifyPaidHire:(cmd,tx)=>{let p=tx.get('corporationRuntime','paidHire:'+cmd.contractID);return p?.nativeStatus==='PAID'&&p?.pilotID===cmd.pilotID&&p?.ownerCharacterID===cmd.ownerCharacterID&&p?.receiptHash===cmd.hireReceiptHash;},
 verifyShipAvailable:(cmd,tx)=>tx.get('corporationRuntime','busyShip:'+cmd.shipItemID)===null,
 verifyRelease:(cmd,tx)=>tx.get('corporationRuntime','deployed:'+cmd.shipItemID)===null};
 return {db,gameStore,permissions,options,put,get,bridge:createPersonalFleetHangarBridge(options),setPoisoned:v=>{poison=v},close:()=>db.close()};
}
function tempDb(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf52-'));return {dir,file:path.join(dir,'game.sqlite'),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};}
function session(owner=9){return {characterID:owner,userid:77,socket:{destroyed:false}};}
const base=(owner=9)=>({session:session(owner),ownerCharacterID:owner,pilotID:'coop-pilot-123',expectedRosterRevision:0});
const HASH='a'.repeat(64);
function hire(overrides={}){return {...base(),type:'IMPORT_PAID_HIRE',operationID:'hire-1',contractID:'contract-1',hireReceiptHash:HASH,...overrides};}
function reserve(overrides={}){return {...base(),type:'RESERVE_HANGAR_SHIP',operationID:'assign-1',expectedRosterRevision:1,shipItemID:1001,stationID:600001,assignmentID:'assignment-1',expectedPilotRevision:0,...overrides};}
function release(overrides={}){return {...reserve(),type:'RELEASE_HANGAR_SHIP',operationID:'release-1',expectedRosterRevision:2,expectedPilotRevision:1,expectedGeneration:1,...overrides};}
function item(overrides={}){return {itemID:1001,ownerID:9,locationID:600001,flagID:4,categoryID:6,quantity:-1,stacksize:1,singleton:1,typeID:606,shipID:1001,shipTypeID:606,spaceState:null,...overrides};}
function seed(f){f.put('items','1001',item());f.put('corporationRuntime','paidHire:contract-1',{nativeStatus:'PAID',pilotID:'coop-pilot-123',ownerCharacterID:9,receiptHash:HASH});}
function hired(f){seed(f);const r=f.bridge.execute(hire());if(r.status!=='APPLIED')throw Error('HIRE_FAILED '+JSON.stringify(r));return r;}
function assigned(f){hired(f);const r=f.bridge.execute(reserve());if(r.status!=='APPLIED')throw Error('ASSIGN_FAILED '+JSON.stringify(r));return r;}
module.exports={openFixture,tempDb,session,base,hire,reserve,release,item,seed,hired,assigned,HASH,REGISTRY_KEY};