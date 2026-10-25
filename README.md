# PulseVoice Desktop

The standalone desktop app for [PulseVoice](https://www.pulsetechnologies.ai/products/pulsevoice) — a thin [Electron](https://www.electronjs.org/) shell around the PulseVoice web client. It lives in your system tray and stays connected, so inbound calls ring you even when the window is closed (like Teams or Zoom).

The shell simply loads the hosted web app (`app.pulsevoice.pulsetechnologies.ai`) — it holds no secrets and auto-updates with each web deploy, so it rarely needs a rebuild.

## Download

Get the latest installer from the [**Releases**](../../releases/latest) page, or from [pulsetechnologies.ai/download](https://www.pulsetechnologies.ai/download):

- **Windows** — `PulseVoice-Setup.exe`
- **macOS** — `PulseVoice.dmg`
- **Linux** — `PulseVoice.AppImage`

## Build

Installers are built and published automatically by the **Build & publish desktop installers** GitHub Actions workflow (Windows/macOS/Linux runners), on a `v*` tag or manual run. To build locally: `npm install && npm run dist`.

## Desktop features (bridge API 2)

Everything below is driven by the hosted web app through `window.pulsevoiceDesktop` (`preload.js`). The bridge exists only on `*.pulsetechnologies.ai` over https (and `localhost` for development); the main process re-checks the sender (the app window's top frame, an allowed origin) and validates every payload (`config.js`) before acting. Nothing places a call by itself.

| Feature | Default | Where it is switched |
| --- | --- | --- |
| Global hotkeys: answer/hang up, mute, show PulseVoice, dial number from clipboard | **Off** (`Ctrl/Cmd+Shift+A / M / P / D` once on) | Settings → Desktop app, or tray |
| Mini call window (caller, timer, mute, hang up) while a call is up and the main window is hidden/minimised | On | Settings, or tray |
| `tel:` / `sip:` links open the dialer with the number filled in | **Asks once** | the question, Settings, or tray |
| "Call with PulseVoice" on a selected phone number or a `tel:` link | Always | right-click |
| Start at login (starts in the tray; Windows and macOS, installed builds only) | Off | Settings, or tray |

Settings live in `desktop-settings.json` in the app's user-data folder. `npm test` runs the unit tests for the pure parts (`phone.js`, `config.js`, `hotkeys.js`).

Gotchas: `clipboard.readText()` is async since Electron 44; a sandboxed preload cannot `require` local files (so the origin allow-list is repeated in `preload.js`); Windows does not let an app make itself the default `tel:` handler, so "Use PulseVoice" registers it and Windows may still ask which app to use the first time.
