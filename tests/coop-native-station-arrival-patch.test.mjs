import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {patch,fileName}=require('../scripts/coop-native-station-arrival-patch.cjs');
function sample(eol='\n'){
 return [
 'function spawnFleetWing(systemID, centerTarget, options = {}) {',
 '  const sharedSpawnOptions = {',
 '    transient: true,',
 '    broadcast: false,',
 '  };',
 '}',
 'function resolveSessionScene(session) {}',
 'function spawnMiningFleetInternal(scene, options = {}) {',
 '  const haulerSpawnResult = spawnFleetWing(systemID, originAnchor, {',
 '      originAnchor,',
 '      warpIn: false,',
 '  });',
 '}',
 'function issueResponseOrders() {}',
 'function completeHaulCycle(scene, fleetRecord, now) {}',
 'function shouldTriggerHauling() {}',
 'function tickMiningFleet(scene, fleetRecord, now, hooks) {',
 '  if (fleetRecord.state === "loaded") {',
 '    const ingressMs = 1000;',
 '    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {',
 '    }',
 '  }',
 '  if (fleetRecord.state === "haulereturn") {',
 '    if (now >= toFiniteNumber(fleetRecord.haulerReturnAtMs, 0)) {',
 '      if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1") require("../../space/coopNativeHaulCargo").unloadCargo(scene, fleetRecord);',
 '      fleetRecord.state = "mining";',
 '    }',
 '    return;',
 '  }',
 '  if (fleetRecord.state !== "mining") {',
 '  }',
 '}',
 ].join(eol);
}
for(const eol of ['\n','\r\n'])test('reversible physical-arrival hook in '+JSON.stringify(eol),()=>{
 const s=sample(eol),next=patch(s,fileName),again=patch(next,fileName,true);
 assert.equal(again,s); assert.match(next,/routeFromHaul/);assert.match(next,/checkReturn/);
 assert.match(next,/EVEJS_COOP_NPC_STATION_DELIVERY !== "1"/);
 assert.match(next,/options.durableHauler === true \? false : true/);
 assert.equal((next.match(/checkReturn\(scene, fleetRecord, now\)/g)||[]).length,2,
  'both the loader and the return branch consult the physical trip director');
 // The loader must not fall through to the native return-home transition while
 // a real station trip is still in flight.
 assert.match(next,/const delivered = settled\.terminal === true && \(settled\.status === "DELIVERED" \|\| settled\.status === "NO_CARGO"\);/);
});
test('wrong target remains untouched',()=>{const s=sample();assert.equal(patch(s,'server/src/space/random.js'),s)});
test('drift without the original hauler return branch aborts',()=>{
 // The spawn transient flag is owned by the durable-fleet patch now, so drift is
 // proven on a strict anchor: the native loaded handler must exist.
 assert.throws(()=>patch(sample().replace('  if (fleetRecord.state === "loaded") {','  if (fleetRecord.state === "loading") {'),fileName),
  /STATION_(LOADED|ARRIVAL_ANCHOR)_DRIFT/)});

