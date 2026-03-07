# ⚔ Bitefight Extension

Chrome extension for **[Bitefight](https://www.bitefight.gameforge.com/)** — a vampire-themed browser strategy game by Gameforge. Provides a battle simulator with formation optimizer and a suite of automation bots.

> **v0.9.0** · Chrome Manifest V3 · Multi-server support (Slovak, English, German)

---

## Features

### 🎯 Battle Simulator
- Full combat simulation replicating in-game mechanics (attack order, unit types, tier abilities, damage calculation)
- Interactive army builder with tier unlock system and power limits
- Step-by-step or auto-play battle visualization with detailed combat log
- **Formation Optimizer** — brute-force and fast-scan modes to find optimal formations against any enemy composition
- Accuracy is above 90% only level >20.

### 🤖 Bot Modules
- **Hunt Bot** — automated human hunting with configurable HP thresholds, healing, and gold management
- **Ruins Bot** — automated ruins farming with level selection, fight result detection, and formation presets per enemy composition
- **Story Bot** — story mode automation with aspect priority system (8 aspects with individual thresholds)
- **Grotto Bot** — demon hunting automation with difficulty selection
- **PvP Bot** — player vs player hunting with target search
- **Gifts Bot** — automated gift collection

### ⚙ Global Features
- Auto-recruitment system (percentage-based essence distribution across T1–T4 units)
- Blood Essence extraction tracking
- Battle logging with CSV export
- Preset formation manager (keyed to enemy compositions per ruins level)
- Background refresh with configurable intervals
- Pin/unpin floating bot panel

---

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the extension folder
5. Navigate to any Bitefight game server — the extension activates automatically

---

## Supported Servers

The extension works on all Bitefight Gameforge servers:
- `s*.bitefight.gameforge.com` (SK, EN, DE, and others)

Lobby, forum, and support subdomains are excluded automatically.

---

## Project Structure

```
├── manifest.json        # Extension config (Manifest V3)
├── js/
│   ├── content.js       # Content script — DOM detection, army reading, data bridge
│   ├── bot.js           # Bot engine — state machine for all bot modules
│   ├── simulator.js     # Battle simulator logic, optimizer, tier definitions
│   ├── bridge.js        # Communication bridge between content script and simulator iframe
│   └── worker.js        # Background service worker for chrome.storage
├── html/
│   └── panel.html       # Simulator UI (loads in iframe)
├── css/
│   ├── panel.css        # Simulator panel styles
│   └── bot-panel.css    # Bot panel styles
└── img/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

---

## How It Works

The extension injects a **content script** into Bitefight game pages. It reads the DOM to detect game state (HP, gold, enemy formations, page context) and drives automation through a state machine. The **battle simulator** runs inside an iframe with its own UI, communicating with the content script via `postMessage`.

All settings and state are stored per-server in `chrome.storage.local`, so each server maintains independent configuration.

---

## Disclaimer

⚠ This extension is a fan-made tool and is **not affiliated with or endorsed by Gameforge**. Use at your own risk. The simulator is an approximation — actual battle outcomes may differ. The author is not responsible for any in-game losses.

---

## License

Copyright (C) 2026 Aescunor

This project is licensed under the [GNU General Public License v3.0](LICENSE). You are free to use, modify, and distribute this software, but any derivative work must also be open-source under the same license.
