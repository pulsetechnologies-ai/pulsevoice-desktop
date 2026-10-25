const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIONS, DEFAULT_BINDINGS, freshSettings, canonicalAccelerator, normalizeSettings, applyPatch,
  isTrustedOrigin, sanitizeCallState, shouldShowMini, answerOrHangupCommand,
} = require('../config');

describe('canonicalAccelerator', () => {
  test('canonicalises case, aliases and modifier order', () => {
    assert.equal(canonicalAccelerator('ctrl+shift+m'), 'Control+Shift+M');
    assert.equal(canonicalAccelerator('Shift+CmdOrCtrl+m'), 'CommandOrControl+Shift+M');
    assert.equal(canonicalAccelerator('Shift+Option+CommandOrControl+9'), 'CommandOrControl+Alt+Shift+9');
    assert.equal(canonicalAccelerator('Control + Alt + space'), 'Control+Alt+Space');
    assert.equal(canonicalAccelerator('Alt+F5'), 'Alt+F5');
    assert.equal(canonicalAccelerator('CommandOrControl+Alt+PageUp'), 'CommandOrControl+Alt+PageUp');
  });
  test('every default is already canonical', () => {
    for (const a of ACTIONS) assert.equal(canonicalAccelerator(DEFAULT_BINDINGS[a]), DEFAULT_BINDINGS[a]);
  });
  test('refuses combinations that would hijack typing', () => {
    for (const bad of ['C', 'A', 'F5', 'Shift+A', 'Control+C', 'CommandOrControl+V', 'Alt+A', 'Command+Q', 'Shift+F5']) {
      assert.equal(canonicalAccelerator(bad), null, bad);
    }
  });
  test('refuses malformed accelerators', () => {
    for (const bad of [
      '', '+', 'Control+', '+A', 'Control+Shift', 'Control+Shift+AB', 'Control+Control+A', 'CommandOrControl+Control+A',
      'Control+Shift+F25', 'Control+Shift+Escape', 'Control+Shift+Enter', 'Meta+Shift+A', 'Control+Shift+A+B', 'Control++A',
      'Control+Shift+;', 'x'.repeat(41), null, undefined, 5, {}, ['Control+Shift+A'],
    ]) assert.equal(canonicalAccelerator(bad), null, String(bad));
  });
});

describe('normalizeSettings', () => {
  test('defaults are the safe ones', () => {
    const s = normalizeSettings(undefined);
    assert.deepEqual(s, freshSettings());
    assert.equal(s.hotkeys.enabled, false);
    assert.equal(s.startAtLogin, false);
    assert.equal(s.phoneLinks, 'ask');
  });
  test('reads a good file', () => {
    const s = normalizeSettings({ hotkeys: { enabled: true, bindings: { toggleMute: 'ctrl+alt+m' } }, startAtLogin: true, phoneLinks: 'yes', miniWindow: false });
    assert.equal(s.hotkeys.enabled, true);
    assert.equal(s.hotkeys.bindings.toggleMute, 'Control+Alt+M');
    assert.equal(s.hotkeys.bindings.answerHangup, DEFAULT_BINDINGS.answerHangup);
    assert.equal(s.startAtLogin, true);
    assert.equal(s.phoneLinks, 'yes');
    assert.equal(s.miniWindow, false);
  });
  test('a damaged file never throws and never turns anything on', () => {
    for (const raw of [null, 'x', 7, [], { hotkeys: 'on' }, { hotkeys: { enabled: 'true', bindings: 'x' } }, { startAtLogin: 'yes', phoneLinks: 'maybe' }]) {
      const s = normalizeSettings(raw);
      assert.equal(s.hotkeys.enabled, false);
      assert.equal(s.startAtLogin, false);
      assert.equal(s.phoneLinks, 'ask');
    }
  });
  test('invalid or repeated saved bindings fall back to the default', () => {
    const s = normalizeSettings({ hotkeys: { enabled: true, bindings: { answerHangup: 'Ctrl+C', toggleMute: 'Control+Shift+X', showWindow: 'ctrl+shift+x' } } });
    assert.equal(s.hotkeys.bindings.answerHangup, DEFAULT_BINDINGS.answerHangup);
    assert.equal(s.hotkeys.bindings.toggleMute, 'Control+Shift+X');
    assert.equal(s.hotkeys.bindings.showWindow, DEFAULT_BINDINGS.showWindow);
  });
});

describe('applyPatch', () => {
  const base = freshSettings();
  test('enables hotkeys and changes one binding', () => {
    const r = applyPatch(base, { hotkeys: { enabled: true, bindings: { toggleMute: 'ctrl+alt+m' } } });
    assert.equal(r.ok, true);
    assert.equal(r.settings.hotkeys.enabled, true);
    assert.equal(r.settings.hotkeys.bindings.toggleMute, 'Control+Alt+M');
    assert.equal(base.hotkeys.enabled, false, 'the input is not mutated');
    assert.equal(base.hotkeys.bindings.toggleMute, DEFAULT_BINDINGS.toggleMute);
  });
  test('is all-or-nothing and reports codes by field', () => {
    const r = applyPatch(base, { startAtLogin: true, hotkeys: { bindings: { toggleMute: 'Ctrl+C', nope: 'Ctrl+Shift+Q' } } });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, { 'hotkeys.bindings.toggleMute': 'invalid', 'hotkeys.bindings.nope': 'unknown' });
  });
  test('refuses a binding another action already owns', () => {
    const r = applyPatch(base, { hotkeys: { bindings: { toggleMute: DEFAULT_BINDINGS.answerHangup } } });
    assert.equal(r.ok, false);
    assert.equal(r.errors['hotkeys.bindings.toggleMute'], 'duplicate');
  });
  test('allows swapping two bindings in one patch', () => {
    const r = applyPatch(base, { hotkeys: { bindings: { toggleMute: DEFAULT_BINDINGS.answerHangup, answerHangup: DEFAULT_BINDINGS.toggleMute } } });
    assert.equal(r.ok, true);
  });
  test('strict types and shapes', () => {
    for (const patch of [null, 'x', [], { startAtLogin: 'yes' }, { miniWindow: 1 }, { phoneLinks: 'ask' }, { phoneLinks: true }, { hotkeys: true },
      { hotkeys: { enabled: 'on' } }, { hotkeys: { bindings: [] } }, { hotkeys: { extra: 1 } }, { other: 1 }]) {
      assert.equal(applyPatch(base, patch).ok, false, JSON.stringify(patch));
    }
  });
  test('phone links can be set to yes / no only (ask is the unasked state)', () => {
    assert.equal(applyPatch(base, { phoneLinks: 'yes' }).settings.phoneLinks, 'yes');
    assert.equal(applyPatch(base, { phoneLinks: 'no' }).settings.phoneLinks, 'no');
  });
});

describe('isTrustedOrigin', () => {
  const app = 'https://app.pulsevoice.pulsetechnologies.ai';
  test('PulseVoice origins', () => {
    assert.equal(isTrustedOrigin('https://app.pulsevoice.pulsetechnologies.ai/phone', app), true);
    assert.equal(isTrustedOrigin('https://login.pulsetechnologies.ai/?x=1', app), true);
    assert.equal(isTrustedOrigin('https://pulsetechnologies.ai/', app), true);
  });
  test('lookalikes, other schemes and garbage', () => {
    for (const bad of ['http://app.pulsevoice.pulsetechnologies.ai/', 'https://pulsetechnologies.ai.evil.com/', 'https://evilpulsetechnologies.ai/',
      'https://pulsetechnologies.ai@evil.com/', 'file:///C:/x.html', 'about:blank', '', 'not a url', null, undefined]) {
      assert.equal(isTrustedOrigin(bad, app), false, String(bad));
    }
  });
  test('the configured override origin is trusted (local development only)', () => {
    assert.equal(isTrustedOrigin('http://localhost:8081/phone', 'http://localhost:8081'), true);
    assert.equal(isTrustedOrigin('http://localhost:9999/', 'http://localhost:8081'), false);
  });
});

describe('sanitizeCallState', () => {
  const now = 1_800_000_000_000;
  test('passes a good summary through', () => {
    assert.deepEqual(
      sanitizeCallState({ status: 'active', direction: 'in', remote: '+15551234567', name: 'Ada Lovelace', muted: true, answeredAt: now - 5000 }, now),
      { status: 'active', direction: 'in', remote: '+15551234567', name: 'Ada Lovelace', muted: true, answeredAt: now - 5000 },
    );
  });
  test('unknown status or a non-object is no call', () => {
    for (const raw of [null, 'x', [], { status: 'idle' }, { status: 'ended' }, { direction: 'in' }, undefined]) assert.equal(sanitizeCallState(raw, now), null);
  });
  test('strips control and bidi characters and bounds the text', () => {
    const s = sanitizeCallState({ status: 'ringing', direction: 'in', remote: '55\u0000512\n34', name: `\u202eevil${'x'.repeat(200)}` }, now);
    assert.equal(s.remote, '5551234');
    assert.equal(s.name.startsWith('evil'), true);
    assert.equal(s.name.length, 80);
  });
  test('fields of the wrong type fall back; bad timestamps are dropped', () => {
    const s = sanitizeCallState({ status: 'active', direction: 'sideways', remote: 5, name: {}, muted: 'yes', answeredAt: 'now' }, now);
    assert.deepEqual(s, { status: 'active', direction: 'out', remote: '', name: '', muted: false });
    assert.equal('answeredAt' in sanitizeCallState({ status: 'active', answeredAt: now + 10 * 86_400_000 }, now), false);
    assert.equal('answeredAt' in sanitizeCallState({ status: 'active', answeredAt: -1 }, now), false);
  });
});

describe('shouldShowMini / answerOrHangupCommand', () => {
  const call = { status: 'active', direction: 'out' };
  test('only during a call with the main window out of sight', () => {
    assert.equal(shouldShowMini({ miniEnabled: true, callState: call, mainVisible: false, mainMinimized: false }), true);
    assert.equal(shouldShowMini({ miniEnabled: true, callState: call, mainVisible: true, mainMinimized: true }), true);
    assert.equal(shouldShowMini({ miniEnabled: true, callState: call, mainVisible: true, mainMinimized: false }), false);
    assert.equal(shouldShowMini({ miniEnabled: true, callState: null, mainVisible: false, mainMinimized: false }), false);
    assert.equal(shouldShowMini({ miniEnabled: false, callState: call, mainVisible: false, mainMinimized: false }), false);
  });
  test('answer a ringing inbound call, otherwise hang up, nothing without a call', () => {
    assert.equal(answerOrHangupCommand({ status: 'ringing', direction: 'in' }), 'answer');
    assert.equal(answerOrHangupCommand({ status: 'ringing', direction: 'out' }), 'hangup');
    assert.equal(answerOrHangupCommand({ status: 'active', direction: 'in' }), 'hangup');
    assert.equal(answerOrHangupCommand({ status: 'held', direction: 'out' }), 'hangup');
    assert.equal(answerOrHangupCommand(null), null);
  });
});
