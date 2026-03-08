// ============================================================
// Bitefight Bot Engine — Phase 4 v0.8.0
// State machine running as content script
// Hunt Bot, Extraction, Ruins Farming, Auto-Recruit, Story Mode
// Grotto (Demon Hunt), PvP, Gifts, Global Settings
// Copyright (C) 2026 Aescunor
// GNU General Public License v3.0
// ============================================================
(function () {
  'use strict';

  // ── GUARD: lobby/forum exclusion ─────────────────────────────
  const hostname = window.location.hostname;
  if (hostname.startsWith('lobby.') || hostname.startsWith('forum.') || hostname.startsWith('support.')) return;

  function ctxOk() { try { return !!chrome.runtime?.id; } catch (e) { return false; } }
  function sGet(keys, cb) { if (!ctxOk()) return; try { chrome.storage.local.get(keys, r => { if (ctxOk()) cb(r); }); } catch(e) {} }
  function sSet(obj, cb) { if (!ctxOk()) return; try { chrome.storage.local.set(obj, cb); } catch(e) {} }

  const SERVER_ID = hostname.split('.')[0] || 'unknown';
  const SK = (k) => SERVER_ID + '_bot_' + k;
  const PAGE = window.location.pathname;
  const BASE = window.location.origin;

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

  // ── INLINE BATTLE SIMULATOR (for Ruins Bot) ────────────────
  // Compact version of simulator.js battle engine for use in content script
  const BOT_ALLY_TIERS = [
    { id: 'T1', dmg: 8, hp: 2, spd: 5, power: 2, pos: 'Rearguard', skillId: 'T1_FIRST_ROUND_DMG' },
    { id: 'T2', dmg: 3, hp: 5, spd: 2, power: 3, pos: 'Vanguard',  skillId: 'T2_REDUCE_DMG' },
    { id: 'T3', dmg: 6, hp: 6, spd: 4, power: 4, pos: 'Vanguard',  skillId: 'T3_VS_SLOW' },
    { id: 'T4', dmg: 7, hp: 4, spd: 4, power: 7, pos: 'Rearguard', skillId: 'T4_REARGUARD_DEBUFF' },
  ];
  const BOT_ENEMY_TIERS = [
    { id: 'E1', dmg: 3, hp: 4, spd: 3, pos: 'Vanguard',  skillId: null },
    { id: 'E2', dmg: 2, hp: 7, spd: 2, pos: 'Vanguard',  skillId: 'E2_REVIVE' },
    { id: 'E3', dmg: 5, hp: 1, spd: 1, pos: 'Rearguard', skillId: 'E3_BUFF_ALLY' },
    { id: 'E4', dmg: 6, hp: 3, spd: 4, pos: 'Rearguard', skillId: 'E4_REARGUARD_FIRST' },
    { id: 'E5', dmg: 1, hp: 10,spd: 1, pos: 'Vanguard',  skillId: 'E5_DEATH_THORNS' },
    { id: 'E6', dmg: 7, hp: 2, spd: 4, pos: 'Vanguard',  skillId: 'E6_DOUBLE_BONUS' },
  ];
  // data-id on page → tier mapping
  const SLIDER_TO_TIER = { '1': 'T1', '2': 'T2', '3': 'T3', '4': 'T4' };
  const ENEMY_IMG_TO_TIER = { '1': 'E1', '2': 'E2', '3': 'E3', '4': 'E4', '5': 'E5', '6': 'E6' };

  function qtyToString(obj) {
    return Object.entries(obj).filter(([,v]) => v > 0).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join(', ');
  }

  function botBuildGroups(side, tierDefs, qtys) {
    return tierDefs.filter(t => (qtys[t.id] || 0) > 0).map(t => {
      const q = qtys[t.id];
      return { id: t.id, tier: t, qty: q, maxHp: t.hp * q, currentHp: t.hp * q,
        aliveUnits: q, alive: true, side, revived: false, revivedThisRound: false,
        damageBuff: 1.0, debuffed: false, debuffRounds: 0, attackedThisRound: false };
    });
  }

  function botPickTarget(atk, enemies) {
    const alive = enemies.filter(g => g.alive);
    if (!alive.length) return null;
    // T4/E4 target rearguard
    if (atk.tier.skillId === 'T4_REARGUARD_DEBUFF' || atk.tier.skillId === 'E4_REARGUARD_FIRST') {
      const rear = alive.filter(g => g.tier.pos === 'Rearguard');
      if (rear.length) return rear[0];
    }
    // Default: vanguard first, then rearguard
    const van = alive.filter(g => g.tier.pos === 'Vanguard');
    return van.length ? van[0] : alive[0];
  }

  function botAttack(atk, tgt, bs) {
    let dmg = atk.tier.dmg * atk.aliveUnits * atk.damageBuff;
    // T1 first round +25%
    if (atk.tier.skillId === 'T1_FIRST_ROUND_DMG' && bs.firstRound) dmg *= 1.25;
    // T3 vs slow
    if (atk.tier.skillId === 'T3_VS_SLOW' && tgt.tier.spd < 3) dmg *= 1.33;
    // E4 first attacker +20%
    if (atk.tier.skillId === 'E4_REARGUARD_FIRST' && bs.firstAttacker === atk.id) dmg *= 1.2;
    // E6 double bonus
    if (atk.tier.skillId === 'E6_DOUBLE_BONUS' && tgt.aliveUnits >= atk.aliveUnits * 2) dmg *= 1.5;
    // T2 reduce incoming
    if (tgt.tier.skillId === 'T2_REDUCE_DMG') dmg *= 0.5;
    // T4 debuff target
    if (atk.tier.skillId === 'T4_REARGUARD_DEBUFF' && !tgt.debuffed) {
      tgt.debuffed = true; tgt.debuffRounds = 2;
    }
    if (tgt.debuffed && atk.id !== tgt.id) dmg *= 0.75; // debuffed targets take less? No — debuff reduces THEIR damage
    // Actually T4 debuff reduces target's damage by 25%, not incoming. Fix:
    // The debuff tracking is on the target — we apply it when the debuffed unit attacks
    // Remove the dmg*0.75 here, apply it in attack calculation of debuffed unit
    dmg = Math.floor(dmg);
    tgt.currentHp -= dmg;
    if (tgt.currentHp <= 0) {
      // E5 death thorns
      if (tgt.tier.skillId === 'E5_DEATH_THORNS') {
        const thorns = Math.floor(tgt.tier.hp * tgt.qty * 0.2);
        atk.currentHp -= thorns;
        atk.aliveUnits = Math.max(0, Math.ceil(atk.currentHp / atk.tier.hp));
        if (atk.aliveUnits <= 0) { atk.alive = false; atk.aliveUnits = 0; atk.currentHp = 0; }
      }
      // E2 revive
      if (tgt.tier.skillId === 'E2_REVIVE' && !tgt.revived) {
        tgt.revived = true; tgt.currentHp = 1; tgt.aliveUnits = 1; tgt.alive = true;
        return;
      }
      tgt.alive = false; tgt.aliveUnits = 0; tgt.currentHp = 0;
    } else {
      tgt.aliveUnits = Math.ceil(tgt.currentHp / tgt.tier.hp);
    }
  }

  function botSimulate(allyQtys, enemyQtys) {
    const allies = botBuildGroups('ally', BOT_ALLY_TIERS, allyQtys);
    const enemies = botBuildGroups('enemy', BOT_ENEMY_TIERS, enemyQtys);
    if (!allies.length || !enemies.length) return null;
    const bs = { allies, enemies, round: 0, done: false, firstRound: true, firstAttacker: null };
    for (let r = 0; r < 50 && !bs.done; r++) {
      bs.round++;
      const all = [...bs.allies, ...bs.enemies].filter(g => g.alive);
      all.forEach(g => { g.attackedThisRound = false; if (g.debuffRounds > 0) { g.debuffRounds--; if (!g.debuffRounds) g.debuffed = false; }});
      bs.firstAttacker = null;
      const order = [...all].sort((a, b) => {
        if (b.tier.spd !== a.tier.spd) return b.tier.spd - a.tier.spd;
        const ps = g => g.tier.pos === 'Rearguard' ? 1 : 0;
        if (ps(b) !== ps(a)) return ps(b) - ps(a);
        return a.side === 'ally' ? -1 : 1;
      });
      for (const atk of order) {
        if (!atk.alive) continue;
        if (!bs.firstAttacker) bs.firstAttacker = atk.id;
        // Apply debuff to attacker's damage
        let origBuff = atk.damageBuff;
        if (atk.debuffed) atk.damageBuff *= 0.75;
        const side = atk.side === 'ally' ? bs.enemies : bs.allies;
        const tgt = botPickTarget(atk, side);
        if (tgt) botAttack(atk, tgt, bs);
        atk.damageBuff = origBuff;
      }
      // E3 buff
      bs.enemies.filter(g => g.alive && g.tier.skillId === 'E3_BUFF_ALLY').forEach(e3 => {
        const fr = bs.enemies.filter(g => g.alive && g.id !== e3.id);
        if (fr.length) {
          const t = fr.reduce((b, g) => g.tier.dmg * g.aliveUnits > b.tier.dmg * b.aliveUnits ? g : b);
          t.damageBuff = +(t.damageBuff + 0.1).toFixed(2);
        }
      });
      bs.firstRound = false;
      if (!bs.allies.some(g => g.alive) || !bs.enemies.some(g => g.alive)) bs.done = true;
    }
    const victory = bs.allies.some(g => g.alive) && !bs.enemies.some(g => g.alive);
    const surviving = bs.allies.filter(g => g.alive).reduce((s, g) => s + g.aliveUnits, 0);
    return { victory, surviving, rounds: bs.round };
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

  // ── GREEDY OPTIMIZER ──────────────────────────────────────
  function findBestFormation(enemyQtys, maxUnits, powerLimit) {
    const tiers = BOT_ALLY_TIERS.filter(t => (maxUnits[t.id] || 0) > 0);
    if (!tiers.length) return null;

    let bestResult = null;
    let bestQtys = null;
    let tested = 0;

    // Generate combinations using bounded iteration
    // Start with max power and work down
    const maxByTier = {};
    tiers.forEach(t => {
      maxByTier[t.id] = Math.min(maxUnits[t.id], Math.floor(powerLimit / t.power));
    });

    // Iterate all reasonable combos (capped at 50k to avoid freezing)
    const ids = tiers.map(t => t.id);
    const powers = tiers.map(t => t.power);
    const maxes = ids.map(id => maxByTier[id]);

    // 4 tiers max → nested loops are fine
    const m0 = maxes[0] || 0, m1 = maxes[1] || 0, m2 = maxes[2] || 0, m3 = maxes[3] || 0;
    const p0 = powers[0] || 99, p1 = powers[1] || 99, p2 = powers[2] || 99, p3 = powers[3] || 99;

    for (let q0 = m0; q0 >= 0; q0--) {
      const pw0 = q0 * p0;
      if (pw0 > powerLimit) continue;
      for (let q1 = Math.min(m1, Math.floor((powerLimit - pw0) / p1)); q1 >= 0; q1--) {
        const pw01 = pw0 + q1 * p1;
        if (ids.length <= 2) {
          // Only 2 tiers
          if (q0 === 0 && q1 === 0) continue;
          const qtys = {}; if (q0) qtys[ids[0]] = q0; if (q1) qtys[ids[1]] = q1;
          const r = botSimulate(qtys, enemyQtys);
          tested++;
          if (r && r.victory && (!bestResult || r.surviving > bestResult.surviving || (r.surviving === bestResult.surviving && r.rounds < bestResult.rounds))) {
            bestResult = r; bestQtys = qtys;
          }
          if (tested > 50000) break;
          continue;
        }
        for (let q2 = Math.min(m2, Math.floor((powerLimit - pw01) / p2)); q2 >= 0; q2--) {
          const pw012 = pw01 + q2 * p2;
          if (ids.length <= 3) {
            if (q0 === 0 && q1 === 0 && q2 === 0) continue;
            const qtys = {}; if (q0) qtys[ids[0]] = q0; if (q1) qtys[ids[1]] = q1; if (q2) qtys[ids[2]] = q2;
            const r = botSimulate(qtys, enemyQtys);
            tested++;
            if (r && r.victory && (!bestResult || r.surviving > bestResult.surviving || (r.surviving === bestResult.surviving && r.rounds < bestResult.rounds))) {
              bestResult = r; bestQtys = qtys;
            }
            if (tested > 50000) break;
            continue;
          }
          for (let q3 = Math.min(m3, Math.floor((powerLimit - pw012) / p3)); q3 >= 0; q3--) {
            if (q0 === 0 && q1 === 0 && q2 === 0 && q3 === 0) continue;
            const qtys = {};
            if (q0) qtys[ids[0]] = q0; if (q1) qtys[ids[1]] = q1;
            if (q2) qtys[ids[2]] = q2; if (q3) qtys[ids[3]] = q3;
            const r = botSimulate(qtys, enemyQtys);
            tested++;
            if (r && r.victory && (!bestResult || r.surviving > bestResult.surviving || (r.surviving === bestResult.surviving && r.rounds < bestResult.rounds))) {
              bestResult = r; bestQtys = qtys;
            }
            if (tested > 50000) break;
          }
          if (tested > 50000) break;
        }
        if (tested > 50000) break;
      }
      if (tested > 50000) break;
    }

    botLog('info', `Optimizer: ${tested} formations tested, ${bestResult ? 'winner found' : 'no victory'}`);
    return bestQtys;
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
    // Recruit
    recruitEnabled: false,
    recruitMode: 'percent',         // 'percent' = % split of BE, 'formation' = fixed formation from simulator
    recruitFormation: {},            // {1: qty, 2: qty, ...} from simulator (mode: formation)
    recruitPercent: { 1: 0, 2: 0, 3: 0, 4: 0 },  // % allocation per unit tier (mode: percent)
    recruitTrigger: 'every',         // 'every' = after every extraction, 'threshold' = when BE >= X
    recruitThreshold: 100,           // BE threshold for trigger mode 'threshold'
    // Ruins
    ruinsEnabled: false,
    ruinsLevels: Array.from({length: 20}, (_, i) => i + 1), // 1-20
    ruinsCadence: 'infinite',   // 'infinite', 'once', 'cycles'
    ruinsCycles: 5,
    ruinsIntervalMin: 60,       // minutes between attacks per level
    ruinsFormation: {},         // {1: qty, 2: qty, ...}
    // Safety stops
    ruinsStopNoWin: true,       // stop if no winning formation found
    ruinsMinUnits: {},          // min units required: {T1: 10, T2: 0, T3: 5, T4: 0}
    ruinsStopMinUnits: false,   // enable min units check
    ruinsStopPresetShort: true, // stop if can't fill preset formation fully
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
    // Schedule
    scheduleEnabled: false,
    scheduleIntervals: [
      { enabled: false, start: '08:00', end: '12:00' },
      { enabled: false, start: '13:00', end: '17:00' },
      { enabled: false, start: '18:00', end: '22:00' },
      { enabled: false, start: '', end: '' },
      { enabled: false, start: '', end: '' },
    ],
    // Other global
    autoEnrollClanWar: false,
    hideGameforgeBar: false,
    fixedInfobar: false,
    hideEventPanel: false,
    backgroundRefresh: false,
    backgroundRefreshInterval: 60, // minutes
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
      // Debug: log what we found
      console.log(`[BF-Bot] rank-line[0]: "${rankText}" → parsed rank: ${result.rank || 'NULL'}`);
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
      setTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.ruinsEnabled && st.ruinsState !== 'done') {
              ruinsTick(st, se);
            }
          });
        });
      }, randomDelay(2000, 4000));
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
          setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 3000));
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
            setTimeout(() => { window.location.href = BASE + '/robbery/humanhunt/' + huntType; }, randomDelay(1500, 3500));
          } else {
            botLog('warn', `AP: ${ap.current}/${neededAP}, nedostatok pre lov.`);
            state.huntState = 'done';
            saveState(state);
          }
          return;
        } else {
          // Navigate to hunt choice page
          setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1500, 3500));
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
            setTimeout(() => botTick(state, settings), randomDelay(2000, 4000));
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
                  setTimeout(() => {
                    const confirmBtn = document.getElementById('confirmModal_buttonLeft');
                    if (confirmBtn) confirmBtn.click();
                    // FALLBACK: if extraction is inline (no page redirect), re-tick after delay
                    setTimeout(() => {
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
                  setTimeout(() => {
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
          setTimeout(() => { window.location.href = BASE + '/robbery/humanhunt/' + huntType; }, randomDelay(600, 1500));
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
          setTimeout(() => { window.location.href = BASE + '/robbery/humanhunt/' + huntType; }, randomDelay(600, 1500));
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
          setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(600, 1500));
          return;
        }
      }
      } // end if (!huntWaiting)
    }

    // ── RECRUIT BOT (after extraction) ─────────────────────────
    if (settings.recruitEnabled && (state.huntState === 'done' || state.huntState === 'waiting_orb' || state.huntState === 'extracting')) {
      // Determine if we should trigger recruit
      const shouldRecruit = (() => {
        if (settings.recruitTrigger === 'threshold') {
          const be = readBE();
          return be !== null && be >= (settings.recruitThreshold || 100);
        }
        // 'every' — trigger after any extraction (extractionsThisSession > 0)
        return state.extractionsThisSession > 0 && !state.recruitDoneThisExtraction;
      })();

      if (shouldRecruit) {
        if (!PAGE.includes('/nourishing/')) {
          botLog('info', 'Recruit: Navigating to Crimson Sanctuary for recruitment');
          setTimeout(() => { window.location.href = BASE + '/nourishing/index'; }, randomDelay(1000, 2000));
          return;
        }
        // On nourishing page — trigger recruitment
        if (PAGE.includes('/nourishing/')) {
          const be = readBE() || 0;
          const pct = settings.recruitPercent || {};
          const totalPct = Object.values(pct).reduce((s, v) => s + (parseInt(v) || 0), 0);

          if (totalPct > 0 && be > 0) {
            const UNIT_COSTS = { 1: 10, 2: 15, 3: 20, 4: 35 };
            const formation = {};
            let spendBE = be;

            // Calculate how many units to buy per tier based on % of available BE
            for (const unitId of ['1', '2', '3', '4']) {
              const unitPct = parseInt(pct[unitId]) || 0;
              if (unitPct <= 0) continue;
              const allocBE = Math.floor(be * unitPct / 100);
              const cost = UNIT_COSTS[unitId] || 10;
              const qty = Math.floor(allocBE / cost);
              if (qty > 0) formation[unitId] = qty;
            }

            const keys = Object.keys(formation).filter(k => formation[k] > 0);
            if (keys.length > 0) {
              botLog('info', `Recruit: BE=${be}, allocation: ${keys.map(k => 'T' + k + '×' + formation[k]).join(', ')}`);
              autoRecruit(formation, 0, keys);
            } else {
              botLog('warn', 'Recruit: Not enough BE to purchase units');
            }
          } else if (totalPct === 0) {
            // Fallback to old formation-based system
            const formation = settings.recruitFormation || {};
            const keys = Object.keys(formation).filter(k => formation[k] > 0);
            if (keys.length > 0) {
              botLog('info', 'Recruit: Using formation from simulator');
              autoRecruit(formation, 0, keys);
            }
          }
          state.recruitDoneThisExtraction = true;
          state.huntState = 'recruit_done';
          saveState(state);
        }
      }
    }

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
    // This only triggers navigation when no other bot is actively navigating.
    // ══════════════════════════════════════════════════════════
    const anyBotActivelyNavigating = 
      (huntEnabled && !huntWaiting && state.huntState === 'navigating') ||
      (ruinsEnabled && state.ruinsState === 'navigating') ||
      (settings.storyEnabled && state.storyState === 'navigating');

    if (settings.goldMode > 0 && !anyBotActivelyNavigating) {
      const goldHandled = globalGoldTick(state, settings);
      if (goldHandled) return; // Gold tick took action (navigation or click), wait for reload
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

    // ══════════════════════════════════════════════════════════
    // ── COOLDOWN PHASE: Gifts & Graveyard ────────────────────
    // These run when main bots are idle/cooldown/done.
    // ══════════════════════════════════════════════════════════
    const mainBotsBusy = (huntEnabled && !huntWaiting && state.huntState !== 'done' && state.huntState !== 'idle') ||
                         (settings.grottoEnabled && state.grottoState === 'fighting') ||
                         (settings.pvpEnabled && state.pvpState === 'hunting');

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
          setTimeout(() => { contLink.click(); }, randomDelay(1000, 2500));
          return;
        }

        // No continue link — navigate manually
        saveState(state);
        botLog('info', `Ruins: Navigating to layer ${levels[state.ruinsCurrentIdx]}`);
        setTimeout(() => { window.location.href = BASE + '/ancestral/show/' + levels[state.ruinsCurrentIdx]; }, randomDelay(800, 2000));
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
    const intervalMs = (settings.ruinsIntervalMin || 60) * 60 * 1000;

    // Init state
    if (!state.ruinsCurrentIdx) state.ruinsCurrentIdx = 0;
    if (!state.ruinsCurrentCycle) state.ruinsCurrentCycle = 1;
    if (!state.ruinsAttackTimes) state.ruinsAttackTimes = {};

    const level = levels[state.ruinsCurrentIdx];

    // Check cooldown for current level — scan all remaining levels for next available
    // Find the first level that is NOT on cooldown
    let foundReady = false;
    for (let scanOffset = 0; scanOffset < levels.length; scanOffset++) {
      const scanIdx = (state.ruinsCurrentIdx + scanOffset) % levels.length;
      const scanLevel = levels[scanIdx];
      const scanLast = state.ruinsAttackTimes[scanLevel] || 0;
      if (now - scanLast >= intervalMs) {
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
        const remaining = intervalMs - (now - last);
        if (remaining > 0 && remaining < minWait) minWait = remaining;
      }
      const waitMs = Math.max(minWait, 30000); // at least 30s
      const waitMin = Math.round(waitMs / 60000);
      botLog('info', `Ruins: All layers on cooldown. Waiting ${waitMin} min.`);
      saveState(state);
      setTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.ruinsEnabled && st.ruinsState !== 'done') ruinsTick(st, se);
          });
        });
      }, waitMs);
      return;
    }

    const lastAttack = state.ruinsAttackTimes[level] || 0;
    if (now - lastAttack < intervalMs) {
      // Current level still on cooldown after scan (shouldn't happen, but safety)
      saveState(state);
      setTimeout(() => ruinsTick(state, settings), 100);
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
      setTimeout(() => { window.location.href = BASE + '/ancestral/show/' + levels[state.ruinsCurrentIdx]; }, randomDelay(800, 2000));
      return;
    }

    // On the correct ruins show page — analyze enemy, check presets, simulate, fight
    if (isRuinsShowPage()) {
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

      sGet([SK('ruinsPresets')], r => {
        const presets = r[SK('ruinsPresets')] || {};
        const levelPresets = presets[String(level)] || [];
        const match = levelPresets.find(p => p.enemy === fp);

        let useQtys = null;
        let source = '';

        if (match) {
          // Preset found — use it (cap to max available)
          useQtys = {};
          let presetShort = false;
          for (const [tid, qty] of Object.entries(match.formation)) {
            const avail = maxUnits[tid] || 0;
            useQtys[tid] = Math.min(qty, avail);
            if (avail < qty) presetShort = true;
          }

          // ── SAFETY CHECK: Can't fill preset fully ──
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

          source = 'PRESET';
          botLog('ok', `Preset found for layer ${level}: ${qtyToString(useQtys)}`);
        } else {
          // No preset — simulate
          const maxStr = Object.entries(maxUnits).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ');
          botLog('info', `No preset for layer ${level} (${fp}), simulating... [${maxStr}] PL:${powerLimit}`);
          useQtys = findBestFormation(enemyQtys, maxUnits, powerLimit);
          source = 'SIM';
        }

        // ── SAFETY CHECK: No winning formation ──
        if (!useQtys) {
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
            setTimeout(() => botTick(state, settings), randomDelay(1000, 2000));
          }
          return;
        }

        const fmtStr = Object.entries(useQtys).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ');
        botLog('ok', `Formation [${source}]: ${fmtStr}`);

        // 4. Set sliders via realistic button clicks (+10, +1)
        function clickSliderTo(tierId, targetQty) {
          const TIER_TO_DATA_ID = { 'T1': '1', 'T2': '2', 'T3': '3', 'T4': '4' };
          const dataId = TIER_TO_DATA_ID[tierId];
          if (!dataId || !targetQty || targetQty <= 0) return Promise.resolve();

          const plus10 = document.querySelector(`.stepBtn.btnPlus10[data-id="${dataId}"]`);
          const plus1 = document.querySelector(`.stepBtn.btnPlus1[data-id="${dataId}"]`);
          if (!plus10 && !plus1) {
            // Fallback: set slider directly if buttons not found
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
              setTimeout(nextClick, 80 + Math.floor(Math.random() * 120)); // 80-200ms per click
            }
            nextClick();
          });
        }

        const tierOrder = Object.entries(useQtys).filter(([,v]) => v > 0);
        let sliderIdx = 0;
        function setNextSlider() {
          if (sliderIdx >= tierOrder.length) {
            // All sliders set — wait for fightBtn unlock
            setTimeout(doFight, 400 + Math.floor(Math.random() * 400));
            return;
          }
          const [tid, qty] = tierOrder[sliderIdx];
          sliderIdx++;
          clickSliderTo(tid, qty).then(() => {
            setTimeout(setNextSlider, 200 + Math.floor(Math.random() * 500)); // pause between tiers
          });
        }

        function doFight() {
          const fightBtn = document.getElementById('fightBtn');
          if (fightBtn && !fightBtn.classList.contains('entryLocked')) {
            botLog('info', `Ruins: Attacking layer ${level}`);
            state.ruinsAttackTimes[level] = now;
            state.ruinsState = 'fighting';
            // Save pre-battle snapshot for battle log
            state.ruinsLastBattle = {
              level: level,
              enemy: enemyQtys,
              formation: { ...useQtys },
              source: source,
              timestamp: now,
              maxUnitsBeforeFight: { ...maxUnits },
            };
            saveState(state);
            setTimeout(() => { fightBtn.click(); }, randomDelay(300, 800));
          } else {
            botLog('warn', `Ruins layer ${level}: fightBtn locked, skipping`);
            state.ruinsCurrentIdx++;
            saveState(state);
            setTimeout(() => botTick(state, settings), randomDelay(1000, 2000));
          }
        }

        // Start realistic slider sequence
        setNextSlider();
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
            setTimeout(() => { window.location.href = BASE + '/city/church'; }, randomDelay(1500, 3000));
            return;
          }
        }

        // Wait and re-check
        const waitTime = randomDelay(10000, 20000);
        botLog('info', `Waiting for regeneration... (next check ~${Math.round(waitTime/1000)}s)`);
        setTimeout(() => {
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
        setTimeout(() => {
          healBtn.click ? healBtn.click() : (window.location.href = healBtn.href || BASE + '/city/church/heal');
        }, randomDelay(500, 1200));
        return;
      }
      // After healing, navigate to adventure
      setTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(1000, 2000));
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
        setTimeout(() => {
          loadState(st => {
            loadSettings(se => {
              if (se.storyEnabled) storyTick(st, se);
            });
          });
        }, randomDelay(30000, 60000));
        return;
      }

      botLog('info', 'Starting story quest...');
      setTimeout(() => { window.location.href = BASE + '/city/adventure/startquest'; }, randomDelay(800, 2000));
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
        setTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(2000, 4000));
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
      setTimeout(() => {
        window.location.href = BASE + '/city/adventure/decision/' + chosen.id;
      }, randomDelay(800, 2200));
      return;
    }

    // ── ON WORKING PAGE ───────────────────────────────────────
    if (isStoryWorkingPage()) {
      botLog('info', 'Story — quest is processing...');
      setTimeout(() => {
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
      setTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(1000, 2500));
      return;
    }

    // ── NOT ON STORY PAGE — NAVIGATE THERE ────────────────────
    if (state.storyState === 'idle' || state.storyState === 'active' || state.storyState === 'navigating') {
      if (!PAGE.includes('/city/adventure') && !isChurchPage()) {
        botLog('info', 'Navigating to story page...');
        state.storyState = 'navigating';
        saveState(state);
        setTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(600, 1500));
        return;
      }
    }

    // ── WAITING FOR AP ────────────────────────────────────────
    if (state.storyState === 'waiting_ap') {
      if (ap.current !== null && ap.current >= 3) {
        botLog('ok', 'AP recovered → Continuing story');
        state.storyState = 'active';
        saveState(state);
        setTimeout(() => { window.location.href = BASE + '/city/adventure'; }, randomDelay(1000, 2000));
        return;
      }
      const waitTime = randomDelay(30000, 60000);
      botLog('info', `Waiting for AP... (next check ~${Math.round(waitTime/1000)}s)`);
      setTimeout(() => {
        loadState(st => {
          loadSettings(se => {
            if (se.storyEnabled) storyTick(st, se);
          });
        });
      }, waitTime);
    }
  }

  // ── AUTO RECRUIT ─────────────────────────────────────────────
  function updateRecruitTotal() {
    let total = 0;
    document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
      total += parseInt(inp.value) || 0;
    });
    const el = document.getElementById('bf-recruit-total');
    if (el) {
      const ok = total === 100;
      el.textContent = `Total: ${total}%` + (ok ? ' ✓' : ' (must be 100%)');
      el.style.color = ok ? '#2ecc71' : '#e0a030';
    }
  }

  function autoRecruit(formation, idx, keys) {
    if (idx >= keys.length) {
      botLog('ok', 'Recruitment complete');
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
        setTimeout(() => autoRecruit(formation, idx + 1, keys), 500);
        return;
      }
      const c = calls[ci];
      const btn = document.getElementById('recruits-' + c.unitId + '-' + c.amount);
      if (btn && !btn.classList.contains('disabled')) {
        btn.click();
        setTimeout(() => doNext(ci + 1), randomDelay(300, 600));
      } else {
        botLog('warn', `Recruit T${c.unitId} x${c.amount} — button disabled`);
        setTimeout(() => autoRecruit(formation, idx + 1, keys), 300);
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
        // Recruit
        recruitDoneThisExtraction: false,
        // Gifts
        giftsState: 'idle',
        giftsDBGOpened: 0,
        giftsPurpleOpened: 0,
        // Global
        goldNavigating: false,
        goldLastSpend: 0,
        graveyardWorking: false,
        graveyardWorkUntil: 0,
      });
    });
  }

  function loadSettings(cb) {
    sGet([SK('settings')], (r) => {
      const s = r[SK('settings')] || {};
      cb(Object.assign({}, DEFAULT_SETTINGS, s));
    });
  }

  function saveSettings(settings) {
    sSet({ [SK('settings')]: settings });
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
              setTimeout(() => { window.location.href = link.href; }, randomDelay(800, 1500));
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
        setTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(1000, 2000));
        return true;
      }
      return false;
    }

    // MODE 2: Donate to clan
    if (settings.goldMode === 2) {
      const minDonate = settings.goldDonateMin || 10000;
      if (spendable < minDonate && !settings.goldDonateAll) return false;

      if (isClanPage()) {
        const donateInput = document.querySelector('input[name="donation"]');
        const donateBtn = document.querySelector('input[name="donate"]');
        if (donateInput && donateBtn) {
          const amount = settings.goldDonateAll ? spendable : Math.min(spendable, minDonate);
          donateInput.value = String(amount);
          botLog('info', `💰 Gold: Darujem ${amount.toLocaleString()} zlata klanu`);
          state.goldLastSpend = Date.now();
          state.goldNavigating = false;
          saveState(state);
          setTimeout(() => { donateBtn.click(); }, randomDelay(800, 1500));
          return true;
        }
        return false;
      }

      // Navigate to clan page
      if (!state.goldNavigating) {
        botLog('info', '💰 Gold: Navigating to clan for donation');
        state.goldNavigating = true;
        saveState(state);
        setTimeout(() => { window.location.href = BASE + '/clan'; }, randomDelay(1000, 2000));
        return true;
      }
      return false;
    }

    return false;
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
        setTimeout(() => { workBtn.click(); }, randomDelay(800, 1500));
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
        setTimeout(() => { window.location.href = BASE + '/city/graveyard'; }, randomDelay(1000, 2000));
      }
    }
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
              setTimeout(() => { window.location.href = dbgLink.href; }, randomDelay(500, 1200));
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
          setTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(800, 1500));
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
            setTimeout(() => { window.location.href = pgLink.href; }, getSpeedDelay(settings));
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
        setTimeout(() => { window.location.href = BASE + '/profile/index'; }, randomDelay(800, 1500));
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
          setTimeout(() => { window.location.href = BASE + '/city/church'; }, randomDelay(1000, 2000));
          return;
        }
      }
      botLog('warn', `Grotto: HP ${hpPct}% low → Waiting for regeneration`);
      setTimeout(() => { loadState(st => { loadSettings(se => { grottoTick(st, se); }); }); }, randomDelay(30000, 60000));
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
      setTimeout(() => { window.location.href = BASE + '/city/grotte'; }, getSpeedDelay(settings));
      return;
    }

    // Navigate to grotto if not there
    if (!isGrottoPage()) {
      botLog('info', 'Grotto: Navigating → Grotto');
      state.grottoState = 'navigating';
      saveState(state);
      setTimeout(() => { window.location.href = BASE + '/city/grotte'; }, randomDelay(800, 1500));
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
      setTimeout(() => { targetBtn.click(); }, randomDelay(500, 1200));
    } else {
      botLog('warn', 'Grotto: Difficulty buttons not found on page, waiting...');
      setTimeout(() => {
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
      setTimeout(() => { loadState(st => { loadSettings(se => { pvpTick(st, se); }); }); }, randomDelay(60000, 120000));
      return;
    }

    // Check AP — need at least 1 AP for PvP
    if (ap.current !== null && ap.current < 1) {
      botLog('warn', `PvP: AP ${ap.current} — not enough AP`);
      setTimeout(() => { loadState(st => { loadSettings(se => { pvpTick(st, se); }); }); }, randomDelay(60000, 120000));
      return;
    }

    // Smart break
    if (settings.pvpSmartBreak && state.pvpNextAttack > Date.now()) {
      const waitMs = state.pvpNextAttack - Date.now();
      botLog('info', `PvP: Smart break – Next attack in ${Math.ceil(waitMs/60000)} min`);
      setTimeout(() => { loadState(st => { loadSettings(se => { pvpTick(st, se); }); }); }, Math.min(waitMs + 1000, 300000));
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
      setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, getSpeedDelay(settings));
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
      if (settings.pvpWhitelist) {
        const wl = settings.pvpWhitelist.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
        if (wl.length > 0) {
          const playerName = (document.querySelector('.reportTable td b, h2, .username, #profileName') || {}).textContent || '';
          if (playerName && wl.includes(playerName.trim().toLowerCase())) {
            botLog('info', `PvP: Player "${playerName.trim()}" is whitelisted → searching for another`);
            setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 2000));
            return;
          }
        }
      }

      if (attackLink) {
        state.pvpState = 'attacking';
        saveState(state);
        botLog('info', 'PvP: Found opponent → Attacking!');
        setTimeout(() => { attackLink.click(); }, randomDelay(500, 1200));
        return;
      }
      if (attackBtn) {
        state.pvpState = 'attacking';
        saveState(state);
        botLog('info', 'PvP: Found opponent → Attacking!');
        setTimeout(() => { attackBtn.click(); }, randomDelay(500, 1200));
        return;
      }

      // No attack button found — maybe no suitable opponent, go back
      botLog('warn', 'PvP: Attack button not found → searching again');
      setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1500, 3000));
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
              setTimeout(() => {
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
          setTimeout(() => {
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
        setTimeout(() => {
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
    setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(800, 1500));
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
      settings.scheduleIntervals = [];
      for (let i = 0; i < 5; i++) {
        settings.scheduleIntervals.push({
          enabled: document.querySelector(`.bf-sched-cb[data-si="${i}"]`)?.checked ?? false,
          start: document.querySelector(`.bf-sched-start[data-si="${i}"]`)?.value || '',
          end: document.querySelector(`.bf-sched-end[data-si="${i}"]`)?.value || '',
        });
      }
      settings.autoEnrollClanWar = document.getElementById('bf-auto-clan-war')?.checked ?? false;
      settings.hideGameforgeBar = document.getElementById('bf-hide-gf-bar')?.checked ?? false;
      settings.fixedInfobar = document.getElementById('bf-fixed-infobar')?.checked ?? false;
      settings.hideEventPanel = document.getElementById('bf-hide-event')?.checked ?? false;
      settings.backgroundRefresh = document.getElementById('bf-bg-refresh')?.checked ?? false;
      settings.backgroundRefreshInterval = parseInt(document.getElementById('bf-bg-refresh-interval')?.value) || 60;
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
    // Schedule
    const se = document.getElementById('bf-schedule-enabled'); if (se) se.checked = !!settings.scheduleEnabled;
    (settings.scheduleIntervals || []).forEach((si, i) => {
      const cb = document.querySelector(`.bf-sched-cb[data-si="${i}"]`); if (cb) cb.checked = !!si.enabled;
      const st = document.querySelector(`.bf-sched-start[data-si="${i}"]`); if (st) st.value = si.start || '';
      const en = document.querySelector(`.bf-sched-end[data-si="${i}"]`); if (en) en.value = si.end || '';
    });
    const acw = document.getElementById('bf-auto-clan-war'); if (acw) acw.checked = !!settings.autoEnrollClanWar;
    const hgf = document.getElementById('bf-hide-gf-bar'); if (hgf) hgf.checked = !!settings.hideGameforgeBar;
    const fib = document.getElementById('bf-fixed-infobar'); if (fib) fib.checked = !!settings.fixedInfobar;
    const hep = document.getElementById('bf-hide-event'); if (hep) hep.checked = !!settings.hideEventPanel;
    const bgr = document.getElementById('bf-bg-refresh'); if (bgr) bgr.checked = !!settings.backgroundRefresh;
    const bri = document.getElementById('bf-bg-refresh-interval'); if (bri) bri.value = settings.backgroundRefreshInterval || 60;
    const brl = document.getElementById('bf-bg-refresh-label'); if (brl) brl.textContent = (settings.backgroundRefreshInterval || 60) + ' min';
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
        <div class="bf-bl-tab active" data-bltab="ruins">⚔ Ruins</div>
        <div class="bf-bl-tab" data-bltab="essence">🩸 Essence</div>
      </div>
      <div class="bf-bl-tab-body" id="bf-bl-ruins-body">
        <div style="display:flex;gap:4px;padding:4px 6px;align-items:center">
          <select id="bf-bl-filter" style="background:#111;color:#4caf50;border:1px solid #1a3a1a;font-size:0.56rem;padding:1px 3px;border-radius:3px;flex:1">
            <option value="all">All levels</option>
          </select>
          <button id="bf-bl-export" title="Export CSV" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#4caf50">📥</button>
          <button id="bf-bl-clear" title="Clear" style="background:none;border:none;cursor:pointer;font-size:0.6rem;color:#e74c3c">🗑</button>
        </div>
        <div id="bf-bl-summary" class="bf-bl-summary"></div>
        <div id="bf-bl-list" class="bf-bl-list"></div>
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
      if (!open) { renderBattleLog(); renderEssenceLog(); }
    });
    document.getElementById('bf-bl-close').addEventListener('click', () => { panel.style.display = 'none'; });

    // Tab switching
    panel.querySelectorAll('.bf-bl-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.bf-bl-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.getAttribute('data-bltab');
        document.getElementById('bf-bl-ruins-body').style.display = which === 'ruins' ? 'flex' : 'none';
        document.getElementById('bf-bl-essence-body').style.display = which === 'essence' ? 'flex' : 'none';
        if (which === 'ruins') renderBattleLog();
        if (which === 'essence') renderEssenceLog();
      });
    });

    // Ruins controls
    document.getElementById('bf-bl-filter').addEventListener('change', () => renderBattleLog());
    document.getElementById('bf-bl-clear').addEventListener('click', () => {
      if (confirm('Clear ruins battle log?')) { sSet({ [SK('ruinsBattleLog')]: [] }); renderBattleLog(); }
    });
    document.getElementById('bf-bl-export').addEventListener('click', () => {
      sGet([SK('ruinsBattleLog')], r => {
        const log = r[SK('ruinsBattleLog')] || [];
        if (!log.length) return;
        const rows = [['Time','Level','Result','Enemy','Formation','Source','Losses','Gold','XP']];
        log.forEach(e => {
          rows.push([
            new Date(e.ts).toLocaleString(), e.level,
            e.won ? 'Victory' : 'Defeat', qtyToString(e.enemy || {}),
            qtyToString(e.formation || {}), e.source || '?',
            qtyToString(e.losses || {}), e.gold || 0, e.xp || 0,
          ]);
        });
        const csv = rows.map(r => r.join(';')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `bf-battlelog-${SERVER_ID}.csv`; a.click();
        URL.revokeObjectURL(url);
      });
    });

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
        const a = document.createElement('a'); a.href = url; a.download = `bf-essence-${SERVER_ID}.csv`; a.click();
        URL.revokeObjectURL(url);
      });
    });

    // Populate ruins filter
    sGet([SK('ruinsBattleLog')], r => {
      const log = r[SK('ruinsBattleLog')] || [];
      const lvls = [...new Set(log.map(e => e.level))].sort((a,b) => a - b);
      const sel = document.getElementById('bf-bl-filter');
      lvls.forEach(l => {
        const opt = document.createElement('option');
        opt.value = String(l); opt.textContent = `Level ${l}`;
        sel.appendChild(opt);
      });
    });
  }

  function renderBattleLog() {
    sGet([SK('ruinsBattleLog')], r => {
      const log = r[SK('ruinsBattleLog')] || [];
      const filterLvl = document.getElementById('bf-bl-filter')?.value || 'all';
      const filtered = filterLvl === 'all' ? log : log.filter(e => String(e.level) === filterLvl);

      const sumEl = document.getElementById('bf-bl-summary');
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

      const listEl = document.getElementById('bf-bl-list');
      if (!listEl) return;
      const show = [...filtered].reverse().slice(0, 100);
      if (!show.length) {
        listEl.innerHTML = '<div style="color:#444;text-align:center;padding:10px;font-size:0.58rem">No records</div>';
        return;
      }
      listEl.innerHTML = show.map(e => {
        const time = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(e.ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
        const lossStr = Object.entries(e.losses || {}).filter(([,v]) => v > 0).map(([k,v]) => `<span style="color:#e07040">${k}:-${v}</span>`).join(' ');
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
        </div>`;
      }).join('');
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
        <span>🤖 BF Bot <span style="font-size:0.55rem;opacity:0.4;margin-left:4px">v0.9.0 · ${SERVER_ID}</span></span>
        <div style="display:flex;gap:4px;align-items:center">
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
            <span class="status-text">Stav:</span>
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
            <div class="bf-bot-group-title">⚔ Auto Recruitment</div>
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-recruit-enabled">
              Auto-train units
            </label>
            <div class="bf-bot-row" style="margin-top:4px">
              <span class="bf-bot-label" style="min-width:60px">Kedy:</span>
              <select class="bf-bot-select" id="bf-recruit-trigger" style="flex:1">
                <option value="every">After every extraction</option>
                <option value="threshold">When BE ≥ threshold</option>
              </select>
            </div>
            <div class="bf-bot-row" id="bf-recruit-threshold-row" style="display:none;margin-top:4px">
              <span class="bf-bot-label" style="min-width:60px">BE ≥</span>
              <input type="number" class="bf-bot-input" id="bf-recruit-threshold" value="100" min="10" style="width:70px">
            </div>
            <div style="font-size:0.6rem;color:#aaa;margin:8px 0 4px 0">
              Dividing the essence into units (%):
            </div>
            <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:3px 0">
              <span style="color:#ccc;font-size:0.6rem;min-width:90px">T1 (10 BE)</span>
              <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="1" min="0" max="100" value="0" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
            <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:3px 0">
              <span style="color:#ccc;font-size:0.6rem;min-width:90px">T2 (15 BE)</span>
              <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="2" min="0" max="100" value="0" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
            <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:3px 0">
              <span style="color:#ccc;font-size:0.6rem;min-width:90px">T3 (20 BE)</span>
              <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="3" min="0" max="100" value="0" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
            <div class="bf-recruit-unit-row" style="display:flex;align-items:center;gap:6px;margin:3px 0">
              <span style="color:#ccc;font-size:0.6rem;min-width:90px">T4 (35 BE)</span>
              <input type="number" class="bf-bot-input bf-recruit-pct" data-unit="4" min="0" max="100" value="0" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.6rem">%</span>
            </div>
            <div id="bf-recruit-total" style="font-size:0.6rem;color:#e0a030;margin-top:4px;font-weight:bold">
              Total: 0% (must be 100%)
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-top:4px;line-height:1.3">
              E.g. T2 60% + T3 40% → from 100 BE, 60 goes to T2 (4 units) and 40 to T3 (2 units).
              Remaining BE will be saved for the next extraction.
            </div>
          </div>

        </div>

        <!-- RUINS TAB -->
        <div class="bf-bot-section" id="bf-bot-ruins">
          <button class="bf-bot-btn bf-bot-toggle-top" id="bf-ruins-toggle">▶ Start Ruins Bot</button>

          <div class="bf-bot-status">
            <span class="status-text">Stav:</span>
            <span class="status-value" id="bf-ruins-status">Disabled</span>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">🏚 Levels to Farm</div>
            <div class="bf-ruins-levels" id="bf-ruins-level-grid"></div>
            <div class="bf-bot-row" style="margin-top:6px">
              <span class="bf-bot-label">Custom:</span>
              <input type="text" class="bf-bot-input" id="bf-ruins-custom" placeholder="napr: 1,5,10,15,20" style="flex:1">
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
            <div class="bf-bot-row">
              <span class="bf-bot-label">Interval:</span>
              <input type="number" class="bf-bot-input" id="bf-ruins-interval" value="60" min="1" max="1440">
              <span style="color:#5a7a4a;font-size:0.62rem">min</span>
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">⚔ Preset Formations</div>
            <div style="font-size:0.58rem;color:#5a7a4a;margin-bottom:4px;line-height:1.4">
              Bot compares enemy with database. Match → uses preset. No match → simulates.
            </div>
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
            <span class="status-text">Stav:</span>
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
            <span class="status-text">Stav:</span>
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
            <span class="status-text">Stav:</span>
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
              <span class="bf-bot-label" style="min-width:70px">BV od:</span>
              <input type="number" class="bf-bot-input" id="bf-pvp-bv-from" placeholder="9965" style="width:70px">
              <span class="bf-bot-label" style="min-width:30px;text-align:center">do:</span>
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
            <div class="bf-bot-row" style="margin-top:4px">
              <input type="number" class="bf-bot-input" id="bf-pvp-delay" value="20" min="1" style="width:50px">
              <span style="color:#5a7a4a;font-size:0.56rem">min &nbsp;±</span>
              <input type="number" class="bf-bot-input" id="bf-pvp-margin" value="3" min="0" style="width:40px">
              <span style="color:#5a7a4a;font-size:0.56rem">(randomizer)</span>
            </div>
            <div style="font-size:0.56rem;color:#5a7a4a;margin-top:4px;line-height:1.3">
              E.g. 20±3 = pause 17–23 min between attacks (random interval).
            </div>
          </div>

          <div class="bf-bot-group">
            <div class="bf-bot-group-title">📊 PvP Statistics</div>
            <div class="bf-bot-info-grid" style="grid-template-columns:1fr 1fr">
              <div class="bf-bot-info-cell"><span class="label">Wins:</span> <span class="value" id="bf-pvp-wins">0</span></div>
              <div class="bf-bot-info-cell"><span class="label">Prehry:</span> <span class="value" id="bf-pvp-losses">0</span></div>
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
            <span class="status-text">Stav:</span>
            <span class="status-value" id="bf-gifts-status">Disabled</span>
          </div>
        </div>

        <!-- GLOBAL TAB -->
        <div class="bf-bot-section" id="bf-bot-global">
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
              <div class="bf-bot-row">
                <span class="bf-bot-label" style="min-width:70px">Min Gold:</span>
                <input type="number" class="bf-bot-input" id="bf-gold-donate-min" value="10000" min="0" style="width:90px">
              </div>
              <label class="bf-bot-checkbox">
                <input type="checkbox" id="bf-gold-donate-all">
                Donate all gold
              </label>
            </div>
            <div class="bf-bot-row" style="margin-top:4px;align-items:center;flex-wrap:nowrap">
              <label class="bf-bot-checkbox" style="flex:0 0 auto;margin:0;white-space:nowrap">
                <input type="checkbox" id="bf-gold-keep">
                Keep:
              </label>
              <input type="number" class="bf-bot-input" id="bf-gold-keep-val" value="0" min="0" style="width:80px;flex:0 0 auto;margin-left:4px">
              <span style="color:#5a7a4a;font-size:0.56rem;flex:0 0 auto;margin-left:2px">Gold</span>
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
            <label class="bf-bot-checkbox">
              <input type="checkbox" id="bf-schedule-enabled">
              Enable schedule
            </label>
            <div id="bf-schedule-intervals" style="margin-top:4px;font-size:0.56rem">
              <div class="bf-bot-row" style="margin-bottom:2px">
                <input type="checkbox" class="bf-sched-cb" data-si="0"> <span style="min-width:20px">#1</span>
                <input type="time" class="bf-bot-input bf-sched-start" data-si="0" style="width:75px;font-size:0.56rem" value="08:00">
                <span>–</span>
                <input type="time" class="bf-bot-input bf-sched-end" data-si="0" style="width:75px;font-size:0.56rem" value="12:00">
              </div>
              <div class="bf-bot-row" style="margin-bottom:2px">
                <input type="checkbox" class="bf-sched-cb" data-si="1"> <span style="min-width:20px">#2</span>
                <input type="time" class="bf-bot-input bf-sched-start" data-si="1" style="width:75px;font-size:0.56rem" value="13:00">
                <span>–</span>
                <input type="time" class="bf-bot-input bf-sched-end" data-si="1" style="width:75px;font-size:0.56rem" value="17:00">
              </div>
              <div class="bf-bot-row" style="margin-bottom:2px">
                <input type="checkbox" class="bf-sched-cb" data-si="2"> <span style="min-width:20px">#3</span>
                <input type="time" class="bf-bot-input bf-sched-start" data-si="2" style="width:75px;font-size:0.56rem" value="18:00">
                <span>–</span>
                <input type="time" class="bf-bot-input bf-sched-end" data-si="2" style="width:75px;font-size:0.56rem" value="22:00">
              </div>
              <div class="bf-bot-row" style="margin-bottom:2px">
                <input type="checkbox" class="bf-sched-cb" data-si="3"> <span style="min-width:20px">#4</span>
                <input type="time" class="bf-bot-input bf-sched-start" data-si="3" style="width:75px;font-size:0.56rem">
                <span>–</span>
                <input type="time" class="bf-bot-input bf-sched-end" data-si="3" style="width:75px;font-size:0.56rem">
              </div>
              <div class="bf-bot-row" style="margin-bottom:2px">
                <input type="checkbox" class="bf-sched-cb" data-si="4"> <span style="min-width:20px">#5</span>
                <input type="time" class="bf-bot-input bf-sched-start" data-si="4" style="width:75px;font-size:0.56rem">
                <span>–</span>
                <input type="time" class="bf-bot-input bf-sched-end" data-si="4" style="width:75px;font-size:0.56rem">
              </div>
            </div>
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
              Background Refresh (Smart Wake Up)
            </label>
            <div class="bf-bot-row" style="margin-left:18px;flex-wrap:wrap">
              <span style="color:#5a7a4a;font-size:0.56rem;width:100%;margin-bottom:2px">Background page refresh interval (1–600 min):</span>
              <input type="range" class="bf-bot-input" id="bf-bg-refresh-interval" min="1" max="600" step="1" value="60" style="width:150px;accent-color:red">
              <span id="bf-bg-refresh-label" style="color:#e0a030;font-size:0.6rem;font-weight:bold;min-width:50px">60 min</span>
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
        _centralStopActive = newState; // sync cache
        sSet({ [SK('centralStop')]: newState }, () => {
          centralStopBtn.classList.toggle('engaged', newState);
          if (newState) {
            botLog('warn', '🛑 CENTRAL STOP ENGAGED — all bots halted');
          } else {
            botLog('info', '✅ Central STOP released — bots resuming');
            // Re-trigger botTick to resume where left off
            loadState(st => { loadSettings(se => {
              updateStatusDot(se, st);
              setTimeout(() => botTick(st, se), randomDelay(500, 1500));
            }); });
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

    // Ruins level grid clicks
    panel.addEventListener('click', (e) => {
      const lvl = e.target.closest('.bf-ruins-lvl');
      if (lvl) {
        lvl.classList.toggle('selected');
        updateRuinsLevelSelection();
      }
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
        settings.recruitEnabled = document.getElementById('bf-recruit-enabled')?.checked ?? false;
        settings.recruitTrigger = document.getElementById('bf-recruit-trigger')?.value || 'every';
        settings.recruitThreshold = parseInt(document.getElementById('bf-recruit-threshold')?.value) || 100;
        // Gather recruit % allocation
        const recruitPct = {};
        document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
          const unitId = inp.dataset.unit;
          if (unitId) recruitPct[unitId] = parseInt(inp.value) || 0;
        });
        settings.recruitPercent = recruitPct;
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
                setTimeout(() => {
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
            setTimeout(() => botTick(state, settings), randomDelay(500, 1500));
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
        // Safety settings
        settings.ruinsStopNoWin = document.getElementById('bf-ruins-stop-nowin')?.checked ?? true;
        settings.ruinsStopPresetShort = document.getElementById('bf-ruins-stop-preset-short')?.checked ?? true;
        settings.ruinsStopMinUnits = document.getElementById('bf-ruins-stop-min-units')?.checked ?? false;
        settings.ruinsMinUnits = {
          T1: parseInt(document.getElementById('bf-ruins-min-t1')?.value) || 0,
          T2: parseInt(document.getElementById('bf-ruins-min-t2')?.value) || 0,
          T3: parseInt(document.getElementById('bf-ruins-min-t3')?.value) || 0,
          T4: parseInt(document.getElementById('bf-ruins-min-t4')?.value) || 0,
        };

        saveSettings(settings);

        if (settings.ruinsEnabled) {
          loadState((state) => {
            state.ruinsState = 'idle';
            state.ruinsCurrentIdx = 0;
            state.ruinsCurrentCycle = 1;
            saveState(state);
            botLog('ok', `Ruins Bot STARTED (${settings.ruinsLevels.length} levels, ${settings.ruinsCadence})`);
            updateRuinsUI(settings, state);
            setTimeout(() => botTick(state, settings), randomDelay(500, 1500));
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
            setTimeout(() => botTick(state, settings), randomDelay(500, 1500));
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
            setTimeout(() => botTick(state, settings), randomDelay(500, 1500));
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
        saveSettings(settings);
        if (settings.pvpEnabled) {
          loadState((state) => {
            state.pvpState = 'navigating';
            saveState(state);
            botLog('ok', 'PvP Bot STARTED');
            updatePvPUI(settings, state);
            setTimeout(() => botTick(state, settings), randomDelay(500, 1500));
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
            setTimeout(() => botTick(state, settings), randomDelay(500, 1500));
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

    // Background refresh slider label
    document.getElementById('bf-bg-refresh-interval')?.addEventListener('input', (e) => {
      const lbl = document.getElementById('bf-bg-refresh-label');
      if (lbl) lbl.textContent = e.target.value + ' min';
    });

    // PvP mode change — show/hide BV range row and blacklist group
    document.getElementById('bf-pvp-mode')?.addEventListener('change', (e) => {
      const mode = parseInt(e.target.value);
      const bvRow = document.getElementById('bf-pvp-bv-row');
      const blGroup = document.getElementById('bf-pvp-bl-group');
      if (bvRow) bvRow.style.display = (mode === 4) ? 'flex' : 'none';
      if (blGroup) blGroup.style.display = (mode === 3) ? '' : 'none';
    });

    // Recruit — % total calculator
    document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
      inp.addEventListener('input', () => updateRecruitTotal());
    });

    // Recruit trigger change — show/hide threshold row
    document.getElementById('bf-recruit-trigger')?.addEventListener('change', (e) => {
      const thresholdRow = document.getElementById('bf-recruit-threshold-row');
      if (thresholdRow) thresholdRow.style.display = (e.target.value === 'threshold') ? 'flex' : 'none';
    });

    // Build ruins level grid
    buildRuinsGrid();

    // Init UI from saved settings
    loadSettings((settings) => {
      applySettingsToUI(settings);
      loadState((state) => {
        updateHuntUI(settings, state);
        updateRuinsUI(settings, state);
        updateStoryUI(settings, state);
        updateGrottoUI(settings, state);
        updatePvPUI(settings, state);
        updateGiftsUI(settings, state);
        applyGlobalSettingsToUI(settings);
        updateInfoBadges();

        // Auto-resume if any bot was running
        const huntActive = settings.huntEnabled && state.huntState !== 'idle';
        const ruinsActive = settings.ruinsEnabled && state.ruinsState !== 'idle' && state.ruinsState !== 'done';
        const storyActive = settings.storyEnabled && state.storyState !== 'idle' && state.storyState !== 'done';
        const grottoActive = settings.grottoEnabled && state.grottoState !== 'idle' && state.grottoState !== 'done';
        const pvpActive = settings.pvpEnabled && state.pvpState !== 'idle' && state.pvpState !== 'done';
        const giftsActive = state.giftsState === 'running' || settings.giftsAutoDBG;
        const globalActive = settings.goldMode > 0 || settings.graveyardEnabled;

        if (huntActive || ruinsActive || storyActive || grottoActive || pvpActive || giftsActive || globalActive) {
          const parts = [];
          if (huntActive) parts.push('Hunt' + (state.huntState === 'waiting_orb' ? ' (cooldown)' : ''));
          if (ruinsActive) parts.push('Ruins');
          if (storyActive) parts.push('Story');
          if (grottoActive) parts.push('Grotto');
          if (pvpActive) parts.push('PvP');
          if (giftsActive) parts.push('Gifts');
          if (globalActive) parts.push('Global');
          botLog('info', `Bot resumed after reload: ${parts.join(' + ')}`);
          updateStatusDot(settings, state);

          // Start cooldown ticker if hunt is on cooldown
          if (huntActive && state.huntState === 'waiting_orb') {
            startCooldownTicker(settings, state);
          }

          // Single botTick call handles priority routing
          setTimeout(() => botTick(state, settings), randomDelay(1500, 3000));
        }
      });
    });
  }

  // ── CENTRAL STOP CHECK ──────────────────────────────────────
  // Cached flag — updated by central stop button and on init
  let _centralStopActive = false;
  function initCentralStop() {
    sGet([SK('centralStop')], r => { _centralStopActive = r[SK('centralStop')] === true; });
  }
  initCentralStop();
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
        const storyActive = settings.storyEnabled && state.storyState !== 'idle' && state.storyState !== 'done';
        const storyWaiting = settings.storyEnabled && (state.storyState === 'waiting_ap' || state.storyRecovering);
        const grottoActive = settings.grottoEnabled && state.grottoState !== 'idle' && state.grottoState !== 'done';
        const pvpActive = settings.pvpEnabled && state.pvpState !== 'idle' && state.pvpState !== 'done';
        const pvpWaiting = settings.pvpEnabled && state.pvpState === 'waiting';
        const giftsActive = state.giftsState === 'running' || settings.giftsAutoDBG;
        const globalActive = settings.goldMode > 0 || settings.graveyardEnabled;

        const anyBotEnabled = huntActive || ruinsActive || storyActive || grottoActive || pvpActive || giftsActive;
        const allWaiting = (!huntActive || huntWaiting) &&
                           (!storyActive || storyWaiting) &&
                           (!pvpActive || pvpWaiting) &&
                           !ruinsActive && !grottoActive && !giftsActive;

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

    _cooldownInterval = setInterval(() => {
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
              setTimeout(() => { window.location.href = BASE + '/robbery/index'; }, randomDelay(1000, 3000));
            }
          });
        });
      }
    }, 1000);
  }

  function stopCooldownTicker() {
    if (_cooldownInterval) {
      clearInterval(_cooldownInterval);
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

  function buildRuinsGrid() {
    const grid = document.getElementById('bf-ruins-level-grid');
    if (!grid) return;
    let html = '';
    for (let i = 1; i <= 30; i++) {
      html += `<div class="bf-ruins-lvl${i <= 20 ? ' selected' : ''}" data-level="${i}">${i}</div>`;
    }
    grid.innerHTML = html;
  }

  function getSelectedRuinsLevels() {
    // Check custom input first
    const custom = document.getElementById('bf-ruins-custom')?.value?.trim();
    if (custom) {
      return custom.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
    }
    // Grid selection
    return Array.from(document.querySelectorAll('.bf-ruins-lvl.selected'))
      .map(el => parseInt(el.getAttribute('data-level'))).filter(n => !isNaN(n)).sort((a, b) => a - b);
  }

  function updateRuinsLevelSelection() {
    // Sync custom input with grid
    const levels = Array.from(document.querySelectorAll('.bf-ruins-lvl.selected'))
      .map(el => el.getAttribute('data-level')).join(',');
    // Don't overwrite custom if it has values
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

    // Recruit
    const recruitEn = document.getElementById('bf-recruit-enabled');
    if (recruitEn) recruitEn.checked = !!settings.recruitEnabled;
    const recruitTrigger = document.getElementById('bf-recruit-trigger');
    if (recruitTrigger) recruitTrigger.value = settings.recruitTrigger || 'every';
    const recruitThreshold = document.getElementById('bf-recruit-threshold');
    if (recruitThreshold) recruitThreshold.value = settings.recruitThreshold || 100;
    const thresholdRow = document.getElementById('bf-recruit-threshold-row');
    if (thresholdRow) thresholdRow.style.display = (settings.recruitTrigger === 'threshold') ? 'flex' : 'none';
    // Restore % allocations
    const rPct = settings.recruitPercent || {};
    document.querySelectorAll('.bf-recruit-pct').forEach(inp => {
      const unitId = inp.dataset.unit;
      if (unitId && rPct[unitId] !== undefined) inp.value = rPct[unitId];
    });
    updateRecruitTotal();

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

    // Ruins levels — select in grid
    const levels = settings.ruinsLevels || [];
    document.querySelectorAll('.bf-ruins-lvl').forEach(el => {
      const lvl = parseInt(el.getAttribute('data-level'));
      if (levels.includes(lvl)) el.classList.add('selected');
      else el.classList.remove('selected');
    });

    // Ruins safety settings
    const stopNoWin = document.getElementById('bf-ruins-stop-nowin');
    if (stopNoWin) stopNoWin.checked = settings.ruinsStopNoWin !== false;
    const stopPreset = document.getElementById('bf-ruins-stop-preset-short');
    if (stopPreset) stopPreset.checked = settings.ruinsStopPresetShort !== false;
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { createBotPanel(); createBattleLogPanel(); });
  } else {
    createBotPanel();
    createBattleLogPanel();
  }

})();
