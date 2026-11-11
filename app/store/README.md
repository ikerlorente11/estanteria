# Ficha de Google Play

Lo que pide Play Console para publicar La Estantería (paquete `com.ikerlorente11.estanteria`).

## Gráficos

| Archivo | Para qué |
| --- | --- |
| `icono-512.png` | Icono de la aplicación (512 × 512) |
| `grafico-destacado-1024x500.png` | Gráfico destacado |
| `captura-1.png` … `captura-4.png` | Capturas de teléfono (1080 × 1920) |

Se rehacen con `make_icon.py` (el icono de la app, el adaptativo, el splash y el de 512) y `make_store.py`
(gráfico destacado y capturas enmarcadas a partir de capturas de la app), con Pillow:
`python make_icon.py <salida-iconos> <salida-play>` y luego `python make_store.py <salida-play>`
(este último espera las capturas en bruto en `shots/` junto al script).

## Textos

**Nombre:** La Estantería

**Descripción breve** (80 caracteres como mucho):

> Lector de cómics, manga y libros: tus archivos, sin conexión y sin cuentas.

**Descripción completa:**

> La Estantería es un lector para tus cómics, manga y libros. Elige las carpetas del móvil donde los guardas y aparecen ordenados por series, con sus portadas, listos para leer. Sin cuentas, sin anuncios y sin conexión: tus archivos se leen en el propio dispositivo.
>
> FORMATOS
> • Cómics y manga: CBZ, CBR (también RAR5), CB7, CBT y ZIP, con imágenes JPEG, PNG, WebP, AVIF o JPEG XL.
> • Libros: EPUB (también de maquetación fija), MOBI, AZW3, PRC, FB2, FBZ y TXT.
> • Documentos: PDF (como documento o página a página) y DjVu.
>
> LECTURA
> • Lector de cómics con página simple, doble página, tira vertical y modo manga (de derecha a izquierda).
> • Lector de libros con tipografía, tamaño, márgenes y paginado o desplazamiento a tu gusto; los ajustes se comparten entre formatos.
> • Marcadores, notas y subrayados.
> • Pasa página con las teclas de volumen y mantén la pantalla encendida mientras lees.
>
> TU ESTANTERÍA
> • Las carpetas del dispositivo, con sus subcarpetas, como series.
> • Abre archivos sueltos desde cualquier otra app.
> • Sigue leyendo donde lo dejaste.
> • Guarda una copia donde quieras, compártela o bórrala.
>
> CATÁLOGOS Y BIBLIOTECAS (opcional)
> • Añade catálogos OPDS públicos (como Project Gutenberg) y descarga lo que quieras leer; las series se descargan enteras, cada una en su carpeta.
> • Conecta tus propios servidores con su dirección y tus credenciales.
>
> PRIVACIDAD
> • Sin cuentas ni registro. La app no recoge datos: tu progreso y tus notas se guardan en el dispositivo.
> • Bloqueo opcional con la huella, la cara o el PIN del dispositivo.
>
> Disponible en español e inglés, con tema claro y oscuro.

**Categoría:** Libros y obras de consulta (Books & Reference). **Etiquetas:** lector de cómics, lector de libros electrónicos.

**Contacto:** el correo de desarrollador de la cuenta de Play Console.

## Política de privacidad

Play la pide siempre, aunque la app no recoja datos. Texto propuesto (hay que publicarlo en una URL pública,
por ejemplo un archivo `PRIVACY.md` en un repositorio público o una página del portfolio):

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
