# La Merienda — minitienda de prueba

Desde la carpeta principal `Skypay`, ejecuta:

```powershell
node tienda/server.js
```

Abre http://localhost:3002. Selecciona un producto y pulsa **Generar link de pago**.
El catálogo ofrece Bs. 22, 30, 45 y 60. Cada prueba compra una unidad del producto
seleccionado. El precio se decide en el servidor y se envía como 2200, 3000, 4500 o
6000 céntimos; no usa dólares ni tasa BCV.

La clave se lee del `.env` del proyecto principal mediante `../lib/skylink.js`.
No hace falta iniciar los otros servidores, iniciar sesión en Skylink ni instalar
dependencias. Requiere Node.js 24. No abrir index.html haciendo doble clic: usar la URL.

La interfaz se construyó desde cero; comparte únicamente el cliente HMAC del proyecto.
El botón crea una orden, no efectúa un pago. Si Skylink acepta la firma, se muestra
su URL real. Si rechaza, se muestra su mensaje y el detalle HTTP, sin fabricar enlaces.
Los diagnósticos no muestran claves, cookies ni firmas.

Se conserva el resultado de cada intento en memoria para evitar duplicarlo con un
doble clic. Se pierde al reiniciar. Ante un timeout, verifica primero el panel de Skylink
antes de iniciar otro intento. Esto es una prueba local, no una tienda de producción:
no tiene inventario, entrega, almacenamiento persistente ni verificación de pago.

La firma se corrigió usando el ejemplo ejecutable enviado por soporte. Validado:
HTTP 201 al crear una orden de Bs. 22 desde el botón y HTTP 200 al consultar su token.
No se realizó ningún pago. Ver `../DIAGNOSTICO-SKYLINK.md` para la causa y el formato correcto.

Pruebas locales sin cobros:

```powershell
node --test --test-isolation=none tienda/server.test.js
```
