import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {record,authorize,fastFleetBookmarkAccess,verifyFleetArrival}=require('../integration/coopNativeScanProof.cjs');
const SYS=30000144;
const site=(overrides={})=>({siteID:71001,targetID:'ABC-001',
 siteKind:'signature',family:'relic',typeID:12001,
 actualPosition:{x:700000,y:800000,z:900000},...overrides});
const pilot=(id=101,ship=91001)=>({characterID:id,socket:{destroyed:false},
 _space:{shipID:ship,systemID:SYS,initialStateSent:true}});
const origin=(id=101,ship=91001)=>({characterID:id,systemID:SYS,shipID:ship});
function keyVal({id='ABC-001',certainty=1,pos=[700000,800000,900000]}={}){
 return {type:'object',name:'util.KeyVal',args:{type:'dict',entries:[
  ['id',id],['certainty',certainty],['pos',pos.map(value=>({type:'real',value}))]
 ]}};
}
const proof=(s,results=[keyVal()],places=[site()],o=origin())=>record({session:s,
 scanResult:{results},origin:o,sites:places,nowMs:100000});
const check=(s,places=[site()],time=100001)=>authorize({session:s,locationID:SYS,
 resultID:'ABC-001',sites:places,nowMs:time});
const nativeFleet={members:new Map([[101,{id:101}],[102,{id:102}]]),
 getFleetForCharacter(id){return this.members.has(id)?this:null},
 getMemberRecord(group,id){return group.members.get(id)||null}};
const bookmark=(viewOverrides={})=>({bookmark:{bookmarkID:92001,folderID:22,
 creatorID:101,locationID:SYS,x:700000,y:800000,z:900000},folder:{isPersonal:false},
 isActive:true,...viewOverrides});
test('real perfect-marshalled result with exact native location yields one bounded receipt',()=>{
 const scanner=pilot();const out=proof(scanner);
 assert.deepEqual(out,{status:'NATIVE_PROBE_SCAN_RECORDED',count:1});
 assert.equal(check(scanner).ok,true);
 assert.equal(scanner._coopNativeScanProof.shipID,91001);
 assert.equal(scanner._coopNativeScanProof.receipts[0].position.x,700000);
});
test('client-provided arbitrary/moved probe position cannot attest current native signature',()=>{
 const scanner=pilot();
 assert.equal(proof(scanner,[keyVal({pos:[1,2,3]})]).count,0);
 assert.equal(check(scanner).ok,false);
 assert.equal(proof(scanner,[keyVal({pos:[700000,800000,900000]})]).count,1);
 assert.equal(check(scanner).ok,true);
 assert.equal(check(scanner,[site({actualPosition:{x:800001,y:800000,z:900000}})]).ok,false);
});
test('same numeric site and target ID cannot reveal moved or replaced site',()=>{
 const scanner=pilot();proof(scanner);
 assert.equal(check(scanner,[site({typeID:12002})]).ok,false);
 assert.equal(check(scanner,[site({instanceID:83001})]).ok,false);
 assert.equal(check(scanner,[site({pairID:191})]).ok,false);
 assert.equal(check(scanner,[site({family:'data'})]).ok,false);
 assert.equal(check(scanner,[site({siteKind:'anomaly'})]).ok,false);
 assert.equal(check(scanner,[site({targetID:'XYZ-999'})]).ok,false);
 assert.equal(check(scanner).ok,true);
});
test('ship switch during request or before bookmarking cannot inherit another hull scan',()=>{
 const scanner=pilot();
 assert.equal(proof(scanner,[keyVal()],[site()],origin(101,99999)).count,0);
 proof(scanner);scanner._space.shipID=91009;
 assert.equal(check(scanner).ok,false);
 scanner._space.shipID=91001;
 assert.equal(check(scanner).ok,true);
});
test('reconnect, wrong system and a different pilot never inherit scan authority',()=>{
 const scanner=pilot();proof(scanner);
 assert.equal(check(pilot()).ok,false);
 assert.equal(check(pilot(102,92002)).ok,false);
 scanner._space.systemID=30000142;
 assert.equal(check(scanner).ok,false);
});
test('malformed marshalling, duplicate fields and duplicate perfect site rows fail closed',()=>{
 const scanner=pilot();
 for(const entry of [
  keyVal({certainty:0.99}),
  keyVal({certainty:'1'}),
  keyVal({certainty:Number.NaN}),
  keyVal({pos:[700000,800000,Infinity]}),
  {...keyVal(),args:{type:'dict',entries:[['id','ABC-001'],['id','ABC-001'],['certainty',1]]}},
 ]) {
  assert.equal(proof(scanner,[entry]).count,0);
  assert.equal(check(scanner).ok,false);
 }
 assert.equal(proof(scanner,[keyVal(),keyVal()]).count,0);
 assert.equal(check(scanner).ok,false);
});
test('receipt cannot be used after TTL or for a competing signature',()=>{
 const scanner=pilot();proof(scanner);
 assert.equal(check(scanner,[site()],100000+15*60*1000-1).ok,true);
 assert.equal(check(scanner,[site()],100000+15*60*1000).ok,false);
 assert.equal(authorize({session:scanner,locationID:SYS,resultID:'DEF-999',
  sites:[site(),site({siteID:71002,targetID:'DEF-999'})],nowMs:100001}).ok,false);
});
test('64 bounded native receipts; no synthetic out-of-catalog positions',()=>{
 const scanner=pilot();const many=Array.from({length:90},(_,i)=>site({siteID:100000+i,
  targetID:'SIG-'+i}));
 const entries=many.map(x=>keyVal({id:x.targetID}));
 assert.equal(proof(scanner,entries,many).count,90);
 assert.equal(scanner._coopNativeScanProof.receipts.length,64);
});
test('fleet delay exception requires pre-granted native shared folder and both current fleet members',()=>{
 const scanner=pilot(102,91002);
 assert.equal(fastFleetBookmarkAccess({session:scanner,bookmarkView:bookmark(),fleetRuntime:nativeFleet}),true);
 assert.equal(fastFleetBookmarkAccess({session:scanner,bookmarkView:bookmark({folder:{isPersonal:true}}),fleetRuntime:nativeFleet}),false);
 nativeFleet.members.delete(101);
 assert.equal(fastFleetBookmarkAccess({session:scanner,bookmarkView:bookmark(),fleetRuntime:nativeFleet}),false);
 nativeFleet.members.set(101,{id:101});
});
test('two real physical player ships at one native site + same permitted bookmark yield positive witness',()=>{
 const scanner=pilot(),peer=pilot(102,91002),mark=bookmark();
 const first={itemID:91001,kind:'ship',nativeNpc:false,pilotCharacterID:101,
  position:{x:700100,y:800100,z:900100}};
 const second={itemID:91002,kind:'ship',nativeNpc:false,pilotCharacterID:102,
  position:{x:701000,y:800000,z:900000}};
 const entities=new Map([[first.itemID,first],[second.itemID,second]]);
 const scene={systemID:SYS,sessions:new Map([[101,scanner],[102,peer]]),getEntityByID:id=>entities.get(id)};
 const args={scene,scanner,peer,scannerBookmarkView:mark,peerBookmarkView:bookmark(),
  site:site(),fleetRuntime:nativeFleet};
 assert.deepEqual(verifyFleetArrival(args),{verified:true,status:'TWO_NATIVE_SHIPS_AT_SHARED_BOOKMARK',
  systemID:SYS,bookmarkID:92001,scannerShipID:91001,peerShipID:91002});
 second.position.x+=150000;
 assert.equal(verifyFleetArrival(args).verified,false);
 second.position.x-=150000;
 entities.set(91002,{...second,nativeNpc:true});
 assert.equal(verifyFleetArrival(args).verified,false);
 entities.set(91002,second);
 assert.equal(verifyFleetArrival({...args,peerBookmarkView:bookmark({bookmark:{...bookmark().bookmark,x:999999}})}).verified,false);
});
test('read-only arrival proof never causes warp, cargo or bookmark mutations',()=>{
 const scanner=pilot(),peer=pilot(102,91002),mark=bookmark();
 const scene={systemID:SYS,sessions:new Map([[101,scanner],[102,peer]]),getEntityByID:id=>({itemID:id,kind:'ship',nativeNpc:false,
   pilotCharacterID:id===91001?101:102,position:{x:700000,y:800000,z:900000}})};
 const result=verifyFleetArrival({scene,scanner,peer,scannerBookmarkView:mark,
  peerBookmarkView:bookmark(),site:site(),fleetRuntime:nativeFleet});
 assert.equal(result.verified,true);
 assert.deepEqual(Object.keys(result).sort(),['bookmarkID','peerShipID','scannerShipID','status','systemID','verified']);
});

test('large astronomical vectors require submeter exact signature match and real scene membership',()=>{
 const scanner=pilot();const precise=site({actualPosition:{x:1e15,y:0,z:0}});
 const scan=keyVal({pos:[1e15,0,0]});
 assert.equal(proof(scanner,[scan],[precise]).count,1);
 assert.equal(check(scanner,[site({actualPosition:{x:1e15+100,y:0,z:0}})]).ok,false);
 const peer=pilot(102,91002),mark=bookmark();
 const scene={systemID:SYS,sessions:new Map([[101,scanner]]),getEntityByID:id=>({itemID:id,kind:'ship',nativeNpc:false,
  pilotCharacterID:id===91001?101:102,position:{x:700000,y:800000,z:900000}})};
 assert.equal(verifyFleetArrival({scene,scanner,peer,site:site(),fleetRuntime:nativeFleet,
  scannerBookmarkView:mark,peerBookmarkView:bookmark()}).verified,false);
});

test('disconnected scanner cannot record, redeem or access a fleet bookmark',()=>{
 const scanner=pilot();proof(scanner);scanner.socket.destroyed=true;
 assert.equal(check(scanner).ok,false);
 assert.equal(proof(scanner).count,0);
 const member=pilot(102,91002);member.socket.destroyed=true;
 assert.equal(fastFleetBookmarkAccess({session:member,bookmarkView:bookmark(),fleetRuntime:nativeFleet}),false);
});
