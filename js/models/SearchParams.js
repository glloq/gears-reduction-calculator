// SearchParams.js - Objet valeur encapsulant les paramètres de recherche
// Supporte la sauvegarde complète, l'URL partageable et les presets

(function (GearApp) {

  // ===== Presets nommés =====
  var PRESETS = {
    robotique: {
      nom: 'Robotique',
      description: 'Compact, épicycloïdal, haute précision',
      rapport: 50, precision: 0.5, maxEtages: 3, maxSolutions: 20,
      typesActifs: ['epicyclic', 'spur', 'helical'],
      dentMenanteSlider: [12, 40], dentMeneeSlider: [30, 100],
      reductionOnly: true
    },
    industriel: {
      nom: 'Industriel',
      description: 'Robuste, engrenages droits, haute fiabilité',
      rapport: 12, precision: 0.1, maxEtages: 4, maxSolutions: 15,
      typesActifs: ['spur', 'helical'],
      dentMenanteSlider: [15, 40], dentMeneeSlider: [30, 80],
      reductionOnly: true
    },
    automobile: {
      nom: 'Automobile',
      description: 'Haut rendement, hélicoïdal, silencieux',
      rapport: 4, precision: 0.1, maxEtages: 2, maxSolutions: 10,
      typesActifs: ['helical', 'spur'],
      dentMenanteSlider: [15, 30], dentMeneeSlider: [20, 60],
      reductionOnly: true
    },
    convoyeur: {
      nom: 'Convoyeur',
      description: 'Très haut rapport, vis sans fin ou épicycloïdal',
      rapport: 100, precision: 1, maxEtages: 3, maxSolutions: 10,
      typesActifs: ['worm', 'epicyclic', 'spur'],
      dentMenanteSlider: [10, 30], dentMeneeSlider: [20, 120],
      reductionOnly: true
    },
    impression3d: {
      nom: 'Impression 3D',
      description: 'Petits modules, engrenages imprimables',
      rapport: 5, precision: 0.5, maxEtages: 2, maxSolutions: 10,
      typesActifs: ['spur', 'internal'],
      dentMenanteSlider: [10, 25], dentMeneeSlider: [20, 60],
      reductionOnly: true
    }
  };

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
    this.searchMode = 'minimumStages';
    this.typeParameters = {};
    this.constraints = {};
  }

  /**
   * Construit les paramètres depuis le formulaire DOM.
   */
  SearchParams.fromForm = function () {
    var p = new SearchParams();
    function element(id) { return document.getElementById(id); }
    function value(id, fallback) { var el=element(id); return el&&el.value!==''?el.value:fallback; }
    // Empty, zero and malformed values deliberately remain distinct. Constraints
    // use null for "not requested"; callers can therefore legitimately supply 0.
    function optionalNumber(id) {
      var el=element(id), raw=el&&String(el.value).trim();
      if(raw==='') return null;
      var parsed=Number(raw);
      return Number.isFinite(parsed)?parsed:null;
    }
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

    p.objectiveMode=value('objective_mode','ratio');
    p.linearTravelPerRevolutionMm=optionalNumber('linear_travel_per_rev');
    p.searchMode = value('search_mode','minimumStages');
    p.moduleMode = value('module_mode','fixed');
    p.moduleMin=optionalNumber('module_min');p.moduleMax=optionalNumber('module_max');
    if (value('objective_mode','ratio') === 'need') {
      var desiredRpm=parseFloat(value('rpm_sortie_cible',0));
      if (desiredRpm>0) p.rapportCible=p.vitesseEntree/desiredRpm;
    }
    p.typeParameters = {};
    Object.keys(GearTransmissionRegistry.parameterDefinitions).forEach(function(typeId){
      var values={module:p.module};
      Object.keys(GearTransmissionRegistry.parameterDefinitions[typeId]).forEach(function(key){var def=GearTransmissionRegistry.parameterDefinitions[typeId][key],el=document.getElementById('tp_'+typeId+'_'+key),raw=el?(def.type==='checkbox'?el.checked:el.value):def.default;values[key]=def.type==='number'?parseFloat(raw):raw;});
      p.typeParameters[typeId]=values;
    });
    p.typeParameters.belt.pitch=GearTransmissionRegistry.beltPitches[p.typeParameters.belt.profile]||2;
    p.typeParameters.belt.beltType='timing';
    p.constraints={maxDiameter:optionalNumber('max_diameter'),maxLength:optionalNumber('max_length'),maxWidth:optionalNumber('max_width'),minimumEfficiency:optionalNumber('minimum_efficiency'),minimumBendingSafety:optionalNumber('minimum_bending_safety'),minimumContactSafety:optionalNumber('minimum_contact_safety')};
    if(p.objectiveMode==='ratio'||p.objectiveMode==='need') {
      p.constraints.minimumOutputTorqueNm=optionalNumber('minimum_output_torque');
      p.constraints.minimumOutputSpeedRpm=optionalNumber('rpm_sortie_min');
      p.constraints.maximumOutputSpeedRpm=optionalNumber('rpm_sortie_max');
      p.linearTravelPerRevolutionMm=null;
      p.typesActifs=p.typesActifs.filter(function(type){return type!=='rack';});
      // Gabarit d'architecture (JSON sérialisé par Workbench) : tableau de
      // crans null (libre) ou listes de types ; ignoré silencieusement si malformé.
      p.typeTemplate=null;
      var templateRaw=value('type_template','');
      if(templateRaw){
        try{
          var parsedTemplate=JSON.parse(templateRaw);
          if(Array.isArray(parsedTemplate))p.typeTemplate=parsedTemplate.slice(0,p.maxEtages).map(function(slot){return Array.isArray(slot)&&slot.length?slot:null;});
        }catch(ignore){p.typeTemplate=null;}
      }
    } else {
      p.constraints.minimumLinearSpeedMmMin=optionalNumber('linear_speed_min');
      p.constraints.maximumLinearSpeedMmMin=optionalNumber('linear_speed_max');
      p.constraints.minimumOutputForceN=optionalNumber('linear_force_min');
      p.typesActifs=['rack'];
      p.rapportCible=null;
    }
    p.inputMaterial=value('input_material','C45');p.outputMaterial=value('output_material','C45');p.additiveDerating=parseFloat(value('additive_derating',1))||1;
    var weightKeys=['ratio','size','efficiency','stress','stages','noise','manufacturing','cost'],weightTotal=0;p.weights={};weightKeys.forEach(function(k){var w=Math.max(0,parseFloat(value('weight_'+k,1))||0);p.weights[k]=w;weightTotal+=w;});if(weightTotal)weightKeys.forEach(function(k){p.weights[k]/=weightTotal;});
    p.manufacturing={mode:value('manufacturing_mode','standard'),minimumModule:parseFloat(value('manufacturing_min_module',0))||undefined,minimumTeeth:parseInt(value('manufacturing_min_teeth',0),10)||undefined,minimumFaceWidth:parseFloat(value('manufacturing_min_width',0))||undefined,printerDiameter:parseFloat(value('printer_diameter',0))||undefined};
    if(p.manufacturing.mode==='printing3d')p.additiveDerating=parseFloat(value('additive_derating',.55))||.55;
    p.fatigue={enabled:!!(document.getElementById('fatigue_enabled')&&document.getElementById('fatigue_enabled').checked),hoursPerDay:parseFloat(value('hours_per_day',8)),daysPerYear:parseFloat(value('days_per_year',250)),years:parseFloat(value('service_years',10)),loadType:value('load_type','constant')};
    p.shaft={supportDistanceMm:parseFloat(value('support_distance',0))||null,allowableShearMPa:parseFloat(value('shaft_allowable_shear',80))||80};

    return p;
  };

  /**
   * Valide les paramètres.
   */
  SearchParams.prototype.validate = function () {
    var mode=this.objectiveMode||'ratio', c=this.constraints||{};
    if (mode==='ratio' && (!Number.isFinite(this.rapportCible) || this.rapportCible <= 0)) {
      return { valid: false, message: "Erreur : rapport cible invalide" };
    }
    if(mode==='ratio'&&(!Number.isFinite(this.precision)||this.precision<0))return {valid:false,message:'Erreur : tolérance invalide',field:'precision'};
    if((mode==='ratio'||mode==='need')&&!(this.typesActifs||[]).some(function(t){return t!=='rack';}))return {valid:false,message:'Aucune transmission rotative sélectionnée',field:'types'};
    if(mode==='need'&&(!Number.isFinite(this.vitesseEntree)||this.vitesseEntree<=0||!Number.isFinite(this.rapportCible)||this.rapportCible<=0))return {valid:false,message:'RPM entrée et RPM sortie cible doivent être supérieurs à zéro',field:'rpm_sortie_cible'};
    if(mode==='rotationTranslation'&&(!Number.isFinite(this.vitesseEntree)||this.vitesseEntree<=0||!Number.isFinite(this.coupleEntree)||this.coupleEntree<=0||!Number.isFinite(this.linearTravelPerRevolutionMm)||this.linearTravelPerRevolutionMm<=0))return {valid:false,message:'RPM, couple et course doivent être supérieurs à zéro',field:'linear_travel_per_rev'};
    if (this.dentMenanteMin > this.dentMenanteMax || this.dentMeneeMin > this.dentMeneeMax) {
      return { valid: false, message: "Erreur : intervalles de dents invalides" };
    }
    if (isNaN(this.maxEtages) || this.maxEtages < 1) {
      return { valid: false, message: "Erreur : nombre d'étages invalide" };
    }
    if(this.moduleMode==='fixed'&&(!Number.isFinite(this.module)||this.module<=0))return {valid:false,message:'Le module fixe est obligatoire',field:'module'};
    if(this.moduleMin!=null&&this.moduleMax!=null&&this.moduleMin>this.moduleMax)return {valid:false,message:'La plage de modules est inversée',field:'module_min'};
    if((mode==='ratio'||mode==='need')&&c.minimumOutputSpeedRpm!=null&&c.maximumOutputSpeedRpm!=null&&c.minimumOutputSpeedRpm>c.maximumOutputSpeedRpm)return {valid:false,message:'La plage RPM sortie est inversée',field:'rpm_sortie_min'};
    if((mode==='ratio'||mode==='need')&&Array.isArray(this.typeTemplate)){
      var aliasType=function(id){return id==='epicyclic'?'planetary':id;};
      var activeAliased=(this.typesActifs||[]).map(aliasType);
      for(var slotIndex=0;slotIndex<this.typeTemplate.length;slotIndex++){
        var slot=this.typeTemplate[slotIndex];
        if(slot&&slot.length&&!slot.some(function(id){return activeAliased.indexOf(aliasType(id))!==-1;}))
          return {valid:false,message:'Architecture imposée : le type choisi à l’étage '+(slotIndex+1)+' n’est pas activé',field:'type_template'};
      }
    }
    if(mode==='rotationTranslation'&&c.minimumLinearSpeedMmMin!=null&&c.maximumLinearSpeedMmMin!=null&&c.minimumLinearSpeedMmMin>c.maximumLinearSpeedMmMin)return {valid:false,message:'La plage de vitesse linéaire est inversée',field:'linear_speed_min'};
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
      // Plancher de vivier : la barre d'affinage filtre côté client, elle a
      // besoin de matière même si l'utilisateur a demandé peu de résultats.
      maxSolutions: Math.max(100, this.maxSolutions || 10),
      maxIterations: this.maxIterations,
      dentMenanteFixe: this.dentMenanteFixe,
      dentMeneeFixe: this.dentMeneeFixe,
      allowReductionOnly: this.reductionOnly,
      typesActifs: this.typesActifs
      ,typeParameters: this.typeParameters
      ,searchMode: this.searchMode
      ,constraints: this.constraints
      ,module: this.module
      ,moduleMode: this.moduleMode
      ,moduleMin: this.moduleMin
      ,moduleMax: this.moduleMax
      ,vitesseEntree: this.vitesseEntree
      ,coupleEntree: this.coupleEntree
      ,inputMaterial: this.inputMaterial
      ,outputMaterial: this.outputMaterial
      ,additiveDerating: this.additiveDerating
      ,weights: this.weights
      ,manufacturing: this.manufacturing
      ,objectiveMode: this.objectiveMode
      ,typeTemplate: this.typeTemplate||null
      ,linearTravelPerRevolutionMm: this.linearTravelPerRevolutionMm
      ,fatigue: this.fatigue
      ,shaft: this.shaft
    };
  };

  /**
   * Sauvegarde complète dans localStorage.
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
    document.querySelectorAll('[data-persist]').forEach(function(el){data[el.id]=el.type==='checkbox'?el.checked:el.value;});

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

    // Paramètres matériaux (pro)
    PRO_FIELDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value.trim() !== '') data[id] = el.value;
    });

    localStorage.setItem("gearCalcParams", JSON.stringify(data));
  };

    var SIMPLE_FIELDS = [
    'rapport', 'precision', 'etages', 'max_solutions', 'max_iterations',
    'dent_menante_fixe', 'dent_menee_fixe', 'module', 'vitesse_entree', 'couple_entree'
  ];

  var PRO_FIELDS = ['angle_pression', 'coeff_frottement', 'largeur_dent', 'limite_elastique', 'qualite_iso'];

  /**
   * Restaure depuis localStorage avec validation des données.
   */
  SearchParams.restore = function () {
    var saved = localStorage.getItem("gearCalcParams");
    if (!saved) return;
    try {
      var data = JSON.parse(saved);
      if (!data || typeof data !== 'object') return;

      // Validation de base
      if (data.rapport !== undefined) {
        var r = parseFloat(data.rapport);
        if (isNaN(r) || r <= 0 || r > 100000) delete data.rapport;
      }

      // Champs input simples
      SIMPLE_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && data[id] !== undefined && data[id] !== '') el.value = data[id];
      });
      document.querySelectorAll('[data-persist]').forEach(function(el){if(data[el.id]!==undefined){if(el.type==='checkbox')el.checked=!!data[el.id];else el.value=data[el.id];}});

      // Champs pro
      PRO_FIELDS.forEach(function (id) {
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

  // ===== URL partageable =====

  SearchParams.toURL = function () {
    var params = SearchParams.fromForm();
    var q = new URLSearchParams();
    q.set('r', params.rapportCible);
    q.set('p', params.precision);
    q.set('e', params.maxEtages);
    q.set('s', params.maxSolutions);
    q.set('t', params.typesActifs.join(','));
    q.set('amin', params.dentMenanteMin);
    q.set('amax', params.dentMenanteMax);
    q.set('bmin', params.dentMeneeMin);
    q.set('bmax', params.dentMeneeMax);
    if (params.reductionOnly) q.set('red', '1');
    if (params.module) q.set('mod', params.module);
    if (params.dentMenanteFixe) q.set('fa', params.dentMenanteFixe);
    if (params.dentMeneeFixe) q.set('fb', params.dentMeneeFixe);
    var expert={};document.querySelectorAll('[data-persist]').forEach(function(el){if(el.id)expert[el.id]=el.type==='checkbox'?el.checked:el.value;});q.set('expert',JSON.stringify(expert));
    return window.location.origin + window.location.pathname + '?' + q.toString();
  };

  SearchParams.fromURL = function () {
    var q = new URLSearchParams(window.location.search);
    if (!q.has('r')) return false;

    var el;
    el = document.getElementById('rapport');
    if (el && q.has('r')) el.value = q.get('r');

    el = document.getElementById('precision');
    if (el && q.has('p')) el.value = q.get('p');

    el = document.getElementById('etages');
    if (el && q.has('e')) el.value = q.get('e');

    el = document.getElementById('max_solutions');
    if (el && q.has('s')) el.value = q.get('s');

    if (q.has('t')) {
      var activeTypes = q.get('t').split(',');
      document.querySelectorAll('.type-checkbox').forEach(function (cb) {
        cb.checked = activeTypes.indexOf(cb.value) !== -1;
      });
    }

    if (q.has('amin') && q.has('amax')) {
      var sliderMenante = document.getElementById('dent_menante_slider');
      if (sliderMenante && sliderMenante.noUiSlider) {
        sliderMenante.noUiSlider.set([parseFloat(q.get('amin')), parseFloat(q.get('amax'))]);
      }
    }
    if (q.has('bmin') && q.has('bmax')) {
      var sliderMenee = document.getElementById('dent_menee_slider');
      if (sliderMenee && sliderMenee.noUiSlider) {
        sliderMenee.noUiSlider.set([parseFloat(q.get('bmin')), parseFloat(q.get('bmax'))]);
      }
    }

    var reductionEl = document.getElementById('reduction_only');
    if (reductionEl) reductionEl.checked = q.get('red') === '1';

    if (q.has('mod')) {
      el = document.getElementById('module');
      if (el) el.value = q.get('mod');
    }
    if (q.has('fa')) {
      el = document.getElementById('dent_menante_fixe');
      if (el) el.value = q.get('fa');
    }
    if (q.has('fb')) {
      el = document.getElementById('dent_menee_fixe');
      if (el) el.value = q.get('fb');
    }
    if(q.has('expert')){try{var expert=JSON.parse(q.get('expert'));SearchParams._pendingExpert=expert;Object.keys(expert).forEach(function(id){var field=document.getElementById(id);if(field){if(field.type==='checkbox')field.checked=!!expert[id];else field.value=expert[id];}});}catch(ignore){/* Ignore malformed shared expert state. */}}

    return true;
  };

  // ===== Presets =====

  SearchParams.getPresets = function () {
    return PRESETS;
  };

  SearchParams.applyPreset = function (presetId) {
    var preset = PRESETS[presetId];
    if (!preset) return;

    var el;
    el = document.getElementById('rapport');
    if (el) el.value = preset.rapport;
    el = document.getElementById('precision');
    if (el) el.value = preset.precision;
    el = document.getElementById('etages');
    if (el) el.value = preset.maxEtages;
    el = document.getElementById('max_solutions');
    if (el) el.value = preset.maxSolutions;

    if (preset.typesActifs) {
      document.querySelectorAll('.type-checkbox').forEach(function (cb) {
        cb.checked = preset.typesActifs.indexOf(cb.value) !== -1;
      });
    }

    if (preset.dentMenanteSlider) {
      var sliderMenante = document.getElementById('dent_menante_slider');
      if (sliderMenante && sliderMenante.noUiSlider) {
        sliderMenante.noUiSlider.set(preset.dentMenanteSlider);
      }
    }
    if (preset.dentMeneeSlider) {
      var sliderMenee = document.getElementById('dent_menee_slider');
      if (sliderMenee && sliderMenee.noUiSlider) {
        sliderMenee.noUiSlider.set(preset.dentMeneeSlider);
      }
    }

    var reductionEl = document.getElementById('reduction_only');
    if (reductionEl && preset.reductionOnly !== undefined) {
      reductionEl.checked = preset.reductionOnly;
    }
  };

  // ===== Export/Import JSON =====

  SearchParams.exportJSON = function () {
    var params = SearchParams.fromForm();
    var blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gear-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  SearchParams.importJSON = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          if (data.rapportCible) {
            var el2 = document.getElementById('rapport');
            if (el2) el2.value = data.rapportCible;
          }
          if (data.precision) {
            var el3 = document.getElementById('precision');
            if (el3) el3.value = data.precision;
          }
          if (data.maxEtages) {
            var el4 = document.getElementById('etages');
            if (el4) el4.value = data.maxEtages;
          }
          if (data.typesActifs && Array.isArray(data.typesActifs)) {
            document.querySelectorAll('.type-checkbox').forEach(function (cb) {
              cb.checked = data.typesActifs.indexOf(cb.value) !== -1;
            });
          }
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  };

  GearApp.models.SearchParams = SearchParams;

})(GearApp);
