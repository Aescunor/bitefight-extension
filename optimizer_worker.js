// ============================================================================
// Bitefight Bot v1.1.0 — Optimizer Worker
// Copyright (C) 2026 Aescunor — GNU General Public License v3.0
// ----------------------------------------------------------------------------
// Dedicated Web Worker that runs a slice of the optimizer search space.
//
// Communication protocol:
//   in (main → worker): {type: 'init', enginePath}
//                        {type: 'run', mode, allyTiers, unlockedAllyIds,
//                                       powerLimit, maxPerTier, splitTierId,
//                                       splitMin, splitMax, enemyQtys,
//                                       stratKillE3, maxCandidates}
//   out (worker → main): {type: 'progress', tested, total, found}
//                         {type: 'done', results: [...], tested, scope}
//                         {type: 'error', message}
//
// Each worker gets a non-overlapping range [splitMin, splitMax] of the
// "split tier" (typically T1 — the most common tier with the highest count).
// This guarantees that the union of all workers' work = whole search space
// with no duplicates.
// ============================================================================

'use strict';

let ENGINE_READY = false;
let ALLY_TIERS_FULL = null;
let ENEMY_TIERS_FULL = null;

self.onmessage = function (e) {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      importScripts(msg.enginePath);
      if (typeof self.BFEngine !== 'object' || !self.BFEngine.simulate) {
        self.postMessage({ type: 'error', message: 'Engine failed to expose BFEngine on self' });
        return;
      }
      ALLY_TIERS_FULL = self.BFEngine.ALLY_TIERS;
      ENEMY_TIERS_FULL = self.BFEngine.ENEMY_TIERS;
      ENGINE_READY = true;
      self.postMessage({ type: 'ready', engineVersion: self.BFEngine.VERSION });
      return;
    }

    if (msg.type === 'run') {
      if (!ENGINE_READY) {
        self.postMessage({ type: 'error', message: 'Engine not initialized — send init first' });
        return;
      }
      runOptimizerSlice(msg);
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: 'Worker exception: ' + (err && err.message ? err.message : String(err)),
      stack: err && err.stack ? err.stack : null,
    });
  }
};

// ============================================================================
// Combination generator (Branch & Bound) — local to worker
// Filtered by [splitMin..splitMax] on splitTierId so workers don't overlap.
// ============================================================================

function* generateCombinations(powerLimit, maxPerTier, unlockedAllyIds, splitTierId, splitMin, splitMax, minPerTier) {
  const tiers = ALLY_TIERS_FULL.filter(t => unlockedAllyIds.indexOf(t.id) >= 0);

  function* recurse(idx, remaining, current) {
    if (idx === tiers.length) {
      if (current.some(v => v > 0)) yield current.slice();
      return;
    }
    const tier = tiers[idx];
    const hardMax = Math.floor(remaining / tier.power);
    let userMax = (maxPerTier && maxPerTier[tier.id] != null) ? maxPerTier[tier.id] : hardMax;
    let userMin = (minPerTier && minPerTier[tier.id] != null) ? Math.max(0, minPerTier[tier.id]) : 0;

    // Apply split range to the chosen split tier (overrides preset min if narrower)
    if (tier.id === splitTierId) {
      userMin = Math.max(userMin, splitMin);
      userMax = Math.min(userMax, splitMax);
    }

    const max = Math.min(hardMax, userMax);
    for (let q = userMin; q <= max; q++) {
      current[idx] = q;
      yield* recurse(idx + 1, remaining - q * tier.power, current);
    }
  }

  const buf = new Array(tiers.length).fill(0);
  for (const combo of recurse(0, powerLimit, buf)) {
    const qtys = {};
    ALLY_TIERS_FULL.forEach(t => { qtys[t.id] = 0; });
    tiers.forEach((t, i) => { qtys[t.id] = combo[i]; });
    yield qtys;
  }
}

// ============================================================================
// Main worker logic
// ============================================================================

function runOptimizerSlice(msg) {
  const {
    mode,                  // 'deep' | 'fast'
    powerLimit,
    maxPerTier,
    minPerTier,            // optional warm-start lower bounds (smart preset)
    unlockedAllyIds,
    splitTierId,
    splitMin,
    splitMax,
    enemyQtys,
    stratKillE3,
    maxCandidates,
    progressEveryMs = 100,
  } = msg;

  const tiers = ALLY_TIERS_FULL.filter(t => unlockedAllyIds.indexOf(t.id) >= 0);
  const results = [];
  let tested = 0;
  let lastProgress = Date.now();

  if (mode === 'deep') {
    // Deep mode: simulate every combination, collect all results
    for (const allyQtys of generateCombinations(powerLimit, maxPerTier, unlockedAllyIds, splitTierId, splitMin, splitMax, minPerTier)) {
      tested++;
      const r = self.BFEngine.simulate(allyQtys, enemyQtys, {
        randomTarget: false,
        collectLog: false,
        maxRounds: 50,
      });
      if (r) {
        results.push({
          allyQtys: allyQtys,
          victory: r.victory,
          draw: r.draw,
          rounds: r.rounds,
          essenceLost: r.essenceLost,
          unitsLost: r.unitsLost,
          unitsSurvived: r.unitsSurvived,
          e3KilledRound1: r.e3KilledRound1,
          power: tiers.reduce((s, t) => s + (allyQtys[t.id] || 0) * t.power, 0),
          totalCost: ALLY_TIERS_FULL.reduce((s, t) => s + (allyQtys[t.id] || 0) * (t.cost || 0), 0),
        });
      }
      if (Date.now() - lastProgress > progressEveryMs) {
        self.postMessage({ type: 'progress', tested: tested, found: results.length });
        lastProgress = Date.now();
      }
    }

    self.postMessage({
      type: 'done',
      mode: 'deep',
      results: results,
      tested: tested,
      scope: { splitTierId, splitMin, splitMax },
    });
    return;
  }

  if (mode === 'fast') {
    // Fast Scan: generate candidates, sort by power desc, simulate until enough winners
    const candidates = [];
    const MAX_CANDIDATES_PER_WORKER = maxCandidates || 200_000;

    for (const allyQtys of generateCombinations(powerLimit, maxPerTier, unlockedAllyIds, splitTierId, splitMin, splitMax, minPerTier)) {
      const power = tiers.reduce((s, t) => s + (allyQtys[t.id] || 0) * t.power, 0);
      candidates.push({ qtys: allyQtys, power: power });
      if (candidates.length >= MAX_CANDIDATES_PER_WORKER) break;
      if (Date.now() - lastProgress > progressEveryMs) {
        self.postMessage({ type: 'progress', phase: 'generating', tested: candidates.length, found: 0 });
        lastProgress = Date.now();
      }
    }

    candidates.sort((a, b) => b.power - a.power);

    const TARGET = msg.targetWinners || 60;
    for (const c of candidates) {
      tested++;
      const r = self.BFEngine.simulate(c.qtys, enemyQtys, {
        randomTarget: false,
        collectLog: false,
        maxRounds: 50,
      });
      if (r && r.victory) {
        if (!stratKillE3 || r.e3KilledRound1) {
          results.push({
            allyQtys: c.qtys,
            victory: true,
            draw: r.draw,
            rounds: r.rounds,
            essenceLost: r.essenceLost,
            unitsLost: r.unitsLost,
            unitsSurvived: r.unitsSurvived,
            e3KilledRound1: r.e3KilledRound1,
            power: c.power,
            totalCost: ALLY_TIERS_FULL.reduce((s, t) => s + (c.qtys[t.id] || 0) * (t.cost || 0), 0),
          });
          if (results.length >= TARGET) break;
        }
      }
      if (Date.now() - lastProgress > progressEveryMs) {
        self.postMessage({ type: 'progress', phase: 'scanning', tested: tested, found: results.length });
        lastProgress = Date.now();
      }
    }

    self.postMessage({
      type: 'done',
      mode: 'fast',
      results: results,
      tested: tested,
      scope: { splitTierId, splitMin, splitMax },
    });
    return;
  }

  self.postMessage({ type: 'error', message: 'Unknown mode: ' + mode });
}
