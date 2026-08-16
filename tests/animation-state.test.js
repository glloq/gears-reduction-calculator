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

test('the pedagogical mode keeps one readable cadence, whatever the real speed', () => {
  const animation = new AnimationController({ request: () => 1, cancel: () => {} });
  animation.setScene({ kinematics: { inputOmega: 15000 } });
  assert.equal(animation.mode, 'pedagogical');
  assert.equal(animation.degreesPerSecond(), 120);
  animation.setSpeed(2);
  assert.equal(animation.degreesPerSecond(), 240);
  animation.setScene({ kinematics: { inputOmega: 60 } });
  assert.equal(animation.degreesPerSecond(), 240, 'le régime réel ne change rien en pédagogique');
});

test('the relative mode follows the real input speed, within readable bounds', () => {
  const animation = new AnimationController({ request: () => 1, cancel: () => {} });
  animation.setMode('relative');
  // Régime de référence : même cadence que le mode pédagogique.
  animation.setScene({ kinematics: { inputOmega: AnimationController.REFERENCE_RPM } });
  assert.equal(animation.degreesPerSecond(), 120);
  // Deux fois plus vite en entrée → deux fois plus vite à l'écran.
  animation.setScene({ kinematics: { inputOmega: 2 * AnimationController.REFERENCE_RPM } });
  assert.equal(animation.degreesPerSecond(), 240);
  // Mais un régime extrême reste borné : 15 000 rpm ne stroboscope pas.
  animation.setScene({ kinematics: { inputOmega: 15000 } });
  assert.equal(animation.degreesPerSecond(), AnimationController.RELATIVE_MAX);
  // Et un régime très lent reste perceptible.
  animation.setScene({ kinematics: { inputOmega: 1 } });
  assert.equal(animation.degreesPerSecond(), AnimationController.RELATIVE_MIN);
  // Vitesse nulle : rien ne bouge, dans les deux modes.
  animation.setSpeed(0);
  assert.equal(animation.degreesPerSecond(), 0);
});

test('the two modes differ only in cadence, never in the poses they produce', () => {
  const pedagogical = new AnimationController({ request: () => 1, cancel: () => {} });
  const relative = new AnimationController({ request: () => 1, cancel: () => {} }).setMode('relative');
  const scene = { kinematics: { inputOmega: 3000 } };
  pedagogical.setScene(scene); relative.setScene(scene);
  assert.notEqual(pedagogical.degreesPerSecond(), relative.degreesPerSecond());
  // Au même angle, les deux contrôleurs décrivent le même état.
  pedagogical.seek(210); relative.seek(210);
  assert.equal(pedagogical.angle, relative.angle);
});
