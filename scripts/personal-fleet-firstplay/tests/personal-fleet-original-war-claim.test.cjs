'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalWarClaim.js'),'utf8');
const SEP='\u001f',KEY='coop-faction-war'+SEP+'fleet-registry-v1';
const TABLE='corporationRuntime';
function fixture({absent=false,unknown=false,corrupt=false,poisoned=false,
 sourceMissing=false}={}){
 const link={systemID:30000142,entityID:2501,pilotID:'coop-pilot-3011234'};
 const state={version:1,ships:{},processed:{},history:[]};
 const calls=[],writable=[];
 let readFailure=false,p=poisoned;
 const origin={
  TABLE,KEY,empty:()=>({version:1,ships:{},processed:{},history:[]}),
  validate:s=>{
   if(s?.version!==1||!s.ships||Array.isArray(s.ships)||
      !s.processed||!Array.isArray(s.history))throw Error('FW_REGISTRY_INVALID');
   return s;
  }};
 if(sourceMissing)origin.KEY='foreign-key';
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>p,
  transact:(tables,fn)=>{
   calls.push([...tables]);
   if(readFailure)throw Error('SQLITE_READ_UNCERTAIN');
   return fn({get:(t,k)=>{
    a.equal(t,TABLE);a.equal(k,KEY);
    if(unknown)return undefined;
    if(absent)return null;
    if(corrupt)return {version:17,ships:[]};
    return state;
   },put:()=>writable.push('put'),del:()=>writable.push('del')});
  }};
 const m={exports:{}},deps={
  '../gameStore':{coopAtomicNativeRows:atomic},
  './coopWarFleetRegistry':origin};
 vm.runInNewContext(source,{module:m,exports:m.exports,require:name=>{
  if(!(name in deps))throw Error('PF103_UNKNOWN_IMPORT:'+name);
  return deps[name];
 },Object,Number,Array,Error},{filename:'PF103-war.js'});
 const create=()=>m.exports.createOriginalWarClaim();
 return {create,link,state,calls,writable,poison:()=>p=true,
  readFail:()=>readFailure=true};
}
test('PF103 proven original empty WAR fleet row does not reserve Personal Fleet hull',()=>{
 const f=fixture({absent:true});
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNASSIGNED');
 a.deepEqual(f.calls,[[TABLE]]);
});
test('PF103 identical original durable WAR ship claim is ASSIGNED',()=>{
 const f=fixture();f.state.ships['2501']={...f.link};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'ASSIGNED');
});
test('PF103 prevents reassignment of claimed WAR hull with wrong pilot',()=>{
 const f=fixture();f.state.ships['2501']={...f.link,pilotID:'coop-pilot-999999'};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 WAR ship in different system remains conflict',()=>{
 const f=fixture();f.state.ships['2501']={...f.link,systemID:30000144};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 pilot reserved on another original WAR hull is ambiguous',()=>{
 const f=fixture();f.state.ships['2601']={...f.link,entityID:2601};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 native WAR transfer PREPARED remains exclusive unknown',()=>{
 const f=fixture();f.state.ships['2501']={...f.link};
 f.state.transfers={'2501':{phase:'PREPARED'}};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 native WAR transfer NATIVE_COMMITTED remains unknown',()=>{
 const f=fixture();f.state.ships['2501']={...f.link};
 f.state.transfers={'2501':{phase:'NATIVE_COMMITTED'}};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 original retired transfer can preserve WAR assigned source',()=>{
 const f=fixture();f.state.ships['2501']={...f.link};
 f.state.transfers={'2501':{phase:'COMPLETE'}};
 a.equal(f.create().readOriginalWarShipClaim(f.link),'ASSIGNED');
});
test('PF103 unknown original SQLite key is not an empty registry',()=>{
 const f=fixture({unknown:true});
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 corrupted original durable WAR row fails closed',()=>{
 const f=fixture({corrupt:true});
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 poisoned GameStore prevents original WAR custody proof',()=>{
 const f=fixture({poisoned:true});
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
 a.equal(f.calls.length,0);
});
test('PF103 original SQL read exception never clears WAR reservation',()=>{
 const f=fixture();f.readFail();
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
test('PF103 malformed identity never reads original WAR registry',()=>{
 const f=fixture();
 a.equal(f.create().readOriginalWarShipClaim({...f.link,pilotID:'fake'}),'UNKNOWN');
 a.equal(f.create().readOriginalWarShipClaim({...f.link,entityID:0}),'UNKNOWN');
 a.equal(f.calls.length,0);
});
test('PF103 source does not mutate original WAR ships or cash',()=>{
 const f=fixture();f.state.ships['2501']={...f.link};
 const before=JSON.stringify(f.state);
 a.equal(f.create().readOriginalWarShipClaim(f.link),'ASSIGNED');
 a.equal(JSON.stringify(f.state),before);
 a.deepEqual(f.writable,[]);
});
test('PF103 rejects a substituted original WAR registry module',()=>{
 const f=fixture({sourceMissing:true});
 a.throws(()=>f.create(),/PF103_ORIGINAL_WAR_SQLITE_REGISTRY_REQUIRED/);
});
test('PF103 original poisoned state during transaction is unknown',()=>{
 const f=fixture();f.state.ships['2501']={...f.link};
 f.poison();
 a.equal(f.create().readOriginalWarShipClaim(f.link),'UNKNOWN');
});
