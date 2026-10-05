# 🛒 Sistema de Pagos SPIDI & Panel de Ventas WhatsApp con Factura Digital y MRW

Implementación integral de pasarela de pagos con **SPIDI** (Banco Sofitasa / Pagos Móviles C2P / Débito Inmediato en Venezuela) compuesta por dos soluciones independientes construidas sobre Node.js nativo sin dependencias externas:

1. **Kiosco de Autopago (Puerto 3000):** Pantalla para puntos de venta físicos o autoservicio con soporte para pago directo o vía Código QR móvil sincronizado en tiempo real.
2. **Panel de Ventas & Cobros por WhatsApp (Puerto 3001):** Panel para vendedores donde seleccionan productos, generan enlaces de verificación en doble moneda (USD y Bs. al cambio oficial BCV), redirigen al pago SPIDI y finalmente a una **Factura Digital** con formulario de encomiendas **MRW** y botón para despachar todo el reporte por WhatsApp en 1 clic.

---

## 🌟 Características Principales

### 🛒 1. Kiosco de Autopago (`http://localhost:3000`)
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

### 📦 2. Panel Admin & Ventas por WhatsApp (`http://localhost:3001`)
- **Armado de Pedidos y Cotización Oficial:**
  - Selección de productos y cantidades.
  - Conversión automática a Bolívares usando la **Tasa Oficial del Banco Central de Venezuela (BCV)**.
- **Subpágina de Verificación Previa (`checkout.html`):**
  - El cliente recibe el enlace por WhatsApp y visualiza el detalle antes de procesar el pago.
  - Muestra el monto total en **USD ($)** y en **Bs.**
- **Redirección a Factura Digital (`factura.html`):**
  - Sello oficial de aprobación bancaria respaldado por SPIDI y Banco Sofitasa.
  - Referencia bancaria, fecha, hora y lista de productos comprados.
  - Formulario de encomienda **MRW**: Destinatario, Cédula, Teléfono, Estado, Ciudad y Agencia MRW de destino.
  - **Botón `📲 Enviar Factura y Datos MRW por WhatsApp`:** Guarda el envío en el sistema y abre WhatsApp con el reporte unificado (comprobante + guía MRW) listo para enviar a la tienda.
  - Opción de copiar texto al portapapeles e imprimir factura / exportar a PDF limpia.

---

## 🚀 Puesta en Marcha

### Requisitos
- **Node.js** (v16 o superior).
- No requiere `npm install` (arquitectura de cero dependencias con módulos nativos de Node.js).

### Ejecución de los Servicios

```bash
# Iniciar Kiosco de Autopago (Puerto 3000)
node server.js

# Iniciar Panel Administrativo & WhatsApp (Puerto 3001)
node server-admin.js
```

O usando los scripts de `npm`:

```bash
npm run start:kiosk
npm run start:admin
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
├── server.js                 # Servidor del Kiosco de Autopago (Puerto 3000)
├── server-admin.js           # Servidor del Admin, WhatsApp & Facturación (Puerto 3001)
├── package.json              # Configuración y comandos de ejecución
├── .gitignore                # Archivos ignorados por git
├── public/                   # Frontend del Kiosco (Puerto 3000)
│   ├── index.html            # Pantalla principal del autoservicio y QR
│   ├── resultado.html        # Pantalla de éxito / fallo con explicaciones bancarias
│   └── chat.html             # Interfaz de cobro alternativo
└── public-admin/             # Frontend del Admin y Clientes (Puerto 3001)
    ├── index.html            # Panel de control de ventas y pedidos
    ├── checkout.html         # Subpágina de verificación para el cliente
    ├── factura.html          # Factura Digital + Formulario MRW + Botón WhatsApp
    ├── error-pago.html       # Manejo amigable de errores bancarios con 1-clic retry
    └── envio.html            # Registro de encomiendas
```

---

## 📄 Licencia
MIT
