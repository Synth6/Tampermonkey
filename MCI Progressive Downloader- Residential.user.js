// ==UserScript==
// @name         MCI Progressive Downloader - Residential
// @namespace    https://middlecreekins.com/
// @version      1.7
// @description  Progressive bulk downloader helper. Injects checkboxes before Date, highlights rows, downloads selected. Copy button exports ONLY checked rows as: Policy - Title - M-D-YYYY (no "(PDF)") for BAT renaming.
// @author       Ron
// @match        https://policyservicing.apps.foragentsonly.com/app/documents-hub/*
// @match        https://policyservicing.apps.foragentsonly.com/app/policy-hub/*
// @match        https://www.foragentsonly.com/*
// @match        https://*.foragentsonly.com/*
// @match        https://*.apps.foragentsonly.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Progressive%20Downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Progressive%20Downloader.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ID_STYLE = '__mci_prog_dl_style__';
  const ID_BAR   = '__mci_prog_dl_bar__';

  // Runtime (kept minimal so it won't "ghost run")
  const R = (window.__mciProgDlRuntime__ = window.__mciProgDlRuntime__ || {
    active: false,
    mo: null
  });

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position = 'fixed';
    el.style.right = '14px';
    el.style.bottom = '14px';
    el.style.zIndex = '2147483647';
    el.style.background = 'rgba(17,24,39,0.95)';
    el.style.color = '#fff';
    el.style.padding = '8px 10px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    el.style.fontSize = '12px';
    el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.35)';
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1600);
  }

  // ---- Data helpers ----
  function getPolicyNumber() {
    const span = document.querySelector('pui-h3[data-pgr-id^="lblPolicyNumber"] span[translate="no"]');
    const t = clean(span ? span.textContent : '');
    if (t) return t;

    const h3 = document.querySelector('pui-h3[data-pgr-id^="lblPolicyNumber"]') ||
               document.querySelector('ps-policy-document-archive pui-h3');
    const txt = clean(h3 ? h3.textContent : '');
    const m = txt.match(/\b(\d{6,})\b/);
    return m ? m[1] : '';
  }

  function getDocLinks() { return $all('a[data-pgr-id^="lnkDisplayTitle"]'); }

  function getRowFromLink(link) {
    return link.closest('tr') || link.closest('[role="row"]') || link.closest('div');
  }

  function getDateSpan(row) {
    return row ? row.querySelector('span[data-pgr-id^="lblArchiveDate"]') : null;
  }

  function getRowDate(row) {
    const s = getDateSpan(row);
    const t = clean(s ? s.textContent : '');
    return (t && t !== '—') ? t : '';
  }

  function getRowTitle(row) {
    const link = row ? row.querySelector('a[data-pgr-id^="lnkDisplayTitle"]') : null;
    if (link) {
      const tEl = link.querySelector('.linkContainer') || link;
      return clean(tEl ? tEl.textContent : '');
    }
    const t2 = row ? row.querySelector('[data-pgr-id="lnkNoDisplayTitle"]') : null;
    return clean(t2 ? t2.textContent : '');
  }

  function getCheckbox(row) { return row ? row.querySelector('input.__mci_prog_cb') : null; }

  // ---- Formatting helpers ----
  function stripPdfTag(title) {
    return clean(title).replace(/\s*\(PDF\)\s*$/i, '');
  }

  function mmddyyToMDYYYY(s) {
    s = clean(s);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
    if (!m) return s.replace(/\//g, '-');
    const mm = String(parseInt(m[1], 10)); // remove leading 0
    const dd = String(parseInt(m[2], 10));
    let yy = m[3];
    if (yy.length === 2) yy = '20' + yy;   // assume 20xx
    return mm + '-' + dd + '-' + yy;
  }

  function sanitizeForFilenamePart(s) {
    // Keep it human-readable but safe for filenames / batch parsing
    s = clean(s);
    s = s.replace(/[\\\/:*?"<>|]/g, '-');
    s = s.replace(/\s+/g, ' ');
    return clean(s);
  }

  // ---- Style ----
  function ensureStyle() {
    if (document.getElementById(ID_STYLE)) return;
    const style = document.createElement('style');
    style.id = ID_STYLE;
    style.textContent = `
      .__mci_prog_active_row { outline:3px solid rgba(180,83,9,0.88)!important; outline-offset:-2px!important; border-radius:4px; }
      .__mci_prog_selected_row { background: rgba(245,158,11,0.12)!important; }
      .__mci_prog_cb { width:16px; height:16px; cursor:pointer; accent-color:#16a34a; }
      .__mci_prog_cb_wrap { display:inline-flex; align-items:center; justify-content:center; width:26px; margin-right:10px; }
      #${ID_BAR} { display:flex; gap:10px; align-items:center; padding:8px 12px; margin:6px 0 10px 0;
        border:1px solid rgba(203,213,225,0.9); border-radius:10px; background:rgba(248,250,252,0.92);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      #${ID_BAR} button { border-radius:10px; padding:6px 10px; font-weight:800; border:1px solid rgba(203,213,225,1);
        background:#fff; cursor:pointer; font-family:inherit; }
      #${ID_BAR} button.__mci_primary { border:0; color:#fff; background:#16a34a; }
    `;
    document.head.appendChild(style);
  }

  function markSelected(row, on) {
    if (!row) return;
    row.classList.toggle('__mci_prog_selected_row', !!on);
  }

  function clearActiveHighlight() {
    const links = getDocLinks();
    for (let i = 0; i < links.length; i++) {
      const r = getRowFromLink(links[i]);
      if (r) r.classList.remove('__mci_prog_active_row');
    }
  }

  // ---- Inject checkboxes before Date ----
  function ensureCheckboxes() {
    const links = getDocLinks();
    for (let i = 0; i < links.length; i++) {
      const row = getRowFromLink(links[i]);
      if (!row || getCheckbox(row)) continue;

      const dateSpan = getDateSpan(row);
      if (!dateSpan || !dateSpan.parentNode) continue;

      const wrap = document.createElement('span');
      wrap.className = '__mci_prog_cb_wrap';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = '__mci_prog_cb';
      cb.title = 'Select for download';

      wrap.appendChild(cb);
      dateSpan.parentNode.insertBefore(wrap, dateSpan);

      cb.addEventListener('change', () => markSelected(row, cb.checked));
    }
  }

  // ---- Bar ----
  function pickBarAnchor() {
    const links = getDocLinks();
    if (!links.length) return null;
    const row = getRowFromLink(links[0]);
    const table = row && row.closest('table');
    return table || (row && row.parentNode) || null;
  }

  function ensureBar() {
    const anchor = pickBarAnchor();
    if (!anchor || !anchor.parentNode) return false;
    if (document.getElementById(ID_BAR)) return true;

    const bar = document.createElement('div');
    bar.id = ID_BAR;
    bar.innerHTML = `
      <button type="button" id="__mci_prog_sel_all__">Select all</button>
      <button type="button" id="__mci_prog_clear__">Clear</button>
      <button type="button" class="__mci_primary" id="__mci_prog_dl__">Download selected</button>
      <button type="button" id="__mci_prog_copy__">Copy for BAT</button>
    `;
    anchor.parentNode.insertBefore(bar, anchor);

    $('#__mci_prog_sel_all__', bar).addEventListener('click', () => {
      ensureCheckboxes();
      let n = 0;
      const links = getDocLinks();
      for (let i = 0; i < links.length; i++) {
        const r = getRowFromLink(links[i]);
        const cb = r && getCheckbox(r);
        if (cb) { cb.checked = true; markSelected(r, true); n++; }
      }
      toast('Selected: ' + n);
    });

    $('#__mci_prog_clear__', bar).addEventListener('click', () => {
      ensureCheckboxes();
      const links = getDocLinks();
      for (let i = 0; i < links.length; i++) {
        const r = getRowFromLink(links[i]);
        const cb = r && getCheckbox(r);
        if (cb) cb.checked = false;
        markSelected(r, false);
      }
      clearActiveHighlight();
      toast('Cleared');
    });

    $('#__mci_prog_copy__', bar).addEventListener('click', async () => {
      ensureCheckboxes();
      const policy = sanitizeForFilenamePart(getPolicyNumber());
      if (!policy) { toast('Policy # not found'); return; }

      const lines = [];
      const links = getDocLinks();

      for (let i = 0; i < links.length; i++) {
        const r = getRowFromLink(links[i]);
        const cb = r && getCheckbox(r);
        if (!cb || !cb.checked) continue;

        let title = sanitizeForFilenamePart(stripPdfTag(getRowTitle(r)));
        const dateRaw = getRowDate(r);
        const date = sanitizeForFilenamePart(mmddyyToMDYYYY(dateRaw));

        if (!title) title = 'Document';
        if (!date) {
          // If no date exists, still output something deterministic
          lines.push(policy + ' - ' + title);
        } else {
          lines.push(policy + ' - ' + title + ' - ' + date);
        }
      }

      if (!lines.length) { toast('No rows selected'); return; }

      const text = lines.join('\n');

      try {
        await navigator.clipboard.writeText(text);
        toast('Copied ' + lines.length);
      } catch (e) {
        // fallback for sites that block clipboard API
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('Copied ' + lines.length); }
        catch (e2) { toast('Copy failed'); }
        document.body.removeChild(ta);
      }
    });

    $('#__mci_prog_dl__', bar).addEventListener('click', async () => {
      if (!R.active) { toast('Not active'); return; }
      ensureCheckboxes();
      await downloadSelected(1800);
    });

    return true;
  }

  // ---- Downloader ----
  async function downloadSelected(delayMs) {
    const links = getDocLinks();
    const items = [];

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const row = getRowFromLink(link);
      const cb = row && getCheckbox(row);
      if (cb && cb.checked) items.push({ link, row });
    }

    if (!items.length) { toast('No documents selected'); return; }

    toast('Downloading ' + items.length + '…');

    for (let i = 0; i < items.length; i++) {
      const row = items[i].row;
      const link = items[i].link;

      clearActiveHighlight();
      if (row) row.classList.add('__mci_prog_active_row');

      try { if (row) row.scrollIntoView({ block: 'center' }); } catch (e) {}
      await sleep(220);

      try { link.click(); } catch (e2) {}

      await sleep(delayMs);
    }

    clearActiveHighlight();
    toast('Done');
  }

  // ---- Activation ----
  async function activate() {
    ensureStyle();
    R.active = true;

    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (getDocLinks().length) break;
      await sleep(250);
    }
    if (!getDocLinks().length) {
      toast('No documents list found');
      R.active = false;
      return;
    }

    ensureBar();
    ensureCheckboxes();

    if (!R.mo) {
      let last = 0;
      R.mo = new MutationObserver(() => {
        if (!R.active) return;
        const now = Date.now();
        if (now - last < 300) return;
        last = now;
        if (!document.getElementById(ID_BAR)) ensureBar();
        ensureCheckboxes();
      });
      R.mo.observe(document.body, { childList: true, subtree: true });
    }

    toast('Progressive downloader ON');
  }

  function deactivate() {
    R.active = false;
    if (R.mo) { try { R.mo.disconnect(); } catch (e) {} R.mo = null; }
    const bar = document.getElementById(ID_BAR);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    clearActiveHighlight();
    toast('Progressive downloader OFF');
  }

  window.addEventListener('mci:progressive-downloader', () => {
    if (R.active) deactivate();
    else activate();
  });
})();
