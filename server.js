const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const querystring = require('querystring');

const PORT = 3000;
const SPIDI_API_TOKEN = '86f736e7-5611-437b-8985-ec9c90381136';
const SPIDI_AGREEMENT_ID = 'agr_5a6f6f57ab8d4afc';
const SPIDI_BASE_URL = 'https://sim.mispidi.com';

// Almacén en memoria de sesiones y pedidos por chat
const sessions = new Map();
let latestSession = null;

function getLocalIp() {
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
  return 'localhost';
}

function fetchSpidi(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SPIDI_BASE_URL);
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${SPIDI_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = require('https').request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API: Crear Sesión de Pago (Kiosco)
  if (pathname === '/api/create-payment' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const amount = payload.amount || 5;
        const description = payload.description || 'Autopago Kiosco';
        const items = payload.items || [];
        const identifier = 'AUTO-' + Math.floor(1000 + Math.random() * 9000);

        const localIp = getLocalIp();
        const host = `${localIp}:${PORT}`;
        const successUrl = `http://${host}/resultado.html?ref=${identifier}&status=success`;
        const failureUrl = `http://${host}/resultado.html?ref=${identifier}&status=failed`;

        const spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/buttons', 'POST', {
          agreement_id: SPIDI_AGREEMENT_ID,
          amount_reference: Number(amount),
          currency_reference: 'USD',
          identifier_label: 'Ticket',
          identifier: identifier,
          description: description,
          success_url: successUrl,
          failure_url: failureUrl,
          duration_minutes: 20
        });

        if (spidiRes.data && spidiRes.data.success && spidiRes.data.data) {
          const sessionData = {
            identifier: identifier,
            sessionId: spidiRes.data.data.session_id,
            amount: Number(amount),
            description: description,
            items: items,
            payment_url: spidiRes.data.data.payment_url,
            payment_qr: spidiRes.data.data.payment_qr,
            createdAt: new Date().toISOString()
          };
          sessions.set(identifier, sessionData);
          sessions.set(sessionData.sessionId, sessionData);
          latestSession = sessionData;
        }

        res.writeHead(spidiRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spidiRes.data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Crear Cobro desde Chat / Mensaje Directo (MD)
  if (pathname === '/api/chat/create-payment' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const amount = Number(payload.amount || 5);
        const description = payload.description || 'Pedido por Chat MD';
        const items = payload.items || [];
        const clientName = payload.client_name || payload.clientName || 'Cliente Chat';
        const sessionType = payload.session_type || 'button'; // 'button' (rápido) o 'request' (solicitud extendida)
        const identifier = 'MD-' + Math.floor(1000 + Math.random() * 9000);

        const localIp = getLocalIp();
        const host = `${localIp}:${PORT}`;
        const successUrl = `http://${host}/resultado.html?ref=${identifier}&status=success`;
        const failureUrl = `http://${host}/resultado.html?ref=${identifier}&status=failed`;

        let spidiRes;

        if (sessionType === 'request') {
          // Solicitud en lote (para WhatsApp / MD con vigencia extendida)
          const dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
          spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/request/batch', 'POST', {
            continue_on_error: true,
            items: [{
              title: `Orden Chat ${identifier}`,
              currency_reference: 'USD',
              amount_reference: amount,
              agreement_id: SPIDI_AGREEMENT_ID,
              identifier_label: 'Chat MD',
              identifier: identifier,
              description: description,
              due_date_session: dueDate,
              due_date_reached_behavior: 'keep_active',
              late_notice_message: 'Tu enlace de pago está por vencer',
              internal_reference: 'REF-' + identifier,
              success_url: successUrl,
              failure_url: failureUrl
            }]
          });

          if (spidiRes.data && spidiRes.data.success && spidiRes.data.data && spidiRes.data.data.items && spidiRes.data.data.items[0]) {
            const item = spidiRes.data.data.items[0];
            const sessionData = {
              identifier: identifier,
              sessionId: item.session_id,
              amount: amount,
              description: description,
              items: items,
              clientName: clientName,
              payment_url: item.payment_url,
              payment_qr: null,
              sessionOrigin: 'request',
              createdAt: new Date().toISOString()
            };
            sessions.set(identifier, sessionData);
            sessions.set(item.session_id, sessionData);
            latestSession = sessionData;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, data: sessionData }));
          }
        } else {
          // Botón estándar (checkout rápido con código QR directo)
          spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/buttons', 'POST', {
            agreement_id: SPIDI_AGREEMENT_ID,
            amount_reference: amount,
            currency_reference: 'USD',
            identifier_label: 'Chat MD',
            identifier: identifier,
            description: description,
            success_url: successUrl,
            failure_url: failureUrl,
            duration_minutes: 20
          });

          if (spidiRes.data && spidiRes.data.success && spidiRes.data.data) {
            const sessionData = {
              identifier: identifier,
              sessionId: spidiRes.data.data.session_id,
              amount: amount,
              description: description,
              items: items,
              clientName: clientName,
              payment_url: spidiRes.data.data.payment_url,
              payment_qr: spidiRes.data.data.payment_qr,
              sessionOrigin: 'button',
              createdAt: new Date().toISOString()
            };
            sessions.set(identifier, sessionData);
            sessions.set(sessionData.sessionId, sessionData);
            latestSession = sessionData;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, data: sessionData }));
          }
        }

        res.writeHead(spidiRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spidiRes.data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Simular pago de prueba desde el Chat en 1 clic
  if (pathname === '/api/chat/simulate-pay' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const sessionId = payload.sessionId || payload.session_id;
        const otp = payload.otp || '000000'; // 000000 (ok), 111111 (sin saldo), 222222 (clave errada)
        const metodo = payload.metodo || 'mobile_payment';

        const stored = sessions.get(sessionId);
        if (!stored) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Sesión no encontrada' }));
        }

        const payData = querystring.stringify({
          metodo: metodo,
          nombre: payload.nombre || stored.clientName || 'Cliente Chat',
          tipo: 'V',
          cedula: '12345678',
          telefono: '04121234567',
          banco: '0102',
          concepto: stored.description || 'Pago por Chat MD',
          otp: otp,
          acreditacion: 'accredited'
        });

        const payReq = require('https').request(stored.payment_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payData)
          }
        }, async (payRes) => {
          // Consultar estado de inmediato y devolver
          const spidiRes = await fetchSpidi(`/api/v1/ext/payment-sessions/status/${stored.sessionId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(spidiRes.data));
        });

        payReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });

        payReq.write(payData);
        payReq.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Reintentar Pago (crea nueva sesión para el mismo carrito)
  if (pathname === '/api/retry-payment' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const ref = payload.ref || payload.identifier;
        const sessionId = payload.sessionId || payload.session_id;

        const prevSession = sessions.get(ref) || sessions.get(sessionId) || latestSession;
        if (!prevSession) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Sesión anterior no encontrada.' }));
        }

        const prefix = prevSession.identifier && prevSession.identifier.startsWith('MD-') ? 'MD-' : 'AUTO-';
        const identifier = prefix + Math.floor(1000 + Math.random() * 9000);
        const localIp = getLocalIp();
        const host = `${localIp}:${PORT}`;
        const successUrl = `http://${host}/resultado.html?ref=${identifier}&status=success`;
        const failureUrl = `http://${host}/resultado.html?ref=${identifier}&status=failed`;

        const spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/buttons', 'POST', {
          agreement_id: SPIDI_AGREEMENT_ID,
          amount_reference: prevSession.amount,
          currency_reference: 'USD',
          identifier_label: prefix === 'MD-' ? 'Chat MD' : 'Ticket',
          identifier: identifier,
          description: prevSession.description,
          success_url: successUrl,
          failure_url: failureUrl,
          duration_minutes: 20
        });

        if (spidiRes.data && spidiRes.data.success && spidiRes.data.data) {
          const newSessionData = {
            identifier: identifier,
            sessionId: spidiRes.data.data.session_id,
            amount: prevSession.amount,
            description: prevSession.description,
            items: prevSession.items,
            clientName: prevSession.clientName,
            payment_url: spidiRes.data.data.payment_url,
            payment_qr: spidiRes.data.data.payment_qr,
            createdAt: new Date().toISOString()
          };
          sessions.set(identifier, newSessionData);
          sessions.set(newSessionData.sessionId, newSessionData);
          latestSession = newSessionData;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, data: newSessionData }));
        }

        res.writeHead(spidiRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spidiRes.data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Consultar Estado por Session ID
  if (pathname.startsWith('/api/check-status/') && req.method === 'GET') {
    const sessionId = pathname.split('/api/check-status/')[1];
    try {
      const spidiRes = await fetchSpidi(`/api/v1/ext/payment-sessions/status/${sessionId}`);
      const stored = sessions.get(sessionId);
      if (spidiRes.data && spidiRes.data.data && stored) {
        spidiRes.data.data.items = stored.items;
        spidiRes.data.data.client_name = stored.clientName;
      }
      res.writeHead(spidiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(spidiRes.data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Consultar Info/Estado por Ref o Session ID
  if (pathname === '/api/session-info' && req.method === 'GET') {
    const ref = parsedUrl.searchParams.get('ref');
    const sessionId = parsedUrl.searchParams.get('session_id') || parsedUrl.searchParams.get('sessionId');

    const stored = sessions.get(ref) || sessions.get(sessionId) || latestSession;
    if (!stored) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Sesión no encontrada' }));
    }

    try {
      const spidiRes = await fetchSpidi(`/api/v1/ext/payment-sessions/status/${stored.sessionId}`);
      const resultData = {
        ...(spidiRes.data ? spidiRes.data.data : {}),
        stored_session: stored,
        items: stored.items,
        identifier: stored.identifier,
        client_name: stored.clientName
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: resultData }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { status: 'unknown', stored_session: stored } }));
    }
    return;
  }

  // API: Consultar la última sesión activa
  if (pathname === '/api/latest-session' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, data: latestSession }));
  }

  // API: Listar historial de sesiones
  if (pathname === '/api/sessions-history' && req.method === 'GET') {
    const list = Array.from(new Set(sessions.values())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, data: list.slice(0, 20) }));
  }

  // Servidor de Archivos Estáticos
  let requestedFile = pathname;
  if (requestedFile === '/' || requestedFile === '') requestedFile = 'index.html';
  else if (requestedFile === '/chat') requestedFile = 'chat.html';
  else if (requestedFile === '/resultado') requestedFile = 'resultado.html';
  else if (requestedFile.startsWith('/')) requestedFile = requestedFile.substring(1);

  let filePath = path.join(__dirname, 'public', requestedFile);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
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

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`🚀 Servidor de Autopago SPIDI iniciado:`);
  console.log(`👉 Kiosco en PC:   http://localhost:${PORT}`);
  console.log(`👉 Chat MD en PC:  http://localhost:${PORT}/chat`);
  console.log(`👉 En tu celular:  http://${localIp}:${PORT}/chat`);
});
