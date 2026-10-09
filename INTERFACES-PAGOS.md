# Kiosco y creador de links

Ambas pantallas usan el backend `api/index.js`, que importa la firma canónica
corregida de `lib/skylink.js`. No hay fórmulas HMAC en el navegador.

## Ejecutar

```powershell
npm start
```

- Kiosco: http://localhost:3000/autopago
- Admin: http://localhost:3000/admin

Estas dos rutas comparten el mismo proceso y las mismas órdenes en memoria.
Para iniciar en otro puerto en PowerShell:

```powershell
$env:PORT='3010'
npm start
```

La instancia verificada durante esta edición se inició en 3010 porque 3000 ya
estaba ocupado. El admin independiente también se verificó en 3001 con
`node server-admin.js`; al ser otro proceso, sus órdenes en memoria son independientes.

## Cambios

- Diseño compartido en `public/pay-ui.css`: colores neutros, acento verde, menos
  decoraciones, total en Bs. destacado y adaptación a pantallas estrechas.
- Kiosco: controles de cantidad, entrada de código, diálogo de pago, QR y enlace
  oficial. Cerrar y reabrir el diálogo conserva el enlace mientras no cambie el carrito.
- Admin: catálogo, monto personalizado en USD, datos opcionales del cliente,
  historial, copia de enlace y preparación del mensaje para WhatsApp.
- Bloqueo de creación en curso y errores visibles sin sustituir tokens faltantes.
- Tasa identificada como configurada manualmente: no se afirma que el valor inicial
  sea una cotización BCV vigente. La minitienda separada sigue trabajando directamente en Bs.

## Verificación realizada

- Las siete pruebas automatizadas pasaron, incluyendo una que atraviesa ambas
  rutas de creación y comprueba que usan el transporte HMAC compartido.
- Desde el kiosco: arroz mediante código de barras, creación de orden por Bs. 41,25.
- Desde el admin independiente: chocolate, creación de orden por Bs. 37,50.
- Verificada la actualización de cantidades y la reutilización del enlace al reabrir.
- Revisadas las interfaces en navegador. No se solicitó acceso físico a la cámara
  ni se realizó un pago. La lectura por cámara depende del navegador y sus permisos.

La creación de enlaces quedó verificada; esto no constituye certificación de
producción. Persistencia de órdenes, autenticación del admin y confirmación del
ciclo de pago completo siguen siendo trabajo separado.
