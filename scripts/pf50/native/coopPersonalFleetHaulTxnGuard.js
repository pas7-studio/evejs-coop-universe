"use strict";
// PF-50. Read-only native GameStore ownership check. Never creates an actor,
// issues an order or transfers a cargo item. Must run IN the same original
// BEGIN IMMEDIATE transaction that writes npcCargo.
const TABLE = "corporationRuntime", SEP = "\u001f";
const CLAIMS = "coop-personal-fleet"+SEP+"actor-claims-v1";
const WAR = "coop-faction-war"+SEP+"fleet-registry-v1";
const SHUTDOWN = "coop-personal-fleet"+SEP+"mining-shutdown-v1"+SEP;
const PERMIT = "coop-personal-fleet"+SEP+"mining-write-v1"+SEP;
const POS = x => Number.isSafeInteger(x)&&x>0;
const ROW = x => !!x&&typeof x==="object"&&!Array.isArray(x);
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const pilot = x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
const keyOK=x=>typeof x==="string"&&/^[A-Za-z0-9._:-]{1,128}$/.test(x);
const tokenOK=x=>typeof x==="string"&&/^[A-Za-z0-9._:-]{12,160}$/.test(x);
const bail=x=>{throw Error("PF50_"+x)};
const need=(v,x)=>{if(!v)bail(x)};
function rowGet(tx,key){
 let r;try{r=tx.get(TABLE,key)}catch{bail("NATIVE_READ_FAILED")}
 need(r!==undefined,"NATIVE_READ_UNCERTAIN");return r;
}
function validatePersonalClaims(claims,systemID,minerID,haulerID){
 need(ROW(claims)&&claims.version===1&&ROW(claims.claims)&&ROW(claims.generations)&&
   ROW(claims.processed),"PERSONAL_CLAIMS_UNPROVEN");
 const ids=Object.keys(claims.claims), gens=Object.keys(claims.generations),
   receipts=Object.keys(claims.processed);
 need(ids.length<=128&&gens.length<=1024&&receipts.length<=1024,"PERSONAL_CLAIM_CAP");
 const seen=new Set();
 for(const [id,gen] of Object.entries(claims.generations))
   need(POS(Number(id))&&String(Number(id))===id&&POS(gen),"CLAIM_GENERATION_CORRUPT");
 for(const [id,c] of Object.entries(claims.claims)){
   need(POS(Number(id))&&String(Number(id))===id&&ROW(c)&&c.entityID===Number(id)&&
     pilot(c.pilotID)&&!seen.has(c.pilotID)&&POS(c.systemID)&&
     POS(c.generation)&&claims.generations[id]>=c.generation&&
     POS(c.ownerCharacterID)&&keyOK(c.assignmentID)&&
     c.ownerType==="PERSONAL_FLEET","PERSONAL_CLAIM_CORRUPT");
   seen.add(c.pilotID);
   // Treat any Personal Fleet claim in the system as unsafe until *every*
   // system-wide competing writer uses this same native lease protocol.
   need(c.systemID!==systemID&&c.entityID!==minerID&&c.entityID!==haulerID,
     "PERSONAL_FLEET_ACTOR_RESERVED");
 }
 for(const [id,r] of Object.entries(claims.processed))
   need(keyOK(id)&&ROW(r)&&typeof r.signature==="string"&&ROW(r.receipt),"CLAIM_RECEIPT_CORRUPT");
}
function validateWar(war,minerID,haulerID){
 // Empty registry is safe only when the original WAR writer has independently
 // been proven part of the global fence; do not use this as coverage proof.
 if(war===null)return;
 need(ROW(war)&&war.version===1&&ROW(war.ships)&&
   (war.transfers===undefined||ROW(war.transfers)),"WAR_UNPROVEN");
 for(const rows of [war.ships,war.transfers||{}]){
   need(Object.keys(rows).length<=256,"WAR_CAP");
   for(const [id,c] of Object.entries(rows)){
     need(POS(Number(id))&&String(Number(id))===id&&ROW(c)&&
       c.entityID===Number(id)&&pilot(c.pilotID),"WAR_ACTOR_CORRUPT");
     need(c.entityID!==minerID&&c.entityID!==haulerID,"WAR_ACTOR_RESERVED");
   }
 }
}
function assertHaulWriteAuthorized(tx,{systemID,minerID,haulerID,opKey}={},readLease){
 need(ROW(tx)&&typeof tx.get==="function","TX_UNAVAILABLE");
 need(POS(systemID)&&POS(minerID)&&POS(haulerID)&&minerID!==haulerID&&
    typeof opKey==="string"&&/^pf-haul:[a-f0-9]{64}$/.test(opKey),"SCOPE_INVALID");
 need(typeof readLease==="function","PF44_READER_MISSING");
 validatePersonalClaims(rowGet(tx,CLAIMS),systemID,minerID,haulerID);
 validateWar(rowGet(tx,WAR),minerID,haulerID);
 const row=rowGet(tx,SHUTDOWN+systemID);
 need(ROW(row)&&row.version===1&&row.systemID===systemID&&
    ROW(row.gate)&&ROW(row.permits)&&Object.keys(row.permits).length<=8192,"SHUTDOWN_UNPROVEN");
 // A crash after the original cargo commit but before ACK leaves a PENDING
 // permit. Do not start another haul in that system until the original source
 // receipt is reconciled; a changed cargo preimage would create a new opKey.
 for(const [key,other] of Object.entries(row.permits)){
   need(typeof key==="string"&&key.length>=8&&key.length<=160&&ROW(other)&&
     other.operationID===key&&other.systemID===systemID&&
     tokenOK(other.leaseToken)&&["PENDING","ACKED"].includes(other.state)&&
     typeof other.writer==="string","PERMIT_LEDGER_CORRUPT");
   if(key!==opKey&&other.writer==="haul_transfer"&&other.state==="PENDING")
     bail("PRIOR_HAUL_OUTCOME_UNRESOLVED");
 }
 const gate=row.gate;
 need(gate.systemID===systemID&&gate.state==="ACTIVE"&&gate.stopPhase==="NONE"&&
    tokenOK(gate.leaseToken)&&Array.isArray(gate.writerNames)&&
    gate.writerNames.includes("haul_transfer")&&
    new Set(gate.writerNames).size===gate.writerNames.length,"HAUL_GATE_NOT_ACTIVE");
 let lease;try{lease=readLease(tx,systemID)}catch{bail("PF44_LEASE_READ_FAILED")}
 need(ROW(lease)&&lease.systemID===systemID&&lease.state==="ACTIVE"&&
    lease.token===gate.leaseToken,"PF44_LEASE_UNPROVEN");
 const p=rowGet(tx,PERMIT+opKey);
 need(ROW(p)&&p.systemID===systemID&&p.leaseToken===lease.token&&
    p.operationID===opKey&&p.writer==="haul_transfer"&&p.state==="PENDING"&&
    p.attemptID===null&&ROW(row.permits[opKey])&&
    JSON.stringify(row.permits[opKey])===JSON.stringify(p),"HAUL_PERMIT_UNPROVEN");
 return true;
}
module.exports={assertHaulWriteAuthorized,CLAIMS,WAR,SHUTDOWN,PERMIT};