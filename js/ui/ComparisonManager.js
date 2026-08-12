// ComparisonManager.js - Système de comparaison multi-sorties
// Permet de définir plusieurs rapports cibles et de comparer les solutions

(function (GearApp) {

  function ComparisonManager(panelId, eventBus) {
    this._panel = document.getElementById(panelId);
    this._eventBus = eventBus || GearApp.eventBus;
    this._outputs = []; // { id, ratio, label, solutions, selectedIdx }
    this._nextId = 1;
    this._isOpen = false;
    this._engine = null;

    this._buildUI();
    this._bindEvents();
  }

  ComparisonManager.prototype.setEngine = function (engine) {
    this._engine = engine;
  };

  ComparisonManager.prototype._buildUI = function () {
    if (!this._panel) return;

    this._panel.innerHTML =
      '<div class="comparison-header">' +
        '<h3>Comparaison multi-sorties</h3>' +
        '<p class="comparison-desc">Définissez plusieurs rapports cibles pour comparer les solutions de transmission.</p>' +
      '</div>' +
      '<div class="comparison-inputs" id="compOutputsList"></div>' +
      '<div class="comparison-actions">' +
        '<button class="btn-secondary" id="compAddOutput">+ Ajouter un rapport</button>' +
        '<button class="btn-primary" id="compRunAll">Rechercher tout</button>' +
      '</div>' +
      '<div id="compResults" class="comparison-results"></div>' +
      '<div id="compSummary" class="comparison-summary" style="display:none;"></div>';
  };

  ComparisonManager.prototype._bindEvents = function () {
    var self = this;

    // Ajouter un rapport
    var addBtn = document.getElementById('compAddOutput');
    if (addBtn) {
      addBtn.onclick = function () { self.addOutput(); };
    }

    // Rechercher tout
    var runBtn = document.getElementById('compRunAll');
    if (runBtn) {
      runBtn.onclick = function () { self.runAll(); };
    }
  };

  ComparisonManager.prototype.toggle = function () {
    this._isOpen = !this._isOpen;
    if (this._panel) {
      this._panel.style.display = this._isOpen ? 'block' : 'none';
    }
    if (this._isOpen && this._outputs.length === 0) {
      this.addOutput(null, 'Sortie 1');
      this.addOutput(null, 'Sortie 2');
    }
  };

  ComparisonManager.prototype.isOpen = function () {
    return this._isOpen;
  };

  /**
   * Ajoute une sortie à comparer.
   */
  ComparisonManager.prototype.addOutput = function (ratio, label) {
    var id = this._nextId++;
    var output = {
      id: id,
      ratio: ratio || '',
      label: label || ('Sortie ' + id),
      solutions: [],
      selectedIdx: 0
    };
    this._outputs.push(output);
    this._renderInputs();
    return id;
  };

  /**
   * Supprime une sortie.
   */
  ComparisonManager.prototype.removeOutput = function (id) {
    this._outputs = this._outputs.filter(function (o) { return o.id !== id; });
    this._renderInputs();
    this._renderResults();
  };

  /**
   * Rend la liste des entrées de rapport.
   */
  ComparisonManager.prototype._renderInputs = function () {
    var container = document.getElementById('compOutputsList');
    if (!container) return;
    container.innerHTML = '';

    var self = this;
    this._outputs.forEach(function (output, idx) {
      var row = document.createElement('div');
      row.className = 'comp-input-row';

      row.innerHTML =
        '<input type="text" class="comp-label-input" value="' + self._escapeAttr(output.label) + '" ' +
          'placeholder="Nom" data-id="' + output.id + '" data-field="label">' +
        '<input type="number" class="comp-ratio-input" value="' + (output.ratio || '') + '" ' +
          'placeholder="Rapport cible" step="0.1" min="0.1" data-id="' + output.id + '" data-field="ratio">' +
        '<button class="btn-icon comp-remove-btn" data-id="' + output.id + '" title="Supprimer">&times;</button>';

      // Events
      var inputs = row.querySelectorAll('input');
      inputs.forEach(function (input) {
        input.oninput = function () {
          var oid = parseInt(input.getAttribute('data-id'), 10);
          var field = input.getAttribute('data-field');
          var o = self._getOutput(oid);
          if (o) o[field] = field === 'ratio' ? parseFloat(input.value) : input.value;
        };
      });

      var removeBtn = row.querySelector('.comp-remove-btn');
      if (removeBtn) {
        removeBtn.onclick = function () {
          self.removeOutput(parseInt(removeBtn.getAttribute('data-id'), 10));
        };
      }

      container.appendChild(row);
    });
  };

  ComparisonManager.prototype._getOutput = function (id) {
    for (var i = 0; i < this._outputs.length; i++) {
      if (this._outputs[i].id === id) return this._outputs[i];
    }
    return null;
  };

  ComparisonManager.prototype._escapeAttr = function (str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  };

  /**
   * Lance la recherche pour toutes les sorties.
   */
  ComparisonManager.prototype.runAll = function () {
    if (!this._engine) {
      this._engine = GearApp._engine; // fallback
    }
    if (!this._engine) return;

    var self = this;
    var validOutputs = this._outputs.filter(function (o) {
      return o.ratio && !isNaN(o.ratio) && o.ratio > 0;
    });

    if (validOutputs.length === 0) return;

    var resultsContainer = document.getElementById('compResults');
    if (resultsContainer) {
      resultsContainer.innerHTML = '<p class="comp-searching">Recherche en cours...</p>';
    }

    // Obtenir les paramètres de base depuis le formulaire
    var baseParams = GearApp.models.SearchParams.fromForm();
    var completed = 0;

    validOutputs.forEach(function (output) {
      // Cloner les params avec le rapport cible modifié
      var params = GearApp.models.SearchParams.fromForm();
      params.rapportCible = output.ratio;

      self._engine.rechercher(params).then(function (solutions) {
        output.solutions = solutions;
        output.selectedIdx = 0;
        completed++;
        if (completed === validOutputs.length) {
          self._renderResults();
          self._renderSummary();
        }
      }).catch(function () {
        output.solutions = [];
        completed++;
        if (completed === validOutputs.length) {
          self._renderResults();
          self._renderSummary();
        }
      });
    });
  };

  /**
   * Rend les résultats pour chaque sortie.
   */
  ComparisonManager.prototype._renderResults = function () {
    var container = document.getElementById('compResults');
    if (!container) return;
    container.innerHTML = '';

    var self = this;
    var registry = GearApp.models.typeRegistry;

    this._outputs.forEach(function (output) {
      if (!output.solutions || output.solutions.length === 0) {
        if (output.ratio) {
          var noResult = document.createElement('div');
          noResult.className = 'comp-output-card comp-no-result';
          noResult.innerHTML = '<h4>' + self._escapeHtml(output.label) +
            ' (r=' + output.ratio + ')</h4><p>Aucun résultat trouvé</p>';
          container.appendChild(noResult);
        }
        return;
      }

      var card = document.createElement('div');
      card.className = 'comp-output-card';

      var header = document.createElement('div');
      header.className = 'comp-card-header';
      header.innerHTML = '<h4>' + self._escapeHtml(output.label) +
        '</h4><span class="comp-target">Cible : ' + output.ratio + ':1</span>' +
        '<span class="comp-count">' + output.solutions.length + ' solution(s)</span>';
      card.appendChild(header);

      // Mini-table des 5 premières solutions
      var table = document.createElement('table');
      table.className = 'comp-mini-table';
      table.innerHTML = '<thead><tr>' +
        '<th></th><th>Engrenages</th><th>Types</th><th>Rapport</th><th>Écart</th><th>Rend.</th>' +
        '</tr></thead>';
      var tbody = document.createElement('tbody');

      var maxShow = Math.min(output.solutions.length, 5);
      for (var i = 0; i < maxShow; i++) {
        (function (idx) {
          var sol = output.solutions[idx];
          var ratio = self._calculerRapport(sol);
          var error = Math.abs((ratio - output.ratio) / output.ratio * 100);

          var row = document.createElement('tr');
          row.className = 'comp-row';
          if (idx === output.selectedIdx) row.classList.add('comp-selected');
          row.onclick = function () {
            output.selectedIdx = idx;
            self._renderResults();
            self._renderSummary();
          };

          // Radio
          var radioCell = document.createElement('td');
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'comp_output_' + output.id;
          radio.checked = idx === output.selectedIdx;
          radioCell.appendChild(radio);

          // Engrenages
          var gearsCell = document.createElement('td');
          gearsCell.textContent = sol.stages.map(function(s){return self._stageLabel(s);}).join(' ; ');

          // Types
          var typesCell = document.createElement('td');
          sol.stages.forEach(function (stage) {
            var typeId = stage.type;
            var type = registry.get(typeId);
            var badge = document.createElement('span');
            badge.className = 'type-badge ' + typeId;
            badge.textContent = type.nomCourt;
            typesCell.appendChild(badge);
          });

          // Rapport
          var ratioCell = document.createElement('td');
          ratioCell.textContent = ratio.toFixed(4);

          // Écart
          var errorCell = document.createElement('td');
          errorCell.textContent = error.toFixed(3) + '%';
          if (error < 0.01) errorCell.classList.add('excellent');
          else if (error < 0.1) errorCell.classList.add('good');

          // Rendement
          var effCell = document.createElement('td');
          effCell.textContent = Number.isFinite(sol.efficiency) ? (sol.efficiency*100).toFixed(1)+'%' : '—';

          row.appendChild(radioCell);
          row.appendChild(gearsCell);
          row.appendChild(typesCell);
          row.appendChild(ratioCell);
          row.appendChild(errorCell);
          row.appendChild(effCell);
          tbody.appendChild(row);
        })(i);
      }

      table.appendChild(tbody);
      card.appendChild(table);
      container.appendChild(card);
    });
  };

  /**
   * Rend le tableau récapitulatif de comparaison.
   */
  ComparisonManager.prototype._renderSummary = function () {
    var summaryEl = document.getElementById('compSummary');
    if (!summaryEl) return;

    var selected = [];
    var self = this;
    this._outputs.forEach(function (output) {
      if (output.solutions && output.solutions.length > 0) {
        var sol = output.solutions[output.selectedIdx] || output.solutions[0];
        selected.push({
          label: output.label,
          targetRatio: output.ratio,
          solution: sol,
          ratio: self._calculerRapport(sol)
        });
      }
    });

    if (selected.length < 2) {
      summaryEl.style.display = 'none';
      return;
    }

    summaryEl.style.display = 'block';
    var registry = GearApp.models.typeRegistry;

    var html = '<h4>Comparaison des solutions sélectionnées</h4>';
    html += '<table class="comp-summary-table"><thead><tr>';
    html += '<th>Propriété</th>';
    selected.forEach(function (s) {
      html += '<th>' + self._escapeHtml(s.label) + '</th>';
    });
    html += '</tr></thead><tbody>';

    // Rapport cible
    html += '<tr><td>Rapport cible</td>';
    selected.forEach(function (s) { html += '<td>' + s.targetRatio + ':1</td>'; });
    html += '</tr>';

    // Rapport obtenu
    html += '<tr><td>Rapport obtenu</td>';
    selected.forEach(function (s) { html += '<td>' + s.ratio.toFixed(4) + '</td>'; });
    html += '</tr>';

    // Nombre d'étages
    html += '<tr><td>Étages</td>';
    selected.forEach(function (s) { html += '<td>' + s.solution.stages.length + '</td>'; });
    html += '</tr>';

    // Types utilisés
    html += '<tr><td>Types</td>';
    selected.forEach(function (s) {
      var types = s.solution.stages.map(function (stage) {
        var typeId = stage.type;
        return '<span class="type-badge ' + typeId + '">' + registry.get(typeId).nomCourt + '</span>';
      }).join(' ');
      html += '<td>' + types + '</td>';
    });
    html += '</tr>';

    html += '<tr><td>Rendement</td>';selected.forEach(function(s){html+='<td>'+(s.solution.efficiency*100).toFixed(1)+'%</td>';});html+='</tr>';
    html += '<tr><td>Dimensions</td>';selected.forEach(function(s){var d=s.solution.dimensions||{};html+='<td>'+[d.length,d.maxDiameter,d.width].map(function(v){return Number.isFinite(v)?v.toFixed(1):'—';}).join(' × ')+' mm</td>';});html+='</tr>';
    html += '<tr><td>Score</td>';selected.forEach(function(s){html+='<td>'+(s.solution.score&&Number.isFinite(s.solution.score.value)?s.solution.score.value.toFixed(3):'—')+'</td>';});html+='</tr>';

    // Étages partagés potentiels
    if (selected.length >= 2) {
      html += '<tr><td>Étages communs</td>';
      selected.forEach(function (s, idx) {
        if (idx === 0) {
          html += '<td>Référence</td>';
          return;
        }
        var common = self._findSharedStages(selected[0].solution, s.solution);
        html += '<td>' + (common > 0 ? common + ' étage(s)' : 'Aucun') + '</td>';
      });
      html += '</tr>';
    }

    html += '</tbody></table>';
    summaryEl.innerHTML = html;
  };

  /**
   * Trouve le nombre d'étages communs entre deux solutions.
   */
  ComparisonManager.prototype._findSharedStages = function (solA, solB) {
    var count = 0;
    var a=solA.stages||[],b=solB.stages||[],minLen = Math.min(a.length, b.length);
    for (var i = 0; i < minLen; i++) {
      if (JSON.stringify(a[i]) === JSON.stringify(b[i])) {
        count++;
      }
    }
    return count;
  };

  ComparisonManager.prototype._calculerRapport = function (solution) {
    return solution && Number.isFinite(solution.ratio) ? solution.ratio : null;
  };

  ComparisonManager.prototype._stageLabel = function(stage){if(stage.type==='worm')return stage.wormStarts+' → '+stage.wheelTeeth;if(stage.type==='planetary')return 'S'+stage.sunTeeth+' / R'+stage.ringTeeth;if(stage.input&&stage.output)return stage.input.teeth+' → '+stage.output.teeth;return stage.type;};

  ComparisonManager.prototype._escapeHtml = function (str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  ComparisonManager.prototype.getOutputs = function () {
    return this._outputs;
  };

  GearApp.ui.ComparisonManager = ComparisonManager;

})(GearApp);
