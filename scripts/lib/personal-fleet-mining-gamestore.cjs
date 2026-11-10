'use strict';
// PF-47 candidate. Compatible with the native coopAtomicNativeRows API.
// NOT activated: real PF-43/44 lease binding and PF-45 audit are not present.
// All mutations must run against the ONE original GameStore owner/connection.
const TABLE = 'corporationRuntime';
const SEP = '\u001f';
const CLAIMS_KEY = 'coop-personal-fleet' + SEP + 'actor-claims-v1';
const SHUTDOWN_KEY = 'coop-personal-fleet' + SEP + 'mining-shutdown-v1' + SEP;
const PERMIT_KEY = 'coop-personal-fleet' + SEP + 'mining-write-v1' + SEP;
const positive = x => Number.isSafeInteger(x) && x > 0;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const idOK = x => typeof x === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(x);
const tokenOK = x => typeof x === 'string' && /^[A-Za-z0-9._:-]{12,160}$/.test(x);
function fail(code) { const e = Error(code);e.code=code;throw e; }
function requireOK(predicate, code) {if(!predicate)fail(code);}
function clone(o){return structuredClone(o);}
function createNativeMiningGameStoreAdapter({gameStore, leaseAuthority, maxPermitsPerSystem=8192}={}) {
  requireOK(typeof gameStore?.coopAtomicNativeRows?.transact === 'function' &&
    typeof gameStore.coopAtomicNativeRows.isPoisoned === 'function', 'PF47_NATIVE_GAMESTORE_REQUIRED');
  requireOK(leaseAuthority && typeof leaseAuthority.readLease === 'function' &&
    typeof leaseAuthority.releaseLease === 'function', 'PF47_PF44_LEASE_AUTHORITY_REQUIRED');
  requireOK(Number.isSafeInteger(maxPermitsPerSystem) && maxPermitsPerSystem>=1 &&
    maxPermitsPerSystem<=8192,'PF47_PERMIT_LIMIT_INVALID');
  function transact(fn) {
    requireOK(typeof fn === 'function','PF47_MUTATION_REQUIRED');
    requireOK(gameStore.coopAtomicNativeRows.isPoisoned() === false,'PF47_NATIVE_STORE_POISONED');
    return gameStore.coopAtomicNativeRows.transact([TABLE], native => {
      requireOK(native && ['get','put'].every(k=>typeof native[k]==='function'),
        'PF47_GAMESTORE_TX_INVALID');
      const get = key => {
        const r = native.get(TABLE,key);
        requireOK(r !== undefined,'PF47_NATIVE_ROW_READ_UNCERTAIN');
        return r;
      };
      const put = (key,value) => native.put(TABLE,key,clone(value));
      const skey = systemID => {requireOK(positive(systemID),'PF47_SYSTEM_INVALID');return SHUTDOWN_KEY+systemID;};
      const okey = operationID => {requireOK(idOK(operationID),'PF47_OPERATION_INVALID');return PERMIT_KEY+operationID;};
      const state = systemID => {
        const row=get(skey(systemID));
        if(row===null)return {version:1,systemID,gate:null,permits:{}};
        requireOK(row&&row.version===1&&row.systemID===systemID&&
          (row.gate===null||(row.gate&&typeof row.gate==='object'&&!Array.isArray(row.gate)))&&
          row.permits&&typeof row.permits==='object'&&!Array.isArray(row.permits)&&
          Object.keys(row.permits).length<=maxPermitsPerSystem,'PF47_SHUTDOWN_ROW_CORRUPT');
        return row;
      };
      const checkedLease = systemID => {
        requireOK(positive(systemID),'PF47_SYSTEM_INVALID');
        const row=leaseAuthority.readLease(native,systemID);
        if(row===null)return null;
        requireOK(row&&typeof row==='object'&&row.systemID===systemID&&
          ['STARTING','ACTIVE','RELEASED'].includes(row.state)&&tokenOK(row.token),
          'PF47_PF44_LEASE_ROW_UNVERIFIED');
        return clone(row);
      };
      const methods={
        readLease: checkedLease,
        readGate(systemID){return clone(state(systemID).gate);},
        writeGate(gate){
          requireOK(gate&&positive(gate.systemID),'PF47_GATE_INVALID');
          const s=state(gate.systemID);s.gate=clone(gate);put(skey(gate.systemID),s);
        },
        countPersonalClaims(systemID){
          requireOK(positive(systemID),'PF47_SYSTEM_INVALID');
          const claims=get(CLAIMS_KEY);
          // Without an initialized PF claim registry we cannot prove a free system.
          requireOK(claims&&claims.version===1&&claims.claims&&
            typeof claims.claims==='object'&&!Array.isArray(claims.claims)&&
            claims.generations&&typeof claims.generations==='object'&&
            claims.processed&&typeof claims.processed==='object'&&
            !Array.isArray(claims.generations)&&!Array.isArray(claims.processed),
            'PF47_PF_CLAIMS_NOT_PROVEN');
          const actors=Object.entries(claims.claims);
          requireOK(actors.length<=128,'PF47_PF_CLAIMS_OVERFLOW');
          const seenPilots=new Set();
          requireOK(Object.keys(claims.generations).length<=1024&&
            Object.keys(claims.processed).length<=1024,'PF47_PF_CLAIMS_OVERFLOW');
          for(const [id,gen] of Object.entries(claims.generations)){
            requireOK(positive(Number(id))&&String(Number(id))===id&&positive(gen),
              'PF47_PF_GENERATIONS_CORRUPT');
          }
          for(const [id,actor] of actors) {
            requireOK(positive(Number(id))&&String(Number(id))===id&&actor&&
              actor.entityID===Number(id)&&positive(actor.systemID)&&
              /^coop-pilot-[0-9]{3,}$/.test(actor.pilotID||'')&&
              !seenPilots.has(actor.pilotID)&&actor.ownerType==='PERSONAL_FLEET'&&
              positive(actor.generation)&&positive(claims.generations[id])&&
              claims.generations[id]>=actor.generation&&positive(actor.ownerCharacterID)&&
              typeof actor.assignmentID==='string'&&actor.assignmentID.length>0,
              'PF47_PF_CLAIMS_CORRUPT');
            seenPilots.add(actor.pilotID);
          }
          for(const [id,record] of Object.entries(claims.processed)){
            requireOK(idOK(id)&&record&&typeof record.signature==='string'&&
              record.receipt&&typeof record.receipt==='object',
              'PF47_PF_RECEIPTS_CORRUPT');
          }
          return actors.filter(([,actor])=>actor.systemID===systemID).length;
        },
        readPermit(operationID){
          const p=get(okey(operationID));
          if(p===null)return null;
          requireOK(p&&positive(p.systemID)&&p.operationID===operationID&&
            JSON.stringify(state(p.systemID).permits[operationID])===JSON.stringify(p),
            'PF47_PERMIT_INDEX_DIVERGED');
          return clone(p);
        },
        writePermit(permit){
          requireOK(permit&&positive(permit.systemID)&&idOK(permit.operationID),
            'PF47_PERMIT_INVALID');
          const key=okey(permit.operationID),previous=get(key);
          requireOK(previous===null||previous.systemID===permit.systemID,
            'PF47_OPERATION_ID_CROSS_SYSTEM_REUSE');
          const s=state(permit.systemID);
          requireOK(own(s.permits,permit.operationID)||
            Object.keys(s.permits).length<maxPermitsPerSystem,'PF47_PERMIT_LIMIT_REACHED');
          s.permits[permit.operationID]=clone(permit);put(skey(permit.systemID),s);
          put(key,permit);
        },
        listPermits(systemID){
          const list=Object.entries(state(systemID).permits);
          for(const [id,p] of list){
            requireOK(p&&p.operationID===id&&p.systemID===systemID&&
              JSON.stringify(get(okey(id)))===JSON.stringify(p),
              'PF47_PERMIT_INDEX_DIVERGED');
          }
          return list.map(([,p])=>clone(p));
        },
        releaseLease(systemID,token,witness){
          requireOK(tokenOK(token)&&witness&&witness.systemID===systemID&&
            witness.leaseToken===token,'PF47_LEASE_RELEASE_SCOPE_INVALID');
          const before=checkedLease(systemID);
          if(!before||before.state!=='ACTIVE'||before.token!==token)return false;
          const ok=leaseAuthority.releaseLease(native,systemID,token,clone(witness));
          if(ok!==true)return false;
          const after=checkedLease(systemID);
          requireOK(after&&after.state==='RELEASED'&&after.token===token&&
            JSON.stringify(after.witness)===JSON.stringify(witness),
            'PF47_PF44_RELEASE_READBACK_FAILED');
          return true;
        },
      };
      // The original GameStore wrapper itself must reject async callbacks.
      const result=fn(Object.freeze(methods));
      requireOK(!(result && typeof result.then==='function'),'PF47_ASYNC_TRANSACTION_FORBIDDEN');
      return result;
    });
  }
  return Object.freeze({transact});
}
module.exports={createNativeMiningGameStoreAdapter,TABLE,CLAIMS_KEY,SHUTDOWN_KEY,PERMIT_KEY};