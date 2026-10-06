const os = require('os');
const querystring = require('querystring');

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

// Almacén en memoria de sesiones y órdenes
const sessions = new Map();
let latestSession = null;
const orders = new Map();

// Catálogo de productos para el agente inteligente de ventas
const CATALOGO_PRODUCTOS = [
  { id: 1, name: "Harina PAN 1kg", code: "7591001", price: 1.20, icon: "🌽", keywords: ["harina pan", "harina", "pan"] },
  { id: 2, name: "Café Molido 250g", code: "7591002", price: 2.50, icon: "☕", keywords: ["cafe", "café", "molido"] },
  { id: 3, name: "Refresco 2L", code: "7591003", price: 2.00, icon: "🥤", keywords: ["refresco", "soda", "gaseosa"] },
  { id: 4, name: "Arroz Blanco 1kg", code: "7591473005492", price: 1.10, icon: "🍚", keywords: ["arroz blanco", "arroz"] },
  { id: 5, name: "Aceite Vegetal 1L", code: "7591005", price: 2.80, icon: "🍳", keywords: ["aceite vegetal", "aceite"] },
  { id: 6, name: "Chocolate de Leche", code: "7591006", price: 1.00, icon: "🍫", keywords: ["chocolate de leche", "chocolate"] }
];

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
        price: prod.price,
        qty: qty,
        icon: prod.icon
      });
    }
  }

  return foundItems;
}

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

function getBaseUrl(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }

  const host = req.headers.host;
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    const proto = (req.connection && req.connection.encrypted) ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  const localIp = getLocalIp();
  const port = process.env.PORT || 3000;
  return `http://${localIp}:${port}`;
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

function getRequestBody(req) {
  return new Promise((resolve) => {
    // Si el entorno (como Vercel) ya procesó el cuerpo
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
      }
      return resolve(req.body || {});
    }

    // Si es un stream crudo de Node.js
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    // Determinar la ruta de la API (soporta ?route=... de vercel.json rewrites)
    let pathname = parsedUrl.pathname;
    const routeParam = parsedUrl.searchParams.get('route');
    if (routeParam) {
      pathname = '/api/' + routeParam;
    }

    const baseUrl = getBaseUrl(req);

    // 1. Tasa BCV
    if (pathname === '/api/bcv-rate' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, rate: bcvRate }));
    }
    if (pathname === '/api/bcv-rate' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      if (payload.rate) bcvRate = Number(payload.rate);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, rate: bcvRate }));
    }

    // 2. Configuración de Tienda
    if (pathname === '/api/store-settings' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: storeSettings }));
    }
    if (pathname === '/api/store-settings' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      if (payload.storePhone) storeSettings.storePhone = payload.storePhone;
      if (payload.storeName) storeSettings.storeName = payload.storeName;
      if (payload.storeRif) storeSettings.storeRif = payload.storeRif;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: storeSettings }));
    }

    // 3. Crear Enlace de Orden (Admin WhatsApp)
    if (pathname === '/api/create-order-link' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const amount = Number(payload.amount || 1);
      const description = payload.description || 'Orden de Compra';
      const items = payload.items || [];
      const clientName = payload.client_name || payload.clientName || 'Cliente';
      const clientPhone = payload.client_phone || payload.clientPhone || '';
      const sessionType = payload.session_type || 'button';

      const orderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
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
      return res.end(JSON.stringify({ success: true, data: orderData }));
    }

    // 4. Estado de Orden (Checkout, Factura, Errores)
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
        return res.end(JSON.stringify({ success: true, data: responsePayload }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, data: order }));
      }
    }

    // 5. Guardar Datos de Envío (Guía Interna de Despacho)
    if (pathname === '/api/save-shipping' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const orderId = payload.order_id || payload.orderId;
      const sessionId = payload.session_id || payload.sessionId;

      const order = orders.get(orderId) || orders.get(sessionId);
      if (!order) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Orden no encontrada para asociar envío.' }));
      }

      // Guía interna del comercio (no de MRW)
      const guideNumber = payload.guide_number || payload.guideNumber || ('INT-' + Math.floor(100000 + Math.random() * 900000));
      const shippingInfo = {
        guideNumber: guideNumber,
        isInternalGuide: true,
        noticeMessage: 'Cuando tengamos tu guía de envío te la haremos llegar por aquí',
        courier: payload.courier || 'Por Asignar (Nacional)',
        recipientName: payload.recipient_name || payload.recipientName || order.clientName,
        recipientId: payload.recipient_id || payload.recipientId || 'V-12345678',
        recipientPhone: payload.recipient_phone || payload.recipientPhone || order.clientPhone,
        state: payload.state || 'Distrito Capital',
        city: payload.city || 'Caracas',
        agencyAddress: payload.agency_address || payload.agencyAddress || payload.address || 'Oficina / Dirección de entrega',
        deliveryType: payload.delivery_type || payload.deliveryType || 'Retiro / Envío Nacional',
        notes: payload.notes || '',
        registeredAt: new Date().toISOString()
      };

      order.shippingData = shippingInfo;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: shippingInfo }));
    }

    // 5B. Agente Inteligente de WhatsApp (Ventas y Despacho)
    if (pathname === '/api/agent-chat' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const userMsg = (payload.message || '').trim();
      const clientName = payload.client_name || payload.clientName || 'Cliente';
      const clientPhone = payload.client_phone || payload.clientPhone || '04121234567';
      const orderId = payload.order_id || payload.orderId || null;
      const state = payload.conversation_state || payload.state || 'browsing';

      // Flujo A: El cliente está enviando sus datos de despacho
      const hasIdPattern = /\b[VvEeJjGg]?\d{6,9}\b/.test(userMsg);
      const mentionsShippingKeywords = userMsg.toLowerCase().includes('mrw') || userMsg.toLowerCase().includes('zoom') || userMsg.toLowerCase().includes('agencia') || userMsg.toLowerCase().includes('calle') || userMsg.toLowerCase().includes('av') || userMsg.toLowerCase().includes('ciudad') || userMsg.toLowerCase().includes('estado');

      if (state === 'awaiting_shipping' || (orderId && (hasIdPattern || mentionsShippingKeywords))) {
        const order = orders.get(orderId);
        const internalGuide = 'INT-' + Math.floor(100000 + Math.random() * 900000);

        let recipientName = clientName;
        let recipientId = 'V-12345678';
        let phone = clientPhone;
        let destination = userMsg;

        const parts = userMsg.split(/[,\n]/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          recipientName = parts[0] || clientName;
          const foundId = parts.find(p => /\b[VvEeJjGg]?\d{6,9}\b/.test(p));
          if (foundId) recipientId = foundId;
          const foundPhone = parts.find(p => /\b04\d{9}\b/.test(p.replace(/\D/g, '')));
          if (foundPhone) phone = foundPhone;
        }

        const shippingInfo = {
          guideNumber: internalGuide,
          isInternalGuide: true,
          noticeMessage: 'Cuando tengamos tu guía de envío te la haremos llegar por aquí',
          courier: 'Por Asignar (Nacional)',
          recipientName,
          recipientId,
          recipientPhone: phone,
          agencyAddress: destination,
          deliveryType: 'Envío Nacional',
          registeredAt: new Date().toISOString()
        };

        if (order) {
          order.shippingData = shippingInfo;
        }

        const replyText = `✅ ¡Datos de envío registrados con éxito! 📦\n\n📌 *Código interno de despacho:* ${internalGuide}\n👤 *Destinatario:* ${recipientName} (${recipientId})\n📍 *Datos:* ${destination}\n\n*Cuando tengamos tu guía de envío te la haremos llegar por aquí.* ¡Muchas gracias por tu compra! 🙌`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          reply: replyText,
          state: 'completed',
          internalGuide,
          shippingInfo
        }));
      }

      // Flujo B: Consulta de catálogo o saludo
      const parsedItems = parseOrderFromMessage(userMsg);

      if (parsedItems.length === 0) {
        let catalogoList = CATALOGO_PRODUCTOS.map(p => `• ${p.icon} *${p.name}* — $${p.price.toFixed(2)} (Bs. ${(p.price * bcvRate).toFixed(2)})`).join('\n');
        
        const replyText = `¡Hola ${clientName}! 👋 Bienvenido a *${storeSettings.storeName}*.\n\nAquí tienes nuestro catálogo disponible cotizado a Tasa BCV (Bs. ${bcvRate.toFixed(2)}/$):\n\n${catalogoList}\n\n💬 _Dime qué productos y cantidades deseas (ej: "Quiero 2 kilos de arroz y 1 café") y te generaré tu enlace de pago oficial de inmediato._`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          reply: replyText,
          state: 'browsing'
        }));
      }

      // Flujo C: Se detectaron productos -> Generar Orden con Link de Pago SPIDI
      let totalUsd = 0;
      let itemsBreakdown = [];
      parsedItems.forEach(i => {
        const sub = i.price * i.qty;
        totalUsd += sub;
        itemsBreakdown.push(`• ${i.icon} *${i.qty}x ${i.name}* ($${i.price.toFixed(2)} c/u) = $${sub.toFixed(2)}`);
      });

      const totalVes = Number((totalUsd * bcvRate).toFixed(2));
      const newOrderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const successUrl = `${baseUrl}/factura.html?order_id=${newOrderId}`;
      const failureUrl = `${baseUrl}/error-pago.html?order_id=${newOrderId}`;
      const checkoutUrl = `${baseUrl}/checkout.html?order_id=${newOrderId}`;
      const description = `Pedido ${newOrderId} (${parsedItems.map(i => `${i.qty}x ${i.name}`).join(', ')})`;

      let spidiRes;
      let sessionId = 'sim_' + Date.now();
      let paymentUrl = checkoutUrl;

      try {
        spidiRes = await fetchSpidi('/api/v1/ext/payment-sessions/buttons', 'POST', {
          agreement_id: SPIDI_AGREEMENT_ID,
          amount_reference: totalUsd,
          currency_reference: 'USD',
          identifier_label: 'Orden',
          identifier: newOrderId,
          description: description,
          success_url: successUrl,
          failure_url: failureUrl,
          duration_minutes: 20
        });

        if (spidiRes.data && spidiRes.data.success && spidiRes.data.data) {
          sessionId = spidiRes.data.data.session_id;
          paymentUrl = spidiRes.data.data.payment_url;
        }
      } catch (e) {
        console.warn("SPIDI order fetch:", e.message);
      }

      const orderData = {
        orderId: newOrderId,
        sessionId,
        amount: totalUsd,
        amountVes: totalVes,
        bcvRate,
        checkoutUrl,
        description,
        items: parsedItems,
        clientName,
        clientPhone,
        storePhone: storeSettings.storePhone,
        storeName: storeSettings.storeName,
        paymentUrl,
        status: 'pending',
        shippingData: null,
        createdAt: new Date().toISOString()
      };

      orders.set(newOrderId, orderData);
      orders.set(sessionId, orderData);

      const replyText = `¡Excelente elección! 🎉 He preparado tu orden de compra:\n\n${itemsBreakdown.join('\n')}\n\n💵 *Total USD:* $${totalUsd.toFixed(2)}\n🇻🇪 *Total en Bs (BCV ${bcvRate.toFixed(2)}):* Bs. ${totalVes.toFixed(2)}\n\n💳 *Paga de forma segura con SPIDI aquí:*\n👉 ${checkoutUrl}\n\n_(Acepta Débito Inmediato y Pago Móvil C2P)_. Apenas el banco confirme tu pago te notificaré por este chat para coordinar el envío. 🚀`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        reply: replyText,
        state: 'order_created',
        orderId: newOrderId,
        orderData
      }));
    }

    // 6. Reintentar Orden
    if (pathname === '/api/retry-order' && req.method === 'POST') {
      const payload = await getRequestBody(req);
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
      return res.end(JSON.stringify(spidiRes.data));
    }

    // 7. Listar Órdenes
    if (pathname === '/api/orders' && req.method === 'GET') {
      const list = Array.from(new Set(orders.values())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: list.slice(0, 30) }));
    }

    // 8. Crear Sesión en Kiosco
    if (pathname === '/api/create-payment' && req.method === 'POST') {
      const payload = await getRequestBody(req);
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
      return res.end(JSON.stringify(spidiRes.data));
    }

    // 9. Simular Pago
    if (pathname === '/api/simulate-pay' && req.method === 'POST') {
      const payload = await getRequestBody(req);
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

      return new Promise((resolve) => {
        const payReq = require('https').request(stored.payment_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payData)
          }
        }, async () => {
          const spidiRes = await fetchSpidi(`/api/v1/ext/payment-sessions/status/${stored.sessionId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(spidiRes.data));
          resolve();
        });

        payReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
          resolve();
        });

        payReq.write(payData);
        payReq.end();
      });
    }

    // 10. Reintentar Sesión de Kiosco
    if (pathname === '/api/retry-payment' && req.method === 'POST') {
      const payload = await getRequestBody(req);
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
      return res.end(JSON.stringify(spidiRes.data));
    }

    // 11. Info de Sesión Kiosco
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
        return res.end(JSON.stringify({ success: true, data: resultData }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, data: { status: 'unknown', stored_session: stored } }));
      }
    }

    // 12. Estado por Session ID
    if (pathname.startsWith('/api/check-status/') && req.method === 'GET') {
      const sessionId = pathname.split('/api/check-status/')[1];
      const spidiRes = await fetchSpidi(`/api/v1/ext/payment-sessions/status/${sessionId}`);
      const stored = sessions.get(sessionId);
      if (spidiRes.data && spidiRes.data.data && stored) {
        spidiRes.data.data.items = stored.items;
        spidiRes.data.data.client_name = stored.clientName;
      }
      res.writeHead(spidiRes.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(spidiRes.data));
    }

    // Ruta API no encontrada
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Endpoint API no encontrado: ' + pathname }));

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: err.message, stack: err.stack }));
  }
}

module.exports = handleApi;
