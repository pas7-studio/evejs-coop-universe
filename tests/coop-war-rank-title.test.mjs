import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {TABLE,KEY,TITLES,titleForRank,nextTitle,createRankTitles,validate}=
 require("../integration/coopWarRankTitle.cjs");

const flags=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_FACTION_WAR_MERIT:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});

test("every real rank has exactly one visible title",()=>{
 assert.equal(Object.keys(TITLES).length,7);
 assert.equal(titleForRank("recruit"),"Recruit");
 assert.equal(titleForRank("pilot"),"Fleet Pilot");
 assert.equal(titleForRank("admiral"),"Fleet Admiral");
 assert.equal(titleForRank("titan"),null);
 assert.equal(titleForRank(""),null);
});

test("a title change carries no unlock of any kind",()=>{
 const next=nextTitle({pilotID:"coop-pilot-050",record:{rank:"pilot",merit:25},at:1000});
 assert.equal(next.status,"CHANGED");
 assert.equal(next.title,"Fleet Pilot");
 assert.equal(next.previousRank,"");
 assert.deepEqual(next.unlocks,[]);
});

test("the same rank is never written twice",()=>{
 const existing={pilotID:"coop-pilot-050",rank:"pilot",title:"Fleet Pilot",at:1000};
 assert.equal(nextTitle({existing,pilotID:"coop-pilot-050",
  record:{rank:"pilot",merit:25},at:2000}).status,"UNCHANGED");
 assert.equal(nextTitle({existing,pilotID:"coop-pilot-050",
  record:{rank:"wingman",merit:70},at:2000}).status,"CHANGED");
});

test("an unknown rank or pilot is refused instead of guessed",()=>{
 assert.equal(nextTitle({pilotID:"coop-pilot-050",record:{rank:"titan"},at:1}).reason,
  "UNKNOWN_RANK");
 assert.equal(nextTitle({pilotID:"player-one",record:{rank:"pilot"},at:1}).reason,
  "INVALID_TITLE_IDENTITY");
 assert.equal(nextTitle({pilotID:"coop-pilot-050",record:{rank:"pilot"},at:0}).reason,
  "INVALID_TITLE_IDENTITY");
});

test("the durable title row is written once per real promotion",()=>{
 const f=fixture();
 const first=f.titles.apply({pilotID:"coop-pilot-050",record:{rank:"pilot",merit:25},at:1000});
 assert.equal(first.status,"CHANGED");
 assert.equal(f.state().records["coop-pilot-050"].title,"Fleet Pilot");
 assert.equal(f.state().records["coop-pilot-050"].unlocks.length,0);
 assert.equal(f.titles.apply({pilotID:"coop-pilot-050",record:{rank:"pilot",merit:25},at:2000}).status,
  "UNCHANGED");
 assert.equal(f.writes,1);
});

test("a corrupted title row is never accepted",()=>{
 const f=fixture();
 f.titles.apply({pilotID:"coop-pilot-050",record:{rank:"pilot",merit:25},at:1000});
 const state=f.state();
 state.records["coop-pilot-050"].title="Admiral of Everything";
 f.set(state);
 assert.throws(()=>f.titles.read(),/WAR_TITLE_RECORD_CORRUPT/);
});

test("the feature is off without the merit flags",()=>{
 const f=fixture({env:{}});
 assert.equal(f.titles.apply({pilotID:"coop-pilot-050",record:{rank:"pilot"},at:1}).status,
  "DISABLED");
 assert.equal(f.state(),undefined);
});

function fixture({env=flags()}={}){
 const records=new Map();
 let writes=0;
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,[TABLE]);
  const draft=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(t,k)=>draft.get(t+":"+k)||null,
   put:(t,k,v)=>{draft.set(t+":"+k,structuredClone(v));writes++}};
  const outcome=fn(tx);
  records.clear();for(const [k,v] of draft)records.set(k,v);
  return outcome;
 }}};
 const titles=createRankTitles({gameStore,env,clock:()=>1000});
 return {titles,get writes(){return writes},state:()=>records.get(TABLE+":"+KEY),
  set:state=>records.set(TABLE+":"+KEY,structuredClone(state))};
}
