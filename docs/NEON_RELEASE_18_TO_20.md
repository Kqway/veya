# Обновление Intavro в Neon: 18 → 20

Этот порядок относится только к проверенной версии с миграциями
`0019_profile_spaces.sql` и `0020_intent_lobbies.sql`. Он не создаёт новую БД,
не меняет credentials и не выполняет миграции автоматически при build/start.
Применённые миграции 0001–0018 остаются неизменными.

## 1. Backup и maintenance

Проверьте проект: база Neon должна быть подключена именно к Vercel `intavro`.
Запишите текущий deployment и commit до переключения. На момент проверки
5 октября 2026 production использует `ae68914ede1923f6d93cf888403fc397e9b42cf4`.

До production SQL сделайте защищённый backup и восстановите его в изолированную
БД. Используйте [backup/restore procedure](DEPLOYMENT.md#backup-and-disaster-recovery)
и проверенные `db:backup` / `db:restore`. Schema export не заменяет backup данных.
Копия production с личными данными не должна быть публичным preview-приложением.
Сначала выполните приведённое ниже обновление на восстановленной копии.

Перед обновлением рабочей БД включите `BETA_READ_ONLY=true` в web и worker
окружениях, примените настройку и приостановите scheduler. Старый source проверяет
ровно18 миграций: после обновления ledger его readiness может стать503 до
публикации новой версии. Это запланированное окно maintenance. Не переключайте
старый source обратно на обновлённую БД как неподтверждённый rollback.

## 2. Получить два SQL-файла

Генератор работает offline: читает только SQL репозитория, проверяет порядок и
SHA256, не читает `.env.local` и не подключается к БД.

```bash
npm ci
mkdir -p .local/release
npm run --silent db:release:sql > .local/release/intavro-upgrade-18-to-20.sql
npm run --silent db:release:sql -- --verify > .local/release/intavro-verify-20.sql
```

`.local/` исключён из Git и Docker image. Файлы содержат DDL и migration hashes,
без credentials и пользовательских данных. Генератор принимает только этот
20-migration release; для будущих релизов используйте их проверенный tooling.
При доступном доверенном direct DB URL штатные `db:migrate` / `db:verify` остаются
основным CLI-путём. URL/пароли не отправляйте в чат и не помещайте в Git.

## 3. Выполнить upgrade

После backup, restore rehearsal и maintenance выберите правильные project,
branch и database в Neon Query Editor. Вставьте **только** весь файл
`intavro-upgrade-18-to-20.sql` и запустите один раз. Не добавляйте вокруг `BEGIN`,
`COMMIT`, отдельный `SELECT` или второй файл: prepared protocol не принимает
несколько верхнеуровневых SQL-команд.

Один `DO` statement выполняет обновление атомарно:

- берёт тот же migration lock, что и `db:migrate`; ожидание ограничено10s;
- требует ровно18 либо уже20 записей с точными source checksums;
- отклоняет пропуски, чужие версии, неверные hashes и отсутствующий ledger;
- применяет19/20 и записывает hashes в одной транзакции;
- при ошибке откатывает DDL и ledger; повторный проверенный20 запуск не повторяет
  DDL и не меняет `applied_at`;
- создаёт новые объекты в `public`, независимо от выбранного search_path.

`Unsupported migration history` означает остановку до обновления. Проверьте БД
и исходный release. Не удаляйте строки ledger, не исправляйте hashes вручную и
не запускайте bootstrap поверх существующей БД. При lock timeout дождитесь
завершения другого migration run и повторите тот же файл. До переключения
приложения исключите незавершённую операцию.

## 4. Проверить и опубликовать

Очистите редактор. Вставьте **только** `intavro-verify-20.sql` и запустите отдельно.
Это read-only `SELECT`. Обязательный результат:

```text
verified = true
migration_count = 20
```

Число20 само по себе недостаточно: `verified` сравнивает все versions и checksums.
Сохраните результат вместе с source SHA и backup reference.

Только после этого публикуйте source из [PR #1](https://github.com/Kqway/veya/pull/1)
с зелёным CI. `main` запускает production deployment; feature branch защищена
от автоматической Vercel публикации. Дождитесь READY, проверьте `/api/health`
и `/api/ready` по HTTPS. Затем примените отключение read-only на том же новом
source и возобновите worker в контролируемом beta-окружении. Выполните hosted smoke
до приглашения пользователей. При проблемах снова ограничьте запись и scheduler;
сохраните evidence и backup, не откатывайте source вслепую на новую схему.

## 5. Worker и настоящий smoke

Настройте `social:process` каждую минуту на доверенном operations host либо частый
авторизованный вызов `/api/cron/social`. Не публикуйте `CRON_SECRET`. Ежедневного
Hobby Cron недостаточно для поиска компании сегодня вечером. Не запускайте
бесконечный worker в Vercel web function. Retention `--apply` требует отдельно
принятой политики и backup; этот upgrade его не запускает.

В двух независимых браузерах с явно созданными beta-профилями пройдите фраза →
review/Start → предложение → Accept → комната → chat → Plan it → availability →
proposal/votes → confirmation. Проверьте notifications, block, recovery, удаление
профиля, Incognito pair isolation и все восемь Profile Worlds. Core работает без AI.

На iPhone/Safari и Android/Chrome проверьте узкий экран, клавиатуру, Copy/сохранение
Ключа, browser Back с несохранёнными изменениями, background/reconnect, offline
fallback и opt-in push, если настроен. Используйте полный
[HTTPS/device checklist](DEPLOYMENT.md#first-host-smoke-and-real-devices).
Тестовые runners никогда не направляйте в production.
