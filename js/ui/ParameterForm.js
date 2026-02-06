// ParameterForm.js - Gestion du formulaire de paramètres, sliders et thème

(function (GearApp) {

  function ParameterForm() {
    this._sliderMenante = null;
    this._sliderMenee = null;
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
  };

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
