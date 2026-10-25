"use strict";
// Prints the published NPC courier rate so the issuer can see an approximate
// price BEFORE creating a contract. The formula lives in
// integration/coopCourierDispatch.cjs (quoteCourier) and is documented in
// docs/NPC_COURIER_CONTRACTS.md. This script only prints numbers; it never
// creates, accepts or settles anything.
//
//   node scripts/Get-CourierRateTable.cjs
//   node scripts/Get-CourierRateTable.cjs --volume 5000 --jumps 2 --collateral 1000000 --hull freighter
const path = require("path");
const { quoteCourier } = require(path.join(__dirname, "..", "integration", "coopCourierDispatch.cjs"));

const args = process.argv.slice(2);
function opt(name, fallback) {
  const index = args.indexOf("--" + name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
function isk(value) {
  return Number(value).toLocaleString("en-US") + " ISK";
}

const policy = {};
if (args.includes("--base")) policy.baseIsk = Number(opt("base", 0));
if (args.includes("--per-m3")) policy.iskPerM3 = Number(opt("per-m3", 0));
if (args.includes("--per-jump")) policy.iskPerJump = Number(opt("per-jump", 0));
if (args.includes("--premium")) policy.collateralPremiumRate = Number(opt("premium", 0));

const single = args.includes("--volume");
if (single) {
  const quote = quoteCourier({
    volumeM3: Number(opt("volume", 0)),
    jumps: Number(opt("jumps", 1)),
    collateral: Number(opt("collateral", 0)),
    hullClass: opt("hull", "industrial"),
  }, policy);
  if (quote.status !== "QUOTED") {
    console.log("no quote: " + quote.reason);
    process.exit(2);
  }
  console.log(`\n${quote.hullClass}, ${quote.volumeM3} m3, ${quote.jumps} jump(s), collateral ${isk(quote.collateral)}`);
  console.log(`  base        ${isk(quote.breakdown.baseIsk)}`);
  console.log(`  volume      ${isk(quote.breakdown.volumeIsk)}`);
  console.log(`  distance    ${isk(quote.breakdown.distanceIsk)}`);
  console.log(`  collateral  ${isk(quote.breakdown.riskIsk)}`);
  console.log(`  hull        ${isk(quote.breakdown.hullIsk)}`);
  console.log(`  TOTAL       ${isk(quote.totalIsk)}\n`);
  process.exit(0);
}

const collateral = Number(opt("collateral", 0));
const volumes = [10, 100, 1000, 5000, 50000, 435000];
const jumpsList = [1, 2, 3, 5, 10];
// Real stock hull capacities, so the table never quotes cargo that cannot fit.
const HULL_CAPACITY = { industrial: 4800, freighter: 435000 };

console.log(`\nNPC courier rate table (collateral ${isk(collateral)})\n`);
for (const hullClass of ["industrial", "freighter"]) {
  console.log(hullClass.toUpperCase() + ` (up to ${HULL_CAPACITY[hullClass].toLocaleString("en-US")} m3)`);
  console.log("  volume m3 |" + jumpsList.map((jumps) => ` ${String(jumps)} jump`).join(" |"));
  for (const volumeM3 of volumes) {
    if (volumeM3 > HULL_CAPACITY[hullClass]) {
      console.log("  " + String(volumeM3).padStart(9) + " | " + jumpsList.map(() => "too big").join(" | "));
      continue;
    }
    const cells = jumpsList.map((jumps) => {
      const quote = quoteCourier({ volumeM3, jumps, collateral, hullClass }, policy);
      return quote.status === "QUOTED" ? quote.totalIsk.toLocaleString("en-US") : "-";
    });
    console.log("  " + String(volumeM3).padStart(9) + " | " + cells.join(" | "));
  }
  console.log("");
}
console.log("Service price, not a market clearing price. A destroyed courier forfeits the");
console.log("collateral to the issuer; with zero collateral the issuer gets nothing back.\n");
