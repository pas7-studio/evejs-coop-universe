import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {authorize}=require('../integration/coopPveRetaliationGuard.cjs');

const SYSTEM=30000142,NOW=100000;
const VICTIM=140000100,HELPER=140000101,ATTACKER=900000001,CHARACTER=2110000001;

function scene(){
 const victim={itemID:VICTIM,kind:'ship',nativeNpc:true,position:{x:0,y:0,z:0}};
 const helper={itemID:HELPER,kind:'ship',nativeNpc:true,position:{x:1000,y:0,z:0}};
 const attacker={itemID:ATTACKER,kind:'ship',nativeNpc:false,position:{x:2000,y:0,z:0}};
 const session={characterID:CHARACTER,
  _space:{shipID:ATTACKER,systemID:SYSTEM,initialStateSent:true},
  socket:{destroyed:false}};
 const byId=new Map([[VICTIM,victim],[HELPER,helper],[ATTACKER,attacker]]);
 return {systemID:SYSTEM,getEntityByID:(id)=>byId.get(Number(id))||null,
  sessions:new Map([['s1',session]]),victim,helper,attacker,session};
}

const base=()=>{
 const s=scene();
 return {systemID:SYSTEM,scene:s,victim:s.victim,helper:s.helper,attacker:s.attacker,
  session:s.session,verifiedCharacterID:CHARACTER,now:NOW};
};

const witnessed=()=>({systemID:SYSTEM,victimEntityID:VICTIM,attackerShipID:ATTACKER,
 characterID:CHARACTER,atMs:NOW-5000});

test('a native-recorded aggressor still authorizes self-defence',()=>{
 assert.equal(authorize({...base(),
  aggression:{lastAggressorID:ATTACKER,lastAggressedAtMs:NOW-1000}}),true);
});

test('a verified damage witness authorizes self-defence when the controller has none',()=>{
 assert.equal(authorize({...base(),aggression:{},witnessedAggression:witnessed()}),true);
 // the same call without any proof is refused
 assert.equal(authorize({...base(),aggression:{}}),false);
});

test('a witness record must match this exact victim, ship, system and character',()=>{
 const cases=[
  {systemID:30000144},                     // another system
  {victimEntityID:140000999},              // another victim
  {attackerShipID:900000999},              // another attacker ship
  {characterID:2110000999},                // another character
  {atMs:NOW-120001},                       // stale
  {atMs:NOW+1},                            // from the future
  {atMs:'soon'},                           // not a timestamp
 ];
 for(const patch of cases)
  assert.equal(authorize({...base(),aggression:{},
   witnessedAggression:{...witnessed(),...patch}}),false,JSON.stringify(patch));
});

test('a witness never authorizes a stale or mismatched session',()=>{
 const wrongShip=base();
 wrongShip.session={...wrongShip.session,_space:{...wrongShip.session._space,shipID:HELPER}};
 assert.equal(authorize({...wrongShip,aggression:{},witnessedAggression:witnessed()}),false);
 const destroyed=base();
 destroyed.session={...destroyed.session,socket:{destroyed:true}};
 assert.equal(authorize({...destroyed,aggression:{},witnessedAggression:witnessed()}),false);
 const noProof=base();
 noProof.session={...noProof.session,_space:{...noProof.session._space,initialStateSent:false}};
 assert.equal(authorize({...noProof,aggression:{},witnessedAggression:witnessed()}),false);
});

test('the witness cannot authorize an NPC-versus-NPC engagement',()=>{
 const s=scene();
 s.attacker.nativeNpc=true;
 assert.equal(authorize({...base(),scene:s,attacker:s.attacker,victim:s.victim,
  helper:s.helper,session:s.session,aggression:{},witnessedAggression:witnessed()}),false);
});
