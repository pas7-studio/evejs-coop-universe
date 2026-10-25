import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {settle,clampCritical,netGrant}=require('../integration/coopPlayerMiningCustody.cjs');
const {patch}=require('../scripts/coop-player-mining-custody-patch.cjs');
function world({kind='ore',units=10,volume=1}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'coop-player-mining-'));
 const prior={flag:process.env.EVEJS_COOP_PLAYER_MINING_CUSTODY,dir:process.env.EVEJS_COOP_PLAYER_MINING_JOURNAL_DIR};
 process.env.EVEJS_COOP_PLAYER_MINING_CUSTODY='1';process.env.EVEJS_COOP_PLAYER_MINING_JOURNAL_DIR=folder;
 const rock={itemID:9201},state={remainingQuantity:units,yieldTypeID:34,yieldKind:kind,unitVolume:volume};
 const entities=new Map([[9201,rock]]),sessions=new Map(),cargos=new Map();
 const scene={systemID:30000144,getEntityByID:id=>entities.get(id)||null,sessions};
 function pilot(id,shipID){const session={characterID:id,_space:{shipID,systemID:scene.systemID,initialStateSent:true},socket:{destroyed:false}};
  const ship={itemID:shipID,kind:'ship',ownerID:id,pilotCharacterID:id,session};
  sessions.set(id,session);entities.set(shipID,ship);return {ship,session};}
 function cycle({ship,session},amount,{waste=0,critical=0,at=10000,flagID=5,creditResult,moduleID=5501}={}){
  const before={...state};let debitCalls=0,creditCalls=0;
  const result={normalQuantity:amount,wastedQuantity:waste,criticalHitQuantity:critical,criticalHitVolume:critical*volume};
  clampCritical(before,result);
  const take=result.normalQuantity+result.criticalHitQuantity,consume=take+waste;
  const evidence=()=>[{item:{itemID:ship.itemID+100000,ownerID:session.characterID,
   locationID:ship.itemID,flagID,typeID:34,quantity:take,stacksize:take},
   previousState:{locationID:0,flagID:0}}];
  const settled=settle({scene,entity:ship,targetEntity:rock,mineableState:before,
   sourceModuleID:moduleID,miningResult:result,transferredQuantity:take,destinationFlagID:flagID,
   availableVolume:100,cycleBoundaryMs:at,readState:()=>state,
   debit:()=>{debitCalls++;state.remainingQuantity-=consume;return {success:true,data:{depleted:state.remainingQuantity===0}}},
   credit:()=>{creditCalls++;if(creditResult)return creditResult;
    cargos.set(ship.itemID,(cargos.get(ship.itemID)||0)+take);
    return {success:true,data:{quantity:take,changes:evidence()}};}});
  return {...settled,take,consume,debitCalls,creditCalls};
 }
 function close(){fs.rmSync(folder,{recursive:true,force:true});
  if(prior.flag===undefined)delete process.env.EVEJS_COOP_PLAYER_MINING_CUSTODY;
  else process.env.EVEJS_COOP_PLAYER_MINING_CUSTODY=prior.flag;
  if(prior.dir===undefined)delete process.env.EVEJS_COOP_PLAYER_MINING_JOURNAL_DIR;
  else process.env.EVEJS_COOP_PLAYER_MINING_JOURNAL_DIR=prior.dir;}
 return {folder,scene,rock,state,cargos,pilot,cycle,close};
}
function run(fn,options){const w=world(options);try{return fn(w)}finally{w.close()}}
test('two players mine the SAME physical rock with serial source depletion',()=>run(w=>{
 const a=w.pilot(501,7101),b=w.pilot(502,7102);
 const first=w.cycle(a,6,{at:10001}),second=w.cycle(b,4,{at:10002});
 assert.equal(first.success,true);assert.equal(second.success,true);
 assert.equal(w.state.remainingQuantity,0);
 assert.equal(w.cargos.get(7101)+w.cargos.get(7102),10);
 assert.equal(first.debitCalls,1);assert.equal(second.debitCalls,1);
}));
test('extra critical yield must consume physical asteroid budget too',()=>run(w=>{
 const a=w.pilot(501,7101);const result=w.cycle(a,7,{critical:9,waste:2});
 assert.equal(result.success,true);assert.equal(result.take,8);assert.equal(result.consume,10);
 assert.equal(w.state.remainingQuantity,0);assert.equal(w.cargos.get(7101),8);
}));
test('ore ice and gas are native custody kinds with hold restrictions',()=>{
 for(const [kind,flag] of [['ore',182],['ice',181],['gas',135]])run(w=>{
  const a=w.pilot(501,7101);assert.equal(w.cycle(a,2,{flagID:flag}).success,true);
  const b=w.pilot(502,7102);const wrong=w.cycle(b,2,{flagID:kind==='ice'?135:181,at:10002});
  assert.equal(wrong.success,false);assert.equal(wrong.debitCalls,0);
 },{kind});
});
test('insufficient physical cargo capacity blocks before any debit',()=>run(w=>{
 const a=w.pilot(501,7101);let debits=0;
 const r=settle({scene:w.scene,entity:a.ship,targetEntity:w.rock,
  mineableState:{...w.state},sourceModuleID:5501,miningResult:{normalQuantity:4,wastedQuantity:0,criticalHitQuantity:0},
  transferredQuantity:4,destinationFlagID:5,availableVolume:2,cycleBoundaryMs:8000,
  readState:()=>w.state,debit:()=>{debits++},credit:()=>{throw Error('NEVER')}});
 assert.equal(r.success,false);assert.equal(debits,0);
}));
test('lost cargo ack leaves a durable rock-level fence after restart',()=>run(w=>{
 const a=w.pilot(501,7101),b=w.pilot(502,7102);
 const bad=w.cycle(a,4,{creditResult:{success:false},at:9010});
 assert.equal(bad.success,false);assert.equal(w.state.remainingQuantity,6);
 const retry=w.cycle(b,3,{at:9011});
 assert.equal(retry.success,false);assert.equal(retry.debitCalls,0);
 assert.equal(w.state.remainingQuantity,6);
 assert.equal(fs.readdirSync(w.folder).some(x=>x.endsWith('.lock')),true);
}));
test('duplicate same-cycle attempt cannot credit twice',()=>run(w=>{
 const a=w.pilot(501,7101);assert.equal(w.cycle(a,2,{at:10003}).success,true);
 const replay=w.cycle(a,2,{at:10003});assert.equal(replay.success,false);
 assert.equal(replay.debitCalls,0);assert.equal(w.cargos.get(7101),2);
}));
test('other pilot cannot mine with a forged or stale session',()=>run(w=>{
 const a=w.pilot(501,7101),other=w.pilot(502,7102);
 w.scene.sessions.set(503,{...a.session});
 assert.equal(w.cycle(a,2,{at:11001}).debitCalls,0);
 w.scene.sessions.delete(503);a.session.socket.destroyed=true;
 assert.equal(w.cycle(a,2,{at:11002}).debitCalls,0);
 a.session.socket.destroyed=false;a.ship.ownerID=other.session.characterID;
 assert.equal(w.cycle(a,2,{at:11003}).debitCalls,0);
}));
test('no second grant after failed resource debit',()=>run(w=>{
 const a=w.pilot(501,7101);let credits=0;
 const r=settle({scene:w.scene,entity:a.ship,targetEntity:w.rock,mineableState:{...w.state},
  sourceModuleID:5501,miningResult:{normalQuantity:2,wastedQuantity:0,criticalHitQuantity:0},
  transferredQuantity:2,destinationFlagID:5,availableVolume:100,cycleBoundaryMs:10101,
  readState:()=>w.state,debit:()=>({success:false}),credit:()=>{credits++}});
 assert.equal(r.success,false);assert.equal(credits,0);assert.equal(w.state.remainingQuantity,10);
}));
test('net delta verifies source item actual owner hold and stack merge',()=>{
 const before={itemID:55,ownerID:501,locationID:7101,flagID:5,typeID:34,quantity:5,stacksize:5};
 const after={...before,quantity:8,stacksize:8};
 assert.equal(netGrant([{item:after,previousData:before}],501,7101,5,34),3);
 assert.equal(netGrant([{item:after,previousData:before}],502,7101,5,34),0);
 assert.equal(netGrant([{item:after,previousData:before}],501,7101,182,34),0);
});
test('source debit may expend waste without issuing cargo grants',()=>run(w=>{
 const a=w.pilot(501,7101);const r=w.cycle(a,0,{waste:2,at:12101});
 assert.equal(r.success,true);assert.equal(r.creditCalls,0);assert.equal(w.state.remainingQuantity,8);
}));
const basic=[
 '  const transferredQuantity = miningResult.getTotalTransferredQuantity();',
 '  if (transferredQuantity <= 0 && miningResult.wastedQuantity <= 0) {',
 '    return {success:false,stopReason:"cargo"};','  }',
 '  if (isNativeNpcEntity(entity)) {',
 '    if (!coopStrictNative) appendNpcCargo(entity, mineableState.yieldTypeID, transferredQuantity);',
 '  } else {','    const grantResult = grantItemsToCharacterLocation(',
 '       x, y, z, q);','  }',
 '  const deltaResult = coopStrictDelta || applyMiningDelta(',
 '    scene, targetEntity, 1, 0, options);',
 '  // COOP_ALIFE_NATIVE_MINING_CONSERVATION_V1',
].join('\n');
test('player-only patch is reversible and leaves NPC branch untouched',()=>{
 const patched=patch(basic);assert.ok(patched.includes('coopPlayerMiningCustody').valueOf());
 assert.ok(patched.includes('if (!coopStrictNative) appendNpcCargo'));
 assert.equal(patch(patched),patched);assert.equal(patch(patched,true),basic);
 const crlf=basic.replace(/\n/g,'\r\n');assert.equal(patch(patch(crlf),true),crlf);
});
test('unsafe stock runtime without strict persistence hook fails source contract',()=>{
 assert.throws(()=>patch(basic.replace('  // COOP_ALIFE_NATIVE_MINING_CONSERVATION_V1','')),/needs existing ALIFE06/);
});
test('mining drone must belong to the verified pilot and physically controlled ship',()=>run(w=>{
 const a=w.pilot(501,7101);
 const drone={itemID:8801,ownerID:501,controllerID:7101,targetID:9201,kind:'drone'};
 w.scene.getEntityByID=(function(old){return id=>id===8801?drone:old(id)})(w.scene.getEntityByID);
 const base={scene:w.scene,entity:a.ship,droneEntity:drone,targetEntity:w.rock,
  mineableState:{...w.state},miningResult:{normalQuantity:2,wastedQuantity:0,criticalHitQuantity:0},
  transferredQuantity:2,destinationFlagID:5,availableVolume:100,cycleBoundaryMs:14001,
  readState:()=>w.state,debit:()=>{w.state.remainingQuantity-=2;return {success:true}},
  credit:()=>({success:true,data:{quantity:2,changes:[{item:{itemID:90001,ownerID:501,
   locationID:7101,flagID:5,typeID:34,quantity:2},previousState:{locationID:0}}]}})};
 drone.ownerID=502;assert.equal(settle(base).success,false);
 drone.ownerID=501;drone.controllerID=7102;assert.equal(settle(base).success,false);
 drone.controllerID=7101;assert.equal(settle(base).success,true);
}));
const droneFixture=[
 'function tickDroneMining(scene, droneEntity, controllerEntity, now) {',
 '  const grantResult = grantItemToCharacterLocation(',
 '    x, y, z, q, t);',
 '  if (!grantResult || grantResult.success !== true) return;',
 '  syncDroneInventoryChangesToSession(',
 '    resolveDroneControllerSession(droneEntity, controllerEntity),',
 '    grantResult.data && grantResult.data.changes,',
 '  );',
 '  const deltaResult = applyMiningDelta(',
 '    scene,',
 '    targetEntity,',
 '    miningResult.normalQuantity,',
 '    miningResult.wastedQuantity, options);',
 '}'
].join('\n');
test('native drone patch is reversible without altering stock drone ownership/control',()=>{
 const {patchDrone}=require('../scripts/coop-player-mining-custody-patch.cjs');
 const patched=patchDrone(droneFixture);
 assert.ok(patched.includes('coopDroneCustody'));
 assert.ok(patched.includes('sourceDroneID:droneEntity.itemID'));
 assert.equal(patchDrone(patched),patched);
 assert.equal(patchDrone(patched,true),droneFixture);
 const crlf=droneFixture.replace(/\n/g,'\r\n');
 assert.equal(patchDrone(patchDrone(crlf),true),crlf);
});
test('two mining lasers or two drones on the SAME hull retain separate cycle IDs',()=>run(w=>{
 const a=w.pilot(501,7101);
 assert.equal(w.cycle(a,4,{moduleID:5501,at:12345}).success,true);
 assert.equal(w.cycle(a,3,{moduleID:5502,at:12345}).success,true);
 assert.equal(w.state.remainingQuantity,3);assert.equal(w.cargos.get(7101),7);
 const replay=w.cycle(a,2,{moduleID:5501,at:12345});
 assert.equal(replay.success,false);assert.equal(replay.creditCalls,0);
}));
