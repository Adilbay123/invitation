// Клиент Upstash Redis REST API.
// Команды уходят POST-запросом с JSON-массивом, поэтому длинные значения не упираются в лимит URL.
// Документация: https://upstash.com/docs/redis/features/restapi

async function call(path, body) {
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) {
        throw new Error('Redis не настроен: задайте UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN');
    }

    const res = await fetch(base.replace(/\/+$/, '') + path, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
        throw new Error(`Redis ${res.status}: ${(data && data.error) || 'нет ответа'}`);
    }
    return data;
}

// redis('set', 'key', 'value', 'EX', 60)
async function redis(...cmd) {
    const data = await call('', cmd.map(String));
    if (data.error) throw new Error('Redis: ' + data.error);
    return data.result;
}

// pipeline([['incr','a'], ['get','b']]) → [результат1, результат2]
async function pipeline(cmds) {
    const data = await call('/pipeline', cmds.map((c) => c.map(String)));
    return data.map((item) => {
        if (item.error) throw new Error('Redis: ' + item.error);
        return item.result;
    });
}

module.exports = { redis, pipeline };
