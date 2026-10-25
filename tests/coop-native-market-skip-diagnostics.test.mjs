import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {nearestStationMeters}=require("../integration/coopVirtualWorldRuntime.cjs");

const station=(itemID,x,radius=0)=>({kind:"station",itemID,position:{x,y:0,z:0},radius});

test("market gate diagnostics report the real gap to the closest scene station",()=>{
 const ship={position:{x:0,y:0,z:0},radius:0};
 const stations=[station(1,50000),station(2,12000,0)];
 assert.deepEqual(nearestStationMeters(ship,stations),{meters:12000,stationID:2});
});

test("station and ship radius are subtracted so hull size cannot hide a legal dock range",()=>{
 const ship={position:{x:0,y:0,z:0},radius:400};
 const stations=[station(7,10200,900)];
 assert.deepEqual(nearestStationMeters(ship,stations),{meters:8900,stationID:7});
});

test("unknown position or an empty station list yields no fabricated distance",()=>{
 assert.deepEqual(nearestStationMeters({position:{x:NaN,y:0,z:0}},[station(1,10)]),
  {meters:null,stationID:null});
 assert.deepEqual(nearestStationMeters({position:{x:0,y:0,z:0}},[]),
  {meters:null,stationID:null});
 assert.deepEqual(nearestStationMeters(null,null),{meters:null,stationID:null});
});

test("stations without a usable position are ignored instead of counted as zero distance",()=>{
 const ship={position:{x:0,y:0,z:0},radius:0};
 const broken={kind:"station",itemID:3,position:null};
 assert.deepEqual(nearestStationMeters(ship,[broken,station(4,2500)]),
  {meters:2500,stationID:4});
});
