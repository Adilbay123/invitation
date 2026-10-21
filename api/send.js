// POST /api/send
//   {uid, type: 'answer', date, time, placeId}  — ответ на приглашение (один раз)
//   {uid, type: 'note', note}                   — записка (до 3 штук, после ответа)
// Сообщение уходит тому, кто создал это приглашение (chatId берётся из Redis).

const { redis } = require('./_redis');
const U = require('./_util');

const MAX_NOTES = 3;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return U.json(res, 405, { ok: false, error: 'Method not allowed' });
    }

    try {
        const body = U.readBody(req);
        const uid = String(body.uid || '');

        if (!(await U.rateLimit(`send:${uid}`, 20, 3600)) ||
            !(await U.rateLimit(`sendip:${U.clientIp(req)}`, 60, 3600))) {
            return U.json(res, 429, { ok: false, error: 'Слишком много запросов. Попробуй позже.' });
        }

        const inv = await U.getInvite(uid);
        if (!inv) return U.json(res, 404, { ok: false, error: 'Ссылка истекла или недействительна' });

        if (body.type === 'answer') return await sendAnswer(res, uid, inv, body);
        if (body.type === 'note') return await sendNote(res, uid, inv, body);
        return U.json(res, 400, { ok: false, error: 'Неизвестный тип запроса' });
    } catch (err) {
        console.error('send error:', err);
        return U.json(res, 500, { ok: false, error: 'Ошибка сервера' });
    }
};

async function sendAnswer(res, uid, inv, body) {
    const date = String(body.date || '');
    const time = String(body.time || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z'))) {
        return U.json(res, 400, { ok: false, error: 'Некорректная дата' });
    }
    if (date < U.localDay(-1)) {
        return U.json(res, 400, { ok: false, error: 'Дата уже прошла' });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return U.json(res, 400, { ok: false, error: 'Некорректное время' });
    }

    // Название места берём на сервере, а не из запроса
    const place = (await U.getPlaces()).find((p) => p.id === body.placeId && p.active !== false);
    if (!place) return U.json(res, 400, { ok: false, error: 'Это место больше недоступно' });

    // Отвечать можно один раз
    const lock = await redis('set', `answered:${uid}`, '1', 'NX', 'EX', U.INVITE_TTL);
    if (!lock) return U.json(res, 409, { ok: false, error: 'Ответ уже отправлен' });

    const placeLine = `${place.emoji ? place.emoji + ' ' : ''}${place.name}`;
    let text =
        `💌 <b>${U.esc(inv.toName)} ${U.g(inv.gender, 'ответила', 'ответил')} на приглашение</b>\n\n` +
        `${U.g(inv.gender, 'Согласна', 'Согласен')}! 😊\n\n` +
        `📅 ${U.esc(U.formatDateRu(date))}\n` +
        `🕒 ${U.esc(time)}\n` +
        `📍 ${U.esc(placeLine)}` + (place.address ? `\n🗺 ${U.esc(place.address)}` : '');

    if (inv.noClicks > 0) {
        const n = inv.noClicks;
        const word = n % 10 >= 2 && n % 10 <= 4 && (n < 12 || n > 14) ? 'раза' : 'раз';
        text += `\n\n😄 Кнопку «Нет» ${U.g(inv.gender, 'пыталась', 'пытался')} нажать ${n} ${word}`;
    }
    text += `\n\n<i>До встречи!</i>`;

    try {
        await U.sendMessage(inv.chatId, text);
    } catch (err) {
        await redis('del', `answered:${uid}`); // даём возможность повторить
        console.error('send answer failed:', err.message);
        return U.json(res, 502, { ok: false, error: 'Не удалось отправить уведомление' });
    }

    inv.answer = {
        date, time,
        placeId: place.id,
        placeName: place.name,
        placeEmoji: place.emoji || '',
        placeAddress: place.address || '',
        at: Date.now(),
    };
    await U.saveInvite(uid, inv);
    await U.track('answer', { uid, invite: inv, placeId: place.id });

    return U.json(res, 200, { ok: true });
}

async function sendNote(res, uid, inv, body) {
    if (!inv.answer) {
        return U.json(res, 400, { ok: false, error: 'Сначала нужно ответить на приглашение' });
    }
    if ((inv.notes || 0) >= MAX_NOTES) {
        return U.json(res, 409, { ok: false, error: `Можно отправить не больше ${MAX_NOTES} записок` });
    }

    const note = String(body.note || '').trim().slice(0, 200);
    if (!note) return U.json(res, 400, { ok: false, error: 'Записка пустая' });

    try {
        await U.sendMessage(
            inv.chatId,
            `💬 <b>Записка от ${U.esc(inv.toName)}</b>\n\n<i>${U.esc(note)}</i>`
        );
    } catch (err) {
        console.error('send note failed:', err.message);
        return U.json(res, 502, { ok: false, error: 'Не удалось отправить записку' });
    }

    inv.notes = (inv.notes || 0) + 1;
    await U.saveInvite(uid, inv);
    await U.track('note', { uid, invite: inv });

    return U.json(res, 200, { ok: true, notes: inv.notes });
}
