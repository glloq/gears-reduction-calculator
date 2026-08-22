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

  /**
   * LA VERTICALE DU MONDE. Tout le reste de la caméra en découle : c'est elle
   * qui décide de ce qui est en haut de l'écran, et elle ne bouge jamais.
   */
  var WORLD_UP = [0, 1, 0];
  // Quand le regard est parallèle à la verticale — vue de dessus, de dessous —
  // « le haut du monde » ne dit plus rien de l'écran. On prend alors une
  // référence de secours : c'est le seul cas où le roulis est une convention.
  var UP_FALLBACK = [0, 0, -1];

  /**
   * LA BASE CAMÉRA, DÉDUITE DU SEUL REGARD.
   *
   * Les quatre bases étaient écrites à la main, vue par vue. Une base écrite à
   * la main peut être orthonormée et pourtant fausse : c'est ainsi que
   * l'isométrie s'est retrouvée en IMAGE MIROIR des vues orthographiques
   * pendant des mois — les longueurs y étaient justes, mais une hélice à droite
   * s'y lisait à gauche. Une seule formule ne peut pas se tromper deux fois :
   *
   *   u = verticale monde × regard      la droite de l'écran, horizontale
   *   v = u × regard                    le BAS de l'écran (Y écran vers le bas)
   *
   * D'où, automatiquement, `u × v = −w` pour toute vue : aucune ne peut être
   * l'image miroir d'une autre, et la verticale du monde reste verticale à
   * l'écran, sans roulis parasite.
   */
  function cameraBasisFromLook(look, worldUp) {
    var w = unit(look);
    var up = unit(worldUp || WORLD_UP);
    if (Math.abs(dot(w, up)) > 1 - 1e-9) up = unit(UP_FALLBACK);
    var u = unit(cross(up, w));
    return { u: u, v: unit(cross(u, w)), w: w };
  }

  /** Une vue complète, décrite par son seul regard. */
  function makeView(spec) {
    var basis = cameraBasisFromLook(spec.w, spec.up);
    return { id: spec.id, label: spec.label, help: spec.help, opposite: spec.opposite || null,
      isoQuarter: spec.isoQuarter == null ? null : spec.isoQuarter,
      u: basis.u, v: basis.v, w: basis.w };
  }

  /**
   * Les vues proposées dans la liste. `u` est l'horizontale de l'écran, `v` la
   * verticale, `w` la direction de regard — toutes trois calculées, jamais
   * écrites.
   */
  // Les libellés disent ce que la vue MONTRE, et non un numéro de face. Le
  // regard de `front` est perpendiculaire à l'arbre d'entrée : cette vue en
  // donne la longueur, pas l'engrènement — ce que son ancien nom, « Entrée »
  // avec pour aide « suivant les axes », affirmait exactement à l'envers.
  var VIEWS = [
    makeView({ id: 'front', label: 'De face', opposite: 'rear',
      help: 'Le regard coupe les arbres : on y lit leur longueur et l’empilement axial.', w: [0, 0, 1] }),
    makeView({ id: 'top', label: 'De dessus', opposite: 'bottom',
      help: 'Même chose vue du dessus : les décalages en profondeur deviennent visibles.', w: [0, 1, 0] }),
    makeView({ id: 'side', label: 'En bout', opposite: 'side-far',
      help: 'Le regard suit l’arbre d’entrée : c’est la vue des dentures et des entraxes.', w: [1, 0, 0] }),
    // ISOMÉTRIQUE au sens propre : le regard suit une diagonale du cube, si
    // bien que les trois axes du monde subissent le MÊME raccourcissement et
    // se projettent à 120° les uns des autres.
    makeView({ id: 'iso', label: 'Iso', isoQuarter: 0,
      help: 'Projection isométrique : les trois axes se valent, et les changements d’axe se lisent d’un coup.',
      w: [1, 1, 1] })
  ];

  /**
   * L'AUTRE BORD — réservé aux vues orthographiques.
   *
   * On ne l'obtient pas en tournant le dessin : `u` — la droite de l'écran —
   * change de sens en même temps que le regard, sans quoi on obtiendrait une
   * image miroir plutôt que l'autre face. La formule s'en charge seule, le
   * regard opposé suffit à la décrire.
   *
   * L'isométrie N'A PLUS d'autre bord. Elle en avait un — le coin
   * diagonalement opposé du cube, [−1, −1, −1] — et il était branché sur la
   * commande de changement d'angle. Or ce coin ne se trouve pas à côté du
   * premier : il est SOUS le mécanisme. Un clic présenté comme « tourner »
   * faisait donc passer d'une vue de dessus à une vue de dessous, inversait le
   * signe de la verticale et retournait d'un coup TOUTE la profondeur du
   * dessin. Tourner autour d'un mécanisme, c'est l'ORBITE ci-dessous.
   */
  var OPPOSITES = [
    makeView({ id: 'rear', label: 'De derrière', opposite: 'front',
      help: 'La même coupe, prise de l’autre bord : les sens apparents de rotation s’y inversent.', w: [0, 0, -1] }),
    makeView({ id: 'bottom', label: 'De dessous', opposite: 'top',
      help: 'Le dessous du réducteur : ce que la vue de dessus cache.', w: [0, -1, 0] }),
    makeView({ id: 'side-far', label: 'En bout (autre extrémité)', opposite: 'side',
      help: 'Le regard suit l’arbre d’entrée, mais depuis son autre extrémité.', w: [-1, 0, 0] })
  ];

  /**
   * L'ORBITE ISOMÉTRIQUE : quatre azimuts, tous vus DE DESSUS.
   *
   * La caméra tourne autour de la verticale du monde. Sa hauteur ne change
   * jamais — `w · [0,1,0] = +1/√3` pour les quatre —, si bien qu'un quart de
   * tour montre l'autre côté du mécanisme sans jamais passer dessous. C'est la
   * différence entre TOURNER AUTOUR et REGARDER DE L'AUTRE COIN.
   *
   * Chacune reste une vraie isométrie : le regard suit toujours une diagonale
   * du cube, donc les trois axes du monde y sont également raccourcis.
   */
  var ISO_TURNS = [
    { id: 'iso', w: [1, 1, 1] },
    { id: 'iso-90', w: [-1, 1, 1] },
    { id: 'iso-180', w: [-1, 1, -1] },
    { id: 'iso-270', w: [1, 1, -1] }
  ];
  var ISO_VARIANTS = ISO_TURNS.slice(1).map(function (turn, i) {
    return makeView({ id: turn.id, label: 'Iso', isoQuarter: i + 1,
      help: 'La même isométrie, la caméra ayant tourné d’un quart de tour autour du mécanisme.',
      w: turn.w });
  });

  /**
   * `iso-rear` désignait le coin [−1, −1, −1], sous le mécanisme. Le nom est
   * conservé pour ne pas casser les liens et les états enregistrés, mais il
   * désigne désormais le demi-tour HORIZONTAL — l'autre côté, pas le dessous.
   */
  var ALIASES = { 'iso-rear': 'iso-180' };

  /** Toutes les vues : `VIEWS` reste la liste proposée à l'utilisateur. */
  var ALL = VIEWS.concat(OPPOSITES, ISO_VARIANTS);

  function resolve(id) { return ALIASES[id] || id; }

  function view(id) {
    var wanted = resolve(id);
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === wanted) return ALL[i];
    return VIEWS[0];
  }

  /** Cette vue est-elle une isométrie, quel que soit son azimut ? */
  function isIso(id) {
    var found = view(id);
    return found.isoQuarter != null && resolve(id) === found.id;
  }

  /** Le quart de tour courant : 0 à 3, ou null hors isométrie. */
  function isoQuarter(id) { return isIso(id) ? view(id).isoQuarter : null; }

  /**
   * TOURNER AUTOUR DU MÉCANISME, d'un quart de tour à la fois.
   *
   * `quarterTurns` est compté positivement dans le sens où l'azimut de la
   * caméra décroît autour de la verticale — c'est-à-dire une rotation de −90°
   * autour de [0,1,0] à chaque pas. Quatre pas ramènent EXACTEMENT à la vue de
   * départ, et un pas dans un sens suivi d'un pas dans l'autre est l'identité.
   *
   * Hors isométrie, il n'y a pas d'azimut à faire tourner : l'identifiant
   * revient tel quel plutôt que d'inventer une vue.
   */
  function rotateIso(id, quarterTurns) {
    if (!isIso(id)) return id;
    var steps = Math.round(Number(quarterTurns) || 0);
    var next = (((view(id).isoQuarter + steps) % 4) + 4) % 4;
    return ISO_TURNS[next].id;
  }

  /**
   * L'autre bord d'une vue ORTHOGRAPHIQUE, ou l'identifiant reçu s'il n'y en a
   * pas — la vue dépliée n'est pas une projection, et une isométrie se tourne
   * au lieu de se retourner.
   */
  function oppositeOrthographic(id) {
    var found = view(resolve(id));
    return found.id === resolve(id) && found.opposite ? found.opposite : id;
  }

  /** La vue de référence d'un identifiant : celle que la liste affiche. */
  function baseView(id) {
    if (isIso(id)) return 'iso';
    var found = view(resolve(id));
    if (found.id !== resolve(id)) return 'front';
    return found.opposite && OPPOSITES.some(function (other) { return other.id === found.id; })
      ? found.opposite : found.id;
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
   * De quel BOUT on regarde cet axe : +1 s'il s'éloigne de l'œil, −1 s'il vient
   * vers lui, 0 s'il est dans le plan de l'écran.
   *
   * `presentation` et `foreshortening` prennent tous deux la valeur ABSOLUE du
   * produit scalaire — ce qui suffit à dire « de face » ou « de profil », et
   * détruit au passage une information qu'on ne peut pas reconstruire ensuite :
   * une roue vue de son autre extrémité tourne, à l'écran, dans l'autre sens.
   * Sans ce signe, l'animation affirme le même sens de rotation des deux côtés
   * du réducteur, ce qui est faux la moitié du temps.
   */
  function facing(axis, id) {
    var v = typeof id === 'string' || id == null ? view(id) : id;
    var alignment = dot(unit(axis), v.w);
    return Math.abs(alignment) < 1e-9 ? 0 : (alignment > 0 ? 1 : -1);
  }

  /** La profondeur d'un point sous ce regard : ce qui permet de trier. */
  function depth(point, id) {
    var v = typeof id === 'string' || id == null ? view(id) : id;
    return dot(point, v.w);
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

  /**
   * La vue qui montre le plus de DENTURE — une autre question qu'`auto`.
   *
   * `auto` répond « d'où perd-on le moins du mécanisme ? », et compte l'axe vu
   * en bout comme une perte, ce qu'il est : on n'y lit plus la longueur des
   * arbres. Pour un train à axes parallèles, cela élit la coupe — toutes les
   * roues en rectangles. C'est un dessin d'ensemble correct, et exactement ce
   * qu'une vue nommée « denture réaliste » ne doit pas montrer.
   *
   * On note donc ce que le DESSIN pourra affirmer. Une roue vue de face ou de
   * profil se trace exactement ; obliquement, elle n'est qu'approchée par une
   * ellipse. On compte d'abord les organes tracés exactement, puis ceux dont
   * la denture est visible, et l'on départage par ce qu'`auto` sait déjà : ne
   * rien confondre.
   */
  /** Un axe peut arriver comme { direction } ou comme un vecteur nu. */
  function directionOf(axis) { return (axis && axis.direction) || axis; }

  function engagement(axes) {
    var list = (axes || []).filter(Boolean);
    if (!list.length) return view('front');
    // UN TRAIN COUDÉ NE SE REGARDE PAS DANS SON AXE MENANT.
    //
    // Le compte ci-dessous récompense les organes vus de FACE, où la denture se
    // lit le mieux. Pour un train à axes parallèles c'est sans danger : ils
    // sont tous vus en bout ensemble, et le dessin dit la vérité — ils sont
    // coaxiaux ou parallèles. Dès qu'il y a un RENVOI, le même compte élit le
    // regard qui aligne l'axe menant sur l'œil : deux roues y montrent leur
    // denture, l'arbre qui les porte n'a plus de direction, et le renvoi qui
    // suit se retrouve dessiné parallèle à un axe qu'on ne voit pas — c'est-à-
    // dire lu comme un montage coaxial. Ce qu'on gagne en denture, on le perd
    // en architecture, et l'architecture est ce qu'un dessin d'ensemble doit
    // dire en premier.
    var lead = directionOf(list[0]);
    var bent = list.some(function (axis) {
      var d = directionOf(axis);
      return Math.abs(dot(unit(d), unit(lead))) < 1 - 1e-6;
    });
    var best = null, score = null;
    VIEWS.forEach(function (candidate) {
      if (bent && presentation(lead, candidate) === 'face') return;
      var exact = 0, faces = 0;
      list.forEach(function (axis) {
        var how = presentation(axis.direction || axis, candidate);
        if (how !== 'oblique') exact++;
        if (how === 'face') faces++;
      });
      var value = [exact, faces, penalty(list, candidate)];
      if (!score || value[0] > score[0] ||
        (value[0] === score[0] && (value[1] > score[1] ||
          (value[1] === score[1] && value[2] > score[2])))) { score = value; best = candidate; }
    });
    return best || view('front');
  }

  return { VIEWS: VIEWS, OPPOSITES: OPPOSITES, ALL: ALL, WORLD_UP: WORLD_UP,
    // `opposite` reste le nom historique de l'autre bord — mais il ne fait
    // plus tourner une isométrie, il n'y a plus de coin opposé à lui donner.
    opposite: oppositeOrthographic, oppositeOrthographic: oppositeOrthographic,
    isIso: isIso, isoQuarter: isoQuarter, rotateIso: rotateIso, baseView: baseView,
    cameraBasisFromLook: cameraBasisFromLook,
    view: view, project: project, presentation: presentation,
    foreshortening: foreshortening, facing: facing, depth: depth,
    auto: auto, engagement: engagement, penalty: penalty,
    FACE_LIMIT: FACE_LIMIT, PROFILE_LIMIT: PROFILE_LIMIT,
    vector: { dot: dot, cross: cross, unit: unit, norm: norm } };
});
