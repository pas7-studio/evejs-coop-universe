import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPlayerMiningCompany}=require('../integration/coopPlayerMiningCompany.cjs');
const OP='coop-mining-shift:'+'a'.repeat(32);
const OP2='coop-mining-shift:'+'b'.repeat(32);
const CORP=9001,NPC=9002,SYSTEM=30000144,FLEET=960004609;
function company(balance=200,employerBalance=25){
 const wallets=new Map();
 const mk=(id,isNPC,amount)=>({corporationID:id,isNPC,wallet:{divisions:{'1000':{
  balance:amount,journal:[],transactions:[]}}}});
 wallets.set('corporations\u001f'+CORP,mk(CORP,false,balance));
 wallets.set('corporations\u001f'+NPC,mk(NPC,true,employerBalance));
 const fleet={systemID:SYSTEM,fleetID:FLEET,ownerID:NPC,minerIDs:[1101,1102],haulerIDs:[1103]};
 let rights={member:true,industry:true,wallet:true},native=true,failAt=0,commitCount=0;
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,transact(tables,fn){
  assert.deepEqual(tables,['corporationRuntime']);
  const snapshot=new Map([...wallets].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get(table,key){return wallets.get(key)||null;},
   put(table,key,value){wallets.set(key,structuredClone(value));if(++commitCount===failAt)throw Error('CRASH_IN_WRITE');},
   scan(table){return [...wallets].map(([key,value])=>({key,value}));}};
  try{return fn(tx);}catch(error){wallets.clear();for(const [k,v] of snapshot)wallets.set(k,v);throw error;}
 }};
 const store={coopAtomicNativeRows:atomic};
 const access={isMember:()=>rights.member,canIndustry:()=>rights.industry,canWallet:()=>rights.wallet};
 const service=flag=>createPlayerMiningCompany({gameStore:store,access,
  getFleet:()=>structuredClone(fleet),verifyNativeFleet:()=>native,
  verifyNpcCorporation:(id,r)=>id===NPC&&r?.corporationID===id&&r?.isNPC===true,
  quoteWage:({employerCorpID,fleet,cycles})=>({employerCorpID,
   fleetID:fleet.fleetID,cycles,wageCents:12345}),
  clock:()=>1793030000000,enabled:()=>flag});
 const hire=(api,operationID=OP,extra={})=>api.hire({session:{characterID:111},
  corporationID:CORP,employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET,cycles:10,operationID,...extra});
 const balanceOf=id=>wallets.get('corporations\u001f'+id).wallet.divisions['1000'].balance;
 return {service,hire,balanceOf,wallets,fleet,rights,setNative:x=>native=x,setFailAt:x=>failAt=x};
}
test('OFF by default: nothing moves',()=>{
 const x=company(),r=x.hire(x.service(false));
 assert.equal(r.reason,'MINING_COMPANY_DISABLED');assert.equal(x.balanceOf(CORP),200);
});
test('funds existing miner + hauler in one native corporate transaction',()=>{
 const x=company(),r=x.hire(x.service(true));
 assert.equal(r.status,'FUNDED');assert.equal(r.wageCents,12345);
 assert.equal(x.balanceOf(CORP),76.55);assert.equal(x.balanceOf(NPC),148.45);
 const saved=x.wallets.get('coopPlayerMiningShift\u001f'+OP);
 assert.equal(saved.status,'FUNDED');assert.deepEqual(saved.minerIDs,[1101,1102]);
 assert.deepEqual(saved.haulerIDs,[1103]);
 for(const id of [CORP,NPC]){
  const w=x.wallets.get('corporations\u001f'+id).wallet.divisions['1000'];
  assert.equal(w.transactions.length,1);assert.equal(w.journal.length,1);
 }
});
test('idempotent replay changes neither wallet nor receipts',()=>{
 const x=company(),s=x.service(true);assert.equal(x.hire(s).status,'FUNDED');
 assert.equal(x.hire(s).status,'ALREADY_FUNDED');assert.equal(x.balanceOf(CORP),76.55);
 assert.equal(x.wallets.get('corporations\u001f'+NPC).wallet.divisions['1000'].journal.length,1);
});
test('same fleet cannot receive two funded contracts',()=>{
 const x=company(),s=x.service(true);assert.equal(x.hire(s).status,'FUNDED');
 const r=x.hire(s,OP2);assert.equal(r.status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(r.reason,'MINING_FLEET_ALREADY_CONTRACTED');assert.equal(x.balanceOf(CORP),76.55);
});
test('native member, industry and wallet rights are each mandatory',()=>{
 for(const right of ['member','industry','wallet']){
  const x=company();x.rights[right]=false;
  assert.equal(x.hire(x.service(true)).reason,'NATIVE_CORPORATION_PERMISSION_DENIED');
  assert.equal(x.balanceOf(CORP),200);
 }
});
test('wallet cannot overdraft; no phantom employer salary',()=>{
 const x=company(50),r=x.hire(x.service(true));
 assert.equal(r.reason,'MINING_COMPANY_INSUFFICIENT_ISK');
 assert.equal(x.balanceOf(CORP),50);assert.equal(x.balanceOf(NPC),25);
});
test('native entity identity/owner proof is required',()=>{
 const x=company();x.setNative(false);
 assert.equal(x.hire(x.service(true)).reason,'PHYSICAL_NATIVE_FLEET_UNVERIFIED');
 assert.equal(x.balanceOf(CORP),200);
});
test('fleet and role list cannot be forged or duplicated',()=>{
 for(const altered of [f=>f.minerIDs.push(1103),f=>f.ownerID=9999,f=>f.haulerIDs=[]]){
  const x=company();altered(x.fleet);
  assert.equal(x.hire(x.service(true)).reason,'PHYSICAL_NATIVE_FLEET_UNVERIFIED');
 }
});
test('invalid identity and terms rejected before native transact',()=>{
 const x=company(),s=x.service(true);
 for(const bad of [{operationID:'abc'},{cycles:0},{cycles:121},{employerCorpID:CORP}])
  assert.equal(x.hire(s,OP,bad).reason,'INVALID_SHIFT_REQUEST');
 assert.equal(x.balanceOf(CORP),200);
});
test('transaction failure after first wallet write rolls back all rows',()=>{
 const x=company();x.setFailAt(1);const r=x.hire(x.service(true));
 assert.equal(r.status,'NEEDS_OPERATOR_REPAIR');assert.equal(x.balanceOf(CORP),200);
 assert.equal(x.balanceOf(NPC),25);assert.equal(x.wallets.has('coopPlayerMiningShift\u001f'+OP),false);
});
test('transaction failure after both wallet writes rolls back all rows',()=>{
 const x=company();x.setFailAt(3);const r=x.hire(x.service(true));
 assert.equal(r.status,'NEEDS_OPERATOR_REPAIR');assert.equal(x.balanceOf(CORP),200);
 assert.equal(x.balanceOf(NPC),25);assert.equal(x.wallets.has('coopPlayerMiningShift\u001f'+OP),false);
});
test('tampered receipts reject replay instead of paying again',()=>{
 const x=company(),s=x.service(true);assert.equal(x.hire(s).status,'FUNDED');
 const corp=x.wallets.get('corporations\u001f'+CORP);
 corp.wallet.divisions['1000'].journal[0].amount=-1;
 assert.equal(x.hire(s).reason,'MINING_COMPANY_REPLAY_CONFLICT');
 assert.equal(x.balanceOf(CORP),76.55);
});
test('changed price on same operation is a replay conflict',()=>{
 const x=company(),s=x.service(true);assert.equal(x.hire(s).status,'FUNDED');
 const rec=x.wallets.get('coopPlayerMiningShift\u001f'+OP);rec.wageCents=1;
 assert.equal(x.hire(s).reason,'MINING_COMPANY_REPLAY_CONFLICT');
});
test('unknown native atomic state blocks the shift before debit',()=>{
 const x=company(),service=x.service(true);
 const r=x.hire(service,OP,{systemID:0});
 assert.equal(r.reason,'INVALID_SHIFT_REQUEST');assert.equal(x.balanceOf(CORP),200);
});
