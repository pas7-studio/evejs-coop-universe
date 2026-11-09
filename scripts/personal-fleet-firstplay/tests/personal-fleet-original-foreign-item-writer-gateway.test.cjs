'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const target=path.join(__dirname,'../native/coopPersonalFleetOriginalForeignItemWriterGateway.js');
const source=fs.readFileSync(target,'utf8');
const pf52=require('../../pf52/native/coopPersonalFleetHangarBridge.cjs');
const originalPF58=require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const SEP='\u001f',T='corporationRuntime',I='items';
const actorKey='coop-personal-fleet'+SEP+'actor-claims-v1';
const freeShip=()=>({itemID:2500,ownerID:500,locationID:6001,
 categoryID:6,typeID:606,flagID:4});
const reservedShip=()=>({itemID:2501,ownerID:500,locationID:6001,
 categoryID:6,typeID:607,flagID:4});
const moduleFree=()=>({itemID:3001,ownerID:500,locationID:2500,
 categoryID:7,typeID:215});
const moduleReserved=()=>({itemID:3002,ownerID:500,locationID:2501,
 categoryID:7,typeID:216});
const cp=x=>JSON.parse(JSON.stringify(x));
function fixture({poisoned=false,missingHandoff=false,invalidSource=false}={}){
 const idx=pf52.newIndex(),pilot='coop-pilot-3011234';
 idx.pilots[pilot]={ownerCharacterID:500,pilotID:pilot,
  contractID:'contract-1',hireReceiptHash:'a'.repeat(64)};
 idx.contracts['contract-1']=pilot;
 idx.generations['2501']=1;
 idx.ships['2501']={shipItemID:2501,ownerCharacterID:500,pilotID:pilot,
  stationID:6001,generation:1,assignmentID:'assn-1'};
 const db={items:{items:{
  '2500':freeShip(),'2501':reservedShip(),
  '3001':moduleFree(),'3002':moduleReserved()
 }},corporationRuntime:{[pf52.REGISTRY_KEY]:idx,[actorKey]:null}};
 let commits=0,attempts=0;
 let isPoisoned=poisoned,throwCommit=false;
 const stock={
  coopAtomicNativeRows:{
   mode:invalidSource?'UNFLAGGED':'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>isPoisoned,
   transact:(tables,fn)=>{
    a.deepEqual(tables,[T,I]);attempts++;
    const proposed=new Map();
    const tx={
     get:(table,key)=>{
      if(table===T&&key.startsWith('coop-personal-fleet'+SEP+'handoff-ship-v1:')&&
         missingHandoff)return undefined;
      if(proposed.has(table+':'+key))return proposed.get(table+':'+key);
      return Object.prototype.hasOwnProperty.call(db[table]||{},key)?
       db[table][key]:null;
     },
     put:(table,key,value)=>{
      proposed.set(table+':'+key,cp(value));
     }
    };
    const result=fn(tx);
    if(throwCommit)throw Error('SIMULATED_SQLITE_ABORT');
    for(const [key,value] of proposed){
     const [table,root]=key.split(':');
     db[table][root]=value;commits++;
    }
    return result;
   }
  }
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:id=>{
  if(id==='../gameStore')return stock;
  if(id==='./coopPersonalFleetHangarBridge')return pf52;
  if(id==='./coopPersonalFleetOriginalNativePermit')return originalPF58;
  throw Error('PF106_UNEXPECTED_NATIVE_IMPORT:'+id);
 },module:m,exports:m.exports,Object,Array,Number,Set,
  Error,JSON,structuredClone},{filename:target});
 const factory=()=>m.exports.createOriginalForeignItemWriterGateway();
 const execute=(writer,ids,buildNext)=>factory().execute({
  writer,declaredItemIDs:ids,buildNext});
 return {db,idx,factory,execute,freezePoison:()=>isPoisoned=true,
  throwCommit:()=>throwCommit=true,stats:()=>({commits,attempts})};
}
test('PF106 requires actual stock authoritative GameStore atomic mode',()=>{
 const f=fixture({invalidSource:true});
 a.throws(()=>f.factory(),/PF106_ORIGINAL_STOCK_ITEMSTORE_GATE_UNAVAILABLE/);
});
test('PF106 authentic PF58/52 gateway permits free player hull transfer',()=>{
 const f=fixture();
 const r=f.execute('PLAYER',[2500],items=>{items['2500'].locationID=30000142;return items});
 a.equal(r.status,'COMMITTED');
 a.equal(r.source,'ORIGINAL_EVEJS_PERSONAL_FLEET_FOREIGN_ITEM_WRITER_GATE_V1');
 a.equal(f.db.items.items['2500'].locationID,30000142);
 a.equal(f.stats().commits,1);
});
test('PF106 modification of reserved real Personal Fleet ship is blocked',()=>{
 const f=fixture(),before=cp(f.db.items.items);
 const r=f.execute('PLAYER',[2501],items=>{items['2501'].ownerID=501;return items});
 a.equal(r.mayCommit,false);
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.deepEqual(f.db.items.items,before);
 a.equal(f.stats().commits,0);
});
test('PF106 loading module into protected hull blocks on NEXT parent chain',()=>{
 const f=fixture(),before=cp(f.db.items.items);
 const r=f.execute('MARKET',[3901],items=>{items['3901']={
  itemID:3901,ownerID:500,locationID:2501,categoryID:7,typeID:216};return items});
 a.match(r.reason,/PF106_ORIGINAL_POSTWRITE_CUSTODY_DENIED/);
 a.deepEqual(f.db.items.items,before);
 a.equal(f.stats().commits,0);
});
test('PF106 old protected module cannot leave the reserved ship',()=>{
 const f=fixture();
 const r=f.execute('MINING',[3002],items=>{
  items['3002'].locationID=6001;return items});
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.equal(f.db.items.items['3002'].locationID,2501);
});
test('PF106 moving free module INTO protected ship is rejected',()=>{
 const f=fixture();
 const r=f.execute('INDUSTRY',[3001],items=>{
  items['3001'].locationID=2501;return items});
 a.match(r.reason,/PF106_ORIGINAL_POSTWRITE_CUSTODY_DENIED/);
 a.equal(f.db.items.items['3001'].locationID,2500);
});
test('PF106 removing original protected cargo is rejected before deletion',()=>{
 const f=fixture();
 const r=f.execute('EXPLORATION',[3002],items=>{
  delete items['3002'];return items});
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.ok(f.db.items.items['3002']);
});
test('PF106 hidden mutation of second stock item fails exact global delta',()=>{
 const f=fixture(),before=cp(f.db.items.items);
 const r=f.execute('PLAYER',[2500],items=>{
  items['2500'].locationID=30000142;
  items['2501'].ownerID=501;
  return items;
 });
 a.match(r.reason,/PF106_UNDECLARED_STOCK_ITEM_CHANGE/);
 a.deepEqual(f.db.items.items,before);
});
test('PF106 declared stock item IDs must match all mutations exactly',()=>{
 const f=fixture();
 const r=f.execute('WAR',[2500,3001],items=>{
  items['2500'].locationID=30000142;return items});
 a.match(r.reason,/PF106_UNDECLARED_STOCK_ITEM_CHANGE/);
});
test('PF106 unverified original one-shot handoff key blocks the foreign writer',()=>{
 const f=fixture({missingHandoff:true});
 const r=f.execute('MARKET',[2500],items=>{
  items['2500'].locationID=30000142;return items});
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.equal(f.stats().commits,0);
});
test('PF106 a poisoned original SQLite owner denies before any builder execution',()=>{
 const f=fixture({poisoned:true});let called=0;
 const r=f.execute('PLAYER',[2500],items=>{called++;items['2500'].ownerID=99;return items});
 a.equal(r.reason,'PF106_ORIGINAL_GAMESTORE_POISONED');
 a.equal(called,0);
 a.equal(f.stats().attempts,0);
});
test('PF106 no user-supplied arbitrary native writer category',()=>{
 const f=fixture();
 const r=f.execute('NPC_ATTACK',[2500],items=>{
  items['2500'].ownerID=99;return items});
 a.equal(r.reason,'PF106_WRITER_DECLARATION_INVALID');
});
test('PF106 duplicate declared IDs and invalid keys cannot pass',()=>{
 const f=fixture();
 a.equal(f.execute('PLAYER',[2500,2500],items=>items).status,'BLOCKED');
 a.equal(f.execute('PLAYER',[0],items=>items).status,'BLOCKED');
});
test('PF106 builder may not return an item delta instead of full stock root',()=>{
 const f=fixture();
 const r=f.execute('PLAYER',[2500],_items=>null);
 a.match(r.reason,/PF106_NEXT_ITEMS_ROOT_REQUIRED/);
 a.equal(f.stats().commits,0);
});
test('PF106 builder exception rolls back original stock transaction',()=>{
 const f=fixture();
 const r=f.execute('PLAYER',[2500],()=>{throw Error('WRITER_FAILED')});
 a.match(r.reason,/WRITER_FAILED/);
 a.equal(f.stats().commits,0);
});
test('PF106 a simulated SQLite abort is not reported COMMITTED',()=>{
 const f=fixture();f.throwCommit();
 const r=f.execute('PLAYER',[2500],items=>{
  items['2500'].locationID=30000142;return items});
 a.equal(r.status,'BLOCKED');
 a.equal(f.stats().commits,0);
});
test('PF106 forged changed item identity cannot be committed',()=>{
 const f=fixture();
 const r=f.execute('PLAYER',[2500],items=>{
  items['2500'].itemID=2509;return items});
 a.match(r.reason,/PF106_ORIGINAL_ITEM_IDENTITY_INVALID/);
 a.equal(f.stats().commits,0);
});
test('PF106 adding unrelated free module to a free player hull can commit',()=>{
 const f=fixture();
 const r=f.execute('INDUSTRY',[3902],items=>{
  items['3902']={itemID:3902,ownerID:500,locationID:2500,
   categoryID:7,typeID:216};
  return items;
 });
 a.equal(r.status,'COMMITTED');
 a.equal(f.db.items.items['3902'].locationID,2500);
});
test('PF106 new item cannot be inserted under reserved module nested chain',()=>{
 const f=fixture();
 const r=f.execute('INDUSTRY',[3903],items=>{
  items['3903']={itemID:3903,ownerID:500,locationID:3002,
   categoryID:8,typeID:250};
  return items;
 });
 a.match(r.reason,/PF106_ORIGINAL_POSTWRITE_CUSTODY_DENIED/);
 a.equal(f.stats().commits,0);
});
test('PF106 bypass by undeclared cargo mutation during a free hull write is blocked',()=>{
 const f=fixture();
 const r=f.execute('EXPLORATION',[2500],items=>{
  items['2500'].flagID=0;
  items['3002'].locationID=6001;
  return items;
 });
 a.match(r.reason,/PF106_UNDECLARED_STOCK_ITEM_CHANGE/);
 a.equal(f.stats().commits,0);
});

test('PF107 original full-root owner derives item IDs within the authoritative transaction',()=>{
 const f=fixture(),snapshot=cp(f.db.items.items);
 snapshot['2500'].flagID=0;
 const result=f.factory().executeOriginalStockRoot({writer:'PLAYER',proposedItems:snapshot});
 a.equal(result.status,'COMMITTED');
 a.deepEqual([...result.changedItemIDs],[2500]);
 a.equal(f.db.items.items['2500'].flagID,0);
 a.equal(f.stats().commits,1);
});
test('PF107 stock owner rejects protected hull even without a caller declared-ID list',()=>{
 const f=fixture(),snapshot=cp(f.db.items.items);
 snapshot['2501'].ownerID=777;
 const r=f.factory().executeOriginalStockRoot({writer:'PLAYER',proposedItems:snapshot});
 a.equal(r.status,'BLOCKED');
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.equal(f.db.items.items['2501'].ownerID,500);
 a.equal(f.stats().commits,0);
});
test('PF107 stock owner denies hidden protected child move even with a free hull change',()=>{
 const f=fixture(),snapshot=cp(f.db.items.items);
 snapshot['2500'].locationID=30000142;
 snapshot['3002'].locationID=6001;
 const r=f.factory().executeOriginalStockRoot({writer:'PLAYER',proposedItems:snapshot});
 a.equal(r.status,'BLOCKED');
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.equal(f.stats().commits,0);
});
test('PF107 stock root no-op is idempotent and does not rewrite GameStore',()=>{
 const f=fixture(),snapshot=cp(f.db.items.items);
 const r=f.factory().executeOriginalStockRoot({writer:'PLAYER',proposedItems:snapshot});
 a.equal(r.status,'COMMITTED');
 a.deepEqual([...r.changedItemIDs],[]);
 a.equal(f.stats().commits,0);
});
test('PF107 original stock source owner forbids invalid root shape',()=>{
 const f=fixture();
 const r=f.factory().executeOriginalStockRoot({writer:'PLAYER',proposedItems:[]});
 a.equal(r.status,'BLOCKED');
 a.equal(r.reason,'PF107_STOCK_ITEMSTORE_ROOT_INVALID');
 a.equal(f.stats().attempts,0);
});
test('PF107 source-bound stock owner cannot write without complete original custody proof',()=>{
 const f=fixture({missingHandoff:true}),snapshot=cp(f.db.items.items);
 snapshot['2500'].locationID=30000142;
 const r=f.factory().executeOriginalStockRoot({writer:'PLAYER',proposedItems:snapshot});
 a.equal(r.status,'BLOCKED');
 a.match(r.reason,/PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED/);
 a.equal(f.stats().commits,0);
});
