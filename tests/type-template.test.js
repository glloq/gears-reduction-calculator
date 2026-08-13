const test = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../js/core/SearchEngine.js');

function params(extra = {}) {
  return Object.assign({
    rapportCible: 30, dentMenanteMin: 10, dentMenanteMax: 14, dentMeneeMin: 28, dentMeneeMax: 40,
    precisionToleree: 5, maxEtages: 2, maxSolutions: 50, maxIterations: 200000,
    typesActifs: ['spur', 'worm'], typeParameters: { spur: { module: 1 }, worm: { module: 1, wormStartsMin: 1, wormStartsMax: 2 } },
    allowReductionOnly: true, module: 1, moduleMode: 'fixed', vitesseEntree: 1500, coupleEntree: 2
  }, extra);
}

test('every solution honors the per-depth type template', () => {
  const r = Search.search(params({ typeTemplate: [['worm'], ['spur']] }));
  assert.ok(r.solutions.length, JSON.stringify(r.stats));
  for (const s of r.solutions) {
    assert.equal(s.stages[0].type, 'worm');
    if (s.stages[1]) assert.equal(s.stages[1].type, 'spur');
  }
});

test('a null or empty slot leaves that depth free', () => {
  const r = Search.search(params({ typeTemplate: [null, ['spur']] }));
  assert.ok(r.solutions.length);
  const firstTypes = new Set(r.solutions.map(s => s.stages[0].type));
  assert.ok(firstTypes.size >= 1);
  for (const s of r.solutions) if (s.stages[1]) assert.equal(s.stages[1].type, 'spur');
});

test('epicyclic template slots match planetary stages', () => {
  const r = Search.search(params({
    rapportCible: 5, precisionToleree: 2, maxEtages: 1,
    typesActifs: ['epicyclic'], typeParameters: { planetary: { module: 1, planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R' } },
    dentMenanteMin: 12, dentMenanteMax: 24, dentMeneeMin: 40, dentMeneeMax: 60,
    typeTemplate: [['epicyclic']]
  }));
  assert.ok(r.solutions.length, JSON.stringify(r.stats));
  for (const s of r.solutions) assert.equal(s.stages[0].type, 'planetary');
});

test('template slots beyond the explored chain length do not suppress shorter solutions', () => {
  const r = Search.search(params({
    rapportCible: 3, precisionToleree: 1, maxEtages: 1, typesActifs: ['spur'],
    typeTemplate: [['spur'], ['worm'], ['worm'], ['worm']]
  }));
  assert.ok(r.solutions.length);
  for (const s of r.solutions) assert.equal(s.stages.length, 1);
});

test('template composes with the fixed first-stage teeth filter', () => {
  const r = Search.search(params({
    rapportCible: 9, precisionToleree: 1, maxEtages: 2, typesActifs: ['spur'],
    dentMenanteFixe: 12, typeTemplate: [['spur'], ['spur']]
  }));
  assert.ok(r.solutions.length);
  for (const s of r.solutions) {
    assert.equal(s.stages[0].type, 'spur');
    assert.equal(s.stages[0].input.teeth, 12);
  }
});

test('a template excluding every candidate type yields zero solutions', () => {
  const r = Search.search(params({ typesActifs: ['spur'], typeTemplate: [['worm']] }));
  assert.equal(r.solutions.length, 0);
});
