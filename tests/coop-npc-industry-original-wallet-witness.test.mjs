import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOriginalNpcWalletReceiptWitness}=require("../integration/coopNpcIndustryOriginalWalletWitness.cjs");
const OWNER=1000035,BUYER=90000001,ORDER=500,FILL=2345001,TYPE=215,STATION=60010001;
const receipt={fillID:FILL,ownerID:OWNER,buyerID:BUYER,orderID:ORDER,
 stationID:STATION,typeID:TYPE,quantity:20,grossCents:25000,
 buyerAfterCents:175000,corpAfterCents:35000};
function fixture(){
 const corpEntry={transactionID:FILL,amount:250,balance:350,referenceID:ORDER};
 const buyerEntry={transactionID:FILL,amount:-250,balance:1750,referenceID:ORDER};
 const trade={transactionID:FILL,journalRefID:FILL,
  sellerID:OWNER,buyerID:BUYER,stationID:STATION,typeID:TYPE,quantity:20};
 const corp={corporationID:OWNER,wallet:{divisions:{"1000":{
  balance:400,journal:[corpEntry],transactions:[corpEntry]}}}};
 const character={characterID:BUYER,balance:1600,
  walletJournal:[buyerEntry],marketTransactions:[trade]};
 const witness=createOriginalNpcWalletReceiptWitness({
  getCorporation:()=>corp,getCharacter:()=>character});
 return{corp,character,trade,corpEntry,buyerEntry,witness,
  run:()=>witness.verify(FILL,receipt)};
}
test("actual native corporation and character wallet journals prove one ISK settlement",()=>{
 const f=fixture(),r=f.run();
 assert.equal(r.verifiedNative,true);
 assert.equal(r.buyerDebitCents,25000);
 assert.equal(r.corporateCreditCents,25000);
 assert.equal(r.transactionID,FILL);
});
test("later legitimate wallet activity does not alter historical paid receipt",()=>{
 const f=fixture();
 f.corp.wallet.divisions["1000"].balance=990;
 f.character.balance=125;
 assert.equal(f.run().verifiedNative,true);
});
test("counterfeit NPC credit journal cannot certify completed payment",()=>{
 const f=fixture();f.corpEntry.amount=249;
 assert.equal(f.run().verifiedNative,false);
});
test("buyer wallet debit must match the exact original fill ID",()=>{
 const f=fixture();f.buyerEntry.transactionID=FILL+1;
 assert.equal(f.run().verifiedNative,false);
});
test("original persisted corporation journal and transaction rows must both exist",()=>{
 const f=fixture();f.corp.wallet.divisions["1000"].journal=[];
 assert.equal(f.run().verifiedNative,false);
});
test("forged buyer trade or station in market transaction fails closed",()=>{
 const f=fixture();f.trade.stationID++;
 assert.equal(f.run().verifiedNative,false);
});
test("duplicate original finance journal rows are not idempotent proof",()=>{
 const f=fixture();f.character.walletJournal.push({...f.buyerEntry});
 assert.equal(f.run().verifiedNative,false);
});
test("wallet journal truncation results in unverified, never fabricated ISK",()=>{
 const f=fixture();f.character.walletJournal=[];
 assert.equal(f.run().verifiedNative,false);
});
test("non-cent original balances and corrupt native amounts fail closed",()=>{
 const f=fixture();
 f.corp.wallet.divisions["1000"].balance=400.004;
 assert.equal(f.run().verifiedNative,false);
});
test("read-only wallet witness has no transaction, clock or native mint",()=>{
 const code=fs.readFileSync(new URL("../integration/coopNpcIndustryOriginalWalletWitness.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(code,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(code,/\.transact\s*\(|\.put\s*\(|\.credit\s*\(/);
});
