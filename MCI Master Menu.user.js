// ==UserScript==
// @name         MCI Master Menu
// @namespace    mci-tools
// @version      5.7.1
// @description  MCI slide-out toolbox for carrier sites (QQ / Erie / NatGen / Progressive). Copy/Paste delegated to separate script.
// @match        https://app.qqcatalyst.com/*
// @match        https://*.qqcatalyst.com/*
// @match        https://portal.agentexchange.com/*
// @match        https://www.agentexchange.com/*
// @match        https://*.agentexchange.com/*
// @match        https://customerdatamanagement.agentexchange.com/*
// @match        https://natgenagency.com/*
// @match        https://*.natgenagency.com/*
// @match        https://www.gotfreefax.com/*
// @match        https://gotfreefax.com/*
// @match        https://natgen.beyondfloods.com/*
// @match        https://nationalgeneral.torrentflood.com/*
// @match        https://quoting.foragentsonly.com/*
// @match        https://www.foragentsonly.com/*
// @match        https://*.foragentsonly.com/*
// @match        https://*.apps.foragentsonly.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Master%20Menu.user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Master%20Menu.user.js
// ==/UserScript==

(function () {
    "use strict";
    const HOST = location.hostname.toLowerCase();
    const PAGE_WINDOW = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const IS_QQ = /qqcatalyst/.test(HOST);
    const IS_PROG = /quoting\.foragentsonly\.com/i.test(HOST) || /foragentsonly\.com/i.test(HOST);
    const IS_ERIE = /agentexchange\.com|portal\.agentexchange\.com|customerdatamanagement\.agentexchange\.com/.test(HOST);
    const IS_NG = /natgenagency\.com/.test(HOST);
    const IN_IFRAME = window.top !== window.self;
    // Only keep menu instances inside QQ iframes; Erie/NatGen modules inherit the parent menu instead.
    if (IN_IFRAME && !(IS_QQ || IS_PROG)) return;

    /***************
     * ENV / CONST *
     ***************/
    const HOST_ID = "mci-shadow-host";
    const MENU_ID = "mciSlideMenu";
    const TRIGGER_ID = "mciSlideTrigger";
    const TOGGLE_KEY = "m";

    /****************
     * UTIL (page)  *
     ****************/
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    const onlyDigits = v => String(v || "").replace(/\D/g, "");
    const splitPhone = v => { const d = onlyDigits(v); return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)]; };
    const splitSSN = v => { const d = onlyDigits(v); return [d.slice(0, 3), d.slice(3, 5), d.slice(5, 9)]; };
    const splitZIP = v => { const d = onlyDigits(v); return [d.slice(0, 5), d.slice(5, 9)]; };
    const splitDOB = v => { const d = onlyDigits(v); return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)]; };
    const fmtDOB = v => { const [mm, dd, yyyy] = splitDOB(v); return (mm && dd && yyyy) ? `${mm}/${dd}/${yyyy}` : ""; };
    const looksMasked = v => /[*]/.test(String(v || ""));

    function setInput(el, v, fire = true) {
        if (!el) return;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (fire && type !== "hidden") try { el.focus(); } catch { }
        if (el.tagName === "SELECT") {
            const norm = s => (s ?? "").toString().trim().toLowerCase();
            let idx = [...el.options].findIndex(o => norm(o.value) === norm(v));
            if (idx < 0) idx = [...el.options].findIndex(o => norm(o.text) === norm(v));
            if (idx >= 0) el.selectedIndex = idx; else el.value = v ?? "";
        } else {
            const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
            desc?.set ? desc.set.call(el, v ?? "") : (el.value = v ?? "");
        }
        if (fire) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("blur", { bubbles: true }));
        }
    }
    function getVal(el) {
        if (!el) return "";
        return el.tagName === "SELECT"
            ? (el.value || el.options[el.selectedIndex]?.value || "")
            : (el.value ?? el.textContent ?? "");
    }
    function firstVisibleSelector(selList) {
        for (const s of selList.split(",").map(x => x.trim()).filter(Boolean)) {
            const el = $(s);
            if (!el) continue;
            const type = (el.getAttribute("type") || "").toLowerCase();
            if (el.offsetParent !== null || type === "hidden") return el;
        }
        return null;
    }

    function triggerContactMapper(mode = "auto") {
        PAGE_WINDOW.dispatchEvent(new CustomEvent("mci-run-contact-mapper", {
            detail: { source: "mci-menu", mode }
        }));
    }

    /***********************
     * QQ-specific helpers *
     ***********************/
    const GLOBAL_STYLE_ID = "mci-global-style";
    const HIGHLIGHT_COLOR_KEY = "mci_row_highlight_color";
    const DEFAULT_ROW_COLOR = "#fffbcc";
    let fileNamesFixed = false;
    let pdfPopupObserver = null;

    function ensureGlobalStyles() {
        if (!document.head || document.getElementById(GLOBAL_STYLE_ID)) return;
        const st = document.createElement("style");
        st.id = GLOBAL_STYLE_ID;
        st.textContent = `
.mci-fileNameFixed{white-space:pre-line !important;overflow:visible !important;text-overflow:unset !important;}
`;
        document.head.appendChild(st);
    }

    function qqGetDownloadUrlFromRow(row, origin) {
        if (!row) return null;
        const ds = row.dataset || {};
        const id = ds.blobid || ds.blobId || ds.fileid || ds.fileId || ds.documentid || ds.documentId || ds.id;
        if (id) return `${origin}/FileUpload/DownloadFile/${id}?preview=true`;

        const cb = row.querySelector('input[type="checkbox"][name="MultiSelectRow"]');
        if (cb && cb.value) {
            if (/^[\\w-]+$/.test(cb.value)) {
                return `${origin}/FileUpload/DownloadFile/${cb.value}?preview=true`;
            }
            try {
                const u = new URL(cb.value, origin);
                const qid = u.searchParams.get("id");
                if (qid) return `${origin}/FileUpload/DownloadFile/${qid}?preview=true`;
                const m = u.pathname.match(/\/FileUpload\/DownloadFile\/([^/?#]+)/);
                if (m && m[1]) return `${origin}/FileUpload/DownloadFile/${m[1]}?preview=true`;
                return u.href;
            } catch { }
        }

        const anchor = row.querySelector('a[href*="/FileUpload/DownloadFile/"], a[href*="DownloadQuickFile"], a[href*="DownloadFile?"], a[href*="/Download/"]');
        if (anchor) {
            try {
                const u = new URL(anchor.getAttribute("href"), origin);
                const qid = u.searchParams.get("id");
                if (qid) return `${origin}/FileUpload/DownloadFile/${qid}?preview=true`;
                const m = u.pathname.match(/\/FileUpload\/DownloadFile\/([^/?#]+)/);
                if (m && m[1]) return `${origin}/FileUpload/DownloadFile/${m[1]}?preview=true`;
                return u.href;
            } catch { }
        }

        const idEl = row.querySelector("[data-blobid],[data-blob-id],[data-fileid],[data-documentid],[data-id]");
        if (idEl) {
            const iid = idEl.getAttribute("data-blobid")
                || idEl.getAttribute("data-blob-id")
                || idEl.getAttribute("data-fileid")
                || idEl.getAttribute("data-documentid")
                || idEl.getAttribute("data-id");
            if (iid) return `${origin}/FileUpload/DownloadFile/${iid}?preview=true`;
        }
        return null;
    }

    function qqGetCheckedBoxes() {
        const selectors = [
            '.DocumentsImagesListTemplateContainer input[name="MultiSelectRow"]:checked',
            'input[name="MultiSelectRow"]:checked',
            'input[type="checkbox"][name="MultiSelectRow"]:checked'
        ];
        for (const sel of selectors) {
            const boxes = Array.from(document.querySelectorAll(sel));
            if (boxes.length) return boxes;
        }
        return [];
    }

    function qqGetRowForCheckbox(cb) {
        return cb.closest(".TableRow, tr, .documents-row, .zebra-row, [data-row]") || cb.closest("*");
    }

    function addOpenPdfButtonToPopup() {
        const popup = document.querySelector('#preview.file-edit-popup');
        if (!popup || getComputedStyle(popup).display === "none") return;
        const img = popup.querySelector("img");
        if (!img || !/DownloadQuickFile/i.test(img.src || "")) return;
        if (popup.querySelector(".mci-open-popup-btn")) return;
        let id = "";
        try {
            id = new URL(img.src, location.origin).searchParams.get("id") || "";
        } catch { }
        if (!id) return;
        const btn = document.createElement("button");
        btn.textContent = "Open PDF in New Tab";
        btn.className = "mci-open-popup-btn";
        Object.assign(btn.style, {
            marginTop: "10px", display: "block", background: "#1f6feb", color: "#fff",
            padding: "8px 12px", border: "none", borderRadius: "6px", cursor: "pointer"
        });
        btn.addEventListener("click", () => window.open(`${location.origin}/FileUpload/DownloadFile/${id}?preview=true`, "_blank"));
        popup.appendChild(btn);
    }

    function startPdfPopupObserver() {
        if (!IS_QQ || pdfPopupObserver || !document.body || typeof MutationObserver === "undefined") return;
        pdfPopupObserver = new MutationObserver(() => addOpenPdfButtonToPopup());
        pdfPopupObserver.observe(document.body, { childList: true, subtree: true });
    }

    function smartOpenPdfs(notify) {
        const origin = location.origin;
        let attempts = 0;
        const tryOpen = () => {
            attempts++;
            const checked = qqGetCheckedBoxes();
            if (checked.length) {
                let opened = 0;
                checked.forEach(cb => {
                    const row = qqGetRowForCheckbox(cb);
                    const url = qqGetDownloadUrlFromRow(row, origin);
                    if (url) {
                        window.open(url, "_blank");
                        opened++;
                    }
                });
                if (opened) {
                    notify && notify(`Opened ${opened} PDF${opened > 1 ? "s" : ""} from selected rows.`);
                    return;
                }
            }
            const iframe = document.getElementById("iframePdf");
            if (iframe && /\/DownloadFile\//i.test(iframe.src || "")) {
                const url = iframe.src.startsWith("/") ? origin + iframe.src : iframe.src;
                window.open(url, "_blank");
                notify && notify("Opened PDF from iframe viewer.");
                return;
            }
            const popupImg = document.querySelector('#preview.file-edit-popup img');
            if (popupImg && /DownloadQuickFile/i.test(popupImg.src || "")) {
                try {
                    const id = new URL(popupImg.src, origin).searchParams.get("id");
                    if (id) {
                        window.open(`${origin}/FileUpload/DownloadFile/${id}?preview=true`, "_blank");
                        notify && notify("Opened PDF from popup viewer.");
                        return;
                    }
                } catch { }
            }
            const thumb = document.querySelector('.documentsImagesFlow img.content[data-blobid]');
            if (thumb) {
                const id = thumb.getAttribute("data-blobid");
                if (id) {
                    window.open(`${origin}/FileUpload/DownloadFile/${id}?preview=true`, "_blank");
                    notify && notify("Opened PDF from thumbnail.");
                    return;
                }
            }
            if (attempts < 8) {
                setTimeout(tryOpen, 350);
            } else {
                notify && notify("PDF not found. Try again after the document loads.");
            }
        };
        tryOpen();
    }

    function toggleFileNameFix() {
        fileNamesFixed = !fileNamesFixed;
        const targets = document.querySelectorAll(".ContactItem.FileName");
        targets.forEach(el => el.classList.toggle("mci-fileNameFixed", fileNamesFixed));
        return { active: fileNamesFixed, count: targets.length };
    }

    function rowHighlightHandler(ev) {
        ev.stopPropagation();
        const row = ev.currentTarget;
        const color = localStorage.getItem(HIGHLIGHT_COLOR_KEY) || DEFAULT_ROW_COLOR;
        const isOn = row.dataset.mciHighlighted === "true";
        if (isOn) {
            row.style.backgroundColor = "";
            row.dataset.mciHighlighted = "";
        } else {
            row.style.backgroundColor = color;
            row.dataset.mciHighlighted = "true";
        }
    }

    function attachRowHighlighter() {
        const rows = document.querySelectorAll('div.zebra-row.email-row, .search-results-row');
        rows.forEach(row => {
            row.style.cursor = "pointer";
            if (!row.dataset.mciRowListener) {
                row.addEventListener("click", rowHighlightHandler);
                row.dataset.mciRowListener = "1";
            }
        });
        return rows.length;
    }

    function updateHighlightedRows(color) {
        document.querySelectorAll('[data-mci-highlighted="true"]').forEach(row => {
            row.style.backgroundColor = color;
        });
    }


    /***************************
     * COPY/PASTE (delegated)  *
     ***************************/
    // Copy/Paste logic has been moved to a separate Tampermonkey script.
    // This menu only dispatches events that the separate script listens for:
    //   - window 'mci:copy'
    //   - window 'mci:paste'

    /**********************
     * SHADOW UI (menu)   *
     **********************/
    function mount() {
        let host = document.getElementById(HOST_ID);
        if (!host) {
            host = document.createElement("div");
            host.id = HOST_ID;
            Object.assign(host.style, {
                position: "fixed", top: "0", left: "0", width: "0", height: "0",
                zIndex: "2147483647"
            });
            document.documentElement.appendChild(host);
            host.attachShadow({ mode: "open" });
        }
        const root = host.shadowRoot;
        if (root.getElementById(MENU_ID)) return root;
        if (IS_QQ) ensureGlobalStyles();
        const storedRowColor = localStorage.getItem(HIGHLIGHT_COLOR_KEY) || DEFAULT_ROW_COLOR;
        if (IS_QQ && !localStorage.getItem(HIGHLIGHT_COLOR_KEY)) {
            localStorage.setItem(HIGHLIGHT_COLOR_KEY, storedRowColor);
        }

        root.innerHTML = `
<style>
  :host{ all:initial; }
  *, *::before, *::after{ box-sizing:border-box; }

  /* Edge Tab (click to open) */
  #${TRIGGER_ID}{
    position:fixed;
    top:50%;
    left:0;
    transform:translateY(-50%);
    width:18px;
    height:54px;
    z-index:2147483647;
    background:#0a5efa;
    color:#fff;
    border:none;
    border-radius:0 10px 10px 0;
    cursor:pointer;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:6px;
    padding:6px 0;
    opacity:.90;
    box-shadow:2px 0 10px rgba(0,0,0,.35);
    transition:opacity .15s ease, width .15s ease, background .15s ease, box-shadow .2s ease;
  }
  #${TRIGGER_ID}:hover{
    opacity:1;
    width:22px;
    background:#1e3a8a;
    box-shadow:3px 0 14px rgba(0,0,0,.45);
  }
  #${TRIGGER_ID}[data-open="1"]{
    opacity:.55;
  }

  .mci-tab-mark{
    width:14px;
    height:14px;
    border-radius:50%;
    background-size:contain;
    background-repeat:no-repeat;
    background-position:center;
  }
  .mci-tab-label{
    writing-mode:vertical-rl;
    transform:rotate(180deg);
    font:700 10px system-ui,Segoe UI,Arial;
    letter-spacing:.8px;
    opacity:.95;
    user-select:none;
  }

  #${MENU_ID}{
    position:fixed; top:0; left:-268px; width:268px; height:100vh;
    background:#1a1c22; color:#eef3ff; z-index:2147483646;
    padding-top:0px; box-shadow:2px 0 10px rgba(0,0,0,.55);
    transition:left .22s cubic-bezier(.2,.9,.2,1), box-shadow .22s ease, filter .22s ease;
    overflow-x:hidden; overflow-y:auto;
    font:13px system-ui,Segoe UI,Arial;
    will-change:left;
  }
  #${MENU_ID}[data-open="1"]{
    left:0 !important;
    filter:brightness(1.02);
  }

  .mci-section{ margin:10px 10px 6px; border:1px solid rgba(255,255,255,.06); border-radius:10px; background:#20232b; overflow:hidden; }
   .mci-head{
    background:#0f172a;
    color:#fff;
    padding:9px 12px;
    border-bottom:1px solid rgba(255,255,255,.08);
    display:flex;
    flex-direction:column;      /* stack rows */
    align-items:flex-start;
    gap:2px;
    font-weight:700;
    letter-spacing:.2px;
  }

  .mci-head-top{
    display:flex;
    align-items:center;
    gap:6px;
  }

  .mci-head-meta{
    display:flex;
    align-items:center;
    gap:6px;
    font-weight:600;
    font-size:12px;
  }

  .mci-close-btn{
    background:none;
    border:none;
    color:#f97373;
    cursor:pointer;
    font-size:14px;
    padding:0;
    margin:0;
  }

  .mci-close-btn:hover{
    color:#fecaca;
  }

  .mci-title{
    font-size:14px;
  }

  .mci-host{
    opacity:.75;
    font-weight:600;
    font-size:12px;
  }

  .mci-host{ opacity:.75; font-weight:600; font-size:12px }
  .mci-body{ padding:8px 10px }
  .mci-btn{ display:block; width:100%; margin:6px 0; padding:9px 10px; border-radius:8px;
    border:1px solid rgba(255,255,255,.12); background:#2a2f39; color:#fff; text-align:left;
    cursor:pointer; transition:transform .05s, background .15s; line-height:1.2; }
  .mci-btn:hover{ background:#394152 } .mci-btn:active{ transform:scale(.99) }
  .mci-btn.primary{ background:#1f6feb } .mci-btn.primary:hover{ background:#2b79f0 }
  .mci-btn.green{ background:#3ba55d } .mci-btn.green:hover{ background:#44b569 }
  .mci-btn.blue{ background:#2563eb } .mci-btn.blue:hover{ background:#2b6ef5 }
  .mci-btn.purple{ background:#7b68ee } .mci-btn.purple:hover{ background:#6c5ce7 }
  .mci-btn.gray{ background:#4b5563 } .mci-btn.gray:hover{ background:#374151 }
  .mci-btn.brand{ background:#1e40af } .mci-btn.brand:hover{ background:#1e3a8a }
  .mci-btn.aqua{ background:#32a8a2 } .mci-btn.aqua:hover{ background:#2c948f }

  /* Progressive split button (looks like one button, two actions) */
  .mci-split-btn{
    display:flex;
    width:100%;
    border-radius:8px;
    overflow:hidden;
    border:1px solid rgba(255,255,255,.12);
    padding: 0px;
    height: 37px;
  }
  .mci-split-btn.brand{ background:#1e40af; }
  .mci-split-btn.aqua{ background:#32a8a2; }
  .mci-split-half{
    flex:1;
    border:none;
    margin:0;
    background:transparent;
    color:#fff;
    text-align:center;
    cursor:pointer;
    font:inherit;
    line-height:1.2;
    transition:background .15s, transform .05s;
  }
  .mci-split-half:hover{ background:rgba(0,0,0,.18); }
  .mci-split-half:active{ transform:scale(.99); }
  .mci-split-divider{
    width:1px;
    background:rgba(255,255,255,.18);
  }


  .divider{ margin:12px 10px 10px; border-top:1px dashed rgba(255,255,255,.25); position:relative; height:0; }
  .divider::after{
    content:attr(data-label); position:absolute; left:50%; transform:translate(-50%,-55%);
    background:#1a1c22; padding:0 6px; color:#9fb4d8; font-size:11px; letter-spacing:.2px;
  }
  .badge{ display:inline-block; background:#334155; color:#e6eef8; border:1px solid rgba(255,255,255,.08);
          padding:3px 6px; border-radius:999px; font-size:11px; margin-left:6px }

  .mci-btn-pair{ display:flex; gap:8px; }
  .mci-btn-pair .mci-btn{ flex:1; margin:0; }

  /* small helper chips */
  .chip{ display:inline-block; padding:2px 6px; font-size:11px; border-radius:999px; background:#0b1220; border:1px solid #2c3442; color:#cfe2ff; }
  .qq-btn-stack{ display:flex; flex-direction:column; gap:8px; }
  .qq-row-controls{ display:flex; gap:8px; align-items:center; }
  .color-chip{ display:flex; flex-direction:column; align-items:center; gap:4px; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#9fb4d8; }
  .color-chip input[type="color"]{ width:26px; height:29px; border:none; padding:0; background:none; cursor:pointer; }
  .qqc-top-row{ display:flex; gap:10px; }
  .qqc-top-row .mci-btn{ flex:1; margin:0; }
  .mci-downloader{ display:flex; flex-direction:column; gap:8px; }
  .mci-downloader .mci-btn{ margin:0; }
  .mci-downloader-panel{ display:none; flex-direction:column; gap:8px; }
  .mci-downloader-panel.open{ display:flex; }
.mci-footer-note.shortcuts.v2{
  margin-top:10px; padding:10px; border-radius:10px;
  background:rgba(255,255,255,.06); color:#d0d6e2;
  font-size:12px; line-height:1.25;
}
.mci-footer-note.shortcuts.v2 .tip{ margin-bottom:6px; color:#c7cfdb; }

.mci-footer-note.shortcuts.v2 .group{
  display:flex; align-items:flex-start; gap:10px;
  margin:6px 0 0;
}

.mci-footer-note.shortcuts.v2 .kbd{
  flex:0 0 auto;
  font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  padding:2px 6px; border-radius:6px;
  background:rgba(255,255,255,.12); color:#fff; border:1px solid rgba(255,255,255,.15);
  letter-spacing:.3px; margin-top:1px;
}

.mci-footer-note.shortcuts.v2 .list{
  flex:1 1 auto; display:flex; flex-direction:column; gap:3px;
  max-width:100%; white-space:normal; word-break:break-word;
}

.mci-footer-note.shortcuts.v2 .list b{ color:#fff; }

</style>

<button id="${TRIGGER_ID}" type="button" title="MCI Toolbox" aria-label="Toggle MCI Toolbox">
<span class="mci-tab-mark" style="background-image:url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2230%22%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.16%22%2F%3E%3Cpath%20d%3D%22M16%2044V20h6l10%2014%2010-14h6v24h-6V30l-10%2014-10-14v14z%22%20fill%3D%22%23ffffff%22%2F%3E%3C%2Fsvg%3E')"></span> 
<span class="mci-tab-label">MCI</span>
</button>
<div id="${MENU_ID}">
  <div class="mci-head">
    <div class="mci-head-top">
      <button id="mci_remove_header" class="mci-close-btn" title="Remove Menu">❌</button>
      <span class="mci-title">MCI Toolbox</span>
    </div>
    <div class="mci-head-meta">
      <span class="badge">
        ${IS_QQ ? "QQ" : IS_ERIE ? "Erie" : IS_NG ? "NatGen" : location.hostname}
      </span>
      <span class="mci-host">${location.hostname}</span>
    </div>
  </div>

  ${IS_QQ ? `
  <div class="divider" data-label="QQ Helpers"></div>
  <div class="mci-section"><div class="mci-body qq-btn-stack">
    <button class="mci-btn primary" id="mci_pdf_open">📄 Open PDFs (Smart)</button>
    <button class="mci-btn purple" id="mci_fix_names">🧾Show Full File Names</button>
    <div class="qq-row-controls">
      <button class="mci-btn green" id="mci_row_highlight" style="flex:1">🟡 Row Highlighter</button>
      <label class="color-chip" for="mci_row_color">
        <span>Color</span>
        <input type="color" id="mci_row_color" value="${storedRowColor}">
      </label>
    </div>
  </div></div>
  ` : ''}

  <div class="divider" data-label="Cross-site tools"></div>
  <div class="mci-section"><div class="mci-body">
    <div class="mci-btn-pair">
      <button class="mci-btn blue"  id="mci_copy">✂️Copy</button>
      <button class="mci-btn green" id="mci_paste">📋Paste</button>
    </div>
  </div></div>

    <div class="divider" data-label="Quote Export"></div>
  <div class="mci-section"><div class="mci-body">
    <div class="mci-downloader">
      <button class="mci-btn blue" id="mci_export_toggle">🚗 Erie Export Quote ▸</button>
      <div class="mci-downloader-panel" id="mci_export_panel">
        <button class="mci-btn brand" id="mci_export_auto">Auto Quote</button>
        <button class="mci-btn brand" id="mci_export_home">Home Quote</button>
      </div>
    </div>
  </div></div>

  <div class="divider" data-label="File Downloader"></div>
  <div class="mci-section"><div class="mci-body">
    <div class="mci-downloader">
      <button class="mci-btn blue" id="mci_fd_toggle">📥 File Downloader ▸</button>
      <div class="mci-downloader-panel" id="mci_fd_panel">
        <button class="mci-btn purple" id="mci_fd_erie">Erie / NatGen</button>
        <div class="mci-split-btn brand" role="group" aria-label="Progressive Downloader">
          <button class="mci-split-half" id="mci_fd_prog_res" type="button" title="Trigger Progressive Residential downloader">Progressive Residential</button>
          <div class="mci-split-divider" aria-hidden="true"></div>
          <button class="mci-split-half" id="mci_fd_prog_com" type="button" title="Trigger Progressive Commercial downloader">Progressive Commercial</button>
        </div>
        <button class="mci-btn green" id="mci_fd_ncjua">NCJUA</button>
        <div class="mci-split-btn aqua" role="group" aria-label="NatGen Flood Downloader">
          <button class="mci-split-half" id="mci_fd_flood_beyond" type="button" title="Trigger Beyond Floods downloader">Beyond Floods</button>
          <div class="mci-split-divider" aria-hidden="true"></div>
          <button class="mci-split-half" id="mci_fd_flood_nfip" type="button" title="Trigger NFIP Flood downloader">NFIP Flood</button>
        </div>
      </div>
    </div>
  </div></div>

  <div class="divider" data-label="QQC Extractor"></div>
  <div class="mci-section"><div class="mci-body">
    <div class="qqc-top-row">
      <button class="mci-btn purple" id="mci_open_qqc">📂 Get Customer Data</button>
    </div>
  </div></div>

<div class="divider" data-label="Menu"></div>
<div class="mci-section"><div class="mci-body">
  <button class="mci-btn brand" id="mci_cashCenter">💵 Cash Payment Center</button>
  <button class="mci-btn brand" id="mci_fax">📠 Fax</button>
</div></div>

<div class="mci-footer-note shortcuts v2">
  <div class="tip">💡 <b>Tip:</b> Hover text, then press the key</div>

    <div class="group">
    <div class="list">
        <div><span class="kbd">ALT</span> + <span class="kbd">Right-Click</span><span><b>SMART LOOKUP</b></div></span>
        <div>Name → Address → Policy #</div>
    </div>
    </div>

  <div class="group">
    <span class="kbd">F10</span>
    <div class="list">
      <div><b>VIN LOOKUP</b> → NHTSA</div>
    </div>
  </div>
</div>

</div>
`;

        // Toast (outside shadow, floats above everything)
        const toast = (msg) => {
            let t = document.querySelector(".toast-mci");
            if (!t) {
                t = document.createElement("div");
                t.className = "toast-mci";
                Object.assign(t.style, {
                    position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
                    padding: "8px 12px", borderRadius: "10px", background: "#111", color: "#fff",
                    border: "1px solid rgba(255,255,255,.15)", boxShadow: "0 6px 18px rgba(0,0,0,.35)",
                    font: "12px/1.2 system-ui,Segoe UI,Arial", opacity: "0",
                    transform: "translateY(6px)", transition: "opacity .18s, transform .18s",
                    maxWidth: "60vw", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden"
                });
                document.documentElement.appendChild(t);
            }
            t.textContent = msg;
            requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
            clearTimeout(t._hideTimer);
            t._hideTimer = setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(6px)"; }, 1600);
        };

        const $s = sel => root.querySelector(sel);

        // Menu open/close helpers (click tab to toggle)
        const _menuEl = $s(`#${MENU_ID}`);
        const _tabEl  = $s(`#${TRIGGER_ID}`);

        function setMenuOpen(open) {
            if (_menuEl) {
                _menuEl.style.left = open ? "0" : "-268px";
                _menuEl.setAttribute("data-open", open ? "1" : "");
            }
            if (_tabEl) _tabEl.setAttribute("data-open", open ? "1" : "");
        }

        // Default closed (Alt+M still toggles)
        setMenuOpen(false);

        if (_tabEl) {
            _tabEl.addEventListener("click", () => {
                const isOpen = _menuEl && _menuEl.getAttribute("data-open") === "1";
                setMenuOpen(!isOpen);
            });
        }


        // QQ-only button handlers
        if (IS_QQ) {
            // Smart PDF opener
            $s('#mci_pdf_open')?.addEventListener('click', () => {
                // make sure we keep enhancing the preview popup
                startPdfPopupObserver();
                smartOpenPdfs(toast);
            });

            // Fix / un-fix file names in the attachment list
            $s('#mci_fix_names')?.addEventListener('click', () => {
                const res = toggleFileNameFix();
                if (!res.count) {
                    toast('No file name cells found on this page.');
                } else if (res.active) {
                    toast(`Showing full file names on ${res.count} cell(s).`);
                } else {
                    toast('File names returned to normal.');
                }
            });

            // Row highlighter
            $s('#mci_row_highlight')?.addEventListener('click', () => {
                const count = attachRowHighlighter();
                toast(
                    count
                        ? `Row highlighter active on ${count} row(s). Click a row to toggle.`
                        : 'No rows found to highlight on this page.'
                );
            });

            // Color picker for highlighted rows
            const colorInput = $s('#mci_row_color');
            if (colorInput) {
                colorInput.addEventListener('input', (e) => {
                    const color = e.target.value || DEFAULT_ROW_COLOR;
                    localStorage.setItem(HIGHLIGHT_COLOR_KEY, color);
                    updateHighlightedRows(color);
                    toast(`Highlight color set to ${color}.`);
                });
            }
        }
                $s("#mci_remove_header")?.addEventListener("click", () => {
            document.getElementById(HOST_ID)?.remove();
        });

        // File Downloader: expand/collapse
        $s('#mci_fd_toggle')?.addEventListener('click', () => {
            const panel = $s('#mci_fd_panel');
            if (!panel) return;
            panel.classList.toggle('open');
            const btn = $s('#mci_fd_toggle');
            if (btn) btn.textContent = panel.classList.contains('open')
                ? 'File Downloader ▾'
                : 'File Downloader ▸';
        });

                // Export Quote: expand/collapse
        $s('#mci_export_toggle')?.addEventListener('click', () => {
            const panel = $s('#mci_export_panel');
            if (!panel) return;
            panel.classList.toggle('open');
            const btn = $s('#mci_export_toggle');
            if (btn) btn.textContent = panel.classList.contains('open')
                ? '🚗 Export Quote ▾'
                : '🚗 Export Quote ▸';
        });

        /************************ menu button handler for Cash Payment Button *********************************/
        $s('#mci_cashCenter')?.addEventListener('click', () => {
            window.open(
                'https://script.google.com/macros/s/AKfycbyna22X-JzASUbS4pR6IdvPrtd_m_lYzUAXqbwxHAVBqYRHvkOCehY1uzY3wC_4gavu/exec',
                '_blank',
                'noopener,noreferrer'
            );
        });

        // === Fax button -> GotFreeFax (open or enhance) ===
        $s('#mci_fax')?.addEventListener('click', () => {
            const onSite = location.hostname.includes('gotfreefax.com');
            if (!onSite) {
                window.open('https://www.gotfreefax.com/', '_blank', 'noopener,noreferrer');
                return;
            }
            runFaxEnhancer();
        });

        // Wire actions: Copy/Paste mapper (unchanged)
        $s("#mci_copy")?.addEventListener("click", () => {
            window.dispatchEvent(new CustomEvent("mci:copy"));
            toast && toast("Copy requested…");
        });
        $s("#mci_paste")?.addEventListener("click", () => {
            window.dispatchEvent(new CustomEvent("mci:paste"));
            toast && toast("Paste requested…");
        });


        // Wire the File Downloader action buttons
        $s('#mci_fd_erie')?.addEventListener('click', () => {
            // collapse panel so the overlay you open isn't hidden behind the menu
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // run the Erie/NatGen row-click opener
            runErieNatGen();
        });

        $s('#mci_fd_prog_res')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // Trigger Progressive Residential downloader script (separate TM script)
            try {
                window.dispatchEvent(new CustomEvent('mci:progressive-residential'));
                // Back-compat with older residential listener (safe to keep)
                window.dispatchEvent(new CustomEvent('mci:progressive-downloader'));
                toast('Progressive Residential triggered.');
            } catch (e) {
                const ev1 = document.createEvent('Event');
                ev1.initEvent('mci:progressive-residential', true, true);
                window.dispatchEvent(ev1);
                const ev2 = document.createEvent('Event');
                ev2.initEvent('mci:progressive-downloader', true, true);
                window.dispatchEvent(ev2);
                toast('Progressive Residential triggered.');
            }
        });

        $s('#mci_fd_prog_com')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // Trigger Progressive Commercial downloader script (separate TM script)
            try {
                window.dispatchEvent(new CustomEvent('mci:progressive-commercial'));
                toast('Progressive Commercial triggered.');
            } catch (e) {
                const ev = document.createEvent('Event');
                ev.initEvent('mci:progressive-commercial', true, true);
                window.dispatchEvent(ev);
                toast('Progressive Commercial triggered.');
            }
        });

        $s('#mci_fd_ncjua')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // open the NCJUA mini-downloader UI
            runNCJUA();
        });


$s('#mci_fd_flood_beyond')?.addEventListener('click', () => {
    $s('#mci_fd_panel')?.classList.remove('open');
    $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
    // Trigger Beyond Floods downloader script (separate TM script)
    try {
        window.dispatchEvent(new CustomEvent('mci:flood-beyond'));
        toast('Beyond Floods triggered.');
    } catch (e) {
        const ev = document.createEvent('Event');
        ev.initEvent('mci:flood-beyond', true, true);
        window.dispatchEvent(ev);
        toast('Beyond Floods triggered.');
    }
});

$s('#mci_fd_flood_nfip')?.addEventListener('click', () => {
    $s('#mci_fd_panel')?.classList.remove('open');
    $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
    // Trigger NFIP Flood downloader script (separate TM script)
    try {
        window.dispatchEvent(new CustomEvent('mci:flood-nfip'));
        toast('NFIP Flood triggered.');
    } catch (e) {
        const ev = document.createEvent('Event');
        ev.initEvent('mci:flood-nfip', true, true);
        window.dispatchEvent(ev);
        toast('NFIP Flood triggered.');
    }
});


        // === Export Quote (Auto / Home) ===
        $s('#mci_export_auto')?.addEventListener('click', () => {
            const w = PAGE_WINDOW || window;
            try {
                if (w.mciRunErieAutoExport) {
                    w.mciRunErieAutoExport();
                } else if (w.top && w.top.mciRunErieAutoExport) {
                    w.top.mciRunErieAutoExport();
                } else {
                    toast('Auto export script not found on this page.');
                }
            } catch (e) {
                console.warn('[MCI Toolbox] Error calling Auto exporter', e);
                toast('Error starting Auto export – see console.');
            }
        });

        $s('#mci_export_home')?.addEventListener('click', () => {
            const w = PAGE_WINDOW || window;
            try {
                if (w.mciRunErieHomeExport) {
                    w.mciRunErieHomeExport();
                } else if (w.top && w.top.mciRunErieHomeExport) {
                    w.top.mciRunErieHomeExport();
                } else {
                    toast('Home export script not found on this page.');
                }
            } catch (e) {
                console.warn('[MCI Toolbox] Error calling Home exporter', e);
                toast('Error starting Home export – see console.');
            }
        });

        // Hand off to external QQC Contact Mapper script
        $s("#mci_open_qqc")?.addEventListener("click", () => {
            triggerContactMapper("auto");
        });

        return root;
    }

    // Hotkeys for the MENU (unchanged from your behavior)
    document.addEventListener("keydown", (e) => {
        const k = (e.key || "").toLowerCase();
        if (e.altKey && !e.shiftKey && k === 'q') {
            triggerContactMapper("auto");
            e.preventDefault();
            return;
        }
        if (e.altKey && !e.shiftKey && k === TOGGLE_KEY) {
            const root = mount();
            const menu = root.getElementById(MENU_ID);
            const tab = root.getElementById(TRIGGER_ID);
            const isOpen = (menu && menu.getAttribute("data-open") === "1");
            if (menu) {
                menu.style.left = isOpen ? "-268px" : "0";
                menu.setAttribute("data-open", isOpen ? "" : "1");
            }
            if (tab) tab.setAttribute("data-open", isOpen ? "" : "1");
            e.preventDefault();
        }
        if (e.altKey && e.shiftKey && k === TOGGLE_KEY) {
            document.getElementById(HOST_ID)?.remove();
            e.preventDefault();
        }
    }, true);

    /***************************************************************
     * Downloader menu
     ***************************************************************/
    // =============================== //
    // ======== ERIE/NATGEN ========== //
    // =============================== //

    function runErieNatGen() {
        const ID = '__carrierDownloader__';
        const MSG_ID = '__carrierDownloadMsg__';

        if (window[ID]) {
            window[ID].rows.forEach(row => {
                row.style.outline = '';
                row.removeEventListener('click', row._dlHandler);
            });
            document.getElementById(MSG_ID)?.remove();
            delete window[ID];
            return;
        }

        function showMessage(text) {
            let msg = document.createElement('div');
            msg.id = MSG_ID;
            msg.textContent = text;
            Object.assign(msg.style, {
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#222',
                color: '#fff',
                padding: '8px 14px',
                borderRadius: '6px',
                fontSize: '14px',
                zIndex: 99999,
                opacity: 0,
                transition: 'opacity 0.3s',
                pointerEvents: 'none'
            });
            document.body.appendChild(msg);
            requestAnimationFrame(() => {
                msg.style.opacity = 1;
            });
            setTimeout(() => {
                msg.style.opacity = 0;
                setTimeout(() => msg.remove(), 500);
            }, 1500);
        }

        function formatDate(dateStr) {
            const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            return match ? `${match[1]}-${match[2]}-${match[3]}` : dateStr;
        }

        function runNatGen() {
            const allRows = document.querySelectorAll('#ctl00_MainContent_PolicyHistoryControl2_dgPolicyHistory tr');
            const rows = [...allRows].filter(row => row.querySelector('.pdfButton'));

            rows.forEach(row => {
                row.style.outline = '2px solid orange';
                const handler = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    document.querySelectorAll('tr.__natgenActive__').forEach(r => {
                        r.classList.remove('__natgenActive__');
                        r.style.backgroundColor = '';
                    });
                    row.classList.add('__natgenActive__');
                    row.style.backgroundColor = '#fff8c6';

                    const tds = row.querySelectorAll('td');
                    const date = formatDate(tds[1]?.innerText.trim());
                    const activity = [...tds[2]?.querySelectorAll('p')].map(p => p.innerText.trim()).join(' ');
                    const policyNum = document.getElementById('ctl00_lblHeaderPageTitleTop')?.textContent.trim().replace(/\s+/g, '') || 'UnknownPolicy';
                    const filename = `${policyNum}_${activity} ${date}`.replace(/[\\/:*?"<>|]/g, '-');

                    navigator.clipboard.writeText(filename).catch(() => { });
                    row.querySelector('.pdfButton')?.click();
                    showMessage(`Opened PDF — filename copied: ${filename}`);
                };
                row.addEventListener('click', handler);
                row._dlHandler = handler;
            });

            window[ID] = {
                rows
            };
            showMessage('NatGen: Click a row to open PDF and copy filename');
        }

        function runErie() {
            const rows = [...document.querySelectorAll('tr')].filter(row =>
                row.querySelector('form[action*="/api/pdf/download"]') &&
                row.querySelector('.download-btn')
            );

            rows.forEach(row => {
                row.style.outline = '2px solid orange';
                const handler = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    document.querySelectorAll('tr.__erieActive__').forEach(r => {
                        r.classList.remove('__erieActive__');
                        r.style.backgroundColor = '';
                    });
                    row.classList.add('__erieActive__');
                    row.style.backgroundColor = '#fff8c6';

                    const form = row.querySelector('form[action*="/api/pdf/download"]');
                    const typeBtn = form?.querySelector('button.download-btn');
                    const label = row.querySelector('.info-label');
                    const tds = row.querySelectorAll('td');
                    const dateCell = [...tds].find(td => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(td.innerText));
                    const finalDate = dateCell ? formatDate(dateCell.innerText.trim()) : "";

                    const policyDropdown = document.querySelector('#policy-dropdown option:checked');
                    const policyText = policyDropdown?.textContent || '';
                    const match = policyText.match(/\((.*?)\)/);
                    const eriePolicy = match ? match[1].trim() : 'UnknownPolicy';

                    const filename = [
                        eriePolicy,
                        typeBtn?.innerText.trim() || '',
                        label?.innerText.trim() || '',
                        finalDate
                    ].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]/g, '-');

                    navigator.clipboard.writeText(filename).catch(() => { });
                    if (form) {
                        const clone = form.cloneNode(true);
                        clone.target = '_blank';
                        clone.style.display = 'none';
                        document.body.appendChild(clone);
                        clone.submit();
                        clone.remove();
                        showMessage(`Opened PDF — filename copied: ${filename}`);
                    } else {
                        showMessage("No PDF form found.");
                    }
                };
                row.addEventListener('click', handler);
                row._dlHandler = handler;
            });

            window[ID] = {
                rows
            };
            showMessage('Erie: Click a row to open PDF and copy filename');
        }

        if (document.querySelector('#ctl00_MainContent_PolicyHistoryControl2_dgPolicyHistory')) {
            runNatGen();
        } else if (document.querySelector('form[action*="/api/pdf/download"]')) {
            runErie();
        } else {
            showMessage("This page doesn't look like Erie or NatGen.");
        }
    }



    // ===================================== //
    // ============== NCJUA ================ //
    // ===================================== //

    function runNCJUA() {
        const box = document.createElement('div');
        box.id = '_ncjuaDownloader';
        Object.assign(box.style, {
            position: 'fixed',
            top: '20px',
            left: '20px',
            background: '#2b2b2b',
            color: '#fff',
            borderRadius: '8px',
            fontFamily: 'Arial',
            fontSize: '13px',
            width: '260px',
            zIndex: 999999,
            boxShadow: '0 0 10px #000',
            padding: '0'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 10px',
            background: '#444',
            fontWeight: 'bold',
            color: '#fff',
            borderTopLeftRadius: '8px',
            borderTopRightRadius: '8px',
            cursor: 'move'
        });

        const title = document.createElement('div');
        title.textContent = 'NCJUA Downloader';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '❌';
        Object.assign(closeBtn.style, {
            background: 'red',
            color: 'white',
            border: 'none',
            fontSize: '14px',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '2px 6px'
        });
        closeBtn.onclick = () => {
            document.body.removeChild(box);
            delete window._ncjuaDownloader;
        };

        header.appendChild(closeBtn);

        const content = document.createElement('div');
        Object.assign(content.style, {
            padding: '10px'
        });

        const createBtn = (label, fn) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            Object.assign(btn.style, {
                width: '100%',
                padding: '6px',
                margin: '5px 0',
                cursor: 'pointer',
                fontWeight: 'bold'
            });
            btn.onclick = fn;
            return btn;
        };

        const sanitize = txt => txt.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');

        const download = (url, filename) => {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };

        const parseDate = (cell) => {
            const raw = cell?.textContent?.trim() || '';
            const parts = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
            return parts ? `${parts[1]}-${parts[2]}-${parts[3]}` : raw.replace(/[\/:]/g, '-');
        };

        function getPolicyNumberForRow(row) {
            let el = row;
            while (el) {
                let ths = el.querySelectorAll?.('th.label') || [];
                for (const th of ths) {
                    if (th.textContent.includes('Policy:')) {
                        const match = th.textContent.match(/Policy:\s*([A-Z0-9\-]+)/);
                        if (match) return match[1];
                    }
                }
                if (el.previousElementSibling) {
                    el = el.previousElementSibling;
                } else {
                    el = el.parentElement;
                }
            }
            return 'UNKNOWN_POLICY';
        }

        const extractRows = () => {
            const rows = [];
            document.querySelectorAll('input[type="checkbox"][id^="Select_"]').forEach(cb => {
                if (cb.checked) {
                    const tr = cb.closest('tr');
                    const trNext = tr?.nextElementSibling;

                    const title = tr.querySelector('a.actionLink')?.textContent?.trim() || 'UNKNOWN';
                    let type = 'Doc';

                    if (trNext && trNext.innerText.includes('Template: Photos')) {
                        type = 'Photos';
                    } else if (/quote/i.test(title)) {
                        type = 'Quotes';
                    }

                    let href = null;

                    if (type === 'Photos') {
                        const img = tr.querySelector('img.thumbnailimg');
                        if (img && img.src.includes('Filename=')) {
                            const url = new URL(img.src, location.origin);
                            const filename = url.searchParams.get('Filename');
                            const rqid = url.searchParams.get('RqId');
                            const secid = url.searchParams.get('SecurityId');
                            if (filename && rqid && secid) {
                                // Construct full absolute URL for photo download
                                href = new URL(`/innovation?rq=STFile&Filename=${filename}&RqId=${rqid}&SecurityId=${secid}`, location.origin).href;
                            }
                        }
                    } else {
                        const link = tr.querySelector('a.actionLink[href*="innovation?rq=STFile"]');
                        if (link && !link.href.includes('void(0)')) {
                            href = link.href;
                        }
                    }

                    if (href) {
                        const dateCell = tr.querySelector('td[id^="DateTime"]');
                        const date = parseDate(dateCell);
                        rows.push({
                            href,
                            title,
                            type,
                            date,
                            rowElement: tr
                        });
                    }
                }
            });
            return rows;
        };

        const saveMappingFile = (entries) => {
            const text = entries.map(e => `${e.desiredName} ${e.type}`).join('\r\n');
            const blob = new Blob([text], {
                type: 'text/plain'
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'filenames.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };

        const handleDownload = () => {
            const entries = [];
            const rows = extractRows();
            let i = 0;

            function next() {
                if (i >= rows.length) {
                    saveMappingFile(entries);
                    return;
                }

                const file = rows[i++];
                const policy = getPolicyNumberForRow(file.rowElement);
                const ext = '.pdf';
                const desired = `${policy} - ${sanitize(file.title)} - ${file.date}${ext}`;
                const random = 'output_' + Math.random().toString(36).substring(2, 12) + ext;
                const fullUrl = file.href.startsWith('http') ? file.href : location.origin + file.href;

                download(fullUrl, random);
                entries.push({
                    desiredName: desired,
                    type: file.type
                });
                setTimeout(next, 1500);
            }

            next();
        };

        let copyMode = false;

        const statusMsg = document.createElement('div');
        statusMsg.style.color = 'lightgreen';
        statusMsg.style.fontSize = '12px';
        statusMsg.style.marginTop = '4px';
        statusMsg.style.textAlign = 'center';
        statusMsg.style.display = 'none';
        content.appendChild(statusMsg);

        content.appendChild(createBtn('📥 Download Selected Files', handleDownload));

        const toggleBtn = createBtn('🔴 Copy Mode Off', function () {
            copyMode = !copyMode;
            this.textContent = copyMode ? '🟢 Copy Mode On' : '🔴 Copy Mode Off';
            this.style.background = copyMode ? '#4caf50' : '';
            statusMsg.textContent = copyMode ? '📋 Copy mode is ON. Click a checkbox to copy filename.' : '';
            statusMsg.style.display = copyMode ? 'block' : 'none';
            if (copyMode) {
                setTimeout(() => statusMsg.style.display = 'none', 2500);
            }
        });
        content.appendChild(toggleBtn);

        // Clipboard copy logic when copyMode is active
        document.addEventListener('click', (e) => {
            if (!copyMode) return;

            const checkbox = e.target.closest('input[type="checkbox"][id^="Select_"]');
            if (checkbox && checkbox.checked) {
                const tr = checkbox.closest('tr');
                const title = sanitize(tr.querySelector('a.actionLink')?.textContent?.trim() || 'UNKNOWN');
                const dateCell = tr.querySelector('td[id^="DateTime"]');
                const date = parseDate(dateCell);
                const policy = getPolicyNumberForRow(tr);
                const filename = `${policy} - ${title} - ${date}.pdf`;

                navigator.clipboard.writeText(filename).then(() => {
                    statusMsg.textContent = '📋 Filename copied!';
                    statusMsg.style.display = 'block';
                    setTimeout(() => statusMsg.style.display = 'none', 3500);
                }).catch(() => {
                    statusMsg.textContent = '❌ Failed to copy!';
                    statusMsg.style.display = 'block';
                    setTimeout(() => statusMsg.style.display = 'none', 3500);
                });
            }
        }, true);


        // ============ Button to download rename-files.bat ====== ///

        const batContent = `
  @echo off
  setlocal enabledelayedexpansion

  set "fileList=filenames.txt"
  set "baseFolder=%CD%"
  set /a index=0

  if not exist "%fileList%" (
      echo ERROR: filenames.txt not found.
      pause
      exit /b
  )

  REM === Step 1: Read all lines from filenames.txt ===
  for /f "usebackq delims=" %%A in ("%fileList%") do (
      set /a index+=1
      set "line[!index!]=%%A"
  )

  REM === Step 2: Gather PDF files in oldest-to-newest order ===
  set /a fileIndex=0
  for /f "delims=" %%F in ('dir /b /a:-d /o:d *.pdf') do (
      if /I not "%%F"=="%~nx0" if /I not "%%F"=="%fileList%" (
          set /a fileIndex+=1
          set "pdf[!fileIndex!]=%%F"
      )
  )

  REM === Step 3: Process lines ===
  set /a i=1
  :processLoop
  if !i! GTR !index! goto done

  set "entry=!line[%i%]!"

  REM === Split off category (last word) ===
  for /f "tokens=* delims=" %%Z in ("!entry!") do (
      set "fullLine=%%Z"
  )

  for /f "tokens=1,* delims= " %%a in ("!fullLine!") do (
      set "firstWord=%%a"
      set "rest=%%b"
  )

  :stripLastWord
  for /f "tokens=1,* delims= " %%a in ("!rest!") do (
      if "%%b"=="" (
          set "category=%%a"
      ) else (
          set "firstWord=!firstWord! %%a"
          set "rest=%%b"
          goto :stripLastWord
      )
  )

  set "desiredName=!firstWord!"

  REM === Remove trailing .pdf just in case ===
  if /i "!desiredName:~-4!"==".pdf" (
      set "desiredName=!desiredName:~0,-4!"
  )

  REM === Extract full policy and split ===
  for /f "tokens=1 delims= " %%x in ("!desiredName!") do (
      set "policyFull=%%x"
  )

  for /f "tokens=1,2 delims=-" %%p in ("!policyFull!") do (
      set "policyBase=%%p"
      set "policySuffix=%%q"
  )

  REM === Clean up suffix ===
  set "policySuffix=!policySuffix: =!"

  REM === Make full folder path ===
  set "targetPath=%baseFolder%\!policyBase!\-!policySuffix!\!category!"
  if not exist "!targetPath!" mkdir "!targetPath!"

  REM === Get next file to move ===
  call set "fileToMove=%%pdf[%i%]%%"
  set "finalName=!desiredName!.pdf"
  set "finalPath=!targetPath!\!finalName!"

  REM === Add (1), (2), etc if file exists ===
  set "count=1"
  :checkExist
  if exist "!finalPath!" (
      set "finalPath=!targetPath!\!desiredName! (!count!).pdf"
      set /a count+=1
      goto :checkExist
  )

  if exist "!fileToMove!" (
      echo Moving !fileToMove! to !finalPath!
      move /Y "!fileToMove!" "!finalPath!" >nul
  ) else (
      echo WARNING: !fileToMove! not found
  )

  set /a i+=1
  goto processLoop

  :done
  echo.
  echo Done moving and renaming files.
  del "%fileList%"

  exit
  `.trim();

        const batBlob = new Blob([batContent], {
            type: 'application/octet-stream'
        });
        const batUrl = URL.createObjectURL(batBlob);
        const batLink = document.createElement('a');
        batLink.href = batUrl;
        batLink.download = 'NCJUA-file-renamer.bat';
        batLink.textContent = '📁 Download Renamer (.bat)';
        Object.assign(batLink.style, {
            display: 'inline-block',
            margin: '8px 0',
            padding: '6px',
            background: '#2196f3',
            color: '#fff',
            textAlign: 'center',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '13px',
            width: '95%'
        });
        content.appendChild(batLink);

        batLink.title =
            "📁 This downloads the NCJUA-file-renamer.bat script\n\n" +
            "📝 What it does:\n" +
            "- Renames each downloaded file using the list from filenames.txt\n" +
            "- Works with files downloaded using the NCJUA Downloader\n\n" +
            "⚠️ Make sure:\n" +
            "- This .bat file, the downloaded PDFs, and filenames.txt are all in the SAME folder\n" +
            "- Then double-click the .bat file to auto-rename your files!";

        box.appendChild(header);
        box.appendChild(content);
        document.body.appendChild(box);
        window._ncjuaDownloader = box;

        document.querySelectorAll('input[type="checkbox"][id^="Select_"]').forEach(cb => {
            cb.addEventListener('change', function () {
                if (copyMode && this.checked) {
                    const tr = this.closest('tr');
                    const policy = getPolicyNumberForRow(tr);
                    const title = sanitize(tr.querySelector('a.actionLink')?.textContent?.trim() || 'UNKNOWN');
                    const dateCell = tr.querySelector('td[id^="DateTime"]');
                    const date = parseDate(dateCell);
                    const line = `${policy} - ${title} - ${date}.pdf`;

                    navigator.clipboard.writeText(line).then(() => {
                        statusMsg.textContent = `📋 Copied: ${line}`;
                        statusMsg.style.display = 'block';
                        setTimeout(() => statusMsg.style.display = 'none', 3000);
                    }).catch(() => {
                        statusMsg.textContent = '❌ Failed to copy!';
                        statusMsg.style.display = 'block';
                        setTimeout(() => statusMsg.style.display = 'none', 3000);
                    });
                }
            });
        });

        let isDragging = false,
            offsetX, offsetY;
        header.addEventListener('mousedown', function (e) {
            isDragging = true;
            const rect = box.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });

        function move(e) {
            if (!isDragging) return;
            box.style.left = `${e.clientX - offsetX}px`;
            box.style.top = `${e.clientY - offsetY}px`;
            box.style.right = 'auto';
            box.style.bottom = 'auto';
        }

        function stop() {
            isDragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        }
    }

    // Boot the menu
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();



    // ------------------- Fax Script ------------------------
function runFaxEnhancer() {
        try {
            // tighten layout to just the free-fax sections
            const topRow = document.querySelector('.section-content > .row');
            if (topRow) topRow.classList.add('fax-only-row');

            const css = `
      nav,.footer-container,#premiumFaxContainer,#prepaidFaxContainer,#cjFaxContainer,
      [id="adContainer"],[data-pw-desk],[data-pw-mobi],.pw-tag,[id^="google_ads_iframe_"],
      iframe[src*="googlesyndication"],#leaderboard_atf,#leaderboard_btf,#pwMobiLbAtf,
      #pwMobiMedRectBtf1,#pw-oop-bottom_rail,#adBanner { display:none!important; }

      .fax-only-row>*{display:none!important}
      .fax-only-row>#senderContainer,
      .fax-only-row>#receiverContainer,
      .fax-only-row>#faxContainer,
      .fax-only-row>#freeFaxContainer { display:block!important }

      #freeFaxContainer>*{display:none!important}
      #freeFaxContainer>.form-content { display:block!important }
      #freeFaxContainer .sendFaxButtonContainer { display:block!important }
      #freeFaxContainer .containerHeading,
      #freeFaxContainer .infoBox,
      #freeFaxContainer .watermark { display:none!important }

      .fax-only-row{display:grid!important;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
      #senderContainer,#receiverContainer{width:100%!important}
      #faxContainer,#freeFaxContainer{grid-column:1/-1;width:100%!important}
      #senderContainer table,#receiverContainer table{width:100%!important;table-layout:fixed}
      #senderContainer td:first-child,#receiverContainer td:first-child{width:28%!important;white-space:nowrap;vertical-align:middle}
      #senderContainer td:last-child,#receiverContainer td:last-child{width:72%!important}
      .form-control-inline,input[type=text],input[type=email]{max-width:100%!important}
      #freeFaxContainer .sendFaxButtonContainer input[type=button]{width:100%!important;padding:12px 16px!important;font-size:18px!important;font-weight:600}
      body{background:#f6f7f9}
      .boxBorder .form-content{padding:12px!important}
    `;

            let style = document.getElementById('fax-only-style-scoped');
            if (!style) {
                style = document.createElement('style');
                style.id = 'fax-only-style-scoped';
                document.head.appendChild(style);
            }
            style.textContent = css;

            // kill late-loading ads a few times
            let tries = 0;
            (function killLateAds() {
                document.querySelectorAll(
                    '[id="adContainer"],[data-pw-desk],[data-pw-mobi],.pw-tag,[id^="google_ads_iframe_"],iframe[src*="googlesyndication"]'
                ).forEach(el => el.style.setProperty('display', 'none', 'important'));
                if (++tries < 20) setTimeout(killLateAds, 400);
            })();
        } catch (e) {
            console.warn('Fax enhancer error:', e);
        }
    }

    // Auto-run on GotFreeFax when loaded there
    if (location.hostname.includes('gotfreefax.com')) {
        try { runFaxEnhancer(); }
        catch (e) { console.warn('Fax enhancer error:', e); }
    }

})();
