/**
 * @module GearCharts
 * @description Module de graphiques de comparaison et d'analyse mécanique.
 *
 * Utilise Chart.js pour afficher les données mécaniques sous forme visuelle.
 * Fournit 4 types de graphiques :
 *   - Comparaison des rapports de réduction (barres + ligne d'écart)
 *   - Radar multicritères (rendement, compacité, conduite, sécurité, précision)
 *   - Cascade couple/vitesse/rendement par étage (lignes multi-axes)
 *   - Répartition puissance utile / pertes par étage (barres horizontales empilées)
 *
 * Chaque graphique est identifié par l'ID de son canvas. Avant de créer
 * un nouveau graphique, l'ancien est automatiquement détruit pour éviter
 * les fuites mémoire et les conflits Chart.js.
 *
 * @see {@link GearApp.visualization.GearCharts} pour le proxy dans le namespace
 */

// ===== Classe principale =====

/**
 * @class GearCharts
 * @classdesc Gestionnaire de graphiques Chart.js pour l'analyse des trains d'engrenages.
 *
 * Encapsule la création, la mise à jour et la destruction de graphiques Chart.js.
 * Maintient un dictionnaire interne de graphiques actifs indexés par l'ID du canvas.
 */
class GearCharts {

  // ===== Construction =====

  /**
   * Crée une nouvelle instance de GearCharts.
   * Initialise le dictionnaire de graphiques actifs.
   */
  constructor() {
    /**
     * @type {Object<string, Chart>}
     * Dictionnaire des instances Chart.js actives, indexées par l'ID du canvas.
     * Permet de retrouver et détruire un graphique avant d'en créer un nouveau.
     */
    this.charts = {};
  }

  // ===== Gestion du cycle de vie des graphiques =====

  /**
   * Détruit un graphique existant avant d'en créer un nouveau.
   * Libère les ressources mémoire de l'instance Chart.js et retire
   * l'entrée du dictionnaire.
   *
   * @private
   * @param {string} chartId - L'identifiant du canvas du graphique à détruire
   */
  _destroyChart(chartId) {
    if (this.charts[chartId]) {
      this.charts[chartId].destroy();
      delete this.charts[chartId];
    }
  }

  // ===== Graphique 1 : Comparaison des rapports =====

  /**
   * Graphique de comparaison des rapports obtenus vs rapport cible.
   *
   * Affiche un graphique mixte barres + ligne :
   *   - Barres bleues : rapport de réduction obtenu pour chaque solution
   *   - Ligne rouge (axe droit) : écart en pourcentage par rapport à la cible
   *   - Ligne horizontale verte en pointillé : valeur du rapport cible
   *
   * Transformation des données :
   *   1. Pour chaque solution, calcule le rapport total en multipliant les rapports
   *      de chaque étage (utilise calculerRapportEtage si disponible, sinon B/A)
   *   2. Calcule l'écart relatif : |rapport - cible| / cible * 100
   *
   * @param {string} canvasId - L'identifiant du canvas HTML pour le graphique
   * @param {Array<Array<Array<number|string>>>} solutions - Tableau de solutions,
   *   chaque solution étant un tableau d'étages au format [A, B, typeId?]
   * @param {number} rapportCible - Le rapport de réduction visé
   */
  drawRatioComparison(canvasId, solutions, rapportCible) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Labels : "Solution 1", "Solution 2", etc.
    const labels = solutions.map((_, i) => `Solution ${i + 1}`);

    // Calcul du rapport total de chaque solution
    // Pour chaque étage, le rapport dépend du type de transmission
    // (utilise calculerRapportEtage du registre si disponible, sinon B/A par défaut)
    const rapports = solutions.map(sol => sol.reduce((acc, stage) => {
      const A = stage[0], B = stage[1], typeId = stage[2] || 'spur';
      if (typeof calculerRapportEtage === 'function') {
        return acc * calculerRapportEtage(typeId, A, B);
      }
      return acc * (B / A);
    }, 1));

    // Calcul de l'écart relatif en pourcentage par rapport au rapport cible
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

  // ===== Graphique 2 : Radar multicritères =====

  /**
   * Graphique radar comparant les propriétés mécaniques de plusieurs solutions.
   *
   * Affiche un diagramme radar (toile d'araignée) avec 5 axes :
   *   - Rendement : rendement total de la transmission (en %)
   *   - Compacité : inversement proportionnel au nombre d'étages (100 - nbEtages * 20)
   *   - Rapport de conduite : moyenne des rapports de conduite de chaque étage (normalisé)
   *   - Sécurité dent : moyenne des facteurs de sécurité minimaux par étage (normalisé)
   *   - Précision ratio : proximité du rapport obtenu par rapport à la cible (normalisé)
   *
   * Chaque solution est représentée par un polygone coloré semi-transparent.
   * Maximum 5 solutions affichées simultanément.
   *
   * @param {string} canvasId - L'identifiant du canvas HTML pour le graphique
   * @param {Array<Object>} analysesArray - Tableau d'analyses mécaniques (objets retournés par GearMechanics)
   * @param {number} rapportCible - Le rapport de réduction visé (pour le calcul de la précision)
   */
  drawMechanicalRadar(canvasId, analysesArray, rapportCible) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Les 5 axes du radar
    const labels = ['Rendement', 'Compacité', 'Rapport conduite', 'Sécurité dent', 'Précision ratio'];

    // Transformation des données d'analyse en scores 0-100 pour chaque axe
    // Limité aux 5 premières solutions pour la lisibilité
    const datasets = analysesArray.slice(0, 5).map((analyse, i) => {
      // Rendement total converti directement en pourcentage
      const rendement = analyse.rendementTotal * 100;
      // Compacité : bonus pour les solutions avec peu d'étages (max 100 pour 0 étage, min 0 pour 5+)
      const compacite = Math.max(0, 100 - analyse.nombreEtages * 20);
      // Rapport de conduite : moyenne normalisée (un rapport de conduite de 2 donne 100)
      const rapportConduite = Math.min(100, analyse.etages.reduce((sum, e) => sum + e.rapportConduite, 0) / analyse.etages.length * 50);
      // Sécurité de la dent : moyenne des facteurs de sécurité minimaux (menant vs mené) normalisée
      // Un facteur de sécurité de 4 donne 100
      const securite = Math.min(100, analyse.etages.reduce((sum, e) => {
        return sum + Math.min(e.resistanceMenante.facteurSecurite, e.resistanceMenee.facteurSecurite);
      }, 0) / analyse.etages.length * 25);
      // Précision du ratio : plus l'écart est faible, plus le score est élevé
      // Un écart de 10% donne un score de 0
      const precision = rapportCible ? Math.max(0, 100 - Math.abs((analyse.rapportTotal - rapportCible) / rapportCible * 100) * 10) : 50;

      // Palette de couleurs semi-transparentes pour les polygones
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

  // ===== Graphique 3 : Cascade couple / vitesse / rendement =====

  /**
   * Graphique de cascade couple / vitesse / rendement à travers les étages.
   *
   * Affiche un graphique à 3 courbes sur des axes Y distincts :
   *   - Vitesse (tr/min) : décroît d'étage en étage (axe Y gauche, bleu)
   *   - Couple (N.m) : croît d'étage en étage (axe Y droit, rouge)
   *   - Rendement cumulé (%) : décroît légèrement à chaque étage (axe Y droit, turquoise pointillé)
   *
   * Transformation des données :
   *   - Les labels sont "Entrée", "Étage 1", "Étage 2", etc.
   *   - La vitesse d'entrée est fournie par l'analyse, puis chaque étage a sa vitesse de sortie
   *   - Le rendement cumulé est calculé en multipliant les rendements successifs
   *
   * @param {string} canvasId - L'identifiant du canvas HTML pour le graphique
   * @param {Object} analyse - L'analyse mécanique complète d'une solution
   */
  drawTorqueSpeedCascade(canvasId, analyse) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Labels : "Entrée" suivi de "Étage N" pour chaque étage
    const labels = ['Entrée', ...analyse.etages.map((_, i) => `Étage ${i + 1}`)];

    // Données de vitesse : entrée puis sortie de chaque étage
    const vitesses = [analyse.vitesseEntree, ...analyse.etages.map(e => e.vitesseSortie)];

    // Données de couple : entrée puis sortie de chaque étage
    const couples = [analyse.coupleEntree, ...analyse.etages.map(e => e.coupleSortie)];

    // Rendement cumulé : 100% à l'entrée, puis multiplié par le rendement de chaque étage
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

  // ===== Graphique 4 : Répartition des pertes =====

  /**
   * Graphique en barres horizontales empilées pour la répartition des pertes de puissance.
   *
   * Affiche pour chaque étage :
   *   - Barre turquoise : puissance utile transmise (W)
   *   - Barre rouge : pertes de puissance (W)
   *
   * Les barres sont empilées horizontalement pour montrer la puissance totale
   * à chaque étage et la proportion de pertes.
   *
   * @param {string} canvasId - L'identifiant du canvas HTML pour le graphique
   * @param {Object} analyse - L'analyse mécanique complète d'une solution
   */
  drawPowerLossBreakdown(canvasId, analyse) {
    this._destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Labels : "Étage 1", "Étage 2", etc.
    const labels = analyse.etages.map((_, i) => `Étage ${i + 1}`);

    // Extraction des pertes et puissances utiles par étage
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

  // ===== Nettoyage =====

  /**
   * Détruit tous les graphiques actifs et libère les ressources mémoire.
   * Appelée lors du nettoyage global de l'interface ou avant un nouveau calcul.
   */
  destroyAll() {
    Object.keys(this.charts).forEach(id => this._destroyChart(id));
  }
}

// Instanciation unique (singleton) et exposition globale
// L'application utilise une seule instance partagée via window.GearCharts
window.GearCharts = new GearCharts();
