import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The built page goes into the host module's assets: the app's local server serves it from there
// (modules/estanteria-host, HostServer.kt). Relative paths, as it is served at http://127.0.0.1:<port>/.
export default defineConfig({
  plugins: [vue()],
  base: './',
  // the viewer is linked from ../../viewer: its imports (vue, epubjs, pdfjs-dist) resolve from here
  resolve: { preserveSymlinks: true },
  clearScreen: false,
  build: {
    outDir: '../modules/estanteria-host/android/src/main/assets/viewer',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false
  }
})
