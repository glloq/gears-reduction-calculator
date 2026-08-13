const test = require('node:test');
const assert = require('node:assert/strict');
const Filter = require('../js/ui/SolutionFilter.js');

function solution(overrides = {}) {
  return Object.assign({
    score: { value: 0.5 },
    errorPercent: 0.05,
    efficiency: 0.94,
    stages: [{ type: 'spur' }, { type: 'spur' }],
    dimensions: { x: 40, y: 50, z: 10, maxDiameter: 50, length: 40, width: 10 },
    mechanical: [
      { bending: { safetyFactor: 1.4 }, contact: { safetyFactor: 1.1 } },
      { bending: { safetyFactor: 2.0 }, contact: { safetyFactor: 1.6 } }
    ],
    warnings: []
  }, overrides);
}

test('bounds reports observed ranges and the union of stage types', () => {
  const pool = [
    solution(),
    solution({ errorPercent: 0.4, efficiency: 0.8, stages: [{ type: 'worm' }], dimensions: { maxDiameter: 120, length: 90, x: 90, y: 120, z: 12 } })
  ];
  const b = Filter.bounds(pool);
  assert.equal(b.maxError, 0.4);
  assert.equal(b.minEfficiency, 0.8);
  assert.equal(b.maxDiameter, 120);
  assert.equal(b.maxLength, 90);
  assert.equal(b.maxStages, 2);
  assert.deepEqual(b.types, ['spur', 'worm']);
});

test('each numeric criterion filters and null passes everything', () => {
  const pool = [
    solution({ errorPercent: 0.01 }),
    solution({ errorPercent: 0.5, efficiency: 0.85, dimensions: { maxDiameter: 200, length: 300, x: 300, y: 200, z: 10 } })
  ];
  assert.equal(Filter.apply(pool, {}).length, 2);
  assert.equal(Filter.apply(pool, { maxErrorPercent: 0.1 }).length, 1);
  assert.equal(Filter.apply(pool, { minEfficiency: 0.9 }).length, 1);
  assert.equal(Filter.apply(pool, { maxDiameter: 100 }).length, 1);
  assert.equal(Filter.apply(pool, { maxLength: 100 }).length, 1);
  assert.equal(Filter.apply(pool, { maxStages: 1 }).length, 0);
});

test('active SF/SH criteria exclude solutions without evaluated factors', () => {
  const noFactors = solution({ mechanical: [{ bending: null, contact: null }] });
  const pool = [solution(), noFactors];
  assert.equal(Filter.apply(pool, {}).length, 2);
  assert.equal(Filter.apply(pool, { minSF: 1.0 }).length, 1);
  assert.equal(Filter.apply(pool, { minSH: 1.0 }).length, 1);
  assert.equal(Filter.apply(pool, { minSF: 1.5 }).length, 0);
});

test('type chips exclude any solution containing a disabled type', () => {
  const mixed = solution({ stages: [{ type: 'worm' }, { type: 'spur' }] });
  const pure = solution();
  const view = Filter.apply([mixed, pure], { types: ['spur'] });
  assert.equal(view.length, 1);
  assert.equal(view[0].index, 1);
});

test('sorts are deterministic and preserve original pool indices', () => {
  const pool = [
    solution({ score: { value: 0.9 }, errorPercent: 0.3, efficiency: 0.9 }),
    solution({ score: { value: 0.1 }, errorPercent: 0.2, efficiency: 0.99 }),
    solution({ score: { value: 0.1 }, errorPercent: 0.1, efficiency: 0.92 })
  ];
  const byScore = Filter.apply(pool, { sort: 'score' });
  assert.deepEqual(byScore.map(v => v.index), [1, 2, 0]);
  const byError = Filter.apply(pool, { sort: 'error' });
  assert.deepEqual(byError.map(v => v.index), [2, 1, 0]);
  const byEff = Filter.apply(pool, { sort: 'efficiency' });
  assert.equal(byEff[0].index, 1);
});

test('sf sort ranks evaluated factors first, missing last', () => {
  const strong = solution();
  const missing = solution({ mechanical: [{ bending: null, contact: null }] });
  const weak = solution({ mechanical: [{ bending: { safetyFactor: 0.5 }, contact: { safetyFactor: 0.4 } }] });
  const view = Filter.apply([missing, weak, strong], { sort: 'sf' });
  assert.deepEqual(view.map(v => v.index), [2, 1, 0]);
});
