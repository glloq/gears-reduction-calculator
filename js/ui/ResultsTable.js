// ResultsTable.js - Affichage et gestion du tableau des résultats

(function (GearApp) {

  function ResultsTable(tbodyId, eventBus) {
    this._tbody = document.getElementById(tbodyId);
    this._eventBus = eventBus || GearApp.eventBus;
    this._solutions = [];
    this._selectedIndex = 0;
  }

  ResultsTable.prototype.getSolutions = function () {
    return this._solutions;
  };

  ResultsTable.prototype.getSolution = function (index) {
    return this._solutions[index];
  };

  ResultsTable.prototype.getSelectedIndex = function () {
    return this._selectedIndex;
  };

  /**
   * Calcule le rapport total type-aware d'une solution.
   */
  ResultsTable.prototype._calculerRapport = function (solution) {
    var registry = GearApp.models.typeRegistry;
    return solution.reduce(function (acc, stage) {
      var typeId = stage[2] || 'spur';
      return acc * registry.calculerRapportEtage(typeId, stage[0], stage[1]);
    }, 1);
  };

  /**
   * Affiche les résultats dans le tableau.
   */
  ResultsTable.prototype.display = function (solutions, params) {
    this._solutions = solutions;
    this._tbody.innerHTML = "";

    if (solutions.length === 0) {
      this._tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat</td></tr>";
      return;
    }

    var self = this;
    var registry = GearApp.models.typeRegistry;
    var target = params ? params.rapportCible : parseFloat(document.getElementById("rapport").value);
    var modValue = params ? params.module : null;
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    solutions.forEach(function (solution, index) {
      var ratio = self._calculerRapport(solution);
      var error = Math.abs((ratio - target) / target * 100);

      var row = document.createElement("tr");
      row.classList.add("result-row");
      if (index === 0) row.classList.add("selected-row");
      row.onclick = function () { self.selectSolution(index); };

      // Engrenages
      var gearsCell = document.createElement("td");
      var gearsHtml = "";
      solution.forEach(function (stage, i) {
        gearsHtml += "<span>" + letters[2 * i] + ":" + stage[0] + ", " + letters[2 * i + 1] + ":" + stage[1] + "</span>";
        if (i < solution.length - 1) gearsHtml += " ; ";
      });
      gearsCell.innerHTML = gearsHtml;

      // Types
      var typesCell = document.createElement("td");
      solution.forEach(function (stage) {
        var typeId = stage[2] || 'spur';
        var type = registry.get(typeId);
        var badge = document.createElement("span");
        badge.className = "type-badge " + typeId;
        badge.textContent = type.nomCourt;
        typesCell.appendChild(badge);
      });

      // Rapport
      var ratioCell = document.createElement("td");
      ratioCell.innerText = ratio.toFixed(4);

      // Écart
      var errorCell = document.createElement("td");
      errorCell.innerText = error.toFixed(3);
      if (error < 0.01) errorCell.classList.add("excellent");
      else if (error < 0.1) errorCell.classList.add("good");

      // Étages
      var stagesCell = document.createElement("td");
      stagesCell.innerText = solution.length;

      // Rendement
      var effCell = document.createElement("td");
      if (modValue) {
        var analyse = GearApp.core.GearMechanics.analyserTrainEngrenages(solution, {
          module: modValue,
          vitesseEntree: params.vitesseEntree || 1500,
          coupleEntree: params.coupleEntree || 10
        });
        effCell.innerText = (analyse.rendementTotal * 100).toFixed(1) + "%";
        if (analyse.rendementTotal > 0.95) effCell.classList.add("excellent");
        else if (analyse.rendementTotal > 0.90) effCell.classList.add("good");
      } else {
        effCell.innerText = "-";
      }

      // Bouton Voir
      var buttonCell = document.createElement("td");
      var btn = document.createElement("button");
      btn.innerText = "Voir";
      btn.classList.add("btn-schema");
      btn.onclick = function (e) {
        e.stopPropagation();
        self.selectSolution(index);
      };
      buttonCell.appendChild(btn);

      row.appendChild(gearsCell);
      row.appendChild(typesCell);
      row.appendChild(ratioCell);
      row.appendChild(errorCell);
      row.appendChild(stagesCell);
      row.appendChild(effCell);
      row.appendChild(buttonCell);
      self._tbody.appendChild(row);
    });

    this.selectSolution(0);
  };

  ResultsTable.prototype.selectSolution = function (index) {
    this._selectedIndex = index;
    document.querySelectorAll(".result-row").forEach(function (row, i) {
      row.classList.toggle("selected-row", i === index);
    });
    var solution = this._solutions[index];
    if (solution) {
      this._eventBus.emit('solution:selected', { index: index, solution: solution });
    }
  };

  GearApp.ui.ResultsTable = ResultsTable;

})(GearApp);
