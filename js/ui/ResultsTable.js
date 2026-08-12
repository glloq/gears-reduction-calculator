// Structured Solution table: sorting, filtering, pagination, configurable columns and CSV.
(function (GearApp) {
  'use strict';
  var COLUMNS = [
    { id: 'score', label: 'Score' }, { id: 'architecture', label: 'Architecture' },
    { id: 'ratio', label: 'Rapport' }, { id: 'error', label: 'Erreur %' },
    { id: 'stages', label: 'Étages' }, { id: 'efficiency', label: 'Rendement' },
    { id: 'dimensions', label: 'Dimensions' }, { id: 'rpm', label: 'RPM sortie' },
    { id: 'torque', label: 'Couple sortie' }, { id: 'sf', label: 'SF' },
    { id: 'sh', label: 'SH' }, { id: 'warnings', label: 'Warnings' },
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
    this._sortColumn = 'score'; this._sortDirection = 'asc'; this._currentPage = 0; this._searchText = ''; this._selectedIndex = 0;
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
      if (column.sortable !== false) { th.className = 'sortable-th'; th.onclick = function () { self._sortDirection = self._sortColumn === column.id && self._sortDirection === 'asc' ? 'desc' : 'asc'; self._sortColumn = column.id; self._render(); }; }
      row.appendChild(th);
    });
  };
  ResultsTable.prototype._rawValue = function (solution, id) {
    return { score: solution.score.value, architecture: types(solution).join(' '), ratio: solution.mode === 'rotationTranslation' ? solution.travelPerRevolutionMm : solution.ratio,
      error: solution.errorPercent, stages: solution.stages.length, efficiency: solution.efficiency,
      dimensions: solution.dimensions.x * solution.dimensions.y * Math.max(1, solution.dimensions.z),
      rpm: solution.outputSpeedRpm, torque: solution.outputTorqueNm, sf: minFactor(solution, 'bending'),
      sh: minFactor(solution, 'contact'), warnings: solution.warnings.length }[id];
  };
  ResultsTable.prototype._displayValue = function (solution, id) {
    var linear=solution.mode==='rotationTranslation';
    var values = { score: number(solution.score.value, 3), architecture: types(solution).join(' → '), ratio: linear ? number(solution.travelPerRevolutionMm,2)+' mm/tr' : number(solution.ratio, 4),
      error: number(solution.errorPercent, 3), stages: solution.stages.length, efficiency: number(solution.efficiency * 100, 1) + '%',
      dimensions: number(solution.dimensions.length, 0) + '×' + number(solution.dimensions.maxDiameter, 0) + '×' + number(solution.dimensions.width, 0),
      rpm: linear ? number(solution.outputLinearSpeedMmMin,0)+' mm/min' : number(solution.outputSpeedRpm, 1), torque: linear ? number(solution.outputForceN,1)+' N' : number(solution.outputTorqueNm, 2), sf: number(minFactor(solution, 'bending'), 2),
      sh: number(minFactor(solution, 'contact'), 2), warnings: solution.warnings.length };
    return values[id];
  };
  ResultsTable.prototype.display = function (solutions, params) { this._solutions = solutions || []; this._params = params; this._currentPage = 0; this._buildToolbar(); this._render(); };
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
    this._previousButton = previous; this._nextButton = next; bar.append(input, csv, this._buildColumnMenu(), previous, this._pageStatus, next); host.insertBefore(bar, host.querySelector('.table-scroll'));
  };
  ResultsTable.prototype._render = function () {
    var self = this; this._filtered = this._solutions.map(function (solution, index) { return { solution: solution, index: index }; }).filter(function (item) { return !self._searchText || types(item.solution).join(' ').toLowerCase().indexOf(self._searchText) >= 0; });
    this._filtered.sort(function (a, b) { var av = self._rawValue(a.solution, self._sortColumn), bv = self._rawValue(b.solution, self._sortColumn), result = typeof av === 'string' ? av.localeCompare(bv) : av - bv; return self._sortDirection === 'asc' ? result : -result; });
    var pages = Math.max(1, Math.ceil(this._filtered.length / PAGE_SIZE)); this._currentPage = Math.min(this._currentPage, pages - 1); if (this._pageStatus) this._pageStatus.textContent = 'Page ' + (this._currentPage + 1) + ' / ' + pages + ' · ' + this._filtered.length + ' résultats'; if (this._previousButton) this._previousButton.disabled = this._currentPage === 0; if (this._nextButton) this._nextButton.disabled = this._currentPage >= pages - 1; if (!this._tbody) return; this._tbody.innerHTML = '';
    this._filtered.slice(this._currentPage * PAGE_SIZE, (this._currentPage + 1) * PAGE_SIZE).forEach(function (item) { var row = document.createElement('tr'); row.classList.toggle('selected',item.index===self._selectedIndex); row.tabIndex=0; var select=function(){self._selectedIndex=item.index;self._eventBus.emit('solution:selected',{index:item.index,solution:item.solution});self._render();};row.addEventListener('click',select);row.addEventListener('keydown',function(event){if(event.key==='Enter'){select();}}); COLUMNS.filter(function (column) { return self._isVisible(column.id); }).forEach(function (column) { var cell = document.createElement('td'); if (column.id === 'action') { var button = document.createElement('button'); button.className = 'btn-small'; button.textContent = 'Voir'; button.addEventListener('click',function(event){event.stopPropagation();select();}); cell.appendChild(button); } else cell.textContent = self._displayValue(item.solution, column.id); row.appendChild(cell); }); self._tbody.appendChild(row); });
  };
  ResultsTable.prototype.exportCSV = function () { var rows = ['score,architecture,ratio,error_percent,stages,efficiency,length_mm,max_diameter_mm,width_mm,output_rpm,output_torque_nm,warnings']; this._filtered.forEach(function (item) { var s = item.solution; rows.push([s.score.value, types(s).join('|'), s.ratio, s.errorPercent, s.stages.length, s.efficiency, s.dimensions.length, s.dimensions.maxDiameter, s.dimensions.width, s.outputSpeedRpm, s.outputTorqueNm, s.warnings.length].join(',')); }); var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = 'solutions.csv'; link.click(); URL.revokeObjectURL(url); };
  GearApp.ui.ResultsTable = ResultsTable;
})(GearApp);
