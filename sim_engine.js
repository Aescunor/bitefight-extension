// ============================================================================
// Bitefight Bot v1.4.0 — Shared Simulation Engine
// Copyright (C) 2026 Aescunor — GNU General Public License v3.0
// ----------------------------------------------------------------------------
// Single source of truth for combat simulation. Used by:
//   - simulator.js  (UI panel, animated battle replay, optimizer)
//   - bot.js        (Ruins bot pre-validation of formations)
//
// Mechanics aligned with reference Python v6 simulator. All 8 ally tiers and
// 10 enemy tiers implemented with full ability set.
//
// v1.3.0: Early Termination — simulate() skips rounds 3..50 when the
// outcome is already decided (hopeless defeat or stalemate).
// v1.4.0: GC optimizations — eliminated per-attack Map allocation
// (replaced with transient _aliveUnitsBefore property) and gated event
// pushes on ctx.collectLog. Result: ~30% speedup on optimizer path.
// ============================================================================

(function (root) {
  'use strict';

  // ============================================================
  // UNIT DEFINITIONS (matches Python v6 unit_desc)
  // ============================================================

  // Rank = tier number. Position: 'Vanguard' = front, 'Rearguard' = rear.
  // power = unit capacity cost, cost = blood essence cost (ally only).

  const ALLY_TIERS = [
    { id: 'T1', label: 'Tier 1', dmg: 8,  hp: 2,  spd: 5, power: 2,  cost: 10,  pos: 'Rearguard', type: 'Brute',   rank: 1,
      skill: 'First round: +25% damage',                            skillId: 'T1_FIRST_ROUND_DMG' },
    { id: 'T2', label: 'Tier 2', dmg: 3,  hp: 5,  spd: 2, power: 3,  cost: 15,  pos: 'Vanguard',  type: 'Brute',   rank: 2,
      skill: '-50% damage taken (overrides type)',                  skillId: 'T2_REDUCE_DMG' },
    { id: 'T3', label: 'Tier 3', dmg: 6,  hp: 6,  spd: 4, power: 4,  cost: 20,  pos: 'Vanguard',  type: 'Occult',  rank: 3,
      skill: '+33% damage vs enemies with speed < 3',               skillId: 'T3_VS_SLOW' },
    { id: 'T4', label: 'Tier 4', dmg: 7,  hp: 4,  spd: 4, power: 7,  cost: 35,  pos: 'Rearguard', type: 'Monster', rank: 4,
      skill: 'Attacks rearguard. Target deals -25% damage this round.', skillId: 'T4_REARGUARD_DEBUFF' },
    { id: 'T5', label: 'Tier 5', dmg: 9,  hp: 5,  spd: 2, power: 10, cost: 50,  pos: 'Rearguard', type: 'Occult',  rank: 5,
      skill: '+10% damage stack per eliminated group',              skillId: 'T5_DEATH_BUFF' },
    { id: 'T6', label: 'Tier 6', dmg: 12, hp: 12, spd: 3, power: 15, cost: 75,  pos: 'Vanguard',  type: 'Monster', rank: 6,
      skill: 'When attacked, reduces attacker speed by -2 (permanent)', skillId: 'T6_SPEED_DEBUFF' },
    { id: 'T7', label: 'Tier 7', dmg: 14, hp: 8,  spd: 3, power: 18, cost: 90,  pos: 'Rearguard', type: 'Occult',  rank: 7,
      skill: 'Every even round, 25% of damage splashes to all enemy rear units', skillId: 'T7_SPLASH_REAR' },
    { id: 'T8', label: 'Tier 8', dmg: 30, hp: 88, spd: 1, power: 30, cost: 150, pos: 'Vanguard',  type: 'Monster', rank: 8,
      skill: 'Ignores typing. Overkill damage transfers to next enemy.', skillId: 'T8_OVERKILL' },
  ];

  // T8 health note: the Python reference uses rotmaws_health_reduce = -2 by default
  // (90 → 88) as a safeguard for low layers. We use 88 to match. Adjust via
  // BFEngine.setRotmawsHealth(90) for higher layers if needed.

  const ENEMY_TIERS = [
    { id: 'E1',  label: 'Tier e1',  dmg: 3,  hp: 4,  spd: 3, power: null, pos: 'Vanguard',  type: 'Brute',   rank: 1,
      skill: 'No ability',                                          skillId: null },
    { id: 'E2',  label: 'Tier e2',  dmg: 2,  hp: 7,  spd: 2, power: null, pos: 'Vanguard',  type: 'Brute',   rank: 2,
      skill: 'On first death, revives with 1 HP per unit',          skillId: 'E2_REVIVE' },
    { id: 'E3',  label: 'Tier e3',  dmg: 5,  hp: 1,  spd: 1, power: null, pos: 'Rearguard', type: 'Occult',  rank: 3,
      skill: 'After own attack, buffs random other enemy +10% damage', skillId: 'E3_BUFF_ALLY' },
    { id: 'E4',  label: 'Tier e4',  dmg: 6,  hp: 3,  spd: 4, power: null, pos: 'Rearguard', type: 'Occult',  rank: 4,
      skill: 'Attacks rearguard. +20% damage if first attacker.',   skillId: 'E4_REARGUARD_FIRST' },
    { id: 'E5',  label: 'Tier e5',  dmg: 1,  hp: 10, spd: 1, power: null, pos: 'Vanguard',  type: 'Monster', rank: 5,
      skill: 'On death, deals 20% of initial HP as damage to attacker', skillId: 'E5_DEATH_THORNS' },
    { id: 'E6',  label: 'Tier e6',  dmg: 7,  hp: 2,  spd: 4, power: null, pos: 'Rearguard', type: 'Occult',  rank: 6,
      skill: 'Ignores typing. +50% damage per multiple of 2x target size.', skillId: 'E6_DOUBLE_BONUS' },
    { id: 'E7',  label: 'Tier e7',  dmg: 8,  hp: 12, spd: 4, power: null, pos: 'Vanguard',  type: 'Brute',   rank: 7,
      skill: 'While alive, ally rearguard deals -15% damage',        skillId: 'E7_REAR_SUPPRESS' },
    { id: 'E8',  label: 'Tier e8',  dmg: 10, hp: 25, spd: 1, power: null, pos: 'Vanguard',  type: 'Monster', rank: 8,
      skill: '+5% damage per tackle (resets on own attack)',        skillId: 'E8_TACKLE_STACK' },
    { id: 'E9',  label: 'Tier e9',  dmg: 9,  hp: 18, spd: 2, power: null, pos: 'Rearguard', type: 'Monster', rank: 9,
      skill: 'Spawns 10 spiderlings at end of each round',           skillId: 'E9_SPAWN_SPIDERLINGS' },
    { id: 'E10', label: 'Tier e10', dmg: 40, hp: 25, spd: 3, power: null, pos: 'Rearguard', type: 'Occult',  rank: 10,
      skill: 'On ally front kill, 50% damage splash to slowest ally rear', skillId: 'E10_LICH_SPLASH' },
  ];

  // Spiderlings are a sub-unit spawned by E9 broodmothers. Hidden from UI selectors.
  const SPIDERLINGS_TIER = {
    id: 'E9S', label: 'spiderlings', dmg: 1, hp: 1, spd: 6, power: null, pos: 'Rearguard', type: 'Monster', rank: 9,
    skill: 'Spawned by broodmothers (E9)', skillId: 'SPIDERLINGS', hidden: true
  };

  // ============================================================
  // TYPE MULTIPLIER (matches Python v6 — strict)
  // ============================================================
  function getTypeMultiplier(attackerType, defenderType) {
    const a = (attackerType || '').trim();
    const d = (defenderType || '').trim();
    if (a === 'Brute'   && d === 'Occult')  return 1.5;
    if (a === 'Brute'   && d === 'Monster') return 0.5;
    if (a === 'Occult'  && d === 'Brute')   return 0.5;
    if (a === 'Occult'  && d === 'Monster') return 1.5;
    if (a === 'Monster' && d === 'Brute')   return 1.5;
    if (a === 'Monster' && d === 'Occult')  return 0.5;
    return 1.0;
  }

  // ============================================================
  // STATE BUILDERS
  // ============================================================
  function tierById(id) {
    if (id === 'E9S') return SPIDERLINGS_TIER;
    return ALLY_TIERS.find(t => t.id === id) || ENEMY_TIERS.find(t => t.id === id) || null;
  }

  function buildGroup(side, tier, qty) {
    return {
      id: tier.id,
      label: tier.label,
      side: side,                 // 'ally' | 'enemy'
      tier: tier,                 // shallow ref
      qty: qty,                   // initial count (does not change)
      maxHp: tier.hp * qty,       // initial total HP
      currentHp: tier.hp * qty,   // current total HP
      aliveUnits: qty,            // current count of living units
      alive: qty > 0,
      revived: false,             // E2: has been revived
      currentSpd: tier.spd,       // T6 reduces this on attacker
      damageBuff: 1.0,            // E3 cultists, T5 necromancers, E8 giants accumulate here
      debuffed: false,            // T4 banshees set this on their target
      debuffRound: -1,            // round when debuff was applied
      attackedThisRound: false,
      __originalQty: qty,         // for E5 thorns (uses initial HP)
    };
  }

  function buildGroups(side, tierList, qtys) {
    const groups = [];
    for (const t of tierList) {
      const q = qtys[t.id] | 0;
      if (q > 0) groups.push(buildGroup(side, t, q));
    }
    return groups;
  }

  // ============================================================
  // ORDERING (matches Python v6 sort chains)
  // ============================================================
  // Attacker order: speed DESC, position DESC (rear-first), side ASC (ally-first), size DESC, rank DESC
  function sortAttackers(groups) {
    return [...groups].filter(g => g.alive).sort((a, b) => {
      if (b.currentSpd !== a.currentSpd) return b.currentSpd - a.currentSpd;
      const ps = g => g.tier.pos === 'Rearguard' ? 1 : 0;
      if (ps(b) !== ps(a)) return ps(b) - ps(a);
      if (a.side !== b.side) return a.side === 'ally' ? -1 : 1;
      if (b.aliveUnits !== a.aliveUnits) return b.aliveUnits - a.aliveUnits;
      return b.tier.rank - a.tier.rank;
    });
  }

  // Defender order (front-first): position ASC (front first), speed ASC, side DESC, size DESC, rank ASC
  function sortDefendersFrontFirst(groups, defenderSide) {
    return groups.filter(g => g.alive && g.side === defenderSide).sort((a, b) => {
      const ps = g => g.tier.pos === 'Vanguard' ? 0 : 1;
      if (ps(a) !== ps(b)) return ps(a) - ps(b);
      if (a.currentSpd !== b.currentSpd) return a.currentSpd - b.currentSpd;
      if (b.aliveUnits !== a.aliveUnits) return b.aliveUnits - a.aliveUnits;
      return a.tier.rank - b.tier.rank;
    });
  }

  // Defender order (rear-first): position DESC (rear first), speed ASC, side DESC, size DESC, rank ASC
  function sortDefendersRearFirst(groups, defenderSide) {
    return groups.filter(g => g.alive && g.side === defenderSide).sort((a, b) => {
      const ps = g => g.tier.pos === 'Rearguard' ? 0 : 1;
      if (ps(a) !== ps(b)) return ps(a) - ps(b);
      if (a.currentSpd !== b.currentSpd) return a.currentSpd - b.currentSpd;
      if (b.aliveUnits !== a.aliveUnits) return b.aliveUnits - a.aliveUnits;
      return a.tier.rank - b.tier.rank;
    });
  }

  function pickTarget(attacker, allGroups) {
    const defenderSide = attacker.side === 'ally' ? 'enemy' : 'ally';
    // E4 (bonewings) and T4 (banshees) attack rear first
    const useRearFirst = (attacker.tier.skillId === 'E4_REARGUARD_FIRST' ||
                          attacker.tier.skillId === 'T4_REARGUARD_DEBUFF');
    const defOrder = useRearFirst
      ? sortDefendersRearFirst(allGroups, defenderSide)
      : sortDefendersFrontFirst(allGroups, defenderSide);
    return defOrder[0] || null;
  }

  // ============================================================
  // HP / UNIT COUNT helpers
  // ============================================================
  // Python v6: when defender is revived zombies, size = ceil(hp / 7) — uses ORIGINAL
  // zombies HP (7), not revived HP (1). This is the "divide by 7" mechanic.
  function recomputeUnitsAfterDamage(group) {
    if (group.currentHp <= 0) {
      group.currentHp = 0;
      group.aliveUnits = 0;
      return;
    }
    group.aliveUnits = Math.max(0, Math.ceil(group.currentHp / group.tier.hp));
  }

  // ============================================================
  // SINGLE ATTACK
  // Returns events array describing what happened.
  // ============================================================
  function performAttack(attacker, target, bs, ctx) {
    const events = [];
    const cl = ctx.collectLog; // v1.4.0: skip event allocations when caller didn't ask for log
    const tier = attacker.tier;
    const aliveUnits = attacker.aliveUnits;
    if (aliveUnits <= 0 || !attacker.alive) return events;

    // Snapshot for spawn/revive triggers (Python: unit_size_before).
    // v1.4.0: avoid Map allocation per attack — write directly to group as a
    // transient property. Safe because all reads happen within this performAttack
    // call (E2 revive, E5 thorns, T5 necro stack), before the next attack overwrites.
    const groups = bs.groups;
    for (let i = 0; i < groups.length; i++) groups[i]._aliveUnitsBefore = groups[i].aliveUnits;

    // --- TYPE MULTIPLIER (Python v6: with overrides for wraiths & ghouls) ---
    let mult = getTypeMultiplier(tier.type, target.tier.type);
    // E6 wraiths IGNORE typing → 1.0 override
    if (tier.skillId === 'E6_DOUBLE_BONUS') {
      mult = 1.0;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'wraithsIgnoreType' });
    }
    // T8 rotmaws IGNORE typing → 1.0 override
    if (tier.skillId === 'T8_OVERKILL') {
      mult = 1.0;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'rotmawsIgnoreType' });
    }
    // T2 ghouls take -50% (override, applied AFTER wraiths/rotmaws in Python order)
    if (target.tier.skillId === 'T2_REDUCE_DMG') {
      mult = 0.5;
      cl && events.push({ type: 'skill', sourceId: target.id, key: 'ghoulsReduce' });
    } else {
      // Log type mult only when not overridden by ghouls
      if (mult > 1.0 && tier.skillId !== 'E6_DOUBLE_BONUS' && tier.skillId !== 'T8_OVERKILL')
        cl && events.push({ type: 'typeAdv', mult, attacker: tier.type, target: target.tier.type });
      if (mult < 1.0)
        cl && events.push({ type: 'typeDisadv', mult, attacker: tier.type, target: target.tier.type });
    }

    // --- E4 bonewings first attacker of round +20% ---
    if (tier.skillId === 'E4_REARGUARD_FIRST' && bs.turnCount === 1) {
      mult *= 1.20;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'e4FirstStrike' });
    }

    // --- E6 wraiths stacking +50% per 2x multiple ---
    if (tier.skillId === 'E6_DOUBLE_BONUS') {
      let wMult = 1.0;
      let aSize = target.aliveUnits;
      const oSize = aliveUnits;
      while (oSize > 0 && aSize >= 2 * oSize) {
        wMult += 0.5;
        aSize -= oSize;
      }
      if (wMult > 1.0) {
        mult *= wMult;
        cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'wraithsStack', mult: wMult });
      }
    }

    // --- E7 revenants aura: -15% to ally rearguard damage (Python: if alive AND attacker is ally rear) ---
    if (attacker.side === 'ally' && tier.pos === 'Rearguard') {
      const e7alive = bs.groups.some(g => g.alive && g.tier.skillId === 'E7_REAR_SUPPRESS');
      if (e7alive) {
        mult *= 0.85;
        cl && events.push({ type: 'skill', sourceId: 'E7', key: 'revenantsAura', attackerId: attacker.id });
      }
    }

    // --- T1 bats first round +25% ---
    if (tier.skillId === 'T1_FIRST_ROUND_DMG' && bs.round === 1) {
      mult *= 1.25;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'batsFirstRound' });
    }

    // --- T3 thralls +33% vs slow target ---
    if (tier.skillId === 'T3_VS_SLOW' && target.currentSpd < 3) {
      mult *= 1.33;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'thrallsVsSlow' });
    }

    // --- T4 debuff applied to attacker (was set by banshees in a previous turn this round) ---
    if (attacker.debuffed && attacker.debuffRound === bs.round) {
      mult *= 0.75;
      cl && events.push({ type: 'skill', sourceId: 'T4', key: 'debuffedAttacker', attackerId: attacker.id });
    }

    // --- T5 necromancers, E3 cultists, E8 giants persistent buff (damageBuff) ---
    const persistentBuff = attacker.damageBuff || 1.0;
    if (tier.skillId === 'T5_DEATH_BUFF' && persistentBuff > 1.0) {
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'necroBuff', mult: persistentBuff });
    }
    if (tier.skillId === 'E8_TACKLE_STACK' && persistentBuff > 1.0) {
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'giantStack', mult: persistentBuff });
    }

    // --- DAMAGE: round half-up at group level (Python: round(x + 0.001)) ---
    const rawDmg = aliveUnits * tier.dmg * mult * persistentBuff;
    const dmg = Math.max(0, Math.round(rawDmg + 0.001));

    target.currentHp = Math.max(0, target.currentHp - dmg);
    cl && events.push({
      type: 'attack',
      attackerId: attacker.id, targetId: target.id,
      damage: dmg, targetHp: target.currentHp, targetMaxHp: target.maxHp
    });

    // --- T6 gargoyles passive: when ATTACKED, reduce attacker speed by -2 ---
    if (target.tier.skillId === 'T6_SPEED_DEBUFF' && target.alive) {
      attacker.currentSpd = Math.max(0, attacker.currentSpd - 2);
      cl && events.push({ type: 'speedDebuff', sourceId: target.id, attackerId: attacker.id, newSpd: attacker.currentSpd });
    }

    // --- T7 blood witches splash on even rounds (25% of damage to all enemy rear) ---
    let witchesSplash = 0;
    if (tier.skillId === 'T7_SPLASH_REAR' && (bs.round % 2) === 0) {
      witchesSplash = Math.max(0, Math.round(dmg * 0.25 + 0.001));
    }

    // --- T4 banshees apply debuff to current target (resets per round; only one debuff per round globally) ---
    if (tier.skillId === 'T4_REARGUARD_DEBUFF') {
      // Python: banshees_reduce_target updated each banshees attack. Single global slot.
      bs.banshees_debuff_round = bs.round;
      bs.banshees_debuff_target = target;
      target.debuffed = true;
      target.debuffRound = bs.round;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 't4Debuff', targetId: target.id });
    }

    // --- DEATH HANDLING ---
    let lichesSplash = 0;
    let rotmawsOverkill = 0;
    let targetKilled = false;
    let targetKilledFront = (target.tier.pos === 'Vanguard') && target.side === 'ally';

    if (target.currentHp <= 0) {
      targetKilled = true;

      // E10 liches: on killing ally front, splash 50% to slowest ally rear
      if (tier.skillId === 'E10_LICH_SPLASH' && targetKilledFront) {
        lichesSplash = Math.max(0, Math.round(dmg * 0.50 + 0.001));
      }
      // T8 rotmaws: overkill transfers to next enemy
      if (tier.skillId === 'T8_OVERKILL') {
        rotmawsOverkill = -target.currentHp; // currentHp is <=0, overkill = positive value
      }
    }

    // Recalculate target units. Python: revived zombies use ORIGINAL HP=7 → "divide by 7"
    // Our tier.hp is always 7 for E2 (we don't change tier.hp on revive), so this works automatically.
    recomputeUnitsAfterDamage(target);
    if (targetKilled && !(target.tier.skillId === 'E2_REVIVE' && !target.revived)) {
      target.alive = false;
      cl && events.push({ type: 'death', groupId: target.id });
    }

    // T4 debuff transfer: if banshees debuffed zombies AND zombies died AND revived alive → transfer
    if (bs.banshees_debuff_round === bs.round &&
        bs.banshees_debuff_target &&
        bs.banshees_debuff_target.tier.skillId === 'E2_REVIVE' &&
        bs.banshees_debuff_target.currentHp === 0) {
      // Will be re-set after revive below
    }

    // --- E2 zombies revive (after death, but only first time, only if all zombies died) ---
    if (target.tier.skillId === 'E2_REVIVE' && targetKilled && !target.revived) {
      const zombiesDiff = target._aliveUnitsBefore - target.aliveUnits;
      if (zombiesDiff > 0 && target.aliveUnits === 0) {
        target.revived = true;
        target.currentHp = target.__originalQty;   // 1 HP per unit, total = original qty
        target.maxHp = target.__originalQty;
        target.aliveUnits = target.__originalQty;
        target.alive = true;
        cl && events.push({ type: 'revive', groupId: target.id, qty: target.__originalQty });

        // T4 debuff transfer to revived zombies (still same group object in our model, so already preserved)
        // No-op in our model since target.debuffed persists.
      }
    }

    // --- E10 liches splash damage to slowest ally rear ---
    if (lichesSplash > 0) {
      const allyRear = bs.groups.filter(g => g.alive && g.side === 'ally' && g.tier.pos === 'Rearguard')
        .sort((a, b) => a.currentSpd - b.currentSpd);
      const splashTarget = allyRear[0];
      if (splashTarget) {
        splashTarget.currentHp = Math.max(0, splashTarget.currentHp - lichesSplash);
        cl && events.push({
          type: 'splash', sourceId: attacker.id, targetId: splashTarget.id,
          damage: lichesSplash, kind: 'liches'
        });
        recomputeUnitsAfterDamage(splashTarget);
        if (splashTarget.currentHp <= 0) {
          splashTarget.alive = false;
          cl && events.push({ type: 'death', groupId: splashTarget.id });
        }
      }
    }

    // --- T7 blood witches splash damage to ALL enemy rear ---
    if (witchesSplash > 0) {
      const enemyRear = bs.groups.filter(g => g.alive && g.side === 'enemy' && g.tier.pos === 'Rearguard');
      for (const sp of enemyRear) {
        sp.currentHp = Math.max(0, sp.currentHp - witchesSplash);
        cl && events.push({
          type: 'splash', sourceId: attacker.id, targetId: sp.id,
          damage: witchesSplash, kind: 'witches'
        });
        recomputeUnitsAfterDamage(sp);
        if (sp.currentHp <= 0) {
          sp.alive = false;
          cl && events.push({ type: 'death', groupId: sp.id });
        }
      }
    }

    // --- T8 rotmaws overkill transfer ---
    if (rotmawsOverkill > 0) {
      const defOrder = sortDefendersFrontFirst(bs.groups, 'enemy');
      const next = defOrder[0];
      if (next) {
        next.currentHp = Math.max(0, next.currentHp - rotmawsOverkill);
        cl && events.push({
          type: 'overkill', sourceId: attacker.id, targetId: next.id, damage: rotmawsOverkill
        });
        recomputeUnitsAfterDamage(next);
        if (next.currentHp <= 0) {
          next.alive = false;
          cl && events.push({ type: 'death', groupId: next.id });
        }
      }
    }

    // --- E3 cultists per-turn buff after own attack ---
    if (tier.skillId === 'E3_BUFF_ALLY' && attacker.alive) {
      const candidates = bs.groups.filter(g => g.alive && g.side === 'enemy' && g.id !== attacker.id);
      if (candidates.length > 0) {
        let pick;
        if (ctx && ctx.randomTarget) {
          pick = candidates[Math.floor((ctx.rand ? ctx.rand() : Math.random()) * candidates.length)];
        } else {
          // Deterministic: strongest other enemy
          pick = candidates.reduce((best, g) =>
            (g.tier.dmg * g.aliveUnits > best.tier.dmg * best.aliveUnits) ? g : best);
        }
        pick.damageBuff = +(((pick.damageBuff || 1.0) + 0.10).toFixed(2));
        cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'cultistBuff', targetId: pick.id, mult: pick.damageBuff });
      }
    }

    // --- E5 corpses death thorns (uses INITIAL HP per Python) ---
    if (target.tier.skillId === 'E5_DEATH_THORNS') {
      const corpsesDiff = target._aliveUnitsBefore - target.aliveUnits;
      if (corpsesDiff > 0 && target.aliveUnits === 0) {
        const thorns = Math.max(1, Math.ceil(target.__originalQty * target.tier.hp * 0.20));
        attacker.currentHp = Math.max(0, attacker.currentHp - thorns);
        cl && events.push({ type: 'thorns', sourceId: target.id, attackerId: attacker.id, damage: thorns });
        recomputeUnitsAfterDamage(attacker);
        if (attacker.currentHp <= 0) {
          attacker.alive = false;
          cl && events.push({ type: 'death', groupId: attacker.id });
        }
      }
    }

    // --- E8 bone giants stacking: +5% per tackle (when attacked) ---
    if (target.tier.skillId === 'E8_TACKLE_STACK' && target.alive) {
      target.damageBuff = +(((target.damageBuff || 1.0) + 0.05).toFixed(2));
      cl && events.push({ type: 'skill', sourceId: target.id, key: 'giantTackle', mult: target.damageBuff });
    }

    // --- E8 bone giants reset on own attack ---
    if (tier.skillId === 'E8_TACKLE_STACK') {
      attacker.damageBuff = 1.0;
      cl && events.push({ type: 'skill', sourceId: attacker.id, key: 'giantReset' });
    }

    // --- T5 necromancers: +10% damage stack per group eliminated THIS turn ---
    const necros = bs.groups.find(g => g.alive && g.tier.skillId === 'T5_DEATH_BUFF');
    if (necros) {
      let newDeaths = 0;
      for (const g of bs.groups) {
        const before = g._aliveUnitsBefore;
        if (before > 0 && g.aliveUnits === 0) newDeaths++;
      }
      if (newDeaths > 0) {
        necros.damageBuff = +(((necros.damageBuff || 1.0) + 0.10 * newDeaths).toFixed(2));
        cl && events.push({ type: 'skill', sourceId: necros.id, key: 'necroStack', mult: necros.damageBuff, deaths: newDeaths });
      }
    }

    return events;
  }

  // ============================================================
  // SIMULATE ONE ROUND
  // ============================================================
  function simulateRound(bs, ctx) {
    const events = [];
    bs.round++;
    bs.turnCount = 0;

    // Reset per-round flags
    for (const g of bs.groups) {
      g.attackedThisRound = false;
      // T4 debuff: applies to target's NEXT attack within the SAME round (Python: same round only)
      // We clear debuff if it was set in a previous round.
      if (g.debuffed && g.debuffRound < bs.round - 1) {
        g.debuffed = false;
        g.debuffRound = -1;
      }
    }

    // Build attacker order at round start (snapshot)
    const order = sortAttackers(bs.groups);
    events.push({ type: 'roundStart', round: bs.round, order: order.map(g => g.id) });

    // Per-round T4 banshees state (Python: banshees_reduce_round, banshees_reduce_target)
    bs.banshees_debuff_round = -1;
    bs.banshees_debuff_target = null;

    for (let i = 0; i < order.length; i++) {
      const attacker = order[i];
      if (!attacker.alive || attacker.aliveUnits <= 0) continue;

      bs.turnCount++;
      const target = pickTarget(attacker, bs.groups);
      if (!target) continue;

      attacker.attackedThisRound = true;
      const attackEvents = performAttack(attacker, target, bs, ctx);
      events.push(...attackEvents);

      // E9 broodmothers end-of-round spawn (Python: triggers after LAST capable attacker of round)
      // Detect: no remaining capable attackers after this turn
      const stillToAct = order.slice(i + 1).some(g => g.alive && g.aliveUnits > 0);
      if (!stillToAct) {
        const broodmothers = bs.groups.find(g => g.alive && g.tier.skillId === 'E9_SPAWN_SPIDERLINGS');
        if (broodmothers) {
          let spider = bs.groups.find(g => g.id === 'E9S');
          if (!spider) {
            spider = buildGroup('enemy', SPIDERLINGS_TIER, 0);
            bs.groups.push(spider);
          }
          spider.aliveUnits += 10;
          spider.qty += 10;
          spider.__originalQty += 10;
          spider.currentHp += 10 * SPIDERLINGS_TIER.hp;
          spider.maxHp += 10 * SPIDERLINGS_TIER.hp;
          spider.alive = true;
          // Keep cached HP totals in sync for early-termination math (v1.3.0).
          if (typeof bs._enemyMaxHpTotal === 'number') {
            bs._enemyMaxHpTotal += 10 * SPIDERLINGS_TIER.hp;
          }
          events.push({ type: 'spawn', sourceId: broodmothers.id, targetId: spider.id, qty: 10 });
        }
      }

      // Early termination check (don't process more attackers if a side is wiped)
      const alliesLeft = bs.groups.some(g => g.alive && g.side === 'ally');
      const enemiesLeft = bs.groups.some(g => g.alive && g.side === 'enemy');
      if (!alliesLeft || !enemiesLeft) break;
    }

    return events;
  }

  // ============================================================
  // PUBLIC API: simulate
  // ============================================================
  function simulate(allyQtys, enemyQtys, opts) {
    opts = opts || {};
    const maxRounds = opts.maxRounds || 50;
    const collectLog = opts.collectLog !== false; // default true

    // ── EARLY TERMINATION CONFIG (v1.3.0) ──
    // Default ON for optimizer/bot use. UI animated replay should pass earlyTermination:false.
    // Thresholds tuned via tune_thresholds.js + test_realistic.js:
    //   • 5% ally HP / 60% enemy HP is the conservative point where no winners
    //     are ever misclassified as defeats across ~380k validation pairs.
    //   • Checks run every other round (R3,R5,R7,...) to keep per-battle overhead
    //     low enough that the speedup outweighs the cost.
    const earlyTermination     = opts.earlyTermination !== false;
    const etMinRound           = (opts.etMinRound           != null) ? opts.etMinRound           : 3;
    const etCheckEveryRounds   = (opts.etCheckEveryRounds   != null) ? opts.etCheckEveryRounds   : 2;    // 1 = every round, 2 = every other, etc.
    const etHopelessAllyHpPct  = (opts.etHopelessAllyHpPct  != null) ? opts.etHopelessAllyHpPct  : 0.05; // ally HP fraction below this AND
    const etHopelessEnemyHpPct = (opts.etHopelessEnemyHpPct != null) ? opts.etHopelessEnemyHpPct : 0.60; //  enemy HP fraction above this → hopeless
    const etStalemateWindow    = (opts.etStalemateWindow    != null) ? opts.etStalemateWindow    : 3;    // compare oldest vs newest entry of this length
    const etStalemateDeltaPct  = (opts.etStalemateDeltaPct  != null) ? opts.etStalemateDeltaPct  : 0.01; // < 1% cumulative HP change on both sides → stalemate
    const etNoKillRound        = (opts.etNoKillRound        != null) ? opts.etNoKillRound        : 5;    // after this many rounds, if 0 enemy groups killed → defeat
    const etNoKillEnemyHpPct   = (opts.etNoKillEnemyHpPct   != null) ? opts.etNoKillEnemyHpPct   : 0.85; // ...AND enemy HP fraction still above this

    const allies = buildGroups('ally', ALLY_TIERS, allyQtys || {});
    const enemies = buildGroups('enemy', ENEMY_TIERS, enemyQtys || {});

    if (allies.length === 0 || enemies.length === 0) return null;

    const bs = {
      groups: [...allies, ...enemies],
      round: 0,
      turnCount: 0,
      banshees_debuff_round: -1,
      banshees_debuff_target: null,
      _hpHistory: [],                          // for stalemate detection
      _enemyGroupsInitial: enemies.length,     // for no_kills detection
      _allyMaxHpTotal:  allies.reduce((s, g) => s + g.maxHp, 0),  // ET fast path: cached denominator
      _enemyMaxHpTotal: enemies.reduce((s, g) => s + g.maxHp, 0), // (E9 spiderlings adjusted below)
    };

    const ctx = {
      randomTarget: opts.randomTarget !== false,  // default true (matches Python)
      rand: opts.rand || Math.random,
      collectLog: collectLog,                     // v1.4.0: skip event pushes when false
    };

    const log = collectLog ? [{ type: 'battleStart', allies: allies.map(g => g.id), enemies: enemies.map(g => g.id) }] : null;

    let e3KilledRound1 = false;
    let earlyExit = false;
    let earlyExitReason = null;

    while (bs.round < maxRounds) {
      const alliesLeft = bs.groups.some(g => g.alive && g.side === 'ally');
      const enemiesLeft = bs.groups.some(g => g.alive && g.side === 'enemy');
      if (!alliesLeft || !enemiesLeft) break;

      const events = simulateRound(bs, ctx);
      if (collectLog) log.push(...events);

      // Optimizer signal: was E3 killed in round 1?
      if (bs.round === 1) {
        const hasE3 = enemies.some(g => g.tier.skillId === 'E3_BUFF_ALLY');
        const e3Dead = bs.groups.filter(g => g.tier.skillId === 'E3_BUFF_ALLY').every(g => !g.alive);
        if (hasE3 && e3Dead) e3KilledRound1 = true;
      }

      // ── EARLY TERMINATION (v1.3.0) ──
      // Skips rounds 3..50 when the outcome is already determined. Three triggers:
      //   (1) no_kills        — after N rounds the ally hasn't killed any enemy group → defeat
      //   (2) hopeless_defeat — ally HP collapsed AND enemy still strong → mark allies dead
      //   (3) stalemate       — both sides barely losing HP for N rounds → exit as non-victory
      // Disabled when opts.earlyTermination === false (UI animated replay wants full battle).
      //
      // Optimization: maxHp totals are cached at battle start (E9 spiderlings adjust
      // bs._enemyMaxHpTotal in their spawn handler). Checks only run every Nth round
      // from etMinRound, keeping per-battle overhead small.
      const etShouldCheck = earlyTermination &&
        bs.round >= etMinRound &&
        ((bs.round - etMinRound) % etCheckEveryRounds === 0);
      if (etShouldCheck) {
        let aHp = 0, eHp = 0;
        let enemyAlive = 0;
        for (let gi = 0; gi < bs.groups.length; gi++) {
          const g = bs.groups[gi];
          if (g.side === 'ally') {
            aHp += g.currentHp;
          } else {
            eHp += g.currentHp;
            if (g.alive && g.id !== 'E9S') enemyAlive++; // ignore spawned spiderlings
          }
        }
        const aMax = bs._allyMaxHpTotal;
        const eMax = bs._enemyMaxHpTotal;
        const aPct = aMax > 0 ? aHp / aMax : 0;
        const ePct = eMax > 0 ? eHp / eMax : 0;

        // (1) No kills — after etNoKillRound rounds, ally hasn't eliminated a single
        // enemy group AND enemy HP is still essentially intact. Formation is too weak
        // to threaten this enemy mix — defeat regardless of how long we keep simulating.
        if (bs.round >= etNoKillRound &&
            enemyAlive >= bs._enemyGroupsInitial &&
            ePct > etNoKillEnemyHpPct) {
          earlyExit = true;
          earlyExitReason = 'no_kills';
          for (const g of bs.groups) {
            if (g.side === 'ally' && g.alive) {
              g.currentHp = 0;
              g.aliveUnits = 0;
              g.alive = false;
            }
          }
          if (collectLog) log.push({
            type: 'earlyExit', reason: 'no_kills',
            round: bs.round, enemyHpPct: ePct, enemyGroupsAlive: enemyAlive
          });
          break;
        }

        // (2) Hopeless defeat — ally is almost dead AND enemy still strong.
        // We mark all surviving allies as dead so essenceLost reflects a full loss.
        // This is required because the optimizer scores by essenceLost — leaving
        // surviving units alive would understate the loss of a doomed formation.
        if (aPct < etHopelessAllyHpPct && ePct > etHopelessEnemyHpPct) {
          earlyExit = true;
          earlyExitReason = 'hopeless_defeat';
          for (const g of bs.groups) {
            if (g.side === 'ally' && g.alive) {
              g.currentHp = 0;
              g.aliveUnits = 0;
              g.alive = false;
            }
          }
          if (collectLog) log.push({
            type: 'earlyExit', reason: 'hopeless_defeat',
            round: bs.round, allyHpPct: aPct, enemyHpPct: ePct
          });
          break;
        }

        // (3) Stalemate — track HP each round; if window-spanning change is tiny
        // on BOTH sides, neither side will resolve before maxRounds. Exit early.
        bs._hpHistory.push(aHp + eHp * 65536); // pack into one number (small allocations)
        if (bs._hpHistory.length > etStalemateWindow) bs._hpHistory.shift();
        if (bs._hpHistory.length === etStalemateWindow) {
          const oldest = bs._hpHistory[0];
          const newest = bs._hpHistory[bs._hpHistory.length - 1];
          const oldestA = oldest % 65536, oldestE = Math.floor(oldest / 65536);
          const newestA = newest % 65536, newestE = Math.floor(newest / 65536);
          const dA = aMax > 0 ? Math.abs(newestA - oldestA) / aMax : 0;
          const dE = eMax > 0 ? Math.abs(newestE - oldestE) / eMax : 0;
          if (dA < etStalemateDeltaPct && dE < etStalemateDeltaPct) {
            earlyExit = true;
            earlyExitReason = 'stalemate';
            if (collectLog) log.push({
              type: 'earlyExit', reason: 'stalemate',
              round: bs.round, allyDelta: dA, enemyDelta: dE
            });
            break;
          }
        }
      }
    }

    const finalAlliesAlive = bs.groups.some(g => g.alive && g.side === 'ally');
    const finalEnemiesAlive = bs.groups.some(g => g.alive && g.side === 'enemy');
    const victory = finalAlliesAlive && !finalEnemiesAlive;
    const draw = !finalAlliesAlive && !finalEnemiesAlive;

    // Tally losses (ally only — enemies don't count for blood essence)
    let essenceLost = 0;
    let unitsLost = 0;
    let unitsSurvived = 0;
    const lossesPerTier = {};
    for (const g of bs.groups) {
      if (g.side !== 'ally') continue;
      const survived = g.alive ? g.aliveUnits : 0;
      const lost = g.qty - survived;
      lossesPerTier[g.id] = { lost, survived, qty: g.qty };
      essenceLost += lost * (g.tier.cost || 0);
      unitsLost += lost;
      unitsSurvived += survived;
    }

    if (collectLog) log.push({ type: 'battleEnd', victory, draw, rounds: bs.round });

    return {
      victory, draw, rounds: bs.round,
      essenceLost, unitsLost, unitsSurvived,
      lossesPerTier,
      e3KilledRound1,
      earlyExit, earlyExitReason,
      log: collectLog ? log : null,
      finalState: bs.groups.map(g => ({
        id: g.id, side: g.side, qty: g.qty, alive: g.alive,
        aliveUnits: g.aliveUnits, currentHp: g.currentHp, maxHp: g.maxHp,
      })),
    };
  }

  // ============================================================
  // EXPORT
  // ============================================================
  const api = {
    ALLY_TIERS: ALLY_TIERS,
    ENEMY_TIERS: ENEMY_TIERS,
    SPIDERLINGS_TIER: SPIDERLINGS_TIER,
    getTypeMultiplier: getTypeMultiplier,
    tierById: tierById,
    simulate: simulate,
    setRotmawsHealth: function (hp) {
      const t8 = ALLY_TIERS.find(t => t.id === 'T8');
      if (t8) t8.hp = hp;
    },
    VERSION: '1.4.0',
  };

  // Browser global (main thread)
  if (typeof window !== 'undefined') window.BFEngine = api;
  // Web Worker global
  if (typeof self !== 'undefined' && typeof window === 'undefined') self.BFEngine = api;
  // CommonJS for Node testing
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Fallback to globalThis
  if (typeof globalThis !== 'undefined' && !globalThis.BFEngine) globalThis.BFEngine = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);
