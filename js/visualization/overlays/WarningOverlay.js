/* Badges graphiques discrets pour les alertes mécaniques structurées.
 *
 * Ce module NE DÉCIDE RIEN. Il posait ses propres seuils — rapport de conduite
 * sous 1,2, SF sous 1,3, SH sous 1,1 — c'est-à-dire qu'il jugeait la mécanique
 * pour son compte, avec une deuxième copie des limites du moteur. Deux copies
 * divergent tôt ou tard, et le jour venu le dessin aurait dit « ! » là où
 * l'analyse disait « conforme », sur le même réducteur.
 *
 * Il affiche donc les alertes que le moteur a émises, et rien d'autre. La
 * portée vient de `stageIndex` : une alerte de chaîne — rendement global,
 * échauffement — ne se pose sur aucun étage.
 *
 * Principe de rendu inchangé : pas de rouge partout, et comme les efforts le
 * groupe est ancré en monde mais dimensionné à l'écran (data-viewer-scale),
 * pour rester lisible sur un pignon de 10 mm comme sur une couronne de 300.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../../core/SolutionCompliance.js') : root.GearSolutionCompliance);
  if (common) module.exports = api; else root.GearWarningOverlay = api;
})(typeof self !== 'undefined' ? self : this, function (catalogue) {
  'use strict';
  /**
   * Les alertes d'un étage : celles dont la PORTÉE est cet étage. Une alerte
   * sans portée vaut pour la chaîne entière et n'a rien à faire sur une roue —
   * elle s'affichait pourtant sur toutes, faute de savoir où la mettre.
   */
  function forStage(warnings, index) {
    return (warnings || []).filter(function (w) {
      if (!w || !w.code) return false;
      var stage = Number.isFinite(w.stageIndex) ? w.stageIndex
        : Number.isFinite(w.stage) ? w.stage - 1 : null;
      return stage === index;
    });
  }

  /**
   * §12 : un badge « ! » qui n'est qu'une infobulle laisse le lecteur chercher
   * lui-même l'étage concerné, puis la grandeur fautive. Il devient un chemin :
   * cliquer désigne l'étage, et l'inspecteur docké en donne la cause chiffrée.
   * @param {function(number)} [onSelect] désigne l'étage — fourni par le renderer,
   *   qui reste seul maître de la sélection.
   */
  function render(create, host, warnings, index, origin, onSelect) {
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
        'data-warning': w.code, 'data-stage': index,
        transform: 'translate(' + (start + i * 15) + ' -13)' });
      badge.appendChild(create('circle', { r: 6 }));
      badge.appendChild(create('text', { 'text-anchor': 'middle', dy: '.35em' }, '!'));
      // Le message vient du moteur, déjà en français : le viewer ne le
      // reformule pas, et n'affiche jamais le code interne.
      badge.appendChild(create('title', {}, (w.message || catalogue.label(w.code)) +
        (w.recommendation ? '\n' + w.recommendation : '')));
      if (onSelect) {
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('role', 'button');
        badge.setAttribute('aria-label', 'Étage ' + (index + 1) + ' — ' + (w.message || catalogue.label(w.code)));
        badge.addEventListener('click', function (event) { event.stopPropagation(); onSelect(index); });
        badge.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index); }
        });
      }
      g.appendChild(badge);
    });
    host.appendChild(g);
    return g;
  }

  return { forStage: forStage, render: render };
});
