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
    this._updateOrCreate(canvasId, { type: 'bar', data: { labels: solution.mechanical.map(function (_, i) { return 'Étage ' + (i + 1); }), datasets: [
      { label: 'SF Lewis simplifié', data: solution.mechanical.map(function (m) { return m.bending ? m.bending.safetyFactor : null; }), backgroundColor: '#2563eb' },
      { label: 'SH Hertz simplifié', data: solution.mechanical.map(function (m) { return m.contact ? m.contact.safetyFactor : null; }), backgroundColor: '#f97316' }
    ] }, options: { responsive: true, plugins: { title: { display: true, text: 'Facteurs de sécurité — Engineering estimate' } }, scales: { y: { beginAtZero: true } } } });
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
