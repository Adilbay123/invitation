// Общие хелперы для всех функций. Файлы с «_» Vercel не публикует как эндпоинты.

const crypto = require('crypto');
const { redis, pipeline } = require('./_redis');

const TZ_OFFSET = Number(process.env.TZ_OFFSET_HOURS || 6); // Бишкек = UTC+6
const INVITE_TTL = 60 * 60 * 24 * 180; // 180 дней

const DEFAULT_PLACES = [
    { id: 'cafe',   emoji: '☕', name: 'Кафе', desc: 'Уютное место', address: '', active: true },
    { id: 'park',   emoji: '🌳', name: 'Парк', desc: 'Свежий воздух', address: '', active: true },
    { id: 'cinema', emoji: '🎬', name: 'Кино', desc: 'Новый фильм',  address: '', active: true },
];

// ───── Мелочи ─────
function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// g('f', 'она', 'он') → вариант по полу получателя
function g(gender, f, m) {
    return gender === 'm' ? m : f;
}

function makeUid() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(10);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function localDay(offsetDays = 0) {
    return new Date(Date.now() + TZ_OFFSET * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
}

function formatDateRu(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
}

function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function readBody(req) {
    const b = req.body;
    if (!b) return {};
    if (typeof b === 'string') {
        try { return JSON.parse(b); } catch (e) { return {}; }
    }
    return b;
}

function json(res, status, payload) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json(payload);
}

// ───── Лимиты запросов ─────
// true — можно, false — лимит исчерпан
async function rateLimit(key, limit, windowSec) {
    const n = await redis('incr', `rl:${key}`);
    if (n === 1) await redis('expire', `rl:${key}`, windowSec);
    return n <= limit;
}

// ───── Telegram ─────
async function tg(method, body) {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new Error('BOT_TOKEN не задан');

    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    }
    return data.result;
}

function sendMessage(chatId, text, extra = {}) {
    return tg('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra,
    });
}

// ───── Приглашения ─────
async function getInvite(uid) {
    if (!/^[a-z0-9]{6,20}$/.test(uid || '')) return null;
    const raw = await redis('get', `invite:${uid}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

async function saveInvite(uid, invite) {
    await redis('set', `invite:${uid}`, JSON.stringify(invite), 'EX', INVITE_TTL);
}

// ───── Места (редактируются в админке) ─────
async function getPlaces() {
    const raw = await redis('get', 'places');
    if (!raw) return DEFAULT_PLACES;
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) && arr.length ? arr : DEFAULT_PLACES;
    } catch (e) {
        return DEFAULT_PLACES;
    }
}

// ───── Статистика ─────
// event: created | open | no | answer | note
async function track(event, { uid, invite, placeId } = {}) {
    const day = localDay();
    const entry = JSON.stringify({
        t: Date.now(),
        e: event,
        uid: uid || null,
        from: invite ? invite.fromName : null,
        to: invite ? invite.toName : null,
    });
    const cmds = [
        ['hincrby', 'stats:total', event, 1],
        ['hincrby', `stats:day:${day}`, event, 1],
        ['expire', `stats:day:${day}`, 60 * 60 * 24 * 400],
        ['lpush', 'events', entry],
        ['ltrim', 'events', 0, 99],
    ];
    if (placeId) cmds.push(['hincrby', 'stats:places', placeId, 1]);

    try {
        await pipeline(cmds);
    } catch (e) {
        console.error('track error:', e.message); // статистика не должна ронять основной запрос
    }
}

module.exports = {
    DEFAULT_PLACES, INVITE_TTL,
    esc, g, makeUid, localDay, formatDateRu, clientIp, readBody, json,
    rateLimit, tg, sendMessage,
    getInvite, saveInvite, getPlaces, track,
};
