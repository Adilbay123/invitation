// api/webhook.js
const crypto = require('crypto');
const { redisCommand, redisPipeline } = require('./_redis');
const { timingSafeEqualStr, sendTelegramMessage, getLocalDateString, getTzOffset } = require('./_util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Проверка секретного токена вебхука
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret && !timingSafeEqualStr(secretHeader, webhookSecret)) {
    return res.status(200).json({ ok: true }); // Всегда отвечаем 200 по требованиям Telegram
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // Обработка текстовых команд и сообщений
    if (update.message) {
      await handleMessage(update.message);
    } 
    // Обработка нажатий на inline-кнопки (выбор пола)
    else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }

  return res.status(200).json({ ok: true });
};

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  let text = (msg.text || '').trim();
  if (!text) return;

  // Очистка от упоминания бота типа /command@BotName
  text = text.replace(/@\w+/, '');

  // Получаем имя отправителя из Redis
  let senderName = await redisCommand(['GET', `sender:name:${chatId}`]);

  // Команда /myname Имя
  if (text.startsWith('/myname')) {
    const parts = text.split(' ');
    const name = parts.slice(1).join(' ').trim();
    if (!name || name.length > 30) {
      await sendTelegramMessage(chatId, '❌ Укажи корректное имя (до 30 символов). Пример: <code>/myname Асан</code>');
      return;
    }
    await redisCommand(['SET', `sender:name:${chatId}`, name]);
    await sendTelegramMessage(chatId, `✅ Твое имя успешно сохранено как: <b>${name}</b>`);
    return;
  }

  if (!senderName) {
    senderName = msg.from.first_name || 'Отправитель';
    await redisCommand(['SET', `sender:name:${chatId}`, senderName]);
  }

  // Команды /start и /help
  if (text === '/start' || text === '/help') {
    const helpText = 
      `👋 Привет, <b>${senderName}</b>!\n\n` +
      `Я бот для создания красивых приглашений погулять.\n\n` +
      `<b>Команды:</b>\n` +
      `• <code>/new</code> — создать новое приглашение\n` +
      `• <code>/my</code> — список твоих приглашений\n` +
      `• <code>/myname Имя</code> — изменить твое имя\n` +
      `• <code>/cancel</code> — отменить текущее действие\n\n` +
      `Каждое приглашение уникально, а получатель сможет выбрать дату, время и место!`;
    await sendTelegramMessage(chatId, helpText);
    return;
  }

  // Команда /cancel
  if (text === '/cancel') {
    await redisCommand(['DEL', `state:${chatId}`]);
    await sendTelegramMessage(chatId, '🚫 Текущее действие отменено.');
    return;
  }

  // Команда /my
  if (text === '/my') {
    const inviteUids = await redisCommand(['SMEMBERS', `sender:${chatId}`]);
    if (!inviteUids || inviteUids.length === 0) {
      await sendTelegramMessage(chatId, '📭 У тебя пока нет созданных приглашений. Нажми <code>/new</code>, чтобы создать.');
      return;
    }

    // Загружаем данные по всем приглашениям через pipeline
    const pipelineCmds = inviteUids.map(uid => ['HGETALL', `invite:${uid}`]);
    const results = await redisPipeline(pipelineCmds);

    const invites = [];
    results.forEach((resItem, idx) => {
      if (resItem.result) {
        // Ответ HGETALL в Upstash REST приходит в виде массива [key1, val1, key2, val2...] или объекта
        const arr = resItem.result;
        const obj = {};
        for (let i = 0; i < arr.length; i += 2) {
          obj[arr[i]] = arr[i + 1];
        }
        obj.uid = inviteUids[idx];
        invites.push(obj);
      }
    });

    // Сортируем по дате создания (новые сверху) и берем последние 10
    invites.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    const last10 = invites.slice(0, 10);

    let msgText = `📋 <b>Твои последние приглашения:</b>\n\n`;
    last10.forEach((inv, index) => {
      let status = '⏳ Ждёт ответа';
      if (inv.answer) {
        status = '✅ Ответил(а)';
      } else if (Number(inv.openedAt) > 0) {
        status = '👁 Открыто';
      }

      const siteUrl = process.env.SITE_URL || 'https://your-app.vercel.app';
      const link = `${siteUrl}/?uid=${inv.uid}`;
      msgText += `${index + 1}. Кому: <b>${inv.toName}</b> (${inv.gender === 'female' ? 'Она' : 'Он'})\n`;
      msgText += `   Статус: ${status}\n`;
      msgText += `   🔗 <a href="${link}">Открыть ссылку</a>\n\n`;
    });

    await sendTelegramMessage(chatId, msgText);
    return;
  }

  // Команда /new
  if (text === '/new') {
    // Проверка лимита: не больше 20 приглашений в сутки
    const todayStr = getLocalDateString(new Date(), getTzOffset());
    const limitKey = `limit:chat:${chatId}:${todayStr}`;
    const countStr = await redisCommand(['GET', limitKey]);
    const count = countStr ? parseInt(countStr, 10) : 0;

    if (count >= 20) {
      await sendTelegramMessage(chatId, '⚠️ Превышен лимит: не больше 20 приглашений в сутки.');
      return;
    }

    // Сохраняем состояние диалога: ожидаем имя получателя
    await redisCommand(['SET', `state:${chatId}`, JSON.stringify({ step: 'waiting_to_name' }), 'EX', 900]);
    await sendTelegramMessage(chatId, '✍️ Введи имя получателя (от 1 до 30 символов):');
    return;
  }

  // Обработка ввода в рамках диалога (состояние в Redis)
  const stateStr = await redisCommand(['GET', `state:${chatId}`]);
  if (stateStr) {
    let state;
    try { state = JSON.parse(stateStr); } catch (e) { state = {}; }

    if (state.step === 'waiting_to_name') {
      const toName = text.trim();
      if (!toName || toName.length > 30) {
        await sendTelegramMessage(chatId, '❌ Имя должно быть от 1 до 30 символов. Попробуй еще раз или напиши /cancel.');
        return;
      }

      // Переходим к выбору пола (inline-кнопки)
      await redisCommand(['SET', `state:${chatId}`, JSON.stringify({ step: 'waiting_gender', toName }), 'EX', 900]);
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '👩 Она', callback_data: 'gender:female' },
            { text: '👨 Он', callback_data: 'gender:male' }
          ]
        ]
      };

      await sendTelegramMessage(chatId, `👤 Получатель: <b>${toName}</b>\nТеперь выбери пол получателя:`, keyboard);
      return;
    }
  }
}

async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const data = query.data;

  const stateStr = await redisCommand(['GET', `state:${chatId}`]);
  if (!stateStr) {
    await sendTelegramMessage(chatId, '⏱ Время сессии истекло. Начни заново с помощью /new.');
    return;
  }

  let state;
  try { state = JSON.parse(stateStr); } catch (e) { state = {}; }

  if (state.step === 'waiting_gender' && data.startsWith('gender:')) {
    const gender = data.split(':')[1];
    const toName = state.toName;
    const senderName = await redisCommand(['GET', `sender:name:${chatId}`]) || 'Отправитель';

    // Создаем UID (10 случайных символов)
    const uid = crypto.randomBytes(5).toString('hex');
    const createdAt = Date.now();

    // Записываем приглашение в Redis (TTL 180 дней = 15552000 секунд)
    const inviteKey = `invite:${uid}`;
    const pipelineCmds = [
      ['HSET', inviteKey, 
        'chatId', chatId, 
        'fromName', senderName, 
        'toName', toName, 
        'gender', gender, 
        'createdAt', createdAt, 
        'openedAt', 0, 
        'noClicks', 0, 
        'notes', JSON.stringify([]), 
        'answer', ''
      ],
      ['EXPIRE', inviteKey, 15552000],
      ['SADD', 'invites', uid],
      ['SADD', `sender:${chatId}`, uid],
      ['DEL', `state:${chatId}`]
    ];

    // Увеличиваем дневной лимит
    const todayStr = getLocalDateString(new Date(), getTzOffset());
    const limitKey = `limit:chat:${chatId}:${todayStr}`;
    pipelineCmds.push(['INCR', limitKey]);
    pipelineCmds.push(['EXPIRE', limitKey, 86400]);

    // Инкрементируем статистику created
    pipelineCmds.push(['HINCRBY', 'stats:total', 'created', 1]);
    pipelineCmds.push(['HINCRBY', `stats:day:${todayStr}`, 'created', 1]);
    pipelineCmds.push(['LPUSH', 'events', JSON.stringify({ type: 'created', uid, chatId, at: createdAt })]);

    await redisPipeline(pipelineCmds);

    const siteUrl = process.env.SITE_URL || 'https://your-app.vercel.app';
    const link = `${siteUrl}/?uid=${uid}`;

    await sendTelegramMessage(chatId, 
      `🎉 <b>Приглашение успешно создано!</b>\n\n` +
      `Кому: <b>${toName}</b> (${gender === 'female' ? 'Она' : 'Он'})\n` +
      `🔗 Ссылка для отправки:\n<code>${link}</code>`
    );
  }
}