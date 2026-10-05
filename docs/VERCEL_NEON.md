# Intavro: Vercel + Neon

Это инструкция для существующего Next.js-приложения. PostgreSQL, гостевые сессии,
ключи восстановления, privacy projections, чат и scheduling остаются прежними.
Проверки в репозитории не заменяют проверку настоящего HTTPS deployment.

## Текущий rollout: 18 live → 20 migrations

Ветка проверки `codex/intent-worlds-20261005` дополнительно исключена из
автоматических deployments через `git.deploymentEnabled` в `vercel.json`.
GitHub CI продолжает работать. Это исключение не блокирует deployment `main`:
слияние разрешено только после согласованного применения миграций и проверки базы.

Production [intavro.vercel.app](https://intavro.vercel.app) остаётся на проверенном
release с **18 migrations**. Profile Worlds и новый minimal intent product сейчас
локальные: **0019_profile_spaces.sql**, **0020_intent_lobbies.sql**. Нового deployment,
production migration нет. Hosted CI source `78d800f` полностью прошёл в
[run37284505275](https://github.com/Kqway/veya/actions/runs/37284505275).
Проверки и pending gates
записаны отдельно в [CODEX_PROGRESS.md](../CODEX_PROGRESS.md).

Подготовить отдельную feature branch/PR: push в production `main` может автоматически
запустить Vercel до обновления БД. Сначала backup и isolated restore, проверить
неизменность 0001–0018, применить 0019/0020 через direct CLI и проверить **все 20**
checksum entries. Только затем публиковать соответствующий web/worker source.
Согласовать maintenance: readiness старого release проверяет точный набор migrations
и может отклонить расширенный ledger. Старый image на новой схеме не считать
автоматически безопасным rollback. Preview использует только synthetic isolated DB.

Для оператора с Neon Query Editor доступен [пошаговый SQL upgrade18→20](NEON_RELEASE_18_TO_20.md):
`db:release:sql` offline генерирует одну атомарную команду и отдельную read-only
проверку всех checksums. Backup/restore rehearsal и maintenance остаются обязательны.

## 1. Создать проект и базу

1. В Vercel импортировать GitHub-репозиторий `Kqway/veya`, production branch `main`,
   root directory — корень репозитория, framework — Next.js, Node — **24.x**.
2. Включить **Fluid compute** и убедиться, что тариф допускает функции длительностью
   300 секунд. Оставить стандартные Next.js output settings; Dockerfile для этого
   способа запуска не используется.
3. Создать Neon PostgreSQL через **Vercel Marketplace → Neon**, либо подключить
   существующий Neon project. Выбрать близкие регионы Vercel и Neon. Не создавать
   платные ресурсы без осознанного выбора тарифа владельцем.
4. Выделить отдельную production branch/database. Preview deploys получают отдельную
   тестовую branch с синтетическими данными, **никогда production credentials или
   копию личных данных пользователей**. Если отдельной базы нет, не выдавать preview
   database credentials: landing работает, `/api/ready` и social API недоступны.
5. В Neon Connection details получить два URI одного endpoint/database/role:
   pooled (host содержит `-pooler`) и direct (без `-pooler`). Использовать server-only
   роль владельца таблиц; политика RLS не предоставляет клиентам доступ к базе.

До появления отдельной synthetic preview-базы автоматические preview-deployments
проекта временно отключены. Текущие provider environment variables ограничены
Production. Перед будущей синхронизацией/rotation проверить также environments у
Storage connection: provider не должен вновь выдать production secrets previews.

Интеграция может подставить URI с `sslmode=require`. При `VERCEL=1` и явно заданном
`DATABASE_SSL_MODE=verify-full` Intavro автоматически меняет единственный такой
параметр на **`sslmode=verify-full`** только для hostnames, заканчивающихся на
`.neon.tech`. Пароль и остальные параметры сохраняются. Драйвер `pg` и realtime
client дополнительно принудительно проверяют сертификат и hostname. Слабые или
конфликтующие TLS flags по-прежнему отклоняются; другой provider не получает это
преобразование. При ручной конфигурации вне Vercel задавать `sslmode=verify-full`
в обеих строках самостоятельно. Не отключать проверку TLS. Если provider использует
нестандартный CA, настроить доверенный CA для Node вместо `rejectUnauthorized=false`.

## 2. Environment variables

Добавить значения в **Vercel → Project → Settings → Environment Variables →
Production**. После изменений нужен новый deployment. Секреты не должны иметь
префикс `NEXT_PUBLIC_`, попадать в Git, URL приложения, скриншоты или логи.

| Variable | Значение |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Постоянный HTTPS origin, например `https://intavro.vercel.app`, без пути/query. После подключения домена обновить и redeploy. Не использовать URL отдельной preview-сборки. |
| `DATABASE_URL` | **Pooled** Neon PostgreSQL URI с `sslmode=verify-full`. |
| `REALTIME_DATABASE_URL` | **Direct/session-mode** URI той же БД и роли. На Vercel можно не копировать секрет: если переменная отсутствует, Intavro использует Marketplace `DATABASE_URL_UNPOOLED`. Явное значение имеет приоритет. Neon `-pooler` hostname отклоняется для realtime; LISTEN требует direct connection. |
| `DATABASE_SSL_MODE` | `verify-full`. |
| `DB_POOL_MAX` | `2` для начала; считать также одно direct LISTEN-соединение на каждый instance с активным SSE. |
| `CRON_SECRET` | Отдельные 32+ случайных base64url символа, до 256. Vercel автоматически передаёт `Authorization: Bearer …` для Cron. |
| `MODERATION_ADMIN_SECRET` | Другой случайный секрет (32–256 base64url символов), хранить у назначенного модератора. |
| `RATE_LIMIT_BACKEND` | `postgres`; shared budgets обязательны для нескольких serverless instances. |
| `AI_PROVIDER` | `mock`; основной flow не требует OpenAI. |

`NODE_ENV=production` и `VERCEL=1` задаёт платформа. Локально эти переменные для
обычного dev не нужны. При `VERCEL=1` default query pool уменьшается до двух;
явный `DB_POOL_MAX` имеет приоритет.

Optional: `OPENAI_API_KEY`/`OPENAI_MODEL` только при выборе `AI_PROVIDER=openai`;
все три `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` для
opt-in Web Push; `ANALYTICS_ENABLED=true` для безопасной агрегатной воронки.
Без VAPID inbox и realtime работают. Push permission запрашивается только по
действию пользователя. Серверные `BETA_SIGNUPS_ENABLED`, `BETA_SEEKING_ENABLED`,
`BETA_READ_ONLY` принимают строго `true`/`false`; defaults `true`, `true`, `false`.

Генерировать два разных секрета локально в менеджере паролей. Не присылать их в чат.
Лимиты и цена Neon/Vercel определяются выбранным тарифом: активные SSE connections
удерживают Neon compute, а reconnect создаёт новые function invocations.

## 3. Migrations до приглашения пользователей

**Build не подключается к production DB и не применяет migrations.** Не добавлять
`db:migrate` в Vercel Build Command. Нет публичного HTTP endpoint для migrations.

На доверенной машине с Node 24 получить checkout того же release и выполнить
`npm ci`. В локальном игнорируемом `.env.local` (права `600`) указать `NODE_ENV=production`,
trusted `NEXT_PUBLIC_APP_URL`, `DATABASE_SSL_MODE=verify-full` и **direct** Neon URI
в `DATABASE_URL`. Здесь direct URI используется только CLI. Не запускать unit/E2E
тесты с production credentials. Не выполнять demo seed в production.

```sh
npm run db:migrate
npm run db:verify
```

Для текущего candidate применяются checksum-tracked migrations **0001–0020**,
transaction + advisory lock; повторный запуск безопасен. Additive 0019/0020 не
меняют применённые 0001–0018. Старый bootstrap из 18 migrations относится только к
предыдущему live release и не устанавливает новую функциональность. При существующей БД сначала сделать backup согласно [DEPLOYMENT.md](DEPLOYMENT.md).
Vercel web остаётся на pooled `DATABASE_URL`, realtime — на direct URL.

Встроенный **Vercel Storage → Query** использует prepared statements и не принимает
несколько отдельных SQL-команд одним запросом. Сгенерированный bootstrap должен
быть одной командой `DO`: внутри advisory lock, неизменённые SQL migrations,
проверка/запись SHA-256 ledger и проверка полной истории. Внешние `BEGIN`, `COMMIT`
и итоговый `SELECT` нельзя отправлять вместе с `DO` через этот редактор. Одна команда
атомарна; проверять ledger отдельным запросом. Предпочтительным воспроизводимым
способом для будущих обновлений остаются существующие CLI `db:migrate` / `db:verify`.

## 4. Deploy и scheduler

Запустить deployment из Vercel. `vercel.json` задаёт `npm ci`, `npm run build` и
один Cron на `/api/cron/social` **ежедневно в 03:00 UTC (06:00 Москвы)** — расписание,
совместимое с ограничением Hobby на один запуск в день. Cron запускается только
для production deployment; preview не должен выполнять production jobs.

Этот endpoint проверяет secret **до доступа к базе**, не принимает query overrides
или гостевую авторизацию. Обрабатывает до пяти intent jobs, пяти candidate jobs и пяти notification
jobs за вызов, включая reminders; использует durable leases, retries и
deduplication. Через 45 секунд перестаёт начинать следующую работу; уже начатая
транзакция завершается. Host имеет hard limit 300 секунд: при принудительном
прерывании leases позволяют безопасно повторить работу. Результат — только counters,
ошибки не содержат персонального контента/секретов. Read-only mode пропускает jobs.

**Для активной beta рекомендуется запуск раз в минуту.** На тарифе, допускающем
такую частоту, изменить schedule на `* * * * *` и redeploy. Альтернатива на Hobby —
доверенный внешний scheduler с HTTPS GET и server-side Bearer secret. Не класть
секрет в query URL. Не запускать несколько scheduler без необходимости; concurrent
вызовы безопасны, но расходуют ресурсы. Защита deployment должна пропускать
авторизованный scheduler: учитывать Vercel Deployment Protection при выборе способа.

Start нового intent выполняет bounded best-effort обработку известных кандидатов;
это не гарантирует мгновенную доставку и не заменяет scheduler. Будущие совместимые
posts ставят active searches в durable queue. Daily default означает отложенные
intent offers, поиск будущих кандидатов/push/reminders и может
не успеть до expiry короткого занятия. Это **не задерживает** явный discovery,
Interested, accept, запись chat, inbox или realtime активного пользователя: эти
действия сохраняются синхронно. Для реальных вечерних встреч ежедневного worker
расписания недостаточно; настроить частый scheduler до приглашения пользователей.

Не запускать бесконечные workers внутри Vercel web functions. Existing CLI
`social:process`/`notifications:process` также можно запускать на доверенном host
по расписанию, используя эту же БД. Retention не выполняется этим Cron: preview
ежедневно на operations host, apply только по явно принятой политике. Backups —
ежедневно вне Vercel ephemeral filesystem, минимум 7 последних и test restore
ежемесячно. Neon restore/history зависит от тарифа и не заменяет проверку recovery.

## 5. Realtime и runtime assets

SSE route работает в Node runtime с `maxDuration=300`, завершает поток через
240 секунд. Клиент reconnect с backoff, безопасный outbox cursor и API sync;
PostgreSQL остаётся источником истины. Каждая подписка авторизована текущей сессией.
Никакие внутренние profile IDs или global incognito alias не отправляются.

На Vercel instance использует общий LISTEN client с прежними subscription caps;
Next.js `after` закрывает его после завершения последнего ответа, не отключая
другие streams. Счётчик включает запросы, ещё проходящие авторизацию. Query pool
подключён к lifecycle через `@vercel/functions.attachDatabasePool`. Для VPS/Docker
общий listener и прежний shutdown flow сохраняются. Не направлять realtime URI
на Neon `-pooler` endpoint.

Next file tracing явно включает SQL для readiness и локальные кириллические
DejaVu fonts для OG. Это необходимо для serverless packaging; никаких внешних
tracking/font requests не добавлено.

## 6. Проверить настоящий deployment

1. `/api/health` → 200; `/api/ready` → 200 после всех migrations. Никогда не считать
   одну работающую landing доказательством исправной базы.
2. `/opengraph-image` возвращает PNG с русским текстом; invite OG также работает.
3. Независимые браузеры: minimal composer → review/один clarification → Start →
   compatible offer → «Я в деле» → full consenting room → plain-text chat без
   Refresh → Plan it → availability/results/votes/confirmation. Третий пользователь
   не получает room access. Проверить external seats, stop/update/expiry, последний
   слот, preferences/quiet hours и completion/history; сохранить legacy шахматный
   discovery/Interested/Accept flow. Пройти также на настоящих iPhone/Android.
4. Подождать более четырёх минут: SSE reconnect восстанавливает состояние; закрытие
   одной вкладки не отключает второго участника. Network offline/online не теряет
   persisted messages. Проверить списки активных Neon connections и Vercel errors.
5. Block останавливает сообщения; deleted/recovered sessions теряют доступ;
   incognito identities независимы между pairs и rooms. Проверить восемь Profile
   Worlds, self/stranger/matched projections и скрытые incognito customization.
   Удаление после recovery стирает исторически связанные plan identities. Moderator
   login и room reports/evidence защищены.
6. Без Cron secret endpoint → 401; с правильным secret → 200 и bounded counters;
   нет секретов, сообщений, raw intent или contacts в runtime logs. Проверить
   Cron execution в dashboard, будущего candidate notification и push fallback.
7. Проверить Secure/HttpOnly cookies, выбранный trusted origin и отсутствие CORS
   разрешений для чужих origin. Preview credentials не открывают production data.
8. Настроить внешний HTTPS monitoring для health/readiness, наблюдать failed jobs
   через `npm run ops:status` на operations host и настроить backup/restore.

Vercel/Neon аккаунты, production URI, разрешённый сетевой доступ и HTTPS smoke
нужны для фактической публикации. До этих проверок это **closed beta release
candidate**, а не подтверждённый production deployment.
