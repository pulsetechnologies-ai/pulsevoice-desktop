// PulseVoice desktop (Electron) — a native shell around the PulseVoice web client.
// It loads the deployed app, auto-grants the microphone for WebRTC calls, and
// lives in the system tray so the softphone stays registered for inbound calls
// even when the window is closed (like Teams/Zoom). Content is the hosted app, so
// it auto-updates with each deploy — no desktop rebuild needed for app changes.

// Chromium's HTTPS-SVCB DNS path can fail (-105 NAME_NOT_RESOLVED) for some hosts
// while the OS resolver succeeds — seen on stun/turn.telnyx.com, which breaks WebRTC
// media. Disable it so Electron resolves those hosts like the rest of the system.
// Must be pushed onto process.argv BEFORE `electron` is required: as of Electron 36,
// app.commandLine.appendSwitch() lowercases both the switch and its value, and these
// Chromium feature names are case-sensitive — lowercased, this switch is silently
// ignored and the DNS bug (and the WebRTC audio breakage it causes) comes back.
process.argv.push('--disable-features=UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn');

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, powerSaveBlocker } = require('electron');
const path = require('node:path');

const APP_URL = process.env.PULSEVOICE_APP_URL || 'https://app.pulsevoice.pulsetechnologies.ai';
const ICON = path.join(__dirname, 'build', 'icon.png');

let win = null;
let tray = null;
let quitting = false;

// While a call is up, stop the display sleeping. Reported live: when the screen
// slept mid-call the other party stopped hearing the user, and waking it brought
// the audio back. Minimising/hiding the window was measured NOT to interrupt the
// audio, so this is Windows powering the display (and often the machine) down,
// not Chromium throttling — the same reason Teams/Zoom keep the display on for
// calls. 'prevent-display-sleep' also prevents system sleep, and unlike the web
// Screen Wake Lock it holds while the window is minimised or in the tray.
let callBlocker = null;
function setCallActive(active) {
  if (active && callBlocker === null) {
    callBlocker = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!active && callBlocker !== null) {
    if (powerSaveBlocker.isStarted(callBlocker)) powerSaveBlocker.stop(callBlocker);
    callBlocker = null;
  }
}
ipcMain.on('pv:call-active', (event, active) => {
  // Only the app's own window may drive this — never a page it navigated to.
  if (!win || event.sender !== win.webContents) return;
  if (!event.senderFrame || new URL(event.senderFrame.url).origin !== new URL(APP_URL).origin) return;
  setCallActive(active === true);
});

// Single instance: focus the existing window instead of launching a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(createWindow);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'PulseVoice',
    backgroundColor: '#140B29', // brand night — matches the app splash
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // WebRTC calls need the mic; auto-grant media, deny everything else — except
  // the screen wake lock, which the web app takes during a call (it was being
  // refused here) and which only keeps the display on, and speaker selection,
  // which the app's Settings → Audio devices speaker picker relies on.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'audioCapture', 'screen-wake-lock', 'speaker-selection'].includes(permission));
  });

  // A reload or a crashed renderer can't send "call ended" — never leave the
  // display pinned on after one.
  win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) setCallActive(false); });
  win.webContents.on('render-process-gone', () => setCallActive(false));

  win.loadURL(APP_URL);

  // External links (support, docs) open in the OS browser, not the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Close hides to tray so the softphone keeps its connection for inbound calls.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  createTray();
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 });
  tray = new Tray(trayIcon);
  tray.setToolTip('PulseVoice');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open PulseVoice', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow);
}

app.on('before-quit', () => { quitting = true; });
// Stay alive in the tray when the window is hidden — keeps inbound working.
app.on('window-all-closed', () => { /* intentionally do not quit */ });
app.on('activate', showWindow); // macOS dock click
