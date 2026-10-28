// While a call or meeting is up the page must keep running when its window is covered by another app or minimized:
// Chromium otherwise reports it hidden and stops requestAnimationFrame, which froze the camera the web app sends with a
// background effect (measured: 0 frames sent with the window behind another app). Outside a call the default stays so a
// window parked in the tray costs nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const fn = main.slice(main.indexOf('function setCallActive(active)'));
const body = fn.slice(0, fn.indexOf('\n}\n'));

test('setCallActive turns background throttling off for a call and back on after it', () => {
  assert.ok(body.includes('setBackgroundThrottling(!active)'));
});

test('the window is created with the default (throttled) behaviour so an idle tray window stays cheap', () => {
  assert.ok(!/backgroundThrottling:\s*false/.test(main));
});
