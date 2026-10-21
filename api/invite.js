// GET  /api/invite?uid=...  → имена, пол, места, статус (для страницы приглашения)
// POST /api/invite          → события {uid, event: 'open' | 'no'}

const { redis } = require('./_redis');
const U = require('./_util');

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') return await getInvite(req, res);
        if (req.method === 'POST') return await postEvent(req, res);
        return U.json(res, 405, { ok: false, error: 'Method not allowed' });
    } catch (err) {
        console.error('invite error:', err);
        return U.json(res, 500, { ok: false, error: 'Ошибка сервера' });
    }
};

async function getInvite(req, res) {
    if (!(await U.rateLimit(`inv:${U.clientIp(req)}`, 120, 60))) {
        return U.json(res, 429, { ok: false, error: 'Слишком много запросов' });
    }

    const uid = String(req.query.uid || '');
    const inv = await U.getInvite(uid);
    if (!inv) return U.json(res, 404, { ok: false, error: 'Ссылка не найдена' });

    const places = (await U.getPlaces())
        .filter((p) => p.active !== false)
        .map(({ id, emoji, name, desc, address }) => ({ id, emoji, name, desc, address }));

    return U.json(res, 200, {
        ok: true,
        fromName: inv.fromName,
        toName: inv.toName,
        gender: inv.gender,
        places,
        answer: inv.answer || null,
        notes: inv.notes || 0,
    });
}

async function postEvent(req, res) {
    const { uid, event } = U.readBody(req);
    if (!['open', 'no'].includes(event)) {
        return U.json(res, 400, { ok: false, error: 'Неизвестное событие' });
    }
    if (!(await U.rateLimit(`ev:${uid}`, 80, 3600))) {
        return U.json(res, 429, { ok: false, error: 'Слишком много запросов' });
    }

    const inv = await U.getInvite(uid);
    if (!inv) return U.json(res, 404, { ok: false, error: 'Ссылка не найдена' });

    if (event === 'open') {
        // Только первое открытие: пишем отправителю один раз
        const first = await redis('set', `opened:${uid}`, '1', 'NX', 'EX', U.INVITE_TTL);
        if (first) {
            inv.openedAt = Date.now();
            await U.saveInvite(uid, inv);
            await U.track('open', { uid, invite: inv });
            try {
                await U.sendMessage(
                    inv.chatId,
                    `👀 <b>${U.esc(inv.toName)}</b> ${U.g(inv.gender, 'открыла', 'открыл')} твоё приглашение`
                );
            } catch (e) {
                console.error('notify open failed:', e.message);
            }
        }
    } else {
        inv.noClicks = Math.min(50, (inv.noClicks || 0) + 1);
        await U.saveInvite(uid, inv);
        await U.track('no', { uid, invite: inv });
    }

    return U.json(res, 200, { ok: true });
}
