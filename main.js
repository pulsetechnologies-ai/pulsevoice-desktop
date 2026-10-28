// PulseVoice desktop (Electron) — a native shell around the PulseVoice web client.
// It loads the deployed app, auto-grants the microphone for WebRTC calls, and
// lives in the system tray so the softphone stays registered for inbound calls
// even when the window is closed (like Teams/Zoom). Content is the hosted app, so
// it auto-updates with each deploy — no desktop rebuild needed for app changes.
// The shell itself updates through updater.js (GitHub releases, electron-updater).

// Chromium's HTTPS-SVCB DNS path can fail (-105 NAME_NOT_RESOLVED) for some hosts
// while the OS resolver succeeds — seen on stun/turn.telnyx.com, which breaks WebRTC
// media. Disable it so Electron resolves those hosts like the rest of the system.
// Must be pushed onto process.argv BEFORE `electron` is required: as of Electron 36,
// app.commandLine.appendSwitch() lowercases both the switch and its value, and these
// Chromium feature names are case-sensitive — lowercased, this switch is silently
// ignored and the DNS bug (and the WebRTC audio breakage it causes) comes back.
process.argv.push('--disable-features=UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn');

const {
  app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, powerSaveBlocker, globalShortcut, clipboard, dialog, Notification, desktopCapturer,
} = require('electron');
const path = require('node:path');
const { setupAutoUpdate } = require('./updater');
const i18n = require('./i18n');
const {
  DEFAULT_BINDINGS, freshSettings, applyPatch, isTrustedOrigin, sanitizeCallState, shouldShowMini, answerOrHangupCommand,
} = require('./config');
const { parsePhoneLink, findPhoneLinkInArgv, sanitizePhoneText } = require('./phone');
const { createHotkeys } = require('./hotkeys');
const { createSettingsStore } = require('./settings-store');
const { createMiniWindow } = require('./mini-window');
const { createSharePicker } = require('./share-picker');
const { audioOffered } = require('./share-sources');

const APP_URL = process.env.PULSEVOICE_APP_URL || 'https://app.pulsevoice.pulsetechnologies.ai';
const ICON = path.join(__dirname, 'build', 'icon.png');

let win = null;
let tray = null;
let quitting = false;
let updater = null;

// Launched by the login item (Windows passes --hidden; macOS says so): start in the tray without opening a window.
const startHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
const PHONE_LINK = /^(tel|sip):/i;
const PENDING_PREFILL_MS = 10 * 60 * 1000;

// Shell-owned preferences (config.js). Hotkeys are off until switched on; phone links ask once.
let settings = freshSettings();
let store = null;
let hotkeys = null;
let mini = null;
let callState = null; // the web app's call summary (config.js sanitizeCallState); null = no call
let subscribed = false; // the web app has attached its command listener
let pendingPrefill = null; // a number from a link/hotkey that arrived before the web app was listening
let askingPhoneLinks = false;
const pendingLinks = []; // macOS open-url events that arrive before the window exists

// While a call is up, stop the display sleeping. Reported live: when the screen
// slept mid-call the other party stopped hearing the user, and waking it brought
// the audio back. Minimising/hiding the window was measured NOT to interrupt the
// audio, so this is Windows powering the display (and often the machine) down,
// not Chromium throttling — the same reason Teams/Zoom keep the display on for
// calls. 'prevent-display-sleep' also prevents system sleep, and unlike the web
// Screen Wake Lock it holds while the window is minimised or in the tray.
let callBlocker = null;
function setCallActive(active) {
  // While a call or meeting is up the page must keep running when the window is covered by another app or minimized:
  // Chromium otherwise reports it hidden, stops requestAnimationFrame and throttles timers, which froze the camera
  // the web app sends (measured: 0 frames with the window behind Outlook). Outside a call keep the default so a
  // window parked in the tray costs nothing.
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.setBackgroundThrottling(!active);
  if (active && callBlocker === null) {
    callBlocker = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!active && callBlocker !== null) {
    if (powerSaveBlocker.isStarted(callBlocker)) powerSaveBlocker.stop(callBlocker);
    callBlocker = null;
    updater?.onCallEnded();
  }
}
// Bridge calls from the web app: the app's own window, its top frame, on a PulseVoice origin — nothing else.
function trusted(event) {
  if (!win || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  return Boolean(frame) && frame === win.webContents.mainFrame && isTrustedOrigin(frame.url, APP_URL);
}

ipcMain.on('pv:call-active', (event, active) => {
  // Only the app's own window may drive this — never a page it navigated to.
  if (!win || event.sender !== win.webContents) return;
  if (!event.senderFrame || new URL(event.senderFrame.url).origin !== new URL(APP_URL).origin) return;
  setCallActive(active === true);
});

// Send a command to the web app. Numbers wait (briefly) for it to start listening — a tel: link can launch the app
// before anyone has signed in — everything else is dropped rather than replayed late.
function deliver(command) {
  if (win && subscribed && !win.webContents.isDestroyed()) {
    win.webContents.send('pv:command', command);
  } else if (command.type === 'prefill') {
    pendingPrefill = { command, at: Date.now() };
  }
}

ipcMain.on('pv:subscribe', (event, on) => {
  if (!trusted(event)) return;
  subscribed = on === true;
  if (subscribed && pendingPrefill) {
    const { command, at } = pendingPrefill;
    pendingPrefill = null;
    if (Date.now() - at < PENDING_PREFILL_MS) deliver(command);
  }
});

function setCallState(next) {
  callState = next;
  refreshTrayMenu();
  syncMini();
}
ipcMain.on('pv:call-state', (event, raw) => {
  if (!trusted(event)) return;
  setCallState(raw === null ? null : sanitizeCallState(raw));
});

const loginItemSupported = () => app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');

function publicSettings() {
  return {
    apiVersion: 2,
    platform: process.platform,
    defaults: { ...DEFAULT_BINDINGS },
    hotkeys: { enabled: settings.hotkeys.enabled, bindings: { ...settings.hotkeys.bindings }, registered: hotkeys ? hotkeys.status() : {} },
    startAtLogin: settings.startAtLogin,
    startAtLoginSupported: loginItemSupported(),
    phoneLinks: settings.phoneLinks,
    phoneLinksSupported: app.isPackaged,
    miniWindow: settings.miniWindow,
  };
}
ipcMain.handle('pv:get-settings', (event) => (trusted(event) ? publicSettings() : null));
ipcMain.handle('pv:set-settings', (event, patch) => {
  if (!trusted(event)) return { ok: false, errors: { sender: 'untrusted' } };
  const result = applyPatch(settings, patch);
  if (!result.ok) return result;
  commitSettings(result.settings);
  return { ok: true, settings: publicSettings() };
});

function commitSettings(next) {
  const phoneLinksChanged = next.phoneLinks !== settings.phoneLinks;
  settings = next;
  if (store) store.save(settings);
  applySettings({ phoneLinksChanged });
  refreshTrayMenu();
  if (win && !win.webContents.isDestroyed()) win.webContents.send('pv:command', { type: 'settings-changed' });
}

function applySettings({ phoneLinksChanged = false } = {}) {
  if (hotkeys) hotkeys.apply(settings.hotkeys);
  if (loginItemSupported()) {
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, args: process.platform === 'win32' ? ['--hidden'] : [] });
  }
  if (app.isPackaged) {
    for (const scheme of ['tel', 'sip']) {
      // Re-register on every launch while on (the install path can move); only ever unregister on an explicit "no".
      if (settings.phoneLinks === 'yes') app.setAsDefaultProtocolClient(scheme);
      else if (settings.phoneLinks === 'no' && phoneLinksChanged && app.isDefaultProtocolClient(scheme)) app.removeAsDefaultProtocolClient(scheme);
    }
  }
  syncMini();
}

// Ask once, the first time the window is actually in front of the person (never from a login-item start, never mid-call).
async function maybeAskPhoneLinks() {
  if (askingPhoneLinks || settings.phoneLinks !== 'ask' || !app.isPackaged || callState || !win || !win.isVisible()) return;
  askingPhoneLinks = true;
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [i18n.t('phoneLinks.yes'), i18n.t('phoneLinks.no')],
      defaultId: 0,
      cancelId: 1,
      title: i18n.t('phoneLinks.title'),
      message: i18n.t('phoneLinks.message'),
      detail: i18n.t('phoneLinks.detail'),
    });
    const applied = applyPatch(settings, { phoneLinks: response === 0 ? 'yes' : 'no' });
    if (applied.ok) commitSettings(applied.settings);
  } finally {
    askingPhoneLinks = false;
  }
}

// A tel:/sip: link or a selected number opens the dialer with the number filled in. It never places the call.
function openPhoneLink(url) {
  const number = parsePhoneLink(url);
  showWindow();
  if (number) deliver({ type: 'prefill', number, source: 'link' });
}
function openPhoneLinkFromArgv(argv) {
  if (!argv.some((a) => typeof a === 'string' && PHONE_LINK.test(a))) return false;
  const number = findPhoneLinkInArgv(argv);
  showWindow();
  if (number) deliver({ type: 'prefill', number, source: 'link' });
  return true;
}

// clipboard.readText() is async as of Electron 44.
async function dialFromClipboard() {
  const text = await clipboard.readText().catch(() => '');
  const number = parsePhoneLink(text) ?? sanitizePhoneText(text);
  if (!number) {
    if (Notification.isSupported()) new Notification({ title: i18n.t('clipboard.title'), body: i18n.t('clipboard.body'), icon: ICON }).show();
    return;
  }
  showWindow();
  deliver({ type: 'prefill', number, source: 'clipboard' });
}

function onHotkey(action) {
  if (action === 'showWindow') showWindow();
  else if (action === 'dialClipboard') dialFromClipboard();
  else if (action === 'toggleMute') { if (callState) deliver({ type: 'toggle-mute' }); }
  else if (action === 'answerHangup') {
    const command = answerOrHangupCommand(callState);
    if (command) deliver({ type: command });
  }
}

const miniStrings = () => ({
  incoming: i18n.t('mini.incoming'),
  calling: i18n.t('mini.calling'),
  onHold: i18n.t('mini.onHold'),
  answer: i18n.t('mini.answer'),
  decline: i18n.t('mini.decline'),
  hangUp: i18n.t('mini.hangUp'),
  mute: i18n.t('mini.mute'),
  unmute: i18n.t('mini.unmute'),
});

function onMiniAction(name) {
  if (name === 'show') showWindow();
  else if (name === 'answer') { if (answerOrHangupCommand(callState) === 'answer') deliver({ type: 'answer' }); }
  else if (!callState) return;
  else if (name === 'hangup') deliver({ type: 'hangup' });
  else if (name === 'toggle-mute') deliver({ type: 'toggle-mute' });
}

function syncMini() {
  if (!mini) return;
  const show = shouldShowMini({
    miniEnabled: settings.miniWindow,
    callState,
    mainVisible: Boolean(win) && win.isVisible(),
    mainMinimized: Boolean(win) && win.isMinimized(),
  });
  if (show) mini.show(callState); else mini.hide();
}

// macOS delivers tel:/sip: links as open-url events, possibly before the window exists.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (win) openPhoneLink(url); else pendingLinks.push(url);
});

// Single instance: focus the existing window instead of launching a second copy.
// On Windows/Linux a tel:/sip: link opened while we run arrives here as the second instance's command line.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (openPhoneLinkFromArgv(argv)) return;
    if (!argv.includes('--hidden')) showWindow();
  });
  app.whenReady().then(createWindow);
}

function shareStrings() {
  return {
    title: i18n.t('share.title'), screens: i18n.t('share.screens'), windows: i18n.t('share.windows'), none: i18n.t('share.none'),
    audio: i18n.t('share.audio'), share: i18n.t('share.share'), cancel: i18n.t('share.cancel'),
  };
}

function createWindow() {
  store = createSettingsStore(app.getPath('userData'));
  settings = store.load();
  hotkeys = createHotkeys({ globalShortcut, onAction: onHotkey });
  mini = createMiniWindow({ icon: ICON, strings: miniStrings, onAction: onMiniAction });

  win = new BrowserWindow({
    show: !startHidden,
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
  // 'display-capture' is allowed here only so getDisplayMedia can reach the handler below, which makes the person pick
  // exactly what is shared; nothing is captured without that choice.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'audioCapture', 'screen-wake-lock', 'speaker-selection', 'display-capture'].includes(permission));
  });

  // Screen share (getDisplayMedia): Electron has no picker of its own on Windows/Linux, so show ours. Only the app's own
  // pages may ask; cancelling answers null, which the web app sees as a refusal and treats as "never mind".
  const sharePicker = createSharePicker({ icon: ICON, strings: shareStrings, getParent: () => (win && !win.isDestroyed() ? win : null) });
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.frame || !isTrustedOrigin(request.frame.url, APP_URL)) { callback(null); return; }
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true })
      .then((sources) => sharePicker.pick(sources, { audioOffered: audioOffered(request, process.platform) })
        .then((choice) => {
          const source = choice && sources.find((s) => s.id === choice.id);
          if (!source) { callback(null); return; }
          callback(choice.audio ? { video: source, audio: 'loopback' } : { video: source });
        }))
      .catch(() => callback(null));
  }, { useSystemPicker: false });

  // A reload or a crashed renderer can't send "call ended" — never leave the
  // display pinned on after one.
  const resetCallState = () => { setCallActive(false); subscribed = false; setCallState(null); };
  win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) resetCallState(); });
  win.webContents.on('render-process-gone', resetCallState);
  win.webContents.once('did-finish-load', () => { maybeAskPhoneLinks(); });

  win.loadURL(APP_URL);

  // External links (support, docs) open in the OS browser, not the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // "Call with PulseVoice" on a selected phone number or a tel: link: fills the dialer, never dials.
  win.webContents.on('context-menu', (_event, params) => {
    if (!isTrustedOrigin(win.webContents.getURL(), APP_URL)) return;
    const number = (params.linkURL ? parsePhoneLink(params.linkURL) : null) ?? sanitizePhoneText(params.selectionText);
    if (!number) return;
    Menu.buildFromTemplate([{
      label: i18n.t('context.call', { number }),
      click: () => { showWindow(); deliver({ type: 'prefill', number, source: 'context-menu' }); },
    }]).popup({ window: win });
  });

  // The mini call window follows the main window going out of sight and back.
  for (const event of ['show', 'hide', 'minimize', 'restore']) win.on(event, syncMini);

  // Close hides to tray so the softphone keeps its connection for inbound calls.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Follow the language chosen in the app (its pulse_lang cookie) for the tray menu and update dialog.
  i18n.start(win.webContents.session);
  i18n.onChange(() => { refreshTrayMenu(); syncMini(); });

  createTray();
  applySettings();

  // A tel:/sip: link that launched us (Windows/Linux command line; macOS open-url events queued before now).
  if (!openPhoneLinkFromArgv(process.argv)) while (pendingLinks.length) openPhoneLink(pendingLinks.shift());

  updater = setupAutoUpdate({
    isCallActive: () => callBlocker !== null,
    getWindow: () => win,
    onStateChange: refreshTrayMenu,
    beforeInstall: () => { quitting = true; },
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  maybeAskPhoneLinks();
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 });
  tray = new Tray(trayIcon);
  tray.setToolTip('PulseVoice');
  refreshTrayMenu();
  tray.on('click', showWindow);
}

// A tray checkbox bound to one shell setting; goes through the same validation as the web app's calls.
function setting(key, checked, patchFor) {
  return {
    label: i18n.t(key),
    type: 'checkbox',
    checked,
    click: (item) => {
      const applied = applyPatch(settings, patchFor(item.checked));
      if (applied.ok) commitSettings(applied.settings);
    },
  };
}

function refreshTrayMenu() {
  if (!tray) return;
  const ready = updater?.state.readyVersion;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: i18n.t('tray.open'), click: showWindow },
      ...(callState
        ? [
          { label: i18n.t(callState.muted ? 'tray.unmute' : 'tray.mute'), click: () => deliver({ type: 'toggle-mute' }) },
          { label: i18n.t('tray.hangup'), click: () => deliver({ type: 'hangup' }) },
        ]
        : []),
      { label: i18n.t('tray.dialClipboard'), click: dialFromClipboard },
      ...(ready ? [{ label: i18n.t('tray.restart', { version: ready }), click: () => updater.installNow() }] : []),
      { type: 'separator' },
      ...(loginItemSupported() ? [setting('tray.startAtLogin', settings.startAtLogin, (on) => ({ startAtLogin: on }))] : []),
      setting('tray.hotkeys', settings.hotkeys.enabled, (on) => ({ hotkeys: { enabled: on } })),
      ...(app.isPackaged ? [setting('tray.phoneLinks', settings.phoneLinks === 'yes', (on) => ({ phoneLinks: on ? 'yes' : 'no' }))] : []),
      setting('tray.miniWindow', settings.miniWindow, (on) => ({ miniWindow: on })),
      { type: 'separator' },
      { label: i18n.t('tray.quit'), click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { hotkeys?.dispose(); mini?.destroy(); });
// Stay alive in the tray when the window is hidden — keeps inbound working.
app.on('window-all-closed', () => { /* intentionally do not quit */ });
app.on('activate', showWindow); // macOS dock click
