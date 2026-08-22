// Charts.js - Module de graphiques de comparaison et d'analyse
// Utilise Chart.js pour afficher les données mécaniques sous forme visuelle
// Supporte la mise à jour in-place (sans destruction/re-création) et l'export PNG

class GearCharts {
  constructor() {
    this.charts = {};
  }

  /**
   * Met à jour un graphique existant ou en crée un nouveau.
   * Évite le scintillement causé par la destruction/re-création.
   */
  _updateOrCreate(canvasId, config) {
    var existing = this.charts[canvasId];
    if (existing) {
      existing.data = config.data;
      if (config.options) {
        existing.options = config.options;
      }
      existing.update('none');
      return existing;
    }
    var ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    if (typeof Chart === 'undefined') return null;
    var chart = new Chart(ctx, config);
    this.charts[canvasId] = chart;
    return chart;
  }

  /**
   * Détruit un graphique existant.
   */
  _destroyChart(chartId) {
    if (this.charts[chartId]) {
      this.charts[chartId].destroy();
      delete this.charts[chartId];
    }
  }

  /**
   * Exporte un graphique en image PNG.
   */
  exportChart(canvasId, filename) {
    var chart = this.charts[canvasId];
    if (!chart) return;
    var url = chart.toBase64Image('image/png', 1);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || (canvasId + '.png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * COMPARAISON DES RAPPORTS — LUE SUR LE MODÈLE, PLUS RECALCULÉE.
   *
   * Ce graphique reconstruisait le rapport de chaque solution à partir d'un
   * triplet hérité `[A, B, type]`, en repassant par `calculerRapportEtage` et,
   * à défaut, par un `B / A`. Or `B / A` n'est le rapport d'un étage que pour
   * les familles à deux roues : une vis sans fin réduit de Z2 / filets, un
   * planétaire suit Willis, une crémaillère n'a pas de rapport du tout. La
   * barre tracée pouvait donc contredire le chiffre affiché deux centimètres
   * plus haut, dans la même page.
   *
   * `Engineering.analyzeSolution` a déjà calculé `ratio` et `errorPercent`,
   * famille par famille. On les LIT. Une valeur affichée n'a qu'une source.
   */
  drawRatioComparison(canvasId, solutions, rapportCible) {
    // Une transmission rotation → translation n'a pas de rapport de réduction :
    // elle a une course. Elle n'appartient pas à cette comparaison, et l'y
    // porter à zéro écraserait l'échelle des autres.
    var rotary = (solutions || []).filter(function (solution) {
      return solution && solution.mode !== 'rotationTranslation' && Number.isFinite(solution.ratio);
    });
    if (!rotary.length) return this._placeholder(canvasId,
      'Comparaison des rapports — aucune solution rotative à comparer');

    var labels = rotary.map(function (_, index) { return 'Solution ' + (index + 1); });
    var ratios = rotary.map(function (solution) { return solution.ratio; });
    var errors = rotary.map(function (solution) {
      return Number.isFinite(solution.errorPercent) ? solution.errorPercent : null;
    });
    var target = Number.isFinite(rapportCible) ? rapportCible : null;

    var datasets = [
      { label: 'Rapport obtenu', data: ratios, backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1, yAxisID: 'y' }
    ];
    // La cible ne se dessine que si on en a une : une ligne à `NaN` laisserait
    // croire qu'il n'y avait pas d'objectif.
    if (target !== null) {
      datasets.push({ label: 'Cible : ' + target, data: ratios.map(function () { return target; }),
        type: 'line', borderColor: 'rgba(0, 200, 0, 0.8)', backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [6, 3], pointRadius: 0, yAxisID: 'y' });
    }
    datasets.push({ label: 'Écart (%)', data: errors, backgroundColor: 'rgba(255, 99, 132, 0.7)',
      borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1, type: 'line', yAxisID: 'y1' });

    this._updateOrCreate(canvasId, {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { title: { display: true, text: 'Comparaison des rapports de réduction' } },
        scales: {
          y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Rapport' } },
          y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Écart (%)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // Quatre tracés hérités vivaient ici — radar mécanique, cascade, pertes et
  // facteurs de sécurité — sur un objet `analyse` à étages français. Plus
  // personne ne les appelait depuis que les `drawStructured*` lisent la
  // `Solution` ; ils ne faisaient que doubler les mêmes courbes à partir d'un
  // modèle qui n'était plus tenu à jour.

  /**
   * §23 : LE DIAGRAMME DE COMPROMIS — le front de Pareto, enfin visible.
   *
   * Le front était une logique interne : il décidait quelles alternatives
   * proposer, et l'utilisateur n'en voyait jamais la forme. Or c'est
   * exactement l'image qui fait comprendre un choix — « ces neuf-là ne sont
   * battues par personne, les autres le sont ».
   *
   * En abscisse l'encombrement, en ordonnée le rendement, la taille du point
   * dit le nombre d'étages, ★ la recommandée, ● le front, · le reste.
   */
  drawParetoScatter(canvasId, assessment) {
    if (!assessment || !assessment.entries.length) {
      return this._placeholder(canvasId, 'Compromis — aucune solution à situer');
    }
    var points = assessment.entries.map(function (entry) {
      var size = entry.solution.dimensions && entry.solution.dimensions.maxDiameter;
      var efficiency = entry.solution.efficiency;
      if (!Number.isFinite(size) || !Number.isFinite(efficiency)) return null;
      return { x: size, y: efficiency * 100, r: 3 + Math.min(6, (entry.solution.stages || []).length * 2),
        rank: entry.decision.rank, pareto: entry.decision.pareto,
        recommended: entry.decision.recommended, index: entry.index };
    }).filter(Boolean);
    if (!points.length) return this._placeholder(canvasId, 'Compromis — encombrement ou rendement non calculés');

    var groups = [
      { label: '★ Recommandée', color: '#2563eb', pick: function (p) { return p.recommended; }, radius: 9 },
      { label: '● Front de Pareto', color: '#15803d', pick: function (p) { return p.pareto && !p.recommended; }, radius: 6 },
      { label: 'Dominées', color: 'rgba(120,130,145,.45)', pick: function (p) { return !p.pareto; }, radius: 4 }
    ];
    this._updateOrCreate(canvasId, {
      type: 'scatter',
      data: { datasets: groups.map(function (group) {
        var subset = points.filter(group.pick);
        return { label: group.label + ' (' + subset.length + ')', data: subset,
          backgroundColor: group.color, borderColor: group.color,
          pointRadius: subset.map(function (p) { return Math.max(group.radius, p.r); }),
          pointHoverRadius: 12 };
      }) },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'Compromis encombrement / rendement — la taille du point dit les étages' },
          tooltip: { callbacks: { label: function (item) {
            var point = item.raw;
            return 'Rang ' + point.rank + ' — Ø ' + point.x.toFixed(0) + ' mm · ' + point.y.toFixed(1) + ' %';
          } } }
        },
        scales: {
          x: { title: { display: true, text: 'Ø hors-tout (mm)' } },
          y: { title: { display: true, text: 'Rendement (%)' } }
        }
      }
    });
  }

  /**
   * §23/§22 : D'OÙ VIENT LE CLASSEMENT.
   *
   * Le radar montrait les pénalités brutes, toutes à la même échelle, sans
   * dire laquelle pèse. Ce sont les CONTRIBUTIONS — pénalité × poids — qui
   * expliquent un rang, et leur somme vaut l'indice affiché.
   */
  drawScoreContribution(canvasId, entry) {
    if (!entry || !entry.contributions || !entry.contributions.length) {
      return this._placeholder(canvasId, 'Contribution — aucune décomposition disponible');
    }
    var rows = entry.contributions.filter(function (row) { return Number.isFinite(row.contribution); });
    if (!rows.length) return this._placeholder(canvasId, 'Contribution — critères non chiffrés');
    var estimated = rows.map(function (row) { return row.confidence === 'low'; });
    this._updateOrCreate(canvasId, {
      type: 'bar',
      data: { labels: rows.map(function (row) { return row.label; }),
        datasets: [{ label: 'Contribution à l’indice',
          data: rows.map(function (row) { return row.contribution; }),
          // Ce qui est ESTIMÉ se distingue de ce qui est calculé : une barre
          // hachurée de bruit ne se lit pas comme une barre d'encombrement.
          backgroundColor: estimated.map(function (low) { return low ? 'rgba(180,83,9,.55)' : '#2563eb'; }) }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          title: { display: true, text: 'Contribution au classement — total ' +
            rows.reduce(function (sum, row) { return sum + row.contribution; }, 0).toFixed(3) },
          tooltip: { callbacks: { afterLabel: function (item) {
            var row = rows[item.dataIndex];
            return 'pénalité ' + row.penalty.toFixed(3) + ' × poids ' + row.weight +
              (row.confidence === 'low' ? ' · estimation qualitative' : ' · calcul');
          } } },
          legend: { display: false }
        },
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Contribution (plus bas = mieux)' } } }
      }
    });
  }

  /** Render-only charts for the structured Engineering Solution model. */
  drawStructuredCascade(canvasId, solution) {
    var speed = solution.inputSpeedRpm, torque = solution.inputTorqueNm;
    var labels = ['Entrée'], speeds = [speed], torques = [torque];
    solution.mechanical.forEach(function (stage, index) {
      speed /= Math.abs(stage.ratio) || 1;
      torque *= Math.abs(stage.ratio) * stage.efficiency;
      labels.push('Étage ' + (index + 1)); speeds.push(speed); torques.push(torque);
    });
    this._updateOrCreate(canvasId, { type: 'line', data: { labels: labels, datasets: [
      { label: 'Vitesse (tr/min)', data: speeds, borderColor: '#2563eb', yAxisID: 'y' },
      { label: 'Couple (N·m)', data: torques, borderColor: '#dc2626', yAxisID: 'y1' }
    ] }, options: { responsive: true, plugins: { title: { display: true, text: 'Cascade calculée par Engineering' } }, scales: { y: { beginAtZero: true }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } } });
  }

  drawStructuredLosses(canvasId, solution) {
    // Une chaîne analysée sans régime n'a pas de puissance d'entrée : il n'y a
    // alors pas de pertes à répartir. Tracer des zéros laisserait croire à un
    // rendement parfait ; on dit que la donnée manque.
    if (!Number.isFinite(solution.inputPowerW)) return this._placeholder(canvasId,
      'Pertes par étage — couple ou puissance d’entrée non renseigné');
    var power = solution.inputPowerW, losses = solution.mechanical.map(function (stage) { var loss = power * (1 - stage.efficiency); power *= stage.efficiency; return loss; });
    this._updateOrCreate(canvasId, { type: 'bar', data: { labels: losses.map(function (_, i) { return 'Étage ' + (i + 1); }), datasets: [{ label: 'Pertes (W)', data: losses, backgroundColor: '#f59e0b' }] }, options: { responsive: true, plugins: { title: { display: true, text: 'Pertes par étage — total ' + solution.lossPowerW.toFixed(1) + ' W' } }, scales: { y: { beginAtZero: true } } } });
  }

  /** Un graphique qu'on ne peut pas tracer : dire pourquoi, plutôt qu'un vide. */
  _placeholder(canvasId, text) {
    if (this.charts && this.charts[canvasId]) { this.charts[canvasId].destroy(); delete this.charts[canvasId]; }
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var context = canvas.getContext && canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#5d6b81';
    context.font = '13px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    context.restore();
  }

  drawStructuredSafety(canvasId, solution) {
    // §24 : LES SEUILS SE VOIENT. Des barres sans ligne de minimum obligent à
    // savoir de tête ce qu'exige le calcul ; c'est le seuil qui dit si la barre
    // est acceptable, et c'est lui qu'on venait chercher.
    var floors = { bending: 1.3, contact: 1.1 };
    var stages = solution.mechanical.map(function (_, i) { return 'Étage ' + (i + 1); });
    var below = function (value, floor) {
      if (!Number.isFinite(value)) return 'rgba(120,130,145,.35)';   // non évalué
      if (value < floor) return '#b91c1c';                            // insuffisant
      return value < floor * 1.25 ? '#b45309' : '#15803d';            // limite / conforme
    };
    this._updateOrCreate(canvasId, { type: 'bar', data: { labels: stages, datasets: [
      { label: 'SF Lewis simplifié', data: solution.mechanical.map(function (m) { return m.bending ? m.bending.safetyFactor : null; }),
        backgroundColor: solution.mechanical.map(function (m) { return below(m.bending && m.bending.safetyFactor, floors.bending); }) },
      { label: 'SH Hertz simplifié', data: solution.mechanical.map(function (m) { return m.contact ? m.contact.safetyFactor : null; }),
        backgroundColor: solution.mechanical.map(function (m) { return below(m.contact && m.contact.safetyFactor, floors.contact); }) },
      { label: 'SF minimal ' + floors.bending.toFixed(2), type: 'line', borderColor: '#2563eb', borderDash: [6, 3],
        borderWidth: 2, pointRadius: 0, data: stages.map(function () { return floors.bending; }) },
      { label: 'SH minimal ' + floors.contact.toFixed(2), type: 'line', borderColor: '#f97316', borderDash: [2, 3],
        borderWidth: 2, pointRadius: 0, data: stages.map(function () { return floors.contact; }) }
    ] }, options: { responsive: true, plugins: { title: { display: true,
      text: 'Facteurs de sécurité — vert conforme, orange limite, rouge insuffisant, gris non évalué' } },
      scales: { y: { beginAtZero: true } } } });
  }

  drawStructuredScore(canvasId, solution) {
    var metrics = solution.score.metrics, keys = Object.keys(metrics);
    // Deux formes coexistent : objets {value,…} en rotatif, nombres bruts en linéaire.
    var values = keys.map(function (key) { var m = metrics[key]; return m && m.value != null ? m.value : (Number(m) || 0); });
    this._updateOrCreate(canvasId, { type: 'radar', data: { labels: keys, datasets: [{ label: 'Pénalités normalisées', data: values, backgroundColor: 'rgba(37,99,235,.2)', borderColor: '#2563eb' }] }, options: { responsive: true, scales: { r: { min: 0, max: 1 } }, plugins: { title: { display: true, text: 'Détail du score — pénalités (plus bas = mieux)' } } } });
  }

  /**
   * Détruit tous les graphiques.
   */
  destroyAll() {
    Object.keys(this.charts).forEach(id => this._destroyChart(id));
  }
}

window.GearCharts = new GearCharts();
