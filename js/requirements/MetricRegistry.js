// MetricRegistry.js - UN SEUL CATALOGUE DE GRANDEURS.
//
// Il en existait deux. `PreferenceModel` décrivait seize grandeurs — largeur,
// couple, vitesse, pertes, vitesse périphérique, sens de sortie, entraxe,
// force… — avec, pour chacune, son unité, son sens d'amélioration et la façon
// de la LIRE sur une solution calculée. La barre d'affinage, elle, avait sa
// propre liste de sept champs, écrite à la main dans le HTML et recopiée dans
// l'explorateur.
//
// Deux listes pour une même notion, c'est une divergence programmée : ce qu'on
// peut demander AVANT la recherche finissait par ne plus correspondre à ce
// qu'on peut filtrer APRÈS. Et rien ne le signalait.
//
// Ce module est la liste. Il ne redéfinit rien : il PROLONGE le catalogue des
// préférences avec ce dont un filtre a besoin en plus — un identifiant de
// champ, un pas de saisie, une valeur suggérée — et sert les deux usages.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./PreferenceModel.js') : root.GearApp.requirements.preferences);
  if (common) module.exports = api;
  else {
    root.GearMetricRegistry = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.metrics = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Preferences) {
  'use strict';

  /**
   * Ce qu'un FILTRE ajoute à un critère : de quel côté il borne, ce qu'il
   * suggère comme première valeur, et son pas de saisie. Tout le reste — nom,
   * unité, catégorie, lecture sur la solution — vient du catalogue commun.
   *
   * Une grandeur absente d'ici reste connue des préférences mais n'est pas
   * proposée au filtrage : certaines n'ont de sens qu'AVANT la recherche.
   */
  // `field` n'est présent que pour les sept filtres qui existaient avant ce
  // catalogue : leur identifiant est déjà dans le markup et dans les tests, et
  // le renommer n'apporterait rien. Les suivants le déduisent de leur clé.
  var FILTERABLE = {
    ratioError: { bound: 'max', suggest: 1, step: 0.01, label: 'Écart ≤', field: 'refine_error_max' },
    efficiency: { bound: 'min', suggest: 90, step: 1, label: 'Rendement ≥', scale: 100, field: 'refine_efficiency_min' },
    bendingSafety: { bound: 'min', suggest: 1.5, step: 0.1, label: 'SF ≥', field: 'refine_sf_min',
      note: 'Les solutions sans facteur évalué (courroie, chaîne…) sont exclues quand ce critère est actif' },
    contactSafety: { bound: 'min', suggest: 1.2, step: 0.1, label: 'SH ≥', field: 'refine_sh_min',
      note: 'Les solutions sans facteur évalué sont exclues quand ce critère est actif' },
    maxDiameter: { bound: 'max', suggest: 80, step: 1, label: 'Ø ≤', field: 'refine_diameter_max' },
    maxLength: { bound: 'max', suggest: 150, step: 1, label: 'Longueur ≤', field: 'refine_length_max' },
    maxWidth: { bound: 'max', suggest: 60, step: 1, label: 'Largeur ≤' },
    stages: { bound: 'max', suggest: 2, step: 1, label: 'Étages ≤', field: 'refine_stages_max' },
    outputTorque: { bound: 'min', suggest: 10, step: 0.5, label: 'Couple ≥' },
    outputSpeed: { bound: 'max', suggest: 500, step: 10, label: 'Vitesse ≤' },
    powerLoss: { bound: 'max', suggest: 50, step: 1, label: 'Pertes ≤' },
    centerDistance: { bound: 'max', suggest: 120, step: 1, label: 'Entraxe ≤' },
    outputForce: { bound: 'min', suggest: 500, step: 10, label: 'Force ≥', linear: true },
    linearSpeed: { bound: 'max', suggest: 5000, step: 100, label: 'Vitesse lin. ≤', linear: true }
  };

  /** Les catégories d'affichage, dans l'ordre où on les propose. */
  var CATEGORIES = [
    { id: 'performance', label: 'Performance' },
    { id: 'robustesse', label: 'Robustesse' },
    { id: 'dimensions', label: 'Dimensions' },
    { id: 'architecture', label: 'Architecture' }
  ];

  function criterion(key) {
    var list = Preferences.CRITERIA || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }

  /** La liste complète, prête pour la barre d'affinage. */
  function filters() {
    return Object.keys(FILTERABLE).map(function (key) {
      var meta = criterion(key);
      if (!meta) return null;
      var extra = FILTERABLE[key];
      return {
        key: key,
        field: extra.field || 'refine_' + key,
        category: meta.category,
        label: extra.label,
        name: meta.label.toLowerCase(),
        unit: extra.unit || meta.unit || '',
        step: extra.step,
        suggest: extra.suggest,
        bound: extra.bound,
        scale: extra.scale || meta.scale || null,
        linear: !!(extra.linear || meta.linear),
        note: extra.note || '',
        metric: meta.metric,
        // Chaque entrée sait juger elle-même : le filtre n'a plus à connaître
        // le sens de chaque grandeur, ni son échelle.
        accepts: function (solution, value) { return accepts(this, solution, value); }
      };
    }).filter(Boolean);
  }

  /** Une solution passe-t-elle ce filtre ? `null` laisse toujours passer. */
  function accepts(entry, solution, value) {
    if (value == null || !Number.isFinite(value)) return true;
    var read = entry.metric(solution);
    if (entry.scale && Number.isFinite(read)) read *= entry.scale;
    // Une grandeur NON ÉVALUÉE ne passe pas un filtre qui la borne : « non
    // vérifié » n'est pas « conforme », et laisser passer reviendrait à
    // afficher sous « SF ≥ 1,5 » des solutions dont le SF est inconnu.
    if (!Number.isFinite(read)) return false;
    return entry.bound === 'min' ? read >= value : read <= value;
  }

  return { filters: filters, accepts: accepts, criterion: criterion,
    CATEGORIES: CATEGORIES, FILTERABLE: FILTERABLE };
});
