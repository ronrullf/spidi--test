const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const skylink = require('../lib/skylink');

const products = [
  { id: 'galletas', name: 'Galletas de avena', description: 'Crujientes, sencillas y listas para compartir.', amount: 2200, icon: '🍪', color: 'sand' },
  { id: 'cafe', name: 'Café de la casa', description: 'Una pausa con aroma a café recién hecho.', amount: 3000, icon: '☕', color: 'pink' },
  { id: 'granola', name: 'Granola artesanal', description: 'Avena tostada para empezar bien el día.', amount: 4500, icon: '🥣', color: 'green' },
  { id: 'combo', name: 'Combo merienda', description: 'Café y galletas: una buena combinación.', amount: 6000, icon: '🥐', color: 'peach' }
];
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

function createServer(client = skylink) {
  // One API operation per attempt, including simultaneous double-clicks.
  // Memory lasts only for this process; this is a local integration test store.
  const attempts = new Map();
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/products') return json(res, 200, { products });
      if (req.method === 'POST' && pathname === '/api/payment') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { message: 'Origen no permitido.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { message: 'Envía JSON.' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096) return json(res, 413, { message: 'Solicitud demasiado grande.' });
        }
        let input;
        try { input = JSON.parse(raw); } catch { return json(res, 400, { message: 'JSON inválido.' }); }
        const product = products.find(item => item.id === input?.productId);
        if (!product || !/^[a-f0-9-]{36}$/i.test(input?.attemptId || '')) return json(res, 400, { message: 'Selecciona un producto e inicia una prueba válida.' });
        const previous = attempts.get(input.attemptId);
        if (previous && previous.productId !== product.id) return json(res, 409, { message: 'Este intento pertenece a otro producto.' });
        if (!previous) {
          if (attempts.size >= 1000) return json(res, 429, { message: 'Se alcanzó el límite local de pruebas. Revisa los pedidos antes de reiniciar.' });
          const promise = (async () => {
            const reference = `TIENDA-${crypto.randomUUID()}`;
            const payload = { buyOrder: reference, sessionId: `SES-${crypto.randomUUID()}`, amount: product.amount, currency: 'VES', installments: 1 };
            const result = await client.request('/api/v1/merchant/transactions', 'POST', payload);
            const diagnostics = { order: reference, amountBs: product.amount / 100, httpStatus: result.status, serverDate: result.serverDate || null, request: payload };
            try {
              const payment = client.paymentFromResponse(result);
              return { status: 201, body: { success: true, url: payment.skylinkPayUrl, message: 'Tu enlace está listo. La orden todavía no está pagada.', diagnostics } };
            } catch (error) {
              const secret = process.env.SKYLINK_API_KEY;
              let message = String(result.data?.message || result.error || error.message);
              if (secret) message = message.split(secret).join('[oculto]');
              return { status: error.httpStatus || 502, body: { success: false, message, code: error.code || 'SKYLINK_ERROR', diagnostics } };
            }
          })().catch(() => ({ status: 502, body: { success: false, message: 'No se pudo confirmar la creación. Revisa el panel de Skylink antes de iniciar otro intento.' } }));
          attempts.set(input.attemptId, { productId: product.id, promise });
        }
        const result = await attempts.get(input.attemptId).promise;
        return json(res, result.status, result.body);
      }
      if (req.method === 'GET' && files[pathname]) {
        const [file, type] = files[pathname];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(path.join(__dirname, file)));
      }
      json(res, 404, { message: 'No encontrado.' });
    } catch { json(res, 500, { success: false, message: 'No se pudo procesar la solicitud.' }); }
  });
}

if (require.main === module) {
  const port = Number(process.env.TIENDA_PORT || 3002);
  createServer().listen(port, '127.0.0.1', () => console.log(`Min tienda: http://localhost:${port}`));
}
module.exports = { createServer, products };
