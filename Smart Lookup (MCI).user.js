// ==UserScript==
// MCI internal tooling
// Copyright (c) 2025 Middle Creek Insurance. All rights reserved.
// Not authorized for redistribution or resale.
// @name        Smart Lookup (MCI)
// @namespace    mci-tools
// @version      4.3.0
// @description  ALT+Right-Click: pinned chooser for Address/Name/Policy. Address: Wake/Maps/Vexcel combos. Name: LinkedIn/Google/Facebook. Policy: Erie/NatGen/Progressive/NFIP
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
// @match        https://nationalgeneral.torrentflood.com/*
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @updateURL   https://raw.githubusercontent.com/Synth6/Tampermonkey/main/Smart%20Lookup%20(MCI).user.js
// @downloadURL https://raw.githubusercontent.com/Synth6/Tampermonkey/main/Smart%20Lookup%20(MCI).user.js
// @run-at       document-idle
// @allFrames    true
// ==/UserScript==

(function(){
  "use strict";

  /* ================= CONFIG ================= */
  const CFG = {
    mapsRegionHint: "Wake County, NC",
    stripStreetTypes: ["rd","road","dr","drive","st","street","ave","avenue","blvd","boulevard","ct","court","trl","trail","ln","lane","way","pkwy","parkway","cir","circle","ter","terrace","pl","place","hwy","highway"],
    indicatorTimeout: 2200,
    armedTTLms: 10 * 60 * 1000,  // 10 minutes
    faoWaitMs: 55 * 1000,        // give FAO up to ~55s after load to reveal search UI
    faoMaxAutoRunsPerTab: 1
  };

  // Erie (WWW)
  const ERIE_ORIGIN = "https://www.agentexchange.com";
  const ERIE_PATH   = "/Customer/Search";

  // NatGen
  const NG_ORIGIN   = "https://natgenagency.com";
  const NG_PATH     = "/MainMenu.aspx";

  // Progressive (FAO)
  const PR_ORIGIN   = "https://www.foragentsonly.com";
  const PR_PATH     = "/";

  // Vexcel
  const VEX_ORIGIN  = "https://app.vexcelgroup.com";

  // NFIP (TorrentFlood)
  const NFIP_ORIGIN = "https://nationalgeneral.torrentflood.com";
  const NFIP_PATH   = "/Dashboard/Agency";

  /* ================= STORAGE KEYS ================= */
  // Erie
  const K_ERIE_POL="carrier.erie.pol", K_ERIE_AWAIT="carrier.erie.await";
  // NatGen
  const K_NG_POL="carrier.ng.pol",     K_NG_AWAIT="carrier.ng.await";
  // NFIP
  const K_NFIP_POL="carrier.nfip.pol", K_NFIP_AWAIT="carrier.nfip.await";
  // Vexcel
  const K_VEX_ADDR="vexcel.addr",      K_VEX_AWAIT="vexcel.await";
  // Progressive
  const K_PR_POL="carrier.pr.pol";
  const K_PR_RAN="carrier.pr.ran";         // per-tab
  const K_PR_PENDING_GM="carrier.pr.pending.gm"; // cross-tab safety
  const K_PR_PENDING_TS="carrier.pr.pending.ts";

  // Arming gate (generic; NOT tied to hotkey anymore)
  const K_ARMED   = "mci.lookup.armed";
  const K_ARMED_TS= "mci.lookup.armed.ts";
  const K_ARMED_GM_TS = "mci.lookup.armed.gm.ts";

  /* ================= URL PARAM HELPERS ================= */
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
      const ttl = CFG.armedTTLms || (10*60*1000);

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

  /* ================= ARMING HELPERS ================= */
  function armAutomations(ts){
    const stamp = ts || Date.now();
    try{
      sessionStorage.setItem(K_ARMED, "1");
      sessionStorage.setItem(K_ARMED_TS, String(stamp));
    }catch(_){}
    // Cross-tab / cross-origin fallback
    try{ if (typeof GM_setValue === "function") GM_setValue(K_ARMED_GM_TS, String(stamp)); }catch(_){}
    return stamp;
  }

  function disarmAutomations(){
    try{
      sessionStorage.removeItem(K_ARMED);
      sessionStorage.removeItem(K_ARMED_TS);
    }catch(_){}
    try{ if (typeof GM_deleteValue === "function") GM_deleteValue(K_ARMED_GM_TS); }catch(_){}
  }

  function isArmed(){
    try{
      const ttl = CFG.armedTTLms || (10*60*1000);
      const now = Date.now();

      // same-tab arm
      if (sessionStorage.getItem(K_ARMED) === "1"){
        const ts = parseInt(sessionStorage.getItem(K_ARMED_TS) || "0", 10);
        if (ts && (now - ts) <= ttl) return true;
      }

      // cross-tab / cross-origin arm (GM storage)
      try{
        if (typeof GM_getValue === "function"){
          const gts = parseInt(GM_getValue(K_ARMED_GM_TS, "0") || "0", 10);
          if (gts && (now - gts) <= ttl) return true;
        }
      }catch(_){}

      // token in URL
      const tok = tokenOKFromLocation();
      if (tok.ok) return true;

    }catch(_){}
    return false;
  }

  /* ================= TOAST ================= */
  GM_addStyle(`
    .mci-toast{position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);
      background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px/1.35 system-ui,Segoe UI,Arial;
      box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:.95;pointer-events:none}
  `);
  function toast(msg,ms=1600){
    try{
      const t=document.createElement("div");
      t.className="mci-toast"; t.textContent=msg; document.body.appendChild(t);
      setTimeout(()=>t.remove(),ms);
    }catch(_){}
  }

  /* ================= TAB TITLE INDICATOR ================= */
  let baseTitle=document.title||"";
  function setTab(dot,label){
    clearTimeout(setTab.timer);
    document.title = `${dot} ${label}`;
    setTab.timer = setTimeout(()=>{ document.title = baseTitle; }, CFG.indicatorTimeout);
  }

  /* ================= HOVER / SELECTION ================= */
  let lastHoverText="";
  document.addEventListener("mouseover",(e)=>{
    const tag=(e.target && e.target.tagName || "").toLowerCase();
    if(tag==="input"||tag==="textarea"||(e.target && e.target.isContentEditable)) return;
    const t=(e.target && (e.target.innerText||e.target.textContent) || "").trim();
    if(t) lastHoverText=t;
  },{capture:true,passive:true});

  function getSelectedOrHoverText(){
    const sel=(window.getSelection&&window.getSelection().toString().trim())||"";
    if(sel) return sel;
    return (lastHoverText||"").trim();
  }

  /* ================= DETECTION HELPERS ================= */
  const RE = {
    ERIE_FMT1:  /^[A-Z]\d{2}-\d{6,}$/,
    HYPHENATED: /\b([A-Z0-9]{1,4}-\d{5,12})\b/,
    DIGITS_8_10:/^\d{8,10}$/,
    DIGITS_11P: /^\d{11,}$/
  };
  const norm=s=>(s||"").replace(/\s+/g," ").trim();

  function isLikelyAddress(s){
    const txt=String(s||"").replace(/[,]/g," ").replace(/\s+/g," ").trim();
    return /^\d+\s+[\w\s.-]+$/.test(txt);
  }
  function normalizeAddressForWake(s){
    let parts=String(s||"").replace(/[,]/g," ").replace(/\s+/g," ").trim().split(" ");
    if(!parts.length || !/^\d+$/.test(parts[0])) return null;
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
    let s = String(raw||"")
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
  function cleanNameForSearch(raw){
    const suffixes=/^(jr|sr|ii|iii|iv|v|vi)\.?$/i;
    const clean=String(raw||"").replace(/[,]/g," ").replace(/\s+/g," ").trim();
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
    const clean=String(s||"").replace(/[,]/g," ").replace(/\s+/g," ").trim();
    const parts=clean.split(" ").filter(Boolean);
    if(parts.length<2 || parts.length>5) return false;
    return parts.every(p=>/^[\p{L}'\-\.]+$/u.test(p));
  }

  // Policy extraction
  function extractPolicy(txt){
    const s=String(txt||"");
    if(!s.trim()) return null;

    // Erie "Q..."
    const q = s.match(/\bQ\d{5,}\b/i);
    if(q) return q[0].toUpperCase();

    const erieExact=s.match(RE.ERIE_FMT1)?.[0];
    if(erieExact) return erieExact;

    const hyp=s.match(RE.HYPHENATED)?.[0];
    if(hyp) return hyp;

    const digits=(s.match(/\b\d{8,}\b/)||[])[0];
    return digits||null;
  }

  /* ================= OPENERS (ARM + PASS TOKEN) ================= */
  function openVexcel(addressRaw){
    const addr = String(addressRaw || "").replace(/\s+/g, " ").trim();
    const ts = armAutomations(Date.now());

    try {
      sessionStorage.setItem(K_VEX_ADDR, addr);
      sessionStorage.setItem(K_VEX_AWAIT, "1");
    } catch(_) {}

    toast(`Vexcel: loading map for “${addr}”...`, 2600);

    GM_openInTab(
      VEX_ORIGIN + "/#/app/home?address=" + encodeURIComponent(addr) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      {active:false, insert:true}
    );
  }

  function openWakeOnly(rawAddress){
    const raw = String(rawAddress || "").replace(/\s+/g, " ").trim();
    const normd = normalizeAddressForWake(raw);
    if(!normd){ toast("Doesn't look like a Wake address."); return; }

    const ts = armAutomations(Date.now());
    const { stnum, stname } = normd;
    const wakeURL =
      `https://services.wake.gov/realestate/ValidateAddress.asp?stnum=${encodeURIComponent(stnum)}&stname=${encodeURIComponent(stname)}&locidList=&spg=&mci=1&ts=${encodeURIComponent(String(ts))}`;

    GM_openInTab(wakeURL,{active:true,insert:true});
    toast(`Wake: ${raw}`);
  }

  function openAddressLookups(rawAddress, mode){
    const raw = String(rawAddress || "").replace(/\s+/g, " ").trim();
    if(mode === "wake") return openWakeOnly(raw);

    const normd = normalizeAddressForWake(raw);
    if(!normd){ toast("Doesn't look like a Wake address."); return; }

    if(mode === "vexcel") { openVexcel(raw); return; }
    if(mode === "maps") {
      const mapsQ   = CFG.mapsRegionHint ? `${raw}, ${CFG.mapsRegionHint}` : raw;
      GM_openInTab(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQ)}`, {active:true, insert:true});
      toast(`Maps: ${raw}`);
      return;
    }

    // default combo: wake+maps+vexcel
    openWakeOnly(raw);
    const mapsQ   = CFG.mapsRegionHint ? `${raw}, ${CFG.mapsRegionHint}` : raw;
    GM_openInTab(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQ)}`, {active:false, insert:true});
    openVexcel(raw);

    toast(`Opening Wake, Maps & Vexcel for: ${raw}`);
  }

  function openNameLookups(nameRaw, mode){
    const leading = extractLeadingName(nameRaw);
    const cleaned = cleanNameForSearch(leading);

    if(mode === "google"){
      const q = cleaned;
      GM_openInTab(`https://www.google.com/search?q=${encodeURIComponent(q)}`, {active:true, insert:true});
      toast(`Google: ${cleaned}`);
      return;
    }
    if(mode === "facebook"){
      // Facebook search works when logged in; if not logged in it will just prompt.
      const q = cleaned;
      GM_openInTab(`https://www.facebook.com/search/people/?q=${encodeURIComponent(q)}`, {active:true, insert:true});
      toast(`Facebook: ${cleaned}`);
      return;
    }

    // default linkedin
    GM_openInTab(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleaned)}`, {active:true, insert:true});
    toast(`LinkedIn: ${cleaned}`);
  }

  function openErie(pol){
    const ts = armAutomations(Date.now());
    const p = String(pol||"").trim().toUpperCase();

    try {
      sessionStorage.setItem(K_ERIE_POL, p);
      sessionStorage.setItem(K_ERIE_AWAIT, "1");
    } catch(_) {}

    window.open(
      ERIE_ORIGIN + ERIE_PATH + "#pol=" + encodeURIComponent(p) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      "_blank"
    );
    toast(`Erie: ${p}`);
  }

  function openNatGen(pol){
    const ts = armAutomations(Date.now());
    const digits = String(pol||"").replace(/\D/g,""); // NatGen wants digits
    if(!digits){ toast("No policy digits detected."); return; }

    try{
      sessionStorage.setItem(K_NG_POL, digits);
      sessionStorage.setItem(K_NG_AWAIT,"1");
    }catch(_){}

    window.open(
      NG_ORIGIN + NG_PATH + "#pol=" + encodeURIComponent(digits) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      "_blank"
    );
    toast(`NatGen: ${digits}`);
  }

  function setProgressivePending(pol, ts){
    const digits = String(pol||"").replace(/\D/g,"");
    if(!digits) return "";
    try { sessionStorage.setItem(K_PR_PENDING_TS, String(ts||Date.now())); } catch(_){}
    try { if (typeof GM_setValue === "function") GM_setValue(K_PR_PENDING_GM, digits); } catch(_){}
    try { if (typeof GM_setValue === "function") GM_setValue(K_PR_POL, digits); } catch(_){}
    return digits;
  }
  function openNFIP(pol){
    const ts = armAutomations(Date.now());
    const p = String(pol||"").trim();
    if(!p){ toast("No policy detected."); return; }

    try{
      sessionStorage.setItem(K_NFIP_POL, p);
      sessionStorage.setItem(K_NFIP_AWAIT,"1");
    }catch(_){}

    window.open(
      NFIP_ORIGIN + NFIP_PATH + "#pol=" + encodeURIComponent(p) + "&mci=1&ts=" + encodeURIComponent(String(ts)),
      "_blank"
    );
    toast(`NFIP: ${p}`);
  }



  function openProgressive(pol){
    const ts = armAutomations(Date.now());
    const digits = setProgressivePending(pol, ts);
    if(!digits){ toast("No policy digits detected."); return; }

    window.open(
      PR_ORIGIN + PR_PATH + "?mci=1&ts=" + encodeURIComponent(String(ts)) + "&pol=" + encodeURIComponent(digits),
      "_blank"
    );
    toast(`Progressive: ${digits}`);
  }

  /* ================= ALT+RIGHT-CLICK CHOOSER (PINNED) ================= */
  GM_addStyle(`
    #mci-hover-chooser{
      position:fixed; z-index:2147483647; display:none;
      background:rgba(15,15,15,.94); color:#fff;
      border:1px solid rgba(255,255,255,.14);
      border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,.38);
      padding:8px; font:12px/1.25 system-ui,Segoe UI,Arial;
      width: 200px;
      min-width: 150px;
    }
    #mci-hover-chooser .row{display:flex; align-items:center; gap:8px;}
    #mci-hover-chooser .lbl{opacity:.85; font-size:11px; white-space:nowrap;}
    #mci-hover-chooser select{
      flex:1; width:100%;
      padding:6px 8px; border-radius:8px;
      border:1px solid rgba(255,255,255,.14);
      background:#ffffff; color:#111;
      outline:none;
    }
    #mci-hover-chooser select option{ color:#111; background:#fff; }
    #mci-hover-chooser .sub{
      margin-top:6px; opacity:.8; font-size:11px;
      max-width:520px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    #mci-hover-chooser button{
      cursor:pointer;border:1px solid rgba(255,255,255,.14);
      background:#ffffff;color:#111;border-radius:8px;padding:6px 8px;line-height:1;
    }
  `);

  const HoverChooser = (function(){
    let el=null, sel=null, sub=null;
    let x=40, y=40;

    function ensure(){
      if(el) return;

      el=document.createElement("div");
      el.id="mci-hover-chooser";
      el.innerHTML=`
        <div class="row">
          <div class="lbl">Open:</div>
          <select id="mci-hc-select"></select>
          <button id="mci-hc-close" title="Close">✕</button>
        </div>
        <div class="sub" id="mci-hc-sub"></div>
      `;
      document.body.appendChild(el);

      sel=el.querySelector("#mci-hc-select");
      sub=el.querySelector("#mci-hc-sub");

      el.querySelector('#mci-hc-close').addEventListener('click', hide, true);

      window.addEventListener("keydown",(e)=>{ if(e.key==="Escape") hide(); }, true);

      // click outside to close
      window.addEventListener("mousedown",(e)=>{
        if(!el || el.style.display==="none") return;
        if(el.contains(e.target)) return;
        hide();
      }, true);

      sel.addEventListener("change", ()=>{
        const v = sel.value;
        if(!v) return;
        const payload = sel._mciPayload || {};
        hide();
        try{ runChooserAction(v, payload); }catch(_){ toast("Chooser error."); }
        sel.value="";
      });

      // prevent the native context menu inside chooser
      el.addEventListener("contextmenu",(e)=>{ e.preventDefault(); }, true);
    }

    function hide(){
      if(!el) return;
      el.style.display="none";
    }

    function position(){
      if(!el) return;
      const pad=10;
      const w=el.offsetWidth||300;
      const h=el.offsetHeight||70;
      let left=x+10, top=y+12;
      left=Math.min(left, window.innerWidth - w - pad);
      top =Math.min(top,  window.innerHeight - h - pad);
      left=Math.max(pad, left);
      top =Math.max(pad, top);
      el.style.left=left+"px";
      el.style.top=top+"px";
    }

    function show(options, payload, subtitle){
      ensure();
      sel.innerHTML = `<option value="">Choose…</option>` + options.map(o=>`<option value="${o.value}">${o.label}</option>`).join("");
      sel._mciPayload = payload;
      sub.textContent = subtitle || "";
      el.style.display="block";
      position();
    }

    function openPinned(text, clientX, clientY){
      const t=String(text||"").trim();
      if(!t){ toast("No text detected."); return; }

      x = (typeof clientX === "number") ? clientX : 40;
      y = (typeof clientY === "number") ? clientY : 40;

      if(isLikelyAddress(t)){
        show(
          [
            {value:"addr_wake_maps_vex", label:"Wake + Maps + Vexcel"},
            {value:"addr_wake",          label:"Wake only"},
            {value:"addr_maps",          label:"Google Maps only"},
            {value:"addr_vexcel",        label:"Vexcel only"}
          ],
          {addr:t},
          t
        );
        return;
      }

      const lead = extractLeadingName(t);
      if(isLikelyName(lead)){
        show(
          [
            {value:"name_linkedin", label:"LinkedIn People Search"},
            {value:"name_google",   label:"Google Search"},
            {value:"name_facebook", label:"Facebook People Search"}
          ],
          {name:t, lead},
          lead
        );
        return;
      }

      const pol = extractPolicy(t);
      if(pol){
        show(
          [
            {value:"pol_erie",        label:"Policy: Erie"},
            {value:"pol_natgen",      label:"Policy: NatGen"},
            {value:"pol_progressive", label:"Policy: Progressive"},
            {value:"pol_nfip",        label:"Policy: NFIP"}
          ],
          {pol},
          pol
        );
        return;
      }

      // fallback: treat as name
      show(
        [
          {value:"name_linkedin", label:"LinkedIn People Search"},
          {value:"name_google",   label:"Google Search"},
          {value:"name_facebook", label:"Facebook People Search"}
        ],
        {name:t, lead:lead},
        lead || t
      );
    }

    return { openPinned, hide };
  })();

  function runChooserAction(action, payload){
    if(!payload) return;

    if(action==="addr_wake_maps_vex") return openAddressLookups(payload.addr, "combo");
    if(action==="addr_wake")          return openAddressLookups(payload.addr, "wake");
    if(action==="addr_maps")          return openAddressLookups(payload.addr, "maps");
    if(action==="addr_vexcel")        return openAddressLookups(payload.addr, "vexcel");

    if(action==="name_linkedin") return openNameLookups(payload.name, "linkedin");
    if(action==="name_google")   return openNameLookups(payload.name, "google");
    if(action==="name_facebook") return openNameLookups(payload.name, "facebook");

    if(action==="pol_erie")        return openErie(payload.pol);
    if(action==="pol_natgen")      return openNatGen(payload.pol);
    if(action==="pol_progressive") return openProgressive(payload.pol);
    if(action==="pol_nfip")        return openNFIP(payload.pol);
  }

  // ALT + RIGHT-CLICK opens chooser pinned at cursor
  document.addEventListener("contextmenu", (e)=>{
    if(!e.altKey) return;

    const tag=(e.target&&e.target.tagName||"").toLowerCase();
    if(tag==="input"||tag==="textarea"||(e.target&&e.target.isContentEditable)) return;

    e.preventDefault();
    e.stopPropagation();

    const selected = (window.getSelection && window.getSelection().toString().trim()) || "";
    const hovered  = (e.target && ((e.target.innerText || e.target.textContent) || "").trim()) || "";
    const txt = selected || hovered;

    HoverChooser.openPinned(txt, e.clientX, e.clientY);
  }, true);

  /* ================= TAB INDICATOR ================= */
  function updateTabIndicator(){
    const txt=getSelectedOrHoverText();
    if(!txt){ document.title = baseTitle; return; }
    let dot="⚫", label="";

    if(isLikelyAddress(txt)){ dot="🟩"; label=`Address: ${txt}`; }
    else if(isLikelyName(extractLeadingName(txt))){ dot="🔵"; label=`Name: ${txt}`; }
    else {
      const pol = extractPolicy(txt);
      if(pol){
        dot="🟠"; label=`Policy: ${pol}`;
      }
    }
    setTab(dot,label);
  }
  document.addEventListener("mousemove", updateTabIndicator, {capture:true, passive:true});
  document.addEventListener("mouseover", updateTabIndicator, {capture:true, passive:true});

  /* ================= ON-SITE AUTOMATIONS (ONLY IF ARMED/TOKEN) ================= */

  // Wake: auto-follow to Account
  (function wakeAutoFollow(){
    if(!/services\.wake\.gov\/realestate\/ValidateAddress\.asp/i.test(location.href)) return;

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
      const tok = tokenOKFromLocation();
      if (tok.ok) armAutomations(tok.ts);
      if(!isArmed()) return;

      const m = (location.hash || "").match(/[#&]pol=([^&]+)/i);
      let pol = m ? decodeURIComponent(m[1]) : "";

      if (!pol) {
        const awaiting = sessionStorage.getItem(K_ERIE_AWAIT) === "1";
        if (!awaiting) return;
        pol = sessionStorage.getItem(K_ERIE_POL) || "";
        if (!pol) return;
      }

            const hp = getHashParams();
      const keepTs = hp.get("ts") || String(Date.now());

      // Run Erie automation only in the top window (prevents iframe loops with @allFrames)
      try { if (window.top !== window.self) return; } catch(_) {}

      // Pause on Erie portal/login pages (server may force these when logged out)
      const eriePath = (location.pathname || "").toLowerCase();
      const isErieLogin =
        eriePath.indexOf("/my.policy") === 0 ||
        eriePath.indexOf("/my.logout.php3") === 0 ||
        !!document.querySelector("input[type='password'], input[name*='user' i], input[name*='login' i]");
      if (isErieLogin) {
        try { sessionStorage.setItem(K_ERIE_POL, pol); sessionStorage.setItem(K_ERIE_AWAIT, "1"); } catch(_) {}
        toast("Erie: login detected — automation paused. Log in, then refresh.", 4500);
        return;
      }

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

      function observeUntil(predicate, timeoutMs=7000, root=document){
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
        await observeUntil(() => document.querySelector("#dropdown-select"), 9000);

        let tries = 0;
        let input = null;
        while (tries < 18 && !input){
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
        }, 9000);

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
        // Run NatGen automation only in the top window (prevents iframe loops with @allFrames)
        try { if (window.top !== window.self) return; } catch(_) {}

        const isMainPage = /\/MainMenu\.aspx$/i.test(location.pathname);

        // Detect if we're on the login screen (URL patterns OR common login controls)
        const isLoginPage =
          /\/Login\.aspx$/i.test(location.pathname) ||
          /\/Account\/Login/i.test(location.pathname) ||
          !!document.querySelector("input[name*='User' i], input[name*='Login' i], input[type='password'], #btnLogin, #btnSignIn");

        if (!isMainPage) {
          // Always persist state so it's ready after login / redirect
          try{
            sessionStorage.setItem(K_NG_POL, pol);
            sessionStorage.setItem(K_NG_AWAIT,"1");
          }catch(_){}

          // SAFE GATE: If we're on login, do nothing and let the user sign in
          if (isLoginPage) {
            toast("NatGen: login detected — automation paused. Log in, then refresh.", 4500);
            return;
          }

          // Runaway guard only when we aren't on MainMenu or Login
          if (typeof bumpRunawayGuard === "function" && !bumpRunawayGuard("mci.ng.redirects", 2)) {
            toast("NatGen: auto-redirect stopped (possible login/blocked).", 3500);
            return;
          }

          location.replace(
            NG_ORIGIN + NG_PATH +
            "#pol=" + encodeURIComponent(pol) +
            "&mci=1&ts=" + encodeURIComponent(keepTs)
          );
          return;
        }

        const input = await waitForSel("#ctl00_MainContent_wgtMainMenuFindPolicy_txtSearchString", 12000);
        if(!input){ finish(); return; }

        const digits = String(pol).replace(/\D/g,"");
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
  // NFIP (TorrentFlood) — quick search on Dashboard/Agency
  if (location.hostname === "nationalgeneral.torrentflood.com") {
    (function nfipAuto(){
      const tok = tokenOKFromLocation();
      if (tok.ok) armAutomations(tok.ts);
      if(!isArmed()) return;

      // Run only top frame (prevents iframe loops with @allFrames)
      try { if (window.top !== window.self) return; } catch(_) {}

      const hp = getHashParams();
      const polFromHash = hp.get("pol") || "";
      let pol = polFromHash;

      if (!pol) {
        const awaiting = sessionStorage.getItem(K_NFIP_AWAIT) === "1";
        if (!awaiting) return;
        pol = sessionStorage.getItem(K_NFIP_POL) || "";
        if (!pol) return;
      }

      const keepTs = hp.get("ts") || String(Date.now());

      const finish=()=>{
        try{ history.replaceState(null,"",location.pathname+location.search);}catch(_){}
        try{ sessionStorage.removeItem(K_NFIP_POL); sessionStorage.removeItem(K_NFIP_AWAIT);}catch(_){}
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
      function setNativeValue(el, value){
        try{
          const proto = (el.tagName === "TEXTAREA") ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, value);
          else el.value = value;
        }catch(_){ try{ el.value = value; }catch(__){} }
      }

      (async ()=>{
        const isAgency = /\/Dashboard\/Agency/i.test(location.pathname || "");

        // Detect if we're on a login screen (URL patterns OR common login controls)
        const isLoginPage =
          /\/Account\/Login/i.test(location.pathname || "") ||
          /\/Login/i.test(location.pathname || "") ||
          !!document.querySelector("input[type='password'], button[type='submit'], #Password, #UserName");

        // Always persist state so it's ready after login / redirect
        try{
          sessionStorage.setItem(K_NFIP_POL, pol);
          sessionStorage.setItem(K_NFIP_AWAIT, "1");
        }catch(_){}

        // SAFE GATE: If login, pause and let user sign in
        if (isLoginPage) {
          toast("NFIP: login detected — automation paused. Log in, then refresh.", 4500);
          return;
        }

        if (!isAgency) {
          location.replace(
            NFIP_ORIGIN + NFIP_PATH +
            "#pol=" + encodeURIComponent(pol) +
            "&mci=1&ts=" + encodeURIComponent(keepTs)
          );
          return;
        }

        const input = await waitForSel("#DashboardQuickSearch_SearchText", 12000);
        if(!input){ toast("NFIP: quick search box not found.", 2800); finish(); return; }

        input.focus();
        setNativeValue(input, "");
        input.dispatchEvent(new Event("input",{bubbles:true}));
        setNativeValue(input, pol);
        input.dispatchEvent(new Event("input",{bubbles:true}));
        input.dispatchEvent(new Event("change",{bubbles:true}));

        const btn = await waitForSel("#DashQuickSearchButton", 8000);
        if(btn) btn.click();

        finish();
      })();
    })();
  }



  // PROGRESSIVE (FAO) — safe automation: waits for login instead of looping
  if (location.hostname === "www.foragentsonly.com") {
    (function progressiveAuto(){
      if (window.top !== window.self) return;

      const tok = tokenOKFromLocation();
      if (tok.ok) armAutomations(tok.ts);

      // If we're not armed, still allow a pending GM policy to run after login (user triggered it in another tab)
      let pending = "";
      try{
        const sp = new URLSearchParams(location.search || "");
        pending = (sp.get("pol") || "").trim();
      }catch(_){}

      if(!pending){
        try{ pending = String(GM_getValue(K_PR_PENDING_GM, "") || "").trim(); }catch(_){ pending = ""; }
      }
      if(!pending){
        try{ pending = String(GM_getValue(K_PR_POL, "") || "").trim(); }catch(_){ pending = ""; }
      }

      // Nothing to do
      if(!pending) { disarmAutomations(); return; }

      // If neither token nor arm exists, we still proceed (because policy is explicitly pending)
      const allowed = isArmed() || !!pending;

      // Only run once per tab
      try{
        if (sessionStorage.getItem(K_PR_RAN) === "1") return;
      }catch(_){}

      // Heuristic: login page detection
      function looksLikeLogin(){
        const u = (location.href || "").toLowerCase();
        if (u.includes("/login")) return true;
        if (document.querySelector("input[type='password']")) return true;
        const btn = Array.from(document.querySelectorAll("button, input[type='submit']")).find(b=>{
          const t = (b.innerText||b.value||"").toLowerCase();
          return /log\s*in|sign\s*in/.test(t);
        });
        return !!btn;
      }

      // If login page: do nothing (keep pending) and do NOT disarm.
      if(looksLikeLogin()){
        // One small hint toast (rate-limited)
        try{
          const k="mci.pr.loginToastTs";
          const last=parseInt(sessionStorage.getItem(k)||"0",10);
          if(!last || Date.now()-last>12000){
            sessionStorage.setItem(k, String(Date.now()));
            toast("MCI Smart Lookup: log into Progressive, then refresh this tab (or open policy search).", 3500);
          }
        }catch(_){}
        return;
      }

      if(!allowed) return;

      function visible(el){
        if(!el) return false;
        const r=el.getBoundingClientRect();
        return !!(el.offsetParent || r.width || r.height);
      }
      function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

      async function waitForAny(selectors, ms){
        const t0=performance.now();
        while(performance.now()-t0<ms){
          for(const sel of selectors){
            const el=document.querySelector(sel);
            if(el && visible(el)) return el;
          }
          await sleep(150);
        }
        return null;
      }

      function setNativeValue(el, value){
        try{
          const proto = (el.tagName === "TEXTAREA") ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, value);
          else el.value = value;
        }catch(_){ try{ el.value = value; }catch(__){} }
      }

      function isNameField(input){
        const sig = (
          (input.getAttribute("aria-label")||"") + " " +
          (input.getAttribute("data-at")||"") + " " +
          (input.getAttribute("data-label")||"") + " " +
          (input.placeholder||"") + " " +
          (input.name||"") + " " +
          (input.id||"")
        ).toLowerCase();
        if (/sbp_userselectedlastname/.test(sig)) return true;
        if (/sbp_userselectedfirstname/.test(sig)) return true;
        if (/\blast name\b/.test(sig)) return true;
        if (/\bfirst name\b/.test(sig)) return true;
        if (/sbp-lastname/.test(sig)) return true;
        if (/sbp-firstname/.test(sig)) return true;
        return false;
      }

      function clickPolicyRadio(){
        const inp = document.querySelector("#SBP_PolSearch");
        if(inp && visible(inp)){ inp.click(); return true; }
        const lab = document.querySelector('label[for="SBP_PolSearch"]');
        if(lab && visible(lab)){ lab.click(); return true; }
        return false;
      }

      function pickPolicyInput(){
        const inputs = Array.from(document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])"))
          .filter(i => visible(i) && !i.disabled && !i.readOnly);
        if(!inputs.length) return null;

        const ranked = inputs.map(i=>{
          const sig = (
            (i.getAttribute("aria-label")||"") + " " +
            (i.getAttribute("data-at")||"") + " " +
            (i.getAttribute("data-label")||"") + " " +
            (i.placeholder||"") + " " +
            (i.name||"") + " " +
            (i.id||"")
          ).toLowerCase();
          let score = 0;
          if (i.closest && i.closest(".search-bar")) score += 20;
          if (/policy/.test(sig)) score += 80;
          if (/polsearch|pol/.test(sig)) score += 10;
          if (isNameField(i)) score -= 200;
          return {i, score};
        }).sort((a,b)=>b.score-a.score);

        const best = ranked[0] ? ranked[0].i : null;
        if(best && !isNameField(best)) return best;

        const nonName = inputs.find(i=>!isNameField(i));
        return nonName || null;
      }

      function clickSearch(){
        const btn = document.querySelector("#sbp-search") || document.querySelector("button.js-search-bar__search");
        if(btn && visible(btn)){ btn.click(); return true; }
        return false;
      }

      function finish(){
        try{ sessionStorage.setItem(K_PR_RAN, "1"); }catch(_){}
        try{ history.replaceState(null, "", location.pathname); }catch(_){}
        try{ if (typeof GM_deleteValue === "function") GM_deleteValue(K_PR_PENDING_GM); }catch(_){}
        disarmAutomations();
      }

      (async function run(){
        // Wait for the search UI to exist; if it never appears, do NOT loop forever.
        const searchBtn = await waitForAny(["#sbp-search", "button.js-search-bar__search"], CFG.faoWaitMs);
        if(!searchBtn){
          toast("Progressive: couldn't find policy search box yet. Navigate to Policy Search then refresh.", 3500);
          return;
        }

        clickPolicyRadio();
        await sleep(600);

        const input = pickPolicyInput();
        if(input){
          input.focus();
          setNativeValue(input, "");
          input.dispatchEvent(new Event("input",{bubbles:true}));
          await sleep(60);
          setNativeValue(input, pending);
          input.dispatchEvent(new Event("input",{bubbles:true}));
          input.dispatchEvent(new Event("change",{bubbles:true}));
        } else {
          toast("Progressive: policy input not found. Try opening the Policy Search page first.", 3500);
          return;
        }

        await sleep(200);
        clickSearch();

        finish();
      })();
    })();
  }

  /* ================= VEXCEL (SPA) ================= */
  if (location.hostname === "app.vexcelgroup.com") {
    (function vexcelAuto(){
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
              box-shadow:0 10px 30px rgba(0,0,0,.45); display:flex; align-items:center; gap:12px;
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
      try { history.replaceState(null,"", location.pathname + location.search); } catch {}
      disarmAutomations();
    })();
  }

})();
