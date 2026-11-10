# Personal Fleet — локальна синхронізація та acceptance

Дата: 2026-11-05. PR [#350](https://github.com/pas7-studio/evejs-coop-universe/pull/350).
Гілка: `docs/personal-fleet-contract-freeze-v1-4-20261104`.

## Чесний стан

**PF-00…PF-16 — reference contracts / tests, НЕ функціональна реалізація Personal Fleet в ігровому сервері.**
Можна локально синхронізувати, запускати Node-тести й SQLite SIGKILL, але **найняти NPC,
призначити фізичний корабель і віддати команду у живій грі ще не можна**. Для цього
потрібні зміни в авторитетному `pas7-studio/EveJS`, гілка `coop/pas7std`.
Поточна GitHub-інтеграція для форку відповідала `403 Resource not accessible by integration`.

ПРОЄКТНА ЗАБОРОНА: GitHub Actions workflow **видалено** із PR #350 після звірки з `AGENTS.md`.
Усі перевірки — лише локальні, без remote CI.

## Один раз на Windows (PowerShell)

Вихідні checkout, які вже використовує проєкт:
- orchestration: `R:\GitRepository\pas7std\evejs-coop-universe` (або твій актуальний шлях);
- engine: `C:\Games\EveCoop\upstream-evejs` (має залишатися на `coop/pas7std`).

```powershell
cd R:\GitRepository\pas7std\evejs-coop-universe
git status --short
git fetch origin docs/personal-fleet-contract-freeze-v1-4-20261104
# Якщо гілки ще немає локально:
git switch --track origin/docs/personal-fleet-contract-freeze-v1-4-20261104
# Якщо локальна гілка вже існує, замість команди вище:
# git switch docs/personal-fleet-contract-freeze-v1-4-20261104

.\scripts\Test-PersonalFleet-Local.ps1 -Sync -WithNative
```

**Передумови:** Git, Windows PowerShell 5.1+, Node.js 22+ у Windows, WSL2 з Linux
і Node.js 22+ усередині WSL. Якщо engine лежить в іншому місці,
вкажи `-ForkRoot 'D:\...\EveJS'`.

`-Sync` робить тільки fast-forward orchestration гілки (якщо локальний worktree
чистий) та **fetch-only** для native fork. Не робить git reset, merge, switch, pull,
build чи deploy у native форку. Якщо engine попереду/позаду `origin/coop/pas7std`,
покаже warning і залишить файли без змін.

`-WithNative` запускає PF-15 SQLite SIGKILL і PF-16 native adapter SIGKILL під WSL;
без нього запускаються лише звичайні contract-тести у Windows,
а Linux-гейти явно позначаються як **NOT RUN**.

Для швидкого запуску без WSL:
```powershell
.\scripts\Test-PersonalFleet-Local.ps1
```

## Що тест справді доводить

| Gate | Що перевіряє | Чого НЕ доводить |
| --- | --- | --- |
| Reference Node unit tests | PF policy state machines, replay, receipt, ownership, payroll | Native NPC gameplay |
| PF-15 SQLite SIGKILL | Відкат/commit і консервація ISK на одноразовій SQLite test schema | Справжній GameStore wallet |
| PF-16 native-gated SIGKILL | `createSqliteAdapter` із саме твого engine checkout, commit ambiguity і poison | Продакшн wallet schema, повну внутрішню GameStore cache/flush інтеграцію |
| WORK gameplay | **ЩЕ НЕ ДОСТУПНИЙ для Personal Fleet** | Не заявляти PASS без фізичного NPC + два клієнти |

Усі SQLite-тести використовують тимчасові бази в OS temp і прибирають їх після запуску.
Вони не читають `evejs-data`/`evejs-agents-data` і не стартують Docker.

## Що потрібно, перш ніж випустити у гру

1. Авторитетний `personal fleet` сервіс у `pas7-studio/EveJS/Code/server/src/space` із feature flag default OFF та підключенням до оригінальних `GameStore`, ItemStore, контрактів, native wallet.
2. Глобальний actor claim/writer guard, який використовують **усі** існуючі WAR, Mining, Exploration й PF writers транзакційно. Без взаємної інтеграції фіча не вмикається.
3. Original ship itemID → native entity/controller + реально встановлені modules/cargo, native dock/undock/warp/gate/combat/mining і durable command arbiter; заборона spawn/дюпу.
4. Original wallet payroll з single-authority debit+credit, дубльованим receipt fencing, reconciler для `OUTCOME_UNKNOWN`, native termination/salary arrears.
5. Перезапуск, recovery, SIGKILL вже на **справжній** GameStore data model, а не тільки synthetic test fixtures.
6. На ізольованому WORK стеку `evejs-agents`: дві автентифіковані клієнтські сесії, повний hire → assign → orders → loss → recover → payroll → persistence; скріншоти/логи оригінальної сцени.
7. Тільки після цього — merge/deploy і окремо погоджене вікно для PLAY. **Не рестартувати PLAY автоматично.**

## Інтерпретація результатів

- `PF_REFERENCE_CONTRACTS_PASS` = reference-код витримав локальну перевірку.
- `PF15_SQLITE_SIGKILL_PASS` = Linux SQLite fixture пройшов.
- `PF_NATIVE_SQLITE_GATE_PASS` = перевірено native-адаптер форку на одноразових SQLite даних.
- **Жоден із цих статусів не означає `PERSONAL_FLEET_GAMEPLAY_READY`.**
- Зберігай лог тестового запуску та точні SHA обох checkout; якщо в engine є незакомічені зміни,
  не переписуй їх і не запускай `-Sync` до ручної перевірки.
