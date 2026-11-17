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
- `Shelf.kt`: los archivos del dispositivo (carpetas y «Abrir con»): cómics cbz/zip, cbr/rar, cb7/7z y cbt/tar, PDF, DjVu
  y libros epub, mobi (azw, azw3, prc), fb2, fbz (.fb2.zip) y txt. Los libros (foliate-js) y el DjVu (djvu-rs) los pinta el
  visor con el archivo entero: el host solo los lista y saca la portada (`Books.kt`: MOBI por EXTH 201, FB2 por
  `<coverpage>`; TXT y DjVu sin portada). Las páginas AVIF y JPEG XL salen como JPEG: AVIF lo decodifica Android 12+,
  JPEG XL `jxl-coder` (libjxl, ~5 MB de .so por arquitectura).
- `app.json`: «Abrir con» por tipo MIME y, para lo que los exploradores mandan como `application/octet-stream`, por el
  final del nombre (`pathPattern` no retrocede: un patrón por cada punto antes de la extensión).

## Desarrollo

```
npm install && npm --prefix web install
npm run web:build                                    # la página, a los assets del módulo
npx expo prebuild --platform android                 # genera android/ (no va a git)
cd android && ./gradlew assembleDebug                # dev client: android/app/build/outputs/apk/debug/
```

MIUI cancela `adb install` sin diálogo: copiar el APK con `adb push … /sdcard/Download/` e instalarlo desde Archivos.
En Windows, CMake se ahoga con rutas de más de 260 caracteres (`ninja: error: Stat(...)`): compilar desde una unidad corta
(`subst S: C:\...\estanteria` y `cd S:\app\android`; el proyecto no puede ser la raíz de la unidad, el autolinking de Expo no
encontraría su package.json), y para una dev build basta `reactNativeArchitectures=arm64-v8a` en
`android/gradle.properties` (tarda la mitad). Expo SDK 58 compila contra Android 16: `sdkmanager "platforms;android-37.0" "build-tools;37.0.0"`.

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

## Credenciales de Telegram

La biblioteca Telegram necesita las credenciales de la app en la API de Telegram (`api_id` y `api_hash`, de
my.telegram.org). El repo es público: **no van en él**. La página las toma al compilarse (Vite) de
`VITE_TELEGRAM_API_ID` y `VITE_TELEGRAM_API_HASH` (`store.telegram` en `web/src/App.vue`); si faltan, la app funciona
igual pero sin biblioteca Telegram.

- **EAS** (`eas build` y `npm run release`): variables de entorno del proyecto en el entorno `production`
  (`eas env:create --environment production --name VITE_TELEGRAM_API_ID --value … --visibility sensitive`, y lo mismo
  con `VITE_TELEGRAM_API_HASH`; o en expo.dev, Project → Environment variables). El perfil `production` (y `apk`, que lo
  extiende) compila en ese entorno, y `eas-build-post-install` hace `web:build` con ellas ya en el entorno.
- **Local** (`npm run web:build`, `npm run update`, `npm --prefix web run dev`): un `web/.env.local` (ignorado por git):

  ```
  VITE_TELEGRAM_API_ID=…
  VITE_TELEGRAM_API_HASH=…
  ```

  `npm run update` construye la página con `web:build` antes de `eas update`, en local: el `--environment production`
  de `eas update` no llega a Vite, así que hace falta el `.env.local` (o `eas env:exec production "npm run web:build"`,
  si las variables no son de visibilidad «secret»).

Van dentro del JavaScript de la página (como en cualquier cliente de Telegram, no son un secreto frente a quien abra el
APK): lo que se evita es publicarlas en el repo. La sesión de cada persona sí es secreta: el host la guarda cifrada con el
keystore (`/host/secret`, en las EncryptedSharedPreferences de `Settings.kt`).
