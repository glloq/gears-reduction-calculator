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
   * La vue qui montre le mieux CE mécanisme.
   *
   * Le choix automatique cherchait la disposition la moins encombrée. C'est un
   * critère de dessin, pas de mécanique : il pouvait choisir une vue où
   * l'engrènement n'était pas visible parce qu'elle évitait deux
   * chevauchements. On décide donc par ce qu'il y a à comprendre.
   *
   *   axes tous parallèles  → de face, on voit les engrènements ;
   *   un seul renvoi         → le plan qui CONTIENT les deux axes ;
   *   plusieurs renvois      → axonométrie, aucune vue plane ne suffit.
   */
  function auto(axes) {
    var directions = (axes || []).map(function (axis) { return unit(axis.direction || axis); });
    if (!directions.length) return view('front');
    var distinct = [];
    directions.forEach(function (d) {
      var known = distinct.some(function (k) { return Math.abs(Math.abs(dot(k, d)) - 1) < 1e-6; });
      if (!known) distinct.push(d);
    });
    if (distinct.length <= 1) return view('front');
    if (distinct.length > 2) return view('iso');
    // Deux directions : la bonne vue est celle dont le regard est perpendiculaire
    // au plan qui les contient — on y voit les deux axes en vraie grandeur.
    var planeNormal = unit(cross(distinct[0], distinct[1]));
    var best = view('front'), score = -1;
    VIEWS.forEach(function (candidate) {
      if (candidate.id === 'iso') return;
      var alignment = Math.abs(dot(candidate.w, planeNormal));
      if (alignment > score) { score = alignment; best = candidate; }
    });
    // Aucune vue plane ne contient ce plan : l'axonométrie dit au moins la vérité.
    return score > 0.9 ? best : view('iso');
  }

  return { VIEWS: VIEWS, view: view, project: project, presentation: presentation,
    foreshortening: foreshortening, auto: auto,
    FACE_LIMIT: FACE_LIMIT, PROFILE_LIMIT: PROFILE_LIMIT,
    vector: { dot: dot, cross: cross, unit: unit, norm: norm } };
});
