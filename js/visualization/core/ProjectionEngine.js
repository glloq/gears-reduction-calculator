// ProjectionEngine.js - Regarder le mécanisme, sans jamais le déformer.
//
// La projection était deux formules ad hoc, enfermées dans la vue cinématique :
//   principale   x = X + 0.45·Z   y = Y − 0.30·Z
//   orthogonale  x = X            y = Z
// La seconde éliminait purement et simplement Y. Ce n'était pas un choix de
// vue : c'était une perte d'information, dans la vue où la projection importe
// le moins — la cinématique sert à comprendre qui entraîne quoi, pas à mesurer.
//
// Ici, une projection est une BASE : deux vecteurs unitaires orthogonaux du
// plan de l'écran, plus la direction de regard. Rien n'est écrasé, seule la
// composante le long du regard disparaît — c'est la définition d'une projection
// orthographique, celles du dessin technique (ISO 5456-2). Une seule projection
// axonométrique s'y ajoute, pour les chaînes qui changent d'axe plusieurs fois
// et qu'aucune vue plane ne rend lisibles d'un coup.
//
// La direction de regard sert à une seconde chose, tout aussi importante : dire
// comment DESSINER chaque organe. Une roue dont l'axe pointe vers l'œil se voit
// de face, denture visible ; la même roue vue de côté n'est plus qu'un
// rectangle de largeur b. C'est ce qui manquait pour qu'un engrenage et une vis
// puissent coexister sur un même arbre sans mentir.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearProjectionEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var n = norm(a); return n < 1e-9 ? [1, 0, 0] : [a[0] / n, a[1] / n, a[2] / n]; }

  var ISO = 1 / Math.sqrt(2), ISO_V = 1 / Math.sqrt(6);

  /**
   * Les vues. `u` est l'horizontale de l'écran, `v` la verticale, `w` la
   * direction de regard — les trois forment un trièdre direct, ce que le test
   * vérifie plutôt que de faire confiance aux constantes écrites ici.
   *
   * L'écran a son Y vers le bas : `v` porte donc l'opposé de la verticale
   * monde, sans quoi tout serait dessiné à l'envers.
   */
  var VIEWS = [
    { id: 'front', label: 'Entrée', help: 'De face, suivant les axes : c’est la vue de l’engrènement.',
      u: [1, 0, 0], v: [0, -1, 0], w: [0, 0, 1] },
    { id: 'top', label: 'Dessus', help: 'Vue de dessus : les décalages en profondeur deviennent visibles.',
      u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] },
    { id: 'side', label: 'Côté', help: 'Vue de côté : la longueur des arbres et l’empilement axial.',
      u: [0, 0, -1], v: [0, -1, 0], w: [1, 0, 0] },
    { id: 'iso', label: 'Iso', help: 'Projection axonométrique : les changements d’axe se lisent d’un coup.',
      u: [ISO, 0, -ISO], v: [-ISO_V, -2 * ISO_V, -ISO_V], w: unit([1, -1, 1]) }
  ];

  function view(id) {
    for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === id) return VIEWS[i];
    return VIEWS[0];
  }

  /** project(point, view) → [x, y] écran. */
  function project(point, id) {
    var v = typeof id === 'string' || id == null ? view(id) : id;
    return [dot(point, v.u), dot(point, v.v)];
  }

  /**
   * Comment se présente un organe dont l'axe est `axis`, vu depuis `view`.
   *
   * `face` — l'axe pointe vers l'œil : disque, denture visible.
   * `profile` — l'axe est dans le plan de l'écran : rectangle de largeur b.
   * `oblique` — entre les deux : ellipse, ou représentation simplifiée.
   *
   * Une roue était PRESQUE toujours dessinée en cercle. C'est juste de face, et
   * faux partout ailleurs — c'est ce qui rendait impossible de montrer un
   * engrenage et une vis sur le même arbre.
   */
  var FACE_LIMIT = Math.cos(20 * Math.PI / 180);     // < 20° de l'œil
  var PROFILE_LIMIT = Math.cos(70 * Math.PI / 180);  // > 70° de l'œil

  function presentation(axis, id) {
    var v = typeof id === 'string' || id == null ? view(id) : id;
    var alignment = Math.abs(dot(unit(axis), v.w));
    if (alignment >= FACE_LIMIT) return 'face';
    if (alignment <= PROFILE_LIMIT) return 'profile';
    return 'oblique';
  }

  /** Le raccourci d'un disque vu obliquement : son petit axe apparent. */
  function foreshortening(axis, id) {
    var v = typeof id === 'string' || id == null ? view(id) : id;
    return Math.abs(dot(unit(axis), v.w));
  }

  /**
   * Ce qu'une vue perd de CE mécanisme.
   *
   * Le choix automatique cherchait la disposition la moins encombrée : un
   * critère de dessin, pas de mécanique, qui pouvait cacher l'engrènement pour
   * éviter deux chevauchements. On décide par ce qui serait PERDU.
   *
   * Une première version ne regardait que les DIRECTIONS d'axes. C'est
   * insuffisant : deux étages parallèles ont la même direction, et ce qui les
   * distingue est leur ENTRAXE. Choisir la vue sur les seules directions
   * pouvait donc élire un point de vue où deux arbres parallèles se confondent
   * — les roues d'un train à deux étages se retrouvaient l'une sur l'autre.
   *
   * On note donc deux pertes, et on retient la pire :
   *   un axe vu en bout se réduit à un point ;
   *   deux axes distincts projetés au même endroit se confondent.
   */
  function penalty(axes, candidate) {
    var worst = 1;
    axes.forEach(function (axis) {
      var direction = unit(axis.direction || axis);
      // 0 quand l'axe pointe vers l'œil, 1 quand il est dans le plan de l'écran.
      worst = Math.min(worst, Math.sqrt(Math.max(0, 1 - dot(direction, candidate.w) * dot(direction, candidate.w))));
    });
    var origins = axes.map(function (axis) { return axis.origin; }).filter(Boolean);
    var separation = 0, pairs = 0;
    for (var i = 0; i < origins.length; i++) {
      for (var j = i + 1; j < origins.length; j++) {
        var delta = [origins[j][0] - origins[i][0], origins[j][1] - origins[i][1], origins[j][2] - origins[i][2]];
        var space = Math.sqrt(dot(delta, delta));
        if (space < 1e-6) continue;                 // axes confondus dans le monde
        pairs++;
        var seen = Math.hypot(dot(delta, candidate.u), dot(delta, candidate.v));
        separation = Math.max(separation, 1 - seen / space);
      }
    }
    return Math.min(worst, pairs ? 1 - separation : 1);
  }

  function auto(axes) {
    var list = (axes || []).filter(Boolean);
    if (!list.length) return view('front');
    var best = null, score = -1;
    VIEWS.forEach(function (candidate) {
      // L'axonométrie ne perd presque rien mais déforme : elle ne gagne qu'à
      // défaut d'une vue plane honnête.
      var value = penalty(list, candidate) - (candidate.id === 'iso' ? 0.08 : 0);
      if (value > score) { score = value; best = candidate; }
    });
    return best || view('front');
  }

  return { VIEWS: VIEWS, view: view, project: project, presentation: presentation,
    foreshortening: foreshortening, auto: auto,
    FACE_LIMIT: FACE_LIMIT, PROFILE_LIMIT: PROFILE_LIMIT,
    vector: { dot: dot, cross: cross, unit: unit, norm: norm } };
});
