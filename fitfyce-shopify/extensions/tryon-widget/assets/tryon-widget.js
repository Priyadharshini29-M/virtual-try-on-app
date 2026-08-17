/**
 * FitSnap virtual try-on widget  v2.1
 * Enterprise production build — universal Shopify theme compatibility
 *
 * Architecture
 * ─────────────
 * • Single capture-phase document listener handles ALL tryfit clicks/drags.
 *   Fires before any theme bubble-phase handler — theme stopPropagation()
 *   on bubble phase cannot block us.
 * • Overlay permanently lives in document.body, isolated from product forms
 *   and Shopify section re-renders.
 * • MutationObserver removes duplicate overlays injected by section reloads.
 * • Focus trapped inside the open modal; restored on close.
 * • Drag-and-drop upload supported on desktop.
 * • ESC always closes the modal.
 * • All global listeners registered exactly once (safe for section:load / block:select).
 * • Debug logging via: window.TRYFIT_DEBUG = true  (before script loads).
 */
(function () {
  "use strict";

  // ── Debug helper ────────────────────────────────────────────────────────────
  var _debug = !!window.TRYFIT_DEBUG;
  function log() {
    if (!_debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[TryFit]");
    Function.prototype.apply.call(console.log, console, args);
  }

  // ── Singleton guard ─────────────────────────────────────────────────────────
  if (window.TryFit && window.TryFit._booted) {
    log("singleton — re-using existing instance");
    window.TryFit._onSectionLoad();
    return;
  }

  // ── Free-tier usage limit ────────────────────────────────────────────────────
  var MAX_FREE_TRYONS = 3;
  var USAGE_KEY       = "tryfit_usage";

  // ── Polyfill: Element.closest for IE / old Android ──────────────────────────
  if (typeof Element !== "undefined" && !Element.prototype.closest) {
    Element.prototype.closest = function (sel) {
      var el = this;
      while (el && el !== document) {
        try {
          if (el.matches(sel)) return el;
        } catch (e) {
          return null;
        }
        el = el.parentNode;
      }
      return null;
    };
  }

  // ── TryFit singleton object ─────────────────────────────────────────────────
  var TryFit = {
    // ── Lifecycle flags (never reset; prevent double-binding) ─────────────
    _booted: false,
    _delegationBound: false,
    _escBound: false,
    _fileChangeBound: false,
    _dragBound: false,
    _focusTrapBound: false,
    _observerStarted: false,
    _settingsFetched: false,

    // ── Per-session state ─────────────────────────────────────────────────
    config: {},
    sessionId: null,
    _progressTimer: null,
    _privacySkipped: false,
    _addingToCart: false,
    _lastTracked: {},
    _settingsCache: null,
    _previousFocus: null,
    _lastFileTriggerAt: 0,
    _filePickerActive: false,
    _cameraStream: null,
    _facingMode: "environment",
    _isSaving: false,
    _tryOnInProgress: false,
    _buyingNow: false,
    _processingPreviewUrl: null,
    _proxyUrl: "",
    _shop: "",
    _qty: 1,
    _countdownTimer: null,
    _countdownSeconds: 0,
    _selectedVariantId: null,
    _tryOnVariantId: null,
    _lastAvatarBase64: null,
    _lastClothingImageUrl: null,

    // ══════════════════════════════════════════════════════════════════════
    // INIT
    // ══════════════════════════════════════════════════════════════════════

    init: function () {
      log("init");
      this._ensureOverlayInBody();
      this._bindGlobalDelegation();
      this._bindEscKey();
      this._bindFileChange();
      this._bindDragDrop();
      this._bindFocusTrap();
      this._startMutationObserver();
      this._discoverProxyAndFetch();
      this._booted = true;
      // Reapply view-specific settings on resize / orientation change (150ms debounce)
      var _self = this;
      var _lastMobileState = window.innerWidth <= 768;
      var _resizeTimer = null;
      function _onViewportChange() {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          var nowMobile = window.innerWidth <= 768;
          if (_self._settingsCache) {
            if (nowMobile !== _lastMobileState) {
              _lastMobileState = nowMobile;
            }
            _self._applySettings(_self._settingsCache);
          }
        }, 150);
      }
      window.addEventListener("resize", _onViewportChange);
      window.addEventListener("orientationchange", _onViewportChange);
      log("init complete");
    },

    // Lightweight re-init on section:load — doesn't re-register global listeners
    _onSectionLoad: function () {
      log("_onSectionLoad");
      this._ensureOverlayInBody();
      this._discoverProxyAndFetch();
    },

    _discoverProxyAndFetch: function () {
      var root = document.getElementById("tryfit-embed-root");
      var existingBtn = document.querySelector(".tryfit-open-btn");
      var proxyUrl = "";
      var shop = "";

      if (root) {
        proxyUrl = (root.dataset.proxyUrl || "").replace(/\/$/, "");
        shop = root.dataset.shop || "";
      } else if (existingBtn) {
        proxyUrl = (existingBtn.dataset.proxyUrl || "").replace(/\/$/, "");
        shop = existingBtn.dataset.shop || "";
      }

      if (proxyUrl) this._proxyUrl = proxyUrl;
      if (shop) this._shop = shop;

      // Debug: log context discovered from DOM
      log(
        "_discoverProxyAndFetch — pageType:",
        root ? root.dataset.pageType : "(no embed-root)",
        "productId:",
        root && root.dataset.productId ? root.dataset.productId : "(n/a)",
        "productTryon:",
        root && root.dataset.productTryon ? root.dataset.productTryon : "(n/a)",
        "shop:", shop || "(none)"
      );

      // Always fetch from the app backend API — no inline CSS from Liquid/schema.
      // All button styles are defined exclusively in the backend settings panel.
      if (proxyUrl && shop && !this._settingsFetched) {
        this._settingsFetched = true;
        this._fetchSettings(proxyUrl, shop);
      } else if (this._settingsCache) {
        // Re-apply cached settings on SPA navigation / section:load / variant swap
        this._applySettings(this._settingsCache);
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // OVERLAY MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════

    _ensureOverlayInBody: function () {
      var all = document.querySelectorAll("#tryfit-overlay");
      if (!all.length) return;

      // Prefer an overlay already directly under body
      var keeper = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].parentNode === document.body) {
          keeper = all[i];
          break;
        }
      }
      if (!keeper) keeper = all[0];

      // Remove every duplicate
      for (var j = 0; j < all.length; j++) {
        if (all[j] !== keeper && all[j].parentNode) {
          all[j].parentNode.removeChild(all[j]);
          log("removed duplicate overlay");
        }
      }

      // Hoist keeper to body so it's outside any product form / section wrapper
      if (keeper.parentNode !== document.body) {
        document.body.appendChild(keeper);
        log("hoisted overlay to body");
      }

      // Break the native label→input activation that causes the file picker to
      // open twice. The input is NESTED inside the label (no `for` attribute),
      // so removing `for` is a no-op. Move the input out of the label so the
      // browser can no longer activate it natively when the label is clicked.
      // inp.click() in _triggerFileInput and the `change` event listener both
      // work regardless of where the input sits in the DOM.
      var fileInp2 = keeper.querySelector("#tryfit-file-input");
      var uploadLbl = keeper.querySelector("#tryfit-upload-label");
      if (fileInp2 && uploadLbl && uploadLbl.contains(fileInp2)) {
        uploadLbl.insertAdjacentElement("afterend", fileInp2);
      }
      if (uploadLbl) uploadLbl.removeAttribute("for");
    },

    // ══════════════════════════════════════════════════════════════════════
    // GLOBAL CLICK DELEGATION  (capture phase — fires before ALL theme handlers)
    // ══════════════════════════════════════════════════════════════════════

    _bindGlobalDelegation: function () {
      if (this._delegationBound) return;
      this._delegationBound = true;
      var self = this;

      document.addEventListener(
        "click",
        function (e) {
          var t = e.target;
          if (!t) return;

          // ── Guard: block clicks that originated on the hidden file input ──
          // inp.click() dispatches a synthetic click. If that click bubbles up
          // to the <label for="tryfit-file-input">, the label's native behavior
          // re-activates the input → picker opens a second time. Stopping
          // propagation here kills the bubble before it can reach the label.
          if (t.id === "tryfit-file-input" || t.type === "file") {
            e.stopPropagation();
            return;
          }

          // ── 1. Try-On open button ────────────────────────────────────────
          var openBtn = t.closest(".tryfit-open-btn");
          if (openBtn) {
            log("open btn clicked — product:", openBtn.dataset.productId);
            e.preventDefault();
            e.stopPropagation();
            self._openFromButton(openBtn);
            return;
          }

          var collectionBtn = t.closest(".tryfit-collection-icon");
          if (collectionBtn) {
            log("collection btn clicked");
            e.preventDefault();
            e.stopPropagation();
            self._openCollectionIcon(collectionBtn);
            return;
          }

          // ── 2. Upload area — explicitly trigger hidden file input ────────
          // Must handle BEFORE the modal-visibility guard below, because the
          // label IS inside the (visible) modal.
          // Using explicit .click() instead of letting the label do it natively
          // is the only reliable path on iOS Safari with opacity:0 inputs.
          var uploadLabel = t.closest(
            "#tryfit-upload-label, label[for='tryfit-file-input']",
          );
          if (uploadLabel) {
            log("upload label clicked");
            e.preventDefault();
            e.stopPropagation();
            self._triggerFileInput();
            return;
          }

          // ── 3. Modal actions — only process when overlay is visible ──────
          var overlay = document.getElementById("tryfit-overlay");
          if (!overlay || overlay.style.display === "none") return;

          // Backdrop click: only when the click target IS the backdrop div itself
          if (t === overlay) {
            log("backdrop click — closing");
            self.closeModal();
            return;
          }

          // Resolve action via data-tryfit-action, fallback to element ID map
          var actionEl = t.closest("[data-tryfit-action]");
          var action = actionEl
            ? actionEl.getAttribute("data-tryfit-action")
            : self._idToAction(t.closest("button,[role='button'],a"));

          if (!action) return;
          log("action:", action);
          e.preventDefault();
          e.stopPropagation();
          self._dispatch(action, actionEl);
        },
        true,
      ); // ← capture phase
    },

    // Backward-compat ID → action fallback
    _idToAction: function (el) {
      if (!el || !el.id) return null;
      var map = {
        "tryfit-close-btn": "close",
        "tryfit-accept-privacy": "accept-privacy",
        "tryfit-add-cart": "add-cart",
        "tryfit-buy-now": "buy-now",
        "tryfit-save-img": "save-img",
        "tryfit-share-wa": "share-wa",
        "tryfit-retry": "retry",
        "tryfit-retry-error": "retry",
      };
      return map[el.id] || null;
    },

    _dispatch: function (action, actionEl) {
      var self = this;
      switch (action) {
        case "close":
          this.closeModal();
          break;

        case "accept-privacy":
          this._showStep("upload");
          break;

        case "add-cart": {
          var varId = actionEl && actionEl.dataset.variantId;
          var v1 = varId ? this._variantById(varId) : null;
          if (!v1) v1 = this.getSelectedResultVariant();
          if (!v1) { this.showToast("Please select a variant first."); break; }
          if (v1.available === false) { this.showToast("This variant is sold out."); break; }
          this.addToCart(v1.id, actionEl);
          break;
        }

        case "buy-now": {
          var varId2 = actionEl && actionEl.dataset.variantId;
          var v2 = varId2 ? this._variantById(varId2) : null;
          if (!v2) v2 = this.getSelectedResultVariant();
          if (!v2) { this.showToast("Please select a variant first."); break; }
          if (v2.available === false) { this.showToast("This variant is sold out."); break; }
          this.buyNow(v2.id, actionEl);
          break;
        }

        case "save-img": {
          var img = document.getElementById("tryfit-result-img");
          if (img && img.src) self.saveImage(img.src);
          break;
        }

        case "share-wa": {
          var ri = document.getElementById("tryfit-result-img");
          self.shareWhatsApp(
            ri ? ri.src : "",
            self.config.storefrontUrl || window.location.href,
          );
          break;
        }

        case "retry":
          this._showStep("upload");
          var fi = document.getElementById("tryfit-file-input");
          if (fi)
            try {
              fi.value = "";
            } catch (ignore) {}
          break;

        case "gallery-upload":
          this._triggerFileInput();
          break;

        case "camera-upload":
          this._openCamera();
          break;

        case "camera-allow":
          this._openCameraStream();
          break;

        case "camera-capture":
          this._captureFromCamera();
          break;

        case "camera-flip":
          this._flipCamera();
          break;

        case "camera-close":
          this._closeCameraStream();
          this._resetCameraStep();
          this._showStep("upload");
          break;

        case "copy-coupon":
          this._copyCoupon();
          break;

        case "qty-inc":
          this._changeQty(1);
          break;

        case "qty-dec":
          this._changeQty(-1);
          break;

        case "zoom-img":
          this._zoomImage();
          break;
      }
    },

    // ── ESC key ──────────────────────────────────────────────────────────────
    _bindEscKey: function () {
      if (this._escBound) return;
      this._escBound = true;
      var self = this;
      document.addEventListener(
        "keydown",
        function (e) {
          if (e.key === "Escape" || e.keyCode === 27) {
            var overlay = document.getElementById("tryfit-overlay");
            if (overlay && overlay.style.display !== "none") {
              log("ESC — closing modal");
              self.closeModal();
            }
          }
        },
        true,
      );
    },

    // ── Focus trap — keeps Tab/Shift-Tab inside the open modal ───────────────
    _bindFocusTrap: function () {
      if (this._focusTrapBound) return;
      this._focusTrapBound = true;

      document.addEventListener("keydown", function (e) {
        if (e.key !== "Tab" && e.keyCode !== 9) return;

        var overlay = document.getElementById("tryfit-overlay");
        if (!overlay || overlay.style.display === "none") return;

        var FOCUSABLE = [
          "a[href]",
          "button:not([disabled])",
          "input:not([disabled]):not([type='hidden'])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          "[tabindex]:not([tabindex='-1'])",
        ].join(",");

        var nodes = overlay.querySelectorAll(FOCUSABLE);
        // Filter out invisible elements (e.g. the opacity-0 file input)
        var focusable = Array.prototype.filter.call(nodes, function (el) {
          return (
            !!(
              el.offsetWidth ||
              el.offsetHeight ||
              el.getClientRects().length
            ) &&
            window.getComputedStyle(el).visibility !== "hidden" &&
            el.style.opacity !== "0"
          );
        });

        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });
    },

    // ── File input change — document-level, capture phase ───────────────────
    _bindFileChange: function () {
      if (this._fileChangeBound) return;
      this._fileChangeBound = true;
      var self = this;

      document.addEventListener(
        "change",
        function (e) {
          if (e.target && e.target.id === "tryfit-file-input") {
            // File selected — release picker mutex immediately rather than
            // waiting for visibilitychange (which never fires on desktop Chrome).
            self._filePickerActive = false;
            self._lastFileTriggerAt = Date.now();
            var file = e.target.files && e.target.files[0];
            if (file) {
              log(
                "file selected:",
                file.name,
                "(",
                Math.round(file.size / 1024),
                "KB )",
              );
              self.handlePhotoSelect(file);
            }
          }
        },
        true,
      );
    },

    // ── Drag-and-drop — document-level, capture phase ────────────────────────
    _bindDragDrop: function () {
      if (this._dragBound) return;
      this._dragBound = true;
      var self = this;

      function getDropZone(target) {
        var overlay = document.getElementById("tryfit-overlay");
        if (!overlay || overlay.style.display === "none") return null;
        return target.closest
          ? target.closest(
              "#tryfit-upload-label, label[for='tryfit-file-input']",
            )
          : null;
      }

      document.addEventListener(
        "dragenter",
        function (e) {
          var zone = getDropZone(e.target);
          if (!zone) return;
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add("tryfit-drag-over");
          var hint = zone.querySelector(".tryfit-drop-hint");
          if (hint) hint.style.display = "block";
        },
        true,
      );

      document.addEventListener(
        "dragover",
        function (e) {
          var zone = getDropZone(e.target);
          if (!zone) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          zone.classList.add("tryfit-drag-over");
        },
        true,
      );

      document.addEventListener(
        "dragleave",
        function (e) {
          var zone = getDropZone(e.target);
          if (!zone) return;
          // Only remove highlight when the cursor leaves the zone entirely
          var related = e.relatedTarget;
          if (related && zone.contains(related)) return;
          zone.classList.remove("tryfit-drag-over");
          var hint = zone.querySelector(".tryfit-drop-hint");
          if (hint) hint.style.display = "none";
        },
        true,
      );

      document.addEventListener(
        "drop",
        function (e) {
          var zone = getDropZone(e.target);
          if (!zone) return;
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove("tryfit-drag-over");
          var hint = zone.querySelector(".tryfit-drop-hint");
          if (hint) hint.style.display = "none";

          var files = e.dataTransfer && e.dataTransfer.files;
          if (!files || !files.length) return;
          var file = files[0];
          if (file.type.indexOf("image/") === 0) {
            log("file dropped:", file.name);
            self.handlePhotoSelect(file);
          } else {
            self.showError("Please drop an image file (JPEG, PNG, or WebP).");
          }
        },
        true,
      );
    },

    // ── Trigger file picker safely (guards against double-open) ─────────────
    _triggerFileInput: function () {
      console.log("UPLOAD_TRIGGER", Date.now());

      // Mutex: _filePickerActive is set true when the picker opens and cleared
      // by visibilitychange (page becomes visible again when picker closes).
      // This is more reliable than focusin which fires when inp.click() focuses
      // the hidden input — BEFORE the OS picker even opens.
      if (this._filePickerActive) {
        console.log("INPUT_CLICK: BLOCKED — picker already active");
        return;
      }

      var now = Date.now();
      if (now - this._lastFileTriggerAt < 500) {
        log("file trigger debounced — suppressing duplicate");
        return;
      }
      this._lastFileTriggerAt = now;

      var inp = document.getElementById("tryfit-file-input");
      if (!inp) {
        log("WARN: file input not found");
        return;
      }
      try { inp.value = ""; } catch (ignore) {}

      this._filePickerActive = true;
      var self = this;

      function releasePickerMutex() {
        self._filePickerActive = false;
        self._lastFileTriggerAt = Date.now();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", onWindowFocus);
        clearTimeout(failsafeTimer);
        log("file picker mutex released");
      }
      function onVisibilityChange() {
        // Mobile: page becomes hidden when OS picker opens, visible when it closes
        if (!document.hidden) { releasePickerMutex(); }
      }
      function onWindowFocus() {
        // Desktop (Chrome/Windows): window regains focus when file dialog closes
        releasePickerMutex();
      }
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", onWindowFocus);
      // 5s failsafe in case neither visibilitychange nor window.focus fires
      var failsafeTimer = setTimeout(releasePickerMutex, 5000);

      console.log("INPUT_CLICK: calling inp.click()");
      inp.click();
      console.log("FILE_PICKER_OPEN: inp.click dispatched");
    },

    // ── MutationObserver — deduplicate overlays after Shopify section reloads ─
    _startMutationObserver: function () {
      if (this._observerStarted || !window.MutationObserver) return;
      this._observerStarted = true;
      var self = this;

      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (
              node.id === "tryfit-overlay" ||
              (node.querySelector && node.querySelector("#tryfit-overlay"))
            ) {
              log("MutationObserver: new overlay injected — deduplicating");
              self._ensureOverlayInBody();
              return;
            }
          }
        }
      });

      // Observe only direct children of body — sections land here on reload
      observer.observe(document.body, { childList: true, subtree: false });
    },

    // ══════════════════════════════════════════════════════════════════════
    // SETTINGS
    // ══════════════════════════════════════════════════════════════════════

    _fetchSettings: function (proxyUrl, shop) {
      var self = this;
      var PHP_DIRECT = "https://tryonapp.digifyce.com";
      var shopParam = "?shop=" + encodeURIComponent(shop);

      log("fetching settings:", proxyUrl + "/api/widget-settings");

      function applyAndInject(s) {
        log("settings received:", s);
        self._settingsCache = s;
        self._applySettings(s);
        var root = document.getElementById("tryfit-embed-root");
        if (
          root &&
          root.dataset.pageType === "collection" &&
          root.dataset.collectionTryon === "true" &&
          s.show_on_collection !== false &&
          s.show_on_collection !== 0
        ) {
          self._injectCollectionIcons(s);
        }
      }

      var FALLBACK_DEFAULTS = {
        button_color: "#111827",
        button_text_color: "#FFFFFF",
        hover_bg_color: "#F3F4F6",
        button_border_radius: 8,
        button_width: 0,
        button_height: 0,
        button_padding_top: 10,
        button_padding_right: 24,
        button_padding_bottom: 10,
        button_padding_left: 24,
        button_margin_top: 0,
        button_margin_right: 0,
        button_margin_bottom: 0,
        button_margin_left: 0,
        widget_title: "Try On This Look",
        widget_subtitle: "See how it fits before you buy",
        title_font_size: 20,
        subtitle_font_size: 14,
        title_font_weight: "600",
        title_font_family: "Inter, sans-serif",
        subtitle_font_family: "Inter, sans-serif",
        desktop_title_font_size: 20,
        mobile_title_font_size: 14,
        desktop_widget_width: 0,
        desktop_widget_width_unit: "px",
        desktop_widget_height: 0,
        desktop_widget_height_unit: "px",
        mobile_widget_width: 100,
        mobile_widget_width_unit: "%",
        mobile_widget_height: 0,
        mobile_widget_height_unit: "auto",
        desktop_padding_top: 10,
        desktop_padding_right: 24,
        desktop_padding_bottom: 10,
        desktop_padding_left: 24,
        mobile_padding_top: 8,
        mobile_padding_right: 16,
        mobile_padding_bottom: 8,
        mobile_padding_left: 16,
      };

      fetch(proxyUrl + "/api/widget-settings" + shopParam)
        .then(function (r) {
          if (!r.ok) throw new Error("proxy-" + r.status);
          return r.json();
        })
        .then(function (s) {
          if (!s || typeof s !== "object" || !Object.keys(s).length)
            throw new Error("proxy-empty");
          applyAndInject(s);
        })
        .catch(function (proxyErr) {
          log(
            "proxy fetch failed (" + proxyErr.message + ") — trying direct PHP",
          );
          fetch(PHP_DIRECT + "/api/widget-settings" + shopParam, {
            mode: "cors",
          })
            .then(function (r) {
              if (!r.ok) throw new Error("direct-" + r.status);
              return r.json();
            })
            .then(function (s) {
              if (s && typeof s === "object" && Object.keys(s).length) {
                applyAndInject(s);
              } else {
                log("direct PHP returned empty — applying fallback defaults");
                applyAndInject(FALLBACK_DEFAULTS);
              }
            })
            .catch(function (directErr) {
              log(
                "both fetches failed (" +
                  directErr.message +
                  ") — applying fallback defaults",
              );
              applyAndInject(FALLBACK_DEFAULTS);
            });
        });
    },

    _applySettings: function (s) {
      if (!s || typeof s !== "object") return;

      var btn = document.getElementById("tryfit-open-btn");
      var embedRoot = document.getElementById("tryfit-embed-root");

      // ── Watermark — apply before any early-return ────────────────────────
      // Default visible; only hidden when server explicitly sends show_watermark:false
      // (paid plans with branding removed). Free/basic plans always show it.
      var watermarkEl = document.getElementById("tryfit-watermark");
      if (watermarkEl) {
        var showWm = s.show_watermark;
        watermarkEl.style.display = (showWm === false || showWm === 0 || showWm === "0" || showWm === "false") ? "none" : "";
      }

      // ── CSS custom properties ─────────────────────────────────────────────
      // Apply before any early-return so collection pages (which have no
      // #tryfit-open-btn) still get the correct merchant colors on the modal.
      var bgColor = s.button_color || "#111827";
      var textColor = s.button_text_color || "#FFFFFF";
      document.documentElement.style.setProperty("--tryfit-primary", bgColor);
      document.documentElement.style.setProperty("--tryfit-primary-fg", textColor);
      try {
        var c = bgColor.replace("#", "");
        if (c.length === 6) {
          var rv = parseInt(c.substring(0, 2), 16);
          var gv = parseInt(c.substring(2, 4), 16);
          var bv = parseInt(c.substring(4, 6), 16);
          document.documentElement.style.setProperty(
            "--tryfit-primary-hover",
            "#" +
              Math.max(0, rv - 30).toString(16).padStart(2, "0") +
              Math.max(0, gv - 30).toString(16).padStart(2, "0") +
              Math.max(0, bv - 30).toString(16).padStart(2, "0"),
          );
          document.documentElement.style.setProperty(
            "--tryfit-primary-tint",
            "rgba(" + rv + "," + gv + "," + bv + ",0.08)",
          );
          document.documentElement.style.setProperty(
            "--tryfit-primary-border",
            "rgba(" + rv + "," + gv + "," + bv + ",0.22)",
          );
        }
      } catch (ignore) {}
      // Also write scoped vars on the embed root so the widget element picks them up
      try {
        var widgetId =
          (embedRoot && embedRoot.dataset && embedRoot.dataset.widgetId) ||
          "fitfyce-embed";
        this._ensureWidgetVars(widgetId, s);
      } catch (ignore) {}

      // Product pages: use live API data (enabled_product_ids) as the primary
      // source of truth so that a disabled product's button is removed even when
      // the storefront HTML was served from a CDN cache that still contains it.
      // Fall back to the Liquid metafield attribute when the API predates this field.
      if (embedRoot && embedRoot.dataset.pageType === "product") {
        var productId = String(
          embedRoot.dataset.productId ||
          (btn && btn.dataset && btn.dataset.productId) ||
          ""
        );
        var productEnabled;
        if (Array.isArray(s.enabled_product_ids)) {
          productEnabled = productId !== "" && s.enabled_product_ids.indexOf(productId) !== -1;
        } else {
          productEnabled = String(embedRoot.dataset.productTryon || "").toLowerCase() === "true";
        }
        console.log("[TryFit] TryOn Status:", {
          productId: productId,
          enabled: productEnabled,
          source: Array.isArray(s.enabled_product_ids) ? "api" : "metafield",
        });
        if (!productEnabled) {
          this._removeInjectedProductButton();
          return;
        }
      }

      if (!btn) {
        if (
          embedRoot &&
          embedRoot.dataset.pageType === "product"
        ) {
          this._injectProductButton(embedRoot, s);
          btn = document.getElementById("tryfit-open-btn");
        }
        if (!btn) {
          log("[warn] tryfit-open-btn not found — CSS vars applied, button styling skipped");
          return;
        }
      }

      var isMobile = window.innerWidth <= 768;

      // ── 1. Button background ──────────────────────────────────────────────
      btn.style.setProperty("background", bgColor, "important");

      // ── 2. Button text color ─────────────────────────────────────────────
      btn.style.setProperty("color", textColor, "important");

      // ── 3. Hover background ──────────────────────────────────────────────
      if (s.hover_bg_color) {
        document.documentElement.style.setProperty(
          "--tryfit-btn-hover-bg",
          s.hover_bg_color,
        );
        if (!document.getElementById("tryfit-hover-style")) {
          var hs = document.createElement("style");
          hs.id = "tryfit-hover-style";
          hs.textContent =
            "#tryfit-open-btn:hover{background:var(--tryfit-btn-hover-bg)!important;}";
          document.head.appendChild(hs);
        }
      }

      // ── 4. Border radius ─────────────────────────────────────────────────
      var radius = s.button_border_radius != null ? s.button_border_radius : 8;
      btn.style.setProperty("border-radius", radius + "px", "important");
      document.documentElement.style.setProperty(
        "--tryfit-border-radius",
        radius + "px",
      );

      // ── 5. Width (viewport-aware) ────────────────────────────────────────
      var wWidth, wUnit;
      if (isMobile) {
        wWidth =
          s.mobile_widget_width != null
            ? s.mobile_widget_width
            : s.button_width || 0;
        wUnit = s.mobile_widget_width_unit || (s.button_width > 0 ? "px" : "%");
      } else {
        wWidth =
          s.desktop_widget_width != null
            ? s.desktop_widget_width
            : s.button_width || 0;
        wUnit =
          s.desktop_widget_width_unit || (s.button_width > 0 ? "px" : "%");
      }
      if (wUnit === "%" && wWidth > 0) {
        btn.style.setProperty("width", wWidth + "%", "important");
      } else if (wUnit === "px" && wWidth > 0) {
        btn.style.setProperty("width", wWidth + "px", "important");
      } else {
        btn.style.setProperty("width", "100%", "important");
      }

      // ── 6. Height (viewport-aware) ───────────────────────────────────────
      var wHeight, hUnit;
      if (isMobile) {
        wHeight = s.mobile_widget_height != null ? s.mobile_widget_height : s.button_height || 0;
        hUnit = s.mobile_widget_height_unit || "auto";
      } else {
        wHeight = s.desktop_widget_height != null ? s.desktop_widget_height : s.button_height || 0;
        hUnit = s.desktop_widget_height_unit || "auto";
      }
      if (hUnit !== "auto" && wHeight > 0) {
        btn.style.setProperty("height", wHeight + "px", "important");
      } else {
        btn.style.setProperty("height", "auto", "important");
      }
      btn.style.setProperty("min-height", "", "important");

      // ── 7. Padding (viewport-aware) ──────────────────────────────────────
      var padTop = isMobile
        ? s.mobile_padding_top != null
          ? s.mobile_padding_top
          : s.button_padding_top
        : s.desktop_padding_top != null
          ? s.desktop_padding_top
          : s.button_padding_top;
      var padRight = isMobile
        ? s.mobile_padding_right != null
          ? s.mobile_padding_right
          : s.button_padding_right
        : s.desktop_padding_right != null
          ? s.desktop_padding_right
          : s.button_padding_right;
      var padBottom = isMobile
        ? s.mobile_padding_bottom != null
          ? s.mobile_padding_bottom
          : s.button_padding_bottom
        : s.desktop_padding_bottom != null
          ? s.desktop_padding_bottom
          : s.button_padding_bottom;
      var padLeft = isMobile
        ? s.mobile_padding_left != null
          ? s.mobile_padding_left
          : s.button_padding_left
        : s.desktop_padding_left != null
          ? s.desktop_padding_left
          : s.button_padding_left;
      if (padTop != null)
        btn.style.setProperty("padding-top", padTop + "px", "important");
      if (padRight != null)
        btn.style.setProperty("padding-right", padRight + "px", "important");
      if (padBottom != null)
        btn.style.setProperty("padding-bottom", padBottom + "px", "important");
      if (padLeft != null)
        btn.style.setProperty("padding-left", padLeft + "px", "important");

      // ── 8. Margin ────────────────────────────────────────────────────────
      if (s.button_margin_top != null)
        btn.style.setProperty(
          "margin-top",
          s.button_margin_top + "px",
          "important",
        );
      if (s.button_margin_right != null)
        btn.style.setProperty(
          "margin-right",
          s.button_margin_right + "px",
          "important",
        );
      if (s.button_margin_bottom != null)
        btn.style.setProperty(
          "margin-bottom",
          s.button_margin_bottom + "px",
          "important",
        );
      if (s.button_margin_left != null)
        btn.style.setProperty(
          "margin-left",
          s.button_margin_left + "px",
          "important",
        );

      // ── 9. Icon ──────────────────────────────────────────────────────────
      var iconEl = btn.querySelector(".tryfit-btn-icon");
      var hasIcon = s.button_icon && s.button_icon !== "none";
      if (iconEl) {
        if (hasIcon) {
          var svgHtml = this._getIconSvg(
            s.button_icon,
            s.icon_size || 16,
            s.icon_color || "#ffffff",
          );
          if (svgHtml) {
            iconEl.innerHTML = svgHtml;
            iconEl.style.setProperty("display", "flex", "important");
            if (s.main_icon_bg_color || s.icon_bg_color) {
              iconEl.style.background = s.main_icon_bg_color || s.icon_bg_color;
              iconEl.style.borderRadius = (s.icon_radius || 4) + "px";
              iconEl.style.padding = "2px";
            }
            if (s.icon_opacity != null)
              iconEl.style.opacity = s.icon_opacity / 100;
          }
        } else {
          iconEl.style.setProperty("display", "none", "important");
        }
      }

      // ── 10. Text layout ──────────────────────────────────────────────────
      var titleEl = btn.querySelector(".tryfit-btn-title");
      var subtitleEl = btn.querySelector(".tryfit-btn-subtitle");
      btn.style.setProperty(
        "flex-direction",
        hasIcon && titleEl ? "row" : "column",
        "important",
      );
      btn.style.setProperty(
        "gap",
        hasIcon && titleEl ? "8px" : "2px",
        "important",
      );

      if (titleEl) {
        // Title text
        titleEl.textContent =
          s.widget_title || s.button_text || "Try On This Look";
        titleEl.style.setProperty("text-align", "center", "important");
        // Title font size (viewport-aware)
        var titleFs = isMobile
          ? s.mobile_title_font_size != null
            ? s.mobile_title_font_size
            : s.title_font_size != null
              ? s.title_font_size
              : 14
          : s.desktop_title_font_size != null
            ? s.desktop_title_font_size
            : s.title_font_size != null
              ? s.title_font_size
              : 18;
        titleEl.style.setProperty("font-size", titleFs + "px", "important");
        titleEl.style.setProperty(
          "font-weight",
          s.title_font_weight || "600",
          "important",
        );
        if (s.title_font_family) {
          this._loadFont(s.title_font_family);
          titleEl.style.setProperty(
            "font-family",
            s.title_font_family,
            "important",
          );
        }
      }

      if (subtitleEl) {
        subtitleEl.style.setProperty("text-align", "center", "important");
        if (s.widget_subtitle) {
          subtitleEl.textContent = s.widget_subtitle;
          subtitleEl.style.setProperty("display", "block", "important");
          subtitleEl.style.setProperty(
            "font-size",
            (s.subtitle_font_size || 14) + "px",
            "important",
          );
          if (s.subtitle_font_family) {
            this._loadFont(s.subtitle_font_family);
            subtitleEl.style.setProperty(
              "font-family",
              s.subtitle_font_family,
              "important",
            );
          }
        } else {
          subtitleEl.style.setProperty("display", "none", "important");
        }
      }

      // Update aria-label to match current title text
      btn.setAttribute(
        "aria-label",
        s.widget_title || s.button_text || "Try On This Look",
      );

      // ── 11. Feature toggles ──────────────────────────────────────────────
      var toBool = function (val, def) {
        if (val === undefined || val === null) return def;
        return val !== false && val !== "false" && val !== 0 && val !== "0";
      };
      var waBtn = document.getElementById("tryfit-share-wa");
      var saveBtn = document.getElementById("tryfit-save-img");
      if (waBtn)
        waBtn.style.display = toBool(s.share_whatsapp_enabled, true)
          ? ""
          : "none";
      if (saveBtn)
        saveBtn.style.display = toBool(s.save_image_enabled, true)
          ? ""
          : "none";
      this._privacySkipped = !toBool(s.privacy_notice_shown, true);

      // ── 12. Reveal button (remove FOUC hide) ─────────────────────────────
      btn.style.setProperty("opacity", "1", "important");
      btn.style.setProperty("visibility", "visible", "important");

    },

    _matchThemeBuyButton: function (btn) {
      if (!btn) return;

      var selectors = [
        '.shopify-payment-button__button--unbranded',
        '.shopify-payment-button__button',
        '.product-form__cart-submit',
        'button[name="add"]',
        '.btn--full.add-to-cart',
        '[data-testid="Checkout-button"]',
      ];

      var buyBtn = null;
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el !== btn && el.offsetHeight > 0) { buyBtn = el; break; }
      }
      if (!buyBtn) return;

      var h = buyBtn.offsetHeight;
      var computed = window.getComputedStyle(buyBtn);
      var fs = computed.fontSize;

      if (h > 0) {
        btn.style.setProperty("height", h + "px", "important");
        btn.style.setProperty("min-height", h + "px", "important");
        btn.style.setProperty("padding-top", "0", "important");
        btn.style.setProperty("padding-bottom", "0", "important");
        // Hide subtitle so content fits cleanly within the matched height
        var subEl = btn.querySelector(".tryfit-btn-subtitle");
        if (subEl) subEl.style.setProperty("display", "none", "important");
      }

      if (fs) {
        var titleEl = btn.querySelector(".tryfit-btn-title");
        if (titleEl) titleEl.style.setProperty("font-size", fs, "important");
      }
    },

    _removeInjectedProductButton: function () {
      var btn = document.getElementById("tryfit-open-btn");
      if (btn && btn.parentNode) {
        var wrap = btn.closest("#tryfit-btn-wrap");
        if (wrap && wrap.parentNode) {
          wrap.parentNode.removeChild(wrap);
          return;
        }
        btn.parentNode.removeChild(btn);
      }
    },

    _loadFont: function (fontFamily) {
      if (!fontFamily) return;
      var name = fontFamily.split(",")[0].trim().replace(/['"]/g, "");
      var sys = [
        "Georgia",
        "Times New Roman",
        "Arial",
        "Helvetica",
        "Verdana",
        "Trebuchet MS",
        "serif",
        "sans-serif",
        "monospace",
      ];
      if (sys.indexOf(name) !== -1) return;
      var id = "tryfit-gfont-" + name.toLowerCase().replace(/\s+/g, "-");
      if (document.getElementById(id)) return;
      var link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=" +
        name.replace(/ /g, "+") +
        ":wght@300;400;500;600;700&display=swap";
      document.head.appendChild(link);
    },

    _getIconSvg: function (icon, size, color) {
      var s = size || 16,
        c = color || "#ffffff";
      var icons = {
        eye:
          '<svg width="' +
          s +
          '" height="' +
          s +
          '" viewBox="0 0 24 24" fill="none" stroke="' +
          c +
          '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        sparkles:
          '<svg width="' +
          s +
          '" height="' +
          s +
          '" viewBox="0 0 24 24" fill="none" stroke="' +
          c +
          '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z"/></svg>',
        camera:
          '<svg width="' +
          s +
          '" height="' +
          s +
          '" viewBox="0 0 24 24" fill="none" stroke="' +
          c +
          '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
        "shopping-bag":
          '<svg width="' +
          s +
          '" height="' +
          s +
          '" viewBox="0 0 24 24" fill="none" stroke="' +
          c +
          '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
      };
      return icons[icon] || null;
    },

    // ══════════════════════════════════════════════════════════════════════
    // BUTTON INJECTION  (embed-root / headless approach)
    // ══════════════════════════════════════════════════════════════════════

    _injectProductButton: function (root, settings) {
      if (document.getElementById("tryfit-open-btn")) return;

      var container =
        document.querySelector(".product-form__buttons") ||
        document.querySelector(".product__submit") ||
        document.querySelector("[data-product-form]") ||
        document.querySelector('form[action*="/cart/add"]') ||
        document.querySelector(".product-form") ||
        document.querySelector(".product-single__meta") ||
        document.querySelector(".product__info-wrapper") ||
        document.querySelector(".product__info") ||
        document.querySelector(".product-single") ||
        document.querySelector("main") ||
        document.body;

      var wrap = document.createElement("div");
      wrap.id = "tryfit-btn-wrap";
      wrap.className = "tryfit-btn-container tryfit-app-block";

      var btn = document.createElement("button");
      btn.type = "button"; // prevents cart-form submit
      btn.id = "tryfit-open-btn";
      btn.className = "tryfit-open-btn";
      btn.setAttribute("aria-label", "Virtual Try-On");
      btn.dataset.productId = root.dataset.productId || "";
      btn.dataset.productTitle = root.dataset.productTitle || "";
      btn.dataset.productHandle = root.dataset.productHandle || "";
      btn.dataset.storefrontUrl = root.dataset.storefrontUrl || "";
      btn.dataset.variants = root.dataset.variants || "[]";
      btn.dataset.options = root.dataset.options || "[]";
      btn.dataset.clothingImages = root.dataset.clothingImages || "{}";
      btn.dataset.featuredImage = root.dataset.featuredImage || "";
      btn.dataset.productImages = root.dataset.productImages || "[]";
      btn.dataset.selectedVariantId =
        root.dataset.selectedVariantId || this._getPageVariantId() || "";
      btn.dataset.proxyUrl = root.dataset.proxyUrl || "";
      btn.dataset.shop = root.dataset.shop || "";
      btn.dataset.currency =
        root.dataset.currency ||
        (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) ||
        "INR";
      // Build initial cssText from provided settings or sensible defaults.
      var s = settings || this._settingsCache || {};
      var bg = s.button_color || "#111827";
      var fg = s.button_text_color || "#ffffff";
      var radius = s.button_border_radius != null ? s.button_border_radius : 4;
      var pt = s.button_padding_top != null ? s.button_padding_top : 12;
      var pr = s.button_padding_right != null ? s.button_padding_right : 24;
      var pb = s.button_padding_bottom != null ? s.button_padding_bottom : 12;
      var pl = s.button_padding_left != null ? s.button_padding_left : 24;
      var isMobileInit = window.innerWidth <= 768;
      var initW = isMobileInit
        ? (s.mobile_widget_width != null ? s.mobile_widget_width : s.button_width || 0)
        : (s.desktop_widget_width != null ? s.desktop_widget_width : s.button_width || 0);
      var initWUnit = isMobileInit
        ? (s.mobile_widget_width_unit || "%")
        : (s.desktop_widget_width_unit || "px");
      var initH = isMobileInit
        ? (s.mobile_widget_height != null ? s.mobile_widget_height : s.button_height || 0)
        : (s.desktop_widget_height != null ? s.desktop_widget_height : s.button_height || 0);
      var initHUnit = isMobileInit
        ? (s.mobile_widget_height_unit || "auto")
        : (s.desktop_widget_height_unit || "auto");
      var width = initW > 0
        ? (initW + (initWUnit === "%" ? "%" : "px"))
        : "100%";
      var height = initH > 0 && initHUnit !== "auto"
        ? (initH + "px")
        : "auto";
      btn.style.cssText =
        "background:" +
        bg +
        ";color:" +
        fg +
        ";border:none;padding:" +
        pt +
        "px " +
        pr +
        "px " +
        pb +
        "px " +
        pl +
        "px;font-weight:600;border-radius:" +
        radius +
        "px;cursor:pointer;width:" +
        width +
        ";height:" +
        height +
        ";display:flex;flex-direction:column;align-items:center;justify-content:center;margin:10px 0;box-sizing:border-box;transition:opacity 0.15s;gap:2px;pointer-events:auto;";

      // Preserve the raw widget-styles payload on the injected button so
      // later logic can detect and re-use it as a single source of truth.
      try {
        btn.dataset.widgetStyles = JSON.stringify(s);
      } catch (ignore) {}

      // Aggressively set critical properties with !important so theme CSS
      // selectors or other stylesheet ordering cannot override them.
      try {
        btn.style.setProperty("background", bg, "important");
        btn.style.setProperty("color", fg, "important");
        btn.style.setProperty("border-radius", radius + "px", "important");
        btn.style.setProperty("width", width, "important");
        btn.style.setProperty("height", height, "important");
        btn.style.setProperty("padding-top", pt + "px", "important");
        btn.style.setProperty("padding-right", pr + "px", "important");
        btn.style.setProperty("padding-bottom", pb + "px", "important");
        btn.style.setProperty("padding-left", pl + "px", "important");
        if (s.button_margin_top != null)
          btn.style.setProperty(
            "margin-top",
            s.button_margin_top + "px",
            "important",
          );
        if (s.button_margin_right != null)
          btn.style.setProperty(
            "margin-right",
            s.button_margin_right + "px",
            "important",
          );
        if (s.button_margin_bottom != null)
          btn.style.setProperty(
            "margin-bottom",
            s.button_margin_bottom + "px",
            "important",
          );
        if (s.button_margin_left != null)
          btn.style.setProperty(
            "margin-left",
            s.button_margin_left + "px",
            "important",
          );
      } catch (ignore) {}

      // If the root (embed root or block) exposes a widget id, attach it to
      // the newly-created wrapper so scoped CSS variables can be applied.
      try {
        var widgetId =
          (root && root.dataset && root.dataset.widgetId) ||
          (root && root.id) ||
          "fitfyce-embed";
        wrap.dataset.widgetId = widgetId;
      } catch (ignore) {}

      // Ensure scoped CSS variables are written immediately so theme CSS
      // that references the variables picks up the correct values.
      try {
        this._ensureWidgetVars(
          (wrap.dataset && wrap.dataset.widgetId) || "fitfyce-embed",
          s,
        );
      } catch (ignore) {}

      var iconSpan = document.createElement("span");
      iconSpan.className = "tryfit-btn-icon";
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.style.cssText =
        "display:none;align-items:center;justify-content:center;flex-shrink:0;";

      var textWrap = document.createElement("div");
      textWrap.className = "tryfit-btn-text";
      textWrap.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:2px;";

      var titleSpan = document.createElement("span");
      titleSpan.className = "tryfit-btn-title";
      titleSpan.style.cssText = "line-height:1.2;text-align:center;";
      titleSpan.textContent = "Try On This Look";

      var subtitleSpan = document.createElement("span");
      subtitleSpan.className = "tryfit-btn-subtitle";
      subtitleSpan.style.cssText =
        "display:none;opacity:0.8;line-height:1.2;text-align:center;";

      textWrap.appendChild(titleSpan);
      textWrap.appendChild(subtitleSpan);
      btn.appendChild(iconSpan);
      btn.appendChild(textWrap);
      wrap.appendChild(btn);

      if (container === document.body) {
        document.body.appendChild(wrap);
      } else {
        container.insertAdjacentElement("afterend", wrap);
      }
      log("product button injected");
    },

    _parseJsonDataset: function (value, fallback) {
      if (!value) return fallback;
      try {
        var parsed = JSON.parse(value);
        return parsed == null ? fallback : parsed;
      } catch (ignore) {
        return fallback;
      }
    },

    _normalizeStorefrontUrl: function (url) {
      if (!url) return "";
      var str = String(url);
      if (str.indexOf("http://") === 0 || str.indexOf("https://") === 0) {
        return str;
      }
      if (str.charAt(0) === "/") {
        return window.location.origin + str;
      }
      return window.location.origin + "/" + str;
    },

    _extractVariantIdFromUrl: function (url) {
      if (!url) return "";
      var match = String(url).match(/[?&]variant=(\d+)/i);
      return match ? match[1] : "";
    },

    _pickDefaultVariant: function (variants) {
      if (!Array.isArray(variants) || !variants.length) return null;
      for (var i = 0; i < variants.length; i++) {
        if (variants[i] && variants[i].available !== false) return variants[i];
      }
      return variants[0] || null;
    },

    _buildTryOnConfig: function (product, extras) {
      extras = extras || {};
      var variants = Array.isArray(product && product.variants)
        ? product.variants
        : [];
      var options = Array.isArray(product && product.options)
        ? product.options
        : [];
      var productImages = Array.isArray(product && product.images)
        ? product.images.slice()
        : [];
      var storefrontUrl = this._normalizeStorefrontUrl(
        extras.storefrontUrl || (product && product.url) || "",
      );
      var selectedVariantId =
        String(
          extras.selectedVariantId ||
            this._extractVariantIdFromUrl(storefrontUrl) ||
            extras.pageVariantId ||
            "",
        ) || "";
      var selectedVariant = null;
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === String(selectedVariantId)) {
          selectedVariant = variants[i];
          break;
        }
      }
      if (!selectedVariant) {
        selectedVariant = this._pickDefaultVariant(variants);
        if (selectedVariant) selectedVariantId = String(selectedVariant.id);
      }

      var variantImage = null;
      if (selectedVariant) {
        variantImage =
          selectedVariant.featured_image || selectedVariant.image || null;
      }

      var price =
        selectedVariant && selectedVariant.price != null
          ? selectedVariant.price
          : product && product.price != null
            ? product.price
            : null;
      var compareAtPrice =
        selectedVariant && selectedVariant.compare_at_price != null
          ? selectedVariant.compare_at_price
          : product && product.compare_at_price != null
            ? product.compare_at_price
            : null;

      return {
        productId: product && product.id ? String(product.id) : "",
        productHandle:
          extras.productHandle || (product && product.handle) || "",
        productTitle: (product && product.title) || "",
        selectedVariantId: selectedVariantId,
        variantImage: variantImage || extras.variantImage || "",
        productImages: productImages,
        price: price,
        compareAtPrice: compareAtPrice,
        variants: variants,
        options: options,
        clothingImages: extras.clothingImages || {},
        featuredImage:
          extras.featuredImage || (product && product.featured_image) || "",
        storefrontUrl: storefrontUrl,
        proxyUrl: (extras.proxyUrl || "").replace(/\/$/, ""),
        shop: extras.shop || "",
        currency: extras.currency || "INR",
        modalPalette: extras.modalPalette || null,
      };
    },

    // Builds a palette object from live merchant settings so the collection modal
    // uses the same colors as the product page modal.
    _buildPaletteFromSettings: function (s) {
      if (!s || !s.button_color) return null;
      var primary = s.button_color;
      var c = primary.replace("#", "");
      var primaryHover = primary;
      var primaryTint = "rgba(17,24,39,0.08)";
      var primaryBorder = "rgba(17,24,39,0.20)";
      var shadowBtn = "0 4px 16px rgba(17,24,39,0.25)";
      var focusRing = "0 0 0 3px rgba(17,24,39,0.20)";
      if (c.length === 6) {
        var rv = parseInt(c.substring(0, 2), 16);
        var gv = parseInt(c.substring(2, 4), 16);
        var bv = parseInt(c.substring(4, 6), 16);
        primaryHover = "#" +
          Math.max(0, rv - 30).toString(16).padStart(2, "0") +
          Math.max(0, gv - 30).toString(16).padStart(2, "0") +
          Math.max(0, bv - 30).toString(16).padStart(2, "0");
        primaryTint = "rgba(" + rv + "," + gv + "," + bv + ",0.08)";
        primaryBorder = "rgba(" + rv + "," + gv + "," + bv + ",0.22)";
        shadowBtn = "0 4px 16px rgba(" + rv + "," + gv + "," + bv + ",0.30)";
        focusRing = "0 0 0 3px rgba(" + rv + "," + gv + "," + bv + ",0.24)";
      }
      return {
        primary:      primary,
        primaryFg:    s.button_text_color || "#ffffff",
        primaryHover: primaryHover,
        primaryTint:  primaryTint,
        primaryBorder: primaryBorder,
        shadowBtn:    shadowBtn,
        focusRing:    focusRing,
      };
    },

    _applyModalPalette: function (palette) {
      if (!palette) return;

      var root = document.documentElement;
      if (palette.primary) root.style.setProperty("--tryfit-primary", palette.primary);
      if (palette.primaryFg) root.style.setProperty("--tryfit-primary-fg", palette.primaryFg);
      if (palette.primaryHover) root.style.setProperty("--tryfit-primary-hover", palette.primaryHover);
      if (palette.primaryTint) root.style.setProperty("--tryfit-primary-tint", palette.primaryTint);
      if (palette.primaryBorder) root.style.setProperty("--tryfit-primary-border", palette.primaryBorder);
      if (palette.surface) root.style.setProperty("--tryfit-surface", palette.surface);
      if (palette.surface2) root.style.setProperty("--tryfit-surface-2", palette.surface2);
      if (palette.border) root.style.setProperty("--tryfit-border", palette.border);
      if (palette.borderHover) root.style.setProperty("--tryfit-border-hover", palette.borderHover);
      if (palette.text1) root.style.setProperty("--tryfit-text-1", palette.text1);
      if (palette.text2) root.style.setProperty("--tryfit-text-2", palette.text2);
      if (palette.text3) root.style.setProperty("--tryfit-text-3", palette.text3);
      if (palette.overlayBg) root.style.setProperty("--tryfit-overlay-bg", palette.overlayBg);
      if (palette.shadowModal) root.style.setProperty("--tryfit-shadow-modal", palette.shadowModal);
      if (palette.shadowImg) root.style.setProperty("--tryfit-shadow-img", palette.shadowImg);
      if (palette.shadowBtn) root.style.setProperty("--tryfit-shadow-btn", palette.shadowBtn);
      if (palette.focusRing) root.style.setProperty("--tryfit-focus-ring", palette.focusRing);
    },

    // Debug helper: runs in page console to report widget state and computed styles
    _debugWidgetState: function () {
      var btn = document.getElementById("tryfit-open-btn");
      var root =
        document.getElementById("tryfit-embed-root") ||
        (btn && btn.closest("[data-widget-id]")) ||
        null;
      var widgetId =
        (root && root.dataset && root.dataset.widgetId) ||
        (root && root.getAttribute && root.getAttribute("data-widget-id")) ||
        null;
      var styleEl = widgetId
        ? document.getElementById("tryfit-vars-" + widgetId)
        : null;
      return {
        btnExists: !!btn,
        btnDataset:
          btn && btn.dataset && btn.dataset.widgetStyles
            ? JSON.parse(btn.dataset.widgetStyles)
            : null,
        widgetRoot: !!root,
        widgetId: widgetId,
        varsStylePresent: !!styleEl,
        varsStyleText: styleEl ? styleEl.textContent : null,
        computedBg: btn ? getComputedStyle(btn).backgroundColor : null,
        computedColor: btn ? getComputedStyle(btn).color : null,
        computedBorderRadius: btn ? getComputedStyle(btn).borderRadius : null,
      };
    },

    _injectCollectionIcons: function (s) {
      var self = this;

      // Build lookup structures from API data.
      // enabled_product_ids / enabled_product_handles are returned by the
      // PHP public widget-settings endpoint and represent the live enabled state —
      // not the potentially stale CDN-cached metafield on each product page.
      var apiHasData = Array.isArray(s.enabled_product_ids);
      var enabledIds = apiHasData ? s.enabled_product_ids : [];
      var enabledHandles = Array.isArray(s.enabled_product_handles)
        ? s.enabled_product_handles
        : [];

      function extractHandle(link) {
        if (!link || !link.href) return null;
        var m = link.href.match(/\/products\/([^/?#]+)/);
        return m ? m[1] : null;
      }

      function isProductEnabled(card) {
        // No API data at all → legacy mode, show icons for every card.
        if (!apiHasData) return true;

        var link = card.querySelector('a[href*="/products/"]');
        var handle = extractHandle(link);
        var pid = card.dataset && card.dataset.productId
          ? String(card.dataset.productId)
          : null;

        // Handle match (preferred — available from URL without extra fetches).
        if (handle && enabledHandles.length > 0) {
          var okH = enabledHandles.indexOf(handle) !== -1;
          console.log("[TryFit] TryOn Collection Status:", { handle: handle, enabled: okH });
          return okH;
        }

        // ID match fallback (requires theme to emit data-product-id on the card).
        if (pid && enabledIds.length > 0) {
          var okI = enabledIds.indexOf(pid) !== -1;
          console.log("[TryFit] TryOn Collection Status:", { productId: pid, enabled: okI });
          return okI;
        }

        // API returned data but we can't identify this card's product.
        // Default CLOSED — never show a button for an unknown product.
        console.log("[TryFit] TryOn Collection Status:", {
          handle: handle,
          pid: pid,
          enabled: false,
          reason: "no-match",
        });
        return false;
      }

      var cards = Array.prototype.filter.call(
        document.querySelectorAll(
          '.product-card,.product-item,[class*="ProductItem"],.grid__item,' +
          '.collection-grid__item,[data-product-card],.grid-product,[class*="product-card"],' +
          '.card-wrapper,.product-card-wrapper,[class*="card-wrapper"],' +
          '.product__wrapper,.product_card,.product-block,.product-wrap',
        ),
        function (el) {
          return !!el.querySelector('a[href*="/products/"]');
        },
      );

      if (!cards.length) {
        var seen = [];
        document
          .querySelectorAll('a[href*="/products/"]')
          .forEach(function (link) {
            var card = link.closest(
              'li,article,[class*="product"],[class*="card"],[class*="grid-item"]',
            );
            if (card && seen.indexOf(card) === -1) {
              seen.push(card);
              if (isProductEnabled(card)) {
                self._addCollectionIcon(card, s);
              }
            }
          });
        return;
      }
      cards.forEach(function (card) {
        if (isProductEnabled(card)) {
          self._addCollectionIcon(card, s);
        }
      });
    },

    _addCollectionIcon: function (card, s) {
      if (card.querySelector(".tryfit-collection-icon")) return;
      if (window.getComputedStyle(card).position === "static")
        card.style.position = "relative";

      var posMap = {
        bottom_left: "bottom:8px;left:8px",
        bottom_right: "bottom:8px;right:8px",
        top_left: "top:8px;left:8px",
        top_right: "top:8px;right:8px",
      };
      var pos =
        posMap[s.collection_position || "bottom_left"] || "bottom:8px;left:8px";

      var icon = document.createElement("button");
      icon.type = "button";
      icon.className = "tryfit-collection-icon";
      icon.setAttribute("aria-label", "Virtual Try-On");
      icon.style.cssText =
        "position:absolute;" +
        pos +
        ";z-index:1;background:" +
        (s.button_color || "#111827") +
        ";color:" +
        (s.button_text_color || "#ffffff") +
        ";border:none;border-radius:" +
        (s.button_border_radius != null ? s.button_border_radius : 4) +
        "px;padding:6px 12px;display:flex;align-items:center;justify-content:center;gap:5px;" +
        "cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);transition:opacity 0.15s;" +
        "font-size:10px;font-weight:700;line-height:1;white-space:nowrap;pointer-events:auto;";

      var iconName =
        s.button_icon && s.button_icon !== "none" ? s.button_icon : null;
      if (iconName) {
        var svgHtml = this._getIconSvg(
          iconName,
          Math.round((s.icon_size || 16) * 0.75),
          s.icon_color || s.button_text_color || "#ffffff",
        );
        if (svgHtml) {
          var iw = document.createElement("span");
          iw.setAttribute("aria-hidden", "true");
          iw.style.cssText =
            "display:flex;align-items:center;justify-content:center;flex-shrink:0;";
          iw.innerHTML = svgHtml;
          icon.appendChild(iw);
        }
      }
      var lbl = document.createElement("span");
      lbl.textContent = "Try On";
      icon.appendChild(lbl);

      icon.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self._openCollectionIcon(icon);
      });

      card.appendChild(icon);
    },

    _openCollectionIcon: function (icon) {
      if (!icon) return;

      var card = icon.closest(
        '.product-card,.product-item,[class*="ProductItem"],.grid__item,.collection-grid__item,[data-product-card],.grid-product,[class*="product-card"],li,article,[class*="product"],[class*="grid-item"]',
      );
      var link = card ? card.querySelector('a[href*="/products/"]') : null;
      if (!link) {
        this.showToast("Could not open try-on for this item.");
        return;
      }

      var match = link.href.match(/\/products\/([^/?#]+)/);
      if (!match) {
        this.showToast("Could not open try-on for this item.");
        return;
      }

      var handle = match[1];
      var proxyUrl = this._proxyUrl || "";
      var shop = this._shop || window.location.hostname;
      var self = this;

      icon.disabled = true;
      icon.style.opacity = "0.55";

      fetch("/products/" + handle + ".js")
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (product) {
          icon.disabled = false;
          icon.style.opacity = "";

          self.config = self._buildTryOnConfig(
            {
              id: product.id,
              handle: product.handle || handle,
              title: product.title || "",
              variants: product.variants || [],
              options: product.options || [],
              images: product.images || [],
              featured_image: product.featured_image || "",
              url: link.href,
            },
            {
              productHandle: product.handle || handle,
              storefrontUrl: link.href,
              selectedVariantId:
                self._extractVariantIdFromUrl(link.href) || "",
              clothingImages: {},
              featuredImage: product.featured_image || "",
              proxyUrl: proxyUrl,
              shop: shop,
              currency:
                (window.Shopify &&
                  window.Shopify.currency &&
                  window.Shopify.currency.active) ||
                "INR",
              modalPalette: self._buildPaletteFromSettings(self._settingsCache),
            },
          );
          self._selectedVariantId = self.config.selectedVariantId || null;
          self._tryOnVariantId = null;
          log("collection try-on — product:", product.id, "handle:", handle);
          self.openModal();
        })
        .catch(function (err) {
          icon.disabled = false;
          icon.style.opacity = "";
          log("collection try-on error:", err && err.message ? err.message : err);
          self.showToast("Try-on could not load. Please try again.");
        });
    },

    // Ensure a scoped <style> element exists that sets CSS variables for a
    // particular widget instance identified by `widgetId`.
    _ensureWidgetVars: function (widgetId, s) {
      if (!widgetId) widgetId = "fitfyce-embed";
      var styleId = "tryfit-vars-" + widgetId;
      var existing = document.getElementById(styleId);
      var css = '[data-widget-id="' + widgetId + '"]{';
      if (s && s.button_color)
        css += "--tryfit-primary:" + s.button_color + ";";
      if (s && s.button_text_color)
        css += "--tryfit-primary-fg:" + s.button_text_color + ";";
      if (s && s.button_border_radius != null)
        css += "--tryfit-border-radius:" + s.button_border_radius + "px;";
      if (s && s.button_padding_top != null)
        css += "--tryfit-padding-top:" + s.button_padding_top + "px;";
      if (s && s.button_padding_right != null)
        css += "--tryfit-padding-right:" + s.button_padding_right + "px;";
      if (s && s.button_padding_bottom != null)
        css += "--tryfit-padding-bottom:" + s.button_padding_bottom + "px;";
      if (s && s.button_padding_left != null)
        css += "--tryfit-padding-left:" + s.button_padding_left + "px;";
      if (s && s.hover_bg_color)
        css += "--tryfit-primary-hover:" + s.hover_bg_color + ";";
      css += "}";
      if (existing) {
        if (existing.textContent !== css) existing.textContent = css;
      } else {
        var el = document.createElement("style");
        el.id = styleId;
        el.textContent = css;
        // Insert close to the widget so it's high priority; append to head
        // to ensure it's applied before many theme styles.
        (document.head || document.documentElement).appendChild(el);
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // OPEN BUTTON → MODAL
    // ══════════════════════════════════════════════════════════════════════

    _openFromButton: function (btn) {
      var variants = this._parseJsonDataset(btn.dataset.variants, []);
      var options = this._parseJsonDataset(btn.dataset.options, []);
      var clothingImages = this._parseJsonDataset(
        btn.dataset.clothingImages,
        {},
      );
      var productImages = this._parseJsonDataset(btn.dataset.productImages, []);

      this.config = this._buildTryOnConfig(
        {
          id: btn.dataset.productId || "",
          handle: btn.dataset.productHandle || "",
          title: btn.dataset.productTitle || "",
          variants: variants,
          options: Array.isArray(options) ? options : [],
          images: productImages,
          featured_image: btn.dataset.featuredImage || "",
          url: btn.dataset.storefrontUrl || "",
        },
        {
          productHandle: btn.dataset.productHandle || "",
          storefrontUrl: btn.dataset.storefrontUrl || "",
          selectedVariantId:
            btn.dataset.selectedVariantId || this._getPageVariantId() || "",
          variantImage: btn.dataset.variantImage || "",
          clothingImages: clothingImages,
          featuredImage: btn.dataset.featuredImage || "",
          proxyUrl: btn.dataset.proxyUrl || "",
          shop: btn.dataset.shop || "",
          currency: btn.dataset.currency || "INR",
        },
      );
      this._selectedVariantId = this.config.selectedVariantId || null;
      this._tryOnVariantId = null;

      log(
        "opening modal — product:",
        this.config.productId,
        "variants:",
        variants.length,
      );
      this.openModal();
    },

    // ══════════════════════════════════════════════════════════════════════
    // MODAL OPEN / CLOSE
    // ══════════════════════════════════════════════════════════════════════

    openModal: function () {
      this._ensureOverlayInBody();

      var overlay = document.getElementById("tryfit-overlay");
      if (!overlay) {
        log("ERROR: #tryfit-overlay not found in DOM");
        return;
      }

      // Save previously focused element for restoration on close
      this._previousFocus = document.activeElement;

      // ── Force ALL layout/stacking styles inline ──────────────────────────
      // Using setAttribute("style", ...) replaces the entire style attribute,
      // so no theme-injected inline styles can survive.
      overlay.setAttribute(
        "style",
        [
          "display:flex",
          "position:fixed",
          "top:0",
          "left:0",
          "right:0",
          "bottom:0",
          "width:100vw",
          "height:100vh",
          "min-height:100vh",
          "z-index:2147483647",
          "box-sizing:border-box",
          "padding:16px",
          "margin:0",
          "background:rgba(0,0,0,0.65)",
          "align-items:center",
          "justify-content:center",
          "overflow-y:auto",
          "overscroll-behavior:contain",
          "pointer-events:auto",
          "isolation:isolate",
          "transform:none",
          "border:none",
          "border-radius:0",
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        ].join(";"),
      );

      overlay.setAttribute("aria-hidden", "false");

      // ── Harden the modal card against theme interference ─────────────────
      var modal = overlay.querySelector(".tryfit-modal");
      if (modal) {
        modal.style.pointerEvents = "auto";
        modal.style.position = "relative";
        modal.style.zIndex = "1";
      }

      document.body.style.overflow = "hidden";

      // Reset file input state
      var fi = document.getElementById("tryfit-file-input");
      if (fi)
        try {
          fi.value = "";
        } catch (ignore) {}

      this._renderVariantSelector();
      this._applyModalPalette(this.config && this.config.modalPalette);
      this._showStep(this._privacySkipped ? "upload" : "privacy");

      // Focus close button first (accessibility best practice for dialogs)
      requestAnimationFrame(function () {
        var closeBtn = overlay.querySelector(
          "[data-tryfit-action='close'], .tryfit-close",
        );
        var target =
          closeBtn || overlay.querySelector("button:not([disabled])");
        if (target) {
          target.focus();
          log("focused:", target.id || target.className);
        }
      });
    },

    closeModal: function () {
      var overlay = document.getElementById("tryfit-overlay");
      if (overlay) {
        overlay.style.display = "none";
        overlay.setAttribute("aria-hidden", "true");
      }
      document.body.style.overflow = "";
      this._stopProgress();
      this._stopCountdown();
      this._closeCameraStream();
      this._resetCameraStep();
      this._buyingNow = false;
      this._filePickerActive = false;
      this._lastFileTriggerAt = 0; // reset debounce so next modal open works immediately
      this._selectedVariantId = null;
      this._tryOnVariantId = null;
      this._lastAvatarBase64 = null;
      this._lastClothingImageUrl = null;
      this._restoreErrorStep();

      // Release object URL held for the processing-step photo preview
      if (this._processingPreviewUrl) {
        try {
          URL.revokeObjectURL(this._processingPreviewUrl);
        } catch (ignore) {}
        this._processingPreviewUrl = null;
      }
      var prevWrap = document.getElementById("tryfit-processing-preview");
      if (prevWrap) prevWrap.style.display = "none";

      var zoomOverlay = document.getElementById("tryfit-zoom-overlay");
      if (zoomOverlay && zoomOverlay.parentNode)
        zoomOverlay.parentNode.removeChild(zoomOverlay);

      // Remove any lingering drag-over state
      var zone = document.getElementById("tryfit-upload-label");
      if (zone) zone.classList.remove("tryfit-drag-over");

      // Restore focus to the element that was active before modal opened
      if (
        this._previousFocus &&
        typeof this._previousFocus.focus === "function"
      ) {
        try {
          this._previousFocus.focus();
        } catch (ignore) {}
      }
      this._previousFocus = null;
      log("modal closed");
    },

    // ══════════════════════════════════════════════════════════════════════
    // STEP MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════

    _showStep: function (step) {
      var steps = [
        "privacy",
        "upload",
        "camera",
        "processing",
        "result",
        "error",
      ];
      for (var i = 0; i < steps.length; i++) {
        var el = document.getElementById("tryfit-step-" + steps[i]);
        if (el) {
          // Always use explicit "block" — never "" — so theme CSS can't
          // re-hide a step by overriding an empty display property.
          el.style.display = steps[i] === step ? "block" : "none";
        }
      }
      log("step:", step);
    },

    _renderVariantSelector: function () {
      var wrap = document.getElementById("tryfit-variant-selector");
      var variants = this.config.variants || [];
      if (!wrap) return;

      if (variants.length <= 1) {
        wrap.innerHTML = "";
        return;
      }

      var sel = document.createElement("select");
      sel.id = "tryfit-variant-select";
      sel.setAttribute("aria-label", "Select variant for try-on");
      sel.style.cssText =
        "width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:4px;font-size:15px;background:#fff;cursor:pointer;pointer-events:auto;";

      for (var i = 0; i < variants.length; i++) {
        var opt = document.createElement("option");
        opt.value = variants[i].id;
        opt.textContent = variants[i].title || "Variant " + (i + 1);
        sel.appendChild(opt);
      }

      var pageVariant = this._getPageVariantId();
      if (!pageVariant && this._selectedVariantId) {
        pageVariant = String(this._selectedVariantId);
      }
      if (pageVariant) sel.value = String(pageVariant);

      wrap.innerHTML = "";
      wrap.appendChild(sel);

      var self = this;
      sel.addEventListener("change", function () {
        self._selectedVariantId = this.value;
      });
    },

    // ══════════════════════════════════════════════════════════════════════
    // PHOTO HANDLING
    // ══════════════════════════════════════════════════════════════════════

    handlePhotoSelect: function (file) {
      if (this._tryOnInProgress) {
        log("handlePhotoSelect — try-on already in progress, ignoring duplicate trigger");
        return;
      }

      // ── Free-tier limit check ──────────────────────────────────────────────
      if (this._getUsageCount() >= MAX_FREE_TRYONS) {
        this._showLimitReached();
        return;
      }

      this._tryOnInProgress = true;

      var allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
      ];
      if (
        file.type &&
        allowedTypes.indexOf(file.type) === -1 &&
        file.type.indexOf("image/") !== 0
      ) {
        this.showError("Please upload an image file (JPEG, PNG, or WebP).");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        this.showError(
          "Photo must be under 5 MB. Please choose a smaller image.",
        );
        return;
      }

      var self = this;
      this._showStep("processing");
      this.showProgress("Resizing your photo…");

      // Show uploaded photo thumbnail in the processing step so the user
      // can see their photo was received while the AI works.
      var prevWrap = document.getElementById("tryfit-processing-preview");
      var prevImg = document.getElementById("tryfit-processing-preview-img");
      if (prevWrap && prevImg) {
        if (this._processingPreviewUrl) {
          try {
            URL.revokeObjectURL(this._processingPreviewUrl);
          } catch (ignore) {}
        }
        var objUrl = URL.createObjectURL(file);
        prevImg.src = objUrl;
        prevWrap.style.display = "";
        this._processingPreviewUrl = objUrl;
      }

      this.toJpegBlob(file)
        .then(function (blob) {
          self.showProgress("FitSnap is creating your look…");
          self.startProgressAnimation(28);
          return self._createSession().then(function () {
            return self.runTryOn(blob);
          });
        })
        .catch(function (err) {
          self._tryOnInProgress = false;
          self._stopProgress();
          self.showError(
            "Something went wrong preparing your photo. Please try again.",
          );
          log("photo error:", err);
        });
    },

    _createSession: function () {
      var self = this;
      var variant = this.getSelectedVariant();
      var shop = this.config.shop || window.location.hostname;

      return fetch(
        this.config.proxyUrl +
          "/api/session/create?shop=" +
          encodeURIComponent(shop),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: this.config.productId,
            variant_id: variant ? variant.id : null,
            device_type: /Mobi|Android/i.test(navigator.userAgent)
              ? "mobile"
              : "desktop",
          }),
        },
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (d.session_id) {
            self.sessionId = d.session_id;
            log("session:", d.session_id);
          }
        })
        .catch(function (err) {
          log("session error:", err.message);
        });
    },

    resizeImage: function (file, maxW, maxH) {
      return new Promise(function (resolve) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth,
            h = img.naturalHeight;
          if (w > maxW || h > maxH) {
            var ratio = Math.min(maxW / w, maxH / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            function (blob) {
              resolve(blob || file);
            },
            "image/jpeg",
            0.85,
          );
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          resolve(file);
        };
        img.src = url;
      });
    },

    // Convert uploaded file to JPEG, capped at MAX_AVATAR_SIDE px on the longest
    // side.  Limiting here keeps the base64 POST body well under server and
    // Shopify-proxy request-size limits while still giving the AI model enough
    // detail (Fashn.ai recommends ≥ 768 px; 1280 px is excellent quality).
    toJpegBlob: function (file) {
      var MAX_AVATAR_SIDE = 1280;
      return new Promise(function (resolve) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          if (w > MAX_AVATAR_SIDE || h > MAX_AVATAR_SIDE) {
            var ratio = Math.min(MAX_AVATAR_SIDE / w, MAX_AVATAR_SIDE / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            function (blob) { resolve(blob || file); },
            "image/jpeg",
            0.88,
          );
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
        this.showError(
          "Could not determine the selected variant. Please refresh and try again.",
        );
        return Promise.resolve();
      }

      var mapping = this.getVariantMapping(variant.id);
      var clothingImage =
        mapping && mapping.tryon_image_url ? mapping.tryon_image_url : null;
      if (!clothingImage) {
        var fi = variant.featured_image || variant.image;
        clothingImage = fi && fi.src ? fi.src : null;
      }
      if (!clothingImage) clothingImage = this.config.featuredImage || null;
      if (!clothingImage) {
        this.showError(
          "No product image is available for try-on. Please contact the merchant.",
        );
        return Promise.resolve();
      }

      // Normalise protocol-relative URLs before sending
      if (clothingImage.indexOf("//") === 0)
        clothingImage = "https:" + clothingImage;

      log(
        "try-on: variant",
        variant.id,
        "clothing",
        clothingImage.substring(0, 60) + "…",
      );

      // Convert only the user's photo to base64.
      // The clothing image is sent as a URL so the PHP server can download it
      // directly — this keeps the POST body small and avoids browser CORS limits.
      return self._blobToBase64(avatarBlob).then(function (avatarBase64) {
        // Store so the result-step variant picker can re-run without re-uploading
        self._lastAvatarBase64 = avatarBase64;
        self._lastClothingImageUrl = clothingImage;

        var controller = window.AbortController ? new AbortController() : null;
        var timeoutId = controller
          ? setTimeout(function () {
              controller.abort();
            }, 95000)
          : null;
        var shop = self.config.shop || window.location.hostname;

        var opts = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clothing_image: clothingImage, // URL — PHP downloads it server-side
            avatar_image: avatarBase64, // User photo must be base64
            shopify_variant_id: variant.id,
            shopify_product_id: self.config.productId,
            session_id: self.sessionId,
          }),
        };
        if (controller) opts.signal = controller.signal;

        return fetch(
          self.config.proxyUrl + "/api/tryon?shop=" + encodeURIComponent(shop),
          opts,
        )
          .then(function (r) {
            if (timeoutId) clearTimeout(timeoutId);
            if (!r.ok) {
              // Read the actual error body so the user sees a helpful message
              return r
                .json()
                .catch(function () {
                  return {};
                })
                .then(function (errBody) {
                  if (errBody.raw_error || errBody.status_code !== undefined) {
                    log(
                      "try-on API error — status:",
                      errBody.status_code,
                      "detail:",
                      errBody.raw_error,
                    );
                  }
                  return Promise.reject(
                    new Error(
                      errBody.error || "Something went wrong. Please try again.",
                    ),
                  );
                });
            }
            return r.json();
          })
          .then(function (data) {
            self._stopProgress();
            if (data.result_image) {
              self.showResult(data.result_image);
            } else {
              self.showError(data.error || "Try-on failed. Please try again.");
            }
          })
          .catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            self._stopProgress();
            var msg;
            if (err && err.name === "AbortError") {
              msg = "This is taking longer than expected. Please try again.";
            } else if (err && err.message && err.message.length < 200) {
              msg = err.message;
            } else {
              msg = "Something went wrong. Please try again.";
            }
            self.showError(msg);
            log("runTryOn error:", err);
          });
      });
    },

    _blobToBase64: function (blob) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function (e) {
          resolve(e.target.result);
        };
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    },

    _fetchAsBase64: function (url) {
      return fetch(url, { mode: "cors" })
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var r = new FileReader();
            r.onload = function (e) {
              resolve(e.target.result);
            };
            r.onerror = function () {
              resolve(null);
            };
            r.readAsDataURL(blob);
          });
        })
        .catch(function () {
          return null;
        });
    },

    // ══════════════════════════════════════════════════════════════════════
    // UI FEEDBACK
    // ══════════════════════════════════════════════════════════════════════

    showResult: function (imageUrl) {
      this._tryOnInProgress = false;
      this._incrementUsageCount();
      var img = document.getElementById("tryfit-result-img");
      if (img) {
        img.src = imageUrl;
        img.alt = "Your virtual try-on result";
      }

      var titleEl = document.getElementById("tryfit-result-product-title");
      if (titleEl) titleEl.textContent = this.config.productTitle || "";

      this._qty = 1;
      var qtyEl = document.getElementById("tryfit-qty-display");
      if (qtyEl) qtyEl.textContent = "1";

      // Re-show countdown banner in case it was hidden from a previous session
      var banner = document.getElementById("tryfit-countdown-banner");
      if (banner) banner.style.display = "";

      // Capture the variant used for this try-on BEFORE _renderResultVariantGrid
      // rebuilds the select (which would otherwise overwrite sel.value with the
      // page's default variant, losing the user's upload-step selection).
      var tryOnVariant = this.getSelectedVariant();
      if (tryOnVariant) this._tryOnVariantId = tryOnVariant.id;

      this._renderResultVariantGrid();
      this._updatePriceDisplay();
      this._startCountdown(600);
      this._applyResultCoupon();
      this._showStep("result");
    },

    showProgress: function (msg) {
      var el = document.getElementById("tryfit-progress-msg");
      if (el) el.textContent = msg;
    },

    showError: function (msg) {
      this._tryOnInProgress = false;
      var el = document.getElementById("tryfit-error-msg");
      if (el) el.textContent = msg;
      this._showStep("error");
      log("error:", msg);
    },

    // ── Free-tier usage limit helpers ────────────────────────────────────────

    _getUsageCount: function () {
      try {
        var stored = localStorage.getItem(USAGE_KEY);
        if (!stored) return 0;
        var data = JSON.parse(stored);
        return (typeof data.count === "number" && data.count >= 0) ? data.count : 0;
      } catch (e) {
        return 0;
      }
    },

    _incrementUsageCount: function () {
      try {
        var stored = localStorage.getItem(USAGE_KEY);
        var data = stored ? JSON.parse(stored) : {};
        data.count = ((typeof data.count === "number" && data.count >= 0) ? data.count : 0) + 1;
        localStorage.setItem(USAGE_KEY, JSON.stringify(data));
        log("try-on usage count:", data.count);
      } catch (e) {
        // localStorage unavailable (incognito quota, etc.) — silently skip
      }
    },

    _showLimitReached: function () {
      this._tryOnInProgress = false;
      var heading = document.querySelector("#tryfit-step-error .tryfit-heading");
      if (heading) {
        heading.textContent = "Free Try-Ons Used Up";
        heading.dataset.limitMode = "true";
      }
      var msgEl = document.getElementById("tryfit-error-msg");
      if (msgEl) {
        msgEl.textContent =
          "You’ve used all " +
          MAX_FREE_TRYONS +
          " free virtual try-ons for this browser. " +
          "Visit the full product page to explore more details.";
      }
      var retryBtn = document.getElementById("tryfit-retry-error");
      if (retryBtn) {
        retryBtn.textContent = "Close";
        retryBtn.setAttribute("data-tryfit-action", "close");
        retryBtn.dataset.limitMode = "true";
      }
      this._showStep("error");
      log("try-on limit reached — max:", MAX_FREE_TRYONS);
    },

    _restoreErrorStep: function () {
      var heading = document.querySelector("#tryfit-step-error .tryfit-heading");
      if (heading && heading.dataset.limitMode) {
        heading.textContent = "Something went wrong";
        delete heading.dataset.limitMode;
      }
      var retryBtn = document.getElementById("tryfit-retry-error");
      if (retryBtn && retryBtn.dataset.limitMode) {
        retryBtn.textContent = "Try Again";
        retryBtn.setAttribute("data-tryfit-action", "retry");
        delete retryBtn.dataset.limitMode;
      }
    },

    showToast: function (msg, durationMs) {
      // Remove any existing toast before showing a new one
      var existing = document.querySelector(".tryfit-toast");
      if (existing && existing.parentNode)
        existing.parentNode.removeChild(existing);

      var toast = document.createElement("div");
      toast.className = "tryfit-toast";
      toast.textContent = msg;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, durationMs || 2500);
    },

    startProgressAnimation: function () {},

    _stopProgress: function () {
      if (this._progressTimer) {
        clearInterval(this._progressTimer);
        this._progressTimer = null;
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // CART / CHECKOUT
    // ══════════════════════════════════════════════════════════════════════

    addToCart: function (variantId, btnEl) {
      var self = this;
      if (self._addingToCart) return;

      var addBtn = btnEl || document.getElementById("tryfit-add-cart");
      var origText = addBtn ? addBtn.textContent : "Add to Cart";

      function resetBtn(text) {
        self._addingToCart = false;
        if (addBtn) {
          addBtn.disabled = false;
          addBtn.textContent = text || origText;
          addBtn.classList.remove("tryfit-btn--loading");
        }
      }

      self._addingToCart = true;
      this.trackAction("add_to_cart");

      if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = "Adding…";
        addBtn.classList.add("tryfit-btn--loading");
      }

      var cartData = {
        id: variantId,
        quantity: self._qty || 1,
        properties: {},
      };
      if (self.sessionId) {
        cartData.properties["_fitfyce_session"] = self.sessionId;
        cartData.properties["_fitfyce_tryon"] = "true";
      }

      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cartData),
      })
        .then(function (r) {
          if (!r.ok) {
            return r.json()
              .catch(function () { return {}; })
              .then(function (body) {
                var msg = (body && body.description) ||
                          (body && body.message) ||
                          "cart/add HTTP " + r.status;
                return Promise.reject(new Error(msg));
              });
          }
          return r.json();
        })
        .then(function () {
          resetBtn(origText);
          self.showToast("Added to cart!");
          self.closeModal();
          self._openCartDrawer();
        })
        .catch(function (err) {
          var msg = err && err.message || "";
          var userMsg = (msg.toLowerCase().indexOf("sold out") !== -1 ||
                         msg.toLowerCase().indexOf("unavailable") !== -1)
            ? "This item is sold out or unavailable."
            : "Could not add to cart. Please try again.";
          resetBtn(origText);
          self.showToast(userMsg);
          log("addToCart error:", msg);
        });
    },

    _openCartDrawer: function () {
      // Fire all standard cart events on both document and window
      var evtNames = ["cart:updated", "cart-update", "cart:open", "cart:toggle", "cart:refresh"];
      for (var ei = 0; ei < evtNames.length; ei++) {
        try {
          var ce = new CustomEvent(evtNames[ei], { bubbles: true, detail: {} });
          document.dispatchEvent(ce);
          window.dispatchEvent(ce);
        } catch (ignore) {}
      }

      // Fetch live cart data and fire cart:refresh with detail (Dawn, Impulse, etc.)
      fetch("/cart.js")
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          try {
            var cartEvt = new CustomEvent("cart:refresh", {
              detail: { cart: cart },
              bubbles: true,
            });
            document.dispatchEvent(cartEvt);
            window.dispatchEvent(cartEvt);
          } catch (ignore) {}
        })
        .catch(function () {});

      // Theme-specific toggle button selectors (Dawn, Debut, Prestige, Impulse, etc.)
      var selectors = [
        "[data-cart-toggle]",
        '[data-drawer-toggle="cart"]',
        '[aria-controls="CartDrawer"]',
        '[aria-controls="cart-drawer"]',
        '[aria-controls="cart-notification-product"]',
        ".cart-drawer__toggle",
        '[href="#cart-drawer"]',
        '[href="#CartDrawer"]',
        ".header__icon--cart",
        '[href="#cart"]',
        '[data-action="toggle-cart"]',
        ".cart-toggle",
        '[data-toggle="cart-drawer"]',
        ".js-cart-trigger",
        ".cart-icon-bubble",
        ".header-cart-toggle",
        "[data-cart-btn]",
        ".cart__toggle",
        "[data-open-cart]",
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.getAttribute("aria-expanded") !== "true") {
          try { el.click(); } catch (ignore) {}
          return;
        }
      }

      // Custom element API (Dawn theme: <cart-drawer>, <cart-notification>)
      var drawerEl =
        document.querySelector("cart-drawer") ||
        document.querySelector("cart-notification");
      if (drawerEl) {
        if (typeof drawerEl.open === "function") {
          try { drawerEl.open(); return; } catch (ignore) {}
        }
        try {
          drawerEl.classList.add("is-open");
          drawerEl.removeAttribute("hidden");
        } catch (ignore) {}
        return;
      }

      // Last resort: navigate to cart page if no drawer was found
      setTimeout(function () {
        var open = document.querySelector(
          "cart-drawer.is-open, .cart-drawer.is-open, #CartDrawer.is-open, [data-cart-drawer].is-open"
        );
        if (!open) window.location.href = "/cart";
      }, 400);
    },

    buyNow: function (variantId, btnEl) {
      var self = this;
      if (self._buyingNow) return;
      self._buyingNow = true;
      this.trackAction("buy_now");

      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = "Loading…";
        btnEl.classList.add("tryfit-btn--loading");
      }

      function resetBtn() {
        self._buyingNow = false;
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = "Buy Now";
          btnEl.classList.remove("tryfit-btn--loading");
        }
      }

      var cartData = {
        id: variantId,
        quantity: this._qty || 1,
        properties: {},
      };
      if (this.sessionId) {
        cartData.properties["_fitfyce_session"] = this.sessionId;
        cartData.properties["_fitfyce_tryon"] = "true";
      }

      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cartData),
      })
        .then(function (r) {
          if (!r.ok) {
            return r.json()
              .catch(function () { return {}; })
              .then(function (body) {
                return Promise.reject(new Error(
                  (body && body.description) || "cart/add HTTP " + r.status
                ));
              });
          }
          return r.json();
        })
        .then(function () {
          // _buyingNow intentionally not reset — we're navigating away
          window.location.href = "/checkout";
        })
        .catch(function (err) {
          resetBtn();
          var msg = err && err.message || "";
          var userMsg = (msg.toLowerCase().indexOf("sold out") !== -1 ||
                         msg.toLowerCase().indexOf("unavailable") !== -1)
            ? "This item is sold out or unavailable."
            : "Could not complete purchase. Please try again.";
          self.showToast(userMsg);
          log("buyNow error:", msg);
        });
    },

    // ══════════════════════════════════════════════════════════════════════
    // SHARE / SAVE
    // ══════════════════════════════════════════════════════════════════════

    saveImage: function (url) {
      var self = this;
      if (this._isSaving) return;
      this._isSaving = true;
      this.trackAction("save_image");

      var saveBtn = document.getElementById("tryfit-save-img");
      var origHTML = saveBtn ? saveBtn.innerHTML : null;

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.setAttribute("aria-busy", "true");
        saveBtn.innerHTML =
          '<svg class="tryfit-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
          'aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving…';
      }

      var filename = "tryon-result-" + Date.now() + ".jpg";

      function restoreBtn() {
        self._isSaving = false;
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.removeAttribute("aria-busy");
          if (origHTML !== null) saveBtn.innerHTML = origHTML;
        }
      }

      function triggerDownload(blob) {
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          if (a.parentNode) document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 1000);
        restoreBtn();
        self.showToast("Image saved!");
      }

      function tryFetch() {
        var ctrl = window.AbortController ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
        var opts = { mode: "cors" };
        if (ctrl) opts.signal = ctrl.signal;

        fetch(url, opts)
          .then(function (r) {
            if (timer) clearTimeout(timer);
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.blob();
          })
          .then(function (blob) {
            triggerDownload(blob);
          })
          .catch(function (err) {
            if (timer) clearTimeout(timer);
            log("saveImage fetch error:", err);
            restoreBtn();
            window.open(url, "_blank", "noopener,noreferrer");
            self.showToast("Opening in new tab — long press to save.");
          });
      }

      // Try canvas.toBlob() first — works when the image is same-origin or the
      // server already sent CORS headers during the initial load.  If the canvas
      // is tainted (cross-origin without CORS), toBlob() throws a SecurityError
      // synchronously and we fall through to the fetch path.
      var imgEl = document.getElementById("tryfit-result-img");
      if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          canvas.getContext("2d").drawImage(imgEl, 0, 0);
          canvas.toBlob(
            function (blob) {
              if (blob) {
                triggerDownload(blob);
              } else {
                tryFetch();
              }
            },
            "image/jpeg",
            0.95,
          );
          return; // canvas path initiated
        } catch (e) {
          log("canvas tainted, falling back to fetch:", e.message);
        }
      }

      tryFetch();
    },

    shareWhatsApp: function (imageUrl, productUrl) {
      // Open blank tab SYNCHRONOUSLY before any async work — popup blockers
      // reject window.open if it is called after fetch/sendBeacon delay.
      var newWindow = null;
      try { newWindow = window.open("", "_blank", "noopener,noreferrer"); } catch (ignore) {}

      this.trackAction("share_wa");

      var title = (this.config && this.config.productTitle) || "";
      var pageUrl =
        productUrl ||
        (this.config && this.config.storefrontUrl) ||
        window.location.href;

      var lines = [];
      if (title) lines.push(title);
      lines.push(pageUrl);
      if (imageUrl && imageUrl !== pageUrl && imageUrl.indexOf("http") === 0) {
        lines.push("My virtual try-on: " + imageUrl);
      }

      var waUrl = "https://wa.me/?text=" + encodeURIComponent(lines.join("\n"));

      if (newWindow && !newWindow.closed) {
        newWindow.location.href = waUrl;
      } else {
        window.location.href = waUrl;
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // TRACKING
    // ══════════════════════════════════════════════════════════════════════

    trackAction: function (action) {
      if (!this.sessionId) return;
      var now = Date.now();
      if (this._lastTracked[action] && now - this._lastTracked[action] < 2000)
        return;
      this._lastTracked[action] = now;

      var shop = this.config.shop || window.location.hostname;
      var url =
        this.config.proxyUrl +
        "/session/track?shop=" +
        encodeURIComponent(shop);
      var body = JSON.stringify({ session_id: this.sessionId, action: action });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          url,
          new Blob([body], { type: "application/json" }),
        );
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    },

    // ══════════════════════════════════════════════════════════════════════
    // VARIANT HELPERS
    // ══════════════════════════════════════════════════════════════════════

    getSelectedVariant: function () {
      var variants = this.config.variants || [];

      // Prefer the variant explicitly chosen via option-group buttons
      if (this._selectedVariantId) {
        for (var k = 0; k < variants.length; k++) {
          if (String(variants[k].id) === String(this._selectedVariantId))
            return variants[k];
        }
      }

      var sel = document.getElementById("tryfit-variant-select");
      if (sel && sel.value) {
        for (var i = 0; i < variants.length; i++) {
          if (String(variants[i].id) === String(sel.value)) return variants[i];
        }
      }

      var pageId = this._getPageVariantId();
      if (pageId) {
        for (var j = 0; j < variants.length; j++) {
          if (String(variants[j].id) === String(pageId)) return variants[j];
        }
      }

      return variants[0] || null;
    },

    _getPageVariantId: function () {
      var el =
        document.querySelector('[name="id"][data-variant-id]') ||
        document.querySelector('form[action*="/cart/add"] [name="id"]') ||
        document.querySelector('[name="id"]');
      return el ? el.value : null;
    },

    getVariantMapping: function (variantId) {
      return (this.config.clothingImages || {})[String(variantId)] || null;
    },

    // Returns the clothing image URL for a given variant using the same
    // priority chain as runTryOn: admin mapping → variant image → product image.
    _getClothingImageForVariant: function (variant) {
      if (!variant) return null;
      var mapping = this.getVariantMapping(variant.id);
      if (mapping && mapping.tryon_image_url) return mapping.tryon_image_url;
      var fi = variant.featured_image || variant.image;
      if (fi && fi.src) return fi.src;
      return this.config.featuredImage || null;
    },

    // Re-runs the try-on on the result step using the stored avatar image and a
    // new clothing image (called when the user picks a variant with a different image).
    _rerunTryOnForVariant: function (variant, clothingImage) {
      if (this._tryOnInProgress) return;
      if (!this._lastAvatarBase64) return;

      var self = this;
      var avatarBase64 = this._lastAvatarBase64;

      this._tryOnInProgress = true;
      this._tryOnVariantId = variant.id;
      this._lastClothingImageUrl = clothingImage;

      if (clothingImage.indexOf("//") === 0) clothingImage = "https:" + clothingImage;

      this._showStep("processing");
      this.showProgress("FitSnap is creating your look…");

      this.startProgressAnimation(28);

      var controller = window.AbortController ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 95000) : null;
      var shop = self.config.shop || window.location.hostname;

      var opts = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clothing_image: clothingImage,
          avatar_image: avatarBase64,
          shopify_variant_id: variant.id,
          shopify_product_id: self.config.productId,
          session_id: self.sessionId,
        }),
      };
      if (controller) opts.signal = controller.signal;

      fetch(self.config.proxyUrl + "/api/tryon?shop=" + encodeURIComponent(shop), opts)
        .then(function (r) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!r.ok) {
            return r.json().catch(function () { return {}; }).then(function (errBody) {
              return Promise.reject(new Error(errBody.error || "Something went wrong. Please try again."));
            });
          }
          return r.json();
        })
        .then(function (data) {
          self._stopProgress();
          if (data.result_image) {
            self.showResult(data.result_image);
          } else {
            self.showError(data.error || "Try-on failed. Please try again.");
          }
        })
        .catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          self._stopProgress();
          var msg;
          if (err && err.name === "AbortError") {
            msg = "This is taking longer than expected. Please try again.";
          } else if (err && err.message && err.message.length < 200) {
            msg = err.message;
          } else {
            msg = "Something went wrong. Please try again.";
          }
          self.showError(msg);
          log("_rerunTryOnForVariant error:", err);
        });
    },

    // ── Result step: option groups + single Add to Cart CTA ─────────

    _renderResultVariantGrid: function () {
      var wrap = document.getElementById("tryfit-result-variant-selector");
      var optionGroups = document.getElementById("tryfit-option-groups");
      var variants = this.config.variants || [];
      var ctasEl = document.querySelector(".tryfit-result-ctas");
      var qtyPrRow = document.querySelector(".tryfit-qty-price-row");
      if (!wrap) return;

      wrap.innerHTML = "";
      if (optionGroups) optionGroups.innerHTML = "";

      if (variants.length <= 1) {
        if (ctasEl) ctasEl.style.display = "";
        if (qtyPrRow) qtyPrRow.style.display = "";
        if (optionGroups) optionGroups.style.display = "none";
        this._renderVariantSelect(variants);
        this._updateAddCartLabel();
        return;
      }

      if (ctasEl) ctasEl.style.display = "";
      if (qtyPrRow) qtyPrRow.style.display = "";
      if (optionGroups) optionGroups.style.display = "";
      this._renderVariantSelect(variants);
      this._renderOptionGroups(variants, optionGroups);
      this._updateAddCartLabel();
    },

    _renderVariantSelect: function (variants) {
      var sel = document.getElementById("tryfit-variant-select");
      if (!sel) {
        sel = document.createElement("select");
        sel.id = "tryfit-variant-select";
        sel.className = "tryfit-variant-select";
        sel.setAttribute("aria-hidden", "true");
        sel.style.display = "none";
        var parent = document.getElementById("tryfit-result-variant-selector");
        if (parent) parent.appendChild(sel);
        else document.body.appendChild(sel);
      }

      sel.innerHTML = "";
      // Prefer the variant that was actually used for this try-on; fall back to
      // whatever the product-page form currently says (or variants[0]).
      var preferredId = this._tryOnVariantId
        ? String(this._tryOnVariantId)
        : this._getPageVariantId();
      var activeId = null;
      for (var i = 0; i < variants.length; i++) {
        var opt = document.createElement("option");
        opt.value = String(variants[i].id);
        opt.textContent = variants[i].title || "Variant " + (i + 1);
        sel.appendChild(opt);
        if (String(variants[i].id) === String(preferredId))
          activeId = String(variants[i].id);
      }
      if (!activeId && variants.length) activeId = String(variants[0].id);
      if (activeId) sel.value = activeId;
      return activeId;
    },

    _renderOptionGroups: function (variants, container) {
      if (!container) return;
      var optionNames = Array.isArray(this.config.options)
        ? this.config.options.slice(0)
        : [];
      var optionValues = [];

      for (var i = 0; i < variants.length; i++) {
        for (var idx = 1; idx <= 3; idx++) {
          var value = variants[i]["option" + idx];
          if (value == null || value === "") break;
          optionValues[idx - 1] = optionValues[idx - 1] || [];
          if (optionValues[idx - 1].indexOf(value) === -1) {
            optionValues[idx - 1].push(value);
          }
        }
      }

      if (!optionValues.length) {
        container.style.display = "none";
        return;
      }

      for (i = 0; i < optionValues.length; i++) {
        optionNames[i] = optionNames[i] || "Option " + (i + 1);
      }

      var selectedVariant = this.getSelectedVariant() || variants[0];
      this._selectedOptions = [];
      for (i = 0; i < optionValues.length; i++) {
        this._selectedOptions[i] =
          selectedVariant["option" + (i + 1)] || optionValues[i][0];
      }

      container.innerHTML = "";
      var self = this;
      for (i = 0; i < optionValues.length; i++) {
        (function (groupIndex) {
          var group = document.createElement("div");
          group.className = "tryfit-option-group";

          var label = document.createElement("div");
          label.className = "tryfit-option-group__label";
          label.textContent =
            optionNames[groupIndex] || "Option " + (groupIndex + 1);
          group.appendChild(label);

          var valuesWrap = document.createElement("div");
          valuesWrap.className = "tryfit-option-values";

          optionValues[groupIndex].forEach(function (value) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "tryfit-option-value";
            btn.textContent = value;
            btn.dataset.optionIndex = String(groupIndex);
            btn.dataset.optionValue = value;
            btn.addEventListener("click", function () {
              self._selectedOptions[groupIndex] = value;
              self._selectVariantByOptions(self._selectedOptions);
            });
            valuesWrap.appendChild(btn);
          });

          group.appendChild(valuesWrap);
          container.appendChild(group);
        })(i);
      }

      this._updateOptionSelection();
    },

    _selectVariantByOptions: function (selectedOptions) {
      var variants = this.config.variants || [];
      var match = null;
      for (var i = 0; i < variants.length; i++) {
        var variant = variants[i];
        var ok = true;
        for (var j = 0; j < selectedOptions.length; j++) {
          if (
            String(variant["option" + (j + 1)]) !== String(selectedOptions[j])
          ) {
            ok = false;
            break;
          }
        }
        if (ok) {
          match = variant;
          break;
        }
      }
      if (match) {
        this._selectedVariantId = match.id; // shared state consumed by cart + buy-now
        var sel = document.getElementById("tryfit-variant-select");
        if (sel) sel.value = String(match.id);
        this._updateOptionSelection();
        this._updatePriceDisplay();
        this._updateAddCartLabel();

        // If the user is viewing a result and the new variant has a different
        // clothing image, automatically regenerate the try-on result.
        var resultStep = document.getElementById("tryfit-step-result");
        var isOnResult = resultStep && resultStep.style.display !== "none";
        if (isOnResult && this._lastAvatarBase64) {
          var newClothing = this._getClothingImageForVariant(match);
          if (newClothing && newClothing !== this._lastClothingImageUrl) {
            this._rerunTryOnForVariant(match, newClothing);
          }
        }
      }
    },

    _updateOptionSelection: function () {
      var buttons = document.querySelectorAll(".tryfit-option-value");
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var optionIndex = Number(btn.dataset.optionIndex);
        var optionValue = btn.dataset.optionValue;
        if (
          this._selectedOptions &&
          String(this._selectedOptions[optionIndex]) === String(optionValue)
        ) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      }
    },

    _updateAddCartLabel: function () {
      var btn = document.getElementById("tryfit-add-cart");
      var buyBtn = document.getElementById("tryfit-buy-now");
      if (!btn) return;

      var variant = this.getSelectedResultVariant();

      // Sold-out / unavailable variant
      if (variant && variant.available === false) {
        btn.textContent = "Sold Out";
        btn.disabled = true;
        if (buyBtn) { buyBtn.textContent = "Sold Out"; buyBtn.disabled = true; }
        return;
      }

      // Re-enable if a previous selection was sold out
      btn.disabled = false;
      if (buyBtn && !this._buyingNow) { buyBtn.textContent = "Buy Now"; buyBtn.disabled = false; }

      var price = variant && variant.price;
      if (!price) {
        btn.textContent = "Add to Cart";
        return;
      }
      var total = price * (this._qty || 1);
      var currency = this.config.currency || "INR";
      try {
        var formatted = new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(total / 100);
        btn.textContent = "Add to cart • " + formatted;
      } catch (ignore) {
        btn.textContent =
          "Add to cart • " + currency + " " + (total / 100).toFixed(2);
      }
    },

    _variantById: function (id) {
      var variants = this.config.variants || [];
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === String(id)) return variants[i];
      }
      return null;
    },

    getSelectedResultVariant: function () {
      return this.getSelectedVariant();
    },

    // ── Countdown timer ──────────────────────────────────────────────────────

    _startCountdown: function (seconds) {
      this._stopCountdown();
      this._countdownSeconds = seconds;
      var self = this;

      var valueEl = document.getElementById("tryfit-countdown-value");
      function tick() {
        if (!valueEl) return;
        var m = Math.floor(self._countdownSeconds / 60);
        var s = self._countdownSeconds % 60;
        valueEl.textContent =
          (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
        if (self._countdownSeconds <= 0) {
          self._stopCountdown();
          var banner = document.getElementById("tryfit-countdown-banner");
          if (banner) banner.style.display = "none";
          return;
        }
        self._countdownSeconds--;
      }
      tick();
      this._countdownTimer = setInterval(tick, 1000);
    },

    _stopCountdown: function () {
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
    },

    // ── Coupon ───────────────────────────────────────────────────────────────

    _applyResultCoupon: function () {
      var s = this._settingsCache;
      var card = document.getElementById("tryfit-coupon-card");
      var codeEl = document.getElementById("tryfit-coupon-code");
      if (!card || !codeEl) return;
      if (s && s.coupon_code && String(s.coupon_code).trim()) {
        codeEl.textContent = String(s.coupon_code).trim().toUpperCase();
        card.style.display = "";
      } else {
        card.style.display = "none";
      }
    },

    _copyCoupon: function () {
      var codeEl = document.getElementById("tryfit-coupon-code");
      var code = codeEl ? codeEl.textContent.trim() : "";
      var copyBtn = document.getElementById("tryfit-copy-coupon");
      if (!code) return;

      var done = function () {
        if (copyBtn) {
          copyBtn.textContent = "Copied!";
          setTimeout(function () {
            if (copyBtn) copyBtn.textContent = "Copy";
          }, 2000);
        }
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(code)
          .then(done)
          .catch(function () {});
      } else {
        var ta = document.createElement("textarea");
        ta.value = code;
        ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          done();
        } catch (ignore) {}
        document.body.removeChild(ta);
      }
    },

    // ── Quantity ─────────────────────────────────────────────────────────────

    _changeQty: function (delta) {
      this._qty = Math.max(1, (this._qty || 1) + delta);
      var el = document.getElementById("tryfit-qty-display");
      if (el) el.textContent = String(this._qty);
      this._updatePriceDisplay();
    },

    // ── Price display ────────────────────────────────────────────────────────

    _updatePriceDisplay: function () {
      var el = document.getElementById("tryfit-price-display");
      if (!el) return;
      var variant = this.getSelectedResultVariant();
      var price = variant && variant.price;
      if (!price) {
        el.textContent = "";
        this._updateAddCartLabel();
        return;
      }
      var total = price * (this._qty || 1);
      var currency = this.config.currency || "INR";
      try {
        el.textContent = new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(total / 100);
      } catch (ignore) {
        el.textContent = currency + " " + (total / 100).toFixed(2);
      }
      this._updateAddCartLabel();
    },

    // ── Camera upload ────────────────────────────────────────────────────────

    _openCamera: function () {
      if (
        window.navigator.mediaDevices &&
        window.navigator.mediaDevices.getUserMedia
      ) {
        // Show the permission-request screen first — getUserMedia is only called
        // when the user explicitly taps "Allow Camera" inside the modal.
        this._resetCameraStep();
        this._showStep("camera");
      } else {
        this._openCameraFallback();
      }
    },

    // Reset the camera step back to the permission screen so it’s clean
    // on each open and after the stream is closed.
    _resetCameraStep: function () {
      var perm = document.getElementById("tryfit-camera-perm");
      var frame = document.getElementById("tryfit-camera-frame");
      var controls = document.getElementById("tryfit-camera-controls");
      var hint = document.getElementById("tryfit-camera-hint");
      var allowBtn = document.getElementById("tryfit-camera-allow-btn");
      if (perm) {
        perm.style.display = "";
      }
      if (frame) {
        frame.style.display = "none";
      }
      if (controls) {
        controls.style.display = "none";
      }
      if (hint) {
        hint.style.display = "none";
      }
      if (allowBtn) {
        allowBtn.textContent = "";
        allowBtn.disabled = false;
        allowBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Allow Camera';
      }
    },

    // Legacy fallback for browsers without getUserMedia.
    _openCameraFallback: function () {
      var inp = document.getElementById("tryfit-file-input");
      if (!inp) return;
      try {
        inp.value = "";
      } catch (ignore) {}
      inp.setAttribute(
        "capture",
        this._facingMode === "user" ? "user" : "environment",
      );
      this._lastFileTriggerAt = Date.now();
      this._filePickerActive = true;

      var self = this;
      function releaseCameraPickerMutex() {
        self._filePickerActive = false;
        self._lastFileTriggerAt = Date.now();
        document.removeEventListener("visibilitychange", onCameraPickerVisibility);
        clearTimeout(cameraPickerFailsafe);
      }
      function onCameraPickerVisibility() {
        if (!document.hidden) { releaseCameraPickerMutex(); }
      }
      document.addEventListener("visibilitychange", onCameraPickerVisibility);
      var cameraPickerFailsafe = setTimeout(releaseCameraPickerMutex, 30000);

      inp.click();
      setTimeout(function () {
        try {
          inp.removeAttribute("capture");
        } catch (ignore) {}
      }, 600);
    },

    // Called when the user taps "Allow Camera" — requests permission and starts stream.
    _openCameraStream: function () {
      var self = this;
      var allowBtn = document.getElementById("tryfit-camera-allow-btn");

      // Show "Requesting…" state on the button while the browser prompt is open
      if (allowBtn) {
        allowBtn.disabled = true;
        allowBtn.textContent = "Requesting…";
      }

      this._getCameraStream(this._facingMode)
        .then(function (stream) {
          self._cameraStream = stream;
          var video = document.getElementById("tryfit-camera-video");
          if (!video) {
            self._closeCameraStream();
            self._showStep("upload");
            return;
          }

          // Swap permission screen → viewfinder
          var perm = document.getElementById("tryfit-camera-perm");
          var frame = document.getElementById("tryfit-camera-frame");
          var controls = document.getElementById("tryfit-camera-controls");
          var hint = document.getElementById("tryfit-camera-hint");
          if (perm) perm.style.display = "none";
          if (frame) frame.style.display = "";
          if (controls) controls.style.display = "";
          if (hint) hint.style.display = "";

          video.srcObject = stream;
          if (self._facingMode === "user") {
            video.classList.add("tryfit-camera-video--mirror");
          } else {
            video.classList.remove("tryfit-camera-video--mirror");
          }
          video.play().catch(function () {});
        })
        .catch(function (err) {
          log("camera stream error:", err.name, err.message);
          self._cameraStream = null;

          // Re-enable the Allow button so the user can try again
          if (allowBtn) {
            allowBtn.disabled = false;
            allowBtn.innerHTML =
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Try Again';
          }

          var msg;
          if (
            err.name === "NotAllowedError" ||
            err.name === "PermissionDeniedError"
          ) {
            msg =
              "Camera access was blocked. Tap the camera or lock icon in your browser’s address bar, choose 'Allow', then tap 'Try Again'.";
          } else if (
            err.name === "NotFoundError" ||
            err.name === "DevicesNotFoundError"
          ) {
            msg = "No camera found on this device.";
            self._resetCameraStep();
            self._showStep("upload");
          } else if (err.name === "NotReadableError") {
            msg =
              "Camera is in use by another app. Close it, then tap 'Try Again'.";
          } else if (err.name === "OverconstrainedError") {
            msg =
              "Camera settings not supported. Please upload a photo instead.";
            self._resetCameraStep();
            self._showStep("upload");
          } else {
            msg =
              "Camera unavailable (" +
              (err.name || "unknown") +
              "). Please upload a photo instead.";
            self._resetCameraStep();
            self._showStep("upload");
          }
          self.showToast(msg, 7000);
        });
    },

    // Returns a Promise<MediaStream> for the given facingMode.
    _getCameraStream: function (facingMode) {
      return navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode || "environment",
          width: { ideal: 1280 },
          height: { ideal: 1024 },
        },
        audio: false,
      });
    },

    // Snapshot the current video frame → handlePhotoSelect.
    _captureFromCamera: function () {
      var video = document.getElementById("tryfit-camera-video");
      if (!video || !this._cameraStream) return;

      var captureBtn = document.getElementById("tryfit-camera-capture-btn");
      if (captureBtn) captureBtn.disabled = true;

      var w = video.videoWidth || 640;
      var h = video.videoHeight || 480;

      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(video, 0, 0, w, h); // non-mirrored real image

      this._closeCameraStream();

      var self = this;
      canvas.toBlob(
        function (blob) {
          if (captureBtn) captureBtn.disabled = false;
          if (!blob) {
            self._showStep("upload");
            self.showToast("Failed to capture photo. Please try again.");
            return;
          }
          var capturedFile = new File([blob], "camera-capture.jpg", {
            type: "image/jpeg",
          });
          self.handlePhotoSelect(capturedFile);
        },
        "image/jpeg",
        0.9,
      );
    },

    // Stop all camera tracks and release the video element.
    _closeCameraStream: function () {
      if (this._cameraStream) {
        var tracks = this._cameraStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          try {
            tracks[i].stop();
          } catch (ignore) {}
        }
        this._cameraStream = null;
      }
      var video = document.getElementById("tryfit-camera-video");
      if (video) {
        try {
          video.srcObject = null;
        } catch (ignore) {}
        video.pause();
      }
    },

    // Toggle between front and rear camera.
    _flipCamera: function () {
      var self = this;
      this._facingMode = this._facingMode === "user" ? "environment" : "user";
      this._closeCameraStream();

      var flipBtn = document.getElementById("tryfit-camera-flip-btn");
      if (flipBtn) flipBtn.disabled = true;

      this._getCameraStream(this._facingMode)
        .then(function (stream) {
          self._cameraStream = stream;
          var video = document.getElementById("tryfit-camera-video");
          if (video) {
            video.srcObject = stream;
            if (self._facingMode === "user") {
              video.classList.add("tryfit-camera-video--mirror");
            } else {
              video.classList.remove("tryfit-camera-video--mirror");
            }
            video.play().catch(function () {});
          }
          if (flipBtn) flipBtn.disabled = false;
        })
        .catch(function (err) {
          log("flip camera error:", err.name);
          // Revert facing mode on failure
          self._facingMode =
            self._facingMode === "user" ? "environment" : "user";
          if (flipBtn) flipBtn.disabled = false;
          self.showToast("Unable to switch camera.");
        });
    },

    // ── Image zoom overlay ───────────────────────────────────────────────────

    _zoomImage: function () {
      var img = document.getElementById("tryfit-result-img");
      if (!img || !img.src) return;

      var existing = document.getElementById("tryfit-zoom-overlay");
      if (existing && existing.parentNode)
        existing.parentNode.removeChild(existing);

      var zOverlay = document.createElement("div");
      zOverlay.id = "tryfit-zoom-overlay";
      zOverlay.setAttribute("role", "dialog");
      zOverlay.setAttribute(
        "aria-label",
        "Zoomed try-on result — click to close",
      );
      zOverlay.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "bottom:0",
        "z-index:2147483648",
        "background:rgba(0,0,0,0.96)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "cursor:zoom-out",
        "padding:16px",
        "box-sizing:border-box",
        "pointer-events:auto",
      ].join(";");

      var zImg = document.createElement("img");
      zImg.src = img.src;
      zImg.alt = "Zoomed try-on result";
      zImg.style.cssText =
        "max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;pointer-events:none;";

      zOverlay.appendChild(zImg);
      document.body.appendChild(zOverlay);

      zOverlay.addEventListener("click", function () {
        if (zOverlay.parentNode) zOverlay.parentNode.removeChild(zOverlay);
      });

      document.addEventListener("keydown", function onKey(e) {
        if (e.key === "Escape" || e.keyCode === 27) {
          if (zOverlay.parentNode) zOverlay.parentNode.removeChild(zOverlay);
          document.removeEventListener("keydown", onKey);
        }
      });
    },
  }; // end TryFit

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  function bootstrap() {
    if (TryFit._booted) {
      TryFit._onSectionLoad();
    } else {
      TryFit.init();
    }
  }

  // Run immediately if DOM is already available, otherwise wait
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  // Shopify Theme Editor events
  document.addEventListener("shopify:section:load", bootstrap);
  document.addEventListener("shopify:section:unload", function () {
    // Prevent the overlay from being removed with the section
    TryFit._ensureOverlayInBody();
  });
  document.addEventListener("shopify:block:select", bootstrap);

  // Expose globally for debugging and external integrations
  window.TryFit = TryFit;
})();
