const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHotkeys } = require('../hotkeys');
const { freshSettings, DEFAULT_BINDINGS } = require('../config');

function fakeShortcut(taken = []) {
  const live = new Map();
  return {
    live,
    register: (acc, fn) => { if (taken.includes(acc) || live.has(acc)) return false; live.set(acc, fn); return true; },
    unregister: (acc) => { live.delete(acc); },
  };
}

describe('createHotkeys', () => {
  test('registers nothing until enabled', () => {
    const gs = fakeShortcut();
    const hk = createHotkeys({ globalShortcut: gs, onAction: () => {} });
    assert.deepEqual(hk.apply(freshSettings().hotkeys), {});
    assert.equal(gs.live.size, 0);
  });
  test('registers every action and routes the press to onAction', () => {
    const gs = fakeShortcut();
    const seen = [];
    const hk = createHotkeys({ globalShortcut: gs, onAction: (a) => seen.push(a) });
    const status = hk.apply({ enabled: true, bindings: { ...DEFAULT_BINDINGS } });
    assert.deepEqual(status, { answerHangup: true, toggleMute: true, showWindow: true, dialClipboard: true });
    gs.live.get(DEFAULT_BINDINGS.toggleMute)();
    assert.deepEqual(seen, ['toggleMute']);
  });
  test('reports a combination another app owns, and keeps the rest', () => {
    const gs = fakeShortcut([DEFAULT_BINDINGS.showWindow]);
    const hk = createHotkeys({ globalShortcut: gs, onAction: () => {} });
    const status = hk.apply({ enabled: true, bindings: { ...DEFAULT_BINDINGS } });
    assert.equal(status.showWindow, false);
    assert.equal(status.answerHangup, true);
    assert.equal(gs.live.size, 3);
  });
  test('re-applying releases the old bindings; disabling releases all', () => {
    const gs = fakeShortcut();
    const hk = createHotkeys({ globalShortcut: gs, onAction: () => {} });
    hk.apply({ enabled: true, bindings: { ...DEFAULT_BINDINGS } });
    hk.apply({ enabled: true, bindings: { ...DEFAULT_BINDINGS, toggleMute: 'Control+Alt+M' } });
    assert.equal(gs.live.has(DEFAULT_BINDINGS.toggleMute), false);
    assert.equal(gs.live.has('Control+Alt+M'), true);
    hk.apply({ enabled: false, bindings: { ...DEFAULT_BINDINGS } });
    assert.equal(gs.live.size, 0);
  });
  test('a throwing register is a failed registration, not a crash', () => {
    const gs = { register: () => { throw new Error('bad accelerator'); }, unregister: () => {} };
    const hk = createHotkeys({ globalShortcut: gs, onAction: () => {} });
    assert.equal(hk.apply({ enabled: true, bindings: { ...DEFAULT_BINDINGS } }).answerHangup, false);
  });
  test('dispose releases everything', () => {
    const gs = fakeShortcut();
    const hk = createHotkeys({ globalShortcut: gs, onAction: () => {} });
    hk.apply({ enabled: true, bindings: { ...DEFAULT_BINDINGS } });
    hk.dispose();
    assert.equal(gs.live.size, 0);
  });
});
