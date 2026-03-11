// ============================================================
// Bitefight Battle Simulator — Content Script v0.8.0
// FIX: Timing — wait for BF_PANEL_READY from iframe
//      Fix: army import failed because iframe was not loaded
// ============================================================
(function () {
  'use strict';

  // ── 1. LOBBY EXCLUSION ─────────────────────────────────────
  const hostname = window.location.hostname;
  if (hostname.startsWith('lobby.') || hostname.startsWith('forum.') || hostname.startsWith('support.')) return;

  // ── 2. CONTEXT GUARD ──────────────────────────────────────
  function ctxOk() {
    try { return !!chrome.runtime?.id; } catch (e) { return false; }
  }
  function safeStorageGet(keys, cb) {
    if (!ctxOk()) return;
    try { chrome.storage.local.get(keys, (r) => { if (ctxOk()) cb(r); }); } catch (e) {}
  }
  function safeStorageSet(obj) {
    if (!ctxOk()) return;
    try { chrome.storage.local.set(obj); } catch (e) {}
  }

  // ── 3. SERVER ID ───────────────────────────────────────────
  const SERVER_ID = hostname.split('.')[0] || 'unknown'; // "s25-sk"
  let PLAYER_ID = null; // Detected async at boot
  const SK = (k) => SERVER_ID + (PLAYER_ID ? '_p' + PLAYER_ID : '') + '_' + k;
  const PID_CACHE_KEY = SERVER_ID + '__pid';

  // ── 3b. PLAYER ID DETECTION (Multi-Account Support) ───────
  const PID_TTL = 10 * 60 * 1000; // 10 min cache TTL
  const _onProfileNow = window.location.pathname.startsWith('/profile');

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

        // D) Fetch /profile/index
        const BASE = window.location.origin;
        fetch(BASE + '/profile/index', { credentials: 'include' })
          .then(resp => resp.text())
          .then(html => {
            let m = html.match(/<div\s+id="senderid"[^>]*>(\d+)<\/div>/);
            if (m) { cacheAndResolve(m[1]); return; }
            m = html.match(/\/profile\/player\/(\d+)/);
            if (m) { cacheAndResolve(m[1]); return; }
            if (cached && cached.id) { PLAYER_ID = String(cached.id); resolve(PLAYER_ID); return; }
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

  // ── 4. ENEMY NAME MAP ────────────────────────────────────
  // Enemy tier detection: language-independent, based on unit position/index in DOM
  // Enemy units in ruins are always displayed in order: E1, E2, E3, E4, E5, E6
  // We detect by: data attributes, img src paths, CSS classes, or DOM order
  const ENEMY_MAP = {}; // Not used — tier detected structurally
  const toTier = (name, index) => {
    // If index is provided (position in unit list), use it directly
    if (typeof index === 'number' && index >= 0) return 'E' + (index + 1);
    return null;
  };

  // ── 5. AP PARSING ──────────────────────────────────────────
  function readAP() {
    const img = document.querySelector('img[src*="symbols/ap.gif"], img[src*="/ap.gif"]');
    if (!img) return { current: null, max: null };
    let node = img.previousSibling;
    while (node) {
      const txt = (node.textContent || '').replace(/\u00a0/g, ' ').trim();
      const m = txt.match(/(\d+)\s*\/\s*(\d+)\s*$/);
      if (m) return { current: parseInt(m[1]), max: parseInt(m[2]) };
      node = node.previousSibling;
    }
    return { current: null, max: null };
  }

  // ── 6. BLOOD ESSENCE ───────────────────────────────────────
  function readBE() {
    const el = document.getElementById('blood-essen-balance');
    return el ? (parseInt(el.textContent.replace(/\D/g, '')) || 0) : null;
  }

  // ── 7. ALLY ARMY ────────────────────────────────────
  function readAlly() {
    // ancestral/show: slidery input.combatSlider#playerArmyN
    const sliders = document.querySelectorAll('input.combatSlider[id^="playerArmy"]');
    if (sliders.length) {
      const units = Array.from(sliders).map(sl => {
        const id   = sl.getAttribute('data-id');
        const card = document.getElementById('playerUnit-' + id);
        return {
          id,
          name:     card?.querySelector('.valueName')?.textContent?.trim() || ('Tier ' + id),
          owned:    parseInt(sl.getAttribute('max'))          || 0,
          selected: parseInt(sl.value)                        || 0,
          power:    parseFloat(sl.getAttribute('data-value')) || 1,
        };
      });
      const powerLimit = (typeof window.difficultyFactor === 'number')
        ? window.difficultyFactor
        : (() => { const m = (document.querySelector('.armyPower')?.textContent||'').match(/\/\s*(\d+)/); return m ? parseInt(m[1]) : null; })();
      return { units, powerLimit, source: 'ancestral-show' };
    }

    // nourishing: data-unit-values
    const armyEl = document.getElementById('units-total-army');
    if (armyEl) {
      try {
        const army = JSON.parse(armyEl.getAttribute('data-unit-values') || '[]');
        if (army.length) return {
          units: army.map(u => ({ id: u.id, name: u.name, owned: parseInt(u.owned)||0, selected: 0, power: parseInt(u.value)||0 })),
          powerLimit: null, source: 'nourishing'
        };
      } catch (e) {}
    }

    // fallback: #owned-N spany
    const byOwned = [];
    for (let i = 1; i <= 8; i++) {
      const el = document.getElementById('owned-' + i);
      if (!el) continue;
      const card = document.getElementById('unit-' + i);
      byOwned.push({ id: String(i), name: card?.querySelector('.uc-name')?.textContent?.trim() || ('Tier '+i), owned: parseInt(el.textContent)||0, selected: 0, power: i });
    }
    if (byOwned.length) return { units: byOwned, powerLimit: null, source: 'owned-spans' };
    return null;
  }

  // ── 8. ENEMY ARMY ──────────────────────────────────
  function readEnemy() {
    // ancestral/show: #enemyCardInner .enemySlot:not(.locked-unit)
    const slots = document.querySelectorAll('#enemyCardInner .enemySlot:not(.locked-unit)');
    if (slots.length) {
      const enemies = Array.from(slots).map((slot, i) => ({
        name: slot.querySelector('.valueName')?.textContent?.trim() || '',
        qty:  parseInt(slot.querySelector('.qtyValue')?.textContent?.trim()) || 0,
        tier: toTier(null, i),
        pos:  slot.classList.contains('enemyFront') ? 'Vanguard' : 'Rearguard'
      })).filter(e => e.qty > 0);
      if (enemies.length) return { enemies, source: 'ancestral-show' };
    }

    // ancestral/index: active layerInfoContainer
    const containers = document.querySelectorAll('[id^="layerInfoContainer"]');
    const active = Array.from(containers).find(c => c.classList.contains('active'))
                || Array.from(containers).find(c => c.querySelector('.enemyUnits[title]'));
    if (active) {
      const difficulty = parseInt(active.querySelector('.cyan-layer')?.textContent) || null;
      const enemies = Array.from(active.querySelectorAll('.enemyUnits[title]'))
        .filter(el => el.getAttribute('title'))
        .map((el, i) => ({
          name: el.getAttribute('title'),
          qty:  parseInt((el.querySelector('p')?.textContent||'x0').replace('x',''))||0,
          tier: toTier(null, i), pos: null
        })).filter(e => e.qty > 0);
      if (enemies.length) return { enemies, source: 'ancestral-index', powerLimit: difficulty };
    }
    return { enemies: null, source: 'none' };
  }

  // ── 9. EXTRACTION ORBS ──────────────────────────────────────
  function readOrbs() {
    const slots = document.querySelectorAll('#slots_availability .slot .timer, .slots .slot .timer');
    if (!slots.length) return null;
    const timers = Array.from(slots).map(el => ({
      remaining: parseInt(el.getAttribute('data-remaining')) || 0,
      text: el.textContent.trim()
    }));
    return { timers, ready: timers.filter(o => o.remaining <= 0).length, total: timers.length };
  }

  // ── 10. COMPLETE STATE ─────────────────────────────────────
  function readGameState() {
    const ap = readAP();
    return {
      serverId: SERVER_ID, playerId: PLAYER_ID, page: window.location.pathname,
      apCurrent: ap.current, apMax: ap.max,
      bloodEssence: readBE(),
      ally:  readAlly(),
      enemy: readEnemy(),
      orbs:  readOrbs(),
    };
  }

  // ── 11. PANEL + TIMING FIX ─────────────────────────────────
  // Problem: sendGameState() was called before iframe loaded
  // Solution: iframe sends 'BF_PANEL_READY' → then we send data
  let panelReady = false;

  // Listen for messages from iframe (bridge.js sends BF_PANEL_READY)
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'BF_PANEL_READY') {
      panelReady = true;
      sendGameState(); // Now iframe is ready — send data
    }
  });

  function sendGameState() {
    if (!ctxOk()) return;
    const state = readGameState();
    const iframe = document.getElementById('bf-sim-iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'BF_GAME_STATE', state }, '*');
    }
  }

  function createPanel() {
    if (document.getElementById('bf-sim-container')) return;

    const btn = document.createElement('div');
    btn.id = 'bf-sim-btn';
    btn.innerHTML = `
      <img src="${chrome.runtime.getURL('img/icon-48.png')}" alt="⚔" />
      <span class="bf-sim-label">Simulator</span>
      <span class="bf-sim-notif" id="bf-notif" style="display:none">!</span>
    `;
    document.body.appendChild(btn);

    const container = document.createElement('div');
    container.id = 'bf-sim-container';
    container.style.display = 'none';
    container.innerHTML = `
      <div id="bf-sim-header">
        <span>⚔ BF Simulator <span style="font-size:0.6rem;opacity:0.4;margin-left:4px">β v0.9.3 · ${SERVER_ID}${PLAYER_ID ? ' · #' + PLAYER_ID : ''}</span></span>
        <div style="display:flex;gap:6px;align-items:center">
          <span id="bf-ap-badge"  class="bf-badge">AP: –</span>
          <span id="bf-be-badge"  class="bf-badge bf-badge-blood">BE: –</span>
          <span id="bf-orb-badge" class="bf-badge bf-badge-orb" style="display:none">🔴 Orby!</span>
          <button id="bf-sim-close">✕</button>
        </div>
      </div>
      <iframe id="bf-sim-iframe" src="${chrome.runtime.getURL('html/panel.html')}"></iframe>
    `;
    document.body.appendChild(container);

    btn.addEventListener('click', () => {
      const open = container.style.display !== 'none';
      container.style.display = open ? 'none' : 'flex';
      if (!open) {
        // If iframe was already loaded, send state immediately
        // If not, BF_PANEL_READY event will do it automatically
        if (panelReady) sendGameState();
      }
    });

    container.querySelector('#bf-sim-close').addEventListener('click', () => {
      container.style.display = 'none';
    });

    makeDraggable(container, container.querySelector('#bf-sim-header'));
    updateBadges();
    setInterval(() => { if (ctxOk()) updateBadges(); }, 20000);
  }

  function updateBadges() {
    const state = readGameState();
    const apB   = document.getElementById('bf-ap-badge');
    const beB   = document.getElementById('bf-be-badge');
    const orbB  = document.getElementById('bf-orb-badge');
    const notif = document.getElementById('bf-notif');

    if (apB) {
      apB.textContent = state.apCurrent !== null ? `AP: ${state.apCurrent}/${state.apMax}` : 'AP: –';
      apB.style.color = (state.apCurrent !== null && state.apCurrent >= state.apMax) ? '#2ecc71' : '';
    }
    if (beB) beB.textContent = state.bloodEssence !== null ? `BE: ${state.bloodEssence}` : 'BE: –';
    const ready = state.orbs?.ready || 0;
    if (orbB) { orbB.style.display = ready > 0 ? 'inline-block' : 'none'; if (ready > 0) orbB.textContent = `🔴 Orby (${ready})`; }
    if (notif) notif.style.display = ready > 0 ? 'block' : 'none';
  }

  // ── 12. DRAGGABLE ─────────────────────────────────────────
  function makeDraggable(el, handle) {
    let ox, oy, ol, ot;
    handle.style.cursor = 'grab';
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
        safeStorageSet({ [SK('panelLeft')]: el.style.left, [SK('panelTop')]: el.style.top });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    safeStorageGet([SK('panelLeft'), SK('panelTop')], (r) => {
      const l = r[SK('panelLeft')]; const t = r[SK('panelTop')];
      if (l) { el.style.left = l; el.style.right  = 'auto'; }
      if (t) { el.style.top  = t; el.style.bottom = 'auto'; }
    });
  }

  // ── 13. INIT ──────────────────────────────────────────────
  function boot() {
    detectPlayerId().then(() => {
      createPanel();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
