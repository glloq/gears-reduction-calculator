// GearSizing.js - Le diamètre est une contrainte mécanique, pas une échelle.
//
// Un diamètre primitif n'est pas une taille de dessin qu'on étire : c'est le
// produit du module par le nombre de dents.
//
//     droit        d = m · Z
//     hélicoïdal   d = mn · Z / cos β        (module NORMAL)
//
// Trois grandeurs, une équation : deux suffisent à fixer la troisième. Vouloir
// imposer les trois, c'est demander l'impossible dès que le compte ne tombe pas
// juste — et le pire qu'on puisse faire alors est de redimensionner le SVG pour
// que ça en ait l'air.
//
// Ce module résout donc, et refuse : il dit quelle grandeur il a déduite, ou
// pourquoi la demande est contradictoire, en donnant les deux valeurs qui ne
// se rencontrent pas. Il ne triche jamais avec l'échelle.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearSizing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function finite(v) { return Number.isFinite(v) && v > 0; }
  function rad(deg) { return deg * Math.PI / 180; }

  /** Le facteur qui relie module normal et diamètre : 1 hors hélicoïdal. */
  function helixFactor(helixAngleDeg) {
    var beta = Number.isFinite(helixAngleDeg) ? rad(Math.abs(helixAngleDeg)) : 0;
    var c = Math.cos(beta);
    return c > 1e-6 ? c : 1;
  }

  /** d = m·Z / cos β */
  function diameterOf(moduleValue, teeth, helixAngleDeg) {
    return moduleValue * teeth / helixFactor(helixAngleDeg);
  }

  var TOLERANCE = 1e-6;

  /**
   * solve({ module, teeth, diameter, helixAngleDeg, locked }) → résultat.
   *
   * `locked` liste les grandeurs que l'utilisateur a imposées. La grandeur
   * absente de `locked` est celle qu'on a le droit de déduire ; si toutes les
   * trois sont imposées et ne s'accordent pas, c'est un CONFLIT — pas une
   * occasion de choisir à sa place.
   *
   * @returns {{status:'solved'|'conflict'|'underdetermined', derived:?string,
   *            module:?number, teeth:?number, diameter:?number,
   *            requestedDiameter:?number, impliedDiameter:?number, message:string}}
   */
  function solve(request) {
    request = request || {};
    var beta = request.helixAngleDeg;
    var locked = {};
    (request.locked || []).forEach(function (key) { locked[key] = true; });

    var m = finite(request.module) ? request.module : null;
    var z = finite(request.teeth) ? Math.round(request.teeth) : null;
    var d = finite(request.diameter) ? request.diameter : null;

    var known = [m !== null, z !== null, d !== null].filter(Boolean).length;
    if (known < 2) {
      return { status: 'underdetermined', derived: null, module: m, teeth: z, diameter: d,
        requestedDiameter: d, impliedDiameter: null,
        message: 'Il faut deux grandeurs parmi module, dents et diamètre pour fixer la troisième.' };
    }

    // Les trois sont posées : elles doivent s'accorder, sinon on le dit.
    if (m !== null && z !== null && d !== null) {
      var implied = diameterOf(m, z, beta);
      if (Math.abs(implied - d) <= Math.max(TOLERANCE, d * TOLERANCE)) {
        return { status: 'solved', derived: null, module: m, teeth: z, diameter: implied,
          requestedDiameter: d, impliedDiameter: implied, message: 'Les trois grandeurs s’accordent.' };
      }
      // Si le diamètre n'est PAS verrouillé, il cède : c'est lui la conséquence.
      if (!locked.diameter) {
        return { status: 'solved', derived: 'diameter', module: m, teeth: z, diameter: implied,
          requestedDiameter: d, impliedDiameter: implied,
          message: 'Ø déduit de Z × m : ' + implied.toFixed(2) + ' mm.' };
      }
      return { status: 'conflict', derived: null, module: m, teeth: z, diameter: null,
        requestedDiameter: d, impliedDiameter: implied,
        message: 'Ø demandé ' + d.toFixed(2) + ' mm ; Ø imposé par Z × m : ' + implied.toFixed(2) + ' mm.' };
    }

    if (d === null) {
      var computed = diameterOf(m, z, beta);
      return { status: 'solved', derived: 'diameter', module: m, teeth: z, diameter: computed,
        requestedDiameter: null, impliedDiameter: computed,
        message: 'Ø = ' + computed.toFixed(2) + ' mm.' };
    }
    if (m === null) {
      var moduleValue = d * helixFactor(beta) / z;
      return { status: 'solved', derived: 'module', module: moduleValue, teeth: z, diameter: d,
        requestedDiameter: d, impliedDiameter: d,
        message: 'm = ' + moduleValue.toFixed(3) + ' mm.' };
    }
    // Le nombre de dents est ENTIER : le diamètre atteignable est donc discret,
    // et se déplace au dent la plus proche. Dire « Z = 29,7 » n'aiderait
    // personne, et arrondir sans le dire ferait mentir le diamètre affiché.
    var exact = d * helixFactor(beta) / m;
    var teeth = Math.max(1, Math.round(exact));
    var reached = diameterOf(m, teeth, beta);
    return { status: 'solved', derived: 'teeth', module: m, teeth: teeth, diameter: reached,
      requestedDiameter: d, impliedDiameter: reached,
      exactTeeth: exact,
      message: Math.abs(reached - d) <= Math.max(TOLERANCE, d * TOLERANCE)
        ? 'Z = ' + teeth + '.'
        : 'Z = ' + teeth + ' — Ø atteignable ' + reached.toFixed(2) + ' mm pour ' + d.toFixed(2) + ' mm demandé.' };
  }

  /**
   * Les grandeurs d'un membre, telles qu'on peut les proposer à l'édition.
   * `origin` reprend le vocabulaire déjà en place : imposée, déduite,
   * automatique. Une grandeur DÉDUITE n'est pas éditable tant qu'on n'a pas
   * libéré l'une des deux autres — c'est cela qui empêche de croire qu'on
   * redimensionne une roue en tapant un diamètre.
   */
  function editable(request) {
    var result = solve(request);
    var locked = {};
    (request && request.locked || []).forEach(function (key) { locked[key] = true; });
    return ['module', 'teeth', 'diameter'].map(function (key) {
      return { key: key, value: result[key],
        locked: !!locked[key],
        derived: result.derived === key,
        editable: !(result.derived === key) };
    });
  }

  return { solve: solve, editable: editable, diameterOf: diameterOf, helixFactor: helixFactor };
});
