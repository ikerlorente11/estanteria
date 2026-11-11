"""Una carpeta con un archivo de cada formato que lee La Estantería, para probarlos todos en la web, el
escritorio y Android (en línea y abriéndolos en local).

    python crear.py "C:\\ruta\\Lectura de prueba"

Hace falta Python 3.11+ con `pillow` (con AVIF: Pillow ≥ 11.2), `pillow-jxl-plugin` y `pymupdf`. El CBR se
hace con `rar` (WinRAR) y el CB7 con `7z` si están (en Windows se buscan en Archivos de programa); el DjVu
con las herramientas de DjVuLibre (`c44`, `cjb2`, `djvm`) si están en el PATH, y si no, con `--djvu`
se le da uno ya hecho. Los libros de Project Gutenberg (dominio público) se descargan una vez y se
guardan en `<carpeta>/.descargas`. Lo que no se puede hacer se dice al final y no para el resto.
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    import pillow_jxl  # noqa: F401  (registra JPEG XL en Pillow)
except ImportError:
    pillow_jxl = None
import pymupdf

GUTENBERG = {
    "epub": "https://www.gutenberg.org/ebooks/2000.epub3.images",
    "azw3": "https://www.gutenberg.org/ebooks/2000.kf8.images",
    "mobi": "https://www.gutenberg.org/ebooks/2000.kindle.images",
    "txt": "https://www.gutenberg.org/ebooks/2000.txt.utf-8",
}
COLORS = ["#2f5d8a", "#8a2f4f", "#3c7a3f", "#8a6a2f", "#5a3c8a", "#2f7a7a", "#7a3c2f", "#4f4f4f"]
problems: list[str] = []


# ---- páginas de cómic ----
def font(size: int):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def page(n: int, total: int, title: str, size=(1200, 1800), wide=False) -> Image.Image:
    """Una página de cómic reconocible: viñetas, su número grande y de qué archivo es."""
    w, h = (size[0] * 2, size[1]) if wide else size
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    color = COLORS[n % len(COLORS)]
    m = 40
    rows = [(m, m, w - m, h * 0.42), (m, h * 0.42 + m / 2, w / 2 - m / 4, h - m), (w / 2 + m / 4, h * 0.42 + m / 2, w - m, h - m)]
    for i, box in enumerate(rows):
        d.rectangle(box, outline="black", width=8, fill=color if i == 0 else "#f2efe6")
    d.text((w / 2, h * 0.21), str(n), font=font(int(h * 0.16)), fill="white", anchor="mm")
    d.text((w / 4, h * 0.7), f"Página {n} de {total}", font=font(int(h * 0.03)), fill="black", anchor="mm")
    d.text((w * 3 / 4, h * 0.7), title, font=font(int(h * 0.025)), fill="black", anchor="mm")
    if wide:
        d.text((w / 2, h * 0.93), "← doble página →", font=font(int(h * 0.035)), fill="black", anchor="mm")
    return img


def encode(img: Image.Image, fmt: str) -> bytes:
    out = io.BytesIO()
    opts = {"JPEG": {"quality": 85}, "WEBP": {"quality": 80}, "AVIF": {"quality": 60}, "JXL": {"quality": 80}}.get(fmt, {})
    img.save(out, fmt, **opts)
    return out.getvalue()


def comic_pages(title: str, fmt="JPEG", ext="jpg", count=6, spread_at: int | None = None) -> list[tuple[str, bytes]]:
    return [(f"{n:03d}.{ext}", encode(page(n, count, title, wide=(n == spread_at)), fmt)) for n in range(1, count + 1)]


def comicinfo(title: str, manga=False) -> bytes:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>{title}</Title><Series>Muestras</Series><Number>1</Number><Writer>La Estantería</Writer>
  <Summary>Archivo de prueba: {title}.</Summary><LanguageISO>es</LanguageISO>
  {'<Manga>YesAndRightToLeft</Manga>' if manga else ''}
</ComicInfo>""".encode()


def write_zip(path: Path, files: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for name, data in files:
            z.writestr(name, data)


def with_folder(files, folder) -> Path:
    for name, data in files:
        (folder / name).write_bytes(data)
    return folder


def tool(name: str, *windows: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for candidate in windows:
        if Path(candidate).exists():
            return candidate
    return None


# ---- documentos ----
def pdf_text(path: Path, paragraphs: list[str]) -> None:
    doc = pymupdf.open()
    toc = []
    for c in range(3):
        p = doc.new_page(width=595, height=842)
        toc.append([1, f"Capítulo {c + 1}", c + 1])
        p.insert_text((60, 90), f"Capítulo {c + 1}", fontsize=22, fontname="helv")
        body = "\n\n".join(paragraphs[c * 4:(c + 1) * 4])
        p.insert_textbox(pymupdf.Rect(60, 120, 535, 800), body, fontsize=11, fontname="tiro")
    doc.set_toc(toc)
    doc.set_metadata({"title": "PDF con texto", "author": "Miguel de Cervantes"})
    doc.save(path)


def pdf_scanned(path: Path, title: str) -> None:
    doc = pymupdf.open()
    for n in range(1, 5):
        img = page(n, 4, title).convert("L")
        p = doc.new_page(width=595, height=892)
        p.insert_image(p.rect, stream=encode(img, "JPEG"))
    doc.set_metadata({"title": title})
    doc.save(path)


def djvu(path: Path, title: str) -> bool:
    c44, cjb2, djvm = (shutil.which(n) for n in ("c44", "cjb2", "djvm"))
    if not (c44 and cjb2 and djvm):
        return False
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for n in range(1, 5):
            img = page(n, 4, title)
            src = Path(tmp) / f"p{n}"
            if n % 2:      # una página en color (IW44), otra en blanco y negro (JB2), como en un escaneo real
                img.save(src.with_suffix(".ppm"))
                subprocess.run([c44, "-dpi", "150", src.with_suffix(".ppm"), src.with_suffix(".djvu")], check=True)
            else:
                img.convert("1").save(src.with_suffix(".pbm"))
                subprocess.run([cjb2, "-dpi", "150", src.with_suffix(".pbm"), src.with_suffix(".djvu")], check=True)
            parts.append(str(src.with_suffix(".djvu")))
        subprocess.run([djvm, "-c", str(path), *parts], check=True)
    return True


# ---- libros ----
def download(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "estanteria-muestras/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            dest.write_bytes(r.read())
    return dest


def quijote_paragraphs(txt: str) -> list[str]:
    start = txt.find("Capítulo primero")
    body = txt[start if start >= 0 else 0:]
    paras = [" ".join(p.split()) for p in body.split("\n\n")]
    return [p for p in paras if len(p) > 200][:40]


def fb2(title: str, paragraphs: list[str]) -> bytes:
    cover = page(1, 1, title, size=(600, 900))
    cover_b64 = base64.b64encode(encode(cover, "JPEG")).decode()
    esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
    chapters = []
    for c in range(3):
        ps = "".join(f"<p>{esc(p)}</p>" for p in paragraphs[c * 5:(c + 1) * 5])
        note = '<p>Con una nota al pie<a l:href="#n1" type="note">[1]</a>.</p>' if c == 0 else ""
        chapters.append(f"<section><title><p>Capítulo {c + 1}</p></title>{ps}{note}</section>")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose_classic</genre>
<author><first-name>Miguel</first-name><last-name>de Cervantes</last-name></author>
<book-title>{esc(title)}</book-title><lang>es</lang>
<coverpage><image l:href="#portada.jpg"/></coverpage></title-info>
<document-info><author><nickname>La Estantería</nickname></author><id>estanteria-muestra-fb2</id><version>1.0</version></document-info>
</description>
<body><title><p>{esc(title)}</p></title>{''.join(chapters)}</body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>Nota al pie de prueba.</p></section></body>
<binary id="portada.jpg" content-type="image/jpeg">{cover_b64}</binary>
</FictionBook>""".encode("utf-8")


def epub_fixed(path: Path, title: str) -> None:
    """Un EPUB de maquetación fija (como los de manga o los álbumes ilustrados): una imagen por página."""
    n = 4
    w, h = 1200, 1800
    files = [("mimetype", b"application/epub+zip"),
             ("META-INF/container.xml", b'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')]
    manifest, spine = [], []
    for i in range(1, n + 1):
        files.append((f"OEBPS/img/p{i}.jpg", encode(page(i, n, title), "JPEG")))
        files.append((f"OEBPS/p{i}.xhtml", f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>{i}</title><meta name="viewport" content="width={w}, height={h}"/><style>body{{margin:0}}img{{width:{w}px;height:{h}px}}</style></head><body><img src="img/p{i}.jpg" alt="Página {i}"/></body></html>'.encode()))
        cover = ' properties="cover-image"' if i == 1 else ""
        manifest.append(f'<item id="p{i}" href="p{i}.xhtml" media-type="application/xhtml+xml"/><item id="i{i}" href="img/p{i}.jpg" media-type="image/jpeg"{cover}/>')
        spine.append(f'<itemref idref="p{i}" properties="page-spread-{"right" if i % 2 else "left"}"/>')
    files.append(("OEBPS/nav.xhtml", ('<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol>'
                                     + "".join(f'<li><a href="p{i}.xhtml">Página {i}</a></li>' for i in range(1, n + 1)) + "</ol></nav></body></html>").encode()))
    files.append(("OEBPS/content.opf", f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">estanteria-muestra-fxl</dc:identifier><dc:title>{title}</dc:title><dc:language>es</dc:language>
<dc:creator>La Estantería</dc:creator><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">landscape</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{''.join(manifest)}</manifest>
<spine>{''.join(spine)}</spine></package>""".encode()))
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files:
            z.writestr(name, data, zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED)


def old_text() -> bytes:
    """Un TXT en Windows-1252 (los textos antiguos en español), con capítulos."""
    chapters = []
    for c, roman in enumerate(["I", "II", "III"], 1):
        paras = [textwrap.fill(f"Párrafo {p} del capítulo {roman}. Año, señal, corazón, pingüino y acción: "
                               "estas palabras llevan eñes, tildes y diéresis para ver que la codificación se lee bien. " * 3, 72)
                 for p in range(1, 6)]
        chapters.append(f"Capítulo {roman}\n\n" + "\n\n".join(paras))
    return ("Texto antiguo de prueba\n\n" + "\n\n\n".join(chapters) + "\n").replace("\n", "\r\n").encode("cp1252")


# ---- todo ----
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carpeta", type=Path)
    ap.add_argument("--djvu", type=Path, help="un DjVu ya hecho, si no hay DjVuLibre")
    args = ap.parse_args()
    out: Path = args.carpeta
    comics, docs, books = out / "Cómics", out / "Documentos", out / "Libros"
    for d in (comics, docs, books):
        d.mkdir(parents=True, exist_ok=True)
    cache = out / ".descargas"

    # cómics
    write_zip(comics / "01 Cómic CBZ.cbz", [("ComicInfo.xml", comicinfo("Cómic CBZ"))] + comic_pages("CBZ (JPEG)"))
    write_zip(comics / "02 Cómic ZIP con WebP.zip", comic_pages("ZIP (WebP)", "WEBP", "webp"))
    write_zip(comics / "03 Manga (derecha a izquierda).cbz", [("ComicInfo.xml", comicinfo("Manga", manga=True))] + comic_pages("Manga", spread_at=4))
    if Image.registered_extensions().get(".avif"):
        write_zip(comics / "04 Cómic con AVIF.cbz", comic_pages("CBZ (AVIF)", "AVIF", "avif"))
    else:
        problems.append("AVIF: este Pillow no escribe AVIF (hace falta Pillow ≥ 11.2)")
    if pillow_jxl:
        write_zip(comics / "05 Cómic con JPEG XL.cbz", comic_pages("CBZ (JPEG XL)", "JXL", "jxl"))
    else:
        problems.append("JPEG XL: falta pillow-jxl-plugin")
    with tarfile.open(comics / "06 Cómic CBT.cbt", "w") as t:
        for name, data in comic_pages("CBT (tar)"):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    with tempfile.TemporaryDirectory() as tmp:
        folder = with_folder(comic_pages("CBR (RAR)"), Path(tmp))
        rar = tool("rar", r"C:\Program Files\WinRAR\Rar.exe")
        if rar:
            target = comics / "07 Cómic CBR.cbr"
            target.unlink(missing_ok=True)
            subprocess.run([rar, "a", "-ep1", "-idq", "-m0", str(target), str(folder / "*.jpg") if os.name == "nt" else "."],
                           check=True, cwd=None if os.name == "nt" else folder)
        else:
            problems.append("CBR: falta rar (WinRAR)")
    with tempfile.TemporaryDirectory() as tmp:
        folder = with_folder(comic_pages("CB7 (7z)"), Path(tmp))
        seven = tool("7z", r"C:\Program Files\7-Zip\7z.exe")
        if seven:
            target = comics / "08 Cómic CB7.cb7"
            target.unlink(missing_ok=True)
            subprocess.run([seven, "a", "-t7z", "-bso0", str(target.resolve()), "."], check=True, cwd=folder)
        else:
            problems.append("CB7: falta 7z")
    folder = comics / "09 Cómic en carpeta"
    folder.mkdir(exist_ok=True)
    with_folder(comic_pages("Carpeta de imágenes"), folder)

    # libros (Gutenberg)
    got = {}
    for kind, url in GUTENBERG.items():
        try:
            got[kind] = download(url, cache / f"quijote.{kind}")
        except Exception as exc:
            problems.append(f"Gutenberg {kind}: {exc}")
    names = {"epub": "10 Don Quijote.epub", "mobi": "12 Don Quijote (MOBI).mobi", "azw3": "13 Don Quijote (AZW3).azw3", "txt": "18 Don Quijote (UTF-8).txt"}
    for kind, name in names.items():
        if kind in got:
            shutil.copyfile(got[kind], books / name)
    if "mobi" in got:
        shutil.copyfile(got["mobi"], books / "14 Don Quijote (PRC).prc")
    epub_fixed(books / "11 Libro ilustrado (maquetación fija).epub", "Maquetación fija")
    paragraphs = quijote_paragraphs(got["txt"].read_text("utf-8")) if "txt" in got else [f"Párrafo de prueba número {i}. " * 12 for i in range(40)]
    data = fb2("Don Quijote (FB2)", paragraphs)
    (books / "15 Don Quijote (FB2).fb2").write_bytes(data)
    with zipfile.ZipFile(books / "16 Don Quijote (FBZ).fbz", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Don Quijote.fb2", data)
    with zipfile.ZipFile(books / "17 Don Quijote (FB2 comprimido).fb2.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Don Quijote.fb2", data)
    (books / "19 Texto antiguo (Windows-1252).txt").write_bytes(old_text())

    # documentos
    pdf_text(docs / "20 PDF con texto.pdf", paragraphs)
    pdf_scanned(docs / "21 PDF escaneado.pdf", "PDF escaneado")
    target = docs / "22 Escaneo DjVu.djvu"
    if not djvu(target, "DjVu"):
        if args.djvu and args.djvu.exists():
            shutil.copyfile(args.djvu, target)
        else:
            problems.append("DjVu: no hay DjVuLibre (c44, cjb2, djvm) ni --djvu")

    made = sorted(p.relative_to(out) for p in out.rglob("*") if p.is_file() and ".descargas" not in p.parts and "09 Cómic en carpeta" not in p.parts)
    print(f"{len(made)} archivos y una carpeta de imágenes en {out}")
    for p in made:
        print("  ", p)
    for p in problems:
        print("FALTA:", p, file=sys.stderr)


if __name__ == "__main__":
    main()
