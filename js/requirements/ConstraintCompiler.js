// ConstraintCompiler.js - Traduit une intention en exigences chiffrées.
//
// C'est la pièce qui manquait. Le besoin est exprimé en grandeurs typées
// (« sortie 20 → 40 rpm », « couple ≥ 80 Nm ») ; le moteur, lui, ne connaît que
// des nombres plats. Le compilateur fait la traduction, et surtout il la fait
// SANS PERDRE l'intention :
//
//   sortie 20 → 40 rpm     →  rapport 37,5 → 75:1
//                             + bornes dures rpm sortie [20, 40]
//
// Les deux sont émis. La tolérance de rapport oriente la recherche ; les bornes
// dures garantissent le résultat même quand la tolérance ne sait pas exprimer
// une plage dissymétrique. Aucun DOM n'est lu ici : c'est ce qui rend la couche
// testable et réutilisable ailleurs qu'à l'écran.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./TransmissionAdvisor.js') : root.GearTransmissionAdvisor);
  if (common) module.exports = api;
  else {
    root.GearConstraintCompiler = api;
    if (root.GearApp) { root.GearApp.requirements = root.GearApp.requirements || {}; root.GearApp.requirements.ConstraintCompiler = api; }
  }
})(typeof self !== 'undefined' ? self : this, function (Advisor) {
  'use strict';

  /** Tolérance de rapport quand l'intention ne se laisse pas convertir. */
  var FALLBACK_TOLERANCE_PERCENT = 5;
  /** Une valeur « exacte » reste soumise à la réalité des dentures entières. */
  var EXACT_TOLERANCE_PERCENT = 0.1;

  function finite(value) { return typeof value === 'number' && isFinite(value); }

  /**
   * Tolérance en pourcent à donner au moteur pour ce rapport, et si elle suffit
   * à représenter fidèlement l'intention.
   */
  function ratioTolerance(quantity) {
    var bounds = quantity.bounds(), nominal = quantity.nominal();
    if (quantity.kind === 'exact') return { percent: EXACT_TOLERANCE_PERCENT, faithful: true };
    if (quantity.kind === 'target') return { percent: quantity.tolerancePercent, faithful: true };
    if (quantity.kind === 'range' && finite(nominal) && nominal !== 0) {
      return { percent: Math.abs((bounds.max - bounds.min) / 2 / nominal) * 100, faithful: true };
    }
    // « ≥ » et « ≤ » sont dissymétriques : aucune tolérance centrée ne les rend.
    return { percent: FALLBACK_TOLERANCE_PERCENT, faithful: false };
  }

  /**
   * Compile besoin + préférences en une requête plate.
   * @param {object} options `technologies` force la sélection, sinon le conseiller décide.
   */
  function compile(requirement, preferences, options) {
    options = options || {};
    var problem = requirement.inferProblem();
    var linear = problem.mode === 'rotationTranslation';
    var ratioQuantity = requirement.ratioRequirement();
    var advice = options.advice || Advisor.advise(requirement, preferences);

    var request = {
      mode: problem.mode,
      problemReason: problem.reason,
      linear: linear,
      inputSpeedRpm: requirement.input.speed.nominal(),
      inputTorqueNm: requirement.input.torque.nominal(),
      ratio: null,
      ratioTolerancePercent: FALLBACK_TOLERANCE_PERCENT,
      travelPerRevolutionMm: null,
      maxStages: null,
      technologies: options.technologies && options.technologies.length ? options.technologies.slice() : advice.selection.slice(),
      searchMode: preferences ? preferences.searchMode() : 'global',
      weights: preferences ? preferences.weights() : null,
      constraints: {},
      notes: []
    };

    if (ratioQuantity.isKnown()) {
      request.ratio = Math.abs(ratioQuantity.nominal());
      var tolerance = ratioTolerance(ratioQuantity);
      request.ratioTolerancePercent = tolerance.percent;
      if (!tolerance.faithful) {
        request.notes.push({ code: 'ratio-open', text: 'Le rapport n’est borné que d’un côté : la tolérance de recherche est indicative, les bornes de sortie restent appliquées strictement.' });
      }
    }

    if (linear) {
      var travel = requirement.travelRequirement();
      if (travel.isKnown()) request.travelPerRevolutionMm = travel.nominal();
      assign(request.constraints, 'minimumOutputForceN', requirement.output.force, 'min');
      assign(request.constraints, 'minimumLinearSpeedMmMin', requirement.output.linearSpeed, 'min');
      assign(request.constraints, 'maximumLinearSpeedMmMin', requirement.output.linearSpeed, 'max');
    } else {
      // Les bornes de sortie sont TOUJOURS transmises, y compris quand le
      // rapport les exprime déjà : elles sont exactes là où la tolérance
      // n'est qu'approchée.
      assign(request.constraints, 'minimumOutputSpeedRpm', requirement.output.speed, 'min');
      assign(request.constraints, 'maximumOutputSpeedRpm', requirement.output.speed, 'max');
      assign(request.constraints, 'minimumOutputTorqueNm', requirement.output.torque, 'min');
    }

    // Contraintes DURES issues des préférences ; les souples sont volontairement
    // ignorées ici — elles classent, elles ne filtrent pas (choix 4B).
    if (preferences) {
      preferences.constraints().forEach(function (entry) {
        var bounds = entry.quantity.bounds(), scale = entry.meta.scale || 1;
        switch (entry.key) {
          case 'maxDiameter': setMax(request.constraints, 'maxDiameter', bounds.max); break;
          case 'maxLength': setMax(request.constraints, 'maxLength', bounds.max); break;
          case 'maxWidth': setMax(request.constraints, 'maxWidth', bounds.max); break;
          case 'efficiency': if (bounds.min != null) request.constraints.minimumEfficiency = bounds.min / scale; break;
          case 'bendingSafety': if (bounds.min != null) request.constraints.minimumBendingSafety = bounds.min; break;
          case 'contactSafety': if (bounds.min != null) request.constraints.minimumContactSafety = bounds.min; break;
          case 'outputTorque': if (bounds.min != null) setMin(request.constraints, 'minimumOutputTorqueNm', bounds.min); break;
          case 'outputForce': if (bounds.min != null) setMin(request.constraints, 'minimumOutputForceN', bounds.min); break;
          case 'outputSpeed':
            setMin(request.constraints, 'minimumOutputSpeedRpm', bounds.min);
            setMax(request.constraints, 'maximumOutputSpeedRpm', bounds.max);
            break;
          case 'linearSpeed':
            setMin(request.constraints, 'minimumLinearSpeedMmMin', bounds.min);
            setMax(request.constraints, 'maximumLinearSpeedMmMin', bounds.max);
            break;
          case 'stages': if (bounds.max != null) request.maxStages = Math.max(1, Math.round(bounds.max)); break;
          case 'ratioError': if (bounds.max != null) request.ratioTolerancePercent = Math.min(request.ratioTolerancePercent, bounds.max); break;
          default: break;
        }
      });
    }

    if (request.maxStages == null) request.maxStages = requirement.architecture.maxStages || 4;

    advice.coverage.forEach(function (gap) { request.notes.push({ code: 'coverage-' + gap.code, text: gap.text }); });
    request.advice = advice;
    return request;
  }

  /** Reporte une borne d'une grandeur du besoin vers la requête. */
  function assign(target, key, quantity, side) {
    if (!quantity || !quantity.isKnown() || quantity.soft) return;
    var bounds = quantity.bounds(), value = side === 'min' ? bounds.min : bounds.max;
    if (value == null) return;
    if (side === 'min') setMin(target, key, value); else setMax(target, key, value);
  }

  // Deux sources peuvent contraindre la même grandeur (la fiche et une chip) :
  // on retient la plus sévère, jamais la dernière écrite.
  function setMin(target, key, value) {
    if (value == null) return;
    target[key] = target[key] == null ? value : Math.max(target[key], value);
  }
  function setMax(target, key, value) {
    if (value == null) return;
    target[key] = target[key] == null ? value : Math.min(target[key], value);
  }

  return { compile: compile, ratioTolerance: ratioTolerance, FALLBACK_TOLERANCE_PERCENT: FALLBACK_TOLERANCE_PERCENT, EXACT_TOLERANCE_PERCENT: EXACT_TOLERANCE_PERCENT };
});
