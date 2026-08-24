// SearchProgress.js - Ce que fait la machine pendant qu'on attend.
//
// Le moteur publiait déjà tout : pourcentage, branches évaluées, profondeur,
// rapport courant, solutions trouvées, motifs de rejet, temps écoulé. Rien de
// tout cela n'arrivait à l'écran.
//
// La raison n'était pas un oubli d'affichage mais un effet de bord de la
// refonte : `#status`, la barre et les statistiques vivent dans l'en-tête du
// panneau de résultats, et ce panneau n'est affiché que sous `body.has-results`.
// Tant que la première recherche n'a rien rendu, ils existent, se mettent à
// jour — et restent invisibles. L'utilisateur voyait donc l'état vide, celui
// qui dit « décrivez la transmission que vous recherchez », pendant que le
// worker tournait : un écran qui a l'air au repos alors qu'il travaille.
//
// Ce panneau est la troisième lecture des mêmes événements, et il n'en calcule
// aucun de son côté : il occupe la place de l'état vide tant que la recherche
// dure, et rend la main ensuite.
(function (GearApp) {
  'use strict';

  /** 1 240 000 → « 1 240 000 » : un compteur qui défile doit rester lisible. */
  function count(value) {
    if (!Number.isFinite(value)) return '0';
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function seconds(ms) {
    if (!Number.isFinite(ms)) return null;
    return (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  }

  /**
   * Pourquoi les branches ont été écartées. Les catégories vides ne sont pas
   * affichées : « dimensions 0 » n'apprend rien et noie celles qui comptent.
   */
  var REJECTIONS = [
    { key: 'ratio', label: 'hors tolérance de rapport' },
    { key: 'geometry', label: 'géométrie impossible' },
    { key: 'dimensions', label: 'encombrement' },
    { key: 'mechanics', label: 'tenue mécanique' },
    { key: 'manufacturing', label: 'fabrication' }
  ];

  function SearchProgress(eventBus) {
    this._bus = eventBus || GearApp.eventBus;
    this._host = document.getElementById('workspaceSearching');
    this._bar = document.getElementById('searchProgressBar');
    this._gauge = document.getElementById('searchProgressGauge');
    this._figures = document.getElementById('searchProgressFigures');
    this._rejects = document.getElementById('searchProgressRejects');
    this._running = false;
    var self = this;
    this._bus.on('search:progress', function (data) { self.setPercent(data && data.percent); });
    this._bus.on('search:stats', function (stats) { self._render(stats); });
  }

  /** La recherche commence : on repart d'un panneau vierge, pas des chiffres
   *  de la précédente — ils feraient croire à une progression instantanée. */
  SearchProgress.prototype.start = function () {
    this._running = true;
    document.body.classList.add('is-searching');
    this.setPercent(0);
    if (this._figures) this._figures.textContent = 'Démarrage du solveur…';
    if (this._rejects) { this._rejects.textContent = ''; this._rejects.hidden = true; }
    return this;
  };

  SearchProgress.prototype.stop = function () {
    this._running = false;
    document.body.classList.remove('is-searching');
    this.setPercent(0);
    return this;
  };

  SearchProgress.prototype.isRunning = function () { return this._running; };

  SearchProgress.prototype.setPercent = function (percent) {
    var value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    if (this._bar) this._bar.style.width = value + '%';
    if (this._gauge) this._gauge.setAttribute('aria-valuenow', Math.round(value));
    return this;
  };

  SearchProgress.prototype._render = function (stats) {
    if (!this._running || !stats) return;
    if (this._figures) {
      // Ce qui dit que ça avance ET où ça en est : un compteur qui monte, la
      // profondeur atteinte, le rapport en cours d'essai, et surtout ce qui a
      // déjà été trouvé — c'est la seule ligne qui annonce une bonne nouvelle.
      var parts = [count(stats.tested) + ' branches évaluées'];
      if (Number.isFinite(stats.depth) && stats.depth > 0) parts.push('profondeur ' + stats.depth);
      if (Number.isFinite(stats.currentRatio)) parts.push('rapport ' + stats.currentRatio.toFixed(2).replace('.', ',') + ':1');
      var found = Number.isFinite(stats.valid) ? stats.valid : 0;
      parts.push(found > 0 ? found + (found > 1 ? ' solutions retenues' : ' solution retenue') : 'aucune retenue pour l’instant');
      var elapsed = seconds(stats.elapsedMs);
      if (elapsed) parts.push(elapsed);
      this._figures.textContent = parts.join(' · ');
    }
    if (this._rejects) {
      var rejected = stats.rejections || {};
      var named = REJECTIONS.filter(function (entry) { return rejected[entry.key] > 0; })
        .map(function (entry) { return count(rejected[entry.key]) + ' ' + entry.label; });
      this._rejects.textContent = named.length ? 'Écartées : ' + named.join(', ') + '.' : '';
      this._rejects.hidden = !named.length;
    }
  };

  GearApp.ui.SearchProgress = SearchProgress;

})(GearApp);
