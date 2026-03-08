// ===================== DATA =====================
// Copyright (C) 2026 Aescunor
// GNU General Public License v3.0
let ARMY_POWER_LIMIT = 20;

function updatePowerLimit() {
  const val = parseInt(document.getElementById('power-limit-input-el').value) || 20;
  ARMY_POWER_LIMIT = Math.max(1, val);
  renderBuilder();
}

const ALLY_TIERS = [
  { id: 'T1', label: 'Tier 1', dmg: 8, hp: 2, spd: 5, power: 2, cost: 10, pos: 'Rearguard', type: 'Brute',
    skill: 'First round: +25% damage', skillId: 'T1_FIRST_ROUND_DMG' },
  { id: 'T2', label: 'Tier 2', dmg: 3, hp: 5, spd: 2, power: 3, cost: 15, pos: 'Vanguard', type: 'Brute',
    skill: '-50% damage taken', skillId: 'T2_REDUCE_DMG' },
  { id: 'T3', label: 'Tier 3', dmg: 6, hp: 6, spd: 4, power: 4, cost: 20, pos: 'Vanguard', type: 'Occult',
    skill: '+33% damage vs enemies with speed < 3', skillId: 'T3_VS_SLOW' },
  { id: 'T4', label: 'Tier 4', dmg: 7, hp: 4, spd: 4, power: 7, cost: 35, pos: 'Rearguard', type: 'Monster',
    skill: 'Attacks rearguard. Reduces target group damage by 25% for 1 round.', skillId: 'T4_REARGUARD_DEBUFF' },
];

const ENEMY_TIERS = [
  { id: 'E1', label: 'Tier e1', dmg: 3, hp: 4, spd: 3, power: null, pos: 'Vanguard', type: 'Brute',
    skill: 'No ability', skillId: null },
  { id: 'E2', label: 'Tier e2', dmg: 2, hp: 7, spd: 2, power: null, pos: 'Vanguard', type: 'Brute',
    skill: 'On first kill, revives with 1 HP in the same round', skillId: 'E2_REVIVE' },
  { id: 'E3', label: 'Tier e3', dmg: 5, hp: 1, spd: 1, power: null, pos: 'Rearguard', type: 'Occult',
    skill: 'If survives round, increases random ally unit damage by 10%', skillId: 'E3_BUFF_ALLY' },
  { id: 'E4', label: 'Tier e4', dmg: 6, hp: 3, spd: 4, power: null, pos: 'Rearguard', type: 'Occult',
    skill: 'Always attacks rearguard. +20% damage if attacks first.', skillId: 'E4_REARGUARD_FIRST' },
  { id: 'E5', label: 'Tier e5', dmg: 1, hp: 10, spd: 1, power: null, pos: 'Vanguard', type: 'Monster',
    skill: 'On death, deals 20% of its HP as damage to attacker', skillId: 'E5_DEATH_THORNS' },
  { id: 'E6', label: 'Tier e6', dmg: 7, hp: 2, spd: 4, power: null, pos: 'Vanguard', type: 'Occult',
    skill: 'Gains +50% attack if target group has double or more units than this group. Checked each round.', skillId: 'E6_DOUBLE_BONUS' },
];

// ===================== STATE =====================
let allyQuantities = {};
let enemyQuantities = {};
// By default all tiers unlocked; user can toggle
let unlockedAllyTiers = new Set(ALLY_TIERS.map(t => t.id));
let unlockedEnemyTiers = new Set(ENEMY_TIERS.map(t => t.id));
let battleState = null;
let autoTimer = null;
let isRunning = false;

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
    addLog('<span style="color:var(--crimson)">Pridajte jednotky na obe strany!</span>');
    return;
  }

  battleState = {
    allies: allyGroups,
    enemies: enemyGroups,
    round: 0,
    done: false,
    firstRound: true,
    // e3 buff tracking
    e3Buffs: {}, // unitId -> multiplier
    // e4 first attack tracking per round
    firstAttackerThisRound: null,
    // t4 debuff tracking
    t4Debuffed: null, // {groupId, rounds}
  };

  clearLog();
  addLog('<span class="log-round">⚔ BATTLE BEGINS ⚔</span>');
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
  }, 900);
}

function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
}

function resetBattle() {
  stopAuto();
  document.getElementById('result-banner').className = '';
  battleState = null;
  isRunning = false;
  clearLog();
  addLog('<span style="color:var(--text-dim);font-style:italic">Build your armies and start the battle...</span>');
  renderBattlefield();
  document.getElementById('turn-order-bar').style.display = 'none';
}

function executeRound() {
  const bs = battleState;
  bs.round++;
  addLog(`<div class="log-round">── Round ${bs.round} ──</div>`);

  // Reset round-start flags
  const allAlive = [...bs.allies, ...bs.enemies].filter(g => g.alive);
  allAlive.forEach(g => {
    g.attackedThisRound = false;
    g.revivedThisRound = false;
    // Tick down T4 debuff
    if (g.debuffRounds > 0) {
      g.debuffRounds--;
      if (g.debuffRounds === 0) g.debuffed = false;
    }
  });
  bs.firstAttackerThisRound = null;

  // Build turn order at START of round (snapshot), sorted:
  // 1. Speed desc  2. Rearguard before Vanguard on tie  3. Ally before enemy on tie
  const turnOrder = [...allAlive].sort((a, b) => {
    if (b.tier.spd !== a.tier.spd) return b.tier.spd - a.tier.spd;
    const posScore = g => g.tier.pos === 'Rearguard' ? 1 : 0;
    if (posScore(b) !== posScore(a)) return posScore(b) - posScore(a);
    return a.side === 'ally' ? -1 : 1;
  });

  renderTurnOrder(turnOrder);

  for (const attacker of turnOrder) {
    // Skip if killed during this round
    if (!attacker.alive) continue;

    // Track first attacker of the round for E4 bonus
    if (bs.firstAttackerThisRound === null) bs.firstAttackerThisRound = attacker.id;

    const enemySide = attacker.side === 'ally' ? bs.enemies : bs.allies;
    const target = pickTarget(attacker, enemySide);
    if (!target) continue;

    attacker.attackedThisRound = true;
    performAttack(attacker, target, bs);
    // NOTE: do NOT call checkEnd here — let ALL units take their turn first
  }

  // End-of-round skills
  // E3: if still alive at end of round, +10% buff to a random friendly
  bs.enemies.filter(g => g.alive && g.tier.skillId === 'E3_BUFF_ALLY').forEach(e3 => {
    const friendlies = bs.enemies.filter(g => g.alive && g.id !== e3.id);
    if (friendlies.length > 0) {
      const t = friendlies[Math.floor(Math.random() * friendlies.length)];
      t.damageBuff = +(((t.damageBuff || 1.0) + 0.1).toFixed(2));
      addLog(`<span class="log-skill">✦ ${e3.label} (E3): Buffs ${t.label} by 10% damage (total ×${t.damageBuff.toFixed(1)})</span>`);
    }
  });

  bs.firstRound = false;
  renderBattlefield();

  // Check end ONLY after the full round is done
  checkEnd(bs);
}

function pickTarget(attacker, enemies) {
  const alive = enemies.filter(g => g.alive);
  if (alive.length === 0) return null;

  // T4 & E4: prefer rearguard (bypass vanguard rule)
  if (attacker.tier.skillId === 'T4_REARGUARD_DEBUFF' || attacker.tier.skillId === 'E4_REARGUARD_FIRST') {
    const rearguard = alive.filter(g => g.tier.pos === 'Rearguard');
    if (rearguard.length > 0) return rearguard.sort((a,b) => a.tier.spd - b.tier.spd)[0];
  }

  // Normal: vanguard before rearguard, within same position target lowest speed first
  const vanguard = alive.filter(g => g.tier.pos === 'Vanguard');
  if (vanguard.length > 0) return vanguard.sort((a, b) => a.tier.spd - b.tier.spd)[0];
  return alive.sort((a, b) => a.tier.spd - b.tier.spd)[0];
}

function getTypeMultiplier(attackerType, targetType) {
  const aT = attackerType.trim();
  const tT = targetType.trim();
  if (aT === 'Brute' && tT === 'Occult') return 1.5;
  if (aT === 'Occult' && tT === 'Monster') return 1.5;
  if (aT === 'Monster' && tT === 'Brute') return 1.5;
  if (aT === 'Occult' && tT === 'Brute') return 0.5;
  if (aT === 'Monster' && tT === 'Occult') return 0.5;
  if (aT === 'Brute' && tT === 'Monster') return 0.5;
  return 1.0;
}

function performAttack(attacker, target, bs) {
  // Alive units = explicitly tracked (survives revive hp changes)
  const aliveUnits = attacker.aliveUnits !== undefined ? attacker.aliveUnits : Math.max(1, Math.ceil(attacker.currentHp / attacker.tier.hp));
  let dmg = attacker.tier.dmg * aliveUnits;

  // T1: first round +25%
  if (attacker.tier.skillId === 'T1_FIRST_ROUND_DMG' && bs.firstRound) {
    dmg *= 1.25;
    addLog(`<span class="log-skill">✦ Tier 1: First round +25% damage</span>`);
  }

  // T3: +33% vs speed < 3
  if (attacker.tier.skillId === 'T3_VS_SLOW' && target.tier.spd < 3) {
    dmg *= 1.33;
    addLog(`<span class="log-skill">✦ Tier 3: +33% vs slow units</span>`);
  }

  // E3 damage buff on attacker
  if (attacker.damageBuff && attacker.damageBuff > 1.0) {
    dmg *= attacker.damageBuff;
  }

  // E4: +20% if this unit is the first attacker this round
  if (attacker.tier.skillId === 'E4_REARGUARD_FIRST' && bs.firstAttackerThisRound === attacker.id) {
    dmg *= 1.2;
    addLog(`<span class="log-skill">✦ Tier e4: +20% damage (attacks first)</span>`);
  }

  // E6: +50% if target group has >= 2x units compared to this group
  if (attacker.tier.skillId === 'E6_DOUBLE_BONUS') {
    const attackerUnits = attacker.aliveUnits || 1;
    const targetUnits = target.aliveUnits || 1;
    if (targetUnits >= attackerUnits * 2) {
      dmg *= 1.5;
      addLog(`<span class="log-skill">✦ Tier e6: +50% damage (target has ${targetUnits} vs ${attackerUnits} units)</span>`);
    }
  }

  // T4 debuff: attacker deals 25% less if it was debuffed
  if (attacker.debuffed) {
    dmg *= 0.75;
    addLog(`<span class="log-skill">✦ ${attacker.label} is debuffed: −25% damage</span>`);
  }

  // Type multiplier
  const typeMult = getTypeMultiplier(attacker.tier.type, target.tier.type);
  dmg *= typeMult;
  if (typeMult > 1.0) addLog(`<span class="log-skill">✦ Type advantage (×${typeMult}): ${attacker.tier.type.trim()} → ${target.tier.type.trim()}</span>`);
  if (typeMult < 1.0) addLog(`<span class="log-skill">✦ Type disadvantage (×${typeMult}): ${attacker.tier.type.trim()} → ${target.tier.type.trim()}</span>`);

  // T2: target takes 50% less damage
  if (target.tier.skillId === 'T2_REDUCE_DMG') {
    dmg *= 0.5;
    addLog(`<span class="log-skill">✦ Tier 2: −50% damage taken</span>`);
  }

  const finalDmg = Math.max(0, Math.ceil(dmg));

  const aLabel = attacker.side === 'ally'
    ? `<span class="attacker">${attacker.label}</span>`
    : `<span class="ally-attacker">${attacker.label}</span>`;
  const tLabel = target.side === 'enemy'
    ? `<span class="target">${target.label}</span>`
    : `<span class="ally-target">${target.label}</span>`;

  target.currentHp = Math.max(0, target.currentHp - finalDmg);
  // Update alive units count based on new HP (1 HP per unit after revive, or tier.hp per unit normally)
  const hpPerUnit = target.aliveUnits !== undefined && target.revived ? 1 : target.tier.hp;
  target.aliveUnits = Math.max(0, Math.ceil(target.currentHp / hpPerUnit));

  addLog(`<span class="log-attack">${aLabel} attacks ${tLabel}: <span class="dmg">−${finalDmg} HP</span> (remaining: ${target.currentHp}/${target.maxHp})</span>`);

  // T4: debuff the target group — it deals 25% less damage for 1 round
  if (attacker.tier.skillId === 'T4_REARGUARD_DEBUFF' && !target.debuffed) {
    target.debuffed = true;
    target.debuffRounds = 2; // ticked down at START of next round, so effectively 1 full round
    addLog(`<span class="log-skill">✦ Tier 4: ${target.label} receives −25% damage for 1 round</span>`);
  }

  // Death check
  if (target.currentHp <= 0) {
    // E2 revive: first death only, and only if not already attacked after revival in this round
    if (target.tier.skillId === 'E2_REVIVE' && !target.revived) {
      target.revived = true;
      // Each unit revives with 1 HP → total revived HP = qty (number of original units)
      target.currentHp = target.qty;
      target.maxHp = target.qty;
      target.aliveUnits = target.qty; // each unit now has 1 HP so qty units alive
      target.alive = true;
      addLog(`<span class="log-skill">✦ Tier e2: Group revives! ${target.qty} units with 1 HP (total ${target.qty} HP)</span>`);
      target.revivedThisRound = true;
      target.revivedByAttackerId = attacker.id;
    } else {
      // E5: death thorns — deal 20% of original maxHp to attacker
      if (target.tier.skillId === 'E5_DEATH_THORNS') {
        const thornDmg = Math.max(1, Math.round(target.maxHp * 0.2));
        attacker.currentHp = Math.max(0, attacker.currentHp - thornDmg);
        // Update aliveUnits for attacker after thorn damage
        const hpPerUnit = attacker.revived ? 1 : attacker.tier.hp;
        attacker.aliveUnits = Math.max(0, Math.ceil(attacker.currentHp / hpPerUnit));
        addLog(`<span class="log-skill">✦ Tier e5: Death deals ${thornDmg} damage to attacker! (remaining: ${attacker.currentHp}/${attacker.maxHp})</span>`);
        if (attacker.currentHp <= 0) {
          attacker.alive = false;
          attacker.aliveUnits = 0;
          attacker.currentHp = 0;
          addLog(`<span class="log-death">💀 ${attacker.label} is defeated by thorn damage!</span>`);
        }
      }
      target.alive = false;
      target.currentHp = 0;
      target.aliveUnits = 0;
      addLog(`<span class="log-death">💀 ${target.label} is defeated!</span>`);
    }
  }

  renderBattlefield();
}

function checkEnd(bs) {
  const alliesAlive = bs.allies.some(g => g.alive);
  const enemiesAlive = bs.enemies.some(g => g.alive);

  if (!alliesAlive || !enemiesAlive) {
    bs.done = true;
    stopAuto();
    isRunning = false;
    renderBattlefield();

    if (!alliesAlive && !enemiesAlive) {
      showResult('draw', 'DRAW', 'Both sides fell in glory!');
    } else if (!enemiesAlive) {
      showResult('victory', 'VICTORY', `Enemies were defeated in round ${bs.round}!`);
    } else {
      showResult('defeat', 'DEFEAT', `Your army was destroyed in round ${bs.round}...`);
    }
    return true;
  }
  return false;
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
  updateComboCount();

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
}

function closeOptimizer() {
  document.getElementById('optimizer-modal').style.display = 'none';
}

// Silent battle simulation — no logging, no rendering
function simulateBattleSilent(allyQtys, enemyQtys) {
  const allies = buildGroups('ally', ALLY_TIERS, allyQtys);
  const enemies = buildGroups('enemy', ENEMY_TIERS, enemyQtys);
  if (allies.length === 0 || enemies.length === 0) return null;

  const bs = { allies, enemies, round: 0, done: false, firstRound: true, firstAttackerThisRound: null, e3KilledRound1: false };
  const MAX_ROUNDS = 50;

  while (!bs.done && bs.round < MAX_ROUNDS) {
    bs.round++;
    const allAlive = [...bs.allies, ...bs.enemies].filter(g => g.alive);
    allAlive.forEach(g => {
      g.attackedThisRound = false;
      g.revivedThisRound = false;
      if (g.debuffRounds > 0) { g.debuffRounds--; if (g.debuffRounds === 0) g.debuffed = false; }
    });
    bs.firstAttackerThisRound = null;

    const turnOrder = [...allAlive].sort((a, b) => {
      if (b.tier.spd !== a.tier.spd) return b.tier.spd - a.tier.spd;
      const ps = g => g.tier.pos === 'Rearguard' ? 1 : 0;
      if (ps(b) !== ps(a)) return ps(b) - ps(a);
      return a.side === 'ally' ? -1 : 1;
    });

    for (const attacker of turnOrder) {
      if (!attacker.alive) continue;
      if (bs.firstAttackerThisRound === null) bs.firstAttackerThisRound = attacker.id;
      const enemySide = attacker.side === 'ally' ? bs.enemies : bs.allies;
      const target = pickTarget(attacker, enemySide);
      if (!target) continue;
      attackSilent(attacker, target, bs);
    }

    // Track E3 round-1 elimination
    if (bs.round === 1) {
      const e3Dead = bs.enemies.filter(g => g.tier.skillId === 'E3_BUFF_ALLY').every(g => !g.alive);
      if (e3Dead && bs.enemies.some(g => g.tier.skillId === 'E3_BUFF_ALLY')) bs.e3KilledRound1 = true;
    }

    // E3 end-of-round buff — target the enemy group with highest base damage (deterministic for optimizer)
    bs.enemies.filter(g => g.alive && g.tier.skillId === 'E3_BUFF_ALLY').forEach(e3 => {
      const fr = bs.enemies.filter(g => g.alive && g.id !== e3.id);
      if (fr.length > 0) {
        // Pick the group that benefits most (highest dmg * aliveUnits)
        const t = fr.reduce((best, g) => (g.tier.dmg * g.aliveUnits > best.tier.dmg * best.aliveUnits ? g : best));
        t.damageBuff = +((t.damageBuff + 0.1).toFixed(2));
      }
    });

    bs.firstRound = false;

    const alliesAlive = bs.allies.some(g => g.alive);
    const enemiesAlive = bs.enemies.some(g => g.alive);
    if (!alliesAlive || !enemiesAlive) bs.done = true;
  }

  const alliesAlive = bs.allies.some(g => g.alive);
  const enemiesAlive = bs.enemies.some(g => g.alive);
  const victory = alliesAlive && !enemiesAlive;
  const draw = !alliesAlive && !enemiesAlive;

  let essenceLost = 0, unitsLost = 0, unitsSurvived = 0;
  bs.allies.forEach(g => {
    const survived = g.alive ? (g.aliveUnits || 0) : 0;
    const lost = g.qty - survived;
    essenceLost += lost * g.tier.cost;
    unitsLost += lost;
    unitsSurvived += survived;
  });

  // Check if E3 was eliminated in round 1
  const e3KilledRound1 = bs.e3KilledRound1 || false;

  return { victory, draw, rounds: bs.round, essenceLost, unitsLost, unitsSurvived, e3KilledRound1 };
}

function attackSilent(attacker, target, bs) {
  const aliveUnits = attacker.aliveUnits !== undefined ? attacker.aliveUnits : Math.max(1, Math.ceil(attacker.currentHp / attacker.tier.hp));
  let dmg = attacker.tier.dmg * aliveUnits;

  if (attacker.tier.skillId === 'T1_FIRST_ROUND_DMG' && bs.firstRound) dmg *= 1.25;
  if (attacker.tier.skillId === 'T3_VS_SLOW' && target.tier.spd < 3) dmg *= 1.33;
  if (attacker.damageBuff && attacker.damageBuff > 1.0) dmg *= attacker.damageBuff;
  if (attacker.tier.skillId === 'E4_REARGUARD_FIRST' && bs.firstAttackerThisRound === attacker.id) dmg *= 1.2;
  if (attacker.tier.skillId === 'E6_DOUBLE_BONUS' && (target.aliveUnits || 1) >= (attacker.aliveUnits || 1) * 2) dmg *= 1.5;
  if (attacker.debuffed) dmg *= 0.75;

  const typeMult = getTypeMultiplier(attacker.tier.type, target.tier.type);
  dmg *= typeMult;
  if (target.tier.skillId === 'T2_REDUCE_DMG') dmg *= 0.5;

  const finalDmg = Math.max(0, Math.ceil(dmg));
  target.currentHp = Math.max(0, target.currentHp - finalDmg);
  const hpPerUnit = target.aliveUnits !== undefined && target.revived ? 1 : target.tier.hp;
  target.aliveUnits = Math.max(0, Math.ceil(target.currentHp / hpPerUnit));

  if (attacker.tier.skillId === 'T4_REARGUARD_DEBUFF' && !target.debuffed) { target.debuffed = true; target.debuffRounds = 2; }

  if (target.currentHp <= 0) {
    if (target.tier.skillId === 'E2_REVIVE' && !target.revived) {
      target.revived = true;
      target.currentHp = target.qty;
      target.maxHp = target.qty;
      target.aliveUnits = target.qty;
      target.alive = true;
      target.revivedThisRound = true;
      target.revivedByAttackerId = attacker.id;
    } else {
      if (target.tier.skillId === 'E5_DEATH_THORNS') {
        const thorn = Math.max(1, Math.round(target.maxHp * 0.2));
        attacker.currentHp = Math.max(0, attacker.currentHp - thorn);
        const hpu = attacker.revived ? 1 : attacker.tier.hp;
        attacker.aliveUnits = Math.max(0, Math.ceil(attacker.currentHp / hpu));
        if (attacker.currentHp <= 0) { attacker.alive = false; attacker.aliveUnits = 0; }
      }
      target.alive = false;
      target.currentHp = 0;
      target.aliveUnits = 0;
    }
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

function* generateCombinations(powerLimit, maxPerTier, enemyQtys) {
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
    const max = Math.min(hardMax, userMax);
    for (let q = 0; q <= max; q++) {
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
async function runFastScan(enemyQtys, topN, stratKillE3, btn) {
  const tiers = ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id));
  const maxPerTier = {};
  tiers.forEach(t => {
    const el = document.getElementById(`opt-max-${t.id}`);
    maxPerTier[t.id] = el ? Math.max(0, parseInt(el.value) || 0) : Math.floor(ARMY_POWER_LIMIT / t.power);
  });

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

  // Generate candidates ordered by power (high → low) using level-by-level BFS on power usage
  // We cap at 500k candidates max to avoid infinite loops
  const MAX_CANDIDATES = 500_000;

  document.getElementById('opt-progress-label').textContent = 'Fast Scan: generating candidates...';
  await new Promise(r => setTimeout(r, 0));

  // Use a smarter ordering: fill greedily then vary
  // Generate all valid combos but sorted by descending total power used
  const candidates = [];
  for (const qtys of generateCombinations(ARMY_POWER_LIMIT, maxPerTier, enemyQtys)) {
    const power = tiers.reduce((s, t) => s + (qtys[t.id] || 0) * t.power, 0);
    candidates.push({ qtys, power });
    if (candidates.length >= MAX_CANDIDATES) break;
    if (Date.now() - lastYield > 80) {
      document.getElementById('opt-progress-label').textContent =
        `Fast Scan: B&B generuje... ${candidates.length.toLocaleString()} candidates`;
      await new Promise(r => setTimeout(r, 0));
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

  const mode = document.querySelector('input[name="opt-mode"]:checked')?.value || 'deep';
  const priority = document.getElementById('opt-priority').value;
  const topN = parseInt(document.getElementById('opt-top').value);
  const stratKillE3 = document.getElementById('strat-kill-e3')?.checked || false;
  const btn = document.getElementById('opt-btn-label');
  btn.textContent = '⏳ Running...';
  document.getElementById('opt-progress').style.display = 'block';
  document.getElementById('opt-progress-bar').style.width = '0%';
  document.getElementById('opt-results').innerHTML = '';

  // Fast Scan mode — separate algorithm
  if (mode === 'fast') {
    await runFastScan(enemyQtys, topN, stratKillE3, btn);
    return;
  }

  // Deep Simulation mode (original B&B + full simulation)
  const maxPerTier = {};
  ALLY_TIERS.filter(t => unlockedAllyTiers.has(t.id)).forEach(t => {
    const el = document.getElementById(`opt-max-${t.id}`);
    maxPerTier[t.id] = el ? Math.max(0, parseInt(el.value) || 0) : Math.floor(ARMY_POWER_LIMIT / t.power);
  });

  const totalCombos = countCombinations(ARMY_POWER_LIMIT, maxPerTier);
  const results = [];
  let tested = 0;
  let lastYield = Date.now();

  for (const allyQtys of generateCombinations(ARMY_POWER_LIMIT, maxPerTier, enemyQtys)) {
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
});

// Qty inputs: oninput + onblur delegation
document.addEventListener('input', function(e) {
  const inp = e.target.closest('.qty-input[data-side][data-tier]');
  if (inp) {
    qtyInputChange(inp.getAttribute('data-side'), inp.getAttribute('data-tier'), inp);
    return;
  }
  // Optimizer max inputs
  if (e.target.closest('.opt-max-input')) {
    updateComboCount();
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

  // Optimizer
  const btnCloseOpt = document.getElementById('btn-close-optimizer');
  if (btnCloseOpt) btnCloseOpt.addEventListener('click', closeOptimizer);

  const btnRunOpt = document.getElementById('btn-run-optimizer');
  if (btnRunOpt) btnRunOpt.addEventListener('click', runOptimizer);

  // Result
  const btnCloseRes = document.getElementById('btn-close-result');
  if (btnCloseRes) btnCloseRes.addEventListener('click', closeResult);

  const btnCloseRes2 = document.getElementById('btn-close-result-2');
  if (btnCloseRes2) btnCloseRes2.addEventListener('click', closeResult);
});
// Copyright (C) 2026 Aescunor
// GNU General Public License v3.0
