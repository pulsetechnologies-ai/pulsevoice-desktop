// The small always-on-top call window: caller, timer, mute, hang up (answer / decline while ringing).
//
// It is a local page (mini.html) with no remote content and no call logic — main.js feeds it the call summary the web
// app reported and relays its button presses back to the web app as ordinary commands.
const path = require('node:path');
const { BrowserWindow, screen, ipcMain } = require('electron');

const WIDTH = 330;
const HEIGHT = 64;
const MARGIN = 16;
const PAGE = path.join(__dirname, 'mini.html');

function createMiniWindow({ icon, strings, onAction }) {
  let mini = null;

  function place() {
    const { workArea } = screen.getPrimaryDisplay();
    mini.setPosition(workArea.x + workArea.width - WIDTH - MARGIN, workArea.y + workArea.height - HEIGHT - MARGIN);
  }

  function create() {
    mini = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: true,
      backgroundColor: '#140B29',
      icon,
      title: 'PulseVoice',
      webPreferences: {
        preload: path.join(__dirname, 'mini-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'pv-mini', // its own session: nothing shared with the app window's cookies or permission grants
      },
    });
    mini.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    mini.setAlwaysOnTop(true, 'floating');
    mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mini.webContents.on('will-navigate', (e) => e.preventDefault());
    mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mini.on('closed', () => { mini = null; });
    mini.loadFile(PAGE);
    place();
  }

  // Only this window's own page may send actions.
  ipcMain.on('mini:action', (event, name) => {
    if (!mini || event.sender !== mini.webContents) return;
    if (!event.senderFrame || !event.senderFrame.url.startsWith('file://')) return;
    if (!['answer', 'toggle-mute', 'hangup', 'show'].includes(name)) return;
    onAction(name);
  });

  return {
    show(state) {
      if (!mini) create();
      const send = () => mini && mini.webContents.send('mini:state', state, strings());
      if (mini.webContents.isLoading()) mini.webContents.once('did-finish-load', send); else send();
      if (!mini.isVisible()) mini.showInactive();
    },
    update(state) {
      if (mini && mini.isVisible()) mini.webContents.send('mini:state', state, strings());
    },
    hide() {
      if (mini && mini.isVisible()) mini.hide();
    },
    destroy() {
      if (mini) { mini.destroy(); mini = null; }
    },
  };
}

module.exports = { createMiniWindow };
