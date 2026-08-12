const test = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../js/core/SearchEngine.js');

test('default Standard interface search returns at least one solution', () => {
  const result = Search.search({
    rapportCible: 12,
    dentMenanteMin: 10,
    dentMenanteMax: 30,
    dentMeneeMin: 20,
    dentMeneeMax: 50,
    precisionToleree: 0.1,
    maxEtages: 4,
    maxSolutions: 10,
    maxIterations: 500000,
    dentMenanteFixe: null,
    dentMeneeFixe: null,
    allowReductionOnly: true,
    typesActifs: ['spur'],
    typeParameters: { spur: { module: 1 } },
    searchMode: 'minimumStages',
    module: 1,
    moduleMode: 'fixed',
    vitesseEntree: 1500,
    coupleEntree: 10,
    constraints: {},
    manufacturing: { mode: 'standard' }
  });

  assert.ok(result.solutions.length > 0, `expected default UI search to find solutions; stats=${JSON.stringify(result.stats)}`);
  assert.ok(result.solutions.some(solution => Math.abs(solution.ratio - 12) / 12 * 100 <= 0.1));
});
