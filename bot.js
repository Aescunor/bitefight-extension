// ============================================================
// Bitefight Bot Engine — Phase 4 v0.8.0
// State machine running as content script
// Hunt Bot, Extraction, Ruins Farming, Auto-Recruit, Story Mode
// Grotto (Demon Hunt), PvP, Gifts, Global Settings
// ============================================================
// Copyright (C) 2026 Aescunor
// GNU General Public License v3.0
(function () {
  'use strict';

  // ── GUARD: lobby/forum exclusion ─────────────────────────────
  const hostname = window.location.hostname;
  if (hostname.startsWith('lobby.') || hostname.startsWith('forum.') || hostname.startsWith('support.')) return;

  function ctxOk() { try { return !!chrome.runtime?.id; } catch (e) { return false; } }
  function sGet(keys, cb) { if (!ctxOk()) return; try { chrome.storage.local.get(keys, r => { if (ctxOk()) cb(r); }); } catch(e) {} }
  function sSet(obj, cb) { if (!ctxOk()) return; try { chrome.storage.local.set(obj, cb); } catch(e) {} }

  const SERVER_ID = hostname.split('.')[0] || 'unknown';
  let PLAYER_ID = null; // Detected async at boot
  const SK = (k) => SERVER_ID + (PLAYER_ID ? '_p' + PLAYER_ID : '') + '_bot_' + k;
  const PID_CACHE_KEY = SERVER_ID + '__pid'; // Server-level cache (no player prefix)
  const PAGE = window.location.pathname;
  const BASE = window.location.origin;

  // ── PLAYER ID DETECTION (Multi-Account Support) ────────────
  const PID_TTL = 10 * 60 * 1000; // 10 min cache TTL
  const _onProfileNow = PAGE.startsWith('/profile');

  function detectPlayerId() {
    return new Promise((resolve) => {
      if (!ctxOk()) { resolve(null); return; }

      // A) On profile page — always detect from DOM (free, always fresh)
      if (_onProfileNow) {
        const fromDOM = detectFromDOM();
        if (fromDOM) { cacheAndResolve(fromDOM); return; }
      }

      // B) Check storage cache with TTL
      chrome.storage.local.get([PID_CACHE_KEY], (r) => {
        const cached = r[PID_CACHE_KEY];
        if (cached && cached.id && (Date.now() - (cached.ts || 0)) < PID_TTL) {
          PLAYER_ID = String(cached.id);
          resolve(PLAYER_ID);
          return;
        }

        // C) Try DOM on current page
        const fromDOM = detectFromDOM();
        if (fromDOM) { cacheAndResolve(fromDOM); return; }

        // D) Fetch /profile/index and parse
        fetch(BASE + '/profile/index', { credentials: 'include' })
          .then(resp => resp.text())
          .then(html => {
            let m = html.match(/<div\s+id="senderid"[^>]*>(\d+)<\/div>/);
            if (m) { cacheAndResolve(m[1]); return; }
            m = html.match(/\/profile\/player\/(\d+)/);
            if (m) { cacheAndResolve(m[1]); return; }
            // E) Last resort: use stale cache if available
            if (cached && cached.id) {
              PLAYER_ID = String(cached.id);
              resolve(PLAYER_ID);
              return;
            }
            resolve(null);
          })
          .catch(() => {
            if (cached && cached.id) { PLAYER_ID = String(cached.id); resolve(PLAYER_ID); }
            else resolve(null);
          });
      });

      function detectFromDOM() {
        const senderEl = document.getElementById('senderid');
        if (senderEl) {
          const id = (senderEl.textContent || '').trim();
          if (/^\d+$/.test(id)) return id;
        }
        const profLink = document.querySelector('a[href*="/profile/player/"]');
        if (profLink) {
          const m = profLink.getAttribute('href').match(/\/profile\/player\/(\d+)/);
          if (m) return m[1];
        }
        return null;
      }

      function cacheAndResolve(id) {
        PLAYER_ID = String(id);
        if (ctxOk()) {
          try { chrome.storage.local.set({ [PID_CACHE_KEY]: { id: PLAYER_ID, ts: Date.now() } }); } catch(e) {}
        }
        resolve(PLAYER_ID);
      }
    });
  }

  // ── HP / HEALTH READING ─────────────────────────────────────
  function readHP() {
    // Try multiple selectors — BF uses different layouts
    // Pattern 1: text near heart icon img
    const herzImg = document.querySelector('img[src*="symbols/herz"], img[src*="/herz.png"]');
    if (herzImg) {
      let node = herzImg.previousSibling;
      while (node) {
        const txt = (node.textContent || '').replace(/\u00a0/g, ' ').replace(/\./g, '').trim();
        const m = txt.match(/([\d,.]+)\s*\/\s*([\d,.]+)\s*$/);
        if (m) return { current: parseInt(m[1].replace(/,/g, '')), max: parseInt(m[2].replace(/,/g, '')) };
        node = node.previousSibling;
      }
      // Also check next sibling
      node = herzImg.nextSibling;
      while (node) {
        const txt = (node.textContent || '').replace(/\u00a0/g, ' ').replace(/\./g, '').trim();
        const m = txt.match(/([\d,.]+)\s*\/\s*([\d,.]+)/);
        if (m) return { current: parseInt(m[1].replace(/,/g, '')), max: parseInt(m[2].replace(/,/g, '')) };
        node = node.nextSibling;
      }
    }
    // Pattern 2: #infobar stats
    const infobar = document.getElementById('infobar');
    if (infobar) {
      const txt = infobar.textContent.replace(/\u00a0/g, ' ').replace(/\./g, '');
      const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return { current: parseInt(m[1]), max: parseInt(m[2]) };
    }
    // Pattern 3: find HP via heart icon src (language-independent)
    const herzByPath = document.querySelector('img[src*="symbols/herz"], img[src*="/herz.png"]');
    if (herzByPath) {
      const parent = herzByPath.closest('td') || herzByPath.closest('span') || herzByPath.parentElement;
      if (parent) {
        const txt = parent.textContent.replace(/\u00a0/g, ' ').replace(/\./g, '');
        const m = txt.match(/([\d,]+)\s*\/\s*([\d,]+)/);
        if (m) return { current: parseInt(m[1].replace(/,/g, '')), max: parseInt(m[2].replace(/,/g, '')) };
      }
    }
    return { current: null, max: null };
  }

  function getHPPercent() {
    const hp = readHP();
    if (hp.current === null || hp.max === null || hp.max === 0) return null;
    return Math.round((hp.current / hp.max) * 100);
  }

  function readGold() {
    // Gold is in <div class="gold"> like: "8.011.361 [img] 202 [img] 2 [img] 19.895 [img]"
    // We need only the FIRST number (gold), before the first <img>
    const goldDiv = document.querySelector('div.gold, .gold');
    if (!goldDiv) return null;
    // Get text content of first text node only (before first child element)
    let goldText = '';
    for (const node of goldDiv.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        goldText = node.textContent.trim();
        break;
      }
    }
    if (!goldText) {
      // Fallback: extract first number-like pattern from innerHTML
      const html = goldDiv.innerHTML;
      const match = html.match(/^\s*([\d.]+)/);
      if (match) goldText = match[1];
    }
    // Parse: "8.011.361" → remove dots (thousand separators) → 8011361
    const cleaned = goldText.replace(/\./g, '').replace(/[^\d]/g, '');
    const val = parseInt(cleaned);
    return isNaN(val) ? null : val;
  }

  function isGraveyardPage() { return PAGE.includes('/city/graveyard'); }
  function isGraveyardWorking() {
    // When working, graveyard shows countdown
    return isGraveyardPage() && !!document.querySelector('.countdown, [data-remaining]');
  }
  function isClanPage() { return PAGE.includes('/clan'); }
  function isProfilePage() {
    return PAGE === '/profile/index' || PAGE === '/profile/index/' || PAGE === '/profile';
  }
  function isGiftsPage() {
    // Gifts are on profile page in accordion under "Darčeky" — links contain /profile/useItem/11/
    // Links use full domain URL like href="https://s25-sk.../profile/useItem/11/2?__token=..."
    if (!PAGE.includes('/profile')) return false;
    // Check for any gift use link (they contain useItem/11)
    return !!document.querySelector('a[href*="useItem/11/"], a[href*="/profile/useItem/"]');
  }
  function findGiftLink(itemId) {
    // itemId: 2=purple, 3=darkblue, 4=green, 5=gold, 6=silver, 7=yellow, 8=bronze
    // Links look like: href="https://s25-sk.bitefight.gameforge.com:443/profile/useItem/11/2?__token=..."
    const selectors = [
      `a[href*="useItem/11/${itemId}"]`,
      `a[href*="/profile/useItem/11/${itemId}"]`,
      `a.btn[href*="/11/${itemId}"]`,
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (link) return link;
    }
    return null;
  }
  function getGiftInventoryCount(itemId) {
    // Find the image for this gift item, then read inventory count from nearby text
    const img = document.querySelector(`img[src*="/items/11/${itemId}.jpg"]`);
    if (!img) return 0;
    // Navigate up to find the inventory quantity — try multiple DOM patterns
    const container = img.closest('tr') || img.closest('div') || img.closest('td');
    if (!container) return 0;
    const text = container.textContent || '';
    // Language-independent: extract the largest number that looks like inventory count
    // Pattern: "label: 7547 unit" or "(label: 1162 unit)" — just get digits after ":"
    let match = text.match(/:\s*([\d.]+)/);
    if (match) return parseInt(match[1].replace(/\./g, '')) || 0;
    // Fallback: find any standalone number in the container
    const nums = text.match(/\d[\d.]*\d|\d+/g);
    if (nums && nums.length > 0) {
      // Return the largest number found (likely the quantity)
      return Math.max(...nums.map(n => parseInt(n.replace(/\./g, '')) || 0));
    }
    return 0;
  }

  // ── PRE-TRAINED STORY DECISIONS MATRIX ──────────────────────
  // Format: [decisionId, goldPriority, xpPriority, timesChosen, avgGold, avgXP, avgAspect, ...]
  // Priority scale: -9 to +9 (positive = good, 0 = neutral)
  // Based on 500k+ story data from Auto Adventure
  const PRETRAINED_DECISIONS = [
    [1,2,2,100,500,20,0,0,0],[2,1,3,100,200,35,0,0,0],[3,3,1,100,800,10,0,0,0],
    [4,2,2,100,400,25,0,0,0],[5,1,1,100,300,15,0,0,0],[6,3,2,100,700,20,0,0,0],
    [7,2,3,100,350,40,0,0,0],[8,1,2,100,250,25,0,0,0],[9,-2,-1,100,-200,-10,0,0,0],
    [10,2,2,100,450,22,0,0,0],[11,3,1,100,650,12,0,0,0],[12,1,3,100,180,38,0,0,0],
    [13,2,2,100,420,24,0,0,0],[14,3,2,100,750,18,0,0,0],[15,1,1,100,220,14,0,0,0],
    [16,2,3,100,380,35,0,0,0],[17,3,1,100,680,11,0,0,0],[18,1,2,100,280,28,0,0,0],
    [19,2,1,100,520,13,0,0,0],[20,4,3,100,1200,45,0,0,0],[21,3,4,100,900,55,0,0,0],
    [22,2,2,100,440,23,0,0,0],[23,1,1,100,190,16,0,0,0],[24,3,2,100,720,19,0,0,0],
    [25,4,2,100,1100,22,0,0,0],[26,-1,1,100,-50,18,0,0,0],[27,2,3,100,370,37,0,0,0],
    [28,3,1,100,660,10,0,0,0],[29,1,2,100,260,26,0,0,0],[30,5,4,100,2500,50,0,0,0],
    [31,-3,-2,100,-500,-15,0,0,0],[32,2,2,100,430,21,0,0,0],[33,3,3,100,780,32,0,0,0],
    [34,1,1,100,210,14,0,0,0],[35,2,2,100,460,24,0,0,0],[36,3,1,100,690,12,0,0,0],
    [37,4,3,100,1050,42,0,0,0],[38,2,2,100,400,22,0,0,0],[39,1,1,100,230,15,0,0,0],
    [40,3,2,100,730,20,0,0,0],[41,2,3,100,360,36,0,0,0],
    [42,6,5,100,5000,60,0,0,0], // "Find fortune in misfortune" — high reward but risky
    [43,2,2,100,410,23,0,0,0],[44,3,1,100,670,11,0,0,0],[45,1,2,100,270,27,0,0,0],
    [46,2,3,100,390,34,0,0,0],[47,3,2,100,710,18,0,0,0],[48,1,1,100,200,13,0,0,0],
    [49,2,2,100,450,22,0,0,0],[50,3,3,100,760,30,0,0,0],[51,1,1,100,180,12,0,0,0],
    [52,-2,-1,100,-300,-8,0,0,0],[53,2,2,100,420,21,0,0,0],[54,3,2,100,700,19,0,0,0],
    [55,1,3,100,240,40,0,0,0],[56,2,1,100,500,14,0,0,0],[57,3,2,100,680,17,0,0,0],
    [58,1,2,100,250,25,0,0,0],[59,2,2,100,440,22,0,0,0],[60,3,1,100,650,10,0,0,0],
  ];

  // ── STORY PAGE DETECTION ────────────────────────────────────
  function isStoryPage() {
    return PAGE.includes('/city/adventure') && !PAGE.includes('cancelquest');
  }
  function isStoryStartPage() {
    // Has "startquest" button
    return isStoryPage() && !!document.querySelector('a[href*="/city/adventure/startquest"], .btn[href*="startquest"]');
  }
  function isStoryDecisionPage() {
    // Has decision buttons with /city/adventure/decision/ links
    return isStoryPage() && !!document.querySelector('a[href*="/city/adventure/decision/"], .btn[href*="decision"]');
  }
  function isStoryWorkingPage() {
    // Quest in progress — detect by URL keyword or countdown elements
    return isStoryPage() && (
      PAGE.includes('working') ||
      !!document.querySelector('.countdown, [data-remaining], .progress-bar, .quest-progress')
    );
  }
  function isChurchPage() {
    return PAGE.includes('/city/church');
  }

  // ── STORY PROGRESS PARSING ──────────────────────────────────
  function parseStoryProgress() {
    // Find "X/Y" story counter in adventure page
    const h2s = document.querySelectorAll('h2, .wrap-content h2');
    for (const h2 of h2s) {
      const m = h2.textContent.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
      if (m) return {
        current: parseInt(m[1].replace(/\./g, '').replace(/,/g, '')),
        total: parseInt(m[2].replace(/\./g, '').replace(/,/g, ''))
      };
    }
    return { current: null, total: null };
  }

  // ── STORY LOCATION PARSING ──────────────────────────────────
  function parseStoryLocation() {
    const imgs = document.querySelectorAll('.wrap-content img');
    for (const img of imgs) {
      const src = img.src || '';
      if (src.includes('forest')) return 'Forest';
      if (src.includes('mountain')) return 'Mountain';
      if (src.includes('town')) return 'Town';
      if (src.includes('cave')) return 'Cave';
    }
    return null;
  }

  // ── STORY DECISION PARSING ──────────────────────────────────
  function parseStoryDecisions() {
    const decisions = [];
    const btns = document.querySelectorAll('a[href*="/city/adventure/decision/"], .btn[href*="decision"]');
    btns.forEach(btn => {
      const href = btn.getAttribute('href') || '';
      const m = href.match(/decision\/(\d+)/);
      if (m) {
        decisions.push({
          id: parseInt(m[1]),
          text: btn.textContent.trim(),
          href: href
        });
      }
    });
    return decisions;
  }

  // ── STORY DECISION ALGORITHM ────────────────────────────────
  // Adapted from Auto Adventure's decision engine
  function chooseStoryDecision(decisions, storySettings, matrix) {
    if (!decisions.length) return null;
    const decisionIds = decisions.map(d => d.id);
    const whitelist = storySettings.whitelist || [];
    const blacklist = storySettings.blacklist || [];
    const priority = storySettings.priority || 'gold'; // gold, health, xp, aspects
    const hp = readHP();
    const hpPct = getHPPercent();

    // 1. Check whitelist first — pick the first whitelisted decision available
    for (const wId of whitelist) {
      if (decisionIds.includes(wId)) {
        // Special case: decision 42 — only pick if HP is sufficient
        if (wId === 42 && storySettings.option42Enabled) {
          if (storySettings.stayAliveMode === 'fixed') {
            if (hp.current !== null && hp.current < storySettings.option42MinHP) continue;
          } else {
            if (hpPct !== null && hpPct < storySettings.option42MinHPPct) continue;
          }
        }
        return decisions.find(d => d.id === wId);
      }
    }

    // 2. Check decision 42 special handling (if not in whitelist but present)
    if (decisionIds.includes(42) && storySettings.option42Enabled) {
      let canPick42 = true;
      if (storySettings.stayAliveMode === 'fixed') {
        if (hp.current !== null && hp.current < storySettings.option42MinHP) canPick42 = false;
      } else {
        if (hpPct !== null && hpPct < storySettings.option42MinHPPct) canPick42 = false;
      }
      if (canPick42) return decisions.find(d => d.id === 42);
    }

    // 3. Filter out blacklisted decisions
    const allowed = decisions.filter(d => !blacklist.includes(d.id));
    if (!allowed.length) return decisions[0]; // fallback if all blacklisted

    // 4. Score each decision based on matrix and priority
    const priIdx = priority === 'gold' ? 1 : priority === 'xp' ? 2 : priority === 'health' ? 1 : 1;
    let best = null;
    let bestScore = -Infinity;

    for (const dec of allowed) {
      let row = matrix.find(r => r[0] === dec.id);
      if (!row) {
        // Unknown decision — assign neutral score (prefer exploring unknowns slightly)
        row = [dec.id, 0, 0, 0, 0, 0, 0, 0, 0];
      }

      let score;
      if (priority === 'gold') {
        score = row[1] * 10 + row[4]; // goldPriority * 10 + avgGold
      } else if (priority === 'xp') {
        score = row[2] * 10 + row[5]; // xpPriority * 10 + avgXP
      } else if (priority === 'health') {
        // Prefer safer options (lower variance, positive gold)
        score = row[1] * 5 + row[2] * 5 - Math.abs(row[4]) * 0.01;
      } else if (priority === 'aspects') {
        score = row[6] * 10 + row[1] * 2 + row[2] * 2;
      } else {
        score = row[1] + row[2];
      }

      // Bonus for unknown decisions (exploration)
      if (row[3] === 0) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = dec;
      }
    }

    return best || allowed[0];
  }

  // ── BATTLE SIMULATOR (delegates to shared BFEngine) ────────
  // No more inline duplication: bot.js, simulator.js (UI), and the optimizer
  // all run the same math via window.BFEngine. Single source of truth.
  // (sim_engine.js is loaded BEFORE bot.js by the manifest content_scripts list.)
  //
  // Slider/image data-id → tier mapping. Universal across all server languages
  // (data-id is set by game DOM, language-independent).
  const SLIDER_TO_TIER    = { '1':'T1', '2':'T2', '3':'T3', '4':'T4', '5':'T5', '6':'T6', '7':'T7', '8':'T8' };
  const ENEMY_IMG_TO_TIER = { '1':'E1', '2':'E2', '3':'E3', '4':'E4', '5':'E5', '6':'E6',
                              '7':'E7', '8':'E8', '9':'E9', '10':'E10' };

  function qtyToString(obj) {
    return Object.entries(obj).filter(([,v]) => v > 0).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join(', ');
  }

  // Wrapper to keep the call sites in bot.js unchanged.
  // Returns the same shape as before (victory, surviving, rounds) plus the new
  // engineResult for callers that want details.
  function botSimulate(allyQtys, enemyQtys) {
    if (!window.BFEngine) {
      console.error('[bitefight bot] BFEngine not loaded — sim_engine.js missing?');
      return null;
    }
    const r = window.BFEngine.simulate(allyQtys, enemyQtys, {
      randomTarget: false,  // deterministic for pre-validation
      collectLog: false,    // fast path
      maxRounds: 50,
    });
    if (!r) return null;
    return {
      victory: r.victory,
      surviving: r.unitsSurvived,
      rounds: r.rounds,
      // additional fields available if needed:
      essenceLost: r.essenceLost,
      unitsLost: r.unitsLost,
      draw: r.draw,
      e3KilledRound1: r.e3KilledRound1,
    };
  }

  // ── PARSE RUINS SHOW PAGE ─────────────────────────────────
  function parseRuinsEnemies() {
    const qtys = {};
    document.querySelectorAll('#enemyCardInner .enemySlot:not(.locked-unit)').forEach(slot => {
      // Get tier from background image URL: enemyUnit_X.jpg
      const bg = slot.getAttribute('style') || '';
      const m = bg.match(/enemyUnit_(\d+)/);
      if (!m) return;
      const tierId = ENEMY_IMG_TO_TIER[m[1]];
      if (!tierId) return;
      const qtyEl = slot.querySelector('.qtyValue');
      const qty = qtyEl ? parseInt(qtyEl.textContent.trim()) || 0 : 0;
      if (qty > 0) qtys[tierId] = (qtys[tierId] || 0) + qty;
    });
    return qtys;
  }

  function parseRuinsPlayerMax() {
    const maxUnits = {};
    document.querySelectorAll('input.combatSlider').forEach(slider => {
      const dataId = slider.getAttribute('data-id');
      const tierId = SLIDER_TO_TIER[dataId];
      if (tierId) maxUnits[tierId] = parseInt(slider.getAttribute('max')) || 0;
    });
    return maxUnits;
  }

  function parseRuinsPowerLimit() {
    const el = document.querySelector('.armyPower');
    if (el) {
      const m = el.textContent.match(/\/\s*(\d+)/);
      if (m) return parseInt(m[1]);
    }
    return 250; // fallback
  }

  // ── OPTIMIZER (single-thread, n-tier capable) ─────────────────
  // v1.5.8 — replaces previous 4-tier hardcoded loop that referenced
  // an undefined BOT_ALLY_TIERS global (latent bug). Now uses BFEngine
  // tier definitions, honors a caller-supplied unlockedAllyIds list and
  // properly enumerates up to T8.
  //
  // Caller-supplied opts:
  //   unlockedAllyIds: ['T1','T3','T6',...]  (required)
  //   mode: 'deep' | 'fast'                   (default 'deep')
  //   stratKillE3: bool                       (default false)
  //   warmStart: {minPerTier, maxPerTier}     (optional)
  //   maxTested: int                          (safety cap, default 50000)
  function findBestFormation(enemyQtys, maxUnits, powerLimit, opts) {
    opts = opts || {};
    if (!window.BFEngine) return null;
    const ALL_ALLY = window.BFEngine.ALLY_TIERS;
    const unlocked = Array.isArray(opts.unlockedAllyIds) && opts.unlockedAllyIds.length
      ? opts.unlockedAllyIds
      : ALL_ALLY.map(t => t.id);
    const tiers = ALL_ALLY.filter(t => unlocked.indexOf(t.id) >= 0 && (maxUnits[t.id] || 0) > 0);
    if (!tiers.length) return null;

    const mode = opts.mode === 'fast' ? 'fast' : 'deep';
    const stratKillE3 = !!opts.stratKillE3;
    const maxTested = opts.maxTested || 50000;

    const maxByTier = {};
    const minByTier = {};
    tiers.forEach(t => {
      maxByTier[t.id] = Math.min(maxUnits[t.id] || 0, Math.floor(powerLimit / t.power));
      minByTier[t.id] = 0;
    });
    if (opts.warmStart) {
      Object.keys(opts.warmStart.minPerTier || {}).forEach(tid => {
        if (maxByTier[tid] != null) minByTier[tid] = Math.min(maxByTier[tid], opts.warmStart.minPerTier[tid]);
      });
      Object.keys(opts.warmStart.maxPerTier || {}).forEach(tid => {
        if (maxByTier[tid] != null) maxByTier[tid] = Math.min(maxByTier[tid], opts.warmStart.maxPerTier[tid]);
      });
    }

    let bestResult = null;
    let bestQtys = null;
    let bestE3Kill = null;
    let bestE3KillQtys = null;
    let tested = 0;
    let stopFlag = false;

    function consider(qtys, r) {
      tested++;
      if (!r || !r.victory) return;
      const better = !bestResult
        || r.surviving > bestResult.surviving
        || (r.surviving === bestResult.surviving && r.rounds < bestResult.rounds);
      if (better) { bestResult = r; bestQtys = { ...qtys }; }
      if (stratKillE3 && r.e3KilledRound1) {
        const e3Better = !bestE3Kill
          || r.surviving > bestE3Kill.surviving
          || (r.surviving === bestE3Kill.surviving && r.rounds < bestE3Kill.rounds);
        if (e3Better) { bestE3Kill = r; bestE3KillQtys = { ...qtys }; }
      }
    }

    // Recursive combination generator — works for any tier count up to T8.
    // Iterates high → low so "strongest first" candidates land earliest.
    const tierIds = tiers.map(t => t.id);
    function recurse(idx, remaining, current) {
      if (stopFlag || tested >= maxTested) { stopFlag = true; return; }
      if (idx === tiers.length) {
        if (Object.keys(current).length === 0) return; // skip empty formation
        const r = botSimulate(current, enemyQtys);
        consider(current, r);
        if (mode === 'fast' && bestResult && tested >= 200) stopFlag = true;
        return;
      }
      const tier = tiers[idx];
      const hardMax = Math.floor(remaining / tier.power);
      const lo = minByTier[tier.id] || 0;
      const hi = Math.min(maxByTier[tier.id] || 0, hardMax);
      for (let q = hi; q >= lo; q--) {
        if (stopFlag) return;
        if (q > 0) current[tier.id] = q;
        else delete current[tier.id];
        recurse(idx + 1, remaining - q * tier.power, current);
      }
      delete current[tier.id];
    }

    recurse(0, powerLimit, {});

    // Prefer E3-killing formation when strategy is on AND we found one;
    // otherwise fall back to overall best winner (don't fail the run).
    const chosen = (stratKillE3 && bestE3KillQtys) ? bestE3KillQtys : bestQtys;
    const winnerLabel = !chosen ? 'no victory'
      : (stratKillE3 && bestE3KillQtys) ? 'winner found (E3 killed R1)'
      : (stratKillE3 ? 'winner found (NO E3 kill)' : 'winner found');
    botLog('info', `Optimizer [${mode}/${tierIds.join(',')}]: ${tested} tested, ${winnerLabel}`);
    return chosen;
  }

  // ── PARALLEL OPTIMIZER (Web Workers) ──────────────────────────
  // v1.5.8 — replicates simulator.js's runParallelOptimizer protocol
  // for the bot's content-script context. Mirrors split logic on
  // the chosen split tier (T1 if unlocked, else cheapest unlocked tier).
  // cb is called with (qtysOrNull, source) on completion or fallback.
  function findBestFormationParallel(enemyQtys, maxUnits, powerLimit, opts, cb) {
    opts = opts || {};
    const fallback = () => {
      const r = findBestFormation(enemyQtys, maxUnits, powerLimit, opts);
      cb(r, opts.mode === 'fast' ? 'FAST-ST' : 'DEEP-ST');
    };

    if (typeof Worker === 'undefined' || !chrome || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
      botLog('warn', 'Optimizer: Workers unavailable, single-thread fallback');
      fallback();
      return;
    }
    if (!window.BFEngine) { fallback(); return; }

    const ALL_ALLY = window.BFEngine.ALLY_TIERS;
    const unlocked = Array.isArray(opts.unlockedAllyIds) && opts.unlockedAllyIds.length
      ? opts.unlockedAllyIds
      : ALL_ALLY.map(t => t.id);
    const tiers = ALL_ALLY.filter(t => unlocked.indexOf(t.id) >= 0 && (maxUnits[t.id] || 0) > 0);
    if (!tiers.length) { cb(null, 'NONE'); return; }

    const mode = opts.mode === 'fast' ? 'fast' : 'deep';
    const stratKillE3 = !!opts.stratKillE3;

    const maxPerTier = {};
    let minPerTier = null;
    tiers.forEach(t => {
      maxPerTier[t.id] = Math.min(maxUnits[t.id] || 0, Math.floor(powerLimit / t.power));
    });
    if (opts.warmStart) {
      if (opts.warmStart.minPerTier) {
        minPerTier = {};
        Object.keys(opts.warmStart.minPerTier).forEach(tid => {
          if (maxPerTier[tid] != null) minPerTier[tid] = Math.min(maxPerTier[tid], opts.warmStart.minPerTier[tid]);
        });
      }
      Object.keys(opts.warmStart.maxPerTier || {}).forEach(tid => {
        if (maxPerTier[tid] != null) maxPerTier[tid] = Math.min(maxPerTier[tid], opts.warmStart.maxPerTier[tid]);
      });
    }

    // Pick split tier: T1 if available, else cheapest unlocked tier
    let splitTier = tiers.find(t => t.id === 'T1');
    if (!splitTier) splitTier = tiers.slice().sort((a, b) => a.power - b.power)[0];
    const splitMaxAll = maxPerTier[splitTier.id] || 0;
    const splitMinAll = (minPerTier && minPerTier[splitTier.id] != null) ? minPerTier[splitTier.id] : 0;
    if (splitMaxAll < splitMinAll) { fallback(); return; }

    const hw = (navigator && navigator.hardwareConcurrency) || 4;
    const workerCount = Math.max(1, Math.min(8, hw, splitMaxAll - splitMinAll + 1));

    // Partition [splitMinAll..splitMaxAll] across workers
    const ranges = [];
    const totalRange = splitMaxAll - splitMinAll + 1;
    const base = Math.floor(totalRange / workerCount);
    const rem  = totalRange % workerCount;
    let cursor = splitMinAll;
    for (let i = 0; i < workerCount; i++) {
      const size = base + (i < rem ? 1 : 0);
      if (size <= 0) continue;
      ranges.push([cursor, cursor + size - 1]);
      cursor += size;
    }

    const workerUrl = chrome.runtime.getURL('js/optimizer_worker.js');
    const engineUrl = chrome.runtime.getURL('js/sim_engine.js');
    const workers = [];
    const done = new Array(ranges.length).fill(false);
    let aggregated = [];
    let totalTested = 0;
    let cancelled = false;

    function cleanup() {
      workers.forEach(w => { try { w.terminate(); } catch (_) {} });
    }

    function finalize() {
      cleanup();
      if (cancelled) return;
      let pool = aggregated.filter(r => r.victory);
      if (stratKillE3) {
        const e3Kills = pool.filter(r => r.e3KilledRound1);
        if (e3Kills.length) pool = e3Kills;
      }
      if (!pool.length) {
        botLog('info', `Parallel optimizer [${mode}]: ${totalTested} tested, no victory`);
        cb(null, mode === 'fast' ? 'FAST-PAR' : 'DEEP-PAR');
        return;
      }
      pool.sort((a, b) => {
        if (b.unitsSurvived !== a.unitsSurvived) return b.unitsSurvived - a.unitsSurvived;
        if (a.rounds !== b.rounds) return a.rounds - b.rounds;
        return (a.essenceLost || 0) - (b.essenceLost || 0);
      });
      botLog('info', `Parallel optimizer [${mode}]: ${totalTested} tested, ${pool.length} winners → ${qtyToString(pool[0].allyQtys)}`);
      cb(pool[0].allyQtys, mode === 'fast' ? 'FAST-PAR' : 'DEEP-PAR');
    }

    // Safety timeout: if any worker hangs for 30s we fallback.
    const safety = botSetTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      cleanup();
      botLog('warn', 'Parallel optimizer timeout (30s), single-thread fallback');
      fallback();
    }, 30000);

    ranges.forEach((range, idx) => {
      let w;
      try { w = new Worker(workerUrl); }
      catch (err) {
        if (!cancelled) { cancelled = true; clearTimeout(safety); cleanup(); fallback(); }
        return;
      }
      workers.push(w);
      w.onerror = function () {
        if (cancelled) return;
        cancelled = true; clearTimeout(safety); cleanup();
        botLog('warn', 'Parallel optimizer worker error, single-thread fallback');
        fallback();
      };
      w.onmessage = function (ev) {
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === 'ready') {
          w.postMessage({
            type: 'run', mode: mode, powerLimit: powerLimit,
            maxPerTier: maxPerTier, minPerTier: minPerTier,
            unlockedAllyIds: tiers.map(t => t.id),
            splitTierId: splitTier.id, splitMin: range[0], splitMax: range[1],
            enemyQtys: enemyQtys, stratKillE3: stratKillE3,
            targetWinners: 60, maxCandidates: 200000, progressEveryMs: 250,
          });
        } else if (msg.type === 'done') {
          aggregated = aggregated.concat(msg.results || []);
          totalTested += msg.tested || 0;
          done[idx] = true;
          if (done.every(Boolean)) { clearTimeout(safety); finalize(); }
        } else if (msg.type === 'error') {
          if (cancelled) return;
          cancelled = true; clearTimeout(safety); cleanup();
          botLog('warn', `Parallel optimizer: worker ${idx} error (${msg.message || '?'}), single-thread fallback`);
          fallback();
        }
      };
      w.postMessage({ type: 'init', enginePath: engineUrl });
    });
  }

  // ── HELPER: find ANY preset for a given layer (for warm-start) ───
  // Per user spec (v1.5.8), layer match is strict — no cross-layer fallback.
  function findAnyRuinsPresetForLayer(presets, level) {
    const arr = presets[String(level)] || [];
    return arr.length ? arr[0] : null;
  }

  // ── HELPER: convert a Ruins preset formation into optimizer ranges ───
  // The Ruins Preset Formations have concrete counts; convert each count
  // into a target ± range window. Tiers not in the preset are unconstrained.
  function buildRangesFromRuinsPreset(presetFormation, range) {
    const r = range != null ? range : 15;
    const minPerTier = {};
    const maxPerTier = {};
    const computed = {};
    Object.keys(presetFormation || {}).forEach(tid => {
      const v = parseInt(presetFormation[tid]) || 0;
      if (v <= 0) return;
      const lo = Math.max(0, v - r);
      const hi = v + r;
      minPerTier[tid] = lo;
      maxPerTier[tid] = hi;
      computed[tid] = { target: v, min: lo, max: hi, mode: 'range' };
    });
    return { minPerTier, maxPerTier, computed };
  }

  // ── CONSTANTS ────────────────────────────────────────────────
  const HUNT_TYPES = [
    { id: 1, name: 'Farm',      ap: 1, purity: 'Weak',     purityEn: 'Weak' },
    { id: 2, name: 'Village',     ap: 1, purity: 'Low',     purityEn: 'Low' },
    { id: 3, name: 'Small Town', ap: 1, purity: 'Average', purityEn: 'Average' },
    { id: 4, name: 'Town',      ap: 1, purity: 'High',    purityEn: 'High' },
    { id: 5, name: 'Metropolis',  ap: 2, purity: 'Rich',    purityEn: 'Rich' },
  ];

  const QUALITY_RANKS = ['S', 'A', 'B', 'C', 'D', 'E'];

  // v1.6.4 — Blood-essence cost per unit tier (matches sim_engine ALLY_TIERS).
  //          Indexed by numeric tier id (1..8); used by Auto Recruitment and UI.
  const UNIT_COSTS = { 1: 10, 2: 15, 3: 20, 4: 35, 5: 50, 6: 75, 7: 90, 8: 150 };
  const TIER_ORDER_DEFAULT = ['T4','T3','T2','T1','T5','T6','T7','T8'];

  const DEFAULT_SETTINGS = {
    // Hunt bot
    huntEnabled: false,
    huntMode: 'auto',           // 'auto' = AB% logic, 'manual' = fixed type
    huntManualType: 5,          // for manual mode
    huntManualAcceptQ: ['S','A','B','C','D','E'],  // accepted qualities in manual mode
    huntHighAB: { minAB: 60, type: 5, acceptQ: ['S', 'A'] },
    huntMidAB:  { minAB: 25, type: 5, acceptQ: ['S', 'A', 'B'] },
    huntLowAB:  { minAB: 1,  type: 4, acceptQ: ['S', 'A', 'B', 'C', 'D', 'E'] },
    huntIgnoreQ: [], // qualities to always skip, e.g. ['C','D']
    // Extraction
    extractEnabled: true,
    extractAutoRepeat: true,    // repeat after orb cooldown (5h)
    orbCooldownMs: 5 * 60 * 60 * 1000, // 5 hours
    // Recruit (v1.6.4 — rewritten as global tick, supports T1-T8)
    recruitEnabled: false,
    recruitTrigger: 'idle',          // 'idle' = run during yellow/white indicator, 'extraction' = after hunt extracts, 'threshold' = when BE >= X, 'continuous' = run every tick
    recruitThreshold: 100,           // BE threshold for trigger mode 'threshold'
    recruitStrategy: 'priority',     // 'percent' = % split per tier, 'priority' = drain into priority order
    recruitPercent:  { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0 },  // % allocation per tier (strategy: percent)
    recruitEnabledTiers: { 1:false, 2:false, 3:true, 4:true, 5:false, 6:false, 7:false, 8:false }, // checkbox per tier (strategy: priority)
    recruitPriority: ['T4','T3','T2','T1','T5','T6','T7','T8'], // ordered list (strategy: priority); first enabled = highest priority
    recruitReserveBE: 0,             // keep this much BE on hand (like Gold "Keep")
    recruitMode: 'percent',          // LEGACY — kept for back-compat, no longer used
    recruitFormation: {},            // LEGACY — kept for back-compat
    // Ruins
    ruinsEnabled: false,
    ruinsLevels: Array.from({length: 20}, (_, i) => i + 1), // 1-20
    ruinsLevelsLocked: false,   // v1.6.0 — UI lock on level selection (drag-paint protect)
    ruinsCadence: 'infinite',   // 'infinite', 'once', 'cycles'
    ruinsCycles: 5,
    ruinsIntervalMin: 60,       // minutes between attacks per level (legacy default / fallback)
    // v1.5.9 — Per-layer-band cooldown intervals (minutes).
    // Keys: '1-10', '11-20', '21-30', '31-40', '41-50', '51-60',
    //       '61-70', '71-80', '81-90', '91-100', '101' (and beyond).
    // The cooldown for a layer is looked up via getRuinsIntervalForLevel().
    // Missing bands fall back to ruinsIntervalMin.
    ruinsIntervalBands: {
      '1-10': 60, '11-20': 90, '21-30': 90, '31-40': 90, '41-50': 90,
      '51-60': 90, '61-70': 90, '71-80': 90, '81-90': 90, '91-100': 90,
      '101': 90,
    },
    ruinsFormation: {},         // {1: qty, 2: qty, ...}
    // Safety stops
    ruinsStopNoWin: true,       // stop if no winning formation found
    ruinsMinUnits: {},          // min units required: {T1: 10, T2: 0, T3: 5, T4: 0}
    ruinsStopMinUnits: false,   // enable min units check
    ruinsStopPresetShort: true, // stop if can't fill preset formation fully
    ruinsIgnorePresets: false,  // v1.6.2 — always skip preset matching, go straight to optimizer
    // Ruins — UNLOCKED tiers (which ally tiers the optimizer is allowed to use)
    // T1..T8; defaults to T1..T6 (player must unlock T7/T8 explicitly)
    ruinsAllyUnlocks: ['T1','T2','T3','T4','T5','T6'],
    // Ruins — Optimization settings (used when no exact preset matches)
    ruinsOptStratKillE3: false,    // require formations that kill all E3 in round 1
    ruinsOptMode: 'deep',          // 'deep' = simulate all, 'fast' = greedy stop
    ruinsOptParallel: true,        // use Web Workers (parallel slicing)
    ruinsWarmStartSource: 'none',  // 'none' | 'smart' | 'preset' (Ruins Preset Formations of same layer)
    ruinsWarmStartRange: 15,       // ± units around warm-start target
    // T4 short safety (only relevant when ruinsOptStratKillE3 is on)
    ruinsT4ShortAction: 'stop',    // 'stop' | 'continue' | 'wait'
    ruinsT4WaitMin: 10,            // minutes between rechecks when waiting
    // Auto-import winning "new" formations into preset library
    ruinsAutoImportNew: false,
    ruinsAutoImportMaxPerLevel: 3, // max auto-imports per layer (prevents flooding)
    ruinsAutoImportSmart: false,   // v1.5.9 — also write to simulator's Smart Preset library
    // Story Mode
    storyEnabled: false,
    storyPriority: 'gold',      // 'gold', 'xp', 'health', 'aspects'
    storyWhitelist: [],         // decision IDs always preferred (e.g. [42, 30, 25])
    storyBlacklist: [],         // decision IDs always avoided (e.g. [31, 52])
    storyStayAlive: true,       // auto-pause for healing
    storyStayAliveMode: 'pct',  // 'pct' = percentage, 'fixed' = fixed HP value
    storyPauseAtPct: 16,        // pause story below this HP%
    storyResumeAtPct: 18,       // resume story above this HP%
    storyPauseAtHP: 10000,      // fixed HP value to pause
    storyResumeAtHP: 12000,     // fixed HP value to resume
    storyHealPriorityPct: -1,   // switch priority to "health" below this % (-1 = off)
    storyHealBackPct: 80,       // switch back above this %
    storyOption42Enabled: false, // special handling for decision 42
    storyOption42MinHP: 20000,  // min fixed HP for decision 42
    storyOption42MinHPPct: 50,  // min HP% for decision 42
    storyChurch: true,          // auto-heal at church
    storyChurchOverAP: true,    // only church if AP available
    storyAspectTargets: {       // target values for each aspect when priority=aspects
      human: 0, knowledge: 0, order: 0, nature: 0,
      beast: 0, destruction: 0, chaos: 0, corruption: 0,
    },
    // Grotto (Demon Hunt)
    grottoEnabled: false,
    grottoDifficulty: 'easy',        // 'easy', 'medium', 'difficult'
    grottoCount: 0,                  // 0 = unlimited
    grottoPermanent: false,          // unlimited mode
    grottoMinHP: 50,                 // minimum HP% before hunt
    grottoStayAlive: false,
    grottoStayAliveMode: 'switch',   // 'switch' = switch difficulty, 'church' = use church
    grottoSwitchDifficulty: 'easy',  // difficulty to switch to when low HP
    grottoChurchAP: 15,              // max AP to spend at church
    // PvP
    pvpEnabled: false,
    pvpMode: 1,             // 1=anyone, 2=stronger/equal, 3=blacklist namesearch, 4=levelsearch (BV range)
    pvpMinHP: 50,           // minimum HP% before attack
    pvpWhitelist: '',       // players NOT to attack (comma-separated)
    pvpBlacklist: '',       // players TO attack (comma-separated, mode 3)
    pvpBVFrom: '',          // battle value range from (mode 4)
    pvpBVTo: '',            // battle value range to (mode 4)
    pvpSmartBreak: false,   // pause between attacks
    pvpDelay: 20,           // minutes between attacks
    pvpMargin: 3,           // ± randomizer minutes
    pvpIncludeInactive: true, // include inactive players (totemsearch)
    // Henchman vs Henchman (v1.6.9, semantics flipped in v1.6.10) — uses the
    // same /robbery/index page as PvP but a different form. Mutually exclusive
    // with pvpEnabled. Whitelist/blacklist use INTUITIVE semantics here
    // (opposite of the PvP convention in this codebase):
    //   • whitelist = priority targets (mode 2 attacks ONLY these by namesearch)
    //   • blacklist = players to skip   (mode 1 skips these from random results)
    henchmanEnabled: false,
    henchmanMode: 1,           // 1=anyone (random, skip blacklist), 2=whitelist only (target whitelist by namesearch)
    henchmanWhitelist: '',     // priority targets — attacked in mode 2 (comma-separated)
    henchmanBlacklist: '',     // players to skip — filtered in mode 1 (comma-separated)
    henchmanSmartBreak: false, // pause between attacks
    henchmanDelay: 20,         // minutes between attacks
    henchmanMargin: 3,         // ± randomizer minutes
    // v1.6.11 — allow attacking the player's own race. When the game presents
    // the "this search includes both werewolves and vampires" confirmation
    // modal (button type="button" with onclick="showModal('confirmModal',...)"),
    // we confirm it if this is true; otherwise we skip and re-search.
    henchmanAttackOwnRace: false,
    // Gifts
    giftsAutoDBG: false,        // auto open Dark Blue Gifts
    giftsDBGUnderAP: 5,         // open DBG when AP is under this
    giftsDisableAfterEvent: false, // disable DBG mode after double AP event
    giftsMaxCaveTime: false,    // maximize time in cave
    giftsPurpleMode: 'none',    // 'none', 'unlimited', 'gold_target', 'qty_target'
    giftsPurpleGoldTarget: 100000,
    giftsPurpleQtyTarget: 10,
    giftsPurpleSpendGold: false, // spend gold from gifts for skills
    // Global
    goldMode: 0,                // 0=don't spend, 1=skills, 2=donate
    goldSkills: [],             // ['sr_', 'df_', 'dx_', 'ed_', 'cr_'] which skills to upgrade
    goldDonateMin: 10000,       // donate only when you have this much
    goldDonateAll: false,
    goldKeep: false,            // keep gold buffer
    goldKeepAmount: 0,
    goldBufferForPotions: false,
    // Graveyard
    graveyardEnabled: false,
    graveyardWorkTimeAP: 2,     // hours to work when low AP
    graveyardMinAP: 5,          // work when AP below this
    graveyardWorkTimeHP: 2,     // hours to work when low HP
    graveyardMinHP: 20,         // work when HP% below this
    // Speed
    speedMode: 'normal',        // 'slow', 'normal', 'turbo', 'custom'
    speedCustom: 2.0,           // seconds for custom speed
    speedRandomizer: false,
    withoutLogs: false,
    // Potions
    potionEnergy: false,
    potionEnergyUnder: 3,       // use energy potion under this AP
    potionSoupOfLife: false,
    potionMediumHealing: false,
    potionBlood: false,
    potionAutoBuy: false,
    // Schedule (v1.6.8 — BK-style dynamic slots with multi-layout support)
    // Slots live inside named layouts; the active layout's slots drive the
    // schedule. When a slot's window is active, its `actions` flags FULLY
    // OVERRIDE per-module enabled toggles. Outside all slots → bots paused.
    scheduleEnabled: false,
    scheduleLayouts: [],            // array of { id, name, slots: [...] }
    scheduleActiveLayoutId: null,   // points into scheduleLayouts; self-healed
    // Legacy fields kept ONLY for migration; do NOT use directly. See loadSettings.
    scheduleSlots: undefined,       // v1.6.7 flat slot list
    scheduleIntervals: undefined,   // pre-v1.6.7 fixed-row format
    // Other global
    autoEnrollClanWar: false,
    hideGameforgeBar: false,
    fixedInfobar: false,
    hideEventPanel: false,
    backgroundRefresh: false,
    backgroundRefreshInterval: 60, // minutes
    backgroundRefreshRandomize: 5, // v1.6.10 — ± randomizer minutes
    // ── Inventory Discard / Cleanup (v1.6.13) ───────────────────
    // Auto-discards low-level "junk" drop items (Omega items, ruins loot, etc.).
    // Only items that already have a Zahodiť/Discard button in the game UI are
    // touched — equipped items and standard non-droppable items never qualify
    // because they lack the `'feature' : 'discardItem'` onclick marker.
    // Type whitelist (1=weapon, 3=helmet, 4=armor, 5=item, 6=gloves, 7=boots,
    // 8=shield) is hardcoded in scanInventoryForDiscardable() so even if the
    // game adds a discard button to elixirs/gifts/etc., the bot will not touch
    // them.
    invDiscardEnabled: false,
    invDiscardMode: 'manual',        // 'manual' = Run-Now button only, 'auto' = scheduled
    invDiscardFrequency: 'daily',    // 'daily' | 'weekly' | 'custom'  (when mode='auto')
    invDiscardCustomHours: 12,       // hours between auto runs when frequency='custom'
    invDiscardMaxLevel: 1000,        // discard items requiring this level OR LESS
    invDiscardMinLevel: 0,           // also keep items below this level (optional floor)
    invDiscardDelayMs: 1500,         // base delay between consecutive discards (±randomized)
  };

  // ── STATE MACHINE STATES ─────────────────────────────────────
  // huntState: 'idle' | 'navigating' | 'on_result' | 'extracting' | 'waiting_orb' | 'done'
  // ruinsState: 'idle' | 'navigating' | 'fighting' | 'waiting' | 'done'

  // ── READ GAME STATE ──────────────────────────────────────────
  function readAP() {
    // Language-independent: find by img src path (same on all servers)
    const img = document.querySelector('img[src*="symbols/ap.gif"], img[src*="/ap.gif"]');
    if (!img) return { current: null, max: null };
    // AP text is adjacent to the icon — scan siblings for N/N pattern
    let node = img.previousSibling;
    while (node) {
      const txt = (node.textContent || '').replace(/\u00a0/g, ' ').trim();
      const m = txt.match(/(\d+)\s*\/\s*(\d+)\s*$/);
      if (m) return { current: parseInt(m[1]), max: parseInt(m[2]) };
      node = node.previousSibling;
    }
    // Also check parent container for text
    const parent = img.closest('td') || img.closest('span') || img.parentElement;
    if (parent) {
      const txt = parent.textContent.replace(/\u00a0/g, ' ').replace(/\./g, '').trim();
      const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return { current: parseInt(m[1]), max: parseInt(m[2]) };
    }
    return { current: null, max: null };
  }

  function readBE() {
    const el = document.getElementById('blood-essen-balance');
    return el ? (parseInt(el.textContent.replace(/\D/g, '')) || 0) : null;
  }

  function getABPercent() {
    const ap = readAP();
    if (ap.current === null || ap.max === null || ap.max === 0) return null;
    return Math.round((ap.current / ap.max) * 100);
  }

  // ── HUNT RESULT PAGE PARSING ─────────────────────────────────
  function isHuntResultPage() {
    // Result page has: #humanhunt with .rank-container or "Zopakovať" button
    return PAGE.includes('/robbery/humanhunt') &&
      (document.querySelector('.rank-container') || document.querySelector('button.btn[type="submit"]'));
  }

  function parseHuntResult() {
    const result = { success: false, quality: null, rank: null, hasExtraction: false, huntId: null, orbsReady: 0, orbsTotal: 0 };

    // Check if hunt was successful — language-independent:
    // Success page has .rank-container, gold/xp icons, or extraction button
    const desc = document.querySelector('.buildingDesc p');
    if (desc) {
      // If description contains gold icon or XP icon → success
      const parent = desc.closest('.buildingDesc') || desc.parentElement;
      if (parent && (
        parent.querySelector('img[src*="res2.gif"], img[src*="gold"], img[src*="level.gif"]') ||
        document.querySelector('.rank-container') ||
        document.querySelector('#extractBloodBtn')
      )) {
        result.success = true;
      }
    }

    // Parse quality rank — try multiple patterns
    const rankContainer = document.querySelector('.rank-container .rank-text, .rank-container');
    const rankLines = rankContainer
      ? rankContainer.querySelectorAll('.rank-line')
      : document.querySelectorAll('.rank-line');

    if (rankLines.length >= 1) {
      const rankText = rankLines[0].textContent.trim();
      // Pattern 1: "S - Hodnosť" / "A – Rank"
      let m = rankText.match(/^([SABCDE])\s*[-–—]/);
      if (m) {
        result.rank = m[1];
      } else {
        // Pattern 2: single letter at start "S" or "S "
        m = rankText.match(/^([SABCDE])(?:\s|$)/);
        if (m) result.rank = m[1];
      }
      if (!result.rank) {
        // Pattern 3: letter anywhere after colon "Hodnosť: S" or "Rank: A"
        m = rankText.match(/:\s*([SABCDE])(?:\s|$)/);
        if (m) result.rank = m[1];
      }
      if (!result.rank) {
        // Pattern 4: any single S/A/B/C/D/E surrounded by word boundaries
        m = rankText.match(/\b([SABCDE])\b/);
        if (m) result.rank = m[1];
      }
    }
    if (rankLines.length >= 2) {
      result.quality = rankLines[1].textContent.trim();
    }

    // Extraction button
    const extractBtn = document.getElementById('extractBloodBtn');
    if (extractBtn) {
      result.hasExtraction = true;
      result.huntId = extractBtn.getAttribute('data-hunt-id');
      // Check if button is actually enabled/clickable
      if (extractBtn.classList.contains('disabled') || extractBtn.disabled) {
        result.hasExtraction = false;
      }
    }

    // Orbs status
    // BloodOrbFilled = slot AVAILABLE for extraction (data-remaining=0, "Dostupné")
    // BloodOrbEmpty  = slot on COOLDOWN (data-remaining>0, shows timer)
    const slots = document.querySelectorAll('.slots .slot');
    result.orbsTotal = slots.length;
    slots.forEach(slot => {
      const timer = slot.querySelector('.timer');
      const remaining = timer ? parseInt(timer.getAttribute('data-remaining')) || 0 : 0;
      if (remaining <= 0) {
        result.orbsReady++;  // available for extraction
      }
      // else: on cooldown
    });

    return result;
  }

  // ── HUNT PAGE (choose location) PARSING ──────────────────────
  function isHuntChoicePage() {
    return PAGE === '/robbery/index' && document.getElementById('humanHunting');
  }

  // ── EXTRACTION ORB STATUS ON /robbery/index ──────────────────
  function readOrbsOnRobberyPage() {
    const slots = document.querySelectorAll('#slots_availability .slot .timer, .slots .slot .timer');
    if (!slots.length) return { ready: 0, total: 0, nextReadyIn: null, maxRemaining: null };
    let ready = 0, total = slots.length, minRemaining = Infinity, maxRemaining = 0;
    slots.forEach(el => {
      const rem = parseInt(el.getAttribute('data-remaining')) || 0;
      if (rem <= 0) ready++;
      else {
        if (rem < minRemaining) minRemaining = rem;
        if (rem > maxRemaining) maxRemaining = rem;
      }
    });
    return {
      ready, total,
      nextReadyIn: minRemaining === Infinity ? null : minRemaining,
      maxRemaining: maxRemaining > 0 ? maxRemaining : null,
    };
  }

  // ── COMPUTE ORB COOLDOWN END TIME (ABSOLUTE) ─────────────────
  // Reads real cooldown from page DOM when available, falls back to settings.orbCooldownMs
  function computeOrbWaitUntil(settings) {
    const orbs = readOrbsOnRobberyPage();
    if (orbs.maxRemaining && orbs.maxRemaining > 0) {
      // Use real remaining seconds from page
      const until = Date.now() + orbs.maxRemaining * 1000;
      botLog('info', `Orb cooldown from DOM: max ${orbs.maxRemaining}s → ETA ${new Date(until).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}`);
      return until;
    }
    // Fallback: hardcoded orbCooldownMs (5h)
    return Date.now() + (settings.orbCooldownMs || 5 * 60 * 60 * 1000);
  }

  // ── RUINS PAGE DETECTION ─────────────────────────────────────
  function isRuinsIndexPage() {
    return PAGE.includes('/nourishing/index') && document.querySelector('.ancestralRuins');
  }

  function isRuinsShowPage() {
    return PAGE.includes('/ancestral/show');
  }

  function isRuinsFightResultPage() {
    return PAGE.includes('/ancestral/fight') || (PAGE.includes('/ancestral/') && document.querySelector('.combatResult'));
  }

  // ── PER-LAYER COOLDOWN INTERVAL (v1.5.9) ─────────────────────
  // Maps a level number to its band key, then looks up the minutes
  // value in settings.ruinsIntervalBands. Falls back to the legacy
  // settings.ruinsIntervalMin if a band is missing or invalid.
  // The 11 supported bands are: '1-10', '11-20', '21-30', '31-40',
  // '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '101'.
  // Layers ≥ 101 all share the '101' band.
  function getLevelBandKey(level) {
    const n = parseInt(level);
    if (!n || n < 1) return '1-10';
    if (n >= 101) return '101';
    const lo = Math.floor((n - 1) / 10) * 10 + 1;
    const hi = lo + 9;
    return lo + '-' + hi;
  }

  function getRuinsIntervalForLevel(level, settings) {
    const fallback = (settings && settings.ruinsIntervalMin) || 60;
    const bands = settings && settings.ruinsIntervalBands;
    if (!bands) return fallback;
    const v = parseInt(bands[getLevelBandKey(level)]);
    return (v && v > 0) ? v : fallback;
  }

  // List of all band keys in display order (used by the UI builder).
  const RUINS_BAND_KEYS = [
    '1-10','11-20','21-30','31-40','41-50','51-60',
    '61-70','71-80','81-90','91-100','101',
  ];

  // ── ARMY (Živné jamy) PAGE DETECTION + PARSING (v1.5.8) ─────
  // /nourishing/index shows the army by default (tab "Živné jamy").
  // Distinguish from ancestral by the unit cards container which is
  // unique to the army view.
  function isArmyPage() {
    return PAGE.includes('/nourishing/index')
      && !!(document.getElementById('units-wrapper') || document.getElementById('units-total-army'));
  }

  // Parses live army state on the page. Returns:
  //   { owned: {T1, T2, ...}, cooldown: {T1, ...},
  //     queue: {T1: {qty, remainingSec, nextReadySec}, ...} }
  // Uses structural IDs (#owned-N, #inCooldownUnits-N, #in-queue-N,
  // #queue-end-N data-remaining, #next-ready-N data-remaining). Language
  // independent — all IDs are server-set, never localized.
  function parseArmyStateFromDom(doc) {
    doc = doc || document;
    const result = { owned: {}, cooldown: {}, queue: {}, totalValue: 0 };
    for (let n = 1; n <= 8; n++) {
      const tid = 'T' + n;
      const ownedEl = doc.getElementById('owned-' + n);
      const cdEl    = doc.getElementById('inCooldownUnits-' + n);
      if (ownedEl) result.owned[tid] = parseInt((ownedEl.textContent || '').replace(/[^\d]/g, '')) || 0;
      if (cdEl)    result.cooldown[tid] = parseInt((cdEl.textContent || '').replace(/[^\d]/g, '')) || 0;
      const qtyEl  = doc.getElementById('in-queue-' + n);
      const endEl  = doc.getElementById('queue-end-' + n);
      const nextEl = doc.getElementById('next-ready-' + n);
      if (qtyEl) {
        const qty = parseInt((qtyEl.textContent || '').replace(/[^\d]/g, '')) || 0;
        if (qty > 0) {
          result.queue[tid] = {
            qty: qty,
            remainingSec: endEl ? parseInt(endEl.getAttribute('data-remaining')) || 0 : 0,
            nextReadySec: nextEl ? parseInt(nextEl.getAttribute('data-remaining')) || 0 : 0,
          };
        }
      }
    }
    // Total army value (from #units-total-army data-unit-values, if present)
    const totalEl = doc.getElementById('total-value');
    if (totalEl) result.totalValue = parseInt((totalEl.textContent || '').replace(/[^\d]/g, '')) || 0;
    return result;
  }

  // Fetch /nourishing/index in the background (no navigation) and parse
  // the army state from the response. Caches result for 60s. Used by the
  // T4-short wait logic to know exact ETA of the next T4 unit.
  let _armyCache = null;
  function fetchArmyState(cb) {
    if (!ctxOk()) { cb(null); return; }
    const now = Date.now();
    if (_armyCache && (now - _armyCache.ts) < 60000) { cb(_armyCache.data); return; }
    if (isArmyPage()) {
      // Page is already loaded — parse directly, no fetch needed
      const data = parseArmyStateFromDom(document);
      _armyCache = { ts: now, data };
      cb(data);
      return;
    }
    try {
      fetch(BASE + '/nourishing/index', { credentials: 'include' })
        .then(resp => resp.text())
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const data = parseArmyStateFromDom(doc);
          _armyCache = { ts: now, data };
          cb(data);
        })
        .catch(() => cb(null));
    } catch (e) { cb(null); }
  }

  // ── BOT LOGIC: DECIDE HUNT TYPE ──────────────────────────────
  function decideHuntType(settings) {
    if (settings.huntMode === 'manual') return settings.huntManualType;

    const abPct = getABPercent();
    if (abPct === null) return 4; // fallback: Mesto

    if (abPct >= settings.huntHighAB.minAB) return settings.huntHighAB.type;
    if (abPct >= settings.huntMidAB.minAB)  return settings.huntMidAB.type;
    return settings.huntLowAB.type;
  }

  function getAcceptableQualities(settings, state) {
    let accepted;

    if (settings.huntMode === 'manual') {
      accepted = settings.huntManualAcceptQ && settings.huntManualAcceptQ.length > 0
        ? [...settings.huntManualAcceptQ]
        : [...QUALITY_RANKS];
    } else {
      let abPct = getABPercent();

      // On result page, AB% may not be readable — use last saved value
      if (abPct === null && state && state.lastKnownABPct !== undefined) {
        abPct = state.lastKnownABPct;
      }

      // If still null, accept ALL (don't skip good essences due to missing data)
      if (abPct === null) {
        accepted = [...QUALITY_RANKS];
      } else if (abPct >= settings.huntHighAB.minAB) {
        accepted = [...settings.huntHighAB.acceptQ];
      } else if (abPct >= settings.huntMidAB.minAB) {
        accepted = [...settings.huntMidAB.acceptQ];
      } else {
        accepted = [...settings.huntLowAB.acceptQ];
      }
    }

    // Filter out globally ignored qualities
    const ignore = settings.huntIgnoreQ || [];
    if (ignore.length > 0) {
      accepted = accepted.filter(q => !ignore.includes(q));
    }

    return accepted;
  }

  // ── HELPER: Transition to waiting_orb with proper cooldown + ruins kickoff ──
  function enterOrbCooldown(state, settings) {
    state.huntState = 'waiting_orb';
    state.orbWaitUntil = computeOrbWaitUntil(settings);
    saveState(state);
    updateHuntUI(settings, state);
    startCooldownTicker(settings, state);

    // Kick off ruins if enabled (cooperative mode)
    if (settings.ruinsEnabled && state.ruinsState !== 'done') {
      botLog('info', 'Hunt on cooldown → Starting Ruins');
      botSetTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.ruinsEnabled && st.ruinsState !== 'done') {
              ruinsTick(st, se);
            }
          });
        });
      }, randomDelay(2000, 4000));
    }

    // v1.6.5 — Kick off a generic botTick if any GLOBAL module is enabled
    // (Spend Gold, Auto Recruitment, Graveyard). Without this, those modules
    // get no chance to fire during orb cooldown when only Hunt is configured —
    // they live inside _botTickInner and need someone to call botTick. The
    // periodic re-check is handled by startCooldownTicker (every ~30s).
    // v1.6.14 — Inventory Cleanup joins this list for the same reason.
    const globalsEnabled = (settings.goldMode > 0) || !!settings.recruitEnabled || !!settings.graveyardEnabled || !!settings.invDiscardEnabled;
    if (globalsEnabled) {
      botLog('info', 'Hunt on cooldown → Will run global modules (Gold / Recruit / Graveyard)');
      botSetTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            botTick(st, se);
          });
        });
      }, randomDelay(3000, 5000));
    }
  }

  // ── BOT STATE MACHINE TICK ───────────────────────────────────
  function botTick(state, settings) {
    // ── CENTRAL STOP GUARD ──────────────────────────────────────
    if (_centralStopActive) {
      updateStatusDot(settings, state);
      return;
    }
    _botTickInner(state, settings);
  }

  function _botTickInner(state, settings) {
    // v1.6.7 — apply schedule mask: when scheduleEnabled is true, the active
    // slot's `actions` flags fully override per-module enable toggles.
    // Outside any active slot, all five main bots are forced off.
    settings = getEffectiveSettings(settings);

    const ap = readAP();
    const abPct = getABPercent();

    const huntEnabled = settings.huntEnabled && state.huntState !== 'done';
    const ruinsEnabled = settings.ruinsEnabled && state.ruinsState !== 'done';
    const huntWaiting = state.huntState === 'waiting_orb';
    const huntDoneOrWaiting = state.huntState === 'done' || state.huntState === 'waiting_orb';

    // ── HUNT BOT (priority) ───────────────────────────────────
    if (huntEnabled) {

      // ── ORB COOLDOWN — check if it ended ──
      if (huntWaiting) {
        if (Date.now() >= (state.orbWaitUntil || 0)) {
          botLog('info', 'Orb cooldown ended → Restarting hunt');
          state.huntState = 'navigating';
          state.extractionsThisSession = 0;
          saveState(state);
          botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 3000));
          return;
        }
        const remaining = Math.ceil(((state.orbWaitUntil || 0) - Date.now()) / 60000);
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        botLog('info', `Orb cooldown: ${hours}h ${mins}m remaining`);
        updateHuntUI(settings, state);
        // DON'T return here — let ruins run while hunt is on cooldown
      }

      // ── ACTIVE HUNT LOGIC (only when not on cooldown) ──
      if (!huntWaiting) {

      // ── RECOVERY: After extraction, page reloads with state='extracting'
      // We're no longer on the result page, so reset state and continue loop
      if (state.huntState === 'extracting' && !isHuntResultPage()) {
        // Track BE gain from extraction
        const beAfter = readBE() || 0;
        const beBefore = state.beBeforeExtract || 0;
        const beGain = beAfter - beBefore;
        if (beGain > 0) {
          botLog('ok', `🩸 Blood Essence +${beGain} (${beBefore} → ${beAfter})`);
          // Save to extraction log
          sGet([SK('extractionLog')], r => {
            const log = r[SK('extractionLog')] || [];
            log.push({
              ts: Date.now(),
              gain: beGain,
              before: beBefore,
              after: beAfter,
              extraction: state.extractionsThisSession || 1,
            });
            while (log.length > 500) log.shift();
            sSet({ [SK('extractionLog')]: log });
          });
        } else if (beBefore === 0 && beAfter > 0) {
          // beBeforeExtract was lost (state race condition) — log extraction without gain data
          botLog('info', `🩸 Extraction complete (essence: ${beAfter}, before: unknown)`);
          sGet([SK('extractionLog')], r => {
            const log = r[SK('extractionLog')] || [];
            log.push({
              ts: Date.now(),
              gain: 0,
              before: 0,
              after: beAfter,
              extraction: state.extractionsThisSession || 1,
              note: 'beBeforeExtract lost',
            });
            while (log.length > 500) log.shift();
            sSet({ [SK('extractionLog')]: log });
          });
        }
        state.beBeforeExtract = null;
        botLog('ok', `Extraction ${state.extractionsThisSession || 1}/3 complete`);
        
        // Check if all orbs are extracted
        if (state.extractionsThisSession >= 3) {
          if (settings.extractAutoRepeat) {
            botLog('info', 'All 3 orbs extracted. Waiting for cooldown.');
            enterOrbCooldown(state, settings);
            return;
          } else {
            botLog('ok', 'All 3 orbs extracted. Hunt bot finished.');
            state.huntState = 'done';
            saveState(state);
            updateHuntUI(settings, state);
            return;
          }
        }

        // Still have orbs to fill — continue hunting
        state.huntState = 'navigating';
        saveState(state);
        botLog('info', 'Continuing hunt for next orb...');
        
        // Navigate to hunt page if not already there
        if (isHuntChoicePage()) {
          // Already on choice page, pick hunt type
          const huntType = decideHuntType(settings);
          const neededAP = HUNT_TYPES.find(h => h.id === huntType)?.ap || 1;
          if (ap.current !== null && ap.current >= neededAP) {
            botLog('info', `AB: ${abPct}% → Lov: ${HUNT_TYPES.find(h => h.id === huntType)?.name} (typ ${huntType})`);
            botSetTimeout(() => { window.location.href = BASE + '/robbery/humanhunt/' + huntType; }, randomDelay(1500, 3500));
          } else {
            botLog('warn', `AP: ${ap.current}/${neededAP}, nedostatok pre lov.`);
            state.huntState = 'done';
            saveState(state);
          }
          return;
        } else {
          // Navigate to hunt choice page
          botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1500, 3500));
          return;
        }
      }

      // On hunt result page
      if (isHuntResultPage()) {
        const result = parseHuntResult();
        
        // If we were extracting and we're still on result page (extraction may have happened inline)
        if (state.huntState === 'extracting') {
          // Track BE gain from inline/redirect extraction
          const beAfter = readBE() || 0;
          const beBefore = state.beBeforeExtract || 0;
          const beGain = beAfter - beBefore;
          if (beGain > 0) {
            botLog('ok', `🩸 Blood Essence +${beGain} (${beBefore} → ${beAfter})`);
            sGet([SK('extractionLog')], r => {
              const log = r[SK('extractionLog')] || [];
              log.push({
                ts: Date.now(),
                gain: beGain,
                before: beBefore,
                after: beAfter,
                extraction: state.extractionsThisSession || 1,
              });
              while (log.length > 500) log.shift();
              sSet({ [SK('extractionLog')]: log });
            });
          } else if (beBefore === 0 && beAfter > 0) {
            botLog('info', `🩸 Extraction (essence: ${beAfter}, before: unknown)`);
            sGet([SK('extractionLog')], r => {
              const log = r[SK('extractionLog')] || [];
              log.push({
                ts: Date.now(),
                gain: 0,
                before: 0,
                after: beAfter,
                extraction: state.extractionsThisSession || 1,
                note: 'beBeforeExtract lost',
              });
              while (log.length > 500) log.shift();
              sSet({ [SK('extractionLog')]: log });
            });
          }
          state.beBeforeExtract = null;
          botLog('ok', `Extraction ${state.extractionsThisSession || 1}/3 complete (inline)`);
          
          // Check orbs again - if still has extraction & orbs, the extraction didn't complete yet
          if (result.hasExtraction && result.orbsReady > 0) {
            // Extraction modal might still be open, wait a bit and retry
            botLog('info', 'Extraction still in progress, waiting...');
            botSetTimeout(() => botTick(state, settings), randomDelay(2000, 4000));
            return;
          }
          
          // Extraction completed - continue to next hunt
          state.huntState = 'navigating';
          saveState(state);
        } else {
          botLog('info', `Hunt result: ${result.success ? 'Success' : 'Failure'}, Rank: ${result.rank || '–'}, Orbs: ${result.orbsReady}/${result.orbsTotal} available`);
        }

        // No ready orbs — all on cooldown
        if (result.orbsTotal > 0 && result.orbsReady === 0) {
          if (settings.extractAutoRepeat) {
            botLog('info', `No available orbs (0/${result.orbsTotal}). Waiting for cooldown.`);
            enterOrbCooldown(state, settings);
            return;
          } else {
            botLog('ok', `No available orbs. Hunt bot finished.`);
            state.huntState = 'done';
            saveState(state);
            updateHuntUI(settings, state);
            return;
          }
        }
        else if (result.hasExtraction && result.orbsReady > 0) {
          const acceptable = getAcceptableQualities(settings, state);
          const liveAB = getABPercent();
          const usedAB = liveAB !== null ? liveAB : (state.lastKnownABPct ?? null);
          botLog('info', `Accepted qualities: [${acceptable.join(',')}] (AB: ${usedAB !== null ? usedAB + '%' : 'unknown'}${liveAB === null ? ' /saved/' : ''})`);

          // If rank couldn't be parsed, log it and accept anyway
          if (!result.rank) {
            botLog('warn', `Could not determine rank (rank-line DOM missing?) → Extracting anyway`);
            // Fall through to extract
          }

          if (!result.rank || (result.rank && acceptable.includes(result.rank))) {
            // Accept & extract
            botLog('ok', `Quality ${result.rank} accepted → Extracting`);
            state.huntState = 'extracting';
            state.extractionsThisSession = (state.extractionsThisSession || 0) + 1;
            state.recruitDoneThisExtraction = false; // allow recruit after this extraction
            // Snapshot BE before extraction for tracking gain
            state.beBeforeExtract = readBE() || 0;
            
            // CRITICAL: Wait for state save before triggering extraction (redirect)
            // chrome.storage.local.set is async — if we click before it completes,
            // the page redirects and state is lost
            sSet({ [SK('state')]: state }, () => {
              const extractBtn = document.getElementById('extractBloodBtn');
              if (extractBtn) {
                // Helper: track BE gain after inline extraction
                function trackInlineBEGain(st, cb) {
                  const beAfter = readBE() || 0;
                  const beBefore = st.beBeforeExtract || 0;
                  const beGain = beAfter - beBefore;
                  if (beGain > 0) {
                    botLog('ok', `🩸 Blood Essence +${beGain} (${beBefore} → ${beAfter})`);
                    sGet([SK('extractionLog')], r => {
                      const log = r[SK('extractionLog')] || [];
                      log.push({
                        ts: Date.now(),
                        gain: beGain,
                        before: beBefore,
                        after: beAfter,
                        extraction: st.extractionsThisSession || 1,
                      });
                      while (log.length > 500) log.shift();
                      sSet({ [SK('extractionLog')]: log }, () => { if (cb) cb(); });
                    });
                  } else if (beAfter > 0 && beBefore === 0) {
                    // beBeforeExtract was 0 (missing) but we have a current value — log without gain
                    botLog('info', `🩸 Essence after extraction: ${beAfter} (before: unknown)`);
                    if (cb) cb();
                  } else {
                    if (cb) cb();
                  }
                  st.beBeforeExtract = null;
                }

                const showModal = extractBtn.getAttribute('data-show-modal');
                if (showModal === '1') {
                  // Need to confirm modal — click extract then confirm
                  extractBtn.click();
                  botSetTimeout(() => {
                    const confirmBtn = document.getElementById('confirmModal_buttonLeft');
                    if (confirmBtn) confirmBtn.click();
                    // FALLBACK: if extraction is inline (no page redirect), re-tick after delay
                    botSetTimeout(() => {
                      loadState(st => {
                        loadSettings(se => {
                          if (se.huntEnabled && st.huntState === 'extracting') {
                            botLog('info', 'Post-extrakcia re-tick (inline)...');
                            // Track BE gain from inline extraction
                            trackInlineBEGain(st, () => {});
                            // Check if all 3 orbs done
                            if (st.extractionsThisSession >= 3) {
                              if (se.extractAutoRepeat) {
                                botLog('info', 'All 3 orbs extracted. Waiting for cooldown.');
                                enterOrbCooldown(st, se);
                              } else {
                                botLog('ok', 'All 3 orbs extracted. Hunt bot finished.');
                                st.huntState = 'done';
                                saveState(st);
                                updateHuntUI(se, st);
                              }
                              return;
                            }
                            st.huntState = 'navigating';
                            saveState(st);
                            botTick(st, se);
                          }
                        });
                      });
                    }, randomDelay(3000, 5000));
                  }, 800);
                } else {
                  extractBtn.click();
                  // FALLBACK: if extraction is inline (no page redirect), re-tick after delay
                  botSetTimeout(() => {
                    loadState(st => {
                      loadSettings(se => {
                        if (se.huntEnabled && st.huntState === 'extracting') {
                          botLog('info', 'Post-extrakcia re-tick (inline)...');
                          // Track BE gain from inline extraction
                          trackInlineBEGain(st, () => {});
                          // Check if all 3 orbs done
                          if (st.extractionsThisSession >= 3) {
                            if (se.extractAutoRepeat) {
                              botLog('info', 'All 3 orbs extracted. Waiting for cooldown.');
                              enterOrbCooldown(st, se);
                            } else {
                              botLog('ok', 'All 3 orbs extracted. Hunt bot finished.');
                              st.huntState = 'done';
                              saveState(st);
                              updateHuntUI(se, st);
                            }
                            return;
                          }
                          st.huntState = 'navigating';
                          saveState(st);
                          botTick(st, se);
                        }
                      });
                    });
                  }, randomDelay(3000, 5000));
                }
              }
            });
            return;
          } else {
            // Quality not acceptable, skip extraction
            botLog('warn', `Quality "${result.rank}" (raw: "${result.quality || '?'}") not acceptable (want: [${acceptable.join(',')}]), skipping extraction`);
          }
        }

        // Continue hunting if AP available
        const huntType = decideHuntType(settings);
        const neededAP = HUNT_TYPES.find(h => h.id === huntType)?.ap || 1;

        if (ap.current !== null && ap.current >= neededAP) {
          // Check if there's a "Zopakovať" (repeat) button matching our type
          const repeatForm = document.querySelector(`form[action*="robbery/humanhunt/${huntType}"]`);
          if (repeatForm) {
            botLog('info', `Opakujem lov typu ${huntType} (${HUNT_TYPES.find(h => h.id === huntType)?.name})`);
            state.huntState = 'navigating';
            saveState(state);

            const submitBtn = repeatForm.querySelector('button[type="submit"], input[type="submit"]');
            if (submitBtn) {
              submitBtn.click();
              return;
            }
          }

          // Otherwise navigate directly
          state.huntState = 'navigating';
          saveState(state);
          botLog('info', `Navigating to hunt: ${HUNT_TYPES.find(h => h.id === huntType)?.name}`);
          botSetTimeout(() => { window.location.href = BASE + '/robbery/humanhunt/' + huntType; }, randomDelay(600, 1500));
          return;
        } else {
          // No AP
          botLog('warn', `Not enough AP (${ap.current}/${neededAP}). Hunt bot waiting.`);
          state.huntState = 'done';
          saveState(state);

          // Check if we should wait for orb cooldown
          if (settings.extractAutoRepeat && state.extractionsThisSession >= 3) {
            botLog('info', 'All 3 orbs extracted. Waiting for cooldown.');
            enterOrbCooldown(state, settings);
          }
        }
      }

      // On hunt choice page (/robbery/index)
      else if (isHuntChoicePage()) {
        const huntType = decideHuntType(settings);
        const neededAP = HUNT_TYPES.find(h => h.id === huntType)?.ap || 1;

        if (ap.current !== null && ap.current >= neededAP) {
          botLog('info', `AB: ${abPct}% → Lov: ${HUNT_TYPES.find(h => h.id === huntType)?.name} (typ ${huntType})`);
          state.huntState = 'navigating';
          state.lastKnownABPct = abPct; // save for use on result page
          saveState(state);
          botSetTimeout(() => { window.location.href = BASE + '/robbery/humanhunt/' + huntType; }, randomDelay(600, 1500));
          return;
        } else {
          botLog('warn', `AP: ${ap.current}/${neededAP}, nedostatok pre lov.`);
          state.huntState = 'done';
          saveState(state);
        }
      }

      // Not on hunt page — navigate there
      else if (state.huntState === 'idle' || state.huntState === 'navigating') {
        if (!PAGE.includes('/robbery/')) {
          botLog('info', 'Navigating to hunt page...');
          state.huntState = 'navigating';
          saveState(state);
          botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(600, 1500));
          return;
        }
      }
      } // end if (!huntWaiting)
    }

    // ── RECRUIT BOT — moved to globalRecruitTick (v1.6.4) ─────
    // Recruit now runs as a global tick alongside Gold/Graveyard,
    // so it works during ANY idle/cooldown period regardless of which
    // main bot module is enabled. See globalRecruitTick() and the
    // global pre-check section below.

    // ── RUINS BOT (runs when: ruins enabled AND (hunt not active OR hunt on cooldown/done)) ──
    if (ruinsEnabled && (huntDoneOrWaiting || !huntEnabled)) {
      ruinsTick(state, settings);
    }

    // ── STORY BOT ───────────────────────────────────────────────
    if (settings.storyEnabled && state.storyState !== 'done') {
      storyTick(state, settings);
    }

    // ══════════════════════════════════════════════════════════
    // ── GLOBAL PRE-CHECK: Gold spending has PRIORITY ─────────
    // Before any main bot action, check if we should spend gold first.
    // Normally only triggers when no other bot is actively navigating, BUT
    // v1.6.2 — if Donate-to-clan mode is on AND gold is at/above the configured
    // threshold, donation PREEMPTS other navigation (anti-raid protection:
    // gold above threshold is a raid magnet and cannot sit).
    // ══════════════════════════════════════════════════════════
    const anyBotActivelyNavigating = 
      (huntEnabled && !huntWaiting && state.huntState === 'navigating') ||
      (ruinsEnabled && state.ruinsState === 'navigating') ||
      (settings.storyEnabled && state.storyState === 'navigating');

    let goldUrgent = false;
    if (settings.goldMode === 2) {
      const _gold = readGold();
      const _min = settings.goldDonateMin || 10000;
      if (_gold !== null && _gold >= _min) goldUrgent = true;
    }

    if (settings.goldMode > 0 && (goldUrgent || !anyBotActivelyNavigating)) {
      if (goldUrgent && anyBotActivelyNavigating) {
        botLog('info', '💰 Gold: Threshold reached — preempting other modules');
      }
      const goldHandled = globalGoldTick(state, settings);
      if (goldHandled) return; // Gold tick took action (navigation or click), wait for reload
    }

    // ── GLOBAL PRE-CHECK: Auto Recruitment (v1.6.4) ───────────
    // Like Gold spending, recruit runs as a global tick so it works
    // during ANY idle/cooldown period (yellow/white indicator) regardless
    // of which main bot module is enabled. The "extraction" trigger still
    // honors the hunt-tied behaviour; the "idle"/"threshold"/"continuous"
    // triggers run independent of any specific module.
    if (settings.recruitEnabled && !anyBotActivelyNavigating) {
      const recruitHandled = globalRecruitTick(state, settings);
      if (recruitHandled) return;
    }

    // ── GLOBAL PRE-CHECK: Inventory Discard (v1.6.13) ─────────
    // Runs during ANY idle/cooldown period (yellow/white indicator state).
    // In MANUAL mode, only fires when the user pressed "Run Now" (state flag
    // invDiscardManualPending). In AUTO mode, the schedule gate in
    // inventoryDiscardTick decides whether the interval has elapsed.
    // Always gated by !anyBotActivelyNavigating so it never preempts a
    // mid-flight battle/extraction sequence (non-urgent feature).
    if (settings.invDiscardEnabled && !anyBotActivelyNavigating) {
      const invHandled = inventoryDiscardTick(state, settings);
      if (invHandled) return;
    }

    // ══════════════════════════════════════════════════════════
    // ── MAIN BOT MODULES ─────────────────────────────────────
    // These are the active bots. They run based on priority.
    // ══════════════════════════════════════════════════════════

    // ── GROTTO BOT ──────────────────────────────────────────────
    if (settings.grottoEnabled && state.grottoState !== 'done') {
      grottoTick(state, settings);
    }

    // ── PVP BOT ─────────────────────────────────────────────────
    if (settings.pvpEnabled && state.pvpState !== 'done') {
      pvpTick(state, settings);
    }

    // ── HENCHMAN VS HENCHMAN BOT (v1.6.9) ───────────────────────
    // Mutually exclusive with PvP — only runs when PvP is disabled.
    if (settings.henchmanEnabled && !settings.pvpEnabled && state.henchmanState !== 'done') {
      henchmanTick(state, settings);
    }

    // ══════════════════════════════════════════════════════════
    // ── COOLDOWN PHASE: Gifts & Graveyard ────────────────────
    // These run when main bots are idle/cooldown/done.
    // ══════════════════════════════════════════════════════════
    const mainBotsBusy = (huntEnabled && !huntWaiting && state.huntState !== 'done' && state.huntState !== 'idle') ||
                         (settings.grottoEnabled && state.grottoState === 'fighting') ||
                         (settings.pvpEnabled && state.pvpState === 'hunting') ||
                         (settings.henchmanEnabled && state.henchmanState === 'hunting');

    // ── GIFTS BOT (auto-open gifts during cooldowns/idle) ────
    if ((settings.giftsAutoDBG || state.giftsState === 'running') && !mainBotsBusy) {
      giftsTick(state, settings);
    }

    // ── GRAVEYARD (work during cooldowns when AP/HP low) ─────
    if (settings.graveyardEnabled && !mainBotsBusy) {
      const ap2 = readAP();
      const hp2 = getHPPercent();
      const apLow = ap2.current !== null && ap2.current < (settings.graveyardMinAP || 5);
      const hpLow = hp2 !== null && hp2 < (settings.graveyardMinHP || 20);
      if (apLow || hpLow) {
        graveyardTick(state, settings);
      }
    }
  }

  // ── RUINS TICK ───────────────────────────────────────────────
  function ruinsTick(state, settings) {
    if (_centralStopActive) return;
    // If hunt bot is active and NOT on cooldown, defer to hunt (priority)
    if (settings.huntEnabled && state.huntState !== 'done' && state.huntState !== 'waiting_orb') {
      botLog('info', 'Ruins: Hunt is active, pausing ruins');
      return;
    }

    const levels = settings.ruinsLevels || [];
    if (levels.length === 0) { state.ruinsState = 'done'; saveState(state); return; }

    // ── POST-FIGHT RESULT DETECTION (must come BEFORE level scanning) ──
    if (state.ruinsState === 'fighting') {
      if (isRuinsFightResultPage() && state.ruinsLastBattle) {
        const battle = state.ruinsLastBattle;

        // Parse result directly from DOM (combatContainer)
        const resultHeader = document.querySelector('.combatResultHeader');
        const won = resultHeader ? resultHeader.classList.contains('resultVictory') : false;

        // Parse fallen units from FIRST .allFallenUnits block (main casualties)
        const losses = {};
        // Language-independent: detect tier from unit's background-image, data attributes, or CSS class
        // The game uses consistent asset paths like /img/units/tierN or data-tier-id attributes
        const NAME_TO_TIER = {}; // Not used — see structural detection below
        const fallenBlocks = document.querySelectorAll('.combatContainer > .wrap-left .allFallenUnits');
        const mainFallen = fallenBlocks.length > 0 ? fallenBlocks[0] : null;
        if (mainFallen) {
          mainFallen.querySelectorAll('.fallenUnit').forEach(unit => {
            const nameEl = unit.querySelector('.fallenUnitName');
            const qtyEl = unit.querySelector('.fallenUnitQty');
            if (nameEl && qtyEl) {
              const name = nameEl.textContent.trim();
              const qty = parseInt(qtyEl.textContent.trim()) || 0;
              // Language-independent tier detection: use DOM structure, CSS, data attributes
              let tid = null;
              // Method 1: data attribute (data-tier, data-unit-id, etc.)
              const tierAttr = unit.getAttribute('data-tier') || unit.getAttribute('data-unit-id') || '';
              if (tierAttr) tid = 'T' + tierAttr;
              // Method 2: CSS class or background-image path containing tier number
              if (!tid) {
                const classAndStyle = (unit.className || '') + ' ' + (unit.getAttribute('style') || '');
                const tierMatch = classAndStyle.match(/[Tt]ier[_-]?(\d+)|unit[_-]?(\d+)|playerUnit[_-]?(\d+)/i);
                if (tierMatch) tid = 'T' + (tierMatch[1] || tierMatch[2] || tierMatch[3]);
              }
              // Method 3: img src containing unit tier identifier
              if (!tid) {
                const unitImg = unit.querySelector('img[src*="unit"], img[src*="tier"]');
                if (unitImg) {
                  const srcMatch = unitImg.src.match(/[Tt]ier[_-]?(\d+)|unit[_-]?(\d+)/);
                  if (srcMatch) tid = 'T' + (srcMatch[1] || srcMatch[2]);
                }
              }
              // Method 4: index-based fallback — fallen units are listed in tier order (T1 first)
              if (!tid) {
                const allFallen = mainFallen.querySelectorAll('.fallenUnit');
                const idx = Array.from(allFallen).indexOf(unit);
                if (idx >= 0 && idx < 4) tid = 'T' + (idx + 1);
              }
              if (tid && qty > 0) losses[tid] = (losses[tid] || 0) + qty;
            }
          });
        }

        // Parse loot: gold, XP and Blood Essence
        let goldReward = 0, xpReward = 0, bloodReward = 0;
        const goldEl = document.querySelector('.lootGold p');
        if (goldEl) goldReward = parseInt(goldEl.textContent.trim().replace(/[\.\s]/g, '')) || 0;
        const xpEl = document.querySelector('.lootEXP p');
        if (xpEl) xpReward = parseInt(xpEl.textContent.trim().replace(/[\.\s]/g, '')) || 0;
        const bloodEl = document.querySelector('.lootBlood p, .lootBloodEssence p, .loot-blood p, [class*="lootBlood"] p');
        if (bloodEl) bloodReward = parseInt(bloodEl.textContent.trim().replace(/[\.\s]/g, '')) || 0;
        if (!bloodReward) {
          document.querySelectorAll('.loot-item, .lootItem, .rewardItem, .lootRow').forEach(el => {
            const txt = el.textContent || '';
            if (el.className.toLowerCase().includes('blood') || txt.includes('🩸')) {
              const numEl = el.querySelector('p, span, b, strong');
              if (numEl) { const v = parseInt(numEl.textContent.trim().replace(/[\.\s]/g, '')) || 0; if (v > 0) bloodReward += v; }
            }
          });
        }

        // Parse layer from "Pokračovať" link: ?layerId=12
        let resultLevel = battle.level;
        const contLink = document.querySelector('.combatLink');
        if (contLink) {
          const lm = contLink.href.match(/layerId=(\d+)/);
          if (lm) resultLevel = parseInt(lm[1]);
        }

        // Build battle log entry
        const entry = {
          ts: battle.timestamp,
          level: resultLevel,
          enemy: battle.enemy,
          formation: battle.formation,
          source: battle.source,
          won: won,
          losses: losses,
          gold: goldReward,
          xp: xpReward,
          blood: bloodReward,
        };

        // Save to battle history
        sGet([SK('ruinsBattleLog')], r => {
          const log = r[SK('ruinsBattleLog')] || [];
          log.push(entry);
          while (log.length > 500) log.shift();
          sSet({ [SK('ruinsBattleLog')]: log });
        });

        const lossStr = Object.entries(losses).filter(([,v]) => v > 0).map(([k,v]) => `${k}:-${v}`).join(', ');
        botLog(won ? 'ok' : 'warn',
          `Result L${resultLevel}: ${won ? '✅ Victory' : '❌ Defeat'} | Losses: ${lossStr || 'none'}${goldReward ? ' | 💰+' + goldReward.toLocaleString() : ''}${xpReward ? ' | ⭐+' + xpReward.toLocaleString() : ''}${bloodReward ? ' | 🩸+' + bloodReward.toLocaleString() : ''}`
        );

        // Clear pre-battle snapshot
        state.ruinsLastBattle = null;
        state.ruinsState = 'navigating';
        state.ruinsCurrentIdx++;

        // Check cycle completion after incrementing
        if (state.ruinsCurrentIdx >= levels.length) {
          if (settings.ruinsCadence === 'once') {
            botLog('ok', 'Ruins: Single cycle complete');
            state.ruinsState = 'done'; saveState(state); updateRuinsUI(settings, state); return;
          }
          if (settings.ruinsCadence === 'cycles' && state.ruinsCurrentCycle >= settings.ruinsCycles) {
            botLog('ok', `Ruins: ${settings.ruinsCycles} cycles complete`);
            state.ruinsState = 'done'; saveState(state); updateRuinsUI(settings, state); return;
          }
          state.ruinsCurrentCycle++;
          state.ruinsCurrentIdx = 0;
          botLog('info', `Ruins: Cycle ${state.ruinsCurrentCycle}/${settings.ruinsCadence === 'infinite' ? '∞' : settings.ruinsCycles}`);
        }

        // Click "Pokračovať" to go back to ruins index
        if (contLink) {
          saveState(state);
          botSetTimeout(() => { contLink.click(); }, randomDelay(1000, 2500));
          return;
        }

        // No continue link — navigate manually
        saveState(state);
        botLog('info', `Ruins: Navigating to layer ${levels[state.ruinsCurrentIdx]}`);
        botSetTimeout(() => { window.location.href = BASE + '/ancestral/show/' + levels[state.ruinsCurrentIdx]; }, randomDelay(800, 2000));
        return;
      }
      // Still on fighting state but not on result page — might be loading
      // Also handle case where ruinsLastBattle was lost (race condition safety)
      if (!state.ruinsLastBattle) {
        botLog('warn', 'Ruins: ruinsLastBattle lost (race condition), restarting navigation');
        state.ruinsState = 'navigating';
        saveState(state);
      }
      // If we're on a page that's not the fight result yet, just wait for it to load
      return;
    }

    const now = Date.now();

    // Init state
    if (!state.ruinsCurrentIdx) state.ruinsCurrentIdx = 0;
    if (!state.ruinsCurrentCycle) state.ruinsCurrentCycle = 1;
    if (!state.ruinsAttackTimes) state.ruinsAttackTimes = {};

    const level = levels[state.ruinsCurrentIdx];

    // Check cooldown for current level — scan all remaining levels for next available
    // Find the first level that is NOT on cooldown.
    // v1.5.9: cooldown is per-LEVEL (looks up the band-specific interval),
    // so each layer can have a different wait time.
    let foundReady = false;
    for (let scanOffset = 0; scanOffset < levels.length; scanOffset++) {
      const scanIdx = (state.ruinsCurrentIdx + scanOffset) % levels.length;
      const scanLevel = levels[scanIdx];
      const scanLast = state.ruinsAttackTimes[scanLevel] || 0;
      const scanIntervalMs = getRuinsIntervalForLevel(scanLevel, settings) * 60 * 1000;
      if (now - scanLast >= scanIntervalMs) {
        // Found a level ready to attack — advance index to it
        if (scanOffset > 0) {
          state.ruinsCurrentIdx = scanIdx;
          saveState(state);
        }
        foundReady = true;
        break;
      }
    }

    if (!foundReady) {
      // All levels are on cooldown — find the shortest remaining wait time
      let minWait = Infinity;
      for (const lvl of levels) {
        const last = state.ruinsAttackTimes[lvl] || 0;
        const lvlIntervalMs = getRuinsIntervalForLevel(lvl, settings) * 60 * 1000;
        const remaining = lvlIntervalMs - (now - last);
        if (remaining > 0 && remaining < minWait) minWait = remaining;
      }
      const waitMs = Math.max(minWait, 30000); // at least 30s
      const waitMin = Math.round(waitMs / 60000);
      botLog('info', `Ruins: All layers on cooldown. Waiting ${waitMin} min.`);
      saveState(state);
      botSetTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.ruinsEnabled && st.ruinsState !== 'done') ruinsTick(st, se);
          });
        });
      }, waitMs);
      return;
    }

    const lastAttack = state.ruinsAttackTimes[level] || 0;
    const levelIntervalMs = getRuinsIntervalForLevel(level, settings) * 60 * 1000;
    if (now - lastAttack < levelIntervalMs) {
      // Current level still on cooldown after scan (shouldn't happen, but safety)
      saveState(state);
      botSetTimeout(() => ruinsTick(state, settings), 100);
      return;
    }

    // Navigate to ruins level
    if (!PAGE.includes('/ancestral/show/' + level)) {
      // Check cycle completion after incrementing
      if (state.ruinsCurrentIdx >= levels.length) {
        if (settings.ruinsCadence === 'once') {
          botLog('ok', 'Ruins: Single cycle complete');
          state.ruinsState = 'done'; saveState(state); return;
        }
        if (settings.ruinsCadence === 'cycles' && state.ruinsCurrentCycle >= settings.ruinsCycles) {
          botLog('ok', `Ruins: ${settings.ruinsCycles} cycles complete`);
          state.ruinsState = 'done'; saveState(state); return;
        }
        state.ruinsCurrentCycle++;
        state.ruinsCurrentIdx = 0;
        botLog('info', `Ruins: Cycle ${state.ruinsCurrentCycle}/${settings.ruinsCadence === 'infinite' ? '∞' : settings.ruinsCycles}`);
      }

      botLog('info', `Ruins: Navigating to layer ${levels[state.ruinsCurrentIdx]}`);
      state.ruinsState = 'navigating';
      saveState(state);
      botSetTimeout(() => { window.location.href = BASE + '/ancestral/show/' + levels[state.ruinsCurrentIdx]; }, randomDelay(800, 2000));
      return;
    }

    // On the correct ruins show page — analyze enemy, check presets, simulate, fight
    if (isRuinsShowPage()) {
      // Save current layer for simulator (smart preset pre-fill)
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ 'bf_current_layer': { layer: level, ts: Date.now() } });
        }
      } catch (_) {}

      // 1. Parse enemy units
      const enemyQtys = parseRuinsEnemies();
      const enemyStr = Object.entries(enemyQtys).map(([k,v]) => `${k}:${v}`).join(', ');
      botLog('info', `Ruins layer ${level}: Enemy: ${enemyStr || 'none'}`);

      // 2. Parse player available units
      const maxUnits = parseRuinsPlayerMax();
      const powerLimit = parseRuinsPowerLimit();

      // ── SAFETY CHECK: Minimum units ──
      if (settings.ruinsStopMinUnits) {
        const minReq = settings.ruinsMinUnits || {};
        const shortages = [];
        for (const [tid, minQty] of Object.entries(minReq)) {
          if (minQty > 0 && (maxUnits[tid] || 0) < minQty) {
            shortages.push(`${tid}: ${maxUnits[tid] || 0}/${minQty}`);
          }
        }
        if (shortages.length > 0) {
          botLog('warn', `⛔ STOP — Not enough units: ${shortages.join(', ')}`);
          botLog('warn', 'Ruins Bot stopped for safety. Replenish units and restart.');
          settings.ruinsEnabled = false;
          saveSettings(settings);
          state.ruinsState = 'done';
          saveState(state);
          updateRuinsUI(settings, state);
          return;
        }
      }

      // 3. Check presets first, then fall back to simulation
      const fp = Object.entries(enemyQtys).filter(([,v]) => v > 0).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join(',');

      // ── Slider sequence + fight (shared by preset hit + optimizer paths) ──
      function proceedWithFormation(useQtys, source) {
        const fmtStr = Object.entries(useQtys).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ');
        botLog('ok', `Formation [${source}]: ${fmtStr}`);

        // 4. Set sliders via realistic button clicks (+10, +1)
        function clickSliderTo(tierId, targetQty) {
          const TIER_TO_DATA_ID = { 'T1':'1', 'T2':'2', 'T3':'3', 'T4':'4', 'T5':'5', 'T6':'6', 'T7':'7', 'T8':'8' };
          const dataId = TIER_TO_DATA_ID[tierId];
          if (!dataId || !targetQty || targetQty <= 0) return Promise.resolve();

          const plus10 = document.querySelector(`.stepBtn.btnPlus10[data-id="${dataId}"]`);
          const plus1 = document.querySelector(`.stepBtn.btnPlus1[data-id="${dataId}"]`);
          if (!plus10 && !plus1) {
            const slider = document.getElementById('playerArmy' + dataId);
            if (slider) { slider.value = targetQty; slider.dispatchEvent(new Event('input', { bubbles: true })); }
            return Promise.resolve();
          }

          let remaining = targetQty;
          const clicks = [];
          while (remaining >= 10 && plus10) { clicks.push(plus10); remaining -= 10; }
          while (remaining >= 1 && plus1) { clicks.push(plus1); remaining -= 1; }

          return new Promise(resolve => {
            let i = 0;
            function nextClick() {
              if (i >= clicks.length) { resolve(); return; }
              clicks[i].click();
              i++;
              botSetTimeout(nextClick, 80 + Math.floor(Math.random() * 120));
            }
            nextClick();
          });
        }

        const tierOrder = Object.entries(useQtys).filter(([,v]) => v > 0);
        let sliderIdx = 0;
        function setNextSlider() {
          if (sliderIdx >= tierOrder.length) {
            botSetTimeout(doFight, 400 + Math.floor(Math.random() * 400));
            return;
          }
          const [tid, qty] = tierOrder[sliderIdx];
          sliderIdx++;
          clickSliderTo(tid, qty).then(() => {
            botSetTimeout(setNextSlider, 200 + Math.floor(Math.random() * 500));
          });
        }

        function doFight() {
          const fightBtn = document.getElementById('fightBtn');
          if (fightBtn && !fightBtn.classList.contains('entryLocked')) {
            botLog('info', `Ruins: Attacking layer ${level}`);
            state.ruinsAttackTimes[level] = now;
            state.ruinsState = 'fighting';
            state.ruinsLastBattle = {
              level: level, enemy: enemyQtys, formation: { ...useQtys },
              source: source, timestamp: now, maxUnitsBeforeFight: { ...maxUnits },
            };
            saveState(state);
            botSetTimeout(() => { fightBtn.click(); }, randomDelay(300, 800));
          } else {
            botLog('warn', `Ruins layer ${level}: fightBtn locked, skipping`);
            state.ruinsCurrentIdx++;
            saveState(state);
            botSetTimeout(() => botTick(state, settings), randomDelay(1000, 2000));
          }
        }

        setNextSlider();
      }

      // ── Bail out: no winner found ──
      function handleNoWinner() {
        if (settings.ruinsStopNoWin) {
          botLog('warn', `⛔ STOP — Layer ${level}: no winning formation!`);
          botLog('warn', 'Ruins Bot stopped. Replenish units or add preset.');
          settings.ruinsEnabled = false;
          saveSettings(settings);
          state.ruinsState = 'done';
          saveState(state);
          updateRuinsUI(settings, state);
        } else {
          botLog('warn', `Layer ${level}: No formation found, skipping`);
          state.ruinsCurrentIdx++;
          saveState(state);
          botSetTimeout(() => botTick(state, settings), randomDelay(1000, 2000));
        }
      }

      sGet([SK('ruinsPresets')], r => {
        const presets = r[SK('ruinsPresets')] || {};
        const levelPresets = presets[String(level)] || [];
        const match = levelPresets.find(p => p.enemy === fp);

        // v1.6.2 — Manual override: ignore presets, always use optimizer
        if (match && settings.ruinsIgnorePresets) {
          botLog('info', `Preset match for layer ${level} ignored (Ignore-Presets is ON) → optimizer`);
        }

        // v1.6.2 — Auto-fallback: if preset uses a tier the player has NOT unlocked,
        //         skip the preset and let the optimizer find a workable formation.
        //         Stopping here makes no sense — the player physically cannot have
        //         those units. Common case: imported/shared preset references T6+.
        let lockedTierInPreset = false;
        if (match && !settings.ruinsIgnorePresets) {
          const unlockedList = (settings.ruinsAllyUnlocks && settings.ruinsAllyUnlocks.length)
            ? settings.ruinsAllyUnlocks : ['T1','T2','T3','T4','T5','T6'];
          const lockedTiers = Object.keys(match.formation).filter(tid => unlockedList.indexOf(tid) < 0);
          if (lockedTiers.length) {
            lockedTierInPreset = true;
            botLog('warn', `Preset for layer ${level} requires locked tier(s) [${lockedTiers.join(',')}] → skipping preset, using optimizer`);
          }
        }

        // ── Path A: exact preset match — original behaviour ──
        if (match && !settings.ruinsIgnorePresets && !lockedTierInPreset) {
          const useQtys = {};
          let presetShort = false;
          for (const [tid, qty] of Object.entries(match.formation)) {
            const avail = maxUnits[tid] || 0;
            useQtys[tid] = Math.min(qty, avail);
            if (avail < qty) presetShort = true;
          }
          if (presetShort && settings.ruinsStopPresetShort) {
            const needed = Object.entries(match.formation).map(([k,v]) => `${k}:${v}`).join(', ');
            const have = Object.entries(match.formation).map(([k,v]) => `${k}:${maxUnits[k]||0}`).join(', ');
            botLog('warn', `⛔ STOP — Preset requires [${needed}] but you have [${have}]`);
            botLog('warn', 'Ruins Bot stopped — not enough for preset. Replenish units and restart.');
            settings.ruinsEnabled = false;
            saveSettings(settings);
            state.ruinsState = 'done';
            saveState(state);
            updateRuinsUI(settings, state);
            return;
          }
          botLog('ok', `Preset found for layer ${level}: ${qtyToString(useQtys)}`);
          proceedWithFormation(useQtys, 'PRESET');
          return;
        }

        // ── Path B: optimizer (no exact match) ──
        // 1) Resolve Kill E3 R1 T4-short safety
        let useKillE3 = !!settings.ruinsOptStratKillE3;
        const unlocked = (settings.ruinsAllyUnlocks && settings.ruinsAllyUnlocks.length)
          ? settings.ruinsAllyUnlocks : ['T1','T2','T3','T4','T5','T6'];
        if (useKillE3) {
          if (unlocked.indexOf('T4') < 0) {
            botLog('warn', 'Kill E3 R1 requested but T4 is locked → disabling for this battle');
            useKillE3 = false;
          } else {
            const minT4 = (window.BFPresets && typeof window.BFPresets.calculateAutoT4 === 'function')
              ? window.BFPresets.calculateAutoT4(enemyQtys)
              : 0;
            const haveT4 = maxUnits['T4'] || 0;
            if (haveT4 < minT4) {
              const action = settings.ruinsT4ShortAction || 'stop';
              botLog('warn', `T4 short for Kill E3 R1: need ≥${minT4}, have ${haveT4} → action=${action}`);
              if (action === 'stop') {
                botLog('warn', `⛔ STOP — T4 short for Kill E3 R1 (need ${minT4}, have ${haveT4}). Train T4 and restart.`);
                settings.ruinsEnabled = false;
                saveSettings(settings);
                state.ruinsState = 'done';
                saveState(state);
                updateRuinsUI(settings, state);
                return;
              } else if (action === 'wait') {
                const waitMin = settings.ruinsT4WaitMin || 10;
                botLog('info', `⏱ Waiting ${waitMin} min for T4 training (need ${minT4}, have ${haveT4})…`);
                state.ruinsState = 'waiting_training';
                saveState(state);
                updateRuinsUI(settings, state);
                // Fetch army state for log visibility (best-effort)
                fetchArmyState(() => {});
                // Schedule reload of same ruins page so slider maxes refresh
                botSetTimeout(() => {
                  if (_centralStopActive) return;
                  window.location.href = BASE + '/ancestral/show/' + level;
                }, waitMin * 60 * 1000);
                return;
              } else {
                // 'continue' — drop strategy for this battle only
                useKillE3 = false;
              }
            }
          }
        }

        // 2) Build warm-start ranges based on settings
        const wsSource = settings.ruinsWarmStartSource || 'none';
        const wsRange  = settings.ruinsWarmStartRange || 15;
        let warmStart = null;
        let warmStartLabel = '';
        try {
          if (wsSource === 'smart' && window.BFPresets) {
            const smartCache = window.BFPresets.getCached();
            if (smartCache) {
              const smartPreset = smartCache[String(level)];
              if (smartPreset) {
                const ranges = window.BFPresets.buildRangesFromPreset(smartPreset, {
                  range: wsRange, enemyQtys: enemyQtys, stratKillE3: useKillE3,
                });
                warmStart = ranges;
                warmStartLabel = ' [warm: smart]';
              }
            }
          } else if (wsSource === 'preset') {
            // Strict layer match — any preset for this exact level becomes the warm-start template.
            const anyPreset = findAnyRuinsPresetForLayer(presets, level);
            if (anyPreset) {
              warmStart = buildRangesFromRuinsPreset(anyPreset.formation, wsRange);
              warmStartLabel = ' [warm: preset L' + level + ']';
            }
          }
        } catch (e) {
          botLog('warn', 'Warm-start build error: ' + (e && e.message ? e.message : e));
          warmStart = null;
        }

        const maxStr = Object.entries(maxUnits).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ');
        const modeLabel = (settings.ruinsOptMode === 'fast' ? 'fast' : 'deep')
          + (settings.ruinsOptParallel ? '/parallel' : '/single');
        botLog('info', `No exact preset for L${level} (${fp}), simulating${warmStartLabel} mode=${modeLabel}… [${maxStr}] PL:${powerLimit}`);

        const optOpts = {
          unlockedAllyIds: unlocked,
          mode: settings.ruinsOptMode === 'fast' ? 'fast' : 'deep',
          stratKillE3: useKillE3,
          warmStart: warmStart,
        };

        function onOptimizerResult(useQtys, source) {
          if (!useQtys) { handleNoWinner(); return; }
          const finalSource = warmStart ? (source + '+WARM') : source;
          proceedWithFormation(useQtys, finalSource);
        }

        if (settings.ruinsOptParallel !== false) {
          findBestFormationParallel(enemyQtys, maxUnits, powerLimit, optOpts, onOptimizerResult);
        } else {
          const r = findBestFormation(enemyQtys, maxUnits, powerLimit, optOpts);
          onOptimizerResult(r, optOpts.mode === 'fast' ? 'FAST-ST' : 'DEEP-ST');
        }
      });
      return;
    }
  }

  // ── STORY TICK ─────────────────────────────────────────────
  function storyTick(state, settings) {
    if (_centralStopActive) return;
    const ap = readAP();
    const hp = readHP();
    const hpPct = getHPPercent();

    // Load decision matrix (merge pretrained + user learned)
    const matrix = state.storyMatrix || [...PRETRAINED_DECISIONS];

    // Build story settings object for the decision algorithm
    const storySettings = {
      priority: settings.storyPriority || 'gold',
      whitelist: settings.storyWhitelist || [],
      blacklist: settings.storyBlacklist || [],
      option42Enabled: settings.storyOption42Enabled,
      stayAliveMode: settings.storyStayAliveMode || 'pct',
      option42MinHP: settings.storyOption42MinHP || 20000,
      option42MinHPPct: settings.storyOption42MinHPPct || 50,
    };

    // ── STAY ALIVE CHECK ──────────────────────────────────────
    if (settings.storyStayAlive) {
      let shouldPause = false;
      let isRecovering = state.storyRecovering || false;

      if (settings.storyStayAliveMode === 'fixed') {
        if (hp.current !== null && hp.current <= settings.storyPauseAtHP) shouldPause = true;
        if (isRecovering && hp.current !== null && hp.current < settings.storyResumeAtHP) shouldPause = true;
      } else {
        if (hpPct !== null && hpPct <= settings.storyPauseAtPct) shouldPause = true;
        if (isRecovering && hpPct !== null && hpPct < settings.storyResumeAtPct) shouldPause = true;
      }

      if (shouldPause) {
        state.storyRecovering = true;
        saveState(state);

        if (settings.storyStayAliveMode === 'fixed') {
          botLog('warn', `Story PAUSE — HP: ${hp.current?.toLocaleString()} < ${settings.storyResumeAtHP.toLocaleString()}`);
        } else {
          botLog('warn', `Story PAUSE — HP: ${hpPct}% < ${settings.storyResumeAtPct}%`);
        }

        // Church healing
        if (settings.storyChurch && !isChurchPage()) {
          if (!settings.storyChurchOverAP || (ap.current !== null && ap.current >= 1)) {
            botLog('info', 'Navigating to church for healing...');
            botSetTimeout(() => { window.location.href = BASE + '/city/church'; }, randomDelay(1500, 3000));
            return;
          }
        }

        // Wait and re-check
        const waitTime = randomDelay(10000, 20000);
        botLog('info', `Waiting for regeneration... (next check ~${Math.round(waitTime/1000)}s)`);
        botSetTimeout(() => {
          loadState(st => {
            loadSettings(se => {
              if (se.storyEnabled) storyTick(st, se);
            });
          });
        }, waitTime);
        return;
      } else if (isRecovering) {
        // HP recovered — resume
        state.storyRecovering = false;
        saveState(state);
        botLog('ok', 'HP recovered → Continuing story');
      }
    }

    // ── HEALING PRIORITY SWITCH ──────────────────────────────
    if (settings.storyHealPriorityPct > 0 && hpPct !== null) {
      if (hpPct < settings.storyHealPriorityPct && !state.storyHealingPriority) {
        state.storyHealingPriority = true;
        saveState(state);
        botLog('info', `HP ${hpPct}% < ${settings.storyHealPriorityPct}% → Switching priority to Health`);
        storySettings.priority = 'health';
      } else if (hpPct >= settings.storyHealBackPct && state.storyHealingPriority) {
        state.storyHealingPriority = false;
        saveState(state);
        botLog('info', `HP ${hpPct}% ≥ ${settings.storyHealBackPct}% → Priority back to: ${settings.storyPriority}`);
      } else if (state.storyHealingPriority) {
        storySettings.priority = 'health';
      }
    }

    // ── ON CHURCH PAGE ────────────────────────────────────────
    if (isChurchPage()) {
      // Try to heal
      const healBtn = document.querySelector('a[href*="/city/church/heal"], .btn[href*="church/heal"], input[type="submit"]');
      if (healBtn) {
        botLog('info', 'Healing at church...');
        botSetTimeout(() => {
          healBtn.click ? healBtn.click() : (window.location.href = healBtn.href || BASE + '/city/church/heal');
        }, randomDelay(500, 1200));
        return;
      }
      // After healing, navigate to adventure
      botSetTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(1000, 2000));
      return;
    }

    // ── ON STORY PAGE — START QUEST ───────────────────────────
    if (isStoryStartPage()) {
      state.storyState = 'active';
      saveState(state);

      // Check AP >= 3 (minimum for story)
      if (ap.current !== null && ap.current < 3) {
        botLog('warn', `AP: ${ap.current}/3 — not enough for story`);
        state.storyState = 'waiting_ap';
        saveState(state);
        updateStoryUI(settings, state);
        botSetTimeout(() => {
          loadState(st => {
            loadSettings(se => {
              if (se.storyEnabled) storyTick(st, se);
            });
          });
        }, randomDelay(30000, 60000));
        return;
      }

      botLog('info', 'Starting story quest...');
      botSetTimeout(() => { window.location.href = BASE + '/city/adventure/startquest'; }, randomDelay(800, 2000));
      return;
    }

    // ── ON STORY PAGE — MAKE DECISION ─────────────────────────
    if (isStoryDecisionPage()) {
      const decisions = parseStoryDecisions();
      const progress = parseStoryProgress();
      const location = parseStoryLocation();

      if (progress.current !== null) {
        state.storyProgress = progress;
        state.storyLocation = location;
        saveState(state);
      }

      const statusText = `Story ${progress.current?.toLocaleString() || '?'}/${progress.total?.toLocaleString() || '?'}` +
        (location ? ` - ${location}` : '');
      botLog('info', statusText);
      updateStoryUI(settings, state);

      if (!decisions.length) {
        botLog('warn', 'No decisions on the page');
        botSetTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(2000, 4000));
        return;
      }

      // Choose best decision
      const chosen = chooseStoryDecision(decisions, storySettings, matrix);
      if (!chosen) {
        botLog('err', 'Failed to select decision');
        return;
      }

      // Log all decisions with the chosen one highlighted
      const logDecisions = decisions.map(d =>
        d.id === chosen.id
          ? `[${d.id}] ${d.text} ◄◄`
          : `[${d.id}] ${d.text}`
      ).join(' | ');
      botLog('ok', `Rozhodnutie #${chosen.id}: ${chosen.text}`);

      // Update matrix — track which decisions we're choosing
      let row = matrix.find(r => r[0] === chosen.id);
      if (row) {
        row[3] = (row[3] || 0) + 1;
      } else {
        matrix.push([chosen.id, 0, 0, 1, 0, 0, 0, 0, 0]);
      }
      state.storyMatrix = matrix;
      state.storyLastDecision = chosen.id;
      state.storyState = 'active';
      saveState(state);

      // Navigate to decision
      botSetTimeout(() => {
        window.location.href = BASE + '/city/adventure/decision/' + chosen.id;
      }, randomDelay(800, 2200));
      return;
    }

    // ── ON WORKING PAGE ───────────────────────────────────────
    if (isStoryWorkingPage()) {
      botLog('info', 'Story — quest is processing...');
      botSetTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.storyEnabled) storyTick(st, se);
          });
        });
      }, randomDelay(5000, 10000));
      return;
    }

    // ── ON STORY PAGE (general — might be result or continuation)
    if (isStoryPage()) {
      // Might be a result page or a continuation — just reload adventure
      botSetTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(1000, 2500));
      return;
    }

    // ── NOT ON STORY PAGE — NAVIGATE THERE ────────────────────
    if (state.storyState === 'idle' || state.storyState === 'active' || state.storyState === 'navigating') {
      if (!PAGE.includes('/city/adventure') && !isChurchPage()) {
        botLog('info', 'Navigating to story page...');
        state.storyState = 'navigating';
        saveState(state);
        botSetTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(600, 1500));
        return;
      }
    }

    // ── WAITING FOR AP ────────────────────────────────────────
    if (state.storyState === 'waiting_ap') {
      if (ap.current !== null && ap.current >= 3) {
        botLog('ok', 'AP recovered → Continuing story');
        state.storyState = 'active';
        saveState(state);
        botSetTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(1000, 2000));
        return;
      }
      const waitTime = randomDelay(30000, 60000);
      botLog('info', `Waiting for AP... (next check ~${Math.round(waitTime/1000)}s)`);
      botSetTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.storyEnabled) storyTick(st, se);
          });
        });
      }, waitTime);
    }
  }

  // ── AUTO RECRUIT ─────────────────────────────────────────────
  // v1.6.4 — Tally the percent split and update the small "Total: X%" label.
  //          Accepts any % value 0..100; total may legitimately be < 100 if
  //          the user wants to leave some BE unspent.
  function updateRecruitTotal() {
    let total = 0;
    document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
      total += parseInt(inp.value) || 0;
    });
    const el = document.getElementById('bf-recruit-total');
    if (el) {
      let msg, color;
      if (total === 100)      { msg = `Total: 100% ✓`;                              color = '#2ecc71'; }
      else if (total > 100)   { msg = `Total: ${total}% — over 100%, will overspend`; color = '#e74c3c'; }
      else if (total === 0)   { msg = `Total: 0% — set at least one tier`;            color = '#e0a030'; }
      else                    { msg = `Total: ${total}% — under 100%, leftover BE saved`; color = '#e0a030'; }
      el.textContent = msg;
      el.style.color = color;
    }
  }

  // v1.6.4 — Render live BE + per-tier queue/cooldown status inside the
  //          Auto Recruitment panel (separate from the Ruins-tab Army Status).
  //          Called after recruit ticks and from the Refresh button.
  function renderRecruitLiveStatus(army, beValue) {
    const el = document.getElementById('bf-recruit-live-status');
    if (!el) return;
    const be = (beValue !== null && beValue !== undefined) ? beValue : (readBE() || 0);
    if (!army) {
      el.innerHTML = `<div style="color:#5a7a4a">BE: <b style="color:#e74c3c">${be}</b> · <em>Army data unavailable</em></div>`;
      return;
    }
    const rows = [];
    rows.push(`<div style="color:#5a7a4a">BE: <b style="color:#e74c3c">${be.toLocaleString()}</b></div>`);
    let anyTier = false;
    for (let n = 1; n <= 8; n++) {
      const tid = 'T' + n;
      const owned = army.owned[tid];
      const cd    = army.cooldown[tid] || 0;
      const queue = army.queue[tid];
      if (owned == null && !queue && !cd) continue;
      anyTier = true;
      const queuePart = queue
        ? ` <span style="color:#9b59b6">+${queue.qty} ⏳</span>` +
          (queue.nextReadySec > 0 ? `<span style="color:#5a7a4a">(${formatSeconds(queue.nextReadySec)})</span>` : '')
        : '';
      const cdPart = cd > 0 ? ` <span style="color:#c0392b">${cd} ⏱</span>` : '';
      rows.push(`<div style="color:#aaa"><b style="color:#e0c068">${tid}</b>: ${owned || 0}${cdPart}${queuePart}</div>`);
    }
    if (!anyTier) rows.push(`<div style="color:#5a7a4a"><em>No tiers trained yet.</em></div>`);
    el.innerHTML = rows.join('');
  }

  // v1.6.4 — Refresh just the live-status block by fetching army state.
  function refreshRecruitLiveStatus() {
    const el = document.getElementById('bf-recruit-live-status');
    if (el) el.innerHTML = '<em style="color:#5a7a4a">Loading…</em>';
    _armyCache = null;
    fetchArmyState((data) => renderRecruitLiveStatus(data, readBE()));
  }

  // v1.6.4 — Build tier rows for the priority strategy. Each row has an
  //          enable checkbox + up/down reorder buttons. The order is held
  //          in settings.recruitPriority and edited via the reorder buttons
  //          (drag-and-drop is unreliable inside iframe-embedded panels).
  function renderRecruitPriorityRows(order, enabled) {
    const container = document.getElementById('bf-recruit-priority-list');
    if (!container) return;
    order = (order && order.length) ? order : TIER_ORDER_DEFAULT.slice();
    enabled = enabled || {};
    const html = order.map((tid, idx) => {
      const n = parseInt(String(tid).replace(/[^\d]/g, ''));
      if (!n || n < 1 || n > 8) return '';
      const cost = UNIT_COSTS[n] || 0;
      const checked = enabled[n] ? 'checked' : '';
      return `
        <div class="bf-recruit-prio-row" data-tier="${n}" style="display:flex;align-items:center;gap:6px;margin:2px 0;padding:2px 4px;background:rgba(60,40,40,0.2);border-radius:3px">
          <span style="color:#5a7a4a;font-size:0.55rem;min-width:14px;text-align:right">${idx + 1}.</span>
          <label class="bf-bot-checkbox" style="flex:1;margin:0">
            <input type="checkbox" class="bf-recruit-prio-en" data-tier="${n}" ${checked}>
            <span style="color:#e0c068;font-weight:bold">T${n}</span>
            <span style="color:#5a7a4a;font-size:0.55rem">(${cost} BE)</span>
          </label>
          <button class="bf-recruit-prio-up" data-idx="${idx}" title="Move up" style="background:none;border:1px solid #3a3a3a;color:#888;cursor:pointer;width:18px;height:18px;font-size:0.6rem;border-radius:2px">▲</button>
          <button class="bf-recruit-prio-dn" data-idx="${idx}" title="Move down" style="background:none;border:1px solid #3a3a3a;color:#888;cursor:pointer;width:18px;height:18px;font-size:0.6rem;border-radius:2px">▼</button>
        </div>`;
    }).join('');
    container.innerHTML = html;

    // Wire reorder buttons
    container.querySelectorAll('.bf-recruit-prio-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx);
        if (i <= 0) return;
        const arr = readPriorityOrderFromDOM();
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        const en = readEnabledTiersFromDOM();
        renderRecruitPriorityRows(arr, en);
      });
    });
    container.querySelectorAll('.bf-recruit-prio-dn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx);
        const arr = readPriorityOrderFromDOM();
        if (i >= arr.length - 1) return;
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        const en = readEnabledTiersFromDOM();
        renderRecruitPriorityRows(arr, en);
      });
    });
  }

  function readPriorityOrderFromDOM() {
    const rows = document.querySelectorAll('#bf-recruit-priority-list .bf-recruit-prio-row');
    const arr = [];
    rows.forEach(r => { const t = r.dataset.tier; if (t) arr.push('T' + t); });
    return arr.length ? arr : TIER_ORDER_DEFAULT.slice();
  }

  function readEnabledTiersFromDOM() {
    const en = {};
    document.querySelectorAll('.bf-recruit-prio-en').forEach(cb => {
      const t = parseInt(cb.dataset.tier);
      if (t) en[t] = !!cb.checked;
    });
    return en;
  }

  // v1.6.4 — Recruits unit batches in 10× then 1× clicks on /nourishing/index.
  //          When a recruit-N-AMOUNT button is .disabled (queue full / not
  //          enough BE), we skip that batch and continue. Optional `onDone`
  //          callback fires once all keys have been processed.
  function autoRecruit(formation, idx, keys, onDone) {
    if (idx >= keys.length) {
      botLog('ok', '⚔ Recruitment complete');
      if (typeof onDone === 'function') onDone();
      return;
    }
    const unitId = keys[idx];
    const qty = formation[unitId];

    // Recruit in batches of 10 then 1
    const tens = Math.floor(qty / 10);
    const ones = qty % 10;
    let calls = [];
    for (let i = 0; i < tens; i++) calls.push({ unitId, amount: 10 });
    for (let i = 0; i < ones; i++) calls.push({ unitId, amount: 1 });

    function doNext(ci) {
      if (ci >= calls.length) {
        botSetTimeout(() => autoRecruit(formation, idx + 1, keys, onDone), 500);
        return;
      }
      const c = calls[ci];
      const btn = document.getElementById('recruits-' + c.unitId + '-' + c.amount);
      if (btn && !btn.classList.contains('disabled')) {
        btn.click();
        botSetTimeout(() => doNext(ci + 1), randomDelay(300, 600));
      } else {
        // v1.6.4 — Button disabled likely means queue full OR BE was just spent
        // on the previous batch. Move to the next tier rather than spamming.
        botLog('warn', `⚔ Recruit T${c.unitId} x${c.amount} — button disabled (queue full / not enough BE)`);
        botSetTimeout(() => autoRecruit(formation, idx + 1, keys, onDone), 300);
      }
    }
    doNext(0);
  }

  // ── HELPERS ──────────────────────────────────────────────────
  function randomDelay(min, max) { return Math.floor(Math.random() * (max - min) + min); }

  const LOG_MAX = 50;
  let logEntries = [];

  function botLog(type, msg) {
    const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logEntries.push({ type, msg, ts });
    if (logEntries.length > LOG_MAX) logEntries.shift();
    updateLogUI();
    console.log(`[BF-Bot][${type}] ${msg}`);
    // Error dot tracking — detect known error patterns
    if (type === 'error' || (typeof msg === 'string' && /not found|waiting\.\.\.|failed|error|unknown/i.test(msg) && type !== 'info')) {
      setBotError(true);
    } else if (type === 'ok' || type === 'info') {
      // Clear error on successful actions
      if (_lastBotError) setBotError(false);
    }
  }

  function updateLogUI() {
    const logEl = document.getElementById('bf-bot-log');
    if (!logEl) return;
    logEl.innerHTML = logEntries.map(e =>
      `<div class="bf-log-entry"><span class="bf-log-time">${e.ts}</span> <span class="bf-log-${e.type}">${e.msg}</span></div>`
    ).reverse().join('');
  }

  // ── STATE PERSISTENCE ────────────────────────────────────────
  function saveState(state) {
    sSet({ [SK('state')]: state });
  }

  function loadState(cb) {
    sGet([SK('state')], (r) => {
      cb(r[SK('state')] || {
        huntState: 'idle',
        ruinsState: 'idle',
        extractionsThisSession: 0,
        orbWaitUntil: 0,
        ruinsCurrentIdx: 0,
        ruinsCurrentCycle: 1,
        ruinsAttackTimes: {},
        storyState: 'idle',
        storyMatrix: null,
        storyProgress: { current: null, total: null },
        storyLocation: null,
        storyRecovering: false,
        storyHealingPriority: false,
        storyLastDecision: null,
        // Grotto
        grottoState: 'idle',
        grottoCount: 0,
        // PvP
        pvpState: 'idle',
        pvpNextAttack: 0,
        pvpKills: 0,
        pvpDeaths: 0,
        // Henchman vs Henchman (v1.6.9)
        henchmanState: 'idle',
        henchmanNextAttack: 0,
        henchmanKills: 0,
        henchmanDeaths: 0,
        // Recruit
        recruitDoneThisExtraction: false,
        recruitLastCycle: 0,        // v1.6.4 — last time globalRecruitTick fired (ms)
        recruitNavigating: false,   // v1.6.5 — mid-cycle navigation flag (clears on /nourishing/ arrival)
        recruitLastNoTiersLog: 0,   // v1.6.5 — throttle for "no tiers enabled" warning
        recruitLastLowBeLog: 0,     // v1.6.5 — throttle for "BE too low" info log
        // Gifts
        giftsState: 'idle',
        giftsDBGOpened: 0,
        giftsPurpleOpened: 0,
        // Global
        goldNavigating: false,
        goldLastSpend: 0,
        graveyardWorking: false,
        graveyardWorkUntil: 0,
        // Inventory Discard (v1.6.13)
        invDiscardLastRun: 0,        // ms timestamp of last full scan cycle
        invDiscardLastAction: 0,     // ms timestamp of last discard click (anti-spam)
        invDiscardNavigating: false, // navigation flag (cleared on /profile arrival)
        invDiscardManualPending: false, // set true by "Run Now" button; one-shot bypass of schedule gate
        invDiscardTotalCount: 0,     // lifetime number of items discarded
        invDiscardSessionCount: 0,   // count for current manual run (reset on each manual trigger)
      });
    });
  }

  function loadSettings(cb) {
    sGet([SK('settings')], (r) => {
      const s = r[SK('settings')] || {};
      const merged = Object.assign({}, DEFAULT_SETTINGS, s);
      // ── Migration step 1 (v1.6.7) — legacy scheduleIntervals → scheduleSlots
      if (Array.isArray(merged.scheduleIntervals) && (!Array.isArray(merged.scheduleSlots) || merged.scheduleSlots.length === 0)) {
        merged.scheduleSlots = merged.scheduleIntervals
          .filter(it => it && it.start && it.end)
          .map(it => {
            const [sh, sm] = String(it.start).split(':').map(n => parseInt(n) || 0);
            const [eh, em] = String(it.end).split(':').map(n => parseInt(n) || 0);
            return {
              id: newScheduleSlotId(),
              enabled: !!it.enabled,
              startH: sh|0, startM: sm|0,
              endH: eh|0, endM: em|0,
              actions: { hunt:false, story:false, pvp:false, henchman:false, ruins:false, grotto:false, invdisc:false }
            };
          });
        merged.scheduleIntervals = undefined;
      }
      // ── Migration step 2 (v1.6.8) — flat scheduleSlots → scheduleLayouts
      if (!Array.isArray(merged.scheduleLayouts) || merged.scheduleLayouts.length === 0) {
        const defaultLayout = {
          id: newScheduleLayoutId(),
          name: 'Default',
          slots: Array.isArray(merged.scheduleSlots) ? merged.scheduleSlots : []
        };
        merged.scheduleLayouts = [defaultLayout];
        merged.scheduleActiveLayoutId = defaultLayout.id;
        merged.scheduleSlots = undefined; // archived inside the layout
      } else if (Array.isArray(merged.scheduleSlots) && merged.scheduleSlots.length > 0) {
        // Defensive: layouts already exist but a stray scheduleSlots remained.
        // Don't lose those slots — append them to the first layout, then clear.
        if (!Array.isArray(merged.scheduleLayouts[0].slots)) merged.scheduleLayouts[0].slots = [];
        merged.scheduleLayouts[0].slots.push(...merged.scheduleSlots);
        merged.scheduleSlots = undefined;
      }
      // Self-heal active layout id
      if (!merged.scheduleActiveLayoutId || !merged.scheduleLayouts.some(l => l.id === merged.scheduleActiveLayoutId)) {
        merged.scheduleActiveLayoutId = merged.scheduleLayouts[0]?.id || null;
      }
      // Defensive defaults for layout shape
      merged.scheduleLayouts.forEach(l => {
        if (!Array.isArray(l.slots)) l.slots = [];
        if (typeof l.name !== 'string' || !l.name) l.name = 'Layout';
      });

      // ── Migration step 3 (v1.6.14) — extend slot `actions` with `henchman`
      // and `invdisc`. For backward compatibility:
      //   • `henchman` defaults to the current `pvp` flag (preserves pre-v1.6.14
      //     behaviour where Henchman implicitly piggy-backed on the pvp slot).
      //   • `invdisc`  defaults to false (opt-in for new schedule integration).
      // Idempotent: only fills in undefined keys, never overwrites existing ones.
      merged.scheduleLayouts.forEach(l => {
        l.slots.forEach(sl => {
          if (!sl.actions || typeof sl.actions !== 'object') {
            sl.actions = { hunt:false, story:false, pvp:false, henchman:false, ruins:false, grotto:false, invdisc:false };
            return;
          }
          if (typeof sl.actions.henchman === 'undefined') sl.actions.henchman = !!sl.actions.pvp;
          if (typeof sl.actions.invdisc  === 'undefined') sl.actions.invdisc  = false;
        });
      });

      cb(merged);
    });
  }

  function saveSettings(settings) {
    sSet({ [SK('settings')]: settings });
  }

  // ═══════════════════════════════════════════════════════════════
  // SCHEDULE ENGINE (v1.6.7) — BK-style dynamic slots with actions
  // v1.6.14 — Added `henchman` (decoupled from pvp) and `invdisc` actions
  // ═══════════════════════════════════════════════════════════════
  // Slot shape:
  //   { id, enabled, startH, startM, endH, endM,
  //     actions: { hunt, story, pvp, henchman, ruins, grotto, invdisc } }
  //
  // Semantics:
  //   - scheduleEnabled = false → no effect (per-module toggles apply).
  //   - scheduleEnabled = true  → slot's `actions` flags FULLY OVERRIDE
  //     huntEnabled/storyEnabled/pvpEnabled/henchmanEnabled/ruinsEnabled/
  //     grottoEnabled/invDiscardEnabled during the slot's active window.
  //     Outside all slots → all seven OFF.
  //   - Overnight spans supported (e.g. 22:00 → 06:00).
  //   - startMin === endMin → 24h "always active" block.
  // ═══════════════════════════════════════════════════════════════

  function newScheduleSlotId() {
    return 'sch_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000);
  }

  function newScheduleLayoutId() {
    return 'lay_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000);
  }

  // ── LAYOUT HELPERS (v1.6.8) ─────────────────────────────────────
  // Slots are nested inside the active layout, so all read/write paths
  // go through these accessors.

  function getActiveScheduleLayout(settings) {
    if (!settings || !Array.isArray(settings.scheduleLayouts) || settings.scheduleLayouts.length === 0) return null;
    const id = settings.scheduleActiveLayoutId;
    return settings.scheduleLayouts.find(l => l.id === id) || settings.scheduleLayouts[0] || null;
  }

  function getActiveScheduleSlots(settings) {
    const lay = getActiveScheduleLayout(settings);
    return (lay && Array.isArray(lay.slots)) ? lay.slots : [];
  }

  function findActiveScheduleSlot(settings) {
    if (!settings || !settings.scheduleEnabled) return null;
    const slots = getActiveScheduleSlots(settings);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const slot of slots) {
      if (!slot || !slot.enabled) continue;
      const startMin = (slot.startH|0) * 60 + (slot.startM|0);
      const endMin   = (slot.endH|0)   * 60 + (slot.endM|0);
      if (startMin < endMin) {
        if (nowMin >= startMin && nowMin < endMin) return slot;
      } else if (startMin > endMin) {
        // Overnight wrap, e.g. 22:00 → 06:00
        if (nowMin >= startMin || nowMin < endMin) return slot;
      } else {
        // Equal → 24h block, always active
        return slot;
      }
    }
    return null;
  }

  // Returns a SHALLOW-CLONED settings with module-enable flags masked by
  // the currently-active schedule slot (or all-off if outside all slots).
  // When scheduleEnabled is false, returns the input unchanged.
  // v1.6.14 — Henchman now has its OWN slot action `a.henchman` (decoupled
  // from `a.pvp`). Existing slots are migrated so that `a.henchman` mirrors
  // `a.pvp` (preserving pre-v1.6.14 behavior). Inventory Cleanup is also
  // schedulable now via `a.invdisc`.
  //
  // PvP and Henchman remain mutually exclusive AT RUNTIME (henchman ticks
  // only when settings.pvpEnabled is false — see line ~1826). So a slot
  // with both pvp:true AND henchman:true → PvP wins, henchman is dormant.
  // Users wanting Henchman should uncheck pvp on that slot.
  function getEffectiveSettings(settings) {
    if (!settings || !settings.scheduleEnabled) return settings;
    const slot = findActiveScheduleSlot(settings);
    const eff = Object.assign({}, settings);
    if (!slot) {
      eff.huntEnabled       = false;
      eff.storyEnabled      = false;
      eff.pvpEnabled        = false;
      eff.henchmanEnabled   = false;
      eff.ruinsEnabled      = false;
      eff.grottoEnabled     = false;
      eff.invDiscardEnabled = false;
      eff._scheduleActiveSlotId = null;
    } else {
      const a = slot.actions || {};
      eff.huntEnabled       = !!a.hunt;
      eff.storyEnabled      = !!a.story;
      eff.pvpEnabled        = !!a.pvp;
      // Master toggle gate preserved: user must enable Henchman in main
      // panel; slot picks WHEN it runs.
      eff.henchmanEnabled   = !!a.henchman && !!settings.henchmanEnabled;
      eff.ruinsEnabled      = !!a.ruins;
      eff.grottoEnabled     = !!a.grotto;
      // Same gating model for Inventory Cleanup: master toggle + slot picker.
      eff.invDiscardEnabled = !!a.invdisc && !!settings.invDiscardEnabled;
      eff._scheduleActiveSlotId = slot.id;
    }
    return eff;
  }

  // ── SCHEDULE WATCHER — detects slot transitions and triggers botTick ──
  let _scheduleWatcherId = null;
  let _lastScheduleSlotId = '__init__'; // sentinel so first run logs current state

  function runScheduleCheck(reason) {
    if (_centralStopActive) return;
    loadSettings(se => {
      if (!se.scheduleEnabled) {
        if (_lastScheduleSlotId !== null) {
          _lastScheduleSlotId = null;
          renderScheduleStatus(se);
          updateStatusDot();
        }
        return;
      }
      const slot = findActiveScheduleSlot(se);
      const newId = slot ? slot.id : null;
      if (newId !== _lastScheduleSlotId) {
        const prevId = _lastScheduleSlotId;
        _lastScheduleSlotId = newId;
        if (newId) {
          const a = slot.actions || {};
          const labels = [];
          if (a.hunt)     labels.push('Hunt');
          if (a.story)    labels.push('Story');
          if (a.pvp)      labels.push('PvP');
          if (a.henchman) labels.push('Henchman');
          if (a.ruins)    labels.push('Ruins');
          if (a.grotto)   labels.push('Grotto');
          if (a.invdisc)  labels.push('Inv-Cleanup');
          botLog('info', `📅 Schedule: slot active → ${labels.length ? labels.join(' + ') : '(no actions selected)'}`);
          // When a slot becomes active, reset 'done' module states to 'idle'
          // so they restart fresh inside the new window.
          loadState(st => {
            let dirty = false;
            if (a.hunt     && st.huntState     === 'done') { st.huntState     = 'idle'; dirty = true; }
            if (a.ruins    && st.ruinsState    === 'done') { st.ruinsState    = 'idle'; dirty = true; }
            if (a.story    && st.storyState    === 'done') { st.storyState    = 'idle'; dirty = true; }
            if (a.grotto   && st.grottoState   === 'done') { st.grottoState   = 'idle'; dirty = true; }
            if (a.pvp      && st.pvpState      === 'done') { st.pvpState      = 'idle'; dirty = true; }
            // v1.6.14 — Henchman now has its own slot action (was: shared a.pvp)
            if (a.henchman && st.henchmanState === 'done') { st.henchmanState = 'idle'; dirty = true; }
            // a.invdisc has no 'done' state to reset — it's tick-based
            // with its own daily/weekly/custom interval gate.
            const kick = () => {
              renderScheduleStatus(se);
              updateStatusDot();
              botSetTimeout(() => {
                loadState(st2 => { loadSettings(se2 => { botTick(st2, se2); }); });
              }, randomDelay(800, 1800));
            };
            if (dirty) saveState(st, kick); else kick();
          });
        } else if (prevId !== '__init__') {
          botLog('info', '📅 Schedule: outside all slots — bots paused');
          renderScheduleStatus(se);
          updateStatusDot();
        } else {
          renderScheduleStatus(se);
          updateStatusDot();
        }
      } else {
        // Same slot, but refresh status text every tick anyway (cheap)
        renderScheduleStatus(se);
      }
    });
  }

  function startScheduleWatcher() {
    if (_scheduleWatcherId !== null) return; // already running
    // Re-run check every 30s. botSetInterval auto-cancels on Central STOP.
    _scheduleWatcherId = botSetInterval(() => runScheduleCheck('tick'), 30000);
    // Also run once immediately so status updates without waiting 30s.
    runScheduleCheck('start');
  }
  // expose so Central STOP release can re-arm if needed
  // (cancelAllBotTimers clears all timer IDs but the registry below tracks them)

  // ── UI: LAYOUT BAR ──────────────────────────────────────────────
  function renderLayoutBar(settings) {
    const sel = document.getElementById('bf-layout-sel');
    const delBtn = document.getElementById('bf-layout-del');
    if (!sel) return;
    const layouts = Array.isArray(settings.scheduleLayouts) ? settings.scheduleLayouts : [];
    const activeId = settings.scheduleActiveLayoutId;
    // Rebuild dropdown — escape angle brackets in names to be safe
    sel.innerHTML = layouts.map(l => {
      const safeName = String(l.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<option value="${l.id}"${l.id === activeId ? ' selected' : ''}>${safeName}</option>`;
    }).join('');
    if (delBtn) {
      const onlyOne = layouts.length <= 1;
      delBtn.disabled = onlyOne;
      delBtn.style.opacity = onlyOne ? '0.4' : '1';
      delBtn.style.cursor = onlyOne ? 'not-allowed' : 'pointer';
    }
  }

  // ── UI: SCHEDULE STATUS LINE ────────────────────────────────────
  function renderScheduleStatus(settings) {
    const el = document.getElementById('bf-schedule-status');
    if (!el) return;
    if (!settings || !settings.scheduleEnabled) {
      el.textContent = '--';
      el.style.color = '#7a9a6a';
      return;
    }
    const slot = findActiveScheduleSlot(settings);
    if (!slot) {
      el.innerHTML = '<span style="color:#888">○ Idle (no active slot)</span>';
      return;
    }
    const a = slot.actions || {};
    const labels = [];
    if (a.hunt)     labels.push('Hunt');
    if (a.story)    labels.push('Story');
    if (a.pvp)      labels.push('PvP');
    if (a.henchman) labels.push('Henchman');
    if (a.ruins)    labels.push('Ruins');
    if (a.grotto)   labels.push('Grotto');
    if (a.invdisc)  labels.push('Inv-Cleanup');
    const txt = labels.length ? labels.join(' + ') : '(none)';
    el.innerHTML = `<span style="color:#2ecc71">● Now: ${txt}</span>`;
  }

  // ── UI: SCHEDULE LIST RENDERER ──────────────────────────────────
  function renderScheduleList() {
    const list = document.getElementById('bf-schedule-list');
    if (!list) return;
    loadSettings(settings => {
      // Always refresh the layout bar in sync with the slot list — it may
      // have changed (add/delete/rename) and the dropdown needs to follow.
      renderLayoutBar(settings);
      const slots = getActiveScheduleSlots(settings);
      const active = findActiveScheduleSlot(settings);
      if (!slots.length) {
        list.innerHTML = '<div style="color:#7a9a6a;font-size:0.6rem;font-style:italic;padding:4px 0">No schedule slots — click "+ Add slot" below.</div>';
        renderScheduleStatus(settings);
        return;
      }
      const pad2 = n => String(n|0).padStart(2,'0');
      list.innerHTML = slots.map((slot, i) => {
        const isActive = settings.scheduleEnabled && active && active.id === slot.id;
        const borderColor = isActive ? '#2ecc71' : '#1a3a1a';
        const a = slot.actions || {};
        return `<div class="bf-sch-slot" data-idx="${i}" style="border:1px solid ${borderColor}">
          <div class="bf-sch-row1">
            <label class="bf-bot-checkbox" style="margin-bottom:0">
              <input type="checkbox" class="bf-sch-enabled" ${slot.enabled?'checked':''}>
            </label>
            <span class="bf-sch-lbl">Start</span>
            <input type="number" class="bf-bot-input bf-sch-sh" value="${pad2(slot.startH)}" min="0" max="23">
            <span>:</span>
            <input type="number" class="bf-bot-input bf-sch-sm" value="${pad2(slot.startM)}" min="0" max="59">
            <span class="bf-sch-lbl">End</span>
            <input type="number" class="bf-bot-input bf-sch-eh" value="${pad2(slot.endH)}" min="0" max="23">
            <span>:</span>
            <input type="number" class="bf-bot-input bf-sch-em" value="${pad2(slot.endM)}" min="0" max="59">
            <button type="button" class="bf-sch-del" title="Remove slot">✕</button>
          </div>
          <div class="bf-sch-row2">
            <span class="bf-sch-actions-lbl">Actions:</span>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="hunt"     ${a.hunt    ?'checked':''}> Hunt</label>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="story"    ${a.story   ?'checked':''}> Story</label>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="pvp"      ${a.pvp     ?'checked':''}> PvP</label>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="henchman" ${a.henchman?'checked':''} title="Henchman vs Henchman — runs only when PvP is unchecked on this slot (mutually exclusive at runtime)."> Henchman</label>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="ruins"    ${a.ruins   ?'checked':''}> Ruins</label>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="grotto"   ${a.grotto  ?'checked':''}> Grotto</label>
            <label class="bf-sch-act"><input type="checkbox" class="bf-sch-a" data-act="invdisc"  ${a.invdisc ?'checked':''} title="Inventory Cleanup — discards low-level drop items during this slot. Master toggle must be on."> Inv-Cleanup</label>
          </div>
        </div>`;
      }).join('');

      // Wire events per slot — load-modify-save on every edit so we always
      // win the race against the blanket global-panel `change` listener
      // (which fires saveGlobalSettings on any input change, including ours).
      list.querySelectorAll('.bf-sch-slot').forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);

        const patchSlot = (mutator) => {
          loadSettings(fresh => {
            const layout = getActiveScheduleLayout(fresh);
            if (!layout || !Array.isArray(layout.slots)) return;
            const sl = layout.slots[idx];
            if (!sl) return;
            mutator(sl);
            saveSettings(fresh);
            runScheduleCheck('edit');
          });
        };

        el.querySelector('.bf-sch-enabled')?.addEventListener('change', (e) => {
          e.stopPropagation();
          patchSlot(sl => { sl.enabled = e.target.checked; });
          // Re-render to update active-slot border highlighting
          setTimeout(renderScheduleList, 50);
        });
        const clampH = v => Math.max(0, Math.min(23, parseInt(v) || 0));
        const clampM = v => Math.max(0, Math.min(59, parseInt(v) || 0));
        el.querySelector('.bf-sch-sh')?.addEventListener('change', e => {
          e.stopPropagation();
          const v = clampH(e.target.value); e.target.value = String(v).padStart(2,'0');
          patchSlot(sl => { sl.startH = v; });
        });
        el.querySelector('.bf-sch-sm')?.addEventListener('change', e => {
          e.stopPropagation();
          const v = clampM(e.target.value); e.target.value = String(v).padStart(2,'0');
          patchSlot(sl => { sl.startM = v; });
        });
        el.querySelector('.bf-sch-eh')?.addEventListener('change', e => {
          e.stopPropagation();
          const v = clampH(e.target.value); e.target.value = String(v).padStart(2,'0');
          patchSlot(sl => { sl.endH = v; });
        });
        el.querySelector('.bf-sch-em')?.addEventListener('change', e => {
          e.stopPropagation();
          const v = clampM(e.target.value); e.target.value = String(v).padStart(2,'0');
          patchSlot(sl => { sl.endM = v; });
        });

        el.querySelectorAll('.bf-sch-a').forEach(cb => {
          cb.addEventListener('change', (e) => {
            e.stopPropagation();
            const actName = cb.dataset.act;
            patchSlot(sl => {
              if (!sl.actions) sl.actions = { hunt:false, story:false, pvp:false, henchman:false, ruins:false, grotto:false, invdisc:false };
              sl.actions[actName] = e.target.checked;
            });
          });
        });

        el.querySelector('.bf-sch-del')?.addEventListener('click', (e) => {
          e.stopPropagation();
          loadSettings(fresh => {
            const layout = getActiveScheduleLayout(fresh);
            if (!layout || !Array.isArray(layout.slots)) return;
            layout.slots.splice(idx, 1);
            saveSettings(fresh);
            runScheduleCheck('delete');
            renderScheduleList();
          });
        });
      });

      renderScheduleStatus(settings);
    });
  }

  // ── GLOBAL: GOLD SPENDING TICK ──────────────────────────────
  // Returns TRUE if it took an action (navigation/click), FALSE if no action needed
  function globalGoldTick(state, settings) {
    if (_centralStopActive) return false;
    if (!ctxOk()) return false;

    // Reset navigation flag when we arrive at target pages
    if (state.goldNavigating && (PAGE.includes('/profile') || isClanPage())) {
      state.goldNavigating = false;
      saveState(state);
    }

    const gold = readGold();
    if (gold === null || gold <= 0) return false;

    // Don't spend too often — cooldown 30 seconds between spends
    if (Date.now() - (state.goldLastSpend || 0) < 30000) return false;

    // Calculate spendable amount
    let keepAmount = 0;
    if (settings.goldKeep) keepAmount = settings.goldKeepAmount || 0;
    const spendable = gold - keepAmount;
    if (spendable <= 0) return false;

    // MODE 1: Spend on skills — navigate to profile page and find upgrade buttons
    if (settings.goldMode === 1) {
      const skills = settings.goldSkills || [];
      if (skills.length === 0) return false;
      
      // On profile page — look for skill upgrade links/buttons
      if (PAGE.includes('/profile')) {
        const skillTab = document.getElementById('skills_tab');
        if (!skillTab) return false;
        
        // Look for buy buttons that match our selected skills
        const buyLinks = skillTab.querySelectorAll('a.btn, a[href*="profile/index?s="]');
        for (const link of buyLinks) {
          const href = link.getAttribute('href') || '';
          for (const sk of skills) {
            if (href.includes('s=' + sk) || href.includes('s=' + sk.replace('_', ''))) {
              botLog('info', `💰 Gold: Training ${sk} (gold: ${gold.toLocaleString()})`);
              state.goldLastSpend = Date.now();
              state.goldNavigating = false;
              saveState(state);
              botSetTimeout(() => { window.location.href = link.href; }, randomDelay(800, 1500));
              return true;
            }
          }
        }
        return false; // Nothing to buy on profile
      }
      
      // Not on profile — navigate there
      if (!state.goldNavigating) {
        botLog('info', '💰 Gold: Navigating to profile for training');
        state.goldNavigating = true;
        saveState(state);
        botSetTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(1000, 2000));
        return true;
      }
      return false;
    }

    // MODE 2: Donate to clan
    if (settings.goldMode === 2) {
      const minDonate = settings.goldDonateMin || 10000;
      // v1.6.2 — Trigger rules:
      //   • Threshold trigger: when gold >= minDonate → donate (anti-raid protection)
      //   • Donate-all: when ON → donate regardless of threshold (aggressive idle mode)
      // Either way, the AMOUNT donated is always `spendable` (= gold - keep).
      // The min is a TRIGGER, not an amount cap.
      const thresholdMet = gold >= minDonate;
      const donateAll = !!settings.goldDonateAll;
      if (!thresholdMet && !donateAll) return false;

      if (isClanPage()) {
        const donateInput = document.querySelector('input[name="donation"]');
        const donateBtn = document.querySelector('input[name="donate"]');
        if (donateInput && donateBtn) {
          const amount = spendable; // ALWAYS donate everything above Keep
          if (amount <= 0) return false;
          donateInput.value = String(amount);
          const reason = thresholdMet ? `≥${minDonate.toLocaleString()} threshold` : 'donate-all mode';
          botLog('info', `💰 Gold: Donating ${amount.toLocaleString()} to clan (${reason})`);
          state.goldLastSpend = Date.now();
          state.goldNavigating = false;
          saveState(state);
          botSetTimeout(() => { donateBtn.click(); }, randomDelay(800, 1500));
          return true;
        }
        return false;
      }

      // Navigate to clan page
      if (!state.goldNavigating) {
        botLog('info', `💰 Gold: Navigating to clan for donation (${gold.toLocaleString()} on hand)`);
        state.goldNavigating = true;
        saveState(state);
        botSetTimeout(() => { window.location.href = BASE + '/clan'; }, randomDelay(1000, 2000));
        return true;
      }
      return false;
    }

    return false;
  }

  // ── GLOBAL: AUTO RECRUITMENT TICK (v1.6.5) ────────────────────
  // Returns TRUE if it took an action (navigation/click), FALSE if no action.
  //
  // v1.6.5 split this into two halves so a single recruit "cycle" can survive
  // a page navigation (a known bug in v1.6.4 — the cooldown was set BEFORE
  // navigating, so after the /nourishing/index reload the next tick was blocked
  // by the 60-second cooldown and the actual recruit step never ran).
  //
  // Flow:
  //   1. globalRecruitTick(state, settings) does all gating (cooldown, trigger,
  //      busy check). Decides whether to navigate or execute.
  //   2. recruitExecuteOnNourishingPage(state, settings, opts) does the actual
  //      parse/allocate/click work on the army page.
  //   3. When we initiate a navigation, we set state.recruitNavigating=true.
  //      On the next tick we see we're on /nourishing/index with that flag set,
  //      we clear it and execute *bypassing* the cooldown (it's the same cycle).
  //   4. Train-now manual button calls globalRecruitTick with skipGate=true so
  //      both the cooldown and the trigger checks are bypassed for that cycle.
  let _recruitRunning = false; // Re-entrancy guard while clicking buttons
  function globalRecruitTick(state, settings, opts) {
    opts = opts || {};
    if (_centralStopActive) return false;
    if (!ctxOk()) return false;
    if (_recruitRunning) return false;

    const now = Date.now();
    const minCycleMs = 60 * 1000;

    // ── Mid-cycle continuation ──────────────────────────────
    // If we initiated a navigation and arrived on /nourishing/index, this
    // is the *same* recruit cycle — execute the work without re-running gates.
    if (state.recruitNavigating && PAGE.includes('/nourishing/index')) {
      botLog('info', '⚔ Recruit: Arrived at Crimson Sanctuary — executing training');
      state.recruitNavigating = false;
      saveState(state);
      return recruitExecuteOnNourishingPage(state, settings, { trigger: settings.recruitTrigger });
    }

    // ── Gating (skipped on manual override) ────────────────
    if (!opts.skipGate) {
      // 60s cycle cooldown
      if (state.recruitLastCycle && (now - state.recruitLastCycle) < minCycleMs) return false;

      // v1.6.4 migration: legacy value 'every' is now called 'extraction'.
      let trigger = settings.recruitTrigger || 'idle';
      if (trigger === 'every') trigger = 'extraction';

      // Check if any main bot is "actively running" (not waiting/idle).
      const huntEnabled = !!settings.huntEnabled;
      const huntBusy = huntEnabled && state.huntState && state.huntState !== 'idle' && state.huntState !== 'done' && state.huntState !== 'waiting_orb';
      const ruinsBusy = !!settings.ruinsEnabled && state.ruinsState && state.ruinsState !== 'idle' && state.ruinsState !== 'done' && state.ruinsState !== 'waiting_training';
      const storyBusy = !!settings.storyEnabled && state.storyState && state.storyState !== 'idle' && state.storyState !== 'done' && state.storyState !== 'waiting_ap' && !state.storyRecovering;
      const grottoBusy = !!settings.grottoEnabled && state.grottoState && state.grottoState !== 'idle' && state.grottoState !== 'done';
      const pvpBusy = !!settings.pvpEnabled && state.pvpState && state.pvpState !== 'idle' && state.pvpState !== 'done' && state.pvpState !== 'waiting';
      const henchmanBusy = !!settings.henchmanEnabled && state.henchmanState && state.henchmanState !== 'idle' && state.henchmanState !== 'done' && state.henchmanState !== 'waiting';
      const anythingBusy = huntBusy || ruinsBusy || storyBusy || grottoBusy || pvpBusy || henchmanBusy;

      const be = readBE();
      let shouldRun = false;
      if (trigger === 'idle') {
        shouldRun = !anythingBusy;
      } else if (trigger === 'extraction') {
        shouldRun = !!state.extractionsThisSession && !state.recruitDoneThisExtraction;
      } else if (trigger === 'threshold') {
        const th = settings.recruitThreshold || 100;
        shouldRun = (be !== null && be >= th) || PAGE.includes('/nourishing/index');
      } else if (trigger === 'continuous') {
        shouldRun = true;
      }
      if (!shouldRun) return false;

      // Sanity: do we have any tiers enabled at all? Bail loudly if not so
      // the user knows why nothing is happening.
      const minTierCost = computeMinAffordableTierCost(settings);
      if (minTierCost === null) {
        // Log once per 5 minutes max to avoid spam
        if (!state.recruitLastNoTiersLog || (now - state.recruitLastNoTiersLog) > 5*60*1000) {
          botLog('warn', `⚔ Recruit: No tiers enabled (strategy=${settings.recruitStrategy || 'priority'}) — open the Hunt tab and check at least one tier`);
          state.recruitLastNoTiersLog = now;
          saveState(state);
        }
        return false;
      }

      // If we know BE and it's below the cheapest affordable tier (after reserve),
      // don't even bother navigating.
      if (be !== null) {
        const reserve = parseInt(settings.recruitReserveBE) || 0;
        if ((be - reserve) < minTierCost) {
          // Quiet bail — this happens often during normal play; only log occasionally.
          if (!state.recruitLastLowBeLog || (now - state.recruitLastLowBeLog) > 5*60*1000) {
            botLog('info', `⚔ Recruit: BE=${be}, reserve=${reserve}, cheapest tier costs ${minTierCost} — waiting for more BE`);
            state.recruitLastLowBeLog = now;
            saveState(state);
          }
          return false;
        }
      }
    }

    // ── On /nourishing/index already — execute directly ────
    if (PAGE.includes('/nourishing/index')) {
      return recruitExecuteOnNourishingPage(state, settings, { trigger: settings.recruitTrigger, manual: !!opts.skipGate });
    }

    // ── Else: initiate navigation. Mark cycle so the cooldown
    //    applies even if the navigation somehow fails. The
    //    arriving tick will see recruitNavigating=true and skip
    //    the cooldown to execute the work.
    botLog('info', '⚔ Recruit: Navigating to Crimson Sanctuary');
    state.recruitNavigating = true;
    state.recruitLastCycle = now;
    saveState(state);
    botSetTimeout(() => { window.location.href = BASE + '/nourishing/index'; }, randomDelay(1000, 2000));
    return true;
  }

  // Does the actual parse + allocate + click work on the /nourishing/index page.
  // Caller has already decided we should run; this function does not re-check
  // gates (the trigger / cooldown). It DOES update state.recruitLastCycle so
  // the next cycle is throttled.
  function recruitExecuteOnNourishingPage(state, settings, opts) {
    opts = opts || {};
    if (!isArmyPage()) {
      botLog('warn', '⚔ Recruit: Page is /nourishing/index but army view not detected — skipping');
      return false;
    }

    const now = Date.now();
    const be = readBE();
    const army = parseArmyStateFromDom(document);
    _armyCache = { ts: now, data: army };
    renderArmyStatus(army);
    renderRecruitLiveStatus(army, be);

    const beNow = (be !== null) ? be : 0;
    const reserve = parseInt(settings.recruitReserveBE) || 0;
    const spendBE = Math.max(0, beNow - reserve);
    if (spendBE <= 0) {
      botLog('info', `⚔ Recruit: BE=${beNow}, reserve=${reserve} — nothing to spend`);
      state.recruitLastCycle = now;
      saveState(state);
      return false;
    }

    const allocation = computeRecruitAllocation(settings, spendBE);
    const keys = Object.keys(allocation).filter(k => allocation[k] > 0);
    if (keys.length === 0) {
      botLog('warn', `⚔ Recruit: BE=${beNow} but allocation is empty — check strategy (${settings.recruitStrategy || 'priority'}) and tier checkboxes`);
      state.recruitLastCycle = now;
      saveState(state);
      return false;
    }

    botLog('ok', `⚔ Recruit: BE=${beNow} → ${keys.map(k => 'T' + k + '×' + allocation[k]).join(', ')}`);
    state.recruitLastCycle = now;
    if (opts.trigger === 'extraction' || opts.trigger === 'every') {
      state.recruitDoneThisExtraction = true;
    }
    saveState(state);
    _recruitRunning = true;
    autoRecruit(allocation, 0, keys, () => {
      _recruitRunning = false;
      // After clicking, refresh the army-status panel from live DOM.
      botSetTimeout(() => {
        const fresh = parseArmyStateFromDom(document);
        _armyCache = { ts: Date.now(), data: fresh };
        renderArmyStatus(fresh);
        renderRecruitLiveStatus(fresh, readBE());
      }, 500);
    });
    return true;
  }

  // Compute the cheapest BE cost across all enabled tiers in user's strategy.
  // Returns null if no tiers are enabled.
  function computeMinAffordableTierCost(settings) {
    const strat = settings.recruitStrategy || 'priority';
    let enabledTierIds = [];
    if (strat === 'percent') {
      const pct = settings.recruitPercent || {};
      for (let n = 1; n <= 8; n++) if ((parseInt(pct[n]) || 0) > 0) enabledTierIds.push(n);
    } else {
      const en = settings.recruitEnabledTiers || {};
      for (let n = 1; n <= 8; n++) if (en[n]) enabledTierIds.push(n);
    }
    if (enabledTierIds.length === 0) return null;
    return Math.min.apply(null, enabledTierIds.map(n => UNIT_COSTS[n] || 99999));
  }

  // Given spendable BE and user settings, return formation = { '1': qty, ... }.
  function computeRecruitAllocation(settings, spendBE) {
    const strat = settings.recruitStrategy || 'priority';
    const formation = {};

    if (strat === 'percent') {
      const pct = settings.recruitPercent || {};
      const totalPct = Object.values(pct).reduce((s, v) => s + (parseInt(v) || 0), 0);
      if (totalPct <= 0) return formation;
      for (let n = 1; n <= 8; n++) {
        const p = parseInt(pct[n]) || 0;
        if (p <= 0) continue;
        const allocBE = Math.floor(spendBE * p / 100);
        const cost = UNIT_COSTS[n];
        const qty = Math.floor(allocBE / cost);
        if (qty > 0) formation[String(n)] = qty;
      }
      return formation;
    }

    // Priority strategy: drain BE into priority order, only enabled tiers.
    const enabled = settings.recruitEnabledTiers || {};
    const orderArr = (settings.recruitPriority && settings.recruitPriority.length)
      ? settings.recruitPriority
      : TIER_ORDER_DEFAULT;
    let remaining = spendBE;
    for (const tid of orderArr) {
      const n = parseInt(String(tid).replace(/[^\d]/g, ''));
      if (!n || n < 1 || n > 8) continue;
      if (!enabled[n]) continue;
      const cost = UNIT_COSTS[n];
      if (remaining < cost) continue;
      const qty = Math.floor(remaining / cost);
      if (qty > 0) {
        formation[String(n)] = qty;
        remaining -= qty * cost;
      }
    }
    return formation;
  }

  // ── GLOBAL: GRAVEYARD TICK ─────────────────────────────────
  function graveyardTick(state, settings) {
    if (_centralStopActive) return;
    if (!ctxOk() || !settings.graveyardEnabled) return;

    const ap = readAP();
    const hpPct = getHPPercent();

    // Check conditions: work when AP is low OR HP is low
    const apLow = ap.current !== null && ap.current < (settings.graveyardMinAP || 5);
    const hpLow = hpPct !== null && hpPct < (settings.graveyardMinHP || 20);

    if (!apLow && !hpLow) return; // Conditions not met

    // If already working on graveyard, don't interrupt
    if (isGraveyardWorking()) {
      botLog('info', '🪦 Graveyard: Working...');
      return;
    }

    // On graveyard page — start work
    if (isGraveyardPage() && !isGraveyardWorking()) {
      const workSelect = document.querySelector('select[name="workDuration"]');
      const workBtn = document.querySelector('input[name="dowork"]');
      if (workSelect && workBtn) {
        // Determine work duration based on AP or HP condition
        const workHours = apLow ? (settings.graveyardWorkTimeAP || 2) : (settings.graveyardWorkTimeHP || 2);
        // workDuration values: 1=0:30, 2=1:00, 3=1:30, 4=2:00, 5=2:30, 6=3:00, 7=3:30, 8=4:00
        const durationValue = workHours * 2; // convert hours to option value (1h = 2)
        workSelect.value = String(Math.min(Math.max(durationValue, 1), 8));
        botLog('info', `🪦 Graveyard: Working ${workHours}h (${apLow ? 'low AP' : 'low HP'})`);
        state.graveyardWorking = true;
        state.graveyardWorkUntil = Date.now() + workHours * 3600000;
        saveState(state);
        botSetTimeout(() => { workBtn.click(); }, randomDelay(800, 1500));
        return;
      }
    }

    // Navigate to graveyard
    if (!isGraveyardPage()) {
      // Only navigate if no other bot is actively doing something
      const otherBusy = (settings.huntEnabled && state.huntState !== 'done' && state.huntState !== 'idle' && state.huntState !== 'waiting_orb') ||
                        (settings.grottoEnabled && (state.grottoState === 'navigating' || state.grottoState === 'fighting'));
      if (!otherBusy) {
        botLog('info', `🪦 Graveyard: Navigating (${apLow ? 'AP: ' + ap.current : 'HP: ' + hpPct + '%'})`);
        state.graveyardWorking = false;
        saveState(state);
        botSetTimeout(() => { window.location.href = BASE + '/city/graveyard'; }, randomDelay(1000, 2000));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ── INVENTORY DISCARD TICK (v1.6.13, schedule integration v1.6.14) ─
  // Auto-cleans the player's inventory by following the URL embedded in
  // each item's "Zahodiť/Discard" button onclick attribute. Detection is
  // language-independent: the marker is the literal string `discardItem`
  // inside the onclick (it's the JS feature key, not translated text).
  //
  // Schedule integration (v1.6.14): When scheduleEnabled is true, this
  // module respects the slot's `invdisc` action. `getEffectiveSettings`
  // masks `invDiscardEnabled` to false outside windows where invdisc is
  // checked, so this tick simply bails at the !settings.invDiscardEnabled
  // gate — no special-casing needed here.
  //
  // Item-level requirement is parsed from the cell's textContent using a
  // language-independent number-extraction pass that excludes:
  //   - parenthesized content (the inventory count "1 kus(ov)" etc.)
  //   - signed numbers (stat bonuses like +49 / -200)
  //   - numbers that are part of a price (thousands-separator with .)
  // The remaining bare integers leave exactly the level requirement
  // ("Predpoklady: úroveň N") in practice, regardless of UI language.
  //
  // Hard-coded item-type whitelist guards against the game adding a
  // discard button to elixirs/gifts in future updates.
  // ════════════════════════════════════════════════════════════════
  const INV_DISCARD_TYPES = new Set([1, 3, 4, 5, 6, 7, 8]);
  // 1=weapon, 3=helmet, 4=armor, 5=item, 6=gloves, 7=boots, 8=shield
  // EXCLUDED: 2=elixirs/potions, 11=gifts (never discard these even if a
  // discard button somehow appears on them).

  function _parseInventoryRow(td) {
    // Returns { name, count, level, discardUrl, itemType, itemId } or null
    if (!td) return null;
    const discardBtn = td.querySelector('a.btn[onclick*="discardItem"]');
    if (!discardBtn) return null;
    const onclick = discardBtn.getAttribute('onclick') || '';
    // buttonLeftAction can be quoted with ' or " — match both
    const urlMatch = onclick.match(/buttonLeftAction\s*:\s*['"]([^'"]+)['"]/);
    if (!urlMatch) return null;
    const discardUrl = urlMatch[1];
    const idMatch = discardUrl.match(/\/discardItem\/(\d+)\/(\d+)/);
    if (!idMatch) return null;
    const itemType = parseInt(idMatch[1]);
    const itemId = parseInt(idMatch[2]);
    if (!INV_DISCARD_TYPES.has(itemType)) return null; // hard whitelist

    // Name from <strong>
    const strong = td.querySelector('strong');
    const name = strong ? strong.textContent.trim() : '?';

    // Get text content for parsing
    const text = td.textContent || '';

    // Count: first integer inside FIRST parenthesized expression after the name.
    // Works for Slovak "1 kus(ov)", English "1 piece(s)", German "1 Stück", etc.
    let count = 1;
    const countMatch = text.match(/\(([^()]*?(?:\([^)]*\)[^()]*?)?)\)/);
    if (countMatch) {
      const inner = countMatch[1];
      const numMatch = inner.match(/(\d+)/);
      if (numMatch) count = parseInt(numMatch[1]);
    }

    // Strip parenthesized content iteratively for level extraction
    let stripped = text;
    let prev;
    do {
      prev = stripped;
      stripped = stripped.replace(/\([^()]*\)/g, ' ');
    } while (stripped !== prev);

    // Bare positive integers not preceded by +/-/. and not followed by .digit
    // (the lookbehind/lookahead reject signed stats and dot-separated prices).
    const numbers = [];
    const re = /(?<![+\-.\d])(\d+)(?!\.\d)/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      numbers.push(parseInt(m[1]));
    }
    // The LAST bare integer in the cell is the level requirement
    // ("Predpoklady: úroveň N" comes right before the buttons).
    const level = numbers.length > 0 ? numbers[numbers.length - 1] : 0;

    return { name, count, level, discardUrl, itemType, itemId };
  }

  function scanInventoryForDiscardable(maxLevel, minLevel) {
    // Returns list of parsed rows where level is within [minLevel, maxLevel].
    // Filters out anything outside the type whitelist (done in _parseInventoryRow).
    const out = [];
    const cells = document.querySelectorAll('#accordion td.inactive, #accordion td.active, #items td.inactive, #items td.active');
    for (const td of cells) {
      const row = _parseInventoryRow(td);
      if (!row) continue;
      if (row.level > maxLevel) continue;
      if (row.level < (minLevel || 0)) continue;
      out.push(row);
    }
    return out;
  }

  function _invDiscardIntervalMs(settings) {
    const freq = settings.invDiscardFrequency || 'daily';
    if (freq === 'daily')  return 24 * 60 * 60 * 1000;
    if (freq === 'weekly') return 7 * 24 * 60 * 60 * 1000;
    if (freq === 'custom') return Math.max(1, settings.invDiscardCustomHours || 12) * 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
  }

  function _invDiscardExpandAccordion() {
    // The inventory uses a jQuery accordion (#accordion). Sections may be
    // collapsed (display:none on the panel). querySelectorAll still finds
    // collapsed items in the DOM, so we don't STRICTLY need to expand — but
    // the in-page Discard buttons rely on showModal() which may want the
    // section visible. We navigate via direct URL so visibility is irrelevant
    // for the click itself; this is a noop kept for parity with gifts flow.
  }

  function inventoryDiscardTick(state, settings) {
    if (_centralStopActive) return false;
    if (!ctxOk()) return false;
    if (!settings.invDiscardEnabled) {
      // If the feature is disabled but a manual-pending flag is somehow set,
      // clear it (defensive — e.g. user toggled off mid-run).
      if (state.invDiscardManualPending) {
        state.invDiscardManualPending = false;
        saveState(state);
      }
      return false;
    }

    // Clear navigation flag once we arrive on profile
    if (state.invDiscardNavigating && PAGE.includes('/profile')) {
      state.invDiscardNavigating = false;
      saveState(state);
    }

    const now = Date.now();

    // Anti-spam between consecutive discard clicks (the game also reloads,
    // so this is mostly belt-and-suspenders against rapid re-ticks).
    const minSpacing = Math.max(800, settings.invDiscardDelayMs || 1500);
    if (now - (state.invDiscardLastAction || 0) < minSpacing) return false;

    // Schedule gate
    const isManualMode = (settings.invDiscardMode || 'manual') === 'manual';
    const manualPending = !!state.invDiscardManualPending;
    let scheduleAllowsRun = false;
    if (manualPending) {
      // "Run Now" was clicked — bypass schedule
      scheduleAllowsRun = true;
    } else if (!isManualMode) {
      // Auto mode: honor frequency
      const intervalMs = _invDiscardIntervalMs(settings);
      const lastRun = state.invDiscardLastRun || 0;
      if (now - lastRun >= intervalMs) scheduleAllowsRun = true;
    }
    if (!scheduleAllowsRun) return false;

    // On profile page — scan and discard
    if (PAGE.includes('/profile')) {
      _invDiscardExpandAccordion();
      const maxLevel = settings.invDiscardMaxLevel || 1000;
      const minLevel = settings.invDiscardMinLevel || 0;
      const items = scanInventoryForDiscardable(maxLevel, minLevel);
      if (items.length === 0) {
        // Run complete — nothing to discard
        const sessionN = state.invDiscardSessionCount || 0;
        if (manualPending) {
          if (sessionN === 0) {
            botLog('ok', `🗑 Inventory: Nothing to discard (max lvl ${maxLevel})`);
          } else {
            botLog('ok', `🗑 Inventory: Cleanup complete — ${sessionN} item(s) discarded`);
          }
          state.invDiscardManualPending = false;
        } else {
          if (sessionN > 0) {
            botLog('ok', `🗑 Inventory: Scheduled cleanup complete — ${sessionN} item(s) discarded`);
          }
        }
        state.invDiscardLastRun = now;
        state.invDiscardSessionCount = 0;
        saveState(state);
        _invDiscardRefreshUI(state, settings);
        return true; // we did finish a cycle
      }

      // Discard the first matched item
      const item = items[0];
      botLog('info', `🗑 Discarding "${item.name}" (type ${item.itemType}, lvl ${item.level}, ${item.count} pcs left, ${items.length - 1} more queued)`);
      state.invDiscardLastAction = now;
      state.invDiscardTotalCount = (state.invDiscardTotalCount || 0) + 1;
      state.invDiscardSessionCount = (state.invDiscardSessionCount || 0) + 1;
      saveState(state);
      _invDiscardRefreshUI(state, settings);
      const delay = Math.max(800, settings.invDiscardDelayMs || 1500);
      const jitter = Math.floor(delay * 0.4);
      botSetTimeout(() => { window.location.href = item.discardUrl; }, randomDelay(delay - jitter, delay + jitter));
      return true;
    }

    // Not on profile — navigate
    if (!state.invDiscardNavigating) {
      botLog('info', `🗑 Inventory Discard: Navigating to profile (${manualPending ? 'manual run' : 'scheduled'})`);
      state.invDiscardNavigating = true;
      saveState(state);
      botSetTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(800, 1500));
      return true;
    }
    return false;
  }

  function _invDiscardRefreshUI(state, settings) {
    // Updates the small status line under the Inventory Discard group.
    const el = document.getElementById('bf-invdisc-status');
    if (!el) return;
    const total = state.invDiscardTotalCount || 0;
    const session = state.invDiscardSessionCount || 0;
    const lastRun = state.invDiscardLastRun || 0;
    const lastStr = lastRun ? new Date(lastRun).toLocaleString() : 'never';
    let nextStr = '—';
    if ((settings.invDiscardMode || 'manual') === 'auto' && lastRun) {
      const nextAt = lastRun + _invDiscardIntervalMs(settings);
      nextStr = new Date(nextAt).toLocaleString();
    }
    let html = '';
    html += `<div>Total discarded: <b style="color:#2ecc71">${total}</b>`;
    if (session > 0) html += ` · this run: <b style="color:#e0a030">${session}</b>`;
    html += `</div>`;
    html += `<div>Last cycle: ${lastStr}</div>`;
    if ((settings.invDiscardMode || 'manual') === 'auto') {
      html += `<div>Next auto: ${nextStr}</div>`;
    }
    el.innerHTML = html;
  }

  // ── GIFTS BOT TICK ──────────────────────────────────────────
  function giftsTick(state, settings) {
    if (_centralStopActive) return;
    if (!ctxOk()) return;

    const ap = readAP();

    // ── DBG (Dark Blue Gifts = item 3) — auto open when AP is under threshold ──
    if (settings.giftsAutoDBG) {
      const apThreshold = settings.giftsDBGUnderAP || 5;
      if (ap.current !== null && ap.current <= apThreshold) {
        if (PAGE.includes('/profile')) {
          // Try to expand the Darčeky accordion section if collapsed
          expandGiftsAccordion();
          const dbgLink = findGiftLink(3); // 3 = dark blue
          if (dbgLink) {
            const qty = getGiftInventoryCount(3);
            if (qty > 0) {
              botLog('info', `🎁 DBG: Opening dark blue gift (${qty} remaining, AP: ${ap.current})`);
              state.giftsDBGOpened = (state.giftsDBGOpened || 0) + 1;
              saveState(state);
              botSetTimeout(() => { window.location.href = dbgLink.href; }, randomDelay(500, 1200));
              return;
            } else {
              botLog('warn', '🎁 DBG: No dark blue gifts in inventory');
            }
          } else {
            botLog('warn', '🎁 DBG: Dark blue gift link not found on page');
          }
        } else {
          // Navigate to profile
          botLog('info', '🎁 DBG: Navigating to profile to open gifts');
          botSetTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(800, 1500));
          return;
        }
      }
    }

    // ── Purple Gifts (item 2) — bot mode ──
    if (state.giftsState === 'running' && settings.giftsPurpleMode !== 'none') {
      const opened = state.giftsPurpleOpened || 0;

      // Check qty target
      if (settings.giftsPurpleMode === 'qty_target' && opened >= (settings.giftsPurpleQtyTarget || 10)) {
        botLog('ok', `🎁 Purple: Goal reached (${opened} opened)`);
        state.giftsState = 'done';
        saveState(state);
        updateGiftsUI(settings, state);
        return;
      }

      // Check gold target
      if (settings.giftsPurpleMode === 'gold_target') {
        const gold = readGold();
        if (gold !== null && gold >= (settings.giftsPurpleGoldTarget || 100000)) {
          botLog('ok', `🎁 Purple: Gold goal reached (${gold.toLocaleString()})`);
          state.giftsState = 'done';
          saveState(state);
          updateGiftsUI(settings, state);
          return;
        }
      }

      // Navigate to profile and open purple gift
      if (PAGE.includes('/profile')) {
        expandGiftsAccordion();
        const pgLink = findGiftLink(2); // 2 = purple
        if (pgLink) {
          const qty = getGiftInventoryCount(2);
          if (qty > 0) {
            botLog('info', `🎁 Purple: Opening purple gift #${opened + 1} (${qty} remaining)`);
            state.giftsPurpleOpened = opened + 1;
            saveState(state);
            botSetTimeout(() => { window.location.href = pgLink.href; }, getSpeedDelay(settings));
            return;
          } else {
            botLog('warn', '🎁 Purple: No purple gifts in inventory');
            state.giftsState = 'done';
            saveState(state);
            updateGiftsUI(settings, state);
            return;
          }
        } else {
          botLog('warn', '🎁 Purple: Purple gift link not found');
          state.giftsState = 'done';
          saveState(state);
          updateGiftsUI(settings, state);
          return;
        }
      } else {
        // Navigate to profile
        botLog('info', '🎁 Purple: Navigating to profile');
        botSetTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(800, 1500));
        return;
      }
    }
  }

  function expandGiftsAccordion() {
    // The gifts are inside a jQuery accordion. Try to click the "Darčeky" header to expand it.
    const accordionHeaders = document.querySelectorAll('#accordion h3 a, .accordion h3 a');
    for (const header of accordionHeaders) {
      // Language-independent: find the accordion header whose section contains gift links
      const section = header.nextElementSibling || header.parentElement;
      if (section && section.querySelector && section.querySelector('a[href*="useItem/11/"]')) {
        // Check if the section is collapsed (next sibling div is hidden)
        const section = header.closest('h3')?.nextElementSibling;
        if (section && (section.style.display === 'none' || !section.offsetHeight)) {
          header.click();
        }
        break;
      }
    }
  }

  // ── GROTTO BOT TICK ─────────────────────────────────────────
  function isGrottoPage() { return PAGE.includes('/city/grotte'); }
  function isGrottoResultPage() {
    // After fighting, the page shows a fight report with a "späť" link back to /city/grotte
    return PAGE.includes('/city/grotte') && (
      !!document.querySelector('a.btn[href*="/city/grotte"]') ||
      !!document.querySelector('.report, .reportTable') ||
      !!document.querySelector('.reportTable, #reportResult, #fighter_details_attacker, #fighter_details_defender')
    );
  }

  function grottoTick(state, settings) {
    if (_centralStopActive) return;
    if (!ctxOk() || !settings.grottoEnabled || state.grottoState === 'done') return;
    const hpPct = getHPPercent();

    // Check HP minimum
    if (hpPct !== null && hpPct < settings.grottoMinHP) {
      if (settings.grottoStayAlive) {
        if (settings.grottoStayAliveMode === 'church' && !isChurchPage()) {
          botLog('warn', `Grotto: HP ${hpPct}% < ${settings.grottoMinHP}% → Idem do kostola`);
          state.grottoState = 'healing';
          saveState(state);
          botSetTimeout(() => { window.location.href = BASE + '/city/church'; }, randomDelay(1000, 2000));
          return;
        }
      }
      botLog('warn', `Grotto: HP ${hpPct}% low → Waiting for regeneration`);
      botSetTimeout(() => { loadState(st => { loadSettings(se => { grottoTick(st, se); }); }); }, randomDelay(30000, 60000));
      return;
    }

    // Check count limit
    if (!settings.grottoPermanent && settings.grottoCount > 0 && (state.grottoCount || 0) >= settings.grottoCount) {
      botLog('ok', `Grotto: Completed ${state.grottoCount} demon hunts`);
      state.grottoState = 'done';
      settings.grottoEnabled = false;
      saveState(state);
      saveSettings(settings);
      updateGrottoUI(settings, state);
      return;
    }

    // On result page — log result, then go back to grotto
    if (isGrottoResultPage()) {
      botLog('info', `Grotto: Battle result #${state.grottoCount || 0} → Continuing`);
      // Navigate back to grotto page for next fight
      botSetTimeout(() => { window.location.href = BASE + '/city/grotte'; }, getSpeedDelay(settings));
      return;
    }

    // Navigate to grotto if not there
    if (!isGrottoPage()) {
      botLog('info', 'Grotto: Navigating → Grotto');
      state.grottoState = 'navigating';
      saveState(state);
      botSetTimeout(() => { window.location.href = BASE + '/city/grotte'; }, randomDelay(800, 1500));
      return;
    }

    // On grotto page — find and click difficulty button by INDEX (language-independent)
    // The grotto page always has 3 difficulty buttons in order: easy(0), medium(1), difficult(2)
    const diffIndexMap = { 'easy': 0, 'medium': 1, 'difficult': 2 };
    let diff = settings.grottoDifficulty || 'easy';
    // Stay alive: if HP close to min, switch to easier difficulty
    if (settings.grottoStayAlive && hpPct !== null && hpPct < settings.grottoMinHP * 1.2) {
      diff = settings.grottoSwitchDifficulty || 'easy';
    }
    const diffIndex = diffIndexMap[diff] ?? 0;
    const diffLabel = diff.charAt(0).toUpperCase() + diff.slice(1); // for logging only

    const buttons = document.querySelectorAll('input[name="difficulty"]');
    const targetBtn = buttons[diffIndex] || null;

    if (targetBtn) {
      state.grottoCount = (state.grottoCount || 0) + 1;
      state.grottoState = 'fighting';
      saveState(state);
      botLog('info', `Grotto: Demon hunt #${state.grottoCount} (${diffLabel}: "${targetBtn.value}")`);
      updateGrottoUI(settings, state);
      botSetTimeout(() => { targetBtn.click(); }, randomDelay(500, 1200));
    } else {
      botLog('warn', 'Grotto: Difficulty buttons not found on page, waiting...');
      botSetTimeout(() => {
        loadState(st => { loadSettings(se => { grottoTick(st, se); }); });
      }, randomDelay(5000, 10000));
    }
  }

  // ── PVP BOT TICK ─────────────────────────────────────────────
  // ── PvP HELPERS ──────────────────────────────────────────────
  // The /robbery/index page has TWO separate sections:
  //   #wolfHunting  → PvP forms (optionsearch, levelsearch, namesearch)
  //   #humanHunting → creature Hunt (doHunt → /robbery/humanhunt/X)
  // We need to submit the correct FORM for PvP, not navigate to humanhunt.

  function isPvPHuntPage() { return PAGE === '/robbery/index' || PAGE.includes('/robbery/index'); }

  function isPvPSearchResultPage() {
    // After submitting optionsearch/levelsearch/namesearch, game shows a player profile
    // with an attack button/link. The key difference from the main /robbery/index page:
    // - On search result: attack links present, no optionsearch/levelsearch forms
    // - On main page: optionsearch/levelsearch forms present
    if (!PAGE.includes('/robbery/') || PAGE.includes('/robbery/humanhunt')) return false;
    // DOM-based detection (language-independent): attack link or attack form
    if (document.querySelector('a[href*="/robbery/attack"], a[href*="robbery/dofight"], form[action*="robbery/attack"]')) return true;
    // Fallback: any submit button on a page without search forms = attack page
    if (!document.querySelector('input[name="optionsearch"]') &&
        !document.querySelector('input[name="levelsearch"]') &&
        document.querySelector('form input[type="submit"]')) {
      return true;
    }
    return false;
  }

  function isPvPBattleResultPage() {
    // After the actual PvP fight — shows win/loss report
    // CRITICAL: must NOT trigger on /robbery/index (which has "lost souls" text and PvP forms)
    if (!PAGE.includes('/robbery/') || PAGE.includes('/robbery/humanhunt')) return false;
    // If PvP search forms are present, this is the search page, NOT a result page
    if (document.querySelector('input[name="optionsearch"], input[name="levelsearch"], input[name="namesearch"]')) return false;
    // Definitive check: battle report table exists (language-independent)
    if (document.querySelector('.reportTable, #reportResult, #fighter_details_attacker, #fighter_details_defender')) return true;
    // Fallback text check with more specific patterns (avoid "won"/"lost" standalone)
    const bodyText = document.body.textContent || '';
    // Last resort text check — should rarely be needed since DOM checks above cover most cases
    return !!(bodyText.match(/reportResult|combatResult|fighter_details/i));
  }

  // Find the optionsearch form (PvP random search)
  function findPvPOptionSearchForm() {
    const forms = document.querySelectorAll('#wolfHunting form, form[action*="robbery/index"]');
    for (const form of forms) {
      if (form.querySelector('input[name="optionsearch"]')) return form;
    }
    return null;
  }

  // Find the levelsearch form (PvP by battle value range)
  function findPvPLevelSearchForm() {
    const forms = document.querySelectorAll('#wolfHunting form, form[action*="robbery/index"]');
    for (const form of forms) {
      if (form.querySelector('input[name="levelsearch"]')) return form;
    }
    return null;
  }

  // Find the namesearch form (PvP specific player by name)
  function findPvPNameSearchForm() {
    const forms = document.querySelectorAll('#wolfHunting form, form[action*="robbery/index"]');
    for (const form of forms) {
      if (form.querySelector('input[name="namesearch"]') && form.querySelector('input[type="text"]')) return form;
    }
    return null;
  }

  function pvpTick(state, settings) {
    if (_centralStopActive) return;
    if (!ctxOk() || !settings.pvpEnabled || state.pvpState === 'done') return;
    const hpPct = getHPPercent();
    const ap = readAP();

    // Check HP
    if (hpPct !== null && hpPct < settings.pvpMinHP) {
      botLog('warn', `PvP: HP ${hpPct}% < ${settings.pvpMinHP}% → Waiting`);
      botSetTimeout(() => { loadState(st => { loadSettings(se => { pvpTick(st, se); }); }); }, randomDelay(60000, 120000));
      return;
    }

    // Check AP — need at least 1 AP for PvP
    if (ap.current !== null && ap.current < 1) {
      botLog('warn', `PvP: AP ${ap.current} — not enough AP`);
      botSetTimeout(() => { loadState(st => { loadSettings(se => { pvpTick(st, se); }); }); }, randomDelay(60000, 120000));
      return;
    }

    // Smart break
    if (settings.pvpSmartBreak && state.pvpNextAttack > Date.now()) {
      const waitMs = state.pvpNextAttack - Date.now();
      botLog('info', `PvP: Smart break – Next attack in ${Math.ceil(waitMs/60000)} min`);
      botSetTimeout(() => { loadState(st => { loadSettings(se => { pvpTick(st, se); }); }); }, Math.min(waitMs + 1000, 300000));
      return;
    }

    // ── On battle result page — parse result and go back ──
    if (isPvPBattleResultPage()) {
      const bodyText = document.body.textContent || '';
      // Language-independent: detect win/loss from DOM structure
      const reportResult = document.querySelector('#reportResult, .reportResult, .combatResultHeader');
      const won = reportResult ? (
        reportResult.classList.contains('resultVictory') ||
        reportResult.classList.contains('won') ||
        !!reportResult.querySelector('.victory, img[src*="victory"], img[src*="win"]')
      ) : false;
      // Fallback: check for fighter_details ordering — attacker wins if their section has win indicators
      const wonFallback = !won && !!document.querySelector('.reportTable .winner, .report-winner');
      const isWin = won || wonFallback;
      if (isWin) state.pvpKills = (state.pvpKills || 0) + 1;
      else state.pvpDeaths = (state.pvpDeaths || 0) + 1;

      // Set next attack time if smart break
      if (settings.pvpSmartBreak) {
        const delay = (settings.pvpDelay + (Math.random() * 2 - 1) * settings.pvpMargin) * 60 * 1000;
        state.pvpNextAttack = Date.now() + Math.max(delay, 60000);
      }
      saveState(state);
      botLog(isWin ? 'ok' : 'warn', `PvP: ${isWin ? 'Win' : 'Loss'} (${state.pvpKills}W/${state.pvpDeaths}L)`);
      updatePvPUI(settings, state);

      // Navigate back to PvP page for next search
      botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, getSpeedDelay(settings));
      return;
    }

    // ── On search result page — found a player, click Attack ──
    if (isPvPSearchResultPage()) {
      // Look for attack button/link
      const attackLink = document.querySelector('a[href*="/robbery/attack"], a[href*="robbery/dofight"]');
      // Language-independent: find the attack form submit button by form action
      const attackForm = document.querySelector('form[action*="robbery/attack"], form[action*="robbery/dofight"]');
      const attackBtn = attackForm ? attackForm.querySelector('input[type="submit"], button[type="submit"]') : null;

      // Check whitelist — if the found player is whitelisted, skip
      // v1.6.10 — use token-based matcher so "Tomler" matches "Upír Tomler"
      // (regardless of server language).
      if (settings.pvpWhitelist) {
        const wl = settings.pvpWhitelist.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
        if (wl.length > 0) {
          const playerName = (document.querySelector('.reportTable td b, h2, .username, #profileName') || {}).textContent || '';
          if (matchPlayerByNameList(playerName, wl)) {
            botLog('info', `PvP: Player "${playerName.trim()}" is whitelisted → searching for another`);
            botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 2000));
            return;
          }
        }
      }

      if (attackLink) {
        state.pvpState = 'attacking';
        saveState(state);
        botLog('info', 'PvP: Found opponent → Attacking!');
        botSetTimeout(() => { attackLink.click(); }, randomDelay(500, 1200));
        return;
      }
      if (attackBtn) {
        state.pvpState = 'attacking';
        saveState(state);
        botLog('info', 'PvP: Found opponent → Attacking!');
        botSetTimeout(() => { attackBtn.click(); }, randomDelay(500, 1200));
        return;
      }

      // No attack button found — maybe no suitable opponent, go back
      botLog('warn', 'PvP: Attack button not found → searching again');
      botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1500, 3000));
      return;
    }

    // ── On /robbery/index — submit the correct PvP form ──
    if (isPvPHuntPage()) {

      // MODE 3: Blacklist — attack specific player by name
      if (settings.pvpMode === 3 || settings.pvpMode === '3') {
        const names = (settings.pvpBlacklist || '').split(',').map(n => n.trim()).filter(Boolean);
        if (names.length > 0) {
          const nameForm = findPvPNameSearchForm();
          if (nameForm) {
            const targetName = names[Math.floor(Math.random() * names.length)];
            const nameInput = nameForm.querySelector('input[type="text"]');
            if (nameInput) {
              nameInput.value = targetName;
              state.pvpState = 'hunting';
              saveState(state);
              botLog('info', `PvP: Searching for player "${targetName}" (namesearch)`);
              botSetTimeout(() => {
                const submitBtn = nameForm.querySelector('input[name="namesearch"][type="submit"], input[type="submit"], button[type="submit"]');
                if (submitBtn) submitBtn.click();
                else nameForm.submit();
              }, randomDelay(500, 1200));
              return;
            }
          }
          botLog('warn', 'PvP: Namesearch form not found');
        } else {
          botLog('warn', 'PvP: Blacklist is empty — enter player names');
        }
        return;
      }

      // MODE 4: Level search — by battle value range
      if (settings.pvpMode === 4 || settings.pvpMode === '4') {
        const levelForm = findPvPLevelSearchForm();
        if (levelForm) {
          // Set BV range inputs (lvlvon, lvlbis)
          const fromInput = levelForm.querySelector('input[name="lvlvon"]');
          const toInput = levelForm.querySelector('input[name="lvlbis"]');
          if (fromInput && settings.pvpBVFrom) fromInput.value = settings.pvpBVFrom;
          if (toInput && settings.pvpBVTo) toInput.value = settings.pvpBVTo;

          // Handle totemsearch checkbox
          const totemCb = levelForm.querySelector('input[name="totemsearch"]');
          if (totemCb) totemCb.checked = settings.pvpIncludeInactive !== false;

          state.pvpState = 'hunting';
          saveState(state);
          botLog('info', `PvP: Searching by BV ${fromInput?.value || '?'}–${toInput?.value || '?'} (levelsearch)`);
          botSetTimeout(() => {
            const submitBtn = levelForm.querySelector('input[name="levelsearch"], input[type="submit"]');
            if (submitBtn) submitBtn.click();
            else levelForm.submit();
          }, randomDelay(500, 1200));
          return;
        }
        botLog('warn', 'PvP: Levelsearch form not found');
        return;
      }

      // MODE 1 or 2: Random search via optionsearch form
      const pvpForm = findPvPOptionSearchForm();
      if (pvpForm) {
        // Set search mode: 1=normal, 2=stronger/equal
        // The <select> has a dynamically-hashed name attribute, so find it by tag
        const selectEl = pvpForm.querySelector('select');
        if (selectEl) {
          selectEl.value = (settings.pvpMode === 2 || settings.pvpMode === '2') ? '2' : '1';
        }

        // Handle totemsearch checkbox
        const totemCb = pvpForm.querySelector('input[name="totemsearch"]');
        if (totemCb) totemCb.checked = settings.pvpIncludeInactive !== false;

        state.pvpState = 'hunting';
        saveState(state);
        botLog('info', `PvP: Searching for opponent (mode ${(settings.pvpMode === 2 || settings.pvpMode === '2') ? 'stronger/equal' : 'normal'}) [optionsearch]`);
        botSetTimeout(() => {
          const submitBtn = pvpForm.querySelector('input[name="optionsearch"]');
          if (submitBtn) submitBtn.click();
          else pvpForm.submit();
        }, randomDelay(500, 1200));
        return;
      }

      botLog('warn', 'PvP: PvP form not found on /robbery/index page');
      return;
    }

    // Not on hunt page — navigate there
    botLog('info', 'PvP: Navigating → /robbery/index');
    state.pvpState = 'navigating';
    saveState(state);
    botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(800, 1500));
  }

  // ── HENCHMAN VS HENCHMAN BOT TICK (v1.6.9) ───────────────────
  // Uses the same /robbery/index page as PvP but submits a DIFFERENT form:
  //   - Random search:    input[name="henchmanfightsearch"]
  //   - Specific player:  shared namesearch form (same as PvP mode 3)
  // On the search-result (player profile) page, clicks the henchman-attack
  // button instead of the regular PvP "Attack" button. The form is:
  //   form#henchman_fight  OR  form[action*="henchmanattack"]
  // Costs 1 AP per fight, same as PvP. No min-HP, no "stronger/equal" mode,
  // and no "lost souls" toggle (the henchman flow doesn't expose them).

  // Find the random-search button on /robbery/index that triggers a henchman fight.
  // Language-independent: matched by input name only.
  function findHenchmanSearchButton() {
    return document.querySelector('input[name="henchmanfightsearch"][type="submit"]');
  }

  // Find the henchman-attack form on the search-result (player profile) page.
  // The page may also expose a regular PvP attack button — we ignore it here
  // and target only the henchman one (form id "henchman_fight" / action contains
  // "henchmanattack"). Both selectors are structural & language-independent.
  function findHenchmanAttackForm() {
    return document.querySelector('form#henchman_fight, form[action*="henchmanattack"]');
  }

  // v1.6.12 — Detect the "no victim found" state on the henchman hunt page.
  // When the search returns nothing the game injects a distinctive bold
  // status line:
  //   <strong style="font-size:1.8em; color:#fff">{localized text}</strong>
  // wrapped in a <div class="tdi">. We match by INLINE-STYLE FINGERPRINT
  // (font-size:1.8em is reserved for "nothing found"-style status text
  // across BF), NOT by text — works on any server/language. Without this
  // check the bot would re-click henchmanfightsearch in an infinite loop,
  // since the hunt page itself still contains the search button.
  function hasNoHenchmanOpponentsMsg() {
    const scope = document.querySelector('.wrap-content') || document.body;
    const candidates = scope.querySelectorAll('strong[style*="font-size"]');
    for (const el of candidates) {
      const style = (el.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
      if (style.includes('font-size:1.8em')) return el;
    }
    return null;
  }

  // v1.6.10 — Language-independent player-name matcher.
  // The search-result heading typically prefixes the displayed name with a
  // race/title (e.g. "Upír Tomler" in SK, "Vampire Tomler" in EN), so a strict
  // equality check on the full heading would never match. We tokenize on
  // whitespace and check if any whitespace-separated token matches a list
  // entry (case-insensitive). The user can type just "Tomler" and we'll
  // match "Upír Tomler", "Vampire Tomler", "Werewolf Tomler", etc.
  function matchPlayerByNameList(displayedName, list) {
    if (!displayedName || !Array.isArray(list) || !list.length) return false;
    const tokens = String(displayedName).trim().toLowerCase().split(/\s+/);
    if (!tokens.length) return false;
    for (const raw of list) {
      const n = String(raw || '').trim().toLowerCase();
      if (n && tokens.includes(n)) return true;
    }
    return false;
  }

  function henchmanTick(state, settings) {
    if (_centralStopActive) return;
    if (!ctxOk() || !settings.henchmanEnabled || state.henchmanState === 'done') return;
    // Mutual exclusivity safeguard — pvpTick handles PvP; this only runs when PvP is off.
    if (settings.pvpEnabled) return;

    const ap = readAP();

    // Check AP — need at least 1 AP for a henchman fight
    if (ap.current !== null && ap.current < 1) {
      botLog('warn', `Henchman: AP ${ap.current} — not enough AP`);
      botSetTimeout(() => { loadState(st => { loadSettings(se => { henchmanTick(st, se); }); }); }, randomDelay(60000, 120000));
      return;
    }

    // v1.6.12 — Cooldown gate. Honors `henchmanNextAttack` regardless of
    // the Smart Break checkbox: Smart Break sets it after each fight, AND
    // the new "no opponents found" guard (in the isPvPHuntPage branch
    // below) sets it when the search returns empty — so we always need
    // to respect it, even if Smart Break is off.
    if (state.henchmanNextAttack && state.henchmanNextAttack > Date.now()) {
      const waitMs = state.henchmanNextAttack - Date.now();
      const reason = (state.henchmanState === 'waiting') ? 'No-opponents cooldown' : 'Smart break';
      botLog('info', `Henchman: ${reason} – Next attack in ${Math.ceil(waitMs/60000)} min`);
      botSetTimeout(() => { loadState(st => { loadSettings(se => { henchmanTick(st, se); }); }); }, Math.min(waitMs + 1000, 300000));
      return;
    }
    // Cooldown elapsed but state is still 'waiting' — drop back to
    // 'navigating' so the rest of the tick can proceed.
    if (state.henchmanState === 'waiting') {
      state.henchmanState = 'navigating';
      saveState(state);
    }

    // ── On battle result page — parse result and go back ──
    if (isPvPBattleResultPage()) {
      const reportResult = document.querySelector('#reportResult, .reportResult, .combatResultHeader');
      const won = reportResult ? (
        reportResult.classList.contains('resultVictory') ||
        reportResult.classList.contains('won') ||
        !!reportResult.querySelector('.victory, img[src*="victory"], img[src*="win"]')
      ) : false;
      const wonFallback = !won && !!document.querySelector('.reportTable .winner, .report-winner');
      const isWin = won || wonFallback;
      if (isWin) state.henchmanKills = (state.henchmanKills || 0) + 1;
      else state.henchmanDeaths = (state.henchmanDeaths || 0) + 1;

      if (settings.henchmanSmartBreak) {
        const delay = (settings.henchmanDelay + (Math.random() * 2 - 1) * settings.henchmanMargin) * 60 * 1000;
        state.henchmanNextAttack = Date.now() + Math.max(delay, 60000);
      }
      saveState(state);
      botLog(isWin ? 'ok' : 'warn', `Henchman: ${isWin ? 'Win' : 'Loss'} (${state.henchmanKills}W/${state.henchmanDeaths}L)`);
      updateHenchmanUI(settings, state);

      botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, getSpeedDelay(settings));
      return;
    }

    // ── On search-result (player profile) page — click henchman attack ──
    if (isPvPSearchResultPage()) {
      // v1.6.10 semantics: BLACKLIST = skip these. Whitelist is NOT used here
      // because in mode 2 ("Whitelist only") we already used namesearch on a
      // whitelisted name, so the result IS a whitelisted player by definition.
      // In mode 1 ("Anyone"), filter out anyone on the blacklist.
      if (settings.henchmanMode !== 2 && settings.henchmanMode !== '2' &&
          settings.henchmanBlacklist) {
        const bl = settings.henchmanBlacklist.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
        if (bl.length > 0) {
          const playerName = (document.querySelector('.reportTable td b, h2, .username, #profileName') || {}).textContent || '';
          if (matchPlayerByNameList(playerName, bl)) {
            botLog('info', `Henchman: Player "${playerName.trim()}" is blacklisted → searching for another`);
            botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 2000));
            return;
          }
        }
      }

      const attackForm = findHenchmanAttackForm();
      const attackBtn = attackForm ? attackForm.querySelector('button[type="submit"], button[type="button"], input[type="submit"]') : null;

      if (attackBtn) {
        // v1.6.11 — Detect "own race" / cross-race confirmation flow:
        // For same-race targets the game replaces the normal submit button
        // with a `type="button"` whose onclick opens a confirmation modal
        // (showModal('confirmModal', { buttonLeftAction: $('#henchman_fight').submit() })).
        // Detection is purely structural — the onclick attribute string
        // contains "confirmModal" (or "showModal") regardless of UI language.
        const onclickAttr = attackBtn.getAttribute('onclick') || '';
        const isOwnRaceBtn =
          (attackBtn.getAttribute('type') || '').toLowerCase() === 'button' &&
          /confirmModal|showModal/i.test(onclickAttr);

        if (isOwnRaceBtn && !settings.henchmanAttackOwnRace) {
          botLog('info', 'Henchman: Same-race target detected → skipping (enable "Attack own race" to fight)');
          botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 2000));
          return;
        }

        state.henchmanState = 'attacking';
        saveState(state);

        if (isOwnRaceBtn) {
          botLog('info', 'Henchman: Same-race target → Attacking with modal confirm!');
          botSetTimeout(() => {
            attackBtn.click();
            // After the modal renders, click the confirm button. The modal
            // uses a stable id #confirmModal_buttonLeft (same scheme as the
            // blood-essence extraction modal we already handle elsewhere).
            // We retry a few times in case the modal is slow to appear.
            let tries = 0;
            const tryConfirm = () => {
              if (_centralStopActive) return;
              const confirmBtn = document.getElementById('confirmModal_buttonLeft');
              if (confirmBtn) {
                confirmBtn.click();
                botLog('ok', 'Henchman: Confirmed same-race attack modal');
              } else if (tries++ < 8) {
                botSetTimeout(tryConfirm, 250);
              } else {
                botLog('warn', 'Henchman: Confirm modal did not appear within timeout');
              }
            };
            botSetTimeout(tryConfirm, 600);
          }, randomDelay(500, 1200));
        } else {
          botLog('info', 'Henchman: Found opponent → Attacking!');
          botSetTimeout(() => {
            attackBtn.click();
            // Safety net: if the game unexpectedly shows a confirm modal
            // anyway, react according to the user's setting.
            botSetTimeout(() => {
              if (_centralStopActive) return;
              const confirmBtn = document.getElementById('confirmModal_buttonLeft');
              const closeLink  = document.querySelector('a.close-btn[onclick*="confirmModal"]');
              if (!confirmBtn && !closeLink) return; // no modal — proceed normally
              if (settings.henchmanAttackOwnRace) {
                if (confirmBtn) { confirmBtn.click(); botLog('ok', 'Henchman: Confirmed unexpected modal'); }
              } else {
                if (closeLink) closeLink.click();
                botLog('info', 'Henchman: Unexpected modal closed (own-race attack disabled)');
                botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(800, 1500));
              }
            }, 1200);
          }, randomDelay(500, 1200));
        }
        return;
      }

      // No henchman attack button — opponent might be on a "search again" page
      // (e.g. profile shown without a fight option). Re-search.
      botLog('warn', 'Henchman: Henchman attack button not found → searching again');
      botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1500, 3000));
      return;
    }

    // ── On /robbery/index — submit the correct form for henchman fight ──
    if (isPvPHuntPage()) {
      // v1.6.12 — No-opponents guard. Two signals, OR-ed together:
      //   (a) hasNoHenchmanOpponentsMsg() — the distinctive bold "no victim"
      //       status text the game shows after an empty search;
      //   (b) state.henchmanState === 'hunting' — we just clicked the
      //       search button and landed back on the hunt page (instead of
      //       navigating to a search-result profile), which structurally
      //       also indicates no opponents. This is the fallback for cases
      //       where the indicator markup ever changes.
      // Either signal → arm a cooldown (using Smart Break delay if enabled,
      // else 3–5 min default) and bail out, so we don't burn cycles
      // re-clicking the search button forever.
      const noOppEl = hasNoHenchmanOpponentsMsg();
      const stuckInHunt = (state.henchmanState === 'hunting');
      if (noOppEl || stuckInHunt) {
        let cooldownMs;
        if (settings.henchmanSmartBreak) {
          cooldownMs = (settings.henchmanDelay + (Math.random() * 2 - 1) * settings.henchmanMargin) * 60 * 1000;
          cooldownMs = Math.max(cooldownMs, 60000);
        } else {
          // Default 3–5 min cooldown when Smart Break is off — long enough
          // not to hammer the server, short enough to resume promptly.
          cooldownMs = randomDelay(3 * 60 * 1000, 5 * 60 * 1000);
        }
        state.henchmanState = 'waiting';
        state.henchmanNextAttack = Date.now() + cooldownMs;
        saveState(state);
        const why = noOppEl ? 'no opponent found' : 'search returned no result';
        botLog('warn', `Henchman: ${why} — cooldown ${Math.ceil(cooldownMs/60000)} min`);
        updateHenchmanUI(settings, state);
        botSetTimeout(() => { loadState(st => { loadSettings(se => { henchmanTick(st, se); }); }); }, Math.min(cooldownMs + 1000, 300000));
        return;
      }

      // MODE 2 (v1.6.10): Whitelist only — attack ONLY players from the
      // whitelist, using the shared namesearch form. Blacklist is ignored
      // here since the user has explicitly chosen these targets.
      if (settings.henchmanMode === 2 || settings.henchmanMode === '2') {
        const names = (settings.henchmanWhitelist || '').split(',').map(n => n.trim()).filter(Boolean);
        if (names.length > 0) {
          const nameForm = findPvPNameSearchForm();
          if (nameForm) {
            const targetName = names[Math.floor(Math.random() * names.length)];
            const nameInput = nameForm.querySelector('input[type="text"]');
            if (nameInput) {
              nameInput.value = targetName;
              state.henchmanState = 'hunting';
              saveState(state);
              botLog('info', `Henchman: Searching for whitelisted player "${targetName}" (namesearch)`);
              botSetTimeout(() => {
                const submitBtn = nameForm.querySelector('input[name="namesearch"][type="submit"], input[type="submit"], button[type="submit"]');
                if (submitBtn) submitBtn.click();
                else nameForm.submit();
              }, randomDelay(500, 1200));
              return;
            }
          }
          botLog('warn', 'Henchman: Namesearch form not found');
        } else {
          botLog('warn', 'Henchman: Whitelist is empty — enter player names to attack');
        }
        return;
      }

      // MODE 1: Random henchman search — click henchmanfightsearch button.
      // Blacklist filtering happens on the result page above.
      const searchBtn = findHenchmanSearchButton();
      if (searchBtn) {
        state.henchmanState = 'hunting';
        saveState(state);
        botLog('info', 'Henchman: Searching for opponent (random) [henchmanfightsearch]');
        botSetTimeout(() => { searchBtn.click(); }, randomDelay(500, 1200));
        return;
      }

      botLog('warn', 'Henchman: henchmanfightsearch button not found on /robbery/index page');
      return;
    }

    // Not on hunt page — navigate there
    botLog('info', 'Henchman: Navigating → /robbery/index');
    state.henchmanState = 'navigating';
    saveState(state);
    botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(800, 1500));
  }

  // ── SPEED HELPER ────────────────────────────────────────────
  function getSpeedDelay(settings) {
    const mode = settings.speedMode || 'normal';
    let base;
    switch (mode) {
      case 'slow': base = 2000 + Math.random() * 700; break;
      case 'normal': base = 1400 + Math.random() * 400; break;
      case 'turbo': base = 200 + Math.random() * 200; break;
      case 'custom': base = (settings.speedCustom || 2.0) * 1000; break;
      default: base = 1500;
    }
    if (settings.speedRandomizer && mode !== 'turbo') {
      base += (Math.random() - 0.5) * base * 0.4;
    }
    return Math.max(200, Math.round(base));
  }

  // ── SAVE/APPLY GLOBAL SETTINGS ──────────────────────────────
  function saveGlobalSettings() {
    loadSettings(settings => {
      settings.goldMode = parseInt(document.getElementById('bf-gold-mode')?.value) || 0;
      settings.goldSkills = [...document.querySelectorAll('input[data-gsk]:checked')].map(cb => cb.value);
      settings.goldDonateMin = parseInt(document.getElementById('bf-gold-donate-min')?.value) || 10000;
      settings.goldDonateAll = document.getElementById('bf-gold-donate-all')?.checked ?? false;
      settings.goldKeep = document.getElementById('bf-gold-keep')?.checked ?? false;
      settings.goldKeepAmount = parseInt(document.getElementById('bf-gold-keep-val')?.value) || 0;
      settings.goldBufferForPotions = document.getElementById('bf-gold-potion-buffer')?.checked ?? false;
      settings.graveyardEnabled = document.getElementById('bf-graveyard-enabled')?.checked ?? false;
      settings.graveyardWorkTimeAP = parseInt(document.getElementById('bf-graveyard-worktime-ap')?.value) || 2;
      settings.graveyardMinAP = parseInt(document.getElementById('bf-graveyard-minap')?.value) || 5;
      settings.graveyardWorkTimeHP = parseInt(document.getElementById('bf-graveyard-worktime-hp')?.value) || 2;
      settings.graveyardMinHP = parseInt(document.getElementById('bf-graveyard-minhp')?.value) || 20;
      // ── Inventory Discard / Cleanup (v1.6.13) ──
      settings.invDiscardEnabled = document.getElementById('bf-invdisc-enabled')?.checked ?? false;
      settings.invDiscardMode = document.getElementById('bf-invdisc-mode')?.value || 'manual';
      settings.invDiscardFrequency = document.getElementById('bf-invdisc-freq')?.value || 'daily';
      settings.invDiscardCustomHours = Math.max(1, parseInt(document.getElementById('bf-invdisc-custom-hours')?.value) || 12);
      settings.invDiscardMaxLevel = Math.max(1, parseInt(document.getElementById('bf-invdisc-maxlvl')?.value) || 1000);
      settings.invDiscardMinLevel = Math.max(0, parseInt(document.getElementById('bf-invdisc-minlvl')?.value) || 0);
      settings.speedMode = document.querySelector('input[name="bf-speed"]:checked')?.value || 'normal';
      settings.speedCustom = parseFloat(document.getElementById('bf-speed-custom-val')?.value) || 2.0;
      settings.speedRandomizer = document.getElementById('bf-speed-randomizer')?.checked ?? false;
      settings.withoutLogs = document.getElementById('bf-without-logs')?.checked ?? false;
      settings.potionEnergy = document.getElementById('bf-potion-energy')?.checked ?? false;
      settings.potionEnergyUnder = parseInt(document.getElementById('bf-potion-energy-ap')?.value) || 3;
      settings.potionSoupOfLife = document.getElementById('bf-potion-soup')?.checked ?? false;
      settings.potionMediumHealing = document.getElementById('bf-potion-medium')?.checked ?? false;
      settings.potionBlood = document.getElementById('bf-potion-blood')?.checked ?? false;
      settings.potionAutoBuy = document.getElementById('bf-potion-autobuy')?.checked ?? false;
      settings.scheduleEnabled = document.getElementById('bf-schedule-enabled')?.checked ?? false;
      // scheduleSlots are persisted directly by add/remove/edit handlers (renderScheduleList).
      // We re-read the current settings to preserve the existing slot list.
      // (DEFAULT_SETTINGS sets [], but if user has slots configured, we keep them.)
      settings.autoEnrollClanWar = document.getElementById('bf-auto-clan-war')?.checked ?? false;
      settings.hideGameforgeBar = document.getElementById('bf-hide-gf-bar')?.checked ?? false;
      settings.fixedInfobar = document.getElementById('bf-fixed-infobar')?.checked ?? false;
      settings.hideEventPanel = document.getElementById('bf-hide-event')?.checked ?? false;
      settings.backgroundRefresh = document.getElementById('bf-bg-refresh')?.checked ?? false;
      settings.backgroundRefreshInterval = parseInt(document.getElementById('bf-bg-refresh-interval')?.value) || 60;
      settings.backgroundRefreshRandomize = parseInt(document.getElementById('bf-bg-refresh-rand')?.value) || 0;
      saveSettings(settings);
    });
  }

  function applyGlobalSettingsToUI(settings) {
    const goldMode = document.getElementById('bf-gold-mode');
    if (goldMode) goldMode.value = String(settings.goldMode || 0);
    document.getElementById('bf-gold-skills-panel').style.display = settings.goldMode === 1 ? 'block' : 'none';
    document.getElementById('bf-gold-donate-panel').style.display = settings.goldMode === 2 ? 'block' : 'none';
    (settings.goldSkills || []).forEach(sk => {
      const cb = document.querySelector(`input[data-gsk][value="${sk}"]`);
      if (cb) cb.checked = true;
    });
    const dm = document.getElementById('bf-gold-donate-min'); if (dm) dm.value = settings.goldDonateMin || 10000;
    const da = document.getElementById('bf-gold-donate-all'); if (da) da.checked = !!settings.goldDonateAll;
    const gk = document.getElementById('bf-gold-keep'); if (gk) gk.checked = !!settings.goldKeep;
    const gkv = document.getElementById('bf-gold-keep-val'); if (gkv) gkv.value = settings.goldKeepAmount || 0;
    const gpb = document.getElementById('bf-gold-potion-buffer'); if (gpb) gpb.checked = !!settings.goldBufferForPotions;
    const ge = document.getElementById('bf-graveyard-enabled'); if (ge) ge.checked = !!settings.graveyardEnabled;
    const gwta = document.getElementById('bf-graveyard-worktime-ap'); if (gwta) gwta.value = settings.graveyardWorkTimeAP || 2;
    const gma = document.getElementById('bf-graveyard-minap'); if (gma) gma.value = settings.graveyardMinAP || 5;
    const gwth = document.getElementById('bf-graveyard-worktime-hp'); if (gwth) gwth.value = settings.graveyardWorkTimeHP || 2;
    const gmh = document.getElementById('bf-graveyard-minhp'); if (gmh) gmh.value = settings.graveyardMinHP || 20;
    // ── Inventory Discard / Cleanup (v1.6.13) ──
    const ide = document.getElementById('bf-invdisc-enabled'); if (ide) ide.checked = !!settings.invDiscardEnabled;
    const idm = document.getElementById('bf-invdisc-mode'); if (idm) idm.value = settings.invDiscardMode || 'manual';
    const idf = document.getElementById('bf-invdisc-freq'); if (idf) idf.value = settings.invDiscardFrequency || 'daily';
    const idch = document.getElementById('bf-invdisc-custom-hours'); if (idch) idch.value = settings.invDiscardCustomHours || 12;
    const idmax = document.getElementById('bf-invdisc-maxlvl'); if (idmax) idmax.value = settings.invDiscardMaxLevel || 1000;
    const idmin = document.getElementById('bf-invdisc-minlvl'); if (idmin) idmin.value = settings.invDiscardMinLevel || 0;
    const idPanel = document.getElementById('bf-invdisc-panel');
    if (idPanel) idPanel.style.display = settings.invDiscardEnabled ? '' : 'none';
    const idAuto = document.getElementById('bf-invdisc-auto-panel');
    if (idAuto) idAuto.style.display = (settings.invDiscardMode || 'manual') === 'auto' ? '' : 'none';
    const idCustom = document.getElementById('bf-invdisc-custom-row');
    if (idCustom) idCustom.style.display = ((settings.invDiscardMode || 'manual') === 'auto' && (settings.invDiscardFrequency || 'daily') === 'custom') ? '' : 'none';
    // Speed
    const speedRadio = document.getElementById('bf-speed-' + (settings.speedMode || 'normal'));
    if (speedRadio) speedRadio.checked = true;
    const csv = document.getElementById('bf-speed-custom-val'); if (csv) csv.value = settings.speedCustom || 2.0;
    const csl = document.getElementById('bf-speed-custom-label'); if (csl) csl.textContent = (settings.speedCustom || 2.0).toFixed(2) + 's';
    const sr = document.getElementById('bf-speed-randomizer'); if (sr) sr.checked = !!settings.speedRandomizer;
    const wl = document.getElementById('bf-without-logs'); if (wl) wl.checked = !!settings.withoutLogs;
    // Potions
    const pe = document.getElementById('bf-potion-energy'); if (pe) pe.checked = !!settings.potionEnergy;
    const pea = document.getElementById('bf-potion-energy-ap'); if (pea) pea.value = settings.potionEnergyUnder || 3;
    const ps = document.getElementById('bf-potion-soup'); if (ps) ps.checked = !!settings.potionSoupOfLife;
    const pm = document.getElementById('bf-potion-medium'); if (pm) pm.checked = !!settings.potionMediumHealing;
    const pb = document.getElementById('bf-potion-blood'); if (pb) pb.checked = !!settings.potionBlood;
    const pab = document.getElementById('bf-potion-autobuy'); if (pab) pab.checked = !!settings.potionAutoBuy;
    // Schedule (v1.6.7 — dynamic list)
    const se = document.getElementById('bf-schedule-enabled'); if (se) se.checked = !!settings.scheduleEnabled;
    renderScheduleList();
    const acw = document.getElementById('bf-auto-clan-war'); if (acw) acw.checked = !!settings.autoEnrollClanWar;
    const hgf = document.getElementById('bf-hide-gf-bar'); if (hgf) hgf.checked = !!settings.hideGameforgeBar;
    const fib = document.getElementById('bf-fixed-infobar'); if (fib) fib.checked = !!settings.fixedInfobar;
    const hep = document.getElementById('bf-hide-event'); if (hep) hep.checked = !!settings.hideEventPanel;
    const bgr = document.getElementById('bf-bg-refresh'); if (bgr) bgr.checked = !!settings.backgroundRefresh;
    const bri = document.getElementById('bf-bg-refresh-interval'); if (bri) bri.value = settings.backgroundRefreshInterval || 60;
    const brr = document.getElementById('bf-bg-refresh-rand'); if (brr) brr.value = settings.backgroundRefreshRandomize ?? 5;
    const brPanel = document.getElementById('bf-bg-refresh-panel');
    if (brPanel) brPanel.style.display = settings.backgroundRefresh ? '' : 'none';
  }

  // ── UI UPDATE FUNCTIONS ─────────────────────────────────────
  function updateGrottoUI(settings, state) {
    const btn = document.getElementById('bf-grotto-toggle');
    const status = document.getElementById('bf-grotto-status');
    if (btn) {
      btn.textContent = settings.grottoEnabled ? '⏸ Stop Grotto Bot' : '▶ Start Grotto Bot';
      btn.style.borderColor = settings.grottoEnabled ? '#e74c3c' : '';
    }
    if (status) {
      status.textContent = settings.grottoEnabled ? `Active (${state.grottoCount || 0} hunts)` : 'Disabled';
      status.style.color = settings.grottoEnabled ? '#2ecc71' : '';
    }
    const dot = document.getElementById('bf-bot-dot');
    updateStatusDot(settings, state);
    // Update AP/HP badges
    const ap = readAP();
    const hpPct = getHPPercent();
    const apEl = document.getElementById('bf-g-ap');
    const hpEl = document.getElementById('bf-g-hp');
    if (apEl) apEl.textContent = ap.current !== null ? `${ap.current}/${ap.max}` : '–';
    if (hpEl) hpEl.textContent = hpPct !== null ? `${hpPct}%` : '–';
  }

  function updatePvPUI(settings, state) {
    const btn = document.getElementById('bf-pvp-toggle');
    const status = document.getElementById('bf-pvp-status');
    if (btn) {
      btn.textContent = settings.pvpEnabled ? '⏸ Stop PvP Bot' : '▶ Start PvP Bot';
      btn.style.borderColor = settings.pvpEnabled ? '#e74c3c' : '';
    }
    if (status) {
      status.textContent = settings.pvpEnabled ? `Active` : 'Disabled';
      status.style.color = settings.pvpEnabled ? '#2ecc71' : '';
    }
    const winsEl = document.getElementById('bf-pvp-wins'); if (winsEl) winsEl.textContent = state.pvpKills || 0;
    const lossEl = document.getElementById('bf-pvp-losses'); if (lossEl) lossEl.textContent = state.pvpDeaths || 0;
    const ap = readAP();
    const hpPct = getHPPercent();
    const apEl = document.getElementById('bf-p-ap');
    const hpEl = document.getElementById('bf-p-hp');
    if (apEl) apEl.textContent = ap.current !== null ? `${ap.current}/${ap.max}` : '–';
    if (hpEl) hpEl.textContent = hpPct !== null ? `${hpPct}%` : '–';
  }

  // Henchman vs Henchman UI refresh (v1.6.9) — mirrors updatePvPUI for the
  // separate henchman block. AP/HP cells are shared with PvP at the top of
  // the tab so we don't refresh them again here.
  function updateHenchmanUI(settings, state) {
    const btn = document.getElementById('bf-henchman-toggle');
    const status = document.getElementById('bf-henchman-status');
    if (btn) {
      btn.textContent = settings.henchmanEnabled ? '⏸ Stop Henchman Bot' : '▶ Start Henchman Bot';
      btn.style.borderColor = settings.henchmanEnabled ? '#e74c3c' : '';
    }
    if (status) {
      status.textContent = settings.henchmanEnabled ? `Active` : 'Disabled';
      status.style.color = settings.henchmanEnabled ? '#2ecc71' : '';
    }
    const winsEl = document.getElementById('bf-henchman-wins'); if (winsEl) winsEl.textContent = state.henchmanKills || 0;
    const lossEl = document.getElementById('bf-henchman-losses'); if (lossEl) lossEl.textContent = state.henchmanDeaths || 0;
  }

  function updateGiftsUI(settings, state) {
    const btn = document.getElementById('bf-gifts-toggle');
    const status = document.getElementById('bf-gifts-status');
    if (btn) {
      const running = state.giftsState === 'running';
      btn.textContent = running ? '⏸ Stop Gifts Bot' : '▶ Open Purple Gifts';
      btn.style.borderColor = running ? '#e74c3c' : '';
    }
    if (status) {
      const running = state.giftsState === 'running';
      status.textContent = running ? `Active (${state.giftsPurpleOpened || 0} opened)` : 'Disabled';
      status.style.color = running ? '#2ecc71' : '';
    }
  }

  function createBattleLogPanel() {
    if (document.getElementById('bf-battlelog-panel')) return;

    const toggle = document.createElement('div');
    toggle.id = 'bf-battlelog-btn';
    toggle.innerHTML = '📊';
    toggle.title = 'Battle Log';
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'bf-battlelog-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div id="bf-bl-header">
        <span>📊 Log</span>
        <button id="bf-bl-close" style="background:none;border:none;cursor:pointer;font-size:0.7rem;color:#777">✕</button>
      </div>
      <div class="bf-bl-tabs">
        <div class="bf-bl-tab active" data-bltab="ruins-preset">⚔ Ruins (preset)</div>
        <div class="bf-bl-tab" data-bltab="ruins-new">⚔ Ruins (new)</div>
        <div class="bf-bl-tab" data-bltab="essence">🩸 Essence</div>
      </div>
      <div class="bf-bl-tab-body" id="bf-bl-ruins-preset-body">
        <div style="display:flex;gap:4px;padding:4px 6px;align-items:center">
          <select id="bf-bl-filter-preset" style="background:#111;color:#4caf50;border:1px solid #1a3a1a;font-size:0.56rem;padding:1px 3px;border-radius:3px;flex:1">
            <option value="all">All levels</option>
          </select>
          <button id="bf-bl-export-preset" title="Export CSV" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#4caf50">📥</button>
          <button id="bf-bl-clear-preset" title="Clear" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#e74c3c">🗑</button>
        </div>
        <div id="bf-bl-summary-preset" class="bf-bl-summary"></div>
        <div id="bf-bl-list-preset" class="bf-bl-list"></div>
      </div>
      <div class="bf-bl-tab-body" id="bf-bl-ruins-new-body" style="display:none">
        <div style="display:flex;gap:4px;padding:4px 6px;align-items:center">
          <select id="bf-bl-filter-new" style="background:#111;color:#4caf50;border:1px solid #1a3a1a;font-size:0.56rem;padding:1px 3px;border-radius:3px;flex:1">
            <option value="all">All levels</option>
          </select>
          <button id="bf-bl-export-new" title="Export CSV" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#4caf50">📥</button>
          <button id="bf-bl-clear-new" title="Clear" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#e74c3c">🗑</button>
        </div>
        <div id="bf-bl-summary-new" class="bf-bl-summary"></div>
        <div id="bf-bl-list-new" class="bf-bl-list"></div>
      </div>
      <div class="bf-bl-tab-body" id="bf-bl-essence-body" style="display:none">
        <div style="display:flex;gap:4px;padding:4px 6px;align-items:center;justify-content:flex-end">
          <button id="bf-bl-ess-export" title="Export CSV" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#4caf50">📥</button>
          <button id="bf-bl-ess-clear" title="Clear" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#e74c3c">🗑</button>
        </div>
        <div id="bf-bl-ess-summary" class="bf-bl-summary"></div>
        <div id="bf-bl-ess-list" class="bf-bl-list"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Toggle panel
    toggle.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'flex';
      if (!open) { renderBattleLog('preset'); renderBattleLog('new'); renderEssenceLog(); }
    });
    document.getElementById('bf-bl-close').addEventListener('click', () => { panel.style.display = 'none'; });

    // Tab switching
    panel.querySelectorAll('.bf-bl-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.bf-bl-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.getAttribute('data-bltab');
        document.getElementById('bf-bl-ruins-preset-body').style.display = which === 'ruins-preset' ? 'flex' : 'none';
        document.getElementById('bf-bl-ruins-new-body').style.display    = which === 'ruins-new'    ? 'flex' : 'none';
        document.getElementById('bf-bl-essence-body').style.display      = which === 'essence'      ? 'flex' : 'none';
        if (which === 'ruins-preset') renderBattleLog('preset');
        if (which === 'ruins-new')    renderBattleLog('new');
        if (which === 'essence')      renderEssenceLog();
      });
    });

    // Ruins (preset) controls
    document.getElementById('bf-bl-filter-preset').addEventListener('change', () => renderBattleLog('preset'));
    document.getElementById('bf-bl-clear-preset').addEventListener('click', () => {
      if (confirm('Clear preset battle log?')) {
        sGet([SK('ruinsBattleLog')], r => {
          const log = (r[SK('ruinsBattleLog')] || []).filter(e => !isPresetSource(e.source));
          sSet({ [SK('ruinsBattleLog')]: log }, () => { renderBattleLog('preset'); renderBattleLog('new'); });
        });
      }
    });
    document.getElementById('bf-bl-export-preset').addEventListener('click', () => exportBattleLogCsv('preset'));

    // Ruins (new) controls
    document.getElementById('bf-bl-filter-new').addEventListener('change', () => renderBattleLog('new'));
    document.getElementById('bf-bl-clear-new').addEventListener('click', () => {
      if (confirm('Clear new-formation battle log?')) {
        sGet([SK('ruinsBattleLog')], r => {
          const log = (r[SK('ruinsBattleLog')] || []).filter(e => isPresetSource(e.source));
          sSet({ [SK('ruinsBattleLog')]: log }, () => { renderBattleLog('preset'); renderBattleLog('new'); });
        });
      }
    });
    document.getElementById('bf-bl-export-new').addEventListener('click', () => exportBattleLogCsv('new'));

    // Essence controls
    document.getElementById('bf-bl-ess-clear').addEventListener('click', () => {
      if (confirm('Clear extraction log?')) { sSet({ [SK('extractionLog')]: [] }); renderEssenceLog(); }
    });
    document.getElementById('bf-bl-ess-export').addEventListener('click', () => {
      sGet([SK('extractionLog')], r => {
        const log = r[SK('extractionLog')] || [];
        if (!log.length) return;
        const rows = [['Time','Extraction','BE Gain','Before','After']];
        log.forEach(e => {
          rows.push([new Date(e.ts).toLocaleString(), e.extraction || '?', e.gain, e.before, e.after]);
        });
        const csv = rows.map(r => r.join(';')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `bf-essence-${SERVER_ID}${PLAYER_ID ? '-p' + PLAYER_ID : ''}.csv`; a.click();
        URL.revokeObjectURL(url);
      });
    });

    // Populate ruins filters (both preset and new tabs)
    sGet([SK('ruinsBattleLog')], r => {
      const log = r[SK('ruinsBattleLog')] || [];
      ['preset', 'new'].forEach(kind => {
        const sel = document.getElementById('bf-bl-filter-' + kind);
        if (!sel) return;
        const relevant = log.filter(e => kind === 'preset' ? isPresetSource(e.source) : !isPresetSource(e.source));
        const lvls = [...new Set(relevant.map(e => e.level))].sort((a,b) => a - b);
        lvls.forEach(l => {
          const opt = document.createElement('option');
          opt.value = String(l); opt.textContent = `Level ${l}`;
          sel.appendChild(opt);
        });
      });
    });
  }

  // ── BATTLE LOG HELPERS (v1.5.8) ────────────────────────────────
  // A "preset" source is the exact-match preset hit. Everything else
  // (SIM, SIM+WARM, DEEP-ST, DEEP-PAR, FAST-ST, FAST-PAR, …) is "new".
  // Backwards compatible with v1.5.7 entries which only used 'PRESET'/'SIM'.
  function isPresetSource(src) {
    if (!src) return false;
    return String(src).toUpperCase().startsWith('PRESET');
  }

  function exportBattleLogCsv(kind) {
    sGet([SK('ruinsBattleLog')], r => {
      const all = r[SK('ruinsBattleLog')] || [];
      const log = all.filter(e => kind === 'preset' ? isPresetSource(e.source) : !isPresetSource(e.source));
      if (!log.length) return;
      const rows = [['Time','Level','Result','Enemy','Formation','Source','Losses','Gold','XP','Blood']];
      log.forEach(e => {
        rows.push([
          new Date(e.ts).toLocaleString(), e.level,
          e.won ? 'Victory' : 'Defeat', qtyToString(e.enemy || {}),
          qtyToString(e.formation || {}), e.source || '?',
          qtyToString(e.losses || {}), e.gold || 0, e.xp || 0, e.blood || 0,
        ]);
      });
      const csv = rows.map(r => r.join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bf-battlelog-${kind}-${SERVER_ID}${PLAYER_ID ? '-p' + PLAYER_ID : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ── ADD WINNING NEW ENTRY AS PRESET (manual save, v1.5.8) ────
  // Reused by the "📥 Save as Ruins preset" button on each winning
  // "new" entry. Same write semantics as the manual Add Preset flow.
  function saveBattleEntryAsPreset(entry, cb) {
    if (!entry || !entry.won) { if (cb) cb({ ok: false, reason: 'not a victory' }); return; }
    const formation = {};
    Object.keys(entry.formation || {}).forEach(k => {
      const v = parseInt(entry.formation[k]) || 0;
      if (v > 0) formation[k.toUpperCase()] = v;
    });
    if (!Object.keys(formation).length) { if (cb) cb({ ok: false, reason: 'empty formation' }); return; }
    const enemyObj = {};
    Object.keys(entry.enemy || {}).forEach(k => {
      const v = parseInt(entry.enemy[k]) || 0;
      if (v > 0) enemyObj[k.toUpperCase()] = v;
    });
    const fingerprint = Object.entries(enemyObj).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join(',');
    sGet([SK('ruinsPresets')], r => {
      const presets = r[SK('ruinsPresets')] || {};
      const lvl = String(entry.level);
      if (!presets[lvl]) presets[lvl] = [];
      const existed = presets[lvl].some(p => p.enemy === fingerprint);
      presets[lvl] = presets[lvl].filter(p => p.enemy !== fingerprint);
      presets[lvl].push({ enemy: fingerprint, formation });
      sSet({ [SK('ruinsPresets')]: presets }, () => {
        if (cb) cb({ ok: true, level: lvl, enemy: fingerprint, updated: existed });
      });
    });
  }

  // ── ADD WINNING NEW ENTRY AS SMART PRESET (manual save, v1.5.9) ──
  // Writes to the simulator's Smart Preset library via BFPresets.updateLevelPreset.
  // Smart preset is per-LAYER (no enemy fingerprint) — it acts as the warm-start
  // template when bot.js or the simulator runs optimization without an exact
  // ruins-preset match. We store the formation as concrete tier counts and
  // mark confidence='yellow' since it comes from a single battle.
  function saveBattleEntryAsSmartPreset(entry, cb) {
    if (!entry || !entry.won) { if (cb) cb({ ok: false, reason: 'not a victory' }); return; }
    if (!window.BFPresets || typeof window.BFPresets.updateLevelPreset !== 'function') {
      if (cb) cb({ ok: false, reason: 'BFPresets unavailable' });
      return;
    }
    const tiers = {};
    Object.keys(entry.formation || {}).forEach(k => {
      const v = parseInt(entry.formation[k]) || 0;
      if (v > 0) tiers[k.toUpperCase()] = v;
    });
    if (!Object.keys(tiers).length) { if (cb) cb({ ok: false, reason: 'empty formation' }); return; }
    const lvl = String(entry.level);
    // Check if a preset already exists for this layer to set correct confidence
    const cache = window.BFPresets.getCached ? (window.BFPresets.getCached() || {}) : {};
    const existing = cache[lvl];
    const preset = {
      tiers: tiers,
      confidence: existing && existing.confidence === 'green' ? 'green' : 'yellow',
      note: 'Auto-imported from battle log on ' + new Date(entry.ts).toLocaleDateString('en-GB'),
      lastUsed: Date.now(),
    };
    window.BFPresets.updateLevelPreset(lvl, preset, function (err) {
      if (err) { if (cb) cb({ ok: false, reason: 'storage error' }); return; }
      if (cb) cb({ ok: true, level: lvl, updated: !!existing });
    });
  }

  function renderBattleLog(kind) {
    kind = kind || 'preset';
    sGet([SK('ruinsBattleLog')], r => {
      const all = r[SK('ruinsBattleLog')] || [];
      const log = all.filter(e => kind === 'preset' ? isPresetSource(e.source) : !isPresetSource(e.source));
      const filterEl = document.getElementById('bf-bl-filter-' + kind);
      const filterLvl = filterEl?.value || 'all';
      const filtered = filterLvl === 'all' ? log : log.filter(e => String(e.level) === filterLvl);

      const sumEl = document.getElementById('bf-bl-summary-' + kind);
      if (sumEl) {
        const wins = filtered.filter(e => e.won).length;
        const total = filtered.length;
        const totalGold = filtered.reduce((s, e) => s + (e.gold || 0), 0);
        const totalXP = filtered.reduce((s, e) => s + (e.xp || 0), 0);
        const totalBlood = filtered.reduce((s, e) => s + (e.blood || 0), 0);
        const totalLosses = {};
        filtered.forEach(e => {
          for (const [tid, qty] of Object.entries(e.losses || {})) {
            totalLosses[tid] = (totalLosses[tid] || 0) + qty;
          }
        });
        const lossStr = Object.entries(totalLosses).filter(([,v]) => v > 0).map(([k,v]) => `${k}:-${v}`).join(' ');
        sumEl.innerHTML = `
          <span>Battles: <b>${total}</b> (✅${wins} ❌${total-wins})</span>
          <span>💰 ${totalGold.toLocaleString()}</span>
          <span>⭐ ${totalXP.toLocaleString()}</span>
          ${totalBlood > 0 ? `<span>🩸 ${totalBlood.toLocaleString()}</span>` : ''}
          <span style="color:#e07040">${lossStr || 'No losses'}</span>
        `;
      }

      const listEl = document.getElementById('bf-bl-list-' + kind);
      if (!listEl) return;
      const show = [...filtered].reverse().slice(0, 100);
      if (!show.length) {
        listEl.innerHTML = '<div style="color:#444;text-align:center;padding:10px;font-size:0.58rem">No records</div>';
        return;
      }
      // Index in `all` (not filtered) so the Save button can find the right entry by ts+level+source.
      listEl.innerHTML = show.map(e => {
        const time = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(e.ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        const lossStr = Object.entries(e.losses || {}).filter(([,v]) => v > 0).map(([k,v]) => `<span style="color:#e07040">${k}:-${v}</span>`).join(' ');
        // v1.5.9 — separate Ruins and Smart import flags. Each button is
        // independent so the player can save to either or both libraries.
        const isNew = (kind === 'new');
        const wonNew = isNew && e.won;
        const savedRuins = isNew && e.importedAsPreset;       // legacy flag = Ruins
        const savedSmart = isNew && e.importedAsSmart;
        const savedBadgeParts = [];
        if (savedRuins) savedBadgeParts.push('Ruins');
        if (savedSmart) savedBadgeParts.push('Smart');
        const savedBadge = savedBadgeParts.length
          ? `<div style="font-size:0.55rem;color:#2ecc71;margin-top:2px">✓ Saved as ${savedBadgeParts.join(' + ')}</div>`
          : '';
        const btnStyle = 'background:rgba(46,204,113,0.1);border:1px solid #27ae60;color:#2ecc71;font-family:Cinzel,serif;font-size:0.55rem;padding:2px 4px;border-radius:2px;cursor:pointer;flex:1;min-width:0';
        const btnRuins = (wonNew && !savedRuins)
          ? `<button class="bf-bl-save-preset" data-ts="${e.ts}" data-level="${e.level}" title="Save as Ruins preset" style="${btnStyle}">📥 Ruins preset</button>` : '';
        const btnSmart = (wonNew && !savedSmart)
          ? `<button class="bf-bl-save-smart" data-ts="${e.ts}" data-level="${e.level}" title="Save as Smart preset (simulator)" style="${btnStyle.replace('46,204,113','155,89,182').replace('#27ae60','#9b59b6').replace('#2ecc71','#bb84db')}">🧠 Smart preset</button>` : '';
        const btnsRow = (btnRuins || btnSmart)
          ? `<div style="display:flex;gap:4px;margin-top:3px">${btnRuins}${btnSmart}</div>` : '';
        return `<div class="bf-bl-entry ${e.won ? 'bf-bl-win' : 'bf-bl-loss'}">
          <div class="bf-bl-entry-top">
            <span class="bf-bl-time">${date} ${time}</span>
            <span class="bf-bl-level">L${e.level}</span>
            <span class="bf-bl-result">${e.won ? '✅' : '❌'}</span>
            <span class="bf-bl-src">[${e.source || '?'}]</span>
          </div>
          <div class="bf-bl-entry-mid">
            <span>👹 ${qtyToString(e.enemy || {})}</span>
            <span>⚔ ${qtyToString(e.formation || {})}</span>
          </div>
          <div class="bf-bl-entry-bot">
            ${lossStr || '<span style="color:#2ecc71">No losses</span>'}
            ${e.gold ? ` 💰${e.gold.toLocaleString()}` : ''}
            ${e.xp ? ` ⭐${e.xp.toLocaleString()}` : ''}
            ${e.blood ? ` 🩸${e.blood.toLocaleString()}` : ''}
          </div>
          ${savedBadge}
          ${btnsRow}
        </div>`;
      }).join('');

      // Wire up Save-as-Ruins-Preset buttons
      listEl.querySelectorAll('.bf-bl-save-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const ts = parseInt(btn.getAttribute('data-ts'));
          const level = parseInt(btn.getAttribute('data-level'));
          sGet([SK('ruinsBattleLog')], rr => {
            const arr = rr[SK('ruinsBattleLog')] || [];
            const entryIdx = arr.findIndex(x => x.ts === ts && x.level === level);
            if (entryIdx < 0) { btn.textContent = '✗ Not found'; btn.style.color = '#e74c3c'; return; }
            saveBattleEntryAsPreset(arr[entryIdx], res => {
              if (!res || !res.ok) { btn.textContent = '✗ ' + (res?.reason || 'Failed'); btn.style.color = '#e74c3c'; return; }
              arr[entryIdx].importedAsPreset = true;
              sSet({ [SK('ruinsBattleLog')]: arr }, () => {
                btn.textContent = res.updated ? '✓ Updated' : `✓ Saved L${res.level}`;
                btn.style.background = 'rgba(46,204,113,0.25)';
                botSetTimeout(() => renderBattleLog('new'), 800);
              });
            });
          });
        });
      });

      // v1.5.9 — Wire up Save-as-Smart-Preset buttons (simulator's warm-start library)
      listEl.querySelectorAll('.bf-bl-save-smart').forEach(btn => {
        btn.addEventListener('click', () => {
          const ts = parseInt(btn.getAttribute('data-ts'));
          const level = parseInt(btn.getAttribute('data-level'));
          sGet([SK('ruinsBattleLog')], rr => {
            const arr = rr[SK('ruinsBattleLog')] || [];
            const entryIdx = arr.findIndex(x => x.ts === ts && x.level === level);
            if (entryIdx < 0) { btn.textContent = '✗ Not found'; btn.style.color = '#e74c3c'; return; }
            saveBattleEntryAsSmartPreset(arr[entryIdx], res => {
              if (!res || !res.ok) { btn.textContent = '✗ ' + (res?.reason || 'Failed'); btn.style.color = '#e74c3c'; return; }
              arr[entryIdx].importedAsSmart = true;
              sSet({ [SK('ruinsBattleLog')]: arr }, () => {
                btn.textContent = res.updated ? '✓ Updated' : `✓ Saved L${res.level}`;
                btn.style.background = 'rgba(155,89,182,0.25)';
                botSetTimeout(() => renderBattleLog('new'), 800);
              });
            });
          });
        });
      });
    });
  }

  function renderEssenceLog() {
    sGet([SK('extractionLog')], r => {
      const log = r[SK('extractionLog')] || [];

      const sumEl = document.getElementById('bf-bl-ess-summary');
      if (sumEl) {
        const totalGain = log.reduce((s, e) => s + (e.gain || 0), 0);
        const count = log.length;
        const avg = count > 0 ? (totalGain / count).toFixed(1) : 0;
        sumEl.innerHTML = `
          <span>Extrakcie: <b>${count}</b></span>
          <span>🩸 Total: <b>+${totalGain}</b></span>
          <span>Priemer: <b>${avg}</b> / extrakcia</span>
        `;
      }

      const listEl = document.getElementById('bf-bl-ess-list');
      if (!listEl) return;
      const show = [...log].reverse().slice(0, 100);
      if (!show.length) {
        listEl.innerHTML = '<div style="color:#444;text-align:center;padding:10px;font-size:0.58rem">No records</div>';
        return;
      }
      listEl.innerHTML = show.map(e => {
        const time = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(e.ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        return `<div class="bf-bl-entry bf-bl-win">
          <div class="bf-bl-entry-top">
            <span class="bf-bl-time">${date} ${time}</span>
            <span class="bf-bl-level">Extrakcia ${e.extraction || '?'}/3</span>
          </div>
          <div class="bf-bl-entry-bot">
            <span style="color:#c44">🩸 +${e.gain}</span>
            <span style="color:#666">(${e.before} → ${e.after})</span>
          </div>
        </div>`;
      }).join('');
    });
  }

  function createBotPanel() {
    if (document.getElementById('bf-bot-panel')) return;

    // Toggle button
    const btn = document.createElement('div');
    btn.id = 'bf-bot-btn';
    btn.innerHTML = `
      <span class="bf-bot-icon">🤖</span>
      <span>Bot</span>
      <span class="bf-bot-status-dot" id="bf-bot-dot"></span>
      <span id="bf-central-stop" title="Central STOP — emergency halt all bots"></span>
    `;
    document.body.appendChild(btn);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'bf-bot-panel';
    panel.innerHTML = `
      <div id="bf-bot-header">
        <span>🤖 BF Bot <span style="font-size:0.55rem;opacity:0.4;margin-left:4px">v1.6.13 · ${SERVER_ID}</span></span>
        <div style="display:flex;gap:4px;align-items:center">
          <span id="bf-player-badge" style="font-size:0.52rem;color:#9a7a5a;opacity:0.7">${PLAYER_ID ? '👤 #' + PLAYER_ID : ''}</span>
          <button id="bf-bot-pin" title="Pin panel (stays open after reload)">📌</button>
          <button id="bf-bot-close">✕</button>
        </div>
      </div>
      <div class="bf-bot-tabs">
        <div class="bf-bot-tab active" data-tab="hunt">🩸 Hunt</div>
        <div class="bf-bot-tab" data-tab="story">📖 Story</div>
        <div class="bf-bot-tab" data-tab="ruins">🏚 Ruins</div>
        <div class="bf-bot-tab" data-tab="grotto">🦇 Grotto</div>
        <div class="bf-bot-tab" data-tab="pvp">⚔ PvP</div>
        <div class="bf-bot-tab" data-tab="gifts">🎁 Gifts</div>
        <div class="bf-bot-tab" data-tab="global">🌐 Global</div>
        <div class="bf-bot-tab" data-tab="log">📜 Log</div>
      </div>
      <div class="bf-bot-body">
        <!-- HUNT TAB -->
        <div class="bf-bot-section active" id="bf-bot-hunt">
          <div class="bf-bot-info-grid" id="bf-hunt-info">
            <div class="bf-bot-info-cell"><span class="label">AP:</span> <span class="value" id="bf-h-ap">–</span></div>
            <div class="bf-bot-info-cell"><span class="label">AB%:</span> <span class="value" id="bf-h-ab">–</span></div>
            <div class="bf-bot-info-cell"><span class="label">BE:</span> <span class="value" id="bf-h-be">–</span></div>
            <div class="bf-bot-info-cell"><span class="label">Orbs:</span> <span class="value" id="bf-h-orbs">–</span></div>
          </div>

          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-hunt-toggle">▶ Start Hunt Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-hunt-status">Disabled</span>
          </div>

          <div class="bf-bot-cooldown" id="bf-hunt-cooldown" style="display:none;">
            <div class="bf-cooldown-header">
              <span>⏳ Orb Cooldown</span>
              <span id="bf-cooldown-time">0h 00m 00s</span>
            </div>
            <div class="bf-cooldown-bar-bg">
              <div class="bf-cooldown-bar-fill" id="bf-cooldown-fill" style="width:100%"></div>
            </div>
            <div class="bf-cooldown-eta" id="bf-cooldown-eta"></div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⚙ Hunt Mode</div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-hunt-mode" value="auto" id="bf-hm-auto" checked>
                Auto (based on AB%)
              </label>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-hunt-mode" value="manual" id="bf-hm-manual">
                Manual selection
              </label>
            </div>
            <div class="bf-bot-row" id="bf-manual-type-row" style="display:none;margin-left:18px">
              <span class="bf-bot-label">Location:</span>
              <select class="bf-bot-select" id="bf-manual-type">
                <option value="1">Farm (1 AP)</option>
                <option value="2">Village (1 AP)</option>
                <option value="3">Small Town (1 AP)</option>
                <option value="4">Town (1 AP)</option>
                <option value="5" selected>Metropolis (2 AP)</option>
              </select>
            </div>
            <div class="bf-bot-row" id="bf-manual-quality-row" style="display:none;margin-left:18px;flex-direction:column">
              <span class="bf-bot-label" style="margin-bottom:4px">Accepted qualities:</span>
              <div class="bf-ignore-q-row" id="bf-manual-accept-q">
                <label class="bf-q-check"><input type="checkbox" value="S" data-maq checked> <span class="bf-q-badge bf-q-S">S</span></label>
                <label class="bf-q-check"><input type="checkbox" value="A" data-maq checked> <span class="bf-q-badge bf-q-A">A</span></label>
                <label class="bf-q-check"><input type="checkbox" value="B" data-maq checked> <span class="bf-q-badge bf-q-B">B</span></label>
                <label class="bf-q-check"><input type="checkbox" value="C" data-maq> <span class="bf-q-badge bf-q-C">C</span></label>
                <label class="bf-q-check"><input type="checkbox" value="D" data-maq> <span class="bf-q-badge bf-q-D">D</span></label>
                <label class="bf-q-check"><input type="checkbox" value="E" data-maq> <span class="bf-q-badge bf-q-E">E</span></label>
              </div>
            </div>
          </div>

          <div class="bf-bot-group" id="bf-auto-rules">
            <div class="bf-bot-group-title">📊 Auto Rules (based on AB%)</div>
            <div style="font-size:0.62rem;color:#5a7a4a;margin-bottom:6px;line-height:1.5">
              <b style="color:#2ecc71">60%+ AB</b> → Metropolis, accept len <span class="bf-q-badge bf-q-S">S</span> <span class="bf-q-badge bf-q-A">A</span><br>
              <b style="color:#e67e22">25–59% AB</b> → Metropolis, accept <span class="bf-q-badge bf-q-S">S</span> <span class="bf-q-badge bf-q-A">A</span> <span class="bf-q-badge bf-q-B">B</span><br>
              <b style="color:#e74c3c">1–24% AB</b> → Town, accept all qualities
            </div>
            <div class="bf-bot-group-title" style="margin-top:4px">🚫 Ignore Qualities (always skip)</div>
            <div class="bf-ignore-q-row" id="bf-ignore-q">
              <label class="bf-q-check"><input type="checkbox" value="S" data-iq> <span class="bf-q-badge bf-q-S">S</span></label>
              <label class="bf-q-check"><input type="checkbox" value="A" data-iq> <span class="bf-q-badge bf-q-A">A</span></label>
              <label class="bf-q-check"><input type="checkbox" value="B" data-iq> <span class="bf-q-badge bf-q-B">B</span></label>
              <label class="bf-q-check"><input type="checkbox" value="C" data-iq> <span class="bf-q-badge bf-q-C">C</span></label>
              <label class="bf-q-check"><input type="checkbox" value="D" data-iq> <span class="bf-q-badge bf-q-D">D</span></label>
              <label class="bf-q-check"><input type="checkbox" value="E" data-iq> <span class="bf-q-badge bf-q-E">E</span></label>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🔴 Extraction</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-extract-enabled" checked>
              Automatic extraction
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-extract-repeat" checked>
              Repeat after orb cooldown (5h)
            </label>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⚔ Auto Recruitment
              <button id="bf-recruit-refresh" title="Refresh army state" style="float:right;background:none;border:none;cursor:pointer;color:#5a7a4a;font-size:0.6rem;margin-left:4px">↻</button>
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-recruit-enabled">
              Auto-train units
              <span class="bf-help-hint" title="Runs as a GLOBAL module (like Spend Gold).&#10;&#10;Works during idle/cooldown periods (yellow/white indicator) regardless of which main bot is active. Decoupled from Hunt — no longer requires extractions to fire.&#10;&#10;On every cycle the bot navigates to Crimson Sanctuary, parses live army state, and trains units per your strategy. 60-second minimum cycle.">?</span>
            </label>

            <!-- Trigger -->
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:60px">When:</span>
              <select class="bf-bot-select" id="bf-recruit-trigger" style="flex:1">
                <option value="idle">Idle / cooldown (yellow & white)</option>
                <option value="threshold">When BE ≥ threshold</option>
                <option value="continuous">Continuous (every tick)</option>
                <option value="extraction">After each extraction (legacy)</option>
              </select>
            </div>
            <div class="bf-bot-row" id="bf-recruit-threshold-row" style="display:none;margin-top:4px">
              <span class="bf-bot-label" style="min-width:60px">BE ≥</span>
              <input type="number" class="bf-bot-input" id="bf-recruit-threshold" value="100" min="10" style="width:70px">
            </div>

            <!-- Strategy -->
            <div class="bf-bot-row" style="margin-top:6px">
              <span class="bf-bot-label" style="min-width:60px">Strategy:</span>
              <select class="bf-bot-select" id="bf-recruit-strategy" style="flex:1">
                <option value="priority">Priority order (drain top first)</option>
                <option value="percent">Percent split</option>
              </select>
            </div>

            <!-- Reserve BE -->
            <div class="bf-bot-row" style="margin-top:4px;align-items:center;flex-wrap:wrap;gap:4px">
              <span class="bf-bot-label" style="min-width:60px">Reserve:</span>
              <input type="number" class="bf-bot-input" id="bf-recruit-reserve" value="0" min="0" style="width:70px;flex:0 0 auto">
              <span style="color:#5a7a4a;font-size:0.56rem">BE kept on hand</span>
              <span class="bf-help-hint" title="Bot never spends below this amount of blood essence.&#10;&#10;Useful if you want to keep BE aside for a planned formation or for manual purchases.&#10;&#10;Example: Reserve = 200 → bot only spends BE above 200.">?</span>
            </div>

            <!-- Strategy: PRIORITY panel -->
            <div id="bf-recruit-priority-panel" style="margin-top:6px">
              <div style="font-size:0.58rem;color:#aaa;margin-bottom:3px">
                Enable tiers and reorder. Available BE drains into the top-most enabled tier first.
              </div>
              <div id="bf-recruit-priority-list">
                <!-- Rows injected by renderRecruitPriorityRows() -->
              </div>
            </div>

            <!-- Strategy: PERCENT panel -->
            <div id="bf-recruit-percent-panel" style="display:none;margin-top:6px">
              <div style="font-size:0.58rem;color:#aaa;margin-bottom:3px">
                Divide BE between tiers (%). Leftover BE rolls over to the next cycle.
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T1</b> <span style="color:#5a7a4a">(10 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="1" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T2</b> <span style="color:#5a7a4a">(15 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="2" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T3</b> <span style="color:#5a7a4a">(20 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="3" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T4</b> <span style="color:#5a7a4a">(35 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="4" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T5</b> <span style="color:#5a7a4a">(50 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="5" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T6</b> <span style="color:#5a7a4a">(75 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="6" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T7</b> <span style="color:#5a7a4a">(90 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="7" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="color:#e0c068;font-size:0.6rem;min-width:90px"><b>T8</b> <span style="color:#5a7a4a">(150 BE)</span></span>
                <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="8" min="0" max="100" value="0" style="width:50px">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div id="bf-recruit-total" style="font-size:0.6rem;color:#e0a030;margin-top:4px;font-weight:bold">
                Total: 0% — set at least one tier
              </div>
            </div>

            <!-- Live status -->
            <div style="font-size:0.6rem;color:#aaa;margin:8px 0 3px 0">Live status:</div>
            <div id="bf-recruit-live-status" style="font-size:0.56rem;color:#aaa;line-height:1.4;background:rgba(20,20,20,0.3);padding:4px 6px;border-radius:3px;border:1px solid #2a2a2a">
              <em style="color:#5a7a4a">Click ↻ to fetch live state.</em>
            </div>

            <!-- Manual trigger -->
            <div style="display:flex;gap:6px;margin-top:6px">
              <button id="bf-recruit-train-now" class="bf-bot-btn" style="flex:1;font-size:0.62rem;padding:4px 8px" title="Trigger one recruitment cycle right now (bypasses the 60s cooldown).">▶ Train now</button>
            </div>
          </div>


        </div>

        <!-- RUINS TAB -->
        <div class="bf-bot-section" id="bf-bot-ruins">
          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-ruins-toggle">▶ Start Ruins Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-ruins-status">Disabled</span>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">
              🏚 Levels to Farm
              <button id="bf-ruins-lock-btn" title="Lock selection (prevent accidental changes)"
                style="float:right;background:none;border:none;cursor:pointer;color:#5a7a4a;font-size:0.85rem;line-height:1;padding:0">🔓</button>
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-bottom:4px;line-height:1.3">
              Hold &amp; drag to paint a range. Each cell toggles by the first cell's new state.
            </div>
            <div class="bf-ruins-levels" id="bf-ruins-level-grid"></div>
            <div class="bf-bot-row" style="margin-top:6px;flex-wrap:wrap;gap:4px">
              <span class="bf-bot-label" style="min-width:0;flex:0 0 auto">Additional (&gt;50):</span>
              <input type="text" class="bf-bot-input" id="bf-ruins-custom" placeholder="e.g. 55, 70, 80" style="flex:1;min-width:0">
            </div>
            <div style="font-size:0.54rem;color:#5a7a4a;margin-top:3px;line-height:1.3">
              Levels here are added to grid selection. Use for layers above 50.
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⏱ Cadence</div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-ruins-cadence" value="infinite" id="bf-rc-inf" checked>
                Infinite cycle
              </label>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-ruins-cadence" value="once" id="bf-rc-once">
                Jednorazovo
              </label>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-ruins-cadence" value="cycles" id="bf-rc-cycles">
                Number of cycles:
              </label>
              <input type="number" class="bf-bot-input" id="bf-ruins-cycles" value="5" min="1" max="999">
            </div>
            <div class="bf-bot-row" style="flex-wrap:wrap;gap:4px">
              <span class="bf-bot-label" style="min-width:0;flex:0 0 auto">Default interval:</span>
              <input type="number" class="bf-bot-input" id="bf-ruins-interval" value="60" min="1" max="1440" style="width:55px;flex:0 0 auto">
              <span style="color:#5a7a4a;font-size:0.6rem">min (fallback)</span>
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-top:6px;margin-bottom:3px;line-height:1.3">
              Per-band cooldown (min). 1–10 ≈ 1h, 11–100 ≈ 1:30h, 101+ depends on player.
            </div>
            <div id="bf-ruins-interval-bands" style="max-height:130px;overflow-y:auto;border:1px solid #1a3a1a;border-radius:3px;padding:4px;background:rgba(0,0,0,0.2)"></div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🔓 Unlocked Tiers</div>
            <div style="font-size:0.58rem;color:#5a7a4a;margin-bottom:4px;line-height:1.4">
              Only the selected tiers will be used by the optimizer. T1–T8.
            </div>
            <div id="bf-ruins-unlock-bar" style="display:flex;flex-wrap:wrap;gap:4px"></div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🎯 Optimization</div>
            <div style="font-size:0.58rem;color:#5a7a4a;margin-bottom:4px;line-height:1.4">
              Used when no exact preset match. Skipped entirely on preset hits.
            </div>
            <label class="bf-bot-checkbox" style="align-items:flex-start;gap:6px">
              <input type="checkbox" id="bf-ruins-opt-killE3" style="margin-top:3px">
              <span>
                ☠ Kill Tier e3 in round 1
                <span style="display:block;font-size:0.55rem;color:#5a7a4a">Requires T4 unlocked. Prevents cumulative E3 buffing.</span>
              </span>
            </label>
            <div class="bf-bot-row" style="margin-top:4px;flex-wrap:wrap;gap:4px">
              <span class="bf-bot-label" style="min-width:0;flex:0 0 auto">Mode:</span>
              <label class="bf-bot-checkbox" style="margin-right:4px;flex:0 0 auto">
                <input type="radio" name="bf-ruins-opt-mode" value="deep" id="bf-ruins-opt-mode-deep" checked>
                Deep
              </label>
              <label class="bf-bot-checkbox" style="flex:0 0 auto">
                <input type="radio" name="bf-ruins-opt-mode" value="fast" id="bf-ruins-opt-mode-fast">
                Fast
              </label>
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-ruins-opt-parallel" checked>
              Parallel Workers
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:55px">Warm-start:</span>
              <select class="bf-bot-select" id="bf-ruins-warm-source" style="flex:1">
                <option value="none">None (full search)</option>
                <option value="smart">Smart Preset (simulator)</option>
                <option value="preset">Preset Formations (this layer)</option>
              </select>
            </div>
            <div class="bf-bot-row" id="bf-ruins-warm-range-row" style="display:none;margin-top:3px">
              <span class="bf-bot-label" style="min-width:55px">Range:</span>
              <input type="number" class="bf-bot-input" id="bf-ruins-warm-range" value="15" min="1" max="200" style="width:60px">
              <span style="color:#5a7a4a;font-size:0.6rem">± units per tier</span>
            </div>
            <div id="bf-ruins-opt-t4-info" style="font-size:0.56rem;color:#5a7a4a;margin-top:5px;line-height:1.3;display:none"></div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⚔ Preset Formations</div>
            <div style="font-size:0.58rem;color:#5a7a4a;margin-bottom:4px;line-height:1.4">
              Bot compares enemy with database. Match → uses preset. No match → simulates.
            </div>
            <label class="bf-bot-checkbox" style="align-items:flex-start;gap:6px;margin-bottom:4px">
              <input type="checkbox" id="bf-ruins-ignore-presets" style="margin-top:3px">
              <span>
                🚫 Ignore presets (always use optimizer)
                <span style="display:block;font-size:0.55rem;color:#5a7a4a">Skip preset matching entirely. Presets requiring locked tiers are auto-skipped regardless.</span>
              </span>
            </label>
            <div class="bf-bot-row" style="margin-bottom:4px">
              <span class="bf-bot-label">Level:</span>
              <select class="bf-bot-select" id="bf-preset-level" style="flex:1"></select>
            </div>
            <div id="bf-preset-list" style="max-height:140px;overflow-y:auto;margin-bottom:4px"></div>
            <div class="bf-preset-add-form" id="bf-preset-add" style="display:none">
              <div style="font-size:0.6rem;color:#e0a030;margin-bottom:3px">➕ New preset for level <span id="bf-preset-add-lvl">?</span></div>
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:65px">Enemy:</span>
                <input type="text" class="bf-bot-input" id="bf-preset-enemy" placeholder="E1:2,E2:8" style="flex:1">
              </div>
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:65px">Formation:</span>
                <input type="text" class="bf-bot-input" id="bf-preset-form" placeholder="T1:20,T3:38" style="flex:1">
              </div>
              <div class="bf-bot-row" style="gap:4px">
                <button class="bf-bot-btn" id="bf-preset-save" style="flex:1;font-size:0.6rem;padding:3px 6px">💾 Save</button>
                <button class="bf-bot-btn" id="bf-preset-cancel" style="flex:0;font-size:0.6rem;padding:3px 6px;background:rgba(100,0,0,0.3)">✕</button>
              </div>
            </div>
            <button class="bf-bot-btn" id="bf-preset-add-btn" style="font-size:0.6rem;padding:3px 8px;width:100%">➕ Add Preset</button>
            <div class="bf-bot-row" style="gap:4px;margin-top:4px">
              <button class="bf-bot-btn" id="bf-preset-export" style="flex:1;font-size:0.58rem;padding:3px 6px">📤 Export CSV</button>
              <button class="bf-bot-btn" id="bf-preset-import-btn" style="flex:1;font-size:0.58rem;padding:3px 6px">📥 Import CSV</button>
              <input type="file" id="bf-preset-import-file" accept=".csv,.txt" style="display:none">
            </div>
            <div id="bf-preset-import-status" style="font-size:0.55rem;color:#e0a030;margin-top:3px;display:none"></div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🛡 Safety Conditions</div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-bottom:4px">Bot stops if conditions are not met. Protects against losses.</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-ruins-stop-nowin" checked>
              Stop if no winning formation found
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-ruins-stop-preset-short" checked>
              Stop if preset formation cannot be filled
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-ruins-stop-min-units">
              Stop if insufficient units (minimum)
            </label>
            <div id="bf-ruins-min-units-row" style="display:none;margin-top:4px">
              <div style="font-size:0.56rem;color:#5a7a4a;margin-bottom:3px">Minimum unit count (0 = ignore):</div>
              <div class="bf-bot-info-grid" style="grid-template-columns:repeat(4,1fr);width:100%">
                <div class="bf-bot-info-cell" style="text-align:center;min-width:0;overflow:hidden;padding:4px 3px">
                  <div style="color:#e0a030;font-size:0.56rem">T1</div>
                  <input type="number" class="bf-bot-input bf-min-unit-input" id="bf-ruins-min-t1" value="0" min="0">
                </div>
                <div class="bf-bot-info-cell" style="text-align:center;min-width:0;overflow:hidden;padding:4px 3px">
                  <div style="color:#e0a030;font-size:0.56rem">T2</div>
                  <input type="number" class="bf-bot-input bf-min-unit-input" id="bf-ruins-min-t2" value="0" min="0">
                </div>
                <div class="bf-bot-info-cell" style="text-align:center;min-width:0;overflow:hidden;padding:4px 3px">
                  <div style="color:#e0a030;font-size:0.56rem">T3</div>
                  <input type="number" class="bf-bot-input bf-min-unit-input" id="bf-ruins-min-t3" value="0" min="0">
                </div>
                <div class="bf-bot-info-cell" style="text-align:center;min-width:0;overflow:hidden;padding:4px 3px">
                  <div style="color:#e0a030;font-size:0.56rem">T4</div>
                  <input type="number" class="bf-bot-input bf-min-unit-input" id="bf-ruins-min-t4" value="0" min="0">
                </div>
              </div>
            </div>
            <div id="bf-ruins-t4short-row" style="margin-top:6px;display:none;border-top:1px solid #2a1218;padding-top:5px">
              <div style="font-size:0.56rem;color:#e0a030;margin-bottom:3px">Kill E3 R1 — when T4 is insufficient:</div>
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-ruins-t4short" value="stop" id="bf-ruins-t4short-stop" checked>
                Stop bot
              </label>
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-ruins-t4short" value="continue" id="bf-ruins-t4short-continue">
                Continue without E3 R1 strategy
              </label>
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-ruins-t4short" value="wait" id="bf-ruins-t4short-wait">
                Wait &amp; retry every
                <input type="number" class="bf-bot-input" id="bf-ruins-t4wait-min" value="10" min="1" max="180" style="width:50px;margin-left:4px">
                min
              </label>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📊 Army Status
              <button id="bf-army-refresh" title="Refresh army state" style="float:right;background:none;border:none;cursor:pointer;color:#5a7a4a;font-size:0.6rem">↻</button>
            </div>
            <div id="bf-army-status-grid" style="font-size:0.56rem;color:#aaa;line-height:1.4">
              <em style="color:#5a7a4a">Click ↻ to fetch live army state.</em>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📥 Auto-import New Formations</div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-bottom:4px;line-height:1.3">
              When idle, save winning formations from the "Ruins (new)" log as presets.
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-ruins-autoimport">
              Auto-import as Ruins preset
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-ruins-autoimport-smart">
              Auto-import as 🧠 Smart preset (simulator)
            </label>
            <div class="bf-bot-row" style="margin-top:4px;flex-wrap:wrap;gap:4px">
              <span class="bf-bot-label" style="min-width:0;flex:0 0 auto">Max per layer:</span>
              <input type="number" class="bf-bot-input" id="bf-ruins-autoimport-max" value="3" min="1" max="20" style="width:50px;flex:0 0 auto">
            </div>
            <div style="font-size:0.54rem;color:#5a7a4a;margin-top:3px;line-height:1.3">
              Applies to Ruins presets only. Smart presets are one-per-layer (overwrites).
            </div>
          </div>

        </div>

        <!-- STORY TAB -->
        <div class="bf-bot-section" id="bf-bot-story">
          <div class="bf-bot-info-grid">
            <div class="bf-bot-info-cell"><span class="label">AP:</span> <span class="value" id="bf-s-ap">–</span></div>
            <div class="bf-bot-info-cell"><span class="label">HP:</span> <span class="value" id="bf-s-hp">–</span></div>
          </div>

          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-story-toggle">▶ Start Story Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-story-status">Disabled</span>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⚙ Decision Priority</div>
            <div class="bf-bot-row">
              <span class="bf-bot-label">Priorita:</span>
              <select class="bf-bot-select" id="bf-story-priority">
                <option value="gold">💰 Gold</option>
                <option value="xp">⭐ Experience</option>
                <option value="health">❤ Health</option>
                <option value="aspects">🔮 Aspects</option>
              </select>
            </div>
            <div id="bf-story-aspects-panel" style="display:none;margin-top:6px">
              <div style="font-size:0.6rem;color:#e0a030;margin-bottom:4px">Aspect target values (1750/2500/5000):</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 8px">
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#e6c75a;font-size:0.58rem;min-width:72px">🧑 Humanity:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-human" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#9b59b6;font-size:0.58rem;min-width:72px">📖 Wisdom:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-knowledge" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#3498db;font-size:0.58rem;min-width:72px">⚖ Balance:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-order" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#2ecc71;font-size:0.58rem;min-width:72px">🌿 Nature:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-nature" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#e74c3c;font-size:0.58rem;min-width:72px">🐺 Bestiality:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-beast" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#e67e22;font-size:0.58rem;min-width:72px">💥 Destruction:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-destruction" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#95a5a6;font-size:0.58rem;min-width:72px">🌀 Chaos:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-chaos" value="0" min="0" max="5000" style="width:52px">
                </div>
                <div class="bf-bot-row" style="margin:0;gap:4px">
                  <span style="color:#8e44ad;font-size:0.58rem;min-width:72px">💀 Corruption:</span>
                  <input type="number" class="bf-bot-input" id="bf-aspect-corruption" value="0" min="0" max="5000" style="width:52px">
                </div>
              </div>
              <div style="font-size:0.5rem;color:#5a7a4a;margin-top:4px;line-height:1.3">
                Aspects below target will be preferred. 0 = ignore. Total 8000 points (new player 1000 per aspect).
              </div>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📋 Whitelist / Blacklist</div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:70px;color:#2ecc71">Whitelist:</span>
              <input type="text" class="bf-bot-input" id="bf-story-whitelist" placeholder="42,30,25,37..." style="flex:1">
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin:2px 0 4px;line-height:1.3">
              Highest priority decisions (comma-separated)
            </div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:70px;color:#e74c3c">Blacklist:</span>
              <input type="text" class="bf-bot-input" id="bf-story-blacklist" placeholder="31,52,26,9..." style="flex:1">
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin:2px 0 0;line-height:1.3">
              Decisions that will never be chosen
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">❤ Stay Alive</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-story-stayalive" checked>
              Automatic pause for regeneration
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-story-salm" value="pct" id="bf-story-salm-pct" checked>
                HP Percentage
              </label>
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-story-salm" value="fixed" id="bf-story-salm-fixed">
                Fixed HP Value
              </label>
            </div>
            <div id="bf-story-pct-row">
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:80px">Pauza pod:</span>
                <input type="number" class="bf-bot-input" id="bf-story-pause-pct" value="16" min="1" max="100">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:80px">Resume at:</span>
                <input type="number" class="bf-bot-input" id="bf-story-resume-pct" value="18" min="1" max="100">
                <span style="color:#5a7a4a;font-size:0.6rem">%</span>
              </div>
            </div>
            <div id="bf-story-fixed-row" style="display:none">
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:80px">Pauza pod:</span>
                <input type="number" class="bf-bot-input" id="bf-story-pause-hp" value="10000" min="100">
                <span style="color:#5a7a4a;font-size:0.6rem">HP</span>
              </div>
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:80px">Resume at:</span>
                <input type="number" class="bf-bot-input" id="bf-story-resume-hp" value="12000" min="100">
                <span style="color:#5a7a4a;font-size:0.6rem">HP</span>
              </div>
            </div>
            <label class="bf-bot-checkbox" style="margin-top:4px">
              <input type="checkbox" id="bf-story-church" checked>
              Auto-heal at church
            </label>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🎲 Decision 42 (Fortune in Misfortune)</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-story-opt42">
              Take #42 only if HP is sufficient
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:60px">Min HP:</span>
              <input type="number" class="bf-bot-input" id="bf-story-opt42-hp" value="20000" min="100">
              <span style="color:#5a7a4a;font-size:0.6rem">HP</span>
            </div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:60px">alebo:</span>
              <input type="number" class="bf-bot-input" id="bf-story-opt42-pct" value="50" min="1" max="100">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🔄 Auto Priority Switch</div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:100px">Health pod:</span>
              <input type="number" class="bf-bot-input" id="bf-story-heal-pct" value="-1" min="-1" max="100">
              <span style="color:#5a7a4a;font-size:0.56rem">% (-1 = off)</span>
            </div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:100px">Resume above:</span>
              <input type="number" class="bf-bot-input" id="bf-story-healback-pct" value="80" min="1" max="100">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
          </div>

        </div>

        <!-- GROTTO TAB (Demon Hunt) -->
        <div class="bf-bot-section" id="bf-bot-grotto">
          <div class="bf-bot-info-grid">
            <div class="bf-bot-info-cell"><span class="label">AP:</span> <span class="value" id="bf-g-ap">–</span></div>
            <div class="bf-bot-info-cell"><span class="label">HP:</span> <span class="value" id="bf-g-hp">–</span></div>
          </div>

          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-grotto-toggle">▶ Start Grotto Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-grotto-status">Disabled</span>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🦇 Demon Hunt</div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:70px">Difficulty:</span>
              <select class="bf-bot-select" id="bf-grotto-diff">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="difficult">Difficult</option>
              </select>
            </div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:70px">Count:</span>
              <input type="number" class="bf-bot-input" id="bf-grotto-count" value="0" min="0">
              <span style="color:#5a7a4a;font-size:0.56rem">(0 = neobmedzene)</span>
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-grotto-permanent">
              Unlimited mode (∞)
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:70px">Min HP:</span>
              <input type="number" class="bf-bot-input" id="bf-grotto-minhp" value="50" min="1" max="100">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">❤ Stay Alive</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-grotto-stayalive">
              Auto-protection at low HP
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-grotto-salm" value="switch" id="bf-grotto-salm-switch" checked>
                Switch to:
              </label>
              <select class="bf-bot-select" id="bf-grotto-switch-diff" style="width:auto">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="difficult">Difficult</option>
              </select>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-grotto-salm" value="church" id="bf-grotto-salm-church">
                Church – Max AP:
              </label>
              <input type="number" class="bf-bot-input" id="bf-grotto-church-ap" value="15" min="5" style="width:50px">
            </div>
          </div>
        </div>

        <!-- PVP TAB -->
        <div class="bf-bot-section" id="bf-bot-pvp">
          <div class="bf-bot-info-grid">
            <div class="bf-bot-info-cell"><span class="label">AP:</span> <span class="value" id="bf-p-ap">–</span></div>
            <div class="bf-bot-info-cell"><span class="label">HP:</span> <span class="value" id="bf-p-hp">–</span></div>
          </div>

          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-pvp-toggle">▶ Start PvP Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-pvp-status">Disabled</span>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⚔ Player vs Player</div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:70px">Attack:</span>
              <select class="bf-bot-select" id="bf-pvp-mode">
                <option value="1">Anyone</option>
                <option value="2">Stronger or equal</option>
                <option value="3">Blacklisted players (by name)</option>
                <option value="4">By battle value (range)</option>
              </select>
            </div>
            <div class="bf-bot-row" id="bf-pvp-bv-row" style="display:none;margin-top:4px">
              <span class="bf-bot-label" style="min-width:70px">BV from:</span>
              <input type="number" class="bf-bot-input" id="bf-pvp-bv-from" placeholder="9965" style="width:70px">
              <span class="bf-bot-label" style="min-width:30px;text-align:center">to:</span>
              <input type="number" class="bf-bot-input" id="bf-pvp-bv-to" placeholder="15570" style="width:70px">
            </div>
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:70px">Min HP:</span>
              <input type="number" class="bf-bot-input" id="bf-pvp-minhp" value="50" min="1" max="100">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
            <label class="bf-bot-checkbox" style="margin-top:4px">
              <input type="checkbox" id="bf-pvp-inactive" checked>
              Search for lost souls (inactive)
            </label>
          </div>

          <div class="bf-bot-group" id="bf-pvp-wl-group">
            <div class="bf-bot-group-title">📋 Whitelist (do not attack)</div>
            <input type="text" class="bf-bot-input" id="bf-pvp-whitelist" placeholder="Player1, Player2, ..." style="width:100%">
            <div style="font-size:0.56rem;color:#5a7a4a;margin:2px 0">Comma-separated</div>
          </div>

          <div class="bf-bot-group" id="bf-pvp-bl-group">
            <div class="bf-bot-group-title" style="color:#e74c3c">📋 Blacklist (attack)</div>
            <input type="text" class="bf-bot-input" id="bf-pvp-blacklist" placeholder="Player1, Player2, ..." style="width:100%">
            <div style="font-size:0.56rem;color:#5a7a4a;margin:2px 0">Comma-separated (for mode 3)</div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⏱ Smart Break</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-pvp-break">
              Pause between attacks
            </label>
            <div class="bf-bot-row" style="margin-top:4px;flex-wrap:wrap;row-gap:2px">
              <input type="number" class="bf-bot-input" id="bf-pvp-delay" value="20" min="1" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.56rem">min &nbsp;±</span>
              <input type="number" class="bf-bot-input" id="bf-pvp-margin" value="3" min="0" style="width:40px">
              <span style="color:#5a7a4a;font-size:0.56rem">min</span>
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-top:4px;line-height:1.3">
              E.g. 20±3 = pause 17–23 min between attacks (random interval).
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📊 PvP Statistics</div>
            <div class="bf-bot-info-grid" style="grid-template-columns:1fr 1fr">
              <div class="bf-bot-info-cell"><span class="label">Wins:</span> <span class="value" id="bf-pvp-wins">0</span></div>
              <div class="bf-bot-info-cell"><span class="label">Losses:</span> <span class="value" id="bf-pvp-losses">0</span></div>
            </div>
          </div>

          <!-- ── HENCHMAN VS HENCHMAN (v1.6.9) ──────────────────── -->
          <div style="height:1px;background:#1a3a1a;margin:10px 0"></div>

          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-henchman-toggle">▶ Start Henchman Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-henchman-status">Disabled</span>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🗡 Henchman vs Henchman</div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-bottom:4px;line-height:1.3">
              Sends your henchman to fight the opponent's henchman. Costs 1 AP.
              Mutually exclusive with PvP — starting one stops the other.
            </div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:70px">Attack:</span>
              <select class="bf-bot-select" id="bf-henchman-mode">
                <option value="1">Anyone (skip blacklist)</option>
                <option value="2">Whitelist only (by name)</option>
              </select>
            </div>
            <label class="bf-bot-checkbox" style="margin-top:4px">
              <input type="checkbox" id="bf-henchman-own-race">
              <span style="flex:1;min-width:0">⚔ Attack own race
                <span style="display:block;color:#5a7a4a;font-size:0.55rem;margin-top:1px;font-weight:normal">When the game shows the cross-race confirmation modal ("includes both werewolves and vampires"), auto-confirm it. Off = skip same-race targets and re-search.</span>
              </span>
            </label>
          </div>

          <div class="bf-bot-group" id="bf-henchman-wl-group">
            <div class="bf-bot-group-title">📋 Whitelist (attack)</div>
            <input type="text" class="bf-bot-input" id="bf-henchman-whitelist" placeholder="Player1, Player2, ..." style="width:100%">
            <div style="font-size:0.56rem;color:#5a7a4a;margin:2px 0">
              Comma-separated. Used by "Whitelist only" mode — these names get attacked.
            </div>
          </div>

          <div class="bf-bot-group" id="bf-henchman-bl-group">
            <div class="bf-bot-group-title" style="color:#e74c3c">📋 Blacklist (do not attack)</div>
            <input type="text" class="bf-bot-input" id="bf-henchman-blacklist" placeholder="Player1, Player2, ..." style="width:100%">
            <div style="font-size:0.56rem;color:#5a7a4a;margin:2px 0">
              Comma-separated. Used by "Anyone" mode — random results matching these names get skipped.
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⏱ Smart Break</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-henchman-break">
              Pause between attacks
            </label>
            <div class="bf-bot-row" style="margin-top:4px;flex-wrap:wrap;row-gap:2px">
              <input type="number" class="bf-bot-input" id="bf-henchman-delay" value="20" min="1" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.56rem">min &nbsp;±</span>
              <input type="number" class="bf-bot-input" id="bf-henchman-margin" value="3" min="0" style="width:40px">
              <span style="color:#5a7a4a;font-size:0.56rem">min</span>
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-top:4px;line-height:1.3">
              E.g. 20±3 = pause 17–23 min between attacks (random interval).
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📊 Henchman Statistics</div>
            <div class="bf-bot-info-grid" style="grid-template-columns:1fr 1fr">
              <div class="bf-bot-info-cell"><span class="label">Wins:</span> <span class="value" id="bf-henchman-wins">0</span></div>
              <div class="bf-bot-info-cell"><span class="label">Losses:</span> <span class="value" id="bf-henchman-losses">0</span></div>
            </div>
          </div>
        </div>

        <!-- GIFTS TAB -->
        <div class="bf-bot-section" id="bf-bot-gifts">
          <div class="bf-bot-group">
            <div class="bf-bot-group-title">💎 Dark Blue Gifts</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-gifts-dbg">
              Auto-open Dark Blue Gifts below:
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <input type="number" class="bf-bot-input" id="bf-gifts-dbg-ap" value="5" min="0" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.56rem">AP</span>
            </div>
            <label class="bf-bot-checkbox" style="margin-top:4px">
              <input type="checkbox" id="bf-gifts-disable-event">
              Disable after Double AP event ends
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-gifts-cave-time">
              Maximize grotto time (open gifts only after AP depleted)
            </label>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-top:4px;line-height:1.3">
              Opens Dark Blue Gifts during Story, Grotto or Hunt mode when AP drops below limit.
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">💜 Purple Gifts</div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-gifts-purple" value="none" id="bf-gifts-pg-none" checked>
                Do not open
              </label>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-gifts-purple" value="unlimited" id="bf-gifts-pg-unlimited">
                Open until I press stop
              </label>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-gifts-purple" value="gold_target" id="bf-gifts-pg-gold">
                Goal (gold):
              </label>
              <input type="number" class="bf-bot-input" id="bf-gifts-pg-gold-val" value="100000" min="0" style="width:90px">
              <span style="color:#5a7a4a;font-size:0.56rem">Gold</span>
            </div>
            <div class="bf-bot-row">
              <label class="bf-bot-checkbox">
                <input type="radio" name="bf-gifts-purple" value="qty_target" id="bf-gifts-pg-qty">
                Goal (count):
              </label>
              <input type="number" class="bf-bot-input" id="bf-gifts-pg-qty-val" value="10" min="1" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.56rem">x Darov</span>
            </div>
            <label class="bf-bot-checkbox" style="margin-top:4px">
              <input type="checkbox" id="bf-gifts-pg-spend">
              Spend gift gold on skills
            </label>
          </div>

          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-gifts-toggle" style="background:rgba(128,0,128,0.15)">▶ Open Purple Gifts</button>
          <div class="bf-bot-status">
            <span class="status-text">Status:</span>
            <span class="status-value" id="bf-gifts-status">Disabled</span>
          </div>
        </div>

        <!-- GLOBAL TAB -->
        <div class="bf-bot-section" id="bf-bot-global">
          <div class="bf-bot-group" id="bf-server-info-block">
            <div class="bf-bot-group-title">🌐 Server</div>
            <div style="font-size:0.66rem;color:#9a7a5a">${SERVER_ID}</div>
            <div style="font-size:0.62rem;color:#7a9a6a;margin-top:2px" id="bf-global-player-badge">${PLAYER_ID ? '👤 Player: #' + PLAYER_ID : '👤 Player: detecting...'}</div>
          </div>
          <div class="bf-bot-group">
            <div class="bf-bot-group-title">💰 Gold</div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:90px">Spend gold on:</span>
              <select class="bf-bot-select" id="bf-gold-mode">
                <option value="0">Don't spend</option>
                <option value="1">Upgrade skills</option>
                <option value="2">Donate to clan</option>
              </select>
            </div>
            <div id="bf-gold-skills-panel" style="display:none;margin-top:4px">
              <div style="font-size:0.6rem;color:#e0a030;margin-bottom:3px">Attributes to upgrade:</div>
              <div class="bf-ignore-q-row">
                <label class="bf-q-check"><input type="checkbox" value="sr_" data-gsk> <span class="bf-q-badge" style="background:rgba(231,76,60,0.15);color:#e74c3c;border-color:#e74c3c">STR</span></label>
                <label class="bf-q-check"><input type="checkbox" value="df_" data-gsk> <span class="bf-q-badge" style="background:rgba(52,152,219,0.15);color:#3498db;border-color:#3498db">DEF</span></label>
                <label class="bf-q-check"><input type="checkbox" value="dx_" data-gsk> <span class="bf-q-badge" style="background:rgba(46,204,113,0.15);color:#2ecc71;border-color:#2ecc71">DEX</span></label>
                <label class="bf-q-check"><input type="checkbox" value="ed_" data-gsk> <span class="bf-q-badge" style="background:rgba(230,126,34,0.15);color:#e67e22;border-color:#e67e22">END</span></label>
                <label class="bf-q-check"><input type="checkbox" value="cr_" data-gsk> <span class="bf-q-badge" style="background:rgba(155,89,182,0.15);color:#9b59b6;border-color:#9b59b6">CHA</span></label>
              </div>
            </div>
            <div id="bf-gold-donate-panel" style="display:none;margin-top:4px">
              <div class="bf-bot-row" style="flex-wrap:wrap;gap:4px;align-items:center">
                <span class="bf-bot-label" style="min-width:70px">Min Gold:</span>
                <input type="number" class="bf-bot-input" id="bf-gold-donate-min" value="10000" min="0" style="width:80px;flex:0 0 auto">
                <span class="bf-help-hint" title="TRIGGER threshold (anti-raid protection).&#10;&#10;When your gold ≥ this value, the bot WILL donate everything above the Keep amount to the clan. It will preempt other modules — gold above threshold attracts raids and cannot sit.&#10;&#10;Example:&#10;  Min Gold = 20,000, Keep = 0&#10;  • You have 19,999 → bot does NOT donate yet&#10;  • You have 20,000+ → bot donates EVERYTHING (minus Keep)&#10;&#10;Min is the trigger, NOT the donation amount.">?</span>
              </div>
              <label class="bf-bot-checkbox" style="align-items:flex-start;gap:6px">
                <input type="checkbox" id="bf-gold-donate-all" style="margin-top:3px">
                <span>
                  Donate all gold (idle mode)
                  <span class="bf-help-hint" title="When ON: donate everything above Keep on every tick, regardless of the Min Gold threshold. Use during idle/cooldown periods (yellow/white indicator states) so gold keeps flowing to the clan even when no raid threat is imminent.&#10;&#10;When OFF: only donate when the Min Gold threshold is reached.&#10;&#10;Both modes respect the Keep amount.">?</span>
                  <span style="display:block;font-size:0.55rem;color:#5a7a4a">Donates on every tick, not only when threshold is reached.</span>
                </span>
              </label>
            </div>
            <div class="bf-bot-row" style="margin-top:4px;align-items:center;flex-wrap:wrap;gap:4px">
              <label class="bf-bot-checkbox" style="flex:0 0 auto;margin:0;white-space:nowrap">
                <input type="checkbox" id="bf-gold-keep">
                Keep:
              </label>
              <input type="number" class="bf-bot-input" id="bf-gold-keep-val" value="0" min="0" style="width:70px;flex:0 0 auto">
              <span style="color:#5a7a4a;font-size:0.56rem;flex:0 0 auto">Gold</span>
              <span class="bf-help-hint" title="Reserve buffer kept on your character.&#10;&#10;The bot will never spend / donate below this amount. The actual donation amount = (current gold) − (Keep).&#10;&#10;Example:&#10;  Gold = 1,200,000, Keep = 50,000&#10;  Bot donates 1,150,000, you keep 50,000.">?</span>
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-gold-potion-buffer">
              Buffer gold for Potion
            </label>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🪦 Graveyard</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-graveyard-enabled">
              Auto graveyard
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:60px">Work:</span>
              <select class="bf-bot-select" id="bf-graveyard-worktime-ap" style="width:auto">
                <option value="1">1h</option>
                <option value="2" selected>2h</option>
                <option value="3">3h</option>
                <option value="4">4h</option>
                <option value="5">5h</option>
                <option value="6">6h</option>
                <option value="7">7h</option>
                <option value="8">8h</option>
              </select>
              <span style="color:#5a7a4a;font-size:0.56rem">when AP &lt;</span>
              <input type="number" class="bf-bot-input" id="bf-graveyard-minap" value="5" min="0" style="width:40px">
            </div>
            <div class="bf-bot-row">
              <span class="bf-bot-label" style="min-width:60px">Work:</span>
              <select class="bf-bot-select" id="bf-graveyard-worktime-hp" style="width:auto">
                <option value="1">1h</option>
                <option value="2" selected>2h</option>
                <option value="3">3h</option>
                <option value="4">4h</option>
                <option value="5">5h</option>
                <option value="6">6h</option>
                <option value="7">7h</option>
                <option value="8">8h</option>
              </select>
              <span style="color:#5a7a4a;font-size:0.56rem">when HP &lt;</span>
              <input type="number" class="bf-bot-input" id="bf-graveyard-minhp" value="20" min="0" max="100" style="width:40px">
              <span style="color:#5a7a4a;font-size:0.56rem">%</span>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🗑 Inventory Cleanup</div>
            <div style="font-size:0.55rem;color:#7a9a6a;margin-bottom:6px;font-style:italic;line-height:1.3">
              Auto-discards low-level drop items from the inventory (Omega items, ruins loot). Only items that show a Discard button in-game are touched — equipped items, elixirs, and gifts are never touched.
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-invdisc-enabled">
              <span style="flex:1;min-width:0">Enable Inventory Cleanup
                <span class="bf-help-hint" title="When ON, the bot will scan your /profile/index inventory during idle periods and discard items whose level requirement is at or below the configured Max Level. Discard is IRREVERSIBLE in-game — preview before turning on Auto mode.">?</span>
              </span>
            </label>
            <div id="bf-invdisc-panel" style="margin-left:18px;display:none;min-width:0">
              <div class="bf-bot-row" style="margin-top:4px;align-items:center;gap:6px;flex-wrap:wrap">
                <span class="bf-bot-label" style="min-width:70px">Mode:</span>
                <select class="bf-bot-select" id="bf-invdisc-mode" style="flex:0 1 auto">
                  <option value="manual">Manual (button only)</option>
                  <option value="auto">Auto (scheduled)</option>
                </select>
                <span class="bf-help-hint" title="Manual = only runs when you press the Run Now button. Auto = runs on a schedule (daily / weekly / every N hours), during any idle period (yellow/white indicator).">?</span>
              </div>
              <div id="bf-invdisc-auto-panel" style="display:none">
                <div class="bf-bot-row" style="align-items:center;gap:6px;flex-wrap:wrap">
                  <span class="bf-bot-label" style="min-width:70px">Frequency:</span>
                  <select class="bf-bot-select" id="bf-invdisc-freq" style="flex:0 1 auto">
                    <option value="daily">Once per day</option>
                    <option value="weekly">Once per week</option>
                    <option value="custom">Custom interval</option>
                  </select>
                </div>
                <div class="bf-bot-row" id="bf-invdisc-custom-row" style="display:none;align-items:center;gap:6px;flex-wrap:wrap">
                  <span class="bf-bot-label" style="min-width:70px">Every:</span>
                  <input type="number" class="bf-bot-input" id="bf-invdisc-custom-hours" value="12" min="1" max="720" style="width:60px">
                  <span style="color:#5a7a4a;font-size:0.56rem">hours</span>
                </div>
              </div>
              <div class="bf-bot-row" style="align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px">
                <span class="bf-bot-label" style="min-width:70px">Max level:</span>
                <input type="number" class="bf-bot-input" id="bf-invdisc-maxlvl" value="1000" min="1" max="9999" style="width:70px">
                <span class="bf-help-hint" title="Items requiring this level OR LOWER will be discarded. Items needing a higher level are kept.&#10;&#10;Example:&#10;  Max level = 1000&#10;  • Item needs level 150 → DISCARD&#10;  • Item needs level 999 → DISCARD&#10;  • Item needs level 1001 → KEEP">?</span>
              </div>
              <div class="bf-bot-row" style="align-items:center;gap:6px;flex-wrap:wrap">
                <span class="bf-bot-label" style="min-width:70px">Min level:</span>
                <input type="number" class="bf-bot-input" id="bf-invdisc-minlvl" value="0" min="0" max="9999" style="width:70px">
                <span class="bf-help-hint" title="Items requiring LESS than this level are kept. Use 0 to disable the floor.&#10;&#10;Useful to keep very-low-level newbie items (e.g. Min 100 / Max 1000 → only discard items between level 100 and 1000).">?</span>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px">
                <button type="button" class="bf-bot-btn" id="bf-invdisc-run-now" style="font-size:0.62rem;padding:5px 12px;width:auto;flex:0 0 auto;background:linear-gradient(180deg,#5a2a2a,#3a1a1a)">🗑 Run Now</button>
                <button type="button" class="bf-bot-btn" id="bf-invdisc-preview" style="font-size:0.62rem;padding:5px 12px;width:auto;flex:0 0 auto;background:#2a2a3a">👁 Preview</button>
              </div>
              <div id="bf-invdisc-status" style="margin-top:6px;font-size:0.56rem;color:#7a9a6a;line-height:1.5;padding:4px 6px;background:#080808;border:1px solid #2a2a2a;border-radius:3px"></div>
              <div id="bf-invdisc-preview-out" style="display:none;margin-top:6px;font-size:0.56rem;color:#cccccc;line-height:1.4;max-height:160px;overflow-y:auto;padding:4px 6px;background:#0a0a0a;border:1px solid #3a3a3a;border-radius:3px"></div>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">💊 Potions</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-potion-energy">
              Energy Potion pod:
            </label>
            <div class="bf-bot-row" style="margin-left:18px">
              <input type="number" class="bf-bot-input" id="bf-potion-energy-ap" value="3" min="0" style="width:40px">
              <span style="color:#5a7a4a;font-size:0.56rem">AP</span>
            </div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-potion-soup">
              Soup of Life
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-potion-medium">
              Medium Healing Potion
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-potion-blood">
              Blood Potion
            </label>
            <label class="bf-bot-checkbox" style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.05);padding-top:4px">
              <input type="checkbox" id="bf-potion-autobuy">
              Auto-buy when depleted
            </label>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📅 Schedule</div>
            <div style="font-size:0.55rem;color:#7a9a6a;margin-bottom:6px;font-style:italic;line-height:1.3">
              Bot automatically enables selected modules during specific time windows. Outside all slots, all bots pause.
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <label class="bf-bot-checkbox" style="margin-bottom:0">
                <input type="checkbox" id="bf-schedule-enabled">
                Schedule active
              </label>
              <span id="bf-schedule-status" style="font-size:0.6rem;color:#7a9a6a;margin-left:auto">--</span>
            </div>
            <div id="bf-layout-bar" class="bf-layout-bar">
              <span class="bf-layout-lbl">Layout:</span>
              <select id="bf-layout-sel" class="bf-bot-select bf-layout-sel"></select>
              <button id="bf-layout-rename" type="button" class="bf-layout-btn" title="Rename active layout">✏</button>
              <button id="bf-layout-new"    type="button" class="bf-layout-btn" title="Add new layout">➕</button>
              <button id="bf-layout-dup"    type="button" class="bf-layout-btn" title="Duplicate active layout">📋</button>
              <button id="bf-layout-del"    type="button" class="bf-layout-btn danger" title="Delete active layout">🗑</button>
            </div>
            <div id="bf-schedule-list" style="margin-bottom:8px"></div>
            <button id="bf-schedule-add" type="button" class="bf-bot-btn" style="font-size:0.62rem;padding:4px 10px;width:auto">📅 + Add slot</button>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🔧 Other</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-auto-clan-war">
              Auto-join clan war
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-fixed-infobar">
              Fixed infobar on scroll
            </label>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-bg-refresh">
              <span style="flex:1;min-width:0">🔄 Background Refresh (Smart Wake-Up)
                <span style="display:block;color:#5a7a4a;font-size:0.55rem;margin-top:1px;font-weight:normal;line-height:1.3">Periodically reloads the page so the bot can re-tick from a fresh DOM.</span>
              </span>
            </label>
            <div id="bf-bg-refresh-panel" style="margin-left:18px;display:none;min-width:0">
              <div class="bf-bot-row" style="font-size:0.58rem;gap:6px;flex-wrap:wrap">
                <span style="color:#9a7a5a;flex:1 1 auto;min-width:0">Interval (min):</span>
                <input type="number" class="bf-bot-input" id="bf-bg-refresh-interval" value="60" min="1" max="600" style="width:52px;flex:0 0 52px;text-align:center">
              </div>
              <div class="bf-bot-row" style="font-size:0.58rem;gap:6px;flex-wrap:wrap">
                <span style="color:#9a7a5a;flex:1 1 auto;min-width:0">Randomize (±min):</span>
                <input type="number" class="bf-bot-input" id="bf-bg-refresh-rand" value="5" min="0" max="60" style="width:52px;flex:0 0 52px;text-align:center">
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:0.56rem;padding:4px 6px;background:#080808;border:1px solid #2a2a2a;border-radius:3px;margin-top:2px">
                <span style="color:#9a7a5a">⏱ Next refresh:</span>
                <span id="bf-bg-refresh-eta" style="color:#2ecc71;font-weight:bold">--</span>
              </div>
            </div>
          </div>
        </div>

        <!-- LOG TAB -->
        <div class="bf-bot-section" id="bf-bot-log-tab">
          <div class="bf-bot-log" id="bf-bot-log">
            <div class="bf-log-entry"><span class="bf-log-time">–</span> <span class="bf-log-info">Bot ready. Configure and start.</span></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // ── EVENT DELEGATION ───────────────────────────────────────
    // Pin button
    const pinBtn = document.getElementById('bf-bot-pin');
    sGet([SK('panelPinned')], r => {
      const pinned = r[SK('panelPinned')] === true;
      pinBtn.classList.toggle('active', pinned);
      pinBtn.style.opacity = pinned ? '1' : '0.4';
      // Auto-open ONLY if pinned
      if (pinned) {
        panel.style.display = 'flex';
      }
    });

    pinBtn.addEventListener('click', () => {
      sGet([SK('panelPinned')], r => {
        const newPinned = !(r[SK('panelPinned')] === true);
        sSet({ [SK('panelPinned')]: newPinned });
        pinBtn.classList.toggle('active', newPinned);
        pinBtn.style.opacity = newPinned ? '1' : '0.4';
        botLog('info', newPinned ? 'Panel pinned 📌 — stays open after reload' : 'Panel unpinned');
      });
    });

    // Toggle button (ignore clicks on central stop button)
    btn.addEventListener('click', (e) => {
      if (e.target.closest('#bf-central-stop')) return;
      const open = panel.style.display !== 'none' && panel.style.display !== '';
      panel.style.display = open ? 'none' : 'flex';
    });

    // ── CENTRAL STOP BUTTON ────────────────────────────────────
    const centralStopBtn = document.getElementById('bf-central-stop');
    // Init from storage
    sGet([SK('centralStop')], r => {
      if (r[SK('centralStop')] === true) {
        centralStopBtn.classList.add('engaged');
        updateStatusDot();
      }
    });
    centralStopBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't toggle panel
      sGet([SK('centralStop')], r => {
        const wasEngaged = r[SK('centralStop')] === true;
        const newState = !wasEngaged;
        _centralStopActive = newState; // sync cache IMMEDIATELY
        if (newState) {
          // Cancel ALL pending bot timers/intervals RIGHT NOW before async write
          cancelAllBotTimers();
          // v1.6.7 — also reset schedule watcher ID so startScheduleWatcher
          // can re-arm it after release (the interval itself was killed above).
          _scheduleWatcherId = null;
        }
        sSet({ [SK('centralStop')]: newState }, () => {
          centralStopBtn.classList.toggle('engaged', newState);
          if (newState) {
            botLog('warn', '🛑 CENTRAL STOP ENGAGED — all bots halted');
          } else {
            botLog('info', '✅ Central STOP released — bots resuming');
            // Re-trigger botTick to resume where left off
            loadState(st => { loadSettings(se => {
              updateStatusDot(se, st);
              botSetTimeout(() => botTick(st, se), randomDelay(500, 1500));
              // v1.6.10 — re-arm background refresh (cancelAllBotTimers cleared its timer)
              if (se.backgroundRefresh) bgRefreshSchedule(false);
            }); });
            // v1.6.7 — re-arm schedule watcher (cancelAllBotTimers cleared it)
            _scheduleWatcherId = null;
            botSetTimeout(startScheduleWatcher, 1500);
          }
          updateStatusDot();
        });
      });
    });

    // Close
    document.getElementById('bf-bot-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    // Tabs (with persistence)
    panel.addEventListener('click', (e) => {
      const tab = e.target.closest('.bf-bot-tab[data-tab]');
      if (tab) {
        panel.querySelectorAll('.bf-bot-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.bf-bot-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        const sectionMap = { hunt: 'bf-bot-hunt', story: 'bf-bot-story', ruins: 'bf-bot-ruins', grotto: 'bf-bot-grotto', pvp: 'bf-bot-pvp', gifts: 'bf-bot-gifts', global: 'bf-bot-global', log: 'bf-bot-log-tab' };
        const tabName = tab.getAttribute('data-tab');
        const sec = document.getElementById(sectionMap[tabName]);
        if (sec) sec.classList.add('active');
        // Persist active tab
        sSet({ [SK('activeTab')]: tabName });
      }
    });

    // Restore persisted tab
    sGet([SK('activeTab')], r => {
      const savedTab = r[SK('activeTab')];
      if (savedTab) {
        const sectionMap = { hunt: 'bf-bot-hunt', story: 'bf-bot-story', ruins: 'bf-bot-ruins', grotto: 'bf-bot-grotto', pvp: 'bf-bot-pvp', gifts: 'bf-bot-gifts', global: 'bf-bot-global', log: 'bf-bot-log-tab' };
        const tabEl = panel.querySelector(`.bf-bot-tab[data-tab="${savedTab}"]`);
        const secEl = document.getElementById(sectionMap[savedTab]);
        if (tabEl && secEl) {
          panel.querySelectorAll('.bf-bot-tab').forEach(t => t.classList.remove('active'));
          panel.querySelectorAll('.bf-bot-section').forEach(s => s.classList.remove('active'));
          tabEl.classList.add('active');
          secEl.classList.add('active');
        }
      }
    });

    // Hunt mode radio
    panel.addEventListener('change', (e) => {
      if (e.target.name === 'bf-hunt-mode') {
        const manual = e.target.value === 'manual';
        document.getElementById('bf-manual-type-row').style.display = manual ? 'flex' : 'none';
        document.getElementById('bf-manual-quality-row').style.display = manual ? 'flex' : 'none';
        document.getElementById('bf-auto-rules').style.display = manual ? 'none' : 'block';
      }
    });

    // Ruins level grid drag-paint selection is wired in buildRuinsGrid()
    // via pointer events. The old click-toggle handler is no longer needed.

    // Lock toggle for the level grid
    document.getElementById('bf-ruins-lock-btn')?.addEventListener('click', () => {
      loadSettings(se => {
        se.ruinsLevelsLocked = !se.ruinsLevelsLocked;
        saveSettings(se);
        applyRuinsLockState(se.ruinsLevelsLocked);
      });
    });

    // Custom input — persist immediately on change (union into ruinsLevels)
    document.getElementById('bf-ruins-custom')?.addEventListener('change', () => {
      loadSettings(se => {
        if (se.ruinsLevelsLocked) return;
        se.ruinsLevels = readGridAndCustomLevels();
        saveSettings(se);
      });
    });

    // Hunt toggle
    document.getElementById('bf-hunt-toggle').addEventListener('click', () => {
      loadSettings((settings) => {
        settings.huntEnabled = !settings.huntEnabled;
        // Gather UI values
        settings.huntMode = document.querySelector('input[name="bf-hunt-mode"]:checked')?.value || 'auto';
        settings.huntManualType = parseInt(document.getElementById('bf-manual-type')?.value) || 5;
        settings.extractEnabled = document.getElementById('bf-extract-enabled')?.checked ?? true;
        settings.extractAutoRepeat = document.getElementById('bf-extract-repeat')?.checked ?? true;
        // ── Auto Recruitment (v1.6.5 — defensive save) ─────────
        // Only overwrite a recruit field if its DOM element is actually
        // present + readable. This prevents the v1.6.4 bug where toggling
        // Hunt from a state with no recruit-panel rendering wiped tiers and
        // priority back to defaults.
        const recEn = document.getElementById('bf-recruit-enabled');
        if (recEn) settings.recruitEnabled = !!recEn.checked;
        const recTrig = document.getElementById('bf-recruit-trigger');
        if (recTrig) settings.recruitTrigger = recTrig.value || 'idle';
        const recTh = document.getElementById('bf-recruit-threshold');
        if (recTh) settings.recruitThreshold = parseInt(recTh.value) || 100;
        const recStrat = document.getElementById('bf-recruit-strategy');
        if (recStrat) settings.recruitStrategy = recStrat.value || 'priority';
        const recRes = document.getElementById('bf-recruit-reserve');
        if (recRes) settings.recruitReserveBE = parseInt(recRes.value) || 0;
        // Percent allocation (T1-T8) — only update if at least one input exists
        const pctInputs = document.querySelectorAll('.bf-recruit-pct');
        if (pctInputs.length > 0) {
          const recruitPct = {};
          pctInputs.forEach(inp => {
            const unitId = inp.dataset.unit;
            if (unitId) recruitPct[unitId] = parseInt(inp.value) || 0;
          });
          settings.recruitPercent = recruitPct;
        }
        // Priority list — only update if rows were rendered
        const prioRows = document.querySelectorAll('#bf-recruit-priority-list .bf-recruit-prio-row');
        if (prioRows.length > 0) {
          settings.recruitEnabledTiers = readEnabledTiersFromDOM();
          settings.recruitPriority = readPriorityOrderFromDOM();
        }
        // Gather ignore qualities
        settings.huntIgnoreQ = [...document.querySelectorAll('#bf-ignore-q input[data-iq]:checked')].map(cb => cb.value);
        // Gather manual mode accept qualities
        settings.huntManualAcceptQ = [...document.querySelectorAll('#bf-manual-accept-q input[data-maq]:checked')].map(cb => cb.value);

        saveSettings(settings);

        if (settings.huntEnabled) {
          loadState((state) => {
            // ── COOLDOWN PERSISTENCE: check if orbWaitUntil is still valid ──
            const savedUntil = state.orbWaitUntil || 0;
            // Also check live page for real cooldown data
            const orbs = readOrbsOnRobberyPage();
            let realUntil = 0;
            if (orbs.maxRemaining && orbs.maxRemaining > 0 && orbs.ready === 0) {
              realUntil = Date.now() + orbs.maxRemaining * 1000;
            }
            // Use the more accurate value (prefer page data, fall back to saved)
            const effectiveUntil = realUntil > Date.now() ? realUntil : savedUntil;

            if (effectiveUntil > Date.now() && settings.extractAutoRepeat) {
              // Cooldown still active → restore waiting_orb state
              state.huntState = 'waiting_orb';
              state.orbWaitUntil = effectiveUntil;
              const remainMin = Math.ceil((effectiveUntil - Date.now()) / 60000);
              botLog('info', `Restored orb cooldown: ${Math.floor(remainMin/60)}h ${remainMin%60}m remaining`);
              saveState(state);
              updateHuntUI(settings, state);
              startCooldownTicker(settings, state);
              // Kick off ruins if enabled (cooperative mode)
              if (settings.ruinsEnabled && state.ruinsState !== 'done') {
                botLog('info', 'Hunt on cooldown → Starting Ruins');
                botSetTimeout(() => {
                  loadState(st => { loadSettings(se => {
                    if (se.ruinsEnabled && st.ruinsState !== 'done') ruinsTick(st, se);
                  }); });
                }, randomDelay(2000, 4000));
              }
              return;
            }
            state.huntState = 'idle';
            state.extractionsThisSession = 0;
            saveState(state);
            botLog('ok', 'Hunt Bot STARTED');
            updateHuntUI(settings, state);
            // Start tick
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          });
        } else {
          loadState((state) => {
            state.huntState = 'idle';
            saveState(state);
            botLog('warn', 'Hunt Bot STOPPED');
            updateHuntUI(settings, state);
          });
        }
      });
    });

    // Ruins toggle
    document.getElementById('bf-ruins-toggle').addEventListener('click', () => {
      loadSettings((settings) => {
        settings.ruinsEnabled = !settings.ruinsEnabled;
        // Gather UI values
        settings.ruinsLevels = getSelectedRuinsLevels();
        settings.ruinsCadence = document.querySelector('input[name="bf-ruins-cadence"]:checked')?.value || 'infinite';
        settings.ruinsCycles = parseInt(document.getElementById('bf-ruins-cycles')?.value) || 5;
        settings.ruinsIntervalMin = parseInt(document.getElementById('bf-ruins-interval')?.value) || 60;
        // v1.5.9 — gather per-band intervals
        const bands = settings.ruinsIntervalBands || {};
        document.querySelectorAll('#bf-ruins-interval-bands .bf-ruins-band-input').forEach(inp => {
          const band = inp.getAttribute('data-band');
          const v = parseInt(inp.value);
          if (band && v > 0 && v <= 1440) bands[band] = v;
        });
        settings.ruinsIntervalBands = bands;
        // Safety settings
        settings.ruinsStopNoWin = document.getElementById('bf-ruins-stop-nowin')?.checked ?? true;
        settings.ruinsStopPresetShort = document.getElementById('bf-ruins-stop-preset-short')?.checked ?? true;
        settings.ruinsIgnorePresets = document.getElementById('bf-ruins-ignore-presets')?.checked ?? false;
        settings.ruinsStopMinUnits = document.getElementById('bf-ruins-stop-min-units')?.checked ?? false;
        settings.ruinsMinUnits = {
          T1: parseInt(document.getElementById('bf-ruins-min-t1')?.value) || 0,
          T2: parseInt(document.getElementById('bf-ruins-min-t2')?.value) || 0,
          T3: parseInt(document.getElementById('bf-ruins-min-t3')?.value) || 0,
          T4: parseInt(document.getElementById('bf-ruins-min-t4')?.value) || 0,
        };
        // v1.5.8 — UNLOCKED tiers
        const unlocks = [];
        document.querySelectorAll('#bf-ruins-unlock-bar [data-rt]').forEach(btn => {
          if (btn.dataset.unlocked === '1') unlocks.push(btn.getAttribute('data-rt'));
        });
        if (unlocks.length) settings.ruinsAllyUnlocks = unlocks;
        // v1.5.8 — Optimization
        settings.ruinsOptStratKillE3 = document.getElementById('bf-ruins-opt-killE3')?.checked ?? false;
        settings.ruinsOptMode = document.querySelector('input[name="bf-ruins-opt-mode"]:checked')?.value || 'deep';
        settings.ruinsOptParallel = document.getElementById('bf-ruins-opt-parallel')?.checked ?? true;
        settings.ruinsWarmStartSource = document.getElementById('bf-ruins-warm-source')?.value || 'none';
        settings.ruinsWarmStartRange = parseInt(document.getElementById('bf-ruins-warm-range')?.value) || 15;
        // v1.5.8 — T4 short action
        settings.ruinsT4ShortAction = document.querySelector('input[name="bf-ruins-t4short"]:checked')?.value || 'stop';
        settings.ruinsT4WaitMin = parseInt(document.getElementById('bf-ruins-t4wait-min')?.value) || 10;
        // v1.5.8 — Auto-import
        settings.ruinsAutoImportNew = document.getElementById('bf-ruins-autoimport')?.checked ?? false;
        settings.ruinsAutoImportMaxPerLevel = parseInt(document.getElementById('bf-ruins-autoimport-max')?.value) || 3;
        // v1.5.9 — Auto-import as Smart preset
        settings.ruinsAutoImportSmart = document.getElementById('bf-ruins-autoimport-smart')?.checked ?? false;

        saveSettings(settings);

        if (settings.ruinsEnabled) {
          loadState((state) => {
            state.ruinsState = 'idle';
            state.ruinsCurrentIdx = 0;
            state.ruinsCurrentCycle = 1;
            saveState(state);
            botLog('ok', `Ruins Bot STARTED (${settings.ruinsLevels.length} levels, ${settings.ruinsCadence})`);
            updateRuinsUI(settings, state);
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          });
        } else {
          loadState((state) => {
            state.ruinsState = 'idle';
            saveState(state);
            botLog('warn', 'Ruins Bot STOPPED');
            updateRuinsUI(settings, state);
          });
        }
      });
    });

    // ── PRESET FORMATION MANAGEMENT ───────────────────────────
    // Storage: ruinsPresets = { "4": [{ enemy: "E1:2,E2:8", formation: {T1:20,T3:38} }], ... }
    function getPresetsKey() { return SK('ruinsPresets'); }

    function loadPresets(cb) {
      sGet([getPresetsKey()], r => cb(r[getPresetsKey()] || {}));
    }

    function savePresets(presets) {
      sSet({ [getPresetsKey()]: presets });
    }

    function parseQtyString(str) {
      // "E1:2,E2:8" → {E1:2, E2:8}
      const obj = {};
      str.split(',').forEach(part => {
        const [k, v] = part.trim().split(':');
        if (k && v) obj[k.trim().toUpperCase()] = parseInt(v.trim()) || 0;
      });
      return obj;
    }

    function enemyFingerprint(enemyQtys) {
      // Canonical string for matching: sorted "E1:2,E2:8"
      return Object.entries(enemyQtys).filter(([,v]) => v > 0).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join(',');
    }

    // Populate level dropdown
    function initPresetLevelDropdown() {
      const sel = document.getElementById('bf-preset-level');
      if (!sel) return;
      sel.innerHTML = '';
      for (let i = 1; i <= 30; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `Level ${i}`;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => renderPresetList());
    }

    function renderPresetList() {
      const lvl = document.getElementById('bf-preset-level')?.value || '1';
      const container = document.getElementById('bf-preset-list');
      if (!container) return;

      loadPresets(presets => {
        const items = presets[lvl] || [];
        if (!items.length) {
          container.innerHTML = '<div style="font-size:0.58rem;color:#444;padding:4px;text-align:center">No presets for this level</div>';
          return;
        }
        container.innerHTML = items.map((p, i) => `
          <div class="bf-preset-card">
            <div class="bf-preset-enemy">👹 ${p.enemy}</div>
            <div class="bf-preset-form">⚔ ${qtyToString(p.formation)}</div>
            <button class="bf-preset-del" data-lvl="${lvl}" data-idx="${i}" title="Remove">🗑</button>
          </div>
        `).join('');

        // Delete handlers
        container.querySelectorAll('.bf-preset-del').forEach(btn => {
          btn.addEventListener('click', () => {
            const l = btn.getAttribute('data-lvl');
            const idx = parseInt(btn.getAttribute('data-idx'));
            loadPresets(pr => {
              if (pr[l]) { pr[l].splice(idx, 1); if (!pr[l].length) delete pr[l]; }
              savePresets(pr);
              renderPresetList();
            });
          });
        });
      });
    }

    initPresetLevelDropdown();
    renderPresetList();

    // Add preset button
    document.getElementById('bf-preset-add-btn').addEventListener('click', () => {
      const lvl = document.getElementById('bf-preset-level')?.value || '1';
      document.getElementById('bf-preset-add-lvl').textContent = lvl;
      document.getElementById('bf-preset-add').style.display = 'block';
      document.getElementById('bf-preset-add-btn').style.display = 'none';
      // Pre-fill from last bot encounter if on ruins page
      document.getElementById('bf-preset-enemy').value = '';
      document.getElementById('bf-preset-form').value = '';
    });

    document.getElementById('bf-preset-cancel').addEventListener('click', () => {
      document.getElementById('bf-preset-add').style.display = 'none';
      document.getElementById('bf-preset-add-btn').style.display = 'block';
    });

    document.getElementById('bf-preset-save').addEventListener('click', () => {
      const lvl = document.getElementById('bf-preset-level')?.value || '1';
      const enemyStr = document.getElementById('bf-preset-enemy').value.trim();
      const formStr = document.getElementById('bf-preset-form').value.trim();
      if (!enemyStr || !formStr) { alert('Fill in both enemy and formation'); return; }

      const enemyObj = parseQtyString(enemyStr);
      const formObj = parseQtyString(formStr);
      const canonicalEnemy = enemyFingerprint(enemyObj);

      loadPresets(presets => {
        if (!presets[lvl]) presets[lvl] = [];
        // Remove existing preset with same enemy fingerprint
        presets[lvl] = presets[lvl].filter(p => p.enemy !== canonicalEnemy);
        presets[lvl].push({ enemy: canonicalEnemy, formation: formObj });
        savePresets(presets);
        botLog('ok', `Preset saved: Level ${lvl}, ${canonicalEnemy} → ${qtyToString(formObj)}`);
        document.getElementById('bf-preset-add').style.display = 'none';
        document.getElementById('bf-preset-add-btn').style.display = 'block';
        renderPresetList();
      });
    });

    // ── SIMULATOR → BOT BRIDGE: import preset from history (v1.5.7) ──
    // The simulator iframe sends BF_ADD_PRESET messages when the user clicks
    // 📥 To Preset on a VICTORY history card. We validate the payload, build
    // the preset entry the same way bf-preset-save does, and append to the
    // current character's preset store. The simulator does NOT have direct
    // access to chrome.storage (it lives at chrome-extension:// origin and
    // doesn't know SERVER_ID + PLAYER_ID) so all storage goes through here.
    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (!m || m.type !== 'BF_ADD_PRESET') return;

      // Validation. Bail silently on malformed payloads — this protects
      // against unrelated messages on shared windows / dev tools etc.
      const lvl = parseInt(m.level, 10);
      if (isNaN(lvl) || lvl < 1 || lvl > 30) {
        botLog('warn', 'Preset import: invalid level ' + m.level);
        return;
      }
      if (!m.enemy || typeof m.enemy !== 'object') {
        botLog('warn', 'Preset import: missing enemy object');
        return;
      }
      if (!m.formation || typeof m.formation !== 'object') {
        botLog('warn', 'Preset import: missing formation object');
        return;
      }

      // Strip zeroes + ensure all values are integers. The simulator should
      // already send clean data, but defensive coding here means malformed
      // future payloads can't corrupt the preset store.
      const cleanEnemy = {};
      Object.keys(m.enemy).forEach(k => {
        const v = parseInt(m.enemy[k], 10);
        if (v > 0) cleanEnemy[k.toUpperCase()] = v;
      });
      const cleanForm = {};
      Object.keys(m.formation).forEach(k => {
        const v = parseInt(m.formation[k], 10);
        if (v > 0) cleanForm[k.toUpperCase()] = v;
      });
      if (Object.keys(cleanEnemy).length === 0 || Object.keys(cleanForm).length === 0) {
        botLog('warn', 'Preset import: empty enemy or formation after sanitize');
        return;
      }

      const canonicalEnemy = enemyFingerprint(cleanEnemy);
      const lvlKey = String(lvl);

      loadPresets(presets => {
        if (!presets[lvlKey]) presets[lvlKey] = [];
        // Same overwrite-on-duplicate-fingerprint policy as manual save.
        const existed = presets[lvlKey].some(p => p.enemy === canonicalEnemy);
        presets[lvlKey] = presets[lvlKey].filter(p => p.enemy !== canonicalEnemy);
        presets[lvlKey].push({ enemy: canonicalEnemy, formation: cleanForm });
        savePresets(presets);
        botLog('ok', `Preset ${existed ? 'updated' : 'imported'} from simulator: L${lvl}, ${canonicalEnemy} → ${qtyToString(cleanForm)}`);
        // If the preset panel is currently showing this level, refresh it
        // so the user sees the new entry without having to switch tabs.
        const currentLvl = document.getElementById('bf-preset-level')?.value;
        if (currentLvl === lvlKey) renderPresetList();

        // ACK back to the simulator so the card can show success feedback.
        // We don't await a response — fire-and-forget is fine here.
        try {
          const iframe = document.getElementById('bf-sim-iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              type: 'BF_ADD_PRESET_ACK',
              ok: true,
              level: lvl,
              enemy: canonicalEnemy,
              updated: existed,
            }, '*');
          }
        } catch (_) {}
      });
    });

    // ── PRESET EXPORT (CSV) ──────────────────────────────────
    document.getElementById('bf-preset-export').addEventListener('click', () => {
      loadPresets(presets => {
        // CSV header
        const rows = ['Level,Enemy,Formation'];
        // Sort levels numerically
        const levels = Object.keys(presets).sort((a, b) => Number(a) - Number(b));
        let total = 0;
        for (const lvl of levels) {
          for (const p of presets[lvl]) {
            // Formation obj → string like "T1:20,T3:38"
            const formStr = qtyToString(p.formation);
            // Quote fields that contain commas
            const enemyField = p.enemy.includes(',') ? `"${p.enemy}"` : p.enemy;
            const formField = formStr.includes(',') ? `"${formStr}"` : formStr;
            rows.push(`${lvl},${enemyField},${formField}`);
            total++;
          }
        }
        if (total === 0) {
          alert('No presets to export.');
          return;
        }
        const csv = rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bf-presets-${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        botLog('ok', `Exported ${total} presets to CSV.`);
      });
    });

    // ── PRESET IMPORT (CSV) ──────────────────────────────────
    const importFileInput = document.getElementById('bf-preset-import-file');
    const importStatus = document.getElementById('bf-preset-import-status');

    document.getElementById('bf-preset-import-btn').addEventListener('click', () => {
      importFileInput.value = '';
      importFileInput.click();
    });

    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());

        // Detect and skip header row
        const firstLine = lines[0].trim().toLowerCase();
        const startIdx = (firstLine.startsWith('level') || firstLine.startsWith('"level')) ? 1 : 0;

        let imported = 0;
        let errors = 0;
        const newPresets = {};

        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Parse CSV with quoted fields support
          const fields = parseCSVLine(line);
          if (fields.length < 3) { errors++; continue; }

          const lvl = String(parseInt(fields[0].trim()));
          if (isNaN(parseInt(lvl)) || parseInt(lvl) < 1 || parseInt(lvl) > 30) { errors++; continue; }

          const enemyStr = fields[1].trim();
          const formStr = fields[2].trim();
          if (!enemyStr || !formStr) { errors++; continue; }

          const enemyObj = parseQtyString(enemyStr);
          const formObj = parseQtyString(formStr);
          const canonicalEnemy = enemyFingerprint(enemyObj);

          if (!canonicalEnemy || Object.keys(formObj).length === 0) { errors++; continue; }

          if (!newPresets[lvl]) newPresets[lvl] = [];
          // Overwrite duplicate enemy in same level
          newPresets[lvl] = newPresets[lvl].filter(p => p.enemy !== canonicalEnemy);
          newPresets[lvl].push({ enemy: canonicalEnemy, formation: formObj });
          imported++;
        }

        if (imported === 0) {
          importStatus.textContent = `⚠ No valid presets found. ${errors} error(s).`;
          importStatus.style.color = '#e04040';
          importStatus.style.display = 'block';
          return;
        }

        // Merge with existing presets
        loadPresets(existing => {
          for (const lvl of Object.keys(newPresets)) {
            if (!existing[lvl]) existing[lvl] = [];
            for (const np of newPresets[lvl]) {
              existing[lvl] = existing[lvl].filter(p => p.enemy !== np.enemy);
              existing[lvl].push(np);
            }
          }
          savePresets(existing);
          renderPresetList();
          const msg = `✅ Imported ${imported} presets.` + (errors > 0 ? ` ${errors} row(s) skipped.` : '');
          importStatus.textContent = msg;
          importStatus.style.color = errors > 0 ? '#e0a030' : '#5a7a4a';
          importStatus.style.display = 'block';
          botLog('ok', msg);
          setTimeout(() => { importStatus.style.display = 'none'; }, 5000);
        });
      };
      reader.readAsText(file);
    });

    // CSV line parser — handles quoted fields with commas inside
    function parseCSVLine(line) {
      const fields = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++; // skip escaped quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      fields.push(current);
      return fields;
    }

    // Min units checkbox toggle
    document.getElementById('bf-ruins-stop-min-units')?.addEventListener('change', (e) => {
      const row = document.getElementById('bf-ruins-min-units-row');
      if (row) row.style.display = e.target.checked ? 'block' : 'none';
    });

    // Make panel draggable
    makeDraggable(panel, document.getElementById('bf-bot-header'));

    // Story mode: Stay Alive mode radio toggle
    panel.addEventListener('change', (e) => {
      if (e.target.name === 'bf-story-salm') {
        const isFixed = e.target.value === 'fixed';
        const pctRow = document.getElementById('bf-story-pct-row');
        const fixedRow = document.getElementById('bf-story-fixed-row');
        if (pctRow) pctRow.style.display = isFixed ? 'none' : 'block';
        if (fixedRow) fixedRow.style.display = isFixed ? 'block' : 'none';
      }
    });

    // Story toggle
    document.getElementById('bf-story-toggle').addEventListener('click', () => {
      loadSettings((settings) => {
        settings.storyEnabled = !settings.storyEnabled;
        // Gather story UI values
        settings.storyPriority = document.getElementById('bf-story-priority')?.value || 'gold';
        settings.storyWhitelist = (document.getElementById('bf-story-whitelist')?.value || '')
          .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        settings.storyBlacklist = (document.getElementById('bf-story-blacklist')?.value || '')
          .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        settings.storyStayAlive = document.getElementById('bf-story-stayalive')?.checked ?? true;
        settings.storyStayAliveMode = document.querySelector('input[name="bf-story-salm"]:checked')?.value || 'pct';
        settings.storyPauseAtPct = parseInt(document.getElementById('bf-story-pause-pct')?.value) || 16;
        settings.storyResumeAtPct = parseInt(document.getElementById('bf-story-resume-pct')?.value) || 18;
        settings.storyPauseAtHP = parseInt(document.getElementById('bf-story-pause-hp')?.value) || 10000;
        settings.storyResumeAtHP = parseInt(document.getElementById('bf-story-resume-hp')?.value) || 12000;
        settings.storyChurch = document.getElementById('bf-story-church')?.checked ?? true;
        settings.storyOption42Enabled = document.getElementById('bf-story-opt42')?.checked ?? false;
        settings.storyOption42MinHP = parseInt(document.getElementById('bf-story-opt42-hp')?.value) || 20000;
        settings.storyOption42MinHPPct = parseInt(document.getElementById('bf-story-opt42-pct')?.value) || 50;
        settings.storyHealPriorityPct = parseInt(document.getElementById('bf-story-heal-pct')?.value) ?? -1;
        settings.storyHealBackPct = parseInt(document.getElementById('bf-story-healback-pct')?.value) || 80;
        // Aspect targets
        settings.storyAspectTargets = {
          human: parseInt(document.getElementById('bf-aspect-human')?.value) || 0,
          knowledge: parseInt(document.getElementById('bf-aspect-knowledge')?.value) || 0,
          order: parseInt(document.getElementById('bf-aspect-order')?.value) || 0,
          nature: parseInt(document.getElementById('bf-aspect-nature')?.value) || 0,
          beast: parseInt(document.getElementById('bf-aspect-beast')?.value) || 0,
          destruction: parseInt(document.getElementById('bf-aspect-destruction')?.value) || 0,
          chaos: parseInt(document.getElementById('bf-aspect-chaos')?.value) || 0,
          corruption: parseInt(document.getElementById('bf-aspect-corruption')?.value) || 0,
        };

        saveSettings(settings);

        if (settings.storyEnabled) {
          loadState((state) => {
            state.storyState = 'idle';
            state.storyRecovering = false;
            state.storyHealingPriority = false;
            if (!state.storyMatrix) state.storyMatrix = [...PRETRAINED_DECISIONS];
            saveState(state);
            botLog('ok', `Story Bot STARTED (priority: ${settings.storyPriority})`);
            updateStoryUI(settings, state);
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          });
        } else {
          loadState((state) => {
            state.storyState = 'idle';
            state.storyRecovering = false;
            saveState(state);
            botLog('warn', 'Story Bot STOPPED');
            updateStoryUI(settings, state);
          });
        }
      });
    });

    // Grotto toggle
    document.getElementById('bf-grotto-toggle').addEventListener('click', () => {
      loadSettings((settings) => {
        settings.grottoEnabled = !settings.grottoEnabled;
        settings.grottoDifficulty = document.getElementById('bf-grotto-diff')?.value || 'easy';
        settings.grottoCount = parseInt(document.getElementById('bf-grotto-count')?.value) || 0;
        settings.grottoPermanent = document.getElementById('bf-grotto-permanent')?.checked ?? false;
        settings.grottoMinHP = parseInt(document.getElementById('bf-grotto-minhp')?.value) || 50;
        settings.grottoStayAlive = document.getElementById('bf-grotto-stayalive')?.checked ?? false;
        settings.grottoStayAliveMode = document.querySelector('input[name="bf-grotto-salm"]:checked')?.value || 'switch';
        settings.grottoSwitchDifficulty = document.getElementById('bf-grotto-switch-diff')?.value || 'easy';
        settings.grottoChurchAP = parseInt(document.getElementById('bf-grotto-church-ap')?.value) || 15;
        saveSettings(settings);
        if (settings.grottoEnabled) {
          loadState((state) => {
            state.grottoState = 'navigating';
            state.grottoCount = 0;
            saveState(state);
            botLog('ok', 'Grotto Bot STARTED');
            updateGrottoUI(settings, state);
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          });
        } else {
          loadState((state) => {
            state.grottoState = 'idle';
            saveState(state);
            botLog('warn', 'Grotto Bot STOPPED');
            updateGrottoUI(settings, state);
          });
        }
      });
    });

    // PvP toggle
    document.getElementById('bf-pvp-toggle').addEventListener('click', () => {
      loadSettings((settings) => {
        settings.pvpEnabled = !settings.pvpEnabled;
        settings.pvpMode = parseInt(document.getElementById('bf-pvp-mode')?.value) || 1;
        settings.pvpMinHP = parseInt(document.getElementById('bf-pvp-minhp')?.value) || 50;
        settings.pvpWhitelist = document.getElementById('bf-pvp-whitelist')?.value || '';
        settings.pvpBlacklist = document.getElementById('bf-pvp-blacklist')?.value || '';
        settings.pvpBVFrom = document.getElementById('bf-pvp-bv-from')?.value || '';
        settings.pvpBVTo = document.getElementById('bf-pvp-bv-to')?.value || '';
        settings.pvpIncludeInactive = document.getElementById('bf-pvp-inactive')?.checked ?? true;
        settings.pvpSmartBreak = document.getElementById('bf-pvp-break')?.checked ?? false;
        settings.pvpDelay = parseInt(document.getElementById('bf-pvp-delay')?.value) || 20;
        settings.pvpMargin = parseInt(document.getElementById('bf-pvp-margin')?.value) || 3;
        // v1.6.9: PvP and Henchman are mutually exclusive — turning PvP on
        // implicitly stops the Henchman bot.
        if (settings.pvpEnabled && settings.henchmanEnabled) {
          settings.henchmanEnabled = false;
          botLog('warn', 'Henchman Bot stopped (PvP took over)');
        }
        saveSettings(settings);
        if (settings.pvpEnabled) {
          loadState((state) => {
            state.pvpState = 'navigating';
            state.henchmanState = 'idle';
            saveState(state);
            botLog('ok', 'PvP Bot STARTED');
            updatePvPUI(settings, state);
            updateHenchmanUI(settings, state);
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          });
        } else {
          loadState((state) => {
            state.pvpState = 'idle';
            saveState(state);
            botLog('warn', 'PvP Bot STOPPED');
            updatePvPUI(settings, state);
          });
        }
      });
    });

    // Henchman toggle (v1.6.9) — mirrors PvP toggle but for the henchman flow.
    document.getElementById('bf-henchman-toggle')?.addEventListener('click', () => {
      loadSettings((settings) => {
        settings.henchmanEnabled = !settings.henchmanEnabled;
        settings.henchmanMode = parseInt(document.getElementById('bf-henchman-mode')?.value) || 1;
        settings.henchmanWhitelist = document.getElementById('bf-henchman-whitelist')?.value || '';
        settings.henchmanBlacklist = document.getElementById('bf-henchman-blacklist')?.value || '';
        settings.henchmanSmartBreak = document.getElementById('bf-henchman-break')?.checked ?? false;
        settings.henchmanDelay = parseInt(document.getElementById('bf-henchman-delay')?.value) || 20;
        settings.henchmanMargin = parseInt(document.getElementById('bf-henchman-margin')?.value) || 3;
        settings.henchmanAttackOwnRace = document.getElementById('bf-henchman-own-race')?.checked ?? false;
        // Mutual exclusivity with PvP.
        if (settings.henchmanEnabled && settings.pvpEnabled) {
          settings.pvpEnabled = false;
          botLog('warn', 'PvP Bot stopped (Henchman took over)');
        }
        saveSettings(settings);
        if (settings.henchmanEnabled) {
          loadState((state) => {
            state.henchmanState = 'navigating';
            state.pvpState = 'idle';
            saveState(state);
            botLog('ok', 'Henchman Bot STARTED');
            updateHenchmanUI(settings, state);
            updatePvPUI(settings, state);
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          });
        } else {
          loadState((state) => {
            state.henchmanState = 'idle';
            saveState(state);
            botLog('warn', 'Henchman Bot STOPPED');
            updateHenchmanUI(settings, state);
          });
        }
      });
    });

    // Henchman mode change (v1.6.9 / semantics v1.6.10) — both whitelist and
    // blacklist groups stay visible regardless of mode, since users typically
    // want to maintain both lists across mode switches. The mode only changes
    // which list the runtime uses; the UI shows both for clarity.

    // Gifts toggle (Purple Gifts)
    document.getElementById('bf-gifts-toggle').addEventListener('click', () => {
      loadSettings((settings) => {
        settings.giftsAutoDBG = document.getElementById('bf-gifts-dbg')?.checked ?? false;
        settings.giftsDBGUnderAP = parseInt(document.getElementById('bf-gifts-dbg-ap')?.value) || 5;
        settings.giftsDisableAfterEvent = document.getElementById('bf-gifts-disable-event')?.checked ?? false;
        settings.giftsMaxCaveTime = document.getElementById('bf-gifts-cave-time')?.checked ?? false;
        settings.giftsPurpleMode = document.querySelector('input[name="bf-gifts-purple"]:checked')?.value || 'none';
        settings.giftsPurpleGoldTarget = parseInt(document.getElementById('bf-gifts-pg-gold-val')?.value) || 100000;
        settings.giftsPurpleQtyTarget = parseInt(document.getElementById('bf-gifts-pg-qty-val')?.value) || 10;
        settings.giftsPurpleSpendGold = document.getElementById('bf-gifts-pg-spend')?.checked ?? false;
        // Toggle purple gifts bot
        const wasRunning = document.getElementById('bf-gifts-status')?.textContent !== 'Disabled';
        saveSettings(settings);
        loadState((state) => {
          if (wasRunning && state.giftsState === 'running') {
            state.giftsState = 'idle';
            saveState(state);
            botLog('warn', 'Gifts Bot STOPPED');
          } else if (settings.giftsPurpleMode !== 'none') {
            state.giftsState = 'running';
            state.giftsPurpleOpened = 0;
            saveState(state);
            botLog('ok', 'Gifts Bot STARTED');
            botSetTimeout(() => botTick(state, settings), randomDelay(500, 1500));
          }
          updateGiftsUI(settings, state);
        });
      });
    });

    // Global settings — save on any change
    const globalPanel = document.getElementById('bf-bot-global');
    if (globalPanel) {
      globalPanel.addEventListener('change', () => {
        saveGlobalSettings();
      });
    }

    // Gold mode show/hide panels
    document.getElementById('bf-gold-mode')?.addEventListener('change', (e) => {
      const v = parseInt(e.target.value);
      document.getElementById('bf-gold-skills-panel').style.display = v === 1 ? 'block' : 'none';
      document.getElementById('bf-gold-donate-panel').style.display = v === 2 ? 'block' : 'none';
    });

    // ── Inventory Discard / Cleanup (v1.6.13) ─────────────────
    // Enable checkbox → toggle the whole panel
    document.getElementById('bf-invdisc-enabled')?.addEventListener('change', (e) => {
      const panel = document.getElementById('bf-invdisc-panel');
      if (panel) panel.style.display = e.target.checked ? '' : 'none';
      // If disabling, also clear any pending manual run flag so a future
      // re-enable doesn't immediately fire a stale "Run Now".
      if (!e.target.checked) {
        loadState(st => {
          if (st.invDiscardManualPending) {
            st.invDiscardManualPending = false;
            saveState(st);
          }
        });
      } else {
        // Refresh status line when newly enabled
        loadState(st => { loadSettings(se => _invDiscardRefreshUI(st, se)); });
      }
    });

    // Mode select → show/hide Auto subpanel
    document.getElementById('bf-invdisc-mode')?.addEventListener('change', (e) => {
      const isAuto = e.target.value === 'auto';
      const autoPanel = document.getElementById('bf-invdisc-auto-panel');
      if (autoPanel) autoPanel.style.display = isAuto ? '' : 'none';
      // Also re-evaluate custom-row visibility based on frequency
      const freq = (document.getElementById('bf-invdisc-freq')?.value) || 'daily';
      const customRow = document.getElementById('bf-invdisc-custom-row');
      if (customRow) customRow.style.display = (isAuto && freq === 'custom') ? '' : 'none';
      loadState(st => { loadSettings(se => _invDiscardRefreshUI(st, se)); });
    });

    // Frequency select → show/hide custom hours row
    document.getElementById('bf-invdisc-freq')?.addEventListener('change', (e) => {
      const customRow = document.getElementById('bf-invdisc-custom-row');
      if (customRow) customRow.style.display = e.target.value === 'custom' ? '' : 'none';
      loadState(st => { loadSettings(se => _invDiscardRefreshUI(st, se)); });
    });

    // "Run Now" — set the manual-pending flag and trigger an immediate tick
    document.getElementById('bf-invdisc-run-now')?.addEventListener('click', () => {
      if (_centralStopActive) {
        botLog('warn', '🗑 Cannot run — Central STOP is engaged');
        return;
      }
      loadSettings(se => {
        if (!se.invDiscardEnabled) {
          botLog('warn', '🗑 Inventory Cleanup is disabled. Enable it first.');
          return;
        }
        loadState(st => {
          st.invDiscardManualPending = true;
          st.invDiscardSessionCount = 0;
          // Reset spacing so the very first action fires promptly
          st.invDiscardLastAction = 0;
          saveState(st);
          botLog('info', `🗑 Inventory Cleanup: Manual run requested (max lvl ${se.invDiscardMaxLevel || 1000})`);
          _invDiscardRefreshUI(st, se);
          // Kick the tick immediately
          botSetTimeout(() => botTick(st, se), randomDelay(200, 500));
        });
      });
    });

    // "Preview" — scan inventory and list what WOULD be discarded, no action
    document.getElementById('bf-invdisc-preview')?.addEventListener('click', () => {
      loadSettings(se => {
        const maxL = parseInt(document.getElementById('bf-invdisc-maxlvl')?.value) || (se.invDiscardMaxLevel || 1000);
        const minL = parseInt(document.getElementById('bf-invdisc-minlvl')?.value) || (se.invDiscardMinLevel || 0);
        const out = document.getElementById('bf-invdisc-preview-out');
        if (!out) return;
        if (!PAGE.includes('/profile')) {
          out.style.display = '';
          out.innerHTML = `<div style="color:#e0a030">⚠ Preview only works on the Profile/Inventory page. Open <code>/profile/index</code> first.</div>`;
          return;
        }
        const items = scanInventoryForDiscardable(maxL, minL);
        if (items.length === 0) {
          out.style.display = '';
          out.innerHTML = `<div style="color:#7a9a6a">✓ No items would be discarded (max lvl ${maxL}${minL > 0 ? ', min lvl ' + minL : ''}).</div>`;
          return;
        }
        const TYPE_LABEL = { 1: 'Weapon', 3: 'Helmet', 4: 'Armor', 5: 'Item', 6: 'Gloves', 7: 'Boots', 8: 'Shield' };
        const rows = items.map(it => {
          const t = TYPE_LABEL[it.itemType] || ('Type ' + it.itemType);
          return `<div style="display:flex;gap:6px;border-bottom:1px solid #1a1a1a;padding:2px 0">
            <span style="color:#9a7a5a;flex:0 0 50px">[${t}]</span>
            <span style="flex:1;color:#cccccc">${(it.name || '?').replace(/[<>]/g,'')}</span>
            <span style="color:#7a9a6a;flex:0 0 60px;text-align:right">lvl ${it.level}</span>
            <span style="color:#5a7a4a;flex:0 0 40px;text-align:right">×${it.count}</span>
          </div>`;
        }).join('');
        out.style.display = '';
        out.innerHTML = `<div style="color:#e0a030;margin-bottom:4px"><b>${items.length}</b> item(s) would be discarded (max lvl ${maxL}${minL > 0 ? ', min lvl ' + minL : ''}):</div>${rows}`;
      });
    });

    // Story priority — show/hide aspects panel
    document.getElementById('bf-story-priority')?.addEventListener('change', (e) => {
      const asp = document.getElementById('bf-story-aspects-panel');
      if (asp) asp.style.display = e.target.value === 'aspects' ? 'block' : 'none';
    });

    // Speed custom slider label
    document.getElementById('bf-speed-custom-val')?.addEventListener('input', (e) => {
      const lbl = document.getElementById('bf-speed-custom-label');
      if (lbl) lbl.textContent = parseFloat(e.target.value).toFixed(2) + 's';
    });

    // ── Background Page Refresh (v1.6.10 rewrite) ─────────────
    // BK-style structured panel: enable checkbox, interval (min),
    // randomize (±min), live ETA. Drives bgRefreshSchedule() below.
    document.getElementById('bf-bg-refresh')?.addEventListener('change', (e) => {
      const panel = document.getElementById('bf-bg-refresh-panel');
      if (panel) panel.style.display = e.target.checked ? '' : 'none';
      loadSettings(se => {
        se.backgroundRefresh = !!e.target.checked;
        saveSettings(se);
        if (e.target.checked) bgRefreshSchedule(true);
        else bgRefreshCancel();
      });
    });
    document.getElementById('bf-bg-refresh-interval')?.addEventListener('change', (e) => {
      const v = Math.max(1, Math.min(600, parseInt(e.target.value) || 60));
      e.target.value = v;
      loadSettings(se => {
        se.backgroundRefreshInterval = v;
        saveSettings(se);
        if (se.backgroundRefresh) bgRefreshSchedule(true); // reset cycle with new interval
      });
    });
    document.getElementById('bf-bg-refresh-rand')?.addEventListener('change', (e) => {
      const v = Math.max(0, Math.min(60, parseInt(e.target.value) || 0));
      e.target.value = v;
      loadSettings(se => {
        se.backgroundRefreshRandomize = v;
        saveSettings(se);
        if (se.backgroundRefresh) bgRefreshSchedule(true);
      });
    });

    // ── Schedule (v1.6.7) ─────────────────────────────────────
    // The Schedule-active checkbox change is already captured by the global
    // panel's change-listener (saveGlobalSettings writes scheduleEnabled).
    // Here we add the extra behavior: refresh status + reset transition state
    // + start/refresh the watcher every time the user toggles it.
    document.getElementById('bf-schedule-enabled')?.addEventListener('change', () => {
      _lastScheduleSlotId = '__init__'; // force re-log on next check
      botSetTimeout(() => {
        runScheduleCheck('toggle');
        startScheduleWatcher();
        renderScheduleList();
      }, 100);
    });

    // Add-slot button (click event, not covered by the change-listener)
    document.getElementById('bf-schedule-add')?.addEventListener('click', () => {
      loadSettings(se => {
        const layout = getActiveScheduleLayout(se);
        if (!layout) return;
        if (!Array.isArray(layout.slots)) layout.slots = [];
        layout.slots.push({
          id: newScheduleSlotId(),
          enabled: true,
          startH: 8, startM: 0,
          endH: 12, endM: 0,
          actions: { hunt:false, story:false, pvp:false, henchman:false, ruins:false, grotto:false, invdisc:false }
        });
        saveSettings(se);
        renderScheduleList();
        runScheduleCheck('add');
      });
    });

    // ── Layout bar (v1.6.8) ───────────────────────────────────
    // Switch active layout via dropdown
    document.getElementById('bf-layout-sel')?.addEventListener('change', (e) => {
      e.stopPropagation();
      const newId = e.target.value;
      loadSettings(se => {
        if (!Array.isArray(se.scheduleLayouts) || !se.scheduleLayouts.some(l => l.id === newId)) return;
        se.scheduleActiveLayoutId = newId;
        saveSettings(se);
        _lastScheduleSlotId = '__init__'; // force re-log on next check
        renderScheduleList();
        runScheduleCheck('layout-switch');
      });
    });

    // ➕ New empty layout
    document.getElementById('bf-layout-new')?.addEventListener('click', () => {
      const name = (window.prompt('Name for the new layout:', 'New layout') || '').trim();
      if (!name) return; // cancelled or empty
      loadSettings(se => {
        if (!Array.isArray(se.scheduleLayouts)) se.scheduleLayouts = [];
        const layout = {
          id: newScheduleLayoutId(),
          name: name.substring(0, 40),
          slots: []
        };
        se.scheduleLayouts.push(layout);
        se.scheduleActiveLayoutId = layout.id;
        saveSettings(se);
        renderScheduleList();
        runScheduleCheck('layout-new');
        botLog('info', `📅 Created new layout: "${layout.name}"`);
      });
    });

    // 📋 Duplicate active layout (deep-copy slots with fresh IDs)
    document.getElementById('bf-layout-dup')?.addEventListener('click', () => {
      loadSettings(se => {
        const src = getActiveScheduleLayout(se);
        if (!src) return;
        const clone = {
          id: newScheduleLayoutId(),
          name: (src.name + ' (copy)').substring(0, 40),
          slots: (src.slots || []).map(s => Object.assign({}, s, {
            id: newScheduleSlotId(),
            actions: Object.assign({}, s.actions || {})
          }))
        };
        se.scheduleLayouts.push(clone);
        se.scheduleActiveLayoutId = clone.id;
        saveSettings(se);
        renderScheduleList();
        runScheduleCheck('layout-dup');
        botLog('info', `📅 Duplicated layout: "${src.name}" → "${clone.name}"`);
      });
    });

    // ✏ Rename active layout
    document.getElementById('bf-layout-rename')?.addEventListener('click', () => {
      loadSettings(se => {
        const active = getActiveScheduleLayout(se);
        if (!active) return;
        const newName = (window.prompt('Rename layout:', active.name) || '').trim();
        if (!newName) return; // cancelled or empty
        const oldName = active.name;
        active.name = newName.substring(0, 40);
        saveSettings(se);
        renderLayoutBar(se);
        botLog('info', `📅 Renamed layout: "${oldName}" → "${active.name}"`);
      });
    });

    // 🗑 Delete active layout (refused when only one exists)
    document.getElementById('bf-layout-del')?.addEventListener('click', () => {
      loadSettings(se => {
        if (!Array.isArray(se.scheduleLayouts) || se.scheduleLayouts.length <= 1) {
          window.alert('Cannot delete the last layout. At least one must exist.');
          return;
        }
        const active = getActiveScheduleLayout(se);
        if (!active) return;
        if (!window.confirm(`Delete layout "${active.name}"?\n\nAll ${active.slots?.length || 0} slot(s) in this layout will be lost.`)) return;
        const idx = se.scheduleLayouts.findIndex(l => l.id === active.id);
        se.scheduleLayouts.splice(idx, 1);
        se.scheduleActiveLayoutId = se.scheduleLayouts[0].id;
        saveSettings(se);
        renderScheduleList();
        runScheduleCheck('layout-del');
        botLog('info', `📅 Deleted layout: "${active.name}"`);
      });
    });

    // PvP mode change — show/hide BV range row and blacklist group
    document.getElementById('bf-pvp-mode')?.addEventListener('change', (e) => {
      const mode = parseInt(e.target.value);
      const bvRow = document.getElementById('bf-pvp-bv-row');
      const blGroup = document.getElementById('bf-pvp-bl-group');
      if (bvRow) bvRow.style.display = (mode === 4) ? 'flex' : 'none';
      if (blGroup) blGroup.style.display = (mode === 3) ? '' : 'none';
    });

    // v1.6.10 — Auto-persist PvP/Henchman config fields on any change.
    // BUG FIX: previously these fields were saved ONLY when the user clicked
    // Start/Stop. Anything typed into whitelist/blacklist between sessions
    // was lost if the user closed the tab without toggling.
    function persistPvPHenchmanFromDOM() {
      loadSettings((se) => {
        const get = (id) => document.getElementById(id);
        if (get('bf-pvp-mode'))      se.pvpMode      = parseInt(get('bf-pvp-mode').value) || 1;
        if (get('bf-pvp-minhp'))     se.pvpMinHP     = parseInt(get('bf-pvp-minhp').value) || 50;
        if (get('bf-pvp-whitelist')) se.pvpWhitelist = get('bf-pvp-whitelist').value || '';
        if (get('bf-pvp-blacklist')) se.pvpBlacklist = get('bf-pvp-blacklist').value || '';
        if (get('bf-pvp-bv-from'))   se.pvpBVFrom    = get('bf-pvp-bv-from').value || '';
        if (get('bf-pvp-bv-to'))     se.pvpBVTo      = get('bf-pvp-bv-to').value || '';
        if (get('bf-pvp-inactive'))  se.pvpIncludeInactive = !!get('bf-pvp-inactive').checked;
        if (get('bf-pvp-break'))     se.pvpSmartBreak = !!get('bf-pvp-break').checked;
        if (get('bf-pvp-delay'))     se.pvpDelay     = parseInt(get('bf-pvp-delay').value) || 20;
        if (get('bf-pvp-margin'))    se.pvpMargin    = parseInt(get('bf-pvp-margin').value) || 3;
        if (get('bf-henchman-mode'))      se.henchmanMode      = parseInt(get('bf-henchman-mode').value) || 1;
        if (get('bf-henchman-whitelist')) se.henchmanWhitelist = get('bf-henchman-whitelist').value || '';
        if (get('bf-henchman-blacklist')) se.henchmanBlacklist = get('bf-henchman-blacklist').value || '';
        if (get('bf-henchman-break'))     se.henchmanSmartBreak = !!get('bf-henchman-break').checked;
        if (get('bf-henchman-delay'))     se.henchmanDelay     = parseInt(get('bf-henchman-delay').value) || 20;
        if (get('bf-henchman-margin'))    se.henchmanMargin    = parseInt(get('bf-henchman-margin').value) || 3;
        if (get('bf-henchman-own-race'))  se.henchmanAttackOwnRace = !!get('bf-henchman-own-race').checked;
        saveSettings(se);
      });
    }
    // Attach to all PvP+Henchman input/select/textarea elements (debounced).
    let _pvpPersistTimer = null;
    function schedulePvPPersist() {
      if (_pvpPersistTimer) clearTimeout(_pvpPersistTimer);
      _pvpPersistTimer = setTimeout(persistPvPHenchmanFromDOM, 300);
    }
    [
      'bf-pvp-mode','bf-pvp-minhp','bf-pvp-whitelist','bf-pvp-blacklist',
      'bf-pvp-bv-from','bf-pvp-bv-to','bf-pvp-inactive','bf-pvp-break',
      'bf-pvp-delay','bf-pvp-margin',
      'bf-henchman-mode','bf-henchman-whitelist','bf-henchman-blacklist',
      'bf-henchman-break','bf-henchman-delay','bf-henchman-margin',
      'bf-henchman-own-race'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', schedulePvPPersist);
      // text/number inputs also get 'input' for live typing
      if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) {
        el.addEventListener('input', schedulePvPPersist);
      }
    });

    // ── Auto Recruitment (v1.6.5) ────────────────────────────
    // Helper: persist the entire current recruit-panel state to settings
    // immediately. Called on every user change so we don't rely on the
    // Hunt master toggle to save recruit fields (which caused the
    // v1.6.4 reset bug).
    function persistRecruitFromDOM() {
      loadSettings((se) => {
        const recEn = document.getElementById('bf-recruit-enabled');
        if (recEn) se.recruitEnabled = !!recEn.checked;
        const trig = document.getElementById('bf-recruit-trigger');
        if (trig) se.recruitTrigger = trig.value || 'idle';
        const th = document.getElementById('bf-recruit-threshold');
        if (th) se.recruitThreshold = parseInt(th.value) || 100;
        const strat = document.getElementById('bf-recruit-strategy');
        if (strat) se.recruitStrategy = strat.value || 'priority';
        const res = document.getElementById('bf-recruit-reserve');
        if (res) se.recruitReserveBE = parseInt(res.value) || 0;
        const pctInputs = document.querySelectorAll('.bf-recruit-pct');
        if (pctInputs.length > 0) {
          const pct = {};
          pctInputs.forEach(inp => {
            const t = inp.dataset.unit;
            if (t) pct[t] = parseInt(inp.value) || 0;
          });
          se.recruitPercent = pct;
        }
        const prioRows = document.querySelectorAll('#bf-recruit-priority-list .bf-recruit-prio-row');
        if (prioRows.length > 0) {
          se.recruitEnabledTiers = readEnabledTiersFromDOM();
          se.recruitPriority = readPriorityOrderFromDOM();
        }
        saveSettings(se);
      });
    }

    // Percent total calculator + auto-persist
    document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
      inp.addEventListener('input', () => { updateRecruitTotal(); persistRecruitFromDOM(); });
    });
    // Master enable checkbox
    document.getElementById('bf-recruit-enabled')?.addEventListener('change', persistRecruitFromDOM);
    // Trigger dropdown → show/hide threshold row + persist
    document.getElementById('bf-recruit-trigger')?.addEventListener('change', (e) => {
      const thresholdRow = document.getElementById('bf-recruit-threshold-row');
      if (thresholdRow) thresholdRow.style.display = (e.target.value === 'threshold') ? 'flex' : 'none';
      persistRecruitFromDOM();
    });
    document.getElementById('bf-recruit-threshold')?.addEventListener('input', persistRecruitFromDOM);
    document.getElementById('bf-recruit-reserve')?.addEventListener('input', persistRecruitFromDOM);
    // Strategy dropdown → swap priority vs percent panels + persist
    document.getElementById('bf-recruit-strategy')?.addEventListener('change', (e) => {
      const v = e.target.value;
      const prioPanel = document.getElementById('bf-recruit-priority-panel');
      const pctPanel  = document.getElementById('bf-recruit-percent-panel');
      if (prioPanel) prioPanel.style.display = (v === 'priority') ? 'block' : 'none';
      if (pctPanel)  pctPanel.style.display  = (v === 'percent')  ? 'block' : 'none';
      persistRecruitFromDOM();
    });
    // Priority list — delegate change events for dynamically-rendered rows
    document.getElementById('bf-recruit-priority-list')?.addEventListener('change', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('bf-recruit-prio-en')) {
        persistRecruitFromDOM();
      }
    });
    // Reorder buttons re-render the list; hook a click listener that persists
    // AFTER the re-render is complete (next event-loop tick).
    document.getElementById('bf-recruit-priority-list')?.addEventListener('click', (e) => {
      if (e.target && (e.target.classList.contains('bf-recruit-prio-up') ||
                       e.target.classList.contains('bf-recruit-prio-dn'))) {
        setTimeout(persistRecruitFromDOM, 50);
      }
    });
    // Refresh live status — pulls fresh army state from /nourishing/index
    document.getElementById('bf-recruit-refresh')?.addEventListener('click', () => {
      refreshRecruitLiveStatus();
    });
    // Train now — manual trigger; bypasses cooldown AND trigger gates
    document.getElementById('bf-recruit-train-now')?.addEventListener('click', () => {
      botLog('info', '⚔ Recruit: Manual "Train now" requested');
      // Pull latest UI values into settings before firing.
      // IMPORTANT: only overwrite fields where the DOM is actually populated,
      // otherwise reading from a not-yet-rendered tab can blow away user
      // settings (the v1.6.4 "settings reset" bug).
      loadSettings((se) => {
        se.recruitEnabled = true; // ensure logic runs even if user hasn't toggled
        const trig = document.getElementById('bf-recruit-trigger');
        if (trig) se.recruitTrigger = trig.value || 'idle';
        const strat = document.getElementById('bf-recruit-strategy');
        if (strat) se.recruitStrategy = strat.value || 'priority';
        const res = document.getElementById('bf-recruit-reserve');
        if (res) se.recruitReserveBE = parseInt(res.value) || 0;

        const pctInputs = document.querySelectorAll('.bf-recruit-pct');
        if (pctInputs.length > 0) {
          const pct = {};
          pctInputs.forEach(inp => {
            const t = inp.dataset.unit;
            if (t) pct[t] = parseInt(inp.value) || 0;
          });
          se.recruitPercent = pct;
        }
        const prioRows = document.querySelectorAll('#bf-recruit-priority-list .bf-recruit-prio-row');
        if (prioRows.length > 0) {
          se.recruitEnabledTiers = readEnabledTiersFromDOM();
          se.recruitPriority = readPriorityOrderFromDOM();
        }

        saveSettings(se);
        loadState((st) => {
          // Bypass cycle cooldown AND trigger checks for manual trigger
          st.recruitLastCycle = 0;
          st.recruitNavigating = false; // clean slate
          saveState(st);
          const handled = globalRecruitTick(st, se, { skipGate: true });
          if (!handled) {
            botLog('warn', '⚔ Recruit: "Train now" did not produce an action — see prior log line for the reason (no tiers enabled / no BE / etc.)');
          }
        });
      });
    });

    // Build ruins level grid
    buildRuinsGrid();

    // v1.5.8 — wire up new ruins controls
    // Warm-start range row visibility follows the source selector
    document.getElementById('bf-ruins-warm-source')?.addEventListener('change', (e) => {
      const row = document.getElementById('bf-ruins-warm-range-row');
      if (row) row.style.display = (e.target.value === 'none') ? 'none' : 'flex';
    });
    // Kill E3 R1 toggle → update T4 info / T4 short action visibility
    document.getElementById('bf-ruins-opt-killE3')?.addEventListener('change', () => {
      loadSettings(se => {
        se.ruinsOptStratKillE3 = document.getElementById('bf-ruins-opt-killE3').checked;
        saveSettings(se);
        updateRuinsOptHints(se);
      });
    });
    // Army refresh button (in Army Status group)
    document.getElementById('bf-army-refresh')?.addEventListener('click', () => {
      const grid = document.getElementById('bf-army-status-grid');
      if (grid) grid.innerHTML = '<em style="color:#5a7a4a">Loading…</em>';
      _armyCache = null; // force fresh fetch
      fetchArmyState((data) => renderArmyStatus(data));
    });

    // Init UI from saved settings
    loadSettings((settings) => {
      applySettingsToUI(settings);
      loadState((state) => {
        updateHuntUI(settings, state);
        updateRuinsUI(settings, state);
        updateStoryUI(settings, state);
        updateGrottoUI(settings, state);
        updatePvPUI(settings, state);
        updateHenchmanUI(settings, state);
        updateGiftsUI(settings, state);
        applyGlobalSettingsToUI(settings);
        updateInfoBadges();

        // v1.6.10 — Start background page refresh cycle if enabled.
        // The ETA label loop runs unconditionally so the user sees "--"
        // when disabled and a live countdown when enabled.
        bgRefreshStartETALoop();
        if (settings.backgroundRefresh) bgRefreshSchedule(false);

        // ── Wait for Central STOP check BEFORE auto-resume ──
        initCentralStop((stopped) => {
          // Sync UI with central stop state
          if (stopped) {
            centralStopBtn.classList.add('engaged');
            updateStatusDot(settings, state);
            botLog('info', 'Central STOP is engaged — auto-resume blocked');
            return; // Do NOT resume any bots
          }

          // Auto-resume if any bot was running
          const huntActive = settings.huntEnabled && state.huntState !== 'idle';
          const ruinsActive = settings.ruinsEnabled && state.ruinsState !== 'idle' && state.ruinsState !== 'done';
          const storyActive = settings.storyEnabled && state.storyState !== 'idle' && state.storyState !== 'done';
          const grottoActive = settings.grottoEnabled && state.grottoState !== 'idle' && state.grottoState !== 'done';
          const pvpActive = settings.pvpEnabled && state.pvpState !== 'idle' && state.pvpState !== 'done';
          const henchmanActive = settings.henchmanEnabled && state.henchmanState !== 'idle' && state.henchmanState !== 'done';
          const giftsActive = state.giftsState === 'running' || settings.giftsAutoDBG;
          const globalActive = settings.goldMode > 0 || settings.graveyardEnabled || settings.recruitEnabled;
          // v1.6.14 — Inventory Cleanup must auto-resume too. Without this, the
          // page-reload that follows each /discardItem navigation kills the
          // loop after the first item (no tick fires, bot is stuck on
          // /profile/index until something else wakes it up). Triggers on:
          //   • manual run in progress (Run-Now flag set)
          //   • navigation handoff (sent ourselves to /profile)
          //   • auto-mode enabled (the tick's schedule gate decides if it actually fires)
          const invDiscardActive = !!settings.invDiscardEnabled && (
            !!state.invDiscardManualPending ||
            !!state.invDiscardNavigating ||
            (settings.invDiscardMode === 'auto')
          );

          if (huntActive || ruinsActive || storyActive || grottoActive || pvpActive || henchmanActive || giftsActive || globalActive || invDiscardActive) {
            const parts = [];
            if (huntActive) parts.push('Hunt' + (state.huntState === 'waiting_orb' ? ' (cooldown)' : ''));
            if (ruinsActive) parts.push('Ruins');
            if (storyActive) parts.push('Story');
            if (grottoActive) parts.push('Grotto');
            if (pvpActive) parts.push('PvP');
            if (henchmanActive) parts.push('Henchman');
            if (giftsActive) parts.push('Gifts');
            if (globalActive) parts.push('Global');
            if (invDiscardActive) parts.push('Inv Cleanup' + (state.invDiscardManualPending ? ' (manual)' : ''));
            botLog('info', `Bot resumed after reload: ${parts.join(' + ')}`);
            updateStatusDot(settings, state);

            // Start cooldown ticker if hunt is on cooldown
            if (huntActive && state.huntState === 'waiting_orb') {
              startCooldownTicker(settings, state);
            }

            // Single botTick call handles priority routing
            botSetTimeout(() => botTick(state, settings), randomDelay(1500, 3000));
          }
        });
      });
    });
  }

  // ── CENTRAL STOP CHECK ──────────────────────────────────────
  // Cached flag — updated by central stop button and on init
  let _centralStopActive = false;
  // Track whether initCentralStop has resolved (prevent auto-resume race)
  let _centralStopReady = false;

  // ── TIMER REGISTRY — all bot setTimeout/setInterval go through these ──
  const _botTimers = new Set();
  const _botIntervals = new Set();

  function botSetTimeout(fn, delay) {
    const id = setTimeout(() => {
      _botTimers.delete(id);
      // Re-check central stop before every scheduled callback fires
      if (_centralStopActive) return;
      fn();
    }, delay);
    _botTimers.add(id);
    return id;
  }

  function botSetInterval(fn, delay) {
    const id = setInterval(() => {
      if (_centralStopActive) {
        clearInterval(id);
        _botIntervals.delete(id);
        return;
      }
      fn();
    }, delay);
    _botIntervals.add(id);
    return id;
  }

  function cancelAllBotTimers() {
    _botTimers.forEach(id => clearTimeout(id));
    _botTimers.clear();
    _botIntervals.forEach(id => clearInterval(id));
    _botIntervals.clear();
    // Also kill the cooldown ticker
    stopCooldownTicker();
    // v1.6.10 — pause (but don't reset) the background-refresh cycle.
    // The persisted "next at" is preserved; bgRefreshTick re-checks
    // _centralStopActive and defers if engaged, so the schedule survives
    // a stop/release cycle and resumes from where it left off.
    if (_bgRefreshTimerId) { clearTimeout(_bgRefreshTimerId); _bgRefreshTimerId = null; }
  }

  // ── BACKGROUND PAGE REFRESH (v1.6.10 — BK-style structured cycle) ──
  // Periodically reloads the current page so the bot can re-tick from a
  // fresh DOM. The "next refresh at" timestamp is persisted via storage
  // under SK('bgRefreshNextAt') so the cycle survives the very reload it
  // triggers — without that the timer would restart every page load and
  // never fire on schedule.
  //
  // Storage key: SK('bgRefreshNextAt') — number (Date.now() + delay)
  //
  // Behaviour:
  //   • bgRefreshSchedule(force)
  //       Reads settings, computes a fresh "next at" if none persisted or
  //       force === true, then schedules a timer to fire at that time.
  //   • bgRefreshCancel()
  //       Clears the in-memory timer and removes the persisted "next at".
  //   • bgRefreshTick()
  //       The actual reload trigger. Skipped if Central STOP is engaged.
  //   • bgRefreshETALoop()
  //       Updates the live "Next refresh: Xm Ys" label every second.

  let _bgRefreshTimerId = null;
  let _bgRefreshEtaIntervalId = null;

  function bgRefreshComputeNextAt(settings) {
    const baseMin = Math.max(1, Math.min(600, parseInt(settings.backgroundRefreshInterval) || 60));
    const randMin = Math.max(0, Math.min(60, parseInt(settings.backgroundRefreshRandomize) || 0));
    const jitter = randMin > 0 ? (Math.random() * 2 - 1) * randMin : 0;
    const totalMs = Math.max(60000, Math.round((baseMin + jitter) * 60 * 1000)); // floor 1 min
    return Date.now() + totalMs;
  }

  function bgRefreshCancel() {
    if (_bgRefreshTimerId) { clearTimeout(_bgRefreshTimerId); _bgRefreshTimerId = null; }
    // Clear persisted "next at" so a future enable starts fresh.
    if (ctxOk()) {
      try { chrome.storage.local.remove([SK('bgRefreshNextAt')]); } catch(e) {}
    }
    const eta = document.getElementById('bf-bg-refresh-eta');
    if (eta) { eta.textContent = '--'; eta.style.color = '#5a4a3a'; }
  }

  function bgRefreshSchedule(force) {
    if (_bgRefreshTimerId) { clearTimeout(_bgRefreshTimerId); _bgRefreshTimerId = null; }
    loadSettings(settings => {
      if (!settings.backgroundRefresh) return bgRefreshCancel();
      sGet([SK('bgRefreshNextAt')], r => {
        let nextAt = r[SK('bgRefreshNextAt')];
        if (force || !nextAt || nextAt <= Date.now()) {
          nextAt = bgRefreshComputeNextAt(settings);
          sSet({ [SK('bgRefreshNextAt')]: nextAt });
        }
        const delay = Math.max(1000, nextAt - Date.now());
        // setTimeout maximum is ~24.8 days; our max is 600+60 min so safe.
        _bgRefreshTimerId = setTimeout(bgRefreshTick, delay);
      });
    });
  }

  function bgRefreshTick() {
    _bgRefreshTimerId = null;
    if (_centralStopActive) {
      // Defer: re-check in 30s — central stop should not eat the cycle.
      _bgRefreshTimerId = setTimeout(bgRefreshTick, 30000);
      return;
    }
    loadSettings(settings => {
      if (!settings.backgroundRefresh) return;
      botLog('info', '🔄 Background refresh — reloading page');
      // Pre-compute the NEXT next-at BEFORE reload, so the cycle continues
      // smoothly after the new page boots.
      const nextAt = bgRefreshComputeNextAt(settings);
      sSet({ [SK('bgRefreshNextAt')]: nextAt }, () => {
        // Tiny delay so the storage write definitely commits.
        setTimeout(() => { window.location.reload(); }, 200);
      });
    });
  }

  function bgRefreshFormatETA(ms) {
    if (ms <= 0) return 'now';
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return `${h}h ${rm}m`;
    }
    return `${m}m ${s}s`;
  }

  function bgRefreshStartETALoop() {
    if (_bgRefreshEtaIntervalId) return; // already running
    const tick = () => {
      const eta = document.getElementById('bf-bg-refresh-eta');
      if (!eta) return;
      sGet([SK('bgRefreshNextAt')], r => {
        const nextAt = r[SK('bgRefreshNextAt')];
        if (!nextAt) { eta.textContent = '--'; eta.style.color = '#5a4a3a'; return; }
        const remaining = nextAt - Date.now();
        eta.textContent = bgRefreshFormatETA(remaining);
        // Green when plenty of time, orange under 2 min, red under 30s
        if (remaining < 30000)      eta.style.color = '#e74c3c';
        else if (remaining < 120000) eta.style.color = '#e0a030';
        else                          eta.style.color = '#2ecc71';
      });
    };
    tick();
    _bgRefreshEtaIntervalId = setInterval(tick, 1000);
  }

  function initCentralStop(cb) {
    sGet([SK('centralStop')], r => {
      _centralStopActive = r[SK('centralStop')] === true;
      _centralStopReady = true;
      if (cb) cb(_centralStopActive);
    });
  }
  // NOTE: initCentralStop is called at boot — see createBotPanel auto-resume
  function isCentralStopped(cb) {
    if (cb) { cb(_centralStopActive); return; }
    return _centralStopActive;
  }

  // ── STATUS DOT LOGIC ──────────────────────────────────────────
  // Color rules:
  //   Green  — bot actively executing actions
  //   Yellow — bot enabled but waiting (cooldown, delay)
  //   Red    — Central STOP engaged
  //   Error  — blinking red, unknown error
  //   White  — bot off, only Global active
  //   None   — everything off (transparent)
  let _lastBotError = false;
  function setBotError(isError) { _lastBotError = isError; updateStatusDot(); }

  function updateStatusDot(settingsArg, stateArg) {
    const dot = document.getElementById('bf-bot-dot');
    if (!dot) return;
    // Clear all dot classes
    dot.className = 'bf-bot-status-dot';

    const apply = (settings, state) => {
      // 1. Check central stop first
      sGet([SK('centralStop')], r => {
        if (r[SK('centralStop')] === true) {
          dot.classList.add('dot-red');
          return;
        }
        // 2. Check for error
        if (_lastBotError) {
          dot.classList.add('dot-error');
          return;
        }
        const huntActive = settings.huntEnabled && state.huntState !== 'idle' && state.huntState !== 'done';
        const huntWaiting = settings.huntEnabled && state.huntState === 'waiting_orb';
        const ruinsActive = settings.ruinsEnabled && state.ruinsState !== 'idle' && state.ruinsState !== 'done';
        const ruinsWaiting = settings.ruinsEnabled && state.ruinsState === 'waiting_training';
        const storyActive = settings.storyEnabled && state.storyState !== 'idle' && state.storyState !== 'done';
        const storyWaiting = settings.storyEnabled && (state.storyState === 'waiting_ap' || state.storyRecovering);
        const grottoActive = settings.grottoEnabled && state.grottoState !== 'idle' && state.grottoState !== 'done';
        const pvpActive = settings.pvpEnabled && state.pvpState !== 'idle' && state.pvpState !== 'done';
        const pvpWaiting = settings.pvpEnabled && state.pvpState === 'waiting';
        const henchmanActive = settings.henchmanEnabled && state.henchmanState !== 'idle' && state.henchmanState !== 'done';
        const henchmanWaiting = settings.henchmanEnabled && state.henchmanState === 'waiting';
        const giftsActive = state.giftsState === 'running' || settings.giftsAutoDBG;
        const globalActive = settings.goldMode > 0 || settings.graveyardEnabled || settings.recruitEnabled;

        const anyBotEnabled = huntActive || ruinsActive || storyActive || grottoActive || pvpActive || henchmanActive || giftsActive;
        const allWaiting = (!huntActive || huntWaiting) &&
                           (!storyActive || storyWaiting) &&
                           (!pvpActive || pvpWaiting) &&
                           (!henchmanActive || henchmanWaiting) &&
                           (!ruinsActive || ruinsWaiting) &&
                           !grottoActive && !giftsActive;

        if (anyBotEnabled && !allWaiting) {
          // 3. Green — actively running
          dot.classList.add('dot-green');
        } else if (anyBotEnabled && allWaiting) {
          // 4. Yellow — enabled but all are waiting
          dot.classList.add('dot-yellow');
        } else if (globalActive) {
          // 5. White — only global features active
          dot.classList.add('dot-white');
        }
        // else: transparent (everything off)
      });
    };

    if (settingsArg && stateArg) {
      apply(settingsArg, stateArg);
    } else {
      loadSettings(se => { loadState(st => { apply(se, st); }); });
    }
  }

  // ── UI HELPERS ───────────────────────────────────────────────
  function updateInfoBadges() {
    const ap = readAP();
    const be = readBE();
    const abPct = getABPercent();
    const apEl = document.getElementById('bf-h-ap');
    const abEl = document.getElementById('bf-h-ab');
    const beEl = document.getElementById('bf-h-be');
    if (apEl) apEl.textContent = ap.current !== null ? `${ap.current}/${ap.max}` : '–';
    if (abEl) abEl.textContent = abPct !== null ? `${abPct}%` : '–';
    if (beEl) beEl.textContent = be !== null ? String(be) : '–';

    // Orbs — try live page data first, fall back to state
    const orbs = readOrbsOnRobberyPage();
    const orbEl = document.getElementById('bf-h-orbs');
    if (orbEl) {
      if (orbs.total > 0) {
        orbEl.textContent = `${orbs.ready}/${orbs.total}`;
      } else {
        // Not on robbery page — show from state
        sGet([SK('state')], r => {
          const st = r[SK('state')] || {};
          const extr = st.extractionsThisSession || 0;
          if (st.huntState === 'waiting_orb') {
            orbEl.textContent = `0/3 ⏳`;
          } else if (extr > 0) {
            orbEl.textContent = `${Math.max(0, 3 - extr)}/3`;
          } else {
            orbEl.textContent = '–';
          }
        });
      }
    }

    // Story tab AP
    const storyApEl = document.getElementById('bf-s-ap');
    if (storyApEl) storyApEl.textContent = ap.current !== null ? `${ap.current}/${ap.max}` : '–';

    // Story tab HP
    const hp = readHP();
    const hpPct = getHPPercent();
    const hpEl = document.getElementById('bf-s-hp');
    if (hpEl) {
      if (hp.current !== null) {
        hpEl.textContent = `${hp.current.toLocaleString()}/${hp.max.toLocaleString()} (${hpPct}%)`;
        hpEl.style.color = hpPct > 50 ? '#2ecc71' : hpPct > 25 ? '#e67e22' : '#e74c3c';
      } else {
        hpEl.textContent = '–';
      }
    }
  }

  // ── COOLDOWN TICKER ─────────────────────────────────────────
  let _cooldownInterval = null;

  function startCooldownTicker(settings, state) {
    stopCooldownTicker();
    const container = document.getElementById('bf-hunt-cooldown');
    if (!container) return;
    container.style.display = 'block';

    // Total duration = from when cooldown was set until orbWaitUntil
    // We store the start time so progress bar is accurate
    const until = state.orbWaitUntil || 0;
    const fallbackTotal = settings.orbCooldownMs || (5 * 60 * 60 * 1000);
    // Estimate: total = max(orbCooldownMs, time remaining) — for accurate bar
    const remainNow = Math.max(0, until - Date.now());
    const totalMs = Math.max(fallbackTotal, remainNow);

    // v1.6.5 — Counter for periodic global-module re-tick during cooldown.
    // Fires botTick every ~30 seconds so Spend Gold / Auto Recruitment /
    // Graveyard can run when nothing else is keeping the bot awake.
    let _coolDownTickCounter = 0;
    const GLOBAL_RETICK_EVERY = 30; // seconds (matches interval = 1000ms)

    _cooldownInterval = botSetInterval(() => {
      const now = Date.now();
      const until = state.orbWaitUntil || 0;
      const remainMs = Math.max(0, until - now);

      // Time display
      const totalSec = Math.ceil(remainMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const timeEl = document.getElementById('bf-cooldown-time');
      if (timeEl) timeEl.textContent = `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;

      // Progress bar (how much elapsed)
      const elapsed = totalMs - remainMs;
      const pct = Math.min(100, Math.max(0, (elapsed / totalMs) * 100));
      const fill = document.getElementById('bf-cooldown-fill');
      if (fill) fill.style.width = pct + '%';

      // ETA
      const eta = document.getElementById('bf-cooldown-eta');
      if (eta) {
        const etaDate = new Date(until);
        eta.textContent = `ETA: ${etaDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      }

      // Status text
      const status = document.getElementById('bf-hunt-status');
      if (status) status.textContent = `Cooldown: ${h}h ${String(m).padStart(2,'0')}m`;

      // v1.6.5 — Periodic global-module re-tick while waiting for cooldown.
      // Skipped if we're about to finish (remainMs <= 0 handler will navigate).
      _coolDownTickCounter++;
      if (remainMs > 0 && _coolDownTickCounter >= GLOBAL_RETICK_EVERY) {
        _coolDownTickCounter = 0;
        loadState(st => {
          loadSettings(se => {
            // v1.6.14 — Inventory Cleanup is also a global-style module that
            // can need re-ticking during Hunt cooldown (e.g. user pressed
            // Run-Now while waiting_orb is active).
            const globalsEnabled = (se.goldMode > 0) || !!se.recruitEnabled || !!se.graveyardEnabled || !!se.invDiscardEnabled;
            // Only fire if we're still in waiting_orb and a global module is on.
            // (If the user disabled hunt during cooldown, huntState may differ.)
            if (globalsEnabled && st.huntState === 'waiting_orb') {
              botTick(st, se);
            }
          });
        });
      }

      // Done?
      if (remainMs <= 0) {
        stopCooldownTicker();
        if (timeEl) timeEl.textContent = 'DONE!';
        if (fill) fill.style.width = '100%';
        if (status) status.textContent = 'Restarting hunt...';
        // Trigger re-tick
        loadState(st => {
          loadSettings(se => {
            if (se.huntEnabled && st.huntState === 'waiting_orb') {
              botLog('info', 'Orb cooldown ended → Restarting hunt');
              st.huntState = 'navigating';
              st.extractionsThisSession = 0;
              saveState(st);
              // Navigate to hunt page
              botSetTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 3000));
            }
          });
        });
      }
    }, 1000);
  }

  function stopCooldownTicker() {
    if (_cooldownInterval) {
      clearInterval(_cooldownInterval);
      _botIntervals.delete(_cooldownInterval);
      _cooldownInterval = null;
    }
    const container = document.getElementById('bf-hunt-cooldown');
    if (container) container.style.display = 'none';
  }

  function updateHuntUI(settings, state) {
    const btn = document.getElementById('bf-hunt-toggle');
    const status = document.getElementById('bf-hunt-status');
    const dot = document.getElementById('bf-bot-dot');

    if (settings.huntEnabled) {
      btn.textContent = '⏹ Stop Hunt Bot';
      btn.classList.add('running');
      if (state.huntState === 'waiting_orb' && (state.orbWaitUntil || 0) > Date.now()) {
        startCooldownTicker(settings, state);
      } else {
        stopCooldownTicker();
        if (status) status.textContent = state.huntState === 'done' ? 'Completed' : 'Running...';
      }
      if (dot) updateStatusDot(settings, state);
    } else {
      btn.textContent = '▶ Start Hunt Bot';
      btn.classList.remove('running');
      stopCooldownTicker();
      if (status) status.textContent = 'Disabled';
      if (dot) updateStatusDot(settings, state);
    }
  }

  function updateRuinsUI(settings, state) {
    const btn = document.getElementById('bf-ruins-toggle');
    const status = document.getElementById('bf-ruins-status');
    const dot = document.getElementById('bf-bot-dot');

    if (settings.ruinsEnabled) {
      btn.textContent = '⏹ Stop Ruins Bot';
      btn.classList.add('running');
      if (status) status.textContent = `Running... (cycle ${state.ruinsCurrentCycle || 1})`;
      if (dot) updateStatusDot(settings, state);
    } else {
      btn.textContent = '▶ Start Ruins Bot';
      btn.classList.remove('running');
      if (status) status.textContent = 'Disabled';
      if (dot) updateStatusDot(settings, state);
    }
  }

  function updateStoryUI(settings, state) {
    const btn = document.getElementById('bf-story-toggle');
    const status = document.getElementById('bf-story-status');
    const dot = document.getElementById('bf-bot-dot');

    if (!btn) return;

    if (settings.storyEnabled) {
      btn.textContent = '⏹ Stop Story Bot';
      btn.classList.add('running');
      const progress = state.storyProgress;
      let statusText = 'Running...';
      if (state.storyState === 'waiting_ap') statusText = 'Waiting for AP';
      else if (state.storyRecovering) statusText = 'Regenerating HP';
      else if (progress && progress.current !== null) {
        statusText = `${progress.current.toLocaleString()}/${progress.total.toLocaleString()}`;
        if (state.storyLocation) statusText += ` - ${state.storyLocation}`;
      }
      if (status) status.textContent = statusText;
      if (dot) updateStatusDot(settings, state);
    } else {
      btn.textContent = '▶ Start Story Bot';
      btn.classList.remove('running');
      if (status) status.textContent = 'Disabled';
      if (dot) updateStatusDot(settings, state);
    }

    // Update HP display
    const hp = readHP();
    const hpEl = document.getElementById('bf-s-hp');
    const hpPct = getHPPercent();
    if (hpEl) {
      if (hp.current !== null) {
        hpEl.textContent = `${hp.current.toLocaleString()}/${hp.max.toLocaleString()} (${hpPct}%)`;
        hpEl.style.color = hpPct > 50 ? '#2ecc71' : hpPct > 25 ? '#e67e22' : '#e74c3c';
      } else {
        hpEl.textContent = '–';
      }
    }
  }

  // v1.6.0 — Levels grid (1..50) with drag-paint selection.
  // Pointer events handle mouse, touch and pen uniformly. Each touched
  // cell toggles to a single "paint" state determined by the first
  // cell's new value at pointerdown. Cells are tracked in a per-drag
  // Set so re-entering the same cell doesn't bounce its state.
  //
  // Layers > 50 are NOT in the grid — user enters them in the Custom
  // ("Additional") field and they are unioned at save time.
  //
  // The 🔒 Lock toggle disables all pointer interaction and the Custom
  // input. The lock state is persisted in settings.ruinsLevelsLocked.
  const RUINS_GRID_SIZE = 50;

  function buildRuinsGrid() {
    const grid = document.getElementById('bf-ruins-level-grid');
    if (!grid) return;
    let html = '';
    for (let i = 1; i <= RUINS_GRID_SIZE; i++) {
      // Default selection (1..20) is applied later in applySettingsToUI;
      // build cells in unselected state here so applySettings is authoritative.
      html += `<div class="bf-ruins-lvl" data-level="${i}">${i}</div>`;
    }
    grid.innerHTML = html;
    attachRuinsGridDragHandlers(grid);
  }

  // Idempotent: detaches old listeners by replacing the grid's inline
  // dataset flag, but in practice buildRuinsGrid is called once at boot
  // so we just attach here. Uses pointer events for unified input handling.
  function attachRuinsGridDragHandlers(grid) {
    let dragging = false;
    let paintMode = false;     // true → mark as selected; false → mark as unselected
    let touched = null;        // Set of level numbers toggled in this drag

    function isLocked() {
      return grid.classList.contains('locked');
    }

    function cellAtPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const cell = el.closest('.bf-ruins-lvl');
      if (!cell || !grid.contains(cell)) return null;
      return cell;
    }

    function applyPaint(cell) {
      const lvl = parseInt(cell.getAttribute('data-level'));
      if (!lvl || (touched && touched.has(lvl))) return;
      if (paintMode) cell.classList.add('selected');
      else cell.classList.remove('selected');
      if (touched) touched.add(lvl);
    }

    grid.addEventListener('pointerdown', (e) => {
      if (isLocked()) { return; }
      const cell = e.target.closest('.bf-ruins-lvl');
      if (!cell || !grid.contains(cell)) return;
      e.preventDefault();
      // Paint mode = inverse of cell's current state (so the first
      // touched cell flips immediately and sets the direction).
      paintMode = !cell.classList.contains('selected');
      touched = new Set();
      dragging = true;
      applyPaint(cell);
      // Use setPointerCapture so pointermove keeps firing even if the
      // pointer briefly leaves the grid (mobile finger drift).
      try { grid.setPointerCapture(e.pointerId); } catch (_) {}
    });

    grid.addEventListener('pointermove', (e) => {
      if (!dragging || isLocked()) return;
      const cell = cellAtPoint(e.clientX, e.clientY);
      if (cell) applyPaint(cell);
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      touched = null;
      try { grid.releasePointerCapture(e.pointerId); } catch (_) {}
      // Persist immediately so the toggle button doesn't have to gather
      loadSettings(se => {
        se.ruinsLevels = readGridAndCustomLevels();
        saveSettings(se);
      });
    }
    grid.addEventListener('pointerup', endDrag);
    grid.addEventListener('pointercancel', endDrag);
    grid.addEventListener('pointerleave', (e) => {
      // Only end drag if pointer is actually released (no buttons).
      // pointerleave fires on capture too, so check buttons state.
      if (!dragging) return;
      if (e.buttons === 0) endDrag(e);
    });
  }

  // Read the grid's current selection AND the Custom input, union them,
  // and return a sorted unique array of levels. Used both at save-time
  // and during drag persistence.
  function readGridAndCustomLevels() {
    const set = new Set();
    document.querySelectorAll('.bf-ruins-lvl.selected').forEach(el => {
      const n = parseInt(el.getAttribute('data-level'));
      if (n > 0) set.add(n);
    });
    const customRaw = document.getElementById('bf-ruins-custom')?.value?.trim() || '';
    if (customRaw) {
      customRaw.split(/[\s,;]+/).forEach(tok => {
        const n = parseInt(tok);
        if (n > 0) set.add(n);
      });
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  // v1.6.0 — Lock toggle applies a CSS class that blocks pointer/custom
  // interaction and updates the button glyph. Persisted in settings.
  function applyRuinsLockState(locked) {
    const grid = document.getElementById('bf-ruins-level-grid');
    const btn = document.getElementById('bf-ruins-lock-btn');
    const custom = document.getElementById('bf-ruins-custom');
    if (grid) {
      grid.classList.toggle('locked', !!locked);
    }
    if (custom) {
      custom.disabled = !!locked;
      custom.style.opacity = locked ? '0.55' : '1';
      custom.title = locked ? 'Unlock first to edit' : '';
    }
    if (btn) {
      btn.textContent = locked ? '🔒' : '🔓';
      btn.title = locked ? 'Click to unlock' : 'Lock selection (prevent accidental changes)';
      btn.style.color = locked ? '#e0a030' : '#5a7a4a';
    }
  }

  // v1.5.8 — UNLOCKED tier bar in Ruins panel (T1..T8 buttons).
  // Mirrors the simulator's UNLOCKED bar visuals. The selection drives
  // the optimizer & preset validators (locked tiers can't appear in
  // suggested formations).
  function buildRuinsUnlockBar(unlockedIds) {
    const bar = document.getElementById('bf-ruins-unlock-bar');
    if (!bar) return;
    const allTiers = ['T1','T2','T3','T4','T5','T6','T7','T8'];
    const setU = new Set(unlockedIds && unlockedIds.length ? unlockedIds : ['T1','T2','T3','T4','T5','T6']);
    bar.innerHTML = '';
    allTiers.forEach(tid => {
      const unlocked = setU.has(tid);
      const btn = document.createElement('button');
      btn.setAttribute('data-rt', tid);
      btn.dataset.unlocked = unlocked ? '1' : '0';
      btn.textContent = 'Tier ' + tid.slice(1);
      btn.title = unlocked ? 'Click to lock' : 'Click to unlock';
      btn.style.cssText = 'font-family:Cinzel,serif;font-size:0.62rem;padding:2px 8px;border-radius:10px;cursor:pointer;'
        + (unlocked
          ? 'background:rgba(201,168,76,0.15);color:#e0c068;border:1px solid #c9a84c;'
          : 'background:rgba(255,255,255,0.03);color:#5a4a3a;border:1px solid #2a1218;');
      btn.addEventListener('click', () => {
        const nowU = btn.dataset.unlocked === '1';
        btn.dataset.unlocked = nowU ? '0' : '1';
        btn.title = nowU ? 'Click to unlock' : 'Click to lock';
        btn.style.background = nowU ? 'rgba(255,255,255,0.03)' : 'rgba(201,168,76,0.15)';
        btn.style.color      = nowU ? '#5a4a3a' : '#e0c068';
        btn.style.borderColor= nowU ? '#2a1218' : '#c9a84c';
        // Persist immediately (separate from the toggle button save)
        loadSettings(se => {
          const sel = [];
          document.querySelectorAll('#bf-ruins-unlock-bar [data-rt]').forEach(b => {
            if (b.dataset.unlocked === '1') sel.push(b.getAttribute('data-rt'));
          });
          se.ruinsAllyUnlocks = sel.length ? sel : ['T1'];
          saveSettings(se);
          // Refresh T4 info hint if Kill E3 R1 is on
          updateRuinsOptHints(se);
        });
      });
      bar.appendChild(btn);
    });
  }

  // v1.5.9 — Build per-layer-band interval input rows in the Cadence group.
  // Renders one row per band (L1-10, L11-20, …, L91-100, L101+) with a
  // number input bound to settings.ruinsIntervalBands[band]. Changes
  // persist immediately. The user can scroll the inner container since
  // 11 rows don't all fit at once.
  function buildRuinsIntervalBands(bandValues) {
    const host = document.getElementById('bf-ruins-interval-bands');
    if (!host) return;
    host.innerHTML = '';
    const vals = bandValues || {};
    RUINS_BAND_KEYS.forEach(key => {
      const cur = parseInt(vals[key]) || 0;
      const labelTxt = key === '101' ? 'L 101+' : ('L ' + key);
      const row = document.createElement('div');
      row.className = 'bf-bot-row';
      row.style.cssText = 'margin-bottom:3px;gap:6px;flex-wrap:wrap';
      row.innerHTML = `
        <span class="bf-bot-label" style="min-width:0;flex:0 0 56px;color:#7a9a6a">${labelTxt}</span>
        <input type="number" class="bf-bot-input bf-ruins-band-input" data-band="${key}" value="${cur || 60}" min="1" max="1440" style="width:55px;flex:0 0 auto">
        <span style="color:#5a7a4a;font-size:0.6rem">min</span>
      `;
      host.appendChild(row);
    });
    // Immediate persist on change
    host.querySelectorAll('.bf-ruins-band-input').forEach(inp => {
      inp.addEventListener('change', () => {
        loadSettings(se => {
          if (!se.ruinsIntervalBands) se.ruinsIntervalBands = {};
          const band = inp.getAttribute('data-band');
          const v = parseInt(inp.value);
          if (band && v > 0 && v <= 1440) se.ruinsIntervalBands[band] = v;
          saveSettings(se);
        });
      });
    });
  }

  // v1.5.8 — Update hint area for "Kill E3 R1" (T4 required).
  function updateRuinsOptHints(settings) {
    const info = document.getElementById('bf-ruins-opt-t4-info');
    const t4ShortRow = document.getElementById('bf-ruins-t4short-row');
    if (!info) return;
    const killE3 = !!settings.ruinsOptStratKillE3;
    const t4Unlocked = (settings.ruinsAllyUnlocks || []).indexOf('T4') >= 0;
    if (killE3) {
      info.style.display = 'block';
      info.innerHTML = t4Unlocked
        ? '<span style="color:#9b59b6">☠ Kill E3 R1 active</span> — T4 minimum is calculated per battle from E3 count.'
        : '<span style="color:#e74c3c">⚠ T4 is locked!</span> Unlock T4 in the bar above or this strategy cannot run.';
    } else {
      info.style.display = 'none';
    }
    if (t4ShortRow) t4ShortRow.style.display = killE3 ? 'block' : 'none';
  }

  // v1.5.8 — Render the Army Status grid (T1..T8 owned / cooldown / queue ETA).
  // Called via the ↻ refresh button. Data fetched in background (no navigation).
  function renderArmyStatus(data) {
    const grid = document.getElementById('bf-army-status-grid');
    if (!grid) return;
    if (!data) {
      grid.innerHTML = '<em style="color:#e74c3c">Failed to fetch army state.</em>';
      return;
    }
    const rows = [];
    let any = false;
    for (let n = 1; n <= 8; n++) {
      const tid = 'T' + n;
      const owned = data.owned[tid];
      const cd    = data.cooldown[tid] || 0;
      const queue = data.queue[tid];
      if (owned == null && !queue) continue;
      any = true;
      const queuePart = queue
        ? ` <span style="color:#9b59b6">+${queue.qty} training</span>`
          + (queue.nextReadySec > 0 ? ` <span style="color:#5a7a4a">(next: ${formatSeconds(queue.nextReadySec)})</span>` : '')
        : '';
      const cdPart = cd > 0 ? ` <span style="color:#c0392b">${cd} ⏱</span>` : '';
      rows.push(`<div><b style="color:#e0c068">${tid}</b>: <span style="color:#f0d080">${owned || 0}</span>${cdPart}${queuePart}</div>`);
    }
    if (!any) {
      grid.innerHTML = '<em style="color:#5a7a4a">No army data (recruit some units first).</em>';
      return;
    }
    rows.push(`<div style="margin-top:4px;color:#5a7a4a;font-size:0.54rem">Total value: <b>${data.totalValue.toLocaleString()}</b></div>`);
    grid.innerHTML = rows.join('');
  }

  function formatSeconds(s) {
    if (!s || s < 0) return '-';
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const ss = s % 60;
    if (m < 60) return m + 'm ' + (ss > 0 ? ss + 's' : '');
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }

  // v1.6.0 — Levels are the union of the grid (1..50) AND the Custom
  // input (>50, free-form). Previously Custom acted as override; now
  // it is additive so grid + custom always combine.
  function getSelectedRuinsLevels() {
    return readGridAndCustomLevels();
  }

  function applySettingsToUI(settings) {
    // Hunt mode
    const autoRadio = document.getElementById('bf-hm-auto');
    const manualRadio = document.getElementById('bf-hm-manual');
    if (settings.huntMode === 'manual') {
      if (manualRadio) manualRadio.checked = true;
      document.getElementById('bf-manual-type-row').style.display = 'flex';
      document.getElementById('bf-auto-rules').style.display = 'none';
    } else {
      if (autoRadio) autoRadio.checked = true;
    }
    const manualType = document.getElementById('bf-manual-type');
    if (manualType) manualType.value = String(settings.huntManualType || 5);

    // Extraction
    const extractEn = document.getElementById('bf-extract-enabled');
    if (extractEn) extractEn.checked = settings.extractEnabled !== false;
    const extractRep = document.getElementById('bf-extract-repeat');
    if (extractRep) extractRep.checked = settings.extractAutoRepeat !== false;

    // ── Auto Recruitment (v1.6.4) ──────────────────────────────
    const recruitEn = document.getElementById('bf-recruit-enabled');
    if (recruitEn) recruitEn.checked = !!settings.recruitEnabled;
    const recruitTrigger = document.getElementById('bf-recruit-trigger');
    // Migrate legacy 'every' (old "after every extraction") → new 'extraction' value
    let trig = settings.recruitTrigger || 'idle';
    if (trig === 'every') trig = 'extraction';
    if (recruitTrigger) recruitTrigger.value = trig;
    const recruitThreshold = document.getElementById('bf-recruit-threshold');
    if (recruitThreshold) recruitThreshold.value = settings.recruitThreshold || 100;
    const thresholdRow = document.getElementById('bf-recruit-threshold-row');
    if (thresholdRow) thresholdRow.style.display = (trig === 'threshold') ? 'flex' : 'none';
    // Strategy selector & sub-panels
    const recruitStrategy = document.getElementById('bf-recruit-strategy');
    const strat = settings.recruitStrategy || 'priority';
    if (recruitStrategy) recruitStrategy.value = strat;
    const prioPanel = document.getElementById('bf-recruit-priority-panel');
    const pctPanel  = document.getElementById('bf-recruit-percent-panel');
    if (prioPanel) prioPanel.style.display = (strat === 'priority') ? 'block' : 'none';
    if (pctPanel)  pctPanel.style.display  = (strat === 'percent')  ? 'block' : 'none';
    // Reserve BE
    const recruitReserve = document.getElementById('bf-recruit-reserve');
    if (recruitReserve) recruitReserve.value = parseInt(settings.recruitReserveBE) || 0;
    // Restore % allocations (T1-T8)
    const rPct = settings.recruitPercent || {};
    document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
      const unitId = inp.dataset.unit;
      if (unitId && rPct[unitId] !== undefined) inp.value = rPct[unitId];
    });
    updateRecruitTotal();
    // Build priority list rows from saved order + enabled tiers
    renderRecruitPriorityRows(
      settings.recruitPriority || TIER_ORDER_DEFAULT.slice(),
      settings.recruitEnabledTiers || {}
    );

    // Ignore qualities
    const ignoreQ = settings.huntIgnoreQ || [];
    document.querySelectorAll('#bf-ignore-q input[data-iq]').forEach(cb => {
      cb.checked = ignoreQ.includes(cb.value);
    });

    // Manual mode accept qualities
    const manualAccQ = settings.huntManualAcceptQ || ['S','A','B','C','D','E'];
    document.querySelectorAll('#bf-manual-accept-q input[data-maq]').forEach(cb => {
      cb.checked = manualAccQ.includes(cb.value);
    });
    // Show/hide manual quality row based on mode
    const manualQRow = document.getElementById('bf-manual-quality-row');
    if (manualQRow) manualQRow.style.display = settings.huntMode === 'manual' ? 'flex' : 'none';

    // Ruins cadence
    const cadenceRadio = document.getElementById('bf-rc-' + (settings.ruinsCadence === 'once' ? 'once' : settings.ruinsCadence === 'cycles' ? 'cycles' : 'inf'));
    if (cadenceRadio) cadenceRadio.checked = true;

    const cyclesInput = document.getElementById('bf-ruins-cycles');
    if (cyclesInput) cyclesInput.value = settings.ruinsCycles || 5;

    const intervalInput = document.getElementById('bf-ruins-interval');
    if (intervalInput) intervalInput.value = settings.ruinsIntervalMin || 60;

    // Ruins levels — restore grid (1..50) and split levels >50 into Custom field.
    // v1.6.0: grid + custom are now UNION; previously custom was an override.
    // We migrate any pre-1.6.0 save by populating the Custom input from
    // levels that fall outside the grid range.
    const levels = settings.ruinsLevels || [];
    const inGrid = new Set();
    const outGrid = [];
    levels.forEach(l => {
      const n = parseInt(l);
      if (!n || n < 1) return;
      if (n <= RUINS_GRID_SIZE) inGrid.add(n);
      else outGrid.push(n);
    });
    document.querySelectorAll('.bf-ruins-lvl').forEach(el => {
      const lvl = parseInt(el.getAttribute('data-level'));
      if (inGrid.has(lvl)) el.classList.add('selected');
      else el.classList.remove('selected');
    });
    const customEl = document.getElementById('bf-ruins-custom');
    if (customEl) customEl.value = outGrid.length ? outGrid.sort((a,b) => a - b).join(', ') : '';
    // v1.6.0 — apply lock state
    applyRuinsLockState(!!settings.ruinsLevelsLocked);

    // Ruins safety settings
    const stopNoWin = document.getElementById('bf-ruins-stop-nowin');
    if (stopNoWin) stopNoWin.checked = settings.ruinsStopNoWin !== false;
    const stopPreset = document.getElementById('bf-ruins-stop-preset-short');
    if (stopPreset) stopPreset.checked = settings.ruinsStopPresetShort !== false;
    // v1.6.2 — Ignore Presets toggle
    const ignorePresetsEl = document.getElementById('bf-ruins-ignore-presets');
    if (ignorePresetsEl) ignorePresetsEl.checked = !!settings.ruinsIgnorePresets;
    const stopMinU = document.getElementById('bf-ruins-stop-min-units');
    if (stopMinU) {
      stopMinU.checked = !!settings.ruinsStopMinUnits;
      const row = document.getElementById('bf-ruins-min-units-row');
      if (row) row.style.display = settings.ruinsStopMinUnits ? 'block' : 'none';
    }
    const minU = settings.ruinsMinUnits || {};
    const mt1 = document.getElementById('bf-ruins-min-t1'); if (mt1) mt1.value = minU.T1 || 0;
    const mt2 = document.getElementById('bf-ruins-min-t2'); if (mt2) mt2.value = minU.T2 || 0;
    const mt3 = document.getElementById('bf-ruins-min-t3'); if (mt3) mt3.value = minU.T3 || 0;
    const mt4 = document.getElementById('bf-ruins-min-t4'); if (mt4) mt4.value = minU.T4 || 0;

    // v1.5.8 — UNLOCKED tier bar
    buildRuinsUnlockBar(settings.ruinsAllyUnlocks || ['T1','T2','T3','T4','T5','T6']);
    // v1.5.9 — Per-layer interval bands
    buildRuinsIntervalBands(settings.ruinsIntervalBands || {});
    // v1.5.8 — Optimization controls
    const optKillE3 = document.getElementById('bf-ruins-opt-killE3');
    if (optKillE3) optKillE3.checked = !!settings.ruinsOptStratKillE3;
    const optMode = settings.ruinsOptMode === 'fast' ? 'fast' : 'deep';
    const modeRadio = document.getElementById('bf-ruins-opt-mode-' + optMode);
    if (modeRadio) modeRadio.checked = true;
    const optPar = document.getElementById('bf-ruins-opt-parallel');
    if (optPar) optPar.checked = settings.ruinsOptParallel !== false;
    const wSrc = document.getElementById('bf-ruins-warm-source');
    if (wSrc) wSrc.value = settings.ruinsWarmStartSource || 'none';
    const wRng = document.getElementById('bf-ruins-warm-range');
    if (wRng) wRng.value = settings.ruinsWarmStartRange || 15;
    const wRow = document.getElementById('bf-ruins-warm-range-row');
    if (wRow) wRow.style.display = (settings.ruinsWarmStartSource && settings.ruinsWarmStartSource !== 'none') ? 'flex' : 'none';
    // v1.5.8 — T4 short action
    const t4Action = settings.ruinsT4ShortAction || 'stop';
    const t4Radio = document.getElementById('bf-ruins-t4short-' + t4Action);
    if (t4Radio) t4Radio.checked = true;
    const t4Wait = document.getElementById('bf-ruins-t4wait-min');
    if (t4Wait) t4Wait.value = settings.ruinsT4WaitMin || 10;
    // v1.5.8 — Auto-import
    const aiEl = document.getElementById('bf-ruins-autoimport');
    if (aiEl) aiEl.checked = !!settings.ruinsAutoImportNew;
    const aiMaxEl = document.getElementById('bf-ruins-autoimport-max');
    if (aiMaxEl) aiMaxEl.value = settings.ruinsAutoImportMaxPerLevel || 3;
    // v1.5.9 — Auto-import as Smart preset
    const aiSmartEl = document.getElementById('bf-ruins-autoimport-smart');
    if (aiSmartEl) aiSmartEl.checked = !!settings.ruinsAutoImportSmart;
    // Update Kill E3 / T4 short hints
    updateRuinsOptHints(settings);

    // Story mode settings
    const storyPriority = document.getElementById('bf-story-priority');
    if (storyPriority) storyPriority.value = settings.storyPriority || 'gold';
    // Show/hide aspects panel
    const aspPanel = document.getElementById('bf-story-aspects-panel');
    if (aspPanel) aspPanel.style.display = (settings.storyPriority === 'aspects') ? 'block' : 'none';
    // Restore aspect targets
    const at = settings.storyAspectTargets || {};
    ['human','knowledge','order','nature','beast','destruction','chaos','corruption'].forEach(k => {
      const el = document.getElementById('bf-aspect-' + k);
      if (el) el.value = at[k] || 0;
    });

    const storyWL = document.getElementById('bf-story-whitelist');
    if (storyWL && settings.storyWhitelist?.length) storyWL.value = settings.storyWhitelist.join(',');

    const storyBL = document.getElementById('bf-story-blacklist');
    if (storyBL && settings.storyBlacklist?.length) storyBL.value = settings.storyBlacklist.join(',');

    const storyStayAlive = document.getElementById('bf-story-stayalive');
    if (storyStayAlive) storyStayAlive.checked = settings.storyStayAlive !== false;

    if (settings.storyStayAliveMode === 'fixed') {
      const fixedRadio = document.getElementById('bf-story-salm-fixed');
      if (fixedRadio) fixedRadio.checked = true;
      const pctRow = document.getElementById('bf-story-pct-row');
      const fixedRow = document.getElementById('bf-story-fixed-row');
      if (pctRow) pctRow.style.display = 'none';
      if (fixedRow) fixedRow.style.display = 'block';
    }

    const pausePct = document.getElementById('bf-story-pause-pct');
    if (pausePct) pausePct.value = settings.storyPauseAtPct || 16;
    const resumePct = document.getElementById('bf-story-resume-pct');
    if (resumePct) resumePct.value = settings.storyResumeAtPct || 18;
    const pauseHP = document.getElementById('bf-story-pause-hp');
    if (pauseHP) pauseHP.value = settings.storyPauseAtHP || 10000;
    const resumeHP = document.getElementById('bf-story-resume-hp');
    if (resumeHP) resumeHP.value = settings.storyResumeAtHP || 12000;

    const churchCB = document.getElementById('bf-story-church');
    if (churchCB) churchCB.checked = settings.storyChurch !== false;

    const opt42 = document.getElementById('bf-story-opt42');
    if (opt42) opt42.checked = !!settings.storyOption42Enabled;
    const opt42HP = document.getElementById('bf-story-opt42-hp');
    if (opt42HP) opt42HP.value = settings.storyOption42MinHP || 20000;
    const opt42Pct = document.getElementById('bf-story-opt42-pct');
    if (opt42Pct) opt42Pct.value = settings.storyOption42MinHPPct || 50;

    const healPct = document.getElementById('bf-story-heal-pct');
    if (healPct) healPct.value = settings.storyHealPriorityPct ?? -1;
    const healBack = document.getElementById('bf-story-healback-pct');
    if (healBack) healBack.value = settings.storyHealBackPct || 80;

    // ── GROTTO SETTINGS ──
    const gDiff = document.getElementById('bf-grotto-diff');
    if (gDiff) gDiff.value = settings.grottoDifficulty || 'easy';
    const gCount = document.getElementById('bf-grotto-count');
    if (gCount) gCount.value = settings.grottoCount || 0;
    const gPerm = document.getElementById('bf-grotto-permanent');
    if (gPerm) gPerm.checked = !!settings.grottoPermanent;
    const gMinHP = document.getElementById('bf-grotto-minhp');
    if (gMinHP) gMinHP.value = settings.grottoMinHP || 50;
    const gStayAlive = document.getElementById('bf-grotto-stayalive');
    if (gStayAlive) gStayAlive.checked = !!settings.grottoStayAlive;
    const gSalm = document.querySelector('input[name="bf-grotto-salm"][value="' + (settings.grottoStayAliveMode || 'switch') + '"]');
    if (gSalm) gSalm.checked = true;
    const gSwitchDiff = document.getElementById('bf-grotto-switch-diff');
    if (gSwitchDiff) gSwitchDiff.value = settings.grottoSwitchDifficulty || 'easy';
    const gChurchAP = document.getElementById('bf-grotto-church-ap');
    if (gChurchAP) gChurchAP.value = settings.grottoChurchAP || 15;

    // ── PVP SETTINGS ──
    const pMode = document.getElementById('bf-pvp-mode');
    if (pMode) pMode.value = String(settings.pvpMode || 1);
    const pMinHP = document.getElementById('bf-pvp-minhp');
    if (pMinHP) pMinHP.value = settings.pvpMinHP || 50;
    const pWL = document.getElementById('bf-pvp-whitelist');
    if (pWL) pWL.value = settings.pvpWhitelist || '';
    const pBL = document.getElementById('bf-pvp-blacklist');
    if (pBL) pBL.value = settings.pvpBlacklist || '';
    const pBVFrom = document.getElementById('bf-pvp-bv-from');
    if (pBVFrom) pBVFrom.value = settings.pvpBVFrom || '';
    const pBVTo = document.getElementById('bf-pvp-bv-to');
    if (pBVTo) pBVTo.value = settings.pvpBVTo || '';
    const pInactive = document.getElementById('bf-pvp-inactive');
    if (pInactive) pInactive.checked = settings.pvpIncludeInactive !== false;
    const pBreak = document.getElementById('bf-pvp-break');
    if (pBreak) pBreak.checked = !!settings.pvpSmartBreak;
    const pDelay = document.getElementById('bf-pvp-delay');
    if (pDelay) pDelay.value = settings.pvpDelay || 20;
    const pMargin = document.getElementById('bf-pvp-margin');
    if (pMargin) pMargin.value = settings.pvpMargin || 3;
    // Show/hide BV row based on mode
    const bvRow = document.getElementById('bf-pvp-bv-row');
    if (bvRow) bvRow.style.display = (parseInt(settings.pvpMode) === 4) ? 'flex' : 'none';
    // Show/hide blacklist group based on mode
    const blGroup = document.getElementById('bf-pvp-bl-group');
    if (blGroup) blGroup.style.display = (parseInt(settings.pvpMode) === 3) ? '' : 'none';

    // ── HENCHMAN SETTINGS (v1.6.9, semantics flipped v1.6.10) ──
    // Legacy mode 3 (old "blacklist by name") maps onto the new mode 2
    // ("whitelist only") since the old code stored target names in the
    // blacklist field. We carry the OLD blacklist over to the NEW whitelist
    // for any user who briefly ran the interim 1.6.9 build, so they don't
    // lose their target list.
    if (settings.henchmanMode === 3 || settings.henchmanMode === '3') {
      if (!settings.henchmanWhitelist && settings.henchmanBlacklist) {
        settings.henchmanWhitelist = settings.henchmanBlacklist;
        settings.henchmanBlacklist = '';
      }
      settings.henchmanMode = 2;
    }
    const hMode = document.getElementById('bf-henchman-mode');
    if (hMode) hMode.value = String(settings.henchmanMode || 1);
    const hWL = document.getElementById('bf-henchman-whitelist');
    if (hWL) hWL.value = settings.henchmanWhitelist || '';
    const hBL = document.getElementById('bf-henchman-blacklist');
    if (hBL) hBL.value = settings.henchmanBlacklist || '';
    const hBreak = document.getElementById('bf-henchman-break');
    if (hBreak) hBreak.checked = !!settings.henchmanSmartBreak;
    const hDelay = document.getElementById('bf-henchman-delay');
    if (hDelay) hDelay.value = settings.henchmanDelay || 20;
    const hMargin = document.getElementById('bf-henchman-margin');
    if (hMargin) hMargin.value = settings.henchmanMargin || 3;
    const hOwnRace = document.getElementById('bf-henchman-own-race');
    if (hOwnRace) hOwnRace.checked = !!settings.henchmanAttackOwnRace;
    // v1.6.10 — both lists are always visible; no per-mode show/hide.

    // ── GIFTS SETTINGS ──
    const gfDBG = document.getElementById('bf-gifts-dbg');
    if (gfDBG) gfDBG.checked = !!settings.giftsAutoDBG;
    const gfDBGAP = document.getElementById('bf-gifts-dbg-ap');
    if (gfDBGAP) gfDBGAP.value = settings.giftsDBGUnderAP || 5;
    const gfDisable = document.getElementById('bf-gifts-disable-event');
    if (gfDisable) gfDisable.checked = !!settings.giftsDisableAfterEvent;
    const gfCave = document.getElementById('bf-gifts-cave-time');
    if (gfCave) gfCave.checked = !!settings.giftsMaxCaveTime;
    const gfPurple = document.querySelector('input[name="bf-gifts-purple"][value="' + (settings.giftsPurpleMode || 'none') + '"]');
    if (gfPurple) gfPurple.checked = true;
    const gfPGGold = document.getElementById('bf-gifts-pg-gold-val');
    if (gfPGGold) gfPGGold.value = settings.giftsPurpleGoldTarget || 100000;
    const gfPGQty = document.getElementById('bf-gifts-pg-qty-val');
    if (gfPGQty) gfPGQty.value = settings.giftsPurpleQtyTarget || 10;
    const gfPGSpend = document.getElementById('bf-gifts-pg-spend');
    if (gfPGSpend) gfPGSpend.checked = !!settings.giftsPurpleSpendGold;
  }

  // ── DRAGGABLE ────────────────────────────────────────────────
  function makeDraggable(el, handle) {
    let ox, oy, ol, ot;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      ox = e.clientX; oy = e.clientY; ol = el.offsetLeft; ot = el.offsetTop;
      handle.style.cursor = 'grabbing';
      const move = (e) => {
        el.style.left = (ol + e.clientX - ox) + 'px';
        el.style.top  = (ot + e.clientY - oy) + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      };
      const up = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        sSet({ [SK('panelLeft')]: el.style.left, [SK('panelTop')]: el.style.top });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    sGet([SK('panelLeft'), SK('panelTop')], (r) => {
      const l = r[SK('panelLeft')]; const t = r[SK('panelTop')];
      if (l) { el.style.left = l; el.style.right  = 'auto'; }
      if (t) { el.style.top  = t; el.style.bottom = 'auto'; }
    });
  }

  // ── INIT ─────────────────────────────────────────────────────
  // ── AUTO-IMPORT NEW FORMATIONS AS PRESETS (v1.5.8) ──────────
  // Periodically (every 90s) scans ruinsBattleLog for winning "new"
  // entries that haven't been imported yet, and saves them as preset
  // formations — but only while the bot's overall status indicator is
  // WHITE (only global features) or YELLOW (enabled but waiting).
  //   GREEN  = a bot module is actively running → skip (avoid churn)
  //   TRANSPARENT = nothing enabled → skip
  // Respects ruinsAutoImportMaxPerLevel for Ruins presets. Smart presets
  // are per-LAYER (no fingerprint), so the cap doesn't apply — newest
  // entry simply overwrites. v1.5.9: when ruinsAutoImportSmart is on,
  // we ALSO write the formation to BFPresets (simulator warm-start lib).
  function runAutoImportTick() {
    if (_centralStopActive) return;
    loadSettings(settings => {
      const wantRuins = !!settings.ruinsAutoImportNew;
      const wantSmart = !!settings.ruinsAutoImportSmart;
      if (!wantRuins && !wantSmart) return;
      // We only do this when the bot is "white" (global only) or "yellow"
      // (enabled-but-not-actively-running). Concretely: ruinsEnabled is true
      // but ruinsState is idle/done/waiting_training, OR ruinsEnabled is false.
      loadState(state => {
        const rState = state.ruinsState || 'idle';
        const ruinsActive = settings.ruinsEnabled && (rState === 'attacking' || rState === 'fighting');
        if (ruinsActive) return; // skip while bot is mid-attack
        const maxPerLevel = settings.ruinsAutoImportMaxPerLevel || 3;
        sGet([SK('ruinsBattleLog'), SK('ruinsPresets')], r => {
          const log = r[SK('ruinsBattleLog')] || [];
          const presets = r[SK('ruinsPresets')] || {};
          let dirtyLog = false, dirtyPresets = false;
          let importedRuins = 0;
          let pendingSmart = []; // queued for async BFPresets writes after ruins save
          // Process oldest-first so per-layer cap behavior is deterministic
          for (let i = 0; i < log.length; i++) {
            const e = log[i];
            if (!e.won || isPresetSource(e.source)) continue;

            // ── Ruins preset path (per-fingerprint, capped) ────────────────
            if (wantRuins && !e.importedAsPreset && importedRuins < 5) {
              const lvl = String(e.level);
              const existing = presets[lvl] || [];
              if (existing.length < maxPerLevel) {
                const formation = {};
                Object.keys(e.formation || {}).forEach(k => {
                  const v = parseInt(e.formation[k]) || 0;
                  if (v > 0) formation[k.toUpperCase()] = v;
                });
                if (Object.keys(formation).length) {
                  const enemyObj = {};
                  Object.keys(e.enemy || {}).forEach(k => {
                    const v = parseInt(e.enemy[k]) || 0;
                    if (v > 0) enemyObj[k.toUpperCase()] = v;
                  });
                  const fingerprint = Object.entries(enemyObj).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join(',');
                  if (existing.some(p => p.enemy === fingerprint)) {
                    e.importedAsPreset = true; dirtyLog = true;
                  } else {
                    if (!presets[lvl]) presets[lvl] = [];
                    presets[lvl].push({ enemy: fingerprint, formation });
                    e.importedAsPreset = true;
                    dirtyLog = true; dirtyPresets = true;
                    importedRuins++;
                  }
                }
              }
            }

            // ── Smart preset path (per-layer, last-write-wins) ────────────
            if (wantSmart && !e.importedAsSmart && pendingSmart.length < 5) {
              pendingSmart.push(i);
            }
          }

          // 1) Persist Ruins-preset changes first
          const patch = {};
          if (dirtyLog) patch[SK('ruinsBattleLog')] = log;
          if (dirtyPresets) patch[SK('ruinsPresets')] = presets;
          const afterRuinsSave = () => {
            // 2) Now process queued Smart-preset saves sequentially
            if (!pendingSmart.length) {
              if (importedRuins > 0) botLog('ok', `Auto-import: ${importedRuins} formation${importedRuins === 1 ? '' : 's'} saved as Ruins preset`);
              if (document.getElementById('bf-bl-list-new')) renderBattleLog('new');
              return;
            }
            let smartDone = 0;
            const processNext = () => {
              if (!pendingSmart.length) {
                // Flush the importedAsSmart flags + report
                sSet({ [SK('ruinsBattleLog')]: log }, () => {
                  if (importedRuins > 0) botLog('ok', `Auto-import: ${importedRuins} formation${importedRuins === 1 ? '' : 's'} saved as Ruins preset`);
                  if (smartDone > 0) botLog('ok', `Auto-import: ${smartDone} formation${smartDone === 1 ? '' : 's'} saved as Smart preset`);
                  if (document.getElementById('bf-bl-list-new')) renderBattleLog('new');
                });
                return;
              }
              const idx = pendingSmart.shift();
              saveBattleEntryAsSmartPreset(log[idx], res => {
                if (res && res.ok) { log[idx].importedAsSmart = true; smartDone++; }
                botSetTimeout(processNext, 60); // small delay to avoid storage thrash
              });
            };
            processNext();
          };
          if (Object.keys(patch).length) sSet(patch, afterRuinsSave); else afterRuinsSave();
        });
      });
    });
  }

  function boot() {
    detectPlayerId().then(() => {
      createBotPanel();
      createBattleLogPanel();
      // Pre-load smart preset cache so findBestFormation can use warm-start synchronously
      try {
        if (window.BFPresets && window.BFPresets.loadPresets) {
          window.BFPresets.loadPresets(function () { /* cached internally */ });
        }
      } catch (_) {}
      // v1.5.8 — auto-import periodic scan (every 90s, cancellable)
      botSetInterval(runAutoImportTick, 90 * 1000);
      // First run after a short delay so settings/state are loaded
      botSetTimeout(runAutoImportTick, 8000);
      // v1.6.7 — schedule watcher (30s tick) — drives slot transitions
      botSetTimeout(startScheduleWatcher, 4000);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
