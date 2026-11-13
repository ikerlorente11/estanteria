# Ficha de Google Play

Lo que pide Play Console para publicar La Estantería (paquete `com.ikerlorente11.estanteria`).

## Gráficos

| Archivo | Para qué |
| --- | --- |
| `icono-512.png` | Icono de la aplicación: 512 × 512, PNG sin transparencia (Play aplica su máscara) |
| `grafico-destacado-1024x500.png` | Gráfico destacado: 1024 × 500, PNG de 24 bits |
| `capturas-movil/01…08-*.png` | Capturas de teléfono: 1080 × 1920 (9:16), en el orden en que se suben |
| `capturas-tablet/01…08-*.png` | Capturas de tablet de 7" y 10": 2560 × 1440 (16:9, la tablet en horizontal) |

`make_icon.py` hace el icono de la app, el adaptativo y el splash. `make_store.py` (común a todas las apps, con
Pillow y Segoe UI) rehace `icono-512.png`, el gráfico destacado y las capturas enmarcadas a partir de
`icono-fuente.png`, las capturas en bruto de `crudas/movil` y `crudas/tablet` (emuladores Pixel 7 y Pixel Tablet,
Android 15, con contenido de dominio público: Little Nemo de Winsor McCay (1905-1911), Planet Comics
(1941 y 1953) y Pirates Comics (1950) de Internet Archive, Hokusai Manga (1814) y clásicos en EPUB de
Standard Ebooks (Don Quixote, Alice in Wonderland, Frankenstein, Dracula, Moby-Dick, Treasure Island)) y
`store.json` (colores, lema y titular de cada captura): `python make_store.py`.

## Textos

Descripción breve, descripción completa y notas de cada versión, listas para pegar: **`ficha.txt`**.

**Nombre:** La Estantería

**Categoría:** Libros y obras de consulta (Books & Reference). **Etiquetas:** lector de cómics, lector de libros electrónicos.

**Contacto:** el correo de desarrollador de la cuenta de Play Console.

## Política de privacidad

Play la pide siempre, aunque la app no recoja datos. Publicada (repo `privacy_policies`, GitHub Pages):
https://ikerlorente11.github.io/privacy_policies/estanteria/privacy-policy.html

En resumen:

> La Estantería no recoge, guarda ni comparte datos personales. Los archivos que lees, tu progreso, tus notas y tus ajustes se quedan en tu dispositivo. La app solo se conecta a internet cuando tú lo pides: para leer los catálogos que añades o los servidores que conectas, con la dirección y las credenciales que tú escribes, que se guardan cifradas en el dispositivo. No hay anuncios ni analíticas.

## Seguridad de los datos (formulario de Play)

- ¿Recoge o comparte datos de usuario? **No.**
- ¿Los datos se cifran en tránsito? Las conexiones a catálogos y servidores usan la dirección que pone el usuario (HTTPS cuando el servidor lo ofrece).
- ¿Se pueden borrar? No hay datos en servidores nuestros: todo está en el dispositivo y se borra al desinstalar.

## Clasificación de contenido

La app es un lector: no incluye contenido propio. En el cuestionario, «aplicación de referencia / lector», sin violencia, sexo, etc. Los catálogos que añada el usuario son responsabilidad suya (no viene ninguno para adultos activado).

## Primera subida

La primera versión se sube a mano en Play Console (la API no deja crear la primera): el AAB de la build de EAS
(`eas build -p android --profile production`). Después, `eas submit` con `credentials/play-service-account.json`
(la misma clave de servicio que las otras apps) sube las siguientes a la pista `internal` (ver `eas.json`).
