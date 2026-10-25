"use strict";
// Native market RPC adapter: the original Rust daemon remains sole order writer.
// Claim is durable in market.sqlite before EveJS wallet/item transfer. A lost
// reply is UNKNOWN; do not auto-retry fills or pay ISK without the journal.
const {assertFillAck}=require("./coopPlayerMarketFill"+(__filename.endsWith(".cjs")?".cjs":""));
const positive=n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
const id=x=>typeof x==="string"&&/^[1-9][0-9]*$/.test(x);
function details(ticket,proof){
 if(!ticket||!proof||!Object.isFrozen(proof)||
    !id(ticket.orderID)||ticket.orderID!==proof.orderID||
    !positive(ticket.cycle)||!positive(proof.ownerID)||
    !positive(proof.counterpartyID)||proof.counterpartyID===proof.ownerID||
    !positive(proof.filledQuantity)||!positive(proof.volumeBefore)||
    !positive(proof.priceCents)||proof.volumeBefore<proof.filledQuantity)
  throw Error("P2P_RUST_CLAIM_NATIVE_TICKET_INVALID");
 const buyer=proof.bid?proof.ownerID:proof.counterpartyID;
 const seller=proof.bid?proof.counterpartyID:proof.ownerID;
 return {order_id:proof.orderID,cycle:ticket.cycle,
  buyer_id:buyer,seller_id:seller,
  volume_before:proof.volumeBefore,
  filled_quantity:proof.filledQuantity,
  price_cents:proof.priceCents};
}
async function claim({ticket,proof,client}={}){
 if(typeof client?.call!=="function")
  throw Error("P2P_RUST_MARKET_DAEMON_REQUIRED");
 const request=details(ticket,proof);
 const ack=await client.call("ClaimPlayerFill",request);
 if(ack?.order_id!==request.order_id||ack.cycle!==request.cycle||
    ack.phase!=="claimed"||ack.buyer_id!==request.buyer_id||
    ack.seller_id!==request.seller_id||
    ack.volume_before!==request.volume_before||
    ack.filled_quantity!==request.filled_quantity||
    ack.volume_after!==request.volume_before-request.filled_quantity)
  throw Error("P2P_RUST_CLAIM_RECEIPT_UNVERIFIED");
 return ack;
}
async function finalize({ticket,proof,client}={}){
 if(typeof client?.call!=="function")throw Error("P2P_RUST_MARKET_DAEMON_REQUIRED");
 const request=details(ticket,proof);
 const ack=await client.call("FinalizePlayerFill",{
  order_id:request.order_id,cycle:request.cycle,
  buyer_id:request.buyer_id,seller_id:request.seller_id
 });
 assertFillAck({proof,ack});
 return ack;
}
async function readClaim({ticket,client}={}){
 if(typeof client?.call!=="function"||!id(ticket?.orderID)||
   !positive(ticket.cycle))throw Error("P2P_RUST_READ_CLAIM_INVALID");
 return client.call("GetPlayerFillClaim",
  {order_id:ticket.orderID,cycle:ticket.cycle});
}
module.exports={details,claim,finalize,readClaim};
