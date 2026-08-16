const test = require('node:test');
const assert = require('node:assert/strict');
const Profile = require('../js/visualization/teeth/ToothProfile.js');
const Cache = require('../js/visualization/teeth/ToothProfileCache.js');

test('involute profile is finite and closed', () => {
  const path = Profile.gearPath(24, 12, 13, 10.75, 20);
  assert.match(path, /^M /);
  assert.match(path, / Z$/);
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test('identical profiles reuse one cache entry', () => {
  Cache.clear();
  const options = { type: 'spur', teeth: 24, module: 1, pressureAngle: 20 };
  assert.equal(Cache.get(options), Cache.get({ ...options }));
  assert.equal(Cache.size(), 1);
});
