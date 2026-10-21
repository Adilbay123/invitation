// API админ-панели. Защита: заголовок x-admin-password == ADMIN_PASSWORD.
//   GET  /api/admin?action=overview      — статистика, приглашения, события, места
//   POST /api/admin?action=save_places   — {places: [...]} сохранить список мест
//   POST /api/admin?action=delete_invite — {uid}

const crypto = require('crypto');
const { redis, pipeline } = require('./_redis');
const U = require('./_util');

function passwordOk(req) {
    const expected = process.env.ADMIN_PASSWORD || '';
    const given = String(req.headers['x-admin-password'] || '');
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
    if (!process.env.ADMIN_PASSWORD) {
        return U.json(res, 503, { ok: false, error: 'ADMIN_PASSWORD не задан в переменных окружения' });
    }

    try {
        // Защита от перебора: 10 неудачных попыток за 15 минут с одного IP
        const failKey = `admfail:${U.clientIp(req)}`;
        const fails = Number((await redis('get', failKey)) || 0);
        if (fails >= 10) {
            return U.json(res, 429, { ok: false, error: 'Слишком много попыток. Подожди 15 минут.' });
        }
        if (!passwordOk(req)) {
            const n = await redis('incr', failKey);
            if (n === 1) await redis('expire', failKey, 900);
            return U.json(res, 401, { ok: false, error: 'Неверный пароль' });
        }

        const action = String(req.query.action || 'overview');
        if (req.method === 'GET' && action === 'overview') return await overview(res);
        if (req.method === 'POST' && action === 'save_places') return await savePlaces(req, res);
        if (req.method === 'POST' && action === 'delete_invite') return await deleteInvite(req, res);
        return U.json(res, 400, { ok: false, error: 'Неизвестное действие' });
    } catch (err) {
        console.error('admin error:', err);
        return U.json(res, 500, { ok: false, error: 'Ошибка сервера' });
    }
};

// HGETALL возвращает плоский массив [k, v, k, v] → объект с числами
function toObj(arr) {
    const out = {};
    for (let i = 0; i < (arr || []).length; i += 2) out[arr[i]] = Number(arr[i + 1]);
    return out;
}

async function overview(res) {
    const dayKeys = [];
    for (let i = 13; i >= 0; i--) dayKeys.push(U.localDay(-i));

    const [totalRaw, placeStatsRaw, uidsRaw, eventsRaw, ...dayRaw] = await pipeline([
        ['hgetall', 'stats:total'],
        ['hgetall', 'stats:places'],
        ['smembers', 'invites'],
        ['lrange', 'events', 0, 29],
        ...dayKeys.map((d) => ['hgetall', `stats:day:${d}`]),
    ]);

    const totals = toObj(totalRaw);
    const days = dayKeys.map((day, i) => ({ day, ...toObj(dayRaw[i]) }));

    // Приглашения (ограничиваем 1000 штук)
    const uids = (uidsRaw || []).slice(0, 1000);
    let invites = [];
    if (uids.length) {
        const raws = await pipeline(uids.map((uid) => ['get', `invite:${uid}`]));
        const dead = [];
        raws.forEach((raw, i) => {
            if (!raw) return dead.push(uids[i]);
            try {
                const inv = JSON.parse(raw);
                invites.push({
                    uid: uids[i],
                    fromName: inv.fromName,
                    toName: inv.toName,
                    gender: inv.gender,
                    createdAt: inv.createdAt,
                    openedAt: inv.openedAt,
                    noClicks: inv.noClicks || 0,
                    notes: inv.notes || 0,
                    answer: inv.answer || null,
                });
            } catch (e) { /* битая запись — пропускаем */ }
        });
        if (dead.length) {
            redis('srem', 'invites', ...dead).catch(() => {}); // убираем истёкшие из индекса
        }
        invites.sort((a, b) => b.createdAt - a.createdAt);
    }

    const places = await U.getPlaces();
    const placeStats = Object.entries(toObj(placeStatsRaw))
        .map(([id, count]) => {
            const p = places.find((x) => x.id === id);
            return { id, name: p ? p.name : id, emoji: p ? p.emoji : '', removed: !p, count };
        })
        .sort((a, b) => b.count - a.count);

    const events = (eventsRaw || []).map((r) => {
        try { return JSON.parse(r); } catch (e) { return null; }
    }).filter(Boolean);

    return U.json(res, 200, {
        ok: true,
        totals: {
            created: totals.created || 0,
            open: totals.open || 0,
            no: totals.no || 0,
            answer: totals.answer || 0,
            note: totals.note || 0,
        },
        days, placeStats, invites, events, places,
    });
}

async function savePlaces(req, res) {
    const input = U.readBody(req).places;
    if (!Array.isArray(input) || input.length > 50) {
        return U.json(res, 400, { ok: false, error: 'Нужен список мест (не больше 50)' });
    }

    const seen = new Set();
    const places = [];
    for (const p of input) {
        const name = String((p && p.name) || '').trim().slice(0, 40);
        if (!name) return U.json(res, 400, { ok: false, error: 'У каждого места должно быть название' });

        let id = String((p && p.id) || '');
        if (!/^[a-z0-9_]{1,24}$/.test(id) || seen.has(id)) id = 'p' + crypto.randomBytes(4).toString('hex');
        seen.add(id);

        places.push({
            id,
            emoji: String(p.emoji || '').trim().slice(0, 8),
            name,
            desc: String(p.desc || '').trim().slice(0, 80),
            address: String(p.address || '').trim().slice(0, 120),
            active: p.active !== false,
        });
    }

    if (!places.some((p) => p.active)) {
        return U.json(res, 400, { ok: false, error: 'Нужно оставить хотя бы одно активное место' });
    }

    await redis('set', 'places', JSON.stringify(places));
    return U.json(res, 200, { ok: true, places });
}

async function deleteInvite(req, res) {
    const uid = String(U.readBody(req).uid || '');
    const inv = await U.getInvite(uid);
    const cmds = [
        ['del', `invite:${uid}`],
        ['del', `opened:${uid}`],
        ['del', `answered:${uid}`],
        ['srem', 'invites', uid],
    ];
    if (inv && inv.chatId) cmds.push(['srem', `sender:${inv.chatId}`, uid]);
    await pipeline(cmds);
    return U.json(res, 200, { ok: true });
}
