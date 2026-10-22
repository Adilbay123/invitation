// api/admin.js
const { redisCommand, redisPipeline } = require('./_redis');
const { timingSafeEqualStr, getLocalDateString, getTzOffset } = require('./_util');

module.exports = async (req, res) => {
  // 1. Проверка пароля администратора через заголовок x-admin-password
  const adminPassword = process.env.ADMIN_PASSWORD;
  const headerPassword = req.headers['x-admin-password'];

  if (!adminPassword || !timingSafeEqualStr(headerPassword, adminPassword)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query.action || 'stats';

  try {
    // ДЕЙСТВИЕ: СТАТИСТИКА
    if (action === 'stats') {
      const totalRaw = await redisCommand(['HGETALL', 'stats:total']);
      const total = {};
      if (totalRaw) {
        for (let i = 0; i < totalRaw.length; i += 2) {
          total[totalRaw[i]] = parseInt(totalRaw[i + 1], 10);
        }
      }

      // Статистика за последние 14 дней
      const tzOffset = getTzOffset();
      const now = new Date();
      const daysData = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const dayStr = getLocalDateString(d, tzOffset);
        const dayStatsRaw = await redisCommand(['HGETALL', `stats:day:${dayStr}`]);
        const dayObj = { date: dayStr, created: 0, open: 0, no: 0, answer: 0, note: 0 };
        if (dayStatsRaw) {
          for (let j = 0; j < dayStatsRaw.length; j += 2) {
            dayObj[dayStatsRaw[j]] = parseInt(dayStatsRaw[j + 1], 10);
          }
        }
        daysData.push(dayObj);
      }

      // Популярные места
      const placesStatsRaw = await redisCommand(['HGETALL', 'stats:places']);
      const placesStats = {};
      if (placesStatsRaw) {
        for (let i = 0; i < placesStatsRaw.length; i += 2) {
          placesStats[placesStatsRaw[i]] = parseInt(placesStatsRaw[i + 1], 10);
        }
      }

      // Лента последних 100 событий
      const eventsRaw = await redisCommand(['LRANGE', 'events', 0, 99]);
      const events = (eventsRaw || []).map(e => {
        try { return JSON.parse(e); } catch (err) { return { raw: e }; }
      });

      return res.status(200).json({ total, daysData, placesStats, events });
    }

    // ДЕЙСТВИЕ: ПРИГЛАШЕНИЯ
    if (action === 'invites') {
      if (req.method === 'GET') {
        const uids = await redisCommand(['SMEMBERS', 'invites']);
        if (!uids || uids.length === 0) return res.status(200).json({ invites: [] });

        const pipelineCmds = uids.map(uid => ['HGETALL', `invite:${uid}`]);
        const results = await redisPipeline(pipelineCmds);

        const invites = [];
        results.forEach((resItem, idx) => {
          if (resItem.result) {
            const arr = resItem.result;
            const obj = {};
            for (let i = 0; i < arr.length; i += 2) {
              obj[arr[i]] = arr[i + 1];
            }
            obj.uid = uids[idx];
            try { obj.notes = JSON.parse(obj.notes || '[]'); } catch (e) { obj.notes = []; }
            try { obj.answer = obj.answer ? JSON.parse(obj.answer) : null; } catch (e) { obj.answer = null; }
            invites.push(obj);
          }
        });

        invites.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
        return res.status(200).json({ invites });
      }

      if (req.method === 'DELETE') {
        const uid = req.query.uid;
        if (!uid) return res.status(400).json({ error: 'Missing uid' });

        const chatId = await redisCommand(['HGET', `invite:${uid}`, 'chatId']);
        const pipelineCmds = [
          ['DEL', `invite:${uid}`],
          ['SREM', 'invites', uid]
        ];
        if (chatId) {
          pipelineCmds.push(['SREM', `sender:${chatId}`, uid]);
        }
        await redisPipeline(pipelineCmds);
        return res.status(200).json({ ok: true });
      }
    }

    // ДЕЙСТВИЕ: МЕСТА
    if (action === 'places') {
      if (req.method === 'GET') {
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
        return res.status(200).json({ places });
      }

      if (req.method === 'POST') {
        let body;
        try {
          body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON' });
        }

        const { places } = body;
        if (!Array.isArray(places)) {
          return res.status(400).json({ error: 'Places must be an array' });
        }

        // Проверяем, что остаётся хотя бы одно активное место
        const activeCount = places.filter(p => p.active !== false).length;
        if (activeCount < 1) {
          return res.status(400).json({ error: 'At least one active place must remain' });
        }

        await redisCommand(['SET', 'places', JSON.stringify(places)]);
        return res.status(200).json({ ok: true, places });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};