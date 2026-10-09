const crypto = require('node:crypto');
const https = require('node:https');
const path = require('node:path');

// Local development only; deployment supplies environment variables directly.
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

// Provider's executable support example supersedes the dashboard's dot-separated example.
function canonicalJson(value) {
  if (value == null) return 'null';
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

function sign(method, pathname, body, timestamp, apiKey) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const signedPath = normalized.split('?')[0];
  return crypto.createHmac('sha256', apiKey)
    .update(`${method.toUpperCase()}\n${signedPath}\n${timestamp}\n${body}`, 'utf8').digest('hex');
}

function request(endpoint, method = 'POST', bodyObj = null) {
  return new Promise((resolve) => {
    try {
      const apiKey = process.env.SKYLINK_API_KEY?.trim();
      const commerceCode = process.env.SKYLINK_COMMERCE_CODE?.trim();
      if (!apiKey || !commerceCode) throw new Error('Faltan SKYLINK_API_KEY o SKYLINK_COMMERCE_CODE en el servidor.');
      const base = new URL(process.env.SKYLINK_BASE_URL || 'https://dev-axis-payment.valinkgroup.com');
      const url = new URL(endpoint, base);
      if (url.protocol !== 'https:' || url.origin !== base.origin) throw new Error('Destino Skylink inválido.');
      method = method.toUpperCase();
      const canonicalBody = canonicalJson(bodyObj);
      const body = method === 'GET' || method === 'HEAD' ? '' : canonicalBody;
      const timestamp = Date.now().toString();
      const headers = {
        'Accept': 'application/json',
        'X-Api-Key': apiKey,
        'X-Commerce-Code': commerceCode,
        'X-Commerce-Id': commerceCode,
        'X-Timestamp': timestamp,
        'X-Signature': sign(method, url.pathname, canonicalBody, timestamp, apiKey)
      };
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
        headers['Idempotency-Key'] = `${bodyObj?.buyOrder || 'req'}-${timestamp}`;
      }
      const req = https.request(url, { method, headers, timeout: 10000 }, res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('error', () => resolve({ ok: false, status: 502, error: 'Respuesta de Skylink interrumpida.' }));
        res.on('end', () => {
          let data;
          try { data = JSON.parse(raw); }
          catch { data = { success: false, message: 'Skylink devolvió una respuesta no JSON.' }; }
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data,
            serverDate: res.headers.date });
        });
      });
      req.on('error', () => resolve({ ok: false, status: 502, error: 'No se pudo conectar con Skylink.' }));
      req.on('timeout', () => {
        resolve({ ok: false, status: 504, error: 'Skylink no respondió a tiempo. Verifica el pedido antes de reintentar.' });
        req.destroy();
      });
      // Sign and transmit exactly the same string, without a second serialization.
      req.end(body);
    } catch (error) {
      resolve({ ok: false, status: 500, error: error.message });
    }
  });
}

function paymentFromResponse(result) {
  const envelope = result.data;
  const payment = envelope?.data;
  let url;
  try { url = new URL(payment?.url); } catch {}
  const base = new URL(process.env.SKYLINK_BASE_URL || 'https://dev-axis-payment.valinkgroup.com');
  if (!result.ok || envelope?.success !== true || typeof payment?.token !== 'string' || !payment.token ||
      !url || url.origin !== base.origin || url.pathname !== `/pay/${payment.token}`) {
    const signatureRejected = result.status === 401 && /firma/i.test(envelope?.message || '');
    const error = new Error(signatureRejected
      ? 'Skylink rechazó la firma (HTTP 401). No se generó un enlace de pago. Revisa la clave y la configuración HMAC con Skylink.'
      : `No se obtuvo un enlace de pago válido de Skylink (HTTP ${result.status}). Verifica la orden antes de reintentar.`);
    error.code = signatureRejected ? 'SKYLINK_SIGNATURE_INVALID' : 'SKYLINK_CREATE_FAILED';
    error.upstreamStatus = result.status;
    error.httpStatus = result.status === 504 ? 504 : 502;
    throw error;
  }
  return { token: payment.token, skylinkPayUrl: payment.url };
}

module.exports = { canonicalJson, sign, request, paymentFromResponse };
