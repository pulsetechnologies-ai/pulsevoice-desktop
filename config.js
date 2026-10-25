// The shell's own settings and the validation every value from the web page goes through.
//
// Pure (no Electron) so it is unit-tested. The hosted web app is the only thing that can talk to the bridge, but the
// shell still treats everything it sends as untrusted input: strict shapes, allow-listed values, bounded strings.
// Anything that could surprise a person defaults to off: hotkeys need an explicit enable, phone links ask once.

const ACTIONS = ['answerHangup', 'toggleMute', 'showWindow', 'dialClipboard'];

// Ctrl/Cmd+Shift+letter: two modifiers (so no plain Ctrl+C-style combination is ever hijacked) and no Alt (AltGr is
// Ctrl+Alt on many keyboard layouts). The person can change every one in Settings.
const DEFAULT_BINDINGS = Object.freeze({
  answerHangup: 'CommandOrControl+Shift+A',
  toggleMute: 'CommandOrControl+Shift+M',
  showWindow: 'CommandOrControl+Shift+P',
  dialClipboard: 'CommandOrControl+Shift+D',
});

const MODS = {
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl', control: 'Control', ctrl: 'Control',
  command: 'Command', cmd: 'Command', alt: 'Alt', option: 'Alt', shift: 'Shift',
};
const PRIMARY = ['CommandOrControl', 'Control', 'Command'];
const NAMED_KEYS = {
  space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete',
};

/**
 * Canonical Electron accelerator ("CommandOrControl+Shift+M") or null.
 * Rules: modifiers then exactly one key (A–Z, 0–9, F1–F24 or a few named keys); at least two distinct modifiers —
 * or one non-Shift modifier with an F-key — so a typing shortcut (Ctrl+C, Shift+A, bare F5) can never be claimed.
 */
function canonicalAccelerator(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const parts = raw.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => p === '')) return null;
  const keyRaw = parts[parts.length - 1];
  const mods = new Set();
  for (const p of parts.slice(0, -1)) {
    const mod = MODS[p.toLowerCase()];
    if (!mod || mods.has(mod)) return null;
    mods.add(mod);
  }
  const primaries = PRIMARY.filter((m) => mods.has(m));
  if (primaries.length > 1) return null;
  let key = null;
  if (/^[a-z0-9]$/i.test(keyRaw)) key = keyRaw.toUpperCase();
  else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(keyRaw)) key = keyRaw.toUpperCase();
  else key = NAMED_KEYS[keyRaw.toLowerCase()] ?? null;
  if (!key) return null;
  const isFKey = /^F\d+$/.test(key);
  if (mods.size < 2 && !(isFKey && mods.size === 1 && !mods.has('Shift'))) return null;
  return [...primaries, ...(mods.has('Alt') ? ['Alt'] : []), ...(mods.has('Shift') ? ['Shift'] : []), key].join('+');
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const freshSettings = () => ({
  hotkeys: { enabled: false, bindings: { ...DEFAULT_BINDINGS } },
  startAtLogin: false,
  phoneLinks: 'ask', // 'ask' (not asked yet) | 'yes' | 'no'
  miniWindow: true, // only ever appears during a call while the main window is hidden or minimised
});

/** Read the saved file leniently: anything wrong falls back to the default for that field, never throws. */
function normalizeSettings(raw) {
  const out = freshSettings();
  if (!isPlainObject(raw)) return out;
  if (isPlainObject(raw.hotkeys)) {
    out.hotkeys.enabled = raw.hotkeys.enabled === true;
    if (isPlainObject(raw.hotkeys.bindings)) {
      const used = new Set();
      for (const action of ACTIONS) {
        const acc = canonicalAccelerator(raw.hotkeys.bindings[action]);
        // An invalid or repeated binding falls back to the action's default.
        const pick = acc && !used.has(acc) ? acc : DEFAULT_BINDINGS[action];
        out.hotkeys.bindings[action] = pick;
        used.add(pick);
      }
    }
  }
  out.startAtLogin = raw.startAtLogin === true;
  if (raw.phoneLinks === 'yes' || raw.phoneLinks === 'no') out.phoneLinks = raw.phoneLinks;
  if (raw.miniWindow === false) out.miniWindow = false;
  return out;
}

/**
 * Apply a patch from the web page strictly and all-or-nothing.
 * @returns {{ok: true, settings: object} | {ok: false, errors: Record<string, string>}}  error codes, not prose
 */
function applyPatch(current, patch) {
  const errors = {};
  if (!isPlainObject(patch)) return { ok: false, errors: { patch: 'invalid' } };
  const next = {
    hotkeys: { enabled: current.hotkeys.enabled, bindings: { ...current.hotkeys.bindings } },
    startAtLogin: current.startAtLogin,
    phoneLinks: current.phoneLinks,
    miniWindow: current.miniWindow,
  };
  for (const key of Object.keys(patch)) {
    if (!['hotkeys', 'startAtLogin', 'phoneLinks', 'miniWindow'].includes(key)) errors[key] = 'unknown';
  }
  if ('startAtLogin' in patch) { if (typeof patch.startAtLogin === 'boolean') next.startAtLogin = patch.startAtLogin; else errors.startAtLogin = 'invalid'; }
  if ('miniWindow' in patch) { if (typeof patch.miniWindow === 'boolean') next.miniWindow = patch.miniWindow; else errors.miniWindow = 'invalid'; }
  if ('phoneLinks' in patch) { if (patch.phoneLinks === 'yes' || patch.phoneLinks === 'no') next.phoneLinks = patch.phoneLinks; else errors.phoneLinks = 'invalid'; }
  if ('hotkeys' in patch) {
    const h = patch.hotkeys;
    if (!isPlainObject(h)) errors.hotkeys = 'invalid';
    else {
      for (const key of Object.keys(h)) if (key !== 'enabled' && key !== 'bindings') errors[`hotkeys.${key}`] = 'unknown';
      if ('enabled' in h) { if (typeof h.enabled === 'boolean') next.hotkeys.enabled = h.enabled; else errors['hotkeys.enabled'] = 'invalid'; }
      if ('bindings' in h) {
        if (!isPlainObject(h.bindings)) errors['hotkeys.bindings'] = 'invalid';
        else {
          for (const [action, value] of Object.entries(h.bindings)) {
            if (!ACTIONS.includes(action)) { errors[`hotkeys.bindings.${action}`] = 'unknown'; continue; }
            const acc = canonicalAccelerator(value);
            if (!acc) errors[`hotkeys.bindings.${action}`] = 'invalid';
            else next.hotkeys.bindings[action] = acc;
          }
        }
      }
    }
  }
  const owners = new Set();
  for (const action of ACTIONS) {
    const acc = next.hotkeys.bindings[action];
    if (owners.has(acc) && !errors[`hotkeys.bindings.${action}`]) errors[`hotkeys.bindings.${action}`] = 'duplicate';
    owners.add(acc);
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings: next };
}

/** Is `url` a page the shell may take bridge calls from? *.pulsetechnologies.ai over https, or the configured app URL. */
function isTrustedOrigin(url, appUrl) {
  let u;
  try { u = new URL(url); } catch { return false; }
  try { if (appUrl && u.origin === new URL(appUrl).origin) return true; } catch { /* bad override */ }
  return u.protocol === 'https:' && (u.hostname === 'pulsetechnologies.ai' || u.hostname.endsWith('.pulsetechnologies.ai'));
}

const CALL_STATUSES = ['ringing', 'dialing', 'active', 'held'];
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(UNSAFE_TEXT, '').trim().slice(0, max) : '');

/** The call summary the web app reports (drives the mini window and tray). null = no call; invalid → null. */
function sanitizeCallState(raw, now = Date.now()) {
  if (!isPlainObject(raw)) return null;
  if (!CALL_STATUSES.includes(raw.status)) return null;
  const answeredAt = Number.isFinite(raw.answeredAt) && raw.answeredAt > 0 && raw.answeredAt <= now + 86_400_000 ? Math.floor(raw.answeredAt) : undefined;
  return {
    status: raw.status,
    direction: raw.direction === 'in' ? 'in' : 'out',
    remote: cleanText(raw.remote, 64),
    name: cleanText(raw.name, 80),
    muted: raw.muted === true,
    ...(answeredAt ? { answeredAt } : {}),
  };
}

/** The mini call window shows during a call while the main window is out of sight. */
function shouldShowMini({ miniEnabled, callState, mainVisible, mainMinimized }) {
  return Boolean(miniEnabled && callState && (!mainVisible || mainMinimized));
}

/** What the hotkey / tray "answer or hang up" action means right now: answer a ringing inbound call, else hang up. */
function answerOrHangupCommand(callState) {
  if (!callState) return null;
  return callState.status === 'ringing' && callState.direction === 'in' ? 'answer' : 'hangup';
}

module.exports = {
  ACTIONS, DEFAULT_BINDINGS, freshSettings, canonicalAccelerator, normalizeSettings, applyPatch,
  isTrustedOrigin, sanitizeCallState, shouldShowMini, answerOrHangupCommand,
};
