// LegacySearchAdapter.js - Le pont, explicitement temporaire.
//
// Choix 20C : migration « model-first ». Le besoin est désormais modélisé pour
// lui-même ; le moteur, lui, attend toujours un `SearchParams`. Plutôt que de
// réécrire un moteur bien testé, on lui parle sa langue depuis un adaptateur
// isolé — un seul fichier à retirer le jour où le moteur consommera la requête
// compilée directement.
//
// Point important : cet adaptateur NE LIT PAS LE DOM. Les réglages purement
// techniques (plages de dentures, module, matériaux, limites du solveur) lui
// sont passés en argument. C'est ce qui permet de tester toute la chaîne
// besoin → paramètres moteur sans navigateur, et c'est ce que l'ancienne
// `SearchParams.fromForm()` rendait impossible.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearLegacySearchAdapter = api;
    if (root.GearApp) { root.GearApp.requirements = root.GearApp.requirements || {}; root.GearApp.requirements.LegacySearchAdapter = api; }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Réglages techniques par défaut, quand personne ne les a touchés. */
  var TECHNICAL_DEFAULTS = {
    dentMenanteMin: 10, dentMenanteMax: 30, dentMeneeMin: 20, dentMeneeMax: 50,
    dentMenanteFixe: null, dentMeneeFixe: null,
    maxSolutions: 100, maxIterations: 500000,
    module: 1, moduleMode: 'fixed', moduleMin: null, moduleMax: null,
    reductionOnly: true, typeParameters: null, typeTemplate: null,
    teethInventory: null, moduleList: null,
    inputMaterial: 'C45', outputMaterial: 'C45', additiveDerating: 1,
    manufacturing: null, fatigue: null, shaft: null
  };

  /** La crémaillère relève du solveur linéaire, et elle seule. */
  function technologiesFor(request) {
    var list = (request.technologies || []).slice();
    if (request.linear) return ['rack'];
    list = list.filter(function (id) { return id !== 'rack'; });
    return list.length ? list : ['spur'];
  }

  /**
   * Construit les paramètres du moteur depuis la requête compilée.
   * @param {object} request sortie de ConstraintCompiler.compile
   * @param {object} technical réglages techniques (voir TECHNICAL_DEFAULTS)
   * @param {function} [Factory] constructeur SearchParams ; sinon objet plat
   */
  function toSearchParams(request, technical, Factory) {
    var settings = Object.assign({}, TECHNICAL_DEFAULTS, technical || {});
    var params = Factory ? new Factory() : {};

    params.objectiveMode = request.mode || 'ratio';
    params.searchMode = request.searchMode || 'global';
    params.vitesseEntree = number(request.inputSpeedRpm, 1500);
    params.coupleEntree = number(request.inputTorqueNm, 10);

    params.rapportCible = request.linear ? null : number(request.ratio, null);
    params.precision = number(request.ratioTolerancePercent, 5);
    params.maxEtages = Math.max(1, Math.round(number(request.maxStages, 4)));
    params.typesActifs = technologiesFor(request);
    params.linearTravelPerRevolutionMm = request.linear ? number(request.travelPerRevolutionMm, null) : null;

    params.dentMenanteMin = settings.dentMenanteMin;
    params.dentMenanteMax = settings.dentMenanteMax;
    params.dentMeneeMin = settings.dentMeneeMin;
    params.dentMeneeMax = settings.dentMeneeMax;
    params.dentMenanteFixe = settings.dentMenanteFixe;
    params.dentMeneeFixe = settings.dentMeneeFixe;
    params.maxSolutions = settings.maxSolutions;
    params.maxIterations = settings.maxIterations;
    params.reductionOnly = settings.reductionOnly;
    params.module = settings.module;
    params.moduleMode = settings.moduleMode;
    params.moduleMin = settings.moduleMin;
    params.moduleMax = settings.moduleMax;
    // Inventaire réel : une liste vide n'est pas un inventaire, c'est
    // l'absence d'inventaire — la transmettre fermerait toute recherche.
    params.teethInventory = nonEmpty(settings.teethInventory);
    params.moduleList = nonEmpty(settings.moduleList);
    params.inputMaterial = settings.inputMaterial;
    params.outputMaterial = settings.outputMaterial;
    params.additiveDerating = settings.additiveDerating;
    if (settings.typeParameters) params.typeParameters = settings.typeParameters;
    if (settings.manufacturing) params.manufacturing = settings.manufacturing;
    if (settings.fatigue) params.fatigue = settings.fatigue;
    if (settings.shaft) params.shaft = settings.shaft;
    // L'architecture imposée n'a de sens que pour un train rotatif.
    params.typeTemplate = request.linear ? null : settings.typeTemplate;

    params.weights = normalizeWeights(request.weights);
    params.constraints = Object.assign({}, request.constraints);
    return params;
  }

  /** Le moteur attend des poids qui somment à 1 ; les nôtres sont des notes sur 10. */
  function normalizeWeights(weights) {
    var keys = ['ratio', 'size', 'efficiency', 'stress', 'stages', 'noise', 'manufacturing', 'cost'];
    var out = {}, total = 0;
    keys.forEach(function (key) {
      var value = weights && isFinite(weights[key]) ? Math.max(0, weights[key]) : 1;
      out[key] = value; total += value;
    });
    if (total) keys.forEach(function (key) { out[key] /= total; });
    return out;
  }

  function nonEmpty(list) {
    return Array.isArray(list) && list.length ? list.slice() : null;
  }

  function number(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  return { toSearchParams: toSearchParams, technologiesFor: technologiesFor, normalizeWeights: normalizeWeights, TECHNICAL_DEFAULTS: TECHNICAL_DEFAULTS };
});
