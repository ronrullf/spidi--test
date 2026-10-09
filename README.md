# 🛒 Skylink Pay (Valink Group) · Autopago & Cobro por Link con Agente IA WhatsApp

**Antes de integrar o modificar la firma:** leer la [guía detallada de HMAC de Skylink](GUIA-FIRMA-HMAC-SKYLINK.md), con explicación sencilla, contrato exacto, vectores verificables y diagnóstico para desarrolladores y LLM.

> **Estado verificado (8 de octubre de 2026):** creación de links corregida con el ejemplo
> ejecutable de soporte: HTTP 201 al crear y HTTP 200 al consultar por token.
> Ver [diagnóstico y pasos de ejecución](DIAGNOSTICO-SKYLINK.md).
> Usar Node.js 24, variables del servidor en `.env` (ver `.env.example`) y `npm test`.
> La creación fue validada; esto no certifica cobros reales ni todo el flujo de producción.

Implementación integral de pasarela de pagos con **Skylink Pay (Valink Group)** (Pago Móvil C2P, Débito Inmediato y Checkout en Bolívares con conversión oficial BCV) con arquitectura unificada lista para despliegue en **Vercel** o ejecución local sobre Node.js nativo sin dependencias externas:

1. **Modelo 1 — Kiosco de Autopago (`/autopago` o `/`):**
   - Escáner de productos por cámara y lector de códigos de barras (incluye `7591473005492` Arroz Blanco 1kg, Harina PAN, Café, etc.).
   - Carrito con cotización en tiempo real en **USD y Bolívares (BCV)**.
   - Modal de pago con 3 opciones claras:
     - **Opción A (Celular / QR):** Genera código QR y enlace de pago para escanear con el smartphone y pagar en la pasarela Skylink Pay.
     - **Opción B (En Pantalla - C2P Directo):** Formulario nativo en la pantalla del kiosco para ingresar Banco (Bancamiga, Venezuela, Banesco, Mercantil, etc.), Cédula, Teléfono, solicitar OTP o ingresar clave dinámica OTP y procesar el cobro de inmediato sin salir del kiosco.
     - **Opción C (Cancelar):** Botón visible para regresar a la cuenta y seguir agregando o modificando productos.
   - Comprobante / Ticket digital con respaldo bancario de Skylink Pay, desglose de productos y botón de impresión física.

2. **Modelo 2 — Cobro por Link Automatizado (`/admin` y `/chat`):**
   - **Panel Admin (`/admin`):** Generación de enlaces de pago con cotización oficial BCV y conversión a céntimos enteros para Skylink Pay. Botón para compartir cotización pre-armada por WhatsApp (`wa.me`).
   - **Agente WhatsApp con IA (`/chat`):** Chat interactivo que procesa pedidos en lenguaje natural (ej: *"Quiero 2 kilos de arroz y 1 café"*), cotiza a tasa BCV, genera el enlace de pago seguro de Skylink Pay, monitorea la acreditación y registra los datos de despacho asignando el código interno `INT-XXXXXX` con el mensaje exacto requerido:
     ```text
     ✅ ¡Datos de envío registrados con éxito! 📦
     📌 Código interno de despacho: INT-XXXXXX
     👤 Destinatario: ...
     📍 Datos: ...
     Cuando tengamos tu guía de envío te la haremos llegar por aquí. ¡Muchas gracias por tu compra! 🙌
     ```

---

## 🌐 Rutas Disponibles

| Módulo / Función | Ruta en Vercel / Producción | Ruta en Localhost |
| :--- | :--- | :--- |
| 🛒 **Kiosco de Autopago** | `https://tu-app.vercel.app/autopago` (o `/`) | `http://localhost:3000/autopago` |
| 📦 **Admin Creación de Links** | `https://tu-app.vercel.app/admin` | `http://localhost:3000/admin` |
| 🤖 **Agente Chat WhatsApp IA** | `https://tu-app.vercel.app/chat` | `http://localhost:3000/chat` |
| 🔍 **Verificación Previa Cliente** | `https://tu-app.vercel.app/checkout?order_id=...` | `http://localhost:3000/checkout?order_id=...` |
| 🧾 **Factura Digital & Despacho** | `https://tu-app.vercel.app/factura?order_id=...` | `http://localhost:3000/factura?order_id=...` |
| ❌ **Manejo de Error Bancario** | `https://tu-app.vercel.app/error-pago?order_id=...` | `http://localhost:3000/error-pago?order_id=...` |
| ⚡ **API Serverless Unificada** | `https://tu-app.vercel.app/api/...` | `http://localhost:3000/api/...` |

---

## ⚙️ Integración con Skylink Pay (Valink Group)

La pasarela se comunica con `https://dev-axis-payment.valinkgroup.com` implementando la firma criptográfica HMAC-SHA256:

- **Firma:** `HMAC-SHA256("METHOD\nPATH\nTIMESTAMP\nBODY_CANONICO")` usando el `SKYLINK_API_KEY`.
- **Cuerpo firmado:** JSON con claves de primer nivel ordenadas alfabéticamente, sin `undefined`. En GET se firma `null` y no se envía cuerpo. PATH excluye los parámetros de consulta.
- **Headers:** `X-Api-Key`, `X-Commerce-Code`, `X-Commerce-Id`, `X-Timestamp`, `X-Signature`.
- **Moneda:** Todos los montos en Bolívares se envían en céntimos enteros: `Math.round(montoBs * 100)`.
- **Endpoints soportados:**
  - `POST /api/v1/merchant/transactions` — Crear transacción y obtener token de pago.
  - `POST /api/v1/merchant/c2p` — Cobro directo C2P en pantalla con OTP.
  - `POST /pay/{token}/otp` — Solicitar OTP de Pago Móvil para el checkout.
  - `POST /pay/{token}` — Confirmar pago C2P público con OTP.
  - `GET /api/v1/merchant/transactions/token/{token}` — Consultar estado de la transacción.

---

## 💻 Ejecución Local

```bash
# Iniciar servidor nativo (puerto 3000 por defecto)
node server.js
```

Abre en tu navegador:
- Kiosco: [http://localhost:3000/](http://localhost:3000/)
- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Chat IA WhatsApp: [http://localhost:3000/chat](http://localhost:3000/chat)

---

## 🧪 Códigos de Prueba C2P

En el formulario en pantalla de Kiosco o Checkout puedes probar los siguientes códigos OTP:

| Código OTP | Resultado | Descripción |
| :--- | :--- | :--- |
| `000000` | ✅ **Aprobado** | Genera referencia bancaria y emite el ticket digital / factura |
| `111111` | ❌ **Fondos Insuficientes** | Rechazo por saldo insuficiente en la cuenta bancaria |
| `222222` | ❌ **Clave Inválida** | Clave dinámica OTP incorrecta o vencida |
| `333333` | ❌ **Límite Excedido** | Límite diario de transferencias o Pago Móvil superado |
