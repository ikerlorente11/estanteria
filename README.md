# La Estantería

Lector de cómics, manga y libros sobre la carpeta `Lectura/` de El Archivador (OpenCloud) y sobre otras bibliotecas
(Komga, Kavita, OPDS…), con una biblioteca unificada y el progreso sincronizado.

- `viewer/`: la biblioteca y los visores (componentes Vue y su lógica), compartidos por las tres apps. Lo importan
  la web del drive (repo `el_archivador`, `estanteria/web`), el escritorio y Android.
- La app de escritorio (Tauri 2) vive en PC Toolkit (`tools/estanteria/app`) e importa el visor de aquí.
- `app/`: la app Android (Expo): el visor en un WebView y un host nativo en Kotlin (servidor local, archivos
  del dispositivo, descargas). Ver `app/README.md`.

El servicio (índice, páginas como imagen, progreso, OPDS) vive en `el_archivador/estanteria/service`.

Licencia: PolyForm Noncommercial 1.0.0.
