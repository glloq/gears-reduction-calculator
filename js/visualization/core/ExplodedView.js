// ExplodedView.js - Écarter pour voir, sans rien changer au mécanisme.
//
// Un réducteur dense cache ses propres pièces. Sur un train épicycloïdal, le
// planétaire, la couronne, le porte-satellites et les satellites occupent le
// MÊME plan axial : vus de face ils sont concentriques, vus de biais ils se
// recouvrent, et aucun cadrage ne les sépare puisqu'ils sont réellement au
// même endroit. C'est une propriété du mécanisme, pas un défaut du dessin.
//
// La vue éclatée est la réponse du dessin technique : on écarte temporairement
// les organes LE LONG DE LEUR AXE, ce qui les décolle sans jamais déplacer un
// entraxe ni changer un diamètre. Deux règles la gouvernent, et elles sont
// entières :
//
//   1. le modèle n'est pas touché — ni le graphe mécanique, ni les positions
//      qu'il a établies. C'est une transformation de PRÉSENTATION, appliquée
//      entre la position monde et la projection :
//
//          position monde  →  décalage d'éclatement  →  projection
//
//   2. rien ne bouge en travers. Un organe glisse sur son propre axe, et
//      seulement là. Un engrènement reste à son entraxe vrai, un renvoi à 90°
//      reste à 90°, et une roue ne franchit jamais l'axe d'une autre.
//
// LE PAS. Ce qui se cache, ce sont les organes qui partagent une LIGNE — le
// même axe, au sens géométrique : même support, même direction. Sur cette
// ligne, on les range dans l'ordre où ils s'y succèdent et on les repousse d'un
// pas constant, à partir du milieu, de sorte que le dessin ne dérive pas. Deux
// organes déjà distants gardent leur écart réel EN PLUS du pas : l'éclatement
// s'ajoute, il ne remplace pas.
//
// Le pas ne vient pas d'un compte d'étages — « décaler le second planétaire de
// 30 » dirait quelque chose de faux sur la machine. Il vient de la LARGEUR des
// organes à dégager : un pas plus petit qu'une largeur de denture ne dégagerait
// rien.
//
// Ce dessin ne se cote pas, et il le dit : voir NOTICE.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.GearExplodedView = api;
    if (root.GearApp && root.GearApp.visualization) root.GearApp.visualization.ExplodedView = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Ce qu'il faut lire au-dessus d'une vue éclatée, et ne jamais omettre. */
  var NOTICE = 'Vue éclatée — espacement non à l’échelle';

  /**
   * Le pas, en multiples de la largeur du plus large organe.
   *
   * En dessous de 1, deux corps voisins se toucheraient encore ; bien au-delà,
   * le mécanisme se disperse et l'on perd ce qui appartient à quoi. 1,7 laisse
   * entre deux organes un intervalle de l'ordre d'une demi-largeur.
   */
  var STEP = 1.7;

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  /**
   * DEUX AXES, UNE SEULE LIGNE.
   *
   * Comparer les identifiants ne suffit pas : un satellite tourne autour d'un
   * axe qui lui est propre, mais confondu avec celui de son étage — même
   * support, même direction, un autre nom. S'en tenir aux noms laisserait les
   * satellites sur place pendant que le planétaire et la couronne s'écartent
   * d'eux, et l'éclatement ferait perdre l'étage au lieu de le montrer.
   */
  function sameLine(a, b) {
    if (!a || !b) return false;
    if (norm(cross(a.direction, b.direction)) > 1e-6) return false;
    var delta = sub(b.origin, a.origin);
    return norm(sub(delta, scale(a.direction, dot(delta, a.direction)))) < 1e-6;
  }

  /** L'intensité demandée : `true` vaut 1, un nombre vaut lui-même, le reste 0. */
  function amountOf(options) {
    var asked = options && options.explode;
    if (asked === true) return 1;
    var value = Number(asked);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /**
   * Le PAS du dessin entier, et non un pas par ligne.
   *
   * Un pas différent d'un arbre à l'autre écarterait les organes de façon
   * inégale, et l'œil lirait cette inégalité comme une donnée du mécanisme.
   * Il part de la largeur, parce que c'est elle qu'il faut dégager ; un organe
   * sans largeur connue — un schéma — se rabat sur son rayon, faute de quoi le
   * pas tomberait à zéro et l'éclatement ne ferait rien.
   */
  function stepOf(members, amount) {
    var widest = 0, largest = 0;
    members.forEach(function (member) {
      widest = Math.max(widest, finite(member.width, 0));
      largest = Math.max(largest, finite(member.radius, 0));
    });
    var reach = Math.max(widest, largest * 0.2, 2);
    return STEP * reach * amount;
  }

  /**
   * offsets(layout, options) → de combien chaque organe glisse sur son axe.
   *
   * Module pur, sans DOM : il répond « voici les décalages », `apply` s'en sert
   * pour construire un placement, et rien n'oblige à passer par lui — une vue
   * qui voudrait animer l'ouverture interpolerait ces valeurs.
   */
  function offsets(layout, options) {
    var amount = amountOf(options);
    var members = (layout && layout.members) || [];
    var idle = { active: false, amount: amount, step: 0, byId: {} };
    if (!amount || members.length < 2) return idle;
    var axes = (layout.graph && layout.graph.byAxis) || {};

    // Les LIGNES du mécanisme, dans l'ordre où on les rencontre.
    var lines = [];
    members.forEach(function (member, index) {
      var axis = axes[member.axisId] || { origin: [0, 0, 0], direction: member.axis || [1, 0, 0] };
      var line = null;
      lines.forEach(function (candidate) { if (!line && sameLine(candidate.axis, axis)) line = candidate; });
      if (!line) { line = { axis: axis, seats: [] }; lines.push(line); }
      line.seats.push({ member: member, index: index });
    });

    var step = stepOf(members, amount);
    var byId = {}, moved = false;
    lines.forEach(function (line) {
      // Dans l'ordre où les organes se succèdent sur la ligne. Deux organes au
      // MÊME plan — le planétaire, la couronne et le porte-satellites d'un
      // même étage — reçoivent des rangs consécutifs : c'est précisément eux
      // qu'il s'agit de décoller, et l'ordre du graphe les départage de façon
      // stable, faute de quoi un même mécanisme s'éclaterait différemment d'un
      // rendu à l'autre.
      var seats = line.seats.slice().sort(function (a, b) {
        var gap = finite(a.member.axialPosition, 0) - finite(b.member.axialPosition, 0);
        return gap || (a.index - b.index);
      });
      if (seats.length < 2) return;
      var middle = (seats.length - 1) / 2;
      seats.forEach(function (seat, rank) {
        byId[seat.member.id] = (rank - middle) * step;
        moved = true;
      });
    });
    if (!moved) return idle;
    return { active: true, amount: amount, step: step, byId: byId, notice: NOTICE };
  }

  /**
   * apply(layout, options) → le MÊME placement, ouvert.
   *
   * Le placement d'origine n'est pas modifié : on en construit un second. Les
   * deux coexistent, ce qui permet de comparer, de revenir, et surtout garantit
   * qu'aucune cote prise sur le modèle ne peut hériter d'un écartement de
   * présentation.
   *
   * Les arbres suivent ce qu'ils portent : un arbre dont les deux roues
   * s'éloignent s'allonge, sans quoi une roue se retrouverait dans le vide.
   */
  function apply(layout, options) {
    var plan = offsets(layout, options);
    if (!plan.active) return layout;
    var axes = (layout.graph && layout.graph.byAxis) || {};
    var overhang = finite(options && options.overhang, 8);

    var byId = {};
    var members = layout.members.map(function (member) {
      var delta = finite(plan.byId[member.id], 0);
      var moved = Object.assign({}, member, {
        axialPosition: finite(member.axialPosition, 0) + delta,
        position: add(member.position, scale(member.axis, delta)),
        // De combien CET organe a été écarté : une vue qui veut relier la pièce
        // à sa place d'origine — un trait d'éclatement — n'a pas à le redériver.
        explodeOffset: delta
      });
      byId[moved.id] = moved;
      return moved;
    });

    var shafts = layout.shafts.map(function (shaft) {
      var placed = shaft.memberIds.map(function (id) { return byId[id]; }).filter(Boolean);
      if (!placed.length) return shaft;
      var axis = axes[shaft.axisId];
      var origin = axis ? axis.origin : [0, 0, 0];
      var direction = axis ? axis.direction : shaft.direction;
      // L'ordre le long de l'axe est conservé par l'éclatement — le pas est le
      // même partout et les rangs suivent les abscisses —, si bien que le
      // premier et le dernier organe le restent.
      var first = placed[0], last = placed[placed.length - 1];
      var from = first.axialPosition - finite(first.width, 0) / 2 - overhang;
      var to = last.axialPosition + finite(last.width, 0) / 2 + overhang;
      return Object.assign({}, shaft, {
        start: add(origin, scale(direction, from)),
        end: add(origin, scale(direction, to)),
        length: to - from
      });
    });

    return Object.assign({}, layout, { members: members, shafts: shafts, byId: byId,
      // Le dépliage lit les abscisses dans le GRAPHE, qu'on ne touche pas : il
      // trouve ici de quoi les corriger.
      axialOffsets: plan.byId, exploded: plan });
  }

  return { offsets: offsets, apply: apply, sameLine: sameLine, amountOf: amountOf,
    NOTICE: NOTICE, STEP: STEP };
});
