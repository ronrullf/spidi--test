// Read-only by default. --create explicitly creates ONE unpaid order for Bs. 30.
const { request, paymentFromResponse } = require('../lib/skylink');

(async () => {
  const create = process.argv.includes('--create');
  const reference = `DIAG-${require('node:crypto').randomUUID()}`;
  const body = create ? { buyOrder: reference, sessionId: reference, amount: 3000, currency: 'VES', installments: 1 } : null;
  const result = await request('/api/v1/merchant/transactions', create ? 'POST' : 'GET', body);
  const output = { operation: create ? 'create' : 'list (read-only)', httpStatus: result.status,
    success: result.data?.success === true, serverDate: result.serverDate, localDate: new Date().toISOString() };
  // Do not print credentials, signatures, cookies, or transaction lists.
  if (create) {
    try { Object.assign(output, paymentFromResponse(result), { reference, amountBs: 30 }); }
    catch (error) { output.error = error.message; output.code = error.code; }
  } else if (!result.ok || !output.success) {
    output.error = result.status === 401 && /firma/i.test(result.data?.message || '')
      ? 'Firma inválida' : `Consulta rechazada o sin respuesta válida (HTTP ${result.status}).`;
  }
  console.log(JSON.stringify(output, null, 2));
  if (output.error) process.exitCode = 1;
})();
