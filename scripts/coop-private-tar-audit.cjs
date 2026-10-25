#!/usr/bin/env node
'use strict';
// Chat 41: offline fail-closed TAR member inspection before any Docker volume restore.
// Intentionally supports only regular ustar files/directories; no symlinks,
// hardlinks, devices, PAX, sparse files or GNU longname extensions.
const fs=require('node:fs');
const BLOCK=512;
function octal(bytes,label){
  const raw=bytes.toString('latin1').replace(/\0.*$/s,'').trim();
  if(!/^[0-7]+$/.test(raw))throw Error('INVALID_TAR_'+label);
  const value=parseInt(raw,8);
  if(!Number.isSafeInteger(value)||value<0)throw Error('TAR_SIZE_OVERFLOW');
  return value;
}
function validateArchive(file){
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size<BLOCK*2||stat.size%BLOCK!==0)throw Error('INVALID_TAR_LENGTH');
  const fd=fs.openSync(file,'r');
  let offset=0,files=0,dirs=0,ended=false;
  const known=new Set(),buffer=Buffer.alloc(BLOCK);
  try{
    while(offset<stat.size){
      if(fs.readSync(fd,buffer,0,BLOCK,offset)!==BLOCK)throw Error('SHORT_TAR_HEADER');
      if(buffer.every(x=>x===0)){
        ended=true;
        while(offset<stat.size){
          if(fs.readSync(fd,buffer,0,BLOCK,offset)!==BLOCK||!buffer.every(x=>x===0))
            throw Error('NONZERO_TAR_TRAILER');
          offset+=BLOCK;
        }
        break;
      }
      const magic=buffer.toString('latin1',257,263);
      if(!['ustar\0','ustar '].some(m=>magic.startsWith(m)))throw Error('UNSUPPORTED_TAR_FORMAT');
      const observed=octal(buffer.subarray(148,156),'CHECKSUM');
      let sum=0;
      for(let i=0;i<BLOCK;i++)sum+=i>=148&&i<156?32:buffer[i];
      if(observed!==sum)throw Error('TAR_CHECKSUM_MISMATCH');
      const type=buffer[156];
      if(![0,48,53].includes(type))throw Error('UNSAFE_TAR_ENTRY_TYPE');
      const name=buffer.toString('utf8',0,100).split('\0')[0];
      const prefix=buffer.toString('utf8',345,500).split('\0')[0];
      const raw=prefix?prefix+'/'+name:name;
      if(!raw||raw.startsWith('/')||raw.includes('\\')||/[\x00-\x1f\x7f]/.test(raw)||/^[a-zA-Z]:/.test(raw))
        throw Error('UNSAFE_TAR_ENTRY_PATH');
      const segments=raw.split('/').filter(x=>x&&x!=='.');
      if(segments.some(x=>x==='..')||segments.length===0&&type!==53)
        throw Error('UNSAFE_TAR_ENTRY_PATH');
      const relative=segments.join('/');
      if(relative&&known.has(relative))throw Error('DUPLICATE_TAR_PATH');
      if(relative)known.add(relative);
      const size=octal(buffer.subarray(124,136),'SIZE');
      if(type===53&&size!==0)throw Error('DIRECTORY_WITH_TAR_PAYLOAD');
      const bytes=Math.ceil(size/BLOCK)*BLOCK;
      if(!Number.isSafeInteger(bytes)||offset+BLOCK+bytes>stat.size)
        throw Error('TAR_ENTRY_OUT_OF_BOUNDS');
      if(type===53)dirs++;else files++;
      offset+=BLOCK+bytes;
    }
    if(!ended||files+dirs===0)throw Error('EMPTY_OR_UNTERMINATED_TAR');
    return {ok:true,regularFiles:files,directories:dirs};
  }finally{fs.closeSync(fd)}
}
if(require.main===module){
 try{
   if(process.argv.length!==3)throw Error('USAGE_TAR_FILE_REQUIRED');
   const proof=validateArchive(process.argv[2]);
   process.stdout.write(JSON.stringify(proof)+'\n');
 }catch(e){
   process.stderr.write('UNSAFE_BACKUP_TAR: '+String(e.message||e).slice(0,100)+'\n');
   process.exitCode=2;
 }
}
module.exports={validateArchive};
