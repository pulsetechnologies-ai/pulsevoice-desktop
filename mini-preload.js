// Preload for the mini call window (local page, no remote content). Two functions, no ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron');

const ACTIONS = new Set(['answer', 'toggle-mute', 'hangup', 'show']);

contextBridge.exposeInMainWorld('pulsevoiceMini', {
  onState: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('mini:state', (_event, state, strings) => cb(state, strings));
  },
  action: (name) => { if (ACTIONS.has(name)) ipcRenderer.send('mini:action', name); },
});
