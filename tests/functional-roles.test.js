const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Scene = require('../js/visualization/core/SceneBuilder.js');
const Layout = require('../js/visualization/TrainLayout.js');
const Inspector = require('../js/visualization/StageInspector.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');
const Primitives = require('../js/visualization/teeth/TeethPrimitives.js');

/** Un planétaire assemblable : (20 + 70) divisible par 3 satellites. */
function planetary(topology) {
  return Object.assign({
    type: 'planetary', sunTeeth: 20, ringTeeth: 70, planetTeeth: 25, planetCount: 3,
    parameters: { module: 1 },
    geometry: { sunDiameter: 20, ringDiameter: 70, planetDiameter: 25, module: 1 }
  }, topology || {});
}
function solutionFor(topology) {
  return { stages: [planetary(topology)], mechanical: [{ ratio: 4.5 }], inputSpeedRpm: 1500 };
}
const TOPOLOGIES = Registry.PLANETARY_TOPOLOGIES;

// ===== §6, §7 : la scène dit qui est quoi, une fois pour toutes =====

test('the scene names the functional role of every planetary member', () => {
  for (const topology of TOPOLOGIES) {
    const scene = Scene.build(solutionFor(topology));
    assert.equal(scene.functionalMember(0, 'input').role, topology.inputMember, JSON.stringify(topology));
    assert.equal(scene.functionalMember(0, 'output').role, topology.outputMember, JSON.stringify(topology));
    assert.equal(scene.functionalMember(0, 'fixed').role, topology.fixed, JSON.stringify(topology));
    // Le satellite n'est jamais entrée, sortie ni bâti : il transmet.
    assert.equal(scene.member('s0-P').functionalRole, 'intermediate');
  }
});

test('no renderer has to deduce the driving member any more', () => {
  const source = fs.readFileSync('js/visualization/core/SceneBuilder.js', 'utf8');
  // S était implicitement l'entrée : faux dès que la couronne ou le
  // porte-satellites mène.
  assert.doesNotMatch(source, /role === 'input' \|\| entry\.role === 'S'/);
  assert.match(source, /entry\.functionalRole === 'input'/);
  assert.match(source, /functionalMember: function/);
});

test('a member carries its readable name and how its rotation must be drawn', () => {
  const scene = Scene.build(solutionFor());
  assert.equal(scene.member('s0-S').memberName, 'Solaire');
  assert.equal(scene.member('s0-C').memberName, 'Porte-satellites');
  assert.equal(scene.member('s0-R').localizedRole, 'Fixe');
  assert.equal(scene.member('s0-P').rotationDisplayMode, 'orbitAndSpin');
  assert.equal(scene.member('s0-R').rotationDisplayMode, 'fixed');
  // §16 : la vis tourne autour de son axe — sa phase se lit sur ses filets.
  const worm = Scene.build({ stages: [{ type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2 } }], mechanical: [{}] });
  assert.equal(worm.member('s0-input').rotationDisplayMode, 'axialThreadPhase');
  assert.equal(worm.member('s0-output').rotationDisplayMode, 'inPlane');
});

// ===== §17 : les puces suivent les vrais membres =====

test('the Entrée and Sortie chips land on the real members, in all six topologies', () => {
  for (const topology of TOPOLOGIES) {
    const model = Layout.layout([planetary(topology)], [{}]);
    assert.equal(model.io.input.memberId, 's0-' + topology.inputMember, JSON.stringify(topology));
    assert.equal(model.io.output.memberId, 's0-' + topology.outputMember, JSON.stringify(topology));
    // La sortie ne doit JAMAIS se poser sur l'organe bloqué.
    assert.notEqual(model.io.output.memberId, 's0-' + topology.fixed);
  }
});

test('the default planetary no longer labels the fixed ring as the output', () => {
  const model = Layout.layout([planetary()], [{}]);
  // C'était le cas AVANT : io.output = wheels[1] = la couronne, c'est-à-dire
  // l'organe qui ne tourne pas.
  assert.equal(model.io.output.memberId, 's0-C');
  assert.notEqual(model.io.output.memberId, 's0-R');
});

// ===== §8 : l'inspecteur lit les bonnes vitesses =====

test('the inspector reports the speeds of the members that actually drive', () => {
  for (const topology of TOPOLOGIES) {
    const solution = solutionFor(topology);
    const scene = Scene.build(solution);
    const data = Inspector.model(solution, 0, Registry, scene);
    assert.equal(data.topology.input.role, topology.inputMember);
    assert.equal(data.topology.output.role, topology.outputMember);
    assert.equal(data.topology.fixed.role, topology.fixed);
    // L'organe bloqué ne tourne pas, quelle que soit la topologie.
    const held = scene.functionalMember(0, 'fixed');
    assert.ok(Math.abs(held.mechanical.rpm || 0) < 1e-6, JSON.stringify(topology));
    assert.ok(Math.abs(data.inputRpm) > 0);
  }
});

// ===== §4, §5 : trois organes distincts, six topologies explorées =====

test('the engine refuses a planetary whose members overlap', () => {
  const planetaryType = Registry.get('planetary');
  const base = planetary();
  assert.equal(planetaryType.validateConfiguration(base), true);
  for (const broken of [
    { inputMember: 'S', outputMember: 'S', fixed: 'R' },
    { inputMember: 'R', outputMember: 'C', fixed: 'R' },
    { inputMember: 'C', outputMember: 'S', fixed: 'C' }
  ]) {
    assert.equal(planetaryType.validateConfiguration(Object.assign({}, base, broken)), false, JSON.stringify(broken));
  }
  assert.equal(TOPOLOGIES.length, 6);
  assert.ok(TOPOLOGIES.every(t => Registry.distinctMembers(t)));
});

test('an automatic search really tries every planetary topology', () => {
  const options = { inputMin: 20, inputMax: 22, outputMin: 70, outputMax: 72,
    typeParameters: { planetary: { planetCount: 3, module: 1 } } };
  const candidates = Registry.get('planetary').generateCandidates(options);
  const seen = new Set(candidates.map(s => s.inputMember + '/' + s.fixed + '/' + s.outputMember));
  assert.equal(seen.size, 6, 'les six permutations doivent être essayées');

  // Et une topologie imposée reste la seule explorée.
  const forced = Registry.get('planetary').generateCandidates({
    inputMin: 20, inputMax: 22, outputMin: 70, outputMax: 72,
    typeParameters: { planetary: { planetCount: 3, topologyMode: 'fixed', inputMember: 'R', fixed: 'S', outputMember: 'C' } }
  });
  assert.ok(forced.length);
  assert.ok(forced.every(s => s.inputMember === 'R' && s.fixed === 'S' && s.outputMember === 'C'));
});

test('the different topologies really produce different ratios', () => {
  const ratios = TOPOLOGIES.map(t => Registry.get('planetary').calculateRatio(planetary(t)));
  const distinct = new Set(ratios.map(r => Math.round(Math.abs(r) * 1000)));
  // Si toutes donnaient le même rapport, les explorer serait sans objet.
  assert.ok(distinct.size >= 4, 'topologies attendues distinctes : ' + ratios.join(', '));
});

// ===== §11 à §14 : la vis tourne sans se déplacer =====

test('the worm body never moves, only its threads do', () => {
  const renderer = fs.readFileSync('js/visualization/TrainRenderer.js', 'utf8');
  // Le groupe ENTIER était translaté : corps, axe et filets ensemble.
  assert.doesNotMatch(renderer, /record\.rotor\.setAttribute\('transform', 'translate\(/);
  assert.match(renderer, /record\.rotor\.removeAttribute\('transform'\)/);
  assert.match(renderer, /querySelector\('\.worm-thread-phase'\)/);
});

test('the thread phase returns exactly to its start after a full turn', () => {
  const geometry = Primitives.wormGeometry({ kind: 'worm', teeth: 2, module: 2, pitchD: 20 });
  const phase = angle => ((angle / 360 * geometry.pitch) % geometry.pitch + geometry.pitch) % geometry.pitch;
  assert.ok(Math.abs(phase(0) - phase(360)) < 1e-9, 'la boucle doit être exacte');
  assert.ok(Math.abs(phase(720) - phase(0)) < 1e-9);
  // Et la phase progresse bien dans l'intervalle.
  assert.ok(phase(90) > phase(0) && phase(180) > phase(90) && phase(270) > phase(180));
  // Une animation inversée recule sans sortir de l'intervalle.
  assert.ok(phase(-90) >= 0 && phase(-90) < geometry.pitch);
});
