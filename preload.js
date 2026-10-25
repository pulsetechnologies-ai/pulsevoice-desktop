// Native bridges for the hosted web client. Kept minimal and context-isolated:
// the page gets a handful of functions, never ipcRenderer itself, and only on
// PulseVoice's own origins (the main process re-checks every call regardless).
//
// Node is not exposed, the payloads below are copied field by field, and the shell
// validates them again on the other side — see config.js.
const { contextBridge, ipcRenderer } = require('electron');

// A sandboxed preload cannot require local files, so the allow-list is repeated here in its simplest form.
const host = location.hostname;
const trusted =
  (location.protocol === 'https:' && (host === 'pulsetechnologies.ai' || host.endsWith('.pulsetechnologies.ai'))) ||
  // Local development against a local web build.
  ((location.protocol === 'http:' || location.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1'));

const COMMANDS = new Set(['answer', 'hangup', 'toggle-mute', 'prefill', 'settings-changed']);
const listeners = new Set();

ipcRenderer.on('pv:command', (_event, command) => {
  if (typeof command !== 'object' || command === null || !COMMANDS.has(command.type)) return;
  const safe = { type: command.type };
  if (command.type === 'prefill') {
    if (typeof command.number !== 'string' || !/^\+?[0-9*#]{1,32}$/.test(command.number)) return;
    safe.number = command.number;
    safe.source = ['link', 'clipboard', 'context-menu'].includes(command.source) ? command.source : 'link';
  }
  for (const cb of [...listeners]) {
    try { cb({ ...safe }); } catch { /* a page's listener must not break the others */ }
  }
});

if (trusted) {
  contextBridge.exposeInMainWorld('pulsevoiceDesktop', {
    // 2 = settings, call state, commands. A web app that finds it undefined or 1 must not call the rest.
    apiVersion: 2,
    platform: process.platform,

    // Called by the web app (src/voice/keepAwake.ts) when a call starts and ends,
    // so the shell can stop the display sleeping mid-call — which cut the mic.
    setCallActive: (active) => ipcRenderer.send('pv:call-active', active === true),

    // The call summary that drives the mini call window and the tray: null when there is no call.
    setCallState: (state) => {
      if (state === null || state === undefined) { ipcRenderer.send('pv:call-state', null); return; }
      if (typeof state !== 'object') return;
      ipcRenderer.send('pv:call-state', {
        status: state.status,
        direction: state.direction,
        remote: state.remote,
        name: state.name,
        muted: state.muted,
        answeredAt: state.answeredAt,
      });
    },

    // Shell-owned preferences (hotkeys, start at login, phone links, mini window). Resolves to the current values and,
    // for hotkeys, which actions the OS accepted.
    getSettings: () => ipcRenderer.invoke('pv:get-settings'),
    setSettings: (patch) => ipcRenderer.invoke('pv:set-settings', patch),

    // Hotkey / tray / mini-window / tel: link commands. Returns an unsubscribe function. Link and clipboard numbers
    // only ever PREFILL the dialer — the shell never places a call by itself.
    onCommand: (cb) => {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      if (listeners.size === 1) ipcRenderer.send('pv:subscribe', true);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) ipcRenderer.send('pv:subscribe', false);
      };
    },
  });
}
