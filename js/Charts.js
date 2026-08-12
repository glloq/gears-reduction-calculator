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
   * Graphique de comparaison des rapports obtenus vs cible.
   */
  drawRatioComparison(canvasId, solutions, rapportCible) {
    const labels = solutions.map((_, i) => `Solution ${i + 1}`);
    const rapports = solutions.map(sol => sol.reduce((acc, stage) => {
      const A = stage[0], B = stage[1], typeId = stage[2] || 'spur';
      if (typeof calculerRapportEtage === 'function') {
        return acc * calculerRapportEtage(typeId, A, B);
      }
      return acc * (B / A);
    }, 1));
    const ecarts = rapports.map(r => Math.abs((r - rapportCible) / rapportCible * 100));

    // Ligne cible simulée via un dataset constant (pas besoin du plugin annotation)
    const cibleData = rapports.map(() => rapportCible);

    var config = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Rapport obtenu',
            data: rapports,
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Cible: ' + rapportCible,
            data: cibleData,
            type: 'line',
            borderColor: 'rgba(0, 200, 0, 0.8)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius: 0,
            yAxisID: 'y'
          },
          {
            label: 'Écart (%)',
            data: ecarts,
            backgroundColor: 'rgba(255, 99, 132, 0.7)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1,
            type: 'line',
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: { display: true, text: 'Comparaison des rapports de réduction' }
        },
        scales: {
          y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Rapport' } },
          y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Écart (%)' }, grid: { drawOnChartArea: false } }
        }
      }
    };

    this._updateOrCreate(canvasId, config);
  }

  /**
   * Graphique radar comparant les propriétés mécaniques des solutions.
   */
  drawMechanicalRadar(canvasId, analysesArray, rapportCible) {
    const labels = ['Rendement', 'Compacité', 'Rapport conduite', 'Sécurité dent', 'Précision ratio'];

    const datasets = analysesArray.slice(0, 5).map((analyse, i) => {
      const rendement = analyse.rendementTotal * 100;
      const compacite = Math.max(0, 100 - analyse.nombreEtages * 20);

      // Gérer les étages sans rapport de conduite (courroie, vis sans fin)
      var sommeConduite = 0, countConduite = 0;
      analyse.etages.forEach(function (e) {
        if (e.rapportConduite !== null && e.rapportConduite !== undefined) {
          sommeConduite += e.rapportConduite;
          countConduite++;
        }
      });
      const rapportConduite = countConduite > 0 ? Math.min(100, (sommeConduite / countConduite) * 50) : 50;

      const securite = Math.min(100, analyse.etages.reduce((sum, e) => {
        var secA = e.resistanceMenante.facteurSecurite;
        var secB = e.resistanceMenee.facteurSecurite;
        if (secA === Infinity) secA = 10;
        if (secB === Infinity) secB = 10;
        return sum + Math.min(secA, secB);
      }, 0) / analyse.etages.length * 25);

      const precision = rapportCible ? Math.max(0, 100 - Math.abs((analyse.rapportTotal - rapportCible) / rapportCible * 100) * 10) : 50;

      const colors = [
        'rgba(54, 162, 235, 0.5)',
        'rgba(255, 99, 132, 0.5)',
        'rgba(75, 192, 192, 0.5)',
        'rgba(255, 206, 86, 0.5)',
        'rgba(153, 102, 255, 0.5)'
      ];

      return {
        label: `Solution ${i + 1}`,
        data: [rendement, compacite, rapportConduite, securite, precision],
        backgroundColor: colors[i],
        borderColor: colors[i].replace('0.5', '1'),
        borderWidth: 2,
        pointRadius: 3
      };
    });

    var config = {
      type: 'radar',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'Comparaison multicritères des solutions' }
        },
        scales: {
          r: { min: 0, max: 100, ticks: { stepSize: 20 } }
        }
      }
    };

    this._updateOrCreate(canvasId, config);
  }

  /**
   * Graphique de cascade couple/vitesse à travers les étages.
   */
  drawTorqueSpeedCascade(canvasId, analyse) {
    const labels = ['Entrée', ...analyse.etages.map((_, i) => `Étage ${i + 1}`)];
    const vitesses = [analyse.vitesseEntree, ...analyse.etages.map(e => e.vitesseSortie)];
    const couples = [analyse.coupleEntree, ...analyse.etages.map(e => e.coupleSortie)];
    const rendements = [100, ...analyse.etages.map((e, i) => {
      let r = 1;
      for (let j = 0; j <= i; j++) r *= analyse.etages[j].rendement;
      return r * 100;
    })];

    var config = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Vitesse (tr/min)',
            data: vitesses,
            borderColor: 'rgba(54, 162, 235, 1)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Couple (N.m)',
            data: couples,
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y1'
          },
          {
            label: 'Rendement cumulé (%)',
            data: rendements,
            borderColor: 'rgba(75, 192, 192, 1)',
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: { display: true, text: 'Évolution couple / vitesse / rendement par étage' }
        },
        scales: {
          y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Vitesse (tr/min)' } },
          y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Couple (N.m)' }, grid: { drawOnChartArea: false } },
          y2: { type: 'linear', display: true, position: 'right', min: 0, max: 100, title: { display: true, text: 'Rendement (%)' }, grid: { drawOnChartArea: false } }
        }
      }
    };

    this._updateOrCreate(canvasId, config);
  }

  /**
   * Graphique en barres horizontales pour la répartition des pertes.
   */
  drawPowerLossBreakdown(canvasId, analyse) {
    const labels = analyse.etages.map((_, i) => `Étage ${i + 1}`);
    const pertes = analyse.etages.map(e => e.pertePuissance);
    const puissancesUtiles = analyse.etages.map(e => e.puissanceSortie);

    var config = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Puissance utile (W)',
            data: puissancesUtiles,
            backgroundColor: 'rgba(75, 192, 192, 0.7)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1
          },
          {
            label: 'Pertes (W)',
            data: pertes,
            backgroundColor: 'rgba(255, 99, 132, 0.7)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        plugins: {
          title: { display: true, text: 'Répartition puissance utile / pertes par étage' }
        },
        scales: {
          x: { stacked: true, title: { display: true, text: 'Puissance (W)' } },
          y: { stacked: true }
        }
      }
    };

    this._updateOrCreate(canvasId, config);
  }

  /**
   * Graphique des facteurs de sécurité par étage (Lewis + Hertz).
   */
  drawSafetyFactors(canvasId, analyse) {
    const labels = analyse.etages.map((_, i) => `Étage ${i + 1}`);
    const lewisMin = analyse.etages.map(e => {
      var a = e.resistanceMenante.facteurSecurite;
      var b = e.resistanceMenee.facteurSecurite;
      if (a === Infinity) a = 10;
      if (b === Infinity) b = 10;
      return Math.min(a, b);
    });
    var hasHertz = analyse.etages.some(function (e) { return e.hertzContact !== null; });
    var hertzFactors = analyse.etages.map(function (e) {
      return e.hertzContact ? e.hertzContact.facteurSecuriteContact : null;
    });

    var datasets = [
      {
        label: 'Sécurité Lewis (flexion)',
        data: lewisMin,
        backgroundColor: 'rgba(54, 162, 235, 0.7)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
      }
    ];
    if (hasHertz) {
      datasets.push({
        label: 'Sécurité Hertz (contact)',
        data: hertzFactors,
        backgroundColor: 'rgba(255, 159, 64, 0.7)',
        borderColor: 'rgba(255, 159, 64, 1)',
        borderWidth: 1
      });
    }

    var config = {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: 'Facteurs de sécurité par étage' }
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Facteur de sécurité' } }
        }
      }
    };

    this._updateOrCreate(canvasId, config);
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
    var power = solution.inputPowerW, losses = solution.mechanical.map(function (stage) { var loss = power * (1 - stage.efficiency); power *= stage.efficiency; return loss; });
    this._updateOrCreate(canvasId, { type: 'bar', data: { labels: losses.map(function (_, i) { return 'Étage ' + (i + 1); }), datasets: [{ label: 'Pertes (W)', data: losses, backgroundColor: '#f59e0b' }] }, options: { responsive: true, plugins: { title: { display: true, text: 'Pertes par étage — total ' + solution.lossPowerW.toFixed(1) + ' W' } }, scales: { y: { beginAtZero: true } } } });
  }

  drawStructuredSafety(canvasId, solution) {
    this._updateOrCreate(canvasId, { type: 'bar', data: { labels: solution.mechanical.map(function (_, i) { return 'Étage ' + (i + 1); }), datasets: [
      { label: 'SF Lewis simplifié', data: solution.mechanical.map(function (m) { return m.bending ? m.bending.safetyFactor : null; }), backgroundColor: '#2563eb' },
      { label: 'SH Hertz simplifié', data: solution.mechanical.map(function (m) { return m.contact ? m.contact.safetyFactor : null; }), backgroundColor: '#f97316' }
    ] }, options: { responsive: true, plugins: { title: { display: true, text: 'Facteurs de sécurité — Engineering estimate' } }, scales: { y: { beginAtZero: true } } } });
  }

  drawStructuredScore(canvasId, solution) {
    var metrics = solution.score.metrics, keys = Object.keys(metrics);
    this._updateOrCreate(canvasId, { type: 'radar', data: { labels: keys, datasets: [{ label: 'Pénalités normalisées', data: keys.map(function (key) { return metrics[key]; }), backgroundColor: 'rgba(37,99,235,.2)', borderColor: '#2563eb' }] }, options: { responsive: true, scales: { r: { min: 0, max: 1 } }, plugins: { title: { display: true, text: 'Détail du score multicritère' } } } });
  }

  /**
   * Détruit tous les graphiques.
   */
  destroyAll() {
    Object.keys(this.charts).forEach(id => this._destroyChart(id));
  }
}

window.GearCharts = new GearCharts();
