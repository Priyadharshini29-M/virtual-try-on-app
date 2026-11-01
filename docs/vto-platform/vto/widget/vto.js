/*!
 * VTO Widget – platform-agnostic Virtual Try-On injector
 * Works on any storefront (custom, Shopify, Woo, Magento, React/Next SPAs like Nykaa/Ajio …)
 *
 * Embed (merchant adds once, e.g. via GTM or in the site <head>):
 *   <script async src="https://vto.yourdomain.com/widget/vto.js"
 *           data-vto-key="SITE_API_KEY"
 *           data-api="https://vto.yourdomain.com/backend/api"></script>
 *
 * Injection zones (each runs its own looped fallback):
 *   - "product" zone  : Try-On button next to Add-to-Cart  + icon on main product image
 *   - "cards" zone    : icon on every product card image (collection / search / "similar products")
 *
 * Fallback loop per zone:   Plan A (scrapy)  →  Plan B (block)  →  Plan C (inspect)
 *   repeated with back-off until something injects, then kept alive by a MutationObserver
 *   (infinite scroll, React re-renders, SPA route changes). Selectors found by B / C are
 *   reported to the server so Plan A uses them directly next time.
 */
(function () {
  'use strict';
  if (window.__VTO_LOADED__) return;
  window.__VTO_LOADED__ = true;

  /* ------------------------------------------------------------------ *
   *  Boot parameters
   * ------------------------------------------------------------------ */
  var script = document.currentScript || document.querySelector('script[data-vto-key]');
  if (!script) return;
  var KEY = script.getAttribute('data-vto-key');
  var API = (script.getAttribute('data-api') || (new URL(script.src).origin + '/backend/api')).replace(/\/$/, '');
  var DEBUG = script.getAttribute('data-debug') === '1' || /[?&]vto_debug=1/.test(location.search);
  var MARK = 'data-vto';
  var RETRY_DELAYS = [400, 900, 1600, 2500, 4000, 6500, 10000];

  function log() { if (DEBUG) console.log.apply(console, ['%c[VTO]', 'color:#7c3aed;font-weight:bold'].concat([].slice.call(arguments))); }

  var CFG = null;
  var VISITOR = (function () {
    try {
      var v = localStorage.getItem('vto_vid');
      if (!v) { v = uuid(); localStorage.setItem('vto_vid', v); }
      return v;
    } catch (e) { return uuid(); }
  })();

  /* ------------------------------------------------------------------ *
   *  Generic DOM utilities
   * ------------------------------------------------------------------ */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function $$(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    catch (e) { return []; }           // invalid selector from DB/heuristics never breaks the page
  }
  function $1(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function rect(el) { return el.getBoundingClientRect(); }
  function area(el) { var r = rect(el); return r.width * r.height; }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = rect(el);
    if (r.width < 2 || r.height < 2) return false;
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05;
  }
  function inChrome(el) {   // header / nav / footer / modal → never a product region
    return !!el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-modal="true"]');
  }
  function txt(el) { return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim(); }
  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }
  function pageTop(el) { return rect(el).top + window.scrollY; }

  var PRICE_RE = /(₹|rs\.?\s?|inr|mrp|\$|€|£|aed|sar|¥)\s?\d|\d[\d,]*(\.\d+)?\s?(₹|rs\b|inr)/i;
  var CART_RE = /\b(add\s*to\s*(cart|bag|basket)|buy\s*now|add\s*to\s*trolley|shop\s*now|kaufen|ajouter\s*au\s*panier)\b/i;
  var NOT_CART_RE = /wish|save|share|size\s*chart|size\s*guide|login|sign\s*in|search|menu|notify|compare|pincode|check|apply|coupon/i;

  /** best image URL from <img>/<picture>/background */
  function imgUrl(img) {
    if (!img) return '';
    if (img.tagName !== 'IMG') {
      var inner = img.querySelector && img.querySelector('img');
      if (inner) return imgUrl(inner);
      var bg = getComputedStyle(img).backgroundImage;
      var m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
      return m ? absUrl(m[1]) : '';
    }
    var best = '';
    var srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    if (srcset) {
      var maxW = 0;
      srcset.split(',').forEach(function (part) {
        var p = part.trim().split(/\s+/); var w = parseInt(p[1], 10) || 1;
        if (p[0] && w >= maxW) { maxW = w; best = p[0]; }
      });
    }
    var cand = best || img.currentSrc || img.getAttribute('data-src') || img.getAttribute('data-original') ||
               img.getAttribute('data-zoom-image') || img.src || '';
    if (!cand || /^data:|^blob:/.test(cand)) cand = img.getAttribute('data-src') || '';
    return cand ? absUrl(cand) : '';
  }

  /* ---- stable selector generation (used to "learn" selectors from Plan B / C) ---- */
  var UNSTABLE_CLASS = /^(css|sc|jsx|emotion|styled|tw|chakra|mui|makeStyles|jss)[-_]|^[a-z]{1,3}[-_][a-z0-9]{5,}$|__[a-z0-9]{5,}$|_[a-z0-9]{5}$|\d{3,}|^(active|selected|hover|focus|is-|has-|lazy|loaded|swiper-slide-(active|next|prev)|slick-(active|current|cloned)|ng-|v-)/i;
  function stableClasses(el) {
    return Array.prototype.filter.call(el.classList || [], function (c) {
      return c.length > 1 && c.length < 40 && !UNSTABLE_CLASS.test(c);
    });
  }
  function stableId(id) { return id && id.length < 50 && !/\d{4,}|^[a-f0-9-]{16,}$|:r\d|^ember|^yui_/i.test(id); }
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'); }

  function partFor(el) {
    var tag = el.tagName.toLowerCase();
    var cls = stableClasses(el).slice(0, 2).map(function (c) { return '.' + esc(c); }).join('');
    return tag + cls;
  }

  /** Unique-ish selector for ONE element (product page targets) */
  function selectorFor(el) {
    if (el.id && stableId(el.id) && $$('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    var attrs = ['data-testid', 'data-test', 'data-qa', 'data-test-id', 'data-automation-id', 'itemprop', 'name', 'aria-label'];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v && v.length < 60 && !/\d{4,}/.test(v)) {
        var s = el.tagName.toLowerCase() + '[' + attrs[i] + '="' + v.replace(/"/g, '\\"') + '"]';
        if ($$(s).length === 1) return s;
      }
    }
    var parts = [], cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 6) {
      if (cur.id && stableId(cur.id)) { parts.unshift('#' + esc(cur.id)); break; }
      parts.unshift(partFor(cur));
      var joined = parts.join(' > ');
      // a bare tag like "img" is unique today but breaks on the next page → require more context
      var specific = parts.length > 1 || /[.#\[]/.test(joined);
      if (specific && $$(joined).length === 1) return joined;
      cur = cur.parentElement; depth++;
    }
    var sel = parts.join(' > ');
    var all = $$(sel);
    if (all.length > 1) {   // disambiguate the target with nth-of-type
      var sibIdx = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) sibIdx++;
      var withNth = sel + ':nth-of-type(' + sibIdx + ')';
      if ($$(withNth).length >= 1 && $$(withNth)[0] === el) return withNth;
      return all[0] === el ? sel : '';
    }
    return all[0] === el ? sel : '';
  }

  /** Selector that matches a GROUP of similar elements (product cards) */
  function groupSelector(els) {
    if (!els.length) return '';
    var tag = els[0].tagName.toLowerCase();
    var common = stableClasses(els[0]).filter(function (c) {
      return els.every(function (e) { return e.classList.contains(c); });
    });
    var tries = [];
    // attribute-based (data-product-id, data-sku …) – very robust across redesigns
    ['data-product-id', 'data-productid', 'data-sku', 'data-pid', 'data-item-id', 'data-product'].forEach(function (a) {
      if (els.every(function (e) { return e.hasAttribute(a); })) tries.push(tag + '[' + a + ']');
    });
    if (common.length) {
      tries.push(tag + '.' + common.slice(0, 2).map(esc).join('.'));
      tries.push('.' + esc(common[0]));
    }
    var parent = els[0].parentElement;
    if (parent && els.every(function (e) { return e.parentElement && partFor(e.parentElement) === partFor(parent); })) {
      tries.push(partFor(parent) + ' > ' + (common.length ? tag + '.' + esc(common[0]) : tag));
    }
    for (var i = 0; i < tries.length; i++) {
      var found = $$(tries[i]);
      var covered = els.filter(function (e) { return found.indexOf(e) > -1; }).length;
      if (covered >= els.length * 0.9 && found.length <= els.length * 1.6 + 2) return tries[i];
    }
    return '';
  }

  /** Relative selector from a card to a child (image / link) */
  function relSelector(card, child) {
    if (!child) return '';
    var simple = child.tagName.toLowerCase() + (child.tagName === 'A' ? '[href]' : '');
    if (card.querySelector(simple) === child) return simple;
    var p = partFor(child);
    if (card.querySelector(p) === child) return p;
    var parts = [], cur = child;
    while (cur && cur !== card && parts.length < 4) { parts.unshift(partFor(cur)); cur = cur.parentElement; }
    var s = parts.join(' > ');
    return card.querySelector(s) === child ? s : simple;
  }

  function largestImg(root) {
    var best = null, bestA = 0;
    $$('img, picture, [style*="background-image"]', root).forEach(function (im) {
      if (!visible(im)) return;
      var a = area(im);
      if (a > bestA) { bestA = a; best = im.tagName === 'PICTURE' ? (im.querySelector('img') || im) : im; }
    });
    return best;
  }

  /* ------------------------------------------------------------------ *
   *  Page type detection
   * ------------------------------------------------------------------ */
  function jsonLdProducts() {
    var out = [];
    $$('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var data = JSON.parse(s.textContent);
        (function walk(n) {
          if (!n) return;
          if (Array.isArray(n)) return n.forEach(walk);
          if (typeof n === 'object') {
            var t = n['@type'];
            if (t === 'Product' || (Array.isArray(t) && t.indexOf('Product') > -1) || t === 'ProductGroup') out.push(n);
            if (n['@graph']) walk(n['@graph']);
            if (n.itemListElement) walk(n.itemListElement);
          }
        })(data);
      } catch (e) { /* ignore broken JSON-LD */ }
    });
    return out;
  }

  function detectPageType() {
    var href = location.href;
    try {
      if (CFG.patterns.product && new RegExp(CFG.patterns.product, 'i').test(href)) return 'product';
      if (CFG.patterns.collection && new RegExp(CFG.patterns.collection, 'i').test(href)) return 'collection';
    } catch (e) { /* bad regex from admin – ignore */ }

    var ld = jsonLdProducts();
    if (ld.length === 1 && ld[0].offers) return 'product';
    var og = $1('meta[property="og:type"]');
    if (og && /product/i.test(og.content || '')) return 'product';
    if ($1('meta[property="product:price:amount"], meta[property="og:price:amount"]')) return 'product';
    if ($$('[itemtype*="schema.org/Product"]').length === 1) return 'product';
    if (/\/(p|dp|product|products|pd|buy)\/[^/]+/i.test(location.pathname) && $1('h1')) return 'product';
    var ctas = $$('button, a, input[type="submit"], [role="button"]').filter(function (b) {
      return CART_RE.test(txt(b) || b.value || b.getAttribute('aria-label') || '') && visible(b) && !inChrome(b);
    });
    if (ctas.length && ctas.length <= 3 && $1('h1')) return 'product';
    return 'collection';
  }

  /* ================================================================== *
   *  PLAN A — "scrapy": selectors from the server (found by the Scrapy
   *  scanner, previously learned by B/C, or entered manually in admin)
   * ================================================================== */
  function planScrapy(zone, pageType) {
    var sels = (CFG.selectors[zone === 'product' ? 'product' : 'collection']) || {};
    var res = { plan: 'scrapy', hits: [], misses: [], learned: [] };

    function first(target, root, multi) {
      var list = sels[target] || [];
      for (var i = 0; i < list.length; i++) {
        var found = $$(list[i].sel, root).filter(visible);
        if (found.length) { res.hits.push(list[i].id); return { els: multi ? found : [found[0]], sel: list[i].sel, src: list[i].src }; }
        if (!root) res.misses.push(list[i].id);
      }
      return null;
    }

    if (zone === 'product') {
      var atc = first('add_to_cart');
      var img = first('product_image');
      if (!atc) { var t = first('product_title'); if (t) atc = { els: t.els, sel: t.sel, after: true }; }
      res.addToCart = atc && atc.els[0];
      res.productImage = img && (img.els[0].tagName === 'IMG' ? img.els[0] : (largestImg(img.els[0]) || img.els[0]));
    } else {
      var cards = first('card', null, true);
      if (cards) {
        res.cards = cards.els.map(function (card) {
          var imgSel = (sels.card_image || [])[0], linkSel = (sels.card_link || [])[0];
          return {
            card: card,
            img: (imgSel && $1(imgSel.sel, card)) || largestImg(card),
            link: (linkSel && $1(linkSel.sel, card)) || card.querySelector('a[href]') || (card.tagName === 'A' ? card : null)
          };
        });
        res.cardSelector = cards.sel;
      }
    }
    return res;
  }

  /* ================================================================== *
   *  PLAN B — "block": visual/structural block segmentation.
   *  Cards  : find repeated sibling blocks that each contain image + link + price
   *  Product: split page into blocks, pick the main media block (largest
   *           image above the fold) and the primary CTA in the info block
   * ================================================================== */
  function planBlock(zone) {
    var res = { plan: 'block', learned: [] };

    if (zone === 'product') {
      // 1) media block: largest product-like image near the top
      var imgs = $$('img').filter(function (im) {
        if (!visible(im) || inChrome(im)) return false;
        var r = rect(im);
        return r.width >= 180 && r.height >= 180 && pageTop(im) < 1600 && r.width / r.height < 2.2;
      }).sort(function (a, b) { return area(b) - area(a); });
      var mainImg = imgs[0] || null;

      // 2) info block: the block containing h1 + price
      var h1 = $$('h1').filter(function (h) { return visible(h) && !inChrome(h); })[0];
      var infoBlock = null;
      if (h1) {
        var cur = h1;
        for (var i = 0; i < 8 && cur && cur !== document.body; i++) {
          if (PRICE_RE.test(txt(cur)) && $$('button, [role="button"], input[type="submit"], a', cur).length) { infoBlock = cur; break; }
          cur = cur.parentElement;
        }
      }
      var priceEls = $$('*').filter(function (el) {
        return el.children.length === 0 && PRICE_RE.test(el.textContent || '') && (el.textContent || '').length < 30 && visible(el) && !inChrome(el);
      }).slice(0, 15);

      // 3) primary CTA scoring
      var best = null, bestScore = 0;
      $$('button, [role="button"], input[type="submit"], a').forEach(function (b) {
        if (!visible(b) || inChrome(b)) return;
        var label = txt(b) || b.value || b.getAttribute('aria-label') || '';
        if (label.length < 2 || label.length > 40 || NOT_CART_RE.test(label)) return;
        var a = area(b); if (a < 1200) return;
        var score = Math.min(a / 8000, 3);
        if (infoBlock && infoBlock.contains(b)) score += 3;
        if (CART_RE.test(label)) score += 4;
        var bg = getComputedStyle(b).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') score += 1;
        if (priceEls.length) {
          var br = rect(b);
          var d = Math.min.apply(null, priceEls.map(function (p) {
            var pr = rect(p); return Math.hypot(pr.left - br.left, pr.top - br.top);
          }));
          score += Math.max(0, 2 - d / 400);
        }
        if (mainImg) {   // CTA is usually right of (desktop) or below (mobile) the media block
          var ir = rect(mainImg), r2 = rect(b);
          if (r2.left >= ir.right - 40 || r2.top >= ir.bottom - 40) score += 1;
        }
        if (score > bestScore) { bestScore = score; best = b; }
      });
      if (bestScore < 4) best = null;   // not confident → let Plan C try

      res.addToCart = best;
      res.productImage = mainImg;
      if (best) { var s1 = selectorFor(best); if (s1) res.learned.push({ target: 'add_to_cart', selector: s1, confidence: Math.min(0.9, bestScore / 12) }); }
      if (mainImg) { var s2 = selectorFor(mainImg); if (s2) res.learned.push({ target: 'product_image', selector: s2, confidence: 0.6 }); }
      return res;
    }

    // ---- cards zone: repeated sibling blocks ----
    var anchors = $$('a[href]').filter(function (a) {
      var im = a.querySelector('img, picture, [style*="background-image"]');
      return im && visible(im) && !inChrome(a) && area(im) > 6000;
    });
    var groups = {};
    anchors.forEach(function (a) {
      // climb until the element's parent holds >= 3 similar siblings → that element is a card
      var cur = a;
      for (var i = 0; i < 6 && cur && cur.parentElement; i++) {
        var parent = cur.parentElement;
        var sig = partFor(cur);
        var similar = Array.prototype.filter.call(parent.children, function (c) { return partFor(c) === sig; });
        if (similar.length >= 3) {
          var key = partFor(parent) + ' > ' + sig;
          (groups[key] = groups[key] || { cards: new Set(), price: 0 }).cards.add(cur);
          break;
        }
        cur = parent;
      }
    });
    var bestGroup = null, bestG = 0;
    Object.keys(groups).forEach(function (k) {
      var cards = Array.from(groups[k].cards);
      var withPrice = cards.filter(function (c) { return PRICE_RE.test(txt(c)); }).length;
      var score = cards.length + withPrice * 2;
      if (cards.length >= 2 && score > bestG) { bestG = score; bestGroup = cards; }
    });
    // include all siblings (cards whose image is still lazy)
    if (bestGroup) {
      var sig = partFor(bestGroup[0]);
      var parents = new Set(bestGroup.map(function (c) { return c.parentElement; }));
      var all = [];
      parents.forEach(function (p) { Array.prototype.forEach.call(p.children, function (c) { if (partFor(c) === sig) all.push(c); }); });
      bestGroup = all.filter(visible);
      res.cards = bestGroup.map(function (card) {
        return { card: card, img: largestImg(card), link: card.tagName === 'A' ? card : card.querySelector('a[href]') };
      }).filter(function (c) { return c.img; });

      var gs = groupSelector(bestGroup);
      if (gs && res.cards.length) {
        res.cardSelector = gs;
        res.learned.push({ target: 'card', selector: gs, confidence: Math.min(0.85, 0.4 + res.cards.length / 40) });
        var c0 = res.cards[0];
        var is = relSelector(c0.card, c0.img.tagName === 'IMG' ? c0.img : (c0.img.querySelector('img') || c0.img));
        if (is) res.learned.push({ target: 'card_image', selector: is, confidence: 0.6 });
        if (c0.link && c0.link !== c0.card) { var ls = relSelector(c0.card, c0.link); if (ls) res.learned.push({ target: 'card_link', selector: ls, confidence: 0.6 }); }
      }
    }
    return res;
  }

  /* ================================================================== *
   *  PLAN C — "inspect": semantic inspection of ids / attributes / markup
   *  (JSON-LD, microdata, og:image, ARIA, common platform class names,
   *   cart forms, button labels)
   * ================================================================== */
  var ATC_SELECTORS = [
    'form[action*="/cart/add"] [type="submit"]', 'button[name="add"]', '[name="add-to-cart"]',
    '#add-to-cart', '#addToCart', '#AddToCart', '#product-addtocart-button', '.single_add_to_cart_button',
    '[data-testid*="add-to-cart" i]', '[data-testid*="addtocart" i]', '[data-testid*="add-to-bag" i]',
    '[id*="add-to-cart" i]', '[id*="addtocart" i]', '[id*="add-to-bag" i]', '[id*="addtobag" i]',
    '[class*="add-to-cart" i]', '[class*="addtocart" i]', '[class*="add-to-bag" i]', '[class*="addtobag" i]',
    '[class*="btn-cart" i]', '[class*="pdp-add" i]', '[aria-label*="add to cart" i]', '[aria-label*="add to bag" i]'
  ];
  var IMG_SELECTORS = [
    '[itemprop="image"]', '.product__media img', '.product-single__photo img', '.woocommerce-product-gallery__image img',
    '.fotorama__stage img', '.gallery-placeholder img', '[class*="pdp-image" i] img', '[class*="product-image" i] img',
    '[class*="productImage" i] img', '[class*="main-image" i] img', '[data-testid*="product-image" i] img', '[class*="image-gallery" i] img'
  ];
  var CARD_SELECTORS = [
    '[itemtype*="schema.org/Product"]', '[data-product-id]', '[data-productid]', '[data-sku]',
    '.product-card', '.product-item', '.product-tile', '.product-grid-item', '.grid-product', '.card-wrapper',
    'li.product', '.productCard', '.plp-card', '.item-card', '.product-base', '.css-product-card',
    '[class*="product-card" i]', '[class*="productcard" i]', '[class*="product-tile" i]', '[class*="ProductTile" i]',
    '[class*="product-item" i]', '[class*="productItem" i]', '[class*="plp" i][class*="item" i]', '[data-testid*="product-card" i]'
  ];

  function planInspect(zone) {
    var res = { plan: 'inspect', learned: [] };

    if (zone === 'product') {
      // --- add to cart ---
      var atc = null, atcSel = '';
      for (var i = 0; i < ATC_SELECTORS.length && !atc; i++) {
        var f = $$(ATC_SELECTORS[i]).filter(function (b) { return visible(b) && !inChrome(b); });
        if (f.length) { atc = f[0]; atcSel = ATC_SELECTORS[i]; }
      }
      if (!atc) {
        atc = $$('button, [role="button"], input[type="submit"], a').filter(function (b) {
          return visible(b) && !inChrome(b) && CART_RE.test(txt(b) || b.value || b.getAttribute('aria-label') || '');
        }).sort(function (a, b) { return area(b) - area(a); })[0] || null;
      }
      // --- product image: match JSON-LD / og:image file name with <img> on page ---
      var wanted = [];
      jsonLdProducts().forEach(function (p) { [].concat(p.image || []).forEach(function (u) { wanted.push(typeof u === 'string' ? u : (u && u.url) || ''); }); });
      var og = $1('meta[property="og:image"]'); if (og) wanted.push(og.content);
      var keys = wanted.filter(Boolean).map(function (u) {
        var name = (u.split('?')[0].split('/').pop() || '').replace(/\.(jpe?g|png|webp|avif)$/i, '');
        return name.length > 5 ? name.slice(0, 24) : '';
      }).filter(Boolean);

      var img = null, imgSel = '';
      if (keys.length) {
        img = $$('img').filter(function (im) {
          var s = (im.currentSrc || im.src || '') + ' ' + (im.getAttribute('srcset') || '') + ' ' + (im.getAttribute('data-src') || '');
          return visible(im) && area(im) > 20000 && keys.some(function (k) { return s.indexOf(k) > -1; });
        }).sort(function (a, b) { return area(b) - area(a); })[0] || null;
      }
      for (var j = 0; j < IMG_SELECTORS.length && !img; j++) {
        var c = $$(IMG_SELECTORS[j]).filter(function (im) { return visible(im) && area(im) > 20000; });
        if (c.length) { img = c[0].tagName === 'IMG' ? c[0] : largestImg(c[0]); imgSel = IMG_SELECTORS[j]; }
      }
      if (!img) {   // alt text that matches the product title
        var title = txt($1('h1')).toLowerCase().slice(0, 25);
        if (title) img = $$('img[alt]').filter(function (im) { return visible(im) && area(im) > 20000 && im.alt.toLowerCase().indexOf(title) > -1; })[0] || null;
      }
      res.addToCart = atc;
      res.productImage = img;
      if (atc) res.learned.push({ target: 'add_to_cart', selector: (atcSel && $$(atcSel).length === 1) ? atcSel : selectorFor(atc), confidence: atcSel ? 0.8 : 0.65 });
      if (img) res.learned.push({ target: 'product_image', selector: (imgSel && $$(imgSel)[0] === img) ? imgSel : selectorFor(img), confidence: 0.65 });
      return res;
    }

    // --- cards ---
    for (var k = 0; k < CARD_SELECTORS.length; k++) {
      var cards = $$(CARD_SELECTORS[k]).filter(function (c) {
        return visible(c) && !inChrome(c) && c.querySelector('img') && (c.tagName === 'A' || c.querySelector('a[href]'));
      });
      // drop nested matches (keep outermost card)
      cards = cards.filter(function (c) { return !cards.some(function (o) { return o !== c && o.contains(c); }); });
      if (cards.length >= 2) {
        res.cards = cards.map(function (card) {
          return { card: card, img: largestImg(card), link: card.tagName === 'A' ? card : card.querySelector('a[href]') };
        }).filter(function (c) { return c.img; });
        if (res.cards.length >= 2) {
          res.cardSelector = CARD_SELECTORS[k];
          res.learned.push({ target: 'card', selector: CARD_SELECTORS[k], confidence: 0.7 });
          var c0 = res.cards[0];
          var is = relSelector(c0.card, c0.img.tagName === 'IMG' ? c0.img : (c0.img.querySelector('img') || c0.img));
          if (is) res.learned.push({ target: 'card_image', selector: is, confidence: 0.6 });
          break;
        }
      }
    }
    return res;
  }

  var PLANS = { scrapy: planScrapy, block: planBlock, inspect: planInspect };

  /* ------------------------------------------------------------------ *
   *  Injection
   * ------------------------------------------------------------------ */
  var ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l-4 3v4l2 1v10h12V11l2-1V6l-4-3"/><path d="M8 3a4 4 0 0 0 8 0"/><path d="M19 15.5l1 1 2-2"/></svg>';
  // icons offered by the FitFyce Widget Settings (same paths as the FitFyce storefront widget)
  var ICON_PATHS = {
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    sparkles: '<path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    'shopping-bag': '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>'
  };
  /** configured icon; '' for the button when the merchant picked "none" (overlay icons always need one) */
  function iconSvg(forButton) {
    var name = CFG.ui.icon;
    if (name === 'none') return forButton ? '' : ICON_SVG;
    if (!ICON_PATHS[name]) return ICON_SVG;
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON_PATHS[name] + '</svg>';
  }

  function injectStyles() {
    if (document.getElementById('vto-styles')) return;
    var st = document.createElement('style');
    st.id = 'vto-styles';
    st.textContent =
      '.vto-btn{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:46px;margin:10px 0;padding:12px 18px;border-radius:var(--vto-radius,6px);cursor:pointer;font:600 var(--vto-title,15px)/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.2px;background:var(--vto-bg,#111);color:var(--vto-fg,#fff);transition:transform .15s,box-shadow .15s,background .15s}' +
      '.vto-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.18);background:var(--vto-hover,var(--vto-bg,#111))}' +
      '.vto-btn .vto-txt{display:flex;flex-direction:column;align-items:flex-start;text-align:left}' +
      '.vto-btn .vto-sub{font-weight:400;font-size:var(--vto-sub,13px);opacity:.9;margin-top:2px}' +
      '@media(max-width:720px){.vto-btn{font-size:var(--vto-title-m,var(--vto-title,15px))}}' +
      '.vto-btn:focus-visible,.vto-icon:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}' +
      '.vto-icon{all:unset;box-sizing:border-box;position:absolute;z-index:20;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--vto-icon-bg,var(--vto-bg,#111));color:var(--vto-icon-fg,var(--vto-fg,#fff));box-shadow:0 2px 10px rgba(0,0,0,.25);transition:transform .15s}' +
      '.vto-icon:hover{transform:scale(1.08)}' +
      '.vto-icon.vto-card{width:32px;height:32px;bottom:10px;right:10px;background:var(--vto-card-bg,var(--vto-bg,#111))}' +
      '.vto-icon.vto-main{top:14px;right:14px;background:var(--vto-main-bg,var(--vto-bg,#111))}' +
      '.vto-icon .vto-tip{position:absolute;right:42px;white-space:nowrap;background:#111;color:#fff;font:500 12px system-ui,sans-serif;padding:4px 8px;border-radius:4px;opacity:0;pointer-events:none;transition:opacity .15s}' +
      '.vto-icon:hover .vto-tip{opacity:1}';
    document.head.appendChild(st);
    var ui = CFG.ui, rootStyle = document.documentElement.style;
    // a transparent icon background would hide a white icon on light product photos → use the button colour
    var solid = function (c) { return c && c !== 'transparent' ? c : ''; };
    var vars = {
      '--vto-bg': ui.color, '--vto-fg': ui.textColor, '--vto-hover': ui.hoverColor,
      '--vto-radius': ui.radius != null ? ui.radius + 'px' : '',
      '--vto-title': ui.titleSize ? ui.titleSize + 'px' : '', '--vto-title-m': ui.mobileTitleSize ? ui.mobileTitleSize + 'px' : '',
      '--vto-sub': ui.subtitleSize ? ui.subtitleSize + 'px' : '',
      '--vto-icon-fg': ui.iconColor, '--vto-main-bg': solid(ui.mainIconBg), '--vto-card-bg': solid(ui.cardIconBg)
    };
    Object.keys(vars).forEach(function (k) { if (vars[k]) rootStyle.setProperty(k, vars[k]); });
  }

  /** container for an absolutely positioned overlay icon */
  function overlayHost(img) {
    var host = img.tagName === 'IMG' && img.parentElement ? img.parentElement : img;
    if (host.tagName === 'PICTURE' && host.parentElement) host = host.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    return host;
  }

  function makeIcon(cls, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'vto-icon ' + cls;
    b.setAttribute(MARK, 'icon');
    b.setAttribute('aria-label', label);
    b.innerHTML = iconSvg(false) + '<span class="vto-tip">' + label + '</span>';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(); }, true);
    // stop the card's own <a> from navigating on mousedown/touch handlers
    ['mousedown', 'touchstart', 'pointerdown'].forEach(function (ev) { b.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
    return b;
  }

  function productContext() {
    var ld = jsonLdProducts()[0] || {};
    var ogImg = $1('meta[property="og:image"]');
    return {
      title: ld.name || txt($1('h1')) || document.title,
      url: location.href,
      fallbackImage: [].concat(ld.image || [])[0] || (ogImg && ogImg.content) || ''
    };
  }

  var currentProductImg = null;   // shared so a button injected by one plan can use an image found by another
  function injectProduct(r) {
    var n = 0, ctx = productContext();
    if (r.productImage) currentProductImg = r.productImage;
    var image = function () {
      var im = (currentProductImg && currentProductImg.isConnected) ? currentProductImg : r.productImage;
      return imgUrl(im) || absUrl(typeof ctx.fallbackImage === 'string' ? ctx.fallbackImage : (ctx.fallbackImage && ctx.fallbackImage.url) || '');
    };

    if (CFG.ui.productButton && r.addToCart && !document.querySelector('.vto-btn[' + MARK + ']')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vto-btn';
      btn.setAttribute(MARK, 'product');
      btn.innerHTML = iconSvg(true) + '<span class="vto-txt"><span class="vto-title"></span></span>';
      btn.querySelector('.vto-title').textContent = CFG.ui.text;
      if (CFG.ui.subtitle) {
        var sub = document.createElement('span'); sub.className = 'vto-sub'; sub.textContent = CFG.ui.subtitle;
        btn.querySelector('.vto-txt').appendChild(sub);
      }
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openTryOn({ image: image(), title: ctx.title, url: ctx.url, trigger: 'product_button', plan: r.plan });
      });
      var anchor = r.addToCart;
      // if ATC sits in a tight flex row with other buttons, put ours after that row
      var parent = anchor.parentElement;
      if (parent && getComputedStyle(parent).display.indexOf('flex') > -1 && getComputedStyle(parent).flexDirection.indexOf('row') === 0 && parent.children.length > 1) anchor = parent;
      anchor.insertAdjacentElement('afterend', btn);
      n++;
    }
    if (CFG.ui.imageIcon && r.productImage && !r.productImage.hasAttribute(MARK)) {
      r.productImage.setAttribute(MARK, 'img');
      var host = overlayHost(r.productImage);
      if (!host.querySelector(':scope > .vto-icon')) {
        host.appendChild(makeIcon('vto-main', CFG.ui.text, function () {
          openTryOn({ image: image(), title: ctx.title, url: ctx.url, trigger: 'image_icon', plan: r.plan });
        }));
        n++;
      }
    }
    return n;
  }

  function injectCards(r) {
    if (!CFG.ui.cardIcon || !r.cards) return 0;
    var n = 0;
    r.cards.forEach(function (c) {
      if (!c.img || c.card.hasAttribute(MARK)) return;
      c.card.setAttribute(MARK, 'card');
      var host = overlayHost(c.img);
      if (host.querySelector(':scope > .vto-icon')) return;
      host.appendChild(makeIcon('vto-card', CFG.ui.text, function () {
        var imEl = c.img.tagName === 'IMG' ? c.img : (c.img.querySelector('img') || c.img);
        openTryOn({
          image: imgUrl(imEl),
          title: (imEl.alt || txt(c.card).slice(0, 120)),
          url: c.link ? absUrl(c.link.getAttribute('href')) : location.href,
          trigger: 'card_icon', plan: r.plan
        });
      }));
      n++;
    });
    return n;
  }

  /* ------------------------------------------------------------------ *
   *  The looped fallback engine
   * ------------------------------------------------------------------ */
  var zones = {};   // zone -> { winner: {plan, ...}, running: bool, gen: number }
  var generation = 0;

  function runZone(zone, pageType) {
    var z = zones[zone] = zones[zone] || {};
    if (z.running) return;
    z.running = true;
    var gen = generation, tried = [], attempt = 0, hits = [], misses = [];

    (function loop() {
      if (gen !== generation) { z.running = false; return; }   // route changed → abandon
      for (var i = 0; i < CFG.plans.length; i++) {
        var planName = CFG.plans[i];
        if (tried.indexOf(planName) === -1) tried.push(planName);
        var r;
        try { r = PLANS[planName](zone, pageType); } catch (err) { log('plan error', planName, err); continue; }
        if (r.hits) hits = hits.concat(r.hits);
        if (r.misses) misses = misses.concat(r.misses);
        var count = zone === 'product' ? injectProduct(r) : injectCards(r);
        var already = document.querySelectorAll(zone === 'product' ? '[' + MARK + '="product"],[' + MARK + '="img"]' : '[' + MARK + '="card"]').length;

        if (count > 0 || (already > 0 && zone === 'product')) {
          log('zone', zone, '→ injected by plan', planName, count, r);
          z.winner = r; z.running = false;
          report({
            event: 'inject', pageType: zone === 'product' ? 'product' : 'collection', plan: planName,
            injected: count || already, tried: tried,
            hits: uniq(hits), misses: uniq(misses.filter(function (id) { return hits.indexOf(id) === -1; })),
            learned: planName === 'scrapy' ? [] : r.learned
          });
          if (zone === 'product') completeProduct(r, i, pageType);
          return;
        }
        log('zone', zone, 'plan', planName, 'found nothing → fallback');
      }
      if (attempt < RETRY_DELAYS.length) {
        setTimeout(loop, RETRY_DELAYS[attempt++]);    // page may still be rendering → loop again
      } else {
        z.running = false;
        if (zone === 'product') report({ event: 'inject', pageType: 'product', plan: 'none', injected: 0, tried: tried, misses: uniq(misses) });
        log('zone', zone, 'gave up after', attempt, 'rounds');
      }
    })();
  }

  /**
   * A plan may find only half of the product page (e.g. Plan A knows the Add-to-cart
   * but not the image). Ask the remaining plans for the missing piece and learn it.
   */
  function completeProduct(r, fromIndex, pageType) {
    var needBtn = CFG.ui.productButton && !r.addToCart;
    var needImg = CFG.ui.imageIcon && !r.productImage;
    for (var i = 0; i < CFG.plans.length && (needBtn || needImg); i++) {
      if (CFG.plans[i] === r.plan) continue;
      var extra;
      try { extra = PLANS[CFG.plans[i]]('product', pageType); } catch (e) { continue; }
      var patch = { plan: extra.plan, learned: [] };
      if (needBtn && extra.addToCart) { patch.addToCart = extra.addToCart; needBtn = false; }
      if (needImg && extra.productImage) { patch.productImage = extra.productImage; needImg = false; }
      if (!patch.addToCart && !patch.productImage) continue;
      if (injectProduct(patch) > 0) {
        log('completed product zone with plan', extra.plan, patch);
        if (extra.plan !== 'scrapy') {
          patch.learned = (extra.learned || []).filter(function (l) {
            return (patch.addToCart && l.target === 'add_to_cart') || (patch.productImage && l.target === 'product_image');
          });
          if (patch.learned.length) report({ event: 'learn', pageType: 'product', plan: extra.plan, learned: patch.learned });
        }
      }
    }
  }

  /** Keep-alive: re-apply the winning plan on DOM changes (infinite scroll, re-renders) */
  function reapply() {
    var pageType = detectPageType();
    ['product', 'cards'].forEach(function (zone) {
      if (zone === 'product' && pageType !== 'product') return;
      var z = zones[zone];
      if (z && z.running) return;
      if (z && z.winner) {
        var r;
        try { r = PLANS[z.winner.plan](zone, pageType); } catch (e) { r = null; }
        if (r) {
          if (zone === 'product') {
            // the store re-rendered its PDP (React/Vue) and wiped our button → run the full loop again
            if (!document.querySelector('[' + MARK + '="product"]') && !document.querySelector('.vto-icon.vto-main')) {
              z.winner = null; runZone(zone, pageType);
            }
          } else {
            injectCards(r);
          }
        }
      } else {
        runZone(zone, pageType);
      }
    });
  }

  var moTimer = null;
  function startObserver() {
    var mo = new MutationObserver(function (muts) {
      // ignore our own mutations
      var relevant = muts.some(function (m) {
        return Array.prototype.some.call(m.addedNodes, function (n) { return n.nodeType === 1 && !(n.hasAttribute && n.hasAttribute(MARK)); });
      });
      if (!relevant) return;
      clearTimeout(moTimer);
      moTimer = setTimeout(reapply, 450);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function hookSpaNavigation() {
    var last = location.href;
    function onNav() {
      if (location.href === last) return;
      last = location.href;
      generation++;
      zones = {};
      currentProductImg = null;
      log('route change →', location.href);
      setTimeout(start, 300);
    }
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () { var ret = orig.apply(this, arguments); setTimeout(onNav, 0); return ret; };
    });
    window.addEventListener('popstate', onNav);
  }

  function start() {
    var pageType = detectPageType();
    log('page type:', pageType);
    if (pageType === 'product') runZone('product', pageType);
    runZone('cards', pageType);   // cards also appear on PDP ("similar products"), home, search
  }

  /* ------------------------------------------------------------------ *
   *  Networking
   * ------------------------------------------------------------------ */
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function report(body) {
    body.url = location.href;
    try {
      fetch(API + '/report.php?key=' + encodeURIComponent(KEY), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true, mode: 'cors'
      }).catch(function () {});
    } catch (e) { /* never break the store */ }
  }

  /* ------------------------------------------------------------------ *
   *  Try-on modal (Shadow DOM → immune to the store's CSS)
   * ------------------------------------------------------------------ */
  var modal = null;
  function buildModal() {
    var host = document.createElement('div');
    host.setAttribute(MARK, 'modal');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:none';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.bd{position:fixed;inset:0;background:rgba(10,10,15,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.md{background:#fff;color:#111;width:min(880px,100%);max-height:92vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:grid;grid-template-columns:1fr 1fr}' +
      '@media(max-width:720px){.md{grid-template-columns:1fr}}' +
      '.pane{padding:22px}.pane+.pane{background:#f6f6f8}' +
      'h2{margin:0 0 4px;font-size:19px}p{margin:0 0 14px;color:#555;font-size:13.5px;line-height:1.5}' +
      '.x{position:absolute;top:10px;right:14px;border:0;background:#fff;width:34px;height:34px;border-radius:50%;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15)}' +
      '.prod{display:flex;gap:12px;align-items:center;margin:14px 0;padding:10px;border:1px solid #eee;border-radius:10px}' +
      '.prod img{width:64px;height:80px;object-fit:cover;border-radius:6px;background:#eee}.prod b{font-size:13.5px;display:block}' +
      '.drop{display:block;border:2px dashed #ccc;border-radius:12px;padding:22px;text-align:center;cursor:pointer;color:#444;font-size:14px}' +
      '.drop:hover{border-color:' + CFG.ui.color + '}.drop img{max-width:100%;max-height:260px;border-radius:8px;display:block;margin:0 auto}' +
      '.go{margin-top:14px;width:100%;border:0;border-radius:8px;padding:14px;font-weight:600;font-size:15px;cursor:pointer;background:' + CFG.ui.color + ';color:' + CFG.ui.textColor + '}' +
      '.go[disabled]{opacity:.45;cursor:not-allowed}' +
      '.res{min-height:340px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;color:#666;font-size:14px;gap:10px}' +
      '.res img{max-width:100%;max-height:70vh;border-radius:10px}' +
      '.spin{width:38px;height:38px;border:4px solid #ddd;border-top-color:' + CFG.ui.color + ';border-radius:50%;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}' +
      '.err{color:#b42318}.note{font-size:11.5px;color:#888;margin-top:10px}a.dl{color:#111;font-size:13px}' +
      '</style>' +
      '<div class="bd" part="backdrop"><div class="md" role="dialog" aria-modal="true" aria-label="Virtual try-on" style="position:relative">' +
      '<button class="x" aria-label="Close">×</button>' +
      '<div class="pane"><h2></h2><p>Upload a clear, front-facing photo (full or half body, good light).</p>' +
      '<div class="prod"><img alt=""><div><b></b><small>Selected product</small></div></div>' +
      '<label class="drop" tabindex="0"><input type="file" accept="image/jpeg,image/png,image/webp" hidden><span>📷 Tap to upload or take a photo</span></label>' +
      '<button class="go" disabled>Generate my look</button>' +
      '<div class="note">Your photo is used only to create this preview and is deleted automatically within 24 hours.</div></div>' +
      '<div class="pane"><div class="res"><div>Your try-on result will appear here</div></div></div>' +
      '</div></div>';

    var $ = function (s) { return root.querySelector(s); };
    $('h2').textContent = CFG.ui.text;
    var state = { file: null, item: null };

    function close() { host.style.display = 'none'; document.documentElement.style.overflow = ''; }
    $('.x').addEventListener('click', close);
    $('.bd').addEventListener('click', function (e) { if (e.target === $('.bd')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && host.style.display !== 'none') close(); });

    var input = $('input[type=file]');
    $('.drop').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { alert('Please choose a photo under 8 MB'); return; }
      state.file = f;
      var url = URL.createObjectURL(f);
      $('.drop').querySelector('span').innerHTML = '';
      var im = document.createElement('img'); im.src = url; im.alt = 'Your photo';
      $('.drop').querySelector('span').appendChild(im);
      $('.go').disabled = false;
    });

    $('.go').addEventListener('click', function () {
      if (!state.file || !state.item) return;
      var res = $('.res');
      res.innerHTML = '<div class="spin"></div><div>Creating your look… this can take up to a minute</div>';
      $('.go').disabled = true;
      var fd = new FormData();
      fd.append('photo', state.file);
      fd.append('product_image', state.item.image);
      fd.append('product_url', state.item.url);
      fd.append('product_title', state.item.title || '');
      fd.append('trigger', state.item.trigger);
      fd.append('plan', state.item.plan || '');
      fd.append('visitor_id', VISITOR);
      fetch(API + '/tryon.php?key=' + encodeURIComponent(KEY), { method: 'POST', body: fd, mode: 'cors' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          $('.go').disabled = false;
          if (!j.ok) throw new Error(j.error || 'Failed');
          res.innerHTML = '';
          var im = document.createElement('img'); im.src = j.result_url; im.alt = 'Try-on result';
          var a = document.createElement('a'); a.className = 'dl'; a.href = j.result_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open full size';
          res.appendChild(im); res.appendChild(a);
        })
        .catch(function (err) {
          $('.go').disabled = false;
          res.innerHTML = '<div class="err"></div>';
          res.querySelector('.err').textContent = err.message || 'Something went wrong, please try again';
        });
    });

    document.body.appendChild(host);
    return {
      open: function (item) {
        state.item = item;
        $('.prod img').src = item.image;
        $('.prod b').textContent = (item.title || '').slice(0, 90);
        $('.res').innerHTML = '<div>Your try-on result will appear here</div>';
        host.style.display = 'block';
        document.documentElement.style.overflow = 'hidden';
        $('.x').focus();
      }
    };
  }

  function openTryOn(item) {
    if (!item.image) { alert('Sorry, we could not read the product image on this page.'); return; }
    report({ event: 'click', trigger: item.trigger, plan: item.plan, pageType: detectPageType() });
    modal = modal || buildModal();
    modal.open(item);
  }

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */
  function boot() {
    fetch(API + '/config.php?key=' + encodeURIComponent(KEY), { mode: 'cors', credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (!cfg.ok) { log('config error', cfg.error); return; }
        CFG = cfg;
        CFG.selectors = CFG.selectors || { product: {}, collection: {} };
        log('config', CFG);
        injectStyles();
        start();
        startObserver();
        hookSpaNavigation();
        window.VTO = { rescan: function () { generation++; zones = {}; start(); }, config: CFG, debug: function () { DEBUG = true; } };
      })
      .catch(function (e) { log('boot failed', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
