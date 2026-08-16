/* Génération du profil de denture en développante de cercle.
 *
 * Conventions et rappels (tout en radians, rayons en millimètres) :
 *   rb  = r · cos(α)                     cercle de BASE, unique générateur du flanc
 *   inv(α) = tan(α) − α                  fonction développante
 *   s   = m · (π/2 + 2·x·tan α)          épaisseur de dent AU CERCLE PRIMITIF
 *   ψp  = s / (2r)                       demi-épaisseur angulaire au primitif
 *   ψb  = ψp + inv(α)                    demi-épaisseur angulaire au cercle de base
 *   ψ(r)= ψb − inv(α(r))                 demi-épaisseur à un rayon quelconque
 *
 * Point clé : le flanc est TOUJOURS la développante du cercle de base réel.
 * Quand le cercle de pied est au-dessus du cercle de base (grandes dentures),
 * on démarre la courbe plus loin sur la même développante — on ne remplace
 * jamais rb, sous peine de générer une courbe qui n'est plus une développante.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearToothProfile = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  function rad(d) { return d * Math.PI / 180; }
  function fixed(v) { return finite(v, 0).toFixed(3); }

  /** inv(α) = tan α − α. */
  function inv(alpha) { return Math.tan(alpha) - alpha; }

  /** Développante au rayon r : inv(α(r)) avec cos α(r) = rb / r. */
  function involuteAt(rb, r) {
    if (!(rb > 0) || r <= rb) return 0;
    // t = tan α(r) = sqrt((r/rb)² − 1) ; inv(α) = t − atan(t).
    var t = Math.sqrt((r / rb) * (r / rb) - 1);
    return t - Math.atan(t);
  }

  /** Rayon où inv(α(r)) = value : réciproque de involuteAt, par Newton. */
  function radiusAtInvolute(rb, value) {
    if (!(rb > 0) || !(value > 0)) return rb;
    var t = Math.max(0.1, Math.cbrt(3 * value));   // amorce : inv(α) ≈ t³/3
    for (var i = 0; i < 40; i++) {
      var f = t - Math.atan(t) - value;
      var df = t * t / (1 + t * t);
      if (!(df > 1e-12)) break;
      var next = t - f / df;
      if (!Number.isFinite(next) || next <= 0) break;
      if (Math.abs(next - t) < 1e-12) { t = next; break; }
      t = next;
    }
    return rb * Math.sqrt(1 + t * t);
  }

  /**
   * Points d'un flanc, du rayon `fromR` au rayon `toR`, sur la développante du
   * cercle de base `rb`. `baseAngle` est l'angle du point de rebroussement
   * (r = rb) et `direction` le sens dans lequel la développante se déroule.
   * Compatible avec l'ancien appel involutePoints(rb, tipR, angle, dir, count).
   */
  function involutePoints(rb, toR, baseAngle, direction, count, fromR) {
    var points = [];
    if (!(rb > 0)) return points;
    var start = Math.max(finite(fromR, rb), rb);
    var end = Math.max(finite(toR, rb), rb);
    var t0 = Math.sqrt(Math.max(0, (start / rb) * (start / rb) - 1));
    var t1 = Math.sqrt(Math.max(0, (end / rb) * (end / rb) - 1));
    var steps = Math.max(2, Math.round(finite(count, 8)));
    for (var i = 0; i <= steps; i++) {
      var t = t0 + (t1 - t0) * i / steps;
      var r = rb * Math.sqrt(1 + t * t);
      var a = baseAngle + direction * (t - Math.atan(t));
      points.push({ x: r * Math.cos(a), y: r * Math.sin(a), r: r, angle: a });
    }
    return points;
  }

  /**
   * Description complète d'une denture avant tracé — c'est elle que valident
   * les tests géométriques : rayon de base, demi-épaisseurs, bornes du flanc.
   */
  function describe(teeth, pitchR, tipR, rootR, pressureAngle, options) {
    options = options || {};
    var z = Math.max(3, Math.round(finite(teeth, 12)));
    var r = Math.max(1e-6, finite(pitchR, 12));
    var alpha = rad(finite(pressureAngle, 20));
    var shift = finite(options.profileShift, 0);
    var internal = !!options.internal;
    var rb = r * Math.cos(alpha);
    var tip = Math.max(1e-6, finite(tipR, internal ? r * 0.9 : r * 1.1));
    var rootRadius = Math.max(1e-6, finite(rootR, internal ? r * 1.1 : r * 0.9));

    // Épaisseur au primitif : s = m(π/2 + 2x·tanα), donc ψp = (π/2 + 2x·tanα)/z.
    // Une denture intérieure a pour dent le creux de la denture conjuguée : le
    // déport y agit en sens inverse.
    var psiPitch = (Math.PI / 2 + (internal ? -2 : 2) * shift * Math.tan(alpha)) / z;
    var psiBase = psiPitch + inv(alpha);

    // Au-delà de ce rayon les deux flancs se croisent : la dent est pointue.
    var pointed = radiusAtInvolute(rb, psiBase);

    // Le flanc vit entre le plus petit et le plus grand des deux rayons, jamais
    // sous le cercle de base et jamais au-delà de la dent pointue.
    var lo = Math.max(Math.min(tip, rootRadius), rb);
    var hi = Math.min(Math.max(tip, rootRadius), pointed);
    if (hi < lo) hi = lo;
    var clamp = function (value) { return Math.min(Math.max(value, lo), hi); };

    return { teeth: z, pitchRadius: r, baseRadius: rb, tipRadius: tip, rootRadius: rootRadius,
      pressureAngle: alpha, profileShift: shift, internal: internal,
      halfThicknessPitch: psiPitch, halfThicknessBase: psiBase, pointedRadius: pointed,
      flankFrom: lo, flankTo: hi, crestR: clamp(tip), gapR: clamp(rootRadius),
      angularPitch: 2 * Math.PI / z,
      /** Demi-épaisseur angulaire de la dent à un rayon donné. */
      halfThicknessAt: function (radius) { return psiBase - involuteAt(rb, radius); },
      /** Angle du flanc gauche (−) ou droit (+) d'une dent centrée en `center`. */
      flankAngle: function (center, radius, side) {
        return center + side * (psiBase - involuteAt(rb, radius));
      } };
  }

  function polar(r, a) { return fixed(r * Math.cos(a)) + ' ' + fixed(r * Math.sin(a)); }

  /**
   * gearPath(teeth, pitchR, tipR, rootR, pressureAngle, options)
   * Contour fermé d'une denture complète. Extérieure par défaut ;
   * `options.internal` produit le contour intérieur d'une couronne (dents vers
   * le centre), directement utilisable en règle evenodd sous une jante.
   */
  function gearPath(teeth, pitchR, tipR, rootR, pressureAngle, options) {
    var g = describe(teeth, pitchR, tipR, rootR, pressureAngle, options);
    var samples = Math.max(3, Math.round(finite(options && options.samples, 10)));
    var radialGap = Math.abs(g.rootRadius - g.gapR) > 1e-9;
    var root = fixed(g.rootRadius), crest = fixed(g.crestR);
    var start = null, d = '';
    // Le tracé progresse par angles croissants : les creux et les têtes sont de
    // vrais arcs de cercle, pas des approximations polygonales.
    for (var i = 0; i < g.teeth; i++) {
      var center = i * g.angularPitch;
      var gapLeft = g.flankAngle(center, g.gapR, -1);
      var gapRight = g.flankAngle(center, g.gapR, 1);

      if (!start) { start = polar(g.rootRadius, gapLeft); d = 'M ' + start; }
      else d += ' A ' + root + ' ' + root + ' 0 0 1 ' + polar(g.rootRadius, gapLeft);
      // Raccord radial quand le pied passe sous le cercle de base : sous rb il
      // n'existe aucune développante, seulement le dégagement de taillage.
      if (radialGap) d += ' L ' + polar(g.gapR, gapLeft);

      // Le premier point de chaque flanc coïncide avec la commande précédente
      // (raccord radial ou arc de tête) : on ne le répète pas.
      involutePoints(g.baseRadius, g.crestR, center - g.halfThicknessBase, 1, samples, g.gapR)
        .slice(radialGap ? 1 : 0).forEach(function (p) { d += ' L ' + fixed(p.x) + ' ' + fixed(p.y); });
      d += ' A ' + crest + ' ' + crest + ' 0 0 1 ' + polar(g.crestR, g.flankAngle(center, g.crestR, 1));
      involutePoints(g.baseRadius, g.gapR, center + g.halfThicknessBase, -1, samples, g.crestR)
        .slice(1).forEach(function (p) { d += ' L ' + fixed(p.x) + ' ' + fixed(p.y); });

      if (radialGap) d += ' L ' + polar(g.rootRadius, gapRight);
    }
    // Dernier creux refermé par un arc, pas par une corde.
    return start ? d + ' A ' + root + ' ' + root + ' 0 0 1 ' + start + ' Z' : '';
  }

  /**
   * Denture trapézoïdale : poulies, pignons de chaîne, et niveaux de détail
   * grossiers où le tracé exact n'apporterait rien à l'écran.
   */
  function toothedRingPath(teeth, outerR, innerR, duty) {
    teeth = Math.max(4, Math.round(finite(teeth, 12)));
    var pitch = 2 * Math.PI / teeth, w = pitch * (duty || 0.35) / 2, parts = [];
    for (var i = 0; i < teeth; i++) {
      var a = i * pitch;
      [[innerR, a - pitch / 2], [innerR, a - w], [outerR, a - w * .6], [outerR, a + w * .6], [innerR, a + w]]
        .forEach(function (p) { parts.push(fixed(p[0] * Math.cos(p[1])) + ' ' + fixed(p[0] * Math.sin(p[1]))); });
    }
    return parts.length ? 'M ' + parts.join(' L ') + ' Z' : '';
  }

  return { involutePoints: involutePoints, gearPath: gearPath, toothedRingPath: toothedRingPath,
    describe: describe, inv: inv, involuteAt: involuteAt, radiusAtInvolute: radiusAtInvolute };
});
