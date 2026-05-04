/**
 * TryFit virtual try-on widget
 * Pure vanilla JS — no framework dependencies.
 * Runs on the merchant's storefront.
 */
(function () {
  'use strict';

  var TryFit = {
    config: {},
    sessionId: null,
    _progressTimer: null,
    _progressStart: null,
    _privacySkipped: false,

    // ── Init ──────────────────────────────────────────────────────
    init: function (config) {
      if (config) this.config = config;

      var root = document.getElementById('tryfit-embed-root');
      var existingBtn = document.querySelector('.tryfit-open-btn');
      var proxyUrl = '';
      var shop = '';

      if (root) {
        proxyUrl = (root.dataset.proxyUrl || '').replace(/\/$/, '');
        shop = root.dataset.shop || '';
        var pageType = root.dataset.pageType;
        // Auto-inject button on product pages when try-on is enabled for this product
        if (pageType === 'product' && root.dataset.productTryon === 'true' && !existingBtn) {
          this._injectProductButton(root);
        }
      } else if (existingBtn) {
        proxyUrl = (existingBtn.dataset.proxyUrl || '').replace(/\/$/, '');
        shop = existingBtn.dataset.shop || '';
      }

      this._bindButtons();
      this._bindModalEvents();

      if (proxyUrl && shop) {
        this._fetchSettings(proxyUrl, shop);
      }
    },

    // ── Settings fetch & apply ─────────────────────────────────────
    _fetchSettings: function (proxyUrl, shop) {
      var self = this;
      var url = proxyUrl + '/api/widget-settings?shop=' + encodeURIComponent(shop);
      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (settings) {
          self._applySettings(settings);
          var root = document.getElementById('tryfit-embed-root');
          if (root && root.dataset.pageType === 'collection' && root.dataset.collectionTryon === 'true') {
            self._injectCollectionIcons(settings);
          }
        })
        .catch(function () { /* keep Liquid fallback styles */ });
    },

    _applySettings: function (s) {
      if (!s || typeof s !== 'object') return;

      var btn = document.getElementById('tryfit-open-btn');
      if (!btn) return;

      // ── Colors & shape ──────────────────────────────────────────
      if (s.button_color) btn.style.background = s.button_color;
      if (s.button_text_color) btn.style.color = s.button_text_color;
      if (s.button_border_radius != null) btn.style.borderRadius = s.button_border_radius + 'px';

      // ── Width / Height ──────────────────────────────────────────
      btn.style.width = (s.button_width > 0) ? s.button_width + 'px' : '100%';
      if (s.button_height > 0) {
        btn.style.height = s.button_height + 'px';
        btn.style.minHeight = '';
      } else {
        btn.style.height = 'auto';
      }

      // ── Padding ─────────────────────────────────────────────────
      if (s.button_padding_top    != null) btn.style.paddingTop    = s.button_padding_top    + 'px';
      if (s.button_padding_right  != null) btn.style.paddingRight  = s.button_padding_right  + 'px';
      if (s.button_padding_bottom != null) btn.style.paddingBottom = s.button_padding_bottom + 'px';
      if (s.button_padding_left   != null) btn.style.paddingLeft   = s.button_padding_left   + 'px';

      // ── Margin ──────────────────────────────────────────────────
      if (s.button_margin_top    != null) btn.style.marginTop    = s.button_margin_top    + 'px';
      if (s.button_margin_right  != null) btn.style.marginRight  = s.button_margin_right  + 'px';
      if (s.button_margin_bottom != null) btn.style.marginBottom = s.button_margin_bottom + 'px';
      if (s.button_margin_left   != null) btn.style.marginLeft   = s.button_margin_left   + 'px';

      // ── Icon ────────────────────────────────────────────────────
      var iconEl = btn.querySelector('.tryfit-btn-icon');
      var hasIcon = s.button_icon && s.button_icon !== 'none';
      if (iconEl) {
        if (hasIcon) {
          var svgHtml = this._getIconSvg(
            s.button_icon,
            s.icon_size || 16,
            s.icon_color || '#ffffff'
          );
          if (svgHtml) {
            iconEl.innerHTML = svgHtml;
            iconEl.style.display = 'flex';
            if (s.icon_bg_color || s.main_icon_bg_color) {
              iconEl.style.background = s.main_icon_bg_color || s.icon_bg_color || 'transparent';
              iconEl.style.borderRadius = (s.icon_radius || 4) + 'px';
              iconEl.style.padding = '2px';
            }
            if (s.icon_opacity != null) iconEl.style.opacity = s.icon_opacity / 100;
          }
        } else {
          iconEl.style.display = 'none';
        }
      }

      // ── Layout direction: row when icon shown, column otherwise ──
      var titleEl = btn.querySelector('.tryfit-btn-title');
      var subtitleEl = btn.querySelector('.tryfit-btn-subtitle');
      if (hasIcon && titleEl) {
        btn.style.flexDirection = 'row';
        btn.style.gap = '8px';
      } else {
        btn.style.flexDirection = 'column';
        btn.style.gap = '2px';
      }

      // ── Title text & typography ─────────────────────────────────
      if (titleEl) {
        if (s.widget_title) titleEl.textContent = s.widget_title;
        if (s.title_font_size)   titleEl.style.fontSize   = s.title_font_size + 'px';
        if (s.title_font_weight) titleEl.style.fontWeight = s.title_font_weight;
        if (s.title_font_family) titleEl.style.fontFamily = s.title_font_family;
      }

      // ── Subtitle ────────────────────────────────────────────────
      if (subtitleEl) {
        if (s.widget_subtitle) {
          subtitleEl.textContent = s.widget_subtitle;
          subtitleEl.style.display = '';
          if (s.subtitle_font_size)   subtitleEl.style.fontSize   = s.subtitle_font_size + 'px';
          if (s.subtitle_font_family) subtitleEl.style.fontFamily = s.subtitle_font_family;
        } else {
          subtitleEl.style.display = 'none';
        }
      }

      // ── Feature toggles ─────────────────────────────────────────
      var toBoolean = function (val) {
        if (val === false || val === 'false' || val === 0 || val === '0') return false;
        return true;
      };

      var waBtn = document.getElementById('tryfit-share-wa');
      if (waBtn) waBtn.style.display = toBoolean(s.share_whatsapp_enabled !== undefined ? s.share_whatsapp_enabled : true) ? '' : 'none';

      var saveBtn = document.getElementById('tryfit-save-img');
      if (saveBtn) saveBtn.style.display = toBoolean(s.save_image_enabled !== undefined ? s.save_image_enabled : true) ? '' : 'none';

      this._privacySkipped = !toBoolean(s.privacy_notice_shown !== undefined ? s.privacy_notice_shown : true);
    },

    _getIconSvg: function (icon, size, color) {
      var s = size || 16;
      var c = color || '#ffffff';
      var icons = {
        'eye': '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        'sparkles': '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z"/></svg>',
        'camera': '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
        'shopping-bag': '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'
      };
      return icons[icon] || null;
    },

    // ── Auto-inject button on product pages (embed block) ─────────
    _injectProductButton: function (root) {
      if (document.getElementById('tryfit-open-btn')) return;

      var container =
        document.querySelector('.product-form__buttons') ||
        document.querySelector('.product__submit') ||
        document.querySelector('[data-product-form]') ||
        document.querySelector('form[action="/cart/add"]') ||
        document.querySelector('.product-form');
      if (!container) return;

      var wrap = document.createElement('div');
      wrap.id = 'tryfit-btn-wrap';
      wrap.className = 'tryfit-btn-container tryfit-app-block';

      var btn = document.createElement('button');
      btn.id = 'tryfit-open-btn';
      btn.className = 'tryfit-open-btn';
      btn.type = 'button';
      btn.dataset.productId = root.dataset.productId || '';
      btn.dataset.variants = root.dataset.variants || '[]';
      btn.dataset.clothingImages = root.dataset.clothingImages || '{}';
      btn.dataset.featuredImage = root.dataset.featuredImage || '';
      btn.dataset.proxyUrl = root.dataset.proxyUrl || '';
      btn.dataset.shop = root.dataset.shop || '';
      btn.style.cssText = 'background:#111827;color:#ffffff;border:none;padding:12px 24px;font-size:16px;font-weight:600;border-radius:4px;cursor:pointer;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:10px 0;box-sizing:border-box;transition:opacity 0.15s;gap:2px;';

      var iconSpan = document.createElement('span');
      iconSpan.className = 'tryfit-btn-icon';
      iconSpan.style.cssText = 'display:none;align-items:center;justify-content:center;flex-shrink:0;';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'tryfit-btn-title';
      titleSpan.style.lineHeight = '1.2';
      titleSpan.textContent = 'Try On This Look';

      var subtitleSpan = document.createElement('span');
      subtitleSpan.className = 'tryfit-btn-subtitle';
      subtitleSpan.style.cssText = 'display:none;opacity:0.8;line-height:1.2;';

      btn.appendChild(iconSpan);
      btn.appendChild(titleSpan);
      btn.appendChild(subtitleSpan);
      wrap.appendChild(btn);
      container.insertAdjacentElement('afterend', wrap);
    },

    // ── Inject mini icons on product cards in collection pages ─────
    _injectCollectionIcons: function (s) {
      var self = this;
      var cards = Array.from(document.querySelectorAll(
        '.product-card, .product-item, [class*="ProductItem"], .grid__item, ' +
        '.collection-grid__item, [data-product-card], .grid-product, [class*="product-card"]'
      )).filter(function (el) {
        return el.querySelector('a[href*="/products/"]');
      });

      if (!cards.length) {
        var seen = [];
        document.querySelectorAll('a[href*="/products/"]').forEach(function (link) {
          var card = link.closest('li, article, [class*="product"], [class*="grid-item"]');
          if (card && seen.indexOf(card) === -1) {
            seen.push(card);
            self._addCollectionIcon(card, s);
          }
        });
        return;
      }

      cards.forEach(function (card) { self._addCollectionIcon(card, s); });
    },

    _addCollectionIcon: function (card, s) {
      if (card.querySelector('.tryfit-collection-icon')) return;
      if (window.getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }

      var position = s.collection_position || 'bottom-left';
      var posMap = {
        'bottom-left':  'bottom:8px;left:8px',
        'bottom-right': 'bottom:8px;right:8px',
        'top-left':     'top:8px;left:8px',
        'top-right':    'top:8px;right:8px',
      };

      var icon = document.createElement('button');
      icon.className = 'tryfit-collection-icon';
      icon.type = 'button';
      icon.setAttribute('aria-label', 'Virtual Try-On');
      icon.style.cssText = [
        'position:absolute',
        posMap[position] || 'bottom:8px;left:8px',
        'z-index:10',
        'background:' + (s.button_color || '#111827'),
        'color:' + (s.button_text_color || '#ffffff'),
        'border:none',
        'border-radius:50%',
        'width:36px',
        'height:36px',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'cursor:pointer',
        'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
        'transition:opacity 0.15s',
      ].join(';');
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

      icon.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var link = card.querySelector('a[href*="/products/"]');
        if (link) window.location.href = link.href;
      });

      card.appendChild(icon);
    },

    _bindButtons: function () {
      var self = this;
      var btns = document.querySelectorAll('.tryfit-open-btn');
      for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        if (btn.getAttribute('data-tryfit-bound')) continue;

        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var b = e.currentTarget;

          // Update config from the clicked button's data
          var variants = [];
          try {
            variants = JSON.parse(b.dataset.variants || '[]');
          } catch (err) { variants = []; }

          var clothingImages = {};
          try {
            clothingImages = JSON.parse(b.dataset.clothingImages || '{}');
          } catch (err) { clothingImages = {}; }

          self.config = {
            productId: b.dataset.productId,
            variants: variants,
            clothingImages: clothingImages,
            featuredImage: b.dataset.featuredImage || '',
            proxyUrl: (b.dataset.proxyUrl || '').replace(/\/$/, ''),
          };

          self.openModal();
        });
        btn.setAttribute('data-tryfit-bound', 'true');
      }
    },

    // ── Modal management ─────────────────────────────────────────
    openModal: function () {
      var overlay = document.getElementById('tryfit-overlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      this._bindModalEvents();
      this._showStep(this._privacySkipped ? 'upload' : 'privacy');
    },

    closeModal: function () {
      var overlay = document.getElementById('tryfit-overlay');
      if (overlay) overlay.style.display = 'none';
      document.body.style.overflow = '';
      this._stopProgress();
    },

    _bindModalEvents: function () {
      var self = this;

      // Selectors for elements that might be re-rendered
      var bindClick = function (id, fn) {
        var el = document.getElementById(id);
        if (el) el.onclick = fn;
      };

      bindClick('tryfit-close-btn', function () { self.closeModal(); });
      bindClick('tryfit-accept-privacy', function () { self._showStep('upload'); });
      bindClick('tryfit-add-cart', function () {
        var v = self.getSelectedVariant();
        if (v) self.addToCart(v.id);
      });
      bindClick('tryfit-buy-now', function () {
        var v = self.getSelectedVariant();
        if (v) self.buyNow(v.id);
      });
      bindClick('tryfit-save-img', function () {
        var img = document.getElementById('tryfit-result-img');
        if (img && img.src) self.saveImage(img.src);
      });
      bindClick('tryfit-share-wa', function () {
        var img = document.getElementById('tryfit-result-img');
        self.shareWhatsApp(img ? img.src : '', window.location.href);
      });
      bindClick('tryfit-retry', function () { self._showStep('upload'); });
      bindClick('tryfit-retry-error', function () { self._showStep('upload'); });

      var overlay = document.getElementById('tryfit-overlay');
      if (overlay) {
        overlay.onclick = function (e) {
          if (e.target === overlay) self.closeModal();
        };
      }

      var fileInput = document.getElementById('tryfit-file-input');
      if (fileInput) {
        fileInput.onchange = function (e) {
          var file = e.target.files && e.target.files[0];
          if (file) self.handlePhotoSelect(file);
        };
      }

      // Build variant selector
      this._renderVariantSelector();
    },

    // ... (rest of the functions remain same, just ensure they use this.config)
    _showStep: function (step) {
      var steps = ['privacy', 'upload', 'processing', 'result', 'error'];
      for (var i = 0; i < steps.length; i++) {
        var el = document.getElementById('tryfit-step-' + steps[i]);
        if (el) el.style.display = steps[i] === step ? '' : 'none';
      }
    },

    _renderVariantSelector: function () {
      var wrap = document.getElementById('tryfit-variant-selector');
      if (!wrap) return;

      var variants = this.config.variants || [];
      if (variants.length <= 1) {
        wrap.innerHTML = '';
        return;
      }

      var sel = document.createElement('select');
      sel.id = 'tryfit-variant-select';
      sel.setAttribute('aria-label', 'Select variant');

      for (var i = 0; i < variants.length; i++) {
        var opt = document.createElement('option');
        opt.value = variants[i].id;
        opt.textContent = variants[i].title || ('Variant ' + (i + 1));
        sel.appendChild(opt);
      }

      var pageVariant = this._getPageVariantId();
      if (pageVariant) sel.value = String(pageVariant);

      wrap.innerHTML = '';
      wrap.appendChild(sel);
    },

    handlePhotoSelect: function (file) {
      if (file.size > 5 * 1024 * 1024) {
        this.showError('Photo must be under 5MB');
        return;
      }
      var self = this;
      this._showStep('processing');
      this.showProgress('Resizing your photo\u2026');

      this.resizeImage(file, 1024, 1024).then(function (blob) {
        self.showProgress('AI is working on your look\u2026');
        self.startProgressAnimation(28);

        // Create session then run try-on
        return self._createSession().then(function () {
          return self.runTryOn(blob);
        });
      }).catch(function (err) {
        self._stopProgress();
        self.showError('Something went wrong. Please try again.');
        console.error('TryFit error:', err);
      });
    },

    _createSession: function () {
      var self = this;
      var variant = this.getSelectedVariant();
      var shop = new URL(window.location.href).searchParams.get('shop') || window.location.hostname;

      return fetch(this.config.proxyUrl + '/session/create?shop=' + shop, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: this.config.productId,
          variant_id: variant ? variant.id : null,
          device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.session_id) self.sessionId = data.session_id;
        })
        .catch(function (err) { console.error('TryFit session error:', err); });
    },

    resizeImage: function (file, maxW, maxH) {
      return new Promise(function (resolve) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          if (w > maxW || h > maxH) {
            var ratio = Math.min(maxW / w, maxH / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            resolve(blob || file);
          }, 'image/jpeg', 0.85);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          resolve(file);
        };
        img.src = url;
      });
    },

    runTryOn: function (avatarBlob) {
      var self = this;
      var variant = this.getSelectedVariant();
      if (!variant) {
        this.showError('Could not determine the selected variant.');
        return Promise.resolve();
      }

      var mapping = this.getVariantMapping(variant.id);

      // Determine clothing image: explicit mapping first, then variant's Shopify image
      var clothingImage = (mapping && mapping.tryon_image_url) ? mapping.tryon_image_url : null;
      if (!clothingImage) {
        var fi = variant.featured_image || variant.image;
        clothingImage = (fi && fi.src) ? fi.src : null;
      }
      if (!clothingImage) {
        clothingImage = this.config.featuredImage || null;
      }
      if (!clothingImage) {
        this.showError('No product image available for try-on.');
        return Promise.resolve();
      }

      // Fetch clothing image from CDN in browser (avoids server-side download failures),
      // then convert both images to base64 and POST to upload.php
      return Promise.all([
        self._blobToBase64(avatarBlob),
        self._fetchAsBase64(clothingImage),
      ]).then(function (results) {
        var avatarBase64 = results[0];
        var clothingBase64 = results[1];

        if (!clothingBase64) {
          self._stopProgress();
          self.showError('Could not load product image. Please try again.');
          return;
        }

        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, 45000);

        var shop = new URL(window.location.href).searchParams.get('shop') || window.location.hostname;

        return fetch(self.config.proxyUrl + '/tryon?shop=' + shop, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clothing_image: clothingBase64,
            avatar_image: avatarBase64,
            shopify_variant_id: variant.id,
            shopify_product_id: self.config.productId,
            session_id: self.sessionId
          }),
          signal: controller.signal,
        }).then(function (res) {
          clearTimeout(timeoutId);
          return res.json();
        }).then(function (data) {
          self._stopProgress();
          if (data.result_image) {
            self.showResult(data.result_image);
          } else {
            self.showError(data.error || 'Try-on failed. Please try again.');
          }
        }).catch(function (err) {
          clearTimeout(timeoutId);
          self._stopProgress();
          if (err && err.name === 'AbortError') {
            self.showError('This is taking longer than usual. Please try again.');
          } else {
            self.showError('Something went wrong. Please try again.');
          }
        });
      });
    },

    _blobToBase64: function (blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) { resolve(e.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    _fetchAsBase64: function (url) {
      return fetch(url)
        .then(function (res) { return res.blob(); })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function (e) { resolve(e.target.result); };
            reader.onerror = function () { resolve(null); };
            reader.readAsDataURL(blob);
          });
        })
        .catch(function () { return null; });
    },

    showResult: function (imageUrl) {
      var img = document.getElementById('tryfit-result-img');
      if (img) img.src = imageUrl;
      this._showStep('result');
    },

    showProgress: function (msg) {
      var el = document.getElementById('tryfit-progress-msg');
      if (el) el.textContent = msg;
    },

    showError: function (msg) {
      var el = document.getElementById('tryfit-error-msg');
      if (el) el.textContent = msg;
      this._showStep('error');
    },

    showToast: function (msg) {
      var toast = document.createElement('div');
      toast.className = 'tryfit-toast';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 2500);
    },

    startProgressAnimation: function (durationSeconds) {
      var self = this;
      this._stopProgress();
      var bar = document.getElementById('tryfit-progress-bar');
      if (!bar) return;
      bar.style.width = '0%';
      var start = Date.now();
      var totalMs = durationSeconds * 1000;
      this._progressTimer = setInterval(function () {
        var elapsed = Date.now() - start;
        var pct = Math.min(95, Math.round((elapsed / totalMs) * 95));
        bar.style.width = pct + '%';
        if (pct >= 95) {
          clearInterval(self._progressTimer);
          self._progressTimer = null;
        }
      }, 200);
    },

    _stopProgress: function () {
      if (this._progressTimer) {
        clearInterval(this._progressTimer);
        this._progressTimer = null;
      }
      var bar = document.getElementById('tryfit-progress-bar');
      if (bar) bar.style.width = '100%';
    },

    trackAction: function (action) {
      if (!this.sessionId) return;
      var shop = new URL(window.location.href).searchParams.get('shop') || window.location.hostname;
      var url = this.config.proxyUrl + '/session/track?shop=' + shop;
      var body = JSON.stringify({ session_id: this.sessionId, action: action });
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
        }).catch(function () { });
      }
    },

    addToCart: function (variantId) {
      var self = this;
      this.trackAction('add_to_cart');
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
      }).then(function () {
        document.dispatchEvent(new CustomEvent('cart:updated'));
        var cartCountEls = document.querySelectorAll('[data-cart-count], .cart-count');
        for (var i = 0; i < cartCountEls.length; i++) {
          cartCountEls[i].dispatchEvent(new Event('cart:updated', { bubbles: true }));
        }
        self.showToast('Added to cart!');
      }).catch(function () {
        self.showToast('Could not add to cart. Please try again.');
      });
    },

    buyNow: function (variantId) {
      this.trackAction('buy_now');
      window.location.href = '/cart/' + variantId + ':1';
    },

    saveImage: function (url) {
      this.trackAction('save_image');
      var a = document.createElement('a');
      a.href = url;
      a.download = 'my-tryon.jpg';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },

    shareWhatsApp: function (resultUrl, productUrl) {
      this.trackAction('share_wa');
      var text = encodeURIComponent(
        'Check out how this looks on me! ' +
        productUrl + '?utm_source=tryfit&utm_medium=whatsapp'
      );
      window.open('https://wa.me/?text=' + text, '_blank', 'noopener');
    },

    getSelectedVariant: function () {
      var sel = document.getElementById('tryfit-variant-select');
      if (sel && sel.value) {
        var selId = sel.value;
        var variants = this.config.variants || [];
        for (var i = 0; i < variants.length; i++) {
          if (String(variants[i].id) === String(selId)) return variants[i];
        }
      }
      var pageId = this._getPageVariantId();
      if (pageId) {
        var variants = this.config.variants || [];
        for (var i = 0; i < variants.length; i++) {
          if (String(variants[i].id) === String(pageId)) return variants[i];
        }
      }
      return (this.config.variants && this.config.variants[0]) || null;
    },

    _getPageVariantId: function () {
      var el =
        document.querySelector('[name="id"][data-variant-id]') ||
        document.querySelector('[name="id"]') ||
        document.querySelector('.product-form__input [name="id"]');
      return el ? el.value : null;
    },

    getVariantMapping: function (variantId) {
      var mappings = this.config.clothingImages || {};
      return mappings[String(variantId)] || null;
    },
  };

  // ── Bootstrap ────────────────────────────────────────────────
  function bootstrap() {
    TryFit.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Support Shopify Theme Editor re-loads
  document.addEventListener('shopify:section:load', bootstrap);

  // Expose for debugging
  window.TryFit = TryFit;
})();
