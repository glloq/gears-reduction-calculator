const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/geometry/GeometryLayout.js');

test('geometry layout uses calculated diameters and corrected flexible distance', () => {
  const solution = { stages: [{ type: 'belt', parameters: { crossed: false }, geometry: { pitchDiameterInput: 40, pitchDiameterOutput: 100, centerDistance: 210, correctedCenterDistance: 212.5, maxDiameter: 100 } }] };
  const model = Layout.build(solution);
  assert.equal(model.stages[0].centerDistance, 212.5);
  // L'étage occupe son entraxe ET ses deux poulies. La DIRECTION dans laquelle
  // il s'étend n'appartient plus à cette vue : elle vient du modèle spatial,
  // comme pour la vue de denture, et c'est justement ce qui garantit que les
  // deux décrivent le même mécanisme.
  assert.ok(Math.max(model.stages[0].width, model.stages[0].height) >= 282.5);
  assert.ok(model.bounds.width >= model.stages[0].x + model.stages[0].width / 2);
});

test('geometry layout spaces stages without overlapping their calculated extents', () => {
  const solution = { stages: [
    { type: 'spur', geometry: { pitchDiameterInput: 30, pitchDiameterOutput: 90, centerDistance: 60, maxDiameter: 94 } },
    { type: 'planetary', geometry: { sunDiameter: 30, planetDiameter: 30, ringDiameter: 90, maxDiameter: 94 } }
  ] };
  const model = Layout.build(solution, { stageGap: 80 });
  const first = model.stages[0], second = model.stages[1];
  assert.ok(second.x - second.diameter / 2 >= first.x - first.diameter / 2 + first.width + 80);
  model.stages.forEach(item => ['x', 'y', 'width', 'height', 'diameter'].forEach(key => assert.ok(Number.isFinite(item[key]))));
});

test('rack width reflects its real travel per revolution', () => {
  const model = Layout.build({ stages: [{ type: 'rack', parameters: { module: 2 }, geometry: { pitchDiameterInput: 40, maxDiameter: 44, travelPerRevolution: 125.66 } }] });
  assert.equal(model.stages[0].width, 125.66);
});

test('each stage exposes its members at their real calculated positions', () => {
  const Registry = require('../js/transmissions/TransmissionRegistry.js');
  const spur = { type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2, faceWidth: 20 } };
  spur.geometry = Registry.get('spur').calculateGeometry(spur);
  const item = Layout.build({ stages: [spur] }).stages[0];
  const [input, output] = item.members;
  assert.equal(input.role, 'input');
  // C'est la DISTANCE qui est l'entraxe : le supposer horizontal était une
  // convention propre à cette vue, et donc une occasion de plus de diverger.
  assert.ok(Math.abs(Math.hypot(output.cx - input.cx, output.cy - input.cy)
    - spur.geometry.centerDistance) < 1e-9, 'entraxe réel entre les deux membres');
  assert.equal(input.pitchDiameter, 40);
  assert.equal(output.outsideDiameter, spur.geometry.outsideDiameterOutput);
  assert.equal(input.baseDiameter, spur.geometry.baseDiameterInput);
});

test('a planetary exposes its ring, sun, every real planet and its carrier', () => {
  const stage = { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 5,
    parameters: { module: 2 }, geometry: { sunDiameter: 48, ringDiameter: 144, planetDiameter: 48, maxDiameter: 148 } };
  const members = Layout.build({ stages: [stage] }).stages[0].members;
  assert.equal(members.filter(m => m.role === 'planet').length, 5);
  assert.equal(members.filter(m => m.role === 'carrier').length, 1);
  // Les satellites sont sur l'orbite réelle (dS + dP) / 2.
  const item = Layout.build({ stages: [stage] }).stages[0];
  members.filter(m => m.role === 'planet').forEach(planet => {
    assert.ok(Math.abs(Math.hypot(planet.cx - item.x, planet.cy - item.y) - 48) < 1e-9);
  });
});

test('only the dimensions actually calculated are listed', () => {
  const belt = { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 2 },
    geometry: { pitchDiameterInput: 40, pitchDiameterOutput: 120, correctedCenterDistance: 212.5,
      maxDiameter: 120, width: 10, actualLength: 620, wrapAngleDeg: 158.2, beltTeeth: 310 } };
  const keys = Layout.build({ stages: [belt] }).stages[0].dimensions.map(d => d.key);
  assert.deepEqual(keys, ['centerDistance', 'width', 'module', 'length', 'wrap', 'beltTeeth']);
  // Une géométrie vide ne fabrique aucune cote.
  assert.deepEqual(Layout.build({ stages: [{ type: 'spur', parameters: {}, geometry: {} }] }).stages[0].dimensions, []);
});

test('the overall envelope repeats the engine dimensions, never invented ones', () => {
  const solution = { stages: [{ type: 'spur', parameters: { module: 1 }, geometry: { pitchDiameterInput: 20, pitchDiameterOutput: 60, centerDistance: 40, maxDiameter: 62 } }],
    dimensions: { length: 102, maxDiameter: 62, width: 10 } };
  assert.deepEqual(Layout.build(solution).envelope, { length: 102, maxDiameter: 62, width: 10 });
  assert.deepEqual(Layout.build({ stages: solution.stages }).envelope, { length: null, maxDiameter: null, width: null });
});

test('margins scale with the reducer so small and large trains frame alike', () => {
  const small = Layout.build({ stages: [{ type: 'spur', parameters: { module: .5 }, geometry: { pitchDiameterInput: 10, pitchDiameterOutput: 20, centerDistance: 15, maxDiameter: 21 } }] });
  const large = Layout.build({ stages: [{ type: 'spur', parameters: { module: 8 }, geometry: { pitchDiameterInput: 160, pitchDiameterOutput: 480, centerDistance: 320, maxDiameter: 496 } }] });
  const fill = model => (model.stages[0].width) / model.bounds.width;
  assert.ok(Math.abs(fill(small) - fill(large)) < 0.2, 'même part du cadre occupée: ' + fill(small) + ' vs ' + fill(large));
});

test('the sized view and the teeth view describe the same mechanism', () => {
  // C'était l'enjeu de la refonte : trois vues, trois placements, donc trois
  // mécanismes possibles pour la même solution. La vue cotée posait la roue
  // d'une vis « sous » la vis, la couronne d'un train intérieur à gauche de son
  // pignon, et la roue conique à une demi-somme de diamètres augmentée d'un
  // demi-diamètre — une formule sans justification mécanique. Rien ne garantit
  // que deux conventions séparées décrivent le même réducteur ; une seule
  // source le garantit.
  const Registry = require('../js/transmissions/TransmissionRegistry.js');
  const Train = require('../js/visualization/TrainLayout.js');
  const build = (type, config) => {
    const stage = Object.assign({ type, parameters: { module: 2 } }, config);
    stage.geometry = Registry.get(type).calculateGeometry(stage);
    return stage;
  };
  const stages = [
    build('spur', { input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, faceWidth: 20 } }),
    build('worm', { wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20, diameterQuotient: 10 } }),
    build('internal', { input: { teeth: 18 }, output: { teeth: 54 }, parameters: { module: 2 } }),
    build('bevel', { input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 90, faceWidth: 15 } })
  ];
  const solution = { stages: stages, mechanical: [] };
  const sized = Layout.build(solution);
  const teeth = Train.layout(stages, [], { solution: solution });

  // Les deux vues disposent leurs étages autrement — l'une côte à côte pour la
  // cotation, l'autre sur les axes réels — mais À L'INTÉRIEUR d'un étage, les
  // organes sont au même endroit les uns par rapport aux autres.
  let compared = 0;
  sized.stages.forEach((item, index) => {
    const drawn = Object.fromEntries(teeth.stages[index].wheels
      .filter(w => w.memberId).map(w => [w.memberId, w]));
    const cotable = item.members.filter(m => m.memberId && drawn[m.memberId]
      && m.role !== 'planet' && m.role !== 'carrier');
    for (let i = 1; i < cotable.length; i++) {
      const [a, b] = [cotable[0], cotable[i]];
      const here = [b.cx - a.cx, b.cy - a.cy];
      const there = [drawn[b.memberId].cx - drawn[a.memberId].cx,
        drawn[b.memberId].cy - drawn[a.memberId].cy];
      assert.ok(Math.hypot(here[0] - there[0], here[1] - there[1]) < 1e-6,
        `étage ${index} · ${a.memberId}→${b.memberId} : ${here} contre ${there}`);
      compared++;
    }
  });
  assert.ok(compared >= 4, 'chaque étage doit avoir été comparé');
});
