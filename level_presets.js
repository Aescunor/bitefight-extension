// ============================================================================
// Bitefight Bot v1.2.1 — Smart Level Presets (Warm-Start Optimization)
// Copyright (C) 2026 Aescunor — GNU General Public License v3.0
// ----------------------------------------------------------------------------
// Per-layer approximate unit counts that narrow the optimizer search space
// from hundreds of thousands of combinations to a few hundred. Used by:
//   - simulator.js   (Smart Preset section in optimizer UI)
//   - bot.js         (Ruins bot — when no exact preset match, use warm-start)
//
// This is COMPLEMENTARY to the existing exact-match preset system in bot.js:
//   * Exact-match presets:   per (level, enemyQtys) → exact formation. Fastest.
//   * Smart/warm-start (us): per level → approximate formation ± range.
//                            Narrows optimizer space, still uses simulation.
//
// When the bot can't find an exact match, it now checks for a warm-start
// preset and runs the optimizer with narrowed ranges instead of full space.
//
// Storage:
//   chrome.storage.local key: 'bf_smart_presets_v1'
//   Format: { "27": { tiers: {T1: 70, T2: 45, T3: 22, T4: "auto"},
//                      confidence: "green",
//                      note: "Tested 50 battles",
//                      lastUsed: 1234567890 }, ... }
// ============================================================================

(function (root) {
  'use strict';

  const STORAGE_KEY = 'bf_smart_presets_v1';
  const CURRENT_LAYER_KEY = 'bf_current_layer';

  // ============================================================
  // DEFAULT PRESETS (built-in starter data)
  // ============================================================
  // User-edited presets override these via chrome.storage.local
  // Format: tiers: { T1: <num>|"auto", T2: ..., T8: ... }
  //   - Numeric value: target count
  //   - "auto": deterministic calculation (e.g. T4 from E3 count when
  //             Kill E3 R1 strategy is active)
  //   - missing tier: treat as 0
  // Confidence: 'red' (no data) | 'yellow' (limited testing) | 'green' (verified)

  const DEFAULT_PRESETS = {
    // ──── Example preset (from user's design notes) ─────────────────
    "27": {
      tiers: { T1: 70, T2: 45, T3: 22, T4: "auto" },
      confidence: "yellow",
      note: "Template — replace with your tested values",
    },
  };

  // ============================================================
  // STORAGE
  // ============================================================

  function getChromeStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  // Load presets (merges defaults with user overrides)
  function loadPresets(callback) {
    const cs = getChromeStorage();
    if (!cs) {
      callback(Object.assign({}, DEFAULT_PRESETS));
      return;
    }
    cs.get([STORAGE_KEY], function (r) {
      if (chrome.runtime && chrome.runtime.lastError) {
        console.warn('[BFPresets] storage.get error:', chrome.runtime.lastError);
        callback(Object.assign({}, DEFAULT_PRESETS));
        return;
      }
      const userPresets = (r && r[STORAGE_KEY]) ? r[STORAGE_KEY] : {};
      // Merge: user presets take precedence over defaults
      const merged = Object.assign({}, DEFAULT_PRESETS, userPresets);
      callback(merged);
    });
  }

  // Save presets (full replacement of stored object)
  function savePresets(presets, callback) {
    const cs = getChromeStorage();
    if (!cs) {
      if (callback) callback(new Error('chrome.storage not available'));
      return;
    }
    const obj = {};
    obj[STORAGE_KEY] = presets;
    cs.set(obj, function () {
      if (chrome.runtime && chrome.runtime.lastError) {
        if (callback) callback(chrome.runtime.lastError);
        return;
      }
      if (callback) callback(null);
    });
  }

  // Synchronous getter — call loadPresets first to populate cache
  let _cache = null;
  function getCached() { return _cache; }
  function setCached(p) { _cache = p; }

  function getPresetForLevel(level, presets) {
    const p = presets || _cache;
    if (!p) return null;
    return p[String(level)] || null;
  }

  // Save/update one level's preset
  function updateLevelPreset(level, presetData, callback) {
    loadPresets(function (current) {
      current[String(level)] = presetData;
      _cache = current;
      savePresets(current, callback);
    });
  }

  function deleteLevelPreset(level, callback) {
    loadPresets(function (current) {
      delete current[String(level)];
      _cache = current;
      savePresets(current, callback);
    });
  }

  // ============================================================
  // CURRENT LAYER (written by bot.js, read by simulator panel)
  // ============================================================

  function saveCurrentLayer(layer) {
    const cs = getChromeStorage();
    if (!cs) return;
    const obj = {};
    obj[CURRENT_LAYER_KEY] = { layer: layer, ts: Date.now() };
    cs.set(obj);
  }

  function loadCurrentLayer(callback) {
    const cs = getChromeStorage();
    if (!cs) { callback(null); return; }
    cs.get([CURRENT_LAYER_KEY], function (r) {
      const data = r && r[CURRENT_LAYER_KEY];
      callback(data && typeof data.layer === 'number' ? data : null);
    });
  }

  // ============================================================
  // DETERMINISTIC T4 LOWER BOUND (Kill E3 R1 strategy)
  // ============================================================
  // T4 banshees: dmg=7, Monster type, attacks rearguard.
  // E3 cultists: hp=1, Occult type. Monster vs Occult = ×0.5 multiplier.
  // Per-unit T4 vs E3 damage: 7 × 0.5 = 3.5 → round-half-up = 4.
  // So 1 T4 unit kills 4 E3 units in one attack.
  //
  // Returns the MINIMUM T4 count needed to wipe all E3 in round 1.
  // The actual optimum may EXCEED this minimum — additional T4 add
  // damage against other rear targets (E4 bonewings, E6 wraiths, etc.)
  // and provide HP buffer. So this value is used as a lower bound only,
  // NOT as a fixed amount.
  //
  // Note: T4 attacks rear first. If other rear enemies exist (E4, E6,
  // E9, E10), T4 may target them first. We add a small safety margin
  // to compensate for E3 not always being the first rear pick.

  function calculateAutoT4(enemyQtys, options) {
    options = options || {};
    const safetyMargin = options.safetyMargin != null ? options.safetyMargin : 2;
    const e3Count = enemyQtys && (enemyQtys.E3 || 0);
    if (e3Count <= 0) return 0;

    // Per-unit T4 → E3 dmg: ceil/round-half-up(7 × 0.5) = 4
    const dmgPerT4 = 4;
    const minT4 = Math.ceil(e3Count / dmgPerT4);
    return minT4 + safetyMargin;
  }

  // ============================================================
  // BUILD OPTIMIZER RANGES FROM PRESET
  // ============================================================
  // Takes a preset + range (±N) and returns the min/max per tier to pass
  // to the optimizer's generateCombinations. Returns also a deterministic
  // T4 count if 'auto' is set and Kill E3 R1 is active.

  function buildRangesFromPreset(preset, options) {
    options = options || {};
    const range = options.range != null ? options.range : 15;
    const enemyQtys = options.enemyQtys || {};
    const stratKillE3 = !!options.stratKillE3;

    if (!preset || !preset.tiers) return null;

    const minPerTier = {};
    const maxPerTier = {};
    const computed = {};  // for UI display

    Object.keys(preset.tiers).forEach(function (tierId) {
      const val = preset.tiers[tierId];

      if (val === 'auto') {
        // 'auto' = LOWER BOUND only.
        // For T4 with Kill E3 R1 active: minimum count needed to kill all E3
        // in round 1. The optimum may exceed this (extra T4 deal damage to
        // other rear targets, or just provide HP buffer). DO NOT fix as max.
        if (tierId === 'T4' && stratKillE3) {
          const t4min = calculateAutoT4(enemyQtys, options);
          minPerTier[tierId] = t4min;
          // No max constraint — let optimizer explore up to power cap
          computed[tierId] = { autoMin: t4min, mode: 'auto', source: 'killE3' };
        } else {
          // 'auto' without Kill E3 R1: no constraint
          computed[tierId] = { mode: 'auto', source: 'no-strategy' };
        }
      } else if (typeof val === 'number' && val > 0) {
        const target = val;
        const lo = Math.max(0, target - range);
        const hi = target + range;
        minPerTier[tierId] = lo;
        maxPerTier[tierId] = hi;
        computed[tierId] = { target: target, min: lo, max: hi, mode: 'range' };
      } else if (val === 0) {
        // Explicit zero: include 0 in range only (skip this tier)
        minPerTier[tierId] = 0;
        maxPerTier[tierId] = 0;
        computed[tierId] = { target: 0, min: 0, max: 0, mode: 'zero' };
      }
    });

    return { minPerTier: minPerTier, maxPerTier: maxPerTier, computed: computed };
  }

  // ============================================================
  // VALIDATION
  // ============================================================
  // Sanity-check a preset object — returns array of error strings (empty if OK)

  function validatePreset(preset) {
    const errors = [];
    if (!preset || typeof preset !== 'object') {
      errors.push('Preset must be an object');
      return errors;
    }
    if (!preset.tiers || typeof preset.tiers !== 'object') {
      errors.push('Preset.tiers must be an object');
      return errors;
    }
    const validTierIds = ['T1','T2','T3','T4','T5','T6','T7','T8'];
    Object.keys(preset.tiers).forEach(function (k) {
      if (validTierIds.indexOf(k) < 0) {
        errors.push('Unknown tier ID: ' + k);
        return;
      }
      const v = preset.tiers[k];
      if (v !== 'auto' && (typeof v !== 'number' || v < 0 || v > 999)) {
        errors.push('Tier ' + k + ' must be a number 0-999 or "auto"');
      }
    });
    if (preset.confidence && ['red','yellow','green'].indexOf(preset.confidence) < 0) {
      errors.push('Confidence must be red/yellow/green');
    }
    return errors;
  }

  // ============================================================
  // EXPORTS
  // ============================================================

  const api = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_PRESETS: DEFAULT_PRESETS,
    loadPresets: loadPresets,
    savePresets: savePresets,
    getCached: getCached,
    setCached: setCached,
    getPresetForLevel: getPresetForLevel,
    updateLevelPreset: updateLevelPreset,
    deleteLevelPreset: deleteLevelPreset,
    saveCurrentLayer: saveCurrentLayer,
    loadCurrentLayer: loadCurrentLayer,
    calculateAutoT4: calculateAutoT4,
    buildRangesFromPreset: buildRangesFromPreset,
    validatePreset: validatePreset,
    VERSION: '1.2.1',
  };

  // Browser global (main thread / panel)
  if (typeof window !== 'undefined') window.BFPresets = api;
  // Web Worker scope
  if (typeof self !== 'undefined' && typeof window === 'undefined') self.BFPresets = api;
  // CommonJS for Node testing
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // Fallback
  if (typeof globalThis !== 'undefined' && !globalThis.BFPresets) globalThis.BFPresets = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);
