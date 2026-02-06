// Charts.js - Module de graphiques de comparaison et d'analyse
// Utilise Chart.js pour afficher les données mécaniques sous forme visuelle

class GearCharts {
  constructor() {
    this.charts = {};
  }

  /**
   * Détruit un graphique existant avant d'en créer un nouveau.
   */
  _destroyChart(chartId) {
    if (this.charts[chartId]) {
      this.charts[chartId].destroy();
      delete this.charts[chartId];
    }
  }

  /**
   * Graphique de comparaison des rapports obtenus vs cible.
   * @param {string} canvasId - ID du canvas
   * @param {Array} solutions - Tableau de solutions
   * @param {number} rapportCible - Rapport cible
   */
  drawRatioComparison(canvasId, solutions, rapportCible) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = solutions.map((_, i) => `Solution ${i + 1}`);
    const rapports = solutions.map(sol => sol.reduce((acc, stage) => {
      const A = stage[0], B = stage[1], typeId = stage[2] || 'spur';
      if (typeof calculerRapportEtage === 'function') {
        return acc * calculerRapportEtage(typeId, A, B);
      }
      return acc * (B / A);
    }, 1));
    const ecarts = rapports.map(r => Math.abs((r - rapportCible) / rapportCible * 100));

    this.charts[canvasId] = new Chart(ctx, {
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
          title: { display: true, text: 'Comparaison des rapports de réduction' },
          annotation: {
            annotations: {
              targetLine: {
                type: 'line',
                yMin: rapportCible,
                yMax: rapportCible,
                borderColor: 'rgba(0, 200, 0, 0.8)',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                  content: `Cible: ${rapportCible}`,
                  enabled: true,
                  position: 'end'
                }
              }
            }
          }
        },
        scales: {
          y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Rapport' } },
          y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Écart (%)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  /**
   * Graphique radar comparant les propriétés mécaniques des solutions.
   */
  drawMechanicalRadar(canvasId, analysesArray) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = ['Rendement', 'Compacité', 'Rapport conduite', 'Sécurité dent', 'Précision ratio'];

    const datasets = analysesArray.slice(0, 5).map((analyse, i) => {
      const rendement = analyse.rendementTotal * 100;
      const compacite = Math.max(0, 100 - analyse.nombreEtages * 20); // Moins d'étages = plus compact
      const rapportConduite = Math.min(100, analyse.etages.reduce((sum, e) => sum + e.rapportConduite, 0) / analyse.etages.length * 50);
      const securite = Math.min(100, analyse.etages.reduce((sum, e) => {
        return sum + Math.min(e.resistanceMenante.facteurSecurite, e.resistanceMenee.facteurSecurite);
      }, 0) / analyse.etages.length * 25);
      const precision = Math.max(0, 100 - Math.abs((analyse.rapportTotal - analyse.rapportTotal) / analyse.rapportTotal * 100) * 10);

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

    this.charts[canvasId] = new Chart(ctx, {
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
    });
  }

  /**
   * Graphique de cascade couple/vitesse à travers les étages.
   */
  drawTorqueSpeedCascade(canvasId, analyse) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = ['Entrée', ...analyse.etages.map((_, i) => `Étage ${i + 1}`)];
    const vitesses = [analyse.vitesseEntree, ...analyse.etages.map(e => e.vitesseSortie)];
    const couples = [analyse.coupleEntree, ...analyse.etages.map(e => e.coupleSortie)];
    const rendements = [100, ...analyse.etages.map((e, i) => {
      let r = 1;
      for (let j = 0; j <= i; j++) r *= analyse.etages[j].rendement;
      return r * 100;
    })];

    this.charts[canvasId] = new Chart(ctx, {
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
    });
  }

  /**
   * Graphique en barres horizontales pour la répartition des pertes.
   */
  drawPowerLossBreakdown(canvasId, analyse) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = analyse.etages.map((_, i) => `Étage ${i + 1}`);
    const pertes = analyse.etages.map(e => e.pertePuissance);
    const puissancesUtiles = analyse.etages.map(e => e.puissanceSortie);

    this.charts[canvasId] = new Chart(ctx, {
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
    });
  }

  /**
   * Détruit tous les graphiques.
   */
  destroyAll() {
    Object.keys(this.charts).forEach(id => this._destroyChart(id));
  }
}

window.GearCharts = new GearCharts();
