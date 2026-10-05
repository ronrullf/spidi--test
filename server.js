const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const SPIDI_API_TOKEN = process.env.SPIDI_API_TOKEN || '86f736e7-5611-437b-8985-ec9c90381136';
const SPIDI_AGREEMENT_ID = process.env.SPIDI_AGREEMENT_ID || 'agr_5a6f6f57ab8d4afc';
const SPIDI_BASE_URL = process.env.SPIDI_BASE_URL || 'https://sim.mispidi.com';

// Tasa oficial referencial BCV (Bolívares por Dólar)
let bcvRate = 37.50;

// Configuración de la tienda
let storeSettings = {
  storeName: 'Mi Tienda C.A.',
  storeRif: 'J-50733628-0',
  storePhone: '584121234567'
};

// Almacén en memoria de sesiones (Kiosco) y órdenes (Admin WhatsApp)
const sessions = new Map();
let latestSession = null;
const orders = new Map();

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

function getBaseUrl(req) {
  // Detecta el host y protocolo de Vercel (o proxies inversos)
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }

  // Si viene con encabezado host de un dominio público
  const host = req.headers.host;
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const proto = (req.connection && req.connection.encrypted) ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  // Entorno local por defecto
  const localIp = getLocalIp();
  return `http://${localIp}:${PORT}`;
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

// Enrutador Principal Unificado (Kiosco + Admin + APIs)
async function handleRequest(req, res) {
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
  const baseUrl = getBaseUrl(req);

  // ==========================================
  // 1. APIS COMPARTIDAS (BCV Y TIENDA)
  // ==========================================
  if (pathname === '/api/bcv-rate' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, rate: bcvRate }));
  }
  if (pathname === '/api/bcv-rate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.rate) bcvRate = Number(payload.rate);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, rate: bcvRate }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/store-settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, data: storeSettings }));
  }
  if (pathname === '/api/store-settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.storePhone) storeSettings.storePhone = payload.storePhone;
        if (payload.storeName) storeSettings.storeName = payload.storeName;
        if (payload.storeRif) storeSettings.storeRif = payload.storeRif;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: storeSettings }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ==========================================
  // 2. APIS DEL KIOSCO AUTOPAGO
  // ==========================================
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

        const successUrl = `${baseUrl}/resultado.html?ref=${identifier}&status=success`;
        const failureUrl = `${baseUrl}/resultado.html?ref=${identifier}&status=failed`;

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
        const successUrl = `${baseUrl}/resultado.html?ref=${identifier}&status=success`;
        const failureUrl = `${baseUrl}/resultado.html?ref=${identifier}&status=failed`;

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

  if (pathname === '/api/simulate-pay' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const sessionId = payload.sessionId || payload.session_id;
        const stored = sessions.get(sessionId);
        if (!stored) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Sesión no encontrada' }));
        }

        const payData = querystring.stringify({
          metodo: payload.metodo || 'mobile_payment',
          nombre: payload.nombre || stored.clientName || 'Cliente Autopago',
          tipo: 'V',
          cedula: payload.cedula || '12345678',
          telefono: payload.telefono || '04121234567',
          banco: payload.banco || '0102',
          concepto: stored.description || 'Autopago SPIDI',
          otp: payload.otp || '000000',
          acreditacion: 'accredited'
        });

        const payReq = require('https').request(stored.payment_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payData)
          }
        }, async (payRes) => {
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

  // ==========================================
  // 3. APIS DEL ADMIN (WHATSAPP, CHECKOUT, FACTURA & MRW)
  // ==========================================
  if (pathname === '/api/create-order-link' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const amount = Number(payload.amount || 1);
        const description = payload.description || 'Orden de Compra';
        const items = payload.items || [];
        const clientName = payload.client_name || payload.clientName || 'Cliente';
        const clientPhone = payload.client_phone || payload.clientPhone || '';
        const sessionType = payload.session_type || 'button';

        const orderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);

        // Rutas directas adaptadas al dominio actual (Vercel o Localhost)
        const successUrl = `${baseUrl}/factura.html?order_id=${orderId}`;
        const failureUrl = `${baseUrl}/error-pago.html?order_id=${orderId}`;
        const checkoutUrl = `${baseUrl}/checkout.html?order_id=${orderId}`;
        const amountVes = Number((amount * bcvRate).toFixed(2));

        let spidiRes;
        let sessionId = '';
        let paymentUrl = '';
        let paymentQr = null;

        if (sessionType === 'request') {
          const dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
          spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/request/batch', 'POST', {
            continue_on_error: true,
            items: [{
              title: `Pedido ${orderId} - ${clientName}`,
              currency_reference: 'USD',
              amount_reference: amount,
              agreement_id: SPIDI_AGREEMENT_ID,
              identifier_label: 'Orden',
              identifier: orderId,
              description: description,
              due_date_session: dueDate,
              due_date_reached_behavior: 'keep_active',
              late_notice_message: 'Tu enlace de pago está por vencer',
              internal_reference: orderId,
              success_url: successUrl,
              failure_url: failureUrl
            }]
          });

          if (spidiRes.data && spidiRes.data.success && spidiRes.data.data && spidiRes.data.data.items && spidiRes.data.data.items[0]) {
            const item = spidiRes.data.data.items[0];
            sessionId = item.session_id;
            paymentUrl = item.payment_url;
          } else {
            throw new Error((spidiRes.data && spidiRes.data.message) || 'Error al crear solicitud en SPIDI');
          }
        } else {
          spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/buttons', 'POST', {
            agreement_id: SPIDI_AGREEMENT_ID,
            amount_reference: amount,
            currency_reference: 'USD',
            identifier_label: 'Orden',
            identifier: orderId,
            description: description,
            success_url: successUrl,
            failure_url: failureUrl,
            duration_minutes: 20
          });

          if (spidiRes.data && spidiRes.data.success && spidiRes.data.data) {
            sessionId = spidiRes.data.data.session_id;
            paymentUrl = spidiRes.data.data.payment_url;
            paymentQr = spidiRes.data.data.payment_qr;
          } else {
            throw new Error((spidiRes.data && spidiRes.data.message) || 'Error al crear botón en SPIDI');
          }
        }

        const orderData = {
          orderId,
          sessionId,
          amount,
          amountVes,
          bcvRate,
          checkoutUrl,
          description,
          items,
          clientName,
          clientPhone,
          storePhone: payload.store_phone || payload.storePhone || storeSettings.storePhone,
          storeName: storeSettings.storeName,
          storeRif: storeSettings.storeRif,
          sessionType,
          paymentUrl,
          paymentQr,
          status: 'pending',
          shippingData: null,
          createdAt: new Date().toISOString()
        };

        orders.set(orderId, orderData);
        orders.set(sessionId, orderData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: orderData }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/order-status/') && req.method === 'GET') {
    const id = pathname.split('/api/order-status/')[1];
    const order = orders.get(id);

    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Orden no encontrada' }));
    }

    try {
      const spidiRes = await fetchSpidi(`/api/v1/ext/payment-sessions/status/${order.sessionId}`);
      const spidiData = (spidiRes.data && spidiRes.data.data) || {};

      if (spidiData.status) {
        order.status = spidiData.status;
      }

      const responsePayload = {
        ...order,
        spidi_status: spidiData.status,
        session_payment: spidiData.session_payment || null
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: responsePayload }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: order }));
    }
    return;
  }

  if (pathname === '/api/save-shipping' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const orderId = payload.order_id || payload.orderId;
        const sessionId = payload.session_id || payload.sessionId;

        const order = orders.get(orderId) || orders.get(sessionId);
        if (!order) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Orden no encontrada para asociar envío.' }));
        }

        const guideNumber = 'MRW-' + Math.floor(100000 + Math.random() * 900000);
        const shippingInfo = {
          guideNumber: guideNumber,
          courier: payload.courier || 'MRW',
          recipientName: payload.recipient_name || order.clientName,
          recipientId: payload.recipient_id || 'V-12345678',
          recipientPhone: payload.recipient_phone || order.clientPhone,
          state: payload.state || 'Distrito Capital',
          city: payload.city || 'Caracas',
          agencyAddress: payload.agency_address || 'Agencia MRW Principal',
          deliveryType: payload.delivery_type || 'Retiro en Agencia',
          notes: payload.notes || '',
          registeredAt: new Date().toISOString()
        };

        order.shippingData = shippingInfo;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: shippingInfo }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/retry-order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const id = payload.order_id || payload.orderId || payload.session_id;
        const prevOrder = orders.get(id);

        if (!prevOrder) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Orden anterior no encontrada' }));
        }

        const newOrderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
        const successUrl = `${baseUrl}/factura.html?order_id=${newOrderId}`;
        const failureUrl = `${baseUrl}/error-pago.html?order_id=${newOrderId}`;
        const checkoutUrl = `${baseUrl}/checkout.html?order_id=${newOrderId}`;
        const amountVes = Number((prevOrder.amount * bcvRate).toFixed(2));

        const spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/buttons', 'POST', {
          agreement_id: SPIDI_AGREEMENT_ID,
          amount_reference: prevOrder.amount,
          currency_reference: 'USD',
          identifier_label: 'Orden',
          identifier: newOrderId,
          description: prevOrder.description,
          success_url: successUrl,
          failure_url: failureUrl,
          duration_minutes: 20
        });

        if (spidiRes.data && spidiRes.data.success && spidiRes.data.data) {
          const newOrderData = {
            orderId: newOrderId,
            sessionId: spidiRes.data.data.session_id,
            amount: prevOrder.amount,
            amountVes,
            bcvRate,
            checkoutUrl,
            description: prevOrder.description,
            items: prevOrder.items,
            clientName: prevOrder.clientName,
            clientPhone: prevOrder.clientPhone,
            storePhone: prevOrder.storePhone || storeSettings.storePhone,
            storeName: prevOrder.storeName || storeSettings.storeName,
            storeRif: prevOrder.storeRif || storeSettings.storeRif,
            sessionType: 'button',
            paymentUrl: spidiRes.data.data.payment_url,
            paymentQr: spidiRes.data.data.payment_qr,
            status: 'pending',
            shippingData: null,
            createdAt: new Date().toISOString()
          };

          orders.set(newOrderId, newOrderData);
          orders.set(newOrderData.sessionId, newOrderData);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, data: newOrderData }));
        }

        res.writeHead(spidiRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spidiRes.data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/orders' && req.method === 'GET') {
    const list = Array.from(new Set(orders.values())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, data: list.slice(0, 30) }));
  }

  // ==========================================
  // 4. SERVIDOR DE ARCHIVOS ESTÁTICOS & RUTAS LIMPIAS
  // ==========================================
  let requestedFile = pathname;
  if (requestedFile === '/' || requestedFile === '') requestedFile = 'index.html';
  else if (requestedFile === '/autopago' || requestedFile === '/kiosco') requestedFile = 'autopago.html';
  else if (requestedFile === '/admin') requestedFile = 'admin.html';
  else if (requestedFile === '/checkout') requestedFile = 'checkout.html';
  else if (requestedFile === '/factura') requestedFile = 'factura.html';
  else if (requestedFile === '/error-pago') requestedFile = 'error-pago.html';
  else if (requestedFile === '/resultado') requestedFile = 'resultado.html';
  else if (requestedFile === '/chat') requestedFile = 'chat.html';
  else if (requestedFile === '/envio') requestedFile = 'factura.html';
  else if (requestedFile.startsWith('/')) requestedFile = requestedFile.substring(1);

  let publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir) && fs.existsSync(path.join(__dirname, '..', 'public'))) {
    publicDir = path.join(__dirname, '..', 'public');
  }

  let filePath = path.join(publicDir, requestedFile);

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

// Iniciar servidor local si se ejecuta directamente con Node.js
if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`=======================================================`);
    console.log(`🚀 Sistema Unificado SPIDI Iniciado con éxito:`);
    console.log(`🛒 Kiosco Autopago:        http://localhost:${PORT}/ (o /autopago)`);
    console.log(`📦 Admin Ventas WhatsApp:  http://localhost:${PORT}/admin`);
    console.log(`🌐 Acceso en tu Red Local: http://${localIp}:${PORT}/`);
    console.log(`⚡ Listo para Vercel:      vercel.json & api/index.js configurados`);
    console.log(`=======================================================`);
  });
}

module.exports = { handleRequest };
