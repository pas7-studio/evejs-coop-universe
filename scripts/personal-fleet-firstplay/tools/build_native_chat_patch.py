#!/usr/bin/env python3
"""Source-pinned original EveJS /pf chat-command review patch.

Never touches PLAY or the default native checkout. Produce a review-only diff;
manual git apply to a dedicated WORK worktree and commit in the native fork.
"""
from __future__ import annotations
import argparse
import difflib
import hashlib
from pathlib import Path
import subprocess
import sys

STOCK='Code/server/src/services/chat/chatCommands.js'
GATEWAY='Code/server/src/space/coopPersonalFleetChatGateway.js'
ORIGINAL_BLOB='5f4dd4d34a398dde3120e8640a7058d2bd3bb038'
HOOK_ANCHOR='  if (command === "events" || command === "alerts") {'
GATEWAY_HOOK='''  if (command === "pf") {
    const result = require("../../space/coopPersonalFleetChatGateway").handleChat({session, argumentText});
    return handledResult(chatHub, session, options, result.message);
  }
'''
COMMAND_ANCHOR='  "jobs",'

def blob(b:bytes)->str:
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\x00'+b).hexdigest()

def transformed(original:str)->str:
    if original.count(HOOK_ANCHOR)!=1 or original.count(COMMAND_ANCHOR)!=1 or \
       'command === "pf"' in original or '"pf",' in original:
        raise ValueError('PF_FIRSTPLAY_CHAT_ANCHOR_NOT_EXACT_OR_ALREADY_INSTALLED')
    code=original.replace(HOOK_ANCHOR,GATEWAY_HOOK+'\n'+HOOK_ANCHOR,1)
    return code.replace(COMMAND_ANCHOR,'  "pf",\n'+COMMAND_ANCHOR,1)

def build(engine:Path,source:Path,*,expected_blob:str=ORIGINAL_BLOB):
    original=engine/STOCK
    gateway=engine/GATEWAY
    if not original.is_file() or not source.is_file():
        raise ValueError('PF_FIRSTPLAY_SOURCE_NOT_FOUND')
    if gateway.exists() or gateway.is_symlink():
        raise ValueError('PF_FIRSTPLAY_NATIVE_GATEWAY_ALREADY_PRESENT')
    data=original.read_bytes()
    if blob(data)!=expected_blob:
        raise ValueError('PF_FIRSTPLAY_ORIGINAL_CHAT_SOURCE_DRIFT: '+blob(data))
    if b'\r\n' in data:
        raise ValueError('PF_FIRSTPLAY_ORIGINAL_CHAT_EOL_UNEXPECTED')
    text=data.decode('utf-8')
    code=transformed(text)
    gateway_source=source.read_text(encoding='utf-8')
    if not gateway_source.startswith("'use strict';\n") or not gateway_source.endswith('\n'):
        raise ValueError('PF_FIRSTPLAY_NATIVE_GATEWAY_INVALID')
    diffs=[]
    for a,b in [(STOCK,text),(GATEWAY,'')]:
        after=code if a==STOCK else gateway_source
        before=b
        block=list(difflib.unified_diff(before.splitlines(keepends=True),
            after.splitlines(keepends=True),fromfile=('/dev/null' if a==GATEWAY else 'a/'+a),tofile='b/'+a))
        if not block:raise ValueError('PF_FIRSTPLAY_EMPTY_PATCH: '+a)
        diffs.extend(block)
    patch=''.join(diffs)
    if not patch.endswith('\n') or patch.count('--- a/')!=1 or patch.count('--- /dev/null')!=1 or patch.count('+++ b/')!=2:
        raise ValueError('PF_FIRSTPLAY_DIFF_INCOMPLETE')
    return patch

def check(engine:Path,patch:str):
    proc=subprocess.run(['git','-C',str(engine),'apply','--whitespace=error','--check','-'],
                        input=patch,encoding='utf-8',capture_output=True)
    if proc.returncode:
        raise ValueError('PF_FIRSTPLAY_GIT_APPLY_CHECK_FAILED: '+proc.stderr.strip()[:300])
    return True

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine',required=True,type=Path,help='clean, source-pinned original EveJS checkout')
    parser.add_argument('--gateway-source',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args(argv)
    engine=args.engine.resolve(strict=True)
    source=args.gateway_source.resolve(strict=True)
    patch=build(engine,source)
    check(engine,patch)
    if args.output.exists():
        raise ValueError('PF_FIRSTPLAY_REVIEW_OUTPUT_EXISTS')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(patch,encoding='utf-8',newline='\n')
    print('PF_FIRSTPLAY_CHAT_PATCH_REVIEW_READY source='+ORIGINAL_BLOB+' sha256='+hashlib.sha256(patch.encode()).hexdigest())
    print('REVIEW ONLY. Do not git apply to PLAY; apply to explicit isolated WORK git worktree.')

if __name__=='__main__':
    try:main()
    except (OSError,ValueError) as e:
        print(str(e),file=sys.stderr);sys.exit(1)
