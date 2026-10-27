const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { toRows, findOffered, audioOffered } = require('../share-sources');

const img = (empty = false) => ({ isEmpty: () => empty, toDataURL: () => 'data:image/png;base64,AAA' });

describe('toRows', () => {
  test('lists screens before windows and drops entries without an id', () => {
    const rows = toRows([
      { id: 'window:1:0', name: 'Notes', thumbnail: img(), appIcon: img() },
      { id: 'screen:0:0', name: 'Screen 1', thumbnail: img() },
      { name: 'no id' },
      null,
    ]);
    assert.deepEqual(rows.map((r) => [r.id, r.kind]), [['screen:0:0', 'screen'], ['window:1:0', 'window']]);
    assert.equal(rows[0].icon, '');
    assert.equal(rows[1].icon, 'data:image/png;base64,AAA');
  });
  test('an empty thumbnail becomes no thumbnail, and a blank name falls back to the id', () => {
    const [r] = toRows([{ id: 'screen:2:0', name: '  ', thumbnail: img(true) }]);
    assert.equal(r.thumbnail, '');
    assert.equal(r.name, 'screen:2:0');
  });
  test('not an array is an empty list', () => {
    assert.deepEqual(toRows(undefined), []);
  });
});

describe('findOffered', () => {
  const rows = toRows([{ id: 'screen:0:0', name: 'Screen 1' }]);
  test('only an offered id is accepted', () => {
    assert.equal(findOffered(rows, 'screen:0:0').id, 'screen:0:0');
    assert.equal(findOffered(rows, 'screen:9:0'), null);
    assert.equal(findOffered(rows, { id: 'screen:0:0' }), null);
  });
});

describe('audioOffered', () => {
  test('only on Windows and only when the page asked for audio', () => {
    assert.equal(audioOffered({ audioRequested: true }, 'win32'), true);
    assert.equal(audioOffered({ audioRequested: false }, 'win32'), false);
    assert.equal(audioOffered({ audioRequested: true }, 'darwin'), false);
    assert.equal(audioOffered(null, 'win32'), false);
  });
});
