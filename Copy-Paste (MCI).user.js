// ==UserScript==
// @name         Copy Paste (MCI)
// @namespace    mci-tools
// @version      1.1
// @description  Copy/Paste profile engine for Erie / NatGen / Progressive. Triggered by MCI Master Menu via window events.
// @match        https://app.qqcatalyst.com/*
// @match        https://*.qqcatalyst.com/*
// @match        https://portal.agentexchange.com/*
// @match        https://www.agentexchange.com/*
// @match        https://agentexchange.com/*
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
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  "use strict";

  /****************
   * Toast (center)
   ****************/
  function toastCenter(msg, ms) {
    ms = ms || 2200;
    try {
      window.dispatchEvent(new CustomEvent("mci:toast", { detail: { msg: String(msg || "") } }));
    } catch (_) { /* ignore */ }

    let t = document.getElementById("mci-toast-center");
    if (!t) {
      t = document.createElement("div");
      t.id = "mci-toast-center";
      Object.assign(t.style, {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: "2147483647",
        padding: "12px 16px",
        borderRadius: "12px",
        background: "rgba(17,17,17,.92)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,.18)",
        boxShadow: "0 10px 30px rgba(0,0,0,.45)",
        font: "600 13px/1.25 system-ui,Segoe UI,Arial",
        maxWidth: "70vw",
        textAlign: "center",
        opacity: "0",
        transition: "opacity .18s, transform .18s",
        pointerEvents: "none",
        whiteSpace: "pre-wrap"
      });
      document.documentElement.appendChild(t);
    }

    t.textContent = String(msg || "");
    clearTimeout(t._hideTimer);

    requestAnimationFrame(function () {
      t.style.opacity = "1";
      t.style.transform = "translate(-50%, -50%) scale(1)";
    });

    t._hideTimer = setTimeout(function () {
      t.style.opacity = "0";
      t.style.transform = "translate(-50%, -50%) scale(.98)";
    }, ms);
  }

  /****************
   * UTIL (page)
   ****************/
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const onlyDigits = v => String(v || "").replace(/\D/g, "");
  const splitPhone = v => { const d = onlyDigits(v); return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)]; };
  const splitSSN = v => { const d = onlyDigits(v); return [d.slice(0, 3), d.slice(3, 5), d.slice(5, 9)]; };
  const splitZIP = v => { const d = onlyDigits(v); return [d.slice(0, 5), d.slice(5, 9)]; };
  const splitDOB = v => { const d = onlyDigits(v); return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)]; };
  const fmtDOB = v => { const p = splitDOB(v); return (p[0] && p[1] && p[2]) ? (p[0] + "/" + p[1] + "/" + p[2]) : ""; };
  const looksMasked = v => /[*]/.test(String(v || ""));

  function getVal(el) {
    if (!el) return "";
    if (el.tagName === "SELECT") {
      return el.value || (el.options[el.selectedIndex] ? el.options[el.selectedIndex].value : "") || "";
    }
    return (el.value != null ? el.value : (el.textContent || ""));
  }

  function firstVisibleSelector(selList) {
    const parts = String(selList || "").split(",").map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const el = $(parts[i]);
      if (!el) continue;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (el.offsetParent !== null || type === "hidden") return el;
    }
    return null;
  }

  function setInput(el, v, fire) {
    if (!el) return;
    fire = (fire !== false);

    const type = (el.getAttribute("type") || "").toLowerCase();
    if (fire && type !== "hidden") { try { el.focus(); } catch (_) { } }

    if (el.tagName === "SELECT") {
      const norm = s => (s == null ? "" : String(s)).trim().toLowerCase();
      let idx = -1;
      for (let i = 0; i < el.options.length; i++) {
        const o = el.options[i];
        if (norm(o.value) === norm(v)) { idx = i; break; }
      }
      if (idx < 0) {
        for (let j = 0; j < el.options.length; j++) {
          const o2 = el.options[j];
          if (norm(o2.text) === norm(v)) { idx = j; break; }
        }
      }
      if (idx >= 0) el.selectedIndex = idx;
      else el.value = (v == null ? "" : v);
    } else {
      try {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, (v == null ? "" : v));
        else el.value = (v == null ? "" : v);
      } catch (_) {
        try { el.value = (v == null ? "" : v); } catch (_) { }
      }
    }

    if (fire) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  }

  async function writeClipboard(text) {
    const s = String(text || "");
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch (_) {
      try { if (typeof GM_setClipboard === "function") { GM_setClipboard(s); return true; } } catch (_) { }
      return false;
    }
  }

  async function readClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch (_) {
      return "";
    }
  }

  async function withPostbackShield(fn) {
    const savedPostBack = window.__doPostBack;
    try { window.__doPostBack = function () { }; } catch (_) { }

    const blocker = e => e.stopImmediatePropagation();
    document.addEventListener("input", blocker, true);
    document.addEventListener("change", blocker, true);
    document.addEventListener("blur", blocker, true);

    try { return await fn(); }
    finally {
      document.removeEventListener("input", blocker, true);
      document.removeEventListener("change", blocker, true);
      document.removeEventListener("blur", blocker, true);
      try { window.__doPostBack = savedPostBack; } catch (_) { }
    }
  }

  /***************************
   * COPY/PASTE PROFILES
   ***************************/
  const PROFILES = [
    // ERIE: Start Quote
    {
      id: "erie-start-quote",
      hostIncludes: ["agentexchange.com", "portal.agentexchange.com", "www.agentexchange.com"],
      pathIncludes: [],
      detect: ["#FirstName", "#LastName", "#MailingAddress_AddressLine1"],
      fields: {
        firstName: "#FirstName",
        middleName: "#MiddleName",
        lastName: "#LastName",
        suffix: "#Suffix",
        address1: "#MailingAddress_AddressLine1",
        address2: "#MailingAddress_AddressLine2",
        city: "#MailingAddress_City",
        state: "#MailingAddress_State",
        zip: "#MailingAddress_ZipCode",
        dob: ["#dateOfBirth_month", "#dateOfBirth_day", "#dateOfBirth_year"]
      }
    },

    // ERIE: Customer Edit / Summary
    {
      id: "erie-customer-edit",
      hostIncludes: ["agentexchange.com", "portal.agentexchange.com", "www.agentexchange.com"],
      pathIncludes: [],
      detect: [
        "#FirstNamedInsured_FirstName",
        "#FirstNamedInsured_EmailAddress",
        "#SSNText_1",
        "#mailing-address-text"
      ],
      prep: () => {
        try {
          const btns = document.querySelectorAll("button.customer-lockdown-buttons");
          for (let i = 0; i < btns.length; i++) {
            const db = (btns[i].getAttribute("data-bind") || "").toLowerCase();
            if (db.indexOf("editbuttonclickevent") >= 0) { try { btns[i].click(); } catch (_) { } }
          }
        } catch (_) { }
      },
      fields: {
        firstName: "#FirstNamedInsured_FirstName",
        middleName: "#FirstNamedInsured_MiddleName",
        lastName: "#FirstNamedInsured_LastName",
        suffix: "#FirstNamedInsured_Suffix",
        dob: "#txtDateOfBirth_1, [id^='txtDateOfBirth_']",
        ssn: "#SSNText_1, [id^='SSNText_']",
        email: "#FirstNamedInsured_EmailAddress, [id$='_EmailAddress']",
        phone: "#FirstNamedInsuredNumber_0, [id^='FirstNamedInsuredNumber_']",
        phoneType: "#FirstNamedInsuredPhoneType_0, [id^='FirstNamedInsuredPhoneType_']",
        licenseState: "#selLicenseState1, [id^='selLicenseState']",
        licenseNo: "#licenseNumber1, [id^='licenseNumber']"
      }
    },

    // NATGEN: Personal Auto
    {
      id: "natgen-personal-auto",
      hostIncludes: ["natgenagency.com", "www.natgenagency.com"],
      pathIncludes: ["quotenamedinsured.aspx"],
      suppressEvents: true,
      detect: [
        "#ctl00_MainContent_InsuredNamed1_txtInsFirstName",
        "#ctl00_MainContent_InsuredNamed1_txtInsCity"
      ],
      fields: {
        firstName: "#ctl00_MainContent_InsuredNamed1_txtInsFirstName",
        middleName: "#ctl00_MainContent_InsuredNamed1_txtInsMiddleName",
        lastName: "#ctl00_MainContent_InsuredNamed1_txtInsLastName",
        suffix: "#ctl00_MainContent_InsuredNamed1_ddlInsSuffix",
        phone: [
          "#ctl00_MainContent_InsuredNamed1_ucPhonesV2_PhoneNumber1_txtPhone1",
          "#ctl00_MainContent_InsuredNamed1_ucPhonesV2_PhoneNumber1_txtPhone2",
          "#ctl00_MainContent_InsuredNamed1_ucPhonesV2_PhoneNumber1_txtPhone3"
        ],
        email: "#ctl00_MainContent_InsuredNamed1_txtInsEmail",
        dob: "#ctl00_MainContent_InsuredNamed1_txtInsDOB",
        ssn: [
          "#ctl00_MainContent_InsuredNamed1_txtSocialSecurityNum1",
          "#ctl00_MainContent_InsuredNamed1_txtSocialSecurityNum2",
          "#ctl00_MainContent_InsuredNamed1_txtSocialSecurityNum3"
        ],
        address1: "#ctl00_MainContent_InsuredNamed1_txtInsAdr",
        address2: "#ctl00_MainContent_InsuredNamed1_txtInsAdr2",
        city: "#ctl00_MainContent_InsuredNamed1_txtInsCity",
        state: "#ctl00_MainContent_InsuredNamed1_ddlInsState",
        zip: [
          "#ctl00_MainContent_InsuredNamed1_txtInsZip",
          "#ctl00_MainContent_InsuredNamed1_txtInsZip2"
        ]
      }
    },

    // PROGRESSIVE: Quote Named Insured
    {
      id: "progressive-quote-named-insured",
      hostIncludes: ["quoting.foragentsonly.com"],
      pathIncludes: ["/quote/index"],
      detect: [
        "#NamedInsured_Embedded_Questions_List_FirstName",
        "#NamedInsured_Embedded_Questions_List_LastName",
        "#NamedInsured_Embedded_Questions_List_MailingAddress"
      ],
      fields: {
        firstName: "#NamedInsured_Embedded_Questions_List_FirstName",
        middleName: "#NamedInsured_Embedded_Questions_List_MiddleInitial",
        lastName: "#NamedInsured_Embedded_Questions_List_LastName",
        suffix: "#NamedInsured_Embedded_Questions_List_Suffix",
        dob: "#NamedInsured_Embedded_Questions_List_DateOfBirth",
        gender: "#NamedInsured_Embedded_Questions_List_Gender",
        email: "#NamedInsured_Embedded_Questions_List_PrimaryEmailAddress",
        phoneType: "#NamedInsured_PhoneNumbers_List_0_Embedded_Questions_List_PhoneType",
        phone: "#NamedInsured_PhoneNumbers_List_0_Embedded_Questions_List_PhoneNumber",
        address1: "#NamedInsured_Embedded_Questions_List_MailingAddress",
        address2: "#NamedInsured_Embedded_Questions_List_ApartmentUnit",
        city: "#NamedInsured_Embedded_Questions_List_City",
        state: "#NamedInsured_Embedded_Questions_List_State",
        zip: "#NamedInsured_Embedded_Questions_List_ZipCode"
      }
    }
  ];

  function pickProfile() {
    const host = location.hostname.toLowerCase();
    const path = (location.pathname + location.search).toLowerCase();

    let best = null, bestScore = -1;

    for (let i = 0; i < PROFILES.length; i++) {
      const p = PROFILES[i];
      const hOk = !p.hostIncludes || !p.hostIncludes.length || p.hostIncludes.some(h => host.indexOf(String(h).toLowerCase()) >= 0);
      const pOk = !p.pathIncludes || !p.pathIncludes.length || p.pathIncludes.some(pt => path.indexOf(String(pt).toLowerCase()) >= 0);
      if (!hOk || !pOk) continue;

      const det = p.detect || [];
      let score = 0;
      for (let d = 0; d < det.length; d++) if (document.querySelector(det[d])) score++;
      if (score > bestScore) { best = p; bestScore = score; }
    }

    return best;
  }

  function parseErieMailingAddress() {
    const el = document.querySelector("#mailing-address-text");
    if (!el) return null;

    const t = String(el.innerText || "").replace(/\r/g, "").trim();
    const lines = t.split(/\n+/);
    if (lines.length < 2) return null;

    const address1 = lines[0].trim();
    const m = lines[1].match(/^(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-(\d{4}))?$/i);
    if (!m) return { address1: address1 };

    const city = m[1].trim();
    const state = String(m[2] || "").toUpperCase();
    const zip5 = m[3];
    const zip4 = m[4] || "";
    return { address1: address1, city: city, state: state, zip: zip4 ? (zip5 + "-" + zip4) : zip5 };
  }

  async function readErieSensitive() {
    const valOrEmpty = sel => (document.querySelector(sel) && document.querySelector(sel).value ? String(document.querySelector(sel).value).trim() : "");

    let dob = valOrEmpty("#txtDateOfBirth_1") || valOrEmpty("[id^='txtDateOfBirth_']");
    let ssn = valOrEmpty("#SSNText_1") || valOrEmpty("[id^='SSNText_']");
    let dln = valOrEmpty("#licenseNumber1") || valOrEmpty("[id^='licenseNumber']");
    let email = valOrEmpty("#FirstNamedInsured_EmailAddress") || valOrEmpty("[id$='_EmailAddress']");
    let phone = valOrEmpty("#FirstNamedInsuredNumber_0") || valOrEmpty("[id^='FirstNamedInsuredNumber_']");

    const needReveal = looksMasked(dob) || looksMasked(ssn) || looksMasked(dln) || (!email && !phone);
    if (needReveal) {
      try {
        const btns = document.querySelectorAll(".reveal-data-btn");
        for (let i = 0; i < btns.length; i++) { try { btns[i].click(); } catch (_) { } }
      } catch (_) { }

      await new Promise(r => setTimeout(r, 220));

      try {
        if (!dob || looksMasked(dob)) {
          const cand = $$(".editor-block .named-insured-value span, .named-insured-value")
            .map(e => (e.textContent || "").trim())
            .filter(tx => /^\d{2}\/\d{2}\/\d{4}$/.test(tx));
          if (cand.length) dob = cand[0];
        }
      } catch (_) { }

      try {
        if (!ssn || looksMasked(ssn)) {
          const cand2 = $$(".editor-block .named-insured-value")
            .map(e => (e.textContent || "").trim())
            .filter(tx => /^\d{3}-\d{2}-\d{4}$/.test(tx));
          if (cand2.length) ssn = cand2[0];
        }
      } catch (_) { }

      try {
        if (!dln || looksMasked(dln)) {
          const cand3 = $$(".editor-block .named-insured-value")
            .map(e => (e.textContent || "").trim())
            .filter(tx => /^[A-Z0-9]{6,}$/i.test(tx) && !looksMasked(tx));
          if (cand3.length) dln = cand3[0];
        }
      } catch (_) { }

      try {
        if (!email) {
          const emTxt = $(".customer-lockdown-email") ? String($(".customer-lockdown-email").textContent || "").trim() : "";
          if (emTxt && emTxt.indexOf("@") >= 0) email = emTxt;
        }
      } catch (_) { }

      try {
        if (!phone) {
          const cand4 = $$(".editor-block .named-insured-value")
            .map(e => (e.textContent || "").trim())
            .filter(tx => /(\(\d{3}\)\s*\d{3}-\d{4})|(\d{3}-\d{3}-\d{4})|(\d{10})/.test(tx));
          if (cand4.length) phone = cand4[0];
        }
      } catch (_) { }
    }

    return { dob: dob, ssn: ssn, licenseNo: dln, email: email, phone: phone };
  }

  async function doCopy() {
    const prof = pickProfile();
    if (!prof) return toastCenter("No profile matched this page");

    const data = {};
    const fields = prof.fields || {};

    for (const key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;

      const sel = fields[key];

      if (Array.isArray(sel)) {
        const vals = sel.map(s => String(getVal($(s)) || "").trim());
        if (key === "dob") data[key] = vals.join("/");
        else if (key === "zip" || key === "ssn" || key === "phone") data[key] = vals.filter(Boolean).join("-");
        else data[key] = vals.join(" ");
      } else {
        const el = String(sel).indexOf(",") >= 0 ? firstVisibleSelector(sel) : $(sel);
        data[key] = String(getVal(el) || "").trim();
      }
    }

    if (prof.id.indexOf("erie-") === 0) {
      const addr = parseErieMailingAddress();
      if (addr) {
        data.address1 = data.address1 || addr.address1 || "";
        data.city = data.city || addr.city || "";
        data.state = data.state || addr.state || "";
        data.zip = data.zip || addr.zip || "";
      }
      try {
        const sens = await readErieSensitive();
        if (sens) {
          if (!data.dob || looksMasked(data.dob)) data.dob = sens.dob || data.dob || "";
          if (!data.ssn || looksMasked(data.ssn)) data.ssn = sens.ssn || data.ssn || "";
          if (!data.licenseNo || looksMasked(data.licenseNo)) data.licenseNo = sens.licenseNo || data.licenseNo || "";
          if (!data.email) data.email = sens.email || data.email || "";
          if (!data.phone) data.phone = sens.phone || data.phone || "";
        }
      } catch (_) { }
    }

    if (data.dob) data.dob = fmtDOB(data.dob);

    if (data.phone) {
      const d = onlyDigits(data.phone);
      if (d.length >= 10) data.phone = d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6, 10);
    }
    if (data.ssn) {
      const d2 = onlyDigits(data.ssn);
      if (d2.length === 9) data.ssn = d2.slice(0, 3) + "-" + d2.slice(3, 5) + "-" + d2.slice(5, 9);
    }

    const json = JSON.stringify(Object.assign({ __profile: prof.id }, data));

    const ok = await writeClipboard(json);
    toastCenter(ok ? ("Copied (" + prof.id + ")") : "Clipboard copy blocked");
  }

  async function doPaste() {
    const prof = pickProfile();
    if (!prof) return toastCenter("No profile matched this page");

    try { if (typeof prof.prep === "function") prof.prep(); } catch (_) { }

    let data = {};
    try {
      data = JSON.parse((await readClipboard()) || "{}");
    } catch (_) {
      return toastCenter("Clipboard JSON invalid");
    }

    const apply = () => {
      const fields = prof.fields || {};

      for (const key in fields) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;

        let val = data[key];
        if (val == null || val === "") continue;

        const sel = fields[key];
        const fire = !prof.suppressEvents;

        if (Array.isArray(sel)) {
          let parts = [];
          if (key === "phone") parts = splitPhone(val);
          else if (key === "ssn") parts = splitSSN(val);
          else if (key === "zip") parts = splitZIP(val);
          else if (key === "dob") parts = splitDOB(val);
          else parts = String(val).split(/[-/\s]+/);

          for (let i = 0; i < sel.length; i++) setInput($(sel[i]), parts[i] == null ? "" : parts[i], fire);
          continue;
        }

        const el = String(sel).indexOf(",") >= 0 ? firstVisibleSelector(sel) : $(sel);
        if (!el) continue;

        if (key === "dob" && el.tagName !== "SELECT") val = fmtDOB(val);
        setInput(el, val, fire);
      }

      if (prof.suppressEvents) {
        const any = $("#ctl00_MainContent_InsuredNamed1_txtInsFirstName");
        if (any) any.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };

    if (prof.suppressEvents) await withPostbackShield(apply);
    else apply();

    toastCenter("Pasted (" + prof.id + ")");
  }

  /****************
   * Event bridge
   ****************/
  function onCopy() { doCopy(); }
  function onPaste() { doPaste(); }

  window.addEventListener("mci:copy", onCopy, false);
  window.addEventListener("mci:paste", onPaste, false);

  // Optional: useful when testing without the menu
  // window.mciCopy = doCopy;
  // window.mciPaste = doPaste;

})();