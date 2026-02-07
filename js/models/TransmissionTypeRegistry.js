// TransmissionTypeRegistry.js - Registre centralisé de tous les types de transmission
// Source de vérité pour les contraintes, formules et paramètres de chaque type

(function (GearApp) {

  // ==================== DÉFINITION DES TYPES ====================

  var TYPES = {

    // Engrenage droit (Spur Gear)
    spur: {
      id: 'spur',
      nom: 'Engrenage droit',
      nomCourt: 'Droit',
      description: 'Engrenage cylindrique à denture droite. Axes parallèles.',
      icone: '\u2699',
      couleur: '#d4e6f1',
      axesRelation: 'parallel',
      reversible: true,
      contraintes: {
        minA: 6, maxA: 200, minB: 6, maxB: 200,
        minRapportEtage: 0.2, maxRapportEtage: 8,
        reductionUniquement: false
      },
      labelA: 'Dents menante', labelB: 'Dents menée',
      uniteA: 'dents', uniteB: 'dents',
      calculerRapport: function (A, B) { return B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var mu = params.coeffFrottement || 0.05;
        var pertes = (Math.PI * mu * (1 / A + 1 / B)) / Math.cos(alpha);
        return Math.max(0.85, 1 - pertes);
      },
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var dpA = mod * A, dpB = mod * B;
        return {
          type: 'spur', entraxe: (dpA + dpB) / 2,
          diamPrimitiveA: dpA, diamPrimitiveB: dpB,
          diamTeteA: dpA + 2 * mod, diamTeteB: dpB + 2 * mod,
          diamPiedA: dpA - 2.5 * mod, diamPiedB: dpB - 2.5 * mod,
          diamBaseA: dpA * Math.cos(alpha), diamBaseB: dpB * Math.cos(alpha),
          pas: Math.PI * mod, angleContact: params.angleContact || 20
        };
      },
      sensRotation: function () { return -1; }
    },

    // Engrenage hélicoïdal (Helical Gear)
    helical: {
      id: 'helical',
      nom: 'Engrenage hélicoïdal',
      nomCourt: 'Hélicoïdal',
      description: 'Denture en hélice. Plus silencieux, supporte des charges plus élevées. Axes parallèles.',
      icone: '\u26F6',
      couleur: '#d5f5e3',
      axesRelation: 'parallel',
      reversible: true,
      contraintes: {
        minA: 8, maxA: 200, minB: 8, maxB: 200,
        minRapportEtage: 0.2, maxRapportEtage: 10,
        reductionUniquement: false
      },
      paramsSupplementaires: [
        { id: 'angleHelice', nom: 'Angle d\'hélice (°)', defaut: 20, min: 5, max: 45 }
      ],
      labelA: 'Dents menante', labelB: 'Dents menée',
      uniteA: 'dents', uniteB: 'dents',
      calculerRapport: function (A, B) { return B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var beta = (params.angleHelice || 20) * Math.PI / 180;
        var mu = params.coeffFrottement || 0.04;
        var alphaN = Math.atan(Math.tan(alpha) / Math.cos(beta));
        var pertes = (Math.PI * mu * (1 / A + 1 / B)) / (Math.cos(alphaN) * Math.cos(beta));
        return Math.max(0.88, 1 - pertes);
      },
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var beta = (params.angleHelice || 20) * Math.PI / 180;
        var modApparent = mod / Math.cos(beta);
        var dpA = modApparent * A, dpB = modApparent * B;
        return {
          type: 'helical', entraxe: (dpA + dpB) / 2,
          diamPrimitiveA: dpA, diamPrimitiveB: dpB,
          diamTeteA: dpA + 2 * mod, diamTeteB: dpB + 2 * mod,
          diamPiedA: dpA - 2.5 * mod, diamPiedB: dpB - 2.5 * mod,
          pas: Math.PI * mod, pasApparent: Math.PI * modApparent,
          angleHelice: params.angleHelice || 20,
          moduleNormal: mod, moduleApparent: modApparent
        };
      },
      sensRotation: function () { return -1; }
    },

    // Engrenage intérieur (Internal Gear)
    internal: {
      id: 'internal',
      nom: 'Engrenage intérieur',
      nomCourt: 'Intérieur',
      description: 'Pignon à l\'intérieur d\'une couronne. Même sens de rotation. Compact.',
      icone: '\u25CE',
      couleur: '#fdebd0',
      axesRelation: 'parallel',
      reversible: true,
      contraintes: {
        minA: 10, maxA: 80, minB: 20, maxB: 300,
        minRapportEtage: 1.5, maxRapportEtage: 12,
        reductionUniquement: true, differenceMinDents: 10
      },
      labelA: 'Dents pignon', labelB: 'Dents couronne',
      uniteA: 'dents', uniteB: 'dents',
      calculerRapport: function (A, B) { return B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var mu = params.coeffFrottement || 0.04;
        var pertes = (Math.PI * mu * (1 / A - 1 / B)) / Math.cos(alpha);
        return Math.max(0.92, 1 - Math.abs(pertes));
      },
      calculerGeometrie: function (A, B, mod) {
        var dpA = mod * A, dpB = mod * B;
        return {
          type: 'internal', entraxe: (dpB - dpA) / 2,
          diamPrimitiveA: dpA, diamPrimitiveB: dpB,
          diamTeteA: dpA + 2 * mod, diamTeteB: dpB - 2 * mod,
          diamPiedA: dpA - 2.5 * mod, diamPiedB: dpB + 2.5 * mod,
          pas: Math.PI * mod
        };
      },
      sensRotation: function () { return 1; }
    },

    // Engrenage conique (Bevel Gear)
    bevel: {
      id: 'bevel',
      nom: 'Engrenage conique',
      nomCourt: 'Conique',
      description: 'Axes à 90°. Permet le changement de direction de l\'axe de rotation.',
      icone: '\u25C7',
      couleur: '#e8daef',
      axesRelation: 'perpendicular',
      reversible: true,
      contraintes: {
        minA: 10, maxA: 80, minB: 10, maxB: 120,
        minRapportEtage: 0.2, maxRapportEtage: 6,
        reductionUniquement: false
      },
      paramsSupplementaires: [
        { id: 'angleCone', nom: 'Angle entre axes (°)', defaut: 90, min: 10, max: 170 }
      ],
      labelA: 'Dents pignon', labelB: 'Dents roue',
      uniteA: 'dents', uniteB: 'dents',
      calculerRapport: function (A, B) { return B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var mu = params.coeffFrottement || 0.06;
        var sigma = Math.atan(A / B);
        var pertes = Math.PI * mu * (1 / A + 1 / B) / Math.cos(sigma);
        return Math.max(0.85, 1 - pertes);
      },
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var sigma1 = Math.atan(A / B);
        var sigma2 = Math.PI / 2 - sigma1;
        var longueurCone = mod * A / (2 * Math.sin(sigma1));
        return {
          type: 'bevel', entraxe: null,
          longueurCone: longueurCone,
          angleCone1: sigma1 * 180 / Math.PI,
          angleCone2: sigma2 * 180 / Math.PI,
          diamPrimitiveA: mod * A, diamPrimitiveB: mod * B,
          diamTeteA: mod * A + 2 * mod * Math.cos(sigma1),
          diamTeteB: mod * B + 2 * mod * Math.cos(sigma2),
          pas: Math.PI * mod,
          angleAxes: params.angleCone || 90
        };
      },
      sensRotation: function () { return -1; }
    },

    // Courroie et poulie (Belt & Pulley)
    belt: {
      id: 'belt',
      nom: 'Courroie et poulie',
      nomCourt: 'Courroie',
      description: 'Transmission par courroie entre deux poulies. Axes parallèles.',
      icone: '\u27F3',
      couleur: '#fadbd8',
      axesRelation: 'parallel',
      reversible: true,
      contraintes: {
        minA: 10, maxA: 200, minB: 10, maxB: 500,
        minRapportEtage: 0.1, maxRapportEtage: 10,
        reductionUniquement: false
      },
      paramsSupplementaires: [
        { id: 'typeCourroie', nom: 'Type de courroie', defaut: 'V', options: ['Plate', 'V', 'Crantée', 'Ronde'] },
        { id: 'courroieCroisee', nom: 'Courroie croisée', defaut: false, type: 'bool' }
      ],
      labelA: 'Poulie menante', labelB: 'Poulie menée',
      uniteA: 'mm \u00d8', uniteB: 'mm \u00d8',
      calculerRapport: function (A, B) { return B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var typeRendements = { 'Plate': 0.95, 'V': 0.96, 'Crantée': 0.98, 'Ronde': 0.93 };
        return typeRendements[params.typeCourroie] || 0.95;
      },
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var entraxe = params.entraxeCourroie || (A + B) * 2;
        var longueurCourroie = 2 * entraxe + Math.PI * (A + B) / 2 + ((B - A) * (B - A)) / (4 * entraxe);
        var angleEnroulement = Math.PI - 2 * Math.asin(Math.abs(B - A) / (2 * entraxe));
        return {
          type: 'belt', entraxe: entraxe,
          longueurCourroie: longueurCourroie,
          angleEnroulementA: angleEnroulement * 180 / Math.PI,
          angleEnroulementB: (2 * Math.PI - angleEnroulement) * 180 / Math.PI,
          diamPrimitiveA: A, diamPrimitiveB: B,
          typeCourroie: params.typeCourroie || 'V'
        };
      },
      sensRotation: function (A, B, params) {
        params = params || {};
        return params.courroieCroisee ? -1 : 1;
      }
    },

    // Train épicycloïdal (Planetary Gear)
    epicyclic: {
      id: 'epicyclic',
      nom: 'Train épicycloïdal',
      nomCourt: 'Épicycloïdal',
      description: 'Train planétaire (solaire + satellites + couronne). Très haut rapport dans un volume compact.',
      icone: '\u2609',
      couleur: '#d6eaf8',
      axesRelation: 'coaxial',
      reversible: false,
      contraintes: {
        minA: 12, maxA: 60, minB: 30, maxB: 200,
        minRapportEtage: 2, maxRapportEtage: 12,
        reductionUniquement: true,
        compatibilite: function (A, B) {
          return (A + B) % 3 === 0;
        }
      },
      paramsSupplementaires: [
        { id: 'nbSatellites', nom: 'Nombre de satellites', defaut: 3, min: 2, max: 6 },
        { id: 'configEpicyclic', nom: 'Configuration', defaut: 'couronne_fixe',
          options: ['couronne_fixe', 'solaire_fixe', 'porte_satellites_fixe'] }
      ],
      labelA: 'Dents solaire', labelB: 'Dents couronne',
      uniteA: 'dents', uniteB: 'dents',
      calculerRapport: function (A, B) { return 1 + B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport - 1 }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var nbSatellites = params.nbSatellites || 3;
        return 0.97 - (nbSatellites - 3) * 0.005;
      },
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var nbSatellites = params.nbSatellites || 3;
        var dentsSatellite = (B - A) / 2;
        var dpA = mod * A, dpB = mod * B, dpSat = mod * dentsSatellite;
        return {
          type: 'epicyclic', entraxe: (dpA + dpSat) / 2,
          diamPrimitiveSolaire: dpA, diamPrimitiveCouronne: dpB,
          diamPrimitiveSatellite: dpSat, dentsSatellite: dentsSatellite,
          nbSatellites: nbSatellites, diamExterieur: dpB + 2 * mod,
          pas: Math.PI * mod,
          config: params.configEpicyclic || 'couronne_fixe'
        };
      },
      sensRotation: function (A, B, params) {
        params = params || {};
        var config = params.configEpicyclic || 'couronne_fixe';
        if (config === 'couronne_fixe') return 1;
        if (config === 'solaire_fixe') return 1;
        return -1;
      }
    },

    // Vis sans fin (Worm Gear)
    worm: {
      id: 'worm',
      nom: 'Vis sans fin',
      nomCourt: 'Vis sans fin',
      description: 'Très haut rapport en un seul étage. Irréversible pour les petits angles d\'avance. Axes à 90°.',
      icone: '\u2942',
      couleur: '#fcf3cf',
      axesRelation: 'perpendicular',
      reversible: false,
      contraintes: {
        minA: 1, maxA: 6, minB: 15, maxB: 120,
        minRapportEtage: 5, maxRapportEtage: 100,
        reductionUniquement: true
      },
      paramsSupplementaires: [
        { id: 'angleAvance', nom: 'Angle d\'avance (°)', defaut: null, computed: true },
        { id: 'nbFilets', nom: 'Nombre de filets', defaut: 1, min: 1, max: 6 }
      ],
      labelA: 'Filets vis', labelB: 'Dents roue',
      uniteA: 'filets', uniteB: 'dents',
      calculerRapport: function (A, B) { return B / A; },
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },
      calculerRendement: function (A, B, params) {
        params = params || {};
        var mod = params.module || 2;
        var q = 10; // quotient de diamètre standard (dw = q * m)
        var diamVis = q * mod;
        var angleAvance = Math.atan(A * mod / diamVis); // λ = atan(n·m / dw) = atan(A/q)
        var mu = params.coeffFrottement || 0.08;
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var phi = Math.atan(mu / Math.cos(alpha));
        var rendement = Math.tan(angleAvance) / Math.tan(angleAvance + phi);
        return Math.max(0.30, Math.min(0.95, rendement));
      },
      calculerGeometrie: function (A, B, mod) {
        var q = 10; // quotient de diamètre standard
        var diamVis = q * mod;
        var dpRoue = mod * B;
        var angleAvance = Math.atan(A * mod / diamVis);
        return {
          type: 'worm', entraxe: (diamVis + dpRoue) / 2,
          diamPrimitiveVis: diamVis, diamPrimitiveRoue: dpRoue,
          nbFilets: A, angleAvance: angleAvance * 180 / Math.PI,
          pas: Math.PI * mod, pasAxial: A * Math.PI * mod,
          longueurVis: dpRoue * 0.8,
          irreversible: angleAvance < (5 * Math.PI / 180)
        };
      },
      sensRotation: function () { return -1; }
    }
  };

  // ==================== CLASSE REGISTRY ====================

  function TransmissionTypeRegistry() {
    this._types = TYPES;
  }

  TransmissionTypeRegistry.prototype.get = function (typeId) {
    return this._types[typeId] || this._types.spur;
  };

  TransmissionTypeRegistry.prototype.list = function () {
    var result = [];
    for (var key in this._types) {
      if (this._types.hasOwnProperty(key)) {
        var t = this._types[key];
        result.push({ id: t.id, nom: t.nom, nomCourt: t.nomCourt, icone: t.icone, description: t.description });
      }
    }
    return result;
  };

  TransmissionTypeRegistry.prototype.calculerRapportEtage = function (typeId, A, B) {
    return this.get(typeId).calculerRapport(A, B);
  };

  TransmissionTypeRegistry.prototype.validerCombinaison = function (typeId, A, B) {
    var type = this.get(typeId);
    var c = type.contraintes;
    if (A < c.minA || A > c.maxA) return false;
    if (B < c.minB || B > c.maxB) return false;
    var rapport = type.calculerRapport(A, B);
    if (rapport < c.minRapportEtage || rapport > c.maxRapportEtage) return false;
    if (c.differenceMinDents && (B - A) < c.differenceMinDents) return false;
    if (c.compatibilite && !c.compatibilite(A, B)) return false;
    return true;
  };

  // Instance partagée
  var registry = new TransmissionTypeRegistry();
  GearApp.models.typeRegistry = registry;
  GearApp.models.TransmissionTypeRegistry = TransmissionTypeRegistry;

  // COMPAT : shims globaux pour code legacy et callers existants
  window.TransmissionTypes = TYPES;
  window.getTransmissionTypesList = function () { return registry.list(); };
  window.getTransmissionType = function (id) { return registry.get(id); };
  window.calculerRapportEtage = function (typeId, A, B) { return registry.calculerRapportEtage(typeId, A, B); };
  window.validerCombinaison = function (typeId, A, B) { return registry.validerCombinaison(typeId, A, B); };

})(GearApp);
