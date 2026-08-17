/* Inspecteur d'étage partagé par les vues de visualisation. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearStageInspector = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function finite(v) { return Number.isFinite(v); }
  function format(v, digits, suffix) { return finite(v) ? v.toFixed(digits == null ? 2 : digits) + (suffix || '') : null; }
  /**
   * Les vitesses viennent de la SCÈNE quand elle est fournie : l'inspecteur ne
   * refait pas la cascade des rapports, il lit le même moteur cinématique que
   * les trois vues. La reconstruction locale ne subsiste qu'en dernier recours.
   */
  function model(solution, index, registry, scene) {
    var stage = (solution && solution.stages || [])[index], mech = (solution && solution.mechanical || [])[index] || {};
    if (!stage) return null;
    var geometry = stage.geometry || mech.geometry || {}, teeth = [];
    try { teeth = registry && registry.getToothCounts ? registry.getToothCounts(stage) : []; } catch (e) { teeth = []; }
    var inputRpm = null, outputRpm = null;
    // §8 : l'inspecteur cherchait « s2-input, sinon s2-S » — c'est-à-dire qu'il
    // tenait le solaire pour l'entrée et le porte-satellites pour la sortie,
    // quelle que soit la topologie réelle. La scène connaît les fonctions ;
    // on les lui demande, et le repli par position ne sert qu'aux scènes
    // anciennes qui ne les portent pas encore.
    var driving = null, driven = null, held = null;
    if (scene && scene.functionalMember) {
      driving = scene.functionalMember(index, 'input');
      driven = scene.functionalMember(index, 'output');
      held = scene.functionalMember(index, 'fixed');
    }
    if (scene && scene.member) {
      driving = driving || scene.member('s' + index + '-input');
      driven = driven || scene.member('s' + index + '-output');
    }
    if (driving && finite(driving.mechanical.rpm)) inputRpm = driving.mechanical.rpm;
    if (driven && finite(driven.mechanical.rpm)) outputRpm = driven.mechanical.rpm;
    if (!finite(inputRpm)) {
      inputRpm = index === 0 ? solution.inputSpeedRpm : null;
      if (!finite(inputRpm) && finite(solution.inputSpeedRpm)) inputRpm = solution.inputSpeedRpm / (solution.mechanical || []).slice(0, index).reduce(function (r, m) { return r * (Math.abs(m.ratio) || 1); }, 1);
    }
    if (!finite(outputRpm)) outputRpm = finite(inputRpm) && finite(mech.ratio) ? inputRpm / Math.abs(mech.ratio) : null;
    // §8, §21 : la topologie fonctionnelle d'un planétaire EST son
    // information principale — « 20 → 30 → 80 » ne dit pas qui mène.
    var topology = null;
    if (stage.type === 'planetary' || stage.type === 'epicyclic') {
      topology = { input: driving || null, output: driven || null, fixed: held || null,
        sunTeeth: stage.sunTeeth, planetTeeth: stage.planetTeeth, ringTeeth: stage.ringTeeth,
        planetCount: Math.max(2, Math.round(finite(stage.planetCount) ? stage.planetCount : 3)) };
      // §20 : le rapport de base et les conditions de montage sont calculés
      // par le registre — l'inspecteur affiche, il ne refait pas la mécanique.
      try {
        if (registry && registry.planetaryDetails) topology.details = registry.planetaryDetails(stage);
      } catch (ignore) { topology.details = null; }
    }
    // §16 : la fiche doit connaître la FAMILLE. Une vis sans fin se choisit
    // très souvent pour tenir une charge à l'arrêt, et une fiche générique
    // laissait de côté la seule raison de l'avoir prise.
    var worm = null;
    if (stage.type === 'worm') {
      try { worm = registry && registry.wormDetails ? registry.wormDetails(stage) : null; }
      catch (ignore) { worm = null; }
    }
    // §24 : d'où vient chaque valeur, quand la solution le sait.
    var origin = (solution && solution.origin && solution.origin[index]) || null;
    return { index: index, type: stage.type, topology: topology, worm: worm, origin: origin,
      teeth: teeth.filter(function (v) { return finite(v) && v > 0; }), ratio: mech.ratio,
      efficiency: mech.efficiency, centerDistance: geometry.centerDistance, module: stage.parameters && stage.parameters.module,
      inputRpm: inputRpm, outputRpm: outputRpm, inputTorque: mech.inputTorqueNm, outputTorque: mech.outputTorqueNm || mech.torqueNm,
      bendingSafety: mech.bending && mech.bending.safetyFactor, contactSafety: mech.contact && mech.contact.safetyFactor };
  }
  /** Nom lisible d'une famille : le registre fait foi, jamais `stage.type`. */
  function familyName(type, registry) {
    try {
      if (registry && registry.familyName) return registry.familyName(type);
    } catch (ignore) { /* registre absent : on retombe sur l'identifiant */ }
    return type;
  }

  /**
   * §24 : « 🔒 votre valeur » ou « ✨ proposée ». Sur une chaîne complétée,
   * « 20 → 60 » ne dit pas que le 20 venait d'une roue déjà taillée et que le 60
   * est une proposition du solveur — or c'est exactement ce qu'on veut vérifier
   * avant de fabriquer quoi que ce soit.
   */
  var ORIGIN_MARKS = {
    pinned: { mark: ' 🔒', title: 'Valeur que vous avez imposée' },
    found: { mark: ' ✨', title: 'Valeur proposée par le solveur' }
  };

  function origin(data, path) {
    if (!data.origin) return null;
    return data.origin.fields && data.origin.fields[path] ? 'pinned' : 'found';
  }

  /** « Solaire (S) · 1500 rpm ↺ » — organe, code, et ce qu'il fait. */
  function memberLine(entry) {
    if (!entry) return null;
    var code = entry.role ? ' (' + entry.role + ')' : '';
    var name = (entry.memberName || entry.role || '') + code;
    var rpm = entry.mechanical && entry.mechanical.rpm;
    if (!finite(rpm)) return name;
    if (Math.abs(rpm) < 1e-6) return name + ' · immobile';
    return name + ' · ' + Math.abs(rpm).toFixed(0) + ' rpm ' + (rpm < 0 ? '↻' : '↺');
  }

  /** Vitesse d'un organe VUE DU PORTE-SATELLITES : c'est le repère de Willis. */
  function relativeLine(details, code) {
    var relative = details && details.relativeToCarrier;
    if (!relative || !finite(relative[code])) return null;
    return (relative[code] >= 0 ? '+' : '') + relative[code].toFixed(3) + ' × ω entrée';
  }

  /** « 30 ✓ » ou « 30,5 ✗ entier attendu » — la condition et son verdict. */
  function conditionLine(condition, requirement) {
    if (!condition || !finite(condition.value)) return null;
    var value = Number.isInteger(condition.value) ? String(condition.value) : condition.value.toFixed(2);
    return value + (condition.satisfied ? ' ✓' : ' ✗ ' + requirement);
  }

  function Inspector(container, options) { this.container = container; this.options = options || {}; this.solution = null; this.element = null; }
  Inspector.prototype.setSolution = function (solution, scene) { this.solution = solution; this.scene = scene || null; return this; };
  Inspector.prototype._element = function () {
    if (this.element && this.element.isConnected) return this.element;
    if (this.element) { this.container.appendChild(this.element); return this.element; }
    // L'identifiant est un contrat public : les e2e et les scripts d'intégration
    // ciblent #stageInspector / #stageInspectorEdit, quelle que soit la vue.
    var card = document.createElement('aside'); card.id = 'stageInspector'; card.className = 'stage-inspector';
    card.hidden = true; card.setAttribute('aria-live', 'polite');
    this.container.appendChild(card); this.element = card; return card;
  };
  Inspector.prototype.hide = function () { if (this.element) this.element.hidden = true; };
  Inspector.prototype.show = function (index) {
    var data = model(this.solution, index, this.options.registry, this.scene); if (!data) return;
    var card = this._element(), self = this; card.textContent = '';
    // §19 : les identifiants anglais restent dans le code, jamais à l'écran.
    var header = document.createElement('header'), title = document.createElement('span');
    title.className = 'type-badge ' + data.type;
    title.textContent = (index + 1) + ' · ' + familyName(data.type, this.options.registry);
    var close = document.createElement('button'); close.type = 'button'; close.className = 'btn-small'; close.setAttribute('aria-label', 'Fermer'); close.textContent = '✕'; header.appendChild(title); header.appendChild(close); card.appendChild(header);
    // Groupes thématiques plutôt qu'une liste plate : on lit d'abord ce que
    // fait l'étage, ensuite comment il est taillé. Un groupe sans donnée
    // fiable n'est pas affiché du tout.
    var grid = document.createElement('div'); grid.className = 'inspector-grid';
    var topology = data.topology, worm = data.worm;
    var GROUPS = [
      { title: null, rows: [
        // Pour un planétaire comme pour une vis, la denture seule ne dit rien :
        // c'est la topologie, ou l'angle d'avance, qui définit le mécanisme. Le
        // bloc de famille les porte, et cette ligne ferait doublon.
        // « 20 → 60 » suffit tant qu'on ne sait pas d'où viennent les valeurs.
        // Dès qu'on le sait, les deux se séparent : leurs provenances diffèrent,
        // et « 20 imposé, 60 proposé » est le cas normal d'une chaîne complétée.
        ['Dents', topology || worm || data.origin ? null : (data.teeth.join(' → ') || null)],
        ['Menante', topology || worm || !data.origin || !finite(data.teeth[0]) ? null
          : data.teeth[0] + ' dents', origin(data, 'input.teeth')],
        ['Menée', topology || worm || !data.origin || !finite(data.teeth[1]) ? null
          : data.teeth[1] + ' dents', origin(data, 'output.teeth')],
        ['Rapport', format(data.ratio, 3, ' : 1')]
      ] },
      topology ? { title: 'Architecture', rows: [
        ['Entrée', memberLine(topology.input)],
        ['Fixe', memberLine(topology.fixed)],
        ['Sortie', memberLine(topology.output)]
      ] } : null,
      topology ? { title: 'Denture', rows: [
        ['Solaire', finite(topology.sunTeeth) ? topology.sunTeeth + ' dents' : null, origin(data, 'sunTeeth')],
        ['Satellites', finite(topology.planetTeeth) ? topology.planetTeeth + ' dents × ' + topology.planetCount : null],
        ['Couronne', finite(topology.ringTeeth) ? topology.ringTeeth + ' dents' : null, origin(data, 'ringTeeth')]
      ] } : null,
      // §20 : deux trains aux mêmes dentures donnent des rapports opposés
      // selon l'organe bloqué. Ce qui explique le rapport, c'est Willis et le
      // rapport de base — pas la liste des dents.
      topology && topology.details ? { title: 'Cinématique', rows: [
        ['Relation', '(ωS − ωC) / (ωR − ωC) = r₀'],
        ['Rapport de base r₀', format(topology.details.basicRatio, 3)],
        ['Solaire / porte-sat.', relativeLine(topology.details, 'S')],
        ['Couronne / porte-sat.', relativeLine(topology.details, 'R')]
      ] } : null,
      topology && topology.details ? { title: 'Montage', rows: [
        ['Coaxialité (Zr − Zs)/2', conditionLine(topology.details.coaxial, 'entier attendu')],
        ['Équirépartition (Zs + Zr)/n', conditionLine(topology.details.assembly, 'entier attendu')]
      ] } : null,
      worm ? { title: 'Vis', rows: [
        ['Filets', finite(worm.starts) ? worm.starts + (worm.starts > 1 ? ' filets' : ' filet') : null, origin(data, 'wormStarts')],
        ['Roue', finite(worm.wheelTeeth) ? worm.wheelTeeth + ' dents' : null, origin(data, 'wheelTeeth')],
        ['Angle d’avance γ', format(worm.leadAngleDeg, 1, '°')],
        // C'est l'angle d'avance face au frottement qui décide du maintien de
        // charge, pas la famille : une vis n'est pas irréversible par nature.
        ['Maintien de charge', worm.selfLocking
          ? 'irréversible (tan γ < μ)'
          : 'rétro-entraînable, η inverse ' + format(worm.backDrivingEfficiency * 100, 0, ' %')]
      ] } : null,
      { title: 'Entrée', rows: [
        ['Vitesse', finite(data.inputRpm) ? format(Math.abs(data.inputRpm), 0, ' rpm') : null],
        ['Couple', format(data.inputTorque, 1, ' N·m')]
      ] },
      { title: 'Sortie', rows: [
        ['Vitesse', finite(data.outputRpm) ? format(Math.abs(data.outputRpm), 0, ' rpm ') + (data.outputRpm < 0 ? '↻' : '↺') : null],
        ['Couple', format(data.outputTorque, 1, ' N·m')]
      ] },
      { title: 'Géométrie', rows: [
        ['Module', finite(data.module) ? data.module + ' mm' : null],
        ['Entraxe', format(data.centerDistance, 2, ' mm')]
      ] },
      { title: 'Rendement', rows: [
        ['Étage', finite(data.efficiency) ? format(data.efficiency * 100, 1, ' %') : null]
      ] },
      { title: 'Sécurité', rows: [
        ['SF flexion', format(data.bendingSafety, 2)],
        ['SH contact', format(data.contactSafety, 2)]
      ] }
    ];
    GROUPS.filter(Boolean).forEach(function (group) {
      var rows = group.rows.filter(function (row) { return row[1] != null && row[1] !== ''; });
      if (!rows.length) return;
      if (group.title) {
        var heading = document.createElement('h4');
        heading.className = 'inspector-group';
        heading.textContent = group.title;
        grid.appendChild(heading);
      }
      rows.forEach(function (row) {
        var line = document.createElement('div'), label = document.createElement('span'), value = document.createElement('strong');
        label.textContent = row[0]; value.textContent = row[1];
        var provenance = row[2] && ORIGIN_MARKS[row[2]];
        if (provenance) {
          var mark = document.createElement('span');
          mark.className = 'value-origin origin-' + row[2];
          mark.textContent = provenance.mark;
          mark.title = provenance.title;
          value.appendChild(mark);
          line.dataset.origin = row[2];
        }
        line.appendChild(label); line.appendChild(value); grid.appendChild(line);
      });
    });
    card.appendChild(grid);
    var edit = document.createElement('button'); edit.type = 'button'; edit.id = 'stageInspectorEdit'; edit.className = 'btn-small btn-primary'; edit.textContent = 'Modifier cet étage'; card.appendChild(edit); card.hidden = false;
    close.addEventListener('click', function () { self.hide(); if (self.options.onClose) self.options.onClose(index); });
    edit.addEventListener('click', function () { if (self.options.onEdit) self.options.onEdit(index); });
  };
  return { Inspector: Inspector, model: model };
});
