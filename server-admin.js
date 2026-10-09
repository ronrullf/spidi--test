const http = require('http');
const fs = require('fs');
const path = require('path');
const handleApi = require('./api/index.js');
const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) return handleApi(req, res);
  // Servidor de Archivos Estáticos de public-admin
  let requestedFile = pathname;
  if (requestedFile === '/' || requestedFile === '') requestedFile = 'index.html';
  else if (requestedFile === '/checkout') requestedFile = 'checkout.html';
  else if (requestedFile === '/envio' || requestedFile === '/envio.html') requestedFile = 'factura.html';
  else if (requestedFile === '/factura') requestedFile = 'factura.html';
  else if (requestedFile === '/error-pago') requestedFile = 'error-pago.html';
  else if (requestedFile.startsWith('/')) requestedFile = requestedFile.substring(1);

  // Both entry points use the same current screens and styling.
  const sharedFiles = {
    '/': 'admin.html', '/index.html': 'admin.html', '/admin': 'admin.html',
    '/autopago': 'autopago.html', '/kiosco': 'autopago.html',
    '/chat': 'chat.html', '/pay-ui.css': 'pay-ui.css', '/zxing.min.js': 'zxing.min.js'
  };
  let filePath = sharedFiles[pathname]
    ? path.join(__dirname, 'public', sharedFiles[pathname])
    : path.join(__dirname, 'public-admin', requestedFile);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Página no encontrada en Admin');
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
});

server.listen(PORT, '0.0.0.0', () => console.log(`Panel Skylink: http://localhost:${PORT}`));
