/* Cache des tracés de denture.
 *
 * Les roues identiques d'un train ne recalculent pas leur profil. La clé doit
 * donc décrire EXACTEMENT ce qui entre dans le tracé : deux roues nominalement
 * identiques mais taillées à des rayons différents (addendum modifié, jeu
 * spécifique, géométrie personnalisée) ne doivent jamais partager un tracé.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./ToothProfile.js') : root.GearToothProfile);
  if (common) module.exports = api; else root.GearToothProfileCache = api;
})(typeof self !== 'undefined' ? self : this, function (Profile) {
  'use strict';
  var cache = new Map();
  var LIMIT = 512;

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  /** Arrondi de clé : 1/1000 de mm, bien en deçà du pouvoir séparateur du tracé. */
  function q(value) { return Number.isFinite(value) ? value.toFixed(3) : 'x'; }

  function radii(o) {
    var teeth = Math.max(1, finite(o.teeth, 12));
    var module_ = finite(o.module, 1);
    var pitch = finite(o.pitchRadius, teeth * module_ / 2);
    return {
      pitch: pitch,
      tip: finite(o.tipRadius, o.internal ? pitch - module_ : pitch + module_),
      root: finite(o.rootRadius, o.internal ? pitch + 1.25 * module_ : Math.max(1, pitch - 1.25 * module_)),
      outer: finite(o.outerRadius, null),
      inner: finite(o.innerRadius, null)
    };
  }

  /** Clé : nomenclature ET rayons réellement utilisés pour générer le tracé. */
  function key(o) {
    o = o || {};
    var r = radii(o);
    return [o.type || 'spur', 'z' + finite(o.teeth, 12), 'm' + q(o.module),
      'pa' + q(finite(o.pressureAngle, 20)), 'ha' + q(finite(o.helixAngle, 0)),
      'x' + q(finite(o.profileShift, 0)), o.internal ? 'i' : 'e',
      'r' + q(r.pitch), 'a' + q(r.tip), 'f' + q(r.root),
      'o' + q(r.outer), 'n' + q(r.inner)].join(':');
  }

  function get(options) {
    var k = key(options);
    if (!cache.has(k)) {
      var r = radii(options);
      var path = options.internal && !(r.outer > 0)
        ? Profile.gearPath(options.teeth, r.pitch, r.tip, r.root, options.pressureAngle,
          { internal: true, profileShift: options.profileShift })
        : options.internal
          ? Profile.toothedRingPath(options.teeth, r.outer, r.inner)
          : Profile.gearPath(options.teeth, r.pitch, r.tip, r.root, options.pressureAngle,
            { profileShift: options.profileShift });
      // Garde-fou mémoire : un train très varié ne doit pas faire grossir le
      // cache indéfiniment (les entrées les plus anciennes sortent en premier).
      if (cache.size >= LIMIT) cache.delete(cache.keys().next().value);
      cache.set(k, path);
    }
    return cache.get(k);
  }

  return { get: get, key: key, clear: function () { cache.clear(); }, size: function () { return cache.size; }, LIMIT: LIMIT };
});
