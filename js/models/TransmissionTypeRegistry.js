/**
 * @module TransmissionTypeRegistry
 * @description Registre centralisé de tous les types de transmission.
 *   Source de vérité unique pour les contraintes, formules et paramètres
 *   de chaque type d'engrenage ou de transmission mécanique.
 *
 *   Types supportés :
 *   - spur       : Engrenage droit (cylindrique, denture droite, axes parallèles)
 *   - helical    : Engrenage hélicoïdal (denture en hélice, axes parallèles)
 *   - internal   : Engrenage intérieur (pignon + couronne, axes parallèles)
 *   - bevel      : Engrenage conique (axes à 90°)
 *   - belt       : Courroie et poulie (axes parallèles, transmission souple)
 *   - epicyclic  : Train épicycloïdal / planétaire (coaxial, haut rapport)
 *   - worm       : Vis sans fin (axes à 90°, très haut rapport, irréversible)
 *
 * @see GearApp.models.typeRegistry  Instance partagée (singleton)
 * @see GearApp.models.TransmissionTypeRegistry  Constructeur exporté
 */

(function (GearApp) {

  // ==================== DÉFINITION DE TYPE (JSDoc) ====================

  /**
   * @typedef {Object} ContraintesType
   * @property {number}   minA                - Valeur minimale du paramètre A (dents ou diamètre)
   * @property {number}   maxA                - Valeur maximale du paramètre A
   * @property {number}   minB                - Valeur minimale du paramètre B
   * @property {number}   maxB                - Valeur maximale du paramètre B
   * @property {number}   minRapportEtage     - Rapport de transmission minimal autorisé pour un étage
   * @property {number}   maxRapportEtage     - Rapport de transmission maximal autorisé pour un étage
   * @property {boolean}  reductionUniquement - Si true, seule la réduction (rapport > 1) est possible
   * @property {number}   [differenceMinDents] - Écart minimal requis entre B et A (ex. engrenage intérieur)
   * @property {function} [compatibilite]     - Fonction (A, B) => boolean de validation supplémentaire
   */

  /**
   * @typedef {Object} ParamSupplementaire
   * @property {string}   id      - Identifiant unique du paramètre
   * @property {string}   nom     - Libellé affiché (en français)
   * @property {*}        defaut  - Valeur par défaut
   * @property {number}   [min]   - Valeur minimale (pour les champs numériques)
   * @property {number}   [max]   - Valeur maximale (pour les champs numériques)
   * @property {string[]} [options] - Liste de choix (pour les champs select)
   * @property {string}   [type]  - Type spécial ('bool' pour case à cocher)
   * @property {boolean}  [computed] - Si true, la valeur est calculée et non saisie
   */

  /**
   * @typedef {Object} GeometrieResult
   * @property {string}  type     - Identifiant du type de transmission
   * @property {?number} entraxe  - Distance entre axes (null si non applicable, ex. conique)
   * @description Objet contenant les données géométriques calculées.
   *   Les propriétés supplémentaires varient selon le type de transmission
   *   (diamètres primitifs, de tête, de pied, angles, longueurs, etc.).
   */

  /**
   * @typedef {Object} TransmissionType
   * @property {string}   id          - Identifiant unique (ex. 'spur', 'worm')
   * @property {string}   nom         - Nom complet en français
   * @property {string}   nomCourt    - Nom abrégé pour l'affichage compact
   * @property {string}   description - Description technique du type
   * @property {string}   icone       - Caractère Unicode servant d'icône
   * @property {string}   couleur     - Couleur CSS associée (code hexadécimal)
   * @property {string}   axesRelation - Relation entre axes ('parallel'|'perpendicular'|'coaxial')
   * @property {boolean}  reversible  - Si true, la transmission est réversible
   * @property {ContraintesType} contraintes - Contraintes de validité (bornes, rapport, compatibilité)
   * @property {ParamSupplementaire[]} [paramsSupplementaires] - Paramètres additionnels spécifiques au type
   * @property {string}   labelA      - Libellé pour le paramètre A (ex. 'Dents menante')
   * @property {string}   labelB      - Libellé pour le paramètre B (ex. 'Dents menée')
   * @property {string}   uniteA      - Unité du paramètre A (ex. 'dents', 'mm ø')
   * @property {string}   uniteB      - Unité du paramètre B
   * @property {function(number, number): number} calculerRapport
   *   Calcule le rapport de transmission : rapport = f(A, B)
   * @property {function(number): {A: number, B: number}} calculerRapportInverse
   *   Retourne un couple {A, B} normalisé (A=1) pour un rapport donné
   * @property {function(number, number, Object=): number} calculerRendement
   *   Calcule le rendement mécanique (0..1) de l'engrenage
   * @property {function(number, number, number, Object=): GeometrieResult} calculerGeometrie
   *   Calcule toutes les données géométriques (diamètres, entraxe, pas, etc.)
   * @property {function(number=, number=, Object=): number} sensRotation
   *   Retourne le sens de rotation relatif : +1 (même sens) ou -1 (inversé)
   */

  // ==================== DÉFINITION DES TYPES DE TRANSMISSION ====================

  /**
   * Dictionnaire statique des 7 types de transmission supportés.
   * Chaque entrée est un objet conforme à {@link TransmissionType}.
   *
   * @type {Object.<string, TransmissionType>}
   * @private
   */
  var TYPES = {

    // ===== Engrenage droit (Spur Gear) =====
    // Type le plus courant : cylindrique à denture droite, axes parallèles.
    // Rapport = B / A (nombre de dents menée / menante).
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

      /**
       * Rapport de transmission = dents menée / dents menante.
       * @param {number} A - Nombre de dents de la roue menante
       * @param {number} B - Nombre de dents de la roue menée
       * @returns {number} Rapport B/A
       */
      calculerRapport: function (A, B) { return B / A; },

      /**
       * Couple (A, B) normalisé pour un rapport donné. A est fixé à 1.
       * @param {number} rapport - Rapport de transmission souhaité
       * @returns {{A: number, B: number}}
       */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },

      /**
       * Rendement mécanique d'un engrenage droit.
       * Formule : pertes = π · μ · (1/A + 1/B) / cos(α)
       *   où α = angle de contact (pression), μ = coefficient de frottement.
       * Le rendement est borné à un minimum de 0.85 (85 %).
       *
       * @param {number} A - Nombre de dents menante
       * @param {number} B - Nombre de dents menée
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.angleContact=20] - Angle de pression en degrés
       * @param {number} [params.coeffFrottement=0.05] - Coefficient de frottement μ
       * @returns {number} Rendement entre 0.85 et 1
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        // Conversion de l'angle de contact (pression) de degrés en radians
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var mu = params.coeffFrottement || 0.05;
        // Pertes par frottement selon la formule empirique des engrenages droits
        // Plus A et B sont grands, plus les pertes sont faibles (engrenages de grand diamètre)
        var pertes = (Math.PI * mu * (1 / A + 1 / B)) / Math.cos(alpha);
        // Plancher à 85 % pour éviter des valeurs irréalistes
        return Math.max(0.85, 1 - pertes);
      },

      /**
       * Géométrie complète d'un engrenage droit.
       * Calcule diamètres primitifs, de tête, de pied, de base, entraxe et pas.
       *
       * Formules clés :
       *   - Diamètre primitif : dp = module × nombre de dents
       *   - Diamètre de tête  : da = dp + 2·m (saillie = 1 module)
       *   - Diamètre de pied  : df = dp - 2.5·m (creux = 1.25 module)
       *   - Diamètre de base  : db = dp · cos(α)
       *   - Entraxe            : e = (dpA + dpB) / 2
       *   - Pas                : p = π · m
       *
       * @param {number} A - Nombre de dents menante
       * @param {number} B - Nombre de dents menée
       * @param {number} mod - Module métrique (mm)
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.angleContact=20] - Angle de pression en degrés
       * @returns {GeometrieResult} Données géométriques complètes
       */
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

      /**
       * Sens de rotation relatif. -1 = inversé (standard pour engrenage externe).
       * @returns {number} -1
       */
      sensRotation: function () { return -1; }
    },

    // ===== Engrenage hélicoïdal (Helical Gear) =====
    // Denture en hélice : fonctionnement plus progressif et silencieux.
    // Le module apparent (transversal) diffère du module normal à cause de l'angle d'hélice β.
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

      /**
       * Rapport de transmission = B / A (identique à l'engrenage droit).
       * @param {number} A - Nombre de dents menante
       * @param {number} B - Nombre de dents menée
       * @returns {number} Rapport B/A
       */
      calculerRapport: function (A, B) { return B / A; },

      /**
       * @param {number} rapport - Rapport souhaité
       * @returns {{A: number, B: number}}
       */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },

      /**
       * Rendement d'un engrenage hélicoïdal.
       * Tient compte de l'angle d'hélice β et de l'angle de pression normal αn.
       *
       * Formules :
       *   - αn = atan(tan(α) / cos(β))   (angle de pression dans le plan normal)
       *   - pertes = π · μ · (1/A + 1/B) / (cos(αn) · cos(β))
       *
       * Le rendement est supérieur à l'engrenage droit pour les mêmes dimensions
       * grâce au contact progressif, avec un plancher à 88 %.
       *
       * @param {number} A - Nombre de dents menante
       * @param {number} B - Nombre de dents menée
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.angleContact=20] - Angle de pression en degrés
       * @param {number} [params.angleHelice=20] - Angle d'hélice en degrés
       * @param {number} [params.coeffFrottement=0.04] - Coefficient de frottement μ
       * @returns {number} Rendement entre 0.88 et 1
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        // Angle de pression (plan frontal) en radians
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        // Angle d'hélice en radians
        var beta = (params.angleHelice || 20) * Math.PI / 180;
        var mu = params.coeffFrottement || 0.04;
        // Angle de pression dans le plan normal : αn = atan(tan(α) / cos(β))
        var alphaN = Math.atan(Math.tan(alpha) / Math.cos(beta));
        // Les pertes sont divisées par cos(αn)·cos(β) car l'effort se répartit
        // sur une surface de contact hélicoïdale plus grande
        var pertes = (Math.PI * mu * (1 / A + 1 / B)) / (Math.cos(alphaN) * Math.cos(beta));
        return Math.max(0.88, 1 - pertes);
      },

      /**
       * Géométrie d'un engrenage hélicoïdal.
       * Le module apparent (transversal) est plus grand que le module normal :
       *   m_t = m_n / cos(β)
       * Les diamètres primitifs utilisent le module apparent.
       *
       * @param {number} A - Nombre de dents menante
       * @param {number} B - Nombre de dents menée
       * @param {number} mod - Module normal (mm)
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.angleHelice=20] - Angle d'hélice en degrés
       * @returns {GeometrieResult} Données géométriques complètes
       */
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var beta = (params.angleHelice || 20) * Math.PI / 180;
        // Module apparent (transversal) : m_t = m_n / cos(β)
        var modApparent = mod / Math.cos(beta);
        // Les diamètres primitifs sont calculés avec le module apparent
        var dpA = modApparent * A, dpB = modApparent * B;
        return {
          type: 'helical', entraxe: (dpA + dpB) / 2,
          diamPrimitiveA: dpA, diamPrimitiveB: dpB,
          // Saillie et creux utilisent le module normal (standard ISO)
          diamTeteA: dpA + 2 * mod, diamTeteB: dpB + 2 * mod,
          diamPiedA: dpA - 2.5 * mod, diamPiedB: dpB - 2.5 * mod,
          pas: Math.PI * mod, pasApparent: Math.PI * modApparent,
          angleHelice: params.angleHelice || 20,
          moduleNormal: mod, moduleApparent: modApparent
        };
      },

      /**
       * Sens de rotation relatif. -1 = inversé (engrenage externe).
       * @returns {number} -1
       */
      sensRotation: function () { return -1; }
    },

    // ===== Engrenage intérieur (Internal Gear) =====
    // Un pignon tourne à l'intérieur d'une couronne dentée.
    // Avantages : sens de rotation conservé, conception compacte.
    // Contrainte : B doit être > A d'au moins 10 dents.
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

      /**
       * Rapport = dents couronne / dents pignon.
       * @param {number} A - Dents du pignon (intérieur)
       * @param {number} B - Dents de la couronne (extérieur)
       * @returns {number} Rapport B/A
       */
      calculerRapport: function (A, B) { return B / A; },

      /** @param {number} rapport @returns {{A: number, B: number}} */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },

      /**
       * Rendement d'un engrenage intérieur.
       * Formule similaire à l'engrenage droit mais avec (1/A - 1/B) au lieu de (1/A + 1/B)
       * car le contact interne génère moins de glissement relatif.
       * Rendement typiquement meilleur, plancher à 92 %.
       *
       * @param {number} A - Dents du pignon
       * @param {number} B - Dents de la couronne
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.angleContact=20] - Angle de pression en degrés
       * @param {number} [params.coeffFrottement=0.04] - Coefficient de frottement μ
       * @returns {number} Rendement entre 0.92 et 1
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        var mu = params.coeffFrottement || 0.04;
        // (1/A - 1/B) : la différence plutôt que la somme car les dents
        // s'engrènent dans le même sens, réduisant le glissement
        var pertes = (Math.PI * mu * (1 / A - 1 / B)) / Math.cos(alpha);
        return Math.max(0.92, 1 - Math.abs(pertes));
      },

      /**
       * Géométrie d'un engrenage intérieur.
       * Différence principale : l'entraxe = (dpB - dpA) / 2 (différence et non somme).
       * Les diamètres de tête et de pied sont inversés pour la couronne.
       *
       * @param {number} A - Dents du pignon
       * @param {number} B - Dents de la couronne
       * @param {number} mod - Module métrique (mm)
       * @returns {GeometrieResult} Données géométriques
       */
      calculerGeometrie: function (A, B, mod) {
        var dpA = mod * A, dpB = mod * B;
        return {
          type: 'internal', entraxe: (dpB - dpA) / 2,
          diamPrimitiveA: dpA, diamPrimitiveB: dpB,
          // Pignon (externe) : tête = dp + 2m, pied = dp - 2.5m (standard)
          diamTeteA: dpA + 2 * mod, diamTeteB: dpB - 2 * mod,
          // Couronne (interne) : tête = dp - 2m, pied = dp + 2.5m (inversé)
          diamPiedA: dpA - 2.5 * mod, diamPiedB: dpB + 2.5 * mod,
          pas: Math.PI * mod
        };
      },

      /**
       * Sens de rotation conservé (+1) car engrenage intérieur.
       * @returns {number} +1
       */
      sensRotation: function () { return 1; }
    },

    // ===== Engrenage conique (Bevel Gear) =====
    // Permet la transmission entre deux axes formant un angle (typiquement 90°).
    // Les dents sont taillées sur des cônes primitifs.
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

      /**
       * Rapport = dents roue / dents pignon.
       * @param {number} A - Dents du pignon conique
       * @param {number} B - Dents de la roue conique
       * @returns {number} Rapport B/A
       */
      calculerRapport: function (A, B) { return B / A; },

      /** @param {number} rapport @returns {{A: number, B: number}} */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },

      /**
       * Rendement d'un engrenage conique.
       * Formule : pertes = π · μ · (1/A + 1/B) / cos(σ)
       *   où σ = demi-angle du cône primitif du pignon = atan(A/B).
       * Le cos(σ) au dénominateur modélise l'effet de l'inclinaison conique
       * sur le glissement des dents. Plancher à 85 %.
       *
       * @param {number} A - Dents du pignon
       * @param {number} B - Dents de la roue
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.coeffFrottement=0.06] - Coefficient de frottement μ (plus élevé que droit)
       * @returns {number} Rendement entre 0.85 et 1
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        var mu = params.coeffFrottement || 0.06;
        // σ = demi-angle du cône primitif du pignon (pour axes à 90° : σ1 + σ2 = π/2)
        var sigma = Math.atan(A / B);
        var pertes = Math.PI * mu * (1 / A + 1 / B) / Math.cos(sigma);
        return Math.max(0.85, 1 - pertes);
      },

      /**
       * Géométrie d'un engrenage conique.
       * Les deux cônes primitifs se partagent l'angle total entre axes (90° par défaut).
       *   - σ1 = atan(A/B) : demi-angle du cône du pignon
       *   - σ2 = π/2 - σ1  : demi-angle du cône de la roue
       *   - Longueur de cône = m·A / (2·sin(σ1))
       *   - Diamètre de tête = dp + 2·m·cos(σ) (correction conique)
       *
       * Pas d'entraxe au sens classique (les cônes se touchent à leur sommet commun).
       *
       * @param {number} A - Dents du pignon
       * @param {number} B - Dents de la roue
       * @param {number} mod - Module métrique (mm)
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.angleCone=90] - Angle entre les axes en degrés
       * @returns {GeometrieResult} Données géométriques coniques
       */
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        // Demi-angle du cône primitif du pignon
        var sigma1 = Math.atan(A / B);
        // Demi-angle du cône de la roue (complémentaire pour 90°)
        var sigma2 = Math.PI / 2 - sigma1;
        // Longueur génératrice du cône primitif
        var longueurCone = mod * A / (2 * Math.sin(sigma1));
        return {
          type: 'bevel', entraxe: null,
          longueurCone: longueurCone,
          angleCone1: sigma1 * 180 / Math.PI,
          angleCone2: sigma2 * 180 / Math.PI,
          diamPrimitiveA: mod * A, diamPrimitiveB: mod * B,
          // Correction conique : saillie projetée = m·cos(σ)
          diamTeteA: mod * A + 2 * mod * Math.cos(sigma1),
          diamTeteB: mod * B + 2 * mod * Math.cos(sigma2),
          pas: Math.PI * mod,
          angleAxes: params.angleCone || 90
        };
      },

      /**
       * Sens inversé (-1) car engrenage externe conique.
       * @returns {number} -1
       */
      sensRotation: function () { return -1; }
    },

    // ===== Courroie et poulie (Belt & Pulley) =====
    // Transmission souple par courroie entre deux poulies.
    // Types de courroie : Plate, V, Crantée, Ronde (rendement variable).
    // Option courroie croisée pour inverser le sens de rotation.
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

      /**
       * Rapport = diamètre menée / diamètre menante.
       * @param {number} A - Diamètre de la poulie menante (mm)
       * @param {number} B - Diamètre de la poulie menée (mm)
       * @returns {number} Rapport B/A
       */
      calculerRapport: function (A, B) { return B / A; },

      /** @param {number} rapport @returns {{A: number, B: number}} */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },

      /**
       * Rendement d'une transmission par courroie.
       * Valeur fixe selon le type de courroie (pas de formule dynamique) :
       *   - Plate   : 95 %
       *   - V       : 96 %
       *   - Crantée : 98 % (la plus efficace, pas de glissement)
       *   - Ronde   : 93 %
       *
       * @param {number} A - Diamètre poulie menante (mm)
       * @param {number} B - Diamètre poulie menée (mm)
       * @param {Object} [params] - Paramètres optionnels
       * @param {string} [params.typeCourroie='V'] - Type de courroie
       * @returns {number} Rendement fixe selon le type
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        // Table de rendement par type de courroie
        var typeRendements = { 'Plate': 0.95, 'V': 0.96, 'Crantée': 0.98, 'Ronde': 0.93 };
        return typeRendements[params.typeCourroie] || 0.95;
      },

      /**
       * Géométrie d'une transmission par courroie.
       *
       * Formules :
       *   - Longueur de courroie (formule approchée) :
       *       L = 2·E + π·(A+B)/2 + (B-A)² / (4·E)
       *     où E = entraxe entre les poulies.
       *   - Angle d'enroulement sur la petite poulie :
       *       θ = π - 2·arcsin(|B-A| / (2·E))
       *     Plus l'écart de diamètre est grand, plus θ diminue (risque de glissement).
       *
       * @param {number} A - Diamètre poulie menante (mm)
       * @param {number} B - Diamètre poulie menée (mm)
       * @param {number} mod - Non utilisé pour les courroies (ignoré)
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.entraxeCourroie] - Entraxe imposé (sinon défaut = 2·(A+B))
       * @param {string} [params.typeCourroie='V'] - Type de courroie
       * @returns {GeometrieResult} Données géométriques de la transmission
       */
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        // Entraxe par défaut : 2 fois la somme des diamètres (règle empirique)
        var entraxe = params.entraxeCourroie || (A + B) * 2;
        // Longueur de courroie (formule approchée pour courroie ouverte)
        var longueurCourroie = 2 * entraxe + Math.PI * (A + B) / 2 + ((B - A) * (B - A)) / (4 * entraxe);
        // Angle d'enroulement sur la plus petite poulie (en radians)
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

      /**
       * Sens de rotation :
       *   - Courroie normale (+1) : même sens
       *   - Courroie croisée (-1) : sens inversé
       *
       * @param {number} A - Diamètre poulie menante (non utilisé)
       * @param {number} B - Diamètre poulie menée (non utilisé)
       * @param {Object} [params] - Paramètres optionnels
       * @param {boolean} [params.courroieCroisee=false] - Courroie croisée ?
       * @returns {number} +1 ou -1
       */
      sensRotation: function (A, B, params) {
        params = params || {};
        return params.courroieCroisee ? -1 : 1;
      }
    },

    // ===== Train épicycloïdal (Planetary Gear) =====
    // Système planétaire : solaire (central) + satellites (planètes) + couronne (anneau).
    // Rapport très élevé dans un volume réduit grâce à la configuration coaxiale.
    // Contrainte de compatibilité : (A + B) doit être divisible par 3
    // (pour un espacement régulier de 3 satellites par défaut).
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
        /**
         * Vérifie la compatibilité géométrique : (A + B) % 3 === 0
         * pour permettre un espacement régulier des satellites.
         * @param {number} A - Dents du solaire
         * @param {number} B - Dents de la couronne
         * @returns {boolean} true si compatible
         */
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

      /**
       * Rapport de transmission en configuration couronne fixe.
       * Formule de Willis : rapport = 1 + B/A
       *   (rapport toujours > 1, d'où réduction uniquement).
       *
       * @param {number} A - Dents du solaire
       * @param {number} B - Dents de la couronne
       * @returns {number} Rapport 1 + B/A
       */
      calculerRapport: function (A, B) { return 1 + B / A; },

      /**
       * Couple normalisé inverse. Comme rapport = 1 + B/A, on a B = rapport - 1 pour A=1.
       * @param {number} rapport - Rapport souhaité
       * @returns {{A: number, B: number}}
       */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport - 1 }; },

      /**
       * Rendement d'un train épicycloïdal.
       * Modèle simplifié : rendement de base 97 % pour 3 satellites,
       * diminuant de 0.5 % par satellite supplémentaire (frottement accru).
       *
       * @param {number} A - Dents du solaire
       * @param {number} B - Dents de la couronne
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.nbSatellites=3] - Nombre de satellites
       * @returns {number} Rendement (ex. 0.97 pour 3 satellites)
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        var nbSatellites = params.nbSatellites || 3;
        // 97 % de base, -0.5 % par satellite au-delà de 3
        return 0.97 - (nbSatellites - 3) * 0.005;
      },

      /**
       * Géométrie d'un train épicycloïdal.
       *
       * Formules clés :
       *   - Dents satellite = (B - A) / 2  (le satellite comble l'espace)
       *   - Entraxe = (dpSolaire + dpSatellite) / 2
       *   - Diamètre extérieur = dpCouronne + 2·m
       *
       * @param {number} A - Dents du solaire
       * @param {number} B - Dents de la couronne
       * @param {number} mod - Module métrique (mm)
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.nbSatellites=3] - Nombre de satellites
       * @param {string} [params.configEpicyclic='couronne_fixe'] - Configuration du train
       * @returns {GeometrieResult} Données géométriques du train planétaire
       */
      calculerGeometrie: function (A, B, mod, params) {
        params = params || {};
        var nbSatellites = params.nbSatellites || 3;
        // Le satellite a un nombre de dents qui comble exactement l'espace
        // entre le solaire et la couronne : Z_sat = (Z_couronne - Z_solaire) / 2
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

      /**
       * Sens de rotation selon la configuration :
       *   - couronne_fixe           : même sens (+1)
       *   - solaire_fixe            : même sens (+1)
       *   - porte_satellites_fixe   : inversé (-1)
       *
       * @param {number} A - Dents du solaire (non utilisé)
       * @param {number} B - Dents de la couronne (non utilisé)
       * @param {Object} [params] - Paramètres optionnels
       * @param {string} [params.configEpicyclic='couronne_fixe'] - Configuration
       * @returns {number} +1 ou -1
       */
      sensRotation: function (A, B, params) {
        params = params || {};
        var config = params.configEpicyclic || 'couronne_fixe';
        if (config === 'couronne_fixe') return 1;
        if (config === 'solaire_fixe') return 1;
        return -1;
      }
    },

    // ===== Vis sans fin (Worm Gear) =====
    // Très haut rapport en un seul étage (5:1 à 100:1).
    // A = nombre de filets de la vis (souvent 1 à 6), B = dents de la roue.
    // Irréversibilité naturelle pour les petits angles d'avance (< 5°).
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

      /**
       * Rapport = dents roue / filets vis.
       * Avec 1 filet et 60 dents : rapport = 60 (très élevé).
       * @param {number} A - Nombre de filets de la vis
       * @param {number} B - Nombre de dents de la roue
       * @returns {number} Rapport B/A
       */
      calculerRapport: function (A, B) { return B / A; },

      /** @param {number} rapport @returns {{A: number, B: number}} */
      calculerRapportInverse: function (rapport) { return { A: 1, B: rapport }; },

      /**
       * Rendement d'une vis sans fin.
       * Le rendement dépend fortement de l'angle d'avance λ et du frottement.
       *
       * Formules :
       *   - q = 10 (quotient de diamètre standard : d_vis = q · m)
       *   - λ = atan(A · m / d_vis) = atan(A / q)  (angle d'avance)
       *   - φ = atan(μ / cos(α))  (angle de frottement apparent)
       *   - η = tan(λ) / tan(λ + φ)  (rendement mécanique)
       *
       * Un petit angle d'avance (peu de filets) donne un rendement faible
       * mais assure l'irréversibilité. Borné entre 30 % et 95 %.
       *
       * @param {number} A - Nombre de filets de la vis
       * @param {number} B - Nombre de dents de la roue
       * @param {Object} [params] - Paramètres optionnels
       * @param {number} [params.module=2] - Module métrique (mm)
       * @param {number} [params.coeffFrottement=0.08] - Coefficient de frottement μ (élevé pour bronze/acier)
       * @param {number} [params.angleContact=20] - Angle de pression en degrés
       * @returns {number} Rendement entre 0.30 et 0.95
       */
      calculerRendement: function (A, B, params) {
        params = params || {};
        var mod = params.module || 2;
        var q = 10; // quotient de diamètre standard (dw = q * m)
        var diamVis = q * mod;
        // λ = angle d'avance de la vis : atan(n·m / dw) = atan(A/q)
        // Plus A (filets) est grand, plus λ est grand, meilleur est le rendement
        var angleAvance = Math.atan(A * mod / diamVis);
        var mu = params.coeffFrottement || 0.08;
        var alpha = (params.angleContact || 20) * Math.PI / 180;
        // φ = angle de frottement apparent dans le plan normal
        var phi = Math.atan(mu / Math.cos(alpha));
        // Formule classique du rendement vis sans fin :
        // η = tan(λ) / tan(λ + φ)
        var rendement = Math.tan(angleAvance) / Math.tan(angleAvance + phi);
        // Borné entre 30 % (vis à 1 filet, fort frottement) et 95 %
        return Math.max(0.30, Math.min(0.95, rendement));
      },

      /**
       * Géométrie d'une vis sans fin.
       *
       * Formules :
       *   - q = 10 : quotient de diamètre standard
       *   - d_vis = q · m (diamètre primitif de la vis)
       *   - d_roue = m · B (diamètre primitif de la roue)
       *   - λ = atan(A · m / d_vis) (angle d'avance)
       *   - Entraxe = (d_vis + d_roue) / 2
       *   - Pas axial = A · π · m (avance par tour de vis)
       *   - Longueur vis ≈ 0.8 · d_roue (règle empirique)
       *   - Irréversible si λ < 5°
       *
       * @param {number} A - Nombre de filets de la vis
       * @param {number} B - Nombre de dents de la roue
       * @param {number} mod - Module métrique (mm)
       * @returns {GeometrieResult} Données géométriques de la vis sans fin
       */
      calculerGeometrie: function (A, B, mod) {
        var q = 10; // quotient de diamètre standard
        var diamVis = q * mod;
        var dpRoue = mod * B;
        // Angle d'avance λ
        var angleAvance = Math.atan(A * mod / diamVis);
        return {
          type: 'worm', entraxe: (diamVis + dpRoue) / 2,
          diamPrimitiveVis: diamVis, diamPrimitiveRoue: dpRoue,
          nbFilets: A, angleAvance: angleAvance * 180 / Math.PI,
          pas: Math.PI * mod, pasAxial: A * Math.PI * mod,
          // Longueur de vis empirique : ~80 % du diamètre de la roue
          longueurVis: dpRoue * 0.8,
          // Irréversible si l'angle d'avance est inférieur à 5°
          irreversible: angleAvance < (5 * Math.PI / 180)
        };
      },

      /**
       * Sens inversé (-1) car vis sans fin = transmission à axes perpendiculaires.
       * @returns {number} -1
       */
      sensRotation: function () { return -1; }
    }
  };

  // ==================== CLASSE REGISTRY ====================

  /**
   * Registre centralisé des types de transmission.
   * Fournit un accès uniforme aux définitions de types, au calcul de rapport
   * et à la validation des combinaisons (A, B).
   *
   * Une instance partagée (singleton) est créée et exposée via
   * {@link GearApp.models.typeRegistry}.
   *
   * @constructor
   */
  function TransmissionTypeRegistry() {
    /**
     * Dictionnaire interne des types de transmission.
     * @type {Object.<string, TransmissionType>}
     * @private
     */
    this._types = TYPES;
  }

  /**
   * Récupère un type de transmission par son identifiant.
   * Retourne le type 'spur' (engrenage droit) par défaut si l'identifiant
   * n'est pas trouvé (comportement de repli sécurisé).
   *
   * @param {string} typeId - Identifiant du type (ex. 'spur', 'worm', 'belt')
   * @returns {TransmissionType} Objet décrivant le type de transmission
   */
  TransmissionTypeRegistry.prototype.get = function (typeId) {
    return this._types[typeId] || this._types.spur;
  };

  /**
   * Retourne la liste de tous les types disponibles sous forme de résumés.
   * Utile pour construire l'interface (listes déroulantes, filtres, chips).
   *
   * @returns {Array.<{id: string, nom: string, nomCourt: string, icone: string, description: string}>}
   *   Tableau de résumés triés par ordre d'insertion dans TYPES
   */
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

  /**
   * Calcule le rapport de transmission pour un étage donné.
   * Délègue au calculerRapport() du type concerné.
   *
   * @param {string} typeId - Identifiant du type de transmission
   * @param {number} A - Paramètre A (dents menante, filets, diamètre poulie, etc.)
   * @param {number} B - Paramètre B (dents menée, dents roue, diamètre poulie, etc.)
   * @returns {number} Rapport de transmission de l'étage
   */
  TransmissionTypeRegistry.prototype.calculerRapportEtage = function (typeId, A, B) {
    return this.get(typeId).calculerRapport(A, B);
  };

  /**
   * Valide une combinaison (A, B) pour un type de transmission donné.
   * Vérifie dans l'ordre :
   *   1. A est dans l'intervalle [minA, maxA]
   *   2. B est dans l'intervalle [minB, maxB]
   *   3. Le rapport calculé est dans [minRapportEtage, maxRapportEtage]
   *   4. La différence minimale de dents est respectée (si applicable)
   *   5. La fonction de compatibilité supplémentaire est satisfaite (si applicable)
   *
   * @param {string} typeId - Identifiant du type de transmission
   * @param {number} A - Paramètre A
   * @param {number} B - Paramètre B
   * @returns {boolean} true si la combinaison est valide, false sinon
   */
  TransmissionTypeRegistry.prototype.validerCombinaison = function (typeId, A, B) {
    var type = this.get(typeId);
    var c = type.contraintes;
    // Vérification des bornes sur A
    if (A < c.minA || A > c.maxA) return false;
    // Vérification des bornes sur B
    if (B < c.minB || B > c.maxB) return false;
    // Vérification du rapport dans les limites autorisées
    var rapport = type.calculerRapport(A, B);
    if (rapport < c.minRapportEtage || rapport > c.maxRapportEtage) return false;
    // Vérification de la différence minimale de dents (ex. engrenage intérieur)
    if (c.differenceMinDents && (B - A) < c.differenceMinDents) return false;
    // Vérification de compatibilité supplémentaire (ex. train épicycloïdal)
    if (c.compatibilite && !c.compatibilite(A, B)) return false;
    return true;
  };

  // ==================== EXPORT ET SINGLETON ====================

  /** Instance partagée (singleton) du registre, utilisée dans toute l'application. */
  var registry = new TransmissionTypeRegistry();
  GearApp.models.typeRegistry = registry;
  GearApp.models.TransmissionTypeRegistry = TransmissionTypeRegistry;

  // ==================== COMPATIBILITÉ ASCENDANTE (SHIMS) ====================
  // Ces variables et fonctions globales sont exposées sur `window` pour
  // maintenir la compatibilité avec le code legacy et les callers existants
  // qui accédaient directement à TransmissionTypes, getTransmissionType(), etc.
  // À terme, tout le code devrait migrer vers GearApp.models.typeRegistry.

  /** @deprecated Utiliser GearApp.models.typeRegistry à la place */
  window.TransmissionTypes = TYPES;

  /** @deprecated Utiliser GearApp.models.typeRegistry.list() */
  window.getTransmissionTypesList = function () { return registry.list(); };

  /** @deprecated Utiliser GearApp.models.typeRegistry.get(id) */
  window.getTransmissionType = function (id) { return registry.get(id); };

  /** @deprecated Utiliser GearApp.models.typeRegistry.calculerRapportEtage() */
  window.calculerRapportEtage = function (typeId, A, B) { return registry.calculerRapportEtage(typeId, A, B); };

  /** @deprecated Utiliser GearApp.models.typeRegistry.validerCombinaison() */
  window.validerCombinaison = function (typeId, A, B) { return registry.validerCombinaison(typeId, A, B); };

})(GearApp);
