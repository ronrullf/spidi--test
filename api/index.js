const os = require('os');
const crypto = require('crypto');
const querystring = require('querystring');
const https = require('https');
const http = require('http');
const { request: fetchSkylinkPay, paymentFromResponse } = require('../lib/skylink');

// Configuración Oficial Skylink Pay (Valink Group)
const SKYLINK_BASE_URL = process.env.SKYLINK_BASE_URL || 'https://dev-axis-payment.valinkgroup.com';
const SKYLINK_COMMERCE_CODE = process.env.SKYLINK_COMMERCE_CODE || '754947900700';

// Tasa oficial referencial BCV (Bolívares por Dólar)
let bcvRate = 37.50;

// Configuración de la tienda y webhooks
let storeSettings = {
  storeName: 'Mi Tienda C.A.',
  storeRif: 'J-50733628-0',
  storePhone: '584121234567',
  skylinkCommerceCode: SKYLINK_COMMERCE_CODE,
  skylinkBaseUrl: SKYLINK_BASE_URL,
  webhookSecret: 'skypay_secret_' + crypto.randomBytes(8).toString('hex'),
  webhookUrl: '' // URL externa a donde notificar pagos aprobados
};

// Almacén en memoria de órdenes, transacciones y webhooks
const sessions = new Map();
let latestSession = null;
const orders = new Map();
const webhookLogs = [];

// Catálogo de productos oficial (Todos en el rango de 20 a 25 Bs)
let CATALOGO_PRODUCTOS = [
  { id: 1, name: "Harina PAN 1kg", code: "7591001", priceBs: 25.00, category: "Víveres", icon: "🌽", keywords: ["harina pan", "harina", "pan"] },
  { id: 2, name: "Café Molido 100g", code: "7591002", priceBs: 24.50, category: "Bebidas", icon: "☕", keywords: ["cafe", "café", "molido"] },
  { id: 3, name: "Arroz Blanco 1kg", code: "7591473005492", priceBs: 23.50, category: "Víveres", icon: "🍚", keywords: ["arroz blanco", "arroz"] },
  { id: 4, name: "Pasta Spaghetti 500g", code: "7591003", priceBs: 21.00, category: "Víveres", icon: "🍝", keywords: ["pasta", "spaghetti", "fideos"] },
  { id: 5, name: "Azúcar Refinada 1kg", code: "7591005", priceBs: 22.00, category: "Víveres", icon: "🧂", keywords: ["azucar", "azúcar"] },
  { id: 6, name: "Aceite Vegetal 500ml", code: "7591006", priceBs: 25.00, category: "Víveres", icon: "🍳", keywords: ["aceite vegetal", "aceite"] },
  { id: 7, name: "Margarina con Sal 250g", code: "7591007", priceBs: 23.00, category: "Lácteos", icon: "🧈", keywords: ["margarina", "mavesa", "mantequilla"] },
  { id: 8, name: "Leche en Polvo 125g", code: "7591008", priceBs: 24.00, category: "Lácteos", icon: "🥛", keywords: ["leche", "leche en polvo"] },
  { id: 9, name: "Galletas de Vainilla 150g", code: "7591009", priceBs: 21.50, category: "Snacks", icon: "🍪", keywords: ["galletas", "maria", "vainilla"] },
  { id: 10, name: "Salsa de Tomate 397g", code: "7591010", priceBs: 22.50, category: "Salsas", icon: "🍅", keywords: ["salsa de tomate", "ketchup"] },
  { id: 11, name: "Mayonesa Tradicional 175g", code: "7591011", priceBs: 24.00, category: "Salsas", icon: "🥣", keywords: ["mayonesa", "mavesa"] },
  { id: 12, name: "Refresco Lata 355ml", code: "7591012", priceBs: 20.00, category: "Bebidas", icon: "🥤", keywords: ["refresco", "soda", "lata"] },
  { id: 13, name: "Atún en Aceite 140g", code: "7591013", priceBs: 25.00, category: "Víveres", icon: "🐟", keywords: ["atun", "atún"] },
  { id: 14, name: "Caraotas Negras 500g", code: "7591014", priceBs: 22.00, category: "Víveres", icon: "🫘", keywords: ["caraotas", "frijoles"] }
];

// Helper para calcular precio USD en base a Bs
function getProductPriceUsd(priceBs) {
  return Number((priceBs / bcvRate).toFixed(2));
}

// Helper para convertir monto en Bs a céntimos enteros (Skylink Pay)
function toCentimos(amountBs) {
  const value = Math.round(Number(amountBs) * 100);
  if (!Number.isSafeInteger(value) || value <= 0) {
    const error = new Error('El monto debe ser positivo y expresarse en céntimos válidos.');
    error.httpStatus = 400;
    throw error;
  }
  return value;
}

// Despacho de Webhook saliente cuando se confirma un pago
async function dispatchOutboundWebhook(event, data) {
  if (!storeSettings.webhookUrl) return;
  try {
    const payload = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data
    });

    const parsed = new URL(storeSettings.webhookUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const signature = crypto.createHmac('sha256', storeSettings.webhookSecret)
      .update(payload)
      .digest('hex');

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-SkyPay-Signature': signature,
        'X-SkyPay-Event': event
      },
      timeout: 6000
    };

    const req = client.request(parsed, options, (res) => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => {
        webhookLogs.unshift({
          type: 'outbound',
          url: storeSettings.webhookUrl,
          event,
          statusCode: res.statusCode,
          timestamp: new Date().toISOString(),
          success: res.statusCode >= 200 && res.statusCode < 300,
          response: resBody.slice(0, 300)
        });
      });
    });

    req.on('error', (err) => {
      webhookLogs.unshift({
        type: 'outbound',
        url: storeSettings.webhookUrl,
        event,
        statusCode: 500,
        timestamp: new Date().toISOString(),
        success: false,
        error: err.message
      });
    });

    req.write(payload);
    req.end();
  } catch (e) {}
}

function parseOrderFromMessage(text) {
  const normalized = (text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const foundItems = [];

  for (const prod of CATALOGO_PRODUCTOS) {
    let matched = false;
    for (const kw of prod.keywords) {
      if (normalized.includes(kw)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      let qty = 1;
      const kwPattern = prod.keywords.join('|');
      const matchBefore = normalized.match(new RegExp(`(\\d+)\\s*(?:kilos?|paquetes?|unidades?|kg)?\\s*(?:de\\s*)?(?:${kwPattern})`));
      const matchAfter = normalized.match(new RegExp(`(?:${kwPattern})\\s*(?:x\\s*)?(\\d+)`));
      if (matchBefore && matchBefore[1]) {
        qty = parseInt(matchBefore[1], 10);
      } else if (matchAfter && matchAfter[1]) {
        qty = parseInt(matchAfter[1], 10);
      } else if (normalized.includes('dos ' + prod.keywords[0]) || normalized.includes('2 ' + prod.keywords[0])) {
        qty = 2;
      } else if (normalized.includes('tres ' + prod.keywords[0]) || normalized.includes('3 ' + prod.keywords[0])) {
        qty = 3;
      }
      foundItems.push({
        id: prod.id,
        name: prod.name,
        code: prod.code,
        priceBs: prod.priceBs,
        price: getProductPriceUsd(prod.priceBs),
        qty: qty,
        icon: prod.icon
      });
    }
  }

  return foundItems;
}

function getRequestBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
      }
      return resolve(req.body || {});
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function handleApi(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Commerce-Code, X-Timestamp, X-Signature, X-Webhook-Secret');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;
    const routeParam = parsedUrl.searchParams.get('route');
    if (routeParam) {
      pathname = '/api/' + routeParam;
    }

    // ==========================================
    // 1. TASA OFICIAL BCV
    // ==========================================
    if (pathname === '/api/bcv-rate' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, rate: bcvRate, provider: 'BCV Oficial (Configurado)' }));
    }
    if (pathname === '/api/bcv-rate' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const rate = Number(payload.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'La tasa debe ser un número mayor a cero.' }));
      }
      bcvRate = rate;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, rate: bcvRate }));
    }

    // ==========================================
    // 2. CONFIGURACIÓN DE LA TIENDA
    // ==========================================
    if (pathname === '/api/store-settings' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: storeSettings }));
    }
    if (pathname === '/api/store-settings' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      if (payload.storePhone) storeSettings.storePhone = payload.storePhone;
      if (payload.storeName) storeSettings.storeName = payload.storeName;
      if (payload.storeRif) storeSettings.storeRif = payload.storeRif;
      if (payload.webhookUrl !== undefined) storeSettings.webhookUrl = payload.webhookUrl;
      if (payload.webhookSecret) storeSettings.webhookSecret = payload.webhookSecret;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: storeSettings }));
    }

    // ==========================================
    // 3. GESTIÓN DEL CATÁLOGO DE PRODUCTOS (20 - 25 Bs)
    // ==========================================
    if (pathname === '/api/products' && req.method === 'GET') {
      const formatted = CATALOGO_PRODUCTOS.map(p => ({
        ...p,
        priceUsd: getProductPriceUsd(p.priceBs),
        bcvRate
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: formatted, bcvRate }));
    }

    if (pathname === '/api/products' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const name = (payload.name || '').trim();
      const priceBs = Number(payload.priceBs || payload.price_bs || 25);
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'El nombre del producto es obligatorio.' }));
      }
      const newProduct = {
        id: Date.now(),
        name,
        code: payload.code || ('759' + Math.floor(1000 + Math.random() * 9000)),
        priceBs: Number(priceBs.toFixed(2)),
        category: payload.category || 'Víveres',
        icon: payload.icon || '📦',
        keywords: [name.toLowerCase()]
      };
      CATALOGO_PRODUCTOS.push(newProduct);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: newProduct }));
    }

    if (pathname.startsWith('/api/products/') && req.method === 'DELETE') {
      const id = parseInt(pathname.split('/api/products/')[1], 10);
      CATALOGO_PRODUCTOS = CATALOGO_PRODUCTOS.filter(p => p.id !== id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Producto eliminado correctamente.' }));
    }

    // ==========================================
    // 4. GENERADOR AUTOMÁTICO DE LINKS DE PAGO
    //    Permite insertar montos en Bolívares o USD
    // ==========================================
    if ((pathname === '/api/generate-link' || pathname === '/api/v1/links/generate' || pathname === '/api/create-order-link') && req.method === 'POST') {
      const payload = await getRequestBody(req);

      // Determinación del monto exacto en Bolívares
      let amountBs = 0;
      if (payload.amount_bs != null) {
        amountBs = Number(payload.amount_bs);
      } else if (payload.amountBs != null) {
        amountBs = Number(payload.amountBs);
      } else if (payload.amount != null) {
        // Si no se especifica si es Bs o USD, revisamos currency
        if (payload.currency === 'USD' || payload.currency === 'usd') {
          amountBs = Number((Number(payload.amount) * bcvRate).toFixed(2));
        } else if (payload.currency === 'VES' || payload.currency === 'ves') {
          amountBs = Number(payload.amount);
        } else {
          // Asumir USD si es menor a 15, de lo contrario Bs
          amountBs = Number(payload.amount) < 15 ? Number((Number(payload.amount) * bcvRate).toFixed(2)) : Number(payload.amount);
        }
      } else if (Array.isArray(payload.items) && payload.items.length > 0) {
        // Calcular sumatoria de items del catálogo
        amountBs = payload.items.reduce((sum, it) => {
          const prod = CATALOGO_PRODUCTOS.find(p => p.id === it.id);
          const itemPriceBs = prod ? prod.priceBs : (it.priceBs || (it.price ? it.price * bcvRate : 25));
          return sum + (itemPriceBs * (it.qty || it.quantity || 1));
        }, 0);
      }

      amountBs = Number(amountBs.toFixed(2));
      if (!Number.isFinite(amountBs) || amountBs <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Ingresa un monto válido mayor a 0 Bs.' }));
      }

      const amountCentimos = toCentimos(amountBs);
      const amountUsd = Number((amountBs / bcvRate).toFixed(2));
      const description = payload.description || payload.concept || 'Pago en línea con Skylink Pay';
      const clientName = payload.client_name || payload.clientName || 'Cliente';
      const clientPhone = payload.client_phone || payload.clientPhone || '';
      const orderId = 'LNK-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      const sessionId = 'SES-' + Date.now();

      // Llamada oficial y real a Skylink Pay API (Valink Group)
      const skylinkRes = await fetchSkylinkPay('/api/v1/merchant/transactions', 'POST', {
        buyOrder: orderId,
        sessionId: sessionId,
        amount: amountCentimos,
        currency: 'VES',
        installments: 1
      });

      const { token, skylinkPayUrl } = paymentFromResponse(skylinkRes);
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(skylinkPayUrl)}`;

      // Plantilla para compartir directo en WhatsApp
      let phoneClean = clientPhone.replace(/\D/g, '');
      if (phoneClean.startsWith('0')) phoneClean = '58' + phoneClean.slice(1);
      const waMsg = `¡Hola ${clientName}! 👋 Tu link de pago está listo:\n\n` +
        `📝 *Concepto:* ${description}\n` +
        `💵 *Monto:* Bs. ${amountBs.toFixed(2)} (≈ $${amountUsd.toFixed(2)} USD)\n\n` +
        `💳 *Paga aquí en Skylink Pay:* ${skylinkPayUrl}\n\n` +
        `_(Acepta Pago Móvil C2P y Débito Inmediato)_. Al confirmar tu pago coordinaremos de inmediato. 🚀`;
      const whatsappUrl = phoneClean
        ? `https://wa.me/${phoneClean}?text=${encodeURIComponent(waMsg)}`
        : `https://wa.me/?text=${encodeURIComponent(waMsg)}`;

      const orderData = {
        orderId,
        sessionId,
        token,
        amount: amountUsd,
        amountVes: amountBs,
        amountCentimos,
        bcvRate,
        description,
        clientName,
        clientPhone,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        qrCodeUrl,
        whatsappUrl,
        status: 'pending',
        shippingData: null,
        items: payload.items || [],
        source: payload.source || 'link_generator',
        createdAt: new Date().toISOString()
      };

      orders.set(orderId, orderData);
      orders.set(sessionId, orderData);
      orders.set(token, orderData);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        orderId,
        token,
        url: skylinkPayUrl,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        qrCodeUrl,
        whatsappUrl,
        amountBs,
        amountCentimos,
        amountUsd,
        bcvRate,
        description,
        data: orderData
      }));
    }

    // ==========================================
    // 5. WEBHOOKS DE APLICACIONES EXTERNAS
    //    Permite que otras apps creen pagos o notifiquen
    // ==========================================
    if (pathname === '/api/webhooks/incoming' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const authHeader = req.headers['x-webhook-secret'] || req.headers['authorization'] || '';

      // Registrar log del webhook entrante
      const logEntry = {
        id: 'WH-' + crypto.randomUUID().slice(0, 8),
        type: 'incoming',
        ip: req.socket.remoteAddress,
        headers: req.headers,
        body: payload,
        timestamp: new Date().toISOString(),
        success: true
      };

      // Si el webhook externo solicita crear un cobro automáticamente
      if (payload.action === 'create_payment_link' || payload.event === 'order.created') {
        const amountBs = Number(payload.amount_bs || payload.amountBs || (payload.amount ? Number(payload.amount) * bcvRate : 25));
        const amountCentimos = toCentimos(amountBs);
        const orderId = 'EXT-' + crypto.randomUUID().slice(0, 8).toUpperCase();
        const sessionId = 'SES-' + Date.now();

        const skylinkRes = await fetchSkylinkPay('/api/v1/merchant/transactions', 'POST', {
          buyOrder: orderId,
          sessionId: sessionId,
          amount: amountCentimos,
          currency: 'VES',
          installments: 1
        });

        const { token, skylinkPayUrl } = paymentFromResponse(skylinkRes);
        const orderData = {
          orderId,
          sessionId,
          token,
          amount: Number((amountBs / bcvRate).toFixed(2)),
          amountVes: amountBs,
          amountCentimos,
          bcvRate,
          description: payload.description || payload.concept || 'Cobro externo vía Webhook',
          clientName: payload.client_name || payload.customer_name || 'Cliente Externo',
          clientPhone: payload.client_phone || '',
          paymentUrl: skylinkPayUrl,
          skylinkUrl: skylinkPayUrl,
          status: 'pending',
          source: 'external_webhook',
          createdAt: new Date().toISOString()
        };

        orders.set(orderId, orderData);
        orders.set(token, orderData);

        logEntry.createdOrder = orderId;
        logEntry.paymentUrl = skylinkPayUrl;
        webhookLogs.unshift(logEntry);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Link de pago generado con éxito mediante Webhook',
          orderId,
          paymentUrl: skylinkPayUrl,
          token,
          amountBs
        }));
      }

      webhookLogs.unshift(logEntry);
      if (webhookLogs.length > 50) webhookLogs.pop();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: 'Webhook recibido y procesado correctamente',
        receivedAt: logEntry.timestamp
      }));
    }

    // ==========================================
    // 6. WEBHOOK DE RETORNO / CALLBACK SKYLINK PAY
    // ==========================================
    if (pathname === '/api/webhooks/skylink' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const token = payload.token || (payload.data && payload.data.token);
      const status = payload.status || (payload.data && payload.data.status);
      const reference = payload.reference || payload.authorizationCode;

      if (token) {
        const order = orders.get(token);
        if (order) {
          if (status === 'AUTHORIZED' || status === 'paid' || status === 'SUCCESS') {
            order.status = 'paid';
            order.reference = reference || 'SK-' + Math.floor(10000000 + Math.random() * 90000000);
            await dispatchOutboundWebhook('payment.success', order);
          } else if (status === 'FAILED' || status === 'REJECTED') {
            order.status = 'failed';
            await dispatchOutboundWebhook('payment.failed', order);
          }
        }
      }

      webhookLogs.unshift({
        type: 'skylink_callback',
        timestamp: new Date().toISOString(),
        body: payload,
        success: true
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Callback de Skylink procesado' }));
    }

    // Listar logs de webhooks
    if (pathname === '/api/webhooks/logs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: webhookLogs.slice(0, 30) }));
    }

    // Simular webhook de prueba
    if (pathname === '/api/webhooks/test' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const testEntry = {
        id: 'TEST-' + crypto.randomUUID().slice(0, 6),
        type: 'test_simulation',
        body: payload || { test: true, event: 'ping', time: new Date().toISOString() },
        timestamp: new Date().toISOString(),
        success: true
      };
      webhookLogs.unshift(testEntry);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Webhook de prueba registrado', data: testEntry }));
    }

    // ==========================================
    // 7. KIOSCO AUTOPAGO (Crear Transacción Real)
    // ==========================================
    if (pathname === '/api/create-payment' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      let amountBs = 0;

      if (Array.isArray(payload.items) && payload.items.length > 0) {
        amountBs = payload.items.reduce((sum, it) => {
          const prod = CATALOGO_PRODUCTOS.find(p => p.id === it.id);
          const pPrice = prod ? prod.priceBs : (it.priceBs || (it.price ? it.price * bcvRate : 25));
          return sum + (pPrice * (it.qty || it.quantity || 1));
        }, 0);
      } else if (payload.amountBs != null) {
        amountBs = Number(payload.amountBs);
      } else {
        amountBs = Number(payload.amount || 1) * bcvRate;
      }

      amountBs = Number(amountBs.toFixed(2));
      const amountCentimos = toCentimos(amountBs);
      const amountUsd = Number((amountBs / bcvRate).toFixed(2));
      const identifier = 'AUTO-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      const sessionId = 'SES-' + Date.now();

      const skylinkRes = await fetchSkylinkPay('/api/v1/merchant/transactions', 'POST', {
        buyOrder: identifier,
        sessionId: sessionId,
        amount: amountCentimos,
        currency: 'VES',
        installments: 1
      });

      const { token, skylinkPayUrl } = paymentFromResponse(skylinkRes);

      const sessionData = {
        identifier,
        sessionId,
        token,
        amount: amountUsd,
        amountBs,
        amountCentimos,
        bcvRate,
        description: payload.description || 'Compra Kiosco Skylink Pay',
        items: payload.items || [],
        payment_url: skylinkPayUrl,
        skylink_url: skylinkPayUrl,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      sessions.set(identifier, sessionData);
      sessions.set(sessionId, sessionData);
      sessions.set(token, sessionData);
      latestSession = sessionData;

      orders.set(identifier, {
        orderId: identifier,
        sessionId,
        token,
        amount: amountUsd,
        amountVes: amountBs,
        amountCentimos,
        bcvRate,
        description: sessionData.description,
        items: sessionData.items,
        clientName: 'Cliente Kiosco',
        clientPhone: '',
        storePhone: storeSettings.storePhone,
        storeName: storeSettings.storeName,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        status: 'pending',
        source: 'kiosk',
        createdAt: sessionData.createdAt
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        data: sessionData,
        token,
        payment_url: skylinkPayUrl,
        payment_qr: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(skylinkPayUrl)}`,
        skylink_url: skylinkPayUrl,
        amountCentimos,
        amountBs,
        amountUsd
      }));
    }

    // ==========================================
    // 8. CONSULTAR ESTADO DE ORDEN
    // ==========================================
    if (pathname.startsWith('/api/order-status/') && req.method === 'GET') {
      const id = pathname.split('/api/order-status/')[1];
      const order = orders.get(id);

      if (!order) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Orden no encontrada' }));
      }

      if (order.token && order.status === 'pending') {
        try {
          const skylinkStatus = await fetchSkylinkPay(`/api/v1/merchant/transactions/token/${order.token}`, 'GET');
          if (skylinkStatus.ok && skylinkStatus.data) {
            const st = skylinkStatus.data.status || (skylinkStatus.data.data && skylinkStatus.data.data.status);
            if (st === 'AUTHORIZED' || st === 'paid' || st === 'SUCCESS') {
              order.status = 'paid';
              order.reference = skylinkStatus.data.reference || order.reference || 'SK-' + Math.floor(10000000 + Math.random() * 90000000);
              await dispatchOutboundWebhook('payment.success', order);
            }
          }
        } catch (e) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: order }));
    }

    // ==========================================
    // 9. LISTAR ÓRDENES
    // ==========================================
    if (pathname === '/api/orders' && req.method === 'GET') {
      const list = Array.from(new Set(orders.values())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: list.slice(0, 40) }));
    }

    // ==========================================
    // 10. CHAT BOT WHATSAPP IA
    // ==========================================
    if (pathname === '/api/agent-chat' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const userMsg = (payload.message || '').trim();
      const clientName = payload.client_name || payload.clientName || 'Cliente';
      const orderId = payload.order_id || payload.orderId || null;

      const parsedItems = parseOrderFromMessage(userMsg);

      if (parsedItems.length === 0) {
        const isAskingForLink = /link|enlace|pago|pagar|cuenta|transferir/i.test(userMsg);
        const existingOrder = orderId ? orders.get(orderId) : null;
        if (isAskingForLink && existingOrder && existingOrder.status === 'pending') {
          const payUrl = existingOrder.skylinkUrl || existingOrder.paymentUrl;
          const replyText = `💳 *Aquí tienes tu link oficial de pago en Skylink Pay:*\n👉 ${payUrl}\n\n💵 *Monto:* Bs. ${existingOrder.amountVes.toFixed(2)} (≈ $${existingOrder.amount.toFixed(2)} USD)\n\n_(Acepta Pago Móvil C2P y Débito Inmediato)_. Al completar tu pago, coordinaremos el despacho de inmediato. 🚀`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            reply: replyText,
            state: 'order_created',
            orderId: existingOrder.orderId,
            orderData: existingOrder
          }));
        }

        let catalogoList = CATALOGO_PRODUCTOS.map(p => `• ${p.icon} *${p.name}* — Bs. ${p.priceBs.toFixed(2)} ($${getProductPriceUsd(p.priceBs)})`).join('\n');
        const replyText = `¡Hola ${clientName}! 👋 Bienvenido a *${storeSettings.storeName}*.\n\nAquí tienes nuestro catálogo de productos a tasa BCV (Bs. ${bcvRate.toFixed(2)}/$):\n\n${catalogoList}\n\n💬 _Dime qué deseas pedir (ej: "Quiero 2 harina pan y un arroz") y te generaré tu enlace de pago seguro en Skylink Pay de inmediato._`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, reply: replyText, state: 'browsing' }));
      }

      // Crear orden desde chat
      let totalBs = 0;
      let itemsBreakdown = [];
      parsedItems.forEach(i => {
        const sub = i.priceBs * i.qty;
        totalBs += sub;
        itemsBreakdown.push(`• ${i.icon} *${i.qty}x ${i.name}* (Bs. ${i.priceBs.toFixed(2)} c/u) = Bs. ${sub.toFixed(2)}`);
      });

      totalBs = Number(totalBs.toFixed(2));
      const totalCentimos = toCentimos(totalBs);
      const totalUsd = Number((totalBs / bcvRate).toFixed(2));
      const newOrderId = 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      const sessionId = 'SES-' + Date.now();

      const skylinkRes = await fetchSkylinkPay('/api/v1/merchant/transactions', 'POST', {
        buyOrder: newOrderId,
        sessionId: sessionId,
        amount: totalCentimos,
        currency: 'VES',
        installments: 1
      });

      const { token, skylinkPayUrl } = paymentFromResponse(skylinkRes);

      const orderData = {
        orderId: newOrderId,
        sessionId,
        token,
        amount: totalUsd,
        amountVes: totalBs,
        amountCentimos: totalCentimos,
        bcvRate,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        description: `Pedido WhatsApp (${parsedItems.map(i => `${i.qty}x ${i.name}`).join(', ')})`,
        items: parsedItems,
        clientName,
        clientPhone: payload.client_phone || '',
        storePhone: storeSettings.storePhone,
        storeName: storeSettings.storeName,
        status: 'pending',
        shippingData: null,
        source: 'whatsapp_agent',
        createdAt: new Date().toISOString()
      };

      orders.set(newOrderId, orderData);
      orders.set(sessionId, orderData);
      orders.set(token, orderData);

      const replyText = `¡Excelente elección! 🎉 He preparado tu orden de compra:\n\n${itemsBreakdown.join('\n')}\n\n💵 *Total en Bolívares:* Bs. ${totalBs.toFixed(2)}\n💵 *Total USD (Ref):* $${totalUsd.toFixed(2)}\n\n💳 *Aquí tienes tu link oficial de pago en Skylink Pay:*\n👉 ${skylinkPayUrl}\n\n_(Acepta Pago Móvil C2P y Débito Inmediato)_. Al completar tu pago, coordinaremos el despacho por aquí de inmediato. 🚀`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        reply: replyText,
        state: 'order_created',
        orderId: newOrderId,
        orderData
      }));
    }

    // ==========================================
    // 11. REINTENTO DE ORDEN Y GUÍAS DE ENVÍO
    // ==========================================
    if (pathname === '/api/retry-order' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const id = payload.order_id || payload.orderId;
      const prevOrder = orders.get(id);

      if (!prevOrder) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Orden anterior no encontrada' }));
      }

      const newOrderId = 'ORD-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      const amountVes = Number((prevOrder.amount * bcvRate).toFixed(2));
      const amountCentimos = toCentimos(amountVes);
      const sessionId = 'SES-' + Date.now();

      const skylinkRes = await fetchSkylinkPay('/api/v1/merchant/transactions', 'POST', {
        buyOrder: newOrderId,
        sessionId: sessionId,
        amount: amountCentimos,
        currency: 'VES',
        installments: 1
      });

      const { token, skylinkPayUrl } = paymentFromResponse(skylinkRes);

      const newOrderData = {
        orderId: newOrderId,
        sessionId,
        token,
        amount: prevOrder.amount,
        amountVes,
        amountCentimos,
        bcvRate,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        description: prevOrder.description,
        items: prevOrder.items,
        clientName: prevOrder.clientName,
        clientPhone: prevOrder.clientPhone,
        storePhone: prevOrder.storePhone || storeSettings.storePhone,
        storeName: prevOrder.storeName || storeSettings.storeName,
        status: 'pending',
        shippingData: null,
        createdAt: new Date().toISOString()
      };

      orders.set(newOrderId, newOrderData);
      orders.set(sessionId, newOrderData);
      orders.set(token, newOrderData);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: newOrderData }));
    }

    if (pathname === '/api/save-shipping' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const orderId = payload.order_id || payload.orderId;
      const order = orders.get(orderId);

      const guideNumber = payload.guide_number || payload.guideNumber || ('INT-' + Math.floor(100000 + Math.random() * 900000));
      const shippingInfo = {
        guideNumber: guideNumber,
        isInternalGuide: true,
        noticeMessage: 'Cuando tengamos tu guía de envío te la haremos llegar por aquí',
        recipientName: payload.recipient_name || payload.recipientName || (order ? order.clientName : 'Cliente'),
        recipientId: payload.recipient_id || payload.recipientId || 'V-12345678',
        recipientPhone: payload.recipient_phone || payload.recipientPhone || (order ? order.clientPhone : ''),
        city: payload.city || 'Caracas',
        agencyAddress: payload.agency_address || payload.agencyAddress || payload.address || 'Dirección de entrega',
        deliveryType: 'Envío Nacional',
        registeredAt: new Date().toISOString()
      };

      if (order) {
        order.shippingData = shippingInfo;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: shippingInfo }));
    }

    // ==========================================
    // 12. SESIÓN KIOSCO
    // ==========================================
    if (pathname === '/api/session-info' && req.method === 'GET') {
      const ref = parsedUrl.searchParams.get('ref');
      const sessionId = parsedUrl.searchParams.get('session_id') || parsedUrl.searchParams.get('sessionId');
      const stored = sessions.get(ref) || sessions.get(sessionId) || latestSession;

      if (!stored) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Sesión no encontrada' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: stored }));
    }

    // Endpoint no encontrado
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Endpoint no encontrado: ' + pathname }));

  } catch (err) {
    const status = err.httpStatus || 502;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: false,
      error: err.message,
      message: err.message,
      code: err.code || 'ERROR',
      upstreamStatus: err.upstreamStatus
    }));
  }
}

module.exports = handleApi;
