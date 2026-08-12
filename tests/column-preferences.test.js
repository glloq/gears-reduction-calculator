const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../js/ui/ColumnPreferences.js');
const columns = ['score', 'ratio', 'warnings', 'action'];

test('column preferences discard unknown and duplicate columns', () => {
  assert.deepEqual(preferences.sanitize(['ratio', 'unknown', 'ratio'], columns), ['ratio', 'action']);
});

test('column preferences keep action and prevent an empty data table', () => {
  assert.deepEqual(preferences.sanitize([], columns), columns);
  assert.deepEqual(preferences.sanitize(['score'], columns), ['score', 'action']);
});

test('column preferences survive storage and malformed values', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(preferences.save(storage, 'columns', ['warnings'], columns), ['warnings', 'action']);
  assert.deepEqual(preferences.load(storage, 'columns', columns), ['warnings', 'action']);
  values.set('columns', '{broken');
  assert.deepEqual(preferences.load(storage, 'columns', columns), columns);
});
