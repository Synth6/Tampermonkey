// ==UserScript==
// @name         MCI Master Menu
// @namespace    mci-tools
// @version      5.5
// @description  MCI slide-out toolbox for carrier sites (QQ / Erie / NatGen / Progressive). Shadow DOM UI with smart clipboard buttons; hover far-left (or Alt+M) to open.
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
     * COPY/PASTE PROFILES     *
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
                document.querySelectorAll('button.customer-lockdown-buttons')?.forEach(btn => {
                    const db = (btn.getAttribute('data-bind') || "").toLowerCase();
                    if (db.includes('editbuttonclickevent')) try { btn.click(); } catch { }
                });
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
            suppressEvents: true, // shield postbacks while filling
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
        },
];

    function pickProfile() {
        const host = location.hostname.toLowerCase();
        const path = (location.pathname + location.search).toLowerCase();
        let best = null, bestScore = -1;
        for (const p of PROFILES) {
            const hOk = !p.hostIncludes?.length || p.hostIncludes.some(h => host.includes(h.toLowerCase()));
            const pOk = !p.pathIncludes?.length || p.pathIncludes.some(pt => path.includes(pt.toLowerCase()));
            if (!hOk || !pOk) continue;
            const score = (p.detect || []).reduce((n, sel) => n + (document.querySelector(sel) ? 1 : 0), 0);
            if (score > bestScore) { best = p; bestScore = score; }
        }
        return best;
    }

    function parseErieMailingAddress() {
        const el = document.querySelector("#mailing-address-text");
        if (!el) return null;
        const t = el.innerText.replace(/\r/g, "").trim();
        const lines = t.split(/\n+/);
        if (lines.length < 2) return null;
        const address1 = lines[0].trim();
        const m = lines[1].match(/^(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-(\d{4}))?$/i);
        if (!m) return { address1 };
        const city = m[1].trim();
        const state = m[2].toUpperCase();
        const zip5 = m[3];
        const zip4 = m[4] || "";
        return { address1, city, state, zip: zip4 ? `${zip5}-${zip4}` : zip5 };
    }

    async function readErieSensitive() {
        const valOrEmpty = sel => (document.querySelector(sel)?.value || "").trim();
        let dob = valOrEmpty("#txtDateOfBirth_1") || valOrEmpty("[id^='txtDateOfBirth_']");
        let ssn = valOrEmpty("#SSNText_1") || valOrEmpty("[id^='SSNText_']");
        let dln = valOrEmpty("#licenseNumber1") || valOrEmpty("[id^='licenseNumber']");
        let email = valOrEmpty("#FirstNamedInsured_EmailAddress") || valOrEmpty("[id$='_EmailAddress']");
        let phone = valOrEmpty("#FirstNamedInsuredNumber_0") || valOrEmpty("[id^='FirstNamedInsuredNumber_']");
        const needReveal = looksMasked(dob) || looksMasked(ssn) || looksMasked(dln) || (!email && !phone);
        if (needReveal) {
            document.querySelectorAll(".reveal-data-btn").forEach(btn => { try { btn.click(); } catch { } });
            await new Promise(r => setTimeout(r, 220));
            if (!dob || looksMasked(dob)) dob = ($$(".editor-block .named-insured-value span, .named-insured-value").map(e => e.textContent?.trim()).find(tx => /^\d{2}\/\d{2}\/\d{4}$/.test(tx || ""))) || dob;
            if (!ssn || looksMasked(ssn)) ssn = ($$(".editor-block .named-insured-value").map(e => e.textContent?.trim()).find(tx => /^\d{3}-\d{2}-\d{4}$/.test(tx || ""))) || ssn;
            if (!dln || looksMasked(dln)) dln = ($$(".editor-block .named-insured-value").map(e => e.textContent?.trim()).find(tx => /^[A-Z0-9]{6,}$/i.test(tx || "") && !looksMasked(tx || ""))) || dln;
            if (!email) {
                const emTxt = $(".customer-lockdown-email")?.textContent?.trim();
                if (emTxt && /@/.test(emTxt)) email = emTxt;
            }
            if (!phone) {
                const t = $$(".editor-block .named-insured-value").map(e => e.textContent?.trim()).find(tx => /(\(\d{3}\)\s*\d{3}-\d{4})|(\d{3}-\d{3}-\d{4})|(\d{10})/.test(tx || ""));
                if (t) phone = t;
            }
        }
        return { dob, ssn, licenseNo: dln, email, phone };
    }

    async function withPostbackShield(fn) {
        const savedPostBack = window.__doPostBack;
        try { window.__doPostBack = function () { }; } catch { }
        const blocker = e => e.stopImmediatePropagation();
        document.addEventListener("input", blocker, true);
        document.addEventListener("change", blocker, true);
        document.addEventListener("blur", blocker, true);
        try { return await fn(); }
        finally {
            document.removeEventListener("input", blocker, true);
            document.removeEventListener("change", blocker, true);
            document.removeEventListener("blur", blocker, true);
            try { window.__doPostBack = savedPostBack; } catch { }
        }
    }

    async function doCopy(toast) {
        const prof = pickProfile();
        if (!prof) return toast("No profile matched this page");
        const data = {};
        for (const [key, sel] of Object.entries(prof.fields)) {
            if (Array.isArray(sel)) {
                const vals = sel.map(s => getVal($(s)).trim());
                if (key === "dob") data[key] = vals.join("/");
                else if (["zip", "ssn", "phone"].includes(key)) data[key] = vals.filter(Boolean).join("-");
                else data[key] = vals.join(" ");
            } else {
                const el = sel.includes(",") ? firstVisibleSelector(sel) : $(sel);
                data[key] = getVal(el).trim();
            }
        }
        if (prof.id.startsWith("erie-")) {
            const addr = parseErieMailingAddress();
            if (addr) {
                data.address1 ||= addr.address1 || "";
                data.city ||= addr.city || "";
                data.state ||= addr.state || "";
                data.zip ||= addr.zip || "";
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
            } catch { }
        }
        if (data.dob) data.dob = fmtDOB(data.dob);
        if (data.phone) { const d = onlyDigits(data.phone); if (d.length >= 10) data.phone = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}`; }
        if (data.ssn) { const d = onlyDigits(data.ssn); if (d.length === 9) data.ssn = `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 9)}`; }
        const json = JSON.stringify({ __profile: prof.id, ...data });
        try { await navigator.clipboard.writeText(json); toast(`Copied (${prof.id})`); }
        catch { toast("Clipboard copy blocked"); }
    }

    async function doPaste(toast) {
        const prof = pickProfile();
        if (!prof) return toast("No profile matched this page");
        try { prof.prep && prof.prep(); } catch { }
        let data;
        try { data = JSON.parse(await navigator.clipboard.readText() || "{}"); }
        catch { return toast("Clipboard JSON invalid"); }

        const apply = () => {
            for (const [key, sel] of Object.entries(prof.fields)) {
                let val = data[key];
                if (val == null || val === "") continue;
                const fire = !prof.suppressEvents;
                if (Array.isArray(sel)) {
                    let parts = [];
                    if (key === "phone") parts = splitPhone(val);
                    else if (key === "ssn") parts = splitSSN(val);
                    else if (key === "zip") parts = splitZIP(val);
                    else if (key === "dob") parts = splitDOB(val);
                    else parts = String(val).split(/[-/\s]+/);
                    sel.forEach((s, i) => setInput($(s), parts[i] ?? "", fire));
                    continue;
                }
                const el = sel.includes(",") ? firstVisibleSelector(sel) : $(sel);
                if (!el) continue;
                if (key === "dob" && el && el.tagName !== "SELECT") val = fmtDOB(val);
                setInput(el, val, fire);
            }
            if (prof.suppressEvents) {
                const any = $("#ctl00_MainContent_InsuredNamed1_txtInsFirstName");
                if (any) any.dispatchEvent(new Event("input", { bubbles: true }));
            }
        };

        if (prof.suppressEvents) await withPostbackShield(apply); else apply();
        toast(`Pasted (${prof.id})`);
    }

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

  #${TRIGGER_ID}{
    position:fixed; top:0; left:0; width:4px; height:100vh;
    z-index:2147483647; background:transparent; cursor:ew-resize;
  }
  #${MENU_ID}{
    position:fixed; top:0; left:-268px; width:268px; height:100vh;
    background:#1a1c22; color:#eef3ff; z-index:2147483646;
    padding-top:0px; box-shadow:2px 0 8px rgba(0,0,0,.5);
    transition:left .25s ease; overflow-x:hidden; overflow-y:auto;
    font:13px system-ui,Segoe UI,Arial;
  }
  #${TRIGGER_ID}:hover + #${MENU_ID},
  #${MENU_ID}:hover{ left:0 !important; }

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

            display:flex; align-items:center; justify-content:space-between; font-weight:700; letter-spacing:.2px; }
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

<div id="${TRIGGER_ID}" title="Hover to open"></div>
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
      <button class="mci-btn blue" id="mci_fd_toggle">📥 File Downloader</button>
      <div class="mci-downloader-panel" id="mci_fd_panel">
        <button class="mci-btn purple" id="mci_fd_erie">Erie / NatGen</button>
        <button class="mci-btn brand" id="mci_fd_prog">Progressive</button>
        <button class="mci-btn green" id="mci_fd_ncjua">NCJUA</button>
        <button class="mci-btn gray" id="mci_fd_flood">NatGen Flood</button>
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
    <span class="kbd">F8</span>
    <div class="list">
      <div><b>Name</b> → LinkedIn</div>
      <div><b>Address</b> → Maps + Vexcel</div>
      <div><b>Policy #</b> → Carrier</div>
    </div>
  </div>

  <div class="group">
    <span class="kbd">F10</span>
    <div class="list">
      <div><b>VIN</b> → NHTSA</div>
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
        $s("#mci_copy")?.addEventListener("click", () => doCopy(toast));
        $s("#mci_paste")?.addEventListener("click", () => doPaste(toast));


        // Wire the File Downloader action buttons
        $s('#mci_fd_erie')?.addEventListener('click', () => {
            // collapse panel so the overlay you open isn't hidden behind the menu
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // run the Erie/NatGen row-click opener
            runErieNatGen();
        });

        $s('#mci_fd_prog')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // Trigger Progressive downloader script (separate TM script)
            try {
                window.dispatchEvent(new CustomEvent('mci:progressive-downloader'));
                toast('Progressive downloader triggered.');
            } catch (e) {
                // IE-safe-ish fallback isn't needed here, but keep simple:
                const ev = document.createEvent('Event');
                ev.initEvent('mci:progressive-downloader', true, true);
                window.dispatchEvent(ev);
                toast('Progressive downloader triggered.');
            }
        });

        $s('#mci_fd_ncjua')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // open the NCJUA mini-downloader UI
            runNCJUA();
        });

        $s('#mci_fd_flood')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // open the NatGen Flood selector/downloader
            runFlood();
        });

        $s('#mci_fd_ncjua')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            runNCJUA();
        });

        $s('#mci_fd_flood')?.addEventListener('click', () => {
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            runFlood();
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

        // Edge hover watcher (host page coordinates)
        window.addEventListener("mousemove", (e) => {
            const menu = root.getElementById(MENU_ID);
            if (!menu) return;
            if (e.clientX <= 20) menu.style.left = "0";
            else if (!menu.matches(":hover") && e.clientX > 320) menu.style.left = "-268px";
        }, { passive: true });

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
            menu.style.left = (menu.style.left === "0px") ? "-268px" : "0";
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




    // ===================================== //
    // ============ Erie FLOOD ============= //
    // ===================================== //

    function runFlood() {
        const rows = document.querySelectorAll("#DocumentListContentContainer > tr");
        if (!rows.length) return alert("No document rows found.");

        // Create minimal, lighter UI
        const box = document.createElement("div");
        box.innerHTML = `
    <div style="background:#f1f1f1;color:#333;padding:6px 10px;cursor:move;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ccc;">
      <span style="font-weight:bold;">📄NatGen PDF Downloader</span>
      <button id="closeDownloader" style="background:#e74c3c;color:white;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;">X</button>
    </div>
    <div style="padding:10px;">
      <label><input type="checkbox" id="selectAllCheckbox"> Select All</label>
      <button id="downloadSelected" style="margin-left:10px;padding:4px 8px;">Download Selected</button>
      <div id="pdfLog" style="margin-top:8px;max-height:150px;overflow:auto;font-size:11px;line-height:1.4;color:#444;"></div>
    </div>
  `;
        Object.assign(box.style, {
            position: "fixed",
            top: "80px",
            left: "80px",
            background: "#fff",
            border: "1px solid #ccc",
            zIndex: 9999,
            width: "260px",
            borderRadius: "6px",
            boxShadow: "2px 2px 8px rgba(0,0,0,0.2)",
            fontFamily: "Arial, sans-serif",
            fontSize: "13px",
        });
        document.body.appendChild(box);
        window.__pdfDownloaderBox = box;

        // Drag functionality
        const header = box.querySelector("div:first-child");
        header.onmousedown = function (e) {
            const offsetX = e.clientX - box.offsetLeft;
            const offsetY = e.clientY - box.offsetTop;

            function move(e) {
                box.style.left = e.clientX - offsetX + "px";
                box.style.top = e.clientY - offsetY + "px";
            }
            document.addEventListener("mousemove", move);
            document.onmouseup = () => document.removeEventListener("mousemove", move);
        };

        // Close button
        box.querySelector("#closeDownloader").onclick = () => {
            box.remove();
            delete window.__pdfDownloaderBox;
            document.querySelectorAll(".pdfCheckboxCell").forEach(el => el.remove());
        };

        // Add checkboxes to table
        rows.forEach(row => {
            const td = document.createElement("td");
            td.className = "pdfCheckboxCell";
            td.style.textAlign = "center";
            td.innerHTML = `<input type="checkbox" class="pdfCheckbox">`;
            row.insertBefore(td, row.firstElementChild);
        });

        // Select All toggle
        box.querySelector("#selectAllCheckbox").onchange = function () {
            const checked = this.checked;
            document.querySelectorAll(".pdfCheckbox").forEach(cb => cb.checked = checked);
        };

        // Download logic
        box.querySelector("#downloadSelected").onclick = async function () {
            const log = box.querySelector("#pdfLog");
            log.innerHTML = "";

            const selectedRows = Array.from(rows).filter(row => row.querySelector(".pdfCheckbox")?.checked);
            if (!selectedRows.length) return alert("No files selected.");

            const policyNumElem = document.querySelector(".display_value_PolicySummaryView_NFIPPolicyNum");
            const policyNum = policyNumElem ? policyNumElem.textContent.trim() : "NoPolicy";

            for (const row of selectedRows) {
                try {
                    const name = row.querySelector(".documentName")?.textContent.trim();
                    const type = row.cells[4]?.innerText.trim().replace(/\s+/g, "_");
                    const created = row.cells[5]?.innerText.trim().replace(/\//g, "-");
                    const link = row.querySelector("a.JSDocumentLink")?.href;

                    if (!link) {
                        log.innerHTML += `<div>❌ No link for "${name}"</div>`;
                        continue;
                    }

                    const fileName = `${policyNum} - ${name} - ${type} - ${created}.pdf`.replace(/[\\/:*?"<>|]/g, "_");

                    // ✅ Force download via fetch + blob
                    const response = await fetch(link);
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);

                    const a = document.createElement("a");
                    a.href = blobUrl;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();

                    URL.revokeObjectURL(blobUrl); // Clean up

                    log.innerHTML += `<div>✔️ Downloaded: ${fileName}</div>`;
                } catch (e) {
                    log.innerHTML += `<div>❌ Error downloading file: ${e.message}</div>`;
                }
            }
        };


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
