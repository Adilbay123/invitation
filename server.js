const http = require('http');
const webhookHandler = require('./api/webhook.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Если Telegram шлет запрос на вебхук:
  if (req.url === '/api/webhook') {
    return webhookHandler(req, res);
  }
  
  // Главная страница (то, что вы сейчас видите в браузере)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: "❤️ API для историй любви", status: "running" }));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});