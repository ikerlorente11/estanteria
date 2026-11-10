import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The built page goes into the host module's assets: the app's local server serves it from there
// (modules/estanteria-host, HostServer.kt). Relative paths, as it is served at http://127.0.0.1:<port>/.
export default defineConfig({
  plugins: [vue(), {
    // every request the device makes, in the terminal (development only)
    name: 'log-requests',
    configureServer(server) { server.middlewares.use((req, _res, next) => { console.log(new Date().toISOString().slice(11, 19), req.method, req.url); next() }) }
  }],
  base: './',
  // the viewer is linked from ../../viewer: its imports (vue, epubjs, pdfjs-dist) resolve from here
  resolve: { preserveSymlinks: true, dedupe: ['vue'] },
  // the viewer is raw .ts/.vue (never pre-bundled); its CommonJS dependencies must be, or the browser cannot import them
  optimizeDeps: { exclude: ['estanteria-viewer'], include: ['epubjs', 'pdfjs-dist', '@xmldom/xmldom', 'jszip', 'localforage', 'marks-pane', 'lodash/debounce', 'lodash/throttle', 'path-webpack', 'event-emitter', 'core-js'] },
  clearScreen: false,
  // in development the device reaches this server through `adb reverse tcp:5173 tcp:5173`
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../modules/estanteria-host/android/src/main/assets/viewer',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false
  }
})
