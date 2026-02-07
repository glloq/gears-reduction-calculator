/**
 * Tests unitaires pour SearchParams
 * @see js/models/SearchParams.js
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, loadModules, CONFIG } = require('./helpers/context');

describe('SearchParams', () => {
  let ctx, SearchParams;

  before(() => {
    ctx = createContext();
    loadModules(ctx, [...CONFIG, 'js/models/SearchParams.js']);
    SearchParams = ctx.GearApp.models.SearchParams;
  });

  // ===== Constructeur et valeurs par défaut =====

  describe('constructeur', () => {
    it('crée une instance avec les valeurs par défaut', () => {
      const params = new SearchParams();
      assert.equal(params.rapportCible, 12);
      assert.equal(params.precision, 0.1);
      assert.equal(params.maxEtages, 4);
      assert.equal(params.maxSolutions, 10);
      assert.equal(params.maxIterations, 500000);
      assert.equal(params.reductionOnly, true);
    });

    it('les plages de dents par défaut sont correctes', () => {
      const params = new SearchParams();
      assert.equal(params.dentMenanteMin, 10);
      assert.equal(params.dentMenanteMax, 30);
      assert.equal(params.dentMeneeMin, 20);
      assert.equal(params.dentMeneeMax, 50);
    });

    it('le type actif par défaut est spur', () => {
      const params = new SearchParams();
      assert.ok(Array.isArray(params.typesActifs));
      assert.equal(params.typesActifs.length, 1);
      assert.equal(params.typesActifs[0], 'spur');
    });

    it('les paramètres mécaniques par défaut', () => {
      const params = new SearchParams();
      assert.equal(params.vitesseEntree, 1500);
      assert.equal(params.coupleEntree, 10);
      assert.equal(params.module, null);
    });
  });

  // ===== Validation =====

  describe('validate()', () => {
    it('valide des paramètres corrects', () => {
      const params = new SearchParams();
      const result = params.validate();
      assert.equal(result.valid, true);
    });

    it('rejette un rapport cible nul', () => {
      const params = new SearchParams();
      params.rapportCible = 0;
      const result = params.validate();
      assert.equal(result.valid, false);
      assert.ok(result.message.length > 0);
    });

    it('rejette un rapport cible négatif', () => {
      const params = new SearchParams();
      params.rapportCible = -5;
      const result = params.validate();
      assert.equal(result.valid, false);
    });

    it('rejette si menante min > menante max', () => {
      const params = new SearchParams();
      params.dentMenanteMin = 50;
      params.dentMenanteMax = 10;
      const result = params.validate();
      assert.equal(result.valid, false);
    });

    it('rejette si menée min > menée max', () => {
      const params = new SearchParams();
      params.dentMeneeMin = 80;
      params.dentMeneeMax = 20;
      const result = params.validate();
      assert.equal(result.valid, false);
    });

    it('accepte une précision de 0', () => {
      const params = new SearchParams();
      params.precision = 0;
      const result = params.validate();
      assert.equal(result.valid, true);
    });

    it('accepte plusieurs types actifs', () => {
      const params = new SearchParams();
      params.typesActifs = ['spur', 'helical', 'worm'];
      const result = params.validate();
      assert.equal(result.valid, true);
    });
  });

  // ===== Conversion vers Worker =====

  describe('toWorkerParams()', () => {
    it('retourne un objet avec les champs requis par le worker', () => {
      const params = new SearchParams();
      const wp = params.toWorkerParams();
      assert.ok(wp.hasOwnProperty('rapportCible'));
      assert.ok(wp.hasOwnProperty('dentMenanteMin'));
      assert.ok(wp.hasOwnProperty('dentMenanteMax'));
      assert.ok(wp.hasOwnProperty('dentMeneeMin'));
      assert.ok(wp.hasOwnProperty('dentMeneeMax'));
      assert.ok(wp.hasOwnProperty('maxEtages'));
      assert.ok(wp.hasOwnProperty('maxSolutions'));
      assert.ok(wp.hasOwnProperty('maxIterations'));
      assert.ok(wp.hasOwnProperty('typesActifs'));
    });

    it('precisionToleree correspond à la valeur brute de precision', () => {
      const params = new SearchParams();
      params.precision = 1.5;
      const wp = params.toWorkerParams();
      assert.ok(wp.hasOwnProperty('precisionToleree'));
      assert.equal(wp.precisionToleree, 1.5);
    });

    it('les types actifs sont correctement transmis', () => {
      const params = new SearchParams();
      params.typesActifs = ['spur', 'worm'];
      const wp = params.toWorkerParams();
      assert.equal(wp.typesActifs.length, 2);
      assert.equal(wp.typesActifs[0], 'spur');
      assert.equal(wp.typesActifs[1], 'worm');
    });

    it('les dents fixes sont transmises (ou null)', () => {
      const params = new SearchParams();
      params.dentMenanteFixe = 25;
      params.dentMeneeFixe = null;
      const wp = params.toWorkerParams();
      assert.equal(wp.dentMenanteFixe, 25);
      assert.equal(wp.dentMeneeFixe, null);
    });
  });
});
