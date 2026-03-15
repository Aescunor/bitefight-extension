// ============================================================
// Bitefight Battle Simulator — Bridge v0.9.1
// FIX: field names s.ally / s.enemy (nie allyFormation/enemyShow)
// FIX: no inline onclick= handlers (CSP)
// FIX: auto-import without additional clicking
// ============================================================

// ── Receiving game state from content.js ─────────────────────
window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'BF_GAME_STATE') return;
  const s = event.data.state;

  updateGameBar(s);

  // s.ally  = { units: [{id,name,owned,selected,power}], powerLimit, source }
  // s.enemy = { enemies: [{name,qty,tier,pos}], source, powerLimit }
  if (s.ally?.units?.length)       handleAllyData(s.ally);
  if (s.enemy?.enemies?.length)    handleEnemyData(s.enemy);
});

// ── Enemy name map → tier ID ────────────────────────
const EMAP = {
  'kostlivec':          'E1',
  'zombie':             'E2',
  // Enemy names removed — tier detected by DOM position (language-independent)
  'nemrtvy kultista':   'E3',

  'kostlive kridlo':    'E4',

  'nafuknuta mrtvola':  'E5',

  'prizrak':            'E6',
};

// ── Game info bar ───────────────────────────────────────────
function updateGameBar(s) {
  let bar = document.getElementById('bf-game-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bf-game-bar';
    bar.style.cssText = 'background:rgba(0,0,0,0.5);border-bottom:1px solid #1a0d12;' +
      'padding:4px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;' +
      'font-size:0.65rem;font-family:Cinzel,serif;color:#5a3a2a;flex-shrink:0;';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  const sep = '<span style="color:#2a0d12;margin:0 1px">│</span>';
  const parts = ['<span style="opacity:0.5">📡 Live Data:</span>'];
  if (s.apCurrent != null)
    parts.push(`<span style="color:${s.apCurrent >= s.apMax ? '#2ecc71' : '#f0d080'}">⚡ AP: ${s.apCurrent}/${s.apMax}</span>`);
  if (s.bloodEssence != null)
    parts.push(`<span style="color:#e74c3c">🩸 BE: ${s.bloodEssence}</span>`);
  if (s.ally?.powerLimit)
    parts.push(`<span style="color:#9b59b6">⚔ Limit: ${s.ally.powerLimit}</span>`);
  if (s.orbs?.ready > 0)
    parts.push(`<span style="color:#c0392b">🔴 Orbs: ${s.orbs.ready}/${s.orbs.total}</span>`);
  else if (s.orbs?.timers?.length)
    parts.push(`<span style="color:#333">⏱ ${[...s.orbs.timers].sort((a,b)=>a.remaining-b.remaining)[0].text}</span>`);
  if (s.serverId)
    parts.push(`<span style="opacity:0.25;font-size:0.55rem">${s.serverId}</span>`);
  bar.innerHTML = parts.join(sep);
}

// ── Processing ally army ───────────────────────────
function handleAllyData(ally) {
  // Save for later import
  window._bf_ally = ally;

  const owned = ally.units.filter(u => (parseInt(u.owned) || 0) > 0);
  if (!owned.length) return;

  // Show/update import bar
  let notice = document.getElementById('bf-ally-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'bf-ally-notice';
    notice.style.cssText = noticeCss('#3a1050', '#6c3483');
    const bar = document.getElementById('bf-game-bar');
    if (bar) bar.after(notice);
    else document.body.insertBefore(notice, document.body.firstChild);
  }

  const unitStr = owned.map(u =>
    `${u.name}: <b style="color:#f0d080">${u.owned}ks</b>`
  ).join(' │ ');

  notice.innerHTML = `
    <span>🐺 <b>In-game Army:</b> ${unitStr}</span>
  `;

  // Button — no inline onclick
  const btn = document.createElement('button');
  btn.textContent = '⬇ Import';
  btn.style.cssText = 'margin-left:auto;background:#4a2060;border:1px solid #8e44ad;' +
    'color:#f0d080;padding:3px 10px;border-radius:3px;cursor:pointer;' +
    "font-family:'Cinzel',serif;font-size:0.63rem;white-space:nowrap;flex-shrink:0;";
  btn.addEventListener('click', doAllyImport);
  notice.appendChild(btn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#444;cursor:pointer;font-size:0.9rem;padding:0 4px;flex-shrink:0;';
  closeBtn.addEventListener('click', () => notice.remove());
  notice.appendChild(closeBtn);
}

function doAllyImport() {
  const ally = window._bf_ally;
  if (!ally || typeof allyQuantities === 'undefined') return;

  const idMap = { '1':'T1', '2':'T2', '3':'T3', '4':'T4', '5':'T5', '6':'T6', '7':'T7', '8':'T8' };
  ally.units.forEach(u => {
    const tid = idMap[String(u.id)];
    if (tid) allyQuantities[tid] = parseInt(u.owned) || 0;
  });

  // Set power limit if available
  if (ally.powerLimit) {
    const plInput = document.getElementById('power-limit-input-el');
    if (plInput) {
      plInput.value = ally.powerLimit;
      if (typeof updatePowerLimit === 'function') updatePowerLimit();
    }
  }

  if (typeof renderBuilder === 'function') renderBuilder();

  const notice = document.getElementById('bf-ally-notice');
  if (notice) {
    notice.innerHTML = '✅ <b>Allies imported!</b>';
    notice.style.color = '#2ecc71';
    setTimeout(() => notice?.remove(), 2500);
  }
}

// ── Processing enemy army ─────────────────────────
function handleEnemyData(enemy) {
  window._bf_enemy = enemy;

  const valid = enemy.enemies.filter(e => e.qty > 0 && (e.tier || EMAP[e.name?.toLowerCase()?.trim()]));
  if (!valid.length) return;

  let notice = document.getElementById('bf-enemy-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'bf-enemy-notice';
    notice.style.cssText = noticeCss('#2a0808', '#8b0000');

    // Insert after ally notice or game bar
    const after = document.getElementById('bf-ally-notice') || document.getElementById('bf-game-bar');
    if (after) after.after(notice);
    else document.body.insertBefore(notice, document.body.firstChild);
  }

  const enemyStr = valid.map(e => {
    const tier = e.tier || EMAP[e.name?.toLowerCase()?.trim()] || e.name;
    return `${e.name} (${tier}): <b style="color:#e74c3c">${e.qty}ks</b>${e.pos ? ' <span style="opacity:0.6;font-size:0.6rem">'+e.pos+'</span>' : ''}`;
  }).join(' │ ');

  const limitStr = enemy.powerLimit ? ` — Difficulty: <b style="color:#c9a84c">${enemy.powerLimit}</b>` : '';

  notice.innerHTML = `<span>💀 <b>Nepriatelia:</b> ${enemyStr}${limitStr}</span>`;

  const btn = document.createElement('button');
  btn.textContent = '⬇ Import';
  btn.style.cssText = 'margin-left:auto;background:#5a0000;border:1px solid #8b0000;' +
    'color:#f0d080;padding:3px 10px;border-radius:3px;cursor:pointer;' +
    "font-family:'Cinzel',serif;font-size:0.63rem;white-space:nowrap;flex-shrink:0;";
  btn.addEventListener('click', doEnemyImport);
  notice.appendChild(btn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#444;cursor:pointer;font-size:0.9rem;padding:0 4px;flex-shrink:0;';
  closeBtn.addEventListener('click', () => notice.remove());
  notice.appendChild(closeBtn);
}

function doEnemyImport() {
  const enemy = window._bf_enemy;
  if (!enemy || typeof enemyQuantities === 'undefined') return;

  // Reset
  Object.keys(enemyQuantities).forEach(k => { enemyQuantities[k] = 0; });

  enemy.enemies.forEach(e => {
    const tier = e.tier || EMAP[(e.name||'').toLowerCase().trim()];
    if (tier && enemyQuantities.hasOwnProperty(tier)) {
      enemyQuantities[tier] = e.qty;
    }
  });

  if (enemy.powerLimit) {
    const plInput = document.getElementById('power-limit-input-el');
    if (plInput) {
      plInput.value = enemy.powerLimit;
      if (typeof updatePowerLimit === 'function') updatePowerLimit();
    }
  }

  if (typeof renderBuilder === 'function') renderBuilder();

  const notice = document.getElementById('bf-enemy-notice');
  if (notice) {
    notice.innerHTML = '✅ <b>Enemies imported!</b>';
    notice.style.color = '#2ecc71';
    setTimeout(() => notice?.remove(), 2500);
  }
}

// ── CSS helper ─────────────────────────────────────────────
function noticeCss(bg, border) {
  return `background:${bg};border:1px solid ${border};border-radius:4px;` +
    'margin:3px 10px;padding:5px 10px;font-size:0.68rem;color:#9b9b9b;' +
    'display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;';
}

// ── BF_PANEL_READY handshake ────────────────────────────────
window.addEventListener('load', () => {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'BF_PANEL_READY' }, '*');
  }
});
