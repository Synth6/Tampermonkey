// ==UserScript==
// @name         Progressive - Commercial (MCI)
// @namespace    mci-tools
// @version      0.1.2
// @description  Progressive Commercial: copy "Policy - Doc - Date" to clipboard without breaking JS doc links. Triggered by MCI Master Menu.
// @match        https://clpolicy.foragentsonly.com/*
// @match        https://*.foragentsonly.com/Express/*
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  "use strict";

  const STATE_KEY = "__mci_prog_comm_active__";
  const HANDLERS_KEY = "__mci_prog_comm_handlers__";
  const EVENT_NAME = "mci:progressive-commercial";

  function toast(msg) {
    let el = document.getElementById("__mci_prog_comm_toast__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__mci_prog_comm_toast__";
      Object.assign(el.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: 2147483647,
        padding: "8px 12px",
        borderRadius: "10px",
        background: "#111",
        color: "#fff",
        border: "1px solid rgba(255,255,255,.15)",
        boxShadow: "0 6px 18px rgba(0,0,0,.35)",
        font: "12px/1.2 system-ui,Segoe UI,Arial",
        opacity: "0",
        transform: "translateY(6px)",
        transition: "opacity .18s, transform .18s",
        maxWidth: "80vw",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        overflow: "hidden",
        pointerEvents: "none"
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(6px)"; }, 1600);
  }

  async function copyToClipboard(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return true;
      }
    } catch (_) {}
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
    return false;
  }

  function normSpaces(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  function sanitizeFilePart(s) {
    // Windows-illegal: \ / : * ? " < > |
    return normSpaces(s)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+-\s+/g, " - ");
  }

  function getPolicyNumber() {
    const el = document.getElementById("activeAccountReferenceId");
    const raw = (el && el.textContent || "").trim();
    return raw || "UNKNOWN_POLICY";
  }

  function parseRowDate(tr) {
    const txt = normSpaces(tr.textContent);
    const m = txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return "UNKNOWN_DATE";
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${mm}-${dd}-${yyyy}`;
  }

  function findDocAnchors() {
    const out = [];
    const links = Array.from(document.querySelectorAll("table a"));
    for (const a of links) {
      const tr = a.closest("tr");
      if (!tr) continue;
      if (!/(\d{1,2})\/(\d{1,2})\/(\d{4})/.test(tr.textContent || "")) continue;
      const label = normSpaces(a.textContent);
      if (!label || label.length < 3) continue;
      out.push({ a, tr, label });
    }
    return out;
  }

  function attach() {
    if (window[STATE_KEY]) {
      toast("Progressive Commercial: already ON");
      return;
    }
    window[STATE_KEY] = true;

    const policy = getPolicyNumber();
    const items = findDocAnchors();

    if (!items.length) {
      toast("Prog Commercial: No document links found (open Policy Documents first).");
      return;
    }

    const handlers = [];
    window[HANDLERS_KEY] = handlers;

    items.forEach(({ a, tr, label }) => {
      // Visual cue only
      tr.style.outline = "2px solid rgba(255,165,0,.45)";

      // Capture-phase handler: copy name BEFORE Progressive JS runs
      const handler = async () => {
        const docLabel = sanitizeFilePart(label || "Document");
        const date = parseRowDate(tr);
        const filename = sanitizeFilePart(`${policy} - ${docLabel} - ${date}`);

        const ok = await copyToClipboard(filename);
        toast(ok ? `Copied: ${filename}` : "Clipboard blocked (click link again).");
        // IMPORTANT: do NOT preventDefault / stopPropagation
      };

      if (!a.__mciProgCommBound) {
        a.addEventListener("click", handler, true); // capture
        a.__mciProgCommBound = true;
        handlers.push({ a, tr, handler });
      }
    });

    toast(`Progressive Commercial ON (${items.length} docs). Click a document link to copy filename.`);
  }

  function detach() {
    const handlers = window[HANDLERS_KEY] || [];
    handlers.forEach(h => {
      try {
        h.a.removeEventListener("click", h.handler, true);
        h.a.__mciProgCommBound = false;
        h.tr.style.outline = "";
      } catch (_) {}
    });
    window[HANDLERS_KEY] = [];
    window[STATE_KEY] = false;
    toast("Progressive Commercial OFF");
  }

  window.addEventListener(EVENT_NAME, () => {
    if (!window[STATE_KEY]) attach();
    else toast("Progressive Commercial: already ON");
  });

  // Optional toggle hotkey: Alt+Shift+P
  document.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (e.altKey && e.shiftKey && k === "p") {
      if (window[STATE_KEY]) detach(); else attach();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

})();