/**
 * Tests unitaires pour GearMechanics (calculs d'ingénierie)
 * @see js/core/GearMechanics.js
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, loadModules, CORE } = require('./helpers/context');

describe('GearMechanics', () => {
  let ctx, Mech;

  before(() => {
    ctx = createContext();
    loadModules(ctx, CORE);
    Mech = ctx.GearApp.core.GearMechanics;
  });

  // ===== Rapport de conduite =====

  describe('calculerRapportConduite()', () => {
    it('retourne un rapport > 1 pour des engrenages standards', () => {
      const cr = Mech.calculerRapportConduite(20, 40, 20);
      assert.ok(cr > 1, `Rapport de conduite ${cr} devrait être > 1`);
    });

    it('retourne environ 1.6 pour Za=20, Zb=40, alpha=20°', () => {
      const cr = Mech.calculerRapportConduite(20, 40, 20);
      assert.ok(cr > 1.5 && cr < 1.8, `Rapport ${cr} devrait être entre 1.5 et 1.8`);
    });

    it('augmente avec le nombre de dents', () => {
      const cr1 = Mech.calculerRapportConduite(15, 15, 20);
      const cr2 = Mech.calculerRapportConduite(30, 30, 20);
      assert.ok(cr2 > cr1, 'Plus de dents → rapport de conduite plus élevé');
    });

    it('diminue avec l\'angle de pression', () => {
      const cr20 = Mech.calculerRapportConduite(20, 40, 20);
      const cr25 = Mech.calculerRapportConduite(20, 40, 25);
      assert.ok(cr20 > cr25, 'Angle de pression plus élevé → rapport de conduite plus faible');
    });
  });

  // ===== Vitesse périphérique =====

  describe('calculerVitessePeripherique()', () => {
    it('calcule correctement la vitesse (v = π·d·n / 60000)', () => {
      // Z=20, m=2, n=1500 → d=40mm → v = π × 40 × 1500 / 60000 ≈ 3.14 m/s
      const v = Mech.calculerVitessePeripherique(20, 2, 1500);
      assert.ok(Math.abs(v - Math.PI * 40 * 1500 / 60000) < 0.01,
        `Vitesse ${v} devrait être ≈ 3.14 m/s`);
    });

    it('est proportionnelle au nombre de dents', () => {
      const v1 = Mech.calculerVitessePeripherique(20, 2, 1500);
      const v2 = Mech.calculerVitessePeripherique(40, 2, 1500);
      assert.ok(Math.abs(v2 / v1 - 2) < 0.01, 'Double les dents → double la vitesse');
    });

    it('est proportionnelle au module', () => {
      const v1 = Mech.calculerVitessePeripherique(20, 1, 1500);
      const v2 = Mech.calculerVitessePeripherique(20, 2, 1500);
      assert.ok(Math.abs(v2 / v1 - 2) < 0.01, 'Double le module → double la vitesse');
    });
  });

  // ===== Résistance Lewis =====

  describe('calculerResistanceLewis()', () => {
    it('retourne un objet avec les propriétés attendues', () => {
      const result = Mech.calculerResistanceLewis(20, 2, 20, 10, 250);
      assert.ok(result.hasOwnProperty('facteurLewis'));
      assert.ok(result.hasOwnProperty('forceTangentielle'));
      assert.ok(result.hasOwnProperty('contrainteFlexion'));
      assert.ok(result.hasOwnProperty('facteurSecurite'));
      assert.ok(result.hasOwnProperty('estValide'));
    });

    it('donne un facteur de sécurité > 1 pour des conditions normales', () => {
      // Z=30, m=3, b=30, T=20 N.m, sigma_e=250 MPa
      const result = Mech.calculerResistanceLewis(30, 3, 30, 20, 250);
      assert.ok(result.facteurSecurite > 1,
        `Facteur de sécurité ${result.facteurSecurite} devrait être > 1`);
    });

    it('le facteur de sécurité diminue avec le couple', () => {
      const r1 = Mech.calculerResistanceLewis(20, 2, 20, 10, 250);
      const r2 = Mech.calculerResistanceLewis(20, 2, 20, 100, 250);
      assert.ok(r2.facteurSecurite < r1.facteurSecurite,
        'Plus de couple → facteur de sécurité plus faible');
    });

    it('le facteur Lewis augmente avec le nombre de dents', () => {
      const r1 = Mech.calculerResistanceLewis(12, 2, 20, 10, 250);
      const r2 = Mech.calculerResistanceLewis(30, 2, 20, 10, 250);
      assert.ok(r2.facteurLewis > r1.facteurLewis,
        'Plus de dents → facteur Lewis plus élevé');
    });
  });

  // ===== Interférence =====

  describe('verifierInterference()', () => {
    it('retourne un objet avec les propriétés attendues', () => {
      const result = Mech.verifierInterference(20, 40, 20);
      assert.ok(result.hasOwnProperty('interfere'));
      assert.ok(result.hasOwnProperty('nbDentsMinimal'));
    });

    it('pas d\'interférence pour Z=20/40 à 20°', () => {
      const result = Mech.verifierInterference(20, 40, 20);
      assert.equal(result.interfere, false);
    });

    it('interférence possible pour très peu de dents', () => {
      const result = Mech.verifierInterference(6, 10, 20);
      assert.equal(result.interfere, true);
    });

    it('le nombre minimal de dents est environ 17 pour alpha=20°', () => {
      const result = Mech.verifierInterference(20, 40, 20);
      assert.ok(result.nbDentsMinimal >= 13 && result.nbDentsMinimal <= 20,
        `Nb dents minimal ${result.nbDentsMinimal} devrait être entre 13 et 20`);
    });
  });

  // ===== Jeu de denture =====

  describe('calculerJeuDenture()', () => {
    it('retourne un objet avec jeu et qualité ISO', () => {
      const result = Mech.calculerJeuDenture(2, 7);
      assert.ok(result.hasOwnProperty('jeu'));
      assert.ok(result.hasOwnProperty('qualiteISO'));
    });

    it('le jeu augmente avec le module', () => {
      const j1 = Mech.calculerJeuDenture(1, 7);
      const j2 = Mech.calculerJeuDenture(3, 7);
      assert.ok(j2.jeu > j1.jeu, 'Plus grand module → jeu plus important');
    });

    it('le jeu augmente avec la qualité ISO (moins précis)', () => {
      const j5 = Mech.calculerJeuDenture(2, 5);
      const j10 = Mech.calculerJeuDenture(2, 10);
      assert.ok(j10.jeu > j5.jeu, 'Qualité ISO plus élevée → jeu plus important');
    });

    it('utilise la qualité ISO 7 par défaut', () => {
      const result = Mech.calculerJeuDenture(2);
      assert.equal(result.qualiteISO, 7);
    });
  });

  // ===== Contrainte Hertz =====

  describe('calculerContrainteHertz()', () => {
    it('retourne un objet avec les propriétés attendues', () => {
      const result = Mech.calculerContrainteHertz(20, 40, 2, 20, 10);
      assert.ok(result.hasOwnProperty('contrainteHertz'));
      assert.ok(result.hasOwnProperty('facteurSecuriteContact'));
      assert.ok(result.hasOwnProperty('estValide'));
    });

    it('la contrainte augmente avec le couple', () => {
      const r1 = Mech.calculerContrainteHertz(20, 40, 2, 20, 10);
      const r2 = Mech.calculerContrainteHertz(20, 40, 2, 20, 100);
      assert.ok(r2.contrainteHertz > r1.contrainteHertz);
    });

    it('la contrainte diminue avec la largeur de dent', () => {
      const r1 = Mech.calculerContrainteHertz(20, 40, 2, 10, 10);
      const r2 = Mech.calculerContrainteHertz(20, 40, 2, 30, 10);
      assert.ok(r2.contrainteHertz < r1.contrainteHertz);
    });
  });

  // ===== Analyse complète du train =====

  describe('analyserTrainEngrenages()', () => {
    it('analyse un train simple à 1 étage', () => {
      const result = Mech.analyserTrainEngrenages([[20, 40, 'spur']], {
        module: 2, vitesseEntree: 1500, coupleEntree: 10
      });
      assert.ok(result.rapportTotal > 0);
      assert.ok(result.rendementTotal > 0 && result.rendementTotal <= 1);
      assert.ok(Array.isArray(result.etages));
      assert.equal(result.etages.length, 1);
    });

    it('le rapport total est le produit des rapports d\'étage', () => {
      const result = Mech.analyserTrainEngrenages(
        [[20, 40, 'spur'], [15, 45, 'spur']],
        { module: 2, vitesseEntree: 1500, coupleEntree: 10 }
      );
      // Rapport étage 1 = 40/20 = 2, étage 2 = 45/15 = 3, total = 6
      assert.ok(Math.abs(result.rapportTotal - 6) < 0.01);
    });

    it('la vitesse de sortie = vitesse entrée / rapport total', () => {
      const result = Mech.analyserTrainEngrenages([[20, 60, 'spur']], {
        module: 2, vitesseEntree: 1500, coupleEntree: 10
      });
      // Rapport = 3, vitesse sortie = 1500 / 3 = 500
      assert.ok(Math.abs(result.vitesseSortie - 500) < 1);
    });
  });
});
