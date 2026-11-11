"""La Estantería's icon: a shelf of books, comics and manga on a warm dark background.
Drawn at 4x and scaled down (smooth edges). Writes the app's icon, adaptive foreground, splash and
the Play Store's 512 px icon."""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S = 4                      # supersampling
N = 1024 * S
OUT = Path(sys.argv[1])
PLAY = Path(sys.argv[2])

BG_TOP = (44, 34, 30)      # warm charcoal
BG_BOTTOM = (22, 19, 22)
ACCENT = (217, 130, 43)    # the app's orange
ACCENT_DARK = (168, 92, 26)


def gradient(size, top, bottom, radial=True):
    img = Image.new('RGB', (size, size))
    px = img.load()
    cx, cy = size * 0.5, size * 0.38
    rmax = math.hypot(size, size) * 0.62
    for y in range(size):
        for x in range(0, size):
            t = min(1.0, math.hypot(x - cx, y - cy) / rmax) if radial else y / size
            px[x, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img


def art(scale=1.0):
    """The shelf and its books, centred, on transparent; `scale` 1 fills ~70 % of the side."""
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = N / 1024 * scale                       # one unit of the 1024 design
    ox = N / 2 - 512 * u                        # the design's origin, centred
    oy = N / 2 - 512 * u

    def P(x, y):
        return (ox + x * u, oy + y * u)

    def rect(x0, y0, x1, y1, fill, r=10):
        d.rounded_rectangle([P(x0, y0), P(x1, y1)], radius=r * u, fill=fill)

    base = 690                                  # the shelf's top
    # books, left to right: (x, width, height, colour, bands colour, kind)
    books = [
        (232, 86, 330, (243, 230, 208), (217, 130, 43), 'book'),
        (326, 70, 280, (47, 127, 134), (233, 214, 176), 'manga'),
        (404, 96, 372, (184, 69, 60), (243, 230, 208), 'book'),
        (508, 64, 300, (224, 176, 74), (110, 64, 22), 'comic'),
        (580, 80, 344, (243, 230, 208), (47, 127, 134), 'manga'),
    ]
    shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for x, w, h, c, band, kind in books:
        sd.rounded_rectangle([P(x + 8, base - h + 10), P(x + w + 8, base + 4)], radius=12 * u, fill=(0, 0, 0, 120))
    # the leaning one, on the right
    lean = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lean)
    lx, lw, lh = 742, 80, 300
    ld.rounded_rectangle([P(lx, base - lh), P(lx + lw, base)], radius=12 * u, fill=(120, 96, 160))
    for k, yy in enumerate((base - lh + 46, base - 70)):
        ld.rectangle([P(lx, yy), P(lx + lw, yy + 16)], fill=(236, 222, 245))
    ld.rounded_rectangle([P(lx + 22, base - lh + 110), P(lx + lw - 22, base - lh + 190)], radius=8 * u, fill=(236, 222, 245, 200))
    # leaning on the last one: turned on its foot, its top against that book
    pivot = P(lx, base)
    lean = lean.rotate(16, resample=Image.BICUBIC, center=pivot)
    lean_shadow = lean.split()[3].point(lambda a: int(a * 0.45))
    shadow.paste((0, 0, 0, 255), (int(10 * u), int(8 * u)), lean_shadow)

    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10 * u)))
    for x, w, h, c, band, kind in books:
        top = base - h
        rect(x, top, x + w, base, c, 12)
        # a light edge on the left: the spine's roundness
        d.rounded_rectangle([P(x, top), P(x + w * 0.22, base)], radius=12 * u, fill=tuple(min(255, v + 18) for v in c))
        rect(x + w * 0.12, top, x + w, base, c, 12)
        if kind == 'book':
            for yy in (top + 40, top + 62, base - 70):
                d.rectangle([P(x, yy), P(x + w, yy + 10)], fill=band)
            rect(x + w * 0.28, top + 110, x + w * 0.72, top + 200, band + (255,), 6)
        elif kind == 'manga':
            d.rectangle([P(x, top + 34), P(x + w, top + 120)], fill=band)
            # a volume number
            d.ellipse([P(x + w / 2 - 16, base - 92), P(x + w / 2 + 16, base - 60)], fill=band)
        else:                                       # a comic: a bold band and a burst
            d.rectangle([P(x, top + 30), P(x + w, top + 70)], fill=band)
            cx, cy, r = x + w / 2, top + 150, 22
            pts = []
            for i in range(16):
                rr = r if i % 2 == 0 else r * 0.55
                a = math.pi * 2 * i / 16
                pts.append(P(cx + rr * math.cos(a), cy + rr * math.sin(a)))
            d.polygon(pts, fill=band)
    layer.alpha_composite(lean)
    # the shelf: a plank with a lighter top edge
    plank = [P(196, base), P(828, base + 52)]
    d.rounded_rectangle([P(204, base + 10), P(836, base + 62)], radius=14 * u, fill=(0, 0, 0, 110))
    d.rounded_rectangle(plank, radius=14 * u, fill=ACCENT)
    d.rounded_rectangle([P(196, base + 30), P(828, base + 52)], radius=10 * u, fill=ACCENT_DARK)
    d.rectangle([P(206, base + 28), P(818, base + 34)], fill=ACCENT_DARK)
    return layer


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PLAY.mkdir(parents=True, exist_ok=True)
    bg = gradient(N // 8, BG_TOP, BG_BOTTOM).resize((N, N), Image.BICUBIC).convert('RGBA')
    # the full icon (launchers without masks, the store): background and art, full bleed
    full = bg.copy()
    full.alpha_composite(art(1.0))
    down(full, 1024).save(OUT / 'icon.png')
    down(full, 512).convert('RGB').save(PLAY / 'icono-512.png')
    # adaptive: the art inside the safe zone (the launcher masks it to a circle, a squircle…)
    down(art(0.74), 1024).save(OUT / 'adaptive-icon.png')
    # splash: the art alone, on the app's dark splash colour
    down(art(0.9), 1024).save(OUT / 'splash-icon.png')
    print('ok')


main()
