import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'

// The shared viewer, from the repo itself (../../viewer), as source: watched and hot-reloaded like our own files.
// (Through the node_modules link Vite treated it as a dependency: cached, never re-read.)
const viewer = fileURLToPath(new URL('../../viewer/src', import.meta.url))

// The built page goes into the host module's assets: the app's local server serves it from there
// (modules/estanteria-host, HostServer.kt). Relative paths, as it is served at http://127.0.0.1:<port>/.
export default defineConfig({
  plugins: [vue(), {
    // every request the device makes, in the terminal (development only)
    name: 'log-requests',
    configureServer(server) { server.middlewares.use((req, _res, next) => { console.log(new Date().toISOString().slice(11, 19), req.method, req.url); next() }) }
  }],
  base: './',
  resolve: {
    alias: [{ find: 'estanteria-viewer/ui.css', replacement: `${viewer}/lib/ui.css` }, { find: 'estanteria-viewer', replacement: `${viewer}/index.ts` }],
    // the viewer's own imports (vue, epubjs, pdfjs-dist) come from this project's node_modules
    dedupe: ['vue', 'epubjs', 'pdfjs-dist']
  },
  // the viewer is raw .ts/.vue (never pre-bundled); its CommonJS dependencies must be, or the browser cannot import them
  optimizeDeps: { include: ['epubjs', 'pdfjs-dist', '@xmldom/xmldom', 'jszip', 'localforage', 'marks-pane', 'lodash/debounce', 'lodash/throttle', 'path-webpack', 'event-emitter', 'core-js'] },
  clearScreen: false,
  // in development the device reaches this server through `adb reverse tcp:5173 tcp:5173`
  server: { port: 5173, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), viewer] } },
  build: {
    outDir: '../modules/estanteria-host/android/src/main/assets/viewer',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false
  }
})
