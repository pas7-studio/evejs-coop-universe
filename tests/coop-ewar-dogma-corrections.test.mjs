import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
const require = createRequire(import.meta.url);
const {nosTransferAllowed, actualRemoteRepairAmount} = require('../integration/coopEwarDogmaCorrections.cjs');
const {patchEwarDogma} = require('../scripts/coop-ewar-dogma-patch.cjs');
const HOSTILE='server/src/space/modules/hostileModuleRuntime.js';
const ASSIST='server/src/space/modules/assistanceModuleRuntime.js';
function cap(sourceGJ,sourceMax,targetGJ,targetMax){
  const a={capacitorAmount:sourceGJ,capacitorCapacity:sourceMax};
  const b={capacitorAmount:targetGJ,capacitorCapacity:targetMax};
  return [a,b,{getEntityCapacitorAmount:x=>x.capacitorAmount}];
}

test('NOS: 80% attacker cannot drain 20% target despite target having more absolute GJ',()=>{
 const [a,b,cb]=cap(80,100,200,1000);
 assert.equal(nosTransferAllowed(a,b,cb),false);
});
test('NOS: 20% attacker can drain 80% target despite target having fewer absolute GJ',()=>{
 const [a,b,cb]=cap(200,1000,80,100);
 assert.equal(nosTransferAllowed(a,b,cb),true);
});
test('NOS: equal capacitor fractions and completely empty targets fail closed',()=>{
 let [a,b,cb]=cap(50,100,500,1000);
 assert.equal(nosTransferAllowed(a,b,cb),false);
 [a,b,cb]=cap(0,100,0,100);
 assert.equal(nosTransferAllowed(a,b,cb),false);
});
test('NOS: undefined capacity, bad values or failed native read cannot authorize',()=>{
 const [a,b,cb]=cap(1,100,2,100);
 for(const v of [0,-1,NaN,Infinity]){b.capacitorCapacity=v;assert.equal(nosTransferAllowed(a,b,cb),false)}
 b.capacitorCapacity=100;
 b.capacitorAmount=101;
 assert.equal(nosTransferAllowed(a,b,cb),false);
 assert.equal(nosTransferAllowed(a,b,{getEntityCapacitorAmount(){throw Error('read unavailable')}}),false);
});
test('remote shield receipt records actual HP below requested near full',()=>{
 assert.equal(actualRemoteRepairAmount('remoteShield',{shieldCharge:.95},{shieldCapacity:1000,conditionState:{shieldCharge:1}}),50);
});
test('remote armor and hull receipts use native inverse damage ratios',()=>{
 assert.equal(actualRemoteRepairAmount('remoteArmor',{armorDamage:.1},{armorHP:1000,conditionState:{armorDamage:0}}),100);
 assert.equal(actualRemoteRepairAmount('remoteHull',{damage:.45},{structureHP:500,conditionState:{damage:.25}}),100);
});
test('full HP, invalid states and unknown family do not invent repairs',()=>{
 assert.equal(actualRemoteRepairAmount('remoteShield',{shieldCharge:1},{shieldCapacity:1000,conditionState:{shieldCharge:1}}),0);
 assert.equal(actualRemoteRepairAmount('remoteArmor',{armorDamage:0},{armorHP:1000,conditionState:{armorDamage:0}}),0);
 assert.equal(actualRemoteRepairAmount('remoteHull',{damage:0},{structureHP:1000,conditionState:{damage:0}}),0);
 assert.equal(actualRemoteRepairAmount('remoteShield',{shieldCharge:2},{shieldCapacity:1000,conditionState:{shieldCharge:1}}),0);
 assert.equal(actualRemoteRepairAmount('unknown',{shieldCharge:0},{shieldCapacity:1000,conditionState:{shieldCharge:1}}),0);
});
test('reversal loses HP: receipt is zero not negative',()=>{
 assert.equal(actualRemoteRepairAmount('remoteArmor',{armorDamage:.1},{armorHP:1000,conditionState:{armorDamage:.2}}),0);
});
const hostileSource=`function resolveNosTransferAllowed(sourceEntity, targetEntity, effectState, callbacks = {}) {\n  if (effectState && effectState.hostileNosOverride === true) { return true; }\n  const sourceCapAmount = callbacks.getEntityCapacitorAmount(sourceEntity);\n  const targetCapAmount = callbacks.getEntityCapacitorAmount(targetEntity);\n  return sourceCapAmount + 1e-6 < targetCapAmount;\n}`;
const assistSource=`function executeAssistanceModuleCycle({}) {\n  const previousConditionState = {shieldCharge:0.95,armorDamage:0.1,damage:0.1};\n  const targetEntity = {conditionState:{shieldCharge:1,armorDamage:0,damage:0},shieldCapacity:1000,armorHP:1000,structureHP:1000};\n  const shieldBonusAmount=300,armorRepairAmount=300,hullRepairAmount=300;\n  const roundNumber=(x,d)=>Number(x.toFixed(d));\n  return [\n    {\n        appliedAmount: roundNumber(shieldBonusAmount, 6),\n    },\n    {\n        appliedAmount: roundNumber(armorRepairAmount, 6),\n    },\n    {\n        appliedAmount: roundNumber(hullRepairAmount, 6),\n    }\n  ];\n}`;
test('exact native patch is reversible, idempotent and byte-identical for LF and CRLF',()=>{
 for(const [path,text] of [[HOSTILE,hostileSource],[ASSIST,assistSource]])for(const src of [text,text.replace(/\n/g,'\r\n')]){
  const once=patchEwarDogma(src,path);
  assert.notEqual(once,src);
  assert.equal(patchEwarDogma(once,path),once);
  assert.equal(patchEwarDogma(once,path,{remove:true}),src);
  assert.equal(patchEwarDogma(src,path,{remove:true}),src);
  new Script(once,{filename:path});
 }
});
test('native patch refuses missing/duplicated/tampered source without any output',()=>{
 assert.throws(()=>patchEwarDogma(hostileSource.replace('return sourceCapAmount + 1e-6 < targetCapAmount;','return false;'),HOSTILE),/ANCHOR_MISMATCH/);
 assert.throws(()=>patchEwarDogma(hostileSource+'\n'+hostileSource,HOSTILE),/CONTEXT_MISMATCH/);
 assert.throws(()=>patchEwarDogma(assistSource.replace('armorRepairAmount, 6','armorRepairAmount, 5'),ASSIST),/ANCHOR_MISMATCH/);
});
test('native helper opt-in preserves original when OFF and fixes NOS when ON',()=>{
 const patched=patchEwarDogma(hostileSource,HOSTILE);
 const evaluate=(enabled,override=false)=>{
  const nativeRequire=(path)=>{assert.equal(path,'../coopEwarDogmaCorrections');return {nosTransferAllowed}};
  const fn=new Function('require','process',patched+';return resolveNosTransferAllowed;')(nativeRequire,{env:{EVEJS_COOP_NATIVE_EWAR_CORRECTIONS:enabled?'1':'0'}});
  return fn(...cap(80,100,200,1000).slice(0,2),{hostileNosOverride:override},cap(80,100,200,1000)[2]);
 };
 assert.equal(evaluate(false),true);
 assert.equal(evaluate(true),false);
 assert.equal(evaluate(true,true),true);
});
test('native repair receipt patch is OFF-compatible and correct when ON',()=>{
 const patched=patchEwarDogma(assistSource,ASSIST);
 const nativeRequire=(path)=>{assert.equal(path,'../coopEwarDogmaCorrections');return {actualRemoteRepairAmount}};
 for(const [flag,expected] of [['0',[300,300,300]],['1',[50,100,100]]]){
  const fn=new Function('require','process',patched+';return executeAssistanceModuleCycle;')(nativeRequire,{env:{EVEJS_COOP_NATIVE_EWAR_CORRECTIONS:flag}});
  assert.deepEqual(fn({}).map(row=>row.appliedAmount),expected);
 }
});
