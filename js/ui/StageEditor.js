// StageEditor.js - Éditeur d'étages avec ré-analyse instantanée.
// Les aides pures (defaultStage, validateStages, reanalyze, diff) sont
// exportées en UMD pour les tests Node ; la classe DOM n'existe qu'en
// navigateur. La ré-analyse s'appuie sur GearEngineering.analyzeSolution
// (qui MUTE son entrée et LÈVE des exceptions : on clone et on encadre) et
// ManufacturingRules.validate pour la constructibilité.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearStageEditorHelpers = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function registryId(type) { return type === 'epicyclic' ? 'planetary' : type; }

  function minFactor(solution, key) {
    return (solution.mechanical || []).reduce(function (min, stage) {
      var value = stage[key] && stage[key].safetyFactor;
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
  }

  /**
   * Étage neutre et valide pour chaque type (sert à « Ajouter un étage »).
   */
  function defaultStage(typeId, module) {
    var m = Number.isFinite(module) && module > 0 ? module : 1;
    switch (registryId(typeId)) {
      case 'worm':
        return { type: 'worm', wormStarts: 1, wheelTeeth: 40, parameters: { module: m, leadAngle: 20, diameterQuotient: 10, frictionCoefficient: 0.06, pressureAngle: 20 } };
      case 'planetary':
        return { type: 'planetary', sunTeeth: 12, ringTeeth: 48, planetTeeth: 18, planetCount: 3, inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: m, faceWidth: 10, pressureAngle: 20 } };
      case 'belt':
        return { type: 'belt', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { profile: 'GT2', pitch: 2, beltType: 'timing', centerDistance: 100, crossed: false, width: 10 } };
      case 'chain':
        return { type: 'chain', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { pitch: 12.7, centerDistance: 200, width: 10 } };
      case 'internal':
        return { type: 'internal', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: m, pressureAngle: 20, profileShiftInput: 0, profileShiftOutput: 0 } };
      case 'helical':
        return { type: 'helical', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: m, helixAngle: 20, pressureAngle: 20, faceWidth: 12 } };
      case 'bevel':
        return { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: m, shaftAngle: 90, faceWidth: 10 } };
      default:
        return { type: 'spur', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: m, pressureAngle: 20, faceWidth: 10, profileShiftInput: 0, profileShiftOutput: 0 } };
    }
  }

  /**
   * Validation par étage AVANT ré-analyse : analyzeSolution ne fait pas
   * validateConfiguration, c'est donc ici que les incohérences se bloquent.
   * Renvoie un tableau parallèle de {errors[], ratio}.
   */
  function validateStages(stages, Registry) {
    return (stages || []).map(function (stage) {
      var errors = [];
      var def = Registry.get(registryId(stage.type));
      if (!def) return { errors: ['Type inconnu : ' + stage.type], ratio: null };

      if (stage.type === 'planetary') {
        var zp = (stage.ringTeeth - stage.sunTeeth) / 2;
        var count = stage.planetCount || 3;
        if (!Number.isInteger(zp) || zp <= 0) errors.push('Satellites impossibles : (couronne − solaire) doit être pair et positif.');
        else if (!Number.isInteger((stage.sunTeeth + stage.ringTeeth) / count)) errors.push('Assemblage impossible : (solaire + couronne) doit être divisible par ' + count + ' satellites.');
        var members = [stage.inputMember, stage.outputMember, stage.fixed];
        if (new Set(members).size !== 3) errors.push('Organes entrée / sortie / fixe : ils doivent être trois membres distincts.');
      }

      var valid = false;
      try { valid = def.validateConfiguration(stage); }
      catch (e) { errors.push('Configuration invalide : ' + (e && e.message || e)); }
      if (!valid && !errors.length) {
        errors.push(stage.type === 'belt'
          ? 'Entraxe trop court pour les deux poulies.'
          : 'Configuration invalide (dents ou paramètres hors limites).');
      }

      var ratio = null;
      try { ratio = def.calculateRatio(stage); } catch (e) { ratio = null; }
      if (stage.type !== 'rack' && !errors.length) {
        if (!Number.isFinite(ratio) || ratio === 0) errors.push('Rapport d’étage incalculable.');
        else if (Math.abs(ratio) > def.constraints.maxRatio) errors.push('Rapport d’étage ' + Math.abs(ratio).toFixed(2) + ' > maximum ' + def.constraints.maxRatio + ' pour ce type.');
      }
      return { errors: errors, ratio: ratio };
    });
  }

  /**
   * Ré-analyse complète d'une chaîne éditée. Ne mute JAMAIS l'entrée.
   * context = { target, engineeringOptions, manufacturing } (SolutionExplorer.getContext()).
   * deps    = { Engineering, ManufacturingRules, Registry }.
   */
  function reanalyze(stages, context, deps) {
    var copy = clone(stages);
    copy.forEach(function (stage) { stage.type = registryId(stage.type); stage.parameters = stage.parameters || {}; });
    try {
      var chainRatio = 1;
      copy.forEach(function (stage) {
        chainRatio *= Math.abs(deps.Registry.get(stage.type).calculateRatio(stage));
      });
      var target = Number.isFinite(context.target) && context.target > 0 ? context.target : (chainRatio || 1);
      var solution = deps.Engineering.analyzeSolution(copy, target, context.engineeringOptions || {});
      var manufacturing = deps.ManufacturingRules
        ? deps.ManufacturingRules.validate(solution, context.manufacturing || { mode: 'standard' })
        : null;
      if (manufacturing) solution.manufacturing = manufacturing;
      return { solution: solution, manufacturing: manufacturing };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  }

  /**
   * Deltas KPI entre la solution d'origine et la chaîne ré-analysée.
   * direction: 'down' = plus bas est mieux, 'up' = plus haut est mieux, null = neutre.
   */
  function diff(original, edited) {
    var rows = [];
    function push(label, before, after, direction, digits, unit) {
      var better = null;
      if (Number.isFinite(before) && Number.isFinite(after) && before !== after && direction) {
        better = direction === 'up' ? after > before : after < before;
      }
      rows.push({ label: label, before: before, after: after, better: better, digits: digits == null ? 2 : digits, unit: unit || '' });
    }
    push('Rapport', original.ratio, edited.ratio, null, 4);
    push('Écart', original.errorPercent, edited.errorPercent, 'down', 3, ' %');
    push('Rendement', original.efficiency * 100, edited.efficiency * 100, 'up', 1, ' %');
    push('SF min', minFactor(original, 'bending'), minFactor(edited, 'bending'), 'up', 2);
    push('SH min', minFactor(original, 'contact'), minFactor(edited, 'contact'), 'up', 2);
    push('Ø max', original.dimensions.maxDiameter, edited.dimensions.maxDiameter, 'down', 0, ' mm');
    push('Longueur', original.dimensions.length, edited.dimensions.length, 'down', 0, ' mm');
    push('Score (coût)', original.score.value, edited.score.value, 'down', 3);
    push('Avertissements', (original.warnings || []).length, (edited.warnings || []).length, 'down', 0);
    return rows;
  }

  return { defaultStage: defaultStage, validateStages: validateStages, reanalyze: reanalyze, diff: diff, clone: clone, registryId: registryId, minFactor: minFactor };
});

// ===== Classe DOM (navigateur uniquement) =====
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  var H = (typeof self !== 'undefined' ? self : window).GearStageEditorHelpers;

  // §19 : le nom d'une famille vient du registre, pas d'une table locale.
  var familyName = GearTransmissionRegistry.familyName;
  var MANUFACTURING_FAILURES = {
    MODULE_TOO_SMALL: 'Module sous la limite du procédé',
    TOO_FEW_TEETH: 'Dents sous la limite du procédé',
    FACE_WIDTH_TOO_SMALL: 'Largeur de denture insuffisante',
    PRINTER_DIAMETER: 'Diamètre supérieur au plateau d’impression'
  };

  // Champs au niveau étage, par type (les paramètres viennent en plus).
  var STAGE_FIELDS = {
    pair: [
      { path: 'input.teeth', label: 'Dents menantes', min: 4, step: 1 },
      { path: 'output.teeth', label: 'Dents menées', min: 4, step: 1 }
    ],
    worm: [
      { path: 'wormStarts', label: 'Filets de la vis', min: 1, max: 6, step: 1 },
      { path: 'wheelTeeth', label: 'Dents de la roue', min: 15, step: 1 }
    ],
    planetary: [
      { path: 'sunTeeth', label: 'Dents solaire', min: 6, step: 1 },
      { path: 'ringTeeth', label: 'Dents couronne', min: 20, step: 1 },
      { path: 'planetCount', label: 'Satellites', min: 2, max: 6, step: 1 }
    ]
  };

  // Paramètres explicites quand parameterDefinitions ne convient pas
  // (les clés worm* du registre servent au générateur, pas à un étage donné ;
  // les « paramètres » planétaires du registre sont des champs d'étage).
  var EXPLICIT_PARAMS = {
    worm: [
      { key: 'leadAngle', label: 'Angle d’avance (°)', min: 5, max: 45, step: 1 },
      { key: 'diameterQuotient', label: 'Quotient de diamètre q', min: 6, max: 20, step: 1 },
      { key: 'frictionCoefficient', label: 'Coefficient de frottement', min: 0.02, max: 0.2, step: 0.01 },
      { key: 'pressureAngle', label: 'Angle de pression (°)', min: 14.5, max: 25, step: 0.5 }
    ],
    planetary: [
      { key: 'faceWidth', label: 'Largeur (mm)', min: 1, step: 0.5 },
      { key: 'pressureAngle', label: 'Angle de pression (°)', min: 14.5, max: 25, step: 0.5 }
    ]
  };

  /**
   * Les diamètres primitifs éditables, et le nombre de dents qui les porte.
   *
   * Un diamètre primitif n'est pas une taille de dessin : c'est le produit du
   * module par le nombre de dents. On peut donc le SAISIR — c'est souvent lui
   * qu'un encombrement impose — à condition de dire quel nombre de dents en
   * résulte, et quel diamètre est réellement atteignable, le compte de dents
   * étant entier. C'est ce que GearSizing calcule, et que personne ne lisait.
   */
  var DIAMETER_FIELDS = {
    pair: [{ teeth: 'input.teeth', label: 'Ø primitif menant (mm)' },
      { teeth: 'output.teeth', label: 'Ø primitif mené (mm)' }],
    worm: [{ teeth: 'wheelTeeth', label: 'Ø primitif roue (mm)' }],
    planetary: [{ teeth: 'sunTeeth', label: 'Ø primitif solaire (mm)' },
      { teeth: 'ringTeeth', label: 'Ø primitif couronne (mm)' }]
  };

  function el(id) { return document.getElementById(id); }
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o && o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split('.'), last = keys.pop();
    var target = keys.reduce(function (o, k) { if (!o[k]) o[k] = {}; return o[k]; }, obj);
    target[last] = value;
  }
  function finite(value, digits) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }

  function StageEditor(eventBus, hostId, explorer) {
    this.bus = eventBus || GearApp.eventBus;
    this.host = el(hostId);
    this.explorer = explorer;
    this._original = null;   // solution du vivier (jamais mutée)
    this._index = -1;
    this._stages = null;     // copie de travail
    this._lastResult = null; // dernier reanalyze réussi
    this._dirty = false;
    this._pending = null;
    this._debounce = null;
  }

  StageEditor.prototype.bind = function () {
    var self = this;
    this.bus.on('solution:selected', function (data) {
      if (self._dirty && self._stages) { self._pending = data; self._renderPendingNotice(); return; }
      self.load(data.solution, data.index);
    });
    this.bus.on('editor:focus-stage', function (data) { self.focusStage(data.stage); });
  };

  StageEditor.prototype.load = function (solution, index) {
    this._original = solution || null;
    this._index = index;
    this._dirty = false;
    this._pending = null;
    this._lastResult = null;
    if (!solution) { this._renderEmpty(); return; }
    if (solution.mode === 'rotationTranslation') { this._renderLinearDisabled(); this._stages = null; return; }
    this._stages = H.clone(solution.stages);
    this._render();
    this._recompute();
  };

  StageEditor.prototype.focusStage = function (index) {
    if (!this.host) return;
    var row = this.host.querySelector('.editor-stage[data-stage="' + index + '"]');
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('focused');
    setTimeout(function () { row.classList.remove('focused'); }, 1200);
  };

  // ===== Rendus =====

  StageEditor.prototype._renderEmpty = function () {
    if (this.host) this.host.innerHTML = '<p class="detail-placeholder">Lancez une recherche puis sélectionnez une solution pour l’ouvrir dans l’éditeur.</p>';
  };

  StageEditor.prototype._renderLinearDisabled = function () {
    if (this.host) this.host.innerHTML = '<p class="detail-placeholder">L’éditeur d’étages s’applique aux transmissions rotatives. Le solveur linéaire (pignon-crémaillère) n’a qu’un étage, réglable via la configuration.</p>';
  };

  StageEditor.prototype._renderPendingNotice = function () {
    var notice = this.host && this.host.querySelector('.editor-pending');
    if (!notice) return;
    notice.hidden = false;
  };

  StageEditor.prototype._render = function () {
    if (!this.host) return;
    var self = this;
    this.host.innerHTML = '';

    var pending = document.createElement('div');
    pending.className = 'editor-pending';
    pending.hidden = true;
    pending.innerHTML = '<span>Une autre solution a été sélectionnée.</span>';
    var loadBtn = document.createElement('button');
    loadBtn.className = 'btn-small';
    loadBtn.textContent = 'Charger la nouvelle sélection';
    loadBtn.addEventListener('click', function () {
      if (self._pending) self.load(self._pending.solution, self._pending.index);
    });
    pending.appendChild(loadBtn);
    this.host.appendChild(pending);

    var rows = document.createElement('div');
    rows.className = 'editor-stages';
    this.host.appendChild(rows);
    this._stages.forEach(function (stage, index) { rows.appendChild(self._buildStageRow(stage, index)); });

    // Ajout d'étage
    var addBar = document.createElement('div');
    addBar.className = 'editor-add';
    var typeSelect = document.createElement('select');
    typeSelect.setAttribute('aria-label', 'Type du nouvel étage');
    GearTransmissionRegistry.list().forEach(function (def) {
      if (def.id === 'rack') return;
      var option = document.createElement('option');
      option.value = def.id;
      option.textContent = familyName(def.id, 'short');
      typeSelect.appendChild(option);
    });
    var addBtn = document.createElement('button');
    addBtn.className = 'btn-small';
    addBtn.textContent = '+ Ajouter un étage';
    addBtn.addEventListener('click', function () {
      var module = self._stages.length && self._stages[0].parameters && self._stages[0].parameters.module;
      self._stages.push(H.defaultStage(typeSelect.value, module));
      self._dirty = true;
      self._render();
      self._recompute();
    });
    addBar.append(typeSelect, addBtn);
    this.host.appendChild(addBar);

    // KPI + actions
    var kpis = document.createElement('div');
    kpis.className = 'editor-kpis';
    kpis.id = 'editorKpis';
    this.host.appendChild(kpis);

    var actions = document.createElement('div');
    actions.className = 'editor-actions';
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary btn-small';
    saveBtn.id = 'editorSaveVariant';
    saveBtn.textContent = 'Enregistrer comme variante';
    saveBtn.addEventListener('click', function () { self._saveVariant(); });
    var relaunchBtn = document.createElement('button');
    relaunchBtn.className = 'btn-small';
    relaunchBtn.id = 'editorRelaunch';
    relaunchBtn.title = 'Verrouille le premier étage édité et relance une recherche autour';
    relaunchBtn.textContent = 'Relancer autour';
    relaunchBtn.addEventListener('click', function () { self._relaunchAround(); });
    var resetBtn = document.createElement('button');
    resetBtn.className = 'btn-small';
    resetBtn.textContent = 'Réinitialiser';
    resetBtn.addEventListener('click', function () { self.load(self._original, self._index); });
    actions.append(saveBtn, relaunchBtn, resetBtn);
    this.host.appendChild(actions);
  };

  StageEditor.prototype._buildStageRow = function (stage, index) {
    var self = this;
    var registry = H.registryId(stage.type);
    var def = GearTransmissionRegistry.get(registry);
    var row = document.createElement('section');
    row.className = 'editor-stage';
    row.dataset.stage = index;

    var header = document.createElement('header');
    header.innerHTML = '<span class="type-badge ' + registry + '">' + (index + 1) + ' · ' + familyName(registry, 'short') + '</span>';
    var tools = document.createElement('span');
    tools.className = 'editor-stage-tools';
    [['▲', 'Monter', -1], ['▼', 'Descendre', 1]].forEach(function (item) {
      var btn = document.createElement('button');
      btn.className = 'btn-small';
      btn.textContent = item[0];
      btn.title = item[1];
      btn.addEventListener('click', function () {
        var target = index + item[2];
        if (target < 0 || target >= self._stages.length) return;
        var moved = self._stages.splice(index, 1)[0];
        self._stages.splice(target, 0, moved);
        self._dirty = true;
        self._render();
        self._recompute();
      });
      tools.appendChild(btn);
    });
    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn-small';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Supprimer cet étage';
    removeBtn.disabled = this._stages.length <= 1;
    removeBtn.addEventListener('click', function () {
      self._stages.splice(index, 1);
      self._dirty = true;
      self._render();
      self._recompute();
    });
    tools.appendChild(removeBtn);
    header.appendChild(tools);
    row.appendChild(header);

    var grid = document.createElement('div');
    grid.className = 'editor-fields';
    row.appendChild(grid);

    function numberField(label, value, attrs, onChange) {
      var wrap = document.createElement('label');
      wrap.className = 'sub';
      wrap.textContent = label;
      var input = document.createElement('input');
      input.type = 'number';
      Object.keys(attrs || {}).forEach(function (k) {
        if (attrs[k] === undefined) return;
        // Les attributs `data-` ne sont pas des propriétés : les poser comme
        // telles créerait un champ muet côté DOM, invisible aux sélecteurs.
        if (k.indexOf('data-') === 0) input.setAttribute(k, attrs[k]); else input[k] = attrs[k];
      });
      input.value = value;
      input.addEventListener('input', function () {
        var parsed = parseFloat(input.value);
        if (Number.isFinite(parsed)) { onChange(parsed); self._dirty = true; self._scheduleRecompute(); }
      });
      wrap.appendChild(input);
      grid.appendChild(wrap);
      return input;
    }
    function selectField(label, value, options, labels, onChange) {
      var wrap = document.createElement('label');
      wrap.className = 'sub';
      wrap.textContent = label;
      var select = document.createElement('select');
      options.forEach(function (opt, i) {
        var option = document.createElement('option');
        option.value = opt;
        option.textContent = labels ? labels[i] : opt;
        if (String(opt) === String(value)) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function () { onChange(select.value); self._dirty = true; self._scheduleRecompute(); });
      wrap.appendChild(select);
      grid.appendChild(wrap);
      return select;
    }
    function checkboxField(label, checked, onChange) {
      var wrap = document.createElement('label');
      wrap.className = 'checkbox-label';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!checked;
      input.addEventListener('change', function () { onChange(input.checked); self._dirty = true; self._scheduleRecompute(); });
      wrap.appendChild(input);
      wrap.appendChild(document.createTextNode(' ' + label));
      grid.appendChild(wrap);
    }

    // Champs d'étage
    var teethInputs = {};
    var refreshDiameters = function () {};
    var stageFields = STAGE_FIELDS[registry] || STAGE_FIELDS.pair;
    stageFields.forEach(function (field) {
      teethInputs[field.path] = numberField(field.label, getPath(stage, field.path), { min: field.min, max: field.max, step: field.step, 'data-field': field.path }, function (value) {
        setPath(stage, field.path, Math.round(value));
        if (registry === 'planetary') stage.planetTeeth = (stage.ringTeeth - stage.sunTeeth) / 2;
        refreshDiameters();
      });
    });
    if (registry === 'planetary') {
      ['inputMember', 'outputMember', 'fixed'].forEach(function (key) {
        var labels = { inputMember: 'Organe entrée', outputMember: 'Organe sortie', fixed: 'Organe fixe' };
        selectField(labels[key], stage[key], ['S', 'R', 'C'], ['S', 'R', 'C'].map(GearTransmissionRegistry.memberLabel), function (value) { stage[key] = value; });
      });
    }

    // Module (types à denture)
    stage.parameters = stage.parameters || {};
    if (def.capabilities.usesModule) {
      numberField('Module (mm)', stage.parameters.module || 1, { min: 0.1, step: 0.1 }, function (value) { stage.parameters.module = value; });
    }

    // Ø primitif : la grandeur qu'un encombrement impose, et qu'on ne pouvait
    // que subir. On la saisit, GearSizing en déduit le nombre de dents — entier,
    // donc le diamètre atteignable est discret — et le dit au lieu d'arrondir
    // en silence. Rien n'est mis à l'échelle : c'est la denture qui change.
    // Une crémaillère n'a pas de roue menée : elle n'entre pas dans ce repli.
    var sizingFields = DIAMETER_FIELDS[registry]
      || (stage.input && stage.output ? DIAMETER_FIELDS.pair : null);
    if (def.capabilities.usesModule && sizingFields && typeof GearSizing !== 'undefined') {
      var sized = sizingFields.map(function (field) {
        var note = document.createElement('span');
        note.className = 'sizing-note';
        var input = numberField(field.label, '', { min: 0.1, step: 0.1, 'data-sizing': field.teeth }, function (value) {
          var solved = GearSizing.solve({ module: stage.parameters.module,
            diameter: value, helixAngleDeg: stage.parameters.helixAngle });
          note.textContent = solved.message;
          note.classList.toggle('is-conflict', solved.status !== 'solved');
          if (solved.status !== 'solved' || !Number.isFinite(solved.teeth)) return;
          setPath(stage, field.teeth, solved.teeth);
          if (teethInputs[field.teeth]) teethInputs[field.teeth].value = solved.teeth;
          if (registry === 'planetary') stage.planetTeeth = (stage.ringTeeth - stage.sunTeeth) / 2;
        });
        input.parentNode.appendChild(note);
        return { field: field, input: input, note: note };
      });
      // Les deux grandeurs restent d'accord dans les deux sens : changer les
      // dents met à jour le diamètre, sans quoi l'un des deux champs mentirait.
      refreshDiameters = function (silent) {
        sized.forEach(function (entry) {
          var teeth = getPath(stage, entry.field.teeth);
          var reached = Number.isFinite(teeth) && Number.isFinite(stage.parameters.module)
            ? GearSizing.diameterOf(stage.parameters.module, teeth, stage.parameters.helixAngle) : null;
          if (document.activeElement !== entry.input) entry.input.value = Number.isFinite(reached) ? reached.toFixed(2) : '';
          if (!silent) { entry.note.textContent = ''; entry.note.classList.remove('is-conflict'); }
        });
      };
      refreshDiameters(true);
    }

    // Paramètres spécifiques
    var explicit = EXPLICIT_PARAMS[registry];
    if (explicit) {
      explicit.forEach(function (field) {
        numberField(field.label, stage.parameters[field.key] !== undefined ? stage.parameters[field.key] : '', { min: field.min, max: field.max, step: field.step }, function (value) { stage.parameters[field.key] = value; });
      });
    } else {
      var defs = GearTransmissionRegistry.parameterDefinitions[registry] || {};
      Object.keys(defs).forEach(function (key) {
        var definition = defs[key];
        var current = stage.parameters[key] !== undefined ? stage.parameters[key] : definition.default;
        if (definition.options) {
          selectField(definition.label, current, definition.options, definition.optionLabels, function (value) {
            stage.parameters[key] = value;
            // Le pas de courroie découle du profil choisi.
            if (registry === 'belt' && key === 'profile') stage.parameters.pitch = GearTransmissionRegistry.beltPitches[value] || 2;
          });
        } else if (definition.type === 'checkbox') {
          checkboxField(definition.label, current, function (value) { stage.parameters[key] = value; });
        } else {
          numberField(definition.label, current, { min: definition.min, max: definition.max, step: definition.step }, function (value) { stage.parameters[key] = value; });
        }
      });
    }

    var errors = document.createElement('ul');
    errors.className = 'editor-stage-errors';
    row.appendChild(errors);
    return row;
  };

  // ===== Recalcul =====

  StageEditor.prototype._scheduleRecompute = function () {
    var self = this;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(function () { self._recompute(); }, 150);
  };

  StageEditor.prototype._recompute = function () {
    if (!this.host || !this._stages) return;
    var self = this;
    var checks = H.validateStages(this._stages, GearTransmissionRegistry);
    var blocking = false;
    this.host.querySelectorAll('.editor-stage').forEach(function (row, index) {
      var list = row.querySelector('.editor-stage-errors');
      var check = checks[index] || { errors: [] };
      list.innerHTML = check.errors.map(function (message) { return '<li>' + message + '</li>'; }).join('');
      row.classList.toggle('has-errors', check.errors.length > 0);
      if (check.errors.length) blocking = true;
    });

    var kpis = el('editorKpis');
    var saveBtn = el('editorSaveVariant');
    if (blocking) {
      this._lastResult = null;
      if (kpis) kpis.innerHTML = '<p class="field-error">Corrigez les étages signalés pour recalculer la chaîne.</p>';
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    var context = this.explorer ? this.explorer.getContext() : { target: null, engineeringOptions: {}, manufacturing: { mode: 'standard' } };
    var result = H.reanalyze(this._stages, context, {
      Engineering: window.GearEngineering,
      ManufacturingRules: window.ManufacturingRules,
      Registry: GearTransmissionRegistry
    });

    if (result.error) {
      this._lastResult = null;
      if (kpis) kpis.innerHTML = '<p class="field-error">Ré-analyse impossible : ' + result.error + '</p>';
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    this._lastResult = result;
    if (saveBtn) saveBtn.disabled = false;
    if (!kpis) return;

    var rows = H.diff(this._original, result.solution);
    var cells = rows.map(function (row) {
      var cls = row.better === true ? 'delta-better' : row.better === false ? 'delta-worse' : '';
      return '<div class="editor-kpi ' + cls + '"><span>' + row.label + '</span>' +
        '<strong>' + finite(row.after, row.digits) + row.unit + '</strong>' +
        '<small>avant : ' + finite(row.before, row.digits) + row.unit + '</small></div>';
    }).join('');

    var failures = (result.manufacturing && result.manufacturing.failures) || [];
    var failuresHtml = failures.length
      ? '<p class="editor-failures">⚠ Constructibilité : ' + failures.map(function (code) { return MANUFACTURING_FAILURES[code] || code; }).join(' · ') + '</p>'
      : '<p class="editor-ok">✓ Règles de fabrication (' + ((result.manufacturing && result.manufacturing.rules && result.manufacturing.rules.mode) || 'standard') + ') respectées</p>';

    var warnings = (result.solution.warnings || []).slice(0, 3).map(function (w) {
      return '<span class="status-badge warning">⚠ ' + w.code + '</span>';
    }).join(' ');

    kpis.innerHTML = '<div class="editor-kpi-grid">' + cells + '</div>' + failuresHtml +
      (warnings ? '<div class="status-badges">' + warnings + '</div>' : '');
  };

  // ===== Actions =====

  StageEditor.prototype._saveVariant = function () {
    if (!this._lastResult || !this._lastResult.solution || !this.explorer) return;
    var solution = this._lastResult.solution;
    solution.origin = 'variante';
    var module = solution.stages[0] && solution.stages[0].parameters && solution.stages[0].parameters.module;
    solution.stats = solution.stats || {};
    solution.stats.moduleMode = 'manual';
    solution.stats.selectedModule = Number.isFinite(module) ? module : null;
    this._dirty = false;
    this.explorer.addVariant(solution);
  };

  StageEditor.prototype._relaunchAround = function () {
    if (!this._stages || !this._stages.length) return;
    var first = this._stages[0];
    var registry = H.registryId(first.type);
    var lead = registry === 'worm' ? first.wormStarts
      : registry === 'planetary' ? first.sunTeeth
      : first.input && first.input.teeth;
    var fixedInput = el('dent_menante_fixe');
    if (fixedInput && Number.isFinite(lead)) fixedInput.value = lead;

    // Gabarit d'architecture calqué sur la chaîne éditée : chaque étage impose
    // son type ('planetary' redevient 'epicyclic', l'espace de noms de l'UI).
    var uiTypes = this._stages.map(function (stage) {
      var id = H.registryId(stage.type);
      return id === 'planetary' ? 'epicyclic' : id;
    });
    uiTypes.forEach(function (type) {
      var checkbox = el('type-' + type);
      if (checkbox && !checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    var hidden = el('type_template');
    if (hidden) hidden.value = JSON.stringify(uiTypes.map(function (type) { return [type]; }));
    var etages = el('etages');
    if (etages) {
      etages.value = this._stages.length;
      etages.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this._dirty = false;
    if (typeof window.lancerRecherche === 'function') window.lancerRecherche();
  };

  GearApp.ui.StageEditor = StageEditor;

})(typeof GearApp !== 'undefined' ? GearApp : null);
