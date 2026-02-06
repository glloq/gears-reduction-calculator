// UI.js - Gestion de l'affichage, résultats, analyse mécanique et graphiques

var globalSolutions = [];
var gearSvg = null;
var selectedSolutionIndex = 0;

/**
 * Calcule le rapport total d'une solution en tenant compte des types.
 */
function _calculerRapportSolution(solution) {
  return solution.reduce((acc, stage) => {
    const A = stage[0], B = stage[1], typeId = stage[2] || 'spur';
    if (typeof calculerRapportEtage === 'function') {
      return acc * calculerRapportEtage(typeId, A, B);
    }
    return acc * (B / A);
  }, 1);
}

/**
 * Affiche les résultats de recherche dans le tableau avec analyse mécanique.
 * @param {Array} solutions - Tableau des solutions [[A, B, typeId?], ...]
 */
function afficherResultats(solutions) {
  globalSolutions = solutions;
  const tbody = document.getElementById("resultats");
  tbody.innerHTML = "";

  if (solutions.length === 0) {
    tbody.innerHTML = "<tr><td colspan='7'>Aucun résultat</td></tr>";
    _hideMechanicalPanel();
    return;
  }

  const modValue = _getModuleValue();
  const vitesseEntree = _getVitesseEntree();
  const coupleEntree = _getCoupleEntree();

  solutions.forEach((solution, index) => {
    let ratio = _calculerRapportSolution(solution);
    let target = parseFloat(document.getElementById("rapport").value);
    let error = Math.abs((ratio - target) / target * 100);
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let row = document.createElement("tr");
    row.classList.add("result-row");
    if (index === 0) row.classList.add("selected-row");
    row.onclick = () => _selectSolution(index);

    // Colonne Engrenages
    let gearsCell = document.createElement("td");
    let gearsHtml = "";
    solution.forEach((stage, i) => {
      const typeId = stage[2] || 'spur';
      const type = typeof getTransmissionType === 'function' ? getTransmissionType(typeId) : null;
      const labelA = type ? type.labelA.split(' ').pop() : 'dents';
      const labelB = type ? type.labelB.split(' ').pop() : 'dents';
      let letter1 = letters[2 * i];
      let letter2 = letters[2 * i + 1];
      gearsHtml += `<span>${letter1}:${stage[0]}, ${letter2}:${stage[1]}</span>`;
      if (i < solution.length - 1) gearsHtml += " ; ";
    });
    gearsCell.innerHTML = gearsHtml;

    // Colonne Types
    let typesCell = document.createElement("td");
    solution.forEach((stage) => {
      const typeId = stage[2] || 'spur';
      const type = typeof getTransmissionType === 'function' ? getTransmissionType(typeId) : null;
      const nomCourt = type ? type.nomCourt : typeId;
      const badge = document.createElement("span");
      badge.className = `type-badge ${typeId}`;
      badge.textContent = nomCourt;
      typesCell.appendChild(badge);
    });

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
    row.appendChild(typesCell);
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

  // Sens de rotation global
  const sensLabel = analyse.sensRotationTotal > 0 ? 'Même sens' : 'Inversé';

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
  html += `<div class="mech-card">
    <span class="mech-label">Sens rotation</span>
    <span class="mech-value">${sensLabel}</span>
  </div>`;
  html += '</div>';

  // Détails par étage
  html += '<h4>Détails par étage</h4>';
  html += '<div class="stages-table-container"><table class="stages-table"><thead><tr>';
  html += '<th>Étage</th><th>Type</th><th>Menante</th><th>Menée</th><th>Rapport</th>';
  html += '<th>Entraxe</th><th>Rendement</th><th>Vitesse sortie</th>';
  html += '<th>Couple sortie</th><th>Rapp. conduite</th><th>Sécurité</th><th>Axes</th>';
  html += '</tr></thead><tbody>';

  analyse.etages.forEach((etage, i) => {
    const secMin = Math.min(etage.resistanceMenante.facteurSecurite, etage.resistanceMenee.facteurSecurite);
    const secClass = secMin >= 2 ? 'excellent' : secMin >= 1.5 ? 'good' : 'warning';

    const hasConduite = etage.rapportConduite !== null && etage.rapportConduite !== undefined;
    const conduiteText = hasConduite ? etage.rapportConduite.toFixed(2) : '-';
    const conduiteClass = hasConduite ? (etage.rapportConduite >= 1.2 ? 'excellent' : etage.rapportConduite >= 1.0 ? 'good' : 'warning') : '';

    // Vérification d'interférence (seulement pour types à engrenage)
    const isGearType = etage.typeId !== 'belt';
    let interfWarning = '';
    if (isGearType && etage.typeId !== 'worm' && etage.typeId !== 'epicyclic') {
      const interf = GearMechanics.verifierInterference(etage.dentsMenante, etage.dentsMenee, 20);
      if (interf.interfere && !interf.menanteSuffisant) {
        interfWarning = '<span class="warning-icon" title="Risque d\'interférence">!</span>';
      }
    }

    // Entraxe (peut être null pour conique)
    const entraxeText = etage.geometrie.entraxe !== null ? etage.geometrie.entraxe.toFixed(2) + ' mm' : '-';

    // Relation d'axes
    const axesLabels = { parallel: 'Parallèle', perpendicular: '90°', coaxial: 'Coaxial', offset: 'Décalé' };
    const axesText = axesLabels[etage.axesRelation] || etage.axesRelation;

    // Sens de rotation de l'étage
    const sensIcon = etage.sensRotation > 0 ? '↻' : '↺';

    html += `<tr>`;
    html += `<td>${i + 1}</td>`;
    html += `<td><span class="type-badge ${etage.typeId}">${etage.typeNomCourt}</span></td>`;
    html += `<td>${etage.dentsMenante} ${etage.uniteA} ${interfWarning}</td>`;
    html += `<td>${etage.dentsMenee} ${etage.uniteB}</td>`;
    html += `<td>${etage.rapport.toFixed(3)}</td>`;
    html += `<td>${entraxeText}</td>`;
    html += `<td>${(etage.rendement * 100).toFixed(1)}%</td>`;
    html += `<td>${etage.vitesseSortie.toFixed(1)} tr/min</td>`;
    html += `<td>${etage.coupleSortie.toFixed(2)} N.m</td>`;
    html += `<td class="${conduiteClass}">${conduiteText}</td>`;
    html += `<td class="${secClass}">${secMin === Infinity ? '∞' : secMin.toFixed(1)}</td>`;
    html += `<td>${axesText} ${sensIcon}</td>`;
    html += `</tr>`;
  });

  html += '</tbody></table></div>';

  // Géométrie détaillée
  html += '<details><summary>Géométrie détaillée</summary>';
  html += '<div class="geometry-details">';
  analyse.etages.forEach((etage, i) => {
    const g = etage.geometrie;
    const typeId = etage.typeId;
    html += `<div class="geom-stage">
      <h5>Étage ${i + 1} — <span class="type-badge ${typeId}">${etage.typeNomCourt}</span></h5>
      <div class="geom-grid">`;

    // Données communes
    if (g.pas) html += `<div><strong>Pas:</strong> ${g.pas.toFixed(2)} mm</div>`;
    if (g.entraxe !== null && g.entraxe !== undefined) html += `<div><strong>Entraxe:</strong> ${g.entraxe.toFixed(2)} mm</div>`;

    // Données spécifiques au type
    if (typeId === 'spur' || typeId === 'helical' || typeId === 'internal') {
      if (g.diamPrimitiveA) html += `<div><strong>${etage.labelA} - Ø primitif:</strong> ${g.diamPrimitiveA.toFixed(1)} mm</div>`;
      if (g.diamTeteA) html += `<div><strong>${etage.labelA} - Ø tête:</strong> ${g.diamTeteA.toFixed(1)} mm</div>`;
      if (g.diamPiedA) html += `<div><strong>${etage.labelA} - Ø pied:</strong> ${g.diamPiedA.toFixed(1)} mm</div>`;
      if (g.diamPrimitiveB) html += `<div><strong>${etage.labelB} - Ø primitif:</strong> ${g.diamPrimitiveB.toFixed(1)} mm</div>`;
      if (g.diamTeteB) html += `<div><strong>${etage.labelB} - Ø tête:</strong> ${g.diamTeteB.toFixed(1)} mm</div>`;
      if (g.diamPiedB) html += `<div><strong>${etage.labelB} - Ø pied:</strong> ${g.diamPiedB.toFixed(1)} mm</div>`;
      if (g.diamBaseA) html += `<div><strong>${etage.labelA} - Ø base:</strong> ${g.diamBaseA.toFixed(1)} mm</div>`;
      if (g.diamBaseB) html += `<div><strong>${etage.labelB} - Ø base:</strong> ${g.diamBaseB.toFixed(1)} mm</div>`;
      if (typeId === 'helical') {
        if (g.angleHelice) html += `<div><strong>Angle d'hélice:</strong> ${g.angleHelice}°</div>`;
        if (g.moduleApparent) html += `<div><strong>Module apparent:</strong> ${g.moduleApparent.toFixed(3)} mm</div>`;
      }
    } else if (typeId === 'bevel') {
      if (g.diamPrimitiveA) html += `<div><strong>Pignon - Ø primitif:</strong> ${g.diamPrimitiveA.toFixed(1)} mm</div>`;
      if (g.diamPrimitiveB) html += `<div><strong>Roue - Ø primitif:</strong> ${g.diamPrimitiveB.toFixed(1)} mm</div>`;
      if (g.longueurCone) html += `<div><strong>Longueur cône:</strong> ${g.longueurCone.toFixed(1)} mm</div>`;
      if (g.angleCone1) html += `<div><strong>Angle cône pignon:</strong> ${g.angleCone1.toFixed(1)}°</div>`;
      if (g.angleCone2) html += `<div><strong>Angle cône roue:</strong> ${g.angleCone2.toFixed(1)}°</div>`;
      if (g.angleAxes) html += `<div><strong>Angle entre axes:</strong> ${g.angleAxes}°</div>`;
    } else if (typeId === 'belt') {
      if (g.diamPrimitiveA) html += `<div><strong>Ø poulie menante:</strong> ${g.diamPrimitiveA} mm</div>`;
      if (g.diamPrimitiveB) html += `<div><strong>Ø poulie menée:</strong> ${g.diamPrimitiveB} mm</div>`;
      if (g.longueurCourroie) html += `<div><strong>Longueur courroie:</strong> ${g.longueurCourroie.toFixed(1)} mm</div>`;
      if (g.angleEnroulementA) html += `<div><strong>Angle enroulement A:</strong> ${g.angleEnroulementA.toFixed(1)}°</div>`;
      if (g.typeCourroie) html += `<div><strong>Type courroie:</strong> ${g.typeCourroie}</div>`;
    } else if (typeId === 'epicyclic') {
      if (g.diamPrimitiveSolaire) html += `<div><strong>Ø solaire:</strong> ${g.diamPrimitiveSolaire.toFixed(1)} mm</div>`;
      if (g.diamPrimitiveCouronne) html += `<div><strong>Ø couronne:</strong> ${g.diamPrimitiveCouronne.toFixed(1)} mm</div>`;
      if (g.diamPrimitiveSatellite) html += `<div><strong>Ø satellite:</strong> ${g.diamPrimitiveSatellite.toFixed(1)} mm</div>`;
      if (g.dentsSatellite) html += `<div><strong>Dents satellite:</strong> ${g.dentsSatellite}</div>`;
      if (g.nbSatellites) html += `<div><strong>Nb satellites:</strong> ${g.nbSatellites}</div>`;
      if (g.diamExterieur) html += `<div><strong>Ø extérieur:</strong> ${g.diamExterieur.toFixed(1)} mm</div>`;
    } else if (typeId === 'worm') {
      if (g.diamPrimitiveVis) html += `<div><strong>Ø primitif vis:</strong> ${g.diamPrimitiveVis.toFixed(1)} mm</div>`;
      if (g.diamPrimitiveRoue) html += `<div><strong>Ø primitif roue:</strong> ${g.diamPrimitiveRoue.toFixed(1)} mm</div>`;
      if (g.nbFilets) html += `<div><strong>Nb filets:</strong> ${g.nbFilets}</div>`;
      if (g.angleAvance) html += `<div><strong>Angle d'avance:</strong> ${g.angleAvance.toFixed(1)}°</div>`;
      if (g.longueurVis) html += `<div><strong>Longueur vis:</strong> ${g.longueurVis.toFixed(1)} mm</div>`;
      html += `<div><strong>Irréversible:</strong> ${g.irreversible ? 'Oui' : 'Non'}</div>`;
    }

    html += `</div></div>`;
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
