/* Primitives graphiques de la vue « Denture ».
 *
 * Chaque roue est décrite par une liste de descripteurs {tag, attrs, text} :
 * aucune dépendance au DOM, donc testable sous Node et réutilisable à l'export.
 * Le renderer se contente de matérialiser les descripteurs.
 *
 * Niveaux de détail (LOD) — choisis d'après la taille RÉELLE de la roue à
 * l'écran, pas d'après le facteur de zoom : une roue de 8 dents et une roue de
 * 200 dents n'ont pas la même lisibilité au même zoom.
 *   0 silhouette        1 dents simplifiées
 *   2 développante      3 développante + tracés de construction
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./ToothProfile.js') : root.GearToothProfile,
    common ? require('./ToothProfileCache.js') : root.GearToothProfileCache,
    common ? require('../core/GroundSymbol.js') : root.GearGroundSymbol);
  if (common) module.exports = api; else root.GearTeethPrimitives = api;
})(typeof self !== 'undefined' ? self : this, function (Profile, Cache, Ground) {
  'use strict';

  var LEVELS = { SILHOUETTE: 0, SIMPLIFIED: 1, INVOLUTE: 2, TECHNICAL: 3 };
  // Seuils en pixels du diamètre de tête à l'écran.
  var THRESHOLDS = [18, 70, 260];
  /**
   * §17 : le style technique a sa PROPRE échelle de détail.
   *
   * Les mêmes seuils dans les deux styles ramenaient la denture réelle dès le
   * cadrage par défaut — un dessin d'ensemble couvert de développantes, c'est
   * exactement le bruit que la représentation conventionnelle existe pour
   * éviter. Sur un plan, une denture ne se dessine que si on l'a demandée de
   * près : il faut donc une roue nettement plus grande à l'écran pour qu'elle
   * revienne. Le mode s'appelle « technique », pas « détaillé ».
   */
  var TECHNICAL_THRESHOLDS = [60, 260, 900];

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function fixed(value, digits) { return finite(value, 0).toFixed(digits == null ? 2 : digits); }
  function node(tag, attrs, text) { return { tag: tag, attrs: attrs, text: text }; }

  /** Groupe de descripteurs : le rendu le matérialise avec ses enfants. */
  function group(attrs, children) { return { tag: 'g', attrs: attrs, children: children }; }

  /** level(diameterPx) → niveau de détail pour une roue de ce diamètre écran. */
  function level(diameterPx, style) {
    var size = finite(diameterPx, 0);
    var ladder = style === 'technical' ? TECHNICAL_THRESHOLDS : THRESHOLDS;
    for (var i = 0; i < ladder.length; i++) if (size < ladder[i]) return i;
    return LEVELS.TECHNICAL;
  }

  /**
   * Niveau appliqué à une roue : sa taille APPARENTE, en pixels.
   *
   * Le calcul prenait toujours le diamètre. Une roue vue presque en bout occupe
   * pourtant une bande de quelques millimètres : elle déclenchait un niveau de
   * détail maximal pour dessiner une développante haute de trois pixels.
   */
  function levelFor(wheel, pixelsPerUnit, options) {
    var diameter = finite(wheel && (wheel.outsideD || wheel.pitchD), 0);
    var presentation = options && options.presentation;
    var apparent = diameter;
    if (presentation === 'profile') {
      apparent = Math.min(diameter, Math.max(finite(wheel && wheel.faceWidth, 0), diameter * 0.15));
    } else if (presentation === 'oblique') {
      var squeeze = Math.min(1, Math.max(0.05, finite(options && options.foreshortening, 0.5)));
      apparent = diameter * squeeze;
    }
    return level(apparent * finite(pixelsPerUnit, 1), options && options.style);
  }

  function radii(wheel) {
    var m = Math.max(1e-6, finite(wheel.module, 1));
    var pitch = finite(wheel.pitchD, 20) / 2;
    return {
      module: m, pitch: pitch,
      tip: finite(wheel.outsideD, wheel.pitchD + 2 * m) / 2,
      root: Math.max(0.5, finite(wheel.rootD, wheel.pitchD - 2.5 * m) / 2),
      base: finite(wheel.baseD, wheel.pitchD * Math.cos(rad(finite(wheel.pressureAngle, 20)))) / 2
    };
  }

  // ===== Corps de roue par famille =====

  function gearBody(wheel, lod) {
    var r = radii(wheel);
    var teeth = Math.max(3, Math.round(finite(wheel.teeth, 12)));
    if (lod <= LEVELS.SILHOUETTE) return [node('circle', { class: 'tooth-profile silhouette', r: fixed(r.tip) })];
    var d = lod === LEVELS.SIMPLIFIED
      ? Profile.toothedRingPath(teeth, r.tip, r.root, 0.5)
      : Cache.get({ type: wheel.helixAngle ? 'helical' : 'spur', teeth: teeth, module: r.module,
        pressureAngle: finite(wheel.pressureAngle, 20), helixAngle: finite(wheel.helixAngle, 0),
        profileShift: finite(wheel.profileShift, 0), pitchRadius: r.pitch, tipRadius: r.tip, rootRadius: r.root,
        internal: false });
    var shapes = [node('path', { class: 'tooth-profile', d: d || '' })];
    var hub = Math.max(1.2, Math.min(r.root * 0.35, 6 * r.module));
    shapes.push(node('circle', { class: 'gear-hub', r: fixed(hub) }));
    if (lod >= LEVELS.INVOLUTE) shapes.push(node('path', { class: 'hub-cross', d: 'M ' + fixed(-hub) + ' 0 H ' + fixed(hub) + ' M 0 ' + fixed(-hub) + ' V ' + fixed(hub) }));
    return shapes;
  }

  /**
   * Hélicoïdal : le disque reste une développante transverse, mais les stries
   * inclinées à l'angle d'hélice réel et le repère de sens d'hélice évitent de
   * le confondre avec un engrenage droit.
   */
  function helicalMarks(wheel, lod) {
    if (lod <= LEVELS.SILHOUETTE) return [];
    var r = radii(wheel);
    var beta = rad(finite(wheel.helixAngle, 20));
    // `handedness` est le nom du registre et de la scène. `helixHand` est
    // accepté par compatibilité, mais rien ne l'a jamais posé.
    var hand = handOf(wheel);
    var count = Math.max(4, Math.min(16, Math.round(finite(wheel.teeth, 12) / 3)));
    var marks = [];
    for (var i = 0; i < count; i++) {
      var y = -r.root + (2 * r.root) * (i + 0.5) / count;
      var half = Math.sqrt(Math.max(0, r.root * r.root - y * y));
      if (half < r.module) continue;
      var shear = hand * Math.tan(beta) * half;
      marks.push(node('path', { class: 'helix-stripe',
        d: 'M ' + fixed(-half) + ' ' + fixed(y - shear / 2) + ' L ' + fixed(half) + ' ' + fixed(y + shear / 2) }));
    }
    if (lod >= LEVELS.TECHNICAL) {
      marks.push(node('path', { class: 'helix-hand',
        d: 'M ' + fixed(-r.pitch * 0.4) + ' ' + fixed(r.pitch * 0.62) + ' l ' + fixed(hand * r.pitch * 0.8) + ' ' + fixed(-r.pitch * 0.24) }));
      // β se lit : c'est un TEXTE, pas une géométrie. Il ne peut donc pas
      // vivre dans le rotor, qui tourne — il rejoint les annotations, qui
      // restent droites (voir `upright` dans build()).
      marks.push(node('text', { class: 'helix-label upright-annotation', 'text-anchor': 'middle',
        y: fixed(r.pitch * 0.86),
        'font-size': fixed(Math.max(2.4, r.module * 2), 1) }, 'β ' + fixed(finite(wheel.helixAngle, 20), 0) + '° ' + (hand < 0 ? 'G' : 'D')));
    }
    return marks;
  }

  /**
   * Couronne intérieure : jante pleine évidée par la denture (règle evenodd).
   * Le contour du trou plonge de (primitif + creux) vers (primitif − saillie),
   * donc les dents pointent bien vers l'intérieur, et la jante reste visible.
   */
  function internalRingBody(wheel, lod) {
    var r = radii(wheel);
    var teeth = Math.max(6, Math.round(finite(wheel.teeth, 24)));
    // Tête et pied d'une denture INTÉRIEURE : la tête plonge vers le centre,
    // le pied s'écarte vers la jante. C'est l'inverse d'une denture extérieure.
    var tip = Math.min(r.tip, r.pitch - r.module);
    var root = Math.max(r.root, r.pitch + 1.25 * r.module);
    var rim = Math.max(r.pitch + 3 * r.module, root + r.module);
    if (lod <= LEVELS.SILHOUETTE) {
      return [node('path', { class: 'tooth-profile ring-profile', 'fill-rule': 'evenodd',
        d: circlePath(rim) + ' ' + circlePath(tip) })];
    }
    // Au niveau simplifié la denture reste trapézoïdale ; au-delà c'est la
    // vraie développante intérieure, générée par le même moteur que les
    // dentures extérieures.
    var inner = lod === LEVELS.SIMPLIFIED
      ? Profile.toothedRingPath(teeth, tip, root, 0.6)
      : Cache.get({ type: 'internal', teeth: teeth, module: r.module,
        pressureAngle: finite(wheel.pressureAngle, 20), profileShift: finite(wheel.profileShift, 0),
        pitchRadius: r.pitch, tipRadius: tip, rootRadius: root, internal: true });
    return [node('path', { class: 'tooth-profile ring-profile', 'fill-rule': 'evenodd',
      d: circlePath(rim) + ' ' + inner }),
      node('circle', { class: 'ring-rim', r: fixed(root + r.module * 0.35) })];
  }

  /** −1 pour une hélice ou un filet à gauche, +1 à droite. */
  function handOf(wheel) {
    var declared = wheel && (wheel.handedness || wheel.helixHand);
    return declared === 'left' ? -1 : 1;
  }

  function circlePath(radius) {
    var r = fixed(radius);
    return 'M ' + r + ' 0 A ' + r + ' ' + r + ' 0 1 0 ' + fixed(-radius) + ' 0 A ' + r + ' ' + r + ' 0 1 0 ' + r + ' 0 Z';
  }

  function flexibleBody(wheel, lod) {
    var r = radii(wheel);
    var teeth = Math.max(6, Math.round(finite(wheel.teeth, 20)));
    if (lod <= LEVELS.SILHOUETTE) return [node('circle', { class: 'tooth-profile silhouette', r: fixed(r.tip) })];
    var shapes = [node('path', { class: 'tooth-profile',
      d: Profile.toothedRingPath(teeth, r.tip, r.root, wheel.kind === 'sprocket' ? 0.22 : 0.45) })];
    shapes.push(node('circle', { class: 'gear-hub', r: fixed(Math.max(1.2, Math.min(r.root * 0.3, 5 * r.module))) }));
    return shapes;
  }

  /**
   * Vis sans fin : corps cylindrique + filet continu tracé à l'angle d'avance
   * réel, et axe matérialisé — c'est ce qui rend l'entraînement lisible.
   */
  /**
   * §11 à §14 : une vis sans fin vue de côté tourne autour de son axe
   * LONGITUDINAL. Son corps ne bouge donc pas d'un pixel — ce sont les filets
   * hélicoïdaux qui défilent et donnent la phase. Le rendu translatait le
   * groupe entier, corps et axe compris : la vis se promenait le long de son
   * arbre à chaque tour.
   *
   * On sépare donc :
   *   .worm-body / .stage-axis   FIXES
   *   g.worm-thread-phase        SEUL animé, DANS un groupe clippé au corps
   *
   * Le clip était annoncé par ce commentaire et n'existait pas : aucun
   * `clipPath` n'était créé. Le motif, volontairement dessiné deux pas plus
   * loin de chaque côté, débordait donc du corps — et l'animation le faisait
   * défiler dans le vide, filets flottant devant l'arbre. Ce débord reste
   * nécessaire (sans lui un filet disparaîtrait d'un côté avant que le suivant
   * n'entre par l'autre, et la boucle sauterait à chaque tour) : il faut donc
   * bel et bien le masquer, pas le supprimer.
   *
   * Le corps, lui, est un CYLINDRE vu de côté : un rectangle. Il portait
   * `rx = radius`, ce qui en faisait une capsule à extrémités hémisphériques —
   * une forme qu'aucune vis n'a.
   */
  var WORM_MARGIN_PITCHES = 2;

  /**
   * Un identifiant de clip stable et unique par vis. Stable, parce qu'un
   * identifiant tiré d'un compteur changerait à chaque rendu et casserait les
   * exports ; unique, parce que deux vis dans la même chaîne partageraient
   * sinon le même masque, dimensionné pour l'une des deux.
   */
  function wormClipId(wheel) {
    var key = (wheel && (wheel.id || wheel.memberId)) || 'worm';
    return 'worm-clip-' + String(key).replace(/[^A-Za-z0-9_-]/g, '-');
  }

  function wormGeometry(wheel) {
    var r = radii(wheel);
    var radius = Math.max(2, r.pitch);
    var starts = Math.max(1, Math.round(finite(wheel.teeth, 1)));
    return {
      radius: radius,
      length: Math.max(radius * 4, 24 * r.module),
      module: r.module,
      starts: starts,
      // Le pas apparent d'UN filet. Avec n filets, ils sont déphasés de
      // pitch/n : c'est ce qui distingue visuellement une vis 1 filet d'une
      // vis 4 filets, et pas un pas dessiné plus grand.
      pitch: Math.max(1.5 * r.module, Math.PI * r.module * starts),
      lead: rad(finite(wheel.leadAngle, 20))
    };
  }

  function wormBody(wheel, lod, options) {
    var g = wormGeometry(wheel);
    var radius = g.radius, length = g.length;
    // Cylindre vu de côté : pas de `rx`, donc pas d'extrémités arrondies.
    // `options.bare` supprime ce rectangle : vue de biais, la silhouette de la
    // vis est un cylindre à bouts elliptiques, et c'est elle qui la porte —
    // seuls les filets, leur masque et l'axe viennent se poser dedans.
    var bare = !!(options && options.bare);
    var body = bare ? [] : [node('rect', { class: 'tooth-profile worm-body', x: fixed(-length / 2), y: fixed(-radius),
      width: fixed(length), height: fixed(2 * radius) })];
    if (lod <= LEVELS.SILHOUETTE) return body;

    var samples = lod >= LEVELS.INVOLUTE ? 12 : 5;
    var hand = handOf(wheel);
    var margin = WORM_MARGIN_PITCHES * g.pitch;
    var threadPaths = [];
    // Un filet = une sinusoïde apparente : le flanc visible du profil
    // hélicoïdal. Les n filets d'une vis multiple sont régulièrement déphasés.
    for (var start = -length / 2 - margin; start < length / 2 + margin; start += g.pitch) {
      for (var k = 0; k < g.starts; k++) {
        var offset = start + k * g.pitch / g.starts;
        var d = '';
        for (var i = 0; i <= samples; i++) {
          var t = i / samples;
          var x = offset + t * g.pitch / g.starts;
          // §39 : la pente du filet suit le sens déclaré. Sans cela une vis à
          // gauche se dessinait exactement comme une vis à droite, alors que
          // c'est ce sens qui décide de la rotation de la roue.
          var y = -hand * radius * Math.cos(Math.PI * t) * Math.cos(g.lead);
          d += (d ? ' L ' : 'M ') + fixed(x) + ' ' + fixed(y);
        }
        if (d) threadPaths.push(node('path', { class: 'worm-thread', d: d }));
      }
    }
    // Le masque a exactement les bornes du corps : ce qui déborde pour la
    // continuité de l'animation ne sort jamais de la pièce.
    var clipId = wormClipId(wheel);
    body.push({ tag: 'clipPath', attrs: { id: clipId }, children: [
      node('rect', { x: fixed(-length / 2), y: fixed(-radius), width: fixed(length), height: fixed(2 * radius) })
    ] });
    body.push(group({ class: 'worm-thread-clip', 'clip-path': 'url(#' + clipId + ')' },
      [group({ class: 'worm-thread-phase' }, threadPaths)]));
    body.push(node('path', { class: 'stage-axis', d: 'M ' + fixed(-length / 2 - 3 * g.module) + ' 0 H ' + fixed(length / 2 + 3 * g.module) }));
    if (lod >= LEVELS.TECHNICAL) {
      body.push(node('text', { class: 'worm-label', 'text-anchor': 'middle', y: fixed(-radius - 2 * g.module),
        'font-size': fixed(Math.max(2.4, g.module * 2), 1) }, 'γ ' + fixed(finite(wheel.leadAngle, 20), 0) + '° · ' + g.starts + ' filet' + (g.starts > 1 ? 's' : '')));
    }
    return body;
  }

  /**
   * Conique : cône primitif ET cône de tête, denture suggérée sur la génératrice,
   * plus le point d'intersection des axes — la silhouette trapézoïdale seule ne
   * disait rien de l'angle de cône réel.
   */
  function coneBody(wheel, lod) {
    var r = radii(wheel);
    // `apexSide` dit de quel côté de l'organe se trouve le sommet du couple.
    // Sans lui, le cône s'amincit toujours dans le sens de l'axe, c'est-à-dire
    // au hasard de l'orientation que le graphe a donnée à celui-ci : l'un des
    // deux cônes d'un renvoi se dessinait pointe tournée vers l'extérieur.
    var side = finite(wheel.apexSide, 1) < 0 ? -1 : 1;
    var delta = rad(finite(wheel.coneAngleDeg, 45));
    var face = Math.max(3 * r.module, finite(wheel.faceWidth, 8 * r.module));
    var depth = Math.max(2 * r.module, face * Math.cos(delta)) * side;
    var back = r.pitch;
    var front = Math.max(r.module, r.pitch - face * Math.sin(delta));
    var pitchCone = 'M 0 ' + fixed(-back) + ' L ' + fixed(depth) + ' ' + fixed(-front) +
      ' L ' + fixed(depth) + ' ' + fixed(front) + ' L 0 ' + fixed(back) + ' Z';
    var shapes = [node('path', { class: 'tooth-profile cone-body', d: pitchCone })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    var tip = r.tip;
    shapes.push(node('path', { class: 'cone-tip',
      d: 'M 0 ' + fixed(-tip) + ' L ' + fixed(depth) + ' ' + fixed(-front - r.module) +
         ' M 0 ' + fixed(tip) + ' L ' + fixed(depth) + ' ' + fixed(front + r.module) }));
    if (lod >= LEVELS.INVOLUTE) {
      var teeth = Math.max(4, Math.min(24, Math.round(finite(wheel.teeth, 16))));
      var d = '';
      for (var i = 0; i <= teeth; i++) {
        var y = -back + 2 * back * i / teeth;
        var scale = Math.abs(y) / Math.max(1e-6, back);
        d += ' M 0 ' + fixed(y) + ' L ' + fixed(depth) + ' ' + fixed(y * (front / Math.max(1e-6, back)) + (i % 2 ? 1 : -1) * r.module * 0.4 * scale);
      }
      shapes.push(node('path', { class: 'cone-teeth', d: d.trim() }));
    }
    if (lod >= LEVELS.TECHNICAL) {
      // Sommet du cône = intersection des axes, du côté vers lequel le cône se
      // rétrécit : c'est le repère de montage d'un couple conique.
      var apex = side * back / Math.max(1e-6, Math.tan(delta));
      shapes.push(node('path', { class: 'cone-apex', d: 'M ' + fixed(apex) + ' 0 L 0 ' + fixed(-back) + ' M ' + fixed(apex) + ' 0 L 0 ' + fixed(back) }));
      shapes.push(node('circle', { class: 'cone-apex-point', cx: fixed(apex), cy: '0', r: fixed(Math.max(0.6, r.module * 0.6)) }));
    }
    return shapes;
  }

  /** Crémaillère : denture trapézoïdale au pas réel π·m, sur toute la course. */
  function rackBody(wheel, lod) {
    var m = Math.max(1e-6, finite(wheel.module, 1));
    var length = Math.max(4 * m, finite(wheel.length, 100));
    if (lod <= LEVELS.SILHOUETTE) {
      return [node('rect', { class: 'tooth-profile rack-teeth', x: fixed(-length / 2), y: fixed(-m), width: fixed(length), height: fixed(3 * m) })];
    }
    var pitch = Math.PI * m;
    var quarter = pitch / 4;
    var d = 'M ' + fixed(-length / 2) + ' ' + fixed(2.5 * m);
    for (var x = -length / 2; x <= length / 2; x += pitch) {
      d += ' L ' + fixed(x) + ' ' + fixed(1.25 * m) +
        ' L ' + fixed(Math.min(length / 2, x + quarter)) + ' ' + fixed(-m) +
        ' L ' + fixed(Math.min(length / 2, x + pitch - quarter)) + ' ' + fixed(-m) +
        ' L ' + fixed(Math.min(length / 2, x + pitch)) + ' ' + fixed(1.25 * m);
    }
    d += ' L ' + fixed(length / 2) + ' ' + fixed(2.5 * m) + ' Z';
    return [node('path', { class: 'tooth-profile rack-teeth', d: d })];
  }

  // ===== Corps par ORIENTATION =====
  //
  // Une roue était dessinée en cercle quelle que soit la vue. Or un cercle
  // affirme qu'on regarde LE LONG de l'axe. Dès que l'axe est dans le plan de
  // l'écran — ce qui est le cas de tout train déplié — la roue doit devenir un
  // cylindre vu de côté, de largeur b. Sans cela deux roues d'un même arbre,
  // pourtant écartées de leur écart axial réel, se recouvrent quand même, et un
  // pignon placé après un planétaire tombe dans sa couronne.
  //
  // Convention du repère local, la même que celle de la vis depuis toujours :
  // X porte l'AXE de la pièce, Y lui est perpendiculaire. C'est le renderer qui
  // oriente ensuite le groupe suivant l'axe projeté.

  /** Largeur dessinée d'une pièce vue de côté : sa largeur de denture. */
  function faceWidthOf(wheel, r) {
    return Math.max(2 * r.module, finite(wheel.faceWidth, 10 * r.module));
  }

  /**
   * Roue vue de côté : un cylindre. Le diamètre extérieur donne la hauteur, la
   * largeur de denture donne la longueur — les deux cotes que la vue de face ne
   * pouvait pas montrer.
   */
  function gearProfile(wheel, lod) {
    var r = radii(wheel);
    var b = faceWidthOf(wheel, r);
    var shapes = [node('rect', { class: 'tooth-profile gear-profile', x: fixed(-b / 2), y: fixed(-r.tip),
      width: fixed(b), height: fixed(2 * r.tip) })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    // Surface primitive et fond de denture ne sont plus tracés ici : ce sont
    // des SURFACES, et TeethOverlay les dessine pour toutes les présentations —
    // cercles de face, ellipses de biais, génératrices par la tranche. Deux
    // endroits pour un même trait, c'étaient deux occasions de diverger.
    // Le repère d'indexation fixe disparaît aussi : la phase d'une roue vue
    // autrement que de face est portée par le repère mobile de la pose.
    if (lod >= LEVELS.TECHNICAL && Number.isFinite(wheel.helixAngle) && wheel.helixAngle) {
      // Les flancs d'une denture hélicoïdale sont obliques, et leur pente donne
      // le sens de l'hélice.
      var shear = handOf(wheel) * Math.tan(rad(wheel.helixAngle)) * r.tip;
      var stripes = '';
      for (var i = -1; i <= 1; i++) {
        var x = i * b / 3;
        stripes += ' M ' + fixed(x - shear / 4) + ' ' + fixed(-r.tip) + ' L ' + fixed(x + shear / 4) + ' ' + fixed(r.tip);
      }
      shapes.push(node('path', { class: 'helix-stripe', d: stripes.trim() }));
    }
    return shapes;
  }

  /**
   * Couronne intérieure de côté : deux jantes, pas un rectangle plein qu'on
   * confondrait avec une roue. Ce n'est pas une coupe — on ne prétend pas
   * montrer l'intérieur —, seulement le volume annulaire.
   */
  function ringProfile(wheel, lod) {
    var r = radii(wheel);
    var b = faceWidthOf(wheel, r);
    var rim = r.pitch + 3 * r.module;
    var bore = Math.min(r.tip, r.pitch - r.module);
    var shapes = [node('rect', { class: 'tooth-profile ring-profile-top', x: fixed(-b / 2), y: fixed(-rim),
      width: fixed(b), height: fixed(rim - bore) }),
      node('rect', { class: 'tooth-profile ring-profile-bottom', x: fixed(-b / 2), y: fixed(bore),
        width: fixed(b), height: fixed(rim - bore) })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    // Le vide central est marqué en trait conventionnel : il n'est pas dessiné
    // comme une matière qu'on aurait coupée.
    shapes.push(node('path', { class: 'bore-line',
      d: 'M ' + fixed(-b / 2) + ' ' + fixed(-bore) + ' H ' + fixed(b / 2) +
         ' M ' + fixed(-b / 2) + ' ' + fixed(bore) + ' H ' + fixed(b / 2) }));
    return shapes;
  }

  /** Poulie ou pignon de chaîne de côté : largeur réelle, sans dents de face. */
  function flexibleProfile(wheel, lod) {
    var r = radii(wheel);
    var b = faceWidthOf(wheel, r);
    var shapes = [node('rect', { class: 'tooth-profile pulley-profile', x: fixed(-b / 2), y: fixed(-r.tip),
      width: fixed(b), height: fixed(2 * r.tip) })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    // Les joues d'une poulie : ce qui la distingue d'une roue pleine.
    shapes.push(node('path', { class: 'pulley-flange',
      d: 'M ' + fixed(-b / 2) + ' ' + fixed(-r.tip) + ' V ' + fixed(r.tip) +
         ' M ' + fixed(b / 2) + ' ' + fixed(-r.tip) + ' V ' + fixed(r.tip) }));
    return shapes;
  }

  /**
   * Vis vue EN BOUT : son axe pointe vers l'œil. Un cylindre couché n'aurait
   * aucun sens dans cette vue — et surtout aucune translation longitudinale ne
   * doit y apparaître, puisque le mouvement se fait dans la profondeur.
   */
  function wormEnd(wheel, lod) {
    var g = wormGeometry(wheel);
    var shapes = [node('circle', { class: 'tooth-profile worm-end', r: fixed(g.radius) })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    shapes.push(node('circle', { class: 'gear-hub', r: fixed(Math.max(1.2, g.radius * 0.3)) }));
    // Un repère de phase par filet : c'est ce qui rend la rotation visible.
    var marks = '';
    for (var k = 0; k < g.starts; k++) {
      var a = 2 * Math.PI * k / g.starts;
      marks += ' M 0 0 L ' + fixed(Math.cos(a) * g.radius) + ' ' + fixed(Math.sin(a) * g.radius);
    }
    shapes.push(group({ class: 'worm-end-phase' }, [node('path', { class: 'index-mark', d: marks.trim() })]));
    return shapes;
  }

  /** Cône vu de face : la grande face, avec la trace du cône primitif. */
  /**
   * Un cône vu en bout, c'est-à-dire depuis son propre axe : une couronne
   * dentée. La denture est celle de sa section extérieure — la même que celle
   * d'un engrenage droit de même diamètre — et le cercle de la petite face dit
   * jusqu'où elle s'enfonce. Sans elle, la roue conique de sortie d'un renvoi
   * n'était qu'un disque lisse, dans la vue même où l'on veut voir ses dents.
   */
  function coneFace(wheel, lod) {
    var r = radii(wheel);
    if (lod <= LEVELS.SILHOUETTE) return [node('circle', { class: 'tooth-profile cone-face silhouette', r: fixed(r.tip) })];
    var teeth = Math.max(4, Math.round(finite(wheel.teeth, 16)));
    var delta = rad(finite(wheel.coneAngleDeg, 45));
    var face = Math.max(3 * r.module, finite(wheel.faceWidth, 8 * r.module));
    var front = Math.max(r.module, r.pitch - face * Math.sin(delta));
    var shapes = [node('path', { class: 'tooth-profile cone-face',
      d: Profile.toothedRingPath(teeth, r.tip, r.root, 0.5) || '' })];
    shapes.push(node('circle', { class: 'pitch-circle', r: fixed(r.pitch) }));
    shapes.push(node('circle', { class: 'cone-front', r: fixed(front) }));
    var hub = Math.max(1.2, Math.min(front * 0.5, 6 * r.module));
    shapes.push(node('circle', { class: 'gear-hub', r: fixed(hub) }));
    if (lod >= LEVELS.INVOLUTE) {
      shapes.push(node('path', { class: 'hub-cross',
        d: 'M ' + fixed(-hub) + ' 0 H ' + fixed(hub) + ' M 0 ' + fixed(-hub) + ' V ' + fixed(hub) }));
    }
    return shapes;
  }

  // ===== CONTRAT DES PRIMITIVES ORIENTÉES ==============================
  //
  // Une primitive `profile` ou `oblique` est exprimée DANS LE REPÈRE LOCAL DE
  // L'ORGANE. Le renderer pose ce repère une fois :
  //
  //     translate(cx, cy) rotate(axisAngleDeg)
  //
  // si bien que, dans le repère local, l'axe projeté de la pièce est +X. Toute
  // ellipse apparente s'y écrit donc SANS rotation propre :
  //
  //     rx = R × apparent.minor        (le long de l'axe)
  //     ry = R × apparent.major        (en travers de l'axe)
  //
  // C'est vrai parce que `apparent.rotationDeg − axisAngleDeg ≡ 90° [180]` :
  // le grand axe de l'ellipse apparente est toujours perpendiculaire à l'axe
  // projeté. Un test le vérifie plutôt que de le laisser en commentaire.
  //
  // Interdit : mélanger les deux — une ellipse portant `rotate(rotationDeg)`
  // À L'INTÉRIEUR d'un groupe déjà tourné applique la rotation deux fois.
  // ======================================================================

  /** L'ellipse apparente d'un cercle de rayon `radius`, dans le repère local. */
  function apparentEllipse(radius, apparent, attrs) {
    var seen = apparent || { major: 1, minor: 1 };
    return node('ellipse', Object.assign({
      rx: fixed(Math.max(0.2, radius * seen.minor)),
      ry: fixed(Math.max(0.2, radius * seen.major))
    }, attrs || {}));
  }

  // ===== Corps vus DE BIAIS, par famille ================================
  //
  // Une seule primitive générique servait à toutes les familles : en iso, une
  // vis sans fin, un cône et une couronne devenaient trois cylindres
  // identiques. La famille décidait pourtant du dessin de face et du dessin de
  // profil — elle s'arrêtait au seuil de l'oblique, où elle compte tout autant.
  //
  // Toutes travaillent dans le repère LOCAL (voir le contrat plus haut) : axe
  // projeté sur +X, ellipse apparente `rx = R·minor, ry = R·major`. Ce qui
  // suit l'axe se raccourcit de `axialScale`, ce qui le traverse ne bouge pas.

  /** Ce qui reste d'une longueur portée par l'axe, une fois projetée. */
  function axialScaleOf(apparent) {
    var minor = Math.min(1, Math.max(0, finite(apparent && apparent.minor, 0.5)));
    return Math.sqrt(Math.max(0, 1 - minor * minor));
  }

  /**
   * Le cylindre nu.
   *
   * Sa silhouette n'est pas un rectangle : ses deux bouts sont des ellipses.
   * Un rectangle laisse dépasser quatre coins là où la pièce est ronde — c'est
   * visible dès que le raccourci est marqué. Le contour suit donc la moitié
   * ARRIÈRE de la face du fond, les deux génératrices, puis la moitié AVANT de
   * la face de devant.
   */
  function obliqueCylinder(radius, length, seen, classes, lod) {
    var reach = radius * finite(seen.major, 1);
    var flat = Math.max(0.2, radius * finite(seen.minor, 1));
    var half = length / 2;
    var shapes = [node('path', { class: classes.body,
      d: 'M ' + fixed(-half) + ' ' + fixed(-reach) +
         ' A ' + fixed(flat) + ' ' + fixed(reach) + ' 0 0 0 ' + fixed(-half) + ' ' + fixed(reach) +
         ' L ' + fixed(half) + ' ' + fixed(reach) +
         ' A ' + fixed(flat) + ' ' + fixed(reach) + ' 0 0 0 ' + fixed(half) + ' ' + fixed(-reach) + ' Z' })];
    shapes.push(apparentEllipse(radius, seen, { class: classes.face, cx: fixed(half), cy: '0' }));
    if (lod > LEVELS.SILHOUETTE) {
      // La face arrière : c'est elle qui donne l'épaisseur, et qui distingue un
      // cylindre vu de biais d'un disque tordu.
      shapes.push(apparentEllipse(radius, seen, { class: classes.back, cx: fixed(-half), cy: '0' }));
    }
    return shapes;
  }

  /**
   * Un engrenage vu de biais : un cylindre denté.
   *
   * On ne prétend pas faire de la 3D. Le cylindre est décrit par son ellipse
   * apparente — celle que ProjectedScene a calculée pour l'axe de la pièce —
   * épaissie de ce qui reste de sa largeur une fois projetée. Le raccourci
   * n'est plus redérivé ici : c'est `apparent` qui le porte, et c'est la même
   * ellipse qui sert aux surfaces de construction et à la courroie.
   */
  function gearOblique(wheel, lod, apparent) {
    var r = radii(wheel);
    var seen = apparent || { major: 1, minor: 0.5 };
    var thickness = faceWidthOf(wheel, r) * axialScaleOf(seen);
    // Plus de repère d'indexation FIXE en travers de l'ellipse : il ne bougeait
    // pas, et se lisait indifféremment comme un axe, un diamètre ou un sens de
    // rotation. La phase d'une roue oblique est portée par son repère mobile,
    // celui que la pose pilote — et lui seul.
    return obliqueCylinder(r.tip, thickness, seen,
      { body: 'tooth-profile oblique-body', face: 'tooth-profile oblique-face', back: 'oblique-back' }, lod);
  }

  /**
   * Une couronne intérieure vue de biais reste ANNULAIRE.
   *
   * Le corps générique en faisait un cylindre plein : la pièce perdait
   * exactement ce qui la définit — son alésage denté, dans lequel le pignon
   * vient s'engrener. Sa face avant est donc une couronne évidée, et son
   * alésage se poursuit visiblement jusqu'à la face arrière.
   */
  function ringOblique(wheel, lod, apparent) {
    var r = radii(wheel);
    var seen = apparent || { major: 1, minor: 0.5 };
    var rim = r.pitch + 3 * r.module;
    var bore = Math.min(r.tip, r.pitch - r.module);
    var thickness = faceWidthOf(wheel, r) * axialScaleOf(seen);
    var half = thickness / 2;
    var outer = rim * finite(seen.major, 1);
    var inner = bore * finite(seen.major, 1);
    // La silhouette d'un cylindre CREUX, ce sont deux bandes : une jante pleine
    // barrerait justement l'alésage dans lequel le pignon vient s'engrener.
    var shapes = [-1, 1].map(function (side) {
      var from = side < 0 ? -outer : inner;
      return node('path', { class: 'tooth-profile ring-oblique-body',
        d: 'M ' + fixed(-half) + ' ' + fixed(from) + ' h ' + fixed(thickness) +
           ' v ' + fixed(outer - inner) + ' h ' + fixed(-thickness) + ' Z' });
    });
    // La face avant : jante moins alésage, en règle evenodd — le trou est un
    // trou, pas un second disque posé par-dessus.
    shapes.push(node('path', { class: 'tooth-profile ring-oblique-face', 'fill-rule': 'evenodd',
      d: ellipsePath(half, 0, rim, seen) + ' ' + ellipsePath(half, 0, bore, seen) }));
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    shapes.push(apparentEllipse(rim, seen, { class: 'oblique-back', cx: fixed(-half), cy: '0' }));
    // L'alésage traverse la pièce : on le voit au fond.
    shapes.push(apparentEllipse(bore, seen, { class: 'bore-line ring-oblique-bore', cx: fixed(-half), cy: '0' }));
    return shapes;
  }

  /** Un chemin d'ellipse fermé, dans le repère local. */
  function ellipsePath(cx, cy, radius, seen) {
    var rx = Math.max(0.2, radius * finite(seen.minor, 1));
    var ry = Math.max(0.2, radius * finite(seen.major, 1));
    return 'M ' + fixed(cx - rx) + ' ' + fixed(cy) +
      ' a ' + fixed(rx) + ' ' + fixed(ry) + ' 0 1 0 ' + fixed(2 * rx) + ' 0' +
      ' a ' + fixed(rx) + ' ' + fixed(ry) + ' 0 1 0 ' + fixed(-2 * rx) + ' 0 Z';
  }

  /**
   * Poulie et pignon de chaîne vus de biais : un cylindre à GORGE.
   *
   * Sans elle, rien ne distingue une poulie d'un engrenage sur un dessin
   * oblique — or c'est la gorge qui reçoit la courroie, et c'est elle qui
   * explique où le brin s'appuie.
   */
  function flexibleOblique(wheel, lod, apparent) {
    var r = radii(wheel);
    var seen = apparent || { major: 1, minor: 0.5 };
    var thickness = faceWidthOf(wheel, r) * axialScaleOf(seen);
    var shapes = obliqueCylinder(r.tip, thickness, seen,
      { body: 'tooth-profile oblique-body', face: 'tooth-profile oblique-face', back: 'oblique-back' }, lod);
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    // Le fond de gorge, à mi-largeur : la courroie s'appuie là.
    shapes.push(apparentEllipse(r.root, seen, { class: 'flexible-groove', cx: '0', cy: '0' }));
    return shapes;
  }

  /**
   * Un pignon de chaîne vu de biais : un cylindre DENTÉ.
   *
   * Poulie et pignon de chaîne partagent le même cylindre, mais pas la même
   * jante : la poulie a une gorge lisse où la courroie adhère, le pignon a des
   * dents dans lesquelles les maillons se logent. Les confondre en oblique
   * effaçait la seule différence que le dessin doit montrer.
   */
  function sprocketOblique(wheel, lod, apparent) {
    var r = radii(wheel);
    var seen = apparent || { major: 1, minor: 0.5 };
    var thickness = faceWidthOf(wheel, r) * axialScaleOf(seen);
    var shapes = obliqueCylinder(r.tip, thickness, seen,
      { body: 'tooth-profile oblique-body', face: 'tooth-profile oblique-face', back: 'oblique-back' }, lod);
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    var half = thickness / 2;
    // Le fond de denture, sur la face avant : c'est lui qui porte les maillons.
    shapes.push(apparentEllipse(r.root, seen, { class: 'sprocket-oblique-root', cx: fixed(half), cy: '0' }));
    // Et les dents elles-mêmes, en entailles radiales entre fond et tête.
    var teeth = Math.max(6, Math.min(24, Math.round(finite(wheel.teeth, 18))));
    var major = finite(seen.major, 1), minor = finite(seen.minor, 1);
    var d = '';
    for (var i = 0; i < teeth; i++) {
      var a = 2 * Math.PI * i / teeth;
      d += ' M ' + fixed(half + r.root * minor * Math.cos(a)) + ' ' + fixed(r.root * major * Math.sin(a)) +
        ' L ' + fixed(half + r.tip * minor * Math.cos(a)) + ' ' + fixed(r.tip * major * Math.sin(a));
    }
    shapes.push(node('path', { class: 'sprocket-oblique-teeth', d: d.trim() }));
    return shapes;
  }

  /**
   * Une vis sans fin vue de biais : son cylindre RACCOURCI, ses filets, son
   * sens d'hélice.
   *
   * Le corps de profil est déjà juste — filets, pas, sens, masque, groupe de
   * phase animé. Le mettre dans un repère comprimé le long de l'axe suffit à
   * l'amener en oblique sans en réécrire un second, et l'animation continue de
   * défiler dans ce même repère : un pas dessiné reste un pas mécanique.
   */
  function wormOblique(wheel, lod, apparent) {
    var seen = apparent || { major: 1, minor: 0.5 };
    var g = wormGeometry(wheel);
    var squeeze = axialScaleOf(seen);
    // La silhouette d'abord : un cylindre à bouts elliptiques. Le rectangle du
    // dessin de profil laissait quatre coins hors de la pièce dès que le bout
    // s'ouvrait en ellipse.
    var cylinder = obliqueCylinder(g.radius, g.length * squeeze, seen,
      { body: 'tooth-profile worm-body', face: 'tooth-profile oblique-face', back: 'oblique-back' }, lod);
    var shapes = cylinder.length > 2 ? [cylinder[2]] : [];
    shapes.push(cylinder[0]);
    if (lod > LEVELS.SILHOUETTE) {
      // Puis les filets, dans le repère COMPRIMÉ le long de l'axe : un pas
      // dessiné y reste un pas mécanique, et l'animation continue d'y défiler.
      shapes.push(group({ class: 'worm-oblique-seat',
        transform: 'scale(' + fixed(Math.max(0.02, squeeze), 4) + ' ' + fixed(finite(seen.major, 1), 4) + ')' },
        wormBody(wheel, lod, { bare: true })));
    }
    // La face avant ferme la vis par-dessus les filets : c'est elle qui dit de
    // quel côté on la regarde.
    shapes.push(cylinder[1]);
    return shapes;
  }

  /**
   * Un cône vu de biais : deux ellipses et leurs génératrices.
   *
   * Le corps générique en faisait un cylindre — la famille conique disparaissait
   * entièrement du dessin isométrique. La grande base et la petite base sont
   * deux cercles PARALLÈLES portés par l'axe : leurs images sont deux ellipses
   * de même forme, séparées par la longueur projetée du cône.
   *
   * Les génératrices sont tracées entre les extrémités du grand axe des deux
   * ellipses. C'est la construction du dessin technique, exacte lorsque l'axe
   * est dans le plan de l'écran et très proche partout ailleurs ; la silhouette
   * exacte d'un cône demanderait de résoudre le contour apparent, ce que ce
   * dessin ne prétend pas faire.
   */
  function coneOblique(wheel, lod, apparent) {
    var r = radii(wheel);
    var seen = apparent || { major: 1, minor: 0.5 };
    var delta = rad(finite(wheel.coneAngleDeg, 45));
    var face = Math.max(3 * r.module, finite(wheel.faceWidth, 8 * r.module));
    var side = finite(wheel.apexSide, 1) < 0 ? -1 : 1;
    var depth = Math.max(2 * r.module, face * Math.cos(delta)) * axialScaleOf(seen) * side;
    var back = r.pitch;
    var front = Math.max(r.module, r.pitch - face * Math.sin(delta));
    var major = finite(seen.major, 1);
    var minorScale = finite(seen.minor, 1);
    var by = back * major, bx = Math.max(0.2, back * minorScale);
    var fy = front * major, fx = Math.max(0.2, front * minorScale);
    // Le contour suit la moitié ARRIÈRE de la grande base, les deux
    // génératrices, puis la moitié AVANT de la petite : un trapèze laisserait
    // quatre coins hors de la pièce, là où elle est ronde.
    // Les demi-ellipses se retournent avec le cône : la grande base bombe du
    // côté opposé au sommet, la petite du côté du sommet.
    var sweepFront = side > 0 ? 1 : 0, sweepBack = side > 0 ? 1 : 0;
    var shapes = [node('path', { class: 'tooth-profile cone-oblique-body',
      d: 'M 0 ' + fixed(-by) +
         ' L ' + fixed(depth) + ' ' + fixed(-fy) +
         ' A ' + fixed(fx) + ' ' + fixed(fy) + ' 0 0 ' + sweepFront + ' ' + fixed(depth) + ' ' + fixed(fy) +
         ' L 0 ' + fixed(by) +
         ' A ' + fixed(bx) + ' ' + fixed(by) + ' 0 0 ' + sweepBack + ' 0 ' + fixed(-by) + ' Z' })];
    // La grande base ferme le tronc du côté du sommet fuyant ; la petite base
    // est celle qu'on voit en premier.
    shapes.push(apparentEllipse(back, seen, { class: 'cone-oblique-back', cx: '0', cy: '0' }));
    shapes.push(apparentEllipse(front, seen, { class: 'tooth-profile cone-oblique-face', cx: fixed(depth), cy: '0' }));
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    // La denture, en quelques génératrices : elle converge vers le sommet, ce
    // qui est précisément ce qu'un cylindre ne fait pas.
    // Seulement la moitié tournée vers la petite base : l'autre passe derrière
    // le corps, et la dessiner ferait de la pièce un fil de fer.
    var teeth = Math.max(4, Math.min(12, Math.round(finite(wheel.teeth, 16) / 2)));
    var minor = finite(seen.minor, 1);
    var d = '';
    for (var i = 0; i <= teeth; i++) {
      var a = -Math.PI / 2 + Math.PI * i / teeth;
      var from = [back * minor * Math.cos(a), back * major * Math.sin(a)];
      var to = [depth + front * minor * Math.cos(a), front * major * Math.sin(a)];
      d += ' M ' + fixed(from[0]) + ' ' + fixed(from[1]) + ' L ' + fixed(to[0]) + ' ' + fixed(to[1]);
    }
    shapes.push(node('path', { class: 'cone-teeth', d: d.trim() }));
    return shapes;
  }

  // ===== Représentation conventionnelle (style technique) =====
  //
  // Sur un dessin d'ensemble, une roue ne montre pas ses dents. Quatre-vingts
  // développantes exactes n'apprennent rien de plus qu'un cercle, et couvrent
  // le trait qui compte. Le dessin mécanique remplace donc la denture par ses
  // SURFACES : le cercle de tête en trait fort, la surface primitive en trait
  // mixte fin, le fond de denture en trait fin. C'est la convention dont
  // s'inspire ISO 2203 — s'en inspire, sans prétendre la certifier.
  //
  // La denture reste accessible : elle revient de près, quand le niveau de
  // détail la rend lisible, et le style visuel la garde partout.

  /**
   * Le sens d'hélice, en un seul trait.
   *
   * Le style visuel strie tout le disque à l'angle réel, ce qui est juste et
   * lisible quand on regarde une roue. Sur un ensemble technique, seize stries
   * par roue deviennent un motif : un repère oblique unique dit la même chose —
   * à gauche ou à droite — et β se lit dans le résumé de l'organe.
   */
  function helixHandMark(wheel, r) {
    var hand = handOf(wheel);
    var reach = r.pitch * 0.55;
    return [node('path', { class: 'helix-hand',
      d: 'M ' + fixed(-hand * reach * 0.5) + ' ' + fixed(reach * 0.5) +
         ' L ' + fixed(hand * reach * 0.5) + ' ' + fixed(-reach * 0.5) })];
  }

  /** Un engrenage extérieur vu de face : trois surfaces, pas de dents. */
  function gearFaceConventional(wheel, lod) {
    var r = radii(wheel);
    var shapes = [node('circle', { class: 'tip-surface', r: fixed(r.tip) })];
    shapes.push(node('circle', { class: 'pitch-circle', r: fixed(r.pitch) }));
    if (lod > LEVELS.SILHOUETTE) shapes.push(node('circle', { class: 'root-surface', r: fixed(r.root) }));
    return shapes.concat(hubOf(wheel, r, lod));
  }

  /**
   * Une couronne intérieure vue de face. Sa denture est TOURNÉE VERS LE
   * CENTRE : son cercle de tête est plus petit que sa primitive, l'inverse
   * d'une roue extérieure. Sans la jante, rien ne la distinguerait d'un
   * engrenage extérieur une fois la denture retirée.
   */
  function ringFaceConventional(wheel, lod) {
    var r = radii(wheel);
    var rim = Math.max(r.pitch + 3 * r.module, r.root + r.module);
    var shapes = [node('circle', { class: 'rim-surface', r: fixed(rim) })];
    shapes.push(node('circle', { class: 'pitch-circle', r: fixed(r.pitch) }));
    shapes.push(node('circle', { class: 'tip-surface', r: fixed(Math.min(r.tip, r.pitch)) }));
    if (lod > LEVELS.SILHOUETTE) shapes.push(node('circle', { class: 'root-surface', r: fixed(Math.max(r.root, r.pitch)) }));
    return shapes;
  }

  /** Poulie ou pignon de chaîne : le diamètre primitif est ce qui compte. */
  function flexibleFaceConventional(wheel, lod) {
    var r = radii(wheel);
    return [node('circle', { class: 'tip-surface', r: fixed(r.tip) }),
      node('circle', { class: 'pitch-circle', r: fixed(r.pitch) })].concat(hubOf(wheel, r, lod));
  }

  /** Un cône vu en bout : sa grande face, sa primitive, sa petite face. */
  function coneFaceConventional(wheel, lod) {
    var r = radii(wheel);
    var delta = rad(finite(wheel.coneAngleDeg, 45));
    var face = Math.max(3 * r.module, finite(wheel.faceWidth, 8 * r.module));
    var front = Math.max(r.module, r.pitch - face * Math.sin(delta));
    return [node('circle', { class: 'tip-surface', r: fixed(r.tip) }),
      node('circle', { class: 'pitch-circle', r: fixed(r.pitch) }),
      node('circle', { class: 'cone-front', r: fixed(front) })].concat(hubOf(wheel, r, lod));
  }

  /** Le moyeu, seulement s'il est connu : inventer un Ø20 ne renseigne personne. */
  function hubOf(wheel, r, lod) {
    var bore = finite(wheel.boreDiameter, null);
    if (bore === null || !(bore > 0)) return [];
    return [node('circle', { class: 'd-hidden-contour bore-surface', r: fixed(bore / 2) })];
  }

  /**
   * Un engrenage vu par la tranche : un cylindre de largeur b. La surface
   * primitive y est une DROITE, tracée d'un bout à l'autre du corps, et le
   * fond de denture une seconde droite plus près de l'axe. C'est ce couple de
   * traits qui dit « denture » sans dessiner une dent.
   */
  function gearProfileConventional(wheel, lod) {
    var r = radii(wheel);
    var b = faceWidthOf(wheel, r);
    var shapes = [node('rect', { class: 'gear-profile', x: fixed(-b / 2), y: fixed(-r.tip),
      width: fixed(b), height: fixed(2 * r.tip) })];
    [-1, 1].forEach(function (side) {
      shapes.push(node('path', { class: 'pitch-line',
        d: 'M ' + fixed(-b / 2) + ' ' + fixed(side * r.pitch) + ' H ' + fixed(b / 2) }));
      if (lod > LEVELS.SILHOUETTE) {
        shapes.push(node('path', { class: 'root-line',
          d: 'M ' + fixed(-b / 2) + ' ' + fixed(side * r.root) + ' H ' + fixed(b / 2) }));
      }
    });
    return shapes;
  }

  /**
   * Une couronne vue par la tranche : deux jantes, et du vide entre elles.
   * Un rectangle plein la rendrait identique à une roue extérieure — et c'est
   * justement la distinction qui doit survivre au monochrome.
   */
  function ringProfileConventional(wheel, lod) {
    var r = radii(wheel);
    var b = faceWidthOf(wheel, r);
    var rim = Math.max(r.pitch + 3 * r.module, r.root + r.module);
    var inner = Math.min(r.tip, r.pitch);
    var shapes = [];
    [-1, 1].forEach(function (side) {
      var top = side < 0 ? -rim : inner;
      shapes.push(node('rect', { class: side < 0 ? 'ring-profile-top' : 'ring-profile-bottom',
        x: fixed(-b / 2), y: fixed(top), width: fixed(b), height: fixed(rim - inner) }));
      shapes.push(node('path', { class: 'pitch-line',
        d: 'M ' + fixed(-b / 2) + ' ' + fixed(side * r.pitch) + ' H ' + fixed(b / 2) }));
    });
    return shapes;
  }

  /**
   * Une vis sans fin vue par la tranche : son corps, et quelques obliques qui
   * disent le filet et son sens. Une pseudo-hélice détaillée sur un dessin
   * d'ensemble est du bruit ; le nombre de filets et le sens restent lisibles
   * dans le résumé de l'organe.
   */
  function wormProfileConventional(wheel, lod) {
    var r = radii(wheel);
    var g = wormGeometry(wheel);
    var half = g.length / 2;
    var hand = handOf(wheel);
    var shapes = [node('rect', { class: 'worm-body', x: fixed(-half), y: fixed(-r.tip),
      width: fixed(g.length), height: fixed(2 * r.tip) })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    // Une oblique par pas : leur inclinaison porte le sens du filet, leur
    // nombre le pas réel. Aucune n'est décorative.
    var pitch = Math.max(g.pitch, g.length / 24);
    var slant = r.tip * 0.85;
    var marks = '';
    for (var x = -half + pitch / 2; x < half; x += pitch) {
      marks += ' M ' + fixed(x - hand * slant * 0.35) + ' ' + fixed(-r.tip) +
        ' L ' + fixed(x + hand * slant * 0.35) + ' ' + fixed(r.tip);
    }
    if (marks) shapes.push(node('path', { class: 'worm-thread', d: marks.trim() }));
    shapes.push(node('path', { class: 'pitch-line',
      d: 'M ' + fixed(-half) + ' ' + fixed(-r.pitch) + ' H ' + fixed(half) +
         ' M ' + fixed(-half) + ' ' + fixed(r.pitch) + ' H ' + fixed(half) }));
    return shapes;
  }

  /**
   * Un cône vu par la tranche : son cône primitif et son sommet. Sur un
   * ensemble, un renvoi d'angle doit se lire comme un renvoi avant de se lire
   * comme une denture.
   */
  function coneProfileConventional(wheel, lod) {
    var r = radii(wheel);
    var delta = rad(finite(wheel.coneAngleDeg, 45));
    var face = Math.max(3 * r.module, finite(wheel.faceWidth, 8 * r.module));
    var depth = Math.max(2 * r.module, face * Math.cos(delta));
    var front = Math.max(r.module, r.pitch - face * Math.sin(delta));
    var shapes = [node('path', { class: 'cone-body',
      d: 'M 0 ' + fixed(-r.pitch) + ' L ' + fixed(depth) + ' ' + fixed(-front) +
         ' L ' + fixed(depth) + ' ' + fixed(front) + ' L 0 ' + fixed(r.pitch) + ' Z' })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    var apex = r.pitch / Math.max(1e-6, Math.tan(delta));
    shapes.push(node('path', { class: 'cone-apex',
      d: 'M ' + fixed(apex) + ' 0 L 0 ' + fixed(-r.pitch) + ' M ' + fixed(apex) + ' 0 L 0 ' + fixed(r.pitch) }));
    shapes.push(node('circle', { class: 'cone-apex-point', cx: fixed(apex), cy: '0',
      r: fixed(Math.max(0.6, r.module * 0.6)) }));
    return shapes;
  }

  /** Une crémaillère : sa ligne primitive, sa tête, son pied. Pas de dents. */
  function rackProfileConventional(wheel, lod) {
    var m = Math.max(0.2, finite(wheel.module, 1));
    var length = Math.max(6 * m, finite(wheel.length, 40 * m));
    var half = length / 2;
    var shapes = [node('rect', { class: 'rack-profile', x: fixed(-half), y: '0',
      width: fixed(length), height: fixed(2.5 * m) })];
    shapes.push(node('path', { class: 'pitch-line', d: 'M ' + fixed(-half) + ' 0 H ' + fixed(half) }));
    if (lod > LEVELS.SILHOUETTE) {
      shapes.push(node('path', { class: 'root-line',
        d: 'M ' + fixed(-half) + ' ' + fixed(1.25 * m) + ' H ' + fixed(half) }));
    }
    return shapes;
  }

  var CONVENTIONAL_FACE = { gear: gearFaceConventional, 'internal-ring': ringFaceConventional,
    pulley: flexibleFaceConventional, sprocket: flexibleFaceConventional,
    worm: flexibleFaceConventional, cone: coneFaceConventional };
  var CONVENTIONAL_PROFILE = { gear: gearProfileConventional, 'internal-ring': ringProfileConventional,
    pulley: gearProfileConventional, sprocket: gearProfileConventional,
    worm: wormProfileConventional, cone: coneProfileConventional, rack: rackProfileConventional };

  /**
   * Le niveau à partir duquel le style technique consent à dessiner des dents.
   * Le mode s'appelle « technique », pas « détaillé » : rendre la développante
   * partout parce qu'on a changé de style serait exactement le bruit que la
   * représentation conventionnelle existe pour éviter.
   */
  var CONVENTIONAL_UNTIL = LEVELS.INVOLUTE;

  function conventional(wheel, presentation, lod) {
    if (lod > CONVENTIONAL_UNTIL) return null;              // de très près, la denture reprend
    var table = presentation === 'profile' ? CONVENTIONAL_PROFILE
      : presentation === 'face' ? CONVENTIONAL_FACE : null;
    if (!table) return null;                                 // oblique : pas de convention établie
    var draw = table[wheel.kind];
    return draw ? draw(wheel, lod) : null;
  }

  var BODIES = { gear: gearBody, 'internal-ring': internalRingBody, pulley: flexibleBody, sprocket: flexibleBody,
    worm: wormBody, cone: coneBody, rack: rackBody };

  /** Corps de côté, par famille. La vis et la crémaillère l'étaient déjà. */
  var PROFILES = { gear: gearProfile, 'internal-ring': ringProfile, pulley: flexibleProfile,
    sprocket: flexibleProfile, worm: wormBody, cone: coneBody, rack: rackBody };

  /** Corps vus dans l'axe. La plupart des familles y gardent leur dessin de face. */
  var FACES = { worm: wormEnd, cone: coneFace };

  /**
   * Corps vus DE BIAIS. La famille s'arrêtait au seuil de l'oblique : une vis,
   * un cône et une couronne y devenaient trois cylindres identiques.
   */
  var OBLIQUES = { gear: gearOblique, 'internal-ring': ringOblique, pulley: flexibleOblique,
    sprocket: sprocketOblique, worm: wormOblique, cone: coneOblique, rack: rackBody };

  /**
   * build(wheel, options) → { rotor, fixed }
   * `rotor` tourne avec la roue, `fixed` reste solidaire du centre (étiquettes).
   */
  function build(wheel, options) {
    options = options || {};
    var lod = finite(options.lod, LEVELS.INVOLUTE);
    // L'orientation se DEMANDE. Sans elle, on rend exactement le dessin
    // historique : une vis y était déjà couchée, un cône déjà en trapèze, et
    // faire de `face` un défaut aurait retourné ces deux familles en silence.
    var asked = options.presentation;
    var presentation = asked === 'profile' || asked === 'oblique' || asked === 'face' ? asked : null;
    var body;
    // Le style TECHNIQUE remplace la denture par ses surfaces tant que le
    // dessin reste un dessin d'ensemble. Il ne change rien à la mécanique :
    // mêmes diamètres, même organe, même identité.
    var drafted = options.style === 'technical' ? conventional(wheel, presentation, lod) : null;
    if (drafted) {
      body = drafted;
    } else if (presentation === 'oblique') {
      // `apparent` est la description complète de l'ellipse projetée. Le
      // raccourci seul en est un cas particulier — grand axe unitaire —, et
      // reste accepté pour les appelants qui n'ont que lui.
      body = (OBLIQUES[wheel.kind] || gearOblique)(wheel, lod, options.apparent ||
        (Number.isFinite(options.foreshortening) ? { major: 1, minor: options.foreshortening } : null));
    } else if (presentation === 'profile') {
      body = (PROFILES[wheel.kind] || gearProfile)(wheel, lod);
    } else if (presentation === 'face') {
      body = (FACES[wheel.kind] || BODIES[wheel.kind] || gearBody)(wheel, lod);
    } else {
      body = (BODIES[wheel.kind] || gearBody)(wheel, lod);
    }
    // Les stries d'hélice décrivent une denture vue de FACE : de profil, c'est
    // la pente des flancs qui porte l'information, et elle est déjà tracée.
    // Les stries d'hélice décrivent une denture vue de FACE. En technique, elles
    // rempliraient le disque d'un motif décoratif là où un seul repère de sens
    // suffit — β et le sens se lisent dans le résumé de l'organe.
    if (!drafted && presentation !== 'profile' && presentation !== 'oblique'
      && wheel.kind === 'gear' && Number.isFinite(wheel.helixAngle) && wheel.helixAngle) {
      body = body.concat(helicalMarks(wheel, lod));
    }
    if (drafted && presentation === 'face' && Number.isFinite(wheel.helixAngle) && wheel.helixAngle) {
      body = body.concat(helixHandMark(wheel, radii(wheel)));
    }
    // `fixed` porte ce qui suit la PIÈCE — géométrie, hachures de bâti ;
    // `upright` ce qui doit rester lisible à l'écran — les textes. Les mêler
    // obligeait à contre-tourner un groupe qui contenait aussi de la géométrie :
    // le trait y prenait alors une orientation que la pièce n'a pas.
    var labels = [];
    var upright = [];
    var r = radii(wheel);
    // Z=n reste hors du rotor (il ne doit pas tourner) et disparaît quand la
    // roue est trop petite pour rester lisible.
    if (lod >= LEVELS.SIMPLIFIED && wheel.teeth > 0 && wheel.kind !== 'worm' && presentation !== 'profile' && !drafted) {
      var y = wheel.kind === 'internal-ring' ? -(r.pitch + 2.6 * r.module) : -r.root * 0.5;
      var size = Math.max(2.6, Math.min(r.root * 0.3, 10));
      if (wheel.kind === 'internal-ring' || r.root > 6) {
        upright.push(node('text', { class: 'tooth-count', 'text-anchor': 'middle', y: fixed(y, 1), 'font-size': fixed(size, 1) }, 'Z=' + wheel.teeth));
      }
    }
    // §18 : un organe bloqué porte les hachures de bâti. Elles vont dans
    // `fixed` — pas dans le rotor — puisque justement rien ne tourne.
    if (wheel.functionalRole === 'fixed' && Ground) {
      // Les hachures épousent le contour APPARENT de l'organe : un anneau
      // circulaire autour d'une roue elliptique dessinerait un bord absent.
      labels = labels.concat(Ground.ring(0, 0, groundRadius(wheel, r),
        { length: r.module * 1.6, apparent: options.apparent }));
    }
    // Un texte glissé dans le corps tournerait avec lui : on les remonte tous
    // dans `upright`, où ils restent droits et lisibles.
    body = body.filter(function (shape) {
      if (!shape.attrs || !/upright-annotation/.test(shape.attrs.class || '')) return true;
      upright.push(shape);
      return false;
    });
    return { rotor: body, fixed: labels, upright: upright, lod: lod, presentation: presentation,
      conventional: !!drafted };
  }

  /**
   * Rayon sur lequel poser le bâti : le contour EXTÉRIEUR de la pièce. Pour une
   * couronne c'est la jante, pas le diamètre de tête — la denture d'une
   * couronne plonge vers le centre, hachurer sur `tip` mettrait le bâti au
   * milieu du trou.
   */
  function groundRadius(wheel, r) {
    if (wheel.kind === 'internal-ring') return Math.max(r.pitch + 3 * r.module, r.root + r.module) + r.module * 0.4;
    return r.tip + r.module * 0.4;
  }

  return { LEVELS: LEVELS, THRESHOLDS: THRESHOLDS, TECHNICAL_THRESHOLDS: TECHNICAL_THRESHOLDS,
    level: level, levelFor: levelFor, build: build,
    conventional: conventional, CONVENTIONAL_UNTIL: CONVENTIONAL_UNTIL,
    radii: radii, circlePath: circlePath, node: node, group: group,
    apparentEllipse: apparentEllipse, faceWidthOf: faceWidthOf,
    wormGeometry: wormGeometry, wormClipId: wormClipId, WORM_MARGIN_PITCHES: WORM_MARGIN_PITCHES,
    groundRadius: groundRadius };
});
