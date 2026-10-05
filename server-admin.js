const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const querystring = require('querystring');

const PORT = 3001;
const SPIDI_API_TOKEN = '86f736e7-5611-437b-8985-ec9c90381136';
const SPIDI_AGREEMENT_ID = 'agr_5a6f6f57ab8d4afc';
const SPIDI_BASE_URL = 'https://sim.mispidi.com';

// Tasa oficial referencial BCV (Bolívares por Dólar)
let bcvRate = 37.50;

// Configuración de la tienda
let storeSettings = {
  storeName: 'Mi Tienda C.A.',
  storeRif: 'J-50733628-0',
  storePhone: '584121234567'
};

// Almacén en memoria de órdenes y datos de envío
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

  // API 1: Consultar o Modificar Tasa BCV
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

  // API: Configuración de la Tienda
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

  // API 2: Crear Link de Pago desde el Admin
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
        const sessionType = payload.session_type || 'button'; // button (recomendado para redirección limpia)

        const orderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
        const localIp = getLocalIp();
        const host = `${localIp}:${PORT}`;

        // Redirecciones post-pago hacia la Factura con formulario MRW y WhatsApp (puerto 3001)
        const successUrl = `http://${host}/factura.html?order_id=${orderId}`;
        const failureUrl = `http://${host}/error-pago.html?order_id=${orderId}`;

        // Enlace de verificación previa al pago (Checkout Subpágina para el cliente)
        const checkoutUrl = `http://${host}/checkout.html?order_id=${orderId}`;
        const amountVes = Number((amount * bcvRate).toFixed(2));

        let spidiRes;
        let sessionId = '';
        let paymentUrl = '';
        let paymentQr = null;

        if (sessionType === 'request') {
          // Solicitud en Lote (7 días)
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
          // Botón estándar (20 minutos con QR y redirección inmediata en fallo y éxito)
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

  // API 3: Consultar Estado y Detalle de la Orden
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

  // API 4: Guardar Datos de Envío MRW / Courier
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

  // API 5: Reintentar Orden Fallida
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
        const localIp = getLocalIp();
        const host = `${localIp}:${PORT}`;
        const successUrl = `http://${host}/factura.html?order_id=${newOrderId}`;
        const failureUrl = `http://${host}/error-pago.html?order_id=${newOrderId}`;
        const checkoutUrl = `http://${host}/checkout.html?order_id=${newOrderId}`;
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

  // API 6: Listar Todas las Órdenes
  if (pathname === '/api/orders' && req.method === 'GET') {
    const list = Array.from(new Set(orders.values())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, data: list.slice(0, 30) }));
  }

  // Servidor de Archivos Estáticos de public-admin
  let requestedFile = pathname;
  if (requestedFile === '/' || requestedFile === '') requestedFile = 'index.html';
  else if (requestedFile === '/checkout') requestedFile = 'checkout.html';
  else if (requestedFile === '/envio' || requestedFile === '/envio.html') requestedFile = 'factura.html';
  else if (requestedFile === '/factura') requestedFile = 'factura.html';
  else if (requestedFile === '/error-pago') requestedFile = 'error-pago.html';
  else if (requestedFile.startsWith('/')) requestedFile = requestedFile.substring(1);

  let filePath = path.join(__dirname, 'public-admin', requestedFile);

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

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`📦 Panel Administrativo de Ventas SPIDI iniciado:`);
  console.log(`👉 Panel Admin en PC:   http://localhost:${PORT}`);
  console.log(`👉 Enlace en tu red:    http://${localIp}:${PORT}`);
});
