// SearchParams.js - Objet valeur encapsulant les paramètres de recherche

(function (GearApp) {

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

  /**
   * Construit les paramètres depuis le formulaire DOM.
   */
  SearchParams.fromForm = function () {
    var p = new SearchParams();
    p.rapportCible = parseFloat(document.getElementById("rapport").value);
    p.dentMenanteMin = parseInt(document.getElementById("val_menante_min").innerText);
    p.dentMenanteMax = parseInt(document.getElementById("val_menante_max").innerText);
    p.dentMeneeMin = parseInt(document.getElementById("val_menee_min").innerText);
    p.dentMeneeMax = parseInt(document.getElementById("val_menee_max").innerText);
    p.precision = parseFloat(document.getElementById("precision").value);
    p.maxEtages = parseInt(document.getElementById("etages").value);
    p.maxSolutions = parseInt(document.getElementById("max_solutions").value);
    p.maxIterations = parseInt(document.getElementById("max_iterations").value);

    var fixeA = document.getElementById("dent_menante_fixe").value;
    var fixeB = document.getElementById("dent_menee_fixe").value;
    p.dentMenanteFixe = fixeA.trim() !== "" ? parseInt(fixeA, 10) : null;
    p.dentMeneeFixe = fixeB.trim() !== "" ? parseInt(fixeB, 10) : null;

    var reductionEl = document.getElementById("reduction_only");
    p.reductionOnly = reductionEl ? reductionEl.checked : true;

    p.typesActifs = [];
    document.querySelectorAll('.type-checkbox:checked').forEach(function (cb) {
      p.typesActifs.push(cb.value);
    });
    if (p.typesActifs.length === 0) p.typesActifs.push('spur');

    var modEl = document.getElementById("module");
    p.module = (modEl && modEl.value.trim() !== "") ? parseFloat(modEl.value) : null;

    var vitEl = document.getElementById("vitesse_entree");
    p.vitesseEntree = (vitEl && vitEl.value.trim() !== "") ? parseFloat(vitEl.value) : 1500;

    var cplEl = document.getElementById("couple_entree");
    p.coupleEntree = (cplEl && cplEl.value.trim() !== "") ? parseFloat(cplEl.value) : 10;

    return p;
  };

  /**
   * Valide les paramètres.
   * @returns {{ valid: boolean, message?: string }}
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

  /**
   * Convertit en objet plat pour le worker.
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

  /**
   * Sauvegarde dans localStorage (incluant sliders, types cochés, réduction).
   */
  SearchParams.prototype.save = function () {
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

    // Sliders noUiSlider
    var sliderMenante = document.getElementById('dent_menante_slider');
    if (sliderMenante && sliderMenante.noUiSlider) {
      data.sliderMenante = sliderMenante.noUiSlider.get();
    }
    var sliderMenee = document.getElementById('dent_menee_slider');
    if (sliderMenee && sliderMenee.noUiSlider) {
      data.sliderMenee = sliderMenee.noUiSlider.get();
    }

    // Types de transmission cochés
    var types = [];
    document.querySelectorAll('.type-checkbox:checked').forEach(function (cb) {
      types.push(cb.value);
    });
    data.typesActifs = types;

    // Réduction uniquement
    var reductionEl = document.getElementById("reduction_only");
    if (reductionEl) data.reductionOnly = reductionEl.checked;

    localStorage.setItem("gearCalcParams", JSON.stringify(data));
  };

  /** Liste des champs input simples à sauvegarder/restaurer. */
  var SIMPLE_FIELDS = [
    'rapport', 'precision', 'etages', 'max_solutions', 'max_iterations',
    'dent_menante_fixe', 'dent_menee_fixe', 'module', 'vitesse_entree', 'couple_entree'
  ];

  /**
   * Restaure depuis localStorage (incluant sliders, types cochés, réduction).
   */
  SearchParams.restore = function () {
    var saved = localStorage.getItem("gearCalcParams");
    if (!saved) return;
    try {
      var data = JSON.parse(saved);
      if (!data || typeof data !== 'object') return;

      // Champs input simples
      SIMPLE_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && data[id] !== undefined && data[id] !== '') el.value = data[id];
      });

      // Sliders noUiSlider
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

      // Types de transmission cochés
      if (data.typesActifs && Array.isArray(data.typesActifs)) {
        document.querySelectorAll('.type-checkbox').forEach(function (cb) {
          cb.checked = data.typesActifs.indexOf(cb.value) !== -1;
        });
      }

      // Réduction uniquement
      if (data.reductionOnly !== undefined) {
        var reductionEl = document.getElementById("reduction_only");
        if (reductionEl) reductionEl.checked = data.reductionOnly;
      }
    } catch (e) {
      console.error("Erreur restauration paramètres:", e);
    }
  };

  GearApp.models.SearchParams = SearchParams;

})(GearApp);
