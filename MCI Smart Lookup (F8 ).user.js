// ==UserScript==
// MCI internal tooling
// Copyright (c) 2025 Middle Creek Insurance. All rights reserved.
// Not authorized for redistribution or resale.
// @name         MCI Smart Lookup (F8 Universal + Vexcel)
// @namespace    mci-tools
// @version      1.29
// @description  F8 on hover/selection: LinkedIn, Wake+Maps+Vexcel, Erie (WWW), NatGen, Progressive (FAO). Tab title shows detected type. On-site automations run ONLY when triggered by F8.
// @match        *://*/*
// @match        file://*/*
// @match        https://services.wake.gov/realestate/*
// @match        https://www.linkedin.com/*
// @match        https://portal.agentexchange.com/*
// @match        https://www.agentexchange.com/*
// @match        https://agentexchange.com/*
// @match        https://natgenagency.com/*
// @match        https://app.vexcelgroup.com/*
// @match        https://www.foragentsonly.com/*
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// @allFrames    true
// @updateURL    https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Smart%20Lookup%20(F8%20).user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Smart%20Lookup%20(F8%20).user.js
// ==/UserScript==
(function(){
  "use strict";

  /* ============ CONFIG ============ */
  const CFG = {
    wakeAutoFollow: true,
    mapsRegionHint: "Wake County, NC",
    stripStreetTypes: ["rd","road","dr","drive","st","street","ave","avenue","blvd","boulevard","ct","court","trl","trail","ln","lane","way","pkwy","parkway","cir","circle","ter","terrace","pl","place","hwy","highway"],
    indicatorTimeout: 2500,
    armedTTLms: 60000
  };

  // IMPORTANT: use WWW for Erie (this matches your working script)
  const ERIE_ORIGIN = "https://www.agentexchange.com";
  const ERIE_PATH   = "/Customer/Search";

  const NG_ORIGIN   = "https://natgenagency.com";
  const NG_PATH     = "/MainMenu.aspx";

  // Progressive (FAO)
  const PR_ORIGIN   = "https://www.foragentsonly.com";
  const K_PR_RAN    = "mci.pr.ran"; // sessionStorage one-run flag

  // Vexcel
  const VEX_ORIGIN  = "https://app.vexcelgroup.com";     // SPA root

  const K_ERIE_POL="carrier.erie.pol", K_ERIE_AWAIT="carrier.erie.await";
  const K_NG_POL="carrier.ng.pol",     K_NG_AWAIT="carrier.ng.await";

  const K_VEX_ADDR="vexcel.addr";       // sessionStorage key for address
  const K_VEX_AWAIT="vexcel.await";

  // arming gate keys
  const K_ARMED   = "mci.f8.armed";
  const K_ARMED_TS= "mci.f8.armed.ts";

  /* ============ URL PARAM HELPERS ============ */
  function getHashParams(){
    // supports:
    //  - Erie/NatGen: "#pol=...&mci=1&ts=..."
    //  - Vexcel: "#/app/home?address=...&mci=1&ts=..."
    try{
      const h = String(location.hash || "").replace(/^#/, "");
      const qIndex = h.indexOf("?");
      const qs = (qIndex >= 0) ? h.slice(qIndex + 1) : h;
      return new URLSearchParams(qs);
    }catch(_){}
    return new URLSearchParams("");
  }

  function tokenOKFromLocation(){
    try{
      const ttl = CFG.armedTTLms || 60000;

      // hash token
      const hp = getHashParams();
      const mciH = hp.get("mci");
      const tsH  = parseInt(hp.get("ts") || "0", 10);
      if (mciH === "1" && tsH && (Date.now() - tsH) <= ttl) return { ok:true, ts: tsH };

      // query token (Wake + Progressive uses query)
      const sp = new URLSearchParams(location.search || "");
      const mciQ = sp.get("mci");
      const tsQ  = parseInt(sp.get("ts") || "0", 10);
      if (mciQ === "1" && tsQ && (Date.now() - tsQ) <= ttl) return { ok:true, ts: tsQ };

    }catch(_){}
    return { ok:false, ts:0 };
  }

  /* ============ ARMING HELPERS ============ */
  function armAutomations(ts){
    const stamp = ts || Date.now();
    try{
      sessionStorage.setItem(K_ARMED, "1");
      sessionStorage.setItem(K_ARMED_TS, String(stamp));
    }catch(_){}
    return stamp;
  }

  function disarmAutomations(){
    try{
      sessionStorage.removeItem(K_ARMED);
      sessionStorage.removeItem(K_ARMED_TS);
    }catch(_){}
  }

  function isArmed(){
    try{
      const ttl = CFG.armedTTLms || 60000;
      const now = Date.now();

      // same-tab arm
      if (sessionStorage.getItem(K_ARMED) === "1"){
        const ts = parseInt(sessionStorage.getItem(K_ARMED_TS) || "0", 10);
        if (ts && (now - ts) <= ttl) return true;
      }

      // token in URL (new tab)
      const tok = tokenOKFromLocation();
      if (tok.ok) return true;

    }catch(_){}
    return false;
  }

  /* ============ TOAST ============ */
  GM_addStyle(`
    .mci-toast{position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);
      background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px/1.35 system-ui,Segoe UI,Arial;
      box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:.95;pointer-events:none}
  `);
  function toast(msg,ms=1600){
    const t=document.createElement("div");
    t.className="mci-toast"; t.textContent=msg; document.body.appendChild(t);
    setTimeout(()=>t.remove(),ms);
  }

  /* ============ TAB TITLE INDICATOR ============ */
  let baseTitle=document.title||"";
  function setTab(dot,label){
    clearTimeout(setTab.timer);
    document.title = `${dot} ${label}`;
    setTab.timer = setTimeout(()=>{ document.title = baseTitle; }, CFG.indicatorTimeout);
  }

  /* ============ HOVER / SELECTION ============ */
  let lastHoverText="";
  document.addEventListener("mouseover",(e)=>{
    const t=(e.target&&(e.target.innerText||e.target.textContent)||"").trim();
    if(t) lastHoverText=t;
  },{capture:true,passive:true});
  function getSelectedOrHoverText(){
    const sel=(window.getSelection&&window.getSelection().toString().trim())||"";
    if(sel) return sel;
    return (lastHoverText||"").trim();
  }

  /* ============ DETECTION HELPERS ============ */
  const RE = {
    ERIE_FMT1:  /^[A-Z]\d{2}-\d{6,}$/,
    HYPHENATED: /\b([A-Z0-9]{1,4}-\d{5,12})\b/,
    DIGITS:     /^\d{11,}$/,
    PR_DIGITS:  /^\d{8,10}$/
  };
  const norm=s=>(s||"").replace(/\s+/g," ").trim();

  function isLikelyAddress(s){
    const txt=s.replace(/[,]/g," ").replace(/\s+/g," ").trim();
    return /^\d+\s+[\w\s.-]+$/.test(txt);
  }
  function normalizeAddressForWake(s){
    let parts=s.replace(/[,]/g," ").replace(/\s+/g," ").trim().split(" ");
    if(!/^\d+$/.test(parts[0])) return null;
    const stnum=parts.shift();
    if(parts.length>=2){
      const last=parts[parts.length-1].toLowerCase().replace(/\./g,"");
      if(CFG.stripStreetTypes.includes(last)) parts.pop();
    }
    const stname=parts.join(" ");
    return { stnum, stname };
  }

  // Name cleaners
  function extractLeadingName(raw){
    let s = raw
      .replace(/\s+/g, " ")
      .replace(/[,\u2013\u2014-]\s*(first\s+named\s+insured|named\s+insured|insured|policyholder|applicant|contact|primary)\b.*$/i, "")
      .replace(/\s*\((first\s+named\s+insured|named\s+insured|insured|policyholder|applicant|primary)\)\s*$/i, "")
      .trim();
    s = s.split(/\s+[-–—]\s+|\s*\/\s*|\s*\|\s*|\s*·\s*/)[0].trim();
    const m = s.match(/^\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3})\b/u);
    if (m) return m[1];
    const tokens = s.split(" ").filter(Boolean);
    if (tokens.length >= 2 && /^[A-Za-z]/.test(tokens[0])) {
      return tokens.slice(0, Math.min(tokens.length, 4)).join(" ");
    }
    return s;
  }
  function cleanNameForLinkedIn(raw){
    const suffixes=/^(jr|sr|ii|iii|iv|v|vi)\.?$/i;
    const clean=raw.replace(/[,]/g," ").replace(/\s+/g," ").trim();
    const parts=clean.split(" ").filter(Boolean);
    const filtered=[];
    for(const p of parts){
      const naked=p.replace(/\./g,"");
      if(naked.length===1) continue;
      if(suffixes.test(naked)) continue;
      filtered.push(p);
    }
    return (filtered.length>=2 ? filtered.join(" ") : clean);
  }
  function isLikelyName(s){
    const clean=s.replace(/[,]/g," ").replace(/\s+/g," ").trim();
    const parts=clean.split(" ").filter(Boolean);
    if(parts.length<2 || parts.length>5) return false;
    return parts.every(p=>/^[\p{L}'\-\.]+$/u.test(p));
  }

  // Policy detection and routing
  function extractPolicy(txt){
    if(!txt) return null;
    const s=String(txt);

    const erieExact=s.match(RE.ERIE_FMT1)?.[0];
    if(erieExact) return erieExact;

    const hyp=s.match(RE.HYPHENATED)?.[0];
    if(hyp) return hyp;

    // NatGen (11+ digits)
    const digits=(s.match(/\b\d{11,}\b/)||[])[0];
    if(digits) return digits;

    // Progressive (8-10 digits) — only after address/name checks upstream
    const pr=(s.match(/\b\d{8,10}\b/)||[])[0];
    return pr||null;
  }
  function detectCarrier(pol){
    if(!pol) return null;
    if (RE.DIGITS.test(pol)) return "natgen";
    if (RE.PR_DIGITS.test(pol)) return "progressive";
    return "erie";
  }

  /* ============ OPENERS (PASS TOKEN) ============ */
  function openVexcel(addressRaw){
    const addr = (addressRaw || "").replace(/\s+/g, " ").trim();
    const ts = armAutomations(Date.now());

    try {
      sessionStorage.setItem(K_VEX_ADDR, addr);
      sessionStorage.setItem(K_VEX_AWAIT, "1");
    } catch(_) {}

    toast(`Vexcel: loading map for “${addr}”...`, 3000);

    // Vexcel route params live AFTER the hash '?'
    GM_openInTab(
      VEX_ORIGIN + "/#/app/home?address=" + encodeURIComponent(addr) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      {active:false, insert:true}
    );
  }

  function openAddressLookups(rawAddress){
    const raw = (rawAddress || "").replace(/\s+/g, " ").trim();
    const normd = normalizeAddressForWake(raw);
    if(!normd){ toast("Doesn't look like a Wake address."); return; }

    const ts = armAutomations(Date.now());

    const { stnum, stname } = normd;
    const wakeURL =
      `https://services.wake.gov/realestate/ValidateAddress.asp?stnum=${encodeURIComponent(stnum)}&stname=${encodeURIComponent(stname)}&locidList=&spg=&mci=1&ts=${encodeURIComponent(String(ts))}`;

    const mapsQ   = CFG.mapsRegionHint ? `${raw}, ${CFG.mapsRegionHint}` : raw;
    const mapsURL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQ)}`;

    GM_openInTab(wakeURL,{active:true,insert:true});
    GM_openInTab(mapsURL,{active:false,insert:true});
    openVexcel(raw);

    toast(`Opening Wake, Maps & Vexcel for: ${raw}`);
  }
  function openWakeAndMaps(rawAddress){ openAddressLookups(rawAddress); }

  function openNameLookups(nameRaw){
    const leading = extractLeadingName(nameRaw);
    const cleaned = cleanNameForLinkedIn(leading);
    const liURL=`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleaned)}`;
    GM_openInTab(liURL,{active:true,insert:true});
    toast(`LinkedIn: ${cleaned}`);
  }

  function openErie(pol){
    const ts = armAutomations(Date.now());
    try {
      sessionStorage.setItem(K_ERIE_POL, pol);
      sessionStorage.setItem(K_ERIE_AWAIT, "1");
    } catch(_) {}

    window.open(
      ERIE_ORIGIN + ERIE_PATH + "#pol=" + encodeURIComponent(pol) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      "_blank"
    );
    toast(`Erie: ${pol}`);
  }

  function openNatGen(pol){
    const ts = armAutomations(Date.now());
    try{
      sessionStorage.setItem(K_NG_POL,pol);
      sessionStorage.setItem(K_NG_AWAIT,"1");
    }catch(_){}

    window.open(
      NG_ORIGIN + NG_PATH + "#pol=" + encodeURIComponent(pol) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      "_blank"
    );
    toast(`NatGen: ${pol}`);
  }

  function openProgressive(pol){
    const ts = armAutomations(Date.now());
    try{
      GM_setValue("mci.pr.pol", String(pol));
      GM_setValue("mci.pr.ts", String(ts));
      GM_deleteValue("mci.pr.ran");
    }catch(_){}
    // FAO sometimes normalizes/strips query params; rely on GM storage instead of URL params.
    window.open("https://www.foragentsonly.com/home/", "_blank");
    toast(`Progressive: ${pol}`);
  }

  /* ============ TAB INDICATOR ============ */
  function updateTabIndicator(){
    const txt=getSelectedOrHoverText();
    if(!txt){ document.title = baseTitle; return; }
    let dot="⚫", label="";
    if(isLikelyAddress(txt)){ dot="🟩"; label=`Address: ${txt}`; }
    else if(isLikelyName(extractLeadingName(txt))){ dot="🔵"; label=`Name: ${txt}`; }
    else {
      const pol = extractPolicy(txt);
      if(pol){
        const c = detectCarrier(pol);
        if(c==="erie"){ dot="🟧"; label=`Erie ${pol}`; }
        else if(c==="natgen"){ dot="🟣"; label=`NatGen ${pol}`; }
        else { dot="🟦"; label=`Progressive ${pol}`; }
      }
    }
    setTab(dot,label);
  }
  document.addEventListener("mousemove", updateTabIndicator, {capture:true, passive:true});
  document.addEventListener("mouseover", updateTabIndicator, {capture:true, passive:true});

  /* ============ F8 ACTION ============ */
  document.addEventListener("keydown",(e)=>{
    if(e.key!=="F8") return;

    const tag=(e.target&&e.target.tagName||"").toLowerCase();
    if((tag==="input"||tag==="textarea"||e.target.isContentEditable) && !window.getSelection().toString()){
      return; // require selection inside editable fields
    }

    e.preventDefault();

    // IMPORTANT: arming happens ONLY on F8
    armAutomations(Date.now());

    const txt=getSelectedOrHoverText();
    if(!txt){ toast("Select or hover a name/address/policy, then press F8."); return; }

    if(isLikelyAddress(txt)) { openAddressLookups(txt); return; }

    const addrCandidate = txt.match(/\b\d+\s+[A-Za-z0-9 .,'-]+\b(?:.*)?/);
    if(addrCandidate){ openAddressLookups(addrCandidate[0]); return; }

    if(isLikelyName(extractLeadingName(txt))) { openNameLookups(txt); return; }

    const pol = extractPolicy(txt);
    if(pol){
      const c=detectCarrier(pol);
      if(c==="natgen") openNatGen(pol.replace(/-/g,""));
      else if(c==="progressive") openProgressive(pol);
      else openErie(pol);
      return;
    }

    openNameLookups(txt);
  },true);

  /* ============ ON-SITE AUTOMATIONS (ONLY IF F8-TOKEN / ARMED) ============ */

  // Wake: auto-follow to Account
  (function wakeAutoFollow(){
    if(!/services\.wake\.gov\/realestate\/ValidateAddress\.asp/i.test(location.href)) return;
    if(!CFG.wakeAutoFollow) return;

    // Only run if this tab is armed (via mci=1&ts=... or session)
    const tok = tokenOKFromLocation();
    if (tok.ok) armAutomations(tok.ts);
    if(!isArmed()) return;

    const tryClick=()=>{
      const link=document.querySelector('a[href*="Account.asp"]');
      if(link){ link.click(); return true; }
      return false;
    };
    let attempts=0;
    const iv=setInterval(()=>{
      attempts++;
      if(tryClick()||attempts>30){
        clearInterval(iv);
        disarmAutomations();
      }
    },150);
  })();

  // ERIE side (WWW)
  if (location.hostname === "www.agentexchange.com" || location.hostname === "agentexchange.com") {
    (function erieRun(){

      // Must have token or stored armed
      const tok = tokenOKFromLocation();
      if (tok.ok) armAutomations(tok.ts);
      if(!isArmed()) return;

      // get pol from hash if present
      const m = (location.hash || "").match(/[#&]pol=([^&]+)/i);
      const hasHash = !!m;
      let pol = hasHash ? decodeURIComponent(m[1]) : "";

      // allow legacy await fallback (still gated)
      if (!pol) {
        const awaiting = sessionStorage.getItem(K_ERIE_AWAIT) === "1";
        if (!awaiting) return;
        pol = sessionStorage.getItem(K_ERIE_POL) || "";
        if (!pol) return;
      }

      // Keep token when redirecting
      const hp = getHashParams();
      const keepTs = hp.get("ts") || String(Date.now());

      if (!location.pathname.toLowerCase().startsWith(ERIE_PATH.toLowerCase())) {
        try { sessionStorage.setItem(K_ERIE_POL, pol); sessionStorage.setItem(K_ERIE_AWAIT, "1"); } catch(_) {}
        location.replace(
          ERIE_ORIGIN + ERIE_PATH +
          "#pol=" + encodeURIComponent(pol) +
          "&mci=1&ts=" + encodeURIComponent(keepTs)
        );
        return;
      }

      const visible = el => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return !!(el.offsetParent || r.width || r.height);
      };

      function observeUntil(predicate, timeoutMs=5000, root=document){
        return new Promise(resolve => {
          const first = predicate();
          if (first) return resolve(first);
          const obs = new MutationObserver(() => {
            const el = predicate();
            if (el) { obs.disconnect(); resolve(el); }
          });
          obs.observe(root === document ? document.documentElement : root, {childList:true,subtree:true,attributes:true,characterData:true});
          setTimeout(() => { obs.disconnect(); resolve(predicate()); }, timeoutMs);
        });
      }

      function finish(){
        try { history.replaceState(null, "", location.pathname + location.search); } catch(_) {}
        try { sessionStorage.removeItem(K_ERIE_POL); sessionStorage.removeItem(K_ERIE_AWAIT); } catch(_) {}
        disarmAutomations();
      }

      function flipDropdown(){
        const ddl = document.querySelector("#dropdown-select");
        if (ddl && ddl.value !== "0") {
          ddl.value = "0";
          ddl.dispatchEvent(new Event("input",{bubbles:true}));
          ddl.dispatchEvent(new Event("change",{bubbles:true}));
        }
        // Angular poke
        const s=document.createElement("script");
        s.textContent="(()=>{try{var el=document.querySelector('#dropdown-select');if(!el)return; if(window.angular&&angular.element){var sc=angular.element(el).scope()||(angular.element(el).isolateScope&&angular.element(el).isolateScope()); if(sc){sc.searchType='0'; if(typeof sc.searchTypeChanged==='function') sc.searchTypeChanged(); if(sc.$applyAsync) sc.$applyAsync(); else if(sc.$apply) sc.$apply();}} el.value='0'; el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}})()";
        document.documentElement.appendChild(s); s.remove();
      }

      function findPolicyInput(){
        let el = document.querySelector("#policyNumber, #policyNumber-txt, input[name='policyNumber']");
        if (el && visible(el)) return el;

        const all = Array.from(document.querySelectorAll("#searchContainer input, #searchContainer input[type='text'], #searchContainer input[type='search']")).filter(i => visible(i));
        const candidates = all.filter(i => {
          if (i.closest && i.closest("#nameAndAdvSrch")) return false;
          const sig = ((i.placeholder||"")+" "+(i.name||"")+" "+(i.id||"")+" "+(i.getAttribute("aria-label")||"")).toLowerCase();
          return /policy/.test(sig) || /number/.test(sig);
        });
        if (candidates.length) return candidates[0];

        const nameSection = document.querySelector("#nameAndAdvSrch");
        const nameVisible = nameSection && visible(nameSection);
        if (!nameVisible && all.length === 1) return all[0];

        return null;
      }

      (async function main(){
        await observeUntil(() => document.querySelector("#dropdown-select"), 7000);

        let tries = 0;
        let input = null;
        while (tries < 16 && !input){
          tries++;
          flipDropdown();
          input = findPolicyInput();
          if (!input) await new Promise(r => setTimeout(r, 300));
        }
        if (!input) { finish(); return; }

        input.focus();
        input.value = pol;
        input.dispatchEvent(new Event("input",{bubbles:true}));
        input.dispatchEvent(new Event("change",{bubbles:true}));

        const btn = document.querySelector("#btnSearch") ||
                    Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"))
                      .find(b => /search/i.test(norm(b.innerText || b.textContent || b.value || "")));
        if (btn) btn.click();

        const row = await observeUntil(() => {
          const r = document.querySelector("#custSrchResults .custResListArr");
          return r && visible(r) ? r : null;
        }, 8000);

        if (row) {
          const link =
            row.querySelector("#resCustName") ||
            row.querySelector(".custName") ||
            row.querySelector("[ng-click*='gotoCustomerDetail']") ||
            row.querySelector("a");
          if (link) link.click();
          else row.click();
        }

        finish();
      })();

    })();
  }

  // NATGEN side
  if (location.hostname === "natgenagency.com") {
    (function natgenAuto(){

      const tok = tokenOKFromLocation();
      if (tok.ok) armAutomations(tok.ts);
      if(!isArmed()) return;

      const hp = getHashParams();
      const polFromHash = hp.get("pol") || "";

      let pol = polFromHash;
      if (!pol) {
        const awaiting = sessionStorage.getItem(K_NG_AWAIT) === "1";
        if (!awaiting) return;
        pol = sessionStorage.getItem(K_NG_POL) || "";
        if (!pol) return;
      }

      const keepTs = hp.get("ts") || String(Date.now());

      const finish=()=>{
        try{ history.replaceState(null,"",location.pathname+location.search);}catch(_){}
        try{ sessionStorage.removeItem(K_NG_POL); sessionStorage.removeItem(K_NG_AWAIT);}catch(_){}
        disarmAutomations();
      };

      function visible(el){ if(!el) return false; const r=el.getBoundingClientRect(); return !!(el.offsetParent||r.width||r.height); }
      function waitForSel(selector, timeout=12000){
        return new Promise(resolve=>{
          const t0=performance.now();
          const iv=setInterval(()=>{
            const el=document.querySelector(selector);
            if(el && visible(el)){ clearInterval(iv); resolve(el); }
            else if(performance.now()-t0>timeout){ clearInterval(iv); resolve(null); }
          },150);
        });
      }

      (async ()=>{
        // Ensure we are on MainMenu.aspx; if not, redirect WITH token preserved
        if (!/\/MainMenu\.aspx$/i.test(location.pathname)) {
          try{
            sessionStorage.setItem(K_NG_POL, pol);
            sessionStorage.setItem(K_NG_AWAIT,"1");
          }catch(_){}

          location.replace(
            NG_ORIGIN + NG_PATH +
            "#pol=" + encodeURIComponent(pol) +
            "&mci=1&ts=" + encodeURIComponent(keepTs)
          );
          return;
        }

        const input = await waitForSel("#ctl00_MainContent_wgtMainMenuFindPolicy_txtSearchString", 12000);
        if(!input){ finish(); return; }

        const digits = String(pol).replace(/-/g,"");
        input.focus();
        input.value = digits;
        input.dispatchEvent(new Event("input",{bubbles:true}));
        input.dispatchEvent(new Event("change",{bubbles:true}));

        const ddl=document.querySelector("#ctl00_MainContent_wgtMainMenuFindPolicy_ddlAction");
        if(ddl && ddl.value!=="0"){
          ddl.value="0";
          ddl.dispatchEvent(new Event("change",{bubbles:true}));
        }

        const btn=document.querySelector("#ctl00_MainContent_wgtMainMenuFindPolicy_btnSearch");
        if(btn) btn.click();

        finish();
      })();

    })();
  }

  


// PROGRESSIVE (FAO) — on https://www.foragentsonly.com/home/ :
// Select Policy, fill policy number, click Search, then STOP.
// FAO often strips query params; we persist the policy + timestamp via GM_setValue on F8.
if (/(\.|^)foragentsonly\.com$/i.test(location.hostname)) {
  (function progressiveAuto(){
    // One-run guard (per-tab + global)
    try { if (sessionStorage.getItem("mci.pr.ran") === "1") return; } catch(_){}
    try { if (GM_getValue("mci.pr.ran","0") === "1") return; } catch(_){}

    let pol = "";
    let ts  = 0;
    try {
      pol = String(GM_getValue("mci.pr.pol","") || "").trim();
      ts  = parseInt(String(GM_getValue("mci.pr.ts","0") || "0"), 10) || 0;
    } catch(_){}

    if (!pol || !ts) return;

    // Use a longer TTL for FAO because login/redirect can be slow.
    const ttl = 10 * 60 * 1000; // 10 minutes
    const age = Date.now() - ts;
    if (age > ttl) return;

    function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

    async function waitFor(getter, timeoutMs){
      const t0 = performance.now();
      while (performance.now() - t0 < timeoutMs){
        let el = null;
        try { el = getter(); } catch(_){}
        if (el) return el;
        await sleep(150);
      }
      return null;
    }

    function setNativeValue(input, value){
      try{
        const proto = (input && input.tagName === "TEXTAREA") ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
      }catch(_){
        try{ input.value = value; }catch(__){}
      }
    }

    function dbg(msg){
      try { console.log("[MCI PR]", msg); } catch(_){}
    }

    async function run(){
      // Quick debug ping so we can tell it ran at all
      dbg("running on " + location.href + " pol=" + pol + " ageMs=" + age);

      // Give SPA time to mount
      await sleep(800);

      // 1) Select Policy radio (exists even when Customer view is active)
      const radio = await waitFor(() => document.querySelector("#SBP_PolSearch"), 60000);
      const label = document.querySelector('label[for="SBP_PolSearch"]');
      if (radio) {
        try { radio.click(); } catch(_){ try{ label && label.click(); }catch(__){} }
        dbg("clicked Policy radio");
      } else if (label) {
        try { label.click(); } catch(_){}
        dbg("clicked Policy label");
      } else {
        dbg("Policy radio/label not found");
        return;
      }

      // 2) Wait for Policy input to exist (it may be created after toggling)
      const polInput = await waitFor(() =>
          document.querySelector("#SBP_UserSelectedPol") ||
          document.querySelector('input[name="SBP_UserSelectedPol"]') ||
          document.querySelector("input.js-search-bar__policy") ||
          document.querySelector('input[aria-label="Policy Number"]'),
        60000
      );
      if (!polInput) { dbg("policy input not found"); return; }

      // 3) Fill
      try{
        polInput.focus();
        setNativeValue(polInput, "");
        polInput.dispatchEvent(new Event("input",{bubbles:true}));
        await sleep(80);

        setNativeValue(polInput, String(pol));
        polInput.dispatchEvent(new Event("input",{bubbles:true}));
        polInput.dispatchEvent(new Event("change",{bubbles:true}));
        dbg("filled policy input");
      }catch(e){ dbg("fill error: " + (e && e.message ? e.message : e)); }

      // 4) Click Search
      const searchBtn = await waitFor(() =>
          document.querySelector("#sbp-search") ||
          document.querySelector("button.js-search-bar__search"),
        60000
      );
      if (!searchBtn) { dbg("search button not found"); return; }

      await sleep(120);
      try { searchBtn.click(); dbg("clicked search"); } catch(e){ dbg("click error: " + (e && e.message ? e.message : e)); }

      // Stop running again + cleanup
      try { sessionStorage.setItem("mci.pr.ran", "1"); } catch(_){}
      try { GM_setValue("mci.pr.ran", "1"); } catch(_){}
      try { GM_deleteValue("mci.pr.pol"); GM_deleteValue("mci.pr.ts"); } catch(_){}
    }

    run();
  })();
}




  /* ============ VEXCEL (app.vexcelgroup.com) — route with ?address=... + centered loading overlay ============ */
  if (location.hostname === "app.vexcelgroup.com") {
    (function vexcelAuto(){

      // token/arming gate
      const tok = tokenOKFromLocation();
      if (tok.ok) armAutomations(tok.ts);
      if(!isArmed()) return;

      const wantParams = getHashParams();
      const addrFromHash = wantParams.get("address") ? decodeURIComponent(wantParams.get("address")) : null;

      const storedFlag = sessionStorage.getItem(K_VEX_AWAIT) === "1";
      const storedAddr = sessionStorage.getItem(K_VEX_ADDR) || "";

      if (!addrFromHash && !(storedFlag && storedAddr)) return;

      const addr = (addrFromHash || storedAddr || "").trim();
      if (!addr) { sessionStorage.removeItem(K_VEX_AWAIT); disarmAutomations(); return; }

      const s = document.createElement("script");
      s.textContent = `(() => {
        const ADDR = ${JSON.stringify(addr)};

        const sleep = ms => new Promise(r=>setTimeout(r, ms));
        const visible = el => !!el && (()=>{const r=el.getBoundingClientRect();return !!(el.offsetParent||r.width||r.height);})();

        function addOverlay(text){
          const id = "mci-vexcel-overlay";
          if (document.getElementById(id)) return id;

          const style = document.createElement("style");
          style.id = id + "-style";
          style.textContent = \`
            @keyframes mci-spin { to { transform: rotate(360deg); } }
            #\${id}{
              position: fixed; inset: 0; background: rgba(0,0,0,.45);
              display: flex; align-items: center; justify-content: center;
              z-index: 2147483647;
            }
            #\${id} .card{
              background: #121212; color: #fff; padding: 18px 20px; border-radius: 12px;
              box-shadow: 0 10px 30px rgba(0,0,0,.45); display: flex; align-items: center; gap: 12px;
              font: 14px/1.4 system-ui,Segoe UI,Arial;
              max-width: 80vw;
            }
            #\${id} .spinner{
              width: 18px; height: 18px; border-radius: 50%;
              border: 2px solid rgba(255,255,255,.2); border-top-color: #4da3ff;
              animation: mci-spin .9s linear infinite;
            }
            #\${id} .text{ white-space: nowrap; }
          \`;
          document.head.appendChild(style);

          const overlay = document.createElement("div");
          overlay.id = id;
          overlay.innerHTML = '<div class="card"><div class="spinner"></div><div class="text"></div></div>';
          document.body.appendChild(overlay);
          updateOverlay(text);
          return id;
        }
        function updateOverlay(text){
          const t = document.querySelector("#mci-vexcel-overlay .text");
          if (t) t.textContent = text;
        }
        function removeOverlay(){
          const id="mci-vexcel-overlay";
          document.getElementById(id)?.remove();
          document.getElementById(id+"-style")?.remove();
        }

        (async () => {
          const hasAddressParam = /[?&]address=/i.test(location.hash||"");
          if (!hasAddressParam) {
            location.hash = '#/app/home?address=' + encodeURIComponent(ADDR);
          }

          addOverlay('Loading map for “' + ADDR + '”…');

          if (document.readyState !== 'complete') {
            await new Promise(res => window.addEventListener('load', res, {once:true}));
          }
          await sleep(500);

          const t0 = performance.now();
          while (performance.now() - t0 < 10000) {
            if (/[?&]latitude=/.test(location.hash||"") && /[?&]longitude=/.test(location.hash||"")) {
              updateOverlay("Map centered.");
              await sleep(500);
              removeOverlay();
              return;
            }
            await sleep(200);
          }

          updateOverlay("Finalizing…");
          const input = document.querySelector('#searchText');
          if (input && visible(input)) {
            try { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ADDR); }
            catch { input.value = ADDR; }
            input.dispatchEvent(new InputEvent('input', {bubbles:true, cancelable:true, inputType:'insertFromPaste', data: ADDR}));
            input.dispatchEvent(new Event('change', {bubbles:true, cancelable:true}));
            await sleep(120);
            ['keydown','keypress','keyup'].forEach(type => {
              input.dispatchEvent(new KeyboardEvent(type, {bubbles:true, cancelable:true, key:'Enter', code:'Enter', keyCode:13, which:13}));
            });
            await sleep(800);
          }
          removeOverlay();
        })();
      })();`;

      document.documentElement.appendChild(s);
      s.remove();

      sessionStorage.removeItem(K_VEX_AWAIT);
      try { history.replaceState(null,"", location.pathname + location.search); } catch(_){ }
      disarmAutomations();
    })();
  }

})();
