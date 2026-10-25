import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcPartialSettlement,TABLES}=require("../integration/coopNpcPartialFillAtomic.cjs");
const OP="npc-manufacture:0123456789abcdef0123456789abcdef";
const KEY1="npc-partial:11111111111111111111111111111111";
const KEY2="npc-partial:22222222222222222222222222222222";
const OWNER=1000010,STATION=60000001,TYPE=215,ITEM=1990000200,BUYER=90000001,ORDER=456;
const FILL1=910000000000001,FILL2=910000000000002;
const identity=(claimKey,quantity)=>({operationID:OP,claimKey,
 orderID:ORDER,ownerID:OWNER,stationID:STATION,typeID:TYPE,itemID:ITEM,quantity});
function fixture({funds=5000,failAt=null}={}){
 const row="corporations\u001f"+OWNER;
 const data={
  characters:{[BUYER]:{characterID:BUYER,balance:funds,walletJournal:[],marketTransactions:[]}},
  corporationRuntime:{[row]:{corporationID:OWNER,wallet:{divisions:{"1000":{
   balance:100,journal:[],transactions:[]}}}}},
  items:{[ITEM]:{itemID:ITEM,ownerID:OWNER,typeID:TYPE,locationID:9200000000+ORDER,
   flagID:4,singleton:0,categoryID:8,quantity:100,stacksize:100,
   customInfo:"coop-industry:v1:970000000000000"}},
  identityState:{nextItemID:1990000300},
  marketEscrow:{[ORDER]:{orderId:String(ORDER),escrowType:"sell",isCorp:true,
   ownerId:OWNER,stationId:STATION,typeId:TYPE,sourceItemID:ITEM,
   coopOperationID:OP,escrowLocationID:9200000000+ORDER,remainingQuantity:100}},
  npcMarketFills:{}
 };
 const clone=x=>structuredClone(x);
 const gameStore={transact:(tables,fn)=>{
  assert.deepEqual(tables,TABLES);
  const backup=clone(data);
  try {return fn({
   get:(t,k)=>data[t]?.[k]??null,
   scan:t=>Object.entries(data[t]).map(([key,value])=>({key,value})),
   put:(t,k,v)=>{if(failAt===t)throw Error("INJECTED_NATIVE_ROLLBACK:"+t);data[t][k]=v;},
   del:(t,k)=>{if(failAt===t)throw Error("INJECTED_NATIVE_ROLLBACK:"+t);delete data[t][k]}
  });}catch(e){for(const tbl of TABLES)data[tbl]=backup[tbl];throw e;}
 }};
 let configured={claimKey:KEY1,quantity:20,fillID:FILL1,remainingBefore:100},
  rustState="settling",rustPhase="claimed",claimCalls=0,finalizeCalls=0,
  failFinalize=false,validBuyer=true,validCorp=true;
 const rawClaim=()=>({operation_id:OP,claim_key:configured.claimKey,
  order_id:String(ORDER),owner_id:OWNER,station_id:STATION,type_id:TYPE,
  source_item_id:String(ITEM),buyer_id:String(BUYER),source:"coop-npc",
  state:rustState,fill_phase:rustPhase,is_corp:true,bid:false,
  fill_id:String(configured.fillID),fill_quantity:configured.quantity,
  remaining_before:configured.remainingBefore,price_cents:1200,
  remaining_after:configured.remainingBefore-configured.quantity,
  vol_remaining:rustPhase==="claimed"?configured.remainingBefore:
    configured.remainingBefore-configured.quantity});
 const market={
  claimPartialOnce:async()=>{claimCalls++;return rawClaim()},
  finalizePartialOnce:async()=>{finalizeCalls++;rustPhase="finalized";
   rustState=configured.remainingBefore===configured.quantity?"filled":"open";
   if(failFinalize){failFinalize=false;throw Error("LOST_PARTIAL_RUST_ACK");}
   return rawClaim();
  },
  inspectPartialClaim:async()=>rawClaim()
 };
 const bridge=createNpcPartialSettlement({gameStore,market,
  verifyBuyerSession:()=>validBuyer,verifyNpcCorporation:()=>validCorp,
  clock:()=>1761390000000});
 return {data,market,bridge,rawClaim,
  get claims(){return claimCalls},get finalizes(){return finalizeCalls},
  configure:v=>{configured=v;rustState="settling";rustPhase="claimed"},
  setBuyer:v=>{validBuyer=v},setCorp:v=>{validCorp=v},
  loseAck:()=>{failFinalize=true},
  setFault:v=>{failAt=v},
  get rustPhase(){return rustPhase}
 };
}
async function run(fn,options){
 const keys=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF",
  "EVEJS_COOP_NATIVE_NPC_PARTIAL_FILL"];
 const old=keys.map(k=>process.env[k]);
 for(const k of keys)process.env[k]="1";
 try{return await fn(fixture(options));}finally{keys.forEach((k,i)=>{
  if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];
 });}
}
const execute=(f,claimKey=KEY1,quantity=20)=>f.bridge.purchaseOnce({
 buyerID:BUYER,identity:identity(claimKey,quantity),maxPriceCents:1200});
test("native six-table partial fill creates buyer item and preserves source escrow",()=>run(async f=>{
 const r=await execute(f);
 assert.equal(r.status,"PURCHASED_PARTIAL");assert.equal(r.quantity,20);
 assert.equal(r.remainingQuantity,80);assert.equal(r.buyerItemID,1990000300);
 assert.equal(f.data.items[ITEM].quantity,80);
 assert.equal(f.data.items[ITEM].stacksize,80);
 assert.equal(f.data.items[r.buyerItemID].ownerID,BUYER);
 assert.equal(f.data.items[r.buyerItemID].quantity,20);
 assert.equal(f.data.items[r.buyerItemID].locationID,STATION);
 assert.equal(f.data.identityState.nextItemID,1990000301);
 assert.equal(f.data.marketEscrow[ORDER].remainingQuantity,80);
 assert.equal(f.data.characters[BUYER].balance,4760);
 assert.equal(f.data.corporationRuntime["corporations\u001f"+OWNER].wallet.divisions["1000"].balance,340);
 assert.equal(f.data.npcMarketFills["fill\u001f"+FILL1].phase,"NATIVE_PARTIAL_COMMITTED");
}));
test("same canonical fill on restart never debits wallets or creates a second item",()=>run(async f=>{
 await execute(f);const snapshot=structuredClone(f.data);
 assert.equal((await execute(f)).status,"PURCHASED_PARTIAL");
 assert.deepEqual(f.data,snapshot);assert.equal(f.data.characters[BUYER].walletJournal.length,1);
}));
test("consecutive independent partial fills conserve original 100 units",()=>run(async f=>{
 const first=await execute(f);
 f.configure({claimKey:KEY2,fillID:FILL2,remainingBefore:80,quantity:30});
 const second=await execute(f,KEY2,30);
 assert.equal(second.status,"PURCHASED_PARTIAL");
 assert.equal(f.data.items[ITEM].quantity,50);
 assert.equal(f.data.items[first.buyerItemID].quantity,20);
 assert.equal(f.data.items[second.buyerItemID].quantity,30);
 assert.equal(f.data.marketEscrow[ORDER].remainingQuantity,50);
 assert.equal(f.data.characters[BUYER].walletJournal.length,2);
 assert.equal(f.data.characters[BUYER].balance,4400);
}));
test("terminal remaining fill moves original source item rather than leaving zero stack",()=>run(async f=>{
 await execute(f);
 f.configure({claimKey:KEY2,fillID:FILL2,remainingBefore:80,quantity:80});
 const r=await execute(f,KEY2,80);
 assert.equal(r.status,"PURCHASED_PARTIAL");assert.equal(r.remainingQuantity,0);
 assert.equal(r.buyerItemID,ITEM);
 assert.equal(f.data.items[ITEM].ownerID,BUYER);
 assert.equal(f.data.items[ITEM].locationID,STATION);
 assert.equal(f.data.items[ITEM].quantity,80);
 assert.equal(f.data.marketEscrow[ORDER],undefined);
 assert.equal(f.data.identityState.nextItemID,1990000301);
 assert.equal(f.data.items[1990000300].quantity,20);
}));
test("lost Rust finalize ACK reuses durable receipt without double-spend",()=>run(async f=>{
 f.loseAck();
 await assert.rejects(execute(f),/LOST_PARTIAL_RUST_ACK/);
 const committed=structuredClone(f.data);
 const recovered=await execute(f);
 assert.equal(recovered.status,"PURCHASED_PARTIAL");
 assert.deepEqual(f.data,committed);
 assert.equal(f.finalizes,2);
}));
test("insufficient buyer ISK must roll back all six tables",()=>run(async f=>{
 const before=structuredClone(f.data);
 await assert.rejects(execute(f),/INSUFFICIENT_ISK/);
 assert.deepEqual(f.data,before);
},{funds:1}));
test("injected receipt storage fault rolls back item allocator, ISK and escrow",()=>run(async f=>{
 const before=structuredClone(f.data);
 await assert.rejects(execute(f),/INJECTED_NATIVE_ROLLBACK/);
 assert.deepEqual(f.data,before);
},{failAt:"npcMarketFills"}));
test("native itemID allocator must exist and never reuse a physical item",()=>run(async f=>{
 f.data.identityState.nextItemID=0;
 const before=structuredClone(f.data);
 await assert.rejects(execute(f),/ALLOCATOR_MISSING/);
 assert.deepEqual(f.data,before);
}));
test("foreign or tampered physical escrow refuses any new settlement",()=>run(async f=>{
 f.data.items[ITEM].ownerID=999;
 const before=structuredClone(f.data);
 await assert.rejects(execute(f),/SOURCE_ITEM_CONFLICT/);
 assert.deepEqual(f.data,before);
}));
test("Rust claim quantity and price must match the authoritative identity",()=>run(async f=>{
 f.market.claimPartialOnce=async()=>({...f.rawClaim(),fill_quantity:21});
 const before=structuredClone(f.data);
 await assert.rejects(execute(f),/CLAIM_IDENTITY_CHANGED/);
 assert.deepEqual(f.data,before);
}));
test("previously finalized Rust fill without GameStore receipt is unsafe",()=>run(async f=>{
 const raw=f.rawClaim();
 f.market.claimPartialOnce=async()=>({...raw,state:"open",fill_phase:"finalized"});
 await assert.rejects(execute(f),/FINALIZED_WITHOUT_NATIVE_RECEIPT/);
}));
test("counterfeit Rust receipt cannot inject a changed buyer or owner",()=>run(async f=>{
 f.market.claimPartialOnce=async()=>({...f.rawClaim(),buyer_id:"111"});
 await assert.rejects(execute(f),/CLAIM_IDENTITY_CHANGED/);
}));
test("native corporate proof is mandatory",()=>run(async f=>{
 f.setCorp(false);
 await assert.rejects(execute(f),/CORPORATION_NOT_VERIFIED/);
}));
test("native buyer session is mandatory before even claiming the Rust order",()=>run(async f=>{
 f.setBuyer(false);
 assert.equal((await execute(f)).error,"NPC_PARTIAL_BUYER_SESSION_UNVERIFIED");
 assert.equal(f.claims,0);
}));
test("default OFF cannot claim Rust order or modify native item",()=>run(async f=>{
 delete process.env.EVEJS_COOP_NATIVE_NPC_PARTIAL_FILL;
 assert.equal((await execute(f)).error,"NPC_PARTIAL_DISABLED");
 assert.equal(f.claims,0);
}));
test("duplicate item keys in native GameStore fail closed before allocation",()=>run(async f=>{
 f.data.items[1990000999]={...f.data.items[ITEM],itemID:ITEM};
 await assert.rejects(execute(f),/ITEM_KEY_MISMATCH/);
}));

test("100 successive one-unit native partial and terminal fills conserve 100 items and 1200 ISK",()=>run(async f=>{
 for(let i=1;i<=100;i++){
  const key="npc-partial:"+i.toString(16).padStart(32,"0");
  f.configure({claimKey:key,fillID:910000000000000+i,
   remainingBefore:101-i,quantity:1});
  const result=await execute(f,key,1);
  assert.equal(result.status,"PURCHASED_PARTIAL");
  assert.equal(result.remainingQuantity,100-i);
 }
 const all=Object.values(f.data.items);
 assert.equal(all.reduce((n,item)=>n+item.quantity,0),100);
 assert.equal(all.filter(item=>item.ownerID===BUYER).length,100);
 assert.equal(all.some(item=>item.ownerID===OWNER),false);
 assert.equal(f.data.identityState.nextItemID,1990000399);
 assert.equal(f.data.marketEscrow[ORDER],undefined);
 assert.equal(f.data.characters[BUYER].balance,3800);
 assert.equal(f.data.corporationRuntime["corporations\u001f"+OWNER].wallet.divisions["1000"].balance,1300);
 assert.equal(Object.keys(f.data.npcMarketFills).length,100);
}));
