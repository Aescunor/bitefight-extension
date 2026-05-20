# ⚔ Bitefight Extension

Chrome extension for **[Bitefight](https://www.bitefight.gameforge.com/)** — a vampire-themed browser strategy game by Gameforge. Provides a battle simulator with parallel formation optimizer and a full suite of automation bots with multi-window scheduling.

> **v1.6.14** · Chrome Manifest V3 · Language-independent (works on every Bitefight server)

---

## Features

### 🎯 Battle Simulator
- Full combat simulation replicating in-game mechanics (attack order, unit types, tier abilities, damage calculation, E2 revival pool, E3 buff, E4 first-strike)
- Interactive army builder with tier unlock system (T1–T8) and power limits
- Step-by-step or auto-play battle visualization with detailed combat log
- **Parallel Formation Optimizer** — multi-WebWorker brute-force and fast-scan modes that split the search space across CPU cores
- **Smart per-layer presets** — narrow the optimizer search by encoding approximate unit counts per ruins level
- **Per-enemy exact-match presets** — instant lookup when an enemy composition has been seen before
- Accuracy >90 % above level 20; lower-level battles depend more on item RNG, so expect more variance there

### 🤖 Bot Modules
- **Hunt Bot** — automated human hunting with AB %-based tier selection, configurable HP thresholds, orb cooldown handling, and per-quality essence filters
- **Ruins Bot** — automated ruins farming with per-level formation presets, fight-result detection, and warm-start optimizer fallback when no exact preset matches
- **Story Bot** — story-mode automation with 8-aspect priority system and individual aspect thresholds
- **Grotto Bot** — demon hunting with difficulty selection
- **PvP Bot** — player vs player hunting with target search, whitelist/blacklist, race filter, and smart break timing
- **Henchman vs Henchman Bot** *(v1.6.9)* — automated henchman fights; mutually exclusive with PvP at runtime
- **Gifts Bot** — automated dark-blue and purple gift opening
- **Inventory Cleanup** *(v1.6.13)* — auto-discards low-level drop items (Omega items, ruins loot) with min/max level range and Preview mode; equipped items, elixirs, and gifts are protected by a hard whitelist

### ⚙ Global Features
- **Schedule system** *(v1.6.7 / v1.6.8)* — time-based slots with per-slot action selection (Hunt / Story / PvP / Henchman / Ruins / Grotto / Inv-Cleanup), multi-layout support (e.g. Weekday / Weekend), overnight spans, 24 h "always on" blocks
- **Central STOP** *(v1.6.5)* — emergency halt that cancels every scheduled bot timer through a registered timer registry
- **Auto-Recruitment** — percentage-based essence distribution across T1–T4 units with multiple triggers (extraction / idle / threshold / continuous)
- **Gold management** — auto-spend on training or auto-donate to clan above configurable thresholds, with anti-raid preemption
- **Graveyard work** — auto-fills idle periods when AP or HP is low
- **Background page refresh** — keeps the session alive with configurable interval and ETA countdown
- Blood Essence extraction tracking and per-rank quality filters
- **Battle log** with CSV and **XLSX import/export** *(v1.6.6)* — pure-JS implementation, no external libraries
- **Per-character storage isolation** — `chrome.storage.local` keys are prefixed with server + player ID (e.g. `s25- ...*`), so multiple characters on the same server stay independent
- Pin/unpin floating bot panel with tab persistence

### 🌍 Language-independent
All DOM detection uses structural patterns (CSS selectors, element positions, `data-*` attributes, form actions, `src` patterns) — never text matching. The extension works on any Bitefight server regardless of UI language.

---

## Installation

1. **Download** the latest release as a `.zip` and extract it anywhere on disk, or **clone** this repository.
2. Open Chrome (or any Chromium-based browser) and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extracted folder — the one that contains `manifest.json` at its root.
5. Pin the extension icon (optional) and open any Bitefight game server. The floating panel appears automatically.

**Upgrading from a previous version** — overwrite the existing folder with the new files and click the 🔄 reload button on the extension card in `chrome://extensions/`. The stable `key` field in `manifest.json` keeps the extension ID constant, so settings, presets, and battle logs survive the upgrade.

---

## Supported Servers

The extension activates on every Bitefight Gameforge server: `https://s*.bitefight.gameforge.com/*` (SK, EN, DE, FR, IT, ES, PL, US, …). Lobby, forum, and support subdomains are excluded automatically.

---

## File Layout

The folder loaded into Chrome must have exactly this structure (paths are referenced verbatim from `manifest.json` — renaming or moving files will break the extension):

```
bitefight-bot/
├── manifest.json                  # Extension config (Manifest V3)
├── css/
│   ├── bot-panel.css              # Bot panel styles
│   └── panel.css                  # Simulator panel styles
├── html/
│   └── panel.html                 # Simulator UI (loads in iframe)
├── img/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── js/
    ├── bot.js                     # Bot engine — state machine for all bot modules,
    │                              # schedule engine, inventory cleanup, central stop
    ├── bridge.js                  # postMessage bridge: content ↔ simulator iframe
    ├── content.js                 # Content script — DOM detection, army reading,
    │                              # data bridge, simulator iframe injection
    ├── level_presets.js           # Smart per-layer warm-start presets for the optimizer
    ├── optimizer_worker.js        # Web Worker — parallel slice of formation search
    ├── sim_engine.js              # Shared combat simulator (T1–T8 vs E1–E10) used by
    │                              # both the UI optimizer and the Ruins-bot validator
    ├── simulator.js               # Simulator UI logic — army builder, optimizer driver,
    │                              # preset manager, battle replay
    └── worker.js                  # Background service worker (MV3) — chrome.storage relay
```

### Manifest wiring (for reference)

| Role | Files |
|---|---|
| **Content scripts** (injected into every Bitefight page) | `js/content.js`, `js/sim_engine.js`, `js/level_presets.js`, `js/bot.js` |
| **Stylesheets** (injected as content) | `css/panel.css`, `css/bot-panel.css` |
| **Service worker** (background, MV3) | `js/worker.js` |
| **Web-accessible resources** (loaded by the simulator iframe) | `html/panel.html`, `js/simulator.js`, `js/bridge.js`, `js/sim_engine.js`, `js/level_presets.js`, `js/optimizer_worker.js`, `css/panel.css`, `img/*` |
| **Permissions** | `storage` |
| **Host permissions** | `https://*.bitefight.gameforge.com/*` |

If you drop a file in the wrong folder or rename it, Chrome will silently fail to load that asset (the page will still open, but features tied to that file — e.g. the simulator iframe or the optimizer worker — will be broken). Check `chrome://extensions/` → **Errors** for the diagnostic.

---

## How It Works

The **content script** (`content.js` + `bot.js` + `sim_engine.js` + `level_presets.js`) is injected into every Bitefight page at `document_end`. It reads the DOM to detect game state (HP, AP, gold, enemy formations, page context) and drives automation through a state machine. The **battle simulator** runs inside an iframe (`panel.html` + `simulator.js` + `bridge.js`) with its own UI, talking to the content script via `window.postMessage`.

Heavy formation searches are dispatched to multiple instances of `optimizer_worker.js` — each Web Worker grabs a non-overlapping slice of the search space, runs `sim_engine.js` over it, and reports results back. The main thread aggregates and ranks them.

All settings, state, and presets are stored in `chrome.storage.local`, keyed by `<server>_p<playerId>_*` so each character on each server keeps independent configuration. Memory is reset only when the user explicitly clears it.

---

## Tips

- **Before enabling Auto-mode for Inventory Cleanup**, always click **Preview** to confirm the level range matches what you want discarded — discard is irreversible in-game.
- **Schedule + master toggles** — when `Schedule` is on, the slot's action checkboxes fully override the per-module enable toggles inside their windows. Outside every slot, all bots are paused.
- **PvP ↔ Henchman** are mutually exclusive at runtime: if a slot has both checked, PvP wins. Uncheck PvP on slots where you want Henchman to run.
- **Central STOP** cancels every scheduled bot action immediately. Use it when you need to take manual control of the account.

---

## Disclaimer

⚠ This extension is a fan-made tool and is **not affiliated with or endorsed by Gameforge**. Use at your own risk. The simulator is an approximation — actual battle outcomes may differ due to in-game RNG and equipment. The author is not responsible for any in-game losses or account actions.

---

## License

Copyright (C) 2026 Aescunor

This project is licensed under the [GNU General Public License v3.0](LICENSE). You are free to use, modify, and distribute this software, but any derivative work must also be open-source under the same license.
