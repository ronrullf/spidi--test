# Skylink: firma corregida y links verificados

## Resultado — 8 de octubre de 2026

La explicación completa y las reglas para evitar repetir el fallo están en la
[guía de firma HMAC para personas, desarrolladores y LLM](GUIA-FIRMA-HMAC-SKYLINK.md).

Con el ejemplo ejecutable enviado por soporte (`create-transaction-example.js`) se
corrigió el cliente compartido `lib/skylink.js`. Pruebas reales contra el ambiente dev:

- POST de diagnóstico, Bs. 30: HTTP 201 a las 19:50:47 UTC (15:50:47 Venezuela).
- Botón de la minitienda, Bs. 22: creación exitosa y enlace devuelto por Skylink.
- GET por el token de esa orden: HTTP 200, success: true, amount: 2200, status: created.
- Orden: TIENDA-93f1716f-596c-465a-9529-f37a8efefc21.

No se pagó ni se debitó dinero. Se verificó la creación y consulta de órdenes impagas.

## Causa encontrada

Las capturas del panel indicaban `timestamp.METHOD.path.body`. El ejemplo ejecutable
de soporte utiliza un formato diferente que la API sí acepta:

```text
METHOD
PATH
TIMESTAMP
BODY_CANONICO
```

Los componentes se separan con saltos de línea (`\n`), no puntos. El método va primero.
El JSON ordena alfabéticamente sus claves de primer nivel y omite campos undefined.
Para GET/HEAD se firma el texto `null`, pero no se envía cuerpo HTTP. El path empieza
con / y excluye los parámetros de consulta. La clave es texto, la hora va en
milisegundos y el resultado HMAC-SHA256 se expresa en hexadecimal.

Se añadieron Accept: application/json e Idempotency-Key para solicitudes con cuerpo,
como en el ejemplo de soporte. Se mantiene la verificación TLS activa.
No se aisló experimentalmente cuál de cada una de estas diferencias exige el servidor;
se verificó que el formato completo de soporte funciona.

La clave configurada sí funciona con ese formato. No hacía falta una VPS ni otra
interfaz. La evidencia anterior de Firma inválida era real, pero no justificaba
atribuirla a una clave incorrecta. La sesión del panel de 15 minutos era una dependencia
separada y ya fue eliminada.

## Para no repetirlo

- Usar el único cliente HMAC de lib/skylink.js para tienda, admin y diagnósticos.
- No copiar la fórmula con puntos de las capturas antiguas.
- Firmar el cuerpo canónico y enviarlo sin serializarlo nuevamente.
- Crear una firma por solicitud; jamás copiar una firma temporal del panel.
- Guardar las credenciales en .env o variables del despliegue, fuera del navegador.
- Usar únicamente el token y URL confirmados por Skylink; no fabricar tokens ante errores.
- Ejecutar npm test antes de cambiar el cliente de pagos.

## Ejecutar

Node.js 24. .env está ignorado por Git; usar .env.example como plantilla.

```powershell
node tienda/server.js
# http://localhost:3002
npm test
npm run diagnose:skylink
# Consulta de solo lectura; no imprime transacciones de clientes.
npm run diagnose:skylink -- --create
# Crea UNA orden impaga de Bs. 30.
node scripts/generate-skylink-curl.js | Set-Clipboard
# Genera un cURL de Bs. 25 para ReqBin; incluye la clave: no publicarlo.
```

Reiniciar cualquier servidor que ya estuviera abierto para cargar el cliente nuevo.
En Vercel, desplegar los cambios y configurar las variables equivalentes.

Las seis pruebas automáticas cubren firma con valor esperado independiente, orden de
campos, GET firmado con null, bytes UTF-8, rechazos, cuatro rutas de creación,
no exposición de la clave, precios decididos por servidor y deduplicación local.

## Límites

La minitienda guarda intentos y el proyecto principal guarda órdenes en memoria.
No se ha certificado producción, confirmado un pago real con esta corrección ni probado
todos los endpoints C2P. Sigue pendiente revisar autenticación, persistencia y tasa BCV
del proyecto principal. La minitienda trabaja directamente en Bs.

La cabecera de idempotencia replica el ejemplo e incluye timestamp; por sí sola no evita
reintentos con timestamps nuevos. No reintentar automáticamente tras un timeout:
consultar primero el panel usando la referencia de la orden.
