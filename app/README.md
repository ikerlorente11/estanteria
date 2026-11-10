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
npx expo prebuild --platform android                 # genera android/ (no va a git)
cd android && ./gradlew assembleDebug                # dev client: android/app/build/outputs/apk/debug/
```

MIUI cancela `adb install` sin diálogo: copiar el APK con `adb push … /sdcard/Download/` e instalarlo desde Archivos.

Con el dev client instalado, el día a día es sin recompilar:

```
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:5173 tcp:5173
npm --prefix web run dev                             # Vite: la página con recarga en caliente
npx expo start --dev-client --localhost              # Metro: el JS de React Native
```

En desarrollo (`.env.development`) el WebView carga la página de `http://localhost:5173` (Vite en el PC, por
`adb reverse`) y habla con el host de la tablet en `http://127.0.0.1:48123` (`?host=`; el host responde con CORS).
Así un cambio en `web/` o en `../viewer` se ve al guardar. Solo el Kotlin necesita `assembleDebug` otra vez.

Para la app de verdad, la página va en los assets nativos del módulo (dentro del APK): `npm run web:build` antes de
compilar, y un cambio del visor necesita build nueva (EAS Update solo lleva el JS de React Native, aquí casi nada).

Publicar: `eas build -p android --profile production` y `eas submit` (pista interna de Play), como liftlog.
