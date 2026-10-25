import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {render,applyToTuple,enter}=require("../integration/coopAgentDialogue.cjs");

const AUTHORED="Good of you to stop by, {[character]player.name}! And you couldn't have chosen a better time to show up.";
const session={characterID:140000008,characterName:"Antaken Kamola"};

test("authored player-name token is replaced with the signed-in character name",()=>{
 assert.equal(render(AUTHORED,session),"Good of you to stop by, Antaken Kamola! And you couldn't have chosen a better time to show up.");
});

test("text without the token is returned untouched and never rewritten",()=>{
 const plain="I don't have another mission for you just yet.";
 assert.equal(render(plain,session),plain);
 assert.equal(render(plain,null),plain);
});

test("a missing character name keeps the authored text instead of blanking it",()=>{
 assert.equal(render(AUTHORED,{characterID:1}),AUTHORED);
 assert.equal(render(AUTHORED,null),AUTHORED);
});

test("other authored tokens are deliberately left for their own resolution",()=>{
 const text="Deliver it to {[location]objectiveLocationID.name} for {[character]player.name}.";
 assert.equal(render(text,session),"Deliver it to {[location]objectiveLocationID.name} for Antaken Kamola.");
});

test("the session set by DoAction is consumed once and never leaks to a later tuple",()=>{
 const tuple={type:"tuple",items:[AUTHORED,null]};
 enter(session);
 assert.match(applyToTuple(tuple).items[0],/Antaken Kamola/);
 const later={type:"tuple",items:[AUTHORED,null]};
 assert.equal(applyToTuple(later).items[0],AUTHORED);
});
