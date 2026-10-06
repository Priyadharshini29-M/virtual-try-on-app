/**
 * Brix-TryOn Size Chart — standalone storefront widget.
 * Deliberately separate from tryon-widget.js: its own root element, its own
 * fetch, its own modal. Renders nothing if the merchant has the module off,
 * or this product has no chart assigned.
 *
 * Two display modes for the same chart, chosen automatically:
 *  - Any row has a non-empty matching rule → chat-style "Size Assistant"
 *    quiz (age → height/weight → recommended row), with the full table
 *    still reachable via "Tap to view full size chart".
 *  - No rules at all → the plain table only, no quiz.
 */
(function () {
  "use strict";

  function log() {
    if (window.FITFYCE_DEBUG) {
      console.log.apply(console, ["[Brix-TryOn SizeChart]"].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function hasAnyRules(chart) {
    return (chart.rules || []).some(function (r) {
      return r && Object.keys(r).some(function (k) { return r[k] !== null && r[k] !== undefined; });
    });
  }

  function buildTable(chart) {
    var table = document.createElement("table");
    table.className = "fitfyce-sc-table";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    (chart.columns || []).forEach(function (col) {
      var th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    (chart.rows || []).forEach(function (row) {
      var tr = document.createElement("tr");
      row.forEach(function (cell) {
        var td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    return table;
  }

  // ── Size Assistant matching ────────────────────────────────────────────────

  function findMatchIndex(chart, answers) {
    var rules = chart.rules || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r) continue;
      if (r.ageMin != null && answers.age != null && answers.age < r.ageMin) continue;
      if (r.ageMax != null && answers.age != null && answers.age > r.ageMax) continue;
      if (r.heightMin != null && answers.height != null && answers.height < r.heightMin) continue;
      if (r.heightMax != null && answers.height != null && answers.height > r.heightMax) continue;
      if (r.weightMin != null && answers.weight != null && answers.weight < r.weightMin) continue;
      if (r.weightMax != null && answers.weight != null && answers.weight > r.weightMax) continue;
      return i;
    }
    return -1;
  }

  // ── Chat UI ─────────────────────────────────────────────────────────────────

  function ChatController(body, chart) {
    this.body = body;
    this.chart = chart;
    this.answers = {};
  }

  ChatController.prototype.addBotMessage = function (text) {
    var msg = document.createElement("div");
    msg.className = "fitfyce-sc-msg fitfyce-sc-msg--bot";
    msg.textContent = text;
    this.body.appendChild(msg);
    this.scrollToBottom();
    return msg;
  };

  ChatController.prototype.addUserMessage = function (text) {
    var msg = document.createElement("div");
    msg.className = "fitfyce-sc-msg fitfyce-sc-msg--user";
    msg.textContent = text;
    this.body.appendChild(msg);
    this.scrollToBottom();
  };

  ChatController.prototype.scrollToBottom = function () {
    this.body.scrollTop = this.body.scrollHeight;
  };

  ChatController.prototype.clearInputRow = function () {
    var row = this.body.parentNode.querySelector(".fitfyce-sc-input-row");
    if (row) row.innerHTML = "";
    return row;
  };

  ChatController.prototype.start = function () {
    this.addBotMessage("Hi! I'll help you find the right size. First, what is your child's age (in years)?");
    this.renderAgeInput();
  };

  ChatController.prototype.renderAgeInput = function () {
    var self = this;
    var row = this.clearInputRow();
    if (!row) return;

    var input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.className = "fitfyce-sc-chat-input";
    input.placeholder = "Child's age in years";

    var send = document.createElement("button");
    send.type = "button";
    send.className = "fitfyce-sc-chat-send";
    send.textContent = "Send";

    var submit = function () {
      var age = parseFloat(input.value);
      if (isNaN(age)) return;
      self.answers.age = age;
      self.addUserMessage(age + " years old");
      self.addBotMessage("Great! Now enter your child's weight (kg) and height (cm) for the most accurate fit.");
      self.renderWeightHeightInput();
    };

    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    send.addEventListener("click", submit);

    row.appendChild(input);
    row.appendChild(send);
    input.focus();
  };

  ChatController.prototype.renderWeightHeightInput = function () {
    var self = this;
    var row = this.clearInputRow();
    if (!row) return;
    row.classList.add("fitfyce-sc-input-row--pair");

    var weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.className = "fitfyce-sc-chat-input";
    weightInput.placeholder = "Weight (kg)";

    var heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.className = "fitfyce-sc-chat-input";
    heightInput.placeholder = "Height (cm)";

    var send = document.createElement("button");
    send.type = "button";
    send.className = "fitfyce-sc-chat-send fitfyce-sc-chat-send--full";
    send.textContent = "Send Details";

    var submit = function () {
      var weight = parseFloat(weightInput.value);
      var height = parseFloat(heightInput.value);
      if (isNaN(weight) || isNaN(height)) return;
      self.answers.weight = weight;
      self.answers.height = height;
      row.classList.remove("fitfyce-sc-input-row--pair");
      self.addUserMessage("Weight: " + weight + " kg  Height: " + height + " cm");
      self.showResult();
    };

    weightInput.addEventListener("keydown", function (e) { if (e.key === "Enter") heightInput.focus(); });
    heightInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    send.addEventListener("click", submit);

    row.appendChild(weightInput);
    row.appendChild(heightInput);
    row.appendChild(send);
    weightInput.focus();
  };

  ChatController.prototype.showResult = function () {
    var self = this;
    var idx = findMatchIndex(this.chart, this.answers);
    var card = document.createElement("div");
    card.className = "fitfyce-sc-result";

    if (idx === -1) {
      card.innerHTML = "<p>We couldn't find an exact match for those numbers — take a look at the full chart below to compare manually.</p>";
    } else {
      var row = this.chart.rows[idx];
      var columns = this.chart.columns || [];
      var title = document.createElement("h4");
      title.textContent = "Recommended Size: " + row[0];
      card.appendChild(title);

      var list = document.createElement("div");
      list.className = "fitfyce-sc-result-list";
      for (var i = 1; i < columns.length; i++) {
        var line = document.createElement("div");
        line.className = "fitfyce-sc-result-row";
        var label = document.createElement("span");
        label.className = "fitfyce-sc-result-label";
        label.textContent = columns[i];
        var value = document.createElement("span");
        value.className = "fitfyce-sc-result-value";
        value.textContent = row[i];
        line.appendChild(label);
        line.appendChild(value);
        list.appendChild(line);
      }
      card.appendChild(list);
    }
    this.body.appendChild(card);

    var toggleLink = document.createElement("button");
    toggleLink.type = "button";
    toggleLink.className = "fitfyce-sc-toggle-full";
    toggleLink.textContent = "Tap to view full size chart:";
    toggleLink.addEventListener("click", function () {
      if (toggleLink.dataset.open === "1") return;
      toggleLink.dataset.open = "1";
      self.body.appendChild(buildTable(self.chart));
      self.scrollToBottom();
    });
    this.body.appendChild(toggleLink);

    var restart = this.addBotMessage("Need to check another size? Enter the child's age again below.");
    this.scrollToBottom();
    this.renderAgeInput();
    return restart;
  };

  // ── Modal shell ─────────────────────────────────────────────────────────────

  function openModal(chart) {
    var backdrop = document.createElement("div");
    backdrop.className = "fitfyce-sc-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", chart.name || "Size chart");

    var modal = document.createElement("div");
    modal.className = "fitfyce-sc-modal";

    var head = document.createElement("div");
    head.className = "fitfyce-sc-head";
    var title = document.createElement("h3");
    title.textContent = hasAnyRules(chart) ? "Size Assistant" : (chart.name || "Size Chart");
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "fitfyce-sc-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    head.appendChild(title);
    if (!hasAnyRules(chart)) {
      var unit = document.createElement("span");
      unit.className = "fitfyce-sc-unit";
      unit.textContent = "in " + (chart.unit === "cm" ? "centimeters" : "inches");
      head.appendChild(unit);
    }
    head.appendChild(closeBtn);

    var body = document.createElement("div");
    body.className = "fitfyce-sc-body";

    modal.appendChild(head);
    modal.appendChild(body);

    if (hasAnyRules(chart)) {
      var chatBody = document.createElement("div");
      chatBody.className = "fitfyce-sc-chat-body";
      body.appendChild(chatBody);

      var inputRow = document.createElement("div");
      inputRow.className = "fitfyce-sc-input-row";
      modal.appendChild(inputRow);

      var chat = new ChatController(chatBody, chart);
      chat.start();
    } else {
      body.appendChild(buildTable(chart));
    }

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    var close = function () {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.removeEventListener("keydown", onKey);
    };
    var onKey = function (e) {
      if (e.key === "Escape") close();
    };
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", onKey);
  }

  function injectLink(chart) {
    if (document.getElementById("fitfyce-size-chart-link")) return;

    var container =
      document.querySelector(".product-form__buttons") ||
      document.querySelector(".product__submit") ||
      document.querySelector("[data-product-form]") ||
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector(".product-form") ||
      document.querySelector(".product-single__meta") ||
      document.querySelector(".product__info-wrapper") ||
      document.querySelector(".product__info");

    if (!container) return;

    var link = document.createElement("button");
    link.type = "button";
    link.id = "fitfyce-size-chart-link";
    link.className = "fitfyce-sc-link";
    link.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16 16 3l5 5-13 13z"/><path d="m14.5 6.5 2 2M11 10l2 2M7.5 13.5l2 2"/></svg>' +
      "<span>Find Your Size</span>";
    link.addEventListener("click", function () {
      openModal(chart);
    });

    container.insertAdjacentElement("afterend", link);
  }

  function init() {
    var root = document.getElementById("fitfyce-size-chart-root");
    if (!root) return;

    var proxyUrl = root.dataset.proxyUrl;
    var shop = root.dataset.shop;
    var productId = root.dataset.productId;
    if (!proxyUrl || !shop || !productId) return;

    fetch(proxyUrl + "/api/size-chart?shop=" + encodeURIComponent(shop) + "&product_id=" + encodeURIComponent(productId))
      .then(function (res) {
        return res.ok ? res.json() : { chart: null };
      })
      .then(function (data) {
        if (data && data.chart) {
          injectLink(data.chart);
        } else {
          log("no chart for this product");
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
