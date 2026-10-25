"use strict";
// Optional, fail-safe server-side telemetry for actual EveJS login/logoff.
// Never transmits data and never changes ship simulation or persistence.
const fs = require("node:fs");
const path = require("node:path");
const destination = process.env.EVEJS_COOP_EVENTS_FILE;
function positive(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function describe(session,ship){
  return {
    characterID:positive(session?.characterID),
    shipID:positive(ship?.itemID||session?._space?.shipID||session?.shipid),
    systemID:positive(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid),
    clientID:positive(session?.clientID),
  };
}
function observe(event,session,ship,extra={}){
  if(!destination)return false;
  try {
    const record={
      at:new Date().toISOString(),
      event,
      ...describe(session,ship),
      ...extra,
    };
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.appendFileSync(destination,JSON.stringify(record)+"\n",{encoding:"utf8",flag:"a"});
    return true;
  } catch(err) {
    // Optional telemetry must NEVER affect a real login, disconnect, or ship.
    try { console.warn("[CoopProbe] telemetry write failed:",err.message); } catch {}
    return false;
  }
}
module.exports={observe};
