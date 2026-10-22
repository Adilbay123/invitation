const http = require('http');
const webhookHandler = require('./api/webhook.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Добавляем метод status и send, чтобы функции совместимые с Vercel работали на Render
  res.status = function(code) {
    res.statusCode = code;
    return res;
  };

  res.send = function(data) {
    res.end(data);
    return res;
  };

  // Перехватываем POST-запросы от Telegram на /api/webhook
  if (req.url === '/api/webhook' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => {
      body.push(chunk);
    });
    req.on('end', async () => {
      req.body = Buffer.concat(body).toString();
      try {
        // Парсим тело в объект, если это JSON
        if (req.headers['content-type']?.includes('application/json')) {
          req.body = JSON.parse(req.body);
        }
      } catch (e) {}
      
      try {
        await webhookHandler(req, res);
      } catch (err) {
        console.error('Server webhook error:', err);
        if (!res.headersSent) {
          res.status(500).send('Internal Server Error');
        }
      }
    });
    return;
  }

  // Главная страница для проверки
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: "❤️ Love Story API", status: "running" }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});