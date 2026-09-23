// Native bridges for the hosted web client. Kept minimal and context-isolated:
// the page gets exactly one function, never ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulsevoiceDesktop', {
  // Called by the web app (src/voice/keepAwake.ts) when a call starts and ends,
  // so the shell can stop the display sleeping mid-call — which cut the mic.
  setCallActive: (active) => ipcRenderer.send('pv:call-active', active === true),
});
