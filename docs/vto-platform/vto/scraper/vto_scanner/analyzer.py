"""
Plan A analysis: inspect raw (or Playwright-rendered) HTML and produce CSS selectors for
  product pages   : add_to_cart, product_image, product_title
  collection pages: card, card_image (relative to card), card_link (relative to card)

The logic mirrors the browser heuristics in widget/vto.js so selectors are consistent.
"""
import json
import re
from collections import Counter, defaultdict

from parsel import Selector

PRICE_RE = re.compile(r"(₹|rs\.?\s?|inr|mrp|\$|€|£|aed|sar)\s?\d|\d[\d,]*(\.\d+)?\s?(₹|rs\b|inr)", re.I)
CART_RE = re.compile(r"\b(add\s*to\s*(cart|bag|basket)|buy\s*now|add\s*to\s*trolley)\b", re.I)
UNSTABLE_CLASS = re.compile(
    r"^(css|sc|jsx|emotion|styled|tw|chakra|mui|jss)[-_]|^[a-z]{1,3}[-_][a-z0-9]{5,}$|__[a-z0-9]{5,}$|_[a-z0-9]{5}$|\d{3,}"
    r"|^(active|selected|hover|focus|is-|has-|lazy|loaded|swiper-slide-|slick-|ng-|v-)",
    re.I,
)
CHROME_TAGS = {"header", "nav", "footer"}

ATC_CANDIDATES = [
    'form[action*="/cart/add"] [type="submit"]', 'button[name="add"]', '[name="add-to-cart"]',
    "#add-to-cart", "#addToCart", "#AddToCart", "#product-addtocart-button", ".single_add_to_cart_button",
]
ATC_TOKENS = ["add-to-cart", "addtocart", "add_to_cart", "add-to-bag", "addtobag", "btn-cart", "pdp-add"]
CARD_CANDIDATES = [
    '[itemtype*="schema.org/Product"]', "[data-product-id]", "[data-productid]", "[data-sku]",
    ".product-card", ".product-item", ".product-tile", ".product-grid-item", ".grid-product",
    ".card-wrapper", "li.product", ".productCard", ".plp-card", ".item-card", ".product-base",
]


# ----------------------------------------------------------------- helpers
def is_el(el):
    return isinstance(getattr(el, "tag", None), str)


def stable_classes(el):
    return [c for c in (el.get("class") or "").split() if 1 < len(c) < 40 and not UNSTABLE_CLASS.search(c)]


def stable_id(i):
    return bool(i) and len(i) < 50 and not re.search(r"\d{4,}|^[a-f0-9-]{16,}$|:r\d|^ember|^yui_", i, re.I)


def css_escape(s):
    return re.sub(r"([^\w-])", r"\\\1", s)


def part_for(el):
    cls = "".join("." + css_escape(c) for c in stable_classes(el)[:2])
    return el.tag + cls


def in_chrome(el):
    cur = el
    while cur is not None and is_el(cur):
        if cur.tag in CHROME_TAGS or (cur.get("role") or "") in ("navigation", "banner", "contentinfo"):
            return True
        cur = cur.getparent()
    return False


def text_of(el):
    return re.sub(r"\s+", " ", el.text_content() or "").strip()


def count(sel, css):
    try:
        return len(sel.css(css))
    except Exception:
        return 0


def selector_for(el, sel):
    """A unique selector for one element in the page."""
    if stable_id(el.get("id") or "") and count(sel, "#" + css_escape(el.get("id"))) == 1:
        return "#" + css_escape(el.get("id"))
    for attr in ("data-testid", "data-test", "data-qa", "itemprop", "name", "aria-label"):
        v = el.get(attr)
        if v and len(v) < 60 and not re.search(r"\d{4,}", v):
            s = f'{el.tag}[{attr}="{v}"]'
            if count(sel, s) == 1:
                return s
    parts, cur, depth = [], el, 0
    while cur is not None and is_el(cur) and cur.tag not in ("body", "html") and depth < 6:
        cid = cur.get("id") or ""
        if stable_id(cid):
            parts.insert(0, "#" + css_escape(cid))
            break
        parts.insert(0, part_for(cur))
        joined = " > ".join(parts)
        specific = len(parts) > 1 or re.search(r"[.#\[]", joined)
        if specific and count(sel, joined) == 1:
            return " > ".join(parts)
        cur = cur.getparent()
        depth += 1
    s = " > ".join(parts)
    return s if count(sel, s) >= 1 else ""


# ----------------------------------------------------------------- page type
def json_ld_products(sel):
    out = []

    def walk(n):
        if isinstance(n, list):
            for x in n:
                walk(x)
        elif isinstance(n, dict):
            t = n.get("@type")
            if t in ("Product", "ProductGroup") or (isinstance(t, list) and "Product" in t):
                out.append(n)
            for k in ("@graph", "itemListElement"):
                if k in n:
                    walk(n[k])

    for raw in sel.css('script[type="application/ld+json"]::text').getall():
        try:
            walk(json.loads(raw))
        except Exception:
            pass
    return out


def detect_page_type(sel, url):
    ld = json_ld_products(sel)
    if len(ld) == 1 and ld[0].get("offers"):
        return "product"
    if re.search(r"product", sel.css('meta[property="og:type"]::attr(content)').get() or "", re.I):
        return "product"
    if sel.css('meta[property="product:price:amount"], meta[property="og:price:amount"]'):
        return "product"
    if len(sel.css('[itemtype*="schema.org/Product"]')) == 1:
        return "product"
    if re.search(r"/(p|dp|product|products|pd|buy)/[^/]+", url, re.I) and sel.css("h1"):
        return "product"
    return "collection"


# ----------------------------------------------------------------- product page
def find_product_targets(sel):
    root = sel.root
    found = {}

    # add to cart: known selectors → id/class tokens → button text
    for c in ATC_CANDIDATES:
        if count(sel, c) == 1:
            found["add_to_cart"] = (c, 0.85)
            break
    if "add_to_cart" not in found:
        for el in root.iter("button", "input", "a"):
            if in_chrome(el):
                continue
            hay = " ".join([(el.get("id") or ""), (el.get("class") or ""), (el.get("data-testid") or "")]).lower()
            label = text_of(el) or el.get("value") or el.get("aria-label") or ""
            if any(t in hay for t in ATC_TOKENS) or CART_RE.search(label):
                s = selector_for(el, sel)
                if s:
                    found["add_to_cart"] = (s, 0.75 if any(t in hay for t in ATC_TOKENS) else 0.65)
                    break

    # product image: match JSON-LD / og:image file names against <img>
    wanted = []
    for p in json_ld_products(sel):
        imgs = p.get("image") or []
        for u in imgs if isinstance(imgs, list) else [imgs]:
            wanted.append(u.get("url") if isinstance(u, dict) else u)
    og = sel.css('meta[property="og:image"]::attr(content)').get()
    if og:
        wanted.append(og)
    keys = []
    for u in filter(None, wanted):
        name = re.sub(r"\.(jpe?g|png|webp|avif)$", "", u.split("?")[0].rstrip("/").split("/")[-1], flags=re.I)
        if len(name) > 5:
            keys.append(name[:24])
    if keys:
        for img in root.iter("img"):
            hay = " ".join(filter(None, [img.get("src"), img.get("srcset"), img.get("data-src"), img.get("data-srcset")]))
            if any(k in hay for k in keys) and not in_chrome(img):
                s = selector_for(img, sel)
                if s:
                    found["product_image"] = (s, 0.8)
                    break
    if "product_image" not in found:
        for c in ('[itemprop="image"]', ".product__media img", ".woocommerce-product-gallery__image img",
                  ".product-single__photo img", ".fotorama__stage img"):
            if count(sel, c):
                found["product_image"] = (c, 0.6)
                break

    h1 = next((h for h in root.iter("h1") if not in_chrome(h)), None)
    if h1 is not None:
        s = selector_for(h1, sel)
        if s:
            found["product_title"] = (s, 0.5)
    return found


# ----------------------------------------------------------------- collection page
def group_selector(cards, sel):
    tag = cards[0].tag
    common = [c for c in stable_classes(cards[0]) if all(c in (e.get("class") or "").split() for e in cards)]
    tries = []
    for a in ("data-product-id", "data-productid", "data-sku", "data-pid", "data-item-id"):
        if all(e.get(a) is not None for e in cards):
            tries.append(f"{tag}[{a}]")
    if common:
        tries.append(tag + "." + ".".join(css_escape(c) for c in common[:2]))
        tries.append("." + css_escape(common[0]))
    parent = cards[0].getparent()
    if parent is not None:
        tries.append(part_for(parent) + " > " + (tag + "." + css_escape(common[0]) if common else tag))
    n = len(cards)
    for t in tries:
        c = count(sel, t)
        if n * 0.9 <= c <= n * 1.6 + 2:
            return t
    return ""


def find_card_targets(sel):
    root = sel.root
    # 1) well-known card markup
    for c in CARD_CANDIDATES:
        els = [e for e in sel.css(c) if e.css("img") and (e.root.tag == "a" or e.css("a[href]"))]
        if len(els) >= 3:
            return {"card": (c, 0.8), "card_image": ("img", 0.6), "card_link": ("a[href]", 0.6)}

    # 2) structural: repeated sibling blocks containing image + link (+ price)
    groups = defaultdict(set)
    for a in root.iter("a"):
        if a.get("href") is None or in_chrome(a) or not any(True for _ in a.iter("img")):
            continue
        cur = a
        for _ in range(6):
            parent = cur.getparent()
            if parent is None or not is_el(parent):
                break
            sig = part_for(cur)
            similar = [ch for ch in parent if is_el(ch) and part_for(ch) == sig]
            if len(similar) >= 3:
                groups[(part_for(parent), sig)].add(cur)
                break
            cur = parent

    best, best_score = None, 0
    for key, cards in groups.items():
        cards = list(cards)
        priced = sum(1 for c in cards if PRICE_RE.search(text_of(c)))
        score = len(cards) + 2 * priced
        if len(cards) >= 3 and score > best_score:
            best, best_score = cards, score
    if not best:
        return {}
    gs = group_selector(best, sel)
    if not gs:
        return {}
    conf = min(0.85, 0.45 + len(best) / 40)
    out = {"card": (gs, conf), "card_image": ("img", 0.6)}
    if best[0].tag != "a":           # when the card itself is the <a>, no link selector is needed
        out["card_link"] = ("a[href]", 0.6)
    return out


def analyze(html, url):
    sel = Selector(text=html)
    page_type = detect_page_type(sel, url)
    targets = find_product_targets(sel) if page_type == "product" else find_card_targets(sel)
    # product pages often also contain card grids ("you may also like")
    extra_cards = find_card_targets(sel) if page_type == "product" else {}
    return page_type, targets, extra_cards
