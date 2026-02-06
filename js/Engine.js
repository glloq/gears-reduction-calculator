// Engine.js - Moteur de recherche d'engrenages avec support Web Worker

class Engine {
  static worker = null;
  static isRunning = false;

  /**
   * Lance la recherche via Web Worker (non bloquant) ou en fallback synchrone.
   */
  static async rechercherEngrenages(
    dentMenanteMin, dentMenanteMax,
    dentMeneeMin, dentMeneeMax,
    rapportCible, maxEtages, precisionToleree,
    maxSolutions, maxIterations,
    dentMenanteFixe, dentMeneeFixe,
    allowReductionOnly,
    typesActifs
  ) {
    // Tenter d'utiliser un Web Worker
    if (window.Worker) {
      return this._rechercherAvecWorker({
        dentMenanteMin, dentMenanteMax,
        dentMeneeMin, dentMeneeMax,
        rapportCible, maxEtages, precisionToleree,
        maxSolutions, maxIterations,
        dentMenanteFixe, dentMeneeFixe,
        allowReductionOnly: allowReductionOnly !== false,
        typesActifs: typesActifs || ['spur']
      });
    }

    // Fallback : recherche sur le thread principal
    return this._rechercherFallback(
      dentMenanteMin, dentMenanteMax,
      dentMeneeMin, dentMeneeMax,
      rapportCible, maxEtages, precisionToleree,
      maxSolutions, maxIterations,
      dentMenanteFixe, dentMeneeFixe,
      allowReductionOnly
    );
  }

  /**
   * Recherche via Web Worker.
   */
  static _rechercherAvecWorker(params) {
    return new Promise((resolve, reject) => {
      // Terminer le worker précédent si existant
      if (this.worker) {
        this.worker.terminate();
      }

      this.worker = new Worker('js/worker.js');
      this.isRunning = true;

      this.worker.onmessage = (e) => {
        const data = e.data;

        switch (data.type) {
          case 'progress':
            UI.ajouterLog(
              `Itération: ${data.iterations}/${data.maxIterations}, profondeur: ${data.profondeur}, rapport: ${data.rapportActuel.toFixed(3)}, solutions: ${data.solutionsCount}`
            );
            // Mise à jour de la barre de progression
            const progress = Math.min(95, (data.iterations / data.maxIterations) * 100);
            const progressBar = document.getElementById("progress-bar");
            if (progressBar) progressBar.style.width = `${progress}%`;
            break;

          case 'solution_found':
            UI.ajouterLog(
              `Solution: [${data.solution.map(p => `[${p[0]},${p[1]}]`).join(' ')}] rapport: ${data.rapport.toFixed(3)} (écart: ${data.ecart.toFixed(2)}%)`
            );
            break;

          case 'log':
            UI.ajouterLog(data.message);
            break;

          case 'done':
            UI.ajouterLog(`Terminé. ${data.totalIterations} itérations, ${data.totalSolutions} solutions trouvées.`);
            this.isRunning = false;
            this.worker.terminate();
            this.worker = null;
            resolve(data.solutions);
            break;
        }
      };

      this.worker.onerror = (err) => {
        UI.ajouterLog(`Erreur Worker: ${err.message}`);
        this.isRunning = false;
        this.worker.terminate();
        this.worker = null;
        reject(err);
      };

      this.worker.postMessage(params);
    });
  }

  /**
   * Arrête la recherche en cours.
   */
  static arreterRecherche() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isRunning = false;
      UI.ajouterLog("Recherche interrompue par l'utilisateur.");
    }
  }

  /**
   * Fallback : recherche sur le thread principal (même algorithme qu'avant).
   */
  static async _rechercherFallback(
    dentMenanteMin, dentMenanteMax,
    dentMeneeMin, dentMeneeMax,
    rapportCible, maxEtages, precisionToleree,
    maxSolutions, maxIterations,
    dentMenanteFixe, dentMeneeFixe,
    allowReductionOnly
  ) {
    let solutions = [];
    let compteurIterations = 0;
    const LOG_FREQUENCY = 10000;

    async function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
      if (compteurIterations > maxIterations) return;
      compteurIterations++;

      if (compteurIterations % LOG_FREQUENCY === 0) {
        UI.ajouterLog(
          `Itération: ${compteurIterations}, profondeur: ${profondeur}, rapportActuel: ${rapportActuel.toFixed(3)}`
        );
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (profondeur === etageLimite) {
        const ecartPourcentage = Math.abs((rapportActuel - rapportCible) / rapportCible) * 100;
        if (ecartPourcentage <= precisionToleree) {
          solutions.push(chaine);
        }
        return;
      }

      let A_start = dentMenanteMin;
      let A_end = dentMenanteMax;
      if (profondeur === 0 && dentMenanteFixe != null) {
        A_start = dentMenanteFixe;
        A_end = dentMenanteFixe;
      }

      for (let A = A_start; A <= A_end; A++) {
        for (let B = dentMeneeMin; B <= dentMeneeMax; B++) {
          if (allowReductionOnly !== false && B <= A) continue;
          if (allowReductionOnly === false && B === A) continue;

          if (profondeur === etageLimite - 1 && dentMeneeFixe != null) {
            B = dentMeneeFixe;
          }
          const rapport = B / A;
          const nouveauRapport = rapportActuel * rapport;
          if (allowReductionOnly !== false && nouveauRapport > rapportCible * (1 + precisionToleree / 100)) continue;

          let nouvelleChaine = [...chaine, [A, B]];
          await rechercher(nouvelleChaine, profondeur + 1, nouveauRapport, etageLimite);
          if (profondeur === etageLimite - 1 && dentMeneeFixe != null) break;
        }
      }
    }

    for (let etageLimite = 1; etageLimite <= maxEtages; etageLimite++) {
      solutions = [];
      UI.ajouterLog(`Démarrage de la recherche pour ${etageLimite} étage(s)...`);
      await rechercher([], 0, 1, etageLimite);
      if (solutions.length > 0) {
        UI.ajouterLog(`Solutions trouvées avec ${etageLimite} étage(s).`);
        break;
      } else {
        UI.ajouterLog(`Aucune solution trouvée pour ${etageLimite} étage(s).`);
      }
    }

    UI.ajouterLog(`Total d'itérations: ${compteurIterations}.`);

    solutions.sort((a, b) => {
      let rapportA = a.reduce((acc, [m, n]) => acc * (n / m), 1);
      let rapportB = b.reduce((acc, [m, n]) => acc * (n / m), 1);
      return Math.abs(rapportA - rapportCible) - Math.abs(rapportB - rapportCible);
    });

    return solutions.slice(0, maxSolutions);
  }
}
