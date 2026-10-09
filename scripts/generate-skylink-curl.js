// Generate only: does not send a request or create a transaction.
// Output contains the API key. Pipe directly to Set-Clipboard; do not save/share it.
const crypto = require('node:crypto');
const { sign, canonicalJson } = require('../lib/skylink');

const apiKey = process.env.SKYLINK_API_KEY?.trim();
const commerceCode = process.env.SKYLINK_COMMERCE_CODE?.trim();
if (!apiKey || !commerceCode) {
  console.error('Configura SKYLINK_API_KEY y SKYLINK_COMMERCE_CODE en .env.');
  process.exit(1);
}
const endpoint = '/api/v1/merchant/transactions';
const url = new URL(endpoint, process.env.SKYLINK_BASE_URL || 'https://dev-axis-payment.valinkgroup.com');
if (url.protocol !== 'https:') throw new Error('Skylink requiere HTTPS.');
const reference = crypto.randomUUID();
const body = canonicalJson({
  buyOrder: `ORD-${reference}`, sessionId: `SES-${reference}`,
  amount: 2500, currency: 'VES', installments: 1
});
const timestamp = Date.now().toString();
const signature = sign('POST', endpoint, body, timestamp, apiKey);
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const headers = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Idempotency-Key': `ORD-${reference}-${timestamp}`,
  'X-Api-Key': apiKey,
  'X-Commerce-Code': commerceCode,
  'X-Commerce-Id': commerceCode,
  'X-Timestamp': timestamp,
  'X-Signature': signature
};
const parts = [`curl -X POST ${quote(url.href)}`];
for (const [name, value] of Object.entries(headers)) parts.push(`  -H ${quote(`${name}: ${value}`)}`);
parts.push(`  --data-raw ${quote(body)}`);
process.stdout.write(parts.join(' \\\n'));
