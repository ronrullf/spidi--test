# Cobro por Chat — Especificación para construir (v1)

> **Nombre provisional:** Cobro por Chat. Se puede renombrar.
> **Para el agente (Antigravity):** lee esta especificación completa y, **antes de escribir código**, lee la documentación oficial de SPIDI (sección 3). **No inventes endpoints, nombres de campos ni formatos de firma:** sácalos de la documentación. Donde diga `TODO(SPIDI)` falta un dato que debe confirmarse con SPIDI o con el dueño. Trabaja por fases (sección 12), pregunta lo que falte y no avances a la siguiente fase sin cumplir los criterios de aceptación de la actual.

---

## 1. Qué es

Un sistema para vendedores que cobran por **WhatsApp o Instagram** en Venezuela. El vendedor (admin) elige un producto, genera un **link de pago**, lo manda al cliente por el chat y el cliente paga. Cuando el pago se verifica, el cliente llena sus **datos de envío** (MRW, Zoom u otra empresa de encomiendas) y esos datos le llegan al vendedor por WhatsApp.

**Problema que resuelve:** hoy el vendedor recibe una captura de Pago Móvil, la verifica a mano en su banco y luego pide los datos de envío por chat, uno por uno. El sistema automatiza el cobro, la verificación y la captura de los datos de envío.

**Usuarios**
- **Admin (vendedor):** gestiona el catálogo, genera links, ve pedidos y datos de envío. Empieza siendo un solo usuario; deja la estructura lista para varios.
- **Cliente final:** no tiene cuenta. Entra por el link, paga y llena el envío. Casi siempre desde el celular, abriendo el link dentro de WhatsApp o Instagram.

---

## 2. Flujo completo

1. El admin entra al panel y elige uno o más productos del catálogo, con talla/color y cantidad.
2. Opcionalmente escribe el nombre y el WhatsApp del cliente.
3. El sistema crea un **pedido** y genera un link único: `https://<dominio>/p/<token>`.
4. El admin lo envía al cliente por WhatsApp (botón que abre `wa.me` con el mensaje ya escrito).
5. El cliente abre el link y ve la página del pedido con el producto precargado: foto, nombre, talla, cantidad, monto.
6. El cliente toca **Pagar**. El servidor crea la **sesión de pago en SPIDI** y lleva al cliente a pagar. Al terminar vuelve a nuestra página.
7. Nuestro servidor **verifica el pago** (webhook de SPIDI; el redirect solo no prueba nada).
8. Pago verificado → el cliente es redirigido automáticamente al **formulario de envío**.
9. El cliente llena el envío y lo envía.
10. El sistema guarda los datos y **los manda al WhatsApp del admin** (mensaje con el pedido y los datos de envío). Opcionalmente confirma al cliente.
11. El admin despacha, registra la guía/tracking y se la envía al cliente.

> **Nota sobre "pagar directamente en la página":** en la v1 el cliente toca "Pagar" y completa el pago en la **página de pago de SPIDI** (el camino documentado como "Botón"), de donde vuelve solo. Pagar dentro de nuestra propia pantalla requiere el **SDK de SPIDI** (hay versión React); es opcional para una fase posterior y tiene reglas distintas (ver sección 3). No lo uses en la v1.

---

## 3. Integración con SPIDI

SPIDI es una pasarela de pagos en línea para Venezuela. El cliente paga desde su banco (Débito Inmediato como camino principal, Pago Móvil como alternativa y cripto) y el dinero se liquida **en bolívares (VES)** a una cuenta del comercio. No hay costo de implementación ni mensualidad; el banco descuenta su comisión en la acreditación.

**Documentación oficial (léela antes de codificar):**
- Cómo se integra: https://docs.mispidi.com/en-linea/con-codigo/como-se-integra
- Qué es SPIDI: https://docs.mispidi.com/empezar-aqui/que-es
- ¿Cuál solución necesito?: https://docs.mispidi.com/empezar-aqui/cual-solucion
- Recibe tu primer pago (Botón): https://docs.mispidi.com/en-linea/con-codigo/primer-pago
- Guía del Botón: https://docs.mispidi.com/en-linea/con-codigo/guias/boton-web
- Conceptos (modelo de pago, ciclo de vida, transacción a dos fases, webhooks, comisiones): https://docs.mispidi.com/en-linea/con-codigo/conceptos-base
- Conducir el ciclo en el simulador: https://docs.mispidi.com/en-linea/con-codigo/probar/conducir-el-ciclo
- Límites y reglas de operación: https://docs.mispidi.com/recursos/limites-y-reglas-de-operacion
- Pasar a producción: https://docs.mispidi.com/en-linea/con-codigo/pasar-a-produccion
- Referencia de la API de Productos: https://docs.mispidi.com/en-linea/con-codigo/referencia
- Simulador: https://sim.mispidi.com

**Modelo mental (resumen, verifícalo en los docs):**
- El backend se autentica contra la API de Productos (el token vence pronto; se renueva con `refreshToken`).
- Se define un **destino/acuerdo** (a qué cuenta llega el dinero). Cada cobro es una **sesión de pago** con monto, concepto y una referencia propia (`internal_reference`).
- SPIDI devuelve el **enlace** donde paga el cliente. Si no se envía `duration_minutes`, caduca pronto; el rango permitido es de **5 a 20 minutos** y 20 es el máximo.
- **Un pago ocurre en dos fases:** (1) el **pago**, la sesión llega a `paid`; (2) la **acreditación**, llega el webhook `payment_session.accredited` con el desglose (monto bruto, comisión del banco, monto acreditado, `bank_reference_id`). Se puede entregar el producto en la fase 1.
- La URL de una sesión deja de servir cuando vence o cuando el pago se completa.

**Reglas y límites que condicionan el diseño**
- Monto mínimo de una sesión: **14 VES** (menos devuelve error 400).
- Hay un tope por transacción fijado por el BCV: `TODO(SPIDI)` valor vigente. Hazlo configurable (`MAX_TX_VES`).
- Límite de 100 req/min por comercio. El polling del cliente debe consultar **nuestra base de datos**, no a SPIDI.
- `Idempotency-Key` vive 24 h. Úsala en toda creación de sesión.
- La configuración (URLs, credenciales, secretos) va en variables de entorno, nunca en el código.

**Tres entornos, en orden:** simulador (para aprender y forzar desenlaces) → sandbox (donde se certifica) → producción.
**Pasar a producción no es autoservicio:** hay una reunión de certificación (equipo técnico y de marca) y luego datos formales de la empresa. Ver sección 11.

---

## 4. Stack recomendado

Se puede cambiar si hay una razón; justifícala.

- **Next.js (App Router) + TypeScript + Tailwind CSS**, mobile-first.
- **PostgreSQL** (Supabase o Neon) con **Prisma** o **Drizzle**.
- **Despliegue en Vercel.** El endpoint de webhook debe ser **público y alcanzable desde internet**.
- **Auth del admin:** email + contraseña (Auth.js o Supabase Auth). Rutas `/admin/*` protegidas.
- Tareas programadas (expirar pedidos, recordatorios) con Vercel Cron.
- Zona horaria `America/Caracas`, idioma `es-VE`, moneda mostrada como `Bs. 1.234,56`.

---

## 5. Modelo de datos

**Product**
`id, name, description, images[], price_usd (opcional), price_ves (opcional), active, created_at`

**ProductVariant**
`id, product_id, size, color, sku, stock`

**Order**
`id, public_token (aleatorio, no adivinable, ≥16 caracteres), code (corto y legible, ej. P-0042), status, customer_name?, customer_whatsapp?, items[] (snapshot de nombre, variante, cantidad y precio unitario en el momento de crear), total_ves, exchange_rate_used?, notes, created_at, expires_at`

**Estados de Order:**
`draft → link_sent → payment_pending → paid → accredited → shipping_data_received → fulfilled`
Estados terminales o de excepción: `expired`, `payment_failed`, `accreditation_failed`, `cancelled`.

**PaymentSession**
`id, order_id, spidi_session_id, spidi_url, status, amount_ves, internal_reference (= order.code), duration_minutes, expires_at, bank_reference_id?, gross_ves?, bank_commission_ves?, net_ves?, created_at`

**WebhookEvent**
`id, idempotency_key (único), event_type, payload (json), signature_valid, processed_at`

**ShippingInfo**
`id, order_id (único), carrier, delivery_mode (office | home | pickup), recipient_name, id_type (V/E/J/G/P), id_number, phone, state, city, office_name?, address?, reference?, notes?, submitted_at, locked_at?`

**Carrier** (configurable desde el admin)
`id, name, active, modes[], required_fields (json), notes_for_customer`
Valores iniciales: MRW, Zoom, Tealca, Domesa, Retiro en tienda, Delivery local. Cada uno con su lista de campos obligatorios.

**Settings**
`admin_whatsapp, store_name, store_logo, exchange_rate_ves_per_usd (manual), rate_updated_at, max_tx_ves, link_validity_hours`

**Notification**
`id, order_id, channel, to, body, status, created_at` (bitácora de lo enviado o por enviar).

---

## 6. Páginas y endpoints

### Panel del admin (`/admin`)
- **Catálogo:** CRUD de productos y variantes (talla, color, stock), con fotos.
- **Nuevo cobro:** elegir producto(s), variante y cantidad, nombre y WhatsApp del cliente opcionales. Muestra el total en Bs y en USD de referencia. Botón **Generar link**.
- Tras generar: botón **Enviar por WhatsApp** (abre `https://wa.me/<número>?text=<mensaje con el link>`) y botón **Copiar link**.
- **Pedidos:** lista filtrable por estado. Distintivos claros para "pagado, falta enviar datos" y "pago fallido/expirado".
- **Detalle del pedido:** artículos, estado, desglose del pago (bruto, comisión, acreditado, referencia bancaria), datos de envío, historial de notificaciones.
- Acciones: **Copiar datos de envío para WhatsApp**, **Reenviar link de envío al cliente**, **Marcar despachado** (con número de guía y botón para enviársela al cliente por WhatsApp), **Cancelar pedido**.
- **Ajustes:** tasa de cambio, WhatsApp del admin, límites, transportistas y sus campos.

### Públicas (sin login)
- `GET /p/[token]` — página del pedido, producto precargado y botón **Pagar**.
- `POST /api/orders/[token]/pay` — crea (o reutiliza si sigue vigente) la sesión en SPIDI y devuelve la URL de pago. Debe ser **idempotente**.
- `GET /p/[token]/retorno` — destino al que vuelve el cliente desde SPIDI. **No confía en nada que venga en la URL.** Muestra "Verificando tu pago…" y consulta el estado.
- `GET /api/orders/[token]/status` — estado actual del pedido (lee de nuestra base de datos).
- `GET /p/[token]/envio` — formulario de envío. **Solo accesible si el pedido está en `paid` o posterior** (se valida en el servidor).
- `POST /api/orders/[token]/shipping` — guarda los datos y dispara la notificación al admin.
- `GET /p/[token]/listo` — confirmación final con resumen del pedido y comprobante.

### Webhook
- `POST /api/webhooks/spidi` — recibe los avisos de SPIDI. Usa el **cuerpo crudo** para verificar la firma.

---

## 7. Reglas de negocio

1. **El monto lo calcula siempre el servidor**, nunca el cliente. El total se congela al crear el pedido (precios en snapshot).
2. **Moneda:** SPIDI liquida en VES. Si el producto tiene precio en USD, se convierte con la tasa de `Settings` al momento de generar el link y se guarda `exchange_rate_used`. La tasa la actualiza el admin a mano en la v1 (el campo debe quedar listo para sustituirse por una fuente automática). Sesiones menores a 14 VES o sobre `MAX_TX_VES` se bloquean con un mensaje claro.
3. **Stock:** se valida al generar el link y de nuevo al crear la sesión de pago. Se descuenta al pasar a `paid`. Si no hay stock tras un pago, el pedido se marca para revisión del admin.
4. **Sesión de pago:** `duration_minutes = 20`. Si el cliente vuelve al link con la sesión vencida y sin pago, se crea una sesión nueva. Si el pedido ya está pagado, se lleva al paso que corresponda.
5. **Verificación de pago** (de mayor a menor autoridad): webhook verificado → consulta de estado a SPIDI desde el servidor (fallback, con un mínimo de segundos entre consultas por pedido). La redirección a `/retorno` **nunca** es prueba de pago.
6. **Fase 1 vs fase 2:** al pasar la sesión a `paid` el pedido pasa a `paid` y se habilita el formulario de envío. Al llegar `payment_session.accredited` el pedido pasa a `accredited` y se guarda el desglose. Si la acreditación falla, el pedido pasa a `accreditation_failed` y se avisa al admin.
7. **Pago duplicado:** si llega más de un pago para el mismo pedido, se marca para revisión del admin. No se procesa dos veces.
8. **Datos de envío:** editables por el cliente hasta que el admin marque el pedido como despachado; después se bloquean (`locked_at`).
9. **Si el cliente paga y cierra la página** antes del formulario de envío, el admin ve el aviso "pagado, falta enviar datos" y usa **Reenviar link de envío**.
10. **Vigencia del link del pedido:** configurable (`link_validity_hours`). Pasado ese tiempo sin pago el pedido pasa a `expired`.

---

## 8. Formulario de envío

Campos comunes:
- Transportista (lista activa desde `Carrier`).
- Modalidad: **retira en oficina**, **a domicilio** o **retiro en tienda**, según lo que permita el transportista.
- Nombre y apellido completos de quien recibe.
- Cédula o RIF: tipo (V/E/J/G/P) y número, solo dígitos.
- Teléfono de contacto (móvil venezolano, `04XX-XXXXXXX` o `+58…`) con validación.
- Estado y ciudad/municipio.
- Si **oficina**: nombre de la oficina o sucursal de destino.
- Si **domicilio**: dirección completa y punto de referencia.
- Observaciones.

Los campos obligatorios por transportista se configuran en `Carrier.required_fields`. Mostrar texto de ayuda (ej. "Escribe la oficina tal como aparece en la web del transportista"). El formulario debe poder llenarse con una mano, en pantalla pequeña, con teclado numérico para cédula y teléfono.

---

## 9. Notificaciones por WhatsApp

Implementa una interfaz `Notifier` con adaptadores intercambiables:

1. **`WaMeAdapter` (por defecto en la v1):** el panel muestra el mensaje ya redactado y un botón que abre `wa.me` para que el admin lo envíe con un toque. No requiere cuentas ni costos.
2. **`WhatsAppCloudAdapter` (opcional, fase posterior):** API oficial de WhatsApp Cloud (Meta). Requiere verificación de negocio y plantillas de mensajes para mensajes iniciados por el negocio.

> **No uses librerías no oficiales de WhatsApp** (Baileys, whatsapp-web.js y similares): ponen en riesgo la cuenta del vendedor.

**Mensaje al admin** al recibir datos de envío (plantilla):
```
✅ Pedido P-0042 pagado
Producto: Zapatos X, talla 42 (x1)
Monto: Bs. 1.234,56
Ref. bancaria: 123456

📦 Envío por MRW — Retiro en oficina
Recibe: Nombre Apellido
C.I.: V-12345678
Tel: 0412-1234567
Destino: Estado, Ciudad — Oficina XYZ
Obs.: …
```
**Mensaje al cliente con el link de pago** (plantilla editable):
```
Hola {nombre}! Aquí está tu pedido {code}: {producto}.
Total: Bs. {monto}. Págalo aquí: {link}
Al pagar te pediremos los datos para el envío.
```

---

## 10. Seguridad y confiabilidad

- Token público del pedido aleatorio y largo; las rutas del cliente nunca exponen IDs secuenciales.
- **Webhooks:** verificar la firma y **rechazar** (respuesta de error, sin procesar) cualquier firma que no cuadre. Deduplicar por `idempotency-key` (el mismo aviso puede llegar más de una vez). Registrar todo en `WebhookEvent`.
- Todas las operaciones de creación hacia SPIDI llevan `Idempotency-Key`.
- **Botón Pagar bloqueado** mientras la petición está en vuelo (previene el doble débito).
- Datos personales (cédula, teléfono, dirección): acceso solo desde el admin, HTTPS siempre, sin registrarlos en logs.
- Nunca se tocan datos bancarios del cliente: el pago ocurre en SPIDI.
- Rate limiting en los endpoints públicos.
- Secretos solo en variables de entorno.
- Manejo explícito de desenlaces malos: pago fallido, sesión vencida, acreditación fallida.

**Variables de entorno (nombres sugeridos):**
`APP_BASE_URL, DATABASE_URL, SPIDI_ENV (simulator|sandbox|production), SPIDI_BASE_URL, SPIDI_CREDENTIALS_*` (según los docs), `SPIDI_WEBHOOK_SECRET` o el mecanismo que indique la documentación, `ADMIN_WHATSAPP, MAX_TX_VES, AUTH_SECRET, WHATSAPP_CLOUD_TOKEN` (opcional).

---

## 11. Requisitos de certificación de SPIDI

Para pasar a producción SPIDI valida cuatro elementos en la pantalla y cinco hechos en el código. Diséñalo así desde el inicio:

**En pantalla**
1. Leyenda de atribución **"Desarrollado por SPIDI"** con su logotipo (`TODO(SPIDI)`: obtener el logotipo y los lineamientos del Kit de Marca).
2. **Comprobante** verificable de cada pago exitoso, que le llegue al pagador (en la página `/listo`, descargable o enviable).
3. **Identificación del pago:** quién pagó, cuánto y con qué referencia bancaria.
4. **Botón de pago bloqueado** mientras la petición está en vuelo.

La marca también se certifica: sigue la guía "Qué texto poner en el botón" en la documentación del Botón.

**En el código**
- El estado se confirma desde el servidor (la redirección no es prueba).
- Se verifica la firma de los avisos y se **rechaza** la que no cuadra.
- Se deduplica por `idempotency-key`.
- Se manejan los desenlaces malos (pago fallido, sesión vencida, acreditación fallida).
- La configuración no está incrustada: el mismo código corre en simulador, sandbox y producción cambiando solo variables de entorno.

---

## 12. Fases y criterios de aceptación

**Fase 0 — Base.** Proyecto, base de datos, auth del admin, catálogo y generación de pedidos y links. *Aceptación:* el admin crea un producto y genera un link que abre la página del pedido en el celular.

**Fase 1 — Pago contra el simulador.** Integración con la API de SPIDI en `simulator`. *Aceptación:* un **ciclo completo cerrado**: se crea la sesión, se fuerza `paid`, se fuerza `accredited`, **nuestro servidor** recibe y verifica el webhook y el pedido avanza de estado. Además se ensayan estos desenlaces con el simulador: pago fallido, sesión vencida, acreditación fallida, aviso duplicado y firma inválida (debe rechazarse).

**Fase 2 — Envío y notificaciones.** Formulario de envío, bloqueo hasta que el pedido esté pagado, `WaMeAdapter`, panel de pedidos y detalle. *Aceptación:* tras forzar `paid`, el cliente es redirigido al formulario, lo envía y el admin ve el mensaje listo para WhatsApp con todos los datos.

**Fase 3 — Pulido y pre-certificación.** Comprobante, atribución de SPIDI, bloqueo del botón, recordatorios de "pagado sin envío", expiración de pedidos, pruebas automatizadas. *Aceptación:* la lista de la sección 11 se cumple punto por punto y está demostrada.

**Fase 4 — Sandbox, certificación y producción.** Repetir el recorrido en sandbox, solicitar la reunión de certificación y cambiar a credenciales de producción solo con variables de entorno. *Aceptación:* credenciales de producción recibidas y un pago real de prueba de bajo monto completado.

**Fase 5 (opcional).** WhatsApp Cloud API, tasa de cambio automática, varios admins/tiendas, SDK de SPIDI para pagar dentro de la página, reportes y exportar a Excel.

---

## 13. Pendientes por confirmar

`TODO(SPIDI)` — resolver con SPIDI (hola@mispidi.com) o con el asesor comercial:
1. ¿Qué métodos de pago están habilitados hoy (Débito Inmediato, Pago Móvil/C2P, cripto) y cuáles ve el cliente?
2. ¿Cada comercio certifica por separado, o quien construye la integración certifica una vez? ¿Qué datos formales de empresa piden?
3. Comisión que se aplicará y si hay participación para quien implementa.
4. Tope por transacción vigente (BCV) y cuánto tarda hoy la certificación.
5. Si existe un programa de aliados o referidos.
6. Logotipo de SPIDI y lineamientos de marca.

Pendientes del dueño del producto:
- Número de WhatsApp del admin y nombre/logo de la tienda.
- Lista final de transportistas y sus campos obligatorios.
- Si el aviso de envío debe llegar solo al admin o también al cliente.
- Fuente de la tasa de cambio (manual en la v1).

---

## 14. Fuera de alcance de la v1

Carrito de compras público, cuentas de cliente, cobros recurrentes, reembolsos automáticos, integración con los sistemas de las transportistas (generar guías por API), facturación fiscal y reparto de pagos (split).
