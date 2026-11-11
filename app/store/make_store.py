"""Play Store graphics for La Estantería: the feature graphic (1024x500) and phone screenshots framed
with a caption (1080x1920, 9:16), from screenshots of the app."""
import importlib.util
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location('icon', HERE / 'make_icon.py')
FONT_BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
FONT = 'C:/Windows/Fonts/segoeui.ttf'
BG_TOP = (52, 40, 34)
BG_BOTTOM = (20, 17, 20)
ACCENT = (232, 145, 58)


def gradient(w, h):
    g = Image.new('RGB', (1, 256))
    for y in range(256):
        t = y / 255
        g.putpixel((0, y), tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
    return g.resize((w, h), Image.BICUBIC)


def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ''
    for w in words:
        test = f'{line} {w}'.strip()
        if draw.textlength(test, font=font) <= width:
            line = test
        else:
            lines.append(line)
            line = w
    lines.append(line)
    return lines


def feature_graphic():
    sys.argv = [sys.argv[0], str(HERE / 'icon-out'), str(HERE / 'play-out')]
    icon = importlib.util.module_from_spec(spec)
    src = (HERE / 'make_icon.py').read_text(encoding='utf-8').replace('\nmain()\n', '\n')
    exec(compile(src, 'make_icon.py', 'exec'), icon.__dict__)
    img = gradient(1024, 500).convert('RGBA')
    art = icon['art'](1.0) if isinstance(icon, dict) else icon.__dict__['art'](1.0)
    art = art.resize((560, 560), Image.LANCZOS)
    img.alpha_composite(art, (-30, -40))
    d = ImageDraw.Draw(img)
    d.text((500, 150), 'La Estantería', font=ImageFont.truetype(FONT_BOLD, 74), fill=(250, 244, 236))
    sub = ImageFont.truetype(FONT, 34)
    for i, line in enumerate(['Cómics, manga y libros,', 'en tu móvil y sin conexión']):
        d.text((504, 258 + i * 46), line, font=sub, fill=(222, 206, 190))
    d.rounded_rectangle([504, 372, 504 + 96, 378], radius=3, fill=ACCENT)
    img.convert('RGB').save(OUT / 'grafico-destacado-1024x500.png')


def framed(src, caption, name, crop_top=230, crop_bottom=0):
    W, H = 1080, 1920
    img = gradient(W, H).convert('RGBA')
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_BOLD, 64)
    lines = wrap(d, caption, font, W - 160)
    y = 110
    for line in lines:
        tw = d.textlength(line, font=font)
        d.text(((W - tw) / 2, y), line, font=font, fill=(250, 244, 236))
        y += 80
    shot = Image.open(src).convert('RGB')
    shot = shot.crop((0, crop_top, shot.width, shot.height - crop_bottom))
    top = y + 60
    avail_h = H - top - 70
    scale = min((W - 180) / shot.width, avail_h / shot.height)
    shot = shot.resize((int(shot.width * scale), int(shot.height * scale)), Image.LANCZOS)
    x = (W - shot.width) // 2
    # a soft shadow and rounded corners: a phone's screen, no frame
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x + 6, top + 14, x + shot.width + 6, top + shot.height + 14], radius=44, fill=(0, 0, 0, 150))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)))
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1], radius=40, fill=255)
    img.paste(shot, (x, top), mask)
    img.convert('RGB').save(OUT / name)


feature_graphic()
S = HERE / 'shots'
framed(S / '2-libros.png', 'Tus cómics, manga y libros en una sola estantería', 'captura-1.png')
framed(S / '4-libro.png', 'Lee EPUB, MOBI, FB2, PDF, DjVu, CBZ, CBR…', 'captura-2.png', crop_top=260)
framed(S / '3-ficha.png', 'Tus archivos, sin depender de ningún servidor', 'captura-3.png')
framed(S / '6-ajustes.png', 'Tema, idioma, teclas de volumen y bloqueo', 'captura-4.png')
print('ok')
