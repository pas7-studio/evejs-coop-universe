"use strict";
// COOP-055: best-effort, AT-MOST-ONCE native seller notification.
// The durable Rust price history, GameStore wallet + items and original
// receipt already exist before this module is ever called. Never invokes
// RecordTrade, never touches a player's escrow or credits a wallet.
const FILL_BASE=930000000000000,SEP="\u001f";
const pos=n=>Number.isSafeInteger(n)&&n>0;
const nonneg=n=>Number.isSafeInteger(n)&&n>=0;
const number=n=>typeof n==="string"&&/^(0|[1-9][0-9]*)$/.test(n)?Number(n):n;
const money=v=>typeof v==="number"&&Number.isFinite(v)&&
 Number.isSafeInteger(Math.round(v*100))?Math.round(v*100):null;
function createNpcMarketCompletionNotifier({gameStore,marketClient,
 sessions,helpers,walletState,clock=()=>Date.now(),env=process.env}={}){
 if(typeof gameStore?.transact!=="function"||
    typeof marketClient?.call!=="function"||
    typeof sessions?.getSessions!=="function"||
    ["buildKeyVal","buildList","buildFiletimeLong"].some(x=>
      typeof helpers?.[x]!=="function")||
    ["getCharacterWallet","syncWalletToSession","emitAccountChangeToSession"]
      .some(x=>typeof walletState?.[x]!=="function")||
    typeof clock!=="function")
  throw Error("NPC_MARKET_NOTIFY_NATIVE_AUTHORITIES_REQUIRED");
 const denied=reason=>({status:"NOT_SENT",reason});
 function receiptProof(r,claimKey,fillID){
  return r?.phase==="NATIVE_NPC_BUY_COMMITTED"&&r.claimKey===claimKey&&
   r.fillID===fillID&&pos(r.orderID)&&pos(r.sellerID)&&
   pos(r.buyerCorpID)&&pos(r.stationID)&&pos(r.typeID)&&pos(r.itemID)&&
   pos(r.quantity)&&pos(r.priceCents)&&
   r.grossCents===r.quantity*r.priceCents&&
   nonneg(r.taxCents)&&r.netCents===r.grossCents-r.taxCents&&
   r.taxPolicy==="EVEJS_NATIVE_MARKET_RULES"&&
   nonneg(r.sellerAfterCents)&&nonneg(r.buyerAfterCents);
 }
 function orderProof(o,r){
  const row=o?.row;
  return o?.source==="player"&&o.is_corp===false&&
   o.state==="filled"&&row?.bid===false&&
   number(o.owner_id)===r.sellerID&&
   number(row.order_id)===r.orderID&&
   number(row.station_id)===r.stationID&&
   number(row.type_id)===r.typeID&&
   number(row.vol_remaining)===0&&money(row.price)===r.priceCents;
 }
 function orderEntry(o,r){
  const row=o.row;
  const longValue=number(row.order_id);
  const raw=Date.parse(String(row.issued_at??""));
  if(!pos(longValue)||!Number.isFinite(raw))throw Error("NPC_MARKET_NOTIFY_ORDER_DATE_INVALID");
  const ft=BigInt(Math.trunc(raw))*10000n+116444736000000000n;
  return helpers.buildKeyVal([
   ["orderID",{type:"long",value:BigInt(longValue)}],
   ["typeID",r.typeID],["charID",r.sellerID],
   ["regionID",Number(row.region_id)||0],
   ["stationID",r.stationID],
   ["range",Number(row.range_value)||0],
   ["bid",0],["price",r.priceCents/100],
   ["volEntered",Number(row.vol_entered)||r.quantity],
   ["volRemaining",0],
   ["issueDate",helpers.buildFiletimeLong(ft)],
   ["minVolume",Number(row.min_volume)||1],["contraband",0],
   ["duration",Number(row.duration_days)||0],["isCorp",0],
   ["solarSystemID",Number(row.solar_system_id)||0],["escrow",0]
  ]);
 }
 async function notifyCommitted({claimKey,fillID}={}){
  if(env.EVEJS_COOP_NPC_BUY_NOTIFY!=="1"||
     env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1"||
     env.EVEJS_COOP_NPC_BUY_PLAYER_ASK!=="1")
   return denied("DISABLED");
  if(typeof claimKey!=="string"||
     !/^npc-corpbuy:[0-9a-f]{32}$/.test(claimKey)||
     !pos(fillID)||fillID<=FILL_BASE)
   return denied("CLAIM_SCOPE_INVALID");
  const key="corp-buy"+SEP+fillID;
  const load=()=>gameStore.transact(["npcMarketFills"],tx=>tx.get("npcMarketFills",key));
  const nativeRead=load();
  const first=nativeRead?.result??nativeRead;
  if(!receiptProof(first,claimKey,fillID))
   return denied("GAMESTORE_RECEIPT_INVALID");
  if(first.sellerNotifyClaimedAt!==undefined)
   return {status:"ALREADY_CLAIMED",fillID,at:first.sellerNotifyClaimedAt};
  let rust,order;
  try{
   rust=await marketClient.call("GetNpcCorpPlayerClaim",{claim_key:claimKey});
   order=await marketClient.call("GetOrder",{order_id:String(first.orderID)});
  }catch{return denied("MARKET_AUTHORITY_UNAVAILABLE")}
  if(rust?.claim_key!==claimKey||rust.state!=="filled"||
     rust.fill_phase!=="finalized"||rust.history_recorded!==true||
     number(rust.fill_id)!==fillID||number(rust.order_id)!==first.orderID||
     number(rust.owner_id)!==first.sellerID||
     number(rust.quantity)!==first.quantity||
     number(rust.price_cents)!==first.priceCents||
     !/^\d{4}-\d{2}-\d{2}$/.test(String(rust.history_day??""))||
     !orderProof(order,first))
   return denied("RUST_FINALIZE_OR_ORDER_UNVERIFIED");
  let active;
  try{
   active=sessions.getSessions().filter(s=>s&&
    Number(s.characterID)===first.sellerID&&
    typeof s.sendNotification==="function");
  }catch{return denied("SESSION_AUTHORITY_UNAVAILABLE")}
  if(active.length===0)return {status:"SELLER_OFFLINE",fillID};
  let wallet;
  try{wallet=walletState.getCharacterWallet(first.sellerID)}
  catch{return denied("NATIVE_WALLET_UNAVAILABLE")}
  if(wallet?.characterID!==first.sellerID||
     money(wallet.balance)===null||money(wallet.balance)<0)
   return denied("NATIVE_WALLET_UNVERIFIED");
  let payload;
  try{payload=helpers.buildList([orderEntry(order,first)])}
  catch{return denied("ORDER_NOTIFICATION_MARSHAL_INVALID")}
  const at=clock();
  if(!pos(at))return denied("NOTIFY_CLOCK_INVALID");
  // Durable delivery claim BEFORE send. Distinct processes cannot send
  // duplicate events; a crash after the claim can lose a transient event,
  // but clients can refresh the authoritative market order/wallet.
  const result=gameStore.transact(["npcMarketFills"],tx=>{
   const fresh=tx.get("npcMarketFills",key);
   if(!receiptProof(fresh,claimKey,fillID))
    return {status:"RECEIPT_CHANGED"};
   if(fresh.sellerNotifyClaimedAt!==undefined)
    return {status:"ALREADY_CLAIMED",at:fresh.sellerNotifyClaimedAt};
   tx.put("npcMarketFills",key,{...fresh,
    sellerNotifyClaimedAt:at,
    sellerNotifyProtocol:"NATIVE_MARKET_SELLER_AT_MOST_ONCE"});
   return {status:"CLAIMED"};
  });
  const claim=result?.result??result;
  if(claim?.status!=="CLAIMED")
   return {status:claim?.status||"RECEIPT_CHANGED",fillID};
  let delivered=0,failed=0;
  for(const session of active){
   try{
    session.sendNotification("OnOwnOrdersChanged","charid",
     [payload,"Filled",0]);
    walletState.syncWalletToSession(session,wallet);
    walletState.emitAccountChangeToSession(session,{
     ownerID:first.sellerID,balance:wallet.balance});
    delivered++;
   }catch{failed++}
  }
  return {status:failed?"CLAIMED_PARTIAL":"NOTIFIED",
   fillID,delivered,failed,at};
 }
 return Object.freeze({notifyCommitted,mode:"NATIVE_SELLER_AT_MOST_ONCE"});
}
module.exports={createNpcMarketCompletionNotifier};
