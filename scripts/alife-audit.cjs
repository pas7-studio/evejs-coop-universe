"use strict";
// ALIFE-1 evidence reader: answer "what did the NPCs do, and what proves it?"
// from one append-only coop-events.jsonl. Read-only, no gameplay state.
const fs = require("node:fs");

const LIFE = /^(living|alife|virtual)-/;
const PLAYER = /^(coop-party|disconnect|undock|space-arrival)/;

function parse(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ""))
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function label(row) {
  return (
    row.pilotID ||
    (row.haulerID ? `hauler:${row.haulerID}` : "") ||
    (row.entityID ? `entity:${row.entityID}` : "") ||
    (row.shipID ? `ship:${row.shipID}` : "")
  );
}

function blockerKey(row) {
  return [row.module || "?", row.status || "?", row.reason || ""]
    .filter(Boolean)
    .join(" / ");
}

const LIFE_STAGES = [
  ["living-native-mining-startup-slot", "fleet-seeded"],
  ["living-hauler-loaded", "cargo-loaded"],
  ["living-npc-station-warp-requested", "warp-to-station"],
  ["living-npc-station-delivered", "station-delivered"],
  ["living-hauler-delivered", "depot-delivered"],
  ["living-native-market-trade", "market-trade"],
  ["alife-blocker", "blocked"],
  ["living-npc-warehouse-blocked", "warehouse-blocked"],
];

function stageOf(event) {
  const hit = LIFE_STAGES.find(([name]) => name === event);
  return hit ? hit[1] : null;
}

function timeline(rows, { limit = 40 } = {}) {
  return rows
    .map((row) => {
      const stage = stageOf(String(row.event || ""));
      if (!stage) return null;
      const who =
        row.pilotID ||
        (row.haulerID ? `hauler:${row.haulerID}` : "") ||
        (row.shipID ? `ship:${row.shipID}` : "") ||
        (row.fleetID ? `fleet:${row.fleetID}` : "");
      const detail =
        row.reason ||
        row.status ||
        (row.side ? `${row.side}:${row.typeID}` : "") ||
        (row.cargoQuantity ? `cargo:${row.cargoQuantity}` : "") ||
        (row.oreQuantity ? `ore:${row.oreQuantity}` : "") ||
        (row.haulers ? `haulers:${row.haulers}` : "");
      return {
        at: row.at,
        stage,
        who,
        detail,
        systemID: row.systemID || null,
        line: `${row.at || "?"}  ${stage.padEnd(18)} ${String(who || "-").padEnd(22)} ${detail || ""}`.trimEnd(),
      };
    })
    .filter(Boolean)
    .slice(-limit);
}

function summarize(rows, { top = 8, since = "" } = {}) {
  const fresh = since ? rows.filter((row) => String(row.at || "") >= since) : rows;
  const events = new Map();
  const blockers = new Map();
  const actors = new Map();
  const trades = [];
  const deliveries = [];
  let first = "";
  let last = "";
  for (const row of fresh) {
    const name = String(row.event || "?");
    events.set(name, (events.get(name) || 0) + 1);
    if (row.at) {
      if (!first || String(row.at) < first) first = String(row.at);
      if (!last || String(row.at) > last) last = String(row.at);
    }
    if (name === "alife-blocker" || /blocked|repair-required/.test(name)) {
      const key = blockerKey(row);
      const entry = blockers.get(key) || { count: 0, first: row.at, last: row.at };
      entry.count += 1;
      entry.last = row.at || entry.last;
      blockers.set(key, entry);
    }
    const who = label(row);
    if (who) actors.set(who, (actors.get(who) || 0) + 1);
    if (name === "living-native-market-trade") trades.push(row);
    if (name === "living-npc-station-delivered" || name === "living-hauler-delivered") deliveries.push(row);
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: fresh.length,
    first,
    last,
    events: sorted(events).slice(0, top),
    blockers: sorted(new Map([...blockers].map(([key, value]) => [key, value.count])))
      .slice(0, top)
      .map(([key, count]) => ({ key, count, ...blockers.get(key) })),
    actors: sorted(actors).slice(0, top),
    trades,
    deliveries,
    lifeEvents: fresh.filter((row) => LIFE.test(String(row.event || ""))).length,
    playerEvents: fresh.filter((row) => PLAYER.test(String(row.event || ""))).length,
  };
}

function report(summary, { title = "ALIFE audit" } = {}) {
  const lines = [];
  lines.push(`${title}: ${summary.total} events (${summary.first || "?"} .. ${summary.last || "?"})`);
  lines.push(`life=${summary.lifeEvents} player=${summary.playerEvents} trades=${summary.trades.length} deliveries=${summary.deliveries.length}`);
  lines.push("");
  lines.push("events");
  for (const [name, count] of summary.events) lines.push(`  ${String(count).padStart(5)}  ${name}`);
  lines.push("");
  lines.push("blockers (module / status / reason)");
  if (!summary.blockers.length) lines.push("  none");
  for (const blocker of summary.blockers) {
    lines.push(`  ${String(blocker.count).padStart(5)}  ${blocker.key}`);
    lines.push(`         first=${blocker.first || "?"} last=${blocker.last || "?"}`);
  }
  lines.push("");
  lines.push("top actors");
  if (!summary.actors.length) lines.push("  none");
  for (const [who, count] of summary.actors) lines.push(`  ${String(count).padStart(5)}  ${who}`);
  for (const trade of summary.trades) {
    lines.push(`TRADE ${JSON.stringify(trade).slice(0, 240)}`);
  }
  for (const delivery of summary.deliveries) {
    lines.push(`DELIVERY ${JSON.stringify(delivery).slice(0, 240)}`);
  }
  return lines.join("\n");
}


// COOP-048 read-only PERCEIVE/DECIDE -> existing native outcome reconciliation.
// An "intent" is never a native ACT command. Matching an observed trade/load
// is evidence of a SEPARATELY executed native director, not proof that ALIFE
// dispatched it. No value, mission or player reward may originate here.
const RECONCILABLE_STAGES=new Set(["BUY_SUPPLIES","RESUPPLY"]);
const MAX_RECONCILE_ROWS=100000;
function atMs(row){
 const value=Date.parse(row?.at);
 return Number.isFinite(value)?value:null;
}
function nativeOutcomeMatches(intent,actual){
 if(actual?.pilotID!==intent.pilotID||
    Number(actual.entityID)!==Number(intent.entityID)||
    Number(actual.systemID)!==Number(intent.systemID)||
    (intent.stationID!=null&&Number(actual.stationID)!==Number(intent.stationID)&&
      intent.stage!=="RESUPPLY"))return false;
 const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
 if(intent.stage==="BUY_SUPPLIES"){
  if(actual.event!=="living-native-market-trade"||actual.status!=="TRADE_SETTLED"||
     actual.side!=="buy"||actual.nativeCargoVerified!==true||
     actual.marketRPCAcknowledged!==true||actual.npcLedgerOnly!==true||
     !positive(actual.cargoID)||!positive(actual.typeID)||
     !positive(actual.quantity)||!positive(actual.stationID)||
     !positive(actual.buyReceipt?.cargoID)||
     Number(actual.buyReceipt.cargoID)!==Number(actual.cargoID)||
     Number(actual.buyReceipt.stationID)!==Number(actual.stationID)||
     Number(actual.buyReceipt.typeID)!==Number(actual.typeID)||
     Number(actual.buyReceipt.quantity)!==Number(actual.quantity)||
     !actual.marketOrderID)return false;
  return true;
 }
 if(intent.stage==="RESUPPLY")
  return actual.event==="living-npc-earned-rearm"&&
   actual.status==="NATIVE_NPC_CHARGE_LOADED"&&
   actual.nativeModuleVisible===true&&actual.iskGranted===false&&
   actual.cargoItemsCreated===0&&positive(actual.cargoID)&&
   positive(actual.moduleID)&&positive(actual.quantity);
 return false;
}
function reconcileNativeIntents(rows,{windowMs=600000,maxIntents=5000}={}){
 if(!Array.isArray(rows)||rows.length>MAX_RECONCILE_ROWS||
    !Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>86400000||
    !Number.isSafeInteger(maxIntents)||maxIntents<1||maxIntents>20000)
  return {status:"INVALID_RECONCILIATION_INPUT",results:[],counts:{}};
 const intents=rows.map((r,i)=>({row:r,index:i,when:atMs(r)}))
  .filter(x=>x.row?.event==="alife-economy-intent");
 if(intents.length>maxIntents)
  return {status:"INTENT_LIMIT_EXCEEDED",results:[],counts:{}};
 const outcomes=rows.map((r,i)=>({row:r,index:i,when:atMs(r)}))
  .filter(x=>x.row?.event==="living-native-market-trade"||
    x.row?.event==="living-npc-earned-rearm");
 const claimed=new Set(),results=[],counts={
  NATIVE_OUTCOME_OBSERVED:0,NO_AUTHORITATIVE_ACT_PROOF:0,
  INTENT_NOT_CONNECTED_TO_ACT:0,INVALID_INTENT_IDENTITY:0};
 for(const entry of intents){
  const intent=entry.row;
  const valid=typeof intent.intentID==="string"&&intent.intentID.length>0&&
   /^coop-pilot-[0-9]{3,}$/.test(intent.pilotID||"")&&
   Number.isSafeInteger(intent.entityID)&&intent.entityID>0&&
   Number.isSafeInteger(intent.systemID)&&intent.systemID>0&&
   entry.when!==null&&intent.nativeMutation===false&&
   intent.proof==="NATIVE_READ_ONLY";
  let status="NO_AUTHORITATIVE_ACT_PROOF",proof=null;
  if(!valid)status="INVALID_INTENT_IDENTITY";
  else if(!RECONCILABLE_STAGES.has(intent.stage))
   status="INTENT_NOT_CONNECTED_TO_ACT";
  else{
   const found=outcomes.find(o=>!claimed.has(o.index)&&o.when!==null&&
    o.when>=entry.when&&o.when-entry.when<=windowMs&&
    nativeOutcomeMatches(intent,o.row));
   if(found){
    claimed.add(found.index);
    status="NATIVE_OUTCOME_OBSERVED";
    proof={event:found.row.event,at:found.row.at,
     cargoID:Number(found.row.cargoID),entityID:Number(found.row.entityID),
     ...(found.row.marketOrderID?{marketOrderID:String(found.row.marketOrderID)}:{})};
   }
  }
  counts[status]++;
  results.push({intentID:typeof intent.intentID==="string"?intent.intentID:null,
   pilotID:typeof intent.pilotID==="string"?intent.pilotID:null,
   stage:String(intent.stage||"UNKNOWN"),systemID:intent.systemID||null,
   status,proof});
 }
 return {status:results.some(x=>x.status==="INVALID_INTENT_IDENTITY")?
  "INVALID_EVIDENCE":results.some(x=>x.status!=="NATIVE_OUTCOME_OBSERVED")?
  "REQUIRES_NATIVE_E2E_PROOF":"ALL_SUPPORTED_INTENTS_HAVE_NATIVE_EVIDENCE",
  intents:results.length,matched:counts.NATIVE_OUTCOME_OBSERVED,
  counts,results};
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error("usage: node scripts/alife-audit.cjs <coop-events.jsonl> [--since ISO] [--top N]");
    process.exit(2);
  }
  const sinceFlag = process.argv.indexOf("--since");
  const topFlag = process.argv.indexOf("--top");
  const since = sinceFlag > 0 ? String(process.argv[sinceFlag + 1] || "") : "";
  const top = topFlag > 0 ? Math.max(1, Number(process.argv[topFlag + 1]) || 8) : 8;
  const rows = parse(fs.readFileSync(file, "utf8"));
  if (process.argv.includes("--reconcile")) {
    console.log(JSON.stringify(reconcileNativeIntents(rows),null,2));
    process.exit(0);
  }
  if (process.argv.includes("--timeline")) {
    const windowRows = since ? rows.filter((row) => String(row.at || "") >= since) : rows;
    const lines = timeline(windowRows).map((entry) => entry.line);
    console.log(lines.length ? lines.join("\n") : "no life stages in this window");
    process.exit(0);
  }
  console.log(report(summarize(rows, { since, top })));
}

module.exports = { parse, summarize, report, blockerKey, timeline, stageOf, reconcileNativeIntents, nativeOutcomeMatches };
