/**
 * @module SearchParams
 * @description Objet valeur (Value Object) encapsulant tous les paramètres de recherche
 *   de combinaisons d'engrenages. Fournit des méthodes pour :
 *   - Construire les paramètres depuis le formulaire DOM ({@link SearchParams.fromForm})
 *   - Valider la cohérence des paramètres ({@link SearchParams#validate})
 *   - Convertir en format plat pour le Web Worker ({@link SearchParams#toWorkerParams})
 *   - Sauvegarder/restaurer dans localStorage ({@link SearchParams#save}, {@link SearchParams.restore})
 *
 * @see GearApp.models.SearchParams  Constructeur exporté
 */

(function (GearApp) {

  // ==================== CONSTRUCTEUR ====================

  /**
   * Crée une instance SearchParams avec des valeurs par défaut raisonnables.
   * Chaque champ correspond à un paramètre du formulaire de recherche.
   *
   * @constructor
   *
   * @property {number}   rapportCible    - Rapport de transmission cible (ex. 12 = réduction 12:1)
   * @property {number}   dentMenanteMin  - Nombre minimum de dents sur la roue menante
   * @property {number}   dentMenanteMax  - Nombre maximum de dents sur la roue menante
   * @property {number}   dentMeneeMin    - Nombre minimum de dents sur la roue menée
   * @property {number}   dentMeneeMax    - Nombre maximum de dents sur la roue menée
   * @property {number}   precision       - Tolérance sur le rapport (ex. 0.1 = ±10 %)
   * @property {number}   maxEtages       - Nombre maximal d'étages de réduction
   * @property {number}   maxSolutions    - Nombre maximal de solutions à retourner
   * @property {number}   maxIterations   - Limite d'itérations pour éviter les boucles infinies
   * @property {?number}  dentMenanteFixe - Si défini, impose un nombre fixe de dents menante
   * @property {?number}  dentMeneeFixe   - Si défini, impose un nombre fixe de dents menée
   * @property {boolean}  reductionOnly   - Si true, ne cherche que des réductions (rapport > 1)
   * @property {string[]} typesActifs     - Liste des identifiants de types de transmission activés
   * @property {?number}  module          - Module métrique (mm), null = non spécifié
   * @property {number}   vitesseEntree   - Vitesse de rotation en entrée (tr/min)
   * @property {number}   coupleEntree    - Couple en entrée (N·m)
   */
  function SearchParams() {
    this.rapportCible = 12;
    this.dentMenanteMin = 10;
    this.dentMenanteMax = 30;
    this.dentMeneeMin = 20;
    this.dentMeneeMax = 50;
    this.precision = 0.1;
    this.maxEtages = 4;
    this.maxSolutions = 10;
    this.maxIterations = 500000;
    this.dentMenanteFixe = null;
    this.dentMeneeFixe = null;
    this.reductionOnly = true;
    this.typesActifs = ['spur'];
    this.module = null;
    this.vitesseEntree = 1500;
    this.coupleEntree = 10;
  }

  // ==================== MÉTHODE STATIQUE : CONSTRUCTION DEPUIS LE DOM ====================

  /**
   * Construit une instance SearchParams en lisant les valeurs actuelles
   * du formulaire DOM. Chaque champ est extrait de son élément HTML correspondant.
   *
   * Logique de lecture :
   *   - Champs numériques : parseFloat/parseInt sur les éléments input
   *   - Sliders noUiSlider : lecture via innerText des labels min/max
   *   - Dents fixes : null si le champ est vide (pas de contrainte fixe)
   *   - Types actifs : collecte des checkboxes cochées (.type-checkbox:checked)
   *   - Réduction only : état de la checkbox #reduction_only
   *   - Module, vitesse, couple : valeur ou défaut si le champ est vide
   *
   * @static
   * @returns {SearchParams} Nouvelle instance initialisée depuis le formulaire
   */
  SearchParams.fromForm = function () {
    var p = new SearchParams();

    // ===== Champs numériques principaux =====
    p.rapportCible = parseFloat(document.getElementById("rapport").value);
    p.dentMenanteMin = parseInt(document.getElementById("val_menante_min").innerText);
    p.dentMenanteMax = parseInt(document.getElementById("val_menante_max").innerText);
    p.dentMeneeMin = parseInt(document.getElementById("val_menee_min").innerText);
    p.dentMeneeMax = parseInt(document.getElementById("val_menee_max").innerText);
    p.precision = parseFloat(document.getElementById("precision").value);
    p.maxEtages = parseInt(document.getElementById("etages").value);
    p.maxSolutions = parseInt(document.getElementById("max_solutions").value);
    p.maxIterations = parseInt(document.getElementById("max_iterations").value);

    // ===== Dents fixes (optionnelles) =====
    // Si le champ est vide, on laisse null (pas de contrainte fixe)
    var fixeA = document.getElementById("dent_menante_fixe").value;
    var fixeB = document.getElementById("dent_menee_fixe").value;
    p.dentMenanteFixe = fixeA.trim() !== "" ? parseInt(fixeA, 10) : null;
    p.dentMeneeFixe = fixeB.trim() !== "" ? parseInt(fixeB, 10) : null;

    // ===== Réduction uniquement =====
    var reductionEl = document.getElementById("reduction_only");
    p.reductionOnly = reductionEl ? reductionEl.checked : true;

    // ===== Types de transmission actifs =====
    // Collecte de tous les checkboxes cochés ; repli sur 'spur' si aucun n'est coché
    p.typesActifs = [];
    document.querySelectorAll('.type-checkbox:checked').forEach(function (cb) {
      p.typesActifs.push(cb.value);
    });
    if (p.typesActifs.length === 0) p.typesActifs.push('spur');

    // ===== Module métrique (optionnel) =====
    var modEl = document.getElementById("module");
    p.module = (modEl && modEl.value.trim() !== "") ? parseFloat(modEl.value) : null;

    // ===== Vitesse d'entrée (défaut 1500 tr/min) =====
    var vitEl = document.getElementById("vitesse_entree");
    p.vitesseEntree = (vitEl && vitEl.value.trim() !== "") ? parseFloat(vitEl.value) : 1500;

    // ===== Couple d'entrée (défaut 10 N·m) =====
    var cplEl = document.getElementById("couple_entree");
    p.coupleEntree = (cplEl && cplEl.value.trim() !== "") ? parseFloat(cplEl.value) : 10;

    return p;
  };

  // ==================== VALIDATION ====================

  /**
   * Valide la cohérence des paramètres de recherche.
   * Vérifie dans l'ordre :
   *   1. Le rapport cible est un nombre positif valide
   *   2. Les intervalles de dents sont cohérents (min <= max)
   *   3. Le nombre d'étages est au moins 1
   *
   * @returns {{ valid: boolean, message?: string }}
   *   - { valid: true } si tout est correct
   *   - { valid: false, message: "..." } avec un message d'erreur en français sinon
   */
  SearchParams.prototype.validate = function () {
    if (isNaN(this.rapportCible) || this.rapportCible <= 0) {
      return { valid: false, message: "Erreur : rapport cible invalide" };
    }
    if (this.dentMenanteMin > this.dentMenanteMax || this.dentMeneeMin > this.dentMeneeMax) {
      return { valid: false, message: "Erreur : intervalles de dents invalides" };
    }
    if (isNaN(this.maxEtages) || this.maxEtages < 1) {
      return { valid: false, message: "Erreur : nombre d'étages invalide" };
    }
    return { valid: true };
  };

  // ==================== CONVERSION POUR LE WEB WORKER ====================

  /**
   * Convertit les paramètres en un objet plat (plain object) sérialisable,
   * prêt à être envoyé au Web Worker via postMessage().
   *
   * Note : les noms de propriétés sont adaptés au format attendu par le Worker
   * (ex. 'precisionToleree' au lieu de 'precision', 'allowReductionOnly' au lieu de 'reductionOnly').
   *
   * @returns {Object} Objet plat contenant tous les paramètres de recherche
   * @returns {number} return.dentMenanteMin
   * @returns {number} return.dentMenanteMax
   * @returns {number} return.dentMeneeMin
   * @returns {number} return.dentMeneeMax
   * @returns {number} return.rapportCible
   * @returns {number} return.maxEtages
   * @returns {number} return.precisionToleree - Tolérance sur le rapport
   * @returns {number} return.maxSolutions
   * @returns {number} return.maxIterations
   * @returns {?number} return.dentMenanteFixe
   * @returns {?number} return.dentMeneeFixe
   * @returns {boolean} return.allowReductionOnly
   * @returns {string[]} return.typesActifs
   */
  SearchParams.prototype.toWorkerParams = function () {
    return {
      dentMenanteMin: this.dentMenanteMin,
      dentMenanteMax: this.dentMenanteMax,
      dentMeneeMin: this.dentMeneeMin,
      dentMeneeMax: this.dentMeneeMax,
      rapportCible: this.rapportCible,
      maxEtages: this.maxEtages,
      precisionToleree: this.precision,
      maxSolutions: this.maxSolutions,
      maxIterations: this.maxIterations,
      dentMenanteFixe: this.dentMenanteFixe,
      dentMeneeFixe: this.dentMeneeFixe,
      allowReductionOnly: this.reductionOnly,
      typesActifs: this.typesActifs
    };
  };

  // ==================== SAUVEGARDE DANS LOCALSTORAGE ====================

  /**
   * Sauvegarde l'état complet du formulaire dans localStorage sous la clé 'gearCalcParams'.
   * Capture non seulement les champs input simples, mais aussi :
   *   - Les positions des sliders noUiSlider (dents menante et menée)
   *   - Les types de transmission cochés
   *   - L'état de la checkbox "réduction uniquement"
   *
   * Les données sont sérialisées en JSON. La restauration se fait via
   * {@link SearchParams.restore}.
   *
   * @see SearchParams.restore
   */
  SearchParams.prototype.save = function () {
    // ===== Collecte des champs input simples =====
    var data = {
      rapport: document.getElementById("rapport").value,
      precision: document.getElementById("precision").value,
      etages: document.getElementById("etages").value,
      max_solutions: document.getElementById("max_solutions").value,
      max_iterations: document.getElementById("max_iterations").value,
      dent_menante_fixe: document.getElementById("dent_menante_fixe").value,
      dent_menee_fixe: document.getElementById("dent_menee_fixe").value,
      module: document.getElementById("module").value,
      vitesse_entree: document.getElementById("vitesse_entree") ? document.getElementById("vitesse_entree").value : "",
      couple_entree: document.getElementById("couple_entree") ? document.getElementById("couple_entree").value : ""
    };

    // ===== Sliders noUiSlider =====
    // Les sliders stockent un tableau [min, max] via leur API .get()
    var sliderMenante = document.getElementById('dent_menante_slider');
    if (sliderMenante && sliderMenante.noUiSlider) {
      data.sliderMenante = sliderMenante.noUiSlider.get();
    }
    var sliderMenee = document.getElementById('dent_menee_slider');
    if (sliderMenee && sliderMenee.noUiSlider) {
      data.sliderMenee = sliderMenee.noUiSlider.get();
    }

    // ===== Types de transmission cochés =====
    var types = [];
    document.querySelectorAll('.type-checkbox:checked').forEach(function (cb) {
      types.push(cb.value);
    });
    data.typesActifs = types;

    // ===== Réduction uniquement =====
    var reductionEl = document.getElementById("reduction_only");
    if (reductionEl) data.reductionOnly = reductionEl.checked;

    // Sérialisation JSON et stockage sous la clé 'gearCalcParams'
    localStorage.setItem("gearCalcParams", JSON.stringify(data));
  };

  // ==================== RESTAURATION DEPUIS LOCALSTORAGE ====================

  /**
   * Liste des identifiants des champs input simples (texte/nombre) à
   * sauvegarder et restaurer automatiquement. Chaque entrée correspond
   * à un id d'élément DOM et à une clé dans l'objet JSON sauvegardé.
   *
   * @type {string[]}
   * @private
   */
  var SIMPLE_FIELDS = [
    'rapport', 'precision', 'etages', 'max_solutions', 'max_iterations',
    'dent_menante_fixe', 'dent_menee_fixe', 'module', 'vitesse_entree', 'couple_entree'
  ];

  /**
   * Restaure les paramètres depuis localStorage (clé 'gearCalcParams') et
   * les applique au formulaire DOM. Méthode statique appelée au chargement
   * de la page pour retrouver la dernière configuration utilisée.
   *
   * Logique de restauration (dans l'ordre) :
   *   1. Champs input simples : itération sur SIMPLE_FIELDS, application de la valeur
   *      si l'élément existe et la donnée sauvegardée n'est pas vide
   *   2. Sliders noUiSlider : repositionnement via l'API .set() (dents menante et menée)
   *   3. Types de transmission : coche/décoche des checkboxes selon le tableau sauvegardé
   *   4. Réduction uniquement : restauration de l'état de la checkbox
   *
   * En cas d'erreur de parsing JSON ou de données corrompues, l'erreur est
   * capturée et loguée dans la console sans bloquer l'application.
   *
   * @static
   * @see SearchParams#save
   */
  SearchParams.restore = function () {
    var saved = localStorage.getItem("gearCalcParams");
    // Sortie anticipée si aucune donnée n'est sauvegardée
    if (!saved) return;
    try {
      var data = JSON.parse(saved);
      // Vérification de base : l'objet parsé doit être un objet non-null
      if (!data || typeof data !== 'object') return;

      // ===== Champs input simples =====
      // Parcours de SIMPLE_FIELDS pour restaurer chaque champ s'il existe dans le DOM
      // et si une valeur non-vide a été sauvegardée
      SIMPLE_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && data[id] !== undefined && data[id] !== '') el.value = data[id];
      });

      // ===== Sliders noUiSlider =====
      // Restauration des positions des sliders (tableau [min, max])
      if (data.sliderMenante) {
        var sliderMenante = document.getElementById('dent_menante_slider');
        if (sliderMenante && sliderMenante.noUiSlider) {
          sliderMenante.noUiSlider.set(data.sliderMenante);
        }
      }
      if (data.sliderMenee) {
        var sliderMenee = document.getElementById('dent_menee_slider');
        if (sliderMenee && sliderMenee.noUiSlider) {
          sliderMenee.noUiSlider.set(data.sliderMenee);
        }
      }

      // ===== Types de transmission cochés =====
      // On coche uniquement les types présents dans le tableau sauvegardé
      if (data.typesActifs && Array.isArray(data.typesActifs)) {
        document.querySelectorAll('.type-checkbox').forEach(function (cb) {
          cb.checked = data.typesActifs.indexOf(cb.value) !== -1;
        });
      }

      // ===== Réduction uniquement =====
      if (data.reductionOnly !== undefined) {
        var reductionEl = document.getElementById("reduction_only");
        if (reductionEl) reductionEl.checked = data.reductionOnly;
      }
    } catch (e) {
      // En cas de JSON corrompu ou d'erreur inattendue, on logue et on continue
      console.error("Erreur restauration paramètres:", e);
    }
  };

  // ==================== EXPORT ====================

  /** Expose le constructeur SearchParams dans le namespace GearApp.models */
  GearApp.models.SearchParams = SearchParams;

})(GearApp);
