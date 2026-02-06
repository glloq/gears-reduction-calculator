// UI.js - Gestion de l'affichage, résultats, analyse mécanique et graphiques

var globalSolutions = [];
var gearSvg = null;
var selectedSolutionIndex = 0;

/**
 * Affiche les résultats de recherche dans le tableau avec analyse mécanique.
 * @param {Array} solutions - Tableau des solutions (chaînes de paires)
 */
function afficherResultats(solutions) {
  globalSolutions = solutions;
  const tbody = document.getElementById("resultats");
  tbody.innerHTML = "";

  if (solutions.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6'>Aucun résultat</td></tr>";
    _hideMechanicalPanel();
    return;
  }

  const modValue = _getModuleValue();
  const vitesseEntree = _getVitesseEntree();
  const coupleEntree = _getCoupleEntree();

  solutions.forEach((solution, index) => {
    let ratio = solution.reduce((acc, [m, n]) => acc * (n / m), 1);
    let target = parseFloat(document.getElementById("rapport").value);
    let error = Math.abs((ratio - target) / target * 100);
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let gearsText = "";
    solution.forEach((pair, i) => {
      let letter1 = letters[2 * i];
      let letter2 = letters[2 * i + 1];
      gearsText += `${letter1}: ${pair[0]}, ${letter2}: ${pair[1]}`;
      if (i < solution.length - 1) gearsText += " ; ";
    });

    let row = document.createElement("tr");
    row.classList.add("result-row");
    if (index === 0) row.classList.add("selected-row");
    row.onclick = () => _selectSolution(index);

    // Colonne Engrenages
    let gearsCell = document.createElement("td");
    gearsCell.innerText = gearsText;

    // Colonne Rapport obtenu
    let ratioCell = document.createElement("td");
    ratioCell.innerText = ratio.toFixed(4);

    // Colonne Écart
    let errorCell = document.createElement("td");
    errorCell.innerText = error.toFixed(3);
    if (error < 0.01) errorCell.classList.add("excellent");
    else if (error < 0.1) errorCell.classList.add("good");

    // Colonne Nombre d'étages
    let stagesCell = document.createElement("td");
    stagesCell.innerText = solution.length;

    // Colonne Rendement (si module renseigné)
    let effCell = document.createElement("td");
    if (modValue) {
      const analyse = GearMechanics.analyserTrainEngrenages(solution, {
        module: modValue,
        vitesseEntree: vitesseEntree,
        coupleEntree: coupleEntree
      });
      effCell.innerText = (analyse.rendementTotal * 100).toFixed(1) + "%";
      if (analyse.rendementTotal > 0.95) effCell.classList.add("excellent");
      else if (analyse.rendementTotal > 0.90) effCell.classList.add("good");
    } else {
      effCell.innerText = "-";
    }

    // Colonne Schéma
    let buttonCell = document.createElement("td");
    let btn = document.createElement("button");
    btn.innerText = "Voir";
    btn.classList.add("btn-schema");
    btn.onclick = function (e) {
      e.stopPropagation();
      _selectSolution(index);
    };
    buttonCell.appendChild(btn);

    row.appendChild(gearsCell);
    row.appendChild(ratioCell);
    row.appendChild(errorCell);
    row.appendChild(stagesCell);
    row.appendChild(effCell);
    row.appendChild(buttonCell);

    tbody.appendChild(row);
  });

  // Afficher la première solution
  _selectSolution(0);

  // Graphiques de comparaison
  _updateComparisonCharts(solutions);
}

/**
 * Sélectionne une solution et affiche ses détails.
 */
function _selectSolution(index) {
  selectedSolutionIndex = index;

  // Mise à jour de la ligne sélectionnée
  document.querySelectorAll(".result-row").forEach((row, i) => {
    row.classList.toggle("selected-row", i === index);
  });

  const solution = globalSolutions[index];
  if (!solution) return;

  // Schéma SVG interactif
  _drawSVGSchematic(index);

  // Schéma Canvas (legacy)
  displaySolutionSchematic(index);

  // Analyse mécanique détaillée
  _showMechanicalAnalysis(solution);
}

/**
 * Dessine le schéma SVG interactif.
 */
function _drawSVGSchematic(index) {
  const solution = globalSolutions[index];
  if (!solution) return;

  const modValue = _getModuleValue() || 2;

  if (!gearSvg) {
    const container = document.getElementById("svgContainer");
    if (container) {
      gearSvg = new GearSVG("svgContainer");
    }
  }

  if (gearSvg) {
    gearSvg.drawGearTrain(solution, modValue, 20);
  }
}

/**
 * Affiche l'analyse mécanique détaillée.
 */
function _showMechanicalAnalysis(solution) {
  const panel = document.getElementById("mechanicalPanel");
  if (!panel) return;

  const modValue = _getModuleValue();
  if (!modValue) {
    panel.innerHTML = '<p class="hint">Renseignez le module pour voir l\'analyse mécanique complète.</p>';
    panel.style.display = "block";
    return;
  }

  const vitesseEntree = _getVitesseEntree();
  const coupleEntree = _getCoupleEntree();

  const analyse = GearMechanics.analyserTrainEngrenages(solution, {
    module: modValue,
    vitesseEntree: vitesseEntree,
    coupleEntree: coupleEntree
  });

  let html = '<h3>Analyse mécanique</h3>';

  // Résumé global
  html += '<div class="mech-summary">';
  html += `<div class="mech-card">
    <span class="mech-label">Rapport total</span>
    <span class="mech-value">${analyse.rapportTotal.toFixed(4)}</span>
  </div>`;
  html += `<div class="mech-card">
    <span class="mech-label">Rendement total</span>
    <span class="mech-value ${analyse.rendementTotal > 0.95 ? 'excellent' : analyse.rendementTotal > 0.90 ? 'good' : 'warning'}">${(analyse.rendementTotal * 100).toFixed(1)}%</span>
  </div>`;
  html += `<div class="mech-card">
    <span class="mech-label">Vitesse sortie</span>
    <span class="mech-value">${analyse.vitesseSortie.toFixed(1)} tr/min</span>
  </div>`;
  html += `<div class="mech-card">
    <span class="mech-label">Couple sortie</span>
    <span class="mech-value">${analyse.coupleSortie.toFixed(2)} N.m</span>
  </div>`;
  html += `<div class="mech-card">
    <span class="mech-label">Puissance entrée</span>
    <span class="mech-value">${analyse.puissanceEntree.toFixed(1)} W</span>
  </div>`;
  html += `<div class="mech-card">
    <span class="mech-label">Puissance sortie</span>
    <span class="mech-value">${analyse.puissanceSortie.toFixed(1)} W</span>
  </div>`;
  html += '</div>';

  // Détails par étage
  html += '<h4>Détails par étage</h4>';
  html += '<div class="stages-table-container"><table class="stages-table"><thead><tr>';
  html += '<th>Étage</th><th>Menante</th><th>Menée</th><th>Rapport</th>';
  html += '<th>Entraxe</th><th>Rendement</th><th>Vitesse sortie</th>';
  html += '<th>Couple sortie</th><th>Rapp. conduite</th><th>Sécurité</th>';
  html += '</tr></thead><tbody>';

  analyse.etages.forEach((etage, i) => {
    const secMin = Math.min(etage.resistanceMenante.facteurSecurite, etage.resistanceMenee.facteurSecurite);
    const secClass = secMin >= 2 ? 'excellent' : secMin >= 1.5 ? 'good' : 'warning';
    const conduiteClass = etage.rapportConduite >= 1.2 ? 'excellent' : etage.rapportConduite >= 1.0 ? 'good' : 'warning';

    // Vérification d'interférence
    const interf = GearMechanics.verifierInterference(etage.dentsMenante, etage.dentsMenee, 20);

    html += `<tr>`;
    html += `<td>${i + 1}</td>`;
    html += `<td>${etage.dentsMenante} dents ${interf.interfere && !interf.menanteSuffisant ? '<span class="warning-icon" title="Risque d\'interférence">!</span>' : ''}</td>`;
    html += `<td>${etage.dentsMenee} dents</td>`;
    html += `<td>${etage.rapport.toFixed(3)}</td>`;
    html += `<td>${etage.geometrie.entraxe.toFixed(2)} mm</td>`;
    html += `<td>${(etage.rendement * 100).toFixed(1)}%</td>`;
    html += `<td>${etage.vitesseSortie.toFixed(1)} tr/min</td>`;
    html += `<td>${etage.coupleSortie.toFixed(2)} N.m</td>`;
    html += `<td class="${conduiteClass}">${etage.rapportConduite.toFixed(2)}</td>`;
    html += `<td class="${secClass}">${secMin.toFixed(1)}</td>`;
    html += `</tr>`;
  });

  html += '</tbody></table></div>';

  // Géométrie détaillée
  html += '<details><summary>Géométrie détaillée</summary>';
  html += '<div class="geometry-details">';
  analyse.etages.forEach((etage, i) => {
    const g = etage.geometrie;
    html += `<div class="geom-stage">
      <h5>Étage ${i + 1}</h5>
      <div class="geom-grid">
        <div><strong>Module:</strong> ${g.module} mm</div>
        <div><strong>Pas:</strong> ${g.pas.toFixed(2)} mm</div>
        <div><strong>Épaisseur dent:</strong> ${g.epaisseurDent.toFixed(2)} mm</div>
        <div><strong>Entraxe:</strong> ${g.entraxe.toFixed(2)} mm</div>
        <div><strong>Menante - Ø primitif:</strong> ${g.menante.diamPrimitive.toFixed(1)} mm</div>
        <div><strong>Menante - Ø tête:</strong> ${g.menante.diamTete.toFixed(1)} mm</div>
        <div><strong>Menante - Ø pied:</strong> ${g.menante.diamPied.toFixed(1)} mm</div>
        <div><strong>Menante - Ø base:</strong> ${g.menante.diamBase.toFixed(1)} mm</div>
        <div><strong>Menée - Ø primitif:</strong> ${g.menee.diamPrimitive.toFixed(1)} mm</div>
        <div><strong>Menée - Ø tête:</strong> ${g.menee.diamTete.toFixed(1)} mm</div>
        <div><strong>Menée - Ø pied:</strong> ${g.menee.diamPied.toFixed(1)} mm</div>
        <div><strong>Menée - Ø base:</strong> ${g.menee.diamBase.toFixed(1)} mm</div>
      </div>
    </div>`;
  });
  html += '</div></details>';

  panel.innerHTML = html;
  panel.style.display = "block";

  // Mettre à jour les graphiques d'analyse
  _updateAnalysisCharts(analyse);
}

function _hideMechanicalPanel() {
  const panel = document.getElementById("mechanicalPanel");
  if (panel) panel.style.display = "none";
}

/**
 * Met à jour les graphiques de comparaison entre solutions.
 */
function _updateComparisonCharts(solutions) {
  if (typeof GearCharts === 'undefined') return;

  const rapportCible = parseFloat(document.getElementById("rapport").value);

  // Graphique de comparaison des rapports
  if (document.getElementById("ratioChart")) {
    GearCharts.drawRatioComparison("ratioChart", solutions, rapportCible);
  }

  // Graphique radar multicritères (si module renseigné)
  const modValue = _getModuleValue();
  if (modValue && document.getElementById("radarChart")) {
    const analyses = solutions.slice(0, 5).map(sol =>
      GearMechanics.analyserTrainEngrenages(sol, {
        module: modValue,
        vitesseEntree: _getVitesseEntree(),
        coupleEntree: _getCoupleEntree()
      })
    );
    GearCharts.drawMechanicalRadar("radarChart", analyses);
  }
}

/**
 * Met à jour les graphiques d'analyse d'une solution spécifique.
 */
function _updateAnalysisCharts(analyse) {
  if (typeof GearCharts === 'undefined') return;

  if (document.getElementById("cascadeChart")) {
    GearCharts.drawTorqueSpeedCascade("cascadeChart", analyse);
  }
  if (document.getElementById("powerLossChart")) {
    GearCharts.drawPowerLossBreakdown("powerLossChart", analyse);
  }
}

// --- Fonctions utilitaires ---

function _getModuleValue() {
  const el = document.getElementById("module");
  if (el && el.value.trim() !== "") return parseFloat(el.value);
  return null;
}

function _getVitesseEntree() {
  const el = document.getElementById("vitesse_entree");
  if (el && el.value.trim() !== "") return parseFloat(el.value);
  return 1500;
}

function _getCoupleEntree() {
  const el = document.getElementById("couple_entree");
  if (el && el.value.trim() !== "") return parseFloat(el.value);
  return 10;
}

// --- Fonctions publiques originales ---

function afficherMessageStatus(message) {
  const status = document.getElementById("status");
  status.innerText = message;
}

function ajouterLog(message) {
  const logDiv = document.getElementById("logs");
  if (logDiv) {
    const p = document.createElement("p");
    p.innerText = message;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
  }
}

function clearLogs() {
  const logDiv = document.getElementById("logs");
  if (logDiv) logDiv.innerHTML = "";
}

function toggleLogs() {
  const logsDiv = document.getElementById("logs");
  if (logsDiv.style.display === "none") {
    logsDiv.style.display = "block";
  } else {
    logsDiv.style.display = "none";
  }
}

// --- Export SVG/PNG ---

function exporterSVG() {
  if (!gearSvg) return;
  const svgData = gearSvg.exportSVG();
  const blob = new Blob([svgData], { type: "image/svg+xml" });
  _telechargerFichier(blob, "engrenages.svg");
}

function exporterPNG() {
  if (!gearSvg) return;
  gearSvg.exportPNG((blob) => {
    if (blob) _telechargerFichier(blob, "engrenages.png");
  });
}

function toggleAnimation() {
  if (gearSvg) gearSvg.toggleAnimation();
}

function resetSVGView() {
  if (gearSvg) gearSvg.resetView();
}

function _telechargerFichier(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Export global ---

window.UI = {
  afficherResultats,
  afficherMessageStatus,
  ajouterLog,
  toggleLogs,
  clearLogs,
  exporterSVG,
  exporterPNG,
  toggleAnimation,
  resetSVGView
};
