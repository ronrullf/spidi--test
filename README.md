# 🛒 Sistema de Pagos SPIDI & Panel de Ventas WhatsApp con Factura Digital y MRW

Implementación integral de pasarela de pagos con **SPIDI** (Banco Sofitasa / Pagos Móviles C2P / Débito Inmediato en Venezuela) con arquitectura unificada lista para despliegue en **Vercel** o ejecución local sobre Node.js nativo sin dependencias externas:

1. **Kiosco de Autopago (`/autopago` o `/`):** Pantalla para puntos de venta físicos o autoservicio con soporte para pago directo en pantalla o vía Código QR móvil sincronizado en tiempo real.
2. **Panel Admin de Ventas por WhatsApp (`/admin`):** Panel para vendedores donde seleccionan productos, generan enlaces de verificación en doble moneda (USD y Bs. al cambio oficial BCV), redirigen al pago SPIDI y finalmente a una **Factura Digital** con formulario de encomiendas **MRW** y botón para despachar todo el reporte por WhatsApp en 1 clic.

---

## 🌐 Rutas Disponibles (Tanto en Vercel como en Local)

Cuando lo despliegues en **Vercel** tendrás enlaces independientes para cada función bajo tu propio dominio:

| Módulo / Función | Ruta en Vercel / Producción | Ruta en Localhost |
| :--- | :--- | :--- |
| 🛒 **Kiosco de Autopago** | `https://tu-app.vercel.app/autopago` (o `/`) | `http://localhost:3000/autopago` |
| 📦 **Admin Creación de Links** | `https://tu-app.vercel.app/admin` | `http://localhost:3000/admin` |
| 🔍 **Verificación Previa Cliente** | `https://tu-app.vercel.app/checkout?order_id=...` | `http://localhost:3000/checkout?order_id=...` |
| 🧾 **Factura Digital & MRW** | `https://tu-app.vercel.app/factura?order_id=...` | `http://localhost:3000/factura?order_id=...` |
| ❌ **Manejo de Error Bancario** | `https://tu-app.vercel.app/error-pago?order_id=...` | `http://localhost:3000/error-pago?order_id=...` |
| ⚡ **API Serverless Unificada** | `https://tu-app.vercel.app/api/...` | `http://localhost:3000/api/...` |

---

## 🌟 Características Principales

### 🛒 1. Kiosco de Autopago (`/autopago`)
- **Catálogo Interactivo:** Selección rápida de productos de consumo masivo con desglose de ítems y precios.
- **Doble Modalidad de Pago:**
  - **Pago en Kiosco:** Ingreso de credenciales bancarias (Banco, Cédula, Teléfono, OTP C2P).
  - **Pago con Código QR Móvil:** El cliente escanea con su smartphone, paga en su navegador y el kiosco detecta la aprobación automáticamente cerrando la ventana.
- **Gestión Inteligente de Rechazos Bancarios:**
  - Código `111111`: Saldo Insuficiente.
  - Código `222222`: Clave dinámica / OTP inválida.
  - Código `333333`: Límite bancario excedido.
  - Botón de reintento inmediato en 1 clic conservando el carrito.

---

### 📦 2. Panel Admin & Ventas por WhatsApp (`/admin`)
- **Armado de Pedidos y Cotización Oficial:**
  - Selección de productos y cantidades.
  - Conversión automática a Bolívares usando la **Tasa Oficial del Banco Central de Venezuela (BCV)**.
- **Subpágina de Verificación Previa (`/checkout`):**
  - El cliente recibe el enlace por WhatsApp y visualiza el detalle antes de procesar el pago.
  - Muestra el monto total en **USD ($)** y en **Bs.**
- **Redirección a Factura Digital (`/factura`):**
  - Sello oficial de aprobación bancaria respaldado por SPIDI y Banco Sofitasa.
  - Referencia bancaria, fecha, hora y lista de productos comprados.
  - Formulario de encomienda **MRW**: Destinatario, Cédula, Teléfono, Estado, Ciudad y Agencia MRW de destino.
  - **Botón `📲 Enviar Factura y Datos MRW por WhatsApp`:** Guarda el envío en el sistema y abre WhatsApp con el reporte unificado (comprobante + guía MRW) listo para enviar a la tienda.
  - Opción de copiar texto al portapapeles e imprimir factura / exportar a PDF limpia.

---

## 🚀 Despliegue en Vercel

Este proyecto ya incluye `vercel.json` y `api/index.js` preconfigurados para Vercel:

1. Haz un push a tu repositorio en GitHub (o conecta tu cuenta de GitHub con Vercel).
2. En [Vercel](https://vercel.com), presiona **"Add New Project"** e importa el repositorio `ronrullf/spidi--test`.
3. Haz clic en **"Deploy"** (no requiere configuración de build ni dependencias adicionales).
4. ¡Listo! Vercel te dará una URL como `https://spidi--test.vercel.app` donde:
   - `https://spidi--test.vercel.app/autopago` será tu Kiosco.
   - `https://spidi--test.vercel.app/admin` será tu Panel de Enlaces para WhatsApp.

---

## 💻 Ejecución Local

### Requisitos
- **Node.js** (v16 o superior).
- No requiere `npm install` (arquitectura de cero dependencias con módulos nativos de Node.js).

### Iniciar Servidor Unificado Local

```bash
node server.js
```

O usando npm:

```bash
npm start
```

---

## 🧪 Códigos de Simulación SPIDI

En el entorno de pruebas de SPIDI (`sim.mispidi.com`), puedes probar los diferentes comportamientos ingresando los siguientes códigos en el campo **OTP / Clave Temporal**:

| Código OTP | Resultado | Comportamiento |
| :--- | :--- | :--- |
| `000000` | ✅ **Aprobado** | Genera referencia bancaria y redirige a la Factura Digital (`factura.html`) |
| `111111` | ❌ **Saldo Insuficiente** | Redirige a pantalla de error explicando falta de fondos con botón de reintento |
| `222222` | ❌ **Clave Inválida** | Redirige a pantalla de error explicando clave errónea para reingreso |
| `333333` | ❌ **Límite Excedido** | Explica que se superó el límite diario de transferencias de la cuenta |

---

## 📂 Estructura del Proyecto

```
spidi/
├── api/
│   └── index.js              # Entrypoint Serverless para Vercel
├── vercel.json               # Configuración de rutas y rewrites para Vercel
├── server.js                 # Servidor Maestro Unificado (Autopago + Admin + APIs)
├── server-admin.js           # Servidor alternativo para puerto 3001
├── package.json              # Configuración y comandos de ejecución
├── .gitignore                # Filtro de archivos git
└── public/                   # Frontend estático unificado
    ├── index.html            # Kiosco de Autopago (raíz /)
    ├── autopago.html         # Kiosco de Autopago (/autopago)
    ├── admin.html            # Panel Administrativo de WhatsApp (/admin)
    ├── checkout.html         # Subpágina de verificación para el cliente (/checkout)
    ├── factura.html          # Factura Digital + Envíos MRW + WhatsApp (/factura)
    ├── error-pago.html       # Manejo amigable de errores bancarios (/error-pago)
    ├── resultado.html        # Pantalla de resultado del Kiosco (/resultado)
    └── chat.html             # Interfaz de cobro alternativo
```

---

## 📄 Licencia
MIT
