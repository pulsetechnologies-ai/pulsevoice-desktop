const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDialable, parsePhoneLink, findPhoneLinkInArgv, sanitizePhoneText } = require('../phone');

describe('parsePhoneLink', () => {
  test('tel: with visual separators', () => {
    assert.equal(parsePhoneLink('tel:+1-555-123-4567'), '+15551234567');
    assert.equal(parsePhoneLink('TEL:(555) 123.4567'), '5551234567');
    assert.equal(parsePhoneLink('tel:%2B15551234567'), '+15551234567');
    assert.equal(parsePhoneLink('tel:+1%20555%20123%204567'), '+15551234567');
  });
  test('drops parameters and headers', () => {
    assert.equal(parsePhoneLink('tel:5551234;rm -rf'), '5551234');
    assert.equal(parsePhoneLink('tel:+15551234567;phone-context=example.com'), '+15551234567');
    assert.equal(parsePhoneLink('tel:1001;ext=5'), '1001');
    assert.equal(parsePhoneLink('sip:+15551234567@example.com;user=phone?subject=hi'), '+15551234567');
  });
  test('keeps * and # for feature codes and extensions', () => {
    assert.equal(parsePhoneLink('tel:*67'), '*67');
    assert.equal(parsePhoneLink('tel:#31#5551234'), '#31#5551234');
  });
  test('sip: takes the user part only', () => {
    assert.equal(parsePhoneLink('sip:1001@pbx.example.com'), '1001');
    assert.equal(parsePhoneLink('sip:+15551234567:secret@example.com'), '+15551234567');
  });
  test('refuses anything that is not a plain dialable number', () => {
    for (const bad of [
      'sip:alice@example.com', 'sip:example.com', 'sip:@example.com', 'sips:+15551234567@example.com',
      'tel:', 'tel:abc', 'tel:555-CALL', 'tel:+1+555', 'tel:%ZZ', 
      'tel:<script>alert(1)</script>', 'javascript:alert(1)', 'https://example.com/tel:5551234', '', null, undefined, 42, {},
    ]) assert.equal(parsePhoneLink(bad), null, String(bad));
  });
  test('bounds the length', () => {
    assert.equal(parsePhoneLink(`tel:${'1'.repeat(33)}`), null);
    assert.equal(parsePhoneLink(`tel:${'1'.repeat(32)}`), '1'.repeat(32));
    assert.equal(parsePhoneLink(`tel:${'1'.repeat(600)}`), null);
  });
  test('a control character never survives', () => {
    assert.equal(parsePhoneLink('tel:5551234%0A'), null);
    assert.equal(parsePhoneLink('tel:5551234%00'), null);
  });
});

describe('findPhoneLinkInArgv', () => {
  test('finds the link among the command-line arguments', () => {
    assert.equal(findPhoneLinkInArgv(['C:\\PulseVoice.exe', '--hidden', 'tel:+15551234567']), '+15551234567');
    assert.equal(findPhoneLinkInArgv(['pv', 'SIP:1001@pbx']), '1001');
  });
  test('null when absent or invalid', () => {
    assert.equal(findPhoneLinkInArgv(['pv', '--hidden']), null);
    assert.equal(findPhoneLinkInArgv(['pv', 'tel:abc']), null);
    assert.equal(findPhoneLinkInArgv(undefined), null);
    assert.equal(findPhoneLinkInArgv([1, null]), null);
  });
});

describe('sanitizePhoneText (selection / clipboard)', () => {
  test('accepts a whole-selection phone number', () => {
    assert.equal(sanitizePhoneText('  (555) 123-4567 '), '5551234567');
    assert.equal(sanitizePhoneText('+1 555 123 4567'), '+15551234567');
    assert.equal(sanitizePhoneText('+44 20 7946 0958'), '+442079460958');
    assert.equal(sanitizePhoneText('911'), '911');
  });
  test('refuses text that merely contains a number', () => {
    for (const bad of ['call 555-1234', '555-1234 ext 5', 'abc', '', '12', '2026-10-25', '1'.repeat(21), '5551234;5', '555 1234 \n 99', '+', '++15551234567', '1+555123']) {
      assert.equal(sanitizePhoneText(bad), null, bad);
    }
    assert.equal(sanitizePhoneText(undefined), null);
    assert.equal(sanitizePhoneText('1'.repeat(65)), null);
  });
});

describe('normalizeDialable', () => {
  test('strips separators only', () => {
    assert.equal(normalizeDialable('+1 (555) 123-4567'), '+15551234567');
    assert.equal(normalizeDialable('5 5'), '55');
    assert.equal(normalizeDialable('+'), null);
  });
});
