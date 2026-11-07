'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalStationTickDriver.js'),'utf8');
const R={assignmentID:'job-001',operationID:'pfret-001',signature:'a'.repeat(64),phase:'RETURNING',shipItemID:1400,stationID:60000002,systemID:30000001};
function f(){let alive=true,fenced=true,poison=false,rows=[{...R}],throwTx=false,throwSample=false,calls=0,scheduled=null,cleared=0;
 let index={version:1,operations:{'pfret-001':{assignmentID:R.assignmentID,signature:R.signature,phase:'RETURN_ISSUING'}}};
 const t='coop-personal-fleet\u001freturn-dock-v1:',root='coop-personal-fleet\u001freturn-ops-v1';
 const db={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poison,transact:(names,cb)=>{
 if(throwTx)throw Error('DB_DOWN');a.deepEqual([...names],['corporationRuntime']);
 return cb({get:(kind,k)=>k===root?index:k===t+R.assignmentID?(rows.length?rows[0]:null):null});}}};
 const deps={'../gameStore':db,'./coopPersonalFleetReturnDock':{OPS:root,key:x=>t+x,signature:()=>R.signature}};
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:x=>{if(!(x in deps))throw Error('UNKNOWN_SOURCE '+x);return deps[x]},
   Object,Array,Number,Set,Map,structuredClone,setInterval,clearInterval}, {filename:'station-tick.js'});
 const driver=module.exports.createOriginalStationTickDriver({stationDwell:{sample:()=>{calls++;if(throwSample)throw Error('SAMPLE');return {status:'OBSERVED'}}},
 enabled:()=>alive,allWritersFenced:()=>fenced,scheduler:{setInterval:(cb,ms)=>{scheduled={cb,ms,unref(){}};return scheduled},clearInterval:()=>{cleared++}}});
 return {driver,db,R,rows,setRows:v=>rows=v,setIndex:v=>index=v,setAlive:v=>alive=v,setFenced:v=>fenced=v,setPoison:v=>poison=v,
 setThrowTx:v=>throwTx=v,setThrowSample:v=>throwSample=v,getCalls:()=>calls,getScheduled:()=>scheduled,getCleared:()=>cleared};}
const tt=(name,fn)=>test(name,()=>fn(f()));
tt('source tick does not start a timer during construction',f=>a.equal(f.getScheduled(),null));
tt('source tick starts exactly one 100ms unrefd server timer',f=>{
 a.equal(f.driver.start(),true);a.equal(f.getScheduled().ms,100);
 a.throws(()=>f.driver.start(),/ALREADY_STARTED/);f.driver.stop();a.equal(f.getCleared(),1);});
tt('tick samples original authorized RETURNING rows only',f=>{
 const x=f.driver.tick();a.equal(x.status,'SAMPLED');a.equal(x.observed,1);a.equal(f.getCalls(),1);});
tt('no original return index is a safe empty queue',f=>{
 f.setIndex(null);a.equal(f.driver.tick().active,0);a.equal(f.getCalls(),0);});
tt('invalid original operations index fails closed',f=>{
 f.setIndex({version:3,operations:{}});a.match(f.driver.tick().reason,/UNCERTAIN/);a.equal(f.getCalls(),0);});
tt('raw operation signature drift never delivers tick to NPC controller',f=>{
 f.setIndex({version:1,operations:{'pfret-001':{assignmentID:R.assignmentID,signature:'b'.repeat(64)}}});
 a.match(f.driver.tick().reason,/UNCERTAIN/);a.equal(f.getCalls(),0);});
tt('docked NPC is not sampled again',f=>{
 f.rows[0].phase='DOCKED';a.equal(f.driver.tick().active,0);a.equal(f.getCalls(),0);});
tt('unconfirmed RETURN_ISSUING cannot mint station dwell',f=>{
 f.rows[0].phase='RETURN_ISSUING';a.equal(f.driver.tick().active,0);a.equal(f.getCalls(),0);
});
tt('disabled native owner prevents source SQLite transaction and timer tick',f=>{
 f.setAlive(false);a.equal(f.driver.tick().status,'BLOCKED');a.equal(f.getCalls(),0);});
tt('original writer revocation prevents all NPC source calls',f=>{
 f.setFenced(false);a.equal(f.driver.tick().status,'BLOCKED');a.equal(f.getCalls(),0);});
tt('poisoned SQLite means no NPC source call',f=>{
 f.setPoison(true);a.equal(f.driver.tick().status,'BLOCKED');a.equal(f.getCalls(),0);});
tt('source SQLite failure cannot become a successful station sample',f=>{
 f.setThrowTx(true);a.equal(f.driver.tick().status,'BLOCKED');a.equal(f.getCalls(),0);});
tt('uncertain individual actor sample is never counted as physical proof',f=>{
 f.setThrowSample(true);let z=f.driver.tick();a.equal(z.observed,0);a.equal(z.blocked,1);});
tt('native station tick cannot drive docking or any command execution',f=>{
 a.equal(typeof f.driver.executeDock,'undefined');a.equal(typeof f.driver.executeReturn,'undefined');});
tt('timer callback safely catches errors and never raises to native server loop',f=>{
 f.driver.start();f.setThrowTx(true);a.doesNotThrow(()=>f.getScheduled().cb());});
tt('manual stop is idempotent but restart is forbidden',f=>{
 f.driver.start();f.driver.stop();f.driver.stop();a.throws(()=>f.driver.start(),/ALREADY_STARTED/);a.equal(f.getCleared(),1);});
