// FidelityContract.js - Ce que chaque dessin AFFIRME, et ce qu'il ne fait que
// suggérer.
//
// Un dessin technique n'a de valeur que si l'on sait ce qu'on a le droit d'y
// lire. Le même mécanisme est représenté ici de trois façons : une vue
// d'ensemble qui montre les pièces, une vue cotée qui les mesure, un schéma qui
// dit qui entraîne quoi. Les trois ne promettent pas la même chose, et chaque
// FAMILLE de transmission ne tient pas la même promesse dans chacune.
//
// Le projet portait déjà cette idée, mais éparpillée : une phrase écrite dans
// la barre du visualiseur, un drapeau `geometricView` dans le registre que plus
// personne ne lisait, et un README qui décrivait un troisième état. Les trois se
// contredisaient — la chaîne était déclarée « non représentable » par le
// registre pendant que le renderer la dessinait dans les trois vues, sans que
// rien ne le signale.
//
// Il n'y a plus qu'UNE déclaration, et tout ce qui parle de fidélité la lit.
//
// ===== LES CINQ NIVEAUX =====
//
//   exact         Le contour tracé EST la projection orthographique de la
//                 surface réelle. Une longueur relevée dessus est la longueur
//                 de la pièce, à l'échelle près.
//
//   derived       Le contour est calculé À PARTIR de la géométrie réelle, mais
//                 par une construction approchée dont on connaît la limite —
//                 elle est nommée dans `note`. On peut s'y fier pour
//                 comprendre, pas pour relever une cote au dixième.
//
//   conventional  Le tracé suit une CONVENTION de dessin, pas la surface : il
//                 dit qu'il y a quelque chose et de quelle nature, sans que sa
//                 forme soit celle de la pièce. Les grandeurs qui l'entourent —
//                 diamètres, entraxes, trajet — restent, elles, celles du
//                 calcul.
//
//   schematic     Un SYMBOLE. Ni sa taille ni sa place ne sont des grandeurs :
//                 seuls les liens et les vitesses ont un sens.
//
//   unsupported   Cette vue ne représente pas cette famille. Rien n'est dessiné.
//
// ===== CE QUE LE CONTRAT N'EST PAS =====
//
// Ce n'est pas une note de qualité : `conventional` n'est pas un défaut à
// corriger. Les maillons d'une chaîne se dessinent par convention dans tous les
// bureaux d'études du monde, et c'est très bien ainsi. Le défaut, c'est de ne
// pas le DIRE.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.GearFidelityContract = api;
    if (root.GearApp && root.GearApp.visualization) root.GearApp.visualization.FidelityContract = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Du plus fidèle au moins fidèle. L'ordre EST le contrat. */
  var LEVELS = ['exact', 'derived', 'conventional', 'schematic', 'unsupported'];

  var LEVEL_LABELS = {
    exact: 'à l’échelle',
    derived: 'construite',
    conventional: 'conventionnelle',
    schematic: 'symbolique',
    unsupported: 'non représentée'
  };

  var LEVEL_SENTENCES = {
    exact: 'Le contour tracé est la projection de la surface réelle : ce qui s’y mesure est la pièce.',
    derived: 'Le contour est construit à partir de la géométrie réelle, par une approximation connue.',
    conventional: 'Le tracé est conventionnel : il dit ce qu’il y a, non la forme exacte de la pièce. Les diamètres et les entraxes, eux, sont ceux du calcul.',
    schematic: 'Symbole : ni les tailles ni les places ne sont des grandeurs.',
    unsupported: 'Cette vue ne représente pas cette famille.'
  };

  /** Les trois vues, sous les noms que l'interface leur donne. */
  var VIEWS = ['teeth', 'geometry', 'kinematic'];
  /** Comment un organe se présente à la caméra. */
  var PRESENTATIONS = ['face', 'profile', 'oblique'];

  /**
   * LE CONTRAT, famille par famille.
   *
   * `teeth` et `geometry` déclarent un niveau par présentation, parce que c'est
   * là que les approximations vivent : un cône vu de face est un disque, qu'on
   * sait tracer exactement ; vu de biais, son contour apparent est une courbe
   * qu'on approche. `kinematic` est un schéma, et n'a pas de présentation.
   */
  var CONTRACT = {
    spur: {
      teeth: { face: 'exact', profile: 'exact', oblique: 'exact' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'exact' },
      kinematic: 'schematic',
      note: 'La denture n’est tracée en développante vraie qu’au zoom qui la rend lisible ; en dessous, la roue est bornée par ses cercles.'
    },
    helical: {
      teeth: { face: 'exact', profile: 'exact', oblique: 'exact' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'exact' },
      kinematic: 'schematic',
      note: 'Le sens et l’inclinaison de l’hélice se lisent sous les trois présentations. De biais, les marques sont la génératrice hélicoïdale réelle échantillonnée sur la surface latérale et projetée ; par la tranche, ce sont les trois traits inclinés du dessin technique, une convention. Corps, cercles et largeur de denture sont à l’échelle dans les deux cas.'
    },
    internal: {
      teeth: { face: 'exact', profile: 'exact', oblique: 'exact' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'exact' },
      kinematic: 'schematic'
    },
    bevel: {
      // Vu de face ou par la tranche, le tronc de cône se trace exactement.
      // Vu de biais, son CONTOUR APPARENT est l'enveloppe des génératrices —
      // une courbe que le dessin approche par ses deux ellipses de base et deux
      // segments. L'écart est faible et se voit près du sommet.
      teeth: { face: 'exact', profile: 'exact', oblique: 'derived' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'derived' },
      kinematic: 'schematic',
      note: 'De biais, le contour du cône est approché par ses ellipses de base et ses génératrices, non par son enveloppe apparente exacte.'
    },
    worm: {
      teeth: { face: 'exact', profile: 'exact', oblique: 'exact' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'exact' },
      kinematic: 'schematic',
      note: 'Le corps de la vis et sa roue sont à l’échelle ; les filets sont un tracé conventionnel au pas réel.'
    },
    planetary: {
      teeth: { face: 'exact', profile: 'exact', oblique: 'exact' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'exact' },
      kinematic: 'schematic',
      note: 'Les bras du porte-satellites sont conventionnels : ils relient les axes, ils ne dessinent pas la pièce.'
    },
    belt: {
      teeth: { face: 'exact', profile: 'exact', oblique: 'exact' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'exact' },
      kinematic: 'schematic',
      note: 'Poulies, brins et arcs d’enroulement sont à l’échelle ; les dents de courroie sont des repères au pas réel.'
    },
    chain: {
      // La chaîne était déclarée « non représentable » par le registre alors
      // que le renderer la dessine dans les trois vues. Ce qu'elle est
      // vraiment : un trajet et des pignons EXACTS, portant des maillons
      // conventionnels.
      teeth: { face: 'conventional', profile: 'conventional', oblique: 'conventional' },
      geometry: { face: 'conventional', profile: 'conventional', oblique: 'conventional' },
      kinematic: 'schematic',
      note: 'Les pignons, l’entraxe et le trajet de la chaîne sont ceux du calcul ; les maillons sont figurés par des repères au pas réel, sans géométrie de rouleau.'
    },
    rack: {
      // Le profil de la crémaillère est tracé dans le plan du pignon, à hauteur
      // de dent vraie : dans une vue qui raccourcit ce plan, la hauteur ne l'est
      // pas. La course et la ligne primitive, elles, sont projetées.
      teeth: { face: 'exact', profile: 'exact', oblique: 'derived' },
      geometry: { face: 'exact', profile: 'exact', oblique: 'derived' },
      kinematic: 'schematic',
      note: 'De biais, la course et la ligne primitive sont projetées, mais la hauteur de dent reste tracée en vraie grandeur.'
    }
  };

  function rank(level) {
    var index = LEVELS.indexOf(level);
    return index < 0 ? LEVELS.length : index;
  }

  /** Le MOINS bon de plusieurs niveaux : c'est lui qui borne ce qu'on peut lire. */
  function worst(levels) {
    var found = null;
    (levels || []).forEach(function (level) {
      if (!level) return;
      if (!found || rank(level) > rank(found)) found = level;
    });
    return found;
  }

  /**
   * of(family, view, presentation) → le niveau déclaré, ou null.
   *
   * Une famille inconnue rend `null` plutôt qu'un niveau par défaut : inventer
   * « exact » pour ce qui n'a jamais été déclaré est exactement la faute que ce
   * module existe pour empêcher.
   */
  function of(family, view, presentation) {
    var entry = CONTRACT[family];
    if (!entry) return null;
    var declared = entry[view];
    if (!declared) return null;
    if (typeof declared === 'string') return declared;
    return declared[presentation] || worst(PRESENTATIONS.map(function (p) { return declared[p]; }));
  }

  /** Ce que la famille précise sur ses propres conventions, s'il y a lieu. */
  function noteOf(family) {
    var entry = CONTRACT[family];
    return (entry && entry.note) || null;
  }

  /**
   * LE NIVEAU D'UN DESSIN ENTIER : le moins bon de ceux de ses familles, dans
   * les présentations où elles se trouvent réellement.
   *
   * Un train droit + conique ne peut pas se dire « à l'échelle » sous prétexte
   * que ses roues droites le sont : c'est le cône de biais qui borne la lecture.
   *
   * @param {Array} stages [{ family, presentation }]
   */
  function ofDrawing(view, stages) {
    var levels = (stages || []).map(function (stage) {
      return of(stage.family, view, stage.presentation || 'oblique');
    });
    return worst(levels);
  }

  /** La phrase à afficher pour un niveau. */
  function describe(level) { return LEVEL_SENTENCES[level] || ''; }
  function label(level) { return LEVEL_LABELS[level] || level; }

  /** Les familles déclarées — pour qu'un test puisse exiger qu'elles y soient toutes. */
  function families() { return Object.keys(CONTRACT); }

  return { of: of, ofDrawing: ofDrawing, noteOf: noteOf, worst: worst, rank: rank,
    describe: describe, label: label, families: families,
    LEVELS: LEVELS, VIEWS: VIEWS, PRESENTATIONS: PRESENTATIONS, CONTRACT: CONTRACT };
});
