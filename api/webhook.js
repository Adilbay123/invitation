// Вебхук Telegram-бота.
// Каждый отправитель (Асан, Искен, ...) создаёт свои приглашения командой /new
// и получает уведомления только о своих.

const crypto = require('crypto');
const { redis, pipeline } = require('./_redis');
const U = require('./_util');

const HELP =
    `Я помогу отправить красивое приглашение погулять. ` +
    `Когда человек ответит, уведомление придёт сюда.\n\n` +
    `/new — создать приглашение\n` +
    `/my — мои приглашения\n` +
    `/myname Имя — как подписывать тебя в приглашении\n` +
    `/cancel — отменить создание`;

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const secret = process.env.WEBHOOK_SECRET;
    if (secret && !safeEqual(req.headers['x-telegram-bot-api-secret-token'] || '', secret)) {
        return res.status(403).send('Forbidden');
    }

    try {
        await handle(U.readBody(req));
    } catch (err) {
        console.error('Webhook error:', err);
    }
    return res.status(200).send('OK'); // всегда 200, чтобы Telegram не слал повторы
};

async function handle(update) {
    if (update.callback_query) return onCallback(update.callback_query);

    const msg = update.message;
    if (!msg || !msg.text || !msg.chat || msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const cmd = text.match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);

    if (cmd) {
        const name = cmd[1].toLowerCase();
        const arg = (cmd[2] || '').trim();

        if (name === 'start' || name === 'help') return onStart(msg);
        if (name === 'new') return onNew(chatId);
        if (name === 'my') return onMy(chatId);
        if (name === 'myname') return onMyName(chatId, arg);
        if (name === 'cancel') {
            await redis('del', `state:${chatId}`);
            return U.sendMessage(chatId, 'Отменено. Чтобы начать заново, напиши /new');
        }
        return; // неизвестные команды игнорируем
    }

    // Обычный текст — возможно, это ответ на вопрос «как зовут?»
    const raw = await redis('get', `state:${chatId}`);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (state.step !== 'name') return;

    const toName = text.replace(/\s+/g, ' ');
    if (toName.length < 1 || toName.length > 30) {
        return U.sendMessage(chatId, 'Имя должно быть от 1 до 30 символов. Напиши ещё раз.');
    }

    await redis('set', `state:${chatId}`, JSON.stringify({ step: 'gender', toName }), 'EX', 900);
    return U.sendMessage(chatId, `Кого приглашаем: <b>${U.esc(toName)}</b>. Это она или он?\nОт этого зависят окончания в текстах.`, {
        reply_markup: {
            inline_keyboard: [[
                { text: '👩 Она', callback_data: 'g:f' },
                { text: '👨 Он', callback_data: 'g:m' },
            ]],
        },
    });
}

async function onStart(msg) {
    const first = (msg.from && msg.from.first_name) || 'друг';
    return U.sendMessage(msg.chat.id, `Привет, ${U.esc(first)}! 👋\n\n${HELP}`);
}

async function onNew(chatId) {
    const ok = await U.rateLimit(`new:${chatId}`, 20, 86400);
    if (!ok) return U.sendMessage(chatId, 'Сегодня создано слишком много приглашений. Попробуй завтра.');

    await redis('set', `state:${chatId}`, JSON.stringify({ step: 'name' }), 'EX', 900);
    return U.sendMessage(chatId, 'Как зовут того, кого хочешь пригласить? Напиши имя.');
}

async function onMyName(chatId, arg) {
    const name = arg.replace(/\s+/g, ' ');
    if (!name || name.length > 30) {
        return U.sendMessage(chatId, 'Напиши так: /myname Асан (до 30 символов)');
    }
    await redis('set', `profile:${chatId}`, name);
    return U.sendMessage(chatId, `Теперь в приглашениях ты подписан как <b>${U.esc(name)}</b>. Старые ссылки не меняются.`);
}

async function onMy(chatId) {
    const uids = (await redis('smembers', `sender:${chatId}`)) || [];
    if (!uids.length) return U.sendMessage(chatId, 'Приглашений пока нет. Создай первое: /new');

    const items = [];
    for (const uid of uids) {
        const inv = await U.getInvite(uid);
        if (inv) items.push({ uid, inv });
    }
    items.sort((a, b) => b.inv.createdAt - a.inv.createdAt);

    const site = siteUrl();
    const lines = items.slice(0, 10).map(({ uid, inv }) => {
        let status = '⏳ ждёт';
        if (inv.answer) status = `✅ ${U.g(inv.gender, 'ответила', 'ответил')}`;
        else if (inv.openedAt) status = `👀 ${U.g(inv.gender, 'открыла', 'открыл')}`;
        return `<b>${U.esc(inv.toName)}</b> — ${status}\n${site}/?uid=${uid}`;
    });
    return U.sendMessage(chatId, lines.join('\n\n'));
}

async function onCallback(cq) {
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const data = cq.data || '';
    if (!chatId || !/^g:[fm]$/.test(data)) {
        return U.tg('answerCallbackQuery', { callback_query_id: cq.id });
    }

    const raw = await redis('get', `state:${chatId}`);
    const state = raw ? JSON.parse(raw) : null;
    if (!state || state.step !== 'gender') {
        return U.tg('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: 'Это приглашение уже создано или отменено. Начни заново: /new',
            show_alert: true,
        });
    }

    const gender = data === 'g:m' ? 'm' : 'f';
    const profile = await redis('get', `profile:${chatId}`);
    const fromName = profile || (cq.from && cq.from.first_name) || 'Друг';

    const uid = U.makeUid();
    const invite = {
        chatId,
        fromName,
        toName: state.toName,
        gender,
        createdAt: Date.now(),
        openedAt: null,
        noClicks: 0,
        notes: 0,
        answer: null,
    };

    await pipeline([
        ['set', `invite:${uid}`, JSON.stringify(invite), 'EX', U.INVITE_TTL],
        ['sadd', 'invites', uid],
        ['sadd', `sender:${chatId}`, uid],
        ['del', `state:${chatId}`],
    ]);
    await U.track('created', { uid, invite });

    await U.tg('answerCallbackQuery', { callback_query_id: cq.id });
    try {
        await U.tg('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
        });
    } catch (e) { /* кнопки уже убраны — не страшно */ }

    const link = `${siteUrl()}/?uid=${uid}`;
    return U.sendMessage(
        chatId,
        `Готово! Ссылка для <b>${U.esc(state.toName)}</b>:\n\n${link}\n\n` +
        `Отправь её сам. Когда ${U.g(gender, 'она откроет и ответит', 'он откроет и ответит')}, я напишу сюда.`
    );
}

function siteUrl() {
    const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
    if (!site) throw new Error('SITE_URL не задан');
    return site;
}
