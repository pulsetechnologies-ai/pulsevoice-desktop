// The screen-share picker: a small modal window listing screens and windows with thumbnails, shown when the web app
// calls getDisplayMedia. Electron has no built-in picker on Windows/Linux, so without this the call just fails.
//
// It is a local page (share-picker.html) with no remote content. main.js hands it the sources; it hands back one id,
// which is checked against what was offered before anything is captured.
const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { toRows, findOffered } = require('./share-sources');

const PAGE = path.join(__dirname, 'share-picker.html');

function createSharePicker({ icon, strings, getParent }) {
  let picker = null;
  let pending = null; // { rows, resolve }

  function finish(result) {
    const p = pending;
    pending = null;
    if (p) p.resolve(result);
    if (picker) {
      const w = picker;
      picker = null;
      if (!w.isDestroyed()) w.destroy();
    }
  }

  // Only the picker's own page may answer.
  const fromPicker = (event) => Boolean(picker) && event.sender === picker.webContents
    && Boolean(event.senderFrame) && event.senderFrame.url.startsWith('file://');
  ipcMain.on('share:choose', (event, id, withAudio) => {
    if (!pending || !fromPicker(event)) return;
    const row = findOffered(pending.rows, id);
    if (row) finish({ id: row.id, audio: withAudio === true });
  });
  ipcMain.on('share:cancel', (event) => {
    if (pending && fromPicker(event)) finish(null);
  });

  return {
    /** Resolves { id, audio } for the chosen source, or null when cancelled. */
    pick(sources, { audioOffered }) {
      if (pending) finish(null);
      const rows = toRows(sources);
      return new Promise((resolve) => {
        pending = { rows, resolve };
        const parent = getParent();
        picker = new BrowserWindow({
          width: 780,
          height: 560,
          minWidth: 520,
          minHeight: 400,
          parent: parent || undefined,
          modal: Boolean(parent),
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          autoHideMenuBar: true,
          backgroundColor: '#140B29',
          icon,
          title: 'PulseVoice',
          webPreferences: {
            preload: path.join(__dirname, 'share-picker-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: 'pv-share',
          },
        });
        picker.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        picker.webContents.on('will-navigate', (e) => e.preventDefault());
        picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        picker.on('closed', () => {
          picker = null;
          finish(null);
        });
        picker.webContents.once('did-finish-load', () => {
          if (picker && !picker.isDestroyed()) picker.webContents.send('share:sources', rows, strings(), audioOffered === true);
        });
        picker.loadFile(PAGE);
      });
    },
  };
}

module.exports = { createSharePicker };
