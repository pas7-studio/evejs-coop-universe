'use strict';
const {setup}=require('./fixture.cjs');
const [dir,when]=process.argv.slice(2);
const f=setup({dir,afterCommit:result=>{
 if(when==='after-commit'&&result==='COMMITTED')process.kill(process.pid,'SIGKILL');
}});
try{
 if(when==='during-scene')f.nativeNpcService.detachScopedPersonalFleetDockSceneActor=({row,capability})=>{
  const p=f.nativeNpcService.rawAuthorize();
  if(p.capability!==capability||!p.authorize(row))process.exit(71);
  // PF67: crash after the SECOND durable scene permit, before physical removal.
  if(!p.consumeSceneDetach(row))process.exit(72);
  process.kill(process.pid,'SIGKILL');
 };
 f.build().execute(f.c);
 process.exit(70); // the child MUST be killed, not finish normally
}finally{f.close();}
