// ParameterForm.js - Gestion du formulaire de paramètres, sliders, thème et mode pro

(function (GearApp) {

  // Définition des paramètres par type (affichés dynamiquement en mode pro)
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

  function ParameterForm() {
    this._sliderMenante = null;
    this._sliderMenee = null;
    this._proMode = false;
    this._typeParamsContainer = null;
  }

  ParameterForm.prototype.initSliders = function () {
    this._sliderMenante = document.getElementById('dent_menante_slider');
    this._sliderMenee = document.getElementById('dent_menee_slider');

    if (this._sliderMenante && noUiSlider) {
      noUiSlider.create(this._sliderMenante, {
        start: [10, 30], connect: true,
        range: { 'min': 5, 'max': 80 }, step: 1
      });
      this._sliderMenante.noUiSlider.on('update', function (values) {
        document.getElementById("val_menante_min").innerText = Math.round(values[0]);
        document.getElementById("val_menante_max").innerText = Math.round(values[1]);
      });
    }

    if (this._sliderMenee && noUiSlider) {
      noUiSlider.create(this._sliderMenee, {
        start: [20, 50], connect: true,
        range: { 'min': 10, 'max': 120 }, step: 1
      });
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
        if (self._proMode) self._updateTypeParams();
      });
    });
  };

  // ===== Mode Pro =====

  ParameterForm.prototype.isProMode = function () {
    return this._proMode;
  };

  ParameterForm.prototype.toggleProMode = function () {
    this._proMode = !this._proMode;
    document.body.classList.toggle('pro-mode', this._proMode);

    var btn = document.getElementById('proModeBtn');
    if (btn) {
      btn.textContent = this._proMode ? 'Pro' : 'Standard';
      btn.setAttribute('aria-pressed', this._proMode ? 'true' : 'false');
    }

    // Afficher/masquer les sections pro via CSS (.pro-only visible quand body.pro-mode)
    var proSection = document.getElementById('proMaterialSection');
    if (proSection) proSection.style.display = this._proMode ? '' : 'none';

    // Graphique sécurité (pro only)
    var safetyContainer = document.querySelector('.chart-container.pro-only');
    if (safetyContainer) safetyContainer.style.display = this._proMode ? '' : 'none';

    if (this._proMode) {
      this._updateTypeParams();
    }

    localStorage.setItem('gearCalcProMode', this._proMode ? '1' : '0');
  };

  ParameterForm.prototype.restoreProMode = function () {
    var saved = localStorage.getItem('gearCalcProMode');
    if (saved === '1') {
      this.toggleProMode();
    }
  };

  // ===== Paramètres contextuels par type =====

  ParameterForm.prototype._updateTypeParams = function () {
    if (!this._typeParamsContainer) return;

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

      var group = document.createElement('div');
      group.className = 'type-param-group';

      var header = document.createElement('div');
      header.className = 'type-param-header';
      header.innerHTML = '<span class="type-badge ' + typeId + '">' + type.nomCourt + '</span>';
      group.appendChild(header);

      paramDefs.forEach(function (def) {
        var wrapper = document.createElement('div');
        wrapper.className = 'type-param-field';

        var label = document.createElement('label');
        label.textContent = def.label;
        label.setAttribute('for', def.id);
        wrapper.appendChild(label);

        var input;
        if (def.options) {
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
          return;
        } else {
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

    this._typeParamsContainer.style.display = hasParams ? '' : 'none';
  };

  // ===== Lecture des paramètres par type =====

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

  ParameterForm.prototype.getMaterialParams = function () {
    var result = {};
    var fields = [
      { id: 'angle_pression', key: 'angleContact', parse: parseFloat },
      { id: 'coeff_frottement', key: 'coeffFrottement', parse: parseFloat },
      { id: 'largeur_dent', key: 'largeurDent', parse: parseFloat },
      { id: 'limite_elastique', key: 'limiteElastique', parse: parseFloat },
      { id: 'qualite_iso', key: 'qualiteISO', parse: function (v) { return parseInt(v, 10); } }
    ];
    fields.forEach(function (f) {
      var el = document.getElementById(f.id);
      if (el && el.value.trim() !== '') {
        var val = f.parse(el.value);
        if (!isNaN(val)) result[f.key] = val;
      }
    });
    return result;
  };

  // ===== Accesseurs existants =====

  ParameterForm.prototype.toggleTheme = function () {
    document.body.classList.toggle('dark-theme');
    var isDark = document.body.classList.contains('dark-theme');
    localStorage.setItem('gearCalcTheme', isDark ? 'dark' : 'light');
    document.getElementById('themeBtn').innerText = isDark ? 'Clair' : 'Sombre';
  };

  ParameterForm.prototype.restoreTheme = function () {
    var savedTheme = localStorage.getItem('gearCalcTheme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      document.getElementById('themeBtn').innerText = 'Clair';
    }
  };

  ParameterForm.prototype.getModuleValue = function () {
    var el = document.getElementById("module");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return null;
  };

  ParameterForm.prototype.getVitesseEntree = function () {
    var el = document.getElementById("vitesse_entree");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return 1500;
  };

  ParameterForm.prototype.getCoupleEntree = function () {
    var el = document.getElementById("couple_entree");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return 10;
  };

  ParameterForm.prototype.getSearchParams = function () {
    return GearApp.models.SearchParams.fromForm();
  };

  ParameterForm.prototype.save = function () {
    var params = this.getSearchParams();
    params.save();
  };

  ParameterForm.prototype.restore = function () {
    GearApp.models.SearchParams.restore();
  };

  GearApp.ui.ParameterForm = ParameterForm;

})(GearApp);
