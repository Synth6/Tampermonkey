// ==UserScript==
// @name         Beyond Floods - Downloader (MCI) - Simple
// @namespace    https://github.com/Synth6/Tampermonkey
// @version      3.1.0
// @description  Inject checkboxes + Select All + Download Selected into Beyond Floods Customer Documents page. Sequentially clicks the existing links (no fetch/blob).
// @match        https://natgen.beyondfloods.com/*
// @match        https://*.beyondfloods.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var STYLE_ID = '__mci_bf_style__';
  var TOOLBAR_ID = '__mci_bf_toolbar__';
  var RUNNING = false;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      .mci-bf-toolbar{
        display:flex; align-items:center; gap:12px;
        margin:10px 0 12px 0;
        padding:10px 12px;
        border:1px solid rgba(0,0,0,.15);
        border-radius:10px;
        background:#fff;
        box-shadow:0 6px 18px rgba(0,0,0,.08);
        max-width:980px;
      }
      .mci-bf-toolbar label{
        display:flex; align-items:center; gap:8px;
        font-weight:800; cursor:pointer;
      }
      .mci-bf-toolbar input[type="checkbox"]{ width:16px; height:16px; }
      .mci-bf-btn{
        background:#16a34a; color:#fff;
        border:1px solid rgba(0,0,0,.15);
        border-radius:10px;
        padding:8px 12px;
        font-weight:900;
        cursor:pointer;
      }
      .mci-bf-btn:disabled{ opacity:.55; cursor:not-allowed; }
      .mci-bf-status{
        font:12px/1.3 system-ui,Segoe UI,Arial;
        color:#0f172a;
        padding:6px 10px;
        border-radius:8px;
        background:#f1f5f9;
        flex:1;
        overflow:hidden;
        white-space:nowrap;
        text-overflow:ellipsis;
      }
      #documentsList li.mci-bf-row{
        display:flex; align-items:center; gap:10px;
        margin:6px 0;
      }
      #documentsList li.mci-bf-row input.mci-bf-item{
        width:16px; height:16px;
      }
    `;
    document.head.appendChild(st);
  }

  function setStatus(msg) {
    var el = $('#mci_bf_status');
    if (el) el.textContent = msg;
  }

  function getDocsList() {
    return $('#documentsList');
  }

  function getAnchors() {
    var ul = getDocsList();
    if (!ul) return [];
    return $all('li > a[href]', ul);
  }

  function injectCheckboxes() {
    var ul = getDocsList();
    if (!ul) return 0;

    var items = $all('li', ul);
    var injected = 0;

    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      if (li.getAttribute('data-mci-bf') === '1') continue;

      var a = $('a[href]', li);
      if (!a) continue;

      li.setAttribute('data-mci-bf', '1');
      li.classList.add('mci-bf-row');

      // preserve anchor
      li.innerHTML = '';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'mci-bf-item';
      li.appendChild(cb);
      li.appendChild(a);

      injected++;
    }
    return injected;
  }

  function injectToolbar() {
    var ul = getDocsList();
    if (!ul) return false;

    if (document.getElementById(TOOLBAR_ID)) return true;

    // place under the h3 if possible, otherwise right above the ul
    var container = ul.closest('.agent-all-docs-responsive') || ul.parentElement;
    var header = container ? $('h3', container) : null;

    var bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.className = 'mci-bf-toolbar';
    bar.innerHTML = `
      <label title="Toggle all file checkboxes">
        <input id="mci_bf_select_all" type="checkbox" />
        Select All
      </label>
      <button id="mci_bf_download" class="mci-bf-btn">Download Selected</button>
      <div id="mci_bf_status" class="mci-bf-status">Ready.</div>
    `;

    if (header && header.nextSibling) {
      header.parentNode.insertBefore(bar, header.nextSibling);
    } else {
      ul.parentNode.insertBefore(bar, ul);
    }

    // wire controls
    $('#mci_bf_select_all').addEventListener('change', function () {
      var checked = this.checked;
      var cbs = $all('#documentsList input.mci-bf-item');
      for (var i = 0; i < cbs.length; i++) cbs[i].checked = checked;
      setStatus(checked ? ('Selected ' + cbs.length + ' file(s).') : 'None selected.');
    });

    $('#mci_bf_download').addEventListener('click', function () {
      if (RUNNING) return;
      downloadSelected();
    });

    return true;
  }

  async function downloadSelected() {
    var ul = getDocsList();
    if (!ul) {
      setStatus('Documents list not found.');
      return;
    }

    var rows = $all('li[data-mci-bf="1"]', ul);
    var selected = [];
    for (var i = 0; i < rows.length; i++) {
      var cb = $('input.mci-bf-item', rows[i]);
      var a = $('a[href]', rows[i]);
      if (cb && cb.checked && a) selected.push(a);
    }

    if (!selected.length) {
      setStatus('No files selected.');
      return;
    }

    RUNNING = true;
    $('#mci_bf_download').disabled = true;
    setStatus('Starting downloads: ' + selected.length + ' file(s)…');

    // sequential clicks, slight delay between each
    for (var j = 0; j < selected.length; j++) {
      var a2 = selected[j];
      var href = a2.href;

      setStatus('(' + (j + 1) + '/' + selected.length + ') ' + (a2.textContent || 'Downloading…'));

      // Try to force download by programmatic click on a temp anchor
      // (If server sends Content-Disposition: attachment, this will download)
      var temp = document.createElement('a');
      temp.href = href;
      temp.target = '_blank'; // avoid navigating away
      temp.rel = 'noopener noreferrer';
      document.body.appendChild(temp);
      temp.click();
      temp.remove();

      await sleep(1200); // adjust if generation is slow
    }

    setStatus('Done. Triggered ' + selected.length + ' download(s).');
    $('#mci_bf_download').disabled = false;
    RUNNING = false;
  }

  async function waitForDocsAndInject() {
    ensureStyle();

    // wait up to ~25 seconds for #documentsList to appear (SPA / delayed render)
    var tries = 0;
    while (tries < 50) {
      var ul = getDocsList();
      if (ul) break;
      await sleep(500);
      tries++;
    }

    var ul2 = getDocsList();
    if (!ul2) {
      // no popups; just quietly stop
      console.warn('[MCI BeyondFloods] #documentsList not found (page may have different layout).');
      return;
    }

    injectToolbar();
    injectCheckboxes();
    setStatus('Ready. Check files then click Download Selected.');
  }

  // Trigger from Master Menu event (what you already use)
  window.addEventListener('mci:flood-beyond', function () {
    waitForDocsAndInject();
  });

  // Optional: auto-inject if you load the docs page directly
  // (comment this out if you only want master-menu trigger)
  if (location.pathname.toLowerCase().indexOf('/public/') === 0 || $('#documentsList')) {
    waitForDocsAndInject();
  }

})();