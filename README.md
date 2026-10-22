# Приглашение погулять (Vercel + Upstash Redis + Telegram Bot)

## Настройка проекта
1. Создайте проект на **Vercel** и подключите репозиторий.
2. Создайте базу данных в **Upstash Redis** и получите REST URL и Token.
3. Заполните переменные окружения в настройках Vercel (или в локальном `.env`):
   - `BOT_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `SITE_URL` (например, `https://your-app.vercel.app`)
   - `ADMIN_PASSWORD`
   - `WEBHOOK_SECRET`
   - `TZ_OFFSET_HOURS` (например, `6`)

## Установка вебхука Telegram
Выполните запрос для регистрации вебхука с секретным токеном:
```bash
curl -X POST "[https://api.telegram.org/bot](https://api.telegram.org/bot)<8365906457:AAESPoZQ1T9sXSrHVZba_0-mwQqjIx4KBVI>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "[https://your-app.vercel.app/api/webhook](https://your-app.vercel.app/api/webhook)", "secret_token": "WEBHOOK_SECRET"}'