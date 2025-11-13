// ==UserScript==
// @name         MCI Master Menu
// @namespace    mci-tools
// @version      4.2
// @description  Slide-out toolbox (QQ / Erie / NatGen) with Shadow DOM. Hover far-left to open; Alt+M toggles; Alt+Shift+M removes. Copy/Paste mapper, VIN lookup, and in-menu QQC Carrier Extractor -> QQ autofill pipeline.
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
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    "use strict";
    const HOST = location.hostname.toLowerCase();
    const IS_QQ = /qqcatalyst/.test(HOST);
    const IS_ERIE = /agentexchange\.com|portal\.agentexchange\.com|customerdatamanagement\.agentexchange\.com/.test(HOST);
    const IS_NG = /natgenagency\.com/.test(HOST);
    const IN_IFRAME = window.top !== window.self;
    // Only keep menu instances inside QQ iframes; Erie/NatGen modules inherit the parent menu instead.
    if (IN_IFRAME && !IS_QQ) return;

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

    function makePanelDraggable(container, handle, opts = {}) {
        if (!container || !handle) return;
        let dragging = false;
        let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;
        const onMouseDown = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target?.closest?.('button, input, select, textarea, a, [data-nodrag="1"]')) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = container.getBoundingClientRect();
            baseLeft = rect.left;
            baseTop = rect.top;
            opts.onStart?.();
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        };
        const onMouseMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const maxLeft = Math.max(0, window.innerWidth - container.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - container.offsetHeight);
            const newLeft = Math.min(maxLeft, Math.max(0, baseLeft + dx));
            const newTop = Math.min(maxTop, Math.max(0, baseTop + dy));
            container.style.left = `${newLeft}px`;
            container.style.top = `${newTop}px`;
            opts.onMove?.(newLeft, newTop);
        };
        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            opts.onEnd?.();
        };
        handle.addEventListener('mousedown', onMouseDown);
    }

    const QQC_OVERLAY_GAP = 12;
    let overlayResizeHandlerAttached = false;

    function centerOverlayElement(overlay) {
        if (!overlay) return;
        overlay.style.transform = 'none';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        const rect = overlay.getBoundingClientRect();
        const width = rect.width || overlay.offsetWidth || 420;
        const height = rect.height || overlay.offsetHeight || 520;
        const left = Math.max(QQC_OVERLAY_GAP, (window.innerWidth - width) / 2);
        const top = Math.max(QQC_OVERLAY_GAP, (window.innerHeight - height) / 2);
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
    }

    function clampOverlayWithinViewport(overlay) {
        if (!overlay) return;
        const rect = overlay.getBoundingClientRect();
        const width = rect.width || overlay.offsetWidth || 420;
        const height = rect.height || overlay.offsetHeight || 520;
        const maxLeft = Math.max(QQC_OVERLAY_GAP, window.innerWidth - width - QQC_OVERLAY_GAP);
        const maxTop = Math.max(QQC_OVERLAY_GAP, window.innerHeight - height - QQC_OVERLAY_GAP);
        const currentLeft = parseFloat(overlay.style.left || rect.left || 0);
        const currentTop = parseFloat(overlay.style.top || rect.top || 0);
        const nextLeft = Math.min(Math.max(currentLeft, QQC_OVERLAY_GAP), maxLeft);
        const nextTop = Math.min(Math.max(currentTop, QQC_OVERLAY_GAP), maxTop);
        overlay.style.left = `${nextLeft}px`;
        overlay.style.top = `${nextTop}px`;
    }

    function ensureOverlayResizeHandler() {
        if (overlayResizeHandlerAttached) return;
        overlayResizeHandlerAttached = true;
        window.addEventListener('resize', () => {
            const host = document.getElementById(HOST_ID);
            const overlay = host?.shadowRoot?.getElementById('qqc_overlay');
            if (!overlay || overlay.dataset.visible !== '1') return;
            if (overlay.dataset.userPositioned === '1') clampOverlayWithinViewport(overlay);
            else centerOverlayElement(overlay);
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
        }
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
    position:fixed; top:0; left:0; width:28px; height:100vh;
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
  .mci-head{ background:#0f172a; color:#fff; padding:9px 12px; border-bottom:1px solid rgba(255,255,255,.08);
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
  .mci-btn.brand{ background:#1e40af } .mci-btn.darkblue:hover{ background:#1e3a8a }

  .divider{ margin:12px 10px 10px; border-top:1px dashed rgba(255,255,255,.25); position:relative; height:0; }
  .divider::after{
    content:attr(data-label); position:absolute; left:50%; transform:translate(-50%,-55%);
    background:#1a1c22; padding:0 6px; color:#9fb4d8; font-size:11px; letter-spacing:.2px;
  }
  .badge{ display:inline-block; background:#334155; color:#e6eef8; border:1px solid rgba(255,255,255,.08);
          padding:3px 6px; border-radius:999px; font-size:11px; margin-left:6px }

  /* Accordion VIN */
  details.mci-acc{ border:1px solid rgba(255,255,255,.12); border-radius:8px; background:#111827; }
  details.mci-acc[open]{ background:#0f1626; }
  summary.mci-sum{
    list-style:none; cursor:pointer; padding: 2px 5px; font-weight:700; display:flex; align-items:center; justify-content:space-between;
  }
  summary.mci-sum::-webkit-details-marker{ display:none; }
  .mci-caret{ transition:transform .15s ease; }
  details[open] .mci-caret{ transform:rotate(90deg); }

  .vdin-body{ padding:10px 12px; padding-top:0; }
  .mci-input-row{ display:flex; gap:8px; align-items:center; }
  .mci-input{
    flex:1; min-width:0; height:36px; padding:7px 10px; border-radius:6px;
    border:1px solid #2c3442; background:#0b1220; color:#e6eef8; outline:none;
  }
  .mci-inline-btn{
    flex:0 0 auto; height:36px; padding:0 12px; border-radius:8px;
    border:1px solid rgba(255,255,255,.12); background:#2a2f39; color:#fff; cursor:pointer;
  }
  .mci-inline-btn:hover{ background:#394152 }
  .mci-btn-row{ display:flex; gap:8px; align-items:stretch; margin-top:8px; }
  .mci-btn-row .mci-btn{ margin:0; }
  .mci-btn-row .mci-inline-btn{ height:auto; }
  .mci-btn-pair{ display:flex; gap:8px; }
  .mci-btn-pair .mci-btn{ flex:1; margin:0; }

  /* QQC module inside the menu */
  .qqc-wrap{ padding:10px; border-top:1px dashed rgba(255,255,255,.14); }
  .qqc-grid{ display:grid; grid-template-columns:1fr; gap:8px; }
  .qqc-grid label{ display:block; font-size:11px; color:#bcd1f7; }
  .qqc-grid input, .qqc-grid select, .qqc-grid textarea{
    width:100%; height:32px; padding:6px 8px; border-radius:6px;
    border:1px solid #2c3442; background:#0b1220; color:#e6eef8; outline:none;
  }
  .qqc-grid textarea{ height:88px; resize:vertical; }
  .qqc-row{ display:flex; gap:8px; }
  .qqc-row > *{ flex:1 1 0; min-width:0; }
  .qqc-actions{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
  .qqc-status{ font-size:11px; color:#f2ec41; margin-top:6px; min-height:14px; }

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
  #qqc_overlay{
    position:fixed; top:12vh; left:50%; transform:translateX(-50%);
    z-index:2147483647; display:none;
    width:min(420px, calc(100vw - 32px)); max-width:420px; max-height:calc(100vh - 24px);
  }
  .qqc-panel{
    width:100%;
    background:#111827; border:1px solid #374151; border-radius:10px;
    box-shadow:0 12px 32px rgba(0,0,0,0.45); overflow:hidden; font:13px system-ui;
  }
  .qqc-panel-header{
    background:#0f172a; color:#fff; padding:10px 12px;
    display:flex; justify-content:space-between; align-items:center; cursor:move;
  }
  .qqc-panel-header h3{
    margin:0; font-size:14px; letter-spacing:.3px;
  }
  .qqc-panel-header .qqc-head-actions{
    display:flex; gap:8px; align-items:center;
  }
  .qqc-close-btn{
    background:#1f2937; color:#fff; border:none; border-radius:6px;
    width:28px; height:28px; cursor:pointer;
  }
  .qqc-panel-body{
    padding:10px; max-height:75vh; overflow:auto; background:#1b202d;
  }
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
    <div>MCI Toolbox <span class="badge">${IS_QQ ? "QQ" : IS_ERIE ? "Erie" : IS_NG ? "NatGen" : location.hostname}</span></div>
    <div class="mci-host">${location.hostname}</div>
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

  <div class="mci-section"><div class="mci-body">
    <details class="mci-acc" id="mci_vin_acc">
      <summary class="mci-sum">
        <span>VIN Lookup</span>
        <span><span class="badge">NHTSA</span> <span class="mci-caret">></span></span>
      </summary>
      <div class="vdin-body">
        <div class="mci-input-row" style="margin-bottom:8px">
          <input id="mci_vin" class="mci-input" type="text" maxlength="17" placeholder="Enter VIN (partial OK)">
        </div>
        <div class="mci-btn-row">
          <button class="mci-btn" id="mci_vin_search" style="flex:1">Search</button>
          <button class="mci-inline-btn" id="mci_vin_clear">Clear</button>
        </div>
      </div>
    </details>
  </div></div>

  <div class="divider" data-label="File Downloader"></div>
  <div class="mci-section"><div class="mci-body">
    <div class="mci-downloader">
      <button class="mci-btn blue" id="mci_fd_toggle">📥 File Downloader</button>
      <div class="mci-downloader-panel" id="mci_fd_panel">
        <button class="mci-btn purple" id="mci_fd_erie">Erie / NatGen</button>
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
  <button class="mci-btn gray" id="mci_remove">❌ Remove Menu (Alt+Shift+M)</button>
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

  <div id="qqc_overlay">
    <div class="qqc-panel" id="qqc_panel">
      <div class="qqc-panel-header" id="qqc_panel_handle">
        <h3>QQC Carrier Extractor</h3>
        <div class="qqc-head-actions">
          <button class="mci-inline-btn, mci-btn green" id="qqc_overlay_send">Send to QQ</button>
          <button class="qqc-close-btn" id="qqc_overlay_close">X</button>
        </div>
      </div>
      <div class="qqc-panel-body">
        <div id="qqc_mod_mount" style="display:block"></div>
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

        const overlayEl = root.getElementById('qqc_overlay');
        makePanelDraggable(overlayEl, root.getElementById('qqc_panel_handle'), {
            onStart: () => {
                if (!overlayEl) return;
                overlayEl.dataset.userPositioned = '1';
                overlayEl.style.transform = 'none';
                overlayEl.style.right = 'auto';
            },
            onEnd: () => clampOverlayWithinViewport(overlayEl)
        });
        ensureOverlayResizeHandler();
        root.getElementById('qqc_overlay_close')?.addEventListener('click', () => hideQQCOverlay(root));
        root.getElementById('qqc_overlay_send')?.addEventListener('click', () => {
            const mountEl = ensureQQCModule(root);
            mountEl?.__qqcApi?.sendToQQ();
            toast("Sending QQC data...");
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

        $s("#mci_remove")?.addEventListener("click", () => document.getElementById(HOST_ID)?.remove());

        // VIN
        $s("#mci_vin_clear")?.addEventListener("click", () => { const i = $s("#mci_vin"); if (i) { i.value = ""; i.focus(); } });
        $s("#mci_vin_search")?.addEventListener("click", () => {
            const v = ($s("#mci_vin")?.value || "").trim(); if (!v) return toast("Enter a VIN first.");
            const f = document.createElement("form"); f.action = "https://vpic.nhtsa.dot.gov/decoder/Decoder"; f.method = "post"; f.target = "_blank";
            const inp = document.createElement("input"); inp.type = "hidden"; inp.name = "VIN"; inp.value = v.toUpperCase(); f.appendChild(inp);
            document.body.appendChild(f); f.submit(); setTimeout(() => f.remove(), 500);
        });
        $s("#mci_vin")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $s("#mci_vin_search")?.click(); } });

        if (IS_QQ) {
            startPdfPopupObserver();
            $s("#mci_pdf_open")?.addEventListener("click", () => smartOpenPdfs(toast));

            $s("#mci_fix_names")?.addEventListener("click", (evt) => {
                const target = evt.currentTarget;
                const { active, count } = toggleFileNameFix();
                target.textContent = active ? "Hide Full File Names" : "Show Full File Names";
                toast(count ? (active ? "Showing full file names." : "Restored truncated file names.") : "No file names found on this page.");
            });

            const colorInput = $s("#mci_row_color");
            colorInput?.addEventListener("input", (ev) => {
                const val = ev.target.value || DEFAULT_ROW_COLOR;
                localStorage.setItem(HIGHLIGHT_COLOR_KEY, val);
                updateHighlightedRows(val);
            });

            $s("#mci_row_highlight")?.addEventListener("click", () => {
                const rows = attachRowHighlighter();
                toast(rows ? "Row highlighting enabled (click rows to toggle)." : "No rows found to highlight.");
            });
        }


        // Wire the File Downloader action buttons
        $s('#mci_fd_erie')?.addEventListener('click', () => {
            // collapse panel so the overlay you open isn't hidden behind the menu
            $s('#mci_fd_panel')?.classList.remove('open');
            $s('#mci_fd_toggle').textContent = 'File Downloader ▸';
            // run the Erie/NatGen row-click opener
            runErieNatGen();
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


        // Edge hover watcher (host page coordinates)
        window.addEventListener("mousemove", (e) => {
            const menu = root.getElementById(MENU_ID);
            if (!menu) return;
            if (e.clientX <= 6) menu.style.left = "0";
            else if (!menu.matches(":hover") && e.clientX > 280) menu.style.left = "-268px";
        }, { passive: true });

        $s("#mci_open_qqc")?.addEventListener("click", () => {
            toast("Opening QQC data panel...");
            showQQCOverlay(root, { autoDetect: true });
        });
        $s("#qqc_sendqq_main")?.addEventListener("click", () => {
            toast("Detecting and sending to QQ...");
            showQQCOverlay(root, { autoDetect: true, autoSend: true });
        });

        return root;
    }

    // Hotkeys for the MENU (unchanged from your behavior)
    document.addEventListener("keydown", (e) => {
        const k = (e.key || "").toLowerCase();
        if (e.altKey && !e.shiftKey && k === 'q') {
            const root = mount();
            const overlay = root.getElementById('qqc_overlay');
            if (overlay && overlay.style.display === 'block') hideQQCOverlay(root);
            else showQQCOverlay(root, { autoDetect: false });
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

    /******************************************************************
     * QQC CARRIER EXTRACTOR (embedded module + QQ autofill pipeline)
     ******************************************************************/
    const STORAGE_KEY = 'QQC_PAYLOAD_V2';
    const PENDING_KEY = 'QQC_PENDING_V1';
    const QQ_CONTACTS_URL = 'https://app.qqcatalyst.com/Contacts/Customer/Index';

    let lastExtracted = null; // preserves full detected payload (incl. additionalContacts)

    // --- HUD for QQ (centered spinner / status) ---
    let hudEl = null, hudTxt = null, hudIco = null, hudHideTid = null;
    function onQQ() { return /qqcatalyst\.com$/i.test(location.hostname); }
    function ensureHudStyles() {
        if (document.getElementById('qqc-hud-styles')) return;
        const st = document.createElement('style');
        st.id = 'qqc-hud-styles';
        st.textContent = '@keyframes qqcspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
    }
    function ensureHud() {
        if (!onQQ()) return null;
        if (hudEl && document.body.contains(hudEl)) return hudEl;
        ensureHudStyles();
        const el = document.createElement('div');
        el.id = 'qqc-hud';
        el.style.cssText = 'position:fixed;left:50%; top:50%; transform:translate(-50%, -50%);z-index:2147483646;background:#111827;color:#fff;padding:8px 10px;border:1px solid #374151;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;gap:8px;align-items:center;font:12px system-ui;';
        const ico = document.createElement('span');
        ico.id = 'qqc-hud-ico';
        ico.style.cssText = 'display:inline-block;width:12px;height:12px;border:2px solid #fff;border-right-color:transparent;border-radius:50%;animation:qqcspin .8s linear infinite;';
        const txt = document.createElement('span');
        txt.id = 'qqc-hud-txt'; txt.textContent = 'Working...';
        el.appendChild(ico); el.appendChild(txt);
        document.body.appendChild(el);
        hudEl = el; hudIco = ico; hudTxt = txt; return el;
    }
    function hudInfo(msg) { if (!onQQ()) return; ensureHud(); if (hudTxt) hudTxt.textContent = msg || 'Working...'; if (hudIco) { hudIco.style.animation = 'qqcspin .8s linear infinite'; hudIco.style.borderColor = '#fff'; hudIco.style.borderRightColor = 'transparent'; hudIco.textContent = ''; } if (hudHideTid) { clearTimeout(hudHideTid); hudHideTid = null; } }
    function hudOk(msg) {
        if (!onQQ()) return; ensureHud(); if (hudTxt) hudTxt.textContent = msg || 'Done'; if (hudIco) { hudIco.style.animation = ''; hudIco.style.border = ''; hudIco.style.width = 'auto'; hudIco.style.height = 'auto'; hudIco.textContent = 'OK'; hudIco.style.color = '#10b981'; }
        if (hudHideTid) clearTimeout(hudHideTid); hudHideTid = setTimeout(() => { try { hudEl && hudEl.remove(); } catch { } hudEl = null; hudIco = null; hudTxt = null; hudHideTid = null; }, 3000);
    }
    function hudError(msg) { if (!onQQ()) return; ensureHud(); if (hudTxt) hudTxt.textContent = msg || 'Error'; if (hudIco) { hudIco.style.animation = ''; hudIco.style.border = ''; hudIco.style.width = 'auto'; hudIco.style.height = 'auto'; hudIco.textContent = 'X'; hudIco.style.color = '#ef4444'; } if (hudHideTid) { clearTimeout(hudHideTid); hudHideTid = null; } }

    // ---------- Small helpers ----------
    const S = sel => document.querySelector(sel);
    const SA = sel => Array.from(document.querySelectorAll(sel));
    const T = el => (el?.textContent || '').trim();
    const V = el => (el?.value || '').trim();
    function isVisible(el) { return !!el && el.offsetParent !== null; }
    async function waitFor(fn, { timeout = 10000, interval = 100 } = {}) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const v = fn();
            if (v) return v;
            await new Promise(r => setTimeout(r, interval));
        }
        return null;
    }
    async function waitForSelector(sel, { root = document, timeout = 10000, interval = 100 } = {}) {
        return waitFor(() => {
            const el = root.querySelector(sel);
            return (el && isVisible(el)) ? el : null;
        }, { timeout, interval });
    }
    async function waitForText(el, predicate, opts = {}) {
        return waitFor(() => {
            const txt = T(el);
            return predicate(txt) ? txt : null;
        }, opts);
    }
    function parseCityStateZip(line) {
        const m = (line || '').trim().match(/^(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
        return m ? { city: m[1], state: m[2], zip: m[3] } : { city: '', state: '', zip: '' };
    }
    function toMMDDYYYY(s) {
        if (!s) return '';
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (!m) return s;
        const mm = String(m[1]).padStart(2, '0');
        const dd = String(m[2]).padStart(2, '0');
        let yyyy = m[3];
        if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 30 ? '19' : '20') + yyyy;
        return `${mm}/${dd}/${yyyy}`;
    }
    function formatPhone(digits) {
        const d = (digits || '').replace(/[^\d]/g, '');
        if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
        return digits || '';
    }
    function toNameCase(s) {
        if (!s) return '';
        const str = String(s).trim().toLowerCase();
        let out = '', upperNext = true;
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (/[a-z]/.test(ch) && upperNext) { out += ch.toUpperCase(); upperNext = false; }
            else { out += ch; upperNext = /[\s\-']/.test(ch); }
        }
        return out;
    }

    /******************************************
     * Build the in-menu QQC module (Shadow)
     ******************************************/
    function buildQQCModule(root) {
        const mountEl = root.querySelector('#qqc_mod_mount');
        if (!mountEl) return;
        mountEl.innerHTML = `
      <div class="qqc-wrap">
        <div class="qqc-grid">
          <div class="qqc-row">
            <label>Contact Type</label>
            <select id="qqc_ct">
              <option>Prospects</option>
              <option>Customers</option>
            </select>
          </div>
          <div class="qqc-row">
            <label>Customer Type</label>
            <select id="qqc_cust">
              <option>Personal</option>
              <option>Commercial</option>
            </select>
          </div>

          <div class="qqc-row">
            <div>
              <label>First</label>
              <input id="qqc_first" placeholder="First name">
            </div>
            <div>
              <label>Middle</label>
              <input id="qqc_middle" placeholder="M">
            </div>
          </div>
          <div class="qqc-row">
            <div>
              <label>Last</label>
              <input id="qqc_last" placeholder="Last name">
            </div>
            <div>
              <label>Suffix</label>
              <input id="qqc_suffix" placeholder="Jr, Sr, III">
            </div>
          </div>

          <div>
            <label>Business Name <span class="chip">Commercial</span></label>
            <input id="qqc_biz" placeholder="If commercial">
          </div>

          <div class="qqc-row">
            <div>
              <label>Phone</label>
              <input id="qqc_phone" placeholder="(###) ###-#### or raw digits">
            </div>
            <div>
              <label>Email</label>
              <input id="qqc_email" placeholder="name@email.com">
            </div>
          </div>

          <div class="qqc-row">
            <div>
              <label>DOB</label>
              <input id="qqc_dob" placeholder="MM/DD/YYYY">
            </div>
            <div>
              <label>EIN</label>
              <input id="qqc_ein" placeholder="##-#######">
            </div>
          </div>

          <div>
            <label>Street</label>
            <input id="qqc_addr1" placeholder="Line 1">
          </div>
          <div>
            <label>Line 2</label>
            <input id="qqc_addr2" placeholder="Apt, Unit, Suite">
          </div>
          <div class="qqc-row">
            <div><label>City</label><input id="qqc_city"></div>
            <div><label>State</label><input id="qqc_state" placeholder="NC"></div>
          </div>
          <div>
            <label>Zip</label>
            <input id="qqc_zip" placeholder="27526">
          </div>

          <div class="qqc-actions">
            <button class="mci-inline-btn" id="qqc_detect">Auto Detect</button>
            <button class="mci-inline-btn" id="qqc_sendqq_inner">Send to QQ</button>
            <button class="mci-inline-btn" id="qqc_clearui">Clear</button>
          </div>
          <div class="qqc-status" id="qqc_status"></div>
        </div>
      </div>
    `;

        const qs = id => mountEl.querySelector(id);

        function status(msg) { const s = qs('#qqc_status'); if (s) { s.textContent = msg || ''; } }

        function readUI() {
            const get = id => qs(id)?.value?.trim() || '';
            const payload = {
                carrier: location.hostname, sourceUrl: location.href,
                firstName: toNameCase(get('#qqc_first')), middleName: get('#qqc_middle'), lastName: toNameCase(get('#qqc_last')), suffix: get('#qqc_suffix'),
                businessName: get('#qqc_biz'),
                primaryPhone: get('#qqc_phone').replace(/[^\d]/g, ''), phoneType: get('#qqc_phone'),
                primaryEmail: get('#qqc_email').toLowerCase(),
                dob: get('#qqc_dob'),
                ein: get('#qqc_ein'),
                contactType: qs('#qqc_ct')?.value || 'Prospects',
                customerType: (qs('#qqc_cust')?.value) || (get('#qqc_biz') ? 'Commercial' : 'Personal'),
                status: 'Active',
                address: { line1: get('#qqc_addr1'), line2: get('#qqc_addr2'), city: get('#qqc_city'), state: get('#qqc_state'), zip: get('#qqc_zip') }
            };
            return payload;
        }
        function writeUI(p) {
            const set = (id, v) => { const el = qs(id); if (el) el.value = v || ''; };
            set('#qqc_first', toNameCase(p.firstName));
            set('#qqc_middle', p.middleName);
            set('#qqc_last', toNameCase(p.lastName));
            set('#qqc_suffix', p.suffix);
            set('#qqc_biz', p.businessName);
            set('#qqc_phone', p.phoneType || formatPhone(p.primaryPhone));
            set('#qqc_email', p.primaryEmail);
            set('#qqc_dob', p.dob);
            set('#qqc_ein', p.ein);
            set('#qqc_addr1', p.address?.line1);
            set('#qqc_addr2', p.address?.line2);
            set('#qqc_city', p.address?.city);
            set('#qqc_state', p.address?.state);
            set('#qqc_zip', p.address?.zip);
            const ct = qs('#qqc_ct'); if (ct) ct.value = p.contactType || 'Prospects';
            const cu = qs('#qqc_cust'); if (cu) cu.value = p.customerType || (p.businessName ? 'Commercial' : 'Personal');
        }

        // ---- Detectors (NatGen, Erie, Erie Profile, Erie Mendix) ----
        function isNatGenNamedInsured() {
            return /natgenagency\.com$/i.test(location.hostname) && /QuoteNamedInsured\.aspx$/i.test(location.pathname);
        }
        function extractNatGenNamedInsured() {
            const gv = id => (S('#' + id)?.value || '').trim();
            const tv = sel => (S(sel)?.value || '').trim();
            const firstName = gv('ctl00_MainContent_InsuredNamed1_txtInsFirstName');
            const middleName = gv('ctl00_MainContent_InsuredNamed1_txtInsMiddleName');
            const lastName = gv('ctl00_MainContent_InsuredNamed1_txtInsLastName');
            const suffix = tv('#ctl00_MainContent_InsuredNamed1_ddlInsSuffix');
            const p1 = gv('ctl00_MainContent_InsuredNamed1_ucPhonesV2_PhoneNumber1_txtPhone1');
            const p2 = gv('ctl00_MainContent_InsuredNamed1_ucPhonesV2_PhoneNumber1_txtPhone2');
            const p3 = gv('ctl00_MainContent_InsuredNamed1_ucPhonesV2_PhoneNumber1_txtPhone3');
            const primaryPhone = (p1 + p2 + p3).replace(/[^\d]/g, '');
            const phoneDisplay = (p1 && p2 && p3) ? `(${p1}) ${p2}-${p3}` : '';
            const primaryEmail = gv('ctl00_MainContent_InsuredNamed1_txtInsEmail');
            const dob = gv('ctl00_MainContent_InsuredNamed1_txtInsDOB');
            const addr1 = gv('ctl00_MainContent_InsuredNamed1_txtInsAdr');
            const addr2 = gv('ctl00_MainContent_InsuredNamed1_txtInsAdr2');
            const city = gv('ctl00_MainContent_InsuredNamed1_txtInsCity');
            const state = tv('#ctl00_MainContent_InsuredNamed1_ddlInsState');
            const zip = gv('ctl00_MainContent_InsuredNamed1_txtInsZip');
            return {
                carrier: 'NatGen', sourceUrl: location.href,
                firstName, middleName, lastName, suffix,
                primaryPhone, phoneType: phoneDisplay,
                primaryEmail, dob,
                address: { line1: addr1, line2: addr2, city, state, zip }
            };
        }
        function isNatGenSummary() {
            return /natgenagency\.com$/i.test(location.hostname) && !!S('#ctl00_MainContent_InsuredInfo1_lblInsName');
        }
        function extractNatGenSummary() {
            const name = T(S('#ctl00_MainContent_InsuredInfo1_lblInsName'));
            const [firstName, ...rest] = name.split(/\s+/);
            const lastName = rest.join(' ');
            const addr1 = T(S('#ctl00_MainContent_InsuredInfo1_lblInsAdr'));
            const csz = T(S('#ctl00_MainContent_InsuredInfo1_lblInsCityStateZip'));
            let city = '', state = '', zip = ''; const m = csz.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
            if (m) { city = m[1]; state = m[2]; zip = m[3]; }
            const phoneRaw = T(S('#ctl00_MainContent_InsuredInfo1_lblInsPhone'));
            const parts = phoneRaw.split('|').map(s => s.trim());
            const phoneDisplay = (parts[0] || '').replace(/\s{2,}/g, ' ').replace(/\s-\s/g, '-');
            const primaryPhone = phoneDisplay.replace(/[^\d]/g, '');
            const primaryEmail = T(S('#ctl00_MainContent_InsuredInfo1_lblInsEmail'));
            return {
                carrier: 'NatGen', sourceUrl: location.href,
                firstName, lastName,
                primaryPhone, phoneType: phoneDisplay,
                primaryEmail,
                address: { line1: addr1, line2: '', city, state, zip }
            };
        }

        function isEriePLW() {
            return /agentexchange\.com$/i.test(location.hostname) && /\/PersonalLinesWeb\/?/i.test(location.pathname);
        }
        async function revealEriePLWDob() {
            const isMasked = (s) => !s || s.includes('*') || (s.replace(/[^\d]/g, '').length < 6);
            const grabDobText = () => {
                const container = S('.Column-Customer') || document;
                const spans = Array.from(container.querySelectorAll('.named-insured-value span, .named-insured-value .obscured-text-field-container span')).filter(isVisible);
                for (const el of spans) {
                    const txt = (el.textContent || '').trim();
                    const m = txt.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
                    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
                }
                return '';
            };
            const clickRevealNearDob = async () => {
                const container = S('.Column-Customer') || document;
                const dobBlocks = Array.from(container.querySelectorAll('.editor-block')).filter(b => /date\s*of\s*birth/i.test((b.textContent || '')));
                for (const block of dobBlocks) {
                    const btn = block.querySelector('.reveal-data-btn');
                    if (btn && isVisible(btn)) {
                        btn.click();
                        for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 150)); const v = grabDobText(); if (!isMasked(v)) return; }
                    }
                }
                const any = Array.from(document.querySelectorAll('.reveal-data-btn')).find(isVisible);
                if (any) {
                    any.click();
                    for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 150)); const v = grabDobText(); if (!isMasked(v)) return; }
                }
            };
            let dob = grabDobText();
            if (isMasked(dob)) { await clickRevealNearDob(); dob = grabDobText(); }
            if (isMasked(dob)) {
                const dobInput = S('#txtDateOfBirth_1');
                if (dobInput && V(dobInput)) dob = V(dobInput);
            }
            if (isMasked(dob)) return '';
            return toMMDDYYYY(dob);
        }
        function parseEriePLWPhone() {
            const ro = SA('.Column-Customer .named-insured-value').find(e => /\(\d{3}\)\s*\d{3}-\d{4}/.test(T(e)));
            if (ro) {
                const num = T(ro).replace(/[^\d]/g, '');
                const display = formatPhone(num);
                return { primaryPhone: num, phoneType: display };
            }
            const inp = S('#FirstNamedInsuredNumber_0');
            const primaryPhone = inp ? V(inp).replace(/[^\d]/g, '') : '';
            const phoneType = formatPhone(primaryPhone);
            return { primaryPhone, phoneType };
        }
        function parseEriePLWEmail() {
            const ro = S('.Column-Customer .customer-lockdown-email');
            if (ro && T(ro)) return T(ro);
            const inp = S('#FirstNamedInsured_EmailAddress');
            return inp ? V(inp) : '';
        }
        function parseEriePLWName() {
            const first = V(S('#FirstNamedInsured_FirstName'));
            const middle = V(S('#FirstNamedInsured_MiddleName'));
            const last = V(S('#FirstNamedInsured_LastName'));
            if (first && last) return { firstName: first, middleName: middle, lastName: last };
            const opt = S('#ddlFirstNamedInsured option:checked');
            const text = T(opt);
            if (text) {
                const parts = text.split(/\s+/);
                return { firstName: parts[0] || '', middleName: '', lastName: parts.slice(1).join(' ') || '' };
            }
            return { firstName: '', middleName: '', lastName: '' };
        }
        function parseEriePLWAddress() {
            const el = S('#mailing-address-text');
            if (!el) return { line1: '', line2: '', city: '', state: '', zip: '' };
            const html = el.innerHTML || '';
            const parts = html.split(/<br\s*\/?>/i).map(s => s.replace(/<[^>]*>/g, '').trim()).filter(Boolean);
            const line1 = parts[0] || '';
            let city = '', state = '', zip = '';
            if (parts[1]) {
                const csz = parseCityStateZip(parts[1]);
                city = csz.city; state = csz.state; zip = csz.zip;
            }
            return { line1, line2: '', city, state, zip };
        }
        function parseEriePLWSecondContact() {
            const root = S('.Column.Col2.Column-Customer') || S('#ddlSecondNamedInsured')?.closest('.Column') || document;
            if (!root) return null;
            let firstName = V(root.querySelector('#SecondNamedInsured_FirstName'));
            let middleName = V(root.querySelector('#SecondNamedInsured_MiddleName'));
            let lastName = V(root.querySelector('#SecondNamedInsured_LastName'));
            if (!firstName || !lastName) {
                const opt = root.querySelector('#ddlSecondNamedInsured option:checked');
                const text = (opt?.textContent || '').trim();
                if (text && !/^\-\s*None\s*\-$/i.test(text)) {
                    const parts = text.split(/\s+/);
                    firstName = parts[0] || '';
                    lastName = parts.slice(1).join(' ') || '';
                }
            }
            if (!(firstName || lastName)) return null;
            // Phone
            let phoneDisplay = '';
            let primaryPhone = '';
            const roPhone = (root !== document) && Array.from(root.querySelectorAll('.named-insured-value')).find(e => /\(\d{3}\)\s*\d{3}-\d{4}/.test((e.textContent || '').trim()));
            if (roPhone) {
                phoneDisplay = (roPhone.textContent || '').trim();
                primaryPhone = phoneDisplay.replace(/[^\d]/g, '');
            } else {
                const inp = root.querySelector('#SecondNamedInsuredNumber_0');
                if (inp) {
                    primaryPhone = V(inp).replace(/[^\d]/g, '');
                    phoneDisplay = formatPhone(primaryPhone);
                }
            }
            // Email
            let primaryEmail = (root !== document ? (root.querySelector('.customer-lockdown-email')?.textContent || '').trim() : '');
            if (!primaryEmail) {
                const ei = root.querySelector('#SecondNamedInsured_EmailAddress');
                primaryEmail = V(ei);
            }
            // DOB
            const grabDob = () => {
                const cands = [
                    '.named-insured-value .obscured-text-field-container span',
                    '.named-insured-value span',
                    '.named-insured-value'
                ];
                for (const sel of cands) {
                    const el = Array.from(root.querySelectorAll(sel)).find(isVisible);
                    const txt = (el?.textContent || '').trim();
                    const m = txt && txt.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
                    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
                }
                const inp = root.querySelector('#txtDateOfBirth_2');
                return V(inp);
            };
            let dob = grabDob();
            if (dob && /\*/.test(dob)) dob = '';
            dob = toMMDDYYYY(dob || '');
            return {
                firstName, middleName, lastName,
                primaryPhone, phoneType: phoneDisplay,
                primaryEmail,
                dob,
                relationship: 'Spouse'
            };
        }
        async function extractEriePLW() {
            const { firstName, middleName, lastName } = parseEriePLWName();
            const { primaryPhone, phoneType } = parseEriePLWPhone();
            const primaryEmail = parseEriePLWEmail();
            const dob = await revealEriePLWDob();
            const licenseNumber = V(S('#licenseNumber1')) || '';
            const licenseState = V(S('#selLicenseState1')) || T(S('#selLicenseState1 option:checked')) || '';
            const address = parseEriePLWAddress();
            const suffix = V(S('#FirstNamedInsured_Suffix')) || '';
            const second = parseEriePLWSecondContact();
            return {
                carrier: 'Erie-PLW', sourceUrl: location.href,
                firstName, middleName, lastName, suffix,
                primaryPhone, phoneType, primaryEmail, dob,
                licenseNumber, licenseState,
                contactType: 'Customers', customerType: 'Personal',
                address,
                additionalContacts: second ? [second] : []
            };
        }
        function isErieProfile() {
            return /agentexchange\.com$/i.test(location.hostname) && /^\/Customer\/Profile\/?/i.test(location.pathname);
        }
        async function extractErieProfile() {
            const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
            let primaryEmail = '';
            const emailAnchor = await waitFor(() => document.querySelector('a.party-view-email-value, .email-container a.mx-link, a.mx-link.mx-name-actionButton4.party-view-email-value'), { timeout: 3000, interval: 100 });
            const emailText = (emailAnchor?.textContent || '').trim();
            if (emailRe.test(emailText)) primaryEmail = emailText.match(emailRe)[0];
            if (!primaryEmail) {
                const anchors = Array.from(document.querySelectorAll('a'));
                for (const a of anchors) {
                    const m = (a.textContent || '').match(emailRe);
                    if (m) { primaryEmail = m[0]; break; }
                }
            }
            const businessName = (document.querySelector('span.mx-name-txt_legalName2')?.textContent || '').trim();
            async function readProfileEIN() {
                const span = document.querySelector('span.mx-name-lbl_SsnValue4');
                const eye = document.querySelector('a.mx-link.mx-name-actionButton3.organization-view-eye-icon-link');
                if (!span) return '';
                let val = (span.textContent || '').trim();
                const isMasked = (t) => /\*/.test(t) || t.replace(/[^\d]/g, '').length < 9;
                if (isMasked(val) && eye) {
                    eye.click();
                    await waitForText(span, t => !isMasked(t), { timeout: 4000, interval: 150 });
                    val = (span.textContent || '').trim();
                }
                const m = val.match(/\d{2}-\d{7}/);
                return m ? m[0] : val;
            }
            const phoneText = (document.querySelector('.phone-list .mx-name-lbl_MailAddress2')?.textContent || '').trim();
            const primaryPhone = phoneText.replace(/[^\d]/g, '');
            const addrText = (document.querySelector('.address-list .mx-name-lbl_MailAddress2')?.textContent || '').replace(/\r/g, '');
            const lines = (addrText || '').split('\n').map(s => s.trim()).filter(Boolean);
            let line1 = '', city = '', state = '', zip = '';
            if (lines.length) {
                line1 = lines[0];
                const tail = lines[lines.length - 1];
                const csz = tail && tail.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
                if (csz) { city = csz[1]; state = csz[2]; zip = csz[3]; }
            }
            const ein = await readProfileEIN();
            return {
                carrier: 'Erie-Profile', sourceUrl: location.href,
                businessName,
                primaryPhone, phoneType: formatPhone(primaryPhone),
                primaryEmail,
                ein,
                dob: '', licenseNumber: '', licenseState: '',
                contactType: 'Customers', customerType: businessName ? 'Commercial' : 'Personal',
                address: { line1, line2: '', city, state, zip }
            };
        }
        function hasErieProfileEmailAnchor() {
            return !!document.querySelector('a.party-view-email-value, a.mx-link.mx-name-actionButton4.party-view-email-value');
        }
        function isErieMendix() {
            return /customerdatamanagement\.agentexchange\.com$/i.test(location.hostname);
        }
        async function extractErieMendix() {
            const businessName = T(S('span.mx-name-txt_legalName2'));
            const eye = S('a.mx-link[cssselectorhelper="UnMask"]');
            if (eye) eye.click();
            const einEl = await waitFor(() => S('span.mx-name-lbl_SsnValue4'), { timeout: 8000 });
            let ein = '';
            if (einEl) {
                await waitForText(einEl, t => /\d{2}-\d{7}/.test(t) || (t.replace(/[^\d]/g, '').length === 9), { timeout: 4000 });
                const txt = T(einEl);
                const m = txt.match(/(\d{2}-\d{7})/);
                ein = (m ? m[1] : txt).replace(/[^\d-]/g, '');
            }
            const addrBlockRaw = T(S('.address-list .address-edit-addressline2 .mx-name-lbl_MailAddress2'));
            const addrLines = addrBlockRaw.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
            let line1 = '', city = '', state = '', zip = '';
            if (addrLines.length) {
                line1 = addrLines[0];
                const tail = addrLines[addrLines.length - 1];
                const csz = parseCityStateZip(tail);
                city = csz.city; state = csz.state; zip = csz.zip;
            }
            const primaryPhone = (T(S('.phone-list .mx-name-lbl_MailAddress2')) || '').replace(/[^\d]/g, '');
            let primaryEmail = '';
            const anchorEmail = document.querySelector('a.party-view-email-value, a.mx-link.mx-name-actionButton4.party-view-email-value');
            const anchorText = (anchorEmail?.textContent || '').trim();
            const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
            if (emailRe.test(anchorText)) {
                primaryEmail = anchorText.match(emailRe)[0];
            } else {
                const spanEmail = T(S('.email-list .mx-name-lbl_MailAddress2'));
                primaryEmail = spanEmail || '';
            }
            return {
                carrier: 'Erie-Mendix', sourceUrl: location.href,
                businessName,
                primaryPhone, phoneType: formatPhone(primaryPhone),
                primaryEmail: primaryEmail && primaryEmail !== '-' ? primaryEmail : '',
                ein,
                contactType: 'Customers', customerType: 'Commercial',
                address: { line1, line2: '', city, state, zip }
            };
        }

        async function autoDetect() {
            try {
                if (hasErieProfileEmailAnchor()) return await extractErieProfile();
                if (isNatGenNamedInsured()) return extractNatGenNamedInsured();
                if (isNatGenSummary()) return extractNatGenSummary();
                if (isEriePLW()) return await extractEriePLW();
                if (isErieProfile()) return await extractErieProfile();
                if (isErieMendix()) return await extractErieMendix();
            } catch (e) { console.error(e); }
            return { carrier: location.hostname, sourceUrl: location.href, address: {} };
        }

        // --- Wire module buttons ---
        qs('#qqc_detect')?.addEventListener('click', async () => {
            status('Detecting...');
            const p = await autoDetect();
            lastExtracted = p;
            try { await GM_setValue(STORAGE_KEY, p); } catch { }
            writeUI(p);
            status(`Detected from ${p.carrier || 'page'}.`);
        });
        qs('#qqc_clearui')?.addEventListener('click', () => {
            writeUI({
                firstName: '', middleName: '', lastName: '', suffix: '',
                businessName: '', primaryPhone: '', phoneType: '', primaryEmail: '', dob: '', ein: '',
                contactType: 'Prospects', customerType: 'Personal',
                address: { line1: '', line2: '', city: '', state: '', zip: '' }
            });
            status('Cleared.');
        });

        async function sendToQQ() {
            const ui = readUI();
            const payload = Object.assign({}, lastExtracted || {}, ui);
            try { await GM_setValue(STORAGE_KEY, payload); } catch { }
            try { await GM_setValue(PENDING_KEY, { payload, ts: Date.now(), stage: 'popup' }); } catch { }
            status('Sending to QQ...');
            let opened = false;
            try {
                const newWin = window.open('', '_blank');
                if (newWin) {
                    try { newWin.opener = null; } catch { }
                    newWin.location = QQ_CONTACTS_URL;
                    opened = true;
                }
            } catch (err) {
                console.warn('Unable to open QQ in new tab', err);
            }
            if (!opened) {
                try { window.open(QQ_CONTACTS_URL, '_self'); }
                catch { location.href = QQ_CONTACTS_URL; }
            }
        }
        qs('#qqc_sendqq_inner')?.addEventListener('click', sendToQQ);
        mountEl.__qqcApi = { sendToQQ, autoDetect, readUI, writeUI, status };
        mountEl.dataset.ready = '1';

        // Auto-run one detect immediately on open for convenience
        (async () => {
            try {
                const p = await autoDetect();
                lastExtracted = p;
                try { await GM_setValue(STORAGE_KEY, p); } catch { }
                writeUI(p);
                status(`Detected from ${p.carrier || 'page'}.`);
            } catch { status('Auto-detect failed.'); }
        })();
    }

    function ensureQQCModule(root) {
        const mountEl = root.getElementById('qqc_mod_mount');
        if (!mountEl) return null;
        if (!mountEl.dataset.ready) {
            buildQQCModule(root);
        }
        return mountEl;
    }

    async function showQQCOverlay(root, { autoDetect = false, autoSend = false } = {}) {
        const overlay = root.getElementById('qqc_overlay');
        if (!overlay) return;
        const mountEl = ensureQQCModule(root);
        overlay.style.display = 'block';
        overlay.dataset.visible = '1';
        overlay.style.transform = 'none';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        if (overlay.dataset.userPositioned === '1') clampOverlayWithinViewport(overlay);
        else centerOverlayElement(overlay);
        if (autoDetect && mountEl?.__qqcApi?.autoDetect) {
            try { await mountEl.__qqcApi.autoDetect(); }
            catch (err) { console.error('QQC autoDetect failed', err); }
        }
        if (autoSend && mountEl?.__qqcApi?.sendToQQ) {
            try { await mountEl.__qqcApi.sendToQQ(); }
            catch (err) { console.error('QQC auto send failed', err); }
        }
    }

    function hideQQCOverlay(root) {
        const overlay = root.getElementById('qqc_overlay');
        if (!overlay) return;
        overlay.style.display = 'none';
        overlay.dataset.visible = '0';
    }

    /*******************************
     * QQ AUTOFILL IMPLEMENTATION  *
     *******************************/
    function setVal(el, val) {
        if (!el) return;
        const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype
            : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                : HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc && desc.set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function selectByText(select, desired) {
        if (!select || !desired) return false;
        const opts = Array.from(select.options || []);
        const dn = desired.toLowerCase();
        let v = opts.find(o => o.textContent.trim().toLowerCase() === dn)?.value;
        if (!v) v = opts.find(o => o.textContent.trim().toLowerCase().includes(dn))?.value;
        if (v != null) { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        return false;
    }
    function setDateValue(input, mmddyyyy) {
        if (!input) return;
        input.focus();
        const proto = Object.getPrototypeOf(input) || HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, mmddyyyy);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }
    function onDetailsPage() { return /\/Contacts\/Customer\/Details\/\d+/i.test(location.pathname); }

    async function ensurePopupOpen() {
        hudInfo('Opening New Contact popup...');
        const pop = document.querySelector('#add-contact-pop');
        if (pop && pop.offsetParent !== null) return pop;
        const triggers = Array.from(document.querySelectorAll('a,button'))
            .filter(e => /new contact|add contact|create contact/i.test(e.textContent || ''));
        for (const t of triggers) { t.click(); await new Promise(r => setTimeout(r, 300)); const p = document.querySelector('#add-contact-pop'); if (p && p.offsetParent !== null) return p; }
        const found = document.querySelector('#add-contact-pop') || null;
        if (!found) hudError('Could not open popup');
        return found;
    }
    function desiredPhoneCategory(payload) {
        const t = (payload.phoneType || '').toLowerCase();
        const known = ['cell', 'home', 'work', 'mobile', 'business cell', 'other'];
        if (known.some(k => t.includes(k))) {
            if (t.includes('mobile')) return 'Cell';
            return payload.phoneType;
        }
        return payload.businessName ? 'Business Cell' : 'Cell';
    }

    async function fillPopup(payload) {
        const pop = await ensurePopupOpen();
        if (!pop) return false;
        await waitForSelector('#txtFirst', { root: pop, timeout: 8000, interval: 100 });
        hudInfo('Filling popup...');

        selectByText(pop.querySelector('#selContactType'), payload.contactType || 'Prospects');
        const custTypeSel = pop.querySelector('#selCustomerType select, #selCustomerType .sel-sub-type, select[name="selCustomerType"]');
        selectByText(custTypeSel, payload.customerType || (payload.businessName ? 'Commercial' : 'Personal'));
        selectByText(pop.querySelector('#selCurrStat'), payload.status || 'Active');

        await new Promise(r => setTimeout(r, 150));

        if (payload.businessName) setVal(pop.querySelector('#txtBusiness'), payload.businessName || '');
        setVal(pop.querySelector('#txtFirst'), payload.firstName || '');
        setVal(pop.querySelector('#txtLast'), payload.lastName || '');
        setVal(pop.querySelector('#txtPhone'), payload.primaryPhone || '');

        const phoneCat = desiredPhoneCategory(payload);
        selectByText(pop.querySelector('#selPhoneType'), phoneCat);

        const emailEl = await waitForSelector('#txtEmail', { root: pop, timeout: 8000, interval: 100 });
        if (emailEl) {
            try { emailEl.focus(); } catch { }
            setVal(emailEl, (payload.primaryEmail || '').toLowerCase());
            emailEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            emailEl.dispatchEvent(new Event('change', { bubbles: true }));
            try { emailEl.blur(); } catch { }
            await new Promise(r => setTimeout(r, 120));
        }
        selectByText(pop.querySelector('#selEmailType'), payload.businessName ? 'Professional' : 'Personal');

        const add = pop.querySelector('#addcontactbtn');
        if (!add) return false;
        add.click();
        hudInfo('Popup submitted. Waiting for details...');
        try { await GM_setValue(PENDING_KEY, { payload, ts: Date.now(), stage: 'details' }); } catch { }
        return true;
    }

    function fillBasicContactInfo(payload) {
        const basic = document.querySelector('form#BasicContactInfo');
        if (!basic) return false;
        const phoneInput = basic.querySelector('[data-section="phone"] input[name="Value"]') || basic.querySelector('.PhoneTemplateContainer input[name="Value"]');
        if (phoneInput) setVal(phoneInput, payload.primaryPhone || '');
        const phoneType = basic.querySelector('.PhoneTypes');
        if (phoneType) selectByText(phoneType, desiredPhoneCategory(payload));
        const emailInput = basic.querySelector('.EmailTemplateContainer input[name="Value"]');
        if (emailInput) setVal(emailInput, (payload.primaryEmail || '').toLowerCase());
        const save = basic.querySelector('.SectionButtons .section_save');
        if (save) { try { save.classList.remove('hide'); save.style.removeProperty('display'); } catch { } save.click(); }
        return true;
    }

    async function ensureAddressEditorOpen() {
        let link = await waitFor(() => Array.from(document.querySelectorAll('a.h2AddRecordLink')).find(a => /add an address/i.test(a.textContent || '') && a.offsetParent !== null), { timeout: 8000, interval: 150 });
        if (!link) link = await waitFor(() => Array.from(document.querySelectorAll('a,button')).find(a => /add an address/i.test(a.textContent || '') && a.offsetParent !== null), { timeout: 8000, interval: 150 });
        if (link) {
            try { link.scrollIntoView({ block: 'center' }); } catch { }
            link.click();
            const editor = await waitForSelector('.AddressesDetailContainer .section-detaildata input[name="Line1"]', { timeout: 15000, interval: 150 });
            return !!editor;
        }
        const already = document.querySelector('.AddressesDetailContainer .section-detaildata input[name="Line1"]');
        return !!already;
    }
    async function fillAddress(payload) {
        hudInfo('Filling Address...');
        const opened = await ensureAddressEditorOpen();
        if (!opened) return false;
        const detail = Array.from(document.querySelectorAll('.AddressesDetailContainer .section-detaildata')).find(d => d.offsetParent !== null)
            || document.querySelector('.AddressesDetailContainer .section-detaildata');
        if (!detail) return false;

        const setField = (sel, val) => { const el = detail.querySelector(sel); if (!el) return; el.focus(); el.value = val || ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
        const selectIn = (sel, txt) => {
            const el = detail.querySelector(sel);
            if (!el || !txt) return;
            const dn = (txt || '').trim().toLowerCase();
            let opt = Array.from(el.options).find(o => o.textContent.trim().toLowerCase() === dn)
                || Array.from(el.options).find(o => o.textContent.trim().toLowerCase().includes(dn));
            if (!opt) opt = Array.from(el.options).find(o => (o.value || '').trim().toLowerCase() === dn);
            if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
        };

        const countrySel = detail.querySelector('select[name="CountryID"]');
        if (countrySel) {
            const preferUSA = Array.from(countrySel.options).find(o => (o.value || '').toUpperCase() === 'USA');
            const preferText = Array.from(countrySel.options).find(o => o.textContent.trim().toLowerCase() === 'united states');
            const val = (preferUSA?.value) || (preferText?.value) || '';
            if (val && countrySel.value !== val) {
                countrySel.value = val;
                countrySel.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise(r => setTimeout(r, 150));
            }
        }
        setField('input[name="Line1"]', payload.address?.line1 || '');
        setField('input[name="Line2"]', payload.address?.line2 || '');
        setField('input[name="City"]', payload.address?.city || '');

        const stateCode = (payload.address?.state || '').trim();
        if (stateCode.length === 2) {
            const el = detail.querySelector('select[name="StateID"]');
            if (el) {
                const desired = stateCode.toUpperCase();
                let opt = Array.from(el.options).find(o => (o.value || '').toUpperCase() === desired);
                if (!opt) opt = Array.from(el.options).find(o => o.textContent.trim().toLowerCase() === desired.toLowerCase());
                if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
                else { selectIn('select[name="StateID"]', stateCode); }
            }
        } else {
            selectIn('select[name="StateID"]', stateCode);
        }
        setField('input[name="Zip"]', (payload.address?.zip || '').slice(0, 5));
        selectIn('select[name="AddressTypeID"]', payload.address?.addressType || 'Mailing');

        const addrForm = document.querySelector('form#Addresses') || detail.closest('form');
        const save = addrForm?.querySelector('.SectionButtons .section_save') || document.querySelector('form#Addresses .SectionButtons .section_save');
        if (save) {
            try { save.classList.remove('hide'); save.style.removeProperty('display'); } catch { }
            save.click();
            await new Promise(r => setTimeout(r, 300));
        }
        return true;
    }

    async function fillPersonalInfo(payload) {
        const pf = document.querySelector('form#PersonalInfo');
        if (!pf) return false;
        hudInfo('Filling Personal Info...');

        const ensureEdit = async () => {
            try { pf.scrollIntoView({ block: 'center' }); } catch { }
            const saveBtn = pf.querySelector('.SectionButtons .section_save');
            const isVisible = (el) => el && el.offsetParent !== null && !el.classList.contains('hide');
            if (!isVisible(saveBtn)) {
                const editBtn = pf.querySelector('.SectionButtons .section_edit');
                if (editBtn) {
                    editBtn.click();
                    await waitFor(() => {
                        const sb = pf.querySelector('.SectionButtons .section_save');
                        return sb && sb.offsetParent !== null && !sb.classList.contains('hide');
                    }, { timeout: 5000, interval: 150 });
                }
            }
        };
        await ensureEdit();

        const setField = (sel, val) => { const el = pf.querySelector(sel); if (!el) return; el.focus(); el.value = val || ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
        const selectIn = (sel, txt) => {
            const el = pf.querySelector(sel);
            if (!el || !txt) return;
            const dn = (txt || '').trim().toLowerCase();
            let opt = Array.from(el.options).find(o => o.textContent.trim().toLowerCase() === dn)
                || Array.from(el.options).find(o => o.textContent.trim().toLowerCase().includes(dn));
            if (!opt) opt = Array.from(el.options).find(o => (o.value || '').trim().toLowerCase() === dn);
            if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
        };

        setField('input[name="FirstName"]', payload.firstName || '');
        setField('input[name="MiddleName"]', payload.middleName || '');
        setField('input[name="LastName"]', payload.lastName || '');
        const dobEl = pf.querySelector('input[name="DateOfBirthString"]');
        const dobStr = toMMDDYYYY(payload.dob || '');
        if (dobEl && dobStr) setDateValue(dobEl, dobStr);

        if ((payload.customerType || '').toLowerCase() === 'commercial' || payload.businessName) {
            if (payload.ein) setField('input[name="FEIN"]', payload.ein);
        }
        const save = pf.querySelector('.SectionButtons .section_save');
        if (save) {
            await new Promise(r => setTimeout(r, 150));
            try { save.classList.remove('hide'); save.style.removeProperty('display'); } catch { }
            save.click();
            await new Promise(r => setTimeout(r, 250));
        }
        return true;
    }

    async function ensureAdditionalContactsEditorOpen() {
        const section = await waitFor(() => document.querySelector('.section-container[data-sectionkey="AdditionalContacts"]'), { timeout: 15000, interval: 150 });
        if (!section) return false;
        const sectionSave = section.querySelector('.SectionButtons .section_save');
        const sectionEdit = section.querySelector('.SectionButtons .section_edit');
        const __vis = (el) => el && el.offsetParent !== null && !el.classList.contains('hide');
        if (!__vis(sectionSave) && sectionEdit) {
            try { sectionEdit.scrollIntoView({ block: 'center' }); } catch { }
            sectionEdit.click();
            await waitFor(() => {
                const sb = section.querySelector('.SectionButtons .section_save');
                return sb && __vis(sb);
            }, { timeout: 8000, interval: 120 });
        }
        let link = section && Array.from(section.querySelectorAll('span.h2AddRecord a.add-another-row')).find(a => /add a contact/i.test((a.textContent || '')) && isVisible(a));
        if (!link) link = section && Array.from(section.querySelectorAll('a.add-another-row')).find(a => /add a contact/i.test((a.textContent || '')) && isVisible(a));
        const form = document.querySelector('form#AdditionalContacts');
        const detailVisible = form && isVisible(form.querySelector('.AdditionalContactsDetailContainer')) && form.querySelector('.AdditionalContactsDetailContainer .section-detaildata input[name="FirstName"]');
        if (detailVisible) return true;
        if (link) {
            try { link.scrollIntoView({ block: 'center' }); } catch { }
            link.click();
            const editor = await waitForSelector('form#AdditionalContacts .AdditionalContactsDetailContainer .section-detaildata input[name="FirstName"]', { timeout: 20000, interval: 150 });
            return !!editor;
        }
        return false;
    }
    async function fillAdditionalContact(contact) {
        hudInfo('Adding Additional Contact...');
        const opened = await ensureAdditionalContactsEditorOpen();
        if (!opened) return false;
        const form = document.querySelector('form#AdditionalContacts');
        const detail = Array.from(form.querySelectorAll('.AdditionalContactsDetailContainer .section-detaildata')).find(d => d.offsetParent !== null) || form.querySelector('.AdditionalContactsDetailContainer .section-detaildata');
        if (!detail) return false;

        const isVisible = (el) => el && el.offsetParent !== null && !(el.classList?.contains('hide'));
        const saveBtn = form.querySelector('.SectionButtons .section_save');
        if (!isVisible(saveBtn)) {
            const editBtn = form.querySelector('.SectionButtons .section_edit');
            if (editBtn) {
                try { editBtn.scrollIntoView({ block: 'center' }); } catch { }
                editBtn.click();
                await waitFor(() => {
                    const sb = form.querySelector('.SectionButtons .section_save');
                    return sb && isVisible(sb);
                }, { timeout: 8000, interval: 120 });
            }
        }
        const setField = (sel, val) => { const el = detail.querySelector(sel); if (!el) return; el.focus(); el.value = val || ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
        const selectIn = (sel, txt) => { const el = detail.querySelector(sel); if (!el || !txt) return; const dn = (txt || '').trim().toLowerCase(); let opt = Array.from(el.options).find(o => o.textContent.trim().toLowerCase() === dn) || Array.from(el.options).find(o => o.textContent.trim().toLowerCase().includes(dn)); if (!opt) opt = Array.from(el.options).find(o => (o.value || '').trim().toLowerCase() === dn); if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); } };

        setField('input[name="FirstName"]', toNameCase(contact.firstName));
        setField('input[name="MiddleName"]', contact.middleName || '');
        setField('input[name="LastName"]', toNameCase(contact.lastName));
        const dobStr = toMMDDYYYY(contact.dob || ''); if (dobStr) setField('input[name="DateOfBirthString"]', dobStr);

        const rel = (contact.relationship || '').toLowerCase();
        if (rel) {
            const isRelative = /(spouse|husband|wife|child|parent|relative|domestic|partner|brother|sister|roommate|resident)/i.test(contact.relationship || '');
            selectIn('select[name="RelationCategoryID"]', isRelative ? 'Relative' : 'Non Relative');
            await new Promise(r => setTimeout(r, 120));
            selectIn('select[name="RelationID"]', contact.relationship);
        }

        if (contact.address) {
            const countrySel = detail.querySelector('select[name="CountryID"]');
            if (countrySel) {
                let val = Array.from(countrySel.options).find(o => (o.value || '').toUpperCase() === 'USA')?.value;
                if (!val) val = Array.from(countrySel.options).find(o => o.textContent.trim().toLowerCase() === 'united states')?.value;
                if (val) { countrySel.value = val; countrySel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 120)); }
            }
            setField('input[name="Line1"]', contact.address.line1 || '');
            setField('input[name="Line2"]', contact.address.line2 || '');
            setField('input[name="City"]', contact.address.city || '');
            const st = (contact.address.state || '').trim(); if (st) selectIn('select[name="StateID"]', st);
            setField('input[name="Zip"]', (contact.address.zip || '').slice(0, 5));
        }

        const phoneInput = detail.querySelector('.PhoneTemplateContainer [data-section="phone"] input[name="Value"], .PhoneTemplateContainer input[name="Value"]');
        if (phoneInput) {
            setField('[data-section="phone"] input[name="Value"], .PhoneTemplateContainer input[name="Value"]', (contact.primaryPhone || '').replace(/[^\d]/g, ''));
            const phoneTypeSel = detail.querySelector('.PhoneTemplateContainer .PhoneTypes');
            if (phoneTypeSel) selectIn('.PhoneTemplateContainer .PhoneTypes', (contact.phoneType || '').toLowerCase().includes('mobile') ? 'Cell' : (contact.phoneType || ''));
        }
        const emailInput = detail.querySelector('.EmailTemplateContainer input[name="Value"]');
        if (emailInput) setField('.EmailTemplateContainer input[name="Value"]', (contact.primaryEmail || '').toLowerCase());

        const save = form.querySelector('.SectionButtons .section_save');
        if (save) {
            try { save.classList.remove('hide'); save.style.removeProperty('display'); } catch { }
            save.click();
            const spinner = form.querySelector('.SectionButtons .section_saving');
            for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); if (!spinner || spinner.style.display === 'none') break; }
            await new Promise(r => setTimeout(r, 200));
        }
        return true;
    }

    async function runFillDetails(payload) {
        if (!onDetailsPage()) return;
        hudInfo('Filling Basic Contact...');
        await waitFor(() => document.querySelector("form#BasicContactInfo"), { timeout: 15000, interval: 150 });
        const ok1 = fillBasicContactInfo(payload);

        hudInfo('Filling Address...');
        await waitFor(() => document.querySelector("form#Addresses"), { timeout: 15000, interval: 150 });
        const ok2 = await fillAddress(payload);

        hudInfo('Filling Personal Info...');
        await waitFor(() => document.querySelector("form#PersonalInfo"), { timeout: 15000, interval: 150 });
        const ok3 = await fillPersonalInfo(payload);

        let ok4 = true;
        if (Array.isArray(payload.additionalContacts) && payload.additionalContacts.length) {
            hudInfo('Adding Additional Contact...');
            for (const c of payload.additionalContacts) {
                const r = await fillAdditionalContact(c);
                ok4 = ok4 && !!r;
            }
        }
        if (ok1 && ok2 && ok3 && ok4) hudOk('QQC fill complete');
        else hudError('QQC fill incomplete');
    }


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

    // ---------- Auto-run after navigation to QQ ----------
    (async () => {
        try {
            const pending = await GM_getValue(PENDING_KEY);
            if (pending && pending.payload && /qqcatalyst\.com$/i.test(location.hostname)) {
                const fresh = (Date.now() - (pending.ts || 0)) < 3 * 60 * 1000;
                if (!fresh) { await GM_setValue(PENDING_KEY, {}); return; }
                if (pending.stage === 'popup' && !onDetailsPage()) {
                    await waitFor(() => document.readyState === 'complete' ? true : null, { timeout: 15000, interval: 200 });
                    hudInfo('Opening popup and submitting...');
                    const pop = await ensurePopupOpen();
                    if (pop) { await fillPopup(pending.payload); }
                    return;
                }
                if (onDetailsPage()) {
                    hudInfo('Filling details...');
                    await waitFor(() => document.querySelector('form#BasicContactInfo') || document.querySelector('form#PersonalInfo') || document.querySelector('form#Addresses'), { timeout: 20000, interval: 200 });
                    await runFillDetails(pending.payload);
                    await GM_setValue(PENDING_KEY, {});
                }
            }
        } catch { }
    })();
})();
