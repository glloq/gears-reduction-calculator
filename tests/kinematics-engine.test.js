const test = require('node:test');
const assert = require('node:assert/strict');
const Kinematics = require('../js/visualization/core/KinematicsEngine.js');

function pair(type, z1, z2, parameters = {}) { return { type, input: { teeth: z1 }, output: { teeth: z2 }, parameters }; }

test('external, internal and flexible drives preserve ratios and directions', () => {
  const state = Kinematics.build({ inputRpm: 1200, stages: [
    pair('spur', 20, 60), pair('internal', 20, 40), pair('belt', 20, 40), pair('belt', 20, 40, { crossed: true }), pair('chain', 20, 40)
  ] });
  assert.equal(state.members['s0-output'].omega, -400);
  assert.equal(state.members['s1-output'].omega, -200);
  assert.equal(state.members['s2-output'].omega, -100);
  assert.equal(state.members['s3-output'].omega, 50);
  assert.equal(state.members['s4-output'].omega, 25);
});

test('worm and bevel introduce the registry direction', () => {
  const worm = { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 1 } };
  const state = Kinematics.build({ inputRpm: 1000, stages: [worm, pair('bevel', 20, 40)] });
  assert.equal(state.members['s0-output'].omega, -50);
  assert.equal(state.members['s1-output'].omega, 25);
});

test('planetary uses Willis for every valid input/output/fixed permutation', () => {
  const members = ['S', 'R', 'C'];
  for (const fixed of members) for (const inputMember of members) for (const outputMember of members) {
    if (fixed === inputMember || fixed === outputMember || inputMember === outputMember) continue;
    const stage = { type: 'planetary', sunTeeth: 20, ringTeeth: 60, planetTeeth: 20, planetCount: 4, fixed, inputMember, outputMember, parameters: { module: 1 } };
    const state = Kinematics.build({ inputRpm: 100, stages: [stage] });
    assert.equal(state.members[`s0-${fixed}`].omega, 0);
    assert.equal(state.members[`s0-${inputMember}`].omega, 100);
    assert.equal(state.outputOmega, state.members[`s0-${outputMember}`].omega);
  }
});

test('rack pose converts input rotation into translation', () => {
  const stage = { type: 'rack', pinionTeeth: 20, parameters: { module: 2 }, geometry: { pitchDiameterInput: 40 } };
  const state = Kinematics.build({ inputRpm: 60, stages: [stage] });
  const pose = Kinematics.pose(state, Math.PI * 2);
  assert.ok(Math.abs(pose.linear['s0-rack'].position - 40 * Math.PI) < 1e-9);
});

test('an eight-stage compound train remains continuous', () => {
  const state = Kinematics.build({ inputRpm: 256, stages: Array.from({ length: 8 }, () => pair('spur', 10, 20)) });
  assert.equal(Math.abs(state.outputOmega), 1);
  for (let i = 1; i < 8; i++) assert.equal(state.members[`s${i}-input`].omega, state.members[`s${i - 1}-output`].omega);
});
