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
