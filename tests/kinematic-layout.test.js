const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/kinematic/KinematicLayoutEngine.js');

test('consecutive stages share their intermediate world shaft', () => {
  const result = new Layout().layout([{ type: 'spur' }, { type: 'spur' }]);
  assert.equal(result.worldNodes[0].output, result.worldNodes[1].input);
  assert.equal(result.nodes[0].output.id, result.nodes[1].input.id);
});

test('bevel and worm stages create a perpendicular 3D axis', () => {
  for (const type of ['bevel', 'worm']) {
    const node = new Layout().layout([{ type }]).worldNodes[0];
    assert.equal(node.relation, 'perpendicular');
    assert.notEqual(node.input.axis.name, node.output.axis.name);
    const dot = node.input.axis.x * node.output.axis.x + node.input.axis.y * node.output.axis.y + node.input.axis.z * node.output.axis.z;
    assert.equal(dot, 0);
  }
});

test('spur bevel spur preserves the changed axis for the last stage', () => {
  const nodes = new Layout().layout([{ type: 'spur' }, { type: 'bevel' }, { type: 'spur' }]).worldNodes;
  assert.equal(nodes[0].output, nodes[1].input);
  assert.equal(nodes[1].output, nodes[2].input);
  assert.equal(nodes[2].input.axis.name, nodes[2].output.axis.name);
  assert.notEqual(nodes[0].input.axis.name, nodes[2].output.axis.name);
});

test('planetary remains coaxial while internal mesh uses offset parallel axes', () => {
  const planetary = new Layout().layout([{ type: 'planetary' }]).worldNodes[0];
  assert.equal(planetary.relation, 'coaxial');
  assert.equal(planetary.input.id, planetary.output.id);
  const internal = new Layout().layout([{ type: 'internal' }]).worldNodes[0];
  assert.equal(internal.relation, 'internal-parallel');
  assert.notEqual(internal.input.id, internal.output.id);
  assert.equal(internal.input.axis.name, internal.output.axis.name);
});

test('main and orthogonal projections expose different spatial coordinates', () => {
  const engine = new Layout(), stages = [{ type: 'bevel' }];
  const main = engine.layout(stages, 'main').nodes[0].output;
  const orthogonal = engine.layout(stages, 'orthogonal').nodes[0].output;
  assert.notEqual(main.y, orthogonal.y);
  assert.equal(engine.layout([{ type: 'rack' }]).worldNodes[0].output.axis.name, 'LINEAR');
});

test('projected shafts are unique and retain stable S identifiers', () => {
  const result = new Layout().layout([
    { type: 'planetary' },
    { type: 'spur' },
    { type: 'planetary' }
  ]);
  assert.deepEqual(result.projectedShafts.map(shaft => shaft.id), [0, 2]);
  assert.equal(result.projectedShafts[0].role, 'INPUT');
});

test('auto projection selects the least colliding supported projection', () => {
  const engine = new Layout();
  const stages = [{ type: 'spur' }, { type: 'bevel' }, { type: 'spur' }, { type: 'worm' }];
  const automatic = engine.layout(stages, 'auto');
  assert.equal(automatic.requestedProjection, 'auto');
  assert.ok(['main', 'orthogonal'].includes(automatic.projection));
  const scores = ['main', 'orthogonal'].map(name => {
    const points = engine.layout(stages, name).projectedShafts;
    return { name, score: Layout.collisionScore(points) };
  });
  assert.equal(automatic.projection, scores.sort((a, b) => a.score - b.score)[0].name);
});

test('every shaft carries the stage that drives it, coaxial ones included', () => {
  const result = new Layout().layout([{ type: 'spur' }, { type: 'planetary' }, { type: 'bevel' }]);
  assert.equal(result.projectedShafts[0].stageIndex, undefined, "l'arbre d'entrée n'est produit par aucun étage");
  result.projectedShafts.slice(1).forEach(shaft => assert.ok(Number.isFinite(shaft.stageIndex)));
  // Le planétaire ajoute un arbre concentrique : deux vitesses sur un même axe.
  assert.equal(result.coaxialShafts.length, 1);
  assert.equal(result.coaxialShafts[0].stageIndex, 1);
  assert.equal(result.coaxialShafts[0].coaxial, true);
});

test('the layout is normalized inside its own viewBox', () => {
  const result = new Layout().layout([{ type: 'bevel' }, { type: 'worm' }, { type: 'bevel' }, { type: 'spur' }], 'main');
  const points = result.projectedShafts.concat(result.nodes.map(n => n.output));
  points.forEach(point => {
    assert.ok(point.x >= 0 && point.x <= result.width, 'x hors cadre: ' + point.x + '/' + result.width);
    assert.ok(point.y >= 0 && point.y <= result.height, 'y hors cadre: ' + point.y + '/' + result.height);
  });
});

test('shaft labels stay inside the frame and never overlap each other', () => {
  const result = new Layout().layout([{ type: 'spur' }, { type: 'bevel' }, { type: 'spur' }]);
  const labels = result.projectedShafts.map(shaft => ({ x: shaft.x, y: shaft.labelY }));
  labels.forEach(label => {
    assert.ok(Number.isFinite(label.y), 'étiquette sans position');
    assert.ok(label.y > 0 && label.y < result.height, 'étiquette hors cadre: ' + label.y);
  });
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const close = Math.abs(labels[i].x - labels[j].x) < 80 && Math.abs(labels[i].y - labels[j].y) < 18;
    assert.ok(!close, 'étiquettes superposées ' + i + '/' + j);
  }
});

test('normalize reframes negative coordinates without distorting the drawing', () => {
  const points = [{ x: -40, y: -10 }, { x: 100, y: 200 }];
  const before = points[1].x - points[0].x;
  const box = Layout.normalize([points], 300);
  assert.equal(points[1].x - points[0].x, before, 'écarts conservés');
  assert.ok(points.every(p => p.x >= 0 && p.y >= 0));
  assert.ok(box.width >= points[1].x && box.height >= points[1].y);
});
