'use strict';
const {setup}=require('./fixture.cjs');
const dir=process.argv[2],mode=process.argv[3];
const f=setup({dir,
 beforeCommit(result){if(mode.endsWith('BEFORE_COMMIT')&&
 (mode.startsWith('PREPARE')&&result?.status==='PREPARED'||
 mode.startsWith('ISSUE')&&result?.status==='ISSUING'||
 mode.startsWith('FINALIZE')&&result?.status==='FINALIZED'))process.kill(process.pid,'SIGKILL');},
 afterCommit(result){if(mode.endsWith('AFTER_COMMIT')&&
 (mode.startsWith('PREPARE')&&result?.status==='PREPARED'||
 mode.startsWith('ISSUE')&&result?.status==='ISSUING'||
 mode.startsWith('FINALIZE')&&result?.status==='FINALIZED'))process.kill(process.pid,'SIGKILL');}
});
const a=f.create();a.prepare(f.c);
if(mode.startsWith('ISSUE')||mode.startsWith('FINALIZE'))a.issue(f.c);
if(mode.startsWith('FINALIZE')){a.reconcile(f.c);f.settle();a.finalize(f.c);}
console.error('PF60_WORKER_DID_NOT_SIGKILL '+mode);process.exit(11);
