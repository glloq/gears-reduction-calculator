/* Modèle graphique canonique, exclusivement dérivé des résultats du moteur.
 *
 * C'est ICI, et nulle part ailleurs, qu'on répond à « quelle est la géométrie du
 * membre X ? ». Les trois layouts consomment `scene.members` : ils ne relisent
 * plus `stage.geometry` chacun à leur façon.
 *
 * Chaque cote porte sa PROVENANCE :
 *   'engine'  → calculée par le moteur, exacte, cotable ;
 *   'derived' → reconstruite faute de mieux, à signaler comme schématique.
 * Aucune cote n'est inventée en silence.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./KinematicsEngine.js') : root.GearKinematicsEngine,
    common ? require('../../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry);
  if (common) module.exports = api; else root.GearSceneBuilder = api;
})(typeof self !== 'undefined' ? self : this, function (Kinematics, Registry) {
  'use strict';

  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  function compact(object) {
    Object.keys(object).forEach(function (k) { if (object[k] == null) delete object[k]; });
    return object;
  }

  /**
   * Accumulateur de cotes : `take` retient la valeur du moteur, `fallback`
   * retient une reconstruction et la marque comme telle.
   */
  function Dimensions() { this.values = {}; this.provenance = {}; }
  Dimensions.prototype.take = function (key, value) {
    if (Number.isFinite(value)) { this.values[key] = value; this.provenance[key] = 'engine'; }
    return this;
  };
  Dimensions.prototype.fallback = function (key, value) {
    if (this.values[key] == null && Number.isFinite(value)) { this.values[key] = value; this.provenance[key] = 'derived'; }
    return this;
  };
  Dimensions.prototype.exact = function (key) { return this.provenance[key] === 'engine'; };
  Dimensions.prototype.result = function () { return { geometry: compact(this.values), provenance: this.provenance }; };

  /**
   * §6, §7 : QUEL membre est l'entrée, la sortie, l'organe fixé. La question se
   * reposait dans chaque vue, à partir de l'ordre des roues ou d'un `role`
   * codant la position — si bien qu'un planétaire dont l'entrée est la couronne
   * était dessiné, inspecté et coté comme si le solaire menait. La scène
   * répond une fois pour toutes ; aucun renderer ne redéduit.
   *
   * `role` reste la POSITION dans l'étage (S/R/P/C, input/output, rack). C'est
   * `functionalRole` qui dit la FONCTION.
   */
  var MEMBER_NAMES = (Registry && Registry.MEMBER_NAMES) || {};

  var FUNCTION_NAMES = { input: 'Entrée', output: 'Sortie', fixed: 'Fixe', intermediate: 'Intermédiaire' };

  /** Les trois organes d'un planétaire, tels que l'étage les déclare. */
  function planetaryTopology(stage) {
    return {
      input: stage.inputMember || 'S',
      output: stage.outputMember || 'C',
      fixed: stage.fixed || 'R'
    };
  }

  /**
   * Fonction de chaque position, pour un étage donné.
   * @returns {object} position → 'input' | 'output' | 'fixed' | 'intermediate'
   */
  function functionalRoles(stage) {
    if (stage.type === 'planetary' || stage.type === 'epicyclic') {
      var topology = planetaryTopology(stage);
      var out = { S: 'intermediate', R: 'intermediate', P: 'intermediate', C: 'intermediate' };
      // Une position ne peut pas tenir deux fonctions : si l'étage est
      // incohérent, la dernière écrite gagne et la validation le signalera
      // ailleurs — la scène ne corrige pas, elle décrit.
      if (out[topology.fixed] !== undefined) out[topology.fixed] = 'fixed';
      if (out[topology.output] !== undefined) out[topology.output] = 'output';
      if (out[topology.input] !== undefined) out[topology.input] = 'input';
      return out;
    }
    if (stage.type === 'rack') return { input: 'input', rack: 'output' };
    return { input: 'input', output: 'output' };
  }

  /**
   * Comment la rotation de ce membre doit être REPRÉSENTÉE. C'est une décision
   * graphique, distincte du mouvement physique que calcule la cinématique :
   * une vis sans fin tourne bel et bien sur son axe, mais la dessiner en
   * tournant dans le plan de l'écran serait faux.
   */
  function rotationDisplayMode(stage, position, functional) {
    if (functional === 'fixed') return 'fixed';
    if (stage.type === 'rack') return position === 'rack' ? 'linear' : 'inPlane';
    if (stage.type === 'worm') return position === 'input' ? 'axialThreadPhase' : 'inPlane';
    if (stage.type === 'bevel') return 'facePhase';
    if ((stage.type === 'planetary' || stage.type === 'epicyclic') && position === 'P') return 'orbitAndSpin';
    return 'inPlane';
  }

  function member(id, stageIndex, role, kind, dims, kinematic, extra) {
    var built = dims.result();
    return Object.assign({ id: id, stageIndex: stageIndex, role: role, kind: kind,
      geometry: built.geometry, provenance: built.provenance,
      /** Vrai si la cote vient du moteur : seules celles-là sont cotables. */
      isExact: function (key) { return built.provenance[key] === 'engine'; },
      schematic: Object.keys(built.provenance).some(function (k) { return built.provenance[k] === 'derived'; }),
      mechanical: compact(kinematic || {}) }, extra || {});
  }

  /** Ajoute à chaque membre sa fonction, son nom lisible et son mode d'animation. */
  function describeRoles(stage, list) {
    var roles = functionalRoles(stage);
    list.forEach(function (entry) {
      var functional = roles[entry.role] || 'intermediate';
      entry.functionalRole = functional;
      entry.memberName = MEMBER_NAMES[entry.role] || entry.role;
      entry.localizedRole = FUNCTION_NAMES[functional];
      entry.rotationDisplayMode = rotationDisplayMode(stage, entry.role, functional);
    });
    return list;
  }

  /** Vitesses d'un membre, relatives à l'entrée, telles que le moteur les donne. */
  function speeds(kinematics, id) {
    var m = (kinematics.members || {})[id];
    if (!m) return {};
    var scale = finite(kinematics.inputOmega, 1) || 1;
    var out = { rpm: m.omega, relativeSpeed: m.omega / scale, direction: m.direction };
    if (Number.isFinite(m.orbitOmega)) { out.orbitRpm = m.orbitOmega; out.orbitRelativeSpeed = m.orbitOmega / scale; }
    return out;
  }

  /** Description des membres d'un étage, avec leur géométrie réelle par rôle. */
  function stageMembers(stage, index, kinematics, mech) {
    var g = stage.geometry || {};
    var p = stage.parameters || {};
    var m = finite(p.module, null);
    var prefix = 's' + index + '-';
    var alpha = finite(g.pressureAngleDeg, finite(p.pressureAngle, 20));
    var width = finite(g.width, null);
    var torque = finite(mech.outputTorqueNm, finite(mech.torqueNm, null));
    var list = [];

    function common(d, teeth, shift) {
      d.take('width', width).take('module', m).take('pressureAngleDeg', g.pressureAngleDeg);
      d.fallback('pressureAngleDeg', alpha).fallback('module', m);
      if (Number.isFinite(teeth)) d.take('teeth', teeth);
      if (Number.isFinite(shift)) d.take('profileShift', shift);
      return d;
    }

    if (stage.type === 'planetary' || stage.type === 'epicyclic') {
      var zs = finite(stage.sunTeeth, null), zr = finite(stage.ringTeeth, null);
      var zp = finite(stage.planetTeeth, Number.isFinite(zr) && Number.isFinite(zs) ? (zr - zs) / 2 : null);
      var count = Math.max(2, Math.round(finite(stage.planetCount, 3)));

      var sun = common(new Dimensions(), zs);
      sun.take('pitchDiameter', g.sunDiameter).fallback('pitchDiameter', Number.isFinite(m) && Number.isFinite(zs) ? m * zs : null);
      if (Number.isFinite(m)) sun.fallback('outsideDiameter', sun.values.pitchDiameter + 2 * m)
        .fallback('rootDiameter', sun.values.pitchDiameter - 2.5 * m);
      list.push(member(prefix + 'S', index, 'S', 'gear', sun, speeds(kinematics, prefix + 'S')));

      var ring = common(new Dimensions(), zr);
      ring.take('pitchDiameter', g.ringDiameter).fallback('pitchDiameter', Number.isFinite(m) && Number.isFinite(zr) ? m * zr : null);
      if (Number.isFinite(m)) ring.fallback('outsideDiameter', ring.values.pitchDiameter - 2 * m)   // tête vers le centre
        .fallback('rootDiameter', ring.values.pitchDiameter + 2.5 * m);
      list.push(member(prefix + 'R', index, 'R', 'internal-ring', ring, speeds(kinematics, prefix + 'R')));

      var planet = common(new Dimensions(), zp);
      planet.take('pitchDiameter', g.planetDiameter).fallback('pitchDiameter', Number.isFinite(m) && Number.isFinite(zp) ? m * zp : null);
      if (Number.isFinite(m)) planet.fallback('outsideDiameter', planet.values.pitchDiameter + 2 * m)
        .fallback('rootDiameter', planet.values.pitchDiameter - 2.5 * m);
      var orbit = (finite(sun.values.pitchDiameter, 0) + finite(planet.values.pitchDiameter, 0)) / 2;
      list.push(member(prefix + 'P', index, 'P', 'gear', planet, speeds(kinematics, prefix + 'P'),
        { count: count, orbitRadius: orbit || null }));

      var carrier = new Dimensions();
      carrier.fallback('pitchDiameter', orbit ? 2 * orbit : null);
      list.push(member(prefix + 'C', index, 'C', 'carrier', carrier, speeds(kinematics, prefix + 'C'),
        { count: count, orbitRadius: orbit || null }));
      return list;
    }

    if (stage.type === 'rack') {
      var pinion = common(new Dimensions(), finite(stage.pinionTeeth, null));
      pinion.take('pitchDiameter', g.pitchDiameterInput)
        .fallback('pitchDiameter', Number.isFinite(m) && Number.isFinite(stage.pinionTeeth) ? m * stage.pinionTeeth : null);
      pinion.take('outsideDiameter', g.maxDiameter);
      if (Number.isFinite(m)) pinion.fallback('outsideDiameter', pinion.values.pitchDiameter + 2 * m)
        .fallback('rootDiameter', pinion.values.pitchDiameter - 2.5 * m);
      pinion.fallback('baseDiameter', pinion.values.pitchDiameter * Math.cos(alpha * Math.PI / 180));
      list.push(member(prefix + 'input', index, 'input', 'gear', pinion, speeds(kinematics, prefix + 'input')));

      var rack = new Dimensions();
      rack.take('module', m).take('width', width).take('travelPerRevolution', g.travelPerRevolution)
        .fallback('travelPerRevolution', Math.PI * finite(pinion.values.pitchDiameter, 0) || null);
      var linear = (kinematics.linear || {})[prefix + 'rack'] || {};
      list.push(member(prefix + 'rack', index, 'rack', 'rack', rack,
        { mmPerRadian: linear.mmPerRadian, relativeSpeed: 0 }, { linearId: prefix + 'rack' }));
      return list;
    }

    // Paires : entrée / sortie. Chaque cote est prise du moteur quand elle existe.
    var pairKinds = { belt: 'pulley', chain: 'sprocket', internal: 'internal-ring', bevel: 'cone', worm: 'worm' };
    var teethIn = stage.type === 'worm' ? finite(stage.wormStarts, null) : finite(stage.input && stage.input.teeth, null);
    var teethOut = stage.type === 'worm' ? finite(stage.wheelTeeth, null) : finite(stage.output && stage.output.teeth, null);

    var input = common(new Dimensions(), teethIn, p.profileShiftInput);
    input.take('pitchDiameter', g.pitchDiameterInput).take('outsideDiameter', g.outsideDiameterInput)
      .take('outsideDiameter', g.outerDiameterInput).take('rootDiameter', g.rootDiameterInput)
      .take('baseDiameter', g.baseDiameterInput).take('coneAngleDeg', g.pitchConeAngleInput);
    if (Number.isFinite(m)) input.fallback('outsideDiameter', finite(input.values.pitchDiameter, 0) + 2 * m)
      .fallback('rootDiameter', finite(input.values.pitchDiameter, 0) - 2.5 * m);
    input.fallback('baseDiameter', finite(input.values.pitchDiameter, 0) * Math.cos(alpha * Math.PI / 180));
    if (stage.type === 'helical') input.take('helixAngleDeg', finite(p.helixAngle, 20));
    if (stage.type === 'worm') input.take('leadAngleDeg', finite(p.leadAngle, 20));
    list.push(member(prefix + 'input', index, 'input', pairKinds[stage.type] === 'internal-ring' ? 'gear' : (pairKinds[stage.type] || 'gear'),
      input, speeds(kinematics, prefix + 'input'), { torque: mech.inputTorqueNm }));

    var output = common(new Dimensions(), teethOut, p.profileShiftOutput);
    output.take('pitchDiameter', g.pitchDiameterOutput).take('outsideDiameter', g.outsideDiameterOutput)
      .take('outsideDiameter', g.outerDiameterOutput).take('rootDiameter', g.rootDiameterOutput)
      .take('baseDiameter', g.baseDiameterOutput).take('coneAngleDeg', g.pitchConeAngleOutput);
    if (Number.isFinite(m)) {
      var internal = stage.type === 'internal';
      output.fallback('outsideDiameter', finite(output.values.pitchDiameter, 0) + (internal ? -2 : 2) * m)
        .fallback('rootDiameter', finite(output.values.pitchDiameter, 0) + (internal ? 2.5 : -2.5) * m);
    }
    output.fallback('baseDiameter', finite(output.values.pitchDiameter, 0) * Math.cos(alpha * Math.PI / 180));
    if (stage.type === 'helical') output.take('helixAngleDeg', finite(p.helixAngle, 20));
    list.push(member(prefix + 'output', index, 'output',
      stage.type === 'internal' ? 'internal-ring' : (pairKinds[stage.type] === 'worm' ? 'gear' : pairKinds[stage.type] || 'gear'),
      output, speeds(kinematics, prefix + 'output'), { torque: torque }));
    return list;
  }

  /**
   * Arbres : un étage coaxial (planétaire) ne crée pas un nouvel AXE, mais bien
   * un nouvel ARBRE — sa sortie tourne à une autre vitesse sur la même ligne.
   * Les deux notions sont exposées séparément : `axis` (partagé, aligné sur
   * KinematicLayoutEngine) et `id` (unique par vitesse).
   */
  function buildShafts(stages, kinematics, membersByStage) {
    var scale = finite(kinematics.inputOmega, 1) || 1;
    var shafts = [{ id: 'shaft-0', axis: 0, stageIndex: null, role: 'input', coaxial: false,
      omega: kinematics.inputOmega, relativeSpeed: 1, memberIds: [] }];
    var axis = 0;
    stages.forEach(function (stage, index) {
      var relation = (stage.geometry && stage.geometry.axisRelation) ||
        (Registry && Registry.getAxisRelation ? Registry.getAxisRelation(stage) : 'parallel');
      var coaxial = relation === 'coaxial';
      if (!coaxial) axis += 1;
      var record = kinematics.stages[index] || {};
      var shaft = { id: 'shaft-' + (index + 1), axis: axis, stageIndex: index, role: 'driven',
        coaxial: coaxial, axisRelation: relation,
        omega: record.outputOmega, relativeSpeed: finite(record.outputOmega, 0) / scale, memberIds: [] };
      // Le membre menant appartient à l'arbre précédent, le membre mené au nouveau.
      var members = membersByStage[index] || [];
      members.forEach(function (entry) {
        // Le membre MENANT est celui qui porte la fonction d'entrée, quelle
        // que soit sa position : une couronne menante appartient à l'arbre
        // amont exactement comme un solaire menant.
        var driving = entry.functionalRole === 'input';
        (driving ? shafts[shafts.length - 1] : shaft).memberIds.push(entry.id);
      });
      shafts.push(shaft);
    });
    if (shafts.length) shafts[shafts.length - 1].role = 'output';
    return shafts;
  }

  function build(solution) {
    solution = solution || {};
    var stages = solution.stages || [];
    var kinematics = Kinematics.build(solution);
    var membersByStage = stages.map(function (stage, index) {
      return describeRoles(stage, stageMembers(stage, index, kinematics, (solution.mechanical || [])[index] || {}));
    });
    var members = membersByStage.reduce(function (list, group) { return list.concat(group); }, []);
    var byId = {};
    members.forEach(function (entry) { byId[entry.id] = entry; });

    var connections = stages.map(function (stage, index) {
      var g = stage.geometry || {};
      return { id: 'connection-' + index, stageIndex: index, type: stage.type,
        axisRelation: g.axisRelation,
        centerDistance: finite(g.correctedCenterDistance, finite(g.centerDistance, null)),
        exactCenterDistance: Number.isFinite(g.correctedCenterDistance) || Number.isFinite(g.centerDistance),
        crossed: !!(stage.parameters && stage.parameters.crossed),
        pitch: finite(stage.parameters && stage.parameters.pitch, null),
        elements: finite(g.beltTeeth, finite(g.links, null)),
        length: finite(g.actualLength, finite(g.length, null)),
        wrapAngleDeg: finite(g.wrapAngleDeg, null),
        shaftAngleDeg: finite(g.shaftAngleDeg, null) };
    });

    return {
      stages: stages.map(function (s, i) {
        return { index: i, type: s.type, stage: s, geometry: s.geometry || {},
          memberIds: membersByStage[i].map(function (entry) { return entry.id; }),
          warnings: s.warnings || [] };
      }),
      members: members, membersByStage: membersByStage, byId: byId,
      shafts: buildShafts(stages, kinematics, membersByStage),
      connections: connections,
      dimensions: solution.dimensions || {}, bounds: solution.bounds || {},
      input: solution.input || {}, output: solution.output || {},
      kinematics: kinematics, warnings: solution.warnings || [],
      /** Accès direct par identifiant : 's0-input', 's1-P', 's0-rack'… */
      member: function (id) { return byId[id] || null; },
      /** Membres d'un étage, dans l'ordre de rendu. */
      stageMembers: function (index) { return membersByStage[index] || []; },
      /** Arbre porteur de la sortie d'un étage. */
      shaftFor: function (index) { return this.shafts[index + 1] || this.shafts[0]; },
      /**
       * §7 : LE point d'accès aux rôles. Un renderer qui veut « l'entrée de
       * l'étage 2 » la demande ici et ne la devine jamais depuis l'ordre des
       * roues ni depuis un code de position.
       * @param {number} index étage
       * @param {'input'|'output'|'fixed'} functional
       */
      functionalMember: function (index, functional) {
        var list = membersByStage[index] || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].functionalRole === functional) return list[i];
        }
        return null;
      }
    };
  }

  return { build: build, stageMembers: stageMembers, Dimensions: Dimensions,
    functionalRoles: functionalRoles, planetaryTopology: planetaryTopology,
    rotationDisplayMode: rotationDisplayMode, describeRoles: describeRoles,
    MEMBER_NAMES: MEMBER_NAMES, FUNCTION_NAMES: FUNCTION_NAMES };
});
