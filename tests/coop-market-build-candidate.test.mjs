import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {makeCandidateConfig,run,CANDIDATE,SOURCE}=require('../scripts/coop-market-build-candidate.cjs');
const sample=`[input]\nstatic_data_dir = "/var/lib/evejs/gameStore/data"\n[output]\ndatabase_path = "/var/lib/evejs/market/market.sqlite.candidate"\n[seed]\nprice_floor = 100.0\n`;
test('native market seed candidate never references active market.sqlite',()=>{
 const out=makeCandidateConfig(sample);assert.match(out,/coop-manifest.candidate.sqlite/);
 assert.doesNotMatch(out,/database_path = "\/var\/lib\/evejs\/market\/market.sqlite"/);
 assert.match(out,/price_floor = 100.0/);
});
test('refuse unfamiliar or double destination paths',()=>{
 assert.throws(()=>makeCandidateConfig(sample.replace('market.sqlite.candidate','market.sqlite')),/Unexpected pinned/);
 assert.throws(()=>makeCandidateConfig(sample+`\ndatabase_path = "/var/lib/evejs/market/market.sqlite.candidate"`),/Unexpected pinned/);
});
test('dry-run is free of side effects and candidate replaces are forbidden',()=>{
 const opts={source:SOURCE,candidate:CANDIDATE,readFile:()=>sample,exists:()=>false,
  spawn:()=>{throw Error('Cannot start seeder on dry run')},makeTemp:()=>{throw Error('Cannot create temp config on dry run')}};
 assert.equal(run(opts).status,'MANIFEST_CANDIDATE_DRY_RUN');
 assert.throws(()=>run({...opts,exists:(file)=>file===CANDIDATE}),/already exists/);
});
test('build requires exclusive offline market lock',()=>{
 assert.throws(()=>run({build:true,readFile:()=>sample,exists:()=>false}),/Exclusive offline market lock/);
});