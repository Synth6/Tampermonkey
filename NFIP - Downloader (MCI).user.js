// ==UserScript==
// @name         NFIP - Downloader (MCI)
// @namespace    https://github.com/Synth6/Tampermonkey
// @version      1.3.1
// @description  MCI Flood document downloader (NFIP). Clicks Print Documents then injects "Download Selected" into Document Contents bar. Names files: Policy - (their name minus policy) - Type - Date.
// @author       MCI / Ron
// @match        https://nationalgeneral.torrentflood.com/*
// @match        https://*.torrentflood.com/*
// @updateURL    https://raw.githubusercontent.com/Synth6/Tampermonkey/main/NFIP%20-%20Downloader%20(MCI).user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tampermonkey/main/NFIP%20-%20Downloader%20(MCI).user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var FLAG_KEY = '__mci_nfip_run_on_audit__';
  var BTN_ID = '__mci_nfip_download_selected__';

  function toast(msg) {
    try { console.log('[MCI NFIP]', msg); } catch (e) {}
    try { alert(msg); } catch (e2) {}
  }

  function cleanFileName(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDate(v) {
    var s = String(v || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(s)) return s;
    return '';
  }

  function escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getPolicyNumber() {
    var selectors = [
      ".display_value_PolicySummaryView_NFIPPolicyNum",
      ".display_value_PolicySummaryView_PolicyNum",
      ".display_value_PolicySummaryView_PolicyNumber",
      "[class*='PolicyNum']",
      "[id*='PolicyNum']",
      "[data-testid*='policy']",
      ".policyNumber",
      "#policyNumber"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.textContent) {
        var t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
    }
    return 'NoPolicy';
  }

  function isAuditPage() {
    return /\/Policy\/DocumentManagerAudit/i.test(location.pathname);
  }

  function setRunFlag() {
    try { sessionStorage.setItem(FLAG_KEY, '1'); } catch (e) {}
  }

  function consumeRunFlag() {
    try {
      var v = sessionStorage.getItem(FLAG_KEY);
      if (v) sessionStorage.removeItem(FLAG_KEY);
      return !!v;
    } catch (e) { return false; }
  }

  function findPrintDocumentsLink() {
    var a = document.querySelector('li[name="DocumentManagerAuditAction"] a[href*="DocumentManagerAudit"]');
    if (a) return a;

    a = document.querySelector('a[href*="/Policy/DocumentManagerAudit"]');
    if (a) return a;

    var as = document.querySelectorAll("a");
    for (var i = 0; i < as.length; i++) {
      var tx = as[i].textContent ? as[i].textContent.replace(/\s+/g, ' ').trim() : '';
      if (tx === "Print Documents") return as[i];
    }
    return null;
  }

  function goToAuditPage() {
    var a = findPrintDocumentsLink();
    if (!a) {
      toast('Could not find "Print Documents" link/button on this page.');
      return;
    }
    setRunFlag();
    try { a.click(); } catch (e) {}
  }

  function buttonAlreadyThere() {
    return !!document.getElementById(BTN_ID);
  }

  function findDocumentContentsTopBar() {
    var bars = document.querySelectorAll("div.top-bar");
    for (var i = 0; i < bars.length; i++) {
      var title = bars[i].querySelector(".top-bar-title");
      var txt = title && title.textContent ? title.textContent.replace(/\s+/g, ' ').trim() : '';
      if (/^Document Contents$/i.test(txt)) return bars[i];
    }
    return null;
  }

  function injectButton() {
    if (buttonAlreadyThere()) return;

    var topBar = findDocumentContentsTopBar();
    if (!topBar) return;

    var rightMenu = topBar.querySelector(".top-bar-right ul.menu");
    if (!rightMenu) return;

    var li = document.createElement("li");
    li.style.marginLeft = "10px";

    var btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Download Selected";
    btn.style.padding = "6px 12px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid #06b6d4";
    btn.style.cursor = "pointer";
    btn.style.background = "#bff7f6"; // aqua
    btn.style.fontWeight = "800";

    btn.onclick = function () {
      downloadSelected();
    };

    li.appendChild(btn);
    rightMenu.appendChild(li);
  }

  function getAuditTable() {
    return document.querySelector("table");
  }

  function getHeaderMap(table) {
    // Build map of column name -> index from THEAD
    var map = {};
    if (!table) return map;

    var headRow = table.querySelector("thead tr");
    if (!headRow) {
      // Sometimes they may omit thead; try first row in table
      headRow = table.querySelector("tr");
    }
    if (!headRow) return map;

    var ths = headRow.querySelectorAll("th");
    for (var i = 0; i < ths.length; i++) {
      var key = ths[i].textContent ? ths[i].textContent.replace(/\s+/g, ' ').trim().toLowerCase() : '';
      if (key) map[key] = i;
    }
    return map;
  }

  function getDataRows(table) {
    if (!table) return [];
    var rows = table.querySelectorAll("tbody tr");
    return rows && rows.length ? rows : [];
  }

  function extractRow(row, headerMap) {
    headerMap = headerMap || {};

    // selection checkbox on each row
    var sel = row.querySelector("input.IsSelected") ||
              row.querySelector("input[type='checkbox'][name*='.IsSelected']") ||
              row.querySelector("input[type='checkbox']");
    var checked = sel ? !!sel.checked : false;

    // name column link
    var nameCellIndex = (headerMap["name"] != null) ? headerMap["name"] : 3;
    var nameCell = row.cells && row.cells.length > nameCellIndex ? row.cells[nameCellIndex] : null;
    var a = nameCell ? nameCell.querySelector("a") : row.querySelector("a");

    var rawName = a && a.textContent ? a.textContent.replace(/\s+/g, ' ').trim() : "Document";
    var href = a && a.getAttribute ? a.getAttribute("href") : "";
    var link = href ? new URL(href, location.href).href : "";

    // type column
    var typeCellIndex = (headerMap["type"] != null) ? headerMap["type"] : 4;
    var typeCell = row.cells && row.cells.length > typeCellIndex ? row.cells[typeCellIndex] : null;
    var typeText = typeCell && typeCell.innerText ? typeCell.innerText.replace(/\s+/g, ' ').trim() : "";

    // received/created
    var receivedIdx = (headerMap["received on"] != null) ? headerMap["received on"] : 6;
    var createdIdx  = (headerMap["created on"]  != null) ? headerMap["created on"]  : 5;

    var received = "";
    var created = "";

    var rCell = row.cells && row.cells.length > receivedIdx ? row.cells[receivedIdx] : null;
    if (rCell && rCell.innerText) received = normalizeDate(rCell.innerText);

    var cCell = row.cells && row.cells.length > createdIdx ? row.cells[createdIdx] : null;
    if (cCell && cCell.innerText) created = normalizeDate(cCell.innerText);

    var date = received || created || "Date";

    return { checked: checked, rawName: rawName, typeText: typeText, date: date, link: link };
  }

  async function downloadSelected() {
    var table = getAuditTable();
    if (!table) { toast("Couldn't find the document table."); return; }

    var headerMap = getHeaderMap(table);
    var rows = getDataRows(table);
    if (!rows.length) { toast("No document rows found on this page."); return; }

    var picked = [];
    for (var i = 0; i < rows.length; i++) {
      var info = extractRow(rows[i], headerMap);
      if (info.checked) picked.push(info);
    }

    if (!picked.length) { toast("No files selected."); return; }

    var policyNum = getPolicyNumber();
    var polRe = new RegExp("^" + escapeRegExp(policyNum) + "\\s*[-_\\s]+", "i");

    for (var j = 0; j < picked.length; j++) {
      try {
        var info = picked[j];

        if (!info.link) { toast("Missing link for one item."); continue; }

        // Keep their file name, but remove ".pdf" and remove leading policy if present
        var base = String(info.rawName || "Document").replace(/\s+/g, ' ').trim();
        base = base.replace(/\.pdf$/i, '');
        base = base.replace(polRe, '');

        // Type
        var typePart = String(info.typeText || "").replace(/\s+/g, ' ').trim();
        if (!typePart) typePart = "Document";

        // Policy - base - Type - Date.pdf
        var fileName = cleanFileName(policyNum + " - " + base + " - " + typePart + " - " + info.date + ".pdf");

        var resp = await fetch(info.link, { credentials: "include" });
        var blob = await resp.blob();
        var url = URL.createObjectURL(blob);

        var a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.parentNode.removeChild(a);

        URL.revokeObjectURL(url);

        // small delay helps Chrome queue downloads reliably
        await new Promise(function (res) { setTimeout(res, 350); });
      } catch (e) {
        toast("Error downloading one item.");
        try { console.warn("[MCI NFIP] download error", e); } catch (e2) {}
      }
    }
  }

  function ensureInjectedWithObserver() {
    injectButton();

    var tries = 0;
    var maxTries = 120; // ~30s
    var t = setInterval(function () {
      tries++;
      injectButton();
      if (buttonAlreadyThere() || tries >= maxTries) clearInterval(t);
    }, 250);

    var mo = new MutationObserver(function () {
      injectButton();
    });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    setTimeout(function () { try { mo.disconnect(); } catch (e2) {} }, 30000);
  }

  function safeRun() {
    if (isAuditPage()) {
      ensureInjectedWithObserver();
      return;
    }
    goToAuditPage();
  }

  // Auto-run on audit page load if we navigated via button
  if (isAuditPage() && consumeRunFlag()) {
    ensureInjectedWithObserver();
  }

  // Master Menu triggers
  window.addEventListener('mci-flood-trigger', function (e) {
    try {
      if (e && e.detail && e.detail.eventName === "mci:flood-nfip") safeRun();
    } catch (err) {}
  });
  window.addEventListener("mci:flood-nfip", function () { safeRun(); });

  // Debug
  window.MCI_FLOOD_DOWNLOADER_RUN = safeRun;

})();
