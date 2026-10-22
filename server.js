const http = require('http');
const webhookHandler = require('./api/webhook.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Ловим запросы именно на /api/webhook
  if (req.url === '/api/webhook') {
    return webhookHandler(req, res);
  }
  
  // Для проверки работы сервера в браузере
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot server is running!');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});