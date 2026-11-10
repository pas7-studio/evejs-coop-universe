# PF58 reproducible local regression

- Linux Node v22.16.0, SQLite WAL + `PRAGMA synchronous=FULL` in PF54 fixture.
- PF58 own `.test.cjs` files: **59/59 PASS**, 0 fail; five actual child-process
  SIGKILL scenarios (plus one injected rollback test) verified durable one-shot
  fences and preserved original ItemStore hull IDs.
- Existing available PF49-56 archived tests plus PF57 plus PF58: **469/469
  PASS** serial local Node tests, 0 fail, 0 skipped. Previous unattested
  PF46-48 test counts are not folded in. Do not add prior conversational totals.
- PF58 Python patch generator: **7/7 PASS**, including synthetic `git apply
  --check`, compiled Node syntax and exact source-pin failure tests.
- Source blob and anchor counts for real native
  `Code/server/src/space/npc/nativeNpcService.js` verified by GitHub read at
  `ca039daaaad2839d17f7109de2f3834cec0373a8`.
- **Not verified:** successful patch generation or compilation against a complete
  original EveJS checkout, native bootstrap execution in the actual server,
  client gameplay, two-player WORK E2E, and any PLAY behavior.
- GitHub integration previously returned `403 Resource not accessible by
  integration` writing `pas7-studio/EveJS`; PR #350 is in orchestration only.
