import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {
 evaluateContract,evaluateCourierIdentity,planSettlement,selectHull,planRoute,piracyOpportunity,quoteCourier,
}=require('../integration/coopCourierDispatch.cjs');

function courier(overrides={}){
 return {
  contractID:5001,
  contractType:'courier',
  status:'outstanding',
  plasticWrapItemID:1200001,
  volume:3500,
  reward:2500000,
  collateral:0,
  startStationID:60003760,
  endStationID:60003761,
  startSolarSystemID:30000144,
  endSolarSystemID:30000144,
  ...overrides,
 };
}
const HULLS=[
 {name:'Bestower',typeID:1944,capacityM3:4800},
 {name:'Charon',typeID:20185,capacityM3:435000},
];
const STATIONS={
 60003760:{stationID:60003760,solarSystemID:30000144},
 60003761:{stationID:60003761,solarSystemID:30000144},
 60003762:{stationID:60003762,solarSystemID:30000142},
};

test('a normal same-system courier contract with a fitting hull is eligible',()=>{
 const result=evaluateContract(courier(),{},{walletIsk:0,hullCapacityM3:4800});
 assert.equal(result.status,'ELIGIBLE');
 assert.equal(result.volumeM3,3500);
 assert.equal(result.reward,2500000);
});

test('only real courier contracts in a legal state are considered',()=>{
 assert.equal(evaluateContract(courier({contractType:'item_exchange'}),{},{hullCapacityM3:4800}).status,'REFUSED_NOT_COURIER');
 assert.equal(evaluateContract(courier({status:'in_progress'}),{},{hullCapacityM3:4800}).status,'REFUSED_STATUS');
 assert.equal(evaluateContract(courier({status:'finished'}),{},{hullCapacityM3:4800}).status,'REFUSED_STATUS');
 assert.equal(evaluateContract(null,{},{}).status,'REFUSED_NO_CONTRACT');
});

test('a contract without a real package or volume is refused, never partially loaded',()=>{
 assert.equal(evaluateContract(courier({plasticWrapItemID:0}),{},{hullCapacityM3:4800}).status,'REFUSED_NO_PACKAGE');
 assert.equal(evaluateContract(courier({volume:0}),{},{hullCapacityM3:4800}).status,'REFUSED_NO_VOLUME');
 assert.equal(evaluateContract(courier({volume:9000}),{},{hullCapacityM3:4800}).status,'REFUSED_VOLUME_EXCEEDS_HULL');
});

test('collateral is either zero by policy or covered by real native wallet funds',()=>{
 assert.equal(evaluateContract(courier({collateral:1000}),{},{walletIsk:5000,hullCapacityM3:4800}).status,'REFUSED_COLLATERAL_POLICY');
 assert.equal(evaluateContract(courier({collateral:1000}),{requireZeroCollateral:false},{walletIsk:500,hullCapacityM3:4800}).status,'REFUSED_COLLATERAL_UNFUNDED');
 assert.equal(evaluateContract(courier({collateral:1000}),{requireZeroCollateral:false},{walletIsk:5000,hullCapacityM3:4800}).status,'ELIGIBLE');
});

test('a cross-system contract is reported, not silently attempted',()=>{
 const result=evaluateContract(courier({endSolarSystemID:30000142}),{},{hullCapacityM3:4800});
 assert.equal(result.status,'NEEDS_GATE_TRAVEL');
 const open=evaluateContract(courier({endSolarSystemID:30000142}),{sameSystemOnly:false},{hullCapacityM3:4800});
 assert.equal(open.status,'ELIGIBLE');
});

test('hull selection picks the smallest hull that actually fits',()=>{
 assert.equal(selectHull(3500,HULLS).name,'Bestower');
 assert.equal(selectHull(300000,HULLS).name,'Charon');
 assert.equal(selectHull(500000,HULLS).status,'NO_HULL_FITS');
 assert.equal(selectHull(0,HULLS).status,'NO_HULL_FITS');
});

test('hull selection ignores hulls without a real typeID or capacity',()=>{
 const hulls=[{name:'broken',typeID:0,capacityM3:999999},...HULLS];
 assert.equal(selectHull(300000,hulls).name,'Charon');
});

test('route planning stays inside one solar system',()=>{
 const route=planRoute(courier(),STATIONS);
 assert.equal(route.status,'ROUTE_PLANNED');
 assert.equal(route.legs.length,1);
 assert.equal(route.legs[0].fromStationID,60003760);
 assert.equal(route.legs[0].toStationID,60003761);
 assert.equal(route.legs[0].kind,'in-system');
});

test('route planning refuses unknown, same and cross-system stations',()=>{
 assert.equal(planRoute(courier({startStationID:1}),STATIONS).status,'NO_ROUTE');
 assert.equal(planRoute(courier({endStationID:60003760}),STATIONS).status,'NO_ROUTE');
 const cross=planRoute(courier({endStationID:60003762}),STATIONS);
 assert.equal(cross.status,'NEEDS_GATE_TRAVEL');
});

test('piracy is skipped unless explicitly enabled',()=>{
 const route=planRoute(courier(),STATIONS);
 assert.equal(piracyOpportunity(route,{},'seed').status,'PIRACY_SKIPPED');
 assert.equal(piracyOpportunity(route,{enabled:false},'seed').status,'PIRACY_SKIPPED');
});

test('piracy rolls are deterministic and bounded by the configured chance',()=>{
 const route=planRoute(courier(),STATIONS);
 const first=piracyOpportunity(route,{enabled:true,chancePerLeg:1},'contract-5001');
 const second=piracyOpportunity(route,{enabled:true,chancePerLeg:1},'contract-5001');
 assert.deepEqual(first,second);
 assert.deepEqual(first.attackOrderLegs,[1]);
 const none=piracyOpportunity(route,{enabled:true,chancePerLeg:0},'contract-5001');
 assert.deepEqual(none.attackOrderLegs,[]);
});

test('a courier quote grows with volume, jumps and collateral',()=>{
 const small=quoteCourier({volumeM3:100,jumps:1,collateral:0});
 const big=quoteCourier({volumeM3:1000,jumps:1,collateral:0});
 const far=quoteCourier({volumeM3:100,jumps:3,collateral:0});
 const insured=quoteCourier({volumeM3:100,jumps:1,collateral:10000000});
 assert.equal(small.status,'QUOTED');
 assert.ok(big.totalIsk>small.totalIsk);
 assert.ok(far.totalIsk>small.totalIsk);
 assert.ok(insured.totalIsk>small.totalIsk);
 assert.equal(small.breakdown.riskIsk,0);
});

test('a quote is deterministic, rounded and class-aware',()=>{
 const industrial=quoteCourier({volumeM3:5000,jumps:2,collateral:1000000,hullClass:'industrial'});
 const freighter=quoteCourier({volumeM3:5000,jumps:2,collateral:1000000,hullClass:'freighter'});
 assert.deepEqual(industrial,quoteCourier({volumeM3:5000,jumps:2,collateral:1000000,hullClass:'industrial'}));
 assert.ok(freighter.totalIsk>industrial.totalIsk);
 assert.equal(industrial.totalIsk%1000,0);
 assert.equal(
  industrial.breakdown.baseIsk+industrial.breakdown.volumeIsk+
  industrial.breakdown.distanceIsk+industrial.breakdown.riskIsk+
  industrial.breakdown.hullIsk,
  industrial.totalIsk
 );
});

test('a quote refuses unknown hull classes and empty volume',()=>{
 assert.equal(quoteCourier({volumeM3:0}).status,'NO_QUOTE');
 assert.equal(quoteCourier({volumeM3:100,hullClass:'shuttle'}).status,'NO_QUOTE');
});

test('an NPC courier is only ready when it is a real character with funds and a real ship at the origin',()=>{
 const contract=courier({volume:29500,collateral:300000});
 const character={characterID:140000010,accountId:9,stationID:60003760,balance:500000};
 const ship={itemID:9988400000999,typeID:20185,stationID:60003760,capacityM3:435000};
 assert.equal(evaluateCourierIdentity({character,ship},contract).status,'READY');
 assert.equal(evaluateCourierIdentity({ship},contract).status,'REFUSED_NO_CHARACTER');
 assert.equal(evaluateCourierIdentity({character:{...character,accountId:0},ship},contract).status,'REFUSED_NO_CHARACTER');
 assert.equal(evaluateCourierIdentity({character:{...character,stationID:60003761},ship},contract).status,'REFUSED_CHARACTER_NOT_AT_ORIGIN');
 assert.equal(evaluateCourierIdentity({character:{...character,balance:1000},ship},contract).status,'REFUSED_NO_FUNDS');
 assert.equal(evaluateCourierIdentity({character},contract).status,'REFUSED_NO_SHIP');
 assert.equal(evaluateCourierIdentity({character,ship:{...ship,stationID:60003762}},contract).status,'REFUSED_SHIP_NOT_AT_ORIGIN');
 assert.equal(evaluateCourierIdentity({character,ship:{...ship,capacityM3:4800}},contract).status,'REFUSED_SHIP_TOO_SMALL');
});

test('the settlement chain refuses a package that is not at the origin or destination',()=>{
 const contract=courier({volume:29500,collateral:300000});
 const identity={character:{characterID:140000100,accountId:901,stationID:60003760,balance:25000000},
  ship:{itemID:9988400100000,typeID:20185,stationID:60003760,capacityM3:465000}};
 assert.equal(planSettlement(contract,identity,60003760).status,'ACCEPT_THEN_FLY');
 assert.deepEqual(planSettlement(contract,identity,60003760).steps,['accept','fly','complete']);
 assert.equal(planSettlement(contract,identity,60003761).status,'SETTLE_NOW');
 assert.equal(planSettlement(contract,identity,60009999).status,'REFUSED_PACKAGE_ELSEWHERE');
 assert.equal(planSettlement(contract,{character:identity.character},60003760).status,'REFUSED_NO_SHIP');
});

test('the live numeric contract status is accepted alongside the string form',()=>{
 const numeric=evaluateContract(courier({status:0}),{},{walletIsk:0,hullCapacityM3:4800});
 assert.equal(numeric.status,'ELIGIBLE');
 assert.equal(evaluateContract(courier({status:1}),{},{hullCapacityM3:4800}).status,'REFUSED_STATUS');
});
