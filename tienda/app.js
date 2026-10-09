const $ = id => document.getElementById(id);
const money = amount => `Bs. ${(amount / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let selected, pending = false, completed = false, attemptId, paymentUrl;
function reset() {
  attemptId = crypto.randomUUID(); completed = false; paymentUrl = null;
  $('result').hidden = true; $('payment-link').hidden = true; $('copy').hidden = true; $('copy').textContent = 'Copiar enlace';
  $('new-attempt').hidden = true; $('pay').disabled = !selected;
  $('pay').textContent = 'Generar link de pago ↗';
}
function select(product) {
  if (pending) return;
  selected = product; reset();
  document.querySelectorAll('.product').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === product.id)));
  $('selected-name').textContent = product.name;
  $('selected-price').textContent = $('total').textContent = money(product.amount);
}
async function load() {
  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error();
    const { products } = await response.json();
    $('products').replaceChildren();
    for (const product of products) {
      const button = document.createElement('button');
      button.className = 'product'; button.dataset.id = product.id;
      button.setAttribute('aria-pressed', 'false');
      // Content is the fixed server-owned catalog, not customer input.
      button.innerHTML = `<div class="picture ${product.color}" aria-hidden="true">${product.icon}</div><h3>${product.name}</h3><p>${product.description}</p><div class="product-bottom"><strong>${money(product.amount)}</strong><span class="choose">Elegir +</span></div>`;
      button.addEventListener('click', () => select(product)); $('products').append(button);
    }
    select(products[0]);
  } catch { $('products').textContent = 'No se pudo cargar la tienda. Inicia el servidor y recarga esta página.'; }
}
$('pay').addEventListener('click', async () => {
  if (!selected || pending || completed) return;
  pending = true; $('pay').disabled = true; $('pay').textContent = 'Generando enlace…';
  document.querySelectorAll('.product').forEach(button => button.disabled = true);
  try {
    const response = await fetch('/api/payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: selected.id, attemptId }) });
    const data = await response.json();
    completed = true;
    $('result').className = `result ${data.success ? '' : 'error'}`;
    $('result-title').textContent = data.success ? 'Enlace de pago creado' : 'No se pudo crear el enlace';
    $('result-message').textContent = data.message;
    $('diagnostics').textContent = JSON.stringify(data.diagnostics || { message: data.message }, null, 2);
    if (data.success && data.url) {
      paymentUrl = data.url; $('payment-link').href = paymentUrl;
      $('payment-link').hidden = false; $('copy').hidden = false;
    }
    $('new-attempt').hidden = false;
  } catch {
    $('result').className = 'result error';
    $('result-title').textContent = 'Conexión interrumpida';
    $('result-message').textContent = 'Puedes consultar el mismo intento otra vez. Si reiniciaste el servidor, revisa primero el panel de Skylink para evitar duplicar la orden.';
    $('diagnostics').textContent = 'No se recibió una respuesta del servidor local.';
  } finally {
    pending = false; $('pay').disabled = completed;
    $('pay').textContent = completed ? 'Intento finalizado' : 'Consultar el mismo intento';
    document.querySelectorAll('.product').forEach(button => button.disabled = false);
    $('result').hidden = false; $('result').focus();
  }
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(paymentUrl); $('copy').textContent = 'Enlace copiado'; }
  catch { $('result-message').textContent = 'Usa el botón Abrir página de pago y copia la dirección del navegador.'; }
});
$('new-attempt').addEventListener('click', () => {
  if (!confirm('Esto iniciará una orden nueva. Si el resultado anterior fue incierto, revisa primero el panel de Skylink. ¿Continuar?')) return;
  reset();
});
load();
