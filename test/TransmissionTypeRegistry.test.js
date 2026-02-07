/**
 * Tests unitaires pour TransmissionTypeRegistry
 * @see js/models/TransmissionTypeRegistry.js
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, loadModules, REGISTRY } = require('./helpers/context');

describe('TransmissionTypeRegistry', () => {
  let ctx, registry;

  before(() => {
    ctx = createContext();
    loadModules(ctx, REGISTRY);
    registry = ctx.GearApp.models.typeRegistry;
  });

  // ===== Structure du registre =====

  describe('structure', () => {
    it('contient exactement 7 types de transmission', () => {
      const types = registry.list();
      assert.equal(types.length, 7);
    });

    it('contient les 7 types attendus', () => {
      const ids = registry.list().map(t => t.id);
      const expected = ['spur', 'helical', 'internal', 'bevel', 'belt', 'epicyclic', 'worm'];
      for (const id of expected) {
        assert.ok(ids.includes(id), `Type "${id}" manquant`);
      }
    });

    it('chaque type a les propriétés requises', () => {
      const requiredProps = ['id', 'nom', 'nomCourt', 'icone', 'couleur', 'uniteA', 'uniteB'];
      for (const type of registry.list()) {
        const full = registry.get(type.id);
        for (const prop of requiredProps) {
          assert.ok(full[prop] !== undefined, `Type "${type.id}" manque la propriété "${prop}"`);
        }
      }
    });

    it('chaque type a les méthodes de calcul', () => {
      const requiredMethods = ['calculerRapport', 'calculerRendement', 'calculerGeometrie', 'sensRotation'];
      for (const type of registry.list()) {
        const full = registry.get(type.id);
        for (const method of requiredMethods) {
          assert.equal(typeof full[method], 'function',
            `Type "${type.id}" manque la méthode "${method}"`);
        }
      }
    });
  });

  // ===== Accès au registre =====

  describe('get()', () => {
    it('retourne le type spur', () => {
      const spur = registry.get('spur');
      assert.equal(spur.id, 'spur');
    });

    it('retourne spur par défaut si l\'ID est inconnu', () => {
      const fallback = registry.get('inexistant');
      assert.equal(fallback.id, 'spur');
    });
  });

  // ===== Calculs de rapport =====

  describe('rapport de transmission', () => {
    it('spur : rapport = B / A', () => {
      const spur = registry.get('spur');
      assert.equal(spur.calculerRapport(20, 40), 2);
      assert.equal(spur.calculerRapport(15, 45), 3);
    });

    it('helical : rapport = B / A', () => {
      const hel = registry.get('helical');
      assert.equal(hel.calculerRapport(20, 60), 3);
    });

    it('internal : rapport = B / A', () => {
      const internal = registry.get('internal');
      assert.equal(internal.calculerRapport(20, 60), 3);
    });

    it('bevel : rapport = B / A', () => {
      const bevel = registry.get('bevel');
      assert.equal(bevel.calculerRapport(20, 40), 2);
    });

    it('belt : rapport = B / A (diamètres)', () => {
      const belt = registry.get('belt');
      assert.equal(belt.calculerRapport(50, 150), 3);
    });

    it('epicyclic : rapport = 1 + B / A', () => {
      const epi = registry.get('epicyclic');
      // A=solaire, B=couronne → i = 1 + B/A
      assert.equal(epi.calculerRapport(20, 60), 4);
      assert.equal(epi.calculerRapport(10, 40), 5);
    });

    it('worm : rapport = B / A (dents roue / filets)', () => {
      const worm = registry.get('worm');
      assert.equal(worm.calculerRapport(1, 40), 40);
      assert.equal(worm.calculerRapport(2, 60), 30);
    });
  });

  // ===== Rendement =====

  describe('rendement', () => {
    it('le rendement est entre 0 et 1 pour tous les types', () => {
      const testCases = [
        { id: 'spur', A: 20, B: 40 },
        { id: 'helical', A: 20, B: 40 },
        { id: 'internal', A: 20, B: 60 },
        { id: 'bevel', A: 20, B: 40 },
        { id: 'belt', A: 50, B: 150 },
        { id: 'epicyclic', A: 20, B: 60 },
        { id: 'worm', A: 2, B: 40 }
      ];
      for (const tc of testCases) {
        const type = registry.get(tc.id);
        const eta = type.calculerRendement(tc.A, tc.B);
        assert.ok(eta > 0 && eta <= 1,
          `Rendement ${tc.id} = ${eta} devrait être entre 0 et 1`);
      }
    });

    it('worm a le rendement le plus faible', () => {
      const spurEta = registry.get('spur').calculerRendement(20, 40);
      const wormEta = registry.get('worm').calculerRendement(1, 40);
      assert.ok(wormEta < spurEta, 'Vis sans fin devrait être moins efficace que droit');
    });
  });

  // ===== Sens de rotation =====

  describe('sensRotation()', () => {
    it('spur : inversion du sens (-1)', () => {
      const spur = registry.get('spur');
      assert.equal(spur.sensRotation(), -1);
    });

    it('internal : même sens (+1)', () => {
      const internal = registry.get('internal');
      assert.equal(internal.sensRotation(), 1);
    });

    it('belt : même sens (+1)', () => {
      const belt = registry.get('belt');
      assert.equal(belt.sensRotation(), 1);
    });
  });

  // ===== Validation des combinaisons =====

  describe('validerCombinaison()', () => {
    it('accepte une combinaison spur valide', () => {
      assert.equal(registry.validerCombinaison('spur', 20, 40), true);
    });

    it('rejette des dents négatives', () => {
      assert.equal(registry.validerCombinaison('spur', -5, 40), false);
    });

    it('rejette zéro dents', () => {
      assert.equal(registry.validerCombinaison('spur', 0, 40), false);
    });

    it('epicyclic : contrainte (A + B) % 3 === 0 pour 3 satellites', () => {
      // (A + B) doit être divisible par 3 pour placer 3 satellites régulièrement
      const valid = registry.validerCombinaison('epicyclic', 20, 58);   // 20+58=78, %3=0 ✓
      const invalid = registry.validerCombinaison('epicyclic', 20, 59); // 20+59=79, %3≠0 ✗
      assert.equal(valid, true);
      assert.equal(invalid, false);
    });
  });

  // ===== Ponts globaux (backward compatibility) =====

  describe('ponts window.*', () => {
    it('window.getTransmissionType() fonctionne', () => {
      const spur = ctx.window.getTransmissionType('spur');
      assert.equal(spur.id, 'spur');
    });

    it('window.getTransmissionTypesList() retourne 7 types', () => {
      const list = ctx.window.getTransmissionTypesList();
      assert.equal(list.length, 7);
    });

    it('window.calculerRapportEtage() calcule le rapport', () => {
      const ratio = ctx.window.calculerRapportEtage('spur', 20, 40);
      assert.equal(ratio, 2);
    });
  });
});
