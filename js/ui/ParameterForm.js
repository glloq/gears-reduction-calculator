// ParameterForm.js - Gestion du formulaire de paramètres, sliders, thème et mode pro

(function (GearApp) {

  // TransmissionRegistry is the only parameter-definition source.
  var TYPE_PARAMS = GearTransmissionRegistry.parameterDefinitions;

  function ParameterForm() {
    this._sliderMenante = null;
    this._sliderMenee = null;
    this._proMode = false;
    this._typeParamsContainer = null;
  }

  ParameterForm.prototype.initSliders = function () {
    this._sliderMenante = document.getElementById('dent_menante_slider');
    this._sliderMenee = document.getElementById('dent_menee_slider');

    if (this._sliderMenante && typeof noUiSlider !== 'undefined') {
      noUiSlider.create(this._sliderMenante, {
        start: [10, 30], connect: true,
        range: { 'min': 5, 'max': 80 }, step: 1
      });
      this._sliderMenante.noUiSlider.on('update', function (values) {
        document.getElementById("val_menante_min").innerText = Math.round(values[0]);
        document.getElementById("val_menante_max").innerText = Math.round(values[1]);
      });
    }

    if (this._sliderMenee && typeof noUiSlider !== 'undefined') {
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
      var registryId=typeId==='epicyclic'?'planetary':typeId;
      var paramDefs = TYPE_PARAMS[registryId];
      if (!paramDefs || Object.keys(paramDefs).length === 0) return;

      hasParams = true;
      var type = registry.get(typeId);

      var group = document.createElement('div');
      group.className = 'type-param-group';

      var header = document.createElement('div');
      header.className = 'type-param-header';
      header.innerHTML = '<span class="type-badge ' + typeId + '">' + type.nomCourt + '</span>';
      group.appendChild(header);

      Object.keys(paramDefs).forEach(function (key) { var def=paramDefs[key];
        var wrapper = document.createElement('div');
        wrapper.className = 'type-param-field';

        var label = document.createElement('label');
        label.textContent = def.label;
        var fieldId='tp_'+registryId+'_'+key;
        label.setAttribute('for', fieldId);
        wrapper.appendChild(label);

        var input;
        if (def.options) {
          input = document.createElement('select');
          input.id = fieldId;
          def.options.forEach(function (opt, i) {
            var option = document.createElement('option');
            option.value = opt;
            option.textContent = def.optionLabels ? def.optionLabels[i] : opt;
            if (opt === def.default) option.selected = true;
            input.appendChild(option);
          });
        } else if (def.type === 'checkbox') {
          var boolWrapper = document.createElement('label');
          boolWrapper.className = 'checkbox-label';
          input = document.createElement('input');
          input.type = 'checkbox';
          input.id = fieldId;
          input.checked = def.default;
          input.dataset.persist='';
          var pendingCheckbox=GearApp.models.SearchParams._pendingExpert;if(pendingCheckbox&&pendingCheckbox[fieldId]!==undefined)input.checked=!!pendingCheckbox[fieldId];
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
          input.id = fieldId;
          input.value = def.default;
          if (def.min !== undefined) input.min = def.min;
          if (def.max !== undefined) input.max = def.max;
          if (def.step !== undefined) input.step = def.step;
        }

        input.dataset.persist='';var pending=GearApp.models.SearchParams._pendingExpert;if(pending&&pending[fieldId]!==undefined){if(input.type==='checkbox')input.checked=!!pending[fieldId];else input.value=pending[fieldId];}wrapper.appendChild(input);
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
      result[typeId]={};
      Object.keys(TYPE_PARAMS[typeId]).forEach(function (key) { var def=TYPE_PARAMS[typeId][key];
        var el = document.getElementById('tp_'+typeId+'_'+key);
        if (!el) return;
        if (def.type === 'checkbox') {
          result[typeId][key] = el.checked;
        } else if (def.options) {
          result[typeId][key] = el.value;
        } else {
          var val = parseFloat(el.value);
          if (!isNaN(val)) result[typeId][key] = val;
        }
      });
      if(!Object.keys(result[typeId]).length)delete result[typeId];
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
