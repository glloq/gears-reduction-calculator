/* Badges graphiques discrets pour les alertes mécaniques structurées. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearWarningOverlay = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SUPPORTED = { LOW_CONTACT_RATIO: 1, UNDERCUT: 1, LOW_BENDING_SAFETY: 1, LOW_CONTACT_SAFETY: 1, HIGH_AXIAL_LOAD: 1 };
  function forStage(warnings, index) { return (warnings || []).filter(function (w) { var stage = w && (w.stageIndex != null ? w.stageIndex : Number.isFinite(w.stage) ? w.stage - 1 : null); return w && SUPPORTED[w.code] && (stage == null || stage === index); }); }
  function render(create, host, warnings, index, origin) { var list = forStage(warnings, index); if (!list.length) return; var g = create('g', { class: 'warning-overlay', transform: 'translate(' + origin.x + ' ' + origin.y + ')' }); list.slice(0, 3).forEach(function (w, i) { var badge = create('g', { class: 'mechanical-warning warning-' + String(w.level || 'warning'), transform: 'translate(' + (i * 15) + ' 0)' }); badge.appendChild(create('circle', { r: 6 })); badge.appendChild(create('text', { 'text-anchor': 'middle', dy: '.35em' }, '!')); badge.appendChild(create('title', {}, w.code + ' — ' + (w.message || 'Avertissement mécanique'))); g.appendChild(badge); }); host.appendChild(g); }
  function derive(stage, mechanical) { var g = stage && stage.geometry || {}, m = mechanical || {}, f = m.forces || {}, result = [];
    if (Number.isFinite(g.totalContactRatio) && g.totalContactRatio < 1.2) result.push({ code: 'LOW_CONTACT_RATIO', message: 'Rapport de conduite faible' });
    if (stage && stage.input && Number.isFinite(stage.input.teeth) && stage.input.teeth < 17 + ((stage.parameters && stage.parameters.profileShiftInput) || 0) * -10) result.push({ code: 'UNDERCUT', message: 'Sous-coupe probable' });
    if (m.bending && m.bending.safetyFactor < 1.3) result.push({ code: 'LOW_BENDING_SAFETY', level: 'danger', message: 'Sécurité en flexion faible' });
    if (m.contact && m.contact.safetyFactor < 1.1) result.push({ code: 'LOW_CONTACT_SAFETY', level: 'danger', message: 'Sécurité au contact faible' });
    if (Math.abs(f.axialN || 0) > Math.abs(f.tangentialN || 0)) result.push({ code: 'HIGH_AXIAL_LOAD', message: 'Effort axial élevé' }); return result; }
  return { supported: SUPPORTED, forStage: forStage, derive: derive, render: render };
});
