// api/send.js
const { redisCommand, redisPipeline } = require('./_redis');
const { sendTelegramMessage, escapeHtml, getLocalDateString, getTzOffset } = require('./_util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { uid, type } = body;
  if (!uid || !type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const inviteKey = `invite:${uid}`;
  const inviteData = await redisCommand(['HGETALL', inviteKey]);
  if (!inviteData || inviteData.length === 0) {
    return res.status(404).json({ error: 'Invite not found' });
  }

  const inv = {};
  for (let i = 0; i < inviteData.length; i += 2) {
    inv[inviteData[i]] = inviteData[i + 1];
  }

  const chatId = inv.chatId;
  const gender = inv.gender;
  const toName = inv.toName;
  const todayStr = getLocalDateString(new Date(), getTzOffset());

  // Обработка ответа на свидание
  if (type === 'answer') {
    const { date, time, placeId } = body;
    if (!date || !time || !placeId) {
      return res.status(400).json({ error: 'Missing date, time or placeId' });
    }

    // Проверка, что дата не в прошлом
    const selectedDate = new Date(`${date}T${time}:00`);
    if (isNaN(selectedDate.getTime()) || selectedDate.getTime() < Date.now() - 300000) {
      return res.status(400).json({ error: 'Date cannot be in the past' });
    }

    // Проверяем существование и активность места
    let placesRaw = await redisCommand(['GET', 'places']);
    let places = [];
    if (placesRaw) {
      try { places = JSON.parse(placesRaw); } catch (e) { places = []; }
    }
    if (!places || places.length === 0) {
      places = [
        { id: 'p1', name: 'Кафе', emoji: '☕', desc: 'Уютное местечко с десертами', address: 'ул. Ленина, 10', active: true },
        { id: 'p2', name: 'Парк', emoji: '🌳', desc: 'Прогулка на свежем воздухе', address: 'Центральный вход', active: true },
        { id: 'p3', name: 'Кино', emoji: '🎬', desc: 'Свежий блокбастер на большом экране', address: 'ТРЦ Мега, 3 этаж', active: true }
      ];
    }

    const placeObj = places.find(p => p.id === placeId && p.active !== false);
    if (!placeObj) {
      return res.status(400).json({ error: 'Invalid or inactive place selected' });
    }

    // Проверяем, что ответ принимается один раз (SET NX через поле answer)
    if (inv.answer && inv.answer !== '') {
      return res.status(409).json({ error: 'Answer already submitted' });
    }

    const answerData = {
      date,
      time,
      placeName: `${placeObj.emoji} ${placeObj.name}`,
      placeAddress: placeObj.address,
      submittedAt: Date.now()
    };

    // Сохраняем ответ в Redis
    await redisCommand(['HSET', inviteKey, 'answer', JSON.stringify(answerData)]);

    // Статистика мест и общая
    const placeStatKey = `stats:places`;
    await redisPipeline([
      ['HINCRBY', placeStatKey, placeObj.name, 1],
      ['HINCRBY', 'stats:total', 'answer', 1],
      ['HINCRBY', `stats:day:${todayStr}`, 'answer', 1],
      ['LPUSH', 'events', JSON.stringify({ type: 'answer', uid, at: Date.now() })]
    ]);

    // Текстовые окончания в зависимости от пола
    const isFemale = gender === 'female';
    const otvetilaStr = isFemale ? 'ответила' : 'ответил';
    const soglasnaStr = isFemale ? 'Согласна' : 'Согласен';

    const noClicksCount = inv.noClicks || 0;

    const telegramText = 
      `🎉 <b>${escapeHtml(toName)}</b> ${otvetilaStr} на приглашение!\n\n` +
      `✨ ${soglasnaStr}!\n` +
      `📅 Дата: <b>${date}</b>\n` +
      `⏰ Время: <b>${time}</b>\n` +
      `📍 Место: <b>${escapeHtml(placeObj.emoji)} ${escapeHtml(placeObj.name)}</b>\n` +
      `📌 Адрес: <code>${escapeHtml(placeObj.address)}</code>\n` +
      `🚫 Нажатий «Нет»: <b>${noClicksCount}</b>`;

    try {
      await sendTelegramMessage(chatId, telegramText);
    } catch (e) {
      console.error('Failed to send telegram notification:', e);
    }

    return res.status(200).json({ ok: true, answer: answerData });
  }

  // Обработка отправки записки
  if (type === 'note') {
    const { note } = body;
    if (!note || typeof note !== 'string') {
      return res.status(400).json({ error: 'Missing note text' });
    }

    if (note.length > 200) {
      return res.status(400).json({ error: 'Note is too long (max 200 characters)' });
    }

    if (!inv.answer || inv.answer === '') {
      return res.status(400).json({ error: 'Cannot send note before answering' });
    }

    let notesArr = [];
    try { notesArr = JSON.parse(inv.notes || '[]'); } catch (e) { notesArr = []; }

    if (notesArr.length >= 3) {
      return res.status(400).json({ error: 'Maximum 3 notes allowed' });
    }

    const cleanNote = escapeHtml(note.trim());
    notesArr.push({ text: cleanNote, at: Date.now() });

    await redisCommand(['HSET', inviteKey, 'notes', JSON.stringify(notesArr)]);
    await redisPipeline([
      ['HINCRBY', 'stats:total', 'note', 1],
      ['HINCRBY', `stats:day:${todayStr}`, 'note', 1],
      ['LPUSH', 'events', JSON.stringify({ type: 'note', uid, at: Date.now() })]
    ]);

    const isFemale = gender === 'female';
    const telegramText = `📝 Новая записка от <b>${escapeHtml(toName)}</b> (${isFemale ? 'Она' : 'Он'}):\n\n<i>${cleanNote}</i>`;
    try {
      await sendTelegramMessage(chatId, telegramText);
    } catch (e) {
      console.error('Failed to send telegram note notification:', e);
    }

    return res.status(200).json({ ok: true, notes: notesArr });
  }

  return res.status(400).json({ error: 'Unknown request type' });
};