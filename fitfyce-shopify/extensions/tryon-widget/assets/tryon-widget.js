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

    // ── Init ──────────────────────────────────────────────────────
    init: function (config) {
      if (config) this.config = config;
      this._bindButtons();

      // Ensure modal events are bound even if openModal hasn't been called
      // (Handles cases where elements are already in DOM)
      this._bindModalEvents();
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
      this._showStep('privacy');
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
