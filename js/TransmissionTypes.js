// TransmissionTypes.js - Registre de tous les types de transmission
// Chaque type définit : calcul du rapport, rendement, géométrie, contraintes, label SVG

const TransmissionTypes = {

  // ==================== ENGRENAGE DROIT (Spur Gear) ====================
  spur: {
    id: 'spur',
    nom: 'Engrenage droit',
    nomCourt: 'Droit',
    description: 'Engrenage cylindrique à denture droite. Axes parallèles.',
    icone: '\u2699',
    couleur: '#d4e6f1',
    axesRelation: 'parallel',   // parallel, perpendicular, offset
    reversible: true,

    // A = menante (dents), B = menée (dents)
    calculerRapport(A, B) { return B / A; },
    calculerRapportInverse(rapport) { return { A: 1, B: rapport }; },

    // Contraintes sur A et B
    contraintes: {
      minA: 6, maxA: 200,
      minB: 6, maxB: 200,
      minRapportEtage: 0.2, maxRapportEtage: 8,
      reductionUniquement: false  // B > A pour réduction, B < A pour multiplication
    },

    labelA: 'Dents menante',
    labelB: 'Dents menée',
    uniteA: 'dents',
    uniteB: 'dents',

    calculerRendement(A, B, params = {}) {
      const alpha = (params.angleContact || 20) * Math.PI / 180;
      const mu = params.coeffFrottement || 0.05;
      const pertes = (Math.PI * mu * (1 / A + 1 / B)) / Math.cos(alpha);
      return Math.max(0.85, 1 - pertes);
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const alpha = (params.angleContact || 20) * Math.PI / 180;
      const dpA = mod * A;
      const dpB = mod * B;
      return {
        type: 'spur',
        entraxe: (dpA + dpB) / 2,
        diamPrimitiveA: dpA,
        diamPrimitiveB: dpB,
        diamTeteA: dpA + 2 * mod,
        diamTeteB: dpB + 2 * mod,
        diamPiedA: dpA - 2.5 * mod,
        diamPiedB: dpB - 2.5 * mod,
        diamBaseA: dpA * Math.cos(alpha),
        diamBaseB: dpB * Math.cos(alpha),
        pas: Math.PI * mod,
        angleContact: params.angleContact || 20
      };
    },

    // Sens de rotation sortie par rapport à entrée
    sensRotation(A, B) { return -1; } // Inverse
  },

  // ==================== ENGRENAGE HÉLICOÏDAL (Helical Gear) ====================
  helical: {
    id: 'helical',
    nom: 'Engrenage hélicoïdal',
    nomCourt: 'Hélicoïdal',
    description: 'Denture en hélice. Plus silencieux, supporte des charges plus élevées. Axes parallèles.',
    icone: '\u26F6',
    couleur: '#d5f5e3',
    axesRelation: 'parallel',
    reversible: true,

    calculerRapport(A, B) { return B / A; },
    calculerRapportInverse(rapport) { return { A: 1, B: rapport }; },

    contraintes: {
      minA: 8, maxA: 200,
      minB: 8, maxB: 200,
      minRapportEtage: 0.2, maxRapportEtage: 10,
      reductionUniquement: false
    },

    // Paramètre supplémentaire : angle d'hélice (beta)
    paramsSupplementaires: [
      { id: 'angleHelice', nom: 'Angle d\'hélice (\u00b0)', defaut: 20, min: 5, max: 45 }
    ],

    labelA: 'Dents menante',
    labelB: 'Dents menée',
    uniteA: 'dents',
    uniteB: 'dents',

    calculerRendement(A, B, params = {}) {
      const alpha = (params.angleContact || 20) * Math.PI / 180;
      const beta = (params.angleHelice || 20) * Math.PI / 180;
      const mu = params.coeffFrottement || 0.04; // Légèrement meilleur que droit
      const alphaN = Math.atan(Math.tan(alpha) / Math.cos(beta));
      const pertes = (Math.PI * mu * (1 / A + 1 / B)) / (Math.cos(alphaN) * Math.cos(beta));
      return Math.max(0.88, 1 - pertes);
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const beta = (params.angleHelice || 20) * Math.PI / 180;
      const modNormal = mod;
      const modApparent = mod / Math.cos(beta);
      const dpA = modApparent * A;
      const dpB = modApparent * B;
      return {
        type: 'helical',
        entraxe: (dpA + dpB) / 2,
        diamPrimitiveA: dpA,
        diamPrimitiveB: dpB,
        diamTeteA: dpA + 2 * modNormal,
        diamTeteB: dpB + 2 * modNormal,
        diamPiedA: dpA - 2.5 * modNormal,
        diamPiedB: dpB - 2.5 * modNormal,
        pas: Math.PI * modNormal,
        pasApparent: Math.PI * modApparent,
        angleHelice: params.angleHelice || 20,
        moduleNormal: modNormal,
        moduleApparent: modApparent
      };
    },

    sensRotation(A, B) { return -1; }
  },

  // ==================== ENGRENAGE INTÉRIEUR (Internal Gear) ====================
  internal: {
    id: 'internal',
    nom: 'Engrenage intérieur',
    nomCourt: 'Intérieur',
    description: 'Pignon à l\'intérieur d\'une couronne. Même sens de rotation. Compact.',
    icone: '\u25CE',
    couleur: '#fdebd0',
    axesRelation: 'parallel',
    reversible: true,

    // B = couronne (dents intérieures), A = pignon
    // Rapport = B / A, mais B doit être > A
    calculerRapport(A, B) { return B / A; },
    calculerRapportInverse(rapport) { return { A: 1, B: rapport }; },

    contraintes: {
      minA: 10, maxA: 80,
      minB: 20, maxB: 300,
      minRapportEtage: 1.5, maxRapportEtage: 12,
      reductionUniquement: true,
      // Contrainte spéciale : différence de dents min pour éviter interférence
      differenceMinDents: 10
    },

    labelA: 'Dents pignon',
    labelB: 'Dents couronne',
    uniteA: 'dents',
    uniteB: 'dents',

    calculerRendement(A, B, params = {}) {
      const alpha = (params.angleContact || 20) * Math.PI / 180;
      const mu = params.coeffFrottement || 0.04;
      // Engrenage intérieur a un meilleur rendement (glissement réduit)
      const pertes = (Math.PI * mu * (1 / A - 1 / B)) / Math.cos(alpha);
      return Math.max(0.92, 1 - Math.abs(pertes));
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const dpA = mod * A;
      const dpB = mod * B;
      return {
        type: 'internal',
        // Entraxe = (B - A) / 2 * mod pour engrenage intérieur
        entraxe: (dpB - dpA) / 2,
        diamPrimitiveA: dpA,
        diamPrimitiveB: dpB,
        diamTeteA: dpA + 2 * mod,
        diamTeteB: dpB - 2 * mod, // Inversé pour couronne
        diamPiedA: dpA - 2.5 * mod,
        diamPiedB: dpB + 2.5 * mod, // Inversé pour couronne
        pas: Math.PI * mod
      };
    },

    // L'engrenage intérieur conserve le sens de rotation
    sensRotation(A, B) { return 1; }
  },

  // ==================== ENGRENAGE CONIQUE (Bevel Gear) ====================
  bevel: {
    id: 'bevel',
    nom: 'Engrenage conique',
    nomCourt: 'Conique',
    description: 'Axes à 90\u00b0. Permet le changement de direction de l\'axe de rotation.',
    icone: '\u25C7',
    couleur: '#e8daef',
    axesRelation: 'perpendicular',
    reversible: true,

    calculerRapport(A, B) { return B / A; },
    calculerRapportInverse(rapport) { return { A: 1, B: rapport }; },

    contraintes: {
      minA: 10, maxA: 80,
      minB: 10, maxB: 120,
      minRapportEtage: 0.2, maxRapportEtage: 6,
      reductionUniquement: false
    },

    paramsSupplementaires: [
      { id: 'angleCone', nom: 'Angle entre axes (\u00b0)', defaut: 90, min: 10, max: 170 }
    ],

    labelA: 'Dents pignon',
    labelB: 'Dents roue',
    uniteA: 'dents',
    uniteB: 'dents',

    calculerRendement(A, B, params = {}) {
      const mu = params.coeffFrottement || 0.06; // Légèrement plus de friction
      const sigma = Math.atan(A / B); // Angle du cône primitif
      const pertes = Math.PI * mu * (1 / A + 1 / B) / Math.cos(sigma);
      return Math.max(0.85, 1 - pertes);
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const sigma1 = Math.atan(A / B); // Demi-angle du cône pignon
      const sigma2 = Math.PI / 2 - sigma1; // Demi-angle du cône roue
      const longueurCone = mod * A / (2 * Math.sin(sigma1));
      return {
        type: 'bevel',
        entraxe: null, // Pas applicable directement
        longueurCone: longueurCone,
        angleCone1: sigma1 * 180 / Math.PI,
        angleCone2: sigma2 * 180 / Math.PI,
        diamPrimitiveA: mod * A,
        diamPrimitiveB: mod * B,
        diamTeteA: mod * A + 2 * mod * Math.cos(sigma1),
        diamTeteB: mod * B + 2 * mod * Math.cos(sigma2),
        pas: Math.PI * mod,
        angleAxes: params.angleCone || 90
      };
    },

    sensRotation(A, B) { return -1; } // Dépend de l'orientation
  },

  // ==================== COURROIE ET POULIE (Belt & Pulley) ====================
  belt: {
    id: 'belt',
    nom: 'Courroie et poulie',
    nomCourt: 'Courroie',
    description: 'Transmission par courroie entre deux poulies. Axes parallèles, même sens (croisée) ou inverse.',
    icone: '\u27F3',
    couleur: '#fadbd8',
    axesRelation: 'parallel',
    reversible: true,

    // A = diamètre poulie menante (mm), B = diamètre poulie menée (mm)
    // Rapport = B / A (en diamètres ou nombre de dents pour courroie crantée)
    calculerRapport(A, B) { return B / A; },
    calculerRapportInverse(rapport) { return { A: 1, B: rapport }; },

    contraintes: {
      minA: 10, maxA: 200,
      minB: 10, maxB: 500,
      minRapportEtage: 0.1, maxRapportEtage: 10,
      reductionUniquement: false
    },

    paramsSupplementaires: [
      { id: 'typeCourroie', nom: 'Type de courroie', defaut: 'V', options: ['Plate', 'V', 'Crantée', 'Ronde'] },
      { id: 'courroieCroisee', nom: 'Courroie croisée', defaut: false, type: 'bool' }
    ],

    labelA: 'Poulie menante',
    labelB: 'Poulie menée',
    uniteA: 'mm \u00d8',
    uniteB: 'mm \u00d8',

    calculerRendement(A, B, params = {}) {
      // Rendement typique des courroies
      const typeRendements = {
        'Plate': 0.95,
        'V': 0.96,
        'Crantée': 0.98,
        'Ronde': 0.93
      };
      return typeRendements[params.typeCourroie] || 0.95;
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const entraxe = (params.entraxeCourroie || (A + B) * 2); // Estimation entraxe
      const longueurCourroie = 2 * entraxe + Math.PI * (A + B) / 2 + ((B - A) ** 2) / (4 * entraxe);
      const angleEnroulement = Math.PI - 2 * Math.asin(Math.abs(B - A) / (2 * entraxe));
      return {
        type: 'belt',
        entraxe: entraxe,
        longueurCourroie: longueurCourroie,
        angleEnroulementA: angleEnroulement * 180 / Math.PI,
        angleEnroulementB: (2 * Math.PI - angleEnroulement) * 180 / Math.PI,
        diamPrimitiveA: A,
        diamPrimitiveB: B,
        typeCourroie: params.typeCourroie || 'V'
      };
    },

    // Même sens pour courroie droite, inversé pour courroie croisée
    sensRotation(A, B, params = {}) {
      return params.courroieCroisee ? -1 : 1;
    }
  },

  // ==================== ENGRENAGE ÉPICYCLOÏDAL (Planetary Gear) ====================
  epicyclic: {
    id: 'epicyclic',
    nom: 'Train épicycloïdal',
    nomCourt: 'Épicycloïdal',
    description: 'Train planétaire (solaire + satellites + couronne). Très haut rapport dans un volume compact.',
    icone: '\u2609',
    couleur: '#d6eaf8',
    axesRelation: 'coaxial',
    reversible: false,

    // A = dents solaire, B = dents couronne
    // Le rapport dépend de la configuration (porte-satellites fixe, couronne fixe, etc.)
    // Config standard : couronne fixe -> rapport = 1 + B/A
    calculerRapport(A, B) { return 1 + B / A; },
    calculerRapportInverse(rapport) {
      // rapport = 1 + B/A => B/A = rapport - 1
      return { A: 1, B: rapport - 1 };
    },

    contraintes: {
      minA: 12, maxA: 60,
      minB: 30, maxB: 200,
      minRapportEtage: 2, maxRapportEtage: 12,
      reductionUniquement: true,
      // Contrainte : B = A + 2 * satellites (B et A doivent être compatibles)
      compatibilite: function(A, B) {
        // La couronne = solaire + 2 * satellite, et (A + B) doit être divisible par nb satellites
        const nbSatellites = 3; // Typiquement 3 ou 4
        return (A + B) % nbSatellites === 0;
      }
    },

    paramsSupplementaires: [
      { id: 'nbSatellites', nom: 'Nombre de satellites', defaut: 3, min: 2, max: 6 },
      { id: 'configEpicyclic', nom: 'Configuration', defaut: 'couronne_fixe',
        options: ['couronne_fixe', 'solaire_fixe', 'porte_satellites_fixe'] }
    ],

    labelA: 'Dents solaire',
    labelB: 'Dents couronne',
    uniteA: 'dents',
    uniteB: 'dents',

    calculerRendement(A, B, params = {}) {
      const nbSatellites = params.nbSatellites || 3;
      // Rendement élevé des trains planétaires
      const rendementBase = 0.97;
      // Légère perte par satellite supplémentaire
      return rendementBase - (nbSatellites - 3) * 0.005;
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const nbSatellites = params.nbSatellites || 3;
      const dentsSatellite = (B - A) / 2;
      const dpA = mod * A;
      const dpB = mod * B;
      const dpSat = mod * dentsSatellite;
      return {
        type: 'epicyclic',
        entraxe: (dpA + dpSat) / 2, // Distance solaire-satellite
        diamPrimitiveSolaire: dpA,
        diamPrimitiveCouronne: dpB,
        diamPrimitiveSatellite: dpSat,
        dentsSatellite: dentsSatellite,
        nbSatellites: nbSatellites,
        diamExterieur: dpB + 2 * mod,
        pas: Math.PI * mod,
        config: params.configEpicyclic || 'couronne_fixe'
      };
    },

    sensRotation(A, B, params = {}) {
      const config = params.configEpicyclic || 'couronne_fixe';
      if (config === 'couronne_fixe') return 1;  // Même sens
      if (config === 'solaire_fixe') return 1;   // Même sens
      return -1;
    }
  },

  // ==================== VIS SANS FIN (Worm Gear) ====================
  worm: {
    id: 'worm',
    nom: 'Vis sans fin',
    nomCourt: 'Vis sans fin',
    description: 'Très haut rapport en un seul étage. Irréversible pour les petits angles d\'avance. Axes à 90\u00b0.',
    icone: '\u2942',
    couleur: '#fcf3cf',
    axesRelation: 'perpendicular',
    reversible: false, // Irréversible si angle d'avance < ~5°

    // A = nombre de filets de la vis, B = dents de la roue
    calculerRapport(A, B) { return B / A; },
    calculerRapportInverse(rapport) { return { A: 1, B: rapport }; },

    contraintes: {
      minA: 1, maxA: 6,      // 1 à 6 filets
      minB: 15, maxB: 120,
      minRapportEtage: 5, maxRapportEtage: 100,
      reductionUniquement: true
    },

    paramsSupplementaires: [
      { id: 'angleAvance', nom: 'Angle d\'avance (\u00b0)', defaut: null, computed: true },
      { id: 'nbFilets', nom: 'Nombre de filets', defaut: 1, min: 1, max: 6 }
    ],

    labelA: 'Filets vis',
    labelB: 'Dents roue',
    uniteA: 'filets',
    uniteB: 'dents',

    calculerRendement(A, B, params = {}) {
      const mod = params.module || 2;
      const diamVis = mod * A * 3; // Approximation diamètre primitif de la vis
      const angleAvance = Math.atan(A * mod / (Math.PI * diamVis));
      const mu = params.coeffFrottement || 0.08; // Frottement élevé vis sans fin
      const alpha = (params.angleContact || 20) * Math.PI / 180;
      const phi = Math.atan(mu / Math.cos(alpha)); // Angle de frottement

      // Rendement = tan(lambda) / tan(lambda + phi)
      const rendement = Math.tan(angleAvance) / Math.tan(angleAvance + phi);
      return Math.max(0.30, Math.min(0.95, rendement));
    },

    calculerGeometrie(A, B, mod, params = {}) {
      const diamVis = mod * A * 3; // Diamètre primitif vis (approximation)
      const dpRoue = mod * B;
      const entraxe = (diamVis + dpRoue) / 2;
      const angleAvance = Math.atan(A * mod * Math.PI / (Math.PI * diamVis));

      return {
        type: 'worm',
        entraxe: entraxe,
        diamPrimitiveVis: diamVis,
        diamPrimitiveRoue: dpRoue,
        nbFilets: A,
        angleAvance: angleAvance * 180 / Math.PI,
        pas: Math.PI * mod,
        pasAxial: A * Math.PI * mod,
        longueurVis: dpRoue * 0.8, // Approximation
        irreversible: angleAvance < (5 * Math.PI / 180)
      };
    },

    sensRotation(A, B) { return -1; } // Dépend de l'hélice
  }
};

// ==================== FONCTIONS UTILITAIRES ====================

/**
 * Retourne la liste des types disponibles.
 */
function getTransmissionTypesList() {
  return Object.values(TransmissionTypes).map(t => ({
    id: t.id,
    nom: t.nom,
    nomCourt: t.nomCourt,
    icone: t.icone,
    description: t.description
  }));
}

/**
 * Retourne un type par son ID.
 */
function getTransmissionType(typeId) {
  return TransmissionTypes[typeId] || TransmissionTypes.spur;
}

/**
 * Calcule le rapport d'un étage selon son type.
 */
function calculerRapportEtage(typeId, A, B) {
  const type = getTransmissionType(typeId);
  return type.calculerRapport(A, B);
}

/**
 * Vérifie si une combinaison A/B est valide pour un type donné.
 */
function validerCombinaison(typeId, A, B) {
  const type = getTransmissionType(typeId);
  const c = type.contraintes;

  if (A < c.minA || A > c.maxA) return false;
  if (B < c.minB || B > c.maxB) return false;

  const rapport = type.calculerRapport(A, B);
  if (rapport < c.minRapportEtage || rapport > c.maxRapportEtage) return false;

  if (c.differenceMinDents && (B - A) < c.differenceMinDents) return false;

  if (c.compatibilite && !c.compatibilite(A, B)) return false;

  return true;
}

window.TransmissionTypes = TransmissionTypes;
window.getTransmissionTypesList = getTransmissionTypesList;
window.getTransmissionType = getTransmissionType;
window.calculerRapportEtage = calculerRapportEtage;
window.validerCombinaison = validerCombinaison;
