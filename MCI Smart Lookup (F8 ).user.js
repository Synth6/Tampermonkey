// ==UserScript==
// MCI internal tooling
// Copyright (c) 2025 Middle Creek Insurance. All rights reserved.
// Not authorized for redistribution or resale.
// @name         MCI Smart Lookup (F8 Universal + Vexcel)
// @namespace    mci-tools
// @version      1.17
// @description  F8 on hover/selection: LinkedIn, Wake+Maps+Vexcel, Erie (WWW), NatGen, Progressive (FAO). Progressive opens FAO, selects Policy, clicks Search.
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
// ==/UserScript==

(function(){
"use strict";

/* ================= BASIC CONFIG ================= */
const CFG = { indicatorTimeout: 2500, armedTTLms: 60000 };
const K_ARMED="mci.f8.armed", K_ARMED_TS="mci.f8.armed.ts";

/* ================= ARMING ================= */
function arm(ts){
  const t = ts || Date.now();
  try{
    sessionStorage.setItem(K_ARMED,"1");
    sessionStorage.setItem(K_ARMED_TS,String(t));
    GM_setValue(K_ARMED_TS,String(t));
  }catch(_){}
  return t;
}
function isArmed(){
  const ttl = CFG.armedTTLms, now = Date.now();
  try{
    const ts = parseInt(sessionStorage.getItem(K_ARMED_TS)||"0",10);
    if(ts && now-ts<=ttl) return true;
    const gts = parseInt(GM_getValue(K_ARMED_TS,"0")||"0",10);
    if(gts && now-gts<=ttl) return true;
  }catch(_){}
  return false;
}

/* ================= TOAST ================= */
GM_addStyle(`.mci-toast{position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);
background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px system-ui;}`);
function toast(t,m=1600){const d=document.createElement("div");d.className="mci-toast";d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),m);}

/* ================= HOVER ================= */
let lastHover="";
document.addEventListener("mouseover",e=>{
  const t=(e.target&&(e.target.innerText||e.target.textContent)||"").trim();
  if(t) lastHover=t;
},{capture:true});
function getTxt(){
  const sel=(window.getSelection&&window.getSelection().toString().trim())||"";
  return sel||lastHover||"";
}

/* ================= POLICY DETECTION ================= */
function extractPolicy(t){
  const s=String(t||"");
  if(/^Q\d+/i.test(s)) return s.match(/Q\d+/i)[0];
  const d=s.match(/\b\d{8,13}\b/);
  return d?d[0]:null;
}
function detectCarrier(p){
  if(/^Q/i.test(p)) return "erie";
  if(/^\d{11,}$/.test(p)) return "natgen";
  if(/^\d{8,10}$/.test(p)) return "progressive";
  return null;
}

/* ================= OPENERS ================= */
function openProgressive(pol){
  arm();
  GM_setValue("mci.pr.pol",pol);
  window.open("https://www.foragentsonly.com/?mci=1","_blank");
  toast("Progressive: opening FAO");
}

/* ================= F8 ================= */
document.addEventListener("keydown",e=>{
  if(e.key!=="F8") return;
  e.preventDefault();
  arm();
  const t=getTxt();
  const p=extractPolicy(t);
  if(!p){ toast("No policy detected"); return; }
  const c=detectCarrier(p);
  if(c==="progressive"){ openProgressive(p); return; }
  toast("Non‑Progressive policy (unchanged behavior)");
},true);

/* ================= PROGRESSIVE FAO AUTO ================= */
if(location.hostname==="www.foragentsonly.com"){
(function(){
  if(!isArmed()) return;

  function visible(el){
    if(!el) return false;
    const r=el.getBoundingClientRect();
    return !!(el.offsetParent||r.width||r.height);
  }
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  async function waitFor(sel,ms=20000){
    const t0=performance.now();
    while(performance.now()-t0<ms){
      const el=document.querySelector(sel);
      if(el&&visible(el)) return el;
      await sleep(150);
    }
    return null;
  }

  async function run(){
    const searchBtn = await waitFor("#sbp-search, button.js-search-bar__search");
    if(!searchBtn){ toast("FAO: search not found"); return; }

    const polRadio =
      document.querySelector("#SBP_PolSearch") ||
      document.querySelector('label[for="SBP_PolSearch"]');

    if(polRadio && visible(polRadio)){
      polRadio.click();
      toast("FAO: Policy selected");
      await sleep(300);
    } else {
      toast("FAO: Policy radio not found");
    }

    searchBtn.click();
    toast("FAO: Search clicked");
  }

  run();
})();
}

})();
