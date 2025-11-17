// ==UserScript==
// @name         VIN F10 lookup
// @namespace    mci-tools
// @version      1.3
// @description  Press F10 to open NHTSA VIN Decoder. Prefers clipboard; also works with selection, inputs, hover, URL. PDF/local files get a paste-prompt fallback.
// @match        https://app.qqcatalyst.com/*
// @match        https://*.qqcatalyst.com/*
// @match        https://www.agentexchange.com/*
// @match        https://agentexchange.com/*
// @match        https://natgenagency.com/*
// @match        https://*.natgenagency.com/*
// @match        *://*/*
// @match        file://*/*
// @run-at       document-start
// @allFrames    true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Synth6/Tampermonkey/main/VIN%20F10%20lookup.user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tampermonkey/main/VIN%20F10%20lookup.user.js
// ==/UserScript==

(function() {
  "use strict";

  // --- Config ------------------------------------------------------
  const HOTKEY = "F10";
  const PREFER_CLIPBOARD_FIRST = true;     // ← set to false to try page-first
  const SHOW_TOASTS = true;

  const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/i; // excludes I,O,Q
  const NHTSA_DECODER_URL = (vin) =>
    `https://vpic.nhtsa.dot.gov/decoder/Decoder?Vin=${encodeURIComponent(vin)}&Decode=Submit`;

  // --- Hover tracking (HTML pages only) ----------------------------
  let lastHover = null;
  document.addEventListener("mousemove", (e) => { lastHover = e.target; }, { capture: true, passive: true });

  // --- Helpers -----------------------------------------------------
  function extractVinFromText(text) {
    if (!text) return null;
    const m = text.toUpperCase().match(VIN_RE);
    return m ? m[1] : null;
  }
  function getSelectionText() {
    const sel = window.getSelection && window.getSelection();
    return sel ? String(sel).trim() : "";
  }
  function attrMaybeVin(el, name) {
    const v = el?.getAttribute?.(name);
    return v ? extractVinFromText(v) : null;
  }
  function urlParamMaybeVin(href) {
    try {
      const u = new URL(href, location.origin);
      for (const [, v] of u.searchParams) {
        const vin = extractVinFromText(v);
        if (vin) return vin;
      }
      const fromPath = extractVinFromText(u.pathname);
      if (fromPath) return fromPath;
    } catch {}
    return null;
  }
  function findVinNear(node, maxHops = 5) {
    let cur = node, hops = 0;
    while (cur && hops <= maxHops) {
      const t = extractVinFromText(cur.textContent || "");
      if (t) return t;
      for (const a of ["data-vin", "title", "aria-label", "alt", "value"]) {
        const vv = attrMaybeVin(cur, a);
        if (vv) return vv;
      }
      if (cur.tagName === "A") {
        const href = cur.getAttribute("href");
        if (href) {
          const vinFromUrl = urlParamMaybeVin(href);
          if (vinFromUrl) return vinFromUrl;
        }
      }
      cur = cur.parentElement; hops++;
    }
    return null;
  }
  function isLikelyPdfTab() {
    const href = String(location.href);
    if (/\.pdf(?:$|\?)/i.test(href)) return true;
    try {
      const u = new URL(href);
      const src = u.searchParams.get("src") || u.searchParams.get("file");
      if (src && /\.pdf(?:$|\?)/i.test(src)) return true;
    } catch {}
    if (href.startsWith("file:///")) return true;
    return false;
  }
  function showPastePrompt(onSubmit) {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,.35)", zIndex: 2147483647,
      display: "flex", alignItems: "center", justifyContent: "center"
    });
    const box = document.createElement("div");
    Object.assign(box.style, {
      background: "#111", color: "#fff", padding: "14px 16px", borderRadius: "8px",
      boxShadow: "0 10px 24px rgba(0,0,0,.5)", width: "min(480px, 90vw)",
      font: "13px/1.4 system-ui, Segoe UI, Arial"
    });
    box.innerHTML = `
      <div style="font-weight:600; margin-bottom:8px;">Paste VIN (Ctrl+V) and press Enter</div>
      <input id="__vin_input__" type="text" spellcheck="false"
             style="width:100%; padding:8px; border-radius:6px; border:1px solid #444; background:#222; color:#fff" />
      <div style="opacity:.8; margin-top:6px">Tip: This fallback is for PDFs/local files where selection isn't exposed.</div>
    `;
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    const input = box.querySelector("#__vin_input__");
    input.focus();
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        document.body.removeChild(wrap);
        onSubmit(v);
      } else if (e.key === "Escape") {
        document.body.removeChild(wrap);
      }
    });
  }

  // --- Toast -------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ok = true) {
    if (!SHOW_TOASTS) return;
    let t = document.getElementById("__vin_toast__");
    if (!t) {
      t = document.createElement("div");
      t.id = "__vin_toast__";
      Object.assign(t.style, {
        position: "fixed", top: "18px", left: "50%", transform: "translateX(-50%)",
        padding: "8px 12px", font: "12px/1.3 system-ui, Segoe UI, Arial, sans-serif",
        color: "#fff", borderRadius: "6px", zIndex: 2147483647,
        boxShadow: "0 4px 12px rgba(0,0,0,.25)", transition: "opacity .2s ease-in-out", opacity: "0.95"
      });
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = ok ? "#2e7d32" : "#b00020";
    t.style.opacity = "0.95";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 1300);
  }

  function openVin(vin) {
    window.open(NHTSA_DECODER_URL(vin), "_blank");
    toast(`VIN: ${vin} → NHTSA`, true);
  }

  async function tryClipboard() {
    if (!navigator.clipboard?.readText) return null;
    try {
      const txt = await navigator.clipboard.readText();
      return extractVinFromText(txt);
    } catch {
      return null; // denied or unavailable
    }
  }

  // --- Hotkey ------------------------------------------------------
  document.addEventListener("keydown", async (e) => {
    if (e.key !== HOTKEY) return;

    // 0) Clipboard-first (optional)
    if (PREFER_CLIPBOARD_FIRST) {
      const vinFromClipboard0 = await tryClipboard();
      if (vinFromClipboard0) { e.preventDefault(); openVin(vinFromClipboard0); return; }
    }

    // 1) Selection
    const selected = getSelectionText();
    const vinFromSel = extractVinFromText(selected);
    if (vinFromSel) { e.preventDefault(); openVin(vinFromSel); return; }

    // 2) If typing area, use its value
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) {
      const vinFromField = extractVinFromText(e.target.value || "");
      if (vinFromField) { e.preventDefault(); openVin(vinFromField); return; }
    }

    // 3) Hover/nearby
    const target = lastHover || document.elementFromPoint?.(window.innerWidth/2, window.innerHeight/2) || document.body;
    const vinFromHover = findVinNear(target, 6);
    if (vinFromHover) { e.preventDefault(); openVin(vinFromHover); return; }

    // 4) Clipboard fallback (page-first mode)
    if (!PREFER_CLIPBOARD_FIRST) {
      const vinFromClipboard = await tryClipboard();
      if (vinFromClipboard) { e.preventDefault(); openVin(vinFromClipboard); return; }
    }

    // 5) URL
    const vinFromUrl = urlParamMaybeVin(location.href) || extractVinFromText(location.href);
    if (vinFromUrl) { e.preventDefault(); openVin(vinFromUrl); return; }

    // 6) PDF/local fallback: paste prompt
    if (isLikelyPdfTab()) {
      e.preventDefault();
      showPastePrompt((text) => {
        const vin = extractVinFromText(text);
        if (vin) openVin(vin);
        else toast("No 17-char VIN found in pasted text.", false);
      });
      return;
    }

    toast("No 17-char VIN found (copy it, then press F10).", false);
  }, true);

})();
