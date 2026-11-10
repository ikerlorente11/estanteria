# La Estantería para Android

La app Android (Expo 54) enseña el visor compartido (`../viewer`) en un WebView. Lo que el WebView no puede
hacer lo hace un **host nativo** (`modules/estanteria-host`, módulo Expo en Kotlin): un servidor HTTP en
`127.0.0.1:48123` que sirve la página del visor (empaquetada en los assets del módulo), hace de proxy del
servicio de La Estantería añadiendo la credencial del usuario (la página nunca ve la contraseña de
aplicación; sin CORS que configurar), y será quien lea los archivos del dispositivo y guarde las descargas
para leer sin conexión. Todo lo que no sea la propia página exige el token que la app pasa al cargarla.

- `App.tsx`: arranca el host, muestra el WebView, botón atrás, pantalla encendida al leer, «Abrir con».
- `web/`: la página (Vue + Vite): `src/App.vue` es el shell (conexión, navegación por el hash) y
  `src/lib/host.ts` habla con el host. `npm run build` la deja en
  `modules/estanteria-host/android/src/main/assets/viewer/` (no va a git: se construye antes de compilar).
- `modules/estanteria-host/android/.../HostServer.kt`: las rutas del host; `Settings.kt`: dirección, usuario
  y contraseña (cifrada con el keystore); `Events.kt`: progreso de descargas y subidas por SSE.

## Desarrollo

```
npm install && npm --prefix web install
npm run web:build                                    # la página, a los assets del módulo
npx expo run:android --variant release --device <id> --no-bundler   # APK firmado con la clave de debug, en el móvil
```

Al tocar `web/`, `../viewer` o el Kotlin: `npm run web:build` y recompilar. La página va en los assets nativos
del módulo (dentro del APK), así que un cambio del visor necesita build nueva, no vale con EAS Update (que solo
lleva el JS de React Native, aquí casi nada).

Publicar: `eas build -p android --profile production` y `eas submit` (pista interna de Play), como liftlog.
