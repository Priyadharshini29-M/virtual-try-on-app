"""Generates SYNTHETIC test images (abstract shapes + noise). No real people or customer photos.
Run:  python make_fixtures.py   (needs Pillow)
"""
import os, random
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(7)

def person(path, w=1024, h=1536):
    im = Image.new("RGB", (w, h), (214, 218, 224))
    d = ImageDraw.Draw(im)
    cx = w // 2
    d.ellipse([cx-90, 140, cx+90, 340], fill=(196, 160, 140))            # head
    d.rectangle([cx-30, 330, cx+30, 400], fill=(196, 160, 140))          # neck
    d.polygon([(cx-200, 400), (cx+200, 400), (cx+150, 900), (cx-150, 900)], fill=(120, 130, 150))  # torso
    d.rectangle([cx-140, 900, cx-10, 1450], fill=(70, 80, 110))          # legs
    d.rectangle([cx+10, 900, cx+140, 1450], fill=(70, 80, 110))
    d.rectangle([cx-260, 410, cx-200, 880], fill=(196, 160, 140))        # arms
    d.rectangle([cx+200, 410, cx+260, 880], fill=(196, 160, 140))
    im = im.filter(ImageFilter.GaussianBlur(1.2))
    im.save(path, "JPEG", quality=90)

def garment(path, w=800, h=800):
    im = Image.new("RGB", (w, h), (245, 245, 245))
    d = ImageDraw.Draw(im)
    d.polygon([(200, 160), (320, 120), (480, 120), (600, 160), (720, 300), (620, 360), (560, 300),
               (560, 700), (240, 700), (240, 300), (180, 360), (80, 300)], fill=(180, 40, 60))
    d.ellipse([340, 100, 460, 180], fill=(245, 245, 245))
    im.save(path, "JPEG", quality=90)

def result(path, w=768, h=1152):
    im = Image.new("RGB", (w, h), (200, 205, 215))
    ImageDraw.Draw(im).rectangle([w//4, h//5, 3*w//4, 4*h//5], fill=(180, 40, 60))
    im.save(path, "JPEG", quality=88)

def oversize(path, side=1900):
    # random noise compresses badly -> comfortably above the 5 MB UPLOAD_MAX_BYTES limit
    im = Image.frombytes("RGB", (side, side), os.urandom(side * side * 3))
    im.save(path, "JPEG", quality=100)

person(os.path.join(HERE, "person.jpg"))
garment(os.path.join(HERE, "garment.jpg"))
result(os.path.join(HERE, "result.jpg"))
oversize(os.path.join(HERE, "oversize.jpg"))
open(os.path.join(HERE, "not-an-image.txt"), "w").write("this is not an image\n" * 50)
for f in sorted(os.listdir(HERE)):
    if not f.endswith(".py"):
        print(f, os.path.getsize(os.path.join(HERE, f)))
