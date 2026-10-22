// api/_redis.js
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCommand(commandArgs) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Upstash Redis credentials are not configured');
  }

  const response = await fetch(UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commandArgs),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Redis error: ${data.error || response.statusText}`);
  }
  return data.result;
}

async function redisPipeline(commands) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Upstash Redis credentials are not configured');
  }

  const response = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Redis pipeline error: ${data.error || response.statusText}`);
  }
  return data;
}

module.exports = { redisCommand, redisPipeline };