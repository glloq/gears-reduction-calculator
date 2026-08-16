/* Inspecteur d'étage partagé par les vues de visualisation. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearStageInspector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function finite(v) { return Number.isFinite(v); }
  function format(v, digits, suffix) { return finite(v) ? v.toFixed(digits == null ? 2 : digits) + (suffix || '') : null; }
  /**
   * Les vitesses viennent de la SCÈNE quand elle est fournie : l'inspecteur ne
   * refait pas la cascade des rapports, il lit le même moteur cinématique que
   * les trois vues. La reconstruction locale ne subsiste qu'en dernier recours.
   */
  function model(solution, index, registry, scene) {
    var stage = (solution && solution.stages || [])[index], mech = (solution && solution.mechanical || [])[index] || {};
    if (!stage) return null;
    var geometry = stage.geometry || mech.geometry || {}, teeth = [];
    try { teeth = registry && registry.getToothCounts ? registry.getToothCounts(stage) : []; } catch (e) { teeth = []; }
    var inputRpm = null, outputRpm = null;
    if (scene && scene.member) {
      var driving = scene.member('s' + index + '-input') || scene.member('s' + index + '-S');
      var driven = scene.member('s' + index + '-output') || scene.member('s' + index + '-C');
      if (driving && finite(driving.mechanical.rpm)) inputRpm = driving.mechanical.rpm;
      if (driven && finite(driven.mechanical.rpm)) outputRpm = driven.mechanical.rpm;
    }
    if (!finite(inputRpm)) {
      inputRpm = index === 0 ? solution.inputSpeedRpm : null;
      if (!finite(inputRpm) && finite(solution.inputSpeedRpm)) inputRpm = solution.inputSpeedRpm / (solution.mechanical || []).slice(0, index).reduce(function (r, m) { return r * (Math.abs(m.ratio) || 1); }, 1);
    }
    if (!finite(outputRpm)) outputRpm = finite(inputRpm) && finite(mech.ratio) ? inputRpm / Math.abs(mech.ratio) : null;
    return { index: index, type: stage.type, teeth: teeth.filter(function (v) { return finite(v) && v > 0; }), ratio: mech.ratio,
      efficiency: mech.efficiency, centerDistance: geometry.centerDistance, module: stage.parameters && stage.parameters.module,
      inputRpm: inputRpm, outputRpm: outputRpm, inputTorque: mech.inputTorqueNm, outputTorque: mech.outputTorqueNm || mech.torqueNm,
      bendingSafety: mech.bending && mech.bending.safetyFactor, contactSafety: mech.contact && mech.contact.safetyFactor };
  }
  function Inspector(container, options) { this.container = container; this.options = options || {}; this.solution = null; this.element = null; }
  Inspector.prototype.setSolution = function (solution, scene) { this.solution = solution; this.scene = scene || null; return this; };
  Inspector.prototype._element = function () {
    if (this.element && this.element.isConnected) return this.element;
    if (this.element) { this.container.appendChild(this.element); return this.element; }
    // L'identifiant est un contrat public : les e2e et les scripts d'intégration
    // ciblent #stageInspector / #stageInspectorEdit, quelle que soit la vue.
    var card = document.createElement('aside'); card.id = 'stageInspector'; card.className = 'stage-inspector';
    card.hidden = true; card.setAttribute('aria-live', 'polite');
    this.container.appendChild(card); this.element = card; return card;
  };
  Inspector.prototype.hide = function () { if (this.element) this.element.hidden = true; };
  Inspector.prototype.show = function (index) {
    var data = model(this.solution, index, this.options.registry, this.scene); if (!data) return;
    var card = this._element(), self = this; card.textContent = '';
    var header = document.createElement('header'), title = document.createElement('span'); title.className = 'type-badge ' + data.type; title.textContent = (index + 1) + ' · ' + data.type;
    var close = document.createElement('button'); close.type = 'button'; close.className = 'btn-small'; close.setAttribute('aria-label', 'Fermer'); close.textContent = '✕'; header.appendChild(title); header.appendChild(close); card.appendChild(header);
    // Groupes thématiques plutôt qu'une liste plate : on lit d'abord ce que
    // fait l'étage, ensuite comment il est taillé. Un groupe sans donnée
    // fiable n'est pas affiché du tout.
    var grid = document.createElement('div'); grid.className = 'inspector-grid';
    var GROUPS = [
      { title: null, rows: [
        ['Dents', data.teeth.join(' → ') || null],
        ['Rapport', format(data.ratio, 3, ' : 1')]
      ] },
      { title: 'Entrée', rows: [
        ['Vitesse', finite(data.inputRpm) ? format(Math.abs(data.inputRpm), 0, ' rpm') : null],
        ['Couple', format(data.inputTorque, 1, ' N·m')]
      ] },
      { title: 'Sortie', rows: [
        ['Vitesse', finite(data.outputRpm) ? format(Math.abs(data.outputRpm), 0, ' rpm ') + (data.outputRpm < 0 ? '↻' : '↺') : null],
        ['Couple', format(data.outputTorque, 1, ' N·m')]
      ] },
      { title: 'Géométrie', rows: [
        ['Module', finite(data.module) ? data.module + ' mm' : null],
        ['Entraxe', format(data.centerDistance, 2, ' mm')]
      ] },
      { title: 'Rendement', rows: [
        ['Étage', finite(data.efficiency) ? format(data.efficiency * 100, 1, ' %') : null]
      ] },
      { title: 'Sécurité', rows: [
        ['SF flexion', format(data.bendingSafety, 2)],
        ['SH contact', format(data.contactSafety, 2)]
      ] }
    ];
    GROUPS.forEach(function (group) {
      var rows = group.rows.filter(function (row) { return row[1] != null && row[1] !== ''; });
      if (!rows.length) return;
      if (group.title) {
        var heading = document.createElement('h4');
        heading.className = 'inspector-group';
        heading.textContent = group.title;
        grid.appendChild(heading);
      }
      rows.forEach(function (row) {
        var line = document.createElement('div'), label = document.createElement('span'), value = document.createElement('strong');
        label.textContent = row[0]; value.textContent = row[1];
        line.appendChild(label); line.appendChild(value); grid.appendChild(line);
      });
    });
    card.appendChild(grid);
    var edit = document.createElement('button'); edit.type = 'button'; edit.id = 'stageInspectorEdit'; edit.className = 'btn-small btn-primary'; edit.textContent = 'Modifier cet étage'; card.appendChild(edit); card.hidden = false;
    close.addEventListener('click', function () { self.hide(); if (self.options.onClose) self.options.onClose(index); });
    edit.addEventListener('click', function () { if (self.options.onEdit) self.options.onEdit(index); });
  };
  return { Inspector: Inspector, model: model };
});
