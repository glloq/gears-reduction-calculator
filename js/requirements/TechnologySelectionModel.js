// TechnologySelectionModel.js - Comment l'utilisateur veut choisir (§19).
//
// `technologyMode = auto | manual` ne savait exprimer que deux intentions, et
// l'architecture imposée vivait à part, sérialisée en JSON dans un champ caché.
// Une seule politique couvre maintenant les quatre cas réels :
//
//   AUTO      le conseiller décide
//   PREFER    « je préférerais du planétaire », sans fermer la porte au reste
//   RESTRICT  « uniquement du planétaire »
//   TEMPLATE  « étage 1 conique, étage 2 hélicoïdal »
//
// PREFER est la nouveauté qui manquait : jusqu'ici vouloir un planétaire
// obligeait à interdire tout le reste, donc à ne jamais découvrir qu'un
// intérieur faisait mieux.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory();
  if (common) module.exports = api;
  else {
    root.GearTechnologySelectionModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.TechnologySelectionModel = api.TechnologySelectionModel;
      root.GearApp.requirements.technologySelection = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POLICIES = [
    { id: 'auto', label: 'Conseillez-moi', help: 'Le système choisit les technologies adaptées à votre besoin.' },
    { id: 'prefer', label: 'Type préféré', help: 'Privilégier ces familles, sans écarter une meilleure alternative.' },
    { id: 'restrict', label: 'Type imposé', help: 'N’explorer que ces familles.' },
    { id: 'template', label: 'Architecture personnalisée', help: 'Fixer la famille de chaque étage.' }
  ];

  /** Le registre expose l'épicycloïdal sous deux noms ; on n'en garde qu'un. */
  function canonical(id) { return id === 'epicyclic' ? 'planetary' : id; }

  function unique(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (id) {
      var key = canonical(id);
      if (key && !seen[key]) { seen[key] = true; out.push(key); }
    });
    return out;
  }

  function TechnologySelectionModel(seed) {
    this.policy = 'auto';
    this.families = [];          // familles préférées ou imposées
    this.template = [];          // un cran par étage : null = libre, sinon liste
    if (seed) this.merge(seed);
  }

  TechnologySelectionModel.prototype.merge = function (seed) {
    if (seed.policy && POLICIES.some(function (p) { return p.id === seed.policy; })) this.policy = seed.policy;
    if (Array.isArray(seed.families)) this.families = unique(seed.families);
    if (Array.isArray(seed.template)) {
      this.template = seed.template.map(function (slot) {
        return Array.isArray(slot) && slot.length ? unique(slot) : null;
      });
    }
    return this;
  };

  TechnologySelectionModel.prototype.setPolicy = function (policy) {
    if (POLICIES.some(function (p) { return p.id === policy; })) this.policy = policy;
    return this;
  };

  TechnologySelectionModel.prototype.toggleFamily = function (id) {
    var key = canonical(id), index = this.families.indexOf(key);
    if (index === -1) this.families.push(key); else this.families.splice(index, 1);
    return this;
  };

  // ===== Architecture par étage =====

  TechnologySelectionModel.prototype.stageCount = function () { return this.template.length; };

  TechnologySelectionModel.prototype.addStage = function (families) {
    this.template.push(families && families.length ? unique(families) : null);
    return this;
  };

  TechnologySelectionModel.prototype.setStage = function (index, families) {
    if (index < 0 || index >= this.template.length) return this;
    this.template[index] = families && families.length ? unique(families) : null;
    return this;
  };

  TechnologySelectionModel.prototype.removeStage = function (index) {
    this.template.splice(index, 1);
    return this;
  };

  /**
   * Les familles que le moteur doit explorer.
   * @param {string[]} advised sélection du conseiller
   * @param {string[]} [available] univers autorisé (rotatif ou linéaire)
   */
  TechnologySelectionModel.prototype.resolve = function (advised, available) {
    var universe = unique(available && available.length ? available : advised);
    var advice = unique(advised);
    switch (this.policy) {
      case 'restrict':
        return this.families.length ? this.families.slice() : advice;
      case 'prefer': {
        // Les préférées EN PREMIER, puis le conseil : la recherche reste
        // ouverte, seul le classement penche du bon côté.
        var merged = this.families.slice();
        advice.forEach(function (id) { if (merged.indexOf(id) === -1) merged.push(id); });
        return merged.length ? merged : advice;
      }
      case 'template': {
        var needed = [];
        this.template.forEach(function (slot) {
          (slot || universe).forEach(function (id) { if (needed.indexOf(id) === -1) needed.push(id); });
        });
        return needed.length ? needed : advice;
      }
      default:
        return advice;
    }
  };

  /** Nombre d'étages imposé, ou null si l'utilisateur n'en fixe pas. */
  TechnologySelectionModel.prototype.stagesRequired = function () {
    return this.policy === 'template' && this.template.length ? this.template.length : null;
  };

  /** Gabarit au format attendu par le moteur, ou null. */
  TechnologySelectionModel.prototype.toTemplate = function () {
    if (this.policy !== 'template' || !this.template.length) return null;
    return this.template.map(function (slot) { return slot && slot.length ? slot.slice() : null; });
  };

  /**
   * Les préférées influencent le CLASSEMENT, jamais le filtre : c'est ce qui
   * distingue « je préférerais » de « je veux uniquement ».
   */
  TechnologySelectionModel.prototype.preferenceBonus = function (solution) {
    if (this.policy !== 'prefer' || !this.families.length) return 0;
    var stages = (solution.stages || []).map(function (stage) { return canonical(stage.type); });
    if (!stages.length) return 0;
    var matching = stages.filter(function (type) { return this.families.indexOf(type) !== -1; }, this).length;
    return matching / stages.length;
  };

  TechnologySelectionModel.prototype.describe = function (names) {
    var label = function (id) { return (names && names[id]) || id; };
    switch (this.policy) {
      case 'restrict': return this.families.length ? this.families.map(label).join(' ou ') + ' imposé' : 'Type imposé';
      case 'prefer': return this.families.length ? this.families.map(label).join(' ou ') + ' préféré' : 'Type préféré';
      case 'template': return this.template.map(function (slot) {
        return slot && slot.length ? slot.map(label).join('/') : 'libre';
      }).join(' → ');
      default: return 'Technologies conseillées';
    }
  };

  TechnologySelectionModel.prototype.isComplete = function () {
    if (this.policy === 'restrict' || this.policy === 'prefer') return this.families.length > 0;
    if (this.policy === 'template') return this.template.length > 0;
    return true;
  };

  TechnologySelectionModel.prototype.toJSON = function () {
    return { policy: this.policy, families: this.families.slice(), template: this.toTemplate() || [] };
  };

  TechnologySelectionModel.prototype.clone = function () {
    return new TechnologySelectionModel(this.toJSON());
  };

  return { TechnologySelectionModel: TechnologySelectionModel, POLICIES: POLICIES, canonical: canonical };
});
