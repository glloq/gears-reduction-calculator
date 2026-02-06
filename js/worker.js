// worker.js - Web Worker pour le calcul d'engrenages en arrière-plan
// Exécute la recherche hors du thread principal pour ne pas bloquer l'UI

self.onmessage = function (e) {
  const params = e.data;
  const {
    dentMenanteMin, dentMenanteMax,
    dentMeneeMin, dentMeneeMax,
    rapportCible, maxEtages, precisionToleree,
    maxSolutions, maxIterations,
    dentMenanteFixe, dentMeneeFixe,
    allowReductionOnly
  } = params;

  let solutions = [];
  let compteurIterations = 0;
  const LOG_FREQUENCY = 10000;

  function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
    if (compteurIterations > maxIterations) return;
    compteurIterations++;

    if (compteurIterations % LOG_FREQUENCY === 0) {
      self.postMessage({
        type: 'progress',
        iterations: compteurIterations,
        maxIterations: maxIterations,
        profondeur: profondeur,
        rapportActuel: rapportActuel,
        solutionsCount: solutions.length
      });
    }

    if (profondeur === etageLimite) {
      const ecartPourcentage = Math.abs((rapportActuel - rapportCible) / rapportCible) * 100;
      if (ecartPourcentage <= precisionToleree) {
        solutions.push({
          chaine: chaine,
          rapport: rapportActuel,
          ecart: ecartPourcentage
        });
        self.postMessage({
          type: 'solution_found',
          solution: chaine,
          rapport: rapportActuel,
          ecart: ecartPourcentage,
          solutionsCount: solutions.length
        });
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
      if (compteurIterations > maxIterations) return;
      for (let B = dentMeneeMin; B <= dentMeneeMax; B++) {
        if (compteurIterations > maxIterations) return;

        // En mode réduction uniquement, B > A est requis
        if (allowReductionOnly && B <= A) continue;
        // En mode libre, on ignore A === B (rapport 1:1 inutile)
        if (!allowReductionOnly && B === A) continue;

        if (profondeur === etageLimite - 1 && dentMeneeFixe != null) {
          B = dentMeneeFixe;
        }

        const rapport = B / A;
        const nouveauRapport = rapportActuel * rapport;

        // Élagage intelligent : si le rapport dépasse la cible au-delà de la tolérance
        if (allowReductionOnly && nouveauRapport > rapportCible * (1 + precisionToleree / 100)) continue;

        let nouvelleChaine = [...chaine, [A, B]];
        rechercher(nouvelleChaine, profondeur + 1, nouveauRapport, etageLimite);

        if (profondeur === etageLimite - 1 && dentMeneeFixe != null) break;
      }
    }
  }

  // Recherche progressive par nombre d'étages
  for (let etageLimite = 1; etageLimite <= maxEtages; etageLimite++) {
    solutions = [];
    self.postMessage({
      type: 'log',
      message: `Démarrage de la recherche pour ${etageLimite} étage(s)...`
    });

    rechercher([], 0, 1, etageLimite);

    if (solutions.length > 0) {
      self.postMessage({
        type: 'log',
        message: `${solutions.length} solution(s) trouvée(s) avec ${etageLimite} étage(s). Arrêt de la recherche.`
      });
      break;
    } else {
      self.postMessage({
        type: 'log',
        message: `Aucune solution trouvée pour ${etageLimite} étage(s).`
      });
    }
  }

  // Tri par proximité du rapport cible
  solutions.sort((a, b) => Math.abs(a.rapport - rapportCible) - Math.abs(b.rapport - rapportCible));

  self.postMessage({
    type: 'done',
    solutions: solutions.slice(0, maxSolutions).map(s => s.chaine),
    totalIterations: compteurIterations,
    totalSolutions: solutions.length
  });
};
