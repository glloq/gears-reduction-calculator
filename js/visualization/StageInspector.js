/* Inspecteur d'étage partagé par les vues de visualisation. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearStageInspector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function finite(v) { return Number.isFinite(v); }
  function format(v, digits, suffix) { return finite(v) ? v.toFixed(digits == null ? 2 : digits) + (suffix || '') : null; }
  function model(solution, index, registry) {
    var stage = (solution && solution.stages || [])[index], mech = (solution && solution.mechanical || [])[index] || {};
    if (!stage) return null;
    var geometry = stage.geometry || mech.geometry || {}, teeth = [];
    try { teeth = registry && registry.getToothCounts ? registry.getToothCounts(stage) : []; } catch (e) { teeth = []; }
    var inputRpm = index === 0 ? solution.inputSpeedRpm : null;
    if (!finite(inputRpm) && finite(solution.inputSpeedRpm)) inputRpm = solution.inputSpeedRpm / (solution.mechanical || []).slice(0, index).reduce(function (r, m) { return r * (Math.abs(m.ratio) || 1); }, 1);
    var outputRpm = finite(inputRpm) && finite(mech.ratio) ? inputRpm / Math.abs(mech.ratio) : null;
    return { index: index, type: stage.type, teeth: teeth.filter(function (v) { return finite(v) && v > 0; }), ratio: mech.ratio,
      efficiency: mech.efficiency, centerDistance: geometry.centerDistance, module: stage.parameters && stage.parameters.module,
      inputRpm: inputRpm, outputRpm: outputRpm, inputTorque: mech.inputTorqueNm, outputTorque: mech.outputTorqueNm || mech.torqueNm,
      bendingSafety: mech.bending && mech.bending.safetyFactor, contactSafety: mech.contact && mech.contact.safetyFactor };
  }
  function Inspector(container, options) { this.container = container; this.options = options || {}; this.solution = null; this.element = null; }
  Inspector.prototype.setSolution = function (solution) { this.solution = solution; return this; };
  Inspector.prototype._element = function () {
    if (this.element && this.element.isConnected) return this.element;
    if (this.element) { this.container.appendChild(this.element); return this.element; }
    var card = document.createElement('aside'); card.className = 'stage-inspector'; card.hidden = true; card.setAttribute('aria-live', 'polite');
    this.container.appendChild(card); this.element = card; return card;
  };
  Inspector.prototype.hide = function () { if (this.element) this.element.hidden = true; };
  Inspector.prototype.show = function (index) {
    var data = model(this.solution, index, this.options.registry); if (!data) return;
    var card = this._element(), self = this; card.textContent = '';
    var header = document.createElement('header'), title = document.createElement('span'); title.className = 'type-badge ' + data.type; title.textContent = (index + 1) + ' · ' + data.type;
    var close = document.createElement('button'); close.type = 'button'; close.className = 'btn-small'; close.setAttribute('aria-label', 'Fermer'); close.textContent = '✕'; header.appendChild(title); header.appendChild(close); card.appendChild(header);
    var grid = document.createElement('div'); grid.className = 'inspector-grid';
    [["Dents", data.teeth.join(' / ') || null], ['Rapport', format(data.ratio, 3, ':1')], ['Rendement', finite(data.efficiency) ? format(data.efficiency * 100, 1, ' %') : null],
      ['Entraxe', format(data.centerDistance, 2, ' mm')], ['Module', finite(data.module) ? data.module + ' mm' : null], ['Vitesse', finite(data.inputRpm) && finite(data.outputRpm) ? format(data.inputRpm, 0, ' → ') + format(data.outputRpm, 0, ' rpm') : null],
      ['Couple', finite(data.inputTorque) && finite(data.outputTorque) ? format(data.inputTorque, 1, ' → ') + format(data.outputTorque, 1, ' Nm') : null], ['SF / SH', (format(data.bendingSafety, 2) || '—') + ' / ' + (format(data.contactSafety, 2) || '—')]].forEach(function (item) {
        if (item[1] == null || item[1] === '') return; var row = document.createElement('div'), label = document.createElement('span'), value = document.createElement('strong'); label.textContent = item[0]; value.textContent = item[1]; row.appendChild(label); row.appendChild(value); grid.appendChild(row);
      });
    card.appendChild(grid); var edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn-small btn-primary'; edit.textContent = 'Modifier cet étage'; card.appendChild(edit); card.hidden = false;
    close.addEventListener('click', function () { self.hide(); if (self.options.onClose) self.options.onClose(index); });
    edit.addEventListener('click', function () { if (self.options.onEdit) self.options.onEdit(index); });
  };
  return { Inspector: Inspector, model: model };
});
