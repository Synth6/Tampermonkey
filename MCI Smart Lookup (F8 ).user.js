// ==UserScript==
// @name         MCI Smart Lookup (F8 Universal + Vexcel)
// @namespace    mci-tools
// @version      1.10
// @description  F8 on hover/selection: LinkedIn, Wake+Maps+Vexcel, Erie (WWW), NatGen. Tab title shows detected type.
// @match        *://*/*
// @match        file://*/*
// @match        https://services.wake.gov/realestate/*
// @match        https://www.linkedin.com/*
// @match        https://portal.agentexchange.com/*
// @match        https://www.agentexchange.com/*
// @match        https://agentexchange.com/*
// @match        https://natgenagency.com/*
// @match        https://app.vexcelgroup.com/*
// @grant        GM_openInTab
// @grant        GM_addStyle
// @run-at       document-idle
// @allFrames    true
// ==/UserScript==
(function(){
  "use strict";

/* ============ CONFIG ============ */
const CFG = {
  wakeAutoFollow: true,
  mapsRegionHint: "Wake County, NC",
  stripStreetTypes: ["rd","road","dr","drive","st","street","ave","avenue","blvd","boulevard","ct","court","trl","trail","ln","lane","way","pkwy","parkway","cir","circle","ter","terrace","pl","place","hwy","highway"],
  indicatorTimeout: 2500
};

// IMPORTANT: use WWW for Erie (this matches your working script)
const ERIE_ORIGIN = "https://www.agentexchange.com";
const ERIE_PATH   = "/Customer/Search";

const NG_ORIGIN   = "https://natgenagency.com";
const NG_PATH     = "/MainMenu.aspx";

// Vexcel
const VEX_ORIGIN  = "https://app.vexcelgroup.com";     // SPA root

const K_ERIE_POL="carrier.erie.pol", K_ERIE_AWAIT="carrier.erie.await";
const K_NG_POL="carrier.ng.pol",     K_NG_AWAIT="carrier.ng.await";

const K_VEX_ADDR="vexcel.addr";       // sessionStorage key for address
const K_VEX_AWAIT="vexcel.await";

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
  DIGITS:     /^\d{11,}$/
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
  const digits=(s.match(/\b\d{11,}\b/)||[])[0];
  return digits||null;
}
function detectCarrier(pol){
  if(!pol) return null;
  if (RE.ERIE_FMT1.test(pol) || /-/.test(pol) || /^[A-Za-z]/.test(pol)) return "erie";
  if (RE.DIGITS.test(pol)) return "natgen";
  return "erie";
}

/* ============ OPENERS ============ */
function openVexcel(addressRaw){
  const addr = (addressRaw || "").replace(/\s+/g, " ").trim();
  try {
    sessionStorage.setItem(K_VEX_ADDR, addr);
    sessionStorage.setItem(K_VEX_AWAIT, "1");
  } catch(_) {}
  toast(`Vexcel: loading map for “${addr}”...`, 3000);
  // go straight to router with address param so Vexcel geocodes it
  GM_openInTab(VEX_ORIGIN + "/#/app/home?address=" + encodeURIComponent(addr), {active:false, insert:true});
}

// New: send RAW address to Vexcel, normalized parts to Wake; keep alias for compatibility
function openAddressLookups(rawAddress){
  const raw = (rawAddress || "").replace(/\s+/g, " ").trim(); // keep Rd/Dr/etc intact
  const normd = normalizeAddressForWake(raw);
  if(!normd){ toast("Doesn't look like a Wake address."); return; }

  const { stnum, stname } = normd;
  const wakeURL = `https://services.wake.gov/realestate/ValidateAddress.asp?stnum=${encodeURIComponent(stnum)}&stname=${encodeURIComponent(stname)}&locidList=&spg=`;
  const mapsQ   = CFG.mapsRegionHint ? `${raw}, ${CFG.mapsRegionHint}` : raw;
  const mapsURL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQ)}`;

  GM_openInTab(wakeURL,{active:true,insert:true});
  GM_openInTab(mapsURL,{active:false,insert:true});
  openVexcel(raw);

  toast(`Opening Wake, Maps & Vexcel for: ${raw}`);
}
// Back-compat alias
function openWakeAndMaps(rawAddress){ openAddressLookups(rawAddress); }

function openNameLookups(nameRaw){
  const leading = extractLeadingName(nameRaw);
  const cleaned = cleanNameForLinkedIn(leading);
  const liURL=`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleaned)}`;
  GM_openInTab(liURL,{active:true,insert:true});
  toast(`LinkedIn: ${cleaned}`);
}

// Erie
function openErie(pol){
  try {
    sessionStorage.setItem(K_ERIE_POL, pol);
    sessionStorage.setItem(K_ERIE_AWAIT, "1");
  } catch(_) {}
  window.open(ERIE_ORIGIN + ERIE_PATH + "#pol=" + encodeURIComponent(pol), "_blank");
  toast(`Erie: ${pol}`);
}
function openNatGen(pol){
  try{ sessionStorage.setItem(K_NG_POL,pol); sessionStorage.setItem(K_NG_AWAIT,"1"); }catch(_){}
  window.open(NG_ORIGIN + NG_PATH + "#pol=" + encodeURIComponent(pol), "_blank");
  toast(`NatGen: ${pol}`);
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
      else          { dot="🟣"; label=`NatGen ${pol}`; }
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
  const txt=getSelectedOrHoverText();
  if(!txt){ toast("Select or hover a name/address/policy, then press F8."); return; }

  // ADDRESS → use RAW text for Vexcel, normalize only for Wake
  if(isLikelyAddress(txt)) { openAddressLookups(txt); return; }

  // Loose address candidate (allow punctuation/city/zip), still send RAW
  const addrCandidate = txt.match(/\b\d+\s+[A-Za-z0-9 .,'-]+\b(?:.*)?/);
  if(addrCandidate){ openAddressLookups(addrCandidate[0]); return; }

  if(isLikelyName(extractLeadingName(txt))) { openNameLookups(txt); return; }

  const pol = extractPolicy(txt);
  if(pol){
    const c=detectCarrier(pol);
    if(c==="natgen") openNatGen(pol.replace(/-/g,""));
    else openErie(pol);
    return;
  }

  openNameLookups(txt);
},true);

/* ============ ON-SITE AUTOMATIONS ============ */

// Wake: auto-follow to Account
(function wakeAutoFollow(){
  if(!/services\.wake\.gov\/realestate\/ValidateAddress\.asp/i.test(location.href)) return;
  if(!CFG.wakeAutoFollow) return;
  const tryClick=()=>{
    const link=document.querySelector('a[href*="Account.asp"]');
    if(link){ link.click(); return true; }
    return false;
  };
  let attempts=0;
  const iv=setInterval(()=>{ attempts++; if(tryClick()||attempts>30) clearInterval(iv); },150);
})();

// ERIE side (WWW)
if (location.hostname === "www.agentexchange.com" || location.hostname === "agentexchange.com") {
  (function erieRun(){
    const m = (location.hash || "").match(/[#&]pol=([^&]+)/i);
    const hasHash = !!m;
    let pol = hasHash ? decodeURIComponent(m[1]) : "";

    if (hasHash) {
      try { sessionStorage.setItem(K_ERIE_POL, pol); sessionStorage.setItem(K_ERIE_AWAIT, "1"); } catch(_) {}
    } else {
      const awaiting = sessionStorage.getItem(K_ERIE_AWAIT) === "1";
      if (!awaiting) return;
      pol = sessionStorage.getItem(K_ERIE_POL) || "";
      if (!pol) return;
    }

    if (!location.pathname.toLowerCase().startsWith(ERIE_PATH.toLowerCase())) {
      try { sessionStorage.setItem(K_ERIE_POL, pol); sessionStorage.setItem(K_ERIE_AWAIT, "1"); } catch(_) {}
      location.replace(ERIE_ORIGIN + ERIE_PATH + (hasHash ? location.hash : ("#pol=" + encodeURIComponent(pol))));
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
      await observeUntil(() => document.querySelector("#dropdown-select"), 5000);
      let tries = 0;
      let input = null;
      while (tries < 16 && !input){
        tries++;
        flipDropdown();
        input = findPolicyInput();
        if (!input) await new Promise(r => setTimeout(r, 300));
      }
      if (!input) { finish(); return; }

      const fillVal = sessionStorage.getItem(K_ERIE_POL) || "";
      input.focus();
      input.value = fillVal;
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));

      const btn = document.querySelector("#btnSearch") ||
                  Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"))
                    .find(b => /search/i.test(norm(b.innerText || b.textContent || b.value || "")));
      if (btn) btn.click();

      const row = await observeUntil(() => {
        const r = document.querySelector("#custSrchResults .custResListArr");
        return r && visible(r) ? r : null;
      }, 5000);
      if (row) {
        const link = row.querySelector("#resCustName, .custName, [ng-click*='gotoCustomerDetail'], a");
        if (link) link.click();
      }
      finish();
    })();
  })();
}

// NATGEN side
if (location.hostname === "natgenagency.com") {
  (function natgenAuto(){
    const m=(location.hash||"").match(/[#&]pol=([^&]+)/i);
    const hasHash=!!m;
    let pol=hasHash?decodeURIComponent(m[1]):"";

    if(hasHash){
      try{ sessionStorage.setItem(K_NG_POL,pol); sessionStorage.setItem(K_NG_AWAIT,"1"); }catch(_){}
    }else{
      const awaiting=sessionStorage.getItem(K_NG_AWAIT)==="1";
      if(!awaiting) return;
      pol=sessionStorage.getItem(K_NG_POL)||"";
      if(!pol) return;
    }

    const finish=()=>{ try{ history.replaceState(null,"",location.pathname+location.search);}catch(_){}
                       try{ sessionStorage.removeItem(K_NG_POL); sessionStorage.removeItem(K_NG_AWAIT);}catch(_){}
                     };

    function visible(el){ if(!el) return false; const r=el.getBoundingClientRect(); return !!(el.offsetParent||r.width||r.height); }
    function waitForSel(selector, timeout=10000){
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
      if (!/\/MainMenu\.aspx$/i.test(location.pathname)) {
        try{ sessionStorage.setItem(K_NG_POL, pol); sessionStorage.setItem(K_NG_AWAIT,"1"); }catch(_){}
        location.replace(NG_ORIGIN + NG_PATH + "#pol=" + encodeURIComponent(pol));
        return;
      }

      const input = await waitForSel("#ctl00_MainContent_wgtMainMenuFindPolicy_txtSearchString", 10000);
      if(!input){ finish(); return; }

      const digits=(sessionStorage.getItem(K_NG_POL) || pol || "").replace(/-/g,"");
      input.focus();
      input.value=digits;
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));

      const ddl=document.querySelector("#ctl00_MainContent_wgtMainMenuFindPolicy_ddlAction");
      if(ddl && ddl.value!=="0"){ ddl.value="0"; ddl.dispatchEvent(new Event("change",{bubbles:true})); }

      const btn=document.querySelector("#ctl00_MainContent_wgtMainMenuFindPolicy_btnSearch");
      if(btn) btn.click();

      finish();
    })();
  })();
}

/* ============ VEXCEL (app.vexcelgroup.com) — route with ?address=... + centered loading overlay ============ */
if (location.hostname === "app.vexcelgroup.com") {
  (function vexcelAuto(){
    const K_VEX_ADDR="vexcel.addr", K_VEX_AWAIT="vexcel.await";

    // detect address from hash or session
    const wantAddrFromHash = (() => {
      const m = (location.hash||"").match(/[?&]address=([^&#]+)/i);
      return m ? decodeURIComponent(m[1]) : null;
    })();
    const storedFlag = sessionStorage.getItem(K_VEX_AWAIT) === "1";
    const storedAddr = sessionStorage.getItem(K_VEX_ADDR) || "";
    if (!wantAddrFromHash && !(storedFlag && storedAddr)) return;

    const addr = (wantAddrFromHash || storedAddr || "").trim();
    if (!addr) { sessionStorage.removeItem(K_VEX_AWAIT); return; }

    // Inject to page context so Angular sees it, and to draw a centered overlay
    const s = document.createElement("script");
    s.textContent = `(() => {
      const ADDR = ${JSON.stringify(addr)};

      const sleep = ms => new Promise(r=>setTimeout(r, ms));
      const visible = el => !!el && (()=>{const r=el.getBoundingClientRect();return !!(el.offsetParent||r.width||r.height);})();

      // Centered full-screen overlay
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
        // Ensure we’re on the address route; let router geocode
        const hasAddressParam = /[?&]address=/i.test(location.hash||"");
        if (!hasAddressParam) {
          location.hash = '#/app/home?address=' + encodeURIComponent(ADDR);
        }

        addOverlay('Loading map for “' + ADDR + '”…');

        // Wait for full load and a short settle
        if (document.readyState !== 'complete') {
          await new Promise(res => window.addEventListener('load', res, {once:true}));
        }
        await sleep(500);

        // Wait up to ~10s for lat/lon to appear (router finished)
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

        // Fallback: paste + Enter once if router didn’t geocode (edge cases)
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

    // cleanup
    sessionStorage.removeItem(K_VEX_AWAIT);
    try { history.replaceState(null,"", location.pathname + location.search); } catch {}
  })();
}

})();