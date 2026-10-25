// Global hotkeys (Electron globalShortcut), registered only while the person has switched them on.
//
// `globalShortcut` is injected so the register / unregister bookkeeping can be unit-tested without Electron.
// Registration can fail (another app already owns the combination); that is reported per action, never thrown, so the
// Settings screen can say which one needs changing.
const { ACTIONS } = require('./config');

function createHotkeys({ globalShortcut, onAction }) {
  let held = [];
  let registered = {};

  function release() {
    for (const accelerator of held) {
      try { globalShortcut.unregister(accelerator); } catch { /* already gone */ }
    }
    held = [];
    registered = {};
  }

  /** @param {{enabled: boolean, bindings: Record<string,string>}} hotkeys */
  function apply(hotkeys) {
    release();
    if (!hotkeys.enabled) return registered;
    for (const action of ACTIONS) {
      const accelerator = hotkeys.bindings[action];
      let ok = false;
      try { ok = globalShortcut.register(accelerator, () => onAction(action)) === true; } catch { ok = false; }
      registered[action] = ok;
      if (ok) held.push(accelerator);
    }
    return registered;
  }

  return { apply, dispose: release, status: () => ({ ...registered }) };
}

module.exports = { createHotkeys };
