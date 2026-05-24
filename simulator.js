// ===================== Bitefight Battle Simulator v1.5.7 =====================
// Copyright (C) 2026 Aescunor — GNU General Public License v3.0
// v1.5.7: Save winning history → Ruins preset
//   - New 📥 Save as Ruins preset button on every VICTORY history card.
//   - Click prompts for level (1–30, last used pre-filled), then sends
//     formation + enemy + level to bot.js via window.parent.postMessage.
//   - Bot.js validates, writes to the per-character preset store, and
//     posts a BF_ADD_PRESET_ACK back. Button flashes green "✓ Saved L7"
//     on success, amber "⚠ No ack" on timeout, red on validation failure.
//   - Defeat / draw cards do NOT get this button — those formations are
//     bad candidates for the preset library.
// v1.5.6: Battle log export
//   - New 📋 Copy / 💾 Download buttons in the battle log title bar.
//   - Exports include a metadata header (version, timestamp, power
//     limit, ally + enemy formation, outcome) plus the full
//     plain-text log with all engine events.
//   - HTML markup is stripped via DOMParser textContent for safe
//     paste into bug reports / GitHub issues / Discord.
//   - Filename includes ISO-style timestamp:
//       bf-battle-log-2026-05-15_14-32-08.txt
//   - Copy gives clipboard.writeText with a flash-green
//     confirmation on the button; falls back to a textarea +
//     execCommand approach in browsers without async clipboard.
// v1.5.5: Battle replay speed slider
//   - New 0.5× / 1× / 2× / 4× selector for the ⏩ Auto button.
//     1× preserves the v1.4.0 cadence (900ms / round). Faster speeds
//     are useful for long battles; 0.5× is occasionally useful for
//     debugging engine behaviour visually.
//   - Selection persists across iframe reloads via localStorage.
//   - Changing speed while Auto is running restarts the interval
//     immediately with the new delay — no need to stop+restart manually.
// v1.5.4: Pin v history
//   - Each history card now has a 📌 Pin button. Toggle to mark an
//     entry as a baseline you don't want auto-evicted.
//   - LS_HISTORY_MAX (3) now applies only to non-pinned entries. Pinned
//     entries are exempt from FIFO eviction. Safety ceiling at 20 total.
//   - Pinned cards always sort to the top of the list (within each group,
//     newest first), with a distinct gold border + "📌 PINNED" ribbon.
//   - Reapply / Compare continue to work identically on pinned entries.
// v1.5.3: Compare 2 history entries
//   - Each history card now has a checkbox in its top-left corner.
//     Selecting 2 cards reveals a sticky "↔ Compare" button at the
//     bottom of the history panel.
//   - Compare opens a modal overlay with side-by-side per-tier
//     breakdown for both sides (ally + enemy) plus a delta column
//     highlighting what changed: tier qty deltas, survival deltas,
//     outcome change (VICTORY ↔ DEFEAT), rounds delta, and the most
//     useful single number — Δ Blood Essence.
//   - Selection is limited to 2 — clicking a 3rd checkbox no-ops
//     until one of the existing two is deselected.
//   - Selection state lives only in memory; resets when the panel
//     reloads (no point persisting — history itself may have rotated).
// v1.5.2: Optimizer Cancel button
//   - New ⏹ Cancel button next to ⚙ Run Optimizer. Hidden by default,
//     shown only while an optimizer run is in flight, hidden again on
//     completion or cancellation.
//   - Works across all three optimizer paths:
//       • Parallel workers — terminate() all spawned workers and
//         force-resolve their pending promises so Promise.all does not
//         hang. Also fixes a latent v1.4.0 bug in fast-scan early-stop
//         that had the same hanging behaviour.
//       • Single-thread Deep Sim — _optCtl.cancelled flag checked at
//         every yield (every ~50ms).
//       • Single-thread Fast Scan — same cancellation flag checked at
//         both the candidate-generation and simulation yield points.
//   - When cancelled, the progress label shows "⏹ Cancelled at N
//     candidates" and results are NOT rendered (the table would be
//     misleading without a complete search).
// v1.5.1: Recent simulations detail view
//   - History entries now store per-tier survival data for BOTH sides
//     (allyLosses + enemyLosses), pulled from engineResult.lossesPerTier
//     and engineResult.finalState respectively.
//   - Card layout rewritten: separate ⚔ ALLIES and 💀 ENEMIES blocks,
//     each with per-tier rows showing survived/qty with color-coded
//     markers (✓ all alive / partial loss / ☠ wiped / ✗ enemies survived).
//   - LS key bumped to bf_sim_history_v2 since the data shape changed;
//     old v1 entries are silently discarded.
// v1.5.0: UX optimizations
//   - Optimizer modal no longer pre-computes massive combination counts on
//     open. A "🔢 Calculate combinations" button replaces the instant count;
//     once clicked, edits to per-tier max inputs auto-refresh the estimate.
//   - Unlocked-tier state (ally & enemy) is persisted in localStorage so the
//     next simulator open restores the user's last unlock selection.
//   - Quick-import "⬇ Live" button next to Power Limit input pulls the
//     current armyPower limit from the live game state (cached by bridge.js
//     on every BF_GAME_STATE message), without re-importing the full army.
//   - Last 3 manual simulations are saved to localStorage and rendered as
//     compact "Recent simulations" cards under the controls bar. Each card
//     has a ↻ Reapply button to restore that exact formation.
// v1.2.1: Bugfix for Smart Preset 'auto' mode
//   - 'auto' on T4 with Kill E3 R1 now sets LOWER BOUND only (was: fixed = exact)
//   - Optimum may exceed the minimum needed to kill E3 — additional T4 add
//     damage against other rear targets and provide HP buffer
//   - Explicit zero (T#: 0) in preset now means "skip this tier" (0..0)
//   - UI preview shows "T# ≥ N (auto min)" instead of "T# = N (auto)"
// v1.2.0: Smart Level Presets (warm-start optimization)
//   - js/level_presets.js: per-layer formation hints with confidence indicator
//   - 🎯 SMART PRESET section in optimizer: narrows search to ±N range
//   - Preset Manager modal: add/edit/delete/import/export presets
//   - Deterministic T4 calculation when Kill E3 R1 is active
//   - Bot uses warm-start fallback when no exact-match preset exists
//   - Search space reduction: typically 100-1000× fewer combinations
// v1.1.0: Performance optimization — parallel WebWorker optimizer
//   - js/optimizer_worker.js: dedicated worker for optimizer slices
//   - Splits T1 range across N workers (N = min(8, hw concurrency))
//   - Both Deep Simulation and Fast Scan run in parallel
//   - Automatic fallback to single-thread if Worker fails
//   - UI stays responsive during optimization
// v1.0.0: Full tier set + shared simulation engine
//   - T6 (gargoyles), T7 (witches), T8 (rotmaws) added with abilities
//   - E8 (bone giants), E9 (broodmothers), E10 (liches) added with abilities
//   - Spiderlings (E9 spawn) as sub-unit
//   - All math now delegated to BFEngine (js/sim_engine.js)
//     → Single source of truth: optimizer, live UI, and bot pre-validation
//       all use the same battle logic, validated against Python v6.
// ============================================================================

// ===================== TRANSLATIONS =====================
const STRINGS = {
  en: {
    battleBegins: '⚔ BATTLE BEGINS ⚔',
    roundHeader: '── Round {0} ──',
    addUnitsBothSides: 'Add units to both sides!',
    buildArmiesStart: 'Build your armies and start the battle...',
    victory: 'VICTORY',
    defeat: 'DEFEAT',
    draw: 'DRAW',
    bothFell: 'Both sides fell in glory!',
    enemiesDefeated: 'Enemies were defeated in round {0}!',
    armyDestroyed: 'Your army was destroyed in round {0}...',
    // Attack lines
    attackLine: '{0} attacks {1}: <span class="dmg">−{2} HP</span> (remaining: {3}/{4})',
    defeated: '💀 {0} is defeated!',
    // Type
    typeAdv: 'Type advantage (×{0}): {1} → {2}',
    typeDisadv: 'Type disadvantage (×{0}): {1} → {2}',
    // Ally tier skills
    batsFirstRound: 'Tier 1: First round +25% damage',
    ghoulsReduce: 'Tier 2: −50% damage taken (override)',
    thrallsVsSlow: 'Tier 3: +33% vs slow units',
    t4Debuff: 'Tier 4 banshees: {0} attacks at −25% this round',
    necroBuff: 'Tier 5 necromancers: damage ×{0}',
    necroStack: 'Tier 5 necromancers: +10% per dead group (now ×{0}, {1} new deaths)',
    gargoylesDebuff: 'Tier 6 gargoyles: reduce attacker speed by −2 (now {0})',
    witchesSplash: 'Tier 7 witches: 25% splash → {0} on enemy rear',
    rotmawsIgnoreType: 'Tier 8 rotmaws: ignores typing',
    rotmawsOverkill: 'Tier 8 rotmaws: overkill {0} dmg transfers to {1}',
    // Enemy tier skills
    e2Revives: 'Tier e2: Group revives! {0} units with 1 HP',
    cultistBuff: 'Tier e3 cultists: buff {0} (now ×{1})',
    e4FirstStrike: 'Tier e4 bonewings: +20% damage (first attacker of round)',
    e5Thorns: 'Tier e5 corpses: thorns deal {0} dmg to {1}',
    e5KillThorns: '💀 {0} is defeated by thorn damage!',
    wraithsIgnoreType: 'Tier e6 wraiths: ignores unit typing',
    wraithsStack: 'Tier e6 wraiths: damage multiplier ×{0}',
    revenantsAura: 'Tier e7 revenants aura: ally rearguard −15% damage',
    giantTackle: 'Tier e8 bone giants: +5% from tackle (now ×{0})',
    giantStack: 'Tier e8 bone giants: damage ×{0}',
    giantReset: 'Tier e8 bone giants: damage reset to 100% on attack',
    spawn: 'Tier e9 broodmothers: spawn {0} spiderlings',
    lichSplash: 'Tier e10 liches: splash {0} dmg to slowest ally rear',
    debuffedAttacker: '{0} is debuffed: −25% damage',
    // UI labels
    orderLabel: 'ORDER:',
    allyLosses: '⚔ ALLY LOSSES',
    totalLabel: 'TOTAL',
    totalLossesLabel: 'TOTAL LOSSES',
    bloodEssence: 'Blood Essence',
    survived: '{0}/{1} survived',
    turnLost: '−{0} ☠',
  }
};
let SIM_LANG = 'en';
function T(key) {
  const tpl = (STRINGS[SIM_LANG] && STRINGS[SIM_LANG][key]) || (STRINGS.en && STRINGS.en[key]) || key;
  if (arguments.length <= 1) return tpl;
  let out = tpl;
  for (let i = 1; i < arguments.length; i++) {
    out = out.replace('{' + (i - 1) + '}', arguments[i]);
  }
  return out;
}

// ===================== PERSISTENCE (localStorage in iframe origin) =====================
// The simulator iframe runs at the chrome-extension:// origin so localStorage
// is scoped to the extension and shared across game tabs/servers. Storing
// UI state (unlocked tiers, recent simulations) here is enough — these are
// not per-character so we do not need to route through the bot's chrome.storage.
const LS_KEY_UNLOCK_ALLY  = 'bf_sim_unlocked_ally_v1';
const LS_KEY_UNLOCK_ENEMY = 'bf_sim_unlocked_enemy_v1';
const LS_KEY_HISTORY      = 'bf_sim_history_v2';
// FIFO cap for *non-pinned* entries only. Pinned entries are exempt and
// never auto-evict — the user explicitly chose to keep them as a baseline.
const LS_HISTORY_MAX      = 3;
// Hard ceiling on total entries (pinned + unpinned) to prevent unbounded
// growth if a user pins many entries over time. Adding entries beyond this
// cap evicts the oldest *pinned* entry as a last resort, but in practice
// nobody will ever hit this — 20 baselines is more than enough.
const LS_HISTORY_TOTAL_CAP = 20;
// Auto-play speed multiplier (0.5 / 1 / 2 / 4). Persisted across reloads
// so the user's preference sticks. 1× = 900ms / round (v1.4.0 baseline).
const LS_KEY_AUTO_SPEED   = 'bf_sim_auto_speed_v1';
const AUTO_BASE_DELAY_MS  = 900;
const AUTO_SPEED_OPTIONS  = [0.5, 1, 2, 4];

function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

// ===================== DATA (delegated to BFEngine) =====================
let ARMY_POWER_LIMIT = 20;
function updatePowerLimit() {
  const val = parseInt(document.getElementById('power-limit-input-el').value) || 20;
  ARMY_POWER_LIMIT = Math.max(1, val);
  renderBuilder();
}

// Tier definitions come from the shared engine. simulator.js cannot exist
// without sim_engine.js being loaded first (manifest order).
if (typeof window === 'undefined' || !window.BFEngine) {
  console.error('[bitefight] sim_engine.js must be loaded before simulator.js');
}
const ALLY_TIERS  = (window.BFEngine && window.BFEngine.ALLY_TIERS)  || [];
const ENEMY_TIERS = (window.BFEngine && window.BFEngine.ENEMY_TIERS) || [];

// ===================== STATE =====================
let allyQuantities = {};
let enemyQuantities = {};
// By default all tiers unlocked; user can toggle. Last selection is persisted
// to localStorage (LS_KEY_UNLOCK_*) and restored here on every simulator open.
let unlockedAllyTiers, unlockedEnemyTiers;
(function loadUnlockedFromStorage() {
  const savedAlly  = lsGet(LS_KEY_UNLOCK_ALLY);
  const savedEnemy = lsGet(LS_KEY_UNLOCK_ENEMY);
  const allyIds  = new Set(ALLY_TIERS.map(t => t.id));
  const enemyIds = new Set(ENEMY_TIERS.map(t => t.id));
  // Accept saved value only if it is a non-empty array of known ids. Empty
  // array would lock the user out entirely, so we fall back to defaults.
  unlockedAllyTiers = (Array.isArray(savedAlly) && savedAlly.length > 0 && savedAlly.every(id => allyIds.has(id)))
    ? new Set(savedAlly)
    : new Set(ALLY_TIERS.map(t => t.id));
  unlockedEnemyTiers = (Array.isArray(savedEnemy) && savedEnemy.length > 0 && savedEnemy.every(id => enemyIds.has(id)))
    ? new Set(savedEnemy)
    : new Set(ENEMY_TIERS.map(t => t.id));
})();
let battleState = null;
let autoTimer = null;
let isRunning = false;
// Auto-play speed multiplier. Loaded from LS at startup (defaults to 1×);
// changed via the ⏩ AUTO SPEED button row; persisted on every change.
let autoSpeed = (function () {
  const saved = lsGet(LS_KEY_AUTO_SPEED);
  // Accept only known values; anything else falls back to 1×.
  return (AUTO_SPEED_OPTIONS.indexOf(saved) >= 0) ? saved : 1;
})();
function currentAutoDelay() {
  // Lower bound at 50ms — even with future user-configurable speeds this
  // keeps the UI responsive (faster than the engine can render anyway).
  return Math.max(50, Math.round(AUTO_BASE_DELAY_MS / autoSpeed));
}

ALLY_TIERS.forEach(t => allyQuantities[t.id] = 0);
ENEMY_TIERS.forEach(t => enemyQuantities[t.id] = 0);

function toggleUnlock(side, id) {
  const set = side === 'ally' ? unlockedAllyTiers : unlockedEnemyTiers;
  const qtys = side === 'ally' ? allyQuantities : enemyQuantities;
  if (set.has(id)) {
    set.delete(id);
    qtys[id] = 0; // reset qty when locked
  } else {
    set.add(id);
  }
  // Persist to localStorage so the next open restores this selection.
  lsSet(side === 'ally' ? LS_KEY_UNLOCK_ALLY : LS_KEY_UNLOCK_ENEMY, [...set]);
  renderBuilder();
}

function renderUnlockBars() {
  // Ally
  const allyBar = document.getElementById('ally-unlock-bar');
  allyBar.innerHTML = '<span style="font-family:Cinzel,serif;font-size:0.62rem;color:var(--text-dim);letter-spacing:.1em;margin-right:2px">UNLOCKED:</span>';
  ALLY_TIERS.forEach(tier => {
    const unlocked = unlockedAllyTiers.has(tier.id);
    const btn = document.createElement('button');
    btn.textContent = tier.label;
    btn.title = unlocked ? 'Klikni na zamknutie' : 'Klikni na odomknutie';
    btn.style.cssText = `
      font-family:Cinzel,serif;font-size:0.65rem;padding:2px 9px;border-radius:10px;cursor:pointer;
      transition:all 0.15s;border:1px solid;
      background:${unlocked ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)'};
      color:${unlocked ? 'var(--gold-light)' : 'var(--text-dim)'};
      border-color:${unlocked ? 'var(--gold)' : '#2a1218'};
    `;
    btn.onclick = () => toggleUnlock('ally', tier.id);
    allyBar.appendChild(btn);
  });

  // Enemy
  const enemyBar = document.getElementById('enemy-unlock-bar');
  enemyBar.innerHTML = '<span style="font-family:Cinzel,serif;font-size:0.62rem;color:var(--text-dim);letter-spacing:.1em;margin-right:2px">UNLOCKED:</span>';
  ENEMY_TIERS.forEach(tier => {
    const unlocked = unlockedEnemyTiers.has(tier.id);
    const btn = document.createElement('button');
    btn.textContent = tier.label;
    btn.title = unlocked ? 'Klikni na zamknutie' : 'Klikni na odomknutie';
    btn.style.cssText = `
      font-family:Cinzel,serif;font-size:0.65rem;padding:2px 9px;border-radius:10px;cursor:pointer;
      transition:all 0.15s;border:1px solid;
      background:${unlocked ? 'rgba(192,57,43,0.15)' : 'rgba(255,255,255,0.03)'};
      color:${unlocked ? '#e74c3c' : 'var(--text-dim)'};
      border-color:${unlocked ? 'var(--crimson)' : '#2a1218'};
    `;
    btn.onclick = () => toggleUnlock('enemy', tier.id);
    enemyBar.appendChild(btn);
  });
}

// ===================== RENDER BUILDER =====================
function renderBuilder() {
  renderUnlockBars();
  renderAllyTiers();
  renderEnemyTiers();
  updatePower();
}

function renderAllyTiers() {
  const container = document.getElementById('ally-tiers');
  container.innerHTML = '';
  ALLY_TIERS.filter(tier => unlockedAllyTiers.has(tier.id)).forEach(tier => {
    const qty = allyQuantities[tier.id];
    const div = document.createElement('div');
    div.className = 'tier-card' + (qty > 0 ? ' selected' : '');
    div.innerHTML = `
      <span class="tier-label">${tier.label}</span>
      <div class="tier-info-row">
        <span class="stat-badge">⚔<span class="val">${tier.dmg}</span></span>
        <span class="stat-badge">❤<span class="val">${tier.hp}</span></span>
        <span class="stat-badge">💨<span class="val">${tier.spd}</span></span>
        <span class="stat-badge">⚡<span class="val">${tier.power}</span></span>
        <span class="stat-badge" style="color:#c9a84c">🩸<span class="val" style="color:#f0d080">${tier.cost}</span></span>
        <span class="type-badge type-${tier.type}">${tier.type}</span>
        <span class="pos-badge pos-${tier.pos}">${tier.pos === 'Vanguard' ? 'Vanguard' : 'Rearguard'}</span>
        <span class="skill-icon">?<span class="tooltip">${tier.skill}</span></span>
      </div>
      <div class="qty-control">
        <button class="qty-btn" data-side="ally" data-tier="${tier.id}" data-delta="-10" style="font-size:0.6rem;padding:0 4px">−10</button>
        <button class="qty-btn" data-side="ally" data-tier="${tier.id}" data-delta="-1">−</button>
        <input type="number" class="qty-input" min="0" value="${qty}"
          data-side="ally" data-tier="${tier.id}">
        <button class="qty-btn" data-side="ally" data-tier="${tier.id}" data-delta="1">+</button>
        <button class="qty-btn" data-side="ally" data-tier="${tier.id}" data-delta="10" style="font-size:0.6rem;padding:0 4px">+10</button>
      </div>
      <div class="skill-tip">${tier.skill}</div>
    `;
    container.appendChild(div);
  });
}

function renderEnemyTiers() {
  const container = document.getElementById('enemy-tiers');
  container.innerHTML = '';
  ENEMY_TIERS.filter(tier => unlockedEnemyTiers.has(tier.id)).forEach(tier => {
    const qty = enemyQuantities[tier.id];
    const div = document.createElement('div');
    div.className = 'tier-card' + (qty > 0 ? ' enemy-selected' : '');
    div.innerHTML = `
      <span class="tier-label">${tier.label}</span>
      <div class="tier-info-row">
        <span class="stat-badge">⚔<span class="val">${tier.dmg}</span></span>
        <span class="stat-badge">❤<span class="val">${tier.hp}</span></span>
        <span class="stat-badge">💨<span class="val">${tier.spd}</span></span>
        <span class="type-badge type-${tier.type.trim()}">${tier.type.trim()}</span>
        <span class="pos-badge pos-${tier.pos}">${tier.pos === 'Vanguard' ? 'Vanguard' : 'Rearguard'}</span>
        <span class="skill-icon">?<span class="tooltip">${tier.skill}</span></span>
      </div>
      <div class="qty-control">
        <button class="qty-btn" data-side="enemy" data-tier="${tier.id}" data-delta="-10" style="font-size:0.6rem;padding:0 4px">−10</button>
        <button class="qty-btn" data-side="enemy" data-tier="${tier.id}" data-delta="-1">−</button>
        <input type="number" class="qty-input" min="0" value="${qty}"
          data-side="enemy" data-tier="${tier.id}">
        <button class="qty-btn" data-side="enemy" data-tier="${tier.id}" data-delta="1">+</button>
        <button class="qty-btn" data-side="enemy" data-tier="${tier.id}" data-delta="10" style="font-size:0.6rem;padding:0 4px">+10</button>
      </div>
      <div class="skill-tip">${tier.skill}</div>
    `;
    container.appendChild(div);
  });
}

// Input typing — only save value, NO re-render (keeps focus)
function qtyInputChange(side, id, input) {
  const val = Math.max(0, parseInt(input.value) || 0);
  if (side === 'ally') {
    const tier = ALLY_TIERS.find(t => t.id === id);
    const powerWithout = getAllyPower() - (allyQuantities[id] || 0) * tier.power;
    const maxAllowed = Math.floor((ARMY_POWER_LIMIT - powerWithout) / tier.power) + (allyQuantities[id] || 0);
    allyQuantities[id] = Math.min(val, Math.max(0, maxAllowed));
  } else {
    enemyQuantities[id] = val;
  }
  updatePower(); // update power bar without re-rendering tier cards
}

// On blur — sync input display value and re-render
function qtyInputBlur(side, id, input) {
  const stored = side === 'ally' ? (allyQuantities[id] || 0) : (enemyQuantities[id] || 0);
  input.value = stored; // correct display if clamped
  renderBuilder();
}

function changeQty(side, id, delta) {
  if (side === 'ally') {
    const tier = ALLY_TIERS.find(t => t.id === id);
    const currentPower = getAllyPower() - (allyQuantities[id] || 0) * tier.power;
    const maxAllowed = Math.floor((ARMY_POWER_LIMIT - currentPower) / tier.power);
    const newVal = Math.max(0, Math.min((allyQuantities[id] || 0) + delta, maxAllowed));
    allyQuantities[id] = newVal;
  } else {
    enemyQuantities[id] = Math.max(0, (enemyQuantities[id] || 0) + delta);
  }
  renderBuilder();
}

function getAllyPower() {
  return ALLY_TIERS.reduce((sum, t) => sum + (allyQuantities[t.id] || 0) * t.power, 0);
}

function updatePower() {
  const p = getAllyPower();
  const pct = Math.min(100, (p / ARMY_POWER_LIMIT) * 100);
  document.getElementById('ally-power-fill').style.width = pct + '%';
  document.getElementById('ally-power-text').textContent = `${p} / ${ARMY_POWER_LIMIT}`;
}

// ===================== BATTLE ENGINE =====================
function buildGroups(side, tierDefs, quantities) {
  const groups = [];
  tierDefs.forEach(tier => {
    const qty = (quantities[tier.id] || 0);
    if (qty === 0) return;
    groups.push({
      id: tier.id,
      label: tier.label,
      tier: tier,
      qty: qty,
      maxHp: tier.hp * qty,
      currentHp: tier.hp * qty,
      aliveUnits: qty,
      alive: true,
      side: side,
      revived: false,
      revivedThisRound: false,
      revivedByAttackerId: null,
      damageBuff: 1.0,
      debuffed: false,
      debuffRounds: 0,
      attackedThisRound: false,
    });
  });
  return groups;
}

function startBattle() {
  stopAuto();
  const allyGroups = buildGroups('ally', ALLY_TIERS, allyQuantities);
  const enemyGroups = buildGroups('enemy', ENEMY_TIERS, enemyQuantities);

  if (allyGroups.length === 0 || enemyGroups.length === 0) {
    addLog('<span style="color:var(--crimson)">' + T('addUnitsBothSides') + '</span>');
    return;
  }

  // Run the full simulation up-front via the shared engine.
  // The UI then "replays" the resulting event log round-by-round for animation.
  // earlyTermination is disabled here so the user sees the full battle even
  // when it's a slow loss or stalemate — the optimizer path uses default ON.
  const engineResult = window.BFEngine.simulate(allyQuantities, enemyQuantities, {
    randomTarget: true,  // live UI uses random E3 target (matches Python v6)
    collectLog: true,
    maxRounds: 50,
    earlyTermination: false,
  });

  if (!engineResult) {
    addLog('<span style="color:var(--crimson)">Engine error</span>');
    return;
  }

  // Save snapshot of this MANUAL simulation to history (last 3 are kept).
  // Optimizer-driven batch simulations go through BFEngine directly and never
  // reach startBattle(), so they correctly don't pollute the history.
  pushHistory(allyQuantities, enemyQuantities, ARMY_POWER_LIMIT, engineResult);

  // Group events by round for replay
  const roundEvents = [];
  let currentRound = -1;
  for (const ev of engineResult.log) {
    if (ev.type === 'roundStart') {
      currentRound = ev.round;
      roundEvents[currentRound] = { order: ev.order, events: [] };
    } else if (currentRound >= 0 && ev.type !== 'battleStart' && ev.type !== 'battleEnd') {
      roundEvents[currentRound].events.push(ev);
    }
  }

  battleState = {
    allies: allyGroups,
    enemies: enemyGroups,
    groupsById: {},
    round: 0,
    done: false,
    roundEvents: roundEvents,
    finalResult: engineResult,
  };
  // Build id lookup. Note: spiderlings (E9S) may appear later via spawn event.
  [...allyGroups, ...enemyGroups].forEach(g => { battleState.groupsById[g.id] = g; });

  clearLog();
  addLog(`<span class="log-round">${T('battleBegins')}</span>`);
  renderBattlefield();
  isRunning = true;
}

function stepBattle() {
  if (!battleState || battleState.done) { startBattle(); return; }
  if (!isRunning) isRunning = true;
  executeRound();
}

function autoPlay() {
  if (!battleState || battleState.done) { startBattle(); }
  stopAuto();
  autoTimer = setInterval(() => {
    if (!battleState || battleState.done) { stopAuto(); return; }
    executeRound();
  }, currentAutoDelay());
}

function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
}

// ============================================================================
// AUTO-PLAY SPEED CONTROL
// ============================================================================
// setAutoSpeed updates the multiplier, persists it, re-renders the button
// row, and — if Auto is currently running — restarts the interval at the
// new cadence so the user sees the change immediately. Called from the
// click delegate when a speed button is pressed.
function setAutoSpeed(mult) {
  if (AUTO_SPEED_OPTIONS.indexOf(mult) < 0) return; // ignore garbage
  autoSpeed = mult;
  lsSet(LS_KEY_AUTO_SPEED, mult);
  renderSpeedButtons();
  // If Auto is running, restart with the new delay. We don't simply mutate
  // the existing setInterval cadence (setInterval has no runtime adjust API)
  // so a fresh interval is the cleanest way to apply the change without
  // dropping or duplicating a round.
  if (autoTimer) {
    stopAuto();
    autoTimer = setInterval(() => {
      if (!battleState || battleState.done) { stopAuto(); return; }
      executeRound();
    }, currentAutoDelay());
  }
}

function renderSpeedButtons() {
  const host = document.getElementById('speed-buttons');
  if (!host) return;
  host.innerHTML = AUTO_SPEED_OPTIONS.map(mult => {
    const active = (mult === autoSpeed);
    return ''
      + '<button class="auto-speed-btn" data-speed="' + mult + '" '
      +   'title="' + Math.round(AUTO_BASE_DELAY_MS / mult) + ' ms per round" '
      +   'style="font-family:Cinzel,serif;font-size:0.62rem;'
      +     'padding:2px 9px;border-radius:10px;cursor:pointer;'
      +     'background:' + (active ? 'rgba(155,89,182,0.25)' : 'rgba(255,255,255,0.03)') + ';'
      +     'border:1px solid ' + (active ? '#9b59b6' : 'var(--border)') + ';'
      +     'color:' + (active ? '#9b59b6' : 'var(--text-dim)') + ';'
      +     'font-weight:' + (active ? 'bold' : 'normal') + '">'
      +   mult + '×</button>';
  }).join('');
}

function resetBattle() {
  stopAuto();
  document.getElementById('result-banner').className = '';
  battleState = null;
  isRunning = false;
  clearLog();
  addLog('<span style="color:var(--text-dim);font-style:italic">' + T('buildArmiesStart') + '</span>');
  renderBattlefield();
  document.getElementById('turn-order-bar').style.display = 'none';
}

// ===================== EVENT REPLAY (live UI battle from engine log) =====================

// Lookup display group by id; create lazily if engine emitted a group we don't have yet
// (e.g. spiderlings spawned during battle).
function ensureGroup(id) {
  const bs = battleState;
  if (bs.groupsById[id]) return bs.groupsById[id];
  const tier = window.BFEngine.tierById(id);
  if (!tier) return null;
  const g = {
    id: tier.id, label: tier.label, tier: tier, qty: 0,
    maxHp: 0, currentHp: 0, aliveUnits: 0, alive: false, side: 'enemy',
    revived: false, revivedThisRound: false, damageBuff: 1.0,
    debuffed: false, debuffRounds: 0, attackedThisRound: false,
  };
  bs.groupsById[id] = g;
  if (id === 'E9S') bs.enemies.push(g);  // spiderlings live with enemies
  return g;
}

function applyEvent(ev) {
  const bs = battleState;
  const g = ev.groupId ? bs.groupsById[ev.groupId] : null;
  const src = ev.sourceId ? (bs.groupsById[ev.sourceId] || ensureGroup(ev.sourceId)) : null;
  const tgt = ev.targetId ? (bs.groupsById[ev.targetId] || ensureGroup(ev.targetId)) : null;
  const atk = ev.attackerId ? (bs.groupsById[ev.attackerId] || ensureGroup(ev.attackerId)) : null;

  switch (ev.type) {
    case 'attack': {
      if (atk) atk.attackedThisRound = true;
      if (tgt) {
        tgt.currentHp = ev.targetHp;
        tgt.aliveUnits = Math.max(0, Math.ceil(tgt.currentHp / tgt.tier.hp));
      }
      const a = atk ? labelWithSide(atk) : ev.attackerId;
      const t = tgt ? labelWithSide(tgt, true) : ev.targetId;
      addLog(`<span class="log-attack">${T('attackLine', a, t, ev.damage, ev.targetHp, ev.targetMaxHp || (tgt && tgt.maxHp))}</span>`);
      break;
    }
    case 'death': {
      if (g) { g.alive = false; g.currentHp = 0; g.aliveUnits = 0; }
      addLog(`<span class="log-death">${T('defeated', g ? g.label : ev.groupId)}</span>`);
      break;
    }
    case 'revive': {
      if (g) {
        g.revived = true;
        g.currentHp = ev.qty;
        g.maxHp = ev.qty;
        g.aliveUnits = ev.qty;
        g.alive = true;
        g.revivedThisRound = true;
      }
      addLog(`<span class="log-skill">✦ ${T('e2Revives', ev.qty)}</span>`);
      break;
    }
    case 'thorns': {
      if (atk) {
        atk.currentHp = Math.max(0, atk.currentHp - ev.damage);
        atk.aliveUnits = Math.max(0, Math.ceil(atk.currentHp / atk.tier.hp));
      }
      addLog(`<span class="log-skill">✦ ${T('e5Thorns', ev.damage, atk ? atk.label : ev.attackerId)}</span>`);
      break;
    }
    case 'splash': {
      if (tgt) {
        tgt.currentHp = Math.max(0, tgt.currentHp - ev.damage);
        tgt.aliveUnits = Math.max(0, Math.ceil(tgt.currentHp / tgt.tier.hp));
      }
      const key = ev.kind === 'liches' ? 'lichSplash' : 'witchesSplash';
      addLog(`<span class="log-skill">✦ ${T(key, ev.damage)}</span>`);
      break;
    }
    case 'overkill': {
      if (tgt) {
        tgt.currentHp = Math.max(0, tgt.currentHp - ev.damage);
        tgt.aliveUnits = Math.max(0, Math.ceil(tgt.currentHp / tgt.tier.hp));
      }
      addLog(`<span class="log-skill">✦ ${T('rotmawsOverkill', ev.damage, tgt ? tgt.label : ev.targetId)}</span>`);
      break;
    }
    case 'spawn': {
      const spider = ensureGroup(ev.targetId);
      if (spider) {
        spider.qty += ev.qty;
        spider.aliveUnits += ev.qty;
        spider.currentHp += ev.qty * spider.tier.hp;
        spider.maxHp += ev.qty * spider.tier.hp;
        spider.alive = true;
      }
      addLog(`<span class="log-skill">✦ ${T('spawn', ev.qty)}</span>`);
      break;
    }
    case 'speedDebuff': {
      if (atk) atk.currentSpd = ev.newSpd;
      addLog(`<span class="log-skill">✦ ${T('gargoylesDebuff', ev.newSpd)}</span>`);
      break;
    }
    case 'typeAdv':
      addLog(`<span class="log-skill">✦ ${T('typeAdv', ev.mult, ev.attacker, ev.target)}</span>`);
      break;
    case 'typeDisadv':
      addLog(`<span class="log-skill">✦ ${T('typeDisadv', ev.mult, ev.attacker, ev.target)}</span>`);
      break;
    case 'skill': {
      // Generic skill log: lookup by key
      const text = T(ev.key, ev.mult, ev.deaths);
      addLog(`<span class="log-skill">✦ ${text}</span>`);
      break;
    }
  }
}

function labelWithSide(group, isTarget) {
  if (!group) return '?';
  const cls = isTarget
    ? (group.side === 'enemy' ? 'target' : 'ally-target')
    : (group.side === 'ally' ? 'attacker' : 'ally-attacker');
  return `<span class="${cls}">${group.label}</span>`;
}

function executeRound() {
  const bs = battleState;
  bs.round++;

  // If engine had no event for this round, the battle is over
  const roundData = bs.roundEvents[bs.round];
  if (!roundData) {
    finishBattle();
    return;
  }

  addLog(`<div class="log-round">${T('roundHeader', bs.round)}</div>`);

  // Reset per-round flags on display groups
  for (const id in bs.groupsById) {
    const g = bs.groupsById[id];
    g.attackedThisRound = false;
    g.revivedThisRound = false;
  }

  // Build turn order from engine order, mapped to display groups
  const turnOrder = roundData.order
    .map(id => bs.groupsById[id] || ensureGroup(id))
    .filter(Boolean);
  renderTurnOrder(turnOrder);

  // Apply all events for this round
  for (const ev of roundData.events) applyEvent(ev);

  renderBattlefield();

  // End check
  const alliesAlive = bs.allies.some(g => g.alive);
  const enemiesAlive = bs.enemies.some(g => g.alive);
  if (!alliesAlive || !enemiesAlive || bs.round >= bs.roundEvents.length - 1) {
    finishBattle();
  }
}

function finishBattle() {
  const bs = battleState;
  bs.done = true;
  stopAuto();
  isRunning = false;
  renderBattlefield();

  const r = bs.finalResult;
  if (r.draw) showResult('draw', T('draw'), T('bothFell'));
  else if (r.victory) showResult('victory', T('victory'), T('enemiesDefeated', r.rounds));
  else showResult('defeat', T('defeat'), T('armyDestroyed', r.rounds));
}


// ===================== RENDER BATTLEFIELD =====================
function renderBattlefield() {
  const alliesEl = document.getElementById('bf-allies');
  const enemiesEl = document.getElementById('bf-enemies');
  alliesEl.innerHTML = '';
  enemiesEl.innerHTML = '';

  if (!battleState) return;

  battleState.allies.forEach(g => {
    alliesEl.appendChild(createUnitEl(g, 'ally'));
  });

  battleState.enemies.forEach(g => {
    enemiesEl.appendChild(createUnitEl(g, 'enemy'));
  });
}

function createUnitEl(group, side) {
  const div = document.createElement('div');
  div.className = 'bf-unit' + (group.alive ? '' : ' dead');
  div.id = 'unit-' + group.id;

  const hpPct = group.maxHp > 0 ? Math.max(0, (group.currentHp / group.maxHp) * 100) : 0;
  const fillClass = side === 'ally' ? 'hp-fill ally' : 'hp-fill';
  const aliveUnits = group.alive ? (group.aliveUnits || Math.max(1, Math.ceil(group.currentHp / group.tier.hp))) : 0;
  const totalDmg = group.tier.dmg * aliveUnits;
  const statusBadge = group.debuffed ? '<span class="status-badge">Oslabený</span>' : '';
  const buffBadge = group.damageBuff > 1.0 ? `<span class="status-badge" style="color:#e67e22;background:rgba(230,126,34,0.2)">+${Math.round((group.damageBuff-1)*100)}% DMG</span>` : '';

  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap">
      <span class="bf-unit-name">${group.label}</span>
      <div style="display:flex;gap:3px;flex-wrap:wrap">${statusBadge}${buffBadge}</div>
    </div>
    <div style="display:flex;gap:6px;font-size:0.65rem;color:var(--text-dim);margin-bottom:3px">
      <span style="color:var(--gold-light)">×${aliveUnits}</span>
      <span>⚔${group.tier.dmg}<span style="color:var(--gold-light);font-size:0.6rem"> (=${totalDmg})</span></span>
      <span>💨${group.tier.spd}</span>
      <span class="type-badge type-${group.tier.type.trim()}" style="padding:0 4px">${group.tier.type.trim()}</span>
      <span class="pos-badge pos-${group.tier.pos}" style="padding:0 4px">${group.tier.pos === 'Vanguard' ? 'Vanguard' : 'Rearguard'}</span>
    </div>
    <div class="hp-bar-wrap">
      <div class="hp-bar"><div class="${fillClass}" style="width:${hpPct}%"></div></div>
      <div class="hp-text">${Math.max(0, group.currentHp)} / ${group.maxHp} HP</div>
    </div>
  `;

  return div;
}

function renderTurnOrder(groups) {
  const bar = document.getElementById('turn-order-bar');
  bar.style.display = 'flex';
  bar.innerHTML = '<span style="color:var(--text-dim);font-size:0.68rem;font-family:Cinzel,serif;letter-spacing:.1em">PORADIE:</span> ';
  groups.forEach((g, i) => {
    const badge = document.createElement('span');
    badge.className = 'turn-badge ' + g.side;
    if (i === 0) badge.className += ' active';
    badge.textContent = g.label + ' (💨' + g.tier.spd + ')';
    bar.appendChild(badge);
    if (i < groups.length - 1) {
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.style.color = 'var(--text-dim)';
      arrow.style.fontSize = '0.65rem';
      bar.appendChild(arrow);
    }
  });
}

// ===================== LOG =====================
function addLog(html) {
  const container = document.getElementById('log-container');
  const line = document.createElement('div');
  line.innerHTML = html;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function clearLog() {
  document.getElementById('log-container').innerHTML = '';
}

// ============================================================================
// LOG EXPORT — copy to clipboard / download as .txt
// ============================================================================
// Strategy:
//   1. Walk #log-container's children and pull textContent from each line —
//      this drops all <span> markup and emoji-class colouring cleanly.
//   2. Prepend a metadata block so a pasted log is self-describing:
//        - Extension version (from manifest, hardcoded mirror here)
//        - Local timestamp
//        - Power limit at start of battle
//        - Starting ally + enemy formations (compact form)
//        - Outcome if battle has finished
//   3. Copy: navigator.clipboard.writeText (Promise). Fallback for older
//      browsers uses a hidden textarea + document.execCommand('copy').
//   4. Download: Blob + URL.createObjectURL + temporary <a> element.

function buildLogExportText() {
  const container = document.getElementById('log-container');
  if (!container) return '';

  // Walk lines — each addLog() creates a <div> wrapper. The very first
  // "Build your armies..." placeholder is a bare <span>, so we walk all
  // direct children regardless of tag.
  const lines = [];
  for (const child of container.children) {
    const txt = (child.textContent || '').trim();
    if (txt) lines.push(txt);
  }

  // Compact formation summary (only non-zero tiers)
  function compactQtys(qtys, tiers) {
    const parts = [];
    tiers.forEach(t => {
      const q = qtys[t.id] || 0;
      if (q > 0) parts.push(t.id + '×' + q);
    });
    return parts.join(' ') || '—';
  }

  // Outcome line — pull from current battleState if it ended, otherwise
  // mark as "in progress". battleState is the live structure managed by
  // executeRound; .done flips true when one side is wiped.
  let outcomeLine = 'Outcome:        in progress';
  if (battleState && battleState.done) {
    if (battleState.draw)      outcomeLine = 'Outcome:        ⚔ DRAW after ' + (battleState.round || '?') + ' rounds';
    else if (battleState.victory) outcomeLine = 'Outcome:        🏆 VICTORY after ' + (battleState.round || '?') + ' rounds';
    else                       outcomeLine = 'Outcome:        💀 DEFEAT after ' + (battleState.round || '?') + ' rounds';
  } else if (!battleState) {
    outcomeLine = 'Outcome:        no battle started';
  }

  const stamp = new Date();
  const isoLocal = stamp.getFullYear()
    + '-' + String(stamp.getMonth() + 1).padStart(2, '0')
    + '-' + String(stamp.getDate()).padStart(2, '0')
    + ' ' + String(stamp.getHours()).padStart(2, '0')
    + ':' + String(stamp.getMinutes()).padStart(2, '0')
    + ':' + String(stamp.getSeconds()).padStart(2, '0');

  const header = [
    '================================================================',
    ' BiteFight Battle Simulator — Log Export',
    '================================================================',
    'Version:        v1.6.10',
    'Exported:       ' + isoLocal,
    'Power limit:    ' + (ARMY_POWER_LIMIT || '?'),
    'Allies:         ' + compactQtys(allyQuantities, ALLY_TIERS),
    'Enemies:        ' + compactQtys(enemyQuantities, ENEMY_TIERS),
    outcomeLine,
    '----------------------------------------------------------------',
    '',
  ].join('\n');

  const body = lines.length > 0
    ? lines.join('\n')
    : '(log is empty — start a battle to populate it)';

  return header + body + '\n';
}

function flashButton(btn, color, msg, restoreMs) {
  if (!btn) return;
  const orig = {
    bg:     btn.style.background,
    color:  btn.style.color,
    border: btn.style.borderColor,
    html:   btn.innerHTML,
  };
  btn.style.background   = color.bg;
  btn.style.color        = color.fg;
  btn.style.borderColor  = color.border;
  if (msg) btn.innerHTML = msg;
  setTimeout(() => {
    btn.style.background   = orig.bg;
    btn.style.color        = orig.color;
    btn.style.borderColor  = orig.border;
    btn.innerHTML          = orig.html;
  }, restoreMs || 1200);
}

function copyLogToClipboard() {
  const text = buildLogExportText();
  const btn  = document.getElementById('btn-copy-log');
  const ok   = { bg: 'rgba(46,204,113,0.2)',  fg: '#2ecc71', border: '#27ae60' };
  const err  = { bg: 'rgba(231,76,60,0.2)',  fg: '#e74c3c', border: '#c0392b' };

  // Preferred: async clipboard API. Requires HTTPS / extension context,
  // which we're always in (chrome-extension://) so this path almost always
  // succeeds. The fallback handles older browsers and any unexpected denials.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => flashButton(btn, ok, '✓ Copied'),
      () => fallbackCopy(text, btn, ok, err)
    );
    return;
  }
  fallbackCopy(text, btn, ok, err);
}

function fallbackCopy(text, btn, ok, err) {
  // Old-school path: hidden textarea + execCommand('copy'). Works back to
  // pre-Chromium browsers; the user-gesture context (button click) is what
  // makes it permitted.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok2 = document.execCommand('copy');
    document.body.removeChild(ta);
    flashButton(btn, ok2 ? ok : err, ok2 ? '✓ Copied' : '✗ Failed');
  } catch (e) {
    flashButton(btn, err, '✗ Failed');
  }
}

function downloadLogAsFile() {
  const text = buildLogExportText();
  const btn  = document.getElementById('btn-download-log');
  try {
    // Filename with ISO-style local timestamp. Colons replaced with dashes
    // because Windows file systems reject them.
    const t = new Date();
    const stamp = t.getFullYear()
      + '-' + String(t.getMonth() + 1).padStart(2, '0')
      + '-' + String(t.getDate()).padStart(2, '0')
      + '_' + String(t.getHours()).padStart(2, '0')
      + '-' + String(t.getMinutes()).padStart(2, '0')
      + '-' + String(t.getSeconds()).padStart(2, '0');
    const filename = 'bf-battle-log-' + stamp + '.txt';

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Tiny defer before revoke — some browsers race the click event.
    setTimeout(() => URL.revokeObjectURL(url), 250);
    flashButton(btn, { bg: 'rgba(46,204,113,0.2)', fg: '#2ecc71', border: '#27ae60' }, '✓ Saved');
  } catch (e) {
    flashButton(btn, { bg: 'rgba(231,76,60,0.2)', fg: '#e74c3c', border: '#c0392b' }, '✗ Failed');
  }
}

// ===================== RESULT =====================
function showResult(type, title, sub) {
  const banner = document.getElementById('result-banner');
  const box = document.getElementById('result-box');
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-sub').textContent = sub;
  document.getElementById('result-icon').textContent = type === 'victory' ? '🏆' : type === 'defeat' ? '💀' : '⚔';
  box.className = 'result-box' + (type === 'defeat' ? ' defeat-box' : '');

  // Calculate ally casualties + Blood Essence cost
  const bs = battleState;
  let totalStart = 0, totalSurvived = 0, totalEssenceLost = 0;

  let rowsHtml = '';
  bs.allies.forEach(g => {
    const startUnits = g.qty;
    const survivedUnits = g.alive ? (g.aliveUnits || 0) : 0;
    const lost = startUnits - survivedUnits;
    const essenceLost = lost * g.tier.cost;
    totalStart += startUnits;
    totalSurvived += survivedUnits;
    totalEssenceLost += essenceLost;

    if (startUnits === 0) return;
    const color = lost === 0 ? '#2ecc71' : lost === startUnits ? '#e74c3c' : '#e67e22';
    rowsHtml += `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="color:var(--text-dim);min-width:55px">${g.label}</span>
        <span style="color:${color};flex:1">${survivedUnits}/${startUnits} survived</span>
        <span style="color:#c0392b;min-width:30px;text-align:center">${lost > 0 ? '−'+lost+' ☠' : '—'}</span>
        <span style="color:#c9a84c;min-width:70px;text-align:right">${essenceLost > 0 ? '−'+essenceLost+' 🩸' : '<span style="color:var(--text-dim)">—</span>'}</span>
      </div>`;
  });

  const totalLost = totalStart - totalSurvived;
  const survPct = totalStart > 0 ? Math.round((totalSurvived / totalStart) * 100) : 0;

  const statsHtml = `
    <div style="color:var(--gold);font-family:Cinzel,serif;font-size:0.7rem;letter-spacing:.12em;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border)">
      ⚔ ALLY LOSSES
    </div>
    ${rowsHtml}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding-top:6px;margin-top:2px">
      <span style="color:var(--text-dim);font-family:Cinzel,serif;font-size:0.68rem">CELKOM</span>
      <span style="color:var(--text);flex:1">${totalSurvived}/${totalStart} <span style="color:var(--text-dim);font-size:0.7rem">(${survPct}%)</span></span>
      <span style="color:#c0392b;min-width:30px;text-align:center">${totalLost > 0 ? '−'+totalLost+' ☠' : '—'}</span>
      <span style="color:#f0d080;font-weight:bold;min-width:70px;text-align:right">${totalEssenceLost > 0 ? '−'+totalEssenceLost+' 🩸' : '0 🩸'}</span>
    </div>
    <div style="margin-top:10px;padding:8px;background:rgba(139,0,0,0.15);border:1px solid rgba(192,57,43,0.3);border-radius:3px;text-align:center">
      <span style="color:var(--text-dim);font-size:0.7rem;font-family:Cinzel,serif;letter-spacing:.1em">TOTAL LOSSES</span><br>
      <span style="color:#f0d080;font-family:'Cinzel Decorative',cursive;font-size:1.3rem;text-shadow:0 0 12px rgba(201,168,76,0.5)">
        ${totalEssenceLost} Blood Essence
      </span>
    </div>
  `;

  document.getElementById('result-stats').innerHTML = statsHtml;
  banner.className = 'show';
  addLog(`<div class="log-result ${type === 'victory' ? 'victory' : 'defeat'}">${title}: ${sub} | Strata: ${totalEssenceLost} Blood Essence</div>`);
}

function closeResult() {
  document.getElementById('result-banner').className = '';
}

// ===================== OPTIMIZER CANCELLATION =====================
// Module-level control object created fresh at the start of every
// runOptimizer() invocation. The Cancel button reads/writes this via the
// helpers below. Single-thread paths poll _optCtl.cancelled at every yield;
// parallel path additionally tracks worker handles + pending resolver fns
// so terminate() + force-resolve can unblock Promise.all immediately.
let _optCtl = null;

function newOptControl() {
  _optCtl = {
    cancelled: false,
    workers: [],          // parallel: Worker instances spawned this run
    pendingResolvers: [], // parallel: { idx, resolve } records still awaiting 'done'
  };
  return _optCtl;
}

function requestOptimizerCancel() {
  if (!_optCtl || _optCtl.cancelled) return;
  _optCtl.cancelled = true;
  // Tear down any spawned workers. Each worker promise is then force-resolved
  // (instead of left dangling) so Promise.all does not hang.
  _optCtl.workers.forEach(w => { try { w.terminate(); } catch (_) {} });
  _optCtl.pendingResolvers.slice().forEach(rec => {
    try { rec.resolve({ cancelled: true }); } catch (_) {}
  });
  _optCtl.pendingResolvers.length = 0;

  // UI feedback — single-thread paths still need their next yield to fully
  // bail out, but the user sees immediate acknowledgement here.
  const label = document.getElementById('opt-progress-label');
  if (label) label.textContent = '⏹ Cancelled — finalizing in-flight work…';
  const btnLabel = document.getElementById('opt-btn-label');
  if (btnLabel) btnLabel.textContent = '⚙ Run Optimizer';
  showCancelBtn(false);
}

function showCancelBtn(show) {
  const btn = document.getElementById('btn-cancel-optimizer');
  if (btn) btn.style.display = show ? 'inline-flex' : 'none';
}

// Convenience: register a worker + its resolver in the control object.
// Returned wrapper resolves the inner promise AND removes the record from
// pendingResolvers so subsequent cancels do not double-fire.
function registerWorkerPromise(worker, idx, resolve) {
  if (!_optCtl) return resolve;
  _optCtl.workers.push(worker);
  const rec = { idx, resolve };
  _optCtl.pendingResolvers.push(rec);
  return function wrappedResolve(value) {
    const i = _optCtl.pendingResolvers.indexOf(rec);
    if (i >= 0) _optCtl.pendingResolvers.splice(i, 1);
    resolve(value);
  };
}

// ===================== OPTIMIZER =====================
function openOptimizer() {
  const enemyGroups = buildGroups('enemy', ENEMY_TIERS, enemyQuantities);
  if (enemyGroups.length === 0) {
    alert('Set up the enemy army first!');
    return;
  }
  document.getElementById('optimizer-modal').style.display = 'block';
  document.getElementById('opt-results').innerHTML = '';
  document.getElementById('opt-progress').style.display = 'none';

  // Render max-per-tier inputs
  const maxInputsBox = document.getElementById('opt-max-inputs');
  maxInputsBox.innerHTML = '';
  ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id)).forEach(tier => {
    const hardMax = Math.floor(ARMY_POWER_LIMIT / tier.power);
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;min-width:52px';
    col.innerHTML = `
      <span style="font-family:Cinzel,serif;font-size:0.62rem;color:var(--gold-light)">${tier.label}</span>
      <input type="number" id="opt-max-${tier.id}" min="0" max="${hardMax}" value="${hardMax}"
        class="opt-max-input"
        style="width:48px;background:var(--dark);border:1px solid var(--border);color:var(--text);font-family:Cinzel,serif;font-size:0.75rem;padding:3px 5px;border-radius:2px;text-align:center">
      <span style="font-size:0.6rem;color:var(--text-dim)">max ${hardMax}</span>`;
    maxInputsBox.appendChild(col);
  });
  // Lazy combo count: do NOT enumerate combinations on open. At high power
  // limits with many tiers this can take seconds (e.g. layer 52, power 530,
  // 6 tiers ≈ 1.5B combinations to enumerate). The user clicks 🔢 Calculate
  // when they actually want the estimate. After the first manual calculation,
  // edits to the per-tier max inputs will auto-refresh the number.
  resetComboCountUI();

  // Render strategy checkboxes based on active enemy tiers
  const stratBox = document.getElementById('opt-strategies');
  stratBox.innerHTML = '';
  const hasE3 = enemyGroups.some(g => g.tier.skillId === 'E3_BUFF_ALLY');
  if (hasE3) {
    stratBox.innerHTML = `
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
        <input type="checkbox" id="strat-kill-e3" style="margin-top:3px;accent-color:#9b59b6;cursor:pointer">
        <span>
          <span style="font-family:Cinzel,serif;font-size:0.72rem;color:var(--text)">☠ Kill Tier e3 in round 1</span>
          <span style="display:block;font-size:0.68rem;color:var(--text-dim);font-style:italic">Shows only formations where E3 dies in round 1 — prevents cumulative buffing. <span style="color:#9b59b6">Greatly improves result accuracy.</span></span>
        </span>
      </label>`;
  } else {
    stratBox.innerHTML = '<span style="font-size:0.72rem;color:var(--text-dim);font-style:italic">No strategies for current enemies.</span>';
  }

  // Update parallel info text with detected hardware concurrency
  const parallelInfo = document.getElementById('opt-parallel-info');
  if (parallelInfo) {
    const hw = (navigator && navigator.hardwareConcurrency) || null;
    if (hw) {
      const willUse = Math.max(2, Math.min(8, hw));
      parallelInfo.textContent = `Detected ${hw} CPU cores — will use up to ${willUse} parallel workers. UI stays responsive.`;
    } else {
      parallelInfo.textContent = 'Split work across CPU cores. UI stays responsive during search.';
    }
  }

  // Load smart presets and try to detect current layer (set by bot if active)
  refreshPresetCache(function () {
    if (window.BFPresets && window.BFPresets.loadCurrentLayer) {
      window.BFPresets.loadCurrentLayer(function (data) {
        if (data && data.layer) {
          const inp = document.getElementById('opt-preset-level');
          if (inp && (!inp.dataset.touched || inp.dataset.touched === 'false')) {
            inp.value = String(data.layer);
          }
        }
        updateSmartPresetPreview();
      });
    } else {
      updateSmartPresetPreview();
    }
  });
}

function closeOptimizer() {
  document.getElementById('optimizer-modal').style.display = 'none';
}

// ============================================================================
// SMART PRESET UI (warm-start optimization)
// ============================================================================

let _presetCache = null;  // populated on optimizer open

function getActiveSmartPreset() {
  // Returns {preset, level, range} if smart preset is enabled and valid; null otherwise
  if (!window.BFPresets) return null;
  const enabledEl = document.getElementById('opt-preset-enabled');
  if (!enabledEl || !enabledEl.checked) return null;
  const levelEl = document.getElementById('opt-preset-level');
  const level = levelEl ? parseInt(levelEl.value) || 0 : 0;
  if (level <= 0) return null;
  const preset = _presetCache && _presetCache[String(level)];
  if (!preset) return null;
  const rangeEl = document.getElementById('opt-preset-range');
  const range = rangeEl ? parseInt(rangeEl.value) || 15 : 15;
  return { preset: preset, level: level, range: range };
}

function updateSmartPresetPreview() {
  const previewEl = document.getElementById('opt-preset-preview');
  const confEl = document.getElementById('opt-preset-confidence');
  const enabledEl = document.getElementById('opt-preset-enabled');
  const levelEl = document.getElementById('opt-preset-level');
  const rangeEl = document.getElementById('opt-preset-range');
  const rangeValEl = document.getElementById('opt-preset-range-val');
  if (!previewEl || !levelEl) return;

  const level = parseInt(levelEl.value) || 0;
  const range = parseInt(rangeEl.value) || 15;
  if (rangeValEl) rangeValEl.textContent = '±' + range;

  const preset = (_presetCache && _presetCache[String(level)]) || null;

  // Confidence badge
  if (confEl) {
    if (!preset) {
      confEl.textContent = '🔴 no data';
      confEl.style.background = 'rgba(231,76,60,0.2)';
      confEl.style.color = '#e74c3c';
    } else {
      const c = preset.confidence || 'yellow';
      const cmap = {
        red:    { bg: 'rgba(231,76,60,0.2)',  fg: '#e74c3c', label: '🔴 low' },
        yellow: { bg: 'rgba(243,156,18,0.2)', fg: '#f39c12', label: '🟡 limited' },
        green:  { bg: 'rgba(46,204,113,0.2)', fg: '#2ecc71', label: '🟢 verified' },
      };
      const m = cmap[c] || cmap.yellow;
      confEl.textContent = m.label;
      confEl.style.background = m.bg;
      confEl.style.color = m.fg;
    }
  }

  if (!preset) {
    previewEl.innerHTML = '<span style="color:var(--text-dim);font-style:italic">No preset saved for layer ' + level + '. Click "Manage…" to add one.</span>';
    if (enabledEl) enabledEl.checked = false;
    return;
  }

  // Build preview text
  const stratKillE3El = document.getElementById('strat-kill-e3');
  const stratKillE3 = !!(stratKillE3El && stratKillE3El.checked);
  const ranges = window.BFPresets.buildRangesFromPreset(preset, {
    range: range,
    enemyQtys: { ...enemyQuantities },
    stratKillE3: stratKillE3,
  });

  let html = '';
  if (preset.note) {
    html += '<div style="color:var(--gold-light);font-style:italic;margin-bottom:4px">' + escapeHtml(preset.note) + '</div>';
  }
  const parts = [];
  Object.keys(ranges.computed).forEach(function (tid) {
    const c = ranges.computed[tid];
    if (c.mode === 'auto' && c.autoMin != null) {
      parts.push('<span style="color:#9b59b6">' + tid + ' &ge; <b>' + c.autoMin + '</b> (auto min)</span>');
    } else if (c.mode === 'range') {
      parts.push('<span style="color:var(--text)">' + tid + ': ' + c.min + '–' + c.max + '</span>');
    } else if (c.mode === 'zero') {
      parts.push('<span style="color:#7f8c8d">' + tid + ': 0 (skipped)</span>');
    } else if (c.mode === 'auto') {
      parts.push('<span style="color:#7f8c8d">' + tid + ': auto (needs Kill E3 R1)</span>');
    }
  });
  html += parts.join('&nbsp;&nbsp;');
  previewEl.innerHTML = html || '<span style="color:var(--text-dim);font-style:italic">Empty preset.</span>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function refreshPresetCache(callback) {
  if (!window.BFPresets) {
    _presetCache = {};
    if (callback) callback();
    return;
  }
  window.BFPresets.loadPresets(function (presets) {
    _presetCache = presets;
    window.BFPresets.setCached(presets);
    if (callback) callback();
  });
}

// ============================================================================
// PRESET MANAGER MODAL
// ============================================================================

function openPresetManager() {
  refreshPresetCache(function () {
    renderPresetManagerInputs();
    renderPresetManagerTable();
    document.getElementById('preset-manager-modal').style.display = 'block';
    // Pre-fill level from optimizer
    const optLevel = document.getElementById('opt-preset-level');
    const mgrLevel = document.getElementById('pmgr-level');
    if (optLevel && mgrLevel) mgrLevel.value = optLevel.value;
    loadPresetIntoForm(parseInt(mgrLevel.value) || 0);
  });
}

function closePresetManager() {
  document.getElementById('preset-manager-modal').style.display = 'none';
  // Refresh main optimizer preview to reflect any changes
  updateSmartPresetPreview();
}

function renderPresetManagerInputs() {
  const box = document.getElementById('pmgr-tier-inputs');
  if (!box) return;
  box.innerHTML = '';
  ALLY_TIERS.forEach(function (tier) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;min-width:50px';
    col.innerHTML =
      '<label style="font-family:Cinzel,serif;font-size:0.6rem;color:var(--gold-light)">' + tier.id + '</label>' +
      '<input type="text" id="pmgr-tier-' + tier.id + '" placeholder="0" maxlength="5" ' +
        'style="width:42px;background:var(--dark);border:1px solid var(--border);color:var(--text);font-family:Cinzel,serif;font-size:0.72rem;padding:3px 4px;border-radius:2px;text-align:center">';
    box.appendChild(col);
  });
}

function loadPresetIntoForm(level) {
  const preset = (_presetCache && _presetCache[String(level)]) || null;

  // Clear all tier inputs first
  ALLY_TIERS.forEach(function (tier) {
    const inp = document.getElementById('pmgr-tier-' + tier.id);
    if (inp) inp.value = '';
  });

  // Reset confidence + note
  const confRadios = document.querySelectorAll('input[name="pmgr-conf"]');
  confRadios.forEach(r => { r.checked = r.value === 'yellow'; });
  const noteEl = document.getElementById('pmgr-note');
  if (noteEl) noteEl.value = '';

  if (!preset) return;

  // Populate from preset
  Object.keys(preset.tiers || {}).forEach(function (tid) {
    const inp = document.getElementById('pmgr-tier-' + tid);
    if (inp) inp.value = String(preset.tiers[tid]);
  });
  const c = preset.confidence || 'yellow';
  confRadios.forEach(r => { r.checked = r.value === c; });
  if (noteEl && preset.note) noteEl.value = preset.note;
}

function savePresetFromForm() {
  const levelEl = document.getElementById('pmgr-level');
  const level = parseInt(levelEl.value) || 0;
  if (level < 1 || level > 100) {
    showSaveStatus('Level must be 1-100', '#e74c3c');
    return;
  }

  // Collect tier values
  const tiers = {};
  let any = false;
  ALLY_TIERS.forEach(function (tier) {
    const inp = document.getElementById('pmgr-tier-' + tier.id);
    const raw = (inp && inp.value || '').trim();
    if (!raw) return;
    if (raw.toLowerCase() === 'auto') {
      tiers[tier.id] = 'auto';
      any = true;
    } else {
      const n = parseInt(raw);
      if (isNaN(n) || n < 0) {
        showSaveStatus('Tier ' + tier.id + ' invalid value: "' + raw + '"', '#e74c3c');
        return;
      }
      if (n > 0) {
        tiers[tier.id] = n;
        any = true;
      }
    }
  });
  if (!any) {
    showSaveStatus('At least one tier must have a value', '#e74c3c');
    return;
  }

  const confRadio = document.querySelector('input[name="pmgr-conf"]:checked');
  const confidence = confRadio ? confRadio.value : 'yellow';
  const note = (document.getElementById('pmgr-note').value || '').trim();

  const preset = {
    tiers: tiers,
    confidence: confidence,
  };
  if (note) preset.note = note;

  const errors = window.BFPresets.validatePreset(preset);
  if (errors.length) {
    showSaveStatus('Invalid: ' + errors.join('; '), '#e74c3c');
    return;
  }

  window.BFPresets.updateLevelPreset(level, preset, function (err) {
    if (err) {
      showSaveStatus('Save failed: ' + err.message, '#e74c3c');
      return;
    }
    _presetCache = window.BFPresets.getCached();
    showSaveStatus('✓ Saved preset for layer ' + level, '#2ecc71');
    renderPresetManagerTable();
    updateSmartPresetPreview();
  });
}

function showSaveStatus(text, color) {
  const el = document.getElementById('pmgr-save-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.display = 'block';
  setTimeout(function () { el.style.display = 'none'; }, 3000);
}

function renderPresetManagerTable() {
  const box = document.getElementById('pmgr-table');
  if (!box) return;
  const levels = Object.keys(_presetCache || {}).sort(function (a, b) { return parseInt(a) - parseInt(b); });
  if (!levels.length) {
    box.innerHTML = '<div style="color:var(--text-dim);font-style:italic;font-size:0.7rem;padding:10px;text-align:center">No saved presets yet.</div>';
    return;
  }
  const confColor = { red: '#e74c3c', yellow: '#f39c12', green: '#2ecc71' };
  const confIcon  = { red: '🔴', yellow: '🟡', green: '🟢' };

  let html = '<table style="width:100%;font-family:Cinzel,serif;font-size:0.66rem;border-collapse:collapse">';
  html += '<thead><tr style="color:var(--text-dim);border-bottom:1px solid #2a1218">';
  html += '<th style="text-align:left;padding:4px 4px">Lv</th>';
  html += '<th style="text-align:left;padding:4px 4px">Formation</th>';
  html += '<th style="text-align:center;padding:4px 4px">Conf</th>';
  html += '<th style="text-align:right;padding:4px 4px">Actions</th>';
  html += '</tr></thead><tbody>';
  levels.forEach(function (lvl) {
    const p = _presetCache[lvl];
    const conf = p.confidence || 'yellow';
    const tierStr = Object.keys(p.tiers || {}).map(function (k) {
      const v = p.tiers[k];
      return k + ':' + v;
    }).join(' ');
    html += '<tr style="border-bottom:1px solid rgba(42,18,24,0.5)">';
    html += '<td style="padding:5px 4px;color:#9b59b6;font-weight:bold">' + lvl + '</td>';
    html += '<td style="padding:5px 4px;color:var(--text)">' + escapeHtml(tierStr) + '</td>';
    html += '<td style="padding:5px 4px;text-align:center;color:' + (confColor[conf] || '#bdc3c7') + '">' + (confIcon[conf] || '⚪') + '</td>';
    html += '<td style="padding:5px 4px;text-align:right">';
    html += '<button class="pmgr-edit" data-level="' + lvl + '" style="background:none;border:none;color:#3498db;cursor:pointer;font-size:0.7rem;margin-right:6px">✏</button>';
    html += '<button class="pmgr-del" data-level="' + lvl + '" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:0.7rem">🗑</button>';
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;

  // Wire up edit/delete buttons
  box.querySelectorAll('.pmgr-edit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const lvl = parseInt(btn.dataset.level) || 0;
      document.getElementById('pmgr-level').value = String(lvl);
      loadPresetIntoForm(lvl);
    });
  });
  box.querySelectorAll('.pmgr-del').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const lvl = parseInt(btn.dataset.level) || 0;
      if (!confirm('Delete preset for layer ' + lvl + '?')) return;
      window.BFPresets.deleteLevelPreset(lvl, function () {
        _presetCache = window.BFPresets.getCached();
        renderPresetManagerTable();
        updateSmartPresetPreview();
        showSaveStatus('Deleted preset for layer ' + lvl, '#f39c12');
      });
    });
  });
}

function exportPresetsJson() {
  const json = JSON.stringify(_presetCache || {}, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bf-smart-presets-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importPresetsJson(file) {
  const status = document.getElementById('pmgr-import-status');
  if (status) { status.style.display = 'block'; status.textContent = 'Reading file…'; status.style.color = '#e0a030'; }
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data !== 'object' || data === null) throw new Error('Top-level must be an object');
      // Validate each entry
      let validCount = 0;
      const errors = [];
      Object.keys(data).forEach(function (lvl) {
        const errs = window.BFPresets.validatePreset(data[lvl]);
        if (errs.length) errors.push('Lv ' + lvl + ': ' + errs.join(', '));
        else validCount++;
      });
      if (errors.length) {
        if (status) { status.textContent = '⚠ ' + errors.length + ' invalid entries: ' + errors.slice(0,2).join('; '); status.style.color = '#e74c3c'; }
        return;
      }
      window.BFPresets.savePresets(data, function (err) {
        if (err) {
          if (status) { status.textContent = '✗ Save failed: ' + err.message; status.style.color = '#e74c3c'; }
          return;
        }
        _presetCache = data;
        window.BFPresets.setCached(data);
        renderPresetManagerTable();
        updateSmartPresetPreview();
        if (status) { status.textContent = '✓ Imported ' + validCount + ' presets'; status.style.color = '#2ecc71'; }
      });
    } catch (err) {
      if (status) { status.textContent = '✗ Parse error: ' + err.message; status.style.color = '#e74c3c'; }
    }
  };
  reader.onerror = function () { if (status) { status.textContent = '✗ Read error'; status.style.color = '#e74c3c'; } };
  reader.readAsText(file);
}

// Silent battle simulation — thin wrapper around BFEngine for optimizer use.
// Deterministic E3 target selection (strongest other enemy) for reproducible results.
function simulateBattleSilent(allyQtys, enemyQtys) {
  const r = window.BFEngine.simulate(allyQtys, enemyQtys, {
    randomTarget: false,  // deterministic for optimizer
    collectLog: false,    // skip event collection for speed
    maxRounds: 50,
  });
  if (!r) return null;
  return {
    victory: r.victory, draw: r.draw, rounds: r.rounds,
    essenceLost: r.essenceLost, unitsLost: r.unitsLost,
    unitsSurvived: r.unitsSurvived, e3KilledRound1: r.e3KilledRound1,
  };
}


// Tracks whether the user has clicked 🔢 Calculate at least once during the
// current optimizer-modal session. Auto-recalc on per-tier-max input changes
// only fires after that, to avoid the expensive recursive enumeration on
// every keystroke when the optimizer modal first opens.
let _comboCountComputed = false;

function resetComboCountUI() {
  _comboCountComputed = false;
  const label = document.getElementById('opt-combo-count');
  const warn  = document.getElementById('opt-combo-warn');
  if (warn) { warn.style.display = 'none'; warn.textContent = ''; }
  if (!label) return;
  label.innerHTML = '<button id="btn-calc-combos" type="button" '
    + 'style="background:rgba(155,89,182,0.15);border:1px solid #8e44ad;'
    + 'color:#9b59b6;font-family:Cinzel,serif;font-size:0.62rem;'
    + 'padding:2px 8px;border-radius:2px;cursor:pointer">'
    + '🔢 Calculate combinations</button>';
  const btn = document.getElementById('btn-calc-combos');
  if (btn) {
    btn.addEventListener('click', function () {
      _comboCountComputed = true;
      updateComboCount();
    });
  }
}

function updateComboCount() {
  const tiers = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id));
  const maxPerTier = {};
  tiers.forEach(t => {
    const el = document.getElementById(`opt-max-${t.id}`);
    maxPerTier[t.id] = el ? (parseInt(el.value) || 0) : Math.floor(ARMY_POWER_LIMIT / t.power);
  });
  const count = countCombinations(ARMY_POWER_LIMIT, maxPerTier);
  const label = document.getElementById('opt-combo-count');
  const warn = document.getElementById('opt-combo-warn');
  if (!label) return;
  const fmt = count.toLocaleString();
  let color = '#2ecc71', warnText = '';
  if (count > 5_000_000) { color = '#e74c3c'; warnText = '⚠ Very slow — B&B will prune most, but reduce limits to be safe.'; }
  else if (count > 500_000) { color = '#e67e22'; warnText = '⚠ Medium speed — B&B helps significantly.'; }
  else if (count > 50_000) { color = '#f1c40f'; warnText = ''; }
  label.innerHTML = `<span style="color:${color}">~${fmt} combinations (without B&B)</span>`;
  if (warn) { warn.style.display = warnText ? 'block' : 'none'; warn.style.color = color; warn.textContent = warnText; }
}

// ===================== BRANCH & BOUND GENERATOR =====================
// Pre-computes enemy stats once so the bound check is fast
function buildEnemyStats(enemyQtys) {
  let enemyTotalHp = 0, enemyDps = 0;
  const hasE2 = (enemyQtys['E2'] || 0) > 0;
  const hasE3 = (enemyQtys['E3'] || 0) > 0;
  ENEMY_TIERS.forEach(t => {
    const qty = enemyQtys[t.id] || 0;
    if (!qty) return;
    let hp = t.hp * qty;
    if (t.skillId === 'E2_REVIVE') hp += qty;
    enemyTotalHp += hp;
    if (t.skillId !== 'E3_BUFF_ALLY') {
      enemyDps += t.dmg * qty;
    }
  });
  if (hasE2) enemyDps *= 1.15;
  if (hasE3) enemyDps *= 1.2;
  return { enemyTotalHp, enemyDps, hasE3 };
}

// Upper-bound estimate of what a partial formation can achieve
// with the remaining power budget filled optimally (best remaining tier)
function upperBoundCanWin(partial, remaining, tiers, fromIdx, enemyStats) {
  // Current ally stats from partial
  let allyHp = 0, allyDps = 0, allyR1Bonus = 0;
  tiers.forEach((t, i) => {
    const q = partial[i] || 0;
    if (!q) return;
    let hp = t.hp * q;
    if (t.skillId === 'T2_REDUCE_DMG') hp *= 2;
    allyHp += hp;
    let dmg = t.dmg * q;
    if (t.skillId === 'T1_FIRST_ROUND_DMG') allyR1Bonus += dmg * 0.25;
    allyDps += dmg;
  });

  // Optimistic: fill remaining power with the best DPS/power tier available
  if (remaining > 0 && fromIdx < tiers.length) {
    // Find tier with best dmg per power from remaining tiers
    let bestDmgPerPower = 0, bestHpPerPower = 0;
    for (let i = fromIdx; i < tiers.length; i++) {
      const t = tiers[i];
      bestDmgPerPower = Math.max(bestDmgPerPower, t.dmg / t.power);
      const effHp = t.skillId === 'T2_REDUCE_DMG' ? t.hp * 2 / t.power : t.hp / t.power;
      bestHpPerPower = Math.max(bestHpPerPower, effHp);
    }
    // Optimistically assume we can fill ALL remaining power with best tier
    allyDps += bestDmgPerPower * remaining;
    allyHp += bestHpPerPower * remaining;
  }

  const { enemyTotalHp, enemyDps } = enemyStats;
  const effectiveDps = allyDps + allyR1Bonus;
  const roundsToKill = effectiveDps > 0 ? enemyTotalHp / effectiveDps : 999;
  const roundsToLive = enemyDps > 0 ? allyHp / enemyDps : 999;

  // Prune if even in best case we can't win (with generous margin)
  return roundsToKill <= roundsToLive * 2.0 && roundsToKill <= 40;
}

function* generateCombinations(powerLimit, maxPerTier, enemyQtys, minPerTier) {
  const tiers = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id));
  const enemyStats = enemyQtys ? buildEnemyStats(enemyQtys) : null;

  function* recurse(idx, remaining, current) {
    // Prune: check upper bound before going deeper
    if (enemyStats && !upperBoundCanWin(current, remaining, tiers, idx, enemyStats)) return;

    if (idx === tiers.length) {
      if (current.some(v => v > 0)) yield [...current];
      return;
    }
    const tier = tiers[idx];
    const hardMax = Math.floor(remaining / tier.power);
    const userMax = maxPerTier ? (maxPerTier[tier.id] ?? hardMax) : hardMax;
    const userMin = (minPerTier && minPerTier[tier.id] != null) ? Math.max(0, minPerTier[tier.id]) : 0;
    const max = Math.min(hardMax, userMax);
    for (let q = userMin; q <= max; q++) {
      current[idx] = q;
      yield* recurse(idx + 1, remaining - q * tier.power, current);
    }
  }

  const buf = new Array(tiers.length).fill(0);
  for (const combo of recurse(0, powerLimit, buf)) {
    const qtys = {};
    ALLY_TIERS.forEach(t => { qtys[t.id] = 0; });
    tiers.forEach((t, i) => { qtys[t.id] = combo[i]; });
    yield qtys;
  }
}

// Fast combination counter WITH branch & bound (for preview)
function countCombinations(powerLimit, maxPerTier) {
  const tiers = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id));
  // Without enemy context just count naively (for UI preview)
  let count = 0;
  function recurse(idx, remaining) {
    if (idx === tiers.length) { count++; return; }
    const tier = tiers[idx];
    const hardMax = Math.floor(remaining / tier.power);
    const userMax = maxPerTier ? (maxPerTier[tier.id] ?? hardMax) : hardMax;
    const max = Math.min(hardMax, userMax);
    for (let q = 0; q <= max; q++) recurse(idx + 1, remaining - q * tier.power);
  }
  recurse(0, powerLimit);
  return Math.max(0, count - 1);
}


// ===================== FAST SCAN =====================
// Greedy approach: tries formations from strongest down, stops after finding topN winners.
// Generates candidates ordered by total power (descending) using a priority approach.
// Does NOT optimize for blood essence — just finds formations that WIN.
async function runFastScan(enemyQtys, topN, stratKillE3, btn, fastBudget) {
  const tiers = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id));
  const maxPerTier = {};
  let minPerTier = null;
  tiers.forEach(t => {
    const el = document.getElementById(`opt-max-${t.id}`);
    maxPerTier[t.id] = el ? Math.max(0, parseInt(el.value) || 0) : Math.floor(ARMY_POWER_LIMIT / t.power);
  });

  // Apply smart preset if enabled
  const activePresetFS = getActiveSmartPreset();
  if (activePresetFS) {
    const ranges = window.BFPresets.buildRangesFromPreset(activePresetFS.preset, {
      range: activePresetFS.range,
      enemyQtys: enemyQtys,
      stratKillE3: stratKillE3,
    });
    minPerTier = ranges.minPerTier;
    Object.keys(ranges.maxPerTier).forEach(tid => {
      if (maxPerTier[tid] != null) {
        maxPerTier[tid] = Math.min(maxPerTier[tid], ranges.maxPerTier[tid]);
      } else {
        maxPerTier[tid] = ranges.maxPerTier[tid];
      }
    });
  }

  const results = [];
  let tested = 0;
  let lastYield = Date.now();
  const TARGET = Math.max(topN * 3, 20); // find 3× topN then stop

  // Strategy: iterate power levels from high to low.
  // For each power level, generate combinations using that exact power, simulate, collect winners.
  // This way we test "strongest" formations first without brute-forcing everything.

  // We generate in chunks ordered by descending total ally DPS estimate
  // Simple approach: sort all unlocked tiers by (dmg/power) desc — greedy fill best DPS tiers first
  const tiersByValue = [...tiers].sort((a, b) => (b.dmg / b.power) - (a.dmg / a.power));

  // v1.6.18 — use user-set Fast budget as candidate ceiling (was hardcoded 500k).
  // Default 50k if caller didn't pass it.
  const MAX_CANDIDATES = Math.max(1000, Math.min(5000000,
    parseInt(fastBudget) || 50000));

  document.getElementById('opt-progress-label').textContent = 'Fast Scan: generating candidates...';
  await new Promise(r => setTimeout(r, 0));

  // Use a smarter ordering: fill greedily then vary
  // Generate all valid combos but sorted by descending total power used
  const candidates = [];
  for (const qtys of generateCombinations(ARMY_POWER_LIMIT, maxPerTier, enemyQtys, minPerTier)) {
    const power = tiers.reduce((s, t) => s + (qtys[t.id] || 0) * t.power, 0);
    candidates.push({ qtys, power });
    if (candidates.length >= MAX_CANDIDATES) break;
    if (Date.now() - lastYield > 80) {
      document.getElementById('opt-progress-label').textContent =
        `Fast Scan: B&B generuje... ${candidates.length.toLocaleString()} candidates`;
      await new Promise(r => setTimeout(r, 0));
      if (_optCtl && _optCtl.cancelled) {
        document.getElementById('opt-progress-label').textContent =
          `⏹ Cancelled during candidate generation (${candidates.length.toLocaleString()} so far).`;
        return;
      }
      lastYield = Date.now();
    }
  }

  // Sort by descending power (strongest first)
  candidates.sort((a, b) => b.power - a.power);

  document.getElementById('opt-progress-label').textContent =
    `Fast Scan: simulujem ${candidates.length.toLocaleString()} candidates...`;
  await new Promise(r => setTimeout(r, 0));
  lastYield = Date.now();

  for (const { qtys: allyQtys, power } of candidates) {
    tested++;
    const result = simulateBattleSilent(allyQtys, enemyQtys);
    if (result && result.victory) {
      result.allyQtys = { ...allyQtys };
      result.power = power;
      result.totalCost = ALLY_TIERS.reduce((s, t) => s + (allyQtys[t.id] || 0) * t.cost, 0);
      if (!stratKillE3 || result.e3KilledRound1) results.push(result);
      if (results.length >= TARGET) break; // found enough winners
    }

    if (Date.now() - lastYield > 50) {
      const pct = Math.round((tested / candidates.length) * 100);
      document.getElementById('opt-progress-bar').style.width = pct + '%';
      document.getElementById('opt-progress-label').textContent =
        `Fast Scan: ${tested.toLocaleString()}/${candidates.length.toLocaleString()} (${pct}%) — winners found: ${results.length}`;
      await new Promise(r => setTimeout(r, 0));
      if (_optCtl && _optCtl.cancelled) {
        document.getElementById('opt-progress-label').textContent =
          `⏹ Cancelled at ${tested.toLocaleString()}/${candidates.length.toLocaleString()} (no results rendered).`;
        return;
      }
      lastYield = Date.now();
    }
  }

  document.getElementById('opt-progress-bar').style.width = '100%';
  document.getElementById('opt-progress-label').textContent =
    `✓ Fast Scan complete! Tested ${tested.toLocaleString()}, found ${results.length} winners`;
  btn.textContent = '⚙ Run Again';

  // Sort winners by ascending essence lost (cheapest win)
  results.sort((a, b) => a.essenceLost - b.essenceLost);
  renderOptimizerResults(results.slice(0, topN), tested);
}

async function runOptimizer() {
  const enemyQtys = { ...enemyQuantities };
  const enemyGroups = buildGroups('enemy', ENEMY_TIERS, enemyQtys);
  if (enemyGroups.length === 0) { alert('Set up the enemy army!'); return; }

  // Reset cancellation state for this run and reveal the Cancel button.
  // showCancelBtn(false) at the end of every path (success / cancel / error)
  // makes the button transient — visible only while work is in flight.
  newOptControl();
  showCancelBtn(true);

  try {
  const mode = document.querySelector('input[name="opt-mode"]:checked')?.value || 'deep';
  const priority = document.getElementById('opt-priority').value;
  const topN = parseInt(document.getElementById('opt-top').value);
  const stratKillE3 = document.getElementById('strat-kill-e3')?.checked || false;
  const useParallel = document.getElementById('opt-parallel')?.checked !== false;
  // v1.6.18 — read user's Fast Scan budget (clamped 1k..5M)
  const fastBudget = Math.max(1000, Math.min(5000000,
    parseInt(document.getElementById('opt-fastsims')?.value) || 50000));
  // Show a console hint if Fast is used with a low budget on what looks like
  // a high-power army. (The simulator doesn't know "layer" the way the bot
  // does, but we can use PowerLimit ≈ 240 as a proxy for L21+.)
  if (mode === 'fast' && fastBudget < 200000 && ARMY_POWER_LIMIT >= 240) {
    console.warn('[BF] Fast Scan @', fastBudget, 'sims with PowerLimit', ARMY_POWER_LIMIT,
      '— coverage may be insufficient. Consider Deep or budget 200k+.');
  }
  const btn = document.getElementById('opt-btn-label');
  btn.textContent = '⏳ Running...';
  document.getElementById('opt-progress').style.display = 'block';
  document.getElementById('opt-progress-bar').style.width = '0%';
  document.getElementById('opt-results').innerHTML = '';

  // Try parallel path first if requested and Worker is available
  if (useParallel && typeof Worker !== 'undefined' && supportsParallelOptimizer()) {
    try {
      await runParallelOptimizer({ enemyQtys, mode, priority, topN, stratKillE3, btn, fastBudget });
      return;
    } catch (err) {
      console.warn('[BF] Parallel optimizer failed, falling back to single-thread:', err);
      document.getElementById('opt-progress-label').textContent =
        'Parallel mode failed (' + (err && err.message ? err.message : 'unknown') + ') — falling back to single thread...';
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Fast Scan mode — separate algorithm (single thread)
  if (mode === 'fast') {
    await runFastScan(enemyQtys, topN, stratKillE3, btn, fastBudget);
    return;
  }

  // Deep Simulation mode (original B&B + full simulation, single thread)
  const maxPerTier = {};
  let minPerTier = null;
  ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id)).forEach(t => {
    const el = document.getElementById(`opt-max-${t.id}`);
    maxPerTier[t.id] = el ? Math.max(0, parseInt(el.value) || 0) : Math.floor(ARMY_POWER_LIMIT / t.power);
  });

  // Apply smart preset if enabled
  const activePresetDS = getActiveSmartPreset();
  if (activePresetDS) {
    const ranges = window.BFPresets.buildRangesFromPreset(activePresetDS.preset, {
      range: activePresetDS.range,
      enemyQtys: enemyQtys,
      stratKillE3: stratKillE3,
    });
    minPerTier = ranges.minPerTier;
    Object.keys(ranges.maxPerTier).forEach(tid => {
      if (maxPerTier[tid] != null) {
        maxPerTier[tid] = Math.min(maxPerTier[tid], ranges.maxPerTier[tid]);
      } else {
        maxPerTier[tid] = ranges.maxPerTier[tid];
      }
    });
  }

  const totalCombos = countCombinations(ARMY_POWER_LIMIT, maxPerTier);
  const results = [];
  let tested = 0;
  let lastYield = Date.now();

  for (const allyQtys of generateCombinations(ARMY_POWER_LIMIT, maxPerTier, enemyQtys, minPerTier)) {
    tested++;
    const result = simulateBattleSilent(allyQtys, enemyQtys);
    if (result) {
      result.allyQtys = { ...allyQtys };
      result.power = ALLY_TIERS.reduce((s, t) => s + (allyQtys[t.id] || 0) * t.power, 0);
      result.totalCost = ALLY_TIERS.reduce((s, t) => s + (allyQtys[t.id] || 0) * t.cost, 0);
      results.push(result);
    }
    if (Date.now() - lastYield > 50) {
      document.getElementById('opt-progress-label').textContent =
        `Deep Sim: ${tested.toLocaleString()} candidates (B&B pruning the rest)`;
      await new Promise(r => setTimeout(r, 0));
      // Honour cancel between batches. Inner loop body is too tight to check
      // every iteration without measurable overhead, but the 50ms yield is
      // also our cancellation polling interval — feels instant to the user.
      if (_optCtl && _optCtl.cancelled) {
        document.getElementById('opt-progress-label').textContent =
          `⏹ Cancelled at ${tested.toLocaleString()} candidates (no results rendered).`;
        const lbl = document.getElementById('opt-btn-label');
        if (lbl) lbl.textContent = '⚙ Run Optimizer';
        return;
      }
      lastYield = Date.now();
    }
  }

  let filtered;
  if (stratKillE3) {
    const withE3Kill = results.filter(r => r.e3KilledRound1);
    filtered = withE3Kill.length > 0 ? withE3Kill : results.slice();
  } else {
    filtered = results.slice();
  }

  filtered.sort((a, b) => {
    if (stratKillE3 && a.e3KilledRound1 !== b.e3KilledRound1) return b.e3KilledRound1 - a.e3KilledRound1;
    if (priority === 'win_essence') {
      if (a.victory !== b.victory) return b.victory - a.victory;
      return a.essenceLost - b.essenceLost;
    } else if (priority === 'win_units') {
      if (a.victory !== b.victory) return b.victory - a.victory;
      return b.unitsSurvived - a.unitsSurvived;
    } else {
      return a.essenceLost - b.essenceLost;
    }
  });

  document.getElementById('opt-progress-bar').style.width = '100%';
  document.getElementById('opt-progress-label').textContent =
    `✓ Deep Sim complete! Simulated ${tested.toLocaleString()} candidates z ~${totalCombos.toLocaleString()} possible`;
  btn.textContent = '⚙ Run Again';

  renderOptimizerResults(filtered.slice(0, topN), totalCombos);
  } finally {
    // Always hide Cancel — covers success, cancellation, thrown errors, and
    // the parallel→single-thread fallback path which `return`s mid-function.
    showCancelBtn(false);
  }
}

// ============================================================================
// PARALLEL OPTIMIZER (WebWorker pool)
// ----------------------------------------------------------------------------
// Splits the search space across N workers by partitioning the range of the
// "split tier" — by default T1, the highest-count common tier. Each worker
// gets a non-overlapping [splitMin, splitMax] range, so the union of their
// results is the complete search space with no duplicates.
// ============================================================================

function supportsParallelOptimizer() {
  // Require chrome runtime + sim_engine.js URL resolution
  return typeof chrome !== 'undefined'
      && typeof chrome.runtime !== 'undefined'
      && typeof chrome.runtime.getURL === 'function';
}

// Pick the tier to split on: prefer T1 (highest variability), else the
// unlocked tier with the lowest power cost (most combinations on that axis).
function pickSplitTier(maxPerTier) {
  const tiers = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id));
  // Default: T1 if unlocked
  const t1 = tiers.find(t => t.id === 'T1');
  if (t1 && (maxPerTier['T1'] || 0) > 0) return t1;
  // Otherwise pick the unlocked tier with cheapest power
  return tiers.slice().sort((a, b) => a.power - b.power)[0] || tiers[0];
}

function decideWorkerCount(splitTierMax) {
  const hw = (navigator && navigator.hardwareConcurrency) || 4;
  const cap = Math.max(2, Math.min(8, hw));
  // Don't spawn more workers than there are values to split
  return Math.max(1, Math.min(cap, Math.floor((splitTierMax + 1))));
}

function splitRanges(maxVal, n) {
  // Partition [0..maxVal] into n contiguous non-overlapping inclusive ranges
  const total = maxVal + 1;
  const base = Math.floor(total / n);
  const rem = total % n;
  const ranges = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < rem ? 1 : 0);
    if (size <= 0) continue;
    ranges.push([start, start + size - 1]);
    start += size;
  }
  return ranges;
}

function splitRangesWithOffset(minVal, maxVal, n) {
  // Partition [minVal..maxVal] inclusive into n contiguous non-overlapping ranges
  if (maxVal < minVal) return [[minVal, minVal]];
  const total = maxVal - minVal + 1;
  const base = Math.floor(total / n);
  const rem = total % n;
  const ranges = [];
  let start = minVal;
  for (let i = 0; i < n; i++) {
    const size = base + (i < rem ? 1 : 0);
    if (size <= 0) continue;
    ranges.push([start, start + size - 1]);
    start += size;
  }
  return ranges;
}

async function runParallelOptimizer({ enemyQtys, mode, priority, topN, stratKillE3, btn, fastBudget }) {
  // Resolve worker + engine URLs via chrome.runtime
  const workerUrl = chrome.runtime.getURL('js/optimizer_worker.js');
  const engineUrl = chrome.runtime.getURL('js/sim_engine.js');

  // Build maxPerTier from UI
  const maxPerTier = {};
  let minPerTier = null;
  ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id)).forEach(t => {
    const el = document.getElementById(`opt-max-${t.id}`);
    maxPerTier[t.id] = el ? Math.max(0, parseInt(el.value) || 0) : Math.floor(ARMY_POWER_LIMIT / t.power);
  });

  // Apply smart preset if enabled — narrows search to ±range around target counts
  const activePreset = getActiveSmartPreset();
  let presetSummary = '';
  if (activePreset) {
    const ranges = window.BFPresets.buildRangesFromPreset(activePreset.preset, {
      range: activePreset.range,
      enemyQtys: enemyQtys,
      stratKillE3: stratKillE3,
    });
    minPerTier = ranges.minPerTier;
    // Override maxPerTier with preset upper bounds (only for tiers covered by preset)
    Object.keys(ranges.maxPerTier).forEach(tid => {
      if (maxPerTier[tid] != null) {
        maxPerTier[tid] = Math.min(maxPerTier[tid], ranges.maxPerTier[tid]);
      } else {
        maxPerTier[tid] = ranges.maxPerTier[tid];
      }
    });
    const summaryParts = [];
    Object.keys(ranges.computed).forEach(tid => {
      const c = ranges.computed[tid];
      if (c.mode === 'auto' && c.autoMin != null) summaryParts.push(tid + '≥' + c.autoMin);
      else if (c.mode === 'range') summaryParts.push(tid + ':' + c.min + '-' + c.max);
      else if (c.mode === 'zero') summaryParts.push(tid + ':0');
    });
    presetSummary = ' [preset Lv' + activePreset.level + ': ' + summaryParts.join(' ') + ']';
  }

  const totalCombos = countCombinations(ARMY_POWER_LIMIT, maxPerTier);
  const splitTier = pickSplitTier(maxPerTier);
  const splitMax = Math.min(maxPerTier[splitTier.id] || 0, Math.floor(ARMY_POWER_LIMIT / splitTier.power));
  const splitMinPreset = (minPerTier && minPerTier[splitTier.id] != null) ? minPerTier[splitTier.id] : 0;

  if (splitMax < splitMinPreset) {
    throw new Error('split tier ' + splitTier.id + ' range invalid: min=' + splitMinPreset + ' > max=' + splitMax);
  }

  const workerCount = decideWorkerCount(splitMax - splitMinPreset);
  // Split the [splitMinPreset..splitMax] range across workers
  const ranges = splitRangesWithOffset(splitMinPreset, splitMax, workerCount);
  const unlockedAllyIds = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id)).map(t => t.id);

  // v1.6.18 — derive per-worker candidate cap from user's Fast budget.
  // Floor of 2000/worker so even small budgets give each worker room.
  // Deep mode ignores this (worker has no cap in deep).
  const _perWorkerFastCap = (mode === 'fast' && fastBudget)
    ? Math.max(2000, Math.ceil(Math.max(workerCount * 2000, fastBudget) / workerCount))
    : 200000;

  document.getElementById('opt-progress-label').textContent =
    `🚀 Spawning ${ranges.length} workers (split on ${splitTier.id}: ${splitMinPreset}..${splitMax})${presetSummary}…`;
  await new Promise(r => setTimeout(r, 0));

  // Spawn workers — handles are tracked in _optCtl.workers via
  // registerWorkerPromise (used by both the cancel handler and the final
  // cleanup below), so no separate local array is needed.
  const perWorkerProgress = new Array(ranges.length).fill(0);
  const perWorkerFound    = new Array(ranges.length).fill(0);
  let aggregatedResults = [];
  let totalTested = 0;
  let earlyStopRequested = false;

  const startTime = Date.now();

  const allDone = ranges.map((range, idx) => new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(workerUrl);
    } catch (err) {
      reject(new Error('Worker creation failed: ' + err.message));
      return;
    }
    // Register the worker + its resolver in _optCtl so requestOptimizerCancel
    // can both terminate the worker AND immediately resolve the promise. The
    // returned `safeResolve` wrapper also removes the resolver from the
    // pending list once fired, preventing the cancel handler from
    // double-firing it after a normal 'done' message has arrived.
    const safeResolve = registerWorkerPromise(w, idx, resolve);

    w.onerror = function (ev) {
      reject(new Error('Worker ' + idx + ' onerror: ' + (ev.message || 'unknown')));
    };
    w.onmessage = function (e) {
      const msg = e.data;
      if (msg.type === 'ready') {
        // Engine loaded — send the run command
        w.postMessage({
          type: 'run',
          mode: mode,
          powerLimit: ARMY_POWER_LIMIT,
          maxPerTier: maxPerTier,
          minPerTier: minPerTier,
          unlockedAllyIds: unlockedAllyIds,
          splitTierId: splitTier.id,
          splitMin: range[0],
          splitMax: range[1],
          enemyQtys: enemyQtys,
          stratKillE3: stratKillE3,
          targetWinners: Math.max(topN * 3, 20),
          maxCandidates: _perWorkerFastCap,
          progressEveryMs: 120,
        });
      } else if (msg.type === 'progress') {
        perWorkerProgress[idx] = msg.tested || 0;
        perWorkerFound[idx] = msg.found || 0;
      } else if (msg.type === 'done') {
        aggregatedResults = aggregatedResults.concat(msg.results || []);
        totalTested += msg.tested || 0;
        // Early stop for fast scan: if we already have plenty winners, ask others to stop.
        // Latent v1.4.0 bug fixed here too — previously the terminated workers
        // had pending promises that left Promise.all hanging. Now we force-
        // resolve every remaining resolver registered in _optCtl.
        if (mode === 'fast' && !earlyStopRequested) {
          const winners = aggregatedResults.filter(r => r.victory).length;
          if (winners >= Math.max(topN * 3, 20)) {
            earlyStopRequested = true;
            if (_optCtl) {
              _optCtl.workers.forEach(otherW => {
                if (otherW !== w) { try { otherW.terminate(); } catch (_) {} }
              });
              // Force-resolve every still-pending worker promise so Promise.all unblocks.
              _optCtl.pendingResolvers.slice().forEach(rec => {
                try { rec.resolve({ earlyStop: true }); } catch (_) {}
              });
              _optCtl.pendingResolvers.length = 0;
            }
          }
        }
        safeResolve();
      } else if (msg.type === 'error') {
        reject(new Error('Worker ' + idx + ': ' + msg.message + (msg.stack ? '\n' + msg.stack : '')));
      }
    };

    // Initialize worker with engine path
    w.postMessage({ type: 'init', enginePath: engineUrl });
  }));

  // UI progress poll while workers run
  const pollInterval = setInterval(() => {
    const tested = perWorkerProgress.reduce((s, v) => s + v, 0);
    const found = perWorkerFound.reduce((s, v) => s + v, 0) + aggregatedResults.length;
    const pct = totalCombos > 0 ? Math.min(99, Math.round((tested / totalCombos) * 100)) : 0;
    document.getElementById('opt-progress-bar').style.width = pct + '%';
    document.getElementById('opt-progress-label').textContent =
      `🚀 ${ranges.length} workers: ${tested.toLocaleString()} tested · ${found} found (${pct}%)`;
  }, 200);

  try {
    await Promise.all(allDone);
  } catch (err) {
    clearInterval(pollInterval);
    if (_optCtl) _optCtl.workers.forEach(w => { try { w.terminate(); } catch (_) {} });
    throw err;
  }
  clearInterval(pollInterval);
  if (_optCtl) _optCtl.workers.forEach(w => { try { w.terminate(); } catch (_) {} });

  // If the user cancelled mid-run, requestOptimizerCancel already updated the
  // progress label. Skip results rendering — a partial scan would mislead.
  if (_optCtl && _optCtl.cancelled) {
    return;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Final ranking
  let filtered;
  if (stratKillE3 && mode === 'deep') {
    const withE3Kill = aggregatedResults.filter(r => r.e3KilledRound1);
    filtered = withE3Kill.length > 0 ? withE3Kill : aggregatedResults.slice();
  } else {
    filtered = aggregatedResults.slice();
  }

  if (mode === 'fast') {
    // Fast Scan: only winners, sort cheapest first
    filtered = filtered.filter(r => r.victory);
    filtered.sort((a, b) => a.essenceLost - b.essenceLost);
  } else {
    filtered.sort((a, b) => {
      if (stratKillE3 && a.e3KilledRound1 !== b.e3KilledRound1) return b.e3KilledRound1 - a.e3KilledRound1;
      if (priority === 'win_essence') {
        if (a.victory !== b.victory) return b.victory - a.victory;
        return a.essenceLost - b.essenceLost;
      } else if (priority === 'win_units') {
        if (a.victory !== b.victory) return b.victory - a.victory;
        return b.unitsSurvived - a.unitsSurvived;
      } else {
        return a.essenceLost - b.essenceLost;
      }
    });
  }

  document.getElementById('opt-progress-bar').style.width = '100%';
  document.getElementById('opt-progress-label').textContent =
    `✓ ${mode === 'fast' ? 'Fast Scan' : 'Deep Sim'} complete (🚀 ${ranges.length} workers, ${elapsed}s)! ` +
    `Tested ${totalTested.toLocaleString()} / ~${totalCombos.toLocaleString()} possible`;
  btn.textContent = '⚙ Run Again';

  renderOptimizerResults(filtered.slice(0, topN), totalCombos);
}

function renderOptimizerResults(results, totalCombos) {
  const container = document.getElementById('opt-results');
  if (results.length === 0) { container.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:1rem">No results</div>'; return; }

  const winCount = results.filter(r => r.victory).length;
  let html = `<div style="font-family:Cinzel,serif;font-size:0.7rem;color:var(--text-dim);letter-spacing:.1em;margin-bottom:0.8rem">
    TOP ${results.length} FORMATIONS &nbsp;|&nbsp; ${winCount} victorious
  </div>`;

  results.forEach((r, i) => {
    const borderColor = r.victory ? '#27ae60' : r.draw ? '#f39c12' : '#c0392b';
    const icon = r.victory ? '🏆' : r.draw ? '⚔' : '💀';
    const statusColor = r.victory ? '#2ecc71' : r.draw ? '#f39c12' : '#e74c3c';
    const statusText = r.victory ? 'VICTORY' : r.draw ? 'DRAW' : 'DEFEAT';

    // Build unit badges
    const unitBadges = ALLY_TIERS.map(t => {
      const q = r.allyQtys[t.id] || 0;
      if (q === 0) return '';
      return `<span style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:3px;padding:1px 7px;font-size:0.7rem;color:var(--gold-light)">${t.label} ×${q}</span>`;
    }).join('');

    html += `
      <div class="opt-result-card" style="background:var(--panel2);border:1px solid ${borderColor};border-radius:4px;padding:0.8rem;margin-bottom:0.6rem;cursor:pointer;transition:box-shadow 0.2s"
           data-hover-shadow="0 0 12px ${borderColor}44">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:4px">
          <span style="font-family:Cinzel,serif;font-size:0.78rem;color:var(--gold)">#${i+1} Formation</span>
          <span style="color:${statusColor};font-family:Cinzel,serif;font-size:0.72rem">${icon} ${statusText} (kolo ${r.rounds})</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${unitBadges || '<span style="color:var(--text-dim);font-size:0.7rem">empty</span>'}</div>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:0.72rem;color:var(--text-dim);border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;align-items:center">
          <span>⚡ Power: <b style="color:var(--text)">${r.power}/${ARMY_POWER_LIMIT}</b></span>
          <span>💰 Cost: <b style="color:var(--gold-light)">${r.totalCost} 🩸</b></span>
          <span>☠ Loss: <b style="color:#e74c3c">${r.essenceLost} 🩸</b></span>
          <span>✓ Survived: <b style="color:#2ecc71">${r.unitsSurvived} units</b></span>
          ${r.e3KilledRound1 ? '<span style="color:#9b59b6;font-family:Cinzel,serif;font-size:0.65rem">☠ E3 round 1</span>' : ''}
          <button class="opt-apply-btn" data-formation='${JSON.stringify(r.allyQtys)}'
            style="margin-left:auto;font-family:Cinzel,serif;font-size:0.65rem;padding:3px 10px;border:1px solid var(--gold);background:transparent;color:var(--gold);cursor:pointer;border-radius:2px;transition:all 0.15s">
            ← Apply
          </button>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function applyFormation(qtysObj) {
  ALLY_TIERS.forEach(t => { allyQuantities[t.id] = qtysObj[t.id] || 0; });
  renderBuilder();
  closeOptimizer();
}

// ============================================================================
// SIMULATION HISTORY — last N manual simulations
// ============================================================================
// Triggered only from startBattle() (manual ⚔ Start Battle), NOT from the
// optimizer's silent batch simulations. Each entry stores the formation,
// power limit, and result summary so the user can review and reapply.

// In-memory selection state for the Compare feature. Holds 0–2 history
// indices. Not persisted — if the user reloads the iframe, selection
// resets, which is fine because the history list itself may have rotated
// new entries to the front.
let _compareSelection = [];

function toggleCompareSelection(idx) {
  const pos = _compareSelection.indexOf(idx);
  if (pos >= 0) {
    _compareSelection.splice(pos, 1);
  } else {
    if (_compareSelection.length >= 2) {
      // Already 2 selected — silently no-op. The checkbox in the UI is
      // disabled in this state, but a fast double-click could still get
      // through, so guard here too.
      return false;
    }
    _compareSelection.push(idx);
  }
  renderHistory();
  return true;
}

function pushHistory(allyQtys, enemyQtys, powerLimit, engineResult) {
  if (!engineResult) return;

  // Engine returns lossesPerTier { T1: {lost, survived, qty}, ... } for ally side.
  // For enemy per-tier we build the same shape from engineResult.finalState,
  // which lists every group on both sides with end-of-battle aliveUnits.
  const allyLosses = {};
  ALLY_TIERS.forEach(t => {
    const q = allyQtys[t.id] || 0;
    if (q === 0) return;
    const eng = engineResult.lossesPerTier && engineResult.lossesPerTier[t.id];
    if (eng) {
      allyLosses[t.id] = { qty: eng.qty, survived: eng.survived, lost: eng.lost };
    } else {
      // Defensive fallback — should never happen since engine iterates all ally groups
      allyLosses[t.id] = { qty: q, survived: 0, lost: q };
    }
  });

  // Enemy per-tier from finalState. Only include tiers that started > 0
  // (E9S spiderlings that may spawn mid-battle are skipped — they're not
  // part of the user's tracked enemy composition).
  const enemyLosses = {};
  const finalById = {};
  if (Array.isArray(engineResult.finalState)) {
    engineResult.finalState.forEach(fs => {
      if (fs.side === 'enemy') finalById[fs.id] = fs;
    });
  }
  ENEMY_TIERS.forEach(t => {
    const q = enemyQtys[t.id] || 0;
    if (q === 0) return;
    const fs = finalById[t.id];
    const survived = fs ? (fs.alive ? fs.aliveUnits : 0) : 0;
    enemyLosses[t.id] = { qty: q, survived: survived, lost: q - survived };
  });

  // Roll-up totals (used for the card header summary)
  let totalAllyStart = 0, totalAllySurv = 0;
  Object.values(allyLosses).forEach(v => { totalAllyStart += v.qty; totalAllySurv += v.survived; });
  let totalEnemyStart = 0, totalEnemyKilled = 0;
  Object.values(enemyLosses).forEach(v => { totalEnemyStart += v.qty; totalEnemyKilled += v.lost; });

  const entry = {
    t: Date.now(),
    ally:  { ...allyQtys },
    enemy: { ...enemyQtys },
    powerLimit: powerLimit,
    victory: !!engineResult.victory,
    draw:    !!engineResult.draw,
    rounds:  engineResult.rounds || 0,
    essenceLost: (engineResult.essenceLost != null) ? engineResult.essenceLost : 0,
    // v2 fields — per-tier breakdown
    allyLosses:  allyLosses,
    enemyLosses: enemyLosses,
    totalAllyStart: totalAllyStart,
    totalAllySurv:  totalAllySurv,
    totalEnemyStart: totalEnemyStart,
    totalEnemyKilled: totalEnemyKilled,
  };
  const list = lsGet(LS_KEY_HISTORY) || [];
  list.unshift(entry);

  // Pinned-aware FIFO eviction. Strategy:
  //   1. While there are more than LS_HISTORY_MAX *unpinned* entries, drop
  //      the oldest unpinned one (i.e. the last unpinned entry in the
  //      newest-first array).
  //   2. As a last-resort safety, if the total still exceeds
  //      LS_HISTORY_TOTAL_CAP (extremely rare — implies many pins), drop
  //      the oldest entry of any kind. Better to lose a pin than to grow
  //      unbounded in localStorage.
  let unpinnedCount = list.filter(e => !e.pinned).length;
  while (unpinnedCount > LS_HISTORY_MAX) {
    // Find last (oldest) unpinned entry, since list is newest-first.
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].pinned) { list.splice(i, 1); break; }
    }
    unpinnedCount--;
  }
  while (list.length > LS_HISTORY_TOTAL_CAP) {
    list.pop();
  }

  lsSet(LS_KEY_HISTORY, list);
  // pushHistory shifts all existing indexes by +1 (unshift), and may evict
  // the oldest entry. Easiest correct behaviour: clear the selection — the
  // user has just run a new battle and almost certainly wants to compare
  // against THAT, not whatever they had selected before.
  _compareSelection = [];
  renderHistory();
}

// Load and sort history for display. Pinned entries always come first
// (with newest pinned at the top of the pinned group), then unpinned
// (newest first). All consumers use this view, so `data-history-idx` in
// the DOM corresponds to a position in the SORTED array — which is what
// the user sees. We pass the sorted index everywhere; lookups back into
// the raw LS array go through this helper too.
function loadHistorySorted() {
  const raw = lsGet(LS_KEY_HISTORY) || [];
  // Stable sort: pinned first, then by timestamp descending.
  // Both branches return the same comparator if pinned status matches.
  return raw.slice().sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;        // pinned first
    return (b.t || 0) - (a.t || 0);       // newest first within group
  });
}

// Helpers for write paths — given a sorted-view index, find the entry's
// position in the raw LS array so we can mutate it in place.
function rawIndexForSortedIndex(sortedIdx) {
  const sorted = loadHistorySorted();
  const entry = sorted[sortedIdx];
  if (!entry) return -1;
  const raw = lsGet(LS_KEY_HISTORY) || [];
  // Use timestamp as the unique key — pushHistory stamps Date.now() and
  // even sub-millisecond duplicates would still resolve to one entry first.
  return raw.findIndex(e => e.t === entry.t);
}

// ============================================================================
// PIN HISTORY ENTRY
// ----------------------------------------------------------------------------
// Pinned entries are exempt from FIFO eviction in pushHistory. They still
// participate in reapply, compare, and clear-all. Toggle only writes to LS
// and re-renders — no side effects on simulator state.
function toggleHistoryPin(sortedIdx) {
  const raw = lsGet(LS_KEY_HISTORY) || [];
  const rawIdx = rawIndexForSortedIndex(sortedIdx);
  if (rawIdx < 0) return;
  raw[rawIdx].pinned = !raw[rawIdx].pinned;
  lsSet(LS_KEY_HISTORY, raw);
  // Pin toggle re-orders the list (sorted view), so any active compare
  // selection on sorted indexes is now stale. Clearing is the safest
  // option — the user can re-select after seeing the new order.
  _compareSelection = [];
  renderHistory();
}


function humanAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.floor(s / 60) + 'min ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function renderHistory() {
  const container = document.getElementById('sim-history-list');
  if (!container) return;
  const list = loadHistorySorted();
  if (list.length === 0) {
    container.innerHTML = '<span style="font-size:0.66rem;color:var(--text-dim);'
      + 'font-style:italic">No simulations yet — click ⚔ Start Battle.</span>';
    return;
  }

  // Helper: render one side's per-tier loss table (ally or enemy).
  // For ally: green = all survived, orange = partial loss, red = wiped.
  // For enemy: green = all killed (good), red = some survived (bad).
  function tierRowsHtml(losses, side) {
    const ids = side === 'ally'
      ? ALLY_TIERS.map(t => t.id)
      : ENEMY_TIERS.map(t => t.id);
    const rows = [];
    ids.forEach(id => {
      const v = losses[id];
      if (!v || v.qty === 0) return;
      let color, marker;
      if (side === 'ally') {
        // From the user's perspective: surviving allies is good.
        if (v.survived === v.qty)      { color = '#2ecc71'; marker = '✓'; }
        else if (v.survived === 0)     { color = '#e74c3c'; marker = '☠ wiped'; }
        else                           { color = '#e67e22'; marker = '−' + v.lost + ' ☠'; }
      } else {
        // For enemies, the good outcome is total annihilation.
        if (v.survived === 0)          { color = '#2ecc71'; marker = '✓ killed'; }
        else if (v.survived === v.qty) { color = '#e74c3c'; marker = '✗ all alive'; }
        else                           { color = '#f39c12'; marker = v.survived + ' alive'; }
      }
      rows.push(''
        + '<div style="display:flex;justify-content:space-between;align-items:center;'
        +   'font-size:0.62rem;line-height:1.45;padding:1px 0">'
        +   '<span style="color:var(--text-dim);min-width:26px;font-family:Cinzel,serif">' + id + '</span>'
        +   '<span style="color:' + color + ';flex:1;text-align:center">'
        +     v.survived + '/' + v.qty
        +   '</span>'
        +   '<span style="color:' + color + ';font-size:0.6rem;text-align:right;min-width:64px">' + marker + '</span>'
        + '</div>');
    });
    return rows.join('') || '<div style="font-size:0.6rem;color:var(--text-dim);font-style:italic">none</div>';
  }

  // Pre-compute outside the map: if 2 cards are already selected, the
  // others' checkboxes are visually disabled (prevents a 3rd selection).
  const selectionFull = _compareSelection.length >= 2;

  container.innerHTML = list.map((e, idx) => {
    const isSelected = _compareSelection.indexOf(idx) >= 0;
    const status = e.draw
      ? { icon: '⚔', color: '#f39c12', text: 'DRAW' }
      : e.victory
        ? { icon: '🏆', color: '#2ecc71', text: 'VICTORY' }
        : { icon: '💀', color: '#e74c3c', text: 'DEFEAT' };
    const ago = humanAgo(e.t);
    const pl  = e.powerLimit ? ('PL ' + e.powerLimit + ' · ') : '';

    // v2 entries have per-tier loss data; if a v1 entry somehow survived
    // an LS-key bump (or this is a future-format entry) we fall back to
    // an empty breakdown table rather than crashing.
    const allyLosses  = e.allyLosses  || {};
    const enemyLosses = e.enemyLosses || {};
    const totalAllyStart  = e.totalAllyStart  != null ? e.totalAllyStart  : 0;
    const totalAllySurv   = e.totalAllySurv   != null ? e.totalAllySurv   : 0;
    const totalEnemyStart = e.totalEnemyStart != null ? e.totalEnemyStart : 0;
    const totalEnemyKill  = e.totalEnemyKilled != null ? e.totalEnemyKilled : 0;

    return ''
      + '<div class="sim-history-card" data-history-idx="' + idx + '" '
      + 'style="background:rgba(0,0,0,0.3);border:1px solid '
      +   (isSelected ? '#9b59b6' : (e.pinned ? '#c9a84c' : 'var(--border)')) + ';'
      + 'border-radius:3px;padding:7px 9px;display:flex;flex-direction:column;'
      + 'gap:5px;min-width:230px;flex:1 1 250px;max-width:320px;'
      + 'position:relative;'
      + 'box-shadow:' + (isSelected
          ? '0 0 0 1px rgba(155,89,182,0.4)'
          : (e.pinned ? '0 0 0 1px rgba(201,168,76,0.25)' : 'none')) + '">'
      // Pinned ribbon — small floating tag in the top-right corner.
      // Positioned absolutely so it doesn't disturb the existing header layout.
      + (e.pinned
        ? '<span style="position:absolute;top:-8px;right:8px;'
          + 'background:var(--card);border:1px solid #c9a84c;border-radius:3px;'
          + 'padding:1px 6px;color:#c9a84c;font-family:Cinzel,serif;'
          + 'font-size:0.55rem;letter-spacing:.12em;line-height:1.2">📌 PINNED</span>'
        : '')
      // Header row — checkbox + status + meta
      +   '<div style="display:flex;align-items:center;gap:6px;justify-content:space-between">'
      +     '<label style="display:flex;align-items:center;gap:5px;cursor:' + (selectionFull && !isSelected ? 'not-allowed' : 'pointer') + ';margin:0">'
      +       '<input type="checkbox" class="sim-history-compare-cb" data-history-idx="' + idx + '" '
      +         (isSelected ? 'checked' : '')
      +         (selectionFull && !isSelected ? ' disabled' : '')
      +         ' style="accent-color:#9b59b6;cursor:inherit;margin:0;width:13px;height:13px">'
      +       '<span style="color:' + status.color + ';font-family:Cinzel,serif;'
      +         'font-size:0.72rem;font-weight:bold">' + status.icon + ' ' + status.text + '</span>'
      +     '</label>'
      +     '<span style="font-size:0.58rem;color:var(--text-dim)">' + pl + 'R' + e.rounds + ' · ' + ago + '</span>'
      +   '</div>'
      // Allies block
      +   '<div style="margin-top:1px">'
      +     '<div style="display:flex;justify-content:space-between;align-items:center;'
      +       'font-size:0.6rem;color:var(--gold-light);font-family:Cinzel,serif;'
      +       'letter-spacing:.08em;padding-bottom:2px;border-bottom:1px solid rgba(201,168,76,0.12)">'
      +       '<span>⚔ ALLIES</span>'
      +       '<span style="color:' + (totalAllySurv === totalAllyStart ? '#2ecc71' : totalAllySurv === 0 ? '#e74c3c' : '#e67e22') + '">'
      +         totalAllySurv + '/' + totalAllyStart + '</span>'
      +     '</div>'
      +     tierRowsHtml(allyLosses, 'ally')
      +   '</div>'
      // Enemies block
      +   '<div>'
      +     '<div style="display:flex;justify-content:space-between;align-items:center;'
      +       'font-size:0.6rem;color:#e74c3c;font-family:Cinzel,serif;'
      +       'letter-spacing:.08em;padding-bottom:2px;border-bottom:1px solid rgba(231,76,60,0.15)">'
      +       '<span>💀 ENEMIES</span>'
      +       '<span style="color:' + (totalEnemyKill === totalEnemyStart ? '#2ecc71' : totalEnemyKill === 0 ? '#e74c3c' : '#f39c12') + '">'
      +         'killed ' + totalEnemyKill + '/' + totalEnemyStart + '</span>'
      +     '</div>'
      +     tierRowsHtml(enemyLosses, 'enemy')
      +   '</div>'
      // Essence + reapply
      +   '<div style="display:flex;justify-content:space-between;align-items:center;'
      +     'font-size:0.66rem;margin-top:2px;padding-top:4px;'
      +     'border-top:1px solid rgba(255,255,255,0.05)">'
      +     '<span style="color:var(--text-dim);font-family:Cinzel,serif;font-size:0.6rem;letter-spacing:.08em">BLOOD ESSENCE</span>'
      +     '<span style="color:#f0d080;font-weight:bold">−' + e.essenceLost + ' 🩸</span>'
      +   '</div>'
      +   '<div style="display:flex;gap:5px;margin-top:1px">'
      +     '<button class="sim-history-pin" data-history-idx="' + idx + '" '
      +       'title="' + (e.pinned ? 'Unpin — allow FIFO eviction' : 'Pin — exempt from auto-eviction') + '" '
      +       'style="flex:0 0 auto;background:' + (e.pinned ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.05)') + ';'
      +       'border:1px solid ' + (e.pinned ? '#c9a84c' : '#5a4a1a') + ';'
      +       'color:' + (e.pinned ? '#c9a84c' : 'var(--text-dim)') + ';'
      +       'font-family:Cinzel,serif;font-size:0.6rem;padding:3px 9px;'
      +       'border-radius:2px;cursor:pointer">' + (e.pinned ? '📍 Unpin' : '📌 Pin') + '</button>'
      +     '<button class="sim-history-apply" data-history-idx="' + idx + '" '
      +       'style="flex:1;background:rgba(155,89,182,0.15);border:1px solid #8e44ad;'
      +       'color:#9b59b6;font-family:Cinzel,serif;font-size:0.6rem;padding:3px 0;'
      +       'border-radius:2px;cursor:pointer">↻ Reapply formation</button>'
      +   '</div>'
      // 📥 To Preset — only meaningful on VICTORY (defeat/draw formations
      // are bad candidates for the bot's preset library). Sends the
      // formation + enemy composition + chosen level to bot.js via
      // postMessage; bot.js writes to chrome.storage under the current
      // character's preset key.
      + (e.victory ? (''
      +   '<button class="sim-history-to-preset" data-history-idx="' + idx + '" '
      +     'title="Save this winning formation as a Ruins preset" '
      +     'style="margin-top:3px;background:rgba(46,204,113,0.1);border:1px solid #27ae60;'
      +     'color:#2ecc71;font-family:Cinzel,serif;font-size:0.6rem;padding:3px 0;'
      +     'border-radius:2px;cursor:pointer;width:100%">'
      +     '📥 Save as Ruins preset</button>'
      ) : '')
      + '</div>';
  }).join('');

  // Append the Compare action row directly into the card container so it
  // sits visually below the cards but inside the same flex layout. The row
  // takes the full width (flex-basis 100%) so it doesn't get squeezed
  // between cards on wider viewports.
  if (list.length >= 2) {
    const n = _compareSelection.length;
    const ready = (n === 2);
    const msg = n === 0 ? 'Select 2 cards to compare'
              : n === 1 ? 'Select 1 more card to compare'
              : '2 selected — ready to compare';
    container.innerHTML += ''
      + '<div style="flex:1 1 100%;display:flex;align-items:center;justify-content:space-between;'
      +   'gap:8px;margin-top:4px;padding:6px 8px;background:rgba(0,0,0,0.2);'
      +   'border:1px solid rgba(155,89,182,' + (ready ? '0.4' : '0.15') + ');border-radius:3px">'
      +   '<span style="font-size:0.65rem;color:' + (ready ? '#9b59b6' : 'var(--text-dim)') + ';font-family:Cinzel,serif;letter-spacing:.06em">'
      +     (ready ? '↔ ' : '') + msg
      +   '</span>'
      +   '<div style="display:flex;gap:6px">'
      +     (n > 0
        ? '<button id="btn-clear-compare" style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:Cinzel,serif;font-size:0.62rem;padding:3px 10px;border-radius:2px;cursor:pointer">Deselect</button>'
        : '')
      +     '<button id="btn-open-compare" ' + (ready ? '' : 'disabled ')
      +       'style="background:rgba(155,89,182,' + (ready ? '0.25' : '0.05') + ');'
      +       'border:1px solid ' + (ready ? '#9b59b6' : '#2a1218') + ';'
      +       'color:' + (ready ? '#9b59b6' : 'var(--text-dim)') + ';'
      +       'font-family:Cinzel,serif;font-size:0.66rem;padding:3px 14px;'
      +       'border-radius:2px;cursor:' + (ready ? 'pointer' : 'not-allowed') + '">'
      +       '↔ Compare</button>'
      +   '</div>'
      + '</div>';
  }
}

function applyHistoryEntry(idx) {
  // idx is a sorted-view index (matches what the user sees and what
  // data-history-idx encodes in the DOM). loadHistorySorted() applies
  // the same pinned-first + newest-first ordering renderHistory uses.
  const list = loadHistorySorted();
  const entry = list[idx];
  if (!entry) return;
  // Make sure all tiers referenced in the snapshot are unlocked, otherwise
  // their qty fields won't render and the formation would silently lose units.
  let unlockChanged = false;
  ALLY_TIERS.forEach(t => {
    const q = entry.ally[t.id] || 0;
    if (q > 0 && !unlockedAllyTiers.has(t.id)) { unlockedAllyTiers.add(t.id); unlockChanged = true; }
    allyQuantities[t.id] = q;
  });
  ENEMY_TIERS.forEach(t => {
    const q = entry.enemy[t.id] || 0;
    if (q > 0 && !unlockedEnemyTiers.has(t.id)) { unlockedEnemyTiers.add(t.id); unlockChanged = true; }
    enemyQuantities[t.id] = q;
  });
  if (unlockChanged) {
    lsSet(LS_KEY_UNLOCK_ALLY,  [...unlockedAllyTiers]);
    lsSet(LS_KEY_UNLOCK_ENEMY, [...unlockedEnemyTiers]);
  }
  if (entry.powerLimit) {
    const inp = document.getElementById('power-limit-input-el');
    if (inp) inp.value = entry.powerLimit;
    ARMY_POWER_LIMIT = Math.max(1, entry.powerLimit);
  }
  renderBuilder();
}

function clearHistory() {
  lsRemove(LS_KEY_HISTORY);
  _compareSelection = [];
  renderHistory();
}

// ============================================================================
// SEND HISTORY ENTRY → BOT PRESET (v1.5.7)
// ============================================================================
// Bridges the simulator's history into the bot's Ruins Preset Formations
// store. The simulator iframe doesn't have direct chrome.storage access
// (different origin and no SERVER_ID/PLAYER_ID context), so we postMessage
// to bot.js which lives in the page's content-script context. Bot.js
// validates and writes; we display feedback based on the BF_ADD_PRESET_ACK
// echo it sends back.

// One-shot ack tracker keyed by button element so multiple cards being
// queued in rapid succession don't cross-fire each other's feedback.
const _presetAckPending = new Map();

// Attach the ack listener exactly once on first send. We can't safely
// attach it inside an IIFE block at module load because the simulator
// uses no IIFE — keeping it lazy is harmless and avoids any race with
// the bot.js side coming up.
let _presetAckListenerAttached = false;
function ensurePresetAckListener() {
  if (_presetAckListenerAttached) return;
  _presetAckListenerAttached = true;
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'BF_ADD_PRESET_ACK') return;
    // We don't tie ack to a specific button reliably (level+enemy combo
    // would work, but a user pressing two times for the same target is
    // edge-case), so we just fire the first pending button's success
    // animation. Good enough for the workflow.
    const entries = Array.from(_presetAckPending.entries());
    if (entries.length === 0) return;
    const [btn] = entries[0];
    _presetAckPending.delete(btn);
    flashButton(btn,
      { bg: 'rgba(46,204,113,0.2)', fg: '#2ecc71', border: '#27ae60' },
      m.updated ? '✓ Updated' : '✓ Saved L' + m.level,
      1500
    );
  });
}

function sendHistoryToPreset(sortedIdx, buttonEl) {
  ensurePresetAckListener();
  const list = loadHistorySorted();
  const entry = list[sortedIdx];
  if (!entry || !entry.victory) return; // safety — UI shouldn't even offer this on non-victory

  // Build the formation + enemy payloads. Both are plain {TierId: qty}
  // maps with only non-zero entries. Bot.js sanitizes again on receipt.
  const formation = {};
  ALLY_TIERS.forEach(t => {
    const q = (entry.ally && entry.ally[t.id]) || 0;
    if (q > 0) formation[t.id] = q;
  });
  const enemy = {};
  ENEMY_TIERS.forEach(t => {
    const q = (entry.enemy && entry.enemy[t.id]) || 0;
    if (q > 0) enemy[t.id] = q;
  });
  if (Object.keys(formation).length === 0 || Object.keys(enemy).length === 0) {
    flashButton(buttonEl,
      { bg: 'rgba(231,76,60,0.2)', fg: '#e74c3c', border: '#c0392b' },
      '✗ Empty formation', 1500);
    return;
  }

  // Prompt for level. We can't reliably derive the Ruins level from the
  // history entry (powerLimit is the cap, not the level number), so we
  // ask. Default value tries a last-used cache for quality-of-life.
  const lastUsed = lsGet('bf_sim_last_preset_level') || '';
  const raw = prompt('Save as Ruins preset for which level? (1–30)', lastUsed);
  if (raw === null) return; // user cancelled
  const lvl = parseInt(raw.trim(), 10);
  if (isNaN(lvl) || lvl < 1 || lvl > 30) {
    flashButton(buttonEl,
      { bg: 'rgba(231,76,60,0.2)', fg: '#e74c3c', border: '#c0392b' },
      '✗ Invalid level', 1500);
    return;
  }
  lsSet('bf_sim_last_preset_level', String(lvl));

  // Visual: button goes amber while we wait for ack.
  flashButton(buttonEl,
    { bg: 'rgba(243,156,18,0.15)', fg: '#f39c12', border: '#d68910' },
    '⏳ Sending…', 5000);
  _presetAckPending.set(buttonEl, Date.now());

  // postMessage to parent (the BiteFight page). Bot.js's listener
  // catches it there. We use '*' as targetOrigin because the iframe
  // is at chrome-extension://<id> and the parent is the game's HTTPS
  // origin — a strict match would require either knowing the page's
  // exact origin or omitting the check entirely.
  try {
    window.parent.postMessage({
      type: 'BF_ADD_PRESET',
      level: lvl,
      enemy: enemy,
      formation: formation,
    }, '*');
  } catch (e) {
    _presetAckPending.delete(buttonEl);
    flashButton(buttonEl,
      { bg: 'rgba(231,76,60,0.2)', fg: '#e74c3c', border: '#c0392b' },
      '✗ Send failed', 1500);
    return;
  }

  // Timeout safety: if no ack arrives within 4s, clear the pending
  // state and show a soft warning. Most likely bot.js isn't loaded
  // (user is on a page where the bot doesn't inject — e.g. lobby).
  setTimeout(() => {
    if (_presetAckPending.has(buttonEl)) {
      _presetAckPending.delete(buttonEl);
      flashButton(buttonEl,
        { bg: 'rgba(243,156,18,0.2)', fg: '#f39c12', border: '#d68910' },
        '⚠ No ack', 1800);
    }
  }, 4000);
}

// ============================================================================
// COMPARE — side-by-side diff of two history entries
// ============================================================================
// Reads from LS_KEY_HISTORY using the two indexes in _compareSelection.
// Pure rendering — no engine calls, no mutations.

function openCompareModal() {
  if (_compareSelection.length !== 2) return;
  // Selection indexes are SORTED-VIEW indexes (what the user clicked in the
  // rendered card list). loadHistorySorted() applies the same ordering, so
  // list[selectionIdx] resolves to the correct entry.
  const list = loadHistorySorted();
  const a = list[_compareSelection[0]];
  const b = list[_compareSelection[1]];
  if (!a || !b) {
    // Index drifted (e.g. user cleared history in another tab). Reset and bail.
    _compareSelection = [];
    renderHistory();
    return;
  }
  // We label the OLDER entry as "A" and the NEWER as "B" so deltas read as
  // "B vs A" (newer vs older), which is the natural reading direction for
  // experimentation: "compared to the previous attempt, how did this go?".
  // List is newest-first → smaller index = newer. Swap so a = older, b = newer.
  let older = a, newer = b;
  if (_compareSelection[0] < _compareSelection[1]) {
    older = b;
    newer = a;
  }
  renderCompare(older, newer);
  const modal = document.getElementById('compare-modal');
  if (modal) modal.style.display = 'block';
}

function closeCompareModal() {
  const modal = document.getElementById('compare-modal');
  if (modal) modal.style.display = 'none';
}

function renderCompare(A, B) {
  // A = older, B = newer. Tables read left → right: A | B | Δ.
  const body = document.getElementById('compare-body');
  if (!body) return;

  function outcomeOf(e) {
    if (e.draw)    return { icon: '⚔', color: '#f39c12', text: 'DRAW' };
    if (e.victory) return { icon: '🏆', color: '#2ecc71', text: 'VICTORY' };
    return                 { icon: '💀', color: '#e74c3c', text: 'DEFEAT' };
  }
  const oA = outcomeOf(A), oB = outcomeOf(B);

  // Δ helper — returns colored span. Positive deltas are formatted as +N,
  // negative as −N. The "good direction" varies by metric so we pass it in:
  //   goodDir = +1 → larger is better (e.g. ally survived)
  //   goodDir = -1 → smaller is better (e.g. essence lost, rounds, enemies alive)
  //   goodDir = 0  → neutral colour (just show the number)
  function delta(valA, valB, goodDir) {
    const d = valB - valA;
    if (d === 0) return '<span style="color:var(--text-dim)">±0</span>';
    const sign = d > 0 ? '+' : '−';
    const abs = Math.abs(d);
    let color = 'var(--text-dim)';
    if (goodDir > 0) color = (d > 0) ? '#2ecc71' : '#e74c3c';
    if (goodDir < 0) color = (d < 0) ? '#2ecc71' : '#e74c3c';
    return '<span style="color:' + color + ';font-weight:bold">' + sign + abs + '</span>';
  }

  // Per-tier comparison rows for one side. tiersOrder defines the canonical
  // order; we include any tier that appears in either entry (so a tier the
  // user added or removed between attempts still shows up).
  function tierCompareRows(lossesA, lossesB, tiersOrder, side) {
    const ids = tiersOrder.map(t => t.id);
    const rows = [];
    ids.forEach(id => {
      const a = lossesA[id];
      const b = lossesB[id];
      if (!a && !b) return;
      const qtyA = a ? a.qty : 0;
      const qtyB = b ? b.qty : 0;
      const survA = a ? a.survived : 0;
      const survB = b ? b.survived : 0;
      // Skip rows where both entries didn't field this tier at all
      if (qtyA === 0 && qtyB === 0) return;

      // For ally rows we care that allies survived; for enemy rows we care
      // that enemies died (fewer survivors = better).
      const survGoodDir = side === 'ally' ? +1 : -1;
      // qty change is informational, not "good/bad" inherently
      const qtyGoodDir  = 0;

      rows.push(''
        + '<tr>'
        +   '<td style="padding:3px 6px;color:var(--text-dim);font-family:Cinzel,serif">' + id + '</td>'
        +   '<td style="padding:3px 6px;text-align:center">' + survA + '/' + qtyA + '</td>'
        +   '<td style="padding:3px 6px;text-align:center">' + survB + '/' + qtyB + '</td>'
        +   '<td style="padding:3px 6px;text-align:right;font-size:0.66rem">'
        +     'qty ' + delta(qtyA, qtyB, qtyGoodDir)
        +     ' · surv ' + delta(survA, survB, survGoodDir)
        +   '</td>'
        + '</tr>');
    });
    return rows.join('')
      || '<tr><td colspan="4" style="padding:6px;color:var(--text-dim);font-style:italic;text-align:center">no units on this side</td></tr>';
  }

  // Header card for one entry (outcome + meta line)
  function headerCard(e, oc, label) {
    return ''
      + '<div style="background:rgba(0,0,0,0.3);border:1px solid var(--border);'
      +   'border-radius:3px;padding:8px 12px;flex:1;min-width:0">'
      +   '<div style="font-size:0.55rem;color:var(--text-dim);font-family:Cinzel,serif;'
      +     'letter-spacing:.12em;margin-bottom:3px">' + label + '</div>'
      +   '<div style="color:' + oc.color + ';font-family:Cinzel,serif;font-size:0.95rem;'
      +     'font-weight:bold">' + oc.icon + ' ' + oc.text + '</div>'
      +   '<div style="font-size:0.62rem;color:var(--text-dim);margin-top:3px">'
      +     'PL ' + (e.powerLimit || '?') + ' · R' + e.rounds + ' · ' + humanAgo(e.t)
      +   '</div>'
      + '</div>';
  }

  // The most useful single number — Δ Blood Essence. Positive delta = B
  // burned more essence than A (bad), negative = saved essence (good).
  const essenceDeltaHtml = delta(A.essenceLost, B.essenceLost, -1);
  const roundsDeltaHtml  = delta(A.rounds, B.rounds, -1);
  const survDeltaHtml    = delta(A.totalAllySurv || 0, B.totalAllySurv || 0, +1);
  const killDeltaHtml    = delta(A.totalEnemyKilled || 0, B.totalEnemyKilled || 0, +1);

  const outcomeChangedHtml = (oA.text === oB.text)
    ? '<span style="color:var(--text-dim)">unchanged</span>'
    : '<span style="color:#9b59b6;font-weight:bold">' + oA.icon + ' ' + oA.text + ' → ' + oB.icon + ' ' + oB.text + '</span>';

  body.innerHTML = ''
    // Top: two header cards side by side
    + '<div style="display:flex;gap:8px;margin-bottom:0.9rem">'
    +   headerCard(A, oA, 'A · OLDER')
    +   headerCard(B, oB, 'B · NEWER')
    + '</div>'
    // Summary deltas
    + '<div style="background:rgba(155,89,182,0.05);border:1px solid #2a1218;'
    +   'border-radius:3px;padding:10px 12px;margin-bottom:0.9rem">'
    +   '<div style="font-family:Cinzel,serif;font-size:0.65rem;color:#9b59b6;'
    +     'letter-spacing:.1em;margin-bottom:6px">Δ SUMMARY (B vs A)</div>'
    +   '<table style="width:100%;border-collapse:collapse;font-size:0.72rem">'
    +     '<tr>'
    +       '<td style="padding:3px 6px;color:var(--text-dim)">Outcome</td>'
    +       '<td style="padding:3px 6px;text-align:right" colspan="3">' + outcomeChangedHtml + '</td>'
    +     '</tr>'
    +     '<tr>'
    +       '<td style="padding:3px 6px;color:var(--text-dim)">Rounds</td>'
    +       '<td style="padding:3px 6px;text-align:center">' + A.rounds + '</td>'
    +       '<td style="padding:3px 6px;text-align:center">' + B.rounds + '</td>'
    +       '<td style="padding:3px 6px;text-align:right">' + roundsDeltaHtml + '</td>'
    +     '</tr>'
    +     '<tr>'
    +       '<td style="padding:3px 6px;color:var(--text-dim)">Allies survived</td>'
    +       '<td style="padding:3px 6px;text-align:center">' + (A.totalAllySurv || 0) + '/' + (A.totalAllyStart || 0) + '</td>'
    +       '<td style="padding:3px 6px;text-align:center">' + (B.totalAllySurv || 0) + '/' + (B.totalAllyStart || 0) + '</td>'
    +       '<td style="padding:3px 6px;text-align:right">' + survDeltaHtml + '</td>'
    +     '</tr>'
    +     '<tr>'
    +       '<td style="padding:3px 6px;color:var(--text-dim)">Enemies killed</td>'
    +       '<td style="padding:3px 6px;text-align:center">' + (A.totalEnemyKilled || 0) + '/' + (A.totalEnemyStart || 0) + '</td>'
    +       '<td style="padding:3px 6px;text-align:center">' + (B.totalEnemyKilled || 0) + '/' + (B.totalEnemyStart || 0) + '</td>'
    +       '<td style="padding:3px 6px;text-align:right">' + killDeltaHtml + '</td>'
    +     '</tr>'
    +     '<tr style="border-top:1px solid rgba(255,255,255,0.05)">'
    +       '<td style="padding:6px;color:#f0d080;font-family:Cinzel,serif;font-size:0.7rem">🩸 Blood Essence</td>'
    +       '<td style="padding:6px;text-align:center;color:#f0d080">−' + (A.essenceLost || 0) + '</td>'
    +       '<td style="padding:6px;text-align:center;color:#f0d080">−' + (B.essenceLost || 0) + '</td>'
    +       '<td style="padding:6px;text-align:right;font-size:0.78rem">' + essenceDeltaHtml + '</td>'
    +     '</tr>'
    +   '</table>'
    + '</div>'
    // Allies per-tier table
    + '<div style="margin-bottom:0.9rem">'
    +   '<div style="font-family:Cinzel,serif;font-size:0.65rem;color:var(--gold-light);'
    +     'letter-spacing:.1em;margin-bottom:4px;padding-bottom:3px;'
    +     'border-bottom:1px solid rgba(201,168,76,0.15)">⚔ ALLIES — per tier</div>'
    +   '<table style="width:100%;border-collapse:collapse;font-size:0.7rem">'
    +     '<thead><tr style="color:var(--text-dim);font-size:0.6rem">'
    +       '<th style="padding:2px 6px;text-align:left">Tier</th>'
    +       '<th style="padding:2px 6px;text-align:center">A surv/qty</th>'
    +       '<th style="padding:2px 6px;text-align:center">B surv/qty</th>'
    +       '<th style="padding:2px 6px;text-align:right">Δ</th>'
    +     '</tr></thead><tbody>'
    +     tierCompareRows(A.allyLosses || {}, B.allyLosses || {}, ALLY_TIERS, 'ally')
    +   '</tbody></table>'
    + '</div>'
    // Enemies per-tier table
    + '<div>'
    +   '<div style="font-family:Cinzel,serif;font-size:0.65rem;color:#e74c3c;'
    +     'letter-spacing:.1em;margin-bottom:4px;padding-bottom:3px;'
    +     'border-bottom:1px solid rgba(231,76,60,0.2)">💀 ENEMIES — per tier</div>'
    +   '<table style="width:100%;border-collapse:collapse;font-size:0.7rem">'
    +     '<thead><tr style="color:var(--text-dim);font-size:0.6rem">'
    +       '<th style="padding:2px 6px;text-align:left">Tier</th>'
    +       '<th style="padding:2px 6px;text-align:center">A surv/qty</th>'
    +       '<th style="padding:2px 6px;text-align:center">B surv/qty</th>'
    +       '<th style="padding:2px 6px;text-align:right">Δ</th>'
    +     '</tr></thead><tbody>'
    +     tierCompareRows(A.enemyLosses || {}, B.enemyLosses || {}, ENEMY_TIERS, 'enemy')
    +   '</tbody></table>'
    + '</div>';
}

// ===================== INIT =====================
renderBuilder();
// ============================================================
// Event listeners — replacing inline onclick/oninput handlers
// (required by CSP for Chrome Extension Manifest V3)
// ============================================================

// --- Event delegation for dynamically generated elements ---

// Qty buttons (ally & enemy): data-side, data-tier, data-delta
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.qty-btn[data-delta]');
  if (btn) {
    const side = btn.getAttribute('data-side');
    const tier = btn.getAttribute('data-tier');
    const delta = parseInt(btn.getAttribute('data-delta'), 10);
    if (side && tier && !isNaN(delta)) changeQty(side, tier, delta);
    return;
  }

  // Optimizer "Apply" button
  const applyBtn = e.target.closest('.opt-apply-btn[data-formation]');
  if (applyBtn) {
    try {
      const qtys = JSON.parse(applyBtn.getAttribute('data-formation'));
      applyFormation(qtys);
    } catch(ex) { /* ignore parse error */ }
    return;
  }

  // History compare: checkbox click in the card header.
  // We listen on click rather than 'change' here because change-via-keyboard
  // is also caught by the input handler below — using click keeps the
  // checkbox's native toggling intact and lets toggleCompareSelection re-
  // render which preserves DOM state cleanly.
  const cb = e.target.closest('.sim-history-compare-cb[data-history-idx]');
  if (cb) {
    const idx = parseInt(cb.getAttribute('data-history-idx'), 10);
    if (!isNaN(idx)) {
      const accepted = toggleCompareSelection(idx);
      if (!accepted) {
        // 3rd-selection attempt rejected — undo the visual tick the browser
        // already applied before we got the event.
        cb.checked = false;
      }
    }
    return;
  }

  // Auto-play speed selector — discrete button per multiplier. Click
  // updates state, persists, re-renders the row, and (if Auto is running)
  // restarts the interval at the new cadence. See setAutoSpeed().
  const speedBtn = e.target.closest('.auto-speed-btn[data-speed]');
  if (speedBtn) {
    const mult = parseFloat(speedBtn.getAttribute('data-speed'));
    if (!isNaN(mult)) setAutoSpeed(mult);
    return;
  }

  // History: 📌 Pin / 📍 Unpin toggle (sortedIdx in data-history-idx)
  const pinBtn = e.target.closest('.sim-history-pin[data-history-idx]');
  if (pinBtn) {
    const idx = parseInt(pinBtn.getAttribute('data-history-idx'), 10);
    if (!isNaN(idx)) toggleHistoryPin(idx);
    return;
  }

  // History: ↻ Reapply formation button. Moved here from the `input`
  // listener (where it was misplaced in v1.5.0 — buttons don't fire
  // input events, so the original v1.5.0 binding was effectively dead
  // code). Now hooked into the actual click delegate.
  const reapply = e.target.closest('.sim-history-apply[data-history-idx]');
  if (reapply) {
    const idx = parseInt(reapply.getAttribute('data-history-idx'), 10);
    if (!isNaN(idx)) applyHistoryEntry(idx);
    return;
  }

  // History: 📥 Save as Ruins preset (victory entries only — the button
  // isn't rendered on defeat/draw cards). Prompts for level, then sends
  // BF_ADD_PRESET to bot.js which handles the chrome.storage write.
  const toPresetBtn = e.target.closest('.sim-history-to-preset[data-history-idx]');
  if (toPresetBtn) {
    const idx = parseInt(toPresetBtn.getAttribute('data-history-idx'), 10);
    if (!isNaN(idx)) sendHistoryToPreset(idx, toPresetBtn);
    return;
  }

  // History compare: open / clear buttons rendered in the history footer
  if (e.target.closest('#btn-open-compare')) {
    openCompareModal();
    return;
  }
  if (e.target.closest('#btn-clear-compare')) {
    _compareSelection = [];
    renderHistory();
    return;
  }

  // Close-compare button + click-outside-to-close (on the modal backdrop)
  if (e.target.closest('#btn-close-compare')) {
    closeCompareModal();
    return;
  }
  if (e.target.id === 'compare-modal') {
    // Click on the dark backdrop (but not on the inner card) closes the modal.
    closeCompareModal();
    return;
  }
});

// Qty inputs: oninput + onblur delegation
document.addEventListener('input', function(e) {
  const inp = e.target.closest('.qty-input[data-side][data-tier]');
  if (inp) {
    qtyInputChange(inp.getAttribute('data-side'), inp.getAttribute('data-tier'), inp);
    return;
  }
  // Optimizer max inputs — only auto-refresh after user has manually
  // computed combinations once during this modal session (see resetComboCountUI).
  if (e.target.closest('.opt-max-input')) {
    if (_comboCountComputed) updateComboCount();
    return;
  }
});

document.addEventListener('focusout', function(e) {
  const inp = e.target.closest('.qty-input[data-side][data-tier]');
  if (inp) {
    qtyInputBlur(inp.getAttribute('data-side'), inp.getAttribute('data-tier'), inp);
  }
});

// Hover effects for optimizer result cards and apply buttons
// Guard: mouseenter/mouseleave with capture can fire on text nodes (no .closest)
document.addEventListener('mouseenter', function(e) {
  if (!(e.target instanceof Element)) return;
  const card = e.target.closest('.opt-result-card[data-hover-shadow]');
  if (card) card.style.boxShadow = card.getAttribute('data-hover-shadow');
  const abtn = e.target.closest('.opt-apply-btn');
  if (abtn) { abtn.style.background = 'var(--gold)'; abtn.style.color = 'var(--dark)'; }
}, true);

document.addEventListener('mouseleave', function(e) {
  if (!(e.target instanceof Element)) return;
  const card = e.target.closest('.opt-result-card');
  if (card) card.style.boxShadow = 'none';
  const abtn = e.target.closest('.opt-apply-btn');
  if (abtn) { abtn.style.background = 'transparent'; abtn.style.color = 'var(--gold)'; }
}, true);

// --- Static element listeners (attached once on DOMContentLoaded) ---
document.addEventListener('DOMContentLoaded', function () {
  // Power limit
  const plInput = document.getElementById('power-limit-input-el');
  if (plInput) plInput.addEventListener('input', updatePowerLimit);

  // Quick "⬇ Live" import button: reads window._bf_lastPowerLimit (cached
  // by bridge.js on every BF_GAME_STATE message — see bridge.js comments).
  // Briefly turns red if no game data yet, green on successful import.
  const btnQI = document.getElementById('btn-quick-import-pl');
  if (btnQI) btnQI.addEventListener('click', function () {
    const pl = (typeof window._bf_lastPowerLimit === 'number') ? window._bf_lastPowerLimit : null;
    const origBg = btnQI.style.background;
    const origColor = btnQI.style.color;
    const origBorder = btnQI.style.borderColor;
    if (!pl) {
      btnQI.style.background = 'rgba(231,76,60,0.2)';
      btnQI.style.color = '#e74c3c';
      btnQI.style.borderColor = '#c0392b';
      btnQI.title = 'No game data yet — visit the battle / ruins page first';
      setTimeout(() => {
        btnQI.style.background = origBg;
        btnQI.style.color = origColor;
        btnQI.style.borderColor = origBorder;
        btnQI.title = 'Quick import from current game page';
      }, 1500);
      return;
    }
    const inp = document.getElementById('power-limit-input-el');
    if (inp) {
      inp.value = pl;
      updatePowerLimit();
    }
    btnQI.style.background = 'rgba(46,204,113,0.2)';
    btnQI.style.color = '#2ecc71';
    btnQI.style.borderColor = '#27ae60';
    setTimeout(() => {
      btnQI.style.background = origBg;
      btnQI.style.color = origColor;
      btnQI.style.borderColor = origBorder;
    }, 900);
  });

  // Recent-simulations panel
  const btnClearHist = document.getElementById('btn-clear-history');
  if (btnClearHist) btnClearHist.addEventListener('click', function () {
    clearHistory();
  });
  // Initial render so the panel shows the prior session's last 3 simulations
  // (or the "No simulations yet" placeholder) as soon as the iframe loads.
  renderHistory();

  // Auto-play speed: render the 4-button row with the persisted selection
  // highlighted. Click handling is in the main click delegate (looks for
  // .auto-speed-btn[data-speed]).
  renderSpeedButtons();

  // Battle buttons
  const btnStart = document.getElementById('btn-start-battle');
  if (btnStart) btnStart.addEventListener('click', startBattle);

  const btnStep = document.getElementById('btn-step-battle');
  if (btnStep) btnStep.addEventListener('click', stepBattle);

  const btnAuto = document.getElementById('btn-auto-play');
  if (btnAuto) btnAuto.addEventListener('click', autoPlay);

  const btnOpt = document.getElementById('btn-open-optimizer');
  if (btnOpt) btnOpt.addEventListener('click', openOptimizer);

  const btnReset = document.getElementById('btn-reset-battle');
  if (btnReset) btnReset.addEventListener('click', resetBattle);

  const btnReset2 = document.getElementById('btn-reset-battle-2');
  if (btnReset2) btnReset2.addEventListener('click', resetBattle);

  // Battle log export — Copy to clipboard / Download as .txt
  const btnCopyLog = document.getElementById('btn-copy-log');
  if (btnCopyLog) btnCopyLog.addEventListener('click', copyLogToClipboard);
  const btnDlLog   = document.getElementById('btn-download-log');
  if (btnDlLog)   btnDlLog.addEventListener('click', downloadLogAsFile);

  // Optimizer
  const btnCloseOpt = document.getElementById('btn-close-optimizer');
  if (btnCloseOpt) btnCloseOpt.addEventListener('click', closeOptimizer);

  const btnRunOpt = document.getElementById('btn-run-optimizer');
  if (btnRunOpt) btnRunOpt.addEventListener('click', runOptimizer);

  const btnCancelOpt = document.getElementById('btn-cancel-optimizer');
  if (btnCancelOpt) btnCancelOpt.addEventListener('click', requestOptimizerCancel);

  // v1.6.18 — Mode radio toggles Fast Scan budget input visibility
  function syncOptFastRowVisibility() {
    const isFast = document.getElementById('opt-mode-fast')?.checked;
    const row = document.getElementById('opt-fastsims-row');
    if (row) row.style.display = isFast ? 'block' : 'none';
  }
  document.querySelectorAll('input[name="opt-mode"]').forEach(function (r) {
    r.addEventListener('change', syncOptFastRowVisibility);
  });
  syncOptFastRowVisibility(); // init on load

  // Smart Preset section in optimizer
  const presetEnabled = document.getElementById('opt-preset-enabled');
  if (presetEnabled) presetEnabled.addEventListener('change', updateSmartPresetPreview);
  const presetLevel = document.getElementById('opt-preset-level');
  if (presetLevel) {
    presetLevel.addEventListener('input', function () {
      presetLevel.dataset.touched = 'true';
      updateSmartPresetPreview();
    });
  }
  const presetRange = document.getElementById('opt-preset-range');
  if (presetRange) presetRange.addEventListener('input', updateSmartPresetPreview);

  // Preset Manager modal
  const btnMgr = document.getElementById('btn-manage-presets');
  if (btnMgr) btnMgr.addEventListener('click', openPresetManager);
  const btnMgrClose = document.getElementById('btn-close-preset-mgr');
  if (btnMgrClose) btnMgrClose.addEventListener('click', closePresetManager);
  const btnMgrSave = document.getElementById('pmgr-save');
  if (btnMgrSave) btnMgrSave.addEventListener('click', savePresetFromForm);
  const btnMgrClear = document.getElementById('pmgr-clear');
  if (btnMgrClear) btnMgrClear.addEventListener('click', function () {
    const lvl = parseInt(document.getElementById('pmgr-level').value) || 0;
    loadPresetIntoForm(lvl); // re-clear by passing same level (will reload)
    if (!_presetCache[String(lvl)]) {
      // Just clear all fields if no preset for that level
      renderPresetManagerInputs();
    }
  });
  const btnMgrLevel = document.getElementById('pmgr-level');
  if (btnMgrLevel) btnMgrLevel.addEventListener('input', function () {
    loadPresetIntoForm(parseInt(btnMgrLevel.value) || 0);
  });
  const btnMgrExport = document.getElementById('pmgr-export');
  if (btnMgrExport) btnMgrExport.addEventListener('click', exportPresetsJson);
  const btnMgrImportBtn = document.getElementById('pmgr-import-btn');
  const btnMgrImportFile = document.getElementById('pmgr-import-file');
  if (btnMgrImportBtn && btnMgrImportFile) {
    btnMgrImportBtn.addEventListener('click', function () { btnMgrImportFile.click(); });
    btnMgrImportFile.addEventListener('change', function () {
      if (btnMgrImportFile.files && btnMgrImportFile.files[0]) {
        importPresetsJson(btnMgrImportFile.files[0]);
        btnMgrImportFile.value = '';
      }
    });
  }

  // Result
  const btnCloseRes = document.getElementById('btn-close-result');
  if (btnCloseRes) btnCloseRes.addEventListener('click', closeResult);

  const btnCloseRes2 = document.getElementById('btn-close-result-2');
  if (btnCloseRes2) btnCloseRes2.addEventListener('click', closeResult);
});


// Copyright (C) 2026 Aescunor
// GNU General Public License v3.0
