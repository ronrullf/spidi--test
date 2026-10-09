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

// Configuración de la tienda
let storeSettings = {
  storeName: 'Mi Tienda C.A.',
  storeRif: 'J-50733628-0',
  storePhone: '584121234567',
  skylinkCommerceCode: SKYLINK_COMMERCE_CODE,
  skylinkBaseUrl: SKYLINK_BASE_URL
};

// Almacén en memoria de órdenes y transacciones
const sessions = new Map();
let latestSession = null;
const orders = new Map();

// Catálogo de productos oficial
const CATALOGO_PRODUCTOS = [
  { id: 1, name: "Harina PAN 1kg", code: "7591001", price: 1.20, icon: "🌽", keywords: ["harina pan", "harina", "pan"] },
  { id: 2, name: "Café Molido 250g", code: "7591002", price: 2.50, icon: "☕", keywords: ["cafe", "café", "molido"] },
  { id: 3, name: "Refresco 2L", code: "7591003", price: 2.00, icon: "🥤", keywords: ["refresco", "soda", "gaseosa"] },
  { id: 4, name: "Arroz Blanco 1kg", code: "7591473005492", price: 1.10, icon: "🍚", keywords: ["arroz blanco", "arroz"] },
  { id: 5, name: "Aceite Vegetal 1L", code: "7591005", price: 2.80, icon: "🍳", keywords: ["aceite vegetal", "aceite"] },
  { id: 6, name: "Chocolate de Leche", code: "7591006", price: 1.00, icon: "🍫", keywords: ["chocolate de leche", "chocolate"] }
];

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Commerce-Code, X-Timestamp, X-Signature');

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

    // 1. Tasa BCV Oficial
    if (pathname === '/api/bcv-rate' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, rate: bcvRate, provider: 'Tasa configurada manualmente' }));
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

    // 3. Crear Transacción Real en Skylink Pay (Kiosco Autopago)
    // Redirige SIEMPRE a la pantalla oficial de pago de Skylink Pay (/pay/{token})
    if (pathname === '/api/create-payment' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const amountUsd = Number(payload.amount ?? 1);
      const amountBs = Number((amountUsd * bcvRate).toFixed(2));
      const amountCentimos = toCentimos(amountBs);
      const description = payload.description || 'Compra Kiosco Skylink Pay';
      const items = payload.items || [];
      const identifier = 'AUTO-' + crypto.randomUUID();
      const sessionId = 'SES-' + Date.now();

      // Llamada real firmada con HMAC a Skylink Pay API
      const skylinkRes = await fetchSkylinkPay('/api/v1/merchant/transactions', 'POST', {
        buyOrder: identifier,
        sessionId: sessionId,
        amount: amountCentimos,
        currency: 'VES',
        installments: 1
      });

      // Solo publicar enlaces confirmados por Skylink; nunca fabricar tokens.
      const { token, skylinkPayUrl } = paymentFromResponse(skylinkRes);

      const sessionData = {
        identifier,
        sessionId,
        token,
        amount: amountUsd,
        amountBs,
        amountCentimos,
        bcvRate,
        description,
        items,
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
        description,
        items,
        clientName: 'Cliente Kiosco',
        clientPhone: '',
        storePhone: storeSettings.storePhone,
        storeName: storeSettings.storeName,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        status: 'pending',
        createdAt: sessionData.createdAt
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        data: sessionData,
        token,
        payment_url: skylinkPayUrl,
        payment_qr: skylinkPayUrl,
        skylink_url: skylinkPayUrl,
        amountCentimos,
        amountBs,
        amountUsd
      }));
    }

    // 4. Crear Enlace de Orden Real con Skylink Pay (Admin WhatsApp)
    // Genera enlace directo a la pasarela oficial de Skylink Pay (/pay/{token})
    if (pathname === '/api/create-order-link' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const amountUsd = Number(payload.amount ?? 1);
      const amountVes = Number((amountUsd * bcvRate).toFixed(2));
      const amountCentimos = toCentimos(amountVes);
      const description = payload.description || 'Orden de Compra Skylink Pay';
      const items = payload.items || [];
      const clientName = payload.client_name || payload.clientName || 'Cliente';
      const clientPhone = payload.client_phone || payload.clientPhone || '';

      const orderId = 'ORD-' + crypto.randomUUID();
      const sessionId = 'SES-' + Date.now();

      // Llamada real firmada a Skylink Pay
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
        amount: amountUsd,
        amountVes,
        amountCentimos,
        bcvRate,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        description,
        items,
        clientName,
        clientPhone,
        storePhone: payload.store_phone || payload.storePhone || storeSettings.storePhone,
        storeName: storeSettings.storeName,
        status: 'pending',
        shippingData: null,
        createdAt: new Date().toISOString()
      };

      orders.set(orderId, orderData);
      orders.set(sessionId, orderData);
      orders.set(token, orderData);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: orderData }));
    }

    // 5. Agente Inteligente de WhatsApp (Ventas y Despacho)
    // Redirige SIEMPRE al enlace oficial de pago de Skylink Pay
    if (pathname === '/api/agent-chat' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const userMsg = (payload.message || '').trim();
      const clientName = payload.client_name || payload.clientName || 'Cliente';
      const clientPhone = payload.client_phone || payload.clientPhone || '04121234567';
      const orderId = payload.order_id || payload.orderId || null;
      const state = payload.conversation_state || payload.state || 'browsing';

      // Flujo de Registro de Despacho
      const hasIdPattern = /\b[VvEeJjGg]?\d{6,9}\b/.test(userMsg);
      const mentionsShippingKeywords = userMsg.toLowerCase().includes('mrw') || userMsg.toLowerCase().includes('zoom') || userMsg.toLowerCase().includes('tealca') || userMsg.toLowerCase().includes('agencia') || userMsg.toLowerCase().includes('calle') || userMsg.toLowerCase().includes('av') || userMsg.toLowerCase().includes('ciudad') || userMsg.toLowerCase().includes('estado');

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

      // Consulta de Catálogo o Saludo
      const parsedItems = parseOrderFromMessage(userMsg);

      if (parsedItems.length === 0) {
        // Si el cliente pide el link de pago o cómo pagar y hay una orden pendiente activa
        const isAskingForLink = /link|enlace|pago|pagar|cuenta|transferir/i.test(userMsg);
        const existingOrder = orderId ? orders.get(orderId) : null;
        if (isAskingForLink && existingOrder && existingOrder.status === 'pending') {
          const payUrl = existingOrder.skylinkUrl || existingOrder.paymentUrl;
          const replyText = `💳 *Aquí tienes tu link oficial de pago en Skylink Pay:*\n👉 ${payUrl}\n\n💵 *Monto:* $${existingOrder.amount.toFixed(2)} USD (Bs. ${existingOrder.amountVes.toFixed(2)} a tasa BCV ${bcvRate.toFixed(2)})\n\n_(Acepta Pago Móvil C2P y Débito Inmediato)_. Al completar tu pago, confirmaremos tu despacho por aquí de inmediato. 🚀`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            reply: replyText,
            state: 'order_created',
            orderId: existingOrder.orderId,
            orderData: existingOrder
          }));
        }

        let catalogoList = CATALOGO_PRODUCTOS.map(p => `• ${p.icon} *${p.name}* — $${p.price.toFixed(2)} (Bs. ${(p.price * bcvRate).toFixed(2)})`).join('\n');
        
        const replyText = `¡Hola ${clientName}! 👋 Bienvenido a *${storeSettings.storeName}*.\n\nAquí tienes nuestro catálogo cotizado a Tasa Oficial BCV (Bs. ${bcvRate.toFixed(2)}/$):\n\n${catalogoList}\n\n💬 _Dime qué productos y cantidades deseas (ej: "Quiero 2 kilos de arroz y 1 café") y te enviaré tu link oficial de pago en Skylink Pay de inmediato._`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          reply: replyText,
          state: 'browsing'
        }));
      }

      // Generar Orden y Enlace Oficial a la pantalla de pago de Skylink Pay
      let totalUsd = 0;
      let itemsBreakdown = [];
      parsedItems.forEach(i => {
        const sub = i.price * i.qty;
        totalUsd += sub;
        itemsBreakdown.push(`• ${i.icon} *${i.qty}x ${i.name}* ($${i.price.toFixed(2)} c/u) = $${sub.toFixed(2)}`);
      });

      const totalVes = Number((totalUsd * bcvRate).toFixed(2));
      const totalCentimos = toCentimos(totalVes);
      const newOrderId = 'ORD-' + crypto.randomUUID();
      const sessionId = 'SES-' + Date.now();

      // Llamada real firmada a Skylink Pay API
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
        amountVes: totalVes,
        amountCentimos: totalCentimos,
        bcvRate,
        paymentUrl: skylinkPayUrl,
        skylinkUrl: skylinkPayUrl,
        description: `Pedido ${newOrderId} (${parsedItems.map(i => `${i.qty}x ${i.name}`).join(', ')})`,
        items: parsedItems,
        clientName,
        clientPhone,
        storePhone: storeSettings.storePhone,
        storeName: storeSettings.storeName,
        status: 'pending',
        shippingData: null,
        createdAt: new Date().toISOString()
      };

      orders.set(newOrderId, orderData);
      orders.set(sessionId, orderData);
      orders.set(token, orderData);

      const replyText = `¡Excelente elección! 🎉 He preparado tu orden de compra:\n\n${itemsBreakdown.join('\n')}\n\n💵 *Total:* $${totalUsd.toFixed(2)} USD (Bs. ${totalVes.toFixed(2)} a tasa BCV ${bcvRate.toFixed(2)})\n\n💳 *Aquí tienes tu link oficial de pago en Skylink Pay:*\n👉 ${skylinkPayUrl}\n\n_(Acepta Pago Móvil C2P y Débito Inmediato)_. Al completar tu pago, coordinaremos el despacho por aquí de inmediato. 🚀`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        reply: replyText,
        state: 'order_created',
        orderId: newOrderId,
        orderData
      }));
    }

    // 6. Consultar Estado de la Transacción en Skylink Pay
    if (pathname.startsWith('/api/order-status/') && req.method === 'GET') {
      const id = pathname.split('/api/order-status/')[1];
      const order = orders.get(id);

      if (!order) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Orden no encontrada' }));
      }

      // Consultar estado en Skylink Pay API si tiene token
      if (order.token && order.status === 'pending') {
        try {
          const skylinkStatus = await fetchSkylinkPay(`/api/v1/merchant/transactions/token/${order.token}`, 'GET');
          if (skylinkStatus.ok && skylinkStatus.data) {
            const st = skylinkStatus.data.status || (skylinkStatus.data.data && skylinkStatus.data.data.status);
            if (st === 'AUTHORIZED' || st === 'paid' || st === 'SUCCESS') {
              order.status = 'paid';
              order.reference = skylinkStatus.data.reference || order.reference || 'SK-' + Math.floor(10000000 + Math.random() * 90000000);
            }
          }
        } catch (e) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: order }));
    }

    // 7. Guardar Datos de Despacho (Guía Interna INT-XXXXXX)
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

    // 8. Reintentar Orden
    if (pathname === '/api/retry-order' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const id = payload.order_id || payload.orderId;
      const prevOrder = orders.get(id);

      if (!prevOrder) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Orden anterior no encontrada' }));
      }

      const newOrderId = 'ORD-' + crypto.randomUUID();
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

    // 9. Listar Órdenes
    if (pathname === '/api/orders' && req.method === 'GET') {
      const list = Array.from(new Set(orders.values())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: list.slice(0, 30) }));
    }

    // 10. Info de Sesión Kiosco
    if (pathname === '/api/session-info' && req.method === 'GET') {
      const ref = parsedUrl.searchParams.get('ref');
      const sessionId = parsedUrl.searchParams.get('session_id') || parsedUrl.searchParams.get('sessionId');
      const stored = sessions.get(ref) || sessions.get(sessionId) || latestSession;

      if (!stored) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Sesión no encontrada' }));
      }

      if (stored.token && stored.status === 'pending') {
        try {
          const skylinkStatus = await fetchSkylinkPay(`/api/v1/merchant/transactions/token/${stored.token}`, 'GET');
          if (skylinkStatus.ok && skylinkStatus.data) {
            const st = skylinkStatus.data.status || (skylinkStatus.data.data && skylinkStatus.data.data.status);
            if (st === 'AUTHORIZED' || st === 'paid' || st === 'SUCCESS') {
              stored.status = 'paid';
              stored.reference = skylinkStatus.data.reference || 'SK-' + Math.floor(10000000 + Math.random() * 90000000);
            }
          }
        } catch (e) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, data: stored }));
    }

    // Endpoint no encontrado
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Endpoint API no encontrado: ' + pathname }));

  } catch (err) {
    res.writeHead(err.httpStatus || 500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: err.message, message: err.message, code: err.code, upstreamStatus: err.upstreamStatus }));
  }
}

module.exports = handleApi;
