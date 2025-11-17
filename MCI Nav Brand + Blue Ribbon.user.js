// ==UserScript==
// MCI internal tooling
// Copyright (c) 2025 Middle Creek Insurance. All rights reserved.
// Not authorized for redistribution or resale.
// @name         MCI Nav Brand + Blue Ribbon (QQCatalyst)
// @namespace    mci-tools
// @version      2.2
// @description  Adds a stacked “Middle Creek / Insurance” badge in top navigation; applies blue gradient to the fixed ribbon only.
// @match        https://app.qqcatalyst.com/*
// @match        https://*.qqcatalyst.com/*
// @run-at       document-idle
// @allFrames    true
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Nav%20Brand%20+%20Blue%20Ribbon.user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tampermonkey/main/MCI%20Nav%20Brand%20+%20Blue%20Ribbon.user.js
// ==/UserScript==

(() => {
  "use strict";

  /* ───────── CONFIG ───────── */
  const DRIVE_URL    = "https://sites.google.com/middlecreekins.com/easy-links/home";

  // Nav badge size/spacing
  const BADGE_HEIGHT = 41;   // px
  const BADGE_PADX   = 10;   // px
  const MARGIN_LEFT  = 10;   // px after QQ logo

  // Nav badge text sizes
  const FONT_TOP     = 14;   // “Middle Creek”
  const FONT_BOTTOM  = 12;   // “Insurance”

  // Ribbon-only gradient (Carolina blue)
  const RIBBON_GRADIENT = "linear-gradient(135deg,#00223E 0%,#005792 50%,#00BBF0 100%)";

  /* ───────── CSS ───────── */
  GM_addStyle(`
    /* --- Ribbon theming (ONLY #fix-ribbon) --- */
    #fix-ribbon.mci-themed {
      position: relative !important;
      background-image: ${RIBBON_GRADIENT} !important;
      background-size: cover !important;
      background-position: center !important;
      background-attachment: scroll !important;
    }
    #fix-ribbon .mci-ribbon-sheen {
      position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,0));
    }

    /* --- Nav badge (next to #logo) --- */
    #navigation #menu .mci-brand {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: ${BADGE_HEIGHT}px;
      padding: 0 ${BADGE_PADX}px;
      margin-left: ${MARGIN_LEFT}px;
      background: #000;
      color: #fff;
      border-bottom: 2px solid #1e90ff;
      border-radius: 0;
      overflow: hidden;
      box-shadow: 0 2px 5px rgba(0,0,0,.25);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      text-decoration: none !important;
      line-height: 1.1;
      vertical-align: middle;
    }
    #navigation #menu .mci-brand:hover { background: #0a0a0a; }

    /* Stacked title */
    #navigation #menu .mci-brand .mci-title {
      position: relative; z-index: 2;
      display: flex; flex-direction: column; align-items: center;
      text-align: center; white-space: nowrap;
    }
    #navigation #menu .mci-brand .mci-title span:first-child {
      font-size: ${FONT_TOP}px; font-weight: 700; letter-spacing: .2px;
    }
    #navigation #menu .mci-brand .mci-title span:last-child  {
      font-size: ${FONT_BOTTOM}px; font-weight: 600; opacity: .95;
    }

    /* Animated waves behind text (like your QQ menu header) */
    #navigation #menu .mci-brand .mci-wave {
      position: absolute; bottom: 0; left: 0; width: 400%; height: 100%;
      background-repeat: repeat-x; background-size: 50% 100%;
      animation: mciWaveFlow 10s linear infinite;
      z-index: 1; opacity: .4; pointer-events: none;
    }
    #navigation #menu .mci-brand .w1 { background-image: radial-gradient(ellipse at center, #70c5ff 0%, transparent 70%); animation-duration: 12s; opacity: .6; }
    #navigation #menu .mci-brand .w2 { background-image: radial-gradient(ellipse at center, #3498db 0%, transparent 70%); animation-duration: 16s; opacity: .5; }
    #navigation #menu .mci-brand .w3 { background-image: radial-gradient(ellipse at center, #0f6ebd 0%, transparent 70%); animation-duration: 20s; opacity: .4; }
    @keyframes mciWaveFlow { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }

    /* Compact tweak if header gets tight */
    @media (max-width: 1200px) {
      #navigation #menu .mci-brand { height: ${Math.max(28, BADGE_HEIGHT - 4)}px; padding: 0 ${Math.max(6, BADGE_PADX - 2)}px; }
      #navigation #menu .mci-brand .mci-title span:first-child { font-size: ${Math.max(12, FONT_TOP - 1)}px; }
      #navigation #menu .mci-brand .mci-title span:last-child  { font-size: ${Math.max(10, FONT_BOTTOM - 1)}px; }
    }
  `);

  /* ───────── DOM helpers ───────── */
  function insertMciBrandInNav() {
    if (document.querySelector('#navigation #menu .mci-brand')) return;

    const menu = document.querySelector('#navigation #menu');
    if (!menu) return;

    const brand = document.createElement('a');
    brand.className = 'mci-brand';
    brand.href = DRIVE_URL;
    brand.target = '_blank';
    brand.rel = 'noopener';
    brand.setAttribute('aria-label', 'Open Middle Creek Insurance Drive');
    brand.innerHTML = `
      <div class="mci-title">
        <span>Middle Creek</span>
        <span>Insurance</span>
      </div>
      <div class="mci-wave w1"></div>
      <div class="mci-wave w2"></div>
      <div class="mci-wave w3"></div>
    `;

    const logo = document.querySelector('#navigation #menu #logo');
    const navList = menu.querySelector('.global-nav');

    if (logo && logo.parentElement === menu) {
      (logo.nextSibling) ? menu.insertBefore(brand, logo.nextSibling) : menu.appendChild(brand);
    } else if (navList) {
      menu.insertBefore(brand, navList);
    } else {
      menu.appendChild(brand);
    }
  }

  function applyRibbonGradient() {
    const ribbon = document.getElementById('fix-ribbon'); // per your div: <div id="fix-ribbon" class="ribbon locked-to-scroll">
    if (!ribbon) return;
    if (!ribbon.classList.contains('mci-themed')) {
      ribbon.classList.add('mci-themed');
    }
    if (!ribbon.querySelector('.mci-ribbon-sheen')) {
      const sheen = document.createElement('div');
      sheen.className = 'mci-ribbon-sheen';
      ribbon.appendChild(sheen);
    }
  }

  /* ───────── Init + observe SPA changes ───────── */
  function init() {
    insertMciBrandInNav();   // badge stays in navigation
    applyRibbonGradient();   // only the ribbon gets the blue gradient
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  const mo = new MutationObserver(() => {
    insertMciBrandInNav();
    applyRibbonGradient();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Optional: Alt+D opens Drive quickly
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.shiftKey && (e.key || '').toLowerCase() === 'd') {
      window.open(DRIVE_URL, '_blank', 'noopener');
      e.preventDefault();
    }
  });

})();

