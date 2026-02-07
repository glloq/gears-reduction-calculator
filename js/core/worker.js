/**
 * worker.js - Web Worker pour la recherche multi-types de transmission
 *
 * Ce fichier s'exécute dans un contexte Web Worker isolé (pas d'accès au DOM).
 * Il reçoit les paramètres de recherche via postMessage et renvoie les solutions
 * trouvées au thread principal.
 *
 * Communication :
 *   - Réception : self.onmessage(e) avec e.data contenant les paramètres
 *   - Émission :
 *     - { type: 'progress' }       → progression de la recherche
 *     - { type: 'log' }            → message de log textuel
 *     - { type: 'solution_found' } → solution individuelle trouvée
 *     - { type: 'partial_results' }→ lot partiel trié de solutions
 *     - { type: 'done' }           → résultat final complet
 *
 * NOTE : Les contraintes des types sont dupliquées ici car le Worker
 * n'a pas accès à TransmissionTypeRegistry.js (pas de DOM/window).
 * Toute modification des contraintes doit être synchronisée manuellement.
 *
 * @see js/models/TransmissionTypeRegistry.js - source de vérité des types
 * @see js/core/Engine.js - orchestrateur côté thread principal
 */

// =====================================================================
// DÉFINITION LOCALE DES TYPES (miroir de TransmissionTypeRegistry)
// =====================================================================

/**
 * Contraintes et formules de rapport pour chaque type de transmission.
 * Chaque entrée définit :
 *   - minA/maxA, minB/maxB : plages de valeurs pour roue A et B
 *   - maxRatio : rapport maximum par étage
 *   - calcRapport(A, B) : formule de calcul du rapport
 *   - reductionOnly : si true, B doit être > A
 *   - diffMin : différence minimale B-A (optionnel, ex: internal)
 *   - validCombo : fonction de validation supplémentaire (optionnel, ex: epicyclic)
 */
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

// =====================================================================
// RÉCEPTION DES PARAMÈTRES ET LANCEMENT DE LA RECHERCHE
// =====================================================================

/**
 * Handler principal du Worker.
 * Reçoit les paramètres de recherche et lance l'algorithme de recherche
 * par approfondissement itératif (1 étage, puis 2, etc.).
 *
 * @param {MessageEvent} e - Message contenant les paramètres de recherche
 * @param {Object} e.data - Paramètres de recherche (voir SearchParams.toWorkerParams)
 */
self.onmessage = function (e) {
  const params = e.data;
  const {
    dentMenanteMin, dentMenanteMax,
    dentMeneeMin, dentMeneeMax,
    rapportCible, maxEtages, precisionToleree,
    maxSolutions, maxIterations,
    dentMenanteFixe, dentMeneeFixe,
    allowReductionOnly,
    typesActifs
  } = params;

  // Types actifs pour cette recherche (défaut: spur uniquement)
  const activeTypes = (typesActifs && typesActifs.length > 0) ? typesActifs : ['spur'];

  /** @type {Array<{chaine: Array, rapport: number, ecart: number}>} Solutions trouvées */
  let solutions = [];
  /** @type {number} Compteur d'itérations pour la limite et les logs */
  let compteurIterations = 0;
  /** Fréquence d'envoi des messages de progression */
  const LOG_FREQUENCY = 10000;

  // Pré-calcul du ratio max par étage (optimisation : évite un O(n) dans la boucle interne)
  const maxRapportRestantGlobal = Math.max(...activeTypes.map(t => TYPES[t] ? TYPES[t].maxRatio : 1));

  // ===================================================================
  // ALGORITHME DE RECHERCHE RÉCURSIF (Branch & Bound)
  // ===================================================================

  /**
   * Recherche récursive de combinaisons d'engrenages.
   *
   * Algorithme :
   *   - Pour chaque type actif, itère sur les combinaisons (A, B)
   *   - Applique les contraintes de type (réduction, compatibilité, etc.)
   *   - Utilise l'élagage (pruning) pour couper les branches impossibles
   *   - Envoie des résultats partiels au thread principal
   *
   * @param {Array<Array>} chaine - Étages accumulés [[A, B, typeId], ...]
   * @param {number} profondeur - Niveau de récursion actuel (0-based)
   * @param {number} rapportActuel - Rapport cumulé des étages précédents
   * @param {number} etageLimite - Nombre d'étages maximum pour cette passe
   */
  function rechercher(chaine, profondeur, rapportActuel, etageLimite) {
    // Vérifier la limite d'itérations globale
    if (compteurIterations > maxIterations) return;

    // === CAS DE BASE : dernier étage atteint ===
    if (profondeur === etageLimite) {
      const ecartPourcentage = Math.abs((rapportActuel - rapportCible) / rapportCible) * 100;
      if (ecartPourcentage <= precisionToleree) {
        solutions.push({
          chaine: chaine,
          rapport: rapportActuel,
          ecart: ecartPourcentage
        });

        // Envoi de résultats incrémentaux au thread principal
        if (solutions.length % 10 === 1) {
          self.postMessage({
            type: 'solution_found',
            solution: chaine,
            rapport: rapportActuel,
            ecart: ecartPourcentage,
            solutionsCount: solutions.length
          });
        }

        // Envoi de lots triés périodiquement (pour affichage partiel)
        if (solutions.length === 5 || solutions.length % 25 === 0) {
          var sorted = solutions.slice().sort(function (a, b) {
            return Math.abs(a.rapport - rapportCible) - Math.abs(b.rapport - rapportCible);
          });
          self.postMessage({
            type: 'partial_results',
            solutions: sorted.slice(0, maxSolutions).map(function (s) { return s.chaine; }),
            totalSolutions: solutions.length
          });
        }
      }
      return;
    }

    // === CAS RÉCURSIF : explorer les combinaisons possibles ===
    for (const typeId of activeTypes) {
      const typeConf = TYPES[typeId];
      if (!typeConf) continue;

      // Déterminer les plages de A et B (intersection type ∩ paramètres utilisateur)
      let aMin = Math.max(typeConf.minA, dentMenanteMin);
      let aMax = Math.min(typeConf.maxA, dentMenanteMax);
      let bMin = Math.max(typeConf.minB, dentMeneeMin);
      let bMax = Math.min(typeConf.maxB, dentMeneeMax);

      // Si le premier engrenage est fixé par l'utilisateur
      if (profondeur === 0 && dentMenanteFixe != null) {
        if (dentMenanteFixe >= typeConf.minA && dentMenanteFixe <= typeConf.maxA) {
          aMin = dentMenanteFixe;
          aMax = dentMenanteFixe;
        } else {
          continue; // Ce type ne supporte pas la valeur fixe demandée
        }
      }

      for (let A = aMin; A <= aMax; A++) {
        if (compteurIterations > maxIterations) return;

        for (let B = bMin; B <= bMax; B++) {
          if (compteurIterations > maxIterations) return;
          compteurIterations++;

          // Émission périodique de la progression
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

          // --- Contrainte de réduction (B > A) ---
          if (typeConf.reductionOnly && B <= A) continue;
          if (!typeConf.reductionOnly && allowReductionOnly && B <= A) continue;
          if (!typeConf.reductionOnly && !allowReductionOnly && B === A) continue;

          // --- Contraintes spécifiques au type ---
          if (typeConf.diffMin && (B - A) < typeConf.diffMin) continue;
          if (typeConf.validCombo && !typeConf.validCombo(A, B)) continue;

          // --- Dernier engrenage fixé par l'utilisateur ---
          if (profondeur === etageLimite - 1 && dentMeneeFixe != null) {
            if (B !== dentMeneeFixe) continue;
          }

          const rapport = typeConf.calcRapport(A, B);
          const nouveauRapport = rapportActuel * rapport;

          // --- Élagage (pruning) ---
          // Couper si le rapport dépasse déjà largement la cible
          if (nouveauRapport > rapportCible * (1 + precisionToleree / 100) * 1.5) continue;

          // Couper si le rapport est trop petit pour pouvoir atteindre la cible
          // même avec les étages restants au rapport maximal
          const etagesRestants = etageLimite - profondeur - 1;
          if (etagesRestants > 0) {
            if (nouveauRapport * Math.pow(maxRapportRestantGlobal, etagesRestants) < rapportCible * (1 - precisionToleree / 100)) continue;
          }

          // Ajouter cet étage et continuer la récursion
          let nouvelleChaine = [...chaine, [A, B, typeId]];
          rechercher(nouvelleChaine, profondeur + 1, nouveauRapport, etageLimite);
        }
      }
    }
  }

  // ===================================================================
  // RECHERCHE PAR APPROFONDISSEMENT ITÉRATIF
  // ===================================================================

  // Commencer par 1 étage, puis augmenter progressivement.
  // S'arrêter dès qu'on trouve au moins une solution.
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
      break; // Solutions trouvées, pas besoin de chercher avec plus d'étages
    } else {
      self.postMessage({
        type: 'log',
        message: `Aucune solution pour ${etageLimite} étage(s).`
      });
    }
  }

  // ===================================================================
  // ENVOI DES RÉSULTATS FINAUX
  // ===================================================================

  // Tri par proximité au rapport cible (meilleure solution en premier)
  solutions.sort((a, b) => Math.abs(a.rapport - rapportCible) - Math.abs(b.rapport - rapportCible));

  self.postMessage({
    type: 'done',
    solutions: solutions.slice(0, maxSolutions).map(s => s.chaine),
    totalIterations: compteurIterations,
    totalSolutions: solutions.length
  });
};
