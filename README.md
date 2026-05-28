# JARVIS Gesture — Web App

A pure-browser, vanilla-JS JARVIS-style HUD that reads your hand gestures via webcam + MediaPipe and lights up a sci-fi dashboard with 8 widgets.

> No build step. No npm install. Open `index.html` in Chrome and grant camera permission. That's it.

---

## ✨ What it does

- **Real-time hand tracking** via MediaPipe Hands (CDN).
- **13-gesture classifier** — `FIST`, `OPEN_PALM`, `PINCH`, `OK`, `INDEX_UP`, `PEACE`, `POINT_SIDE`, `ROCK`, `THUMBS_UP`, `THREE`, `FOUR`, plus `NONE`/`UNKNOWN`.
- **Air-draw mode** with rainbow particle physics, rAF-driven, draws with your fingertip.
- **8 draggable sci-fi widgets** (cyan/green theme, scan-line overlay, corner brackets):
  - 🕐 SVG analog clock + digital time
  - 📊 System stats (CPU/RAM/NET bars + gesture/interaction counters + FPS)
  - ☀ Weather (current + 5-day forecast)
  - ⬢ 3D rotating power core (real CSS3D cube, pulses on every gesture)
  - ♪ Audio matrix (24 animated bars + ⏮⏯⏭ controls)
  - 📺 Scrolling LIVE news ticker (auto-feeds from brain events)
  - 💬 JARVIS console — type `help` for commands (`status`, `draw`, `screenshot`, `theme cyan`, `god`, etc.)
  - 🗂 Minimised-icon tray
- **Gesture macros** — `PINKY_UP → THUMBS_UP → FIST` resets widget layout, `PEACE → OK` triggers screenshot, Konami-ish `FIST → OPEN_PALM → FIST → OPEN_PALM → OK` triggers 🌈 god mode.
- **Settings modal** — sound, cursor smoothing, pinch sensitivity, particle count, theme picker (cyan / green / orange / purple), rainbow draw toggle.
- **Stable-gesture detection** — 5-frame rAF buffer; only stable gestures fire, no jitter spam.
- **Persistent state** — widget positions, hidden state, config, and lifetime gesture/interaction counts all survive page reload via `localStorage`.
- **Self-pauses on tab hide** — rAF loops respect `document.hidden` to save battery.

---

## 📁 Project layout

```
index.html                 ← entry point (loads MediaPipe + html2canvas + all scripts)
style.css                  ← base HUD theme + side panels
dashboard.css              ← 8 widget styles (cyan, scan lines, corners, glow)
power-features.css         ← particles, draw badge, config modal, macro trail

gesture-engine.js          ← MediaPipe wrapper → window.GestureState
ui.js                      ← boot screen, side panels, status bar
jarvis-brain.js            ← central state + pub/sub event bus → window.JarvisBrain
dashboard.js               ← 8 draggable widgets, brain-wired, rAF-driven
power-features.js          ← particles, air-draw, macros, settings, screenshots
```

Each layer talks to the next through a small, documented API surface:

| Global | Owner | Purpose |
|---|---|---|
| `window.GestureState` | `gesture-engine.js` | Per-frame hand data |
| `window.JarvisBrain` | `jarvis-brain.js` | State + events (`on`, `emit`, `setMode`, `say`, `fireGesture`, …) |
| `window.GestureConfig` | `power-features.js` | User settings (theme, sensitivity, sounds, …) |
| `window.PowerFeatures` | `power-features.js` | Imperative actions — `toggleDraw()`, `screenshot()`, `openConfig()`, `setTheme()`, `godMode()` |
| `window.JarvisSFX` | `power-features.js` | `play('click'|'switch'|'boot'|'error')` |
| `window.GestureMacros` | `power-features.js` | `record(name, pattern, handler)` / `play(name)` / `list()` |

---

## 🚀 Run it

1. Clone the repo.
2. Open `index.html` directly in **Chrome** (or any Chromium browser).
3. Click **► ACTIVATE GESTURE CONTROL** on the boot screen.
4. Grant camera permission.
5. Wave at it.

> ⚠️ Chrome won't grant camera permission on `file://` for some setups. If the camera doesn't fire, serve the folder with any static server:
> ```
> npx serve .
> ```
> or in PowerShell:
> ```
> python -m http.server 8080
> ```
> then visit `http://localhost:8080`.

---

## 🎮 Console commands

Open the JARVIS Console widget and type:

| Command | Action |
|---|---|
| `help` / `?` | List commands |
| `status` | Show current mode + stat counters + uptime |
| `reset` | Reset all widget positions to defaults |
| `draw` | Toggle air-draw mode |
| `screenshot` | Capture the HUD via html2canvas |
| `settings` / `config` | Open the gear modal |
| `theme cyan` / `green` / `orange` / `purple` | Switch accent theme |
| `god` | 🌈 Engage god mode (10s rainbow overlay) |
| `ping` | `pong` |
| `time` | Show current time + date |
| `clear` | Clear console log |

---

## 🛠 Tech stack

- **MediaPipe Hands** (via jsdelivr CDN) — hand landmark detection.
- **html2canvas** (via cloudflare CDN) — screenshot capture.
- **Vanilla JS** — no framework, no bundler, no transpiler. Targets evergreen Chromium.
- **CSS3D** — real rotating cube in the Power Core widget.
- **Web Audio API** — synthesised SFX (no audio files).
- **localStorage** — for persistence.

No npm install. No build. No server. Just open `index.html`.

---

## 📝 License

MIT — go nuts.
