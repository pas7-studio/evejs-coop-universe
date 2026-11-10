'use strict';
/**
 * PF94 proposal for the ORIGINAL single GameStore SQLite transaction owner.
 * Only the original owner can install the writer closure after BEGIN IMMEDIATE.
 * NEVER wrap an arbitrary GameStore tx at PF runtime and call it attested:
 * unwrapped source writers would bypass this instrumented capability.
 * Original EveJS owner hook has NOT been installed.
 */
const issued=new WeakMap();
const posInt=x=>Number.isSafeInteger(x)&&x>=0;
function createOriginalOwnerMutationEpoch({get,scan,put,del}={}){
 if([get,scan,put,del].some(f=>typeof f!=='function'))
  throw Error('PF94_NATIVE_GAMESTORE_OWNER_METHODS_REQUIRED');
 let count=0,closed=false;
 const alive=()=>{if(closed)throw Error('PF94_NATIVE_TRANSACTION_CLOSED')};
 const tx=Object.freeze({
  get(t,k){alive();return get(t,k)},
  scan(t){alive();return scan(t)},
  put(t,k,v){alive();count++;return put(t,k,v)},
  del(t,k){alive();count++;return del(t,k)},
 });
 const mark=Object.freeze({reads:()=>{alive();return count},close:()=>{closed=true}});
 issued.set(tx,mark);
 return Object.freeze({tx,close:mark.close});
}
function verifyOriginalSessionWitnessWithOwnerEpoch(tx,callback,request){
 const mark=issued.get(tx);
 if(!mark||typeof callback!=='function')
  throw Error('PF94_AUTHENTIC_NATIVE_OWNER_EPOCH_REQUIRED');
 const before=mark.reads();
 if(!posInt(before))throw Error('PF94_INVALID_NATIVE_OWNER_EPOCH');
 const reader=Object.freeze({
  get:(t,k)=>structuredClone(tx.get(t,k)),
  scan:t=>structuredClone(tx.scan(t)),
 });
 let result,problem;
 try{
  result=callback(request,reader);
  if(result&&typeof result.then==='function')
   throw Error('PF94_ASYNC_ORIGINAL_WITNESS_FORBIDDEN');
 }catch(e){problem=e}
 const after=mark.reads();
 if(!posInt(after)||after!==before)
  throw Error('PF94_NATIVE_OWNER_SQLITE_WRITE_ATTEMPT_ROLLBACK');
 if(problem)throw problem;
 return result===true;
}
module.exports={createOriginalOwnerMutationEpoch,verifyOriginalSessionWitnessWithOwnerEpoch};
