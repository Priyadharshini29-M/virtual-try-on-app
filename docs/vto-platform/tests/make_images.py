"""Generates local demo images (picsum.photos redirects, which the SSRF-safe fetch rejects by design).

  vto/demo/img/k1..k8.jpg          card images (400x533)
  vto/demo/img/kurta-main-blue.jpg main product image (600x800), referenced by JSON-LD + og:image
  tests/fixtures/person.jpg        shopper photo used by the e2e upload step
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(ROOT, "..", "vto", "demo", "img")
FIX_DIR = os.path.join(ROOT, "fixtures")
os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(FIX_DIR, exist_ok=True)

COLOURS = [(37, 99, 235), (190, 18, 60), (22, 163, 74), (234, 179, 8),
           (124, 58, 237), (14, 165, 233), (249, 115, 22), (219, 39, 119)]


def kurta(w, h, colour, label):
    im = Image.new("RGB", (w, h), (244, 241, 236))
    d = ImageDraw.Draw(im)
    cx, top = w // 2, int(h * 0.12)
    sw, bw, bot = int(w * 0.30), int(w * 0.24), int(h * 0.92)
    # body + sleeves of a simple kurta silhouette
    d.polygon([(cx - bw, top + 20), (cx + bw, top + 20), (cx + bw + 30, bot), (cx - bw - 30, bot)], fill=colour)
    d.polygon([(cx - bw, top + 20), (cx - sw - 60, top + 160), (cx - sw - 25, top + 190), (cx - bw + 10, top + 90)], fill=colour)
    d.polygon([(cx + bw, top + 20), (cx + sw + 60, top + 160), (cx + sw + 25, top + 190), (cx + bw - 10, top + 90)], fill=colour)
    d.ellipse([cx - 30, top - 5, cx + 30, top + 45], fill=(244, 241, 236))
    for y in range(top + 70, bot - 20, 36):   # placket buttons
        d.ellipse([cx - 4, y, cx + 4, y + 8], fill=(255, 255, 255))
    d.text((12, h - 24), label, fill=(60, 60, 60))
    return im


for i, c in enumerate(COLOURS, start=1):
    kurta(400, 533, c, f"Kurta {i}").save(os.path.join(IMG_DIR, f"k{i}.jpg"), quality=88)
kurta(600, 800, COLOURS[0], "Blue cotton kurta").save(os.path.join(IMG_DIR, "kurta-main-blue.jpg"), quality=90)

# shopper photo: plain person silhouette on a light background
p = Image.new("RGB", (600, 900), (226, 232, 240))
d = ImageDraw.Draw(p)
d.ellipse([240, 70, 360, 200], fill=(198, 134, 103))
d.rectangle([285, 195, 315, 230], fill=(198, 134, 103))
d.rounded_rectangle([190, 225, 410, 560], radius=40, fill=(71, 85, 105))
d.rectangle([215, 555, 285, 860], fill=(30, 41, 59))
d.rectangle([315, 555, 385, 860], fill=(30, 41, 59))
p.save(os.path.join(FIX_DIR, "person.jpg"), quality=90)
print("images written to", os.path.normpath(IMG_DIR), "and", os.path.normpath(FIX_DIR))
