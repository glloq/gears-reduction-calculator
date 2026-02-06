// worker.js - Web Worker pour la recherche multi-types de transmission
// Chaque type a ses propres contraintes et formule de rapport

// Définition locale des types (le Worker n'a pas accès au DOM)
const TYPES = {
  spur:      { minA: 6,  maxA: 200, minB: 6,   maxB: 200, maxRatio: 8,   calcRapport: (A, B) => B / A, reductionOnly: false },
  helical:   { minA: 8,  maxA: 200, minB: 8,   maxB: 200, maxRatio: 10,  calcRapport: (A, B) => B / A, reductionOnly: false },
  internal:  { minA: 10, maxA: 80,  minB: 20,  maxB: 300, maxRatio: 12,  calcRapport: (A, B) => B / A, reductionOnly: true, diffMin: 10 },
  bevel:     { minA: 10, maxA: 80,  minB: 10,  maxB: 120, maxRatio: 6,   calcRapport: (A, B) => B / A, reductionOnly: false },
  belt:      { minA: 10, maxA: 200, minB: 10,  maxB: 500, maxRatio: 10,  calcRapport: (A, B) => B / A, reductionOnly: false },
  epicyclic: { minA: 12, maxA: 60,  minB: 30,  maxB: 200, maxRatio: 12,  calcRapport: (A, B) => 1 + B / A, reductionOnly: true,
               validCombo: (A, B) => (A + B) % 3 === 0 && (B - A) > 0 && (B - A) % 2 === 0 },
  worm:      { minA: 1,  maxA: 6,   minB: 15,  maxB: 120, maxRatio: 100, calcRapport: (A, B) => B / A, reductionOnly: true }
};

self.onmessage = function (e) {
  const params = e.data;
  const {
    dentMenanteMin, dentMenanteMax,
    dentMeneeMin, dentMeneeMax,
    rapportCible, maxEtages, precisionToleree,
    maxSolutions, maxIterations,
    dentMenanteFixe, dentMeneeFixe,
    allowReductionOnly,
    typesActifs // ['spur', 'helical', 'worm', ...]
  } = params;

  const activeTypes = (typesActifs && typesActifs.length > 0) ? typesActifs : ['spur'];

  let solutions = [];
  let compteurIterations = 0;
  const LOG_FREQUENCY = 10000;

  function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
    if (compteurIterations > maxIterations) return;

    if (profondeur === etageLimite) {
      const ecartPourcentage = Math.abs((rapportActuel - rapportCible) / rapportCible) * 100;
      if (ecartPourcentage <= precisionToleree) {
        solutions.push({
          chaine: chaine,
          rapport: rapportActuel,
          ecart: ecartPourcentage
        });
        if (solutions.length % 10 === 1) {
          self.postMessage({
            type: 'solution_found',
            solution: chaine,
            rapport: rapportActuel,
            ecart: ecartPourcentage,
            solutionsCount: solutions.length
          });
        }
      }
      return;
    }

    // Itérer sur chaque type actif
    for (const typeId of activeTypes) {
      const typeConf = TYPES[typeId];
      if (!typeConf) continue;

      // Déterminer les plages de A et B
      let aMin = Math.max(typeConf.minA, dentMenanteMin);
      let aMax = Math.min(typeConf.maxA, dentMenanteMax);
      let bMin = Math.max(typeConf.minB, dentMeneeMin);
      let bMax = Math.min(typeConf.maxB, dentMeneeMax);

      // Premier engrenage fixe
      if (profondeur === 0 && dentMenanteFixe != null) {
        if (dentMenanteFixe >= typeConf.minA && dentMenanteFixe <= typeConf.maxA) {
          aMin = dentMenanteFixe;
          aMax = dentMenanteFixe;
        } else {
          continue; // Ce type ne supporte pas la valeur fixe
        }
      }

      for (let A = aMin; A <= aMax; A++) {
        if (compteurIterations > maxIterations) return;

        for (let B = bMin; B <= bMax; B++) {
          if (compteurIterations > maxIterations) return;
          compteurIterations++;

          if (compteurIterations % LOG_FREQUENCY === 0) {
            self.postMessage({
              type: 'progress',
              iterations: compteurIterations,
              maxIterations: maxIterations,
              profondeur: profondeur,
              rapportActuel: rapportActuel,
              solutionsCount: solutions.length,
              typeEnCours: typeId
            });
          }

          // Contrainte de réduction
          if (typeConf.reductionOnly && B <= A) continue;
          if (!typeConf.reductionOnly && allowReductionOnly && B <= A) continue;
          if (!typeConf.reductionOnly && !allowReductionOnly && B === A) continue;

          // Contrainte spécifique au type
          if (typeConf.diffMin && (B - A) < typeConf.diffMin) continue;
          if (typeConf.validCombo && !typeConf.validCombo(A, B)) continue;

          // Dernier engrenage fixe
          if (profondeur === etageLimite - 1 && dentMeneeFixe != null) {
            if (B !== dentMeneeFixe) continue;
          }

          const rapport = typeConf.calcRapport(A, B);
          const nouveauRapport = rapportActuel * rapport;

          // Élagage : si le rapport dépasse déjà largement la cible
          if (nouveauRapport > rapportCible * (1 + precisionToleree / 100) * 1.5) continue;
          // Élagage : si le rapport est trop petit pour pouvoir atteindre la cible
          const etagesRestants = etageLimite - profondeur - 1;
          if (etagesRestants > 0) {
            // Le max rapport par étage restant
            const maxRapportRestant = Math.max(...activeTypes.map(t => TYPES[t] ? TYPES[t].maxRatio : 1));
            if (nouveauRapport * Math.pow(maxRapportRestant, etagesRestants) < rapportCible * (1 - precisionToleree / 100)) continue;
          }

          let nouvelleChaine = [...chaine, [A, B, typeId]];
          rechercher(nouvelleChaine, profondeur + 1, nouveauRapport, etageLimite);
        }
      }
    }
  }

  // Recherche progressive par nombre d'étages
  for (let etageLimite = 1; etageLimite <= maxEtages; etageLimite++) {
    solutions = [];
    self.postMessage({
      type: 'log',
      message: `Recherche pour ${etageLimite} étage(s) avec types: [${activeTypes.join(', ')}]...`
    });

    rechercher([], 0, 1, etageLimite);

    if (solutions.length > 0) {
      self.postMessage({
        type: 'log',
        message: `${solutions.length} solution(s) trouvée(s) avec ${etageLimite} étage(s).`
      });
      break;
    } else {
      self.postMessage({
        type: 'log',
        message: `Aucune solution pour ${etageLimite} étage(s).`
      });
    }
  }

  // Tri par proximité
  solutions.sort((a, b) => Math.abs(a.rapport - rapportCible) - Math.abs(b.rapport - rapportCible));

  self.postMessage({
    type: 'done',
    solutions: solutions.slice(0, maxSolutions).map(s => s.chaine),
    totalIterations: compteurIterations,
    totalSolutions: solutions.length
  });
};
