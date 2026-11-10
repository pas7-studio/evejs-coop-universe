'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),F=require('./fixture.cjs');
function run(kind,fn){const t=F.tempDb(),f=F.open(t.file);
 try{if(kind==='ACTIVE')f.prepareActive();else if(kind==='CONTRACTED')f.prepareContracted();else{f.seed();f.onboard();}
  fn(f);}finally{f.close();t.cleanup();}}
const pay=(f,c=F.payrollCmd())=>f.life.salary(c);
const release=(f,c=F.dismissCmd())=>f.life.dismiss(c);
const loss=(f,c=F.lossCmd())=>f.life.loss(c);
test('PF57 recurring salary debits original character, credits original corporation, original journals',()=>run('RESERVED',f=>{
 const orig=f.get('characters',String(F.OWNER)).balance,corp=f.get('corporationRuntime','corporations\u001f'+F.EMPLOYER).wallet.divisions['1000'].balance;
 const r=pay(f);a.equal(r.status,'APPLIED');a.equal(r.receipt.amountCents,4500);
 a.equal(f.get('characters',String(F.OWNER)).balance,orig-45);
 a.equal(f.get('corporationRuntime','corporations\u001f'+F.EMPLOYER).wallet.divisions['1000'].balance,corp+45);
 a.equal(f.get('characters',String(F.OWNER)).walletJournal[0].transactionID,r.receipt.transactionID);
 a.equal(f.get('corporationRuntime',F.api.LEDGER).contracts[F.PILOT].lastPeriod,1);
}));
test('PF57 replay returns same journal ID and does not debit twice',()=>run('RESERVED',f=>{
 const r=pay(f);a.equal(r.status,'APPLIED');const bal=f.get('characters',String(F.OWNER)).balance;
 const again=pay(f);a.equal(again.status,'DUPLICATE');a.equal(again.receipt.transactionID,r.receipt.transactionID);
 a.equal(f.get('characters',String(F.OWNER)).balance,bal);
}));
test('second payroll period is ordered, not writable by client amount',()=>run('RESERVED',f=>{
 a.equal(pay(f).status,'APPLIED');f.shared.salaryTxID++;
 const c=F.payrollCmd({operationID:'pf57-salary-2',periodIndex:2,amountCents:1});
 a.equal(pay(f,c).status,'APPLIED');a.equal(f.get('corporationRuntime',F.api.LEDGER).contracts[F.PILOT].lastPeriod,2);
 a.equal(f.get('characters',String(F.OWNER)).balance,3500-90);
}));
test('cannot skip salary periods',()=>run('RESERVED',f=>{
 a.equal(pay(f,F.payrollCmd({periodIndex:3})).reason,'PF57_PERIOD_OUT_OF_SEQUENCE');
}));
test('cannot reuse operationID for different salary period',()=>run('RESERVED',f=>{
 a.equal(pay(f).status,'APPLIED');a.equal(pay(f,F.payrollCmd({periodIndex:2})).reason,'PF57_REPLAY_CONFLICT');
}));
test('insufficient money blocks without contract change',()=>run('RESERVED',f=>{
 f.shared.salaryCents=100000000;a.equal(pay(f).reason,'PF57_INSUFFICIENT_ISK');
 a.equal(f.get('corporationRuntime',F.api.LEDGER),null);
}));
test('missing PF53 hire journal blocks payroll',()=>run('RESERVED',f=>{
 const c=f.get('characters',String(F.OWNER));c.walletJournal=[];f.put('characters',String(F.OWNER),c);
 a.equal(pay(f).reason,'PF57_ORIGINAL_PAID_HIRE_UNVERIFIED');
}));
test('salary quote from untrusted source blocked',()=>run('RESERVED',f=>{
 f.shared.periodRevision=0;a.equal(pay(f).reason,'PF57_NATIVE_SALARY_QUOTE_UNVERIFIED_OR_NOT_DUE');
}));
test('salary requires actual original pilot service',()=>run('RESERVED',f=>{
 f.shared.serviceReady=false;a.equal(pay(f).reason,'PF57_NATIVE_PILOT_SERVICE_UNVERIFIED');
}));
test('wallet transaction id may not collide with PF53 original ID',()=>run('RESERVED',f=>{
 f.shared.salaryTxID=f.shared.txid;
 a.equal(pay(f).reason,'PF57_NATIVE_JOURNAL_ID_COLLISION');
}));
test('revoke feature inside original transaction fails before any ISK debit',()=>run('RESERVED',f=>{
 const before=f.get('characters',String(F.OWNER)).balance;
 f.shared.onTx=()=>{f.shared.enabled=false;};
 a.equal(pay(f).reason,'PF57_GATE_REVOKED');
 a.equal(f.get('characters',String(F.OWNER)).balance,before);
}));
test('revoke session inside original transaction blocks pay',()=>run('RESERVED',f=>{
 f.shared.onTx=()=>{f.shared.auth=false;};
 a.equal(pay(f).reason,'PF57_ACCESS_REVOKED');
}));
test('rollback after character and corporation mutations preserves both balances',()=>run('RESERVED',f=>{
 const b=f.get('characters',String(F.OWNER)).balance;
 f.shared.failAfterPut=2;
 a.equal(pay(f).reason,'PF57_SALARY_COMMIT_OUTCOME_UNKNOWN');
 a.equal(f.get('characters',String(F.OWNER)).balance,b);
 a.equal(f.get('corporationRuntime',F.api.LEDGER),null);
}));
test('wallet notification fails after commit but no retry debit',()=>run('RESERVED',f=>{
 f.shared.notificationSuccess=false;
 a.equal(pay(f).notificationStatus,'PENDING');
 const balance=f.get('characters',String(F.OWNER)).balance;
 a.equal(pay(f).status,'DUPLICATE');a.equal(f.get('characters',String(F.OWNER)).balance,balance);
}));
test('two pilots cannot share PF52 roster identity after changed ownership',()=>run('RESERVED',f=>{
 const ix=f.get('corporationRuntime',F.pf52.REGISTRY_KEY);
 ix.pilots[F.PILOT].ownerCharacterID=44;f.put('corporationRuntime',F.pf52.REGISTRY_KEY,ix);
 a.equal(pay(f).reason,'PF57_ORIGINAL_ROSTER_OR_LEDGER_CORRUPT');
}));
test('dismiss returns the original pilot to source only after confirmed release, no refund',()=>run('CONTRACTED',f=>{
 const balance=f.get('characters',String(F.OWNER)).balance;
 const r=release(f);a.equal(r.status,'APPLIED');a.equal(r.receipt.noRefund,true);
 const idx=f.get('corporationRuntime',F.pf52.REGISTRY_KEY),
  roster=f.get('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER);
 a.equal(idx.pilots[F.PILOT],undefined);a.equal(idx.contracts[F.OFFER.contractID],undefined);
 a.equal(roster.pilots[F.PILOT],undefined);
 a.equal(f.get('characters',String(F.OWNER)).balance,balance);
 a.equal(release(f).status,'DUPLICATE');
}));
test('dismiss blocked while original ship reserved or deployed',()=>run('RESERVED',f=>{
 a.equal(release(f).reason,'PF57_SHIP_STILL_RESERVED_OR_ACTIVE');
}));
test('dismiss blocked if original pilot still under order or source custody',()=>run('CONTRACTED',f=>{
 f.shared.otherOrdersClear=false;a.equal(release(f).reason,'PF57_NATIVE_PILOT_OR_ORDER_STILL_ACTIVE');
 f.shared.otherOrdersClear=true;f.shared.nativePilotReleased=false;
 a.equal(release(f).reason,'PF57_NATIVE_PILOT_OR_ORDER_STILL_ACTIVE');
}));
test('dismiss prevents stale contract from being used again',()=>run('CONTRACTED',f=>{
 a.equal(release(f).status,'APPLIED');
 a.equal(pay(f).reason,'PF57_CONTRACT_NOT_ACTIVE_OR_CHANGED');
}));
test('dismiss transaction crash rollback preserves roster and global index',()=>run('CONTRACTED',f=>{
 f.shared.failAfterPut=2;a.equal(release(f).reason,'PF57_DISMISS_COMMIT_OUTCOME_UNKNOWN');
 a.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).pilots[F.PILOT]);
 a.ok(f.get('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER).pilots[F.PILOT]);
}));
test('loss with original wreck releases actor and reservation without creating ship',()=>run('ACTIVE',f=>{
 f.lossWreck();const r=loss(f);a.equal(r.status,'APPLIED');
 a.equal(r.receipt.noAutomaticReplacement,true);
 const ix=f.get('corporationRuntime',F.pf52.REGISTRY_KEY),
  rs=f.get('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER);
 a.equal(ix.ships[String(F.SHIP)],undefined);
 a.equal(rs.pilots[F.PILOT].status,'CONTRACTED');
 a.equal(rs.pilots[F.PILOT].shipItemID,null);
 a.equal(f.get('items',String(F.SHIP)),null);
 a.equal(f.get('corporationRuntime',F.api.CLAIMS).claims[String(F.SHIP)],undefined);
 a.equal(f.get('corporationRuntime',F.api.PF54+F.ASSIGNMENT).phase,'LOST');
 a.equal(loss(f).status,'DUPLICATE');
}));
test('loss without original confirmed wreck refuses release',()=>run('ACTIVE',f=>{
 f.db.prepare('DELETE FROM items WHERE key=?').run(String(F.SHIP));
 a.equal(loss(f).reason,'PF57_ORIGINAL_WRECK_NOT_FOUND');
}));
test('loss cannot resurrect a hull still in original ItemStore',()=>run('ACTIVE',f=>{
 f.lossWreck();f.put('items',String(F.SHIP),{itemID:F.SHIP});
 a.equal(loss(f).reason,'PF57_ORIGINAL_SHIP_NOT_DESTROYED');
}));
test('loss requires original native controller death evidence',()=>run('ACTIVE',f=>{
 f.lossWreck();f.shared.wreckProofBad={nativeControllerAbsent:false};
 a.equal(loss(f).reason,'PF57_NATIVE_WRECK_LOSS_UNVERIFIED');
}));
test('loss requires original cargo/fitting title accounting',()=>run('ACTIVE',f=>{
 f.lossWreck();f.shared.custodyProofBad={originalCargoAccountedFor:false};
 a.equal(loss(f).reason,'PF57_WRECK_ASSET_CUSTODY_UNVERIFIED');
}));
test('loss refuses foreign or wrong ship wreck',()=>run('ACTIVE',f=>{
 f.lossWreck();const obj=f.get('npcWrecks','npcWrecks');obj.wrecks[String(F.WRECK)].sourceEntityID=F.SHIP+1;
 f.put('npcWrecks','npcWrecks',obj);
 a.equal(loss(f).reason,'PF57_ORIGINAL_WRECK_NOT_FOUND');
}));
test('loss still requires original order lifecycle to be settled',()=>run('ACTIVE',f=>{
 f.lossWreck();f.shared.otherOrdersClear=false;
 a.equal(loss(f).reason,'PF57_NATIVE_ORDER_LIFECYCLE_UNVERIFIED');
}));
test('loss transaction rollback does not free ship or actor',()=>run('ACTIVE',f=>{
 f.lossWreck();f.shared.failAfterPut=3;
 a.equal(loss(f).reason,'PF57_LOSS_COMMIT_OUTCOME_UNKNOWN');
 a.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).ships[String(F.SHIP)]);
 a.ok(f.get('corporationRuntime',F.api.CLAIMS).claims[String(F.SHIP)]);
 a.equal(f.get('corporationRuntime',F.api.PF54+F.ASSIGNMENT).phase,'ACTIVE');
}));
test('feature disabled blocks all monetary and loss paths without mutations',()=>run('ACTIVE',f=>{
 f.shared.enabled=false;a.equal(pay(f).status,'DISABLED');
 a.equal(release(f).status,'DISABLED');a.equal(loss(f).status,'DISABLED');
}));
test('loss replay with changed original wreckID is rejected',()=>run('ACTIVE',f=>{
 f.lossWreck();a.equal(loss(f).status,'APPLIED');
 a.equal(loss(f,F.lossCmd({wreckID:F.WRECK+1})).reason,'PF57_OPERATION_COLLISION');
}));
test('salary replay remains durable and unchanged even after subsequent dismissal',()=>run('CONTRACTED',f=>{
 const paid=pay(f);a.equal(paid.status,'APPLIED');
 a.equal(release(f).status,'APPLIED');
 const oldBal=f.get('characters',String(F.OWNER)).balance;
 const replay=pay(f);a.equal(replay.status,'DUPLICATE');
 a.equal(replay.receipt.transactionID,paid.receipt.transactionID);
 a.equal(f.get('characters',String(F.OWNER)).balance,oldBal);
}));
test('dismissal blocks overdue final service settlement',()=>run('CONTRACTED',f=>{
 f.shared.dismissalSettled=false;
 a.equal(release(f).reason,'PF57_OUTSTANDING_SALARY_OR_TERMINATION_UNVERIFIED');
 a.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).pilots[F.PILOT]);
}));
test('loss requires no remaining original native cargo for the destroyed hull',()=>run('ACTIVE',f=>{
 f.lossWreck();f.put('npcCargo','npcCargo',{cargo:{1:{cargoID:1,entityID:F.SHIP}}});
 a.equal(loss(f).reason,'PF57_ORIGINAL_NATIVE_ASSETS_STILL_ACTIVE');
}));
test('loss requires original native modules to have completed wreck custody',()=>run('ACTIVE',f=>{
 f.lossWreck();f.put('npcModules','modules\u001f1',{moduleID:1,entityID:F.SHIP});
 a.equal(loss(f).reason,'PF57_ORIGINAL_NATIVE_ASSETS_STILL_ACTIVE');
}));
test('loss refuses an original live NPC entity regardless of forged absent proof',()=>run('ACTIVE',f=>{
 f.lossWreck();f.put('npcEntities','entities\u001f'+String(F.SHIP),{entityID:F.SHIP});
 a.equal(loss(f).reason,'PF57_ORIGINAL_NATIVE_ASSETS_STILL_ACTIVE');
}));
test('loss rejects duplicate native wrecks for the same original hull',()=>run('ACTIVE',f=>{
 f.lossWreck();const r=f.get('npcWrecks','npcWrecks');
 r.wrecks[String(F.WRECK+1)]={wreckID:F.WRECK+1,sourceEntityID:F.SHIP,systemID:F.SYSTEM};
 f.put('npcWrecks','npcWrecks',r);
 a.equal(loss(f).reason,'PF57_DUPLICATE_OR_AMBIGUOUS_NATIVE_WRECK');
}));
test('loss rejects duplicate original item-title lineage inside wreck-items collection',()=>run('ACTIVE',f=>{
 f.lossWreck();const r=f.get('npcWreckItems','npcWreckItems');
 r.items={'111':{wreckItemID:111,originalItemID:77},'112':{wreckItemID:112,sourceItemID:77}};
 f.put('npcWreckItems','npcWreckItems',r);
 a.equal(loss(f).reason,'PF57_DUPLICATED_ORIGINAL_WRECK_ITEM_TITLE');
}));
test('loss cannot overwrite a pre-existing PF actor processed receipt',()=>run('ACTIVE',f=>{
 f.lossWreck();const r=f.get('corporationRuntime',F.api.CLAIMS);
 r.processed['pf57:pf57-loss-1']={signature:'old',receipt:{type:'RELEASE'}};
 f.put('corporationRuntime',F.api.CLAIMS,r);
 a.equal(loss(f).reason,'PF57_ACTOR_RECEIPT_COLLISION');
 a.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).ships[String(F.SHIP)]);
}));
test('loss cannot be dismissed until ship has a final state',()=>run('ACTIVE',f=>{
 f.lossWreck();f.shared.wreckProof=false;
 a.equal(loss(f).reason,'PF57_NATIVE_WRECK_LOSS_UNVERIFIED');
 a.equal(release(f).reason,'PF57_SHIP_STILL_RESERVED_OR_ACTIVE');
}));
test('salary cannot re-use original character wallet ID already used by any existing journal entry',()=>run('RESERVED',f=>{
 const r=f.get('characters',String(F.OWNER));r.walletJournal.unshift({transactionID:f.shared.salaryTxID});
 f.put('characters',String(F.OWNER),r);
 a.equal(pay(f).reason,'PF57_NATIVE_JOURNAL_ID_COLLISION');
}));
test('loss during unknown DOCK_ISSUING cannot race later ItemStore dock commit',()=>run('ACTIVE',f=>{
 f.lossWreck();f.put('corporationRuntime',F.api.PF56+F.ASSIGNMENT,
  {phase:'DOCK_ISSUING',shipItemID:F.SHIP,pilotID:F.PILOT});
 a.equal(loss(f).reason,'PF57_RETURN_DOCK_CONFLICT');
 a.ok(f.get('corporationRuntime',F.api.CLAIMS).claims[String(F.SHIP)]);
}));
test('inspect retains immutable loss history even if no salary ever paid',()=>run('ACTIVE',f=>{
 f.lossWreck();a.equal(loss(f).status,'APPLIED');
 const r=f.life.inspect(F.lossCmd());a.equal(r.status,'OK');a.equal(r.contract,null);
 a.equal(r.losses.length,1);a.equal(r.losses[0].shipItemID,F.SHIP);
 a.equal(r.losses[0].ownerCharacterID,F.OWNER);
}));
test('a different authenticated owner cannot read another pilot loss',()=>run('ACTIVE',f=>{
 f.lossWreck();a.equal(loss(f).status,'APPLIED');
 f.shared.auth=false;
 a.equal(f.life.inspect(F.lossCmd()).reason,'PF57_ACCESS_DENIED');
}));
test('dismiss replay refuses to claim success if original PF52 roster was unexpectedly restored',()=>run('CONTRACTED',f=>{
 a.equal(release(f).status,'APPLIED');const ro=f.get('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER);
 ro.pilots[F.PILOT]={pilotID:F.PILOT,contractID:F.OFFER.contractID,
  hireReceiptHash:f.get('corporationRuntime',F.pf53.paidKey('pf54-hire-1')).hireReceiptHash,
  status:'CONTRACTED',shipItemID:null,revision:0};
 f.put('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER,ro);
 a.equal(release(f).reason,'PF57_REPLAY_ORIGINAL_RELEASE_UNVERIFIED');
}));
test('loss replay refuses success if destroyed original ship was unexpectedly recreated',()=>run('ACTIVE',f=>{
 f.lossWreck();a.equal(loss(f).status,'APPLIED');
 f.put('items',String(F.SHIP),{itemID:F.SHIP});
 a.equal(loss(f).reason,'PF57_REPLAY_ORIGINAL_LOSS_UNVERIFIED');
}));
