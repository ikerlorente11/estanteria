# djvu-rs (copia)

El lector de DjVu: [djvu-rs](https://github.com/matyushkin/djvu-rs) 0.43.0 (MIT, `LICENSE`; las licencias de lo que lleva
el `.wasm` dentro, todas permisivas, en `THIRD_PARTY_NOTICES`), la versión WebAssembly con SIMD del paquete npm
`djvu-rs` tal cual (`simd128/`). La usa `src/lib/djvu.ts`, que pinta las páginas en el propio dispositivo: igual con un
DjVu del Archivador, de otra biblioteca o de este equipo.

Copiado en vez de dependencia porque el paquete localiza su `.wasm` con `import.meta.url` y sus `exports` no dejan
importarlo con `?url` desde las apps que usan el visor; aquí `djvu.ts` lo importa con `?url` y Vite lo empaqueta.
Solo la variante SIMD: la soportan todos los navegadores que ya exige el lector de libros (Chromium 91+, Safari 16.4+).

Para actualizar: `npm pack djvu-rs@<versión>` y copiar `simd128/djvu_rs.js`, `simd128/djvu_rs.d.ts`,
`simd128/djvu_rs_bg.wasm`, `LICENSE` y `THIRD_PARTY_NOTICES`.
