const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const handleApi = require('./api/index.js');

const PORT = process.env.PORT || 3000;

function getLocalIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (name.toLowerCase().includes('wi-fi') || iface.address.startsWith('192.168.')) {
            return iface.address;
          }
        }
      }
    }
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {}
  return 'localhost';
}

function handleStatic(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = parsedUrl.pathname;

  let requestedFile = pathname;
  if (requestedFile === '/' || requestedFile === '') requestedFile = 'index.html';
  else if (requestedFile === '/autopago' || requestedFile === '/kiosco') requestedFile = 'autopago.html';
  else if (requestedFile === '/admin') requestedFile = 'admin.html';
  else if (requestedFile === '/checkout') requestedFile = 'checkout.html';
  else if (requestedFile === '/factura') requestedFile = 'factura.html';
  else if (requestedFile === '/error-pago') requestedFile = 'error-pago.html';
  else if (requestedFile === '/resultado') requestedFile = 'resultado.html';
  else if (requestedFile === '/chat' || requestedFile === '/whatsapp' || requestedFile === '/simulador') requestedFile = 'chat.html';
  else if (requestedFile === '/envio') requestedFile = 'factura.html';
  else if (requestedFile.startsWith('/')) requestedFile = requestedFile.substring(1);

  let filePath = path.join(__dirname, 'public', requestedFile);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Página no encontrada: ' + pathname);
    } else {
      const ext = path.extname(filePath);
      let contentType = 'text/html; charset=utf-8';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.js') contentType = 'application/javascript';
      if (ext === '.json') contentType = 'application/json';
      if (ext === '.png') contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      if (ext === '.svg') contentType = 'image/svg+xml';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsedUrl.pathname.startsWith('/api/')) {
    return handleApi(req, res);
  }
  return handleStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`=======================================================`);
    console.log(`🚀 Sistema Unificado Skylink Pay (Valink Group) Iniciado:`);
    console.log(`🛒 Kiosco Autopago:        http://localhost:${PORT}/ (o /autopago)`);
    console.log(`📦 Admin Ventas WhatsApp:  http://localhost:${PORT}/admin`);
    console.log(`🤖 Agente Chat WhatsApp:   http://localhost:${PORT}/chat`);
    console.log(`🌐 Acceso en tu Red Local: http://${localIp}:${PORT}/`);
    console.log(`=======================================================`);
  });
}

module.exports = server;
