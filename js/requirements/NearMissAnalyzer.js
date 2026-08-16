// NearMissAnalyzer.js - « Aucun résultat » n'est pas une réponse.
//
// Choix 14C. Lister les contraintes actives en disant « c'est peut-être l'une
// d'elles » n'aide personne. Ce qui aide, c'est :
//
//   Aucune solution.
//   Blocage principal : Ø max = 80 mm
//   La meilleure architecture atteint 83,6 mm
//   Si Ø max passe à 84 mm → 23 solutions deviennent disponibles
//   [Accepter 84 mm]
//
// Le moteur n'a pas été modifié pour ça : il ne renvoie que les solutions qui
// passent, donc l'analyse a besoin d'un VIVIER SONDE — la même recherche, les
// contraintes de qualification levées, le besoin fonctionnel intact. Le module
// ne lance rien lui-même ; il prépare la sonde, puis lit ce qu'elle a ramené.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./PreferenceModel.js') : root.GearPreferenceModel);
  if (common) module.exports = api;
  else {
    root.GearNearMissAnalyzer = api;
    if (root.GearApp) { root.GearApp.requirements = root.GearApp.requirements || {}; root.GearApp.requirements.NearMissAnalyzer = api; }
  }
})(typeof self !== 'undefined' ? self : this, function (Preferences) {
  'use strict';

  function finite(value) { return typeof value === 'number' && isFinite(value); }

  /**
   * Préférences allégées de toute contrainte dure : c'est la requête sonde.
   * Les préférences souples sont conservées — elles ne filtrent pas, donc elles
   * ne peuvent pas être responsables de l'absence de résultat.
   */
  function probePreferences(preferences) {
    var probe = new Preferences.PreferenceModel(preferences.toJSON());
    probe.constraints().forEach(function (entry) { probe.drop(entry.key); });
    return probe;
  }

  /**
   * Arrondit une borne vers l'extérieur, à un cran lisible.
   * 83,6 → 84 ; 0,913 → 0,92 ; 1234 → 1300. On ne propose jamais « 83,6421 ».
   */
  function niceBound(value, direction) {
    if (!finite(value) || value === 0) return value;
    var magnitude = Math.pow(10, Math.floor(Math.log(Math.abs(value)) / Math.LN10) - 1);
    var step = magnitude <= 0 ? 1 : magnitude;
    return direction === 'up' ? Math.ceil(value / step) * step : Math.floor(value / step) * step;
  }

  function round(value) {
    if (!finite(value)) return value;
    var abs = Math.abs(value);
    var decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return Number(value.toFixed(decimals));
  }

  /**
   * Que faudrait-il assouplir, et de combien ?
   * @param {Array} probePool solutions obtenues sans les contraintes dures
   * @param {object} preferences PreferenceModel d'origine
   * @returns {{status, blocker, candidates, text}}
   */
  function analyze(probePool, preferences) {
    var pool = Array.isArray(probePool) ? probePool : [];
    var hard = preferences ? preferences.constraints() : [];

    if (!pool.length) {
      return {
        status: 'infeasible', blocker: null, candidates: [],
        text: 'Même sans vos contraintes de dimensions et de performance, aucune architecture n’atteint ce rapport. Élargissez les technologies, le nombre d’étages ou la tolérance sur le rapport.'
      };
    }
    if (!hard.length) {
      return {
        status: 'unconstrained', blocker: null, candidates: [],
        text: 'Aucune contrainte n’est active : c’est le besoin lui-même qui n’a pas de solution avec les technologies retenues.'
      };
    }

    var candidates = hard.map(function (entry) {
      return measure(entry, pool, preferences);
    }).filter(Boolean).sort(function (a, b) { return b.severity - a.severity; });

    if (!candidates.length) {
      return {
        status: 'elsewhere', blocker: null, candidates: [],
        text: 'Chaque contrainte est tenable isolément : c’est leur combinaison qui ne l’est pas. Assouplissez-en deux plutôt qu’une.'
      };
    }

    var blocker = candidates[0];
    return { status: 'relaxable', blocker: blocker, candidates: candidates, text: describe(blocker) };
  }

  /**
   * Pour une contrainte : la meilleure valeur atteinte, la borne à viser, et
   * combien de solutions cela débloquerait — TOUTES les autres contraintes
   * restant appliquées, sinon le chiffre annoncé serait un mensonge.
   */
  function measure(entry, pool, preferences) {
    var bounds = entry.quantity.bounds(), scale = entry.meta.scale || 1;
    var direction = bounds.max != null ? 'max' : bounds.min != null ? 'min' : null;
    if (!direction) return null;

    var values = pool.map(function (solution) {
      var value = entry.meta.metric(solution);
      return finite(value) ? value * scale : null;
    }).filter(finite);
    if (!values.length) return null;

    var achieved = direction === 'max' ? Math.min.apply(Math, values) : Math.max.apply(Math, values);
    var limit = direction === 'max' ? bounds.max : bounds.min;
    if (direction === 'max' ? achieved <= limit : achieved >= limit) return null;   // celle-ci passait déjà

    var suggested = niceBound(achieved, direction === 'max' ? 'up' : 'down');
    var relaxed = relax(preferences, entry.key, suggested);
    var unlocked = pool.filter(function (solution) { return relaxed.accepts(solution); }).length;

    return {
      key: entry.key, meta: entry.meta, quantity: entry.quantity, direction: direction,
      limit: round(limit), achieved: round(achieved), suggested: round(suggested),
      unlocked: unlocked, preferences: relaxed,
      severity: Math.abs(achieved - limit) / (Math.abs(limit) || 1)
    };
  }

  /** Le modèle de préférences tel qu'il serait après acceptation — pour le bouton. */
  function relax(preferences, key, value) {
    var next = new Preferences.PreferenceModel(preferences.toJSON());
    var entry = next.get(key);
    if (entry.isKnown()) next.entries[key] = entry.relaxedTo(value);
    return next;
  }

  function describe(blocker) {
    var unit = blocker.meta.unit ? ' ' + blocker.meta.unit : '';
    var symbol = blocker.direction === 'max' ? '≤ ' : '≥ ';
    var lines = [
      'Blocage principal : ' + blocker.meta.label + ' ' + symbol + blocker.limit + unit + '.',
      'La meilleure architecture atteint ' + blocker.achieved + unit + '.'
    ];
    if (blocker.unlocked > 0) {
      lines.push('En passant à ' + blocker.suggested + unit + ', ' + blocker.unlocked +
        (blocker.unlocked > 1 ? ' solutions deviennent disponibles.' : ' solution devient disponible.'));
    } else {
      lines.push('Assouplir cette seule contrainte ne suffit pas : une autre bloque juste derrière.');
    }
    return lines.join(' ');
  }

  return { analyze: analyze, probePreferences: probePreferences, relax: relax, niceBound: niceBound, measure: measure };
});
