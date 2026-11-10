#!/usr/bin/env python3
"""PF88: add fail-closed source-owned firstplay start before original TCP listen.

Only for an explicitly isolated WORK native source tree. No PLAY/main write.
The pristine Code/server/index.js must match this Git blob exactly.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import difflib

PATH=Path('Code/server/index.js')
ORIGINAL_GIT_BLOB='912c942d29db35f5f105119bfc6c0d2eff1bf5dd'
ANCHOR='// Start the TCP server with the service manager\nstartTCPServer(serviceManager);\n'
INSERT='''// PF88 source-owned native Personal Fleet startup, opt-in ONLY.
 // When any PF flag is requested, require both native feature flags and
 // verified original writer authority BEFORE accepting the first TCP client.
 // Missing original hooks/catalog abort startup; no partial "ready" server.
if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1" ||
    process.env.EVEJS_COOP_PERSONAL_FLEET_CHAT === "1") {
  require("./src/space/coopPersonalFleetOriginalWorkStarter")
    .bootstrapOriginalWorkFromServer();
}

'''

def build(work:Path)->str:
 raw=(work/PATH).read_bytes()
 git_blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 if git_blob!=ORIGINAL_GIT_BLOB:
  raise ValueError('PF88_ORIGINAL_STARTUP_SOURCE_DRIFT: '+git_blob)
 old=raw.decode('utf-8')
 if old.count(ANCHOR)!=1 or 'PF88 source-owned native Personal Fleet startup' in old:
  raise ValueError('PF88_ORIGINAL_STARTUP_ANCHOR_DRIFT')
 changed=old.replace(ANCHOR,INSERT+ANCHOR,1)
 return ''.join(difflib.unified_diff(old.splitlines(keepends=True),
  changed.splitlines(keepends=True),
  fromfile='a/'+str(PATH),tofile='b/'+str(PATH)))
