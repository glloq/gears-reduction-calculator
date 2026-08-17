// BuildModel.js - La transmission qu'on construit soi-même.
//
// « Je veux choisir moi-même mon architecture » était déjà possible, mais
// enfoui : il fallait passer par Technologie → Architecture personnalisée, et
// on n'y fixait que la FAMILLE de chaque étage. Impossible d'y écrire « étage 1
// conique, 18 → 54, module 1,5 ; étage 2 : trouve », qui est pourtant la
// demande la plus fréquente dès qu'on a une contrainte réelle — un carter, un
// arbre existant, une roue déjà taillée.
//
// Ce modèle décrit une chaîne EN COURS DE CONSTRUCTION, où chaque étage est
// connu à un degré différent. Le degré de liberté n'est pas stocké : il se
// DÉDUIT de ce qui est épinglé. Un drapeau « partiel » rangé à côté des valeurs
// finirait tôt ou tard par les contredire — l'utilisateur remplit le dernier
// champ, et l'étage se prétend encore incomplet.
//
//   🔒 imposé       famille + toutes les dentures : rien à chercher
//   ◐ partiel      une partie seulement
//   ⚙ automatique  rien, ou seulement la famille
//
// Le modèle ne calcule rien lui-même : une chaîne complète est analysée par
// `StageEditorHelpers.reanalyze`, exactement comme une solution trouvée par le
// moteur. Deux jeux de formules donneraient deux vérités.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(
    common ? require('../ui/StageEditor.js') : root.GearStageEditorHelpers,
    common ? require('../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry,
    common ? require('../core/Engineering.js') : root.GearEngineering,
    common ? require('../core/ManufacturingRules.js') : root.ManufacturingRules
  );
  if (common) module.exports = api;
  else {
    root.GearBuildModel = api;
    if (root.GearApp) {
      root.GearApp.requirements = root.GearApp.requirements || {};
      root.GearApp.requirements.BuildModel = api.BuildModel;
      root.GearApp.requirements.build = api;
    }
  }
})(typeof self !== 'undefined' ? self : this, function (Helpers, Registry, Engineering, ManufacturingRules) {
  'use strict';

  /**
   * Ce qu'il faut connaître d'un étage pour qu'il n'y ait plus rien à chercher,
   * par famille. Les chemins sont ceux de l'étage AU FORMAT MOTEUR : c'est ce
   * qui permet au solveur de filtrer ses candidats sans rien savoir des
   * familles, en comparant simplement des chemins à des valeurs.
   */
  var REQUIRED = {
    pair: ['input.teeth', 'output.teeth'],
    worm: ['wormStarts', 'wheelTeeth'],
    planetary: ['sunTeeth', 'ringTeeth'],
    rack: ['pinionTeeth']
  };

  /**
   * Champs facultatifs : les épingler resserre la recherche, les omettre la
   * laisse choisir. Ils ne comptent PAS dans « l'étage est-il imposé ? » — un
   * planétaire dont on n'a pas dit quel organe mène a une valeur par défaut,
   * il n'est pas incomplet pour autant.
   */
  var OPTIONAL = {
    planetary: ['planetCount', 'inputMember', 'fixed', 'outputMember']
  };

  var LEVELS = { FIXED: 'fixed', PARTIAL: 'partial', AUTO: 'auto' };

  /**
   * §11 : deux LECTURES du même état, parce que les deux parcours ne promettent
   * pas la même chose. « Automatique » dit ce que le système fera : juste en
   * Construire, faux en Étudier, où rien ne doit être choisi à la place de
   * l'utilisateur. Un champ vide y est une donnée MANQUANTE, pas une
   * délégation — et le laisser afficher « automatique » inviterait précisément
   * à ce que le logiciel s'est engagé à ne plus faire : inventer.
   */
  var READINGS = {
    build: {
      fixed: { label: 'Imposé', icon: '🔒', help: 'Toutes les valeurs sont données : rien à chercher.' },
      partial: { label: 'Partiel', icon: '◐', help: 'Le système cherche seulement ce qui manque.' },
      auto: { label: 'Automatique', icon: '⚙', help: 'Le système choisit tout cet étage.' },
      emptyField: 'auto',
      emptyOption: 'Automatique',
      emptyFamily: 'Famille automatique',
      missingOne: 'valeur à trouver', missingMany: 'valeurs à trouver',
      hint: 'Laissez vide ce que le système doit choisir.',
      stageHint: 'Choisissez une famille pour fixer des dentures, ou laissez le système décider de tout cet étage.'
    },
    observe: {
      fixed: { label: 'Renseigné', icon: '🔒', help: 'Toutes les valeurs sont connues : cet étage est calculable.' },
      partial: { label: 'Incomplet', icon: '◐', help: 'Il manque des valeurs : cet étage ne sera pas évalué.' },
      auto: { label: 'Non renseigné', icon: '·', help: 'Rien n’est décrit : cet étage ne sera pas évalué.' },
      emptyField: 'non renseigné',
      emptyOption: 'Non renseigné',
      emptyFamily: 'Famille non renseignée',
      missingOne: 'valeur manquante', missingMany: 'valeurs manquantes',
      hint: 'Décrivez ce qui existe réellement. Les valeurs inconnues resteront non évaluées.',
      stageHint: 'Choisissez la famille de cet étage pour pouvoir en décrire les dentures.'
    }
  };

  /** @param {'build'|'observe'} [reading] lecture « Construire » par défaut. */
  function reading(id) { return READINGS[id] || READINGS.build; }

  /** Vocabulaire historique : celui de Construire. */
  var LEVEL_LABELS = READINGS.build;

  function familyKey(type) {
    var id = Helpers.registryId(type);
    if (REQUIRED[id]) return id;
    return 'pair';
  }

  function requiredFields(type) { return REQUIRED[familyKey(type)] || REQUIRED.pair; }
  function optionalFields(type) { return OPTIONAL[familyKey(type)] || []; }

  function get(object, path) {
    return path.split('.').reduce(function (node, key) { return node == null ? null : node[key]; }, object);
  }

  function set(object, path, value) {
    var keys = path.split('.'), last = keys.pop();
    var node = keys.reduce(function (current, key) {
      if (!current[key]) current[key] = {};
      return current[key];
    }, object);
    node[last] = value;
  }

  function present(value) { return value !== null && value !== undefined && value !== ''; }

  /**
   * Un cran de la chaîne. `family` null signifie « n'importe laquelle » ; une
   * seule famille est retenue parce qu'on ne peut pas épingler une denture sur
   * un étage dont on n'a pas encore choisi la nature.
   */
  function BuildStage(seed) {
    this.family = null;
    this.values = {};
    if (seed) this.merge(seed);
  }

  BuildStage.prototype.merge = function (seed) {
    if (seed.family) this.family = Helpers.registryId(seed.family);
    if (seed.values) {
      Object.keys(seed.values).forEach(function (path) {
        if (present(seed.values[path])) this.values[path] = seed.values[path];
      }, this);
    }
    return this;
  };

  BuildStage.prototype.setFamily = function (family) {
    var next = family ? Helpers.registryId(family) : null;
    // Changer de famille invalide les dentures : « 20 dents menantes » n'a pas
    // de sens sur une vis, et les garder produirait un étage silencieusement
    // faux. Ce qui reste valable dans la nouvelle famille est conservé.
    if (next !== this.family) {
      var keep = next ? requiredFields(next).concat(optionalFields(next)) : [];
      Object.keys(this.values).forEach(function (path) {
        if (keep.indexOf(path) === -1) delete this.values[path];
      }, this);
    }
    this.family = next;
    return this;
  };

  BuildStage.prototype.set = function (path, value) {
    if (present(value)) this.values[path] = value; else delete this.values[path];
    return this;
  };

  BuildStage.prototype.clear = function (path) { delete this.values[path]; return this; };

  /** Champs que cette famille demande, et ce qui en est connu. */
  BuildStage.prototype.fields = function () {
    if (!this.family) return [];
    var self = this;
    return requiredFields(this.family).concat(optionalFields(this.family)).map(function (path) {
      return { path: path, value: self.values[path] === undefined ? null : self.values[path],
        required: requiredFields(self.family).indexOf(path) !== -1 };
    });
  };

  /**
   * Le degré de liberté, DÉDUIT. Une famille sans aucune denture reste
   * « automatique » : le solveur a toute la latitude, il sait seulement de
   * quelle nature doit être l'étage.
   */
  BuildStage.prototype.level = function () {
    if (!this.family) return LEVELS.AUTO;
    var required = requiredFields(this.family);
    var known = required.filter(function (path) { return present(this.values[path]); }, this);
    if (known.length === required.length) return LEVELS.FIXED;
    if (known.length === 0 && !Object.keys(this.values).length) return LEVELS.AUTO;
    return LEVELS.PARTIAL;
  };

  BuildStage.prototype.isFixed = function () { return this.level() === LEVELS.FIXED; };

  /**
   * §12 : ce qu'il reste à déterminer sur cet étage. « ◐ Partiel » dit qu'il
   * manque quelque chose sans dire quoi, ni combien : sur un planétaire à six
   * champs, l'écart entre « il manque une valeur » et « il en manque cinq »
   * change complètement la lecture.
   */
  BuildStage.prototype.missingFields = function () {
    if (!this.family) return [];
    return requiredFields(this.family).filter(function (path) { return !present(this.values[path]); }, this);
  };

  /** L'étage au format moteur, ou null s'il n'est pas entièrement déterminé. */
  BuildStage.prototype.toStage = function (module) {
    if (!this.isFixed()) return null;
    var stage = Helpers.defaultStage(this.family, module);
    Object.keys(this.values).forEach(function (path) { set(stage, path, this.values[path]); }, this);
    return stage;
  };

  /**
   * Ce que le solveur doit respecter pour cet étage. Des chemins et des
   * valeurs, rien de plus : le moteur n'a pas à connaître les familles pour
   * appliquer ça.
   */
  BuildStage.prototype.toConstraint = function () {
    var fields = {};
    Object.keys(this.values).forEach(function (path) { fields[path] = this.values[path]; }, this);
    return { families: this.family ? [this.family] : null, fields: fields };
  };

  BuildStage.prototype.toJSON = function () {
    return { family: this.family, values: JSON.parse(JSON.stringify(this.values)) };
  };

  // ===== La chaîne =====

  function BuildModel(seed) {
    this.stages = [];
    // Le moteur applique UN module à toute la chaîne : le fixer par étage
    // serait une promesse que rien ne tient. Il est donc épinglé ici, pour
    // l'ensemble, ou laissé libre.
    this.module = null;
    if (seed) this.merge(seed);
  }

  BuildModel.prototype.merge = function (seed) {
    if (Array.isArray(seed)) seed = { stages: seed };
    if (seed.stages) this.stages = seed.stages.map(function (entry) { return new BuildStage(entry); });
    if (present(seed.module)) this.module = seed.module;
    return this;
  };

  BuildModel.prototype.addStage = function (family) {
    this.stages.push(new BuildStage(family ? { family: family } : null));
    return this;
  };

  BuildModel.prototype.removeStage = function (index) {
    if (index >= 0 && index < this.stages.length) this.stages.splice(index, 1);
    return this;
  };

  BuildModel.prototype.moveStage = function (index, offset) {
    var target = index + offset;
    if (index < 0 || index >= this.stages.length || target < 0 || target >= this.stages.length) return this;
    var moved = this.stages.splice(index, 1)[0];
    this.stages.splice(target, 0, moved);
    return this;
  };

  BuildModel.prototype.stage = function (index) { return this.stages[index] || null; };

  BuildModel.prototype.setModule = function (value) {
    this.module = present(value) ? value : null;
    return this;
  };

  BuildModel.prototype.isEmpty = function () { return this.stages.length === 0; };

  /** Tous les étages sont-ils entièrement déterminés ? */
  BuildModel.prototype.isComplete = function () {
    return this.stages.length > 0 && this.stages.every(function (stage) { return stage.isFixed(); });
  };

  /** Combien d'étages restent à trouver — ce que le solveur aura à faire. */
  BuildModel.prototype.unknownCount = function () {
    return this.stages.filter(function (stage) { return !stage.isFixed(); }).length;
  };

  /** Répartition des degrés de liberté, pour l'afficher sans la recompter. */
  BuildModel.prototype.levels = function () {
    return this.stages.map(function (stage) { return stage.level(); });
  };

  /**
   * La chaîne au format moteur. Null tant qu'un étage reste inconnu : rendre
   * une chaîne partielle laisserait croire qu'elle est calculable.
   */
  BuildModel.prototype.toStages = function () {
    if (!this.isComplete()) return null;
    var module = this.module;
    return this.stages.map(function (stage) { return stage.toStage(module); });
  };

  /** Contraintes par profondeur, dans l'ordre des étages. */
  BuildModel.prototype.toStageConstraints = function () {
    return this.stages.map(function (stage) { return stage.toConstraint(); });
  };

  /**
   * §24 : ce que l'utilisateur avait ÉPINGLÉ, figé au moment du calcul. Sans
   * cette trace, une chaîne complétée est indiscernable d'une chaîne trouvée de
   * bout en bout : « 20 → 60 » ne dit pas que le 20 venait d'une roue déjà
   * taillée et que le 60 est une proposition. C'est un instantané, pas un
   * renvoi vers le modèle vivant : celui-ci peut avoir été édité depuis, et la
   * solution affichée doit continuer de dire d'où elle vient.
   */
  BuildModel.prototype.toOrigin = function () {
    return this.stages.map(function (stage) {
      var fields = {};
      Object.keys(stage.values).forEach(function (path) { fields[path] = true; });
      return { family: !!stage.family, fields: fields };
    });
  };

  /** Le gabarit de familles, tel que le moteur le connaît déjà. */
  BuildModel.prototype.toTemplate = function () {
    return this.stages.map(function (stage) { return stage.family ? [stage.family] : null; });
  };

  /** Familles citées : ce que la recherche doit avoir le droit d'explorer. */
  BuildModel.prototype.families = function () {
    var out = [];
    this.stages.forEach(function (stage) {
      if (stage.family && out.indexOf(stage.family) === -1) out.push(stage.family);
    });
    return out;
  };

  /** Erreurs par étage sur la partie DÉJÀ décrite — un étage imposé peut être faux. */
  BuildModel.prototype.errors = function () {
    var out = [], module = this.module;
    this.stages.forEach(function (stage, index) {
      if (!stage.isFixed()) return;
      var built = stage.toStage(module);
      Helpers.validateStages([built], Registry).forEach(function (entry) {
        entry.errors.forEach(function (text) { out.push({ stage: index + 1, text: text }); });
      });
    });
    return out;
  };

  /**
   * La chaîne construite, analysée comme n'importe quelle solution. C'est ce
   * qui fait du mode « entièrement manuel » un vrai outil de calcul, et non un
   * simple formulaire de saisie.
   */
  BuildModel.prototype.analyze = function (options) {
    var stages = this.toStages();
    if (!stages || this.errors().length) return null;
    var result = Helpers.reanalyze(stages, { engineeringOptions: options || {} }, {
      Registry: Registry, Engineering: Engineering, ManufacturingRules: ManufacturingRules
    });
    if (!result.solution) return null;
    // Rien n'a été visé : parler d'écart au rapport n'aurait pas de sens.
    result.solution.errorPercent = 0;
    result.solution.isBuilt = true;
    return result.solution;
  };

  /** Rapport de la chaîne, ou null tant qu'elle n'est pas déterminée. */
  BuildModel.prototype.ratio = function () {
    var stages = this.toStages();
    if (!stages) return null;
    var total = 1, ok = true;
    stages.forEach(function (stage) {
      var definition = Registry.get(Helpers.registryId(stage.type));
      var value = null;
      try { value = definition && definition.calculateRatio(stage); } catch (ignore) { value = null; }
      if (!isFinite(value) || !value) ok = false; else total *= Math.abs(value);
    });
    return ok ? total : null;
  };

  BuildModel.prototype.describe = function () {
    if (!this.stages.length) return null;
    var unknown = this.unknownCount();
    var text = this.stages.length + (this.stages.length > 1 ? ' étages' : ' étage');
    if (unknown) return text + ', ' + unknown + ' à compléter';
    var ratio = this.ratio();
    return ratio ? text + ', rapport ' + (Math.round(ratio * 100) / 100) + ':1' : text;
  };

  BuildModel.prototype.toJSON = function () {
    return { module: this.module, stages: this.stages.map(function (stage) { return stage.toJSON(); }) };
  };

  BuildModel.prototype.clone = function () { return new BuildModel(this.toJSON()); };

  /**
   * §25 : une solution rendue ÉDITABLE. C'est la conversion inverse de
   * `toStages()`, et elle referme la boucle : concevoir, puis reprendre la main
   * étage par étage sur ce qui a été trouvé.
   *
   * Tous les étages entrent IMPOSÉS. C'est bien ce qu'on veut d'abord — la
   * solution telle qu'elle est — et libérer un champ se fait ensuite en le
   * vidant. L'inverse, tout ouvrir d'emblée, perdrait précisément la solution
   * qu'on venait de reprendre.
   */
  function fromStages(stages) {
    var model = new BuildModel();
    (stages || []).forEach(function (stage) {
      var family = Helpers.registryId(stage.type);
      model.addStage(family);
      var built = model.stage(model.stages.length - 1);
      requiredFields(family).concat(optionalFields(family)).forEach(function (path) {
        var value = get(stage, path);
        if (present(value)) built.set(path, value);
      });
    });
    // Le module est celui de la chaîne : le moteur n'en applique qu'un, et
    // c'est déjà la règle du constructeur.
    var first = (stages || [])[0];
    var module = first && first.parameters ? first.parameters.module : null;
    if (present(module)) model.setModule(module);
    return model;
  }

  return { BuildModel: BuildModel, BuildStage: BuildStage, LEVELS: LEVELS, LEVEL_LABELS: LEVEL_LABELS,
    READINGS: READINGS, reading: reading, fromStages: fromStages,
    REQUIRED: REQUIRED, OPTIONAL: OPTIONAL, requiredFields: requiredFields, optionalFields: optionalFields,
    familyKey: familyKey, get: get, set: set };
});
