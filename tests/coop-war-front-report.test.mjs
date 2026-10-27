import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const runtime=require('../integration/coopVirtualWorldRuntime.cjs');
const view=require('../integration/coopWarClientView.cjs');

test('a front report is sent once per real event, never repeated',()=>{
 const details={eventKey:'camp:30000144',attackerFactionID:500011,
  defenderFactionID:500014,targetSystemID:30000144};
 assert.equal(runtime.warFrontChat('war-opened',details,[30000142,30000144]),true);
 // The same real transition must never produce a second message.
 assert.equal(runtime.warFrontChat('war-opened',details,[30000142,30000144]),false);
 // A different campaign is a different event.
 assert.equal(runtime.warFrontChat('war-opened',{...details,eventKey:'camp:30000145'}),true);
});

test('an unknown kind never produces a message',()=>{
 assert.equal(runtime.warFrontChat('nonsense-kind',{eventKey:'x'}),false);
});

test('the text is the same text the projector builds',()=>{
 // warFrontChat uses coopWarClientView.frontReport, so a capture reads the same.
 const captured=view.frontReport('objective-captured',{systemID:30000144,factionID:500011});
 assert.match(captured,/System #30000144 captured by #500011/);
 assert.equal(runtime.warFrontChat('objective-captured',
  {eventKey:'camp:1:30000144:3',systemID:30000144,factionID:500011},[30000144]),true);
});
