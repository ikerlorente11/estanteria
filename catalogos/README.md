# Repositorio de catálogos

Un repositorio de catálogos es un `index.json` publicado en cualquier sitio (aquí, en GitHub): la app lo lee desde
**Catálogos › Añadir catálogo › Un repositorio de catálogos** y sus catálogos pasan a estar entre los que se pueden
añadir. Solo lleva datos (nunca código): cada catálogo dice cómo se le habla con un protocolo que la app ya conoce.

URL de este repositorio: `https://raw.githubusercontent.com/ikerlorente11/estanteria/master/catalogos/index.json`

```json
{
  "name": "Nombre del repositorio",
  "description": "Opcional",
  "catalogs": [
    {
      "id": "único-en-el-repositorio",
      "name": "Nombre del catálogo",
      "description": "Opcional",
      "languages": ["es"],            // ISO 639-1, o "multi" si tiene muchos
      "content": ["books"],           // books, comics, manga
      "protocol": "opds",             // opds (1.2 o 2.0) o mangadex
      "url": "https://…/opds",        // dónde empieza
      "nsfw": false,                  // opcional: contenido adulto
      "site": "https://…"             // opcional: su web
    }
  ]
}
```

No es compatible con los repositorios de extensiones de Mihon/Tachiyomi (`index.min.json` / `index.pb`): esas
extensiones son programas para Android. Para usarlas, un servidor Suwayomi conectado en **Bibliotecas**.
