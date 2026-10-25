// Phone-number parsing for tel:/sip: links, the context-menu "Call with PulseVoice" entry and the clipboard hotkey.
//
// Pure (no Electron) so it is unit-tested. Everything here exists to turn untrusted text — a link anyone can put on a
// web page, a selection, the clipboard — into either a short dialable string (digits, a leading +, * and #) or null.
// The result is only ever PREFILLED into the dialer; nothing in the shell places a call.

const MAX_DIGITS = 32;

/** "(555) 123-4567" → "5551234567". null unless what is left is a plain dialable string. */
function normalizeDialable(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/[ \t.\-()]/g, '');
  if (!/^\+?[0-9*#]+$/.test(stripped)) return null;
  if (stripped.replace(/\D/g, '').length === 0 || stripped.length > MAX_DIGITS) return null;
  return stripped;
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

/**
 * tel:+1-555-123-4567;phone-context=x  →  "+15551234567"
 * sip:+15551234567@host;user=phone     →  "+15551234567"
 * sip:alice@host / sip:host / sips:… / anything else → null (the dialer places phone calls, not SIP-address calls).
 */
function parsePhoneLink(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  const m = /^(tel|sip):(.*)$/is.exec(raw.trim());
  if (!m) return null;
  let rest = m[2];
  if (m[1].toLowerCase() === 'sip') {
    const at = rest.indexOf('@');
    if (at < 1) return null; // no user part
    rest = rest.slice(0, at);
    const colon = rest.indexOf(':'); // user:password
    if (colon >= 0) rest = rest.slice(0, colon);
  }
  rest = rest.split(/[;?]/, 1)[0]; // drop ;phone-context=…, ;ext=…, ?headers
  const decoded = decode(rest);
  return decoded === null ? null : normalizeDialable(decoded);
}

/** The first tel:/sip: argument in a command line (second-instance on Windows/Linux, cold start). */
function findPhoneLinkInArgv(argv) {
  if (!Array.isArray(argv)) return null;
  const arg = argv.find((a) => typeof a === 'string' && /^(tel|sip):/i.test(a));
  return arg === undefined ? null : parsePhoneLink(arg);
}

/**
 * A selection or clipboard text counts as a phone number only when ALL of it looks like one — "call 555-1234 after 5"
 * is not offered. 3–20 digits, optional leading +, spaces . - ( ) as separators; a date such as 2026-10-25 is refused.
 */
function sanitizePhoneText(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const t = text.trim();
  if (!/^\+?[\d \t.\-()]+$/.test(t)) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) return null;
  const digits = t.replace(/\D/g, '').length;
  if (digits < 3 || digits > 20) return null;
  return normalizeDialable(t);
}

module.exports = { normalizeDialable, parsePhoneLink, findPhoneLinkInArgv, sanitizePhoneText };
