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
  // Un tour d'entrée (360°) avance la crémaillère de la course par tour, π·d.
  const full = Kinematics.pose(state, 360);
  assert.ok(Math.abs(full.linear['s0-rack'].position - 40 * Math.PI) < 1e-9);
  const half = Kinematics.pose(state, 180);
  assert.ok(Math.abs(half.linear['s0-rack'].position - 20 * Math.PI) < 1e-9);
});

test('reversing the input angle reverses the rack travel', () => {
  const stage = { type: 'rack', pinionTeeth: 20, parameters: { module: 2 }, geometry: { pitchDiameterInput: 40 } };
  const state = Kinematics.build({ inputRpm: 60, stages: [stage] });
  assert.equal(Kinematics.pose(state, -360).linear['s0-rack'].position, -Kinematics.pose(state, 360).linear['s0-rack'].position);
});

test('planet members carry both their own spin and their carrier orbit', () => {
  const stage = { type: 'planetary', sunTeeth: 20, ringTeeth: 60, planetTeeth: 20, planetCount: 4, fixed: 'R', inputMember: 'S', outputMember: 'C', parameters: { module: 1 } };
  const state = Kinematics.build({ inputRpm: 100, stages: [stage] });
  const planet = state.members['s0-P'];
  assert.equal(planet.count, 4);
  assert.equal(planet.orbitOmega, state.members['s0-C'].omega);
  // Couronne fixe : ωC = ωS/(1+ZR/ZS) = 25, ωP = ωC − (ZS/ZP)(ωS − ωC) = -50.
  assert.equal(state.members['s0-C'].omega, 25);
  assert.equal(planet.omega, -50);
  const posed = Kinematics.pose(state, 360);
  assert.equal(posed.members['s0-P'].orbitAngle, 90);
  assert.equal(posed.members['s0-P'].angle, -180);
});

test('flexible drives expose the belt travel per input revolution', () => {
  const stage = { type: 'belt', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { pitch: 2 }, geometry: { pitchDiameterInput: 40 } };
  const state = Kinematics.build({ inputRpm: 100, stages: [stage] });
  assert.ok(Math.abs(Kinematics.pose(state, 360).flexible['s0-drive'].offset - 40 * Math.PI) < 1e-9);
});

test('stage records expose the relation and the signed speeds of each shaft', () => {
  const state = Kinematics.build({ inputRpm: 1200, stages: [pair('spur', 20, 60), pair('bevel', 20, 40)] });
  assert.equal(state.stages[0].axisRelation, 'parallel');
  assert.equal(state.stages[1].axisRelation, 'perpendicular');
  assert.equal(state.stages[1].inputOmega, state.stages[0].outputOmega);
  assert.equal(Kinematics.relative(state, 's0-output'), -1 / 3);
});

test('an eight-stage compound train remains continuous', () => {
  const state = Kinematics.build({ inputRpm: 256, stages: Array.from({ length: 8 }, () => pair('spur', 10, 20)) });
  assert.equal(Math.abs(state.outputOmega), 1);
  for (let i = 1; i < 8; i++) assert.equal(state.members[`s${i}-input`].omega, state.members[`s${i - 1}-output`].omega);
});
