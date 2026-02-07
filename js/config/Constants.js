/**
 * Constants.js - Constantes globales de l'application
 *
 * Centralise toutes les valeurs magiques et constantes partagées
 * entre les différents modules pour faciliter la maintenance
 * et la cohérence des paramètres.
 *
 * @namespace GearApp.config
 */
(function (GearApp) {

  GearApp.config = GearApp.config || {};

  // =====================================================================
  // PARAMÈTRES PAR DÉFAUT DU FORMULAIRE
  // =====================================================================

  /** Valeurs initiales des champs de saisie */
  GearApp.config.DEFAULTS = {
    /** Rapport cible par défaut (entrée/sortie) */
    RAPPORT_CIBLE: 12,
    /** Intervalle de précision en pourcentage */
    PRECISION_POURCENT: 0.1,
    /** Nombre maximum d'étages de réduction */
    MAX_ETAGES: 4,
    /** Nombre maximum de solutions retournées */
    MAX_SOLUTIONS: 10,
    /** Limite d'itérations pour la recherche */
    MAX_ITERATIONS: 500000,
    /** Vitesse d'entrée en tr/min */
    VITESSE_ENTREE: 1500,
    /** Couple d'entrée en N.m */
    COUPLE_ENTREE: 10,
    /** Module des engrenages en mm (si non renseigné) */
    MODULE: 2
  };

  // =====================================================================
  // PLAGES DES SLIDERS
  // =====================================================================

  /** Configuration des sliders noUiSlider */
  GearApp.config.SLIDERS = {
    MENANTE: { start: [10, 30], min: 5, max: 80, step: 1 },
    MENEE:   { start: [20, 50], min: 10, max: 120, step: 1 }
  };

  // =====================================================================
  // SEUILS DE QUALITÉ (pour les indicateurs visuels)
  // =====================================================================

  /**
   * Seuils utilisés pour les classes CSS 'excellent', 'good', 'warning'.
   * Ces seuils déterminent la couleur des indicateurs dans le tableau
   * et le panneau mécanique.
   */
  GearApp.config.SEUILS = {
    /** Seuils d'écart (%) pour la qualité du rapport */
    ECART: {
      EXCELLENT: 0.01,   // < 0.01% → classe 'excellent'
      BON: 0.1           // < 0.1%  → classe 'good', sinon neutre
    },
    /** Seuils de rendement total (ratio 0-1) */
    RENDEMENT: {
      EXCELLENT: 0.95,   // > 95% → classe 'excellent'
      BON: 0.90          // > 90% → classe 'good', sinon 'warning'
    },
    /** Seuils du facteur de sécurité (Lewis) */
    SECURITE: {
      EXCELLENT: 2.0,    // ≥ 2.0 → 'excellent'
      BON: 1.5           // ≥ 1.5 → 'good', sinon 'warning'
    },
    /** Seuils du rapport de conduite */
    CONDUITE: {
      EXCELLENT: 1.2,    // ≥ 1.2 → 'excellent'
      BON: 1.0           // ≥ 1.0 → 'good', sinon 'warning'
    },
    /** Seuils de vitesse périphérique (m/s) - mode pro */
    VITESSE_PERIPHERIQUE: {
      ATTENTION: 10,     // > 10 m/s → 'good' (attention)
      DANGER: 15         // > 15 m/s → 'warning'
    },
    /** Seuils de pertes de puissance (ratio par rapport à l'entrée) */
    PERTES: {
      ATTENTION: 0.20    // > 20% de pertes → 'warning'
    },
    /** Seuils de sécurité de contact Hertz */
    HERTZ: {
      EXCELLENT: 1.3,    // ≥ 1.3 → 'excellent'
      BON: 1.0           // ≥ 1.0 → 'good', sinon 'warning'
    }
  };

  // =====================================================================
  // CONSTANTES D'INGÉNIERIE MÉCANIQUE
  // =====================================================================

  /** Constantes utilisées dans les calculs mécaniques */
  GearApp.config.MECANIQUE = {
    /** Facteur d'élasticité Hertz ZE (√MPa) — pour acier/acier (ISO 6336) */
    ZE_ACIER: 190,
    /** Limite de contact par défaut en MPa (acier trempé) */
    LIMITE_CONTACT_DEFAUT: 1200,
    /** Limite élastique par défaut en MPa (acier doux) */
    LIMITE_ELASTIQUE_DEFAUT: 250,
    /** Angle de pression standard en degrés */
    ANGLE_PRESSION_STANDARD: 20,
    /** Qualité ISO par défaut pour le jeu de denture */
    QUALITE_ISO_DEFAUT: 7,
    /**
     * Facteurs de qualité ISO pour le calcul du jeu de denture.
     * Index = qualité ISO (0 à 12), valeur = facteur multiplicateur du module.
     */
    FACTEURS_QUALITE_ISO: [0, 0.01, 0.013, 0.018, 0.025, 0.035, 0.05, 0.071, 0.1, 0.14, 0.2, 0.28, 0.4],
    /** Quotient de diamètre standard pour vis sans fin (dw = q × m) */
    QUOTIENT_DIAMETRE_VIS: 10,
    /** Coefficient de frottement par défaut selon le type */
    COEFF_FROTTEMENT: {
      DROIT: 0.05,
      HELICOIDALE: 0.04,
      INTERIEUR: 0.04,
      CONIQUE: 0.06,
      VIS_SANS_FIN: 0.08
    }
  };

  // =====================================================================
  // SVG & VISUALISATION
  // =====================================================================

  /**
   * Constantes pour le rendu SVG interactif.
   * Utilisées par GearSVG.js et ses sous-modules
   * (GearDrawer, SVGInteraction, AnimationEngine).
   */
  GearApp.config.SVG = {
    /** Hauteur par défaut du SVG (pixels) */
    HEIGHT: 400,
    /** ViewBox initiale du SVG */
    VIEWBOX: { X: 0, Y: 0, W: 800, H: 400 },
    /** Facteur de zoom par pas de molette */
    ZOOM_FACTOR_IN: 1.1,
    ZOOM_FACTOR_OUT: 0.9,
    /** Paramètres du profil de dent */
    TOOTH: {
      /** Facteur d'addendum (rayon tête = Rp + module × facteur) */
      ADDENDUM_FACTOR: 1,
      /** Facteur de dédendum (rayon pied = Rp − module × facteur, norme ISO) */
      DEDENDUM_FACTOR: 1.25,
      /** Nombre de points d'échantillonnage de la courbe involute */
      INVOLUTE_POINTS: 8
    },
    /** Vitesse angulaire d'animation (radians par frame) */
    ANIMATION_SPEED: 0.02,
    /** Facteur de mise à l'échelle pour l'export PNG */
    EXPORT_SCALE: 2,
    /** Padding autour du train lors du cadrage automatique */
    FIT_PADDING: 60,
    /** Position de départ pour le dessin du train */
    TRAIN_START: { X: 100, Y: 200 },
    /** Couleurs des labels Entrée/Sortie */
    IO_COLORS: { ENTREE: '#2ecc71', SORTIE: '#e74c3c' },
    /** Gradient radial métallique pour les engrenages */
    GRADIENT: { CENTER: '#e8e8e8', EDGE: '#b0b0b0' },
    /** Paramètres du filtre d'ombre portée SVG */
    SHADOW: { DX: 1, DY: 1, BLUR: 2 }
  };

  // =====================================================================
  // RECHERCHE (Web Worker)
  // =====================================================================

  /** Paramètres internes de la recherche */
  GearApp.config.RECHERCHE = {
    /** Fréquence d'émission des logs de progression (toutes les N itérations) */
    LOG_FREQUENCY: 10000,
    /** Facteur d'élagage : marge au-delà du rapport cible avant coupure */
    PRUNING_FACTOR: 1.5,
    /** Limite de barre de progression avant complétion (%) */
    PROGRESS_MAX_PERCENT: 95
  };

  // =====================================================================
  // LABELS POUR L'UI
  // =====================================================================

  /** Labels de relation d'axes pour l'affichage */
  GearApp.config.LABELS_AXES = {
    parallel: 'Parallèle',
    perpendicular: '90°',
    coaxial: 'Coaxial',
    offset: 'Décalé'
  };

  /** Lettres utilisées pour nommer les engrenages (A, B, C...) */
  GearApp.config.GEAR_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

})(GearApp);
