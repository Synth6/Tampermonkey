// ==UserScript==
// @name         MCI – Erie Auto → MCI Auto Form
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Export Erie Auto quote data (Customer, Drivers, Vehicles, Coverages) to MCI Auto Quote HTML form with one-click flow
// @author       Ron / MCI
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Customer*
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Coverages/Auto*
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Vehicle*
// @match        https://www.agentexchange.com/PersonalLinesWeb/g/*/Driver*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // ===== CONFIG =====
  const AUTO_FORM_URL = 'https://middlecreekins.com/wp-content/uploads/JonesForms/AutoQuoteForm.html';
  const STORAGE_KEY   = 'mci_erie_auto_customer_v1';
  const FLOW_KEY      = 'mci_erie_auto_flow_v1';   // "idle" | "after_customer" | "after_drivers" | "after_vehicles"

  // ===== Generic helpers =====
  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  function waitForElement(selector, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          resolve(el);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Timeout waiting for ' + selector));
        }
      }, 200);
    });
  }

  // Wait until the VIN changes from the previous one
  async function waitForVehicleChange(prevVin, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const vinInput = document.querySelector('#VIN');
      if (vinInput) {
        const v = (vinInput.value || '').trim();
        if (v && v !== prevVin) {
          return;
        }
      }
      await wait(200);
    }
    console.warn('[MCI Auto] Timeout waiting for vehicle change; continuing anyway.');
  }

  function getSelectedText(selector) {
    const sel = document.querySelector(selector);
    if (!sel) {
      console.warn('[MCI Auto] No select found for', selector);
      return '';
    }
    const opt = sel.options[sel.selectedIndex];
    const value = opt ? (opt.text || '').trim() : '';
    console.log('[MCI Auto] Selected text for', selector, '→', value);
    return value;
  }

  function getValue(selector) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn('[MCI Auto] No input/select found for', selector);
      return '';
    }
    const value = (el.value || '').trim();
    console.log('[MCI Auto] Value for', selector, '→', value);
    return value;
  }

  function getText(selector) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn('[MCI Auto] No element found for', selector);
      return '';
    }
    const value = (el.innerText || el.textContent || '').trim();
    console.log('[MCI Auto] Text for', selector, '→', value);
    return value;
  }

  function parseMailingAddress() {
    const addrDiv = document.querySelector('#mailing-address-text');
    if (!addrDiv) {
      console.warn('[MCI Auto] No #mailing-address-text found');
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
        console.warn('[MCI Auto] Could not parse city/state/zip from:', lines[1]);
      }
    }

    console.log('[MCI Auto] Parsed mailing address:', { street, city, state, zip });
    return { street, city, state, zip };
  }

  function getCounty() {
    const sel = document.querySelector('#selMailingCountyList');
    if (sel && sel.value) {
      const value = sel.value.trim();
      console.log('[MCI Auto] County from select →', value);
      return value;
    }

    const span = document.querySelector('.editor-block span.bold');
    if (span) {
      const value = (span.innerText || span.textContent || '').trim();
      console.log('[MCI Auto] County from bold span →', value);
      return value;
    }

    console.warn('[MCI Auto] County not found');
    return '';
  }

  // Get per-vehicle coverage texts (Comprehensive, Collision, RoadService, ExtendedTransportationExp)
  function getVehicleCoverageByCode(code) {
    const sels = Array.from(
      document.querySelectorAll(
        'select[data-coveragelevel="Vehicle"][data-coveragecode="' + code + '"]'
      )
    );
    const list = sels.map(sel => {
      const opt = sel.options[sel.selectedIndex];
      return opt ? (opt.text || '').trim() : '';
    });
    console.log('[MCI Auto] Coverage', code, 'per-vehicle =', list);
    return list;
  }

  // =========================
  // STEP 1 – CUSTOMER TAB
  // =========================
  function collectCustomerData() {
    const mailing = parseMailingAddress();

    const data = {
      // ---- Policy & insured info ----
      named_insured: getSelectedText('#ddlFirstNamedInsured'),
      insured_email: getText('.customer-lockdown-email'),

      garaging_address: mailing.street,
      city:             mailing.city,
      zip_code:         mailing.zip,
      county:           getCounty(),

      prior_carrier_premium: '',
      limit_of_liability:  '',
      med_pay_limit:       '',
      um_limit:            '',
      uim_limit:           '',
      prior_policy_term:         '',
      continuous_coverage_12mo:  '',
      date_policy_cancelled:     '',

      // Vehicles / Drivers placeholders
      veh1_class_use_type: '', veh1_vin: '', veh1_year: '', veh1_make: '', veh1_model: '',
      veh1_comp_ded: '',       veh1_coll_ded: '',       veh1_tow_limit: '', veh1_rental_limit: '',

      veh2_class_use_type: '', veh2_vin: '', veh2_year: '', veh2_make: '', veh2_model: '',
      veh2_comp_ded: '',       veh2_coll_ded: '',       veh2_tow_limit: '', veh2_rental_limit: '',

      veh3_class_use_type: '', veh3_vin: '', veh3_year: '', veh3_make: '', veh3_model: '',
      veh3_comp_ded: '',       veh3_coll_ded: '',       veh3_tow_limit: '', veh3_rental_limit: '',

      veh4_class_use_type: '', veh4_vin: '', veh4_year: '', veh4_make: '', veh4_model: '',
      veh4_comp_ded: '',       veh4_coll_ded: '',       veh4_tow_limit: '', veh4_rental_limit: '',

      drv1_name: '', drv1_dob: '', drv1_dl: '', drv1_state: '', drv1_ssn: '', drv1_occupation: '',
      drv2_name: '', drv2_dob: '', drv2_dl: '', drv2_state: '', drv2_ssn: '', drv2_occupation: '',
      drv3_name: '', drv3_dob: '', drv3_dl: '', drv3_state: '', drv3_ssn: '', drv3_occupation: '',
      drv4_name: '', drv4_dob: '', drv4_dl: '', drv4_state: '', drv4_ssn: '', drv4_occupation: '',

      rent_or_own: '',
      home_currently_with_agency: '',
      home_insurance_company: '',
      claims_last_4_years: ''
    };

    console.log('[MCI Auto] Customer data collected:', data);
    return data;
  }

  function handleCustomerClick() {
    try {
      console.log('[MCI Auto] Step 1 – Collecting Customer data…');
      const data = collectCustomerData();
      GM_setValue(STORAGE_KEY, data);
      console.log('[MCI Auto] Stored Customer data into GM storage:', data);

      // Set flow to auto-run next step on Drivers page
      GM_setValue(FLOW_KEY, 'after_customer');

      // Navigate to Drivers tab
      const drvTab = document.querySelector('#DriverHeaderTab a');
      if (drvTab) {
        const dataUrl = drvTab.getAttribute('data-url'); // "Driver"
        if (dataUrl) {
          const href = window.location.href;
          const idx  = href.indexOf('/Customer');
          const base = idx > -1 ? href.substring(0, idx) : href;
          const targetUrl = base.replace(/\/$/, '') + '/' + dataUrl.replace(/^\//, '');
          console.log('[MCI Auto] Navigating to Drivers:', targetUrl);
          window.location.href = targetUrl;
        } else {
          alert('Saved Customer data, but could not find Drivers URL (data-url missing).');
        }
      } else {
        alert('Saved Customer data. Now click the "Drivers" tab and the script will continue automatically.');
      }
    } catch (e) {
      console.error('[MCI Auto] Error in Step 1:', e);
      alert('Error capturing Customer data. Check the console.');
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // =========================
  // STEP 2 – DRIVERS TAB
  // =========================

  async function collectDrivers() {
    const buttons = Array.from(
      document.querySelectorAll('#DriverGridTableItems .driver-view-edit-button')
    );

    console.log('[MCI Auto] Found', buttons.length, 'driver rows.');
    const drivers = [];

    for (let i = 0; i < buttons.length && i < 4; i++) {
      console.log(`[MCI Auto] === DRIVER LOOP START #${i + 1} ===`);
      try {
        const btn = buttons[i];
        if (!btn) {
          console.warn('[MCI Auto] No button element for driver index', i);
          continue;
        }

        console.log('[MCI Auto] Clicking driver View/Edit button for driver', i + 1);
        btn.click();

        try {
          await waitForElement('#DriverContentFrame', 15000);
          console.log('[MCI Auto] DriverContentFrame visible for driver', i + 1);
        } catch (e) {
          console.warn('[MCI Auto] Timeout waiting for DriverContentFrame for driver', i + 1, e);
        }

        await wait(300);

        const firstInput =
          document.querySelector('#DriverContentFrame #txtFirstName') ||
          document.querySelector('#txtFirstName');
        const lastInput =
          document.querySelector('#DriverContentFrame #txtLastName') ||
          document.querySelector('#txtLastName');

        const firstName = firstInput ? (firstInput.value || '').trim() : '';
        const lastName  = lastInput  ? (lastInput.value  || '').trim() : '';

        const dobInput =
          document.querySelector('#DriverContentFrame #txtDateOfBirth_') ||
          document.querySelector('#txtDateOfBirth_');
        let dob = '';
        if (dobInput) {
          try {
            dobInput.focus();
            dobInput.dispatchEvent(new Event('focus', { bubbles: true }));
          } catch (e) {
            console.warn('[MCI Auto] Could not focus DOB for driver', i + 1, e);
          }
          await wait(200);
          dob = (dobInput.value || '').trim();
        }

        const dlInput =
          document.querySelector('#DriverContentFrame #txtLicenseNumber') ||
          document.querySelector('#txtLicenseNumber');
        const dlNumber = dlInput ? (dlInput.value || '').trim() : '';

        const stateSel =
          document.querySelector('#DriverContentFrame #selLicenseState') ||
          document.querySelector('#selLicenseState');
        const dlState = stateSel ? (stateSel.value || '').trim() : '';

        const ssnInput =
          document.querySelector('#DriverContentFrame #SSNText_1') ||
          document.querySelector('#SSNText_1');
        const ssn = ssnInput ? (ssnInput.value || '').trim() : '';

        const driverObj = {
          firstName,
          lastName,
          fullName: [firstName, lastName].filter(Boolean).join(' '),
          dob,
          dlNumber,
          dlState,
          ssn
        };

        console.log('[MCI Auto] Driver #' + (i + 1) + ' data:', driverObj);
        drivers.push(driverObj);

        const cancelBtn =
          document.querySelector('#DriverContentFrame #btnCancelDriver') ||
          document.querySelector('#btnCancelDriver');
        if (cancelBtn) {
          console.log('[MCI Auto] Clicking Cancel for driver', i + 1);
          cancelBtn.click();
          await wait(300);
        } else {
          console.warn('[MCI Auto] Cancel button not found for driver', i + 1);
        }
      } catch (e) {
        console.error('[MCI Auto] Error while scraping driver #', i + 1, e);
      }
      console.log(`[MCI Auto] === DRIVER LOOP END #${i + 1} ===`);
    }

    console.log('[MCI Auto] Finished collectDrivers. Total scraped:', drivers.length);
    return drivers;
  }

  async function handleDrivers(autoMode = false) {
    try {
      console.log('[MCI Auto] Step 2 – loading Customer data from storage…');
      const baseData = GM_getValue(STORAGE_KEY, null);
      if (!baseData) {
        if (!autoMode) {
          alert('No stored Customer data found. Start from the Customer step first.');
        }
        console.warn('[MCI Auto] No stored Customer data – aborting Drivers step.');
        GM_setValue(FLOW_KEY, 'idle');
        return;
      }

      const drivers = await collectDrivers();
      console.log('[MCI Auto] Drivers array:', drivers);

      const merged = Object.assign({}, baseData);

      drivers.forEach((d, idx) => {
        const n = idx + 1;
        const prefix = `drv${n}_`;
        merged[prefix + 'name']  = d.fullName || '';
        merged[prefix + 'dob']   = d.dob || '';
        merged[prefix + 'dl']    = d.dlNumber || '';
        merged[prefix + 'state'] = d.dlState || '';
        merged[prefix + 'ssn']   = d.ssn || '';
      });

      GM_setValue(STORAGE_KEY, merged);
      console.log('[MCI Auto] Merged data with Drivers:', merged);

      // Set flow state for Vehicles
      GM_setValue(FLOW_KEY, 'after_drivers');

      // Navigate to Vehicles tab
      const vehTab = document.querySelector('#VehicleHeaderTab a');
      if (vehTab) {
        const dataUrl = vehTab.getAttribute('data-url'); // "Vehicle"
        if (dataUrl) {
          const href = window.location.href;
          const idx  = href.indexOf('/Driver');
          const base = idx > -1 ? href.substring(0, idx) : href;
          const targetUrl = base.replace(/\/$/, '') + '/' + dataUrl.replace(/^\//, '');
          console.log('[MCI Auto] Navigating to Vehicles:', targetUrl);
          window.location.href = targetUrl;
        } else if (!autoMode) {
          alert('Saved Drivers. Could not find Vehicles URL (data-url missing).');
        }
      } else if (!autoMode) {
        alert('Saved Drivers. Now click the "Vehicles" tab and the script will continue there.');
      }
    } catch (e) {
      console.error('[MCI Auto] Error in Step 2 (Drivers):', e);
      if (!autoMode) {
        alert('There was an error loading driver data. Check the console for details.');
      }
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // =========================
  // STEP 3 – VEHICLES TAB
  // =========================

  // Wait until Year / Make / Model spans have some text
  async function waitForVehicleDetails(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const yearSpan  = document.querySelector('span[data-bind*="VehicleFormContainer.VehicleForm.Year"]');
      const makeSpan  = document.querySelector('span[data-bind*="VehicleFormContainer.VehicleForm.FullMake"]');
      const modelSpan = document.querySelector('span[data-bind*="VehicleFormContainer.VehicleForm.FullModel"]');

      const year  = yearSpan  ? (yearSpan.innerText  || yearSpan.textContent  || '').trim() : '';
      const make  = makeSpan  ? (makeSpan.innerText  || makeSpan.textContent  || '').trim() : '';
      const model = modelSpan ? (modelSpan.innerText || modelSpan.textContent || '').trim() : '';

      if (year || make || model) {
        return { year, make, model };
      }
      await wait(200);
    }
    console.warn('[MCI Auto] Timeout waiting for vehicle details; returning blanks.');
    return { year: '', make: '', model: '' };
  }

  async function collectVehicles() {
    const maxVehicles = Math.min(
      4,
      document.querySelectorAll('table.DataTable.tableStyle a.vehicle-name').length
    );

    console.log('[MCI Auto] Found', maxVehicles, 'vehicle rows.');
    const vehicles = [];

    for (let i = 0; i < maxVehicles; i++) {
      console.log(`[MCI Auto] Opening vehicle #${i + 1}`);

      // Re-query links each loop so we don't use stale references
      const links = document.querySelectorAll('table.DataTable.tableStyle a.vehicle-name');
      const link = links[i];
      if (!link) {
        console.warn('[MCI Auto] No vehicle link at index', i);
        continue;
      }

      // VIN before clicking (to detect change)
      const vinInputBefore = document.querySelector('#VIN');
      const prevVin = vinInputBefore ? (vinInputBefore.value || '').trim() : '';

      // Open this vehicle’s detail panel
      link.click();

      // Wait for vehicle form and for VIN to change
      await waitForElement('#VehicleType', 8000);
      await waitForVehicleChange(prevVin, 8000);

      // ---- Class Use Type ----
      let classUseType = '';
      const classUseSel = document.querySelector('#VehicleType');
      if (classUseSel) {
        const opt = classUseSel.options[classUseSel.selectedIndex];
        classUseType = opt ? (opt.text || '').trim() : '';
      }

      // ---- Full VIN from detail form ----
      let vin = '';
      const vinInput = document.querySelector('#VIN');
      if (vinInput) {
        vin = (vinInput.value || '').trim();
      }

      // ---- Year / Make / Model (wait until populated) ----
      const details = await waitForVehicleDetails(8000);
      const year  = details.year;
      const make  = details.make;
      const model = details.model;

      const vObj = { classUseType, vin, year, make, model };
      vehicles.push(vObj);
      console.log('[MCI Auto] Vehicle #' + (i + 1) + ' data:', vObj);
    }

    console.log('[MCI Auto] Finished collectVehicles. Total scraped:', vehicles.length);
    return vehicles;
  }

  async function handleVehicles(autoMode = false) {
    try {
      console.log('[MCI Auto] Step 3 – Loading Customer+Drivers from storage…');
      const baseData = GM_getValue(STORAGE_KEY, null);
      if (!baseData) {
        if (!autoMode) {
          alert('No stored Customer/Driver data found. Run the earlier steps first.');
        }
        console.warn('[MCI Auto] No stored Customer/Driver data – aborting Vehicles step.');
        GM_setValue(FLOW_KEY, 'idle');
        return;
      }

      const vehicles = await collectVehicles();
      console.log('[MCI Auto] Collected vehicles array:', vehicles);

      const merged = Object.assign({}, baseData);

      vehicles.forEach((v, idx) => {
        const n = idx + 1;
        merged[`veh${n}_class_use_type`] = v.classUseType || '';
        merged[`veh${n}_vin`]            = v.vin || '';
        merged[`veh${n}_year`]           = v.year || '';
        merged[`veh${n}_make`]           = v.make || '';
        merged[`veh${n}_model`]          = v.model || '';
      });

      console.log('[MCI Auto] Merged data with Vehicles:', merged);
      GM_setValue(STORAGE_KEY, merged);

      // Set flow state for Coverages
      GM_setValue(FLOW_KEY, 'after_vehicles');

      // Navigate to Coverages tab
      const covTab = document.querySelector('#CoveragesHeaderTab a');
      if (covTab) {
        const dataUrl = covTab.getAttribute('data-url'); // e.g. "Coverages/Auto?shouldRate=true"
        if (dataUrl) {
          const href = window.location.href;
          const idx  = href.indexOf('/Vehicle');
          const base = idx > -1 ? href.substring(0, idx) : href;
          const targetUrl = base.replace(/\/$/, '') + '/' + dataUrl.replace(/^\//, '');
          console.log('[MCI Auto] Navigating to Coverages:', targetUrl);
          window.location.href = targetUrl;
        } else if (!autoMode) {
          alert('Saved Vehicles. Could not find Coverages URL (data-url missing).');
        }
      } else if (!autoMode) {
        alert('Saved Vehicles. Now click the "Coverages" tab and run the final step there.');
      }
    } catch (e) {
      console.error('[MCI Auto] Error in Step 3 (Vehicles):', e);
      if (!autoMode) {
        alert('There was an error loading vehicle data. Check the console for details.');
      }
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // =========================
  // STEP 4 – COVERAGES TAB (EXPORT)
  // =========================

  function collectCoveragesData() {
    const data = {
      limit_of_liability: getSelectedText('#BodilyInjury_Policy'),
      med_pay_limit:      getSelectedText('#NCMedicalPayments0'),
      uim_limit:          getSelectedText('#UIMBodilyInjury_Policy'),
      um_limit:           getSelectedText('#UMBodilyInjury_Policy')
    };

    const compList   = getVehicleCoverageByCode('Comprehensive');
    const collList   = getVehicleCoverageByCode('Collision');
    const towList    = getVehicleCoverageByCode('RoadService');
    const rentalList = getVehicleCoverageByCode('ExtendedTransportationExp');

    for (let i = 0; i < 4; i++) {
      const n = i + 1;
      data['veh' + n + '_comp_ded']     = compList[i]   || '';
      data['veh' + n + '_coll_ded']     = collList[i]   || '';
      data['veh' + n + '_tow_limit']    = towList[i]    || '';
      data['veh' + n + '_rental_limit'] = rentalList[i] || '';
    }

    console.log('[MCI Auto] Coverages data collected (incl per-vehicle):', data);
    return data;
  }

  function handleCoverages(autoMode = false) {
    try {
      console.log('[MCI Auto] Step 4 – loading combined data from storage…');
      const baseData = GM_getValue(STORAGE_KEY, null);
      if (!baseData) {
        if (!autoMode) {
          alert('No stored data found. Run the earlier steps first (Customer, Drivers, Vehicles).');
        }
        console.warn('[MCI Auto] No stored data – aborting Coverages step.');
        GM_setValue(FLOW_KEY, 'idle');
        return;
      }

      const cov = collectCoveragesData();
      const merged = Object.assign({}, baseData, cov);
      console.log('[MCI Auto] Final merged data (Customer + Drivers + Vehicles + Coverages):', merged);

      const json   = JSON.stringify(merged);
      const base64 = btoa(json);
      const param  = encodeURIComponent(base64);

      const url =
        AUTO_FORM_URL +
        (AUTO_FORM_URL.includes('?') ? '&' : '?') +
        'mci=' + param;

      console.log('[MCI Auto] Opening Auto form with payload URL:', url);

      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true });
      } else {
        window.open(url, '_blank');
      }

      if (!autoMode) {
        alert('Auto data exported (Customer + Drivers + Vehicles + Coverages).');
      }

      GM_setValue(STORAGE_KEY, null);
      GM_setValue(FLOW_KEY, 'idle');
    } catch (e) {
      console.error('[MCI Auto] Error in Step 4 (Coverages/export):', e);
      if (!autoMode) {
        alert('There was an error exporting data. Check the console for [MCI Auto] messages.');
      }
      GM_setValue(FLOW_KEY, 'idle');
    }
  }

  // =========================
  // INIT – state machine by URL
  // =========================
  function init() {
    const href = window.location.href;
    const flow = GM_getValue(FLOW_KEY, 'idle') || 'idle';
    console.log('[MCI Auto] Init on URL:', href, 'flow state =', flow);

    if (href.includes('/Customer')) {
      // When we land on Customer, just reset and wait for Toolbox trigger
      GM_setValue(FLOW_KEY, 'idle');
      console.log('[MCI Auto] On Customer page – waiting for MCI Toolbox trigger.');

    } else if (href.includes('/Driver')) {
      if (flow === 'after_customer') {
        console.log('[MCI Auto] Auto-mode: running Drivers step.');
        handleDrivers(true);
      } else {
        console.log('[MCI Auto] On Drivers page but flow state is', flow, '– not auto-running.');
      }

    } else if (href.includes('/Vehicle')) {
      if (flow === 'after_drivers') {
        console.log('[MCI Auto] Auto-mode: running Vehicles step.');
        handleVehicles(true);
      } else {
        console.log('[MCI Auto] On Vehicles page but flow state is', flow, '– not auto-running.');
      }

    } else if (href.includes('/Coverages/Auto')) {
      if (flow === 'after_vehicles') {
        console.log('[MCI Auto] Auto-mode: running Coverages/export step.');
        handleCoverages(true);
      } else {
        console.log('[MCI Auto] On Coverages page but flow state is', flow, '– not auto-running.');
      }
    } else {
      console.log('[MCI Auto] Script loaded, but URL did not match expected paths.');
    }
  }

  window.addEventListener('load', () => {
    // tiny delay so Erie’s JS has time to paint
    wait(400).then(init);
  });

  // Expose a hook so the MCI Toolbox button can kick off the Auto export
  try {
    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    pageWin.mciRunErieAutoExport = () => {
      console.log('[MCI Auto] Triggered from MCI Toolbox button.');
      GM_setValue(FLOW_KEY, 'idle');  // reset flow just in case
      handleCustomerClick();
    };
  } catch (e) {
    console.warn('[MCI Auto] Could not expose mciRunErieAutoExport:', e);
  }

})();