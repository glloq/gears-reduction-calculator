// Structured Solution table: sorting, filtering, pagination, configurable columns and CSV.
(function (GearApp) {
  'use strict';
  // « Score (coût) » demandait au lecteur de deviner lequel des deux mots
  // l'emportait ; « Score global » laissait croire qu'il répondait à « laquelle
  // choisir ? ». Ce n'est ni l'un ni l'autre : c'est un indice ABSOLU, calculé
  // solution par solution, sans rien savoir du vivier ni des priorités. Le
  // classement qui répond à « laquelle choisir ? » est le rang décisionnel, et
  // il a sa propre colonne. Deux grandeurs, deux noms.
  var SCORE_HINT = 'Indice technique : moyenne pondérée de huit pénalités (écart, taille, pertes, risque mécanique, étages, bruit, fabrication, coût), calculée pour cette solution seule. Plus bas = mieux. Ce n’est pas le classement : voir la colonne Rang.';
  var RANK_HINT = 'Rang décisionnel : la place de cette solution dans le classement qui tient compte du vivier, de vos priorités et du front de Pareto. C’est lui qui élit la solution recommandée.';
  // §14 : la vue « expert » n'affichait que des données brutes et l'indice du
  // moteur. Les cartes, elles, portaient le Pareto, les badges, la
  // justification et la conformité — d'où deux vues qui semblaient donner deux
  // résultats. Trois colonnes suffisent à les réconcilier : le rang, le front,
  // et l'état des contrôles.
  var PARETO_HINT = 'Front de Pareto : aucune autre solution du vivier n’est meilleure sur TOUS les critères à la fois.';
  var CHECK_HINT = 'Contrôles : ✓ conforme · ⚠ limite · ✕ insuffisant · · non vérifié. « Non vérifié » n’est pas « conforme ».';
  var COLUMNS = [
    { id: 'rank', label: 'Rang', hint: RANK_HINT },
    { id: 'pareto', label: 'Pareto', hint: PARETO_HINT },
    { id: 'checks', label: 'Contrôles', hint: CHECK_HINT },
    { id: 'score', label: 'Indice technique', hint: SCORE_HINT }, { id: 'architecture', label: 'Architecture' },
    { id: 'ratio', label: 'Rapport' }, { id: 'error', label: 'Erreur %' },
    { id: 'stages', label: 'Étages' }, { id: 'efficiency', label: 'Rendement' },
    { id: 'dimensions', label: 'Dimensions' }, { id: 'rpm', label: 'RPM sortie' },
    { id: 'torque', label: 'Couple sortie' }, { id: 'sf', label: 'SF' },
    // « Warnings : 3 » ne disait pas si l'une d'elles était un refus.
    { id: 'sh', label: 'SH' }, { id: 'warnings', label: 'Alertes', hint: 'Gravité d’abord : ✕ refus, ⚠ réserve. Trois réserves ne valent pas un refus.' },
    { id: 'action', label: 'Action', sortable: false }
  ];
  var PAGE_SIZE = 25, STORAGE_KEY = 'gearCalcResultColumns';
  function ids() { return COLUMNS.map(function (column) { return column.id; }); }
  function types(solution) { return solution.stages.map(function (stage) { return stage.type; }); }
  function minFactor(solution, key) { return solution.mechanical.reduce(function (value, stage) { return Math.min(value, stage[key] ? stage[key].safetyFactor : Infinity); }, Infinity); }
  function number(value, digits) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }

  function ResultsTable(tbodyId, eventBus) {
    this._tbody = document.getElementById(tbodyId); this._table = this._tbody && this._tbody.closest('table');
    this._eventBus = eventBus || GearApp.eventBus; this._solutions = []; this._filtered = [];
    // Le tableau s'ouvre sur le RANG, comme les cartes : deux vues d'un même
    // vivier ne doivent pas proposer deux premières lignes différentes.
    this._sortColumn = 'rank'; this._sortDirection = 'asc'; this._currentPage = 0; this._searchText = ''; this._selectedIndex = 0;
    // Regroupement par architecture. Une recherche rend couramment quatre-vingts
    // solutions dont soixante sont « Droit → Droit » à quelques dents près :
    // les lire une à une ne dit rien de plus que la première.
    this._grouped = false; this._expanded = {};
    this._visibleColumns = ResultsColumnPreferences.load(localStorage, STORAGE_KEY, ids());
    this._initHeaders();
  }
  ResultsTable.prototype.getSolutions = function () { return this._solutions; };
  ResultsTable.prototype.getSolution = function (index) { return this._solutions[index]; };
  ResultsTable.prototype.getSelectedIndex = function () { return this._selectedIndex; };
  ResultsTable.prototype._isVisible = function (id) { return this._visibleColumns.indexOf(id) >= 0; };
  ResultsTable.prototype._initHeaders = function () {
    if (!this._table) return; var row = this._table.querySelector('thead tr'), self = this; if (!row) return; row.innerHTML = '';
    COLUMNS.filter(function (column) { return self._isVisible(column.id); }).forEach(function (column) {
      var th = document.createElement('th'); th.textContent = column.label; th.dataset.col = column.id;
      if (column.hint) th.title = column.hint;
      if (column.sortable !== false) { th.className = 'sortable-th'; th.onclick = function () { self._sortDirection = self._sortColumn === column.id && self._sortDirection === 'asc' ? 'desc' : 'asc'; self._sortColumn = column.id; self._render(); }; }
      row.appendChild(th);
    });
  };
  ResultsTable.prototype._rawValue = function (solution, id) {
    return { score: solution.score.value, architecture: types(solution).join(' '), ratio: solution.mode === 'rotationTranslation' ? solution.travelPerRevolutionMm : solution.ratio,
      error: solution.errorPercent, stages: solution.stages.length, efficiency: solution.efficiency,
      dimensions: solution.dimensions.x * solution.dimensions.y * Math.max(1, solution.dimensions.z),
      rpm: solution.outputSpeedRpm, torque: solution.outputTorqueNm, sf: minFactor(solution, 'bending'),
      sh: minFactor(solution, 'contact'), warnings: alertSeverity(solution) }[id];
  };

  /** L'état des contrôles, dans les marques que tout l'écran partage. */
  function checkSummary(entry) {
    var order = { danger: 0, warning: 1, unknown: 2, ok: 3 };
    var counts = {};
    (entry.compliance.checks || []).forEach(function (check) {
      counts[check.state] = (counts[check.state] || 0) + 1;
    });
    var marks = { ok: '✓', warning: '⚠', danger: '✕', unknown: '·' };
    return Object.keys(counts).sort(function (a, b) { return order[a] - order[b]; })
      .map(function (state) { return marks[state] + ' ' + counts[state]; }).join(' ') || '—';
  }

  /**
   * §13 : trier sur `warnings.length` mettait trois réserves devant un refus.
   * On trie sur la GRAVITÉ, et l'affichage la montre de la même façon.
   */
  function alertSeverity(solution) {
    var counts = { danger: 0, warning: 0, unknown: 0 };
    ((solution && solution.warnings) || []).forEach(function (entry) {
      var level = (entry && entry.level) || 'warning';
      if (counts[level] != null) counts[level]++;
    });
    return counts.danger * 1e6 + counts.warning * 1e3 + counts.unknown;
  }

  function alertText(solution) {
    var counts = { danger: 0, warning: 0 };
    ((solution && solution.warnings) || []).forEach(function (entry) {
      var level = (entry && entry.level) || 'warning';
      if (counts[level] != null) counts[level]++;
    });
    var parts = [];
    if (counts.danger) parts.push('✕ ' + counts.danger);
    if (counts.warning) parts.push('⚠ ' + counts.warning);
    return parts.join(' · ') || '—';
  }
  /** Le rang décisionnel se lit sur la POSITION dans le vivier, pas sur la solution. */
  ResultsTable.prototype._rankOf = function (index) {
    var rank = this._decision && this._decision.rank ? this._decision.rank[index] : null;
    return Number.isFinite(rank) ? rank : Infinity;
  };
  ResultsTable.prototype._displayValue = function (solution, id, index) {
    var linear=solution.mode==='rotationTranslation';
    var rank = this._decision && this._decision.rank ? this._decision.rank[index] : null;
    var entry = this._assessment && this._assessment.byIndex ? this._assessment.byIndex[index] : null;
    var values = { rank: Number.isFinite(rank) ? (rank === 1 ? '★ 1' : String(rank)) : '—',
      pareto: entry ? (entry.decision.pareto ? '✓' : '') : '—',
      checks: entry ? checkSummary(entry) : '—',
      score: number(solution.score.value, 3), architecture: types(solution).join(' → '), ratio: linear ? number(solution.travelPerRevolutionMm,2)+' mm/tr' : number(solution.ratio, 4),
      error: number(solution.errorPercent, 3), stages: solution.stages.length, efficiency: number(solution.efficiency * 100, 1) + '%',
      dimensions: number(solution.dimensions.length, 0) + '×' + number(solution.dimensions.maxDiameter, 0) + '×' + number(solution.dimensions.width, 0),
      rpm: linear ? number(solution.outputLinearSpeedMmMin,0)+' mm/min' : number(solution.outputSpeedRpm, 1), torque: linear ? number(solution.outputForceN,1)+' N' : number(solution.outputTorqueNm, 2), sf: number(minFactor(solution, 'bending'), 2),
      sh: number(minFactor(solution, 'contact'), 2), warnings: alertText(solution) };
    return values[id];
  };
  // baseIndices[i] = position de solutions[i] dans le vivier d'origine (contrat
  // de sélection de SolutionExplorer) ; omis, l'index local fait foi.
  ResultsTable.prototype.display = function (solutions, params, baseIndices, decision, assessment) { this._solutions = solutions || []; this._params = params; this._baseIndices = baseIndices || null; this._decision = decision || null; this._assessment = assessment || null; this._currentPage = 0; this._buildToolbar(); this._render(); };
  ResultsTable.prototype.setSelectedIndex = function (index) { this._selectedIndex = index; this._render(); };
  ResultsTable.prototype._buildColumnMenu = function () {
    var self = this, details = document.createElement('details'); details.className = 'column-picker';
    var summary = document.createElement('summary'); summary.textContent = 'Colonnes'; details.appendChild(summary);
    var panel = document.createElement('div'); panel.className = 'column-picker-panel';
    COLUMNS.filter(function (column) { return column.id !== 'action'; }).forEach(function (column) {
      var label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = self._isVisible(column.id);
      input.onchange = function () { var next = self._visibleColumns.filter(function (id) { return id !== column.id; }); if (input.checked) next.push(column.id); self._visibleColumns = ResultsColumnPreferences.save(localStorage, STORAGE_KEY, next, ids()); self._initHeaders(); self._render(); };
      label.appendChild(input); label.appendChild(document.createTextNode(' ' + column.label)); panel.appendChild(label);
    }); details.appendChild(panel); return details;
  };
  ResultsTable.prototype._buildToolbar = function () {
    if (!this._table) return; var host = this._table.parentElement.parentElement, old = host.querySelector('.results-toolbar'), self = this; if (old) old.remove();
    var bar = document.createElement('div'); bar.className = 'results-toolbar'; var input = document.createElement('input'); input.className = 'results-search'; input.placeholder = 'Rechercher une architecture…';
    input.oninput = function () { self._searchText = input.value.toLowerCase(); self._currentPage = 0; self._render(); };
    var csv = document.createElement('button'); csv.className = 'btn-small'; csv.textContent = 'CSV'; csv.onclick = function () { self.exportCSV(); };
    var previous = document.createElement('button'); previous.className = 'btn-small'; previous.textContent = '←'; previous.onclick = function () { if (self._currentPage > 0) { self._currentPage--; self._render(); } };
    this._pageStatus = document.createElement('span'); this._pageStatus.className = 'pagination-status';
    var next = document.createElement('button'); next.className = 'btn-small'; next.textContent = '→'; next.onclick = function () { if ((self._currentPage + 1) * PAGE_SIZE < self._filtered.length) { self._currentPage++; self._render(); } };
    this._previousButton = previous; this._nextButton = next; var groupToggle = document.createElement('button'); groupToggle.className = 'btn-small' + (this._grouped ? ' active' : ''); groupToggle.id = 'resultsGroup';
    groupToggle.textContent = 'Grouper'; groupToggle.setAttribute('aria-pressed', String(this._grouped));
    groupToggle.title = 'Une ligne par architecture, avec sa meilleure solution et ses variantes';
    groupToggle.onclick = function () { self._grouped = !self._grouped; self._expanded = {}; self._currentPage = 0; self._buildToolbar(); self._render(); };
    bar.append(input, groupToggle, csv, this._buildColumnMenu(), previous, this._pageStatus, next); host.insertBefore(bar, host.querySelector('.table-scroll'));
  };
  /**
   * UNE LIGNE PAR ARCHITECTURE.
   *
   * La ligne de groupe porte la MEILLEURE solution de sa famille, avec le
   * nombre de variantes et ce qui les sépare. La déplier montre les autres,
   * en retrait, dans le même ordre que la liste complète.
   *
   * La pagination compte alors les GROUPES, pas les solutions : c'est ce qu'on
   * parcourt, et paginer sur soixante variantes repliées donnerait des pages
   * vides.
   */
  ResultsTable.prototype._renderGrouped = function (items) {
    var self = this;
    var groups = GearSolutionGrouping.group(items.map(function (item) { return item.solution; }),
      { indices: items.map(function (item) { return item.index; }) });
    var pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
    this._currentPage = Math.min(this._currentPage, pages - 1);
    if (this._pageStatus) {
      this._pageStatus.textContent = 'Page ' + (this._currentPage + 1) + ' / ' + pages + ' · ' +
        groups.length + ' architecture' + (groups.length > 1 ? 's' : '') + ' · ' + items.length + ' solutions';
    }
    if (this._previousButton) this._previousButton.disabled = this._currentPage === 0;
    if (this._nextButton) this._nextButton.disabled = this._currentPage >= pages - 1;
    this._tbody.innerHTML = '';
    groups.slice(this._currentPage * PAGE_SIZE, (this._currentPage + 1) * PAGE_SIZE).forEach(function (entry) {
      var open = !!self._expanded[entry.key];
      var head = self._row({ solution: entry.best, index: entry.bestIndex }, {
        group: entry, expanded: open,
        onToggle: function () { self._expanded[entry.key] = !open; self._render(); }
      });
      self._tbody.appendChild(head);
      if (!open || entry.count < 2) return;
      // Les variantes, en retrait : la meilleure est déjà en tête de groupe.
      entry.members.slice(1).forEach(function (item) {
        self._tbody.appendChild(self._row(item, { variant: true }));
      });
    });
  };

  /** Une ligne de tableau — de groupe, de variante, ou de solution simple. */
  ResultsTable.prototype._row = function (item, options) {
    var self = this, settings = options || {};
    var row = document.createElement('tr');
    row.classList.toggle('selected', item.index === this._selectedIndex);
    if (settings.group) row.classList.add('group-head');
    if (settings.variant) row.classList.add('group-variant');
    row.tabIndex = 0;
    var select = function () {
      self._selectedIndex = item.index;
      self._eventBus.emit('solution:selected', { index: item.index, solution: item.solution });
      self._render();
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', function (event) { if (event.key === 'Enter') select(); });
    COLUMNS.filter(function (column) { return self._isVisible(column.id); }).forEach(function (column) {
      var cell = document.createElement('td');
      // Une cellule dit à quelle colonne elle appartient. Sans cela, tout ce
      // qui la vise le fait par sa POSITION — et la position change dès qu'une
      // colonne est ajoutée, masquée ou réordonnée.
      cell.dataset.col = column.id;
      if (column.id === 'action') {
        var button = document.createElement('button');
        button.className = 'btn-small'; button.textContent = 'Voir';
        button.addEventListener('click', function (event) { event.stopPropagation(); select(); });
        cell.appendChild(button);
        var pin = document.createElement('button');
        pin.className = 'btn-small'; pin.textContent = '☆'; pin.title = 'Épingler pour comparer';
        pin.addEventListener('click', function (event) { event.stopPropagation(); self._eventBus.emit('solution:pin-toggled', { solution: item.solution }); });
        cell.appendChild(pin);
      } else if (column.id === 'architecture' && settings.group) {
        cell.appendChild(document.createTextNode(self._displayValue(item.solution, column.id, item.index)));
        // La CONFIGURATION, à côté de la famille : « Épicycloïdal » réunissait
        // deux montages qui n'ont ni le même rapport ni le même sens.
        var shape = typeof GearSolutionGrouping !== 'undefined'
          ? GearSolutionGrouping.describeAll(item.solution, function (code) {
            return GearTransmissionRegistry && GearTransmissionRegistry.memberName
              ? GearTransmissionRegistry.memberName(code) : code;
          }) : '';
        if (shape) {
          var note = document.createElement('span');
          note.className = 'group-configuration';
          note.textContent = ' · ' + shape;
          cell.appendChild(note);
        }
        var entry = settings.group;
        if (entry.count > 1) {
          var toggle = document.createElement('button');
          toggle.className = 'btn-small group-toggle';
          toggle.setAttribute('aria-expanded', String(!!settings.expanded));
          toggle.textContent = (settings.expanded ? '▾ ' : '▸ ') + entry.count + ' variantes';
          toggle.title = self._spreadHint(entry);
          toggle.addEventListener('click', function (event) { event.stopPropagation(); settings.onToggle(); });
          cell.appendChild(toggle);
        }
      } else if (column.id === 'architecture' && settings.variant) {
        cell.className = 'variant-cell';
        cell.textContent = self._displayValue(item.solution, column.id, item.index);
      } else cell.textContent = self._displayValue(item.solution, column.id, item.index);
      row.appendChild(cell);
    });
    return row;
  };

  /** Ce que déplier apporterait : l'étendue de ce qui sépare les variantes. */
  ResultsTable.prototype._spreadHint = function (entry) {
    var spread = entry.spread;
    if (!spread) return 'Une seule solution de cette architecture';
    var parts = [];
    if (spread.error && spread.error.span > 1e-9) parts.push('écart ' + number(spread.error.min, 2) + ' à ' + number(spread.error.max, 2) + ' %');
    if (spread.efficiency && spread.efficiency.span > 1e-9) parts.push('rendement ' + number(spread.efficiency.min * 100, 0) + ' à ' + number(spread.efficiency.max * 100, 0) + ' %');
    if (spread.diameter && spread.diameter.span > 1e-9) parts.push('Ø ' + number(spread.diameter.min, 0) + ' à ' + number(spread.diameter.max, 0) + ' mm');
    // Des variantes qui ne se distinguent par rien de mesurable ne demandent
    // pas d'être lues une à une, et le dire vaut mieux que de laisser croire
    // qu'on cache quelque chose.
    return parts.length ? 'Ces variantes vont de ' + parts.join(', ') : 'Variantes de denture, à performances identiques';
  };

  ResultsTable.prototype._render = function () {
    var self = this; this._filtered = this._solutions.map(function (solution, i) { return { solution: solution, index: self._baseIndices ? self._baseIndices[i] : i }; }).filter(function (item) { return !self._searchText || types(item.solution).join(' ').toLowerCase().indexOf(self._searchText) >= 0; });
    this._filtered.sort(function (a, b) {
      var result;
      if (self._sortColumn === 'rank') result = self._rankOf(a.index) - self._rankOf(b.index);
      else {
        var av = self._rawValue(a.solution, self._sortColumn), bv = self._rawValue(b.solution, self._sortColumn);
        result = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      }
      return self._sortDirection === 'asc' ? result : -result;
    });
    if (!this._tbody) return;
    if (this._grouped && typeof GearSolutionGrouping !== 'undefined') return this._renderGrouped(this._filtered);
    var pages = Math.max(1, Math.ceil(this._filtered.length / PAGE_SIZE)); this._currentPage = Math.min(this._currentPage, pages - 1); if (this._pageStatus) this._pageStatus.textContent = 'Page ' + (this._currentPage + 1) + ' / ' + pages + ' · ' + this._filtered.length + ' résultats'; if (this._previousButton) this._previousButton.disabled = this._currentPage === 0; if (this._nextButton) this._nextButton.disabled = this._currentPage >= pages - 1; this._tbody.innerHTML = '';
    this._filtered.slice(this._currentPage * PAGE_SIZE, (this._currentPage + 1) * PAGE_SIZE).forEach(function (item) { self._tbody.appendChild(self._row(item)); });
  };
  ResultsTable.prototype.exportCSV = function () { var rows = ['score,architecture,ratio,error_percent,stages,efficiency,length_mm,max_diameter_mm,width_mm,output_rpm,output_torque_nm,warnings']; this._filtered.forEach(function (item) { var s = item.solution; rows.push([s.score.value, types(s).join('|'), s.ratio, s.errorPercent, s.stages.length, s.efficiency, s.dimensions.length, s.dimensions.maxDiameter, s.dimensions.width, s.outputSpeedRpm, s.outputTorqueNm, s.warnings.length].join(',')); }); var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = 'solutions.csv'; link.click(); URL.revokeObjectURL(url); };
  GearApp.ui.ResultsTable = ResultsTable;
})(GearApp);
