/**
 * Brix-TryOn Complete Your Look — standalone storefront widget.
 * Deliberately separate from tryon-widget.js: its own root element, its own
 * fetch, its own DOM. Renders nothing if the merchant has the module off,
 * or this product has no styling ideas assigned.
 */
(function () {
  "use strict";

  function log() {
    if (window.FITFYCE_DEBUG) {
      console.log.apply(console, ["[Brix-TryOn CompleteLook]"].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function formatPrice(price, currency) {
    var n = parseFloat(price) || 0;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(n);
    } catch (e) {
      return (currency || "") + " " + n.toFixed(2);
    }
  }

  function buildCard(product, currency) {
    var a = document.createElement("a");
    a.className = "fitfyce-cl-card";
    a.href = "/products/" + product.handle;

    var imgWrap = document.createElement("div");
    imgWrap.className = "fitfyce-cl-img";
    if (product.image) {
      var img = document.createElement("img");
      img.src = product.image;
      img.alt = product.title;
      img.loading = "lazy";
      imgWrap.appendChild(img);
    }

    var title = document.createElement("span");
    title.className = "fitfyce-cl-title";
    title.textContent = product.title;

    var price = document.createElement("span");
    price.className = "fitfyce-cl-price";
    price.textContent = formatPrice(product.price, currency);

    a.appendChild(imgWrap);
    a.appendChild(title);
    a.appendChild(price);
    return a;
  }

  function buildRail(products, currency) {
    var section = document.createElement("section");
    section.className = "fitfyce-cl-section tryfit-app-block";

    var heading = document.createElement("h3");
    heading.className = "fitfyce-cl-heading";
    heading.textContent = "Styling ideas";
    section.appendChild(heading);

    var wrap = document.createElement("div");
    wrap.className = "fitfyce-cl-wrap";

    var track = document.createElement("div");
    track.className = "fitfyce-cl-track";
    products.forEach(function (p) {
      track.appendChild(buildCard(p, currency));
    });

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "fitfyce-cl-nav fitfyce-cl-nav--prev";
    prevBtn.setAttribute("aria-label", "Scroll left");
    prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "fitfyce-cl-nav fitfyce-cl-nav--next";
    nextBtn.setAttribute("aria-label", "Scroll right");
    nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

    var scrollBy = function (dir) {
      var cardWidth = track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 12 : 200;
      track.scrollBy({ left: dir * cardWidth * 2, behavior: "smooth" });
    };
    prevBtn.addEventListener("click", function () { scrollBy(-1); });
    nextBtn.addEventListener("click", function () { scrollBy(1); });

    wrap.appendChild(prevBtn);
    wrap.appendChild(track);
    wrap.appendChild(nextBtn);
    section.appendChild(wrap);

    return section;
  }

  function inject(products, currency) {
    if (document.getElementById("fitfyce-complete-look-rail")) return;

    var container =
      document.querySelector(".product__description") ||
      document.querySelector(".product-single__description") ||
      document.querySelector("[data-product-form]") ||
      document.querySelector(".product-form") ||
      document.querySelector(".product__info-wrapper") ||
      document.querySelector(".product__info") ||
      document.querySelector("main");

    if (!container) return;

    var rail = buildRail(products, currency);
    rail.id = "fitfyce-complete-look-rail";
    container.insertAdjacentElement("afterend", rail);
  }

  function init() {
    var root = document.getElementById("fitfyce-complete-look-root");
    if (!root) return;

    var proxyUrl = root.dataset.proxyUrl;
    var shop = root.dataset.shop;
    var productId = root.dataset.productId;
    var currency = root.dataset.currency;
    if (!proxyUrl || !shop || !productId) return;

    fetch(proxyUrl + "/api/complete-look?shop=" + encodeURIComponent(shop) + "&product_id=" + encodeURIComponent(productId))
      .then(function (res) {
        return res.ok ? res.json() : { products: [] };
      })
      .then(function (data) {
        var products = (data && data.products) || [];
        if (products.length > 0) {
          inject(products, currency);
        } else {
          log("no styling ideas for this product");
        }
      })
      .catch(function (err) {
        log("fetch failed", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
