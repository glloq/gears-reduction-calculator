// ComparePanel.js - Épingler jusqu'à 4 solutions et les comparer côte à côte.
// Différent de ComparisonManager (comparaison multi-RAPPORTS cibles) : ici on
// compare des solutions du vivier (ou d'anciens viviers — les épingles
// retiennent l'objet solution et survivent aux re-recherches).
// Les aides pures sont exportées en UMD pour les tests Node.
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry);
  if (common) module.exports = api; else root.GearComparePanelHelpers = api;
})(typeof self !== 'undefined' ? self : this, function (Registry) {
  'use strict';

  var PIN_CAP = 4;

  function minFactor(solution, key) {
    return (solution.mechanical || []).reduce(function (min, stage) {
      var value = stage[key] && stage[key].safetyFactor;
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
  }

  /**
   * Bascule une épingle. Renvoie {pins, action: 'added'|'removed'|'rejected'}.
   */
  function togglePin(pins, solution, cap) {
    cap = cap || PIN_CAP;
    var uid = solution && solution.uid;
    var existing = pins.findIndex(function (pin) { return pin.uid === uid; });
    if (existing !== -1) {
      var next = pins.slice();
      next.splice(existing, 1);
      return { pins: next, action: 'removed' };
    }
    if (pins.length >= cap) return { pins: pins, action: 'rejected' };
    return { pins: pins.concat([{ uid: uid, solution: solution }]), action: 'added' };
  }

  function isPinned(pins, uid) {
    return pins.some(function (pin) { return pin.uid === uid; });
  }

  /**
   * Indices des meilleures valeurs (ex æquo tous marqués). Les valeurs non
   * finies ne gagnent jamais.
   */
  function bestIndices(values, direction) {
    var best = null;
    values.forEach(function (value) {
      if (!Number.isFinite(value)) return;
      if (best === null) { best = value; return; }
      best = direction === 'max' ? Math.max(best, value) : Math.min(best, value);
    });
    if (best === null) return [];
    var out = [];
    values.forEach(function (value, index) { if (value === best) out.push(index); });
    return out;
  }

  /**
   * Un planétaire ne se compare pas à ses seules dentures.
   *
   * « S20 / R80 » désignait indifféremment deux mécanismes qui n'ont rien de
   * commun : solaire menant et couronne bloquée d'un côté, porte-satellites
   * menant et solaire bloqué de l'autre. À dentures identiques, les rapports
   * diffèrent — et parfois de signe. Comparer sans dire qui mène et qui est
   * tenu, c'est comparer deux lignes qui se ressemblent.
   */
  function planetaryLabel(stage) {
    var teeth = 'S' + stage.sunTeeth +
      (Number.isFinite(stage.planetTeeth) ? ' / P' + stage.planetTeeth +
        (Number.isFinite(stage.planetCount) ? '×' + Math.round(stage.planetCount) : '') : '') +
      ' / R' + stage.ringTeeth;
    var roles = [];
    if (stage.inputMember) roles.push(memberName(stage.inputMember) + ' entrée');
    if (stage.fixed) roles.push(memberName(stage.fixed) + ' fixe');
    if (stage.outputMember) roles.push(memberName(stage.outputMember) + ' sortie');
    return roles.length ? teeth + '\n' + roles.join(' · ') : teeth;
  }

  /** Le nom d'un organe vient du registre : cette vue ne traduit rien. */
  function memberName(code) {
    return Registry && Registry.memberName ? Registry.memberName(code) : code;
  }

  function stageLabel(stage) {
    if (!stage) return '—';
    if (stage.type === 'worm') return 'vis ' + stage.wormStarts + ' → ' + stage.wheelTeeth;
    if (stage.type === 'planetary' || stage.type === 'epicyclic') return planetaryLabel(stage);
    if (stage.type === 'rack') return 'pignon ' + stage.pinionTeeth;
    return stage.input.teeth + ' → ' + stage.output.teeth;
  }

  /**
   * Modèle de lignes pour le rendu : gère les mélanges rotatif/linéaire
   * (cellules '—' quand la grandeur ne s'applique pas).
   */
  function buildRows(pins) {
    var solutions = pins.map(function (pin) { return pin.solution; });
    var anyLinear = solutions.some(function (s) { return s.mode === 'rotationTranslation'; });
    var anyRotary = solutions.some(function (s) { return s.mode !== 'rotationTranslation'; });

    function row(label, direction, digits, unit, pick) {
      return { label: label, direction: direction, digits: digits, unit: unit || '', values: solutions.map(pick) };
    }

    var rows = [
      row('Score (coût)', 'min', 3, '', function (s) { return s.score && s.score.value; })
    ];
    if (anyRotary) {
      rows.push(row('Rapport', null, 4, ':1', function (s) { return s.mode === 'rotationTranslation' ? null : s.ratio; }));
      rows.push(row('Écart', 'min', 3, ' %', function (s) { return s.mode === 'rotationTranslation' ? null : s.errorPercent; }));
    }
    if (anyLinear) {
      rows.push(row('Course', null, 2, ' mm/tr', function (s) { return s.travelPerRevolutionMm; }));
      rows.push(row('Vitesse linéaire', null, 0, ' mm/min', function (s) { return s.outputLinearSpeedMmMin; }));
      rows.push(row('Force sortie', 'max', 1, ' N', function (s) { return s.outputForceN; }));
    }
    rows.push(row('Rendement', 'max', 1, ' %', function (s) { return Number.isFinite(s.efficiency) ? s.efficiency * 100 : null; }));
    rows.push(row('Étages', 'min', 0, '', function (s) { return (s.stages || []).length; }));
    rows.push(row('Longueur', 'min', 0, ' mm', function (s) { return s.dimensions && s.dimensions.length; }));
    rows.push(row('Ø max', 'min', 0, ' mm', function (s) { return s.dimensions && s.dimensions.maxDiameter; }));
    if (anyRotary) {
      rows.push(row('SF min', 'max', 2, '', function (s) { var v = minFactor(s, 'bending'); return Number.isFinite(v) ? v : null; }));
      rows.push(row('SH min', 'max', 2, '', function (s) { var v = minFactor(s, 'contact'); return Number.isFinite(v) ? v : null; }));
    }
    rows.push(row('Avertissements', 'min', 0, '', function (s) { return (s.warnings || []).length; }));
    rows.push(row('Échecs fabrication', 'min', 0, '', function (s) { return s.manufacturing ? (s.manufacturing.failures || []).length : null; }));

    // Lignes d'architecture (une par position d'étage)
    var maxStages = solutions.reduce(function (max, s) { return Math.max(max, (s.stages || []).length); }, 0);
    for (var i = 0; i < maxStages; i++) {
      (function (position) {
        rows.push({
          label: 'Étage ' + (position + 1), direction: null, digits: null, unit: '',
          values: solutions.map(function (s) {
            var stage = (s.stages || [])[position];
            return stage ? { type: stage.type, label: stageLabel(stage) } : null;
          })
        });
      })(i);
    }
    return rows;
  }

  return { PIN_CAP: PIN_CAP, togglePin: togglePin, isPinned: isPinned, bestIndices: bestIndices, buildRows: buildRows, stageLabel: stageLabel, planetaryLabel: planetaryLabel, minFactor: minFactor };
});

// ===== Classe DOM (navigateur uniquement) =====
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  var H = (typeof self !== 'undefined' ? self : window).GearComparePanelHelpers;

  function finite(value, digits) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }

  /**
   * L'écart face à la référence, dans le même langage visuel que les cartes :
   * une seule logique pour une seule notion, sinon « mieux » finirait par
   * changer de couleur d'un écran à l'autre.
   */
  function deltaFor(value, reference, row) {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) return null;
    var digits = row.digits == null ? 2 : row.digits;
    var gap = Math.round((value - reference) * Math.pow(10, digits)) / Math.pow(10, digits);
    if (!gap) return null;
    var good = row.direction === 'max' ? gap > 0 : gap < 0;
    var mark = document.createElement('span');
    mark.className = 'metric-delta ' + (good ? 'delta-better' : 'delta-worse');
    mark.textContent = (gap > 0 ? '+' : '−') + Math.abs(gap).toFixed(digits) + (row.unit || '');
    return mark;
  }

  function ComparePanel(eventBus, hostId, explorer) {
    this.bus = eventBus || GearApp.eventBus;
    this.host = document.getElementById(hostId);
    this.explorer = explorer;
    this._pins = [];
  }

  ComparePanel.prototype.bind = function () {
    var self = this;
    this.bus.on('solution:pin-toggled', function (data) {
      var result = H.togglePin(self._pins, data.solution);
      if (result.action === 'rejected') {
        var status = document.getElementById('status');
        if (status) status.textContent = 'Maximum ' + H.PIN_CAP + ' solutions épinglées — retirez-en une pour continuer.';
        return;
      }
      self._pins = result.pins;
      self.render();
      self.bus.emit('compare:changed', { uids: self._pins.map(function (pin) { return pin.uid; }) });
    });
  };

  ComparePanel.prototype.isPinned = function (uid) { return H.isPinned(this._pins, uid); };

  ComparePanel.prototype.render = function () {
    if (!this.host) return;
    var self = this;
    this.host.innerHTML = '';

    if (!this._pins.length) {
      this.host.innerHTML = '<p class="detail-placeholder">Épinglez des solutions (☆ sur les cartes ou dans le tableau) pour les comparer côte à côte — jusqu\'à ' + H.PIN_CAP + '.</p>';
      return;
    }

    var table = document.createElement('table');
    table.className = 'compare-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    this._pins.forEach(function (pin, column) {
      var th = document.createElement('th');
      var poolIndex = self.explorer ? self.explorer.poolIndexOf(pin.uid) : -1;
      var name = document.createElement('span');
      name.textContent = poolIndex >= 0 ? 'N° ' + (poolIndex + 1) : 'Épinglée';
      var view = document.createElement('button');
      view.className = 'btn-small';
      view.textContent = 'Voir';
      view.addEventListener('click', function () {
        self.bus.emit('solution:selected', { index: poolIndex, solution: pin.solution });
      });
      var unpin = document.createElement('button');
      unpin.className = 'btn-small';
      unpin.textContent = '✕';
      unpin.title = 'Retirer de la comparaison';
      unpin.addEventListener('click', function () {
        self.bus.emit('solution:pin-toggled', { solution: pin.solution });
      });
      var tools = document.createElement('span');
      tools.className = 'compare-tools';
      tools.append(view, unpin);
      th.append(name, tools);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    H.buildRows(this._pins).forEach(function (row) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.textContent = row.label;
      tr.appendChild(th);
      var numeric = row.values.map(function (value) { return typeof value === 'number' ? value : NaN; });
      var best = row.direction ? H.bestIndices(numeric, row.direction) : [];
      // §26 : la première colonne sert de RÉFÉRENCE, et les autres disent ce
      // qu'elles gagnent ou perdent — exactement comme les cartes. « 94 mm » et
      // « 72 mm » côte à côte obligeaient à faire la soustraction de tête.
      var reference = numeric[0];
      row.values.forEach(function (value, column) {
        var td = document.createElement('td');
        if (value && typeof value === 'object') {
          // §21 : le nom de la famille, pas son identifiant interne.
          td.innerHTML = '<span class="type-badge ' + value.type + '">' +
            GearTransmissionRegistry.familyName(value.type, 'short') + '</span> ' + value.label;
        } else {
          td.textContent = finite(value, row.digits == null ? 2 : row.digits) + (Number.isFinite(value) ? row.unit : '');
          var delta = column > 0 && row.direction ? deltaFor(numeric[column], reference, row) : null;
          if (delta) td.appendChild(delta);
        }
        if (best.indexOf(column) !== -1) td.classList.add('best');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.appendChild(table);
    this.host.appendChild(scroll);
  };

  GearApp.ui.ComparePanel = ComparePanel;

})(typeof GearApp !== 'undefined' ? GearApp : null);
