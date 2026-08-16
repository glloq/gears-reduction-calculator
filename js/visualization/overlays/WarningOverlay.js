/* Badges graphiques discrets pour les alertes mécaniques structurées.
 *
 * Principe : pas de rouge partout. Un badge n'apparaît que si l'étage est
 * réellement problématique, et seuls les codes structurés connus sont rendus.
 * Comme les efforts, le groupe est ancré en monde mais dimensionné à l'écran
 * (data-viewer-scale) : un badge doit rester lisible sur un pignon de 10 mm
 * comme sur une couronne de 300 mm.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearWarningOverlay = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SUPPORTED = { LOW_CONTACT_RATIO: 1, UNDERCUT: 1, LOW_BENDING_SAFETY: 1, LOW_CONTACT_SAFETY: 1, HIGH_AXIAL_LOAD: 1 };
  var LABELS = {
    LOW_CONTACT_RATIO: 'Rapport de conduite faible',
    UNDERCUT: 'Sous-coupe probable',
    LOW_BENDING_SAFETY: 'Sécurité en flexion faible',
    LOW_CONTACT_SAFETY: 'Sécurité au contact faible',
    HIGH_AXIAL_LOAD: 'Effort axial élevé'
  };

  function forStage(warnings, index) {
    return (warnings || []).filter(function (w) {
      var stage = w && (w.stageIndex != null ? w.stageIndex : Number.isFinite(w.stage) ? w.stage - 1 : null);
      return w && SUPPORTED[w.code] && (stage == null || stage === index);
    });
  }

  function render(create, host, warnings, index, origin) {
    var list = forStage(warnings, index);
    if (!list.length) return null;
    var g = create('g', { class: 'warning-overlay', 'data-viewer-scale': '',
      'data-anchor-x': origin.x, 'data-anchor-y': origin.y,
      transform: 'translate(' + origin.x + ' ' + origin.y + ')' });
    // Rangée centrée juste au-dessus du point d'ancrage : les coordonnées
    // locales sont des pixels écran une fois l'échelle appliquée.
    var start = -(Math.min(list.length, 3) - 1) * 7.5;
    list.slice(0, 3).forEach(function (w, i) {
      var badge = create('g', { class: 'mechanical-warning warning-' + String(w.level || 'warning'),
        transform: 'translate(' + (start + i * 15) + ' -13)' });
      badge.appendChild(create('circle', { r: 6 }));
      badge.appendChild(create('text', { 'text-anchor': 'middle', dy: '.35em' }, '!'));
      badge.appendChild(create('title', {}, w.code + ' — ' + (w.message || LABELS[w.code] || 'Avertissement mécanique')));
      g.appendChild(badge);
    });
    host.appendChild(g);
    return g;
  }

  /** Dérive les alertes d'un étage à partir de sa géométrie et de son analyse. */
  function derive(stage, mechanical) {
    var g = stage && stage.geometry || {}, m = mechanical || {}, f = m.forces || {}, result = [];
    if (Number.isFinite(g.totalContactRatio) && g.totalContactRatio < 1.2) result.push({ code: 'LOW_CONTACT_RATIO', message: LABELS.LOW_CONTACT_RATIO });
    if (stage && stage.input && Number.isFinite(stage.input.teeth) && stage.input.teeth < 17 + ((stage.parameters && stage.parameters.profileShiftInput) || 0) * -10) result.push({ code: 'UNDERCUT', message: LABELS.UNDERCUT });
    if (m.bending && m.bending.safetyFactor < 1.3) result.push({ code: 'LOW_BENDING_SAFETY', level: 'danger', message: LABELS.LOW_BENDING_SAFETY });
    if (m.contact && m.contact.safetyFactor < 1.1) result.push({ code: 'LOW_CONTACT_SAFETY', level: 'danger', message: LABELS.LOW_CONTACT_SAFETY });
    if (Math.abs(f.axialN || 0) > Math.abs(f.tangentialN || 0)) result.push({ code: 'HIGH_AXIAL_LOAD', message: LABELS.HIGH_AXIAL_LOAD });
    return result;
  }

  return { supported: SUPPORTED, labels: LABELS, forStage: forStage, derive: derive, render: render };
});
