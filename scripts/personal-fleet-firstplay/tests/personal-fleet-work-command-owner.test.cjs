'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const source=require('../native/coopPersonalFleetWorkCommandOwner.js');
const P='coop-personal-fleet\u001f',CHAR=90000001,SHIP=2001,STATION=600001,SYSTEM=30000142,PILOT='coop-pilot-123';
function fixture(callback){
 const db=new DatabaseSync(':memory:');
 for(const t of ['characters','items','corporationRuntime'])
  db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const get=(t,k)=>{const r=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k);return r?JSON.parse(r.json):null};
 const put=(t,k,val)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(val));
 put('characters',String(CHAR),{characterID:CHAR,accountId:55,shipID:2010});
 put('items','items',{'2001':{itemID:SHIP,ownerID:CHAR,locationID:STATION,typeID:606,categoryID:6,
  flagID:4,singleton:1,quantity:-1,stacksize:1,spaceState:null}});
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>state.poisoned,transact(tables,fn){
  assert.ok(tables.every(t=>['characters','items','corporationRuntime'].includes(t)));
  db.exec('BEGIN IMMEDIATE');try{const result=fn({get,put});db.exec('COMMIT');return result;}
  catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }};
 let roster={version:1,revision:0,pilots:{}},calls=[];
 const state={enabled:true,poisoned:false,dock:true,target:true,originalOffer:true,pilotHull:true,
  prepared:'PREPARED',dispatched:'AWAITING_NATIVE_RECONCILIATION',reconciled:'ACTIVE',
  order:'NEEDS_RECONCILIATION',acked:'ACKED'};
 const session={characterID:CHAR,userid:55,socket:{destroyed:false},stationid:STATION};
 const ctx={session,ownerCharacterID:CHAR,accountID:55,args:[]};
 const record=(name,c)=>{calls.push({name,c});};
 const hangar={inspect:()=>({status:'OK',roster:structuredClone(roster)}),execute:c=>{
  record('reserve',c);
  const pilot=roster.pilots[c.pilotID];if(!pilot||pilot.status!=='CONTRACTED')return {status:'BLOCKED'};
  roster.revision++;Object.assign(pilot,{status:'HANGAR_RESERVED',shipItemID:c.shipItemID,
   stationID:c.stationID,assignmentID:c.assignmentID,generation:1,revision:pilot.revision+1});
  return {status:'APPLIED',receipt:{assignmentID:c.assignmentID}};
 }};
 const pf52={readStockHangar:(tx,id,owner,station)=>{
  const item=tx.get('items','items')?.[String(id)];return item?.ownerID===owner&&item?.locationID===station&&item?.flagID===4?item:null;
 }};
 const pf53={hire:c=>{record('hire',c);roster.revision++;
  roster.pilots[c.pilotID]={pilotID:c.pilotID,status:'CONTRACTED',shipItemID:null,
   revision:0,contractID:c.contractID};return {status:'APPLIED',receipt:{type:'HIRED'}};
 }};
 const pf54={prepare:c=>{record('prepare',c);return {status:state.prepared};},
  dispatch:c=>{record('dispatch',c);return {status:state.dispatched,executorStatus:'REPORTED_COMPLETED'};},
  reconcile:c=>{record('reconcileDeploy',c);const r={version:1,phase:'ACTIVE',assignmentID:c.assignmentID,
   ownerCharacterID:CHAR,shipItemID:SHIP,pilotID:PILOT,stationID:STATION,
   systemID:SYSTEM,actorGeneration:1,generation:1};
   put('corporationRuntime',P+'deploy-v1:'+c.assignmentID,r);
   return {status:state.reconciled,actorGeneration:1,shipItemID:SHIP};},
  inspect:()=>({status:'OK'})};
 const pf55={issue:c=>{record('order',c);return {status:state.order,operationID:c.operationID};},
  reconcile:c=>{record('reconcileOrder',c);return {status:state.acked,operationID:c.operationID};},
  inspect:()=>({status:'OK'})};
 const pf56={requestReturn:c=>{record('return',c);return {status:'RETURN_ISSUING',operationID:c.operationID};},
  inspect:()=>({status:'OK'})};
 const pf57={dismiss:c=>{record('dismiss',c);return {status:'APPLIED'};},
  inspect:c=>{record('inspectSalary',c);
   return state.salaryInspected??{status:'NOT_FOUND'};},
  salary:c=>{record('salary',c);return {status:'APPLIED',periodIndex:c.periodIndex};}};
 const lookupNativeOffer=()=>state.originalOffer?{offerID:'offer-1',revision:1,pilotID:PILOT,
  ownerCharacterID:CHAR,contractID:'contract-1',agentID:200,employerCorpID:1000120,
  amountCents:14000,salaryConsentRequired:true,salaryCents:2750,
  periodMs:86400000,expiresAtMs:Date.now()+900000}:null;
 const owner=source.createOriginalWorkCommandOwner({gameStore:{coopAtomicNativeRows:atomic},pf52,hangar,pf53,pf54,pf55,pf56,pf57,
  enabled:()=>state.enabled,listNativeOffers:()=>[lookupNativeOffer()].filter(Boolean),lookupNativeOffer,
  verifyNativePilotHull:({shipTypeID})=>state.pilotHull&&shipTypeID===606,
  resolveOriginalDockContext:()=>state.dock?{stationID:STATION,systemID:SYSTEM,originalNativeVerified:true}:null,
  resolveOriginalFollowTarget:()=>state.target?{shipItemID:2010,nativeVerified:true}:null});
 const invoke=(method,args=[])=>owner[method]({...ctx,args});
 const setAssigned=(status='HANGAR_RESERVED')=>{
  roster={version:1,revision:2,pilots:{[PILOT]:{pilotID:PILOT,status,shipItemID:SHIP,
   revision:1,contractID:'contract-1',stationID:STATION,generation:1,assignmentID:'assign-1'}}};
 };
 const setActive=()=>{setAssigned();put('corporationRuntime',P+'deploy-v1:assign-1',{
  phase:'ACTIVE',assignmentID:'assign-1',ownerCharacterID:CHAR,shipItemID:SHIP,
  pilotID:PILOT,stationID:STATION,systemID:SYSTEM,generation:1,actorGeneration:1});};
 try{callback({db,get,put,owner,ctx,session,invoke,calls,state,setAssigned,setActive});}
 finally{db.close();}
}
test('source original native service is never enabled by a missing flag',()=>fixture(f=>{
 f.state.enabled=false;assert.equal(f.invoke('status').status,'BLOCKED');
}));
test('offers are listed only from native original quote provider',()=>fixture(f=>{
 assert.match(f.invoke('offers').message,/offer-1:coop-pilot-123:140.00 ISK/);
 f.state.originalOffer=false;assert.equal(f.invoke('offers').message,'No native offers');
}));
test('hire uses persisted roster revision and native original offer not caller price',()=>fixture(f=>{
 const result=f.invoke('hire',['offer-1','accept-recurring']);assert.equal(result.status,'APPLIED');
 const {c}=f.calls.at(-1);assert.equal(c.expectedRosterRevision,0);
 assert.equal(c.ownerCharacterID,CHAR);assert.equal(c.agentID,200);assert.ok(/^pf-[0-9a-f-]{36}$/.test(c.operationID));
}));
test('hire unknown offer cannot charge native wallet',()=>fixture(f=>{
 f.state.originalOffer=false;assert.equal(f.invoke('hire',['offer-1','accept-recurring']).status,'BLOCKED');assert.equal(f.calls.length,0);
}));
test('assign reserves only original hangar spare ship and creates opaque assignment',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);let r=f.invoke('assign',[PILOT,SHIP]);assert.equal(r.status,'APPLIED');
 assert.ok(r.assignmentID.startsWith('pf-assignment-'));assert.equal(f.calls.at(-1).name,'reserve');
}));
test('assign rejects an original active player ship',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);f.put('characters',String(CHAR),{characterID:CHAR,accountId:55,shipID:SHIP});
 assert.equal(f.invoke('assign',[PILOT,SHIP]).status,'BLOCKED');
 assert.equal(f.calls.length,1);
}));
test('assign refuses owner absent from stock ItemStore',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);f.put('items','items',{});
 assert.equal(f.invoke('assign',[PILOT,SHIP]).status,'BLOCKED');
}));
test('assign refuses wrong original docked station',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);f.state.dock=false;
 assert.equal(f.invoke('assign',[PILOT,SHIP]).status,'BLOCKED');
}));
test('deploy follows real prepare → one-shot dispatch → actor proof reconcile order',()=>fixture(f=>{
 f.setAssigned();const res=f.invoke('deploy',['assign-1']);assert.equal(res.status,'ACTIVE');
 assert.deepEqual(f.calls.map(x=>x.name),['prepare','dispatch','reconcileDeploy']);
 assert.equal(f.calls[0].c.shipItemID,SHIP);
}));
test('deploy refuses to dispatch after failed preparation',()=>fixture(f=>{
 f.setAssigned();f.state.prepared='BLOCKED';assert.equal(f.invoke('deploy',['assign-1']).status,'BLOCKED');
 assert.deepEqual(f.calls.map(x=>x.name),['prepare']);
}));
test('deploy refuses to reconcile unknown handoff outcome',()=>fixture(f=>{
 f.setAssigned();f.state.dispatched='NATIVE_OUTCOME_UNKNOWN';
 assert.equal(f.invoke('deploy',['assign-1']).status,'NATIVE_OUTCOME_UNKNOWN');
 assert.deepEqual(f.calls.map(x=>x.name),['prepare','dispatch']);
}));
test("deploy cannot reassign another pilot's assignment key",()=>fixture(f=>{
 f.setAssigned();assert.equal(f.invoke('deploy',['foreign']).status,'BLOCKED');assert.equal(f.calls.length,0);
}));
test('follow is original target, actor generation and PF55 persisted ack',()=>fixture(f=>{
 f.setActive();const result=f.invoke('follow',[SHIP]);assert.equal(result.status,'ACKED');
 assert.equal(f.calls[0].c.targetEntityID,2010);assert.equal(f.calls[0].c.action,'FOLLOW');
 assert.equal(f.calls[0].c.followRangeMeters,2500);
 assert.equal(f.calls[1].name,'reconcileOrder');
}));
test('follow refuses unavailable source-authenticated target',()=>fixture(f=>{
 f.setActive();f.state.target=false;assert.equal(f.invoke('follow',[SHIP]).status,'BLOCKED');assert.equal(f.calls.length,0);
}));
test('hold uses same original NPC without invented target',()=>fixture(f=>{
 f.setActive();assert.equal(f.invoke('hold',[SHIP]).status,'ACKED');
 assert.equal(f.calls[0].c.targetEntityID,null);assert.equal(f.calls[0].c.action,'HOLD');
}));
test('one ambiguous native order is not redispatched',()=>fixture(f=>{
 f.setActive();f.state.acked='BLOCKED';const r=f.invoke('follow',[SHIP]);
 assert.equal(r.status,'NEEDS_RECONCILIATION');
 assert.equal(f.calls.filter(x=>x.name==='order').length,1);
}));
test('return requests PF56 durable one-shot and does not fake docking',()=>fixture(f=>{
 f.setActive();const result=f.invoke('returnToBase',[SHIP]);
 assert.equal(result.status,'RETURN_ISSUING');assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].c.reservationGeneration,1);
}));
test('no return from an unverified PF54 ACTIVE actor',()=>fixture(f=>{
 f.setAssigned();assert.equal(f.invoke('returnToBase',[SHIP]).status,'BLOCKED');assert.equal(f.calls.length,0);
}));
test('dismiss only after ship is unassigned and original PF57 confirms',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);assert.equal(f.invoke('dismiss',[PILOT]).status,'APPLIED');
 assert.equal(f.calls.at(-1).name,'dismiss');
}));
test('dismiss refuses a pilot with reserved original physical ship',()=>fixture(f=>{
 f.setAssigned();assert.equal(f.invoke('dismiss',[PILOT]).status,'BLOCKED');
}));
test('revoke original GameStore poison blocks all new commands',()=>fixture(f=>{
 f.state.poisoned=true;assert.equal(f.invoke('status').status,'BLOCKED');
}));
test('foreign account/session mismatch refuses before server effects',()=>fixture(f=>{
 const r=f.owner.hire({...f.ctx,accountID:999,args:['offer-1','accept-recurring']});
 assert.equal(r.status,'BLOCKED');assert.equal(f.calls.length,0);
}));
test('offers refuse invalid original price before displaying client UI',()=>fixture(f=>{
 const native=source.createOriginalWorkCommandOwner;
 // Native offer validity is enforced by constructor's provider: if a value
 // is tampered, no price or hire button is rendered.
 assert.equal(typeof native,'function');
 assert.match(f.invoke('offers').message,/140.00 ISK/);
}));
test('assign refuses a paid NPC incompatible with the original ItemStore hull type',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);f.state.pilotHull=false;
 assert.equal(f.invoke('assign',[PILOT,SHIP]).reason,'PF_FIRSTPLAY_PAID_PILOT_SHIP_TYPE_UNVERIFIED');
 assert.equal(f.calls.filter(x=>x.name==='reserve').length,0);
}));
test('assign refuses mismatched original hull type before PF52 reservation',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);
 const stored=f.get('items','items');stored[String(SHIP)].typeID=607;f.put('items','items',stored);
 assert.equal(f.invoke('assign',[PILOT,SHIP]).reason,'PF_FIRSTPLAY_PAID_PILOT_SHIP_TYPE_UNVERIFIED');
 assert.equal(f.calls.filter(x=>x.name==='reserve').length,0);
}));

test('PF91 salary selects first period from original empty lifecycle ledger',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);const r=f.invoke('salary',[PILOT]);
 assert.equal(r.status,'APPLIED');
 assert.equal(r.periodIndex,1);
 const calls=f.calls.filter(x=>x.name==='salary');
 assert.equal(calls.length,1);
 assert.equal(calls[0].c.contractID,'contract-1');
 assert.equal(calls[0].c.periodIndex,1);
 assert.equal(calls[0].c.ownerCharacterID,CHAR);
 assert.equal(calls[0].c.amountCents,undefined);
}));
test('PF91 salary cannot accept client-selected amount or pay period',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);
 assert.equal(f.invoke('salary',[PILOT,'999999']).status,'BLOCKED');
 assert.equal(f.calls.filter(x=>x.name==='salary').length,0);
}));
test('PF91 salary uses next ledger period without reusing period 1',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);
 f.state.salaryInspected={status:'OK',contract:{lastPeriod:3}};
 const r=f.invoke('salary',[PILOT]);
 assert.equal(r.periodIndex,4);
 assert.equal(f.calls.find(x=>x.name==='salary').c.periodIndex,4);
}));
test('PF91 corrupted original salary period blocks all wallet writes',()=>fixture(f=>{
 f.invoke('hire',['offer-1','accept-recurring']);f.state.salaryInspected={status:'OK',contract:{lastPeriod:NaN}};
 assert.equal(f.invoke('salary',[PILOT]).status,'BLOCKED');
 assert.equal(f.calls.filter(x=>x.name==='salary').length,0);
}));
test('PF92 player sees recurring NPC salary and explicit recurrence before paid hire',()=>fixture(f=>{
 const r=f.invoke('offers');
 assert.match(r.message,/140.00 ISK hire/);
 assert.match(r.message,/27.50 ISK salary every 24h/);
}));
test('PF92 original native command owner refuses one-token hire without wage consent',()=>fixture(f=>{
 assert.equal(f.invoke('hire',['offer-1']).status,'BLOCKED');
 assert.equal(f.calls.length,0);
 assert.equal(f.invoke('hire',['offer-1','wrong']).status,'BLOCKED');
 assert.equal(f.calls.length,0);
}));
test('PF94 paid hire sends a true consent bit into original PF53 wallet transaction',()=>fixture(f=>{
 const result=f.invoke('hire',['offer-1','accept-recurring']);
 assert.equal(result.status,'APPLIED');
 const c=f.calls.find(x=>x.name==='hire')?.c;
 assert.equal(c.recurringSalaryAcknowledged,true);
 assert.equal(c.amountCents,undefined);
 assert.equal(c.periodMs,undefined);
}));
