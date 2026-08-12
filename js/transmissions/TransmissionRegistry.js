/* Global/worker/CommonJS transmission registry: the single source of truth. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearTransmissionRegistry = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var radians = function (degrees) { return degrees * Math.PI / 180; };
  var pairRatio = function (stage) { return stage.output.teeth / stage.input.teeth; };
  var pairDirection = function () { return -1; };
  function pairGeometry(stage) {
    var p = stage.parameters || {}, m = p.module || 1, a = radians(p.pressureAngle == null ? 20 : p.pressureAngle);
    var z1 = stage.input.teeth, z2 = stage.output.teeth, x1 = p.profileShiftInput || 0, x2 = p.profileShiftOutput || 0;
    var internal = stage.type === 'internal', beta = radians(stage.type === 'helical' ? (p.helixAngle || 20) : 0);
    var mt = m / Math.cos(beta), d1 = mt * z1, d2 = mt * z2;
    var center = (internal ? d2 - d1 : d1 + d2) / 2 + m * (x1 + x2);
    var base1 = d1 * Math.cos(a), base2 = d2 * Math.cos(a);
    var outside1 = d1 + 2 * m * (1 + x1), outside2 = d2 + (internal ? -2 : 2) * m * (1 + x2);
    var root1 = d1 - 2 * m * (1.25 - x1), root2 = d2 + (internal ? 2 : -2) * m * (1.25 - x2);
    var path = Math.sqrt(Math.max(0, outside1 * outside1 - base1 * base1)) / 2 +
      (internal ? -1 : 1) * Math.sqrt(Math.max(0, outside2 * outside2 - base2 * base2)) / 2 - center * Math.sin(a);
    var transverse = Math.max(0, path / (Math.PI * m * Math.cos(a)));
    var overlap = stage.type === 'helical' ? ((p.faceWidth || 10 * m) * Math.tan(beta)) / (Math.PI * m) : 0;
    return { pitchDiameterInput: d1, pitchDiameterOutput: d2, baseDiameterInput: base1,
      baseDiameterOutput: base2, outsideDiameterInput: outside1, outsideDiameterOutput: outside2,
      rootDiameterInput: root1, rootDiameterOutput: root2, circularPitch: Math.PI * m,
      theoreticalToothThickness: Math.PI * m / 2 + 2 * x1 * m * Math.tan(a), addendum: m,
      dedendum: 1.25 * m, clearance: 0.25 * m, backlash: p.backlash || 0,
      centerDistance: center, pressureAngleDeg: a * 180 / Math.PI, workingPressureAngleDeg: a * 180 / Math.PI,
      transverseContactRatio: transverse, overlapContactRatio: overlap, totalContactRatio: transverse + overlap,
      maxDiameter: Math.max(outside1, outside2), width: p.faceWidth || 10 * m };
  }
  function gearForces(stage, torqueNm) {
    var g = pairGeometry(stage), p = stage.parameters || {}, alpha = radians(p.pressureAngle || 20);
    var beta = radians(stage.type === 'helical' ? (p.helixAngle || 20) : 0);
    var ft = 2000 * torqueNm / g.pitchDiameterInput; // N: diameter is mm
    return { tangentialN: ft, radialN: ft * Math.tan(alpha) / Math.cos(beta), axialN: ft * Math.tan(beta) };
  }
  function candidatePair(type, a, b, parameters) { return { type: type, input: { teeth: a }, output: { teeth: b }, parameters: parameters || {} }; }
  function pairCandidates(type, options, constraints) {
    var out = [], a0 = Math.max(constraints.minInput, options.inputMin), a1 = Math.min(constraints.maxInput, options.inputMax);
    var b0 = Math.max(constraints.minOutput, options.outputMin), b1 = Math.min(constraints.maxOutput, options.outputMax);
    for (var a = a0; a <= a1; a++) for (var b = b0; b <= b1; b++) {
      if (options.reductionOnly && b <= a) continue;
      if (type === 'internal' && b - a < 10) continue;
      out.push(candidatePair(type, a, b, options.typeParameters && options.typeParameters[type]));
    }
    return out;
  }
  function pair(id, name, constraints, efficiency, direction) {
    return { id: id, name: name, constraints: constraints, parameterDefinitions: {},
      validateConfiguration: function (s) { return !!(s.input && s.output && s.input.teeth > 0 && s.output.teeth > 0); },
      calculateRatio: pairRatio, calculateGeometry: pairGeometry,
      calculateEfficiency: function () { return efficiency; }, calculateForces: gearForces,
      rotationDirection: direction || pairDirection,
      generateCandidates: function (o) { return pairCandidates(id, o, constraints); } };
  }
  var types = {};
  function register(definition) { if (!definition || !definition.id) throw new Error('Transmission id required'); types[definition.id] = Object.freeze(definition); return definition; }
  register(pair('spur', 'Engrenage droit', { minInput: 6, maxInput: 200, minOutput: 6, maxOutput: 200, maxRatio: 8 }, 0.97));
  register(pair('helical', 'Engrenage hélicoïdal', { minInput: 8, maxInput: 200, minOutput: 8, maxOutput: 200, maxRatio: 10 }, 0.98));
  register(pair('internal', 'Engrenage intérieur', { minInput: 10, maxInput: 80, minOutput: 20, maxOutput: 300, maxRatio: 12 }, 0.98, function () { return 1; }));
  register(pair('bevel', 'Engrenage conique', { minInput: 10, maxInput: 80, minOutput: 10, maxOutput: 120, maxRatio: 6 }, 0.96));
  register({ id: 'worm', name: 'Vis sans fin', constraints: { minInput: 1, maxInput: 6, minOutput: 15, maxOutput: 120, maxRatio: 120 }, parameterDefinitions: { wormStarts: [1, 6] },
    validateConfiguration: function (s) { return s.wormStarts >= 1 && s.wormStarts <= 6 && s.wheelTeeth >= 15; },
    calculateRatio: function (s) { return s.wheelTeeth / s.wormStarts; },
    calculateGeometry: function (s) { var m = s.parameters.module || 1, dw = m * s.wheelTeeth, ds = m * (s.parameters.diameterQuotient || 10); return { pitchDiameterInput: ds, pitchDiameterOutput: dw, centerDistance: (ds + dw) / 2, maxDiameter: dw + 2 * m, width: 12 * m }; },
    calculateEfficiency: function (s) { var gamma = radians(s.parameters.leadAngle || 20), mu = s.parameters.frictionCoefficient || 0.06; return Math.max(0.2, Math.min(0.9, Math.tan(gamma) / Math.tan(gamma + Math.atan(mu)))); },
    calculateForces: function (s, t) { var g = this.calculateGeometry(s), ft = 2000 * t / g.pitchDiameterInput; return { tangentialN: ft, radialN: ft * Math.tan(radians(s.parameters.pressureAngle || 20)), axialN: ft / Math.tan(radians(s.parameters.leadAngle || 20)) }; }, rotationDirection: pairDirection,
    generateCandidates: function (o) { var out = [], p = o.typeParameters.worm || {}, lo = p.wormStartsMin || 1, hi = p.wormStartsMax || 6; for (var a = lo; a <= hi; a++) for (var b = Math.max(15, o.outputMin); b <= Math.min(120, o.outputMax); b++) out.push({ type: 'worm', wormStarts: a, wheelTeeth: b, parameters: p }); return out; } });
  function planetarySpeeds(s, inputSpeed) {
    var members = ['S', 'R', 'C'], fixed = s.fixed || 'R', input = s.inputMember || 'S', output = s.outputMember || 'C';
    if (input === output || input === fixed || output === fixed || members.indexOf(input) < 0 || members.indexOf(output) < 0) throw new Error('Invalid planetary member selection');
    var speeds = { S: null, R: null, C: null }; speeds[fixed] = 0; speeds[input] = inputSpeed;
    // Willis: (wS-wC)/(wR-wC) = -ZR/ZS
    var k = s.ringTeeth / s.sunTeeth;
    if (speeds.C == null) speeds.C = (speeds.S + k * speeds.R) / (1 + k);
    else if (speeds.S == null) speeds.S = (1 + k) * speeds.C - k * speeds.R;
    else speeds.R = ((1 + k) * speeds.C - speeds.S) / k;
    return { speeds: speeds, ratio: inputSpeed / speeds[output] };
  }
  register({ id: 'planetary', aliases: ['epicyclic'], name: 'Train épicycloïdal', constraints: { minInput: 12, maxInput: 60, minOutput: 30, maxOutput: 200, maxRatio: 12 }, parameterDefinitions: {},
    validateConfiguration: function (s) { var zp = (s.ringTeeth - s.sunTeeth) / 2, n = s.planetCount || 3; return zp > 0 && Number.isInteger(zp) && Number.isInteger((s.sunTeeth + s.ringTeeth) / n); },
    calculateRatio: function (s) { return planetarySpeeds(s, 1).ratio; }, calculateSpeeds: planetarySpeeds,
    calculateGeometry: function (s) { var m = s.parameters.module || 1; return { sunDiameter: m * s.sunTeeth, ringDiameter: m * s.ringTeeth, planetDiameter: m * (s.ringTeeth - s.sunTeeth) / 2, maxDiameter: m * (s.ringTeeth + 2), width: s.parameters.faceWidth || 10 * m, centerDistance: 0 }; },
    calculateEfficiency: function () { return 0.97; }, calculateForces: function (s, t) { var d = s.parameters.module * s.sunTeeth, n = s.planetCount || 3, ft = 2000 * t / d / n; return { tangentialN: ft, radialN: ft * Math.tan(radians(s.parameters.pressureAngle || 20)), axialN: 0 }; }, rotationDirection: function (s) { return Math.sign(this.calculateRatio(s)); },
    generateCandidates: function (o) { var out = [], p = o.typeParameters.planetary || o.typeParameters.epicyclic || {}; for (var zs = Math.max(12, o.inputMin); zs <= Math.min(60, o.inputMax); zs++) for (var zr = Math.max(30, o.outputMin); zr <= Math.min(200, o.outputMax); zr++) { var s = { type: 'planetary', sunTeeth: zs, ringTeeth: zr, planetTeeth: (zr-zs)/2, planetCount: p.planetCount || 3, inputMember: p.inputMember || 'S', outputMember: p.outputMember || 'C', fixed: p.fixed || 'R', parameters: p }; if (this.validateConfiguration(s)) out.push(s); } return out; } });
  function beltGeometry(s) { var d1 = s.input.teeth * s.parameters.pitch / Math.PI, d2 = s.output.teeth * s.parameters.pitch / Math.PI, c = s.parameters.centerDistance, l = 2*c + Math.PI*(d1+d2)/2 + Math.pow(d2-d1,2)/(4*c); return { pitchDiameterInput:d1,pitchDiameterOutput:d2,centerDistance:c,length:l,beltTeeth:Math.round(l/s.parameters.pitch),wrapAngleDeg:180-2*Math.asin(Math.abs(d2-d1)/(2*c))*180/Math.PI,maxDiameter:Math.max(d1,d2),width:s.parameters.width||10 }; }
  register({ id:'belt', name:'Courroie', constraints:{minInput:10,maxInput:200,minOutput:10,maxOutput:500,maxRatio:10}, parameterDefinitions:{}, validateConfiguration:function(s){return s.parameters.centerDistance>Math.abs(s.output.teeth-s.input.teeth)*s.parameters.pitch/(2*Math.PI);}, calculateRatio:pairRatio, calculateGeometry:beltGeometry, calculateEfficiency:function(s){return s.parameters.beltType==='timing'?0.98:0.95;}, calculateForces:function(){return {tangentialN:null,radialN:null,axialN:0};}, rotationDirection:function(s){return s.parameters.crossed?-1:1;}, generateCandidates:function(o){return pairCandidates('belt',o,this.constraints);} });
  register({ id:'chain', name:'Chaîne', constraints:{minInput:8,maxInput:120,minOutput:8,maxOutput:240,maxRatio:12}, parameterDefinitions:{}, validateConfiguration:function(){return true;}, calculateRatio:pairRatio, calculateGeometry:function(s){var p=s.parameters.pitch,c=s.parameters.centerDistance,z1=s.input.teeth,z2=s.output.teeth,x=2*c/p+(z1+z2)/2+Math.pow(z2-z1,2)*p/(4*Math.PI*Math.PI*c);return {pitchDiameterInput:p/Math.sin(Math.PI/z1),pitchDiameterOutput:p/Math.sin(Math.PI/z2),centerDistance:c,links:Math.round(x/2)*2,length:Math.round(x/2)*2*p,maxDiameter:p/Math.sin(Math.PI/z2),width:s.parameters.width||10};},calculateEfficiency:function(){return .97;},calculateForces:function(){return {tangentialN:null,radialN:null,axialN:0};},rotationDirection:function(){return 1;},generateCandidates:function(o){return pairCandidates('chain',o,this.constraints);} });
  register({ id:'rack', name:'Pignon-crémaillère', constraints:{minInput:6,maxInput:200,minOutput:1,maxOutput:1,maxRatio:Infinity},parameterDefinitions:{},validateConfiguration:function(s){return s.pinionTeeth>0;},calculateRatio:function(){return null;},calculateGeometry:function(s){var d=s.parameters.module*s.pinionTeeth;return {pitchDiameterInput:d,travelPerRevolution:Math.PI*d,linearSpeedMmMin:Math.PI*d*(s.parameters.rpm||0),maxDiameter:d+2*s.parameters.module,width:s.parameters.faceWidth||10*s.parameters.module};},calculateEfficiency:function(){return .97;},calculateForces:function(s,t){return {tangentialN:2000*t/(s.parameters.module*s.pinionTeeth),radialN:0,axialN:0};},rotationDirection:function(){return 0;},generateCandidates:function(){return [];} });
  types.epicyclic = types.planetary;
  return { register: register, get: function(id){return types[id];}, list:function(){return Object.keys(types).filter(function(k){return k!=='epicyclic';}).map(function(k){return types[k];});}, createLegacyStage:function(a,b,type,params){if(type==='worm')return {type:type,wormStarts:a,wheelTeeth:b,parameters:params||{}};if(type==='epicyclic'||type==='planetary')return {type:'planetary',sunTeeth:a,ringTeeth:b,planetTeeth:(b-a)/2,planetCount:(params&&params.planetCount)||3,inputMember:(params&&params.inputMember)||'S',outputMember:(params&&params.outputMember)||'C',fixed:(params&&params.fixed)||'R',parameters:params||{}};return candidatePair(type,a,b,params);}, toLegacy:function(s){return s.type==='worm'?[s.wormStarts,s.wheelTeeth,s.type]:s.type==='planetary'?[s.sunTeeth,s.ringTeeth,'epicyclic']:[s.input.teeth,s.output.teeth,s.type];} };
});
