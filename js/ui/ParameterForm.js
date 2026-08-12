// ParameterForm.js - Sliders de dents, thème, mode expert et accès aux paramètres.
// Le rendu des paramètres par type est assuré par Workbench.renderTypeParams().

(function (GearApp) {

  var TYPE_PARAMS = GearTransmissionRegistry.parameterDefinitions;

  function ParameterForm() {
    this._sliderMenante = null;
    this._sliderMenee = null;
    this._proMode = false;
  }

  // ===== Sliders noUiSlider =====

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
  };

  // ===== Mode expert (anciennement « Pro ») =====

  ParameterForm.prototype.isProMode = function () {
    return this._proMode;
  };

  ParameterForm.prototype.toggleProMode = function () {
    this._proMode = !this._proMode;
    document.body.classList.toggle('pro-mode', this._proMode);

    var btn = document.getElementById('proModeBtn');
    if (btn) {
      btn.textContent = this._proMode ? 'Expert' : 'Standard';
      btn.setAttribute('aria-pressed', this._proMode ? 'true' : 'false');
    }

    localStorage.setItem('gearCalcProMode', this._proMode ? '1' : '0');
  };

  ParameterForm.prototype.restoreProMode = function () {
    if (localStorage.getItem('gearCalcProMode') === '1') {
      this.toggleProMode();
    }
  };

  // ===== Thème =====

  ParameterForm.prototype.toggleTheme = function () {
    document.body.classList.toggle('dark-theme');
    var isDark = document.body.classList.contains('dark-theme');
    localStorage.setItem('gearCalcTheme', isDark ? 'dark' : 'light');
    var btn = document.getElementById('themeBtn');
    if (btn) btn.innerText = isDark ? 'Clair' : 'Sombre';
  };

  ParameterForm.prototype.restoreTheme = function () {
    if (localStorage.getItem('gearCalcTheme') === 'dark') {
      document.body.classList.add('dark-theme');
      var btn = document.getElementById('themeBtn');
      if (btn) btn.innerText = 'Clair';
    }
  };

  // ===== Lecture des paramètres par type (champs tp_*) =====

  ParameterForm.prototype.getTypeSpecificParams = function () {
    var result = {};
    for (var typeId in TYPE_PARAMS) {
      result[typeId] = {};
      Object.keys(TYPE_PARAMS[typeId]).forEach(function (key) {
        var def = TYPE_PARAMS[typeId][key];
        var el = document.getElementById('tp_' + typeId + '_' + key);
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
      if (!Object.keys(result[typeId]).length) delete result[typeId];
    }
    return result;
  };

  // Conservé pour compatibilité : ces champs experts historiques n'existent
  // plus dans le formulaire, la fonction renvoie alors un objet vide.
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

  // ===== Accesseurs =====

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
    this.getSearchParams().save();
  };

  ParameterForm.prototype.restore = function () {
    GearApp.models.SearchParams.restore();
  };

  GearApp.ui.ParameterForm = ParameterForm;

})(GearApp);
