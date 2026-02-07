/**
 * @file ParameterForm.js - Gestion du formulaire de paramètres, sliders, thème et mode pro
 * @description Composant UI responsable de la gestion complète du formulaire de saisie :
 *              - Sliders noUiSlider pour les plages de dents (menante/menée)
 *              - Mode pro avec paramètres avancés contextuels par type de transmission
 *              - Paramètres matériaux (angle de pression, frottement, etc.)
 *              - Bascule du thème clair/sombre avec persistance localStorage
 *              - Lecture et sauvegarde des paramètres de recherche
 * @namespace GearApp.ui.ParameterForm
 */

(function (GearApp) {

  // ===== Définition des paramètres spécifiques par type de transmission =====

  /**
   * Table de définition des paramètres contextuels affichés dynamiquement
   * en mode pro selon les types de transmission cochés.
   * Chaque type possède un tableau de définitions de champs avec :
   * - id : identifiant HTML de l'input
   * - label : libellé affiché à l'utilisateur
   * - defaut : valeur par défaut
   * - min/max/step : contraintes numériques (pour les inputs number)
   * - options/optionLabels : valeurs pour les selects
   * - type : 'bool' pour les checkboxes
   * - key : clé utilisée dans l'objet de paramètres retourné
   *
   * @type {Object.<string, Array<{id: string, label: string, defaut: *, min: number, max: number, step: number, key: string, options: Array<string>, optionLabels: Array<string>, type: string}>>}
   */
  var TYPE_PARAMS = {
    helical: [
      { id: 'param_helical_angle', label: 'Angle d\'hélice (°)', defaut: 20, min: 5, max: 45, step: 1, key: 'angleHelice' }
    ],
    bevel: [
      { id: 'param_bevel_angle', label: 'Angle entre axes (°)', defaut: 90, min: 10, max: 170, step: 5, key: 'angleCone' }
    ],
    belt: [
      { id: 'param_belt_type', label: 'Type de courroie', defaut: 'V', options: ['Plate', 'V', 'Crantée', 'Ronde'], key: 'typeCourroie' },
      { id: 'param_belt_crossed', label: 'Courroie croisée', defaut: false, type: 'bool', key: 'courroieCroisee' }
    ],
    epicyclic: [
      { id: 'param_epi_satellites', label: 'Nombre de satellites', defaut: 3, min: 2, max: 6, step: 1, key: 'nbSatellites' },
      { id: 'param_epi_config', label: 'Configuration', defaut: 'couronne_fixe',
        options: ['couronne_fixe', 'solaire_fixe', 'porte_satellites_fixe'],
        optionLabels: ['Couronne fixe', 'Solaire fixe', 'Porte-sat. fixe'],
        key: 'configEpicyclic' }
    ],
    worm: [
      { id: 'param_worm_filets', label: 'Nombre de filets', defaut: 1, min: 1, max: 6, step: 1, key: 'nbFilets' }
    ]
  };

  // ===== Constructeur =====

  /**
   * Crée une instance de ParameterForm.
   * Initialise les références internes ; les sliders doivent être créés
   * explicitement via initSliders().
   *
   * @constructor
   */
  function ParameterForm() {
    /** @type {HTMLElement|null} @private Slider noUiSlider pour la plage de dents de la roue menante */
    this._sliderMenante = null;
    /** @type {HTMLElement|null} @private Slider noUiSlider pour la plage de dents de la roue menée */
    this._sliderMenee = null;
    /** @type {boolean} @private Indique si le mode pro est activé */
    this._proMode = false;
    /** @type {HTMLElement|null} @private Conteneur DOM des paramètres contextuels par type */
    this._typeParamsContainer = null;
  }

  // ===== Initialisation des sliders =====

  /**
   * Initialise les sliders noUiSlider pour les plages de dents menante et menée.
   * Configure les callbacks de mise à jour des labels et lie les checkboxes
   * de types pour la mise à jour dynamique des paramètres contextuels.
   *
   * @returns {void}
   */
  ParameterForm.prototype.initSliders = function () {
    this._sliderMenante = document.getElementById('dent_menante_slider');
    this._sliderMenee = document.getElementById('dent_menee_slider');

    // Slider de la roue menante : plage [5, 80], pas de 1
    if (this._sliderMenante && noUiSlider) {
      noUiSlider.create(this._sliderMenante, {
        start: [10, 30], connect: true,
        range: { 'min': 5, 'max': 80 }, step: 1
      });
      // Mise à jour des labels min/max en temps réel
      this._sliderMenante.noUiSlider.on('update', function (values) {
        document.getElementById("val_menante_min").innerText = Math.round(values[0]);
        document.getElementById("val_menante_max").innerText = Math.round(values[1]);
      });
    }

    // Slider de la roue menée : plage [10, 120], pas de 1
    if (this._sliderMenee && noUiSlider) {
      noUiSlider.create(this._sliderMenee, {
        start: [20, 50], connect: true,
        range: { 'min': 10, 'max': 120 }, step: 1
      });
      // Mise à jour des labels min/max en temps réel
      this._sliderMenee.noUiSlider.on('update', function (values) {
        document.getElementById("val_menee_min").innerText = Math.round(values[0]);
        document.getElementById("val_menee_max").innerText = Math.round(values[1]);
      });
    }

    // Liaison des checkboxes de types pour les paramètres contextuels
    this._typeParamsContainer = document.getElementById('typeParamsContainer');
    var self = this;
    document.querySelectorAll('.type-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        // Mise à jour des paramètres contextuels uniquement en mode pro
        if (self._proMode) self._updateTypeParams();
      });
    });
  };

  // ===== Mode Pro =====

  /**
   * Retourne l'état actuel du mode pro.
   *
   * @returns {boolean} true si le mode pro est activé
   */
  ParameterForm.prototype.isProMode = function () {
    return this._proMode;
  };

  /**
   * Bascule le mode pro (Standard <-> Pro).
   * Active/désactive la classe CSS 'pro-mode' sur le body pour afficher/masquer
   * les éléments '.pro-only'. Met à jour les paramètres contextuels par type
   * et persiste le choix dans localStorage.
   *
   * @returns {void}
   */
  ParameterForm.prototype.toggleProMode = function () {
    this._proMode = !this._proMode;
    document.body.classList.toggle('pro-mode', this._proMode);

    var btn = document.getElementById('proModeBtn');
    if (btn) btn.textContent = this._proMode ? 'Pro' : 'Standard';

    // Afficher/masquer les sections pro via CSS
    // .pro-only éléments visibles seulement quand body.pro-mode
    if (this._proMode) {
      this._updateTypeParams();
    }

    // Persistance du choix dans localStorage
    localStorage.setItem('gearCalcProMode', this._proMode ? '1' : '0');
  };

  /**
   * Restaure l'état du mode pro depuis localStorage.
   * Appelé au démarrage de l'application pour rétablir les préférences utilisateur.
   *
   * @returns {void}
   */
  ParameterForm.prototype.restoreProMode = function () {
    var saved = localStorage.getItem('gearCalcProMode');
    if (saved === '1') {
      this.toggleProMode();
    }
  };

  // ===== Paramètres contextuels par type =====

  /**
   * Met à jour dynamiquement les champs de paramètres spécifiques aux types
   * de transmission cochés. Reconstruit le DOM du conteneur _typeParamsContainer
   * en fonction des types sélectionnés et de leurs définitions dans TYPE_PARAMS.
   *
   * Gère trois types de champs :
   * - select : pour les listes déroulantes (options/optionLabels)
   * - checkbox : pour les booléens (type === 'bool')
   * - number : pour les valeurs numériques avec min/max/step
   *
   * @private
   * @returns {void}
   */
  ParameterForm.prototype._updateTypeParams = function () {
    if (!this._typeParamsContainer) return;

    // Récupérer les types de transmission cochés
    var checkedTypes = [];
    document.querySelectorAll('.type-checkbox:checked').forEach(function (cb) {
      checkedTypes.push(cb.value);
    });

    this._typeParamsContainer.innerHTML = '';

    var registry = GearApp.models.typeRegistry;
    var hasParams = false;

    var self = this;
    checkedTypes.forEach(function (typeId) {
      var paramDefs = TYPE_PARAMS[typeId];
      if (!paramDefs || paramDefs.length === 0) return;

      hasParams = true;
      var type = registry.get(typeId);

      // Groupe de paramètres pour ce type
      var group = document.createElement('div');
      group.className = 'type-param-group';

      // En-tête avec le badge du type
      var header = document.createElement('div');
      header.className = 'type-param-header';
      header.innerHTML = '<span class="type-badge ' + typeId + '">' + type.nomCourt + '</span>';
      group.appendChild(header);

      // Génération dynamique des champs selon la définition
      paramDefs.forEach(function (def) {
        var wrapper = document.createElement('div');
        wrapper.className = 'type-param-field';

        var label = document.createElement('label');
        label.textContent = def.label;
        label.setAttribute('for', def.id);
        wrapper.appendChild(label);

        var input;
        if (def.options) {
          // Champ de type select (liste déroulante)
          input = document.createElement('select');
          input.id = def.id;
          def.options.forEach(function (opt, i) {
            var option = document.createElement('option');
            option.value = opt;
            option.textContent = def.optionLabels ? def.optionLabels[i] : opt;
            if (opt === def.defaut) option.selected = true;
            input.appendChild(option);
          });
        } else if (def.type === 'bool') {
          // Champ de type checkbox (booléen)
          var boolWrapper = document.createElement('label');
          boolWrapper.className = 'checkbox-label';
          input = document.createElement('input');
          input.type = 'checkbox';
          input.id = def.id;
          input.checked = def.defaut;
          boolWrapper.appendChild(input);
          var boolLabel = document.createElement('span');
          boolLabel.textContent = def.label;
          boolWrapper.appendChild(boolLabel);
          wrapper.innerHTML = '';
          wrapper.appendChild(boolWrapper);
          group.appendChild(wrapper);
          return; // Le champ bool a un rendu spécial, on sort du forEach
        } else {
          // Champ de type number (valeur numérique)
          input = document.createElement('input');
          input.type = 'number';
          input.id = def.id;
          input.value = def.defaut;
          if (def.min !== undefined) input.min = def.min;
          if (def.max !== undefined) input.max = def.max;
          if (def.step !== undefined) input.step = def.step;
        }

        wrapper.appendChild(input);
        group.appendChild(wrapper);
      });

      self._typeParamsContainer.appendChild(group);
    });

    // Masquer le conteneur s'il n'y a aucun paramètre à afficher
    this._typeParamsContainer.style.display = hasParams ? '' : 'none';
  };

  // ===== Lecture des paramètres par type =====

  /**
   * Lit les valeurs actuelles de tous les paramètres spécifiques aux types.
   * Parcourt TYPE_PARAMS et récupère les valeurs des inputs correspondants
   * dans le DOM (s'ils existent).
   *
   * @returns {Object.<string, *>} Objet clé/valeur des paramètres par type
   *          (ex: { angleHelice: 20, nbSatellites: 3, configEpicyclic: 'couronne_fixe' })
   */
  ParameterForm.prototype.getTypeSpecificParams = function () {
    var result = {};
    for (var typeId in TYPE_PARAMS) {
      TYPE_PARAMS[typeId].forEach(function (def) {
        var el = document.getElementById(def.id);
        if (!el) return;
        if (def.type === 'bool') {
          result[def.key] = el.checked;
        } else if (def.options) {
          result[def.key] = el.value;
        } else {
          var val = parseFloat(el.value);
          if (!isNaN(val)) result[def.key] = val;
        }
      });
    }
    return result;
  };

  // ===== Lecture des paramètres matériaux (pro) =====

  /**
   * Lit les valeurs actuelles des paramètres matériaux du mode pro.
   * Ne retourne que les champs renseignés (non vides et valides numériquement).
   *
   * @returns {Object.<string, number>} Objet clé/valeur des paramètres matériaux
   *          (ex: { angleContact: 20, coeffFrottement: 0.05, largeurDent: 10 })
   */
  ParameterForm.prototype.getMaterialParams = function () {
    var result = {};
    /** @type {Array<{id: string, key: string, parse: function}>} Définitions des champs matériaux */
    var fields = [
      { id: 'angle_pression', key: 'angleContact', parse: parseFloat },
      { id: 'coeff_frottement', key: 'coeffFrottement', parse: parseFloat },
      { id: 'largeur_dent', key: 'largeurDent', parse: parseFloat },
      { id: 'limite_elastique', key: 'limiteElastique', parse: parseFloat },
      { id: 'qualite_iso', key: 'qualiteISO', parse: function (v) { return parseInt(v, 10); } }
    ];
    fields.forEach(function (f) {
      var el = document.getElementById(f.id);
      // Ne retourner que les champs renseignés et numériquement valides
      if (el && el.value.trim() !== '') {
        var val = f.parse(el.value);
        if (!isNaN(val)) result[f.key] = val;
      }
    });
    return result;
  };

  // ===== Thème clair/sombre =====

  /**
   * Bascule le thème visuel entre clair et sombre.
   * Active/désactive la classe CSS 'dark-theme' sur le body,
   * persiste le choix dans localStorage et met à jour le bouton.
   *
   * @returns {void}
   */
  ParameterForm.prototype.toggleTheme = function () {
    document.body.classList.toggle('dark-theme');
    var isDark = document.body.classList.contains('dark-theme');
    localStorage.setItem('gearCalcTheme', isDark ? 'dark' : 'light');
    document.getElementById('themeBtn').innerText = isDark ? 'Clair' : 'Sombre';
  };

  /**
   * Restaure le thème depuis localStorage au démarrage.
   * Si le thème sauvegardé est 'dark', applique la classe et met à jour le bouton.
   *
   * @returns {void}
   */
  ParameterForm.prototype.restoreTheme = function () {
    var savedTheme = localStorage.getItem('gearCalcTheme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      document.getElementById('themeBtn').innerText = 'Clair';
    }
  };

  // ===== Accesseurs des paramètres de base =====

  /**
   * Retourne la valeur du module d'engrenage saisie dans le formulaire.
   *
   * @returns {number|null} Valeur du module en mm, ou null si non renseigné
   */
  ParameterForm.prototype.getModuleValue = function () {
    var el = document.getElementById("module");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return null;
  };

  /**
   * Retourne la vitesse d'entrée saisie dans le formulaire.
   *
   * @returns {number} Vitesse d'entrée en tr/min (par défaut 1500)
   */
  ParameterForm.prototype.getVitesseEntree = function () {
    var el = document.getElementById("vitesse_entree");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return 1500;
  };

  /**
   * Retourne le couple d'entrée saisi dans le formulaire.
   *
   * @returns {number} Couple d'entrée en N.m (par défaut 10)
   */
  ParameterForm.prototype.getCoupleEntree = function () {
    var el = document.getElementById("couple_entree");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return 10;
  };

  /**
   * Construit et retourne un objet SearchParams à partir des valeurs du formulaire.
   * Délègue à GearApp.models.SearchParams.fromForm().
   *
   * @returns {GearApp.models.SearchParams} Les paramètres de recherche
   */
  ParameterForm.prototype.getSearchParams = function () {
    return GearApp.models.SearchParams.fromForm();
  };

  // ===== Sauvegarde et restauration =====

  /**
   * Sauvegarde les paramètres de recherche actuels dans localStorage.
   *
   * @returns {void}
   */
  ParameterForm.prototype.save = function () {
    var params = this.getSearchParams();
    params.save();
  };

  /**
   * Restaure les paramètres de recherche depuis localStorage dans le formulaire.
   *
   * @returns {void}
   */
  ParameterForm.prototype.restore = function () {
    GearApp.models.SearchParams.restore();
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.ui.ParameterForm = ParameterForm;

})(GearApp);
