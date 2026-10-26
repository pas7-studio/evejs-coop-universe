import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {validateArchive}=require('../scripts/coop-private-tar-audit.cjs');
function ustar(name='',data='',type='0',prefix=''){
 const header=Buffer.alloc(512,0),body=Buffer.from(data);
 header.write(name,0,100,'utf8');
 header.write('0000644\0',100,8,'ascii');
 header.write('0000000\0',108,8,'ascii');
 header.write('0000000\0',116,8,'ascii');
 header.write(body.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');
 header.write('00000000000\0',136,12,'ascii');
 header.fill(32,148,156);
 header.write(type,156,1,'latin1');
 header.write('ustar\0',257,6,'latin1');
 header.write('00',263,2,'latin1');
 if(prefix)header.write(prefix,345,155,'utf8');
 let checksum=0;for(const b of header)checksum+=b;
 header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
 const pad=Buffer.alloc((512-body.length%512)%512);
 return Buffer.concat([header,body,pad]);
}
function check(members,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eve41tar-'));
 try{
  const tar=path.join(dir,'backup.tar');
  const archive=Buffer.concat([...members,Buffer.alloc(options.noEnd?0:1024)]);
  fs.writeFileSync(tar,archive);
  if(options.mutate)options.mutate(archive,tar);
  return validateArchive(tar);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('ordinary ustar regular files and directories are admitted',()=>{
 assert.deepEqual(check([ustar('./','', '5'),ustar('./db/','', '5'),ustar('./db/world.sqlite','character state')]),
 {ok:true,regularFiles:1,directories:2});
});
test('parent traversal is forbidden even with matching tar checksum',()=>{
 assert.throws(()=>check([ustar('../../outside.txt','bad')]),/UNSAFE_TAR_ENTRY_PATH/);
});
test('absolute paths are forbidden',()=>{
 assert.throws(()=>check([ustar('/etc/evil','bad')]),/UNSAFE_TAR_ENTRY_PATH/);
});
test('Windows drive and backslash traversal are forbidden',()=>{
 assert.throws(()=>check([ustar('C:/Windows/sneaky','bad')]),/UNSAFE_TAR_ENTRY_PATH/);
 assert.throws(()=>check([ustar('..\\outside','bad')]),/UNSAFE_TAR_ENTRY_PATH/);
});
test('symlinks and hardlinks never write outside a restore volume',()=>{
 assert.throws(()=>check([ustar('./redirect','', '2')]),/UNSAFE_TAR_ENTRY_TYPE/);
 assert.throws(()=>check([ustar('./hardlink','', '1')]),/UNSAFE_TAR_ENTRY_TYPE/);
});
test('PAX, GNU long-name and special device records are unsupported',()=>{
 for(const flag of ['x','g','L','S','3'])
  assert.throws(()=>check([ustar('./metadata','',flag)]),/UNSAFE_TAR_ENTRY_TYPE/,flag);
});
test('duplicate paths cannot alter a verified backup twice',()=>{
 assert.throws(()=>check([ustar('./db','x'),ustar('./db','y')]),/DUPLICATE_TAR_PATH/);
});
test('truncated archive and missing end markers are rejected',()=>{
 assert.throws(()=>check([ustar('./x','ok')],{noEnd:true}),/EMPTY_OR_UNTERMINATED_TAR/);
});
test('forged header checksum rejected',()=>{
 assert.throws(()=>check([ustar('./x','ok')],{mutate:(data,file)=>{
  data[0]=0x78;fs.writeFileSync(file,data);
 }}),/TAR_CHECKSUM_MISMATCH/);
});
test('backup may not include nonzero payload after end of archive',()=>{
 assert.throws(()=>check([ustar('./x','ok')],{mutate:(data,file)=>{
  data[data.length-1]=10;fs.writeFileSync(file,data);
 }}),/NONZERO_TAR_TRAILER/);
});
