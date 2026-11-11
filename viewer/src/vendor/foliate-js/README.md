# foliate-js (copia)

El motor del lector de libros: [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, `LICENSE`), copiado del
commit `78914ae` (2026-05-01). Lee EPUB (también de maquetación fija), MOBI, AZW/AZW3 (KF8), FB2 y FBZ en el navegador;
lo usa `src/lib/books.ts` (abrir el archivo) y `src/views/BookReader.vue` (el lector).

Solo están los módulos que se usan (sin `pdf.js` ni su pdfjs, sin la interfaz de ejemplo, el OPDS ni los diccionarios).
Único cambio: en `view.js`, `makeBook` ya no importa `./pdf.js` (los PDF van por pdf.js en `PdfReader.vue`).

Para actualizar: copiar los mismos archivos de un commit nuevo, volver a aplicar ese cambio y probar un EPUB, un
EPUB de maquetación fija, un MOBI, un AZW3, un FB2 y un TXT.
