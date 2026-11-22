"""Draw simple illustrated location images for the manual's screenshots.

No photos of real places or people: flat illustrations, so the screenshots
can be published without licence questions.

    venv/bin/python test-script/manual_shots/draw_locations.py <out_dir>
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 800


def gradient(top, bottom):
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im


def glow(im, centres, colour, radius):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x, y in centres:
        d.ellipse((x - radius, y - radius, x + radius, y + radius), fill=colour + (110,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.6))
    return Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB")


def coffee_shop():
    im = gradient((248, 228, 196), (196, 150, 104))
    d = ImageDraw.Draw(im)
    # Big window with mullions, daylight beyond.
    d.rectangle((90, 90, 700, 520), fill=(226, 240, 246), outline=(92, 62, 40), width=14)
    for x in (293, 496):
        d.line([(x, 90), (x, 520)], fill=(92, 62, 40), width=10)
    d.line([(90, 305), (700, 305)], fill=(92, 62, 40), width=10)
    for i in range(7):  # street trees through the glass
        x = 120 + i * 85
        d.ellipse((x, 360, x + 90, 450), fill=(150, 186, 140))
    # Counter, espresso machine, cups.
    d.rectangle((0, 560, W, H), fill=(110, 72, 46))
    d.rectangle((0, 548, W, 566), fill=(70, 44, 28))
    d.rounded_rectangle((820, 380, 1060, 550), 18, fill=(180, 184, 190), outline=(120, 124, 130), width=6)
    d.rectangle((860, 470, 1020, 490), fill=(90, 94, 100))
    for x in (870, 935, 1000):
        d.rounded_rectangle((x, 505, x + 40, 548), 6, fill=(250, 248, 242))
    # Pendant lamps.
    for x in (240, 520, 900):
        d.line([(x, 0), (x, 120)], fill=(60, 40, 30), width=4)
        d.pieslice((x - 60, 100, x + 60, 220), 180, 360, fill=(52, 70, 60))
    im = glow(im, [(240, 175), (520, 175), (900, 175)], (255, 214, 140), 90)
    return im


def city_street_night():
    im = gradient((14, 22, 48), (40, 52, 92))
    d = ImageDraw.Draw(im)
    rnd = random.Random(7)
    x = 0
    windows = []
    while x < W:
        w = rnd.randint(110, 190)
        h = rnd.randint(260, 560)
        d.rectangle((x, H - 170 - h, x + w, H - 170), fill=(22, 28, 44))
        for wy in range(H - 150 - h, H - 200, 38):
            for wx in range(x + 14, x + w - 20, 30):
                if rnd.random() < 0.38:
                    d.rectangle((wx, wy, wx + 14, wy + 20), fill=(255, 210, 120))
                    windows.append((wx + 7, wy + 10))
        x += w + rnd.randint(6, 18)
    # Wet street with reflections.
    d.rectangle((0, H - 170, W, H), fill=(26, 30, 44))
    for lx in (180, 600, 1020):
        d.line([(lx, H - 170), (lx, H - 470)], fill=(70, 76, 90), width=8)
        d.ellipse((lx - 22, H - 495, lx + 22, H - 455), fill=(255, 226, 160))
        d.rectangle((lx - 30, H - 160, lx + 30, H - 20), fill=(90, 80, 60))
    im = glow(im, [(180, H - 475), (600, H - 475), (1020, H - 475)], (255, 210, 140), 110)
    im = glow(im, windows[::6], (255, 200, 120), 18)
    rain = Image.new("RGBA", im.size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(rain)
    for _ in range(520):
        rx, ry = rnd.randint(0, W), rnd.randint(0, H)
        rd.line([(rx, ry), (rx - 6, ry + 26)], fill=(200, 210, 230, 70), width=2)
    return Image.alpha_composite(im.convert("RGBA"), rain).convert("RGB")


def apartment():
    im = gradient((210, 204, 196), (150, 140, 132))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 600, W, H), fill=(120, 96, 76))  # floor
    d.rectangle((760, 120, 1080, 470), fill=(70, 86, 120), outline=(60, 50, 44), width=12)  # night window
    d.line([(920, 120), (920, 470)], fill=(60, 50, 44), width=8)
    d.rounded_rectangle((120, 430, 620, 600), 30, fill=(96, 70, 60))  # sofa
    d.rounded_rectangle((150, 360, 590, 470), 30, fill=(110, 82, 70))
    # Papers scattered — someone searched the place.
    rnd = random.Random(3)
    for _ in range(14):
        x, y = rnd.randint(80, 1100), rnd.randint(620, 770)
        d.polygon([(x, y), (x + 70, y + rnd.randint(-10, 10)), (x + 64, y + 50), (x - 6, y + 46)], fill=(244, 242, 236))
    d.rectangle((680, 480, 720, 600), fill=(60, 50, 44))  # lamp
    d.polygon([(640, 430), (760, 430), (730, 360), (670, 360)], fill=(232, 210, 160))
    im = glow(im, [(700, 420)], (255, 220, 160), 120)
    return im


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    coffee_shop().save(out / "coffee_shop.jpg", quality=90)
    city_street_night().save(out / "city_street_night.jpg", quality=90)
    apartment().save(out / "marcus_apartment.jpg", quality=90)
    print("wrote", out)


if __name__ == "__main__":
    main()
