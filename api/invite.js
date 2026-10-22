// api/invite.js
const { redisCommand, redisPipeline } = require('./_redis');
const { sendTelegramMessage, getLocalDateString, getTzOffset } = require('./_util');

module.exports = async (req, res) => {
  const uid = req.query.uid;
  if (!uid) {
    return res.status(400).json({ error: 'Missing uid' });
  }

  const inviteKey = `invite:${uid}`;

  if (req.method === 'GET') {
    // Получаем данные приглашения
    const inviteData = await redisCommand(['HGETALL', inviteKey]);
    if (!inviteData || inviteData.length === 0) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const inv = {};
    for (let i = 0; i < inviteData.length; i += 2) {
      inv[inviteData[i]] = inviteData[i + 1];
    }

    // Получаем список активных мест из Redis (или стандартные)
    let placesRaw = await redisCommand(['GET', 'places']);
    let places = [];
    if (placesRaw) {
      try { places = JSON.parse(placesRaw); } catch (e) { places = []; }
    }
    if (!places || places.length === 0) {
      places = [
        { id: 'p1', name: 'Кафе', emoji: '☕', desc: 'Уютное местечко с десертами', address: 'ул. Ленина, 10', active: true, order: 1 },
        { id: 'p2', name: 'Парк', emoji: '🌳', desc: 'Прогулка на свежем воздухе', address: 'Центральный вход', active: true, order: 2 },
        { id: 'p3', name: 'Кино', emoji: '🎬', desc: 'Свежий блокбастер на большом экране', address: 'ТРЦ Мега, 3 этаж', active: true, order: 3 }
      ];
    }
    // Оставляем только активные места
    const activePlaces = places.filter(p => p.active !== false);

    let notesArr = [];
    try { notesArr = JSON.parse(inv.notes || '[]'); } catch (e) { notesArr = []; }

    return res.status(200).json({
      fromName: inv.fromName,
      toName: inv.toName,
      gender: inv.gender,
      answer: inv.answer ? JSON.parse(inv.answer) : null,
      notes: notesArr,
      places: activePlaces
    });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const { event } = body;
    if (!event || !['open', 'no'].includes(event)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    const exists = await redisCommand(['EXISTS', inviteKey]);
    if (!exists) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const todayStr = getLocalDateString(new Date(), getTzOffset());

    if (event === 'open') {
      // Учитываем открытие один раз (SET NX дляopenedAt)
      // Сначала проверим текущее значение openedAt
      const openedAtVal = await redisCommand(['HGET', inviteKey, 'openedAt']);
      if (!openedAtVal || Number(openedAtVal) === 0) {
        const now = Date.now();
        await redisCommand(['HSET', inviteKey, 'openedAt', now]);
        
        // Отправляем уведомление отправителю
        const chatId = await redisCommand(['HGET', inviteKey, 'chatId']);
        const toName = await redisCommand(['HGET', inviteKey, 'toName']);
        if (chatId) {
          await sendTelegramMessage(chatId, `👁 <b>${toName}</b> только что открыл(а) ваше приглашение!`);
        }

        // Статистика
        await redisPipeline([
          ['HINCRBY', 'stats:total', 'open', 1],
          ['HINCRBY', `stats:day:${todayStr}`, 'open', 1],
          ['LPUSH', 'events', JSON.stringify({ type: 'open', uid, at: now })]
        ]);
      }
      return res.status(200).json({ ok: true });
    }

    if (event === 'no') {
      // Увеличиваем счётчик кликов «Нет»
      const noClicks = await redisCommand(['HINCRBY', inviteKey, 'noClicks', 1]);
      await redisPipeline([
        ['HINCRBY', 'stats:total', 'no', 1],
        ['HINCRBY', `stats:day:${todayStr}`, 'no', 1],
        ['LPUSH', 'events', JSON.stringify({ type: 'no', uid, at: Date.now() })]
      ]);
      return res.status(200).json({ ok: true, noClicks });
    }

    return res.status(400).json({ error: 'Unknown event' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method Not Allowed' });
};