const test = require('node:test');
const assert = require('node:assert/strict');
const AnimationController = require('../js/visualization/core/AnimationController.js');

test('animation controller exposes deterministic state controls', () => {
  const updates = [];
  const animation = new AnimationController({ request: () => 1, cancel: () => {}, onUpdate: angle => updates.push(angle) });
  animation.setScene({ id: 1 }).setSpeed(.25).setDirection(-1).setMode('relative').seek(90);
  assert.equal(animation.angle, 90);
  assert.equal(animation.speed, .25);
  assert.equal(animation.direction, -1);
  assert.equal(animation.mode, 'relative');
  animation.play(); assert.equal(animation.playing, true);
  animation.pause(); assert.equal(animation.playing, false);
  assert.deepEqual(updates, [0, 90]);
});
