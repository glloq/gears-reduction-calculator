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
   * Les deux ROUES D'EXTRÉMITÉ : le pignon déjà monté sur le moteur, et la roue
   * déjà taillée sur l'arbre de sortie. Ce sont les deux pièces qu'on ne
   * choisit pas — elles existent avant la transmission, et c'est la
   * transmission qui doit s'y raccorder.
   *
   * Elles ne forment PAS un étage de plus. Une roue est toujours la moitié d'un
   * engrènement : celle d'entrée est la roue menante du premier étage, celle de
   * sortie la roue menée du dernier. Les compter à part ferait apparaître des
   * étages fantômes dans le rapport, le rendement et l'encombrement.
   */
  var END_WHEEL_ROLES = [
    { role: 'input', label: 'Roue d’entrée', help: 'La roue déjà en place côté moteur : elle mène le premier étage.' },
    { role: 'output', label: 'Roue de sortie', help: 'La roue déjà en place côté récepteur : elle est menée par le dernier étage.' }
  ];

  /**
   * Ce qu'on peut connaître d'une roue réelle. `teeth` n'a pas de chemin fixe :
   * il désigne l'organe MENANT ou MENÉ selon le bout de chaîne, et le chemin se
   * déduit de la famille — `wormStarts` sur une vis, `sunTeeth` sur un
   * planétaire, `input.teeth` sur un couple ordinaire. C'est la même table
   * `REQUIRED` qui sert, plutôt qu'une seconde liste à tenir en accord.
   *
   * `needsModule` : ces grandeurs n'existent que sur une denture taillée. Une
   * poulie n'a pas de module, et lui en proposer un promettrait une géométrie
   * que le calcul ne lit jamais.
   */
  var END_WHEEL_FIELDS = [
    { key: 'teeth', label: 'Dents', unit: 'dents', min: 1, step: 1 },
    { key: 'module', label: 'Module', unit: 'mm', min: 0.1, step: 0.05, needsModule: true },
    { key: 'faceWidth', label: 'Largeur', unit: 'mm', min: 1, step: 0.5, needsModule: true },
    { key: 'pressureAngle', label: 'Angle de pression', unit: '°', min: 10, max: 30, step: 0.5, needsModule: true },
    { key: 'helixAngle', label: 'Angle d’hélice', unit: '°', min: 0, max: 45, step: 1, families: ['helical'] }
  ];

  /** Ce qui, d'une roue, s'écrit dans les PARAMÈTRES de l'étage et non dans ses dentures. */
  var END_WHEEL_PARAMETERS = END_WHEEL_FIELDS
    .filter(function (field) { return field.key !== 'teeth'; })
    .map(function (field) { return field.key; });

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
    // Grandeurs imposées à l'étage entier — module, largeur, angles. Elles ne
    // se SAISISSENT pas ici : elles arrivent d'une roue d'extrémité réelle, et
    // le constructeur les propage à l'étage qu'elle touche.
    this.parameters = {};
    if (seed) this.merge(seed);
  }

  BuildStage.prototype.merge = function (seed) {
    if (seed.family) this.family = Helpers.registryId(seed.family);
    if (seed.values) {
      Object.keys(seed.values).forEach(function (path) {
        if (present(seed.values[path])) this.values[path] = seed.values[path];
      }, this);
    }
    if (seed.parameters) {
      Object.keys(seed.parameters).forEach(function (key) {
        if (present(seed.parameters[key])) this.parameters[key] = seed.parameters[key];
      }, this);
    }
    return this;
  };

  BuildStage.prototype.setParameter = function (key, value) {
    if (present(value)) this.parameters[key] = value; else delete this.parameters[key];
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
    // Après les valeurs par défaut ET après le module de chaîne : une roue
    // réelle a le module qu'elle a, ce n'est pas au constructeur de le redire.
    Object.keys(this.parameters).forEach(function (key) { stage.parameters[key] = this.parameters[key]; }, this);
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
    // Deux natures de contrainte, et il faut les distinguer : `fields` se
    // COMPARE aux candidats engendrés (une denture existe avant le filtrage),
    // `parameters` s'IMPOSE à la solution retenue (un module n'est choisi
    // qu'après). Les mélanger ferait rejeter tout candidat, puisqu'aucun ne
    // porte encore de module au moment où on le filtre.
    return { families: this.family ? [this.family] : null, fields: fields,
      parameters: JSON.parse(JSON.stringify(this.parameters)) };
  };

  BuildStage.prototype.toJSON = function () {
    return { family: this.family, values: JSON.parse(JSON.stringify(this.values)),
      parameters: JSON.parse(JSON.stringify(this.parameters)) };
  };

  BuildStage.prototype.clone = function () { return new BuildStage(this.toJSON()); };

  // ===== Les roues d'extrémité =====

  /**
   * Une roue RÉELLE, à un bout de la chaîne. Elle ne se cherche pas : elle se
   * décrit, parce qu'elle est déjà là.
   *
   * Elle porte sa propre famille, parce qu'on la voit avant de savoir ce que
   * sera l'étage : « j'ai un pignon conique 18 dents module 1,5 » se dit sans
   * avoir encore décidé quoi que ce soit du réducteur. Cette famille sert alors
   * aussi à l'étage qu'elle touche — l'engrènement ne peut pas être d'une autre
   * nature que la roue qui en fait la moitié.
   */
  function EndWheel(role, seed) {
    this.role = role === 'output' ? 'output' : 'input';
    this.family = null;
    this.values = {};
    if (seed) this.merge(seed);
  }

  EndWheel.prototype.merge = function (seed) {
    if (!seed) return this;
    if (seed.role) this.role = seed.role === 'output' ? 'output' : 'input';
    if (seed.family) this.family = Helpers.registryId(seed.family);
    var values = seed.values || {};
    Object.keys(values).forEach(function (key) {
      if (present(values[key])) this.values[key] = values[key];
    }, this);
    return this;
  };

  EndWheel.prototype.setFamily = function (family) {
    var next = family ? Helpers.registryId(family) : null;
    if (next !== this.family) {
      this.family = next;
      // Une grandeur qui n'existe pas dans la nouvelle famille ne peut pas
      // survivre au changement : un angle d'hélice sur un pignon droit serait
      // une valeur silencieusement fausse, lue par la géométrie sans l'être
      // par l'écran.
      var allowed = this.fields().map(function (field) { return field.key; });
      Object.keys(this.values).forEach(function (key) {
        if (allowed.indexOf(key) === -1) delete this.values[key];
      }, this);
    }
    this.family = next;
    return this;
  };

  EndWheel.prototype.set = function (key, value) {
    if (present(value)) this.values[key] = value; else delete this.values[key];
    return this;
  };

  EndWheel.prototype.get = function (key) {
    return this.values[key] === undefined ? null : this.values[key];
  };

  EndWheel.prototype.clear = function () { this.family = null; this.values = {}; return this; };

  EndWheel.prototype.isEmpty = function () {
    return !this.family && !Object.keys(this.values).length;
  };

  /**
   * Les grandeurs proposées pour CETTE roue. Tant que la famille est inconnue,
   * seules les dents et le module ont un sens : largeur et angles se lisent sur
   * une denture dont on sait la nature.
   */
  EndWheel.prototype.fields = function (inheritedFamily) {
    var family = this.family || (inheritedFamily ? Helpers.registryId(inheritedFamily) : null);
    var definition = family ? Registry.get(family) : null;
    var usesModule = definition ? !!(definition.capabilities && definition.capabilities.usesModule) : true;
    var self = this;
    return END_WHEEL_FIELDS.filter(function (field) {
      if (field.families) return family ? field.families.indexOf(family) !== -1 : false;
      if (field.needsModule && !usesModule) return false;
      if (field.needsModule && !family) return field.key === 'module';
      return true;
    }).map(function (field) {
      return { key: field.key, label: field.label, unit: field.unit, min: field.min,
        max: field.max, step: field.step, value: self.get(field.key) };
    });
  };

  /**
   * Le chemin, dans l'étage au format moteur, de l'organe que cette roue EST.
   * Entrée = organe menant, sortie = organe mené : c'est exactement l'ordre de
   * `REQUIRED`, qui n'a donc pas à être redit ici.
   */
  EndWheel.prototype.teethPath = function (family) {
    if (!family) return null;
    var required = requiredFields(family);
    return (this.role === 'input' ? required[0] : required[1]) || null;
  };

  /** Ce que cette roue impose aux paramètres de l'étage qu'elle touche. */
  EndWheel.prototype.toParameters = function () {
    var out = {};
    END_WHEEL_PARAMETERS.forEach(function (key) {
      if (present(this.values[key])) out[key] = this.values[key];
    }, this);
    return out;
  };

  EndWheel.prototype.describe = function () {
    if (this.isEmpty()) return null;
    var bits = [];
    if (this.family) bits.push(Registry.familyName(this.family, 'short'));
    if (present(this.values.teeth)) bits.push(this.values.teeth + ' dents');
    if (present(this.values.module)) bits.push('module ' + this.values.module);
    return bits.length ? bits.join(', ') : null;
  };

  EndWheel.prototype.toJSON = function () {
    return { role: this.role, family: this.family, values: JSON.parse(JSON.stringify(this.values)) };
  };

  EndWheel.prototype.clone = function () { return new EndWheel(this.role, this.toJSON()); };

  /** Le libellé d'un bout de chaîne, dit une seule fois. */
  function endWheelRole(role) {
    return END_WHEEL_ROLES.filter(function (entry) { return entry.role === role; })[0] || END_WHEEL_ROLES[0];
  }

  // ===== La chaîne =====

  function BuildModel(seed) {
    this.stages = [];
    // Le module de la chaîne : celui que le solveur appliquera partout où rien
    // ne l'impose. Une roue d'extrémité réelle, elle, garde le sien — c'est
    // désormais la seule dérogation, et elle porte sur un étage nommé.
    this.module = null;
    // Les deux pièces qui existaient avant le réducteur.
    this.inputWheel = new EndWheel('input');
    this.outputWheel = new EndWheel('output');
    if (seed) this.merge(seed);
  }

  BuildModel.prototype.merge = function (seed) {
    if (Array.isArray(seed)) seed = { stages: seed };
    if (seed.stages) this.stages = seed.stages.map(function (entry) { return new BuildStage(entry); });
    if (present(seed.module)) this.module = seed.module;
    if (seed.inputWheel) this.inputWheel = new EndWheel('input', seed.inputWheel);
    if (seed.outputWheel) this.outputWheel = new EndWheel('output', seed.outputWheel);
    return this;
  };

  /** La roue d'un bout de chaîne. */
  BuildModel.prototype.endWheel = function (role) {
    return role === 'output' ? this.outputWheel : this.inputWheel;
  };

  /** L'étage qu'une roue d'extrémité touche, ou null si la chaîne est vide. */
  BuildModel.prototype.endStageIndex = function (role) {
    if (!this.stages.length) return null;
    return role === 'output' ? this.stages.length - 1 : 0;
  };

  /**
   * La famille effective d'un bout de chaîne : celle de la roue si elle est
   * connue, sinon celle de l'étage qu'elle touche. C'est ce qui permet de
   * décrire une roue sans redire la famille qu'on vient d'écrire à l'étage —
   * et l'inverse.
   */
  BuildModel.prototype.endFamily = function (role) {
    var wheel = this.endWheel(role), index = this.endStageIndex(role);
    var stage = index == null ? null : this.stages[index];
    return wheel.family || (stage && stage.family) || null;
  };

  /**
   * La chaîne AVEC ses roues d'extrémité fondues dedans. C'est le seul endroit
   * où la fusion se fait : tout le reste — contraintes, niveaux, erreurs,
   * rapport — lit ces étages-là. Deux fusions à deux endroits finiraient par
   * diverger, et l'écran annoncerait un étage « partiel » que le solveur, lui,
   * traiterait comme imposé.
   */
  BuildModel.prototype.resolved = function () {
    var stages = this.stages.map(function (stage) { return stage.clone(); });
    if (!stages.length) return stages;
    applyEndWheel(this.inputWheel, stages[0]);
    applyEndWheel(this.outputWheel, stages[stages.length - 1]);
    return stages;
  };

  /**
   * Une roue écrite dans l'étage qu'elle touche. La famille de la roue ne
   * REMPLACE jamais celle de l'étage : une contradiction entre les deux est une
   * erreur à montrer, pas un arbitrage à faire en silence.
   */
  function applyEndWheel(wheel, stage) {
    if (!wheel || wheel.isEmpty()) return;
    if (wheel.family && !stage.family) stage.family = wheel.family;
    var path = wheel.teethPath(stage.family);
    if (path && present(wheel.get('teeth'))) stage.values[path] = wheel.get('teeth');
    var parameters = wheel.toParameters();
    Object.keys(parameters).forEach(function (key) { stage.parameters[key] = parameters[key]; });
  }

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

  /** Les roues d'extrémité réellement décrites, dans l'ordre de la chaîne. */
  BuildModel.prototype.describedEndWheels = function () {
    var self = this;
    return END_WHEEL_ROLES.map(function (entry) { return self.endWheel(entry.role); })
      .filter(function (wheel) { return !wheel.isEmpty(); });
  };

  /** Tous les étages sont-ils entièrement déterminés ? */
  BuildModel.prototype.isComplete = function () {
    var stages = this.resolved();
    return stages.length > 0 && stages.every(function (stage) { return stage.isFixed(); });
  };

  /** Combien d'étages restent à trouver — ce que le solveur aura à faire. */
  BuildModel.prototype.unknownCount = function () {
    return this.resolved().filter(function (stage) { return !stage.isFixed(); }).length;
  };

  /** Répartition des degrés de liberté, pour l'afficher sans la recompter. */
  BuildModel.prototype.levels = function () {
    return this.resolved().map(function (stage) { return stage.level(); });
  };

  /**
   * La chaîne au format moteur. Null tant qu'un étage reste inconnu : rendre
   * une chaîne partielle laisserait croire qu'elle est calculable.
   */
  BuildModel.prototype.toStages = function () {
    if (!this.isComplete()) return null;
    var module = this.module;
    return this.resolved().map(function (stage) { return stage.toStage(module); });
  };

  /** Contraintes par profondeur, dans l'ordre des étages. */
  BuildModel.prototype.toStageConstraints = function () {
    return this.resolved().map(function (stage) { return stage.toConstraint(); });
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
    var self = this, last = this.stages.length - 1;
    return this.resolved().map(function (stage, index) {
      var fields = {};
      Object.keys(stage.values).forEach(function (path) { fields[path] = true; });
      var entry = { family: !!stage.family, fields: fields };
      // Rien à dire quand rien n'a été imposé : une clé vide sur tous les
      // étages ferait porter à la trace un bruit que personne ne lit.
      var parameters = Object.keys(stage.parameters);
      if (parameters.length) {
        entry.parameters = {};
        parameters.forEach(function (key) { entry.parameters[key] = true; });
      }
      // Une roue déjà taillée et une denture simplement épinglée ne se lisent
      // pas pareil : la première ne se rediscute pas, la seconde si.
      if (index === 0 && !self.inputWheel.isEmpty()) entry.wheel = 'input';
      if (index === last && !self.outputWheel.isEmpty()) entry.wheel = entry.wheel ? 'both' : 'output';
      return entry;
    });
  };

  /** Le gabarit de familles, tel que le moteur le connaît déjà. */
  BuildModel.prototype.toTemplate = function () {
    return this.resolved().map(function (stage) { return stage.family ? [stage.family] : null; });
  };

  /** Familles citées : ce que la recherche doit avoir le droit d'explorer. */
  BuildModel.prototype.families = function () {
    var out = [];
    this.resolved().forEach(function (stage) {
      if (stage.family && out.indexOf(stage.family) === -1) out.push(stage.family);
    });
    return out;
  };

  /** Erreurs par étage sur la partie DÉJÀ décrite — un étage imposé peut être faux. */
  BuildModel.prototype.errors = function () {
    var out = this.endWheelErrors(), module = this.module;
    this.resolved().forEach(function (stage, index) {
      if (!stage.isFixed()) return;
      var built = stage.toStage(module);
      Helpers.validateStages([built], Registry).forEach(function (entry) {
        entry.errors.forEach(function (text) {
          out.push({ stage: index + 1, label: 'Étage ' + (index + 1), text: text });
        });
      });
    });
    return out;
  };

  /**
   * Ce qu'une roue réelle peut contredire. Ces erreurs ne sont pas celles d'un
   * étage : les ranger sous « Étage 1 » enverrait corriger la denture alors que
   * c'est la roue, ou l'inverse.
   */
  BuildModel.prototype.endWheelErrors = function () {
    var out = [], self = this;
    function report(role, text) {
      out.push({ stage: null, wheel: role, label: endWheelRole(role).label, text: text });
    }
    END_WHEEL_ROLES.forEach(function (entry) {
      var role = entry.role, wheel = self.endWheel(role);
      if (wheel.isEmpty()) return;
      if (!self.stages.length) {
        report(role, 'Ajoutez un étage : une roue est la moitié d’un engrènement, elle ne se tient pas seule.');
        return;
      }
      var index = self.endStageIndex(role), stage = self.stages[index];
      if (wheel.family && stage.family && wheel.family !== stage.family) {
        report(role, 'Elle est ' + Registry.familyName(wheel.family, 'short').toLowerCase() +
          ' alors que l’étage ' + (index + 1) + ' est ' + Registry.familyName(stage.family, 'short').toLowerCase() +
          ' : un engrènement ne peut pas être des deux natures.');
      }
      if (!self.endFamily(role) && present(wheel.get('teeth'))) {
        report(role, 'Choisissez sa famille : sans elle, « ' + wheel.get('teeth') +
          ' dents » ne désigne aucun organe.');
      }
    });
    // Un seul étage, deux roues : elles engrènent ENSEMBLE. Deux modules ou
    // deux familles différents décriraient un engrènement impossible.
    if (this.stages.length === 1 && !this.inputWheel.isEmpty() && !this.outputWheel.isEmpty()) {
      var a = this.inputWheel, b = this.outputWheel;
      if (present(a.get('module')) && present(b.get('module')) && a.get('module') !== b.get('module')) {
        report('output', 'Les deux roues engrènent ensemble sur l’unique étage : elles ne peuvent pas avoir ' +
          'deux modules différents (' + a.get('module') + ' et ' + b.get('module') + ').');
      }
      if (a.family && b.family && a.family !== b.family) {
        report('output', 'Les deux roues engrènent ensemble sur l’unique étage : elles ne peuvent pas être ' +
          'de deux familles différentes.');
      }
    }
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
    return { module: this.module, stages: this.stages.map(function (stage) { return stage.toJSON(); }),
      inputWheel: this.inputWheel.toJSON(), outputWheel: this.outputWheel.toJSON() };
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

  return { BuildModel: BuildModel, BuildStage: BuildStage, EndWheel: EndWheel,
    END_WHEEL_ROLES: END_WHEEL_ROLES, END_WHEEL_FIELDS: END_WHEEL_FIELDS,
    END_WHEEL_PARAMETERS: END_WHEEL_PARAMETERS, endWheelRole: endWheelRole,
    LEVELS: LEVELS, LEVEL_LABELS: LEVEL_LABELS,
    READINGS: READINGS, reading: reading, fromStages: fromStages,
    REQUIRED: REQUIRED, OPTIONAL: OPTIONAL, requiredFields: requiredFields, optionalFields: optionalFields,
    familyKey: familyKey, get: get, set: set };
});
