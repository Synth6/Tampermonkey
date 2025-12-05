// ==UserScript==
// @name         MCI – Erie Home → MCI Home Form
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  Export Erie Home quote data to the MCI Home Quote HTML form, walking Customer → Dwelling → Coverages, then opening the form.
// @author       Ron / MCI
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Customer*
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Dwelling*
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Coverages*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // ===== CONFIG =====
  const HOME_FORM_URL = 'https://middlecreekins.com/wp-content/uploads/JonesForms/HomeQuoteForm.html';
  const STORAGE_KEY   = 'mci_erie_home_data_v1';
  const FLOW_KEY      = 'mci_erie_home_flow_v1';   // "idle" | "after_customer" | "after_dwelling"

  // ===== Generic helpers =====
  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  function getSelectedText(selector) {
    const sel = document.querySelector(selector);
    if (!sel) {
      console.warn('[MCI Home] No <select> found for', selector);
      return '';
    }
    const opt = sel.options[sel.selectedIndex];
    const value = opt ? (opt.text || '').trim() : '';
    console.log('[MCI Home] Selected text for', selector, '→', value);
    return value;
  }

  function getValue(selector) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn('[MCI Home] No input/select found for', selector);
      return '';
    }
    const value = (el.value || '').trim();
    console.log('[MCI Home] Value for', selector, '→', value);
    return value;
  }

  function getCurrentHomeInsurerText() {
    const sel = document.querySelector('#CurrentHomeInsurer');
    if (!sel) {
      console.warn('[MCI Home] #CurrentHomeInsurer select not found.');
      return '';
    }

    const idx = sel.selectedIndex;
    if (idx < 0) {
      console.warn('[MCI Home] CurrentHomeInsurer has no selected option.');
      return '';
    }

    const opt = sel.options[idx];
    const text = opt ? (opt.text || opt.innerText || '').trim() : '';
    const value = sel.value != null ? sel.value.trim() : '';

    console.log('[MCI Home] CurrentHomeInsurer → value =', value, ', text =', text);
    return value || text; // prefer internal value, fall back to label
  }

  function getText(selector) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn('[MCI Home] No element found for', selector);
      return '';
    }
    const value = (el.innerText || el.textContent || '').trim();
    console.log('[MCI Home] Text for', selector, '→', value);
    return value;
  }

  function parseMailingAddress() {
    const addrDiv = document.querySelector('#mailing-address-text');
    if (!addrDiv) {
      console.warn('[MCI Home] No #mailing-address-text found');
      return { street: '', city: '', state: '', zip: '' };
    }

    const text = (addrDiv.innerText || addrDiv.textContent || '').trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    let street = '';
    let city   = '';
    let state  = '';
    let zip    = '';

    if (lines.length > 0) {
      street = lines[0];
    }
    if (lines.length > 1) {
      const m = lines[1].match(/^([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
      if (m) {
        city  = m[1].trim();
        state = m[2].trim();
        zip   = m[3].trim();
      } else {
        console.warn('[MCI Home] Could not parse city/state/zip from:', lines[1]);
      }
    }

    console.log('[MCI Home] Parsed mailing address:', { street, city, state, zip });
    return { street, city, state, zip };
  }

  function getCounty() {
    const sel = document.querySelector('#selMailingCountyList');
    if (sel) {
      const val = (sel.value || '').trim();
      console.log('[MCI Home] County from #selMailingCountyList →', val);
      return val;
    }

    const span = document.querySelector('.editor-block span.bold');
    if (span) {
      const value = (span.innerText || span.textContent || '').trim();
      console.log('[MCI Home] County from bold span →', value);
      return value;
    }

    console.warn('[MCI Home] County not found');
    return '';
  }

  // Grab the email, treating "None entered" as blank
  function getNamedInsuredEmail() {
    const label = document.querySelector('label.named-insured-value.customer-lockdown-email');
    if (!label) {
      console.warn('[MCI Home] Email label not found');
      return '';
    }
    const raw = (label.innerText || label.textContent || '').trim();
    const email = raw === 'None entered' ? '' : raw;
    console.log('[MCI Home] Named insured email →', email);
    return email;
  }

  // Generic helper for Erie’s <obscured-text-with-toggle> custom elements
  function grabObscuredValue(paramSubstring) {
    const comp = document.querySelector(`obscured-text-with-toggle[params*="${paramSubstring}"]`);
    if (!comp) {
      console.warn('[MCI Home] No obscured-text-with-toggle found for', paramSubstring);
      return '';
    }
    const span = comp.querySelector('obscured-text-field-container span');
    if (!span) {
      console.warn('[MCI Home] No span inside obscured component for', paramSubstring);
      return '';
    }
    const txt = (span.innerText || span.textContent || '').trim();
    console.log(`[MCI Home] Obscured value for ${paramSubstring} →`, txt);
    return txt;
  }

  // Get DOB from obscured-text-with-toggle (index 0 = Named, 1 = Second Named)
  async function getFullDateOfBirth(index = 0, allowReveal = true) {
    const comps = document.querySelectorAll('obscured-text-with-toggle[params*="dates.obscure"]');
    const comp = comps[index];
    if (!comp) {
      console.warn('[MCI Home] DOB component not found at index', index);
      return '';
    }

    const span   = comp.querySelector('obscured-text-field-container span');
    const toggle = allowReveal ? comp.querySelector('obscured-text-toggle .reveal-data-btn') : null;

    if (!span) {
      console.warn('[MCI Home] DOB span not found at index', index);
      return '';
    }

    let txt = (span.innerText || span.textContent || '').trim();

    if (allowReveal && txt.indexOf('*') !== -1 && toggle) {
      console.log('[MCI Home] DOB appears masked at index', index, '– clicking eye icon…');
      toggle.click();
      await wait(300);
      txt = (span.innerText || span.textContent || '').trim();
      console.log('[MCI Home] DOB after reveal at index', index, '→', txt);
    } else {
      console.log('[MCI Home] DOB at index', index, '→', txt);
    }

    return txt;
  }

  // Convert MM/DD/YYYY to YYYY-MM-DD for <input type="date">
  function normalizeDateToISO(text) {
    if (!text) return '';
    const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return '';
    let mm = m[1].padStart(2, '0');
    let dd = m[2].padStart(2, '0');
    let yy = m[3];
    if (yy.length === 2) {
      const n = parseInt(yy, 10);
      yy = (n >= 50 ? '19' : '20') + yy;
    }
    const iso = `${yy}-${mm}-${dd}`;
    console.log('[MCI Home] Normalized date', text, '→', iso);
    return iso;
  }

  // ===== STEP 1 – CUSTOMER TAB =====
  async function collectCustomerData() {
    console.log('[MCI Home] Collecting Customer-tab data…');

    const mailing = parseMailingAddress();

    const namedInsured   = getSelectedText('#ddlFirstNamedInsured');
    const insuredEmail   = getNamedInsuredEmail();
    const currentCarrier = getCurrentHomeInsurerText();

    const dobRaw = await getFullDateOfBirth(0, true);
    const insuredBirthdateIso = normalizeDateToISO(dobRaw);
    const insuredBirthdate = insuredBirthdateIso || dobRaw;

    const secondDobRaw = await getFullDateOfBirth(1, false);

    const insuredSSPartial      = grabObscuredValue('licenseNumbers.obscure');
    const secondNamedSSPartial  = grabObscuredValue('ssn.obscure');

    const county = getCounty();

    const data = {
      namedInsured,
      insuredEmail,
      currentCarrier,
      insuredBirthdate,
      insuredSSN:       insuredSSPartial,
      secondNamedBirthdate: secondDobRaw,
      secondNamedSSN:   secondNamedSSPartial,

      propertyAddress: mailing.street,
      city:  mailing.city,
      state: mailing.state,
      zip:   mailing.zip,
      county,

      // filled later
      policyEffDate: '',
      cancelDate: '',
      hoForm: '',
      dwellingValue: '',
      liabilityLimit: '',
      medPayLimit: '',
      protectionClass: '',
      yearBuilt: '',
      squareFootage: '',
      constructionFrame: '',
      constructionBV: '',
      deductible: '',
      fireExtinguishers: '',
      deadBolts: '',
      smokeDetectors: '',
      centralHeat: '',
      centralAlarm: '',
      localAlarm: '',
      swimmingPool: '',
      poolFenced: '',
      trampoline: '',
      dogs: '',
      dogBreeds: '',
      dogBiteHistory: '',
      anyLosses3yrs: '',
      lossDescription: '',
      anySpecialEndorsements: '',
      specialEndorsementDetails: '',
      autoWithAgency: '',
      autoCompany: '',
      hasMortgage: '',
      paymentMethod: '',
      notes: ''
    };

    console.log('[MCI Home] Customer data object:', data);
    return data;
  }

  async function handleCustomerClick() {
    try {
      console.log('[MCI Home] Step 1 – collecting and storing Customer data…');
      const data = await collectCustomerData();
      GM_setValue(STORAGE_KEY, data);
      GM_setValue(FLOW_KEY, 'after_customer');

      const href = window.location.href;
      const idx = href.indexOf('/Customer');
      if (idx > -1) {
        const base = href.substring(0, idx);
        const targetUrl = base.replace(/\/$/, '') + '/Dwelling';
        console.log('[MCI Home] Navigating to Dwelling:', targetUrl);
        window.location.href = targetUrl;
      } else {
        alert('Saved Customer data, but could not find /Customer in URL to navigate to Dwelling.');
      }
    } catch (e) {
      console.error('[MCI Home] Error in Customer step:', e);
      alert('Error capturing Customer data. Check the console for [MCI Home] messages.');
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // ===== STEP 2 – DWELLING TAB =====

  function collectDwellingData() {
    console.log('[MCI Home] Collecting Dwelling-tab data…');

    const data = {};

    const dwellingAmount = getValue('#DwellingAmount');
    data.dwellingValue = dwellingAmount;

    // Fire District / Protection Class from Dwelling tab
    const pcSel = document.querySelector('#ProtectionClass');
    if (pcSel) {
      let pcVal = '';
      const idx = pcSel.selectedIndex;

      if (idx >= 0) {
        const opt = pcSel.options[idx];
        pcVal = ((opt && (opt.text || opt.value)) || '').trim();
      } else {
        pcVal = (pcSel.value || '').trim();
      }

      data.protectionClass = pcVal;
      data.fireDistrict    = pcVal;  // kept for compatibility, though form now just uses Protection Class

      console.log('[MCI Home] ProtectionClass / Fire District →', pcVal);
    } else {
      console.warn('[MCI Home] #ProtectionClass not found on Dwelling tab.');
    }

    const yearBuilt = getValue('#ConstructionYear');
    data.yearBuilt = yearBuilt;

    const sqFt = getValue('#txtLivingArea');
    data.squareFootage = sqFt;

    const consSel = document.querySelector('#ConstructionType');
    if (consSel) {
      const consVal = (consSel.value || '').trim();
      data.constructionFrame = consVal;
    }

    let swimmingPool = '';
    const poolYes = document.getElementById('HasSwimmingPoolYes');
    const poolNo  = document.getElementById('HasSwimmingPoolNo');
    if (poolYes && poolYes.checked) {
      swimmingPool = 'Yes';
    } else if (poolNo && poolNo.checked) {
      swimmingPool = 'No';
    }
    data.swimmingPool = swimmingPool;

    console.log('[MCI Home] Dwelling data object:', data);
    return data;
  }

  function goToCoveragesTab(autoMode) {
    const covTabLink = document.querySelector('#CoveragesHeaderTab a');
    if (covTabLink) {
      console.log('[MCI Home] Clicking Coverages tab link...');
      covTabLink.click();
      return true;
    }

    console.warn('[MCI Home] Coverages tab link (#CoveragesHeaderTab a) not found.');
    if (!autoMode) {
      alert('Captured Dwelling data, but could not find the Coverages tab to click. Please click it manually.');
    }
    return false;
  }

  async function handleDwelling(autoMode = false) {
    try {
      console.log('[MCI Home] Step 2 – Dwelling step starting…');
      const baseData = GM_getValue(STORAGE_KEY, null);
      if (!baseData) {
        console.warn('[MCI Home] No stored Customer data – aborting Dwelling step.');
        GM_setValue(FLOW_KEY, 'idle');
        if (!autoMode) {
          alert('No stored Customer data found. Start from the Customer step first.');
        }
        return;
      }

      const dwellingData = collectDwellingData();
      const merged = Object.assign({}, baseData, dwellingData);
      GM_setValue(STORAGE_KEY, merged);
      GM_setValue(FLOW_KEY, 'after_dwelling');

      const clicked = goToCoveragesTab(autoMode);

      if (!clicked && autoMode) {
        const href = window.location.href;
        const idx = href.indexOf('/Dwelling');
        if (idx > -1) {
          const base = href.substring(0, idx);
          const targetUrl = base.replace(/\/$/, '') + '/Coverages';
          console.log('[MCI Home] Fallback – navigating to Coverages via URL:', targetUrl);
          window.location.href = targetUrl;
        } else {
          console.warn('[MCI Home] Could not find /Dwelling in URL to navigate to Coverages.');
        }
      }
    } catch (e) {
      console.error('[MCI Home] Error in Dwelling step:', e);
      if (!autoMode) {
        alert('There was an error in the Dwelling step. Check the console for [MCI Home] messages.');
      }
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // ===== STEP 3 – COVERAGES TAB =====

  function collectCoveragesData() {
    console.log('[MCI Home] Collecting Coverages-tab data…');

    const data = {};

    const liab = getValue('#LiabilityLimit');
    data.liabilityLimit = liab;

    const med = getValue('#MedicalPayment');
    data.medPayLimit = med;

    console.log('[MCI Home] Coverages data object:', data);
    return data;
  }

  function exportToHomeForm(data, autoMode) {
    const json   = JSON.stringify(data);
    const base64 = btoa(json);
    const param  = encodeURIComponent(base64);

    const url =
      HOME_FORM_URL +
      (HOME_FORM_URL.includes('?') ? '&' : '?') +
      'mci=' + param;

    console.log('[MCI Home] Opening Home form with payload URL:', url);

    if (typeof GM_openInTab === 'function') {
      GM_openInTab(url, { active: true });
    } else {
      window.open(url, '_blank');
    }

    if (!autoMode) {
      alert('Home data exported to MCI Home Quote form (Customer + Dwelling + Coverages).');
    }

    GM_setValue(STORAGE_KEY, null);
    GM_setValue(FLOW_KEY, 'idle');
  }

  // Ensure we’re on the Home sub-tab before collecting Coverages
  async function ensureHomeCoveragesPanel() {
    function fieldsPresent() {
      return document.querySelector('#LiabilityLimit') || document.querySelector('#MedicalPayment');
    }

    if (fieldsPresent()) {
      console.log('[MCI Home] Coverages fields already present (likely Home tab already active).');
      return true;
    }

    const homeLink =
      document.querySelector('#HomeCoveragesMenuItem a') ||
      document.querySelector('#HomeCoverages-link');

    if (!homeLink) {
      console.warn('[MCI Home] Home coverages tab not found.');
      return false;
    }

    console.log('[MCI Home] Clicking Home coverages sub-tab…');
    homeLink.click();

    // Wait for Erie’s JS to swap the panel in
    for (let i = 0; i < 15; i++) {   // up to ~4.5s
      await wait(300);
      if (fieldsPresent()) {
        console.log('[MCI Home] Home coverages fields detected after tab click.');
        return true;
      }
    }

    console.warn('[MCI Home] Home coverages fields did not appear after clicking tab.');
    return false;
  }

  async function handleCoverages(autoMode = false) {
    try {
      console.log('[MCI Home] Step 3 – Coverages/export step starting…');
      const baseData = GM_getValue(STORAGE_KEY, null);
      if (!baseData) {
        console.warn('[MCI Home] No stored data – aborting Coverages step.');
        GM_setValue(FLOW_KEY, 'idle');
        if (!autoMode) {
          alert('No stored data found. Start from the Customer step.');
        }
        return;
      }

      const ok = await ensureHomeCoveragesPanel();
      if (!ok) {
        GM_setValue(FLOW_KEY, 'idle');
        if (!autoMode) {
          alert('Could not locate Home coverages panel. Please select the Home tab and re-run.');
        }
        return;
      }

      const coverageData = collectCoveragesData();
      const merged = Object.assign({}, baseData, coverageData);
      console.log('[MCI Home] Final merged Home data (Customer + Dwelling + Coverages):', merged);

      exportToHomeForm(merged, autoMode);
    } catch (e) {
      console.error('[MCI Home] Error in Coverages step:', e);
      if (!autoMode) {
        alert('There was an error in the Coverages/export step. Check the console for [MCI Home] messages.');
      }
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // ===== INIT – state machine =====
  function init() {
    const href = window.location.href;
    const flow = GM_getValue(FLOW_KEY, 'idle') || 'idle';
    console.log('[MCI Home] Init on URL:', href, 'flow state =', flow);

    if (href.includes('/Customer')) {
      // No UI, no auto-run. We just log and wait for mciRunErieHomeExport()
      console.log('[MCI Home] On Customer page – waiting for MCI Toolbox trigger.');

    } else if (href.includes('/Dwelling')) {
      if (flow === 'after_customer') {
        console.log('[MCI Home] Auto-mode: running Dwelling step.');
        handleDwelling(true);
      } else {
        console.log('[MCI Home] On Dwelling page but flow state is', flow, '– not auto-running.');
      }

    } else if (href.includes('/Coverages')) {
      if (flow === 'after_dwelling') {
        console.log('[MCI Home] Auto-mode: on Coverages page – ensuring Home tab, then exporting.');
        handleCoverages(true);
      } else {
        console.log('[MCI Home] On Coverages page but flow state is', flow, '– not auto-running.');
      }
    }
  }

  window.addEventListener('load', () => {
    wait(400).then(init);
  });

  // Expose a hook so the MCI Toolbox button can kick off the Home export
  try {
    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    pageWin.mciRunErieHomeExport = () => {
      console.log('[MCI Home] Triggered from MCI Toolbox button.');
      // Reset flow just in case, then start from Customer
      GM_setValue(FLOW_KEY, 'idle');
      handleCustomerClick();
    };
  } catch (e) {
    console.warn('[MCI Home] Could not expose mciRunErieHomeExport:', e);
  }

})();
