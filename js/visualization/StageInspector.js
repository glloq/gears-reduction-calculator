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
      bendingSafety: mech.bending && mech.bending.safetyFactor, contactSafety: mech.contact && mech.contact.safetyFactor,
      // La géométrie, les paramètres et les efforts de CET étage : le bloc de
      // famille et le bloc d'efforts les lisent, ils ne les recalculent pas.
      stage: stage, geometry: geometry, parameters: stage.parameters || {}, forces: mech.forces || null,
      warnings: (solution && solution.warnings || []).filter(function (w) {
        return finite(w.stageIndex) ? w.stageIndex === index : finite(w.stage) ? w.stage - 1 === index : false;
      }) };
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

  /**
   * Ce qu'il faut savoir d'un étage, PAR FAMILLE.
   *
   * Le planétaire et la vis sans fin avaient déjà leur bloc — ce sont les deux
   * familles dont la denture seule ne dit rien. Les autres retombaient sur une
   * fiche générique, où « 18 → 54 » et un rapport étaient tout ce qu'on
   * obtenait : ni l'angle d'hélice qui décide de l'effort axial, ni l'angle
   * d'enroulement qui décide de la capacité d'une courroie, ni la course par
   * tour d'une crémaillère, qui est pourtant la raison de l'avoir choisie.
   *
   * Ces grandeurs sont déjà calculées ; elles n'étaient affichées nulle part.
   * Les mettre ici, dans l'étage sélectionné, évite d'en couvrir le dessin.
   */
  var FAMILY_ROWS = {
    spur: function (d) {
      return [['Angle de pression α', format(d.geometry.pressureAngleDeg, 1, '°')],
        ['Rapport de conduite', format(d.geometry.totalContactRatio, 2)]];
    },
    helical: function (d) {
      var beta = finite(d.parameters.helixAngle) ? d.parameters.helixAngle : null;
      return [['Angle d’hélice β', format(beta, 1, '°')],
        ['Angle de pression α', format(d.geometry.transversePressureAngleDeg, 1, '°')],
        ['Recouvrement', format(d.geometry.overlapContactRatio, 2)],
        ['Rapport de conduite', format(d.geometry.totalContactRatio, 2)],
        // L'hélice CRÉE l'effort axial : c'est le prix du silence, et il se
        // paie en roulements.
        ['Effort axial induit', finite(d.forces && d.forces.axialN)
          ? format(Math.abs(d.forces.axialN), 0, ' N') + ' — prévoir une butée' : null]];
    },
    internal: function (d) {
      return [['Denture', 'intérieure — même sens d’entrée et de sortie'],
        ['Angle de pression α', format(d.geometry.pressureAngleDeg, 1, '°')],
        ['Rapport de conduite', format(d.geometry.totalContactRatio, 2)]];
    },
    bevel: function (d) {
      return [['Angle des arbres', format(d.geometry.shaftAngleDeg, 1, '°')],
        ['Cône menant δ₁', format(d.geometry.pitchConeAngleInput, 1, '°')],
        ['Cône mené δ₂', format(d.geometry.pitchConeAngleOutput, 1, '°')],
        ['Distance conique', format(d.geometry.coneDistance, 2, ' mm')]];
    },
    belt: function (d) {
      return [['Profil', d.parameters.profile || null],
        ['Pas', format(d.parameters.pitch, 1, ' mm')],
        ['Longueur', format(d.geometry.actualLength || d.geometry.length, 1, ' mm')],
        ['Dents de courroie', finite(d.geometry.beltTeeth) ? String(d.geometry.beltTeeth) : null],
        // Sous 120°, la petite poulie n'engrène plus assez de dents pour
        // transmettre le couple annoncé.
        ['Enroulement petite poulie', finite(d.geometry.wrapAngleDeg)
          ? format(d.geometry.wrapAngleDeg, 1, '°') + (d.geometry.wrapAngleDeg < 120 ? ' — faible' : '') : null]];
    },
    chain: function (d) {
      return [['Pas', format(d.parameters.pitch, 2, ' mm')],
        ['Maillons', finite(d.geometry.links) ? String(d.geometry.links) : null],
        ['Longueur', format(d.geometry.actualLength || d.geometry.length, 1, ' mm')],
        ['Entraxe corrigé', format(d.geometry.correctedCenterDistance, 2, ' mm')]];
    },
    rack: function (d) {
      return [['Pignon', finite(d.stage.pinionTeeth) ? d.stage.pinionTeeth + ' dents' : null, origin(d, 'pinionTeeth')],
        ['Course par tour', format(d.geometry.travelPerRevolution, 2, ' mm/tr')],
        ['Vitesse linéaire', format(d.geometry.linearSpeedMmMin, 0, ' mm/min')],
        // Sur une crémaillère, la grandeur utile n'est pas un couple mais une
        // force : c'est elle qui décide si la charge avance.
        ['Force de poussée', finite(d.forces && d.forces.tangentialN)
          ? format(d.forces.tangentialN, 0, ' N') : null]];
    }
  };

  /** Le bloc de famille de cet étage, ou rien si la famille n'en a pas. */
  function familyRows(data) {
    var builder = FAMILY_ROWS[data.type];
    if (!builder) return null;
    try { return builder(data); } catch (ignore) { return null; }
  }

  /**
   * Les efforts, CHIFFRÉS. L'overlay graphique donne leur direction et leur
   * importance relative ; leurs valeurs n'étaient lisibles qu'en infobulle. Sur
   * un hélicoïdal, un conique ou une vis, c'est l'effort axial qui dimensionne
   * les roulements — un nombre qu'on relève, pas une flèche qu'on estime.
   */
  function forceRows(data) {
    var f = data.forces;
    if (!f || !finite(f.tangentialN)) return null;
    return [['Tangentiel Ft', format(Math.abs(f.tangentialN), 0, ' N')],
      ['Radial Fr', finite(f.radialN) ? format(Math.abs(f.radialN), 0, ' N') : null],
      ['Axial Fa', finite(f.axialN) ? format(Math.abs(f.axialN), 0, ' N') : null]];
  }

  function Inspector(container, options) { this.container = container; this.options = options || {}; this.solution = null; this.element = null; }
  Inspector.prototype.setSolution = function (solution, scene, model) {
    this.solution = solution;
    this.scene = scene || null;
    // Le MODÈLE DESSINÉ : arbres, organes, étages tels que la vue les a posés.
    // L'inspecteur ne savait parler que d'étages, et n'avait donc besoin que de
    // la solution ; désigner un arbre demande de savoir ce qu'il porte, et
    // c'est le modèle qui le sait.
    this.model = model || null;
    return this;
  };
  Inspector.prototype._element = function () {
    if (this.element && this.element.isConnected) return this.element;
    // §6 : la page fournit un emplacement DOCKÉ, à côté du dessin. L'inspecteur
    // s'y installe plutôt que de se créer dans le conteneur SVG : une carte
    // flottante masquait la pièce qu'on venait de choisir, et le conteneur est
    // vidé à chaque rendu, ce qui obligeait à la rattacher sans cesse.
    var docked = typeof document !== 'undefined' ? document.getElementById('stageInspector') : null;
    if (docked) { this.element = docked; return docked; }
    if (this.element) { this.container.appendChild(this.element); return this.element; }
    // Repli : monté sur un conteneur nu (harnais de test, intégration), il se
    // crée son propre panneau. L'identifiant est un contrat public — les e2e et
    // les scripts ciblent #stageInspector / #stageInspectorEdit.
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
    var family = familyRows(data), efforts = forceRows(data);
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
      // Ce que cette FAMILLE-ci demande de savoir. Planétaire et vis ont leur
      // bloc juste au-dessus ; les autres n'avaient rien, et se lisaient donc
      // toutes de la même façon — « 18 → 54 » et un rapport.
      family ? { title: familyName(data.type, this.options.registry), rows: family } : null,
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
      efforts ? { title: 'Efforts', rows: efforts } : null,
      { title: 'Rendement', rows: [
        ['Étage', finite(data.efficiency) ? format(data.efficiency * 100, 1, ' %') : null]
      ] },
      // §12 : la cause, à l'endroit où le badge « ! » conduit. Sans cela il
      // désignait un étage sans dire ce qu'on lui reprochait.
      data.warnings && data.warnings.length ? { title: 'Avertissements', rows:
        data.warnings.map(function (w) {
          return [w.message || w.code, w.recommendation || '—'];
        }) } : null,
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
  /**
   * Poser une fiche : un en-tête, des groupes, un bouton d'action.
   *
   * Les quatre fiches — étage, organe, arbre, engrènement — partagent la même
   * charpente. Ce qui change est ce qu'on y met, et c'est bien la seule chose
   * qui doit changer : quatre mises en page différentes pour quatre objets du
   * même dessin donneraient quatre écrans à apprendre.
   */
  Inspector.prototype._card = function (options) {
    var card = this._element(), self = this;
    card.textContent = '';
    var header = document.createElement('header');
    var title = document.createElement('span');
    title.className = 'type-badge ' + (options.badge || 'selection');
    title.textContent = options.title;
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'btn-small';
    close.setAttribute('aria-label', 'Fermer'); close.textContent = '✕';
    header.appendChild(title); header.appendChild(close); card.appendChild(header);
    if (options.subtitle) {
      var lead = document.createElement('p');
      lead.className = 'inspector-lead';
      lead.textContent = options.subtitle;
      card.appendChild(lead);
    }
    var grid = document.createElement('div');
    grid.className = 'inspector-grid';
    (options.groups || []).filter(Boolean).forEach(function (group) {
      var rows = (group.rows || []).filter(function (row) { return row[1] != null && row[1] !== ''; });
      if (!rows.length) return;
      if (group.title) {
        var heading = document.createElement('h4');
        heading.className = 'inspector-group';
        heading.textContent = group.title;
        grid.appendChild(heading);
      }
      rows.forEach(function (row) {
        var line = document.createElement('div');
        var label = document.createElement('span');
        var value = document.createElement('strong');
        label.textContent = row[0]; value.textContent = row[1];
        line.appendChild(label); line.appendChild(value); grid.appendChild(line);
      });
    });
    card.appendChild(grid);
    (options.actions || []).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-small' + (action.primary ? ' btn-primary' : '');
      if (action.id) button.id = action.id;
      button.textContent = action.label;
      button.addEventListener('click', action.run);
      card.appendChild(button);
    });
    card.hidden = false;
    close.addEventListener('click', function () { self.hide(); if (self.options.onClose) self.options.onClose(-1); });
    return card;
  };

  /** L'organe dessiné qui porte cet identifiant, avec son numéro d'exemplaire. */
  Inspector.prototype._wheel = function (memberId, instance) {
    var wheels = (this.model && this.model.wheels) || [];
    var matches = wheels.filter(function (wheel) { return wheel.memberId === memberId; });
    if (instance != null) {
      var exact = matches.filter(function (wheel) { return wheel.instance === instance; });
      if (exact.length) return exact[0];
    }
    return matches[0] || null;
  };

  /**
   * L'ORGANE : ce qu'il est, comment il est taillé, sur quel arbre il tourne.
   *
   * C'est la fiche qui manquait le plus : cliquer une roue répondait « étage 2 »
   * quand la question était « quelle roue, et à quelle vitesse ? ».
   */
  Inspector.prototype.showMember = function (selection) {
    var wheel = this._wheel(selection.id, selection.instance);
    if (!wheel) return this.show(selection.stageIndex == null ? 0 : selection.stageIndex);
    var member = this.scene && this.scene.member ? this.scene.member(selection.id) : null;
    var mechanical = (member && member.mechanical) || {};
    var stageIndex = selection.stageIndex;
    var shaft = ((this.model && this.model.shafts) || []).filter(function (entry) {
      return entry.id === wheel.bodyId;
    })[0];
    var self = this;
    var name = wheel.memberName || (member && member.memberName) ||
      kindLabel(wheel.kind) || 'Organe';
    this._card({
      badge: 'member',
      title: name,
      subtitle: wheel.localizedRole || (member && member.localizedRole) || null,
      groups: [
        { rows: [
          ['Type', kindLabel(wheel.kind)],
          ['Dents', finite(wheel.teeth) ? String(wheel.teeth) : null],
          ['Module', finite(wheel.module) ? wheel.module + ' mm' : null],
          ['Ø primitif', format(wheel.pitchD, 2, ' mm')],
          ['Ø tête', format(wheel.outsideD, 2, ' mm')],
          ['Largeur b', format(wheel.faceWidth, 1, ' mm')],
          ['Angle d’hélice β', finite(wheel.helixAngle) && wheel.helixAngle ? format(wheel.helixAngle, 1, '°') : null]
        ] },
        { title: 'Mouvement', rows: [
          ['Vitesse', finite(mechanical.rpm) ? format(Math.abs(mechanical.rpm), 0, ' rpm ') + (mechanical.rpm < 0 ? '↻' : '↺') : null],
          ['Vitesse relative', finite(wheel.speed) ? format(wheel.speed, 3, ' ×') : null],
          ['Couple', format(mechanical.torque, 1, ' N·m')]
        ] },
        { title: 'Montage', rows: [
          ['Arbre', shaft ? shaftLabel(shaft, (this.model && this.model.shafts) || []) : null],
          ['Solidaire de', shaft && shaft.memberNames && shaft.memberNames.length > 1
            ? shaft.memberNames.filter(function (other) { return other !== name; }).join(', ') : null],
          ['Étage', stageIndex == null ? null : 'Étage ' + (stageIndex + 1)],
          ['Vue', presentationLabel(wheel.presentation)]
        ] }
      ],
      actions: [
        // Vu en bout, un arbre est un POINT, caché par la roue qui l'entoure :
        // il n'y a alors aucun endroit où le cliquer. La fiche de l'organe y
        // mène, ce qui le rend atteignable dans toutes les vues.
        stageIndex == null ? null : { label: 'Voir l’étage',
          run: function () { if (self.options.onSelectStage) self.options.onSelectStage(stageIndex); } },
        // Vu en bout, un arbre est un POINT, caché par la roue qui l'entoure :
        // il n'y a alors aucun endroit où le cliquer. La fiche de l'organe y
        // mène, ce qui le rend atteignable dans toutes les vues.
        shaft ? { label: 'Voir l’arbre',
          run: function () { if (self.options.onSelectShaft) self.options.onSelectShaft(shaft.id); } } : null,
        stageIndex == null ? null : { label: 'Modifier cet étage', id: 'stageInspectorEdit', primary: true,
          run: function () { if (self.options.onEdit) self.options.onEdit(stageIndex); } }
      ].filter(Boolean)
    });
    return this;
  };

  /**
   * L'ARBRE : un corps tournant, sa vitesse, et TOUT ce qu'il porte.
   *
   * Aucune fiche ne parlait de lui, alors que c'est l'objet qu'on dimensionne :
   * savoir que deux roues sont solidaires demandait de relire les étages un
   * à un.
   */
  Inspector.prototype.showShaft = function (selection) {
    var shaft = ((this.model && this.model.shafts) || []).filter(function (entry) {
      return entry.id === selection.id;
    })[0];
    if (!shaft) return this.hide();
    var wheels = ((this.model && this.model.wheels) || []).filter(function (wheel) {
      return wheel.bodyId === shaft.id;
    });
    var speeds = wheels.map(function (wheel) {
      var member = this.scene && this.scene.member ? this.scene.member(wheel.memberId) : null;
      return member && finite(member.mechanical.rpm) ? member.mechanical.rpm : null;
    }, this).filter(function (rpm) { return rpm != null; });
    var rpm = speeds.length ? speeds[0] : null;
    this._card({
      badge: 'shaft',
      title: shaftLabel(shaft, (this.model && this.model.shafts) || []),
      subtitle: shaft.grounded ? 'Bloqué sur le bâti' : null,
      groups: [
        { rows: [
          ['Vitesse', finite(rpm) ? format(Math.abs(rpm), 0, ' rpm ') + (rpm < 0 ? '↻' : '↺')
            : (shaft.grounded ? '0 rpm' : null)],
          ['Organes portés', String(shaft.memberIds ? shaft.memberIds.length : wheels.length)]
        ] },
        { title: 'Porte', rows: (shaft.memberNames || []).map(function (label, index) {
          var wheel = wheels[index];
          return [label, wheel && finite(wheel.teeth) ? wheel.teeth + ' dents' : '—'];
        }) }
      ],
      actions: []
    });
    return this;
  };

  /**
   * L'ENGRÈNEMENT : le couple de roues, son rapport, son entraxe, ses efforts.
   *
   * C'est l'endroit où la puissance passe d'un arbre à l'autre — et donc la
   * seule maille à laquelle « Ft, Fr, Fa » veut dire quelque chose.
   */
  Inspector.prototype.showMesh = function (selection) {
    var index = selection.stageIndex == null
      ? Number(String(selection.id).replace(/\D/g, '')) : selection.stageIndex;
    var data = model(this.solution, index, this.options.registry, this.scene);
    if (!data) return this.hide();
    var wheels = ((this.model && this.model.stages) || [])[index];
    var pair = wheels ? wheels.wheels.filter(function (wheel) { return wheel.role !== 'planet'; }) : [];
    var self = this;
    var efforts = forceRows(data);
    this._card({
      badge: 'mesh',
      title: 'Engrènement de l’étage ' + (index + 1),
      subtitle: familyName(data.type, this.options.registry),
      groups: [
        { rows: [
          ['Roues', pair.length >= 2 && finite(pair[0].teeth) && finite(pair[1].teeth)
            ? pair[0].teeth + ' ↔ ' + pair[1].teeth + ' dents' : (data.teeth.join(' ↔ ') || null)],
          ['Rapport', format(data.ratio, 3, ' : 1')],
          ['Entraxe', format(data.centerDistance, 2, ' mm')],
          ['Module', finite(data.module) ? data.module + ' mm' : null],
          ['Rendement', finite(data.efficiency) ? format(data.efficiency * 100, 1, ' %') : null]
        ] },
        efforts ? { title: 'Efforts', rows: efforts } : null,
        { title: 'Sécurité', rows: [
          ['SF flexion', format(data.bendingSafety, 2)],
          ['SH contact', format(data.contactSafety, 2)]
        ] }
      ],
      actions: [
        { label: 'Voir l’étage', run: function () { if (self.options.onSelectStage) self.options.onSelectStage(index); } },
        { label: 'Modifier cet étage', id: 'stageInspectorEdit', primary: true,
          run: function () { if (self.options.onEdit) self.options.onEdit(index); } }
      ]
    });
    return this;
  };

  /**
   * Ce que la SÉLECTION demande de montrer.
   *
   * Un seul point d'entrée : la fiche suit ce qui est désigné, au lieu que
   * chaque appelant décide lui-même de quelle fiche il a besoin.
   */
  Inspector.prototype.showSelection = function (selection) {
    var current = selection || { type: null };
    if (!current.type) return this.hide();
    if (current.type === 'member') return this.showMember(current);
    if (current.type === 'shaft') return this.showShaft(current);
    if (current.type === 'mesh') return this.showMesh(current);
    return this.show(Number(current.id));
  };

  /**
   * Le nom d'un arbre, tel qu'on le désigne à l'écran.
   *
   * Jamais son identifiant interne : « shaft-2-C » ne se lit pas, et la règle
   * de la maison est que ce qui vient du code reste dans le code. Un arbre se
   * nomme par son RÔLE, et par un rang quand plusieurs partagent le même.
   */
  /**
   * Le nom français d'un TYPE D'ORGANE.
   *
   * `familyName` nomme une FAMILLE de transmission — « Droit », « Vis sans
   * fin » —, pas une pièce. Lui passer le genre d'un organe rendait son
   * identifiant interne tel quel : la fiche affichait « Famille gear ».
   */
  var MEMBER_KINDS = { gear: 'Roue dentée', 'internal-ring': 'Couronne intérieure',
    pulley: 'Poulie', sprocket: 'Pignon de chaîne', worm: 'Vis sans fin',
    cone: 'Roue conique', rack: 'Crémaillère', carrier: 'Porte-satellites' };
  function kindLabel(kind) { return MEMBER_KINDS[kind] || null; }

  var SHAFT_ROLES = { input: 'Arbre d’entrée', output: 'Arbre de sortie', driven: 'Arbre mené',
    planet: 'Axe de satellite', fixed: 'Corps bloqué', intermediate: 'Arbre intermédiaire' };
  function shaftLabel(shaft, shafts) {
    if (!shaft) return null;
    var name = SHAFT_ROLES[shaft.role] || 'Arbre';
    var peers = (shafts || []).filter(function (other) { return other.role === shaft.role; });
    if (peers.length < 2) return name;
    var rank = peers.indexOf(shaft) + 1;
    return name + ' ' + (rank > 0 ? rank : peers.length);
  }

  /** Comment cet organe se présente, en français. */
  var PRESENTATIONS = { face: 'de face', profile: 'par la tranche', oblique: 'de biais' };
  function presentationLabel(presentation) { return PRESENTATIONS[presentation] || null; }

  return { Inspector: Inspector, model: model, shaftLabel: shaftLabel, kindLabel: kindLabel };
});
