// api/_util.js
const crypto = require('crypto');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getLocalDateString(date = new Date(), tzOffsetHours = 6) {
  const tzOffsetMs = tzOffsetHours * 60 * 60 * 1000;
  const localDate = new Date(date.getTime() + tzOffsetMs);
  return localDate.toISOString().split('T')[0];
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Чтобы длина не выдавала таймингом, но сравнение отработало
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not configured');

  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!data.ok) {
    console.error('Telegram API error:', data);
  }
  return data;
}

function getTzOffset() {
  const offset = parseInt(process.env.TZ_OFFSET_HOURS, 10);
  return isNaN(offset) ? 6 : offset;
}

module.exports = {
  escapeHtml,
  getLocalDateString,
  timingSafeEqualStr,
  sendTelegramMessage,
  getTzOffset,
};