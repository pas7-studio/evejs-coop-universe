# PF64 integration / acceptance gates

| Gate | Current status | Proof still needed |
| --- | --- | --- |
| Persist native attempt before removal | PASS in SQLite fixture | Original GameStore integration in engine |
| Restart cannot reissue after committed attempt | PASS in 2 SIGKILL fixtures | Real native controller rows and WORK process restart |
| Native Store refuses capability before attempt | PASS in isolated test | Real PF61 source-patched store |
| PF58 bootstrap constructor failure leaves no bindings | PASS in VM constructor tests | Native complete server import/start |
| PF62 review patch includes changed PF58/PF61 modules | Generator stages modules by path | Actual clean EveJS checkout source-pinned roundtrip |
| Cross-writer claim fencing | BLOCKED | Stock ItemStore/Market, Mining, WAR, Exploration |
| Real stock ammo and combat | NOT READY | Original weapon/charge engine contract |
| Two independently authenticated clients | NOT RUN | Owner WORK gameplay E2E |
| EveJS native fork writable | BLOCKED 403 | GitHub Contents write access to native fork |
| PLAY/main | UNCHANGED | No automatic activation |

No native cleanup rollback, retry after crash, forced merge, GitHub Actions or PLAY restart is authorized.
