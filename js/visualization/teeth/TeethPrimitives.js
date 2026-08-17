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

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function rad(deg) { return deg * Math.PI / 180; }
  function fixed(value, digits) { return finite(value, 0).toFixed(digits == null ? 2 : digits); }
  function node(tag, attrs, text) { return { tag: tag, attrs: attrs, text: text }; }

  /** Groupe de descripteurs : le rendu le matérialise avec ses enfants. */
  function group(attrs, children) { return { tag: 'g', attrs: attrs, children: children }; }

  /** level(diameterPx) → niveau de détail pour une roue de ce diamètre écran. */
  function level(diameterPx) {
    var size = finite(diameterPx, 0);
    for (var i = 0; i < THRESHOLDS.length; i++) if (size < THRESHOLDS[i]) return i;
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
    return level(apparent * finite(pixelsPerUnit, 1));
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
      marks.push(node('text', { class: 'helix-label', 'text-anchor': 'middle', y: fixed(r.pitch * 0.86),
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

  function wormBody(wheel, lod) {
    var g = wormGeometry(wheel);
    var radius = g.radius, length = g.length;
    // Cylindre vu de côté : pas de `rx`, donc pas d'extrémités arrondies.
    var body = [node('rect', { class: 'tooth-profile worm-body', x: fixed(-length / 2), y: fixed(-radius),
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
    var delta = rad(finite(wheel.coneAngleDeg, 45));
    var face = Math.max(3 * r.module, finite(wheel.faceWidth, 8 * r.module));
    var depth = Math.max(2 * r.module, face * Math.cos(delta));
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
      var apex = back / Math.max(1e-6, Math.tan(delta));
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
    // Surface primitive et fond de denture : les deux traits conventionnels qui
    // distinguent une roue d'un simple cylindre.
    shapes.push(node('path', { class: 'pitch-line',
      d: 'M ' + fixed(-b / 2) + ' ' + fixed(-r.pitch) + ' H ' + fixed(b / 2) +
         ' M ' + fixed(-b / 2) + ' ' + fixed(r.pitch) + ' H ' + fixed(b / 2) }));
    if (lod >= LEVELS.INVOLUTE) {
      shapes.push(node('path', { class: 'root-line',
        d: 'M ' + fixed(-b / 2) + ' ' + fixed(-r.root) + ' H ' + fixed(b / 2) +
           ' M ' + fixed(-b / 2) + ' ' + fixed(r.root) + ' H ' + fixed(b / 2) }));
      // Un repère d'indexation : la silhouette d'un cylindre qui tourne ne
      // change pas, il faut donc autre chose pour voir qu'il tourne.
      shapes.push(node('path', { class: 'index-mark', d: 'M 0 ' + fixed(-r.root) + ' V ' + fixed(r.root) }));
    }
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
  function coneFace(wheel, lod) {
    var r = radii(wheel);
    var shapes = [node('circle', { class: 'tooth-profile cone-face', r: fixed(r.tip) })];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    shapes.push(node('circle', { class: 'pitch-circle', r: fixed(r.pitch) }));
    shapes.push(node('circle', { class: 'gear-hub', r: fixed(Math.max(1.2, r.pitch * 0.25)) }));
    return shapes;
  }

  /**
   * Vue oblique : ni un disque, ni un rectangle.
   *
   * On ne prétend pas faire de la 3D. Une ellipse dont le petit axe vaut le
   * raccourci réel, épaissie le long de l'axe, suffit à montrer immédiatement
   * qu'une pièce n'est ni de face ni de profil — c'est tout ce qu'on lui
   * demande.
   */
  function obliqueBody(wheel, lod, foreshortening) {
    var r = radii(wheel);
    var squeeze = Math.min(1, Math.max(0.05, finite(foreshortening, 0.5)));
    var b = faceWidthOf(wheel, r);
    // L'épaisseur apparente d'une pièce est ce qui reste de sa largeur quand on
    // ne la voit plus tout à fait de face.
    var thickness = b * Math.sqrt(Math.max(0, 1 - squeeze * squeeze));
    var rx = r.tip * squeeze;
    var shapes = [
      node('path', { class: 'tooth-profile oblique-body',
        d: 'M ' + fixed(-thickness / 2) + ' ' + fixed(-r.tip) + ' h ' + fixed(thickness) +
           ' v ' + fixed(2 * r.tip) + ' h ' + fixed(-thickness) + ' Z' }),
      node('ellipse', { class: 'tooth-profile oblique-face', cx: fixed(thickness / 2), cy: '0',
        rx: fixed(Math.max(0.4, rx)), ry: fixed(r.tip) })
    ];
    if (lod <= LEVELS.SILHOUETTE) return shapes;
    shapes.push(node('ellipse', { class: 'oblique-back', cx: fixed(-thickness / 2), cy: '0',
      rx: fixed(Math.max(0.4, rx)), ry: fixed(r.tip) }));
    shapes.push(node('path', { class: 'index-mark',
      d: 'M ' + fixed(thickness / 2) + ' ' + fixed(-r.tip) + ' V ' + fixed(r.tip) }));
    return shapes;
  }

  var BODIES = { gear: gearBody, 'internal-ring': internalRingBody, pulley: flexibleBody, sprocket: flexibleBody,
    worm: wormBody, cone: coneBody, rack: rackBody };

  /** Corps de côté, par famille. La vis et la crémaillère l'étaient déjà. */
  var PROFILES = { gear: gearProfile, 'internal-ring': ringProfile, pulley: flexibleProfile,
    sprocket: flexibleProfile, worm: wormBody, cone: coneBody, rack: rackBody };

  /** Corps vus dans l'axe. La plupart des familles y gardent leur dessin de face. */
  var FACES = { worm: wormEnd, cone: coneFace };

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
    if (presentation === 'oblique') {
      body = obliqueBody(wheel, lod, options.foreshortening);
    } else if (presentation === 'profile') {
      body = (PROFILES[wheel.kind] || gearProfile)(wheel, lod);
    } else if (presentation === 'face') {
      body = (FACES[wheel.kind] || BODIES[wheel.kind] || gearBody)(wheel, lod);
    } else {
      body = (BODIES[wheel.kind] || gearBody)(wheel, lod);
    }
    // Les stries d'hélice décrivent une denture vue de FACE : de profil, c'est
    // la pente des flancs qui porte l'information, et elle est déjà tracée.
    if (presentation !== 'profile' && presentation !== 'oblique' && wheel.kind === 'gear' && Number.isFinite(wheel.helixAngle) && wheel.helixAngle) {
      body = body.concat(helicalMarks(wheel, lod));
    }
    var labels = [];
    var r = radii(wheel);
    // Z=n reste hors du rotor (il ne doit pas tourner) et disparaît quand la
    // roue est trop petite pour rester lisible.
    if (lod >= LEVELS.SIMPLIFIED && wheel.teeth > 0 && wheel.kind !== 'worm' && presentation !== 'profile') {
      var y = wheel.kind === 'internal-ring' ? -(r.pitch + 2.6 * r.module) : -r.root * 0.5;
      var size = Math.max(2.6, Math.min(r.root * 0.3, 10));
      if (wheel.kind === 'internal-ring' || r.root > 6) {
        labels.push(node('text', { class: 'tooth-count', 'text-anchor': 'middle', y: fixed(y, 1), 'font-size': fixed(size, 1) }, 'Z=' + wheel.teeth));
      }
    }
    // §18 : un organe bloqué porte les hachures de bâti. Elles vont dans
    // `fixed` — pas dans le rotor — puisque justement rien ne tourne.
    if (wheel.functionalRole === 'fixed' && Ground) {
      labels = labels.concat(Ground.ring(0, 0, groundRadius(wheel, r), { length: r.module * 1.6 }));
    }
    return { rotor: body, fixed: labels, lod: lod, presentation: presentation };
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

  return { LEVELS: LEVELS, THRESHOLDS: THRESHOLDS, level: level, levelFor: levelFor, build: build,
    radii: radii, circlePath: circlePath, node: node, group: group,
    wormGeometry: wormGeometry, wormClipId: wormClipId, WORM_MARGIN_PITCHES: WORM_MARGIN_PITCHES,
    groundRadius: groundRadius };
});
