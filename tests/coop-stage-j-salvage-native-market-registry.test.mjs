import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {names,PIN}=require("../scripts/patch-evejs-coop.cjs");
const mustShip=[
 "coopSalvageNpcRivals",
 "coopSalvageNpcStationDelivery",
 "coopNpcPendingMarketEscrow",
 "coopSalvageNpcPendingMarket"
];
test("pinned overlay ships physical rival station and source-backed native market modules",()=>{
 assert.equal(PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 for(const name of mustShip)
  assert.equal(names.filter(x=>x===name).length,1,name+" missing or duplicated");
});
test("native market dependencies are installed after original NPC salvager",()=>{
 const rival=names.indexOf("coopSalvageNpcRivals");
 for(const name of mustShip.slice(1))
  assert.ok(names.indexOf(name)>rival,"incompatible copy order for "+name);
 assert.equal(new Set(names).size,names.length);
});
