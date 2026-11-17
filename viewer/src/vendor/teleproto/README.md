# teleproto (copia)

El cliente de Telegram de la biblioteca Telegram: [teleproto](https://github.com/sanyok12345/teleproto) 1.232.1 (MIT,
`LICENSE`), el fork mantenido de GramJS (el paquete `telegram`, archivado). Habla MTProto con Telegram por WebSocket
(`wss://*.web.telegram.org/apiws`) desde el propio dispositivo o navegador, sin servidor en medio. Lo usa
`src/lib/telegram.ts`, que lo carga solo cuando hace falta (`await import`).

Va empaquetado en un solo ESM (`teleproto.js`, ~1,5 MB; ~430 KB comprimido) en vez de como dependencia porque las tres
apps compilan el visor desde el código con configuraciones de Vite distintas; así ninguna tiene que saber de sus
dependencias. Dentro van `cifrante`, `buffer`, `big-integer`, `mime`, `base64-js` e `ieee754` (sus licencias, todas
permisivas, en `THIRD_PARTY_NOTICES`). En navegador no necesita polyfills. `teleproto.d.ts` declara solo lo que se
usa, sin tipos (`telegram.ts` pone los suyos).

Para actualizar (con una versión de al menos dos semanas), en una carpeta aparte:

```sh
npm init -y && npm i teleproto@<versión> esbuild@0.24.2
echo 'export { TelegramClient, Api, sessions, errors } from "teleproto";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020,chrome105,safari16 \
  --minify --legal-comments=none --outfile=teleproto.js
```

y copiar `teleproto.js`, el `LICENSE` de teleproto y rehacer `THIRD_PARTY_NOTICES` con las licencias de lo que entre
(`npx esbuild … --metafile=meta.json` dice qué paquetes van dentro). Probar después: alta con QR, lista de canales,
documentos de un canal y una descarga.
