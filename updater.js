// Auto-update for the desktop shell (electron-updater, GitHub releases).
//
// Almost everything users see is the hosted web app, which updates on every
// deploy with no reinstall. This covers the shell itself (main.js/preload.js/
// Electron), which until now only changed when someone re-downloaded the
// installer — so a shell fix like the 1.0.8 keep-display-awake one reached
// nobody who didn't reinstall.
//
// Rules:
//  - It only ever sees PUBLISHED releases, so the draft-then-publish step in the
//    release process stays the gate. Downloads happen in the background.
//  - Never restart during a call. An update that lands mid-call waits, and is
//    offered once the call ends.
//  - The app lives in the tray and is rarely quit, so "install on quit" alone
//    would leave most installs behind. Offer "Restart now / Later"; if it's put
//    off, the tray menu keeps a "Restart to update" item, and once the machine
//    has been idle for an hour with no call up, it installs silently and relaunches.
//  - Windows only accepts an update signed by the publisher in app-update.yml
//    (from build.win.azureSignOptions.publisherName = "Pulse Payments LLC").
//    macOS needs the signed .zip published next to the .dmg (build.mac.target).

const { app, dialog, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const IDLE_SWEEP_MS = 15 * 60 * 1000;
const IDLE_INSTALL_SEC = 60 * 60;

/**
 * @param {object} deps
 * @param {() => boolean} deps.isCallActive
 * @param {() => Electron.BrowserWindow | null} deps.getWindow
 * @param {() => void} deps.onStateChange  rebuild the tray menu
 * @param {() => void} deps.beforeInstall  let the close-to-tray handler through
 */
function setupAutoUpdate({ isCallActive, getWindow, onStateChange, beforeInstall }) {
  const state = { readyVersion: null, promptPending: false, prompting: false };
  const forceDev = process.env.PV_UPDATER_DEV === '1';
  if (!app.isPackaged && !forceDev) {
    return { state, installNow: () => undefined, onCallEnded: () => undefined };
  }

  const { autoUpdater } = require('electron-updater');
  const logFile = path.join(app.getPath('userData'), 'updater.log');
  const write = (level) => (...args) => {
    const line = `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')}\n`;
    try { fs.appendFileSync(logFile, line); } catch { /* disk full / locked — not worth failing over */ }
    if (forceDev) process.stdout.write(`[updater] ${line}`);
  };
  autoUpdater.logger = { info: write('INFO'), warn: write('WARN'), error: write('ERROR'), debug: () => undefined };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // We only ship full NSIS installers; never accept a web-installer stub.
  autoUpdater.disableWebInstaller = true;
  if (forceDev) autoUpdater.forceDevUpdateConfig = true;

  const installNow = () => {
    if (!state.readyVersion || isCallActive()) return;
    autoUpdater.logger.info(`installing ${state.readyVersion}`);
    beforeInstall();
    // isSilent: reuse the existing install location with no wizard.
    // isForceRunAfter: reopen PulseVoice so the softphone comes straight back.
    autoUpdater.quitAndInstall(true, true);
  };

  const prompt = async () => {
    if (!state.readyVersion || state.prompting) return;
    if (isCallActive()) { state.promptPending = true; return; }
    state.promptPending = false;
    const win = getWindow();
    // Nobody is looking — leave it to the tray item and the idle install.
    if (!win || !win.isVisible()) return;
    state.prompting = true;
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'PulseVoice update',
        message: `PulseVoice ${state.readyVersion} is ready to install.`,
        detail: 'PulseVoice will close for a few seconds and reopen. If you choose Later, it installs the next time PulseVoice restarts.',
      });
      if (response === 0) installNow();
    } finally {
      state.prompting = false;
    }
  };

  autoUpdater.on('update-downloaded', (info) => {
    state.readyVersion = info.version;
    onStateChange();
    void prompt();
  });
  autoUpdater.on('error', (err) => autoUpdater.logger.error('update failed:', err));

  const check = () => { autoUpdater.checkForUpdates().catch((err) => autoUpdater.logger.error('check failed:', err)); };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  setInterval(() => {
    if (state.readyVersion && !isCallActive() && powerMonitor.getSystemIdleTime() >= IDLE_INSTALL_SEC) installNow();
  }, IDLE_SWEEP_MS);

  return {
    state,
    installNow,
    // A download that finished mid-call is offered once the call ends.
    onCallEnded: () => { if (state.promptPending) void prompt(); },
  };
}

module.exports = { setupAutoUpdate };
