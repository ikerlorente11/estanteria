# qrcode-generator (copia)

El QR del alta en Telegram: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 de Kazuhiko
Arase (MIT; el aviso de la licencia va en la cabecera de `qrcode.js`), el `dist/qrcode.mjs` del paquete npm tal cual,
renombrado a `qrcode.js`. Lo usa `src/views/TelegramLogin.vue`, que dibuja el QR como SVG en la propia página (sin
pedir nada fuera: las apps y la web del Archivador no cargan scripts de otros sitios). `qrcode.d.ts` es propio: solo
lo que se usa.

Para actualizar: `npm pack qrcode-generator@<versión>` y copiar `dist/qrcode.mjs` como `qrcode.js`.
