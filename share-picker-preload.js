// Preload for the screen-share picker (a local page, no remote content). Three functions, no ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulsevoiceShare', {
  onSources: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('share:sources', (_event, rows, strings, audioOffered) => cb(rows, strings, audioOffered === true));
  },
  choose: (id, withAudio) => ipcRenderer.send('share:choose', String(id), withAudio === true),
  cancel: () => ipcRenderer.send('share:cancel'),
});
