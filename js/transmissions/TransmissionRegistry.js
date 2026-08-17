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
  var AXIS_RELATIONS={spur:'parallel',helical:'parallel',internal:'internal-parallel',bevel:'perpendicular',worm:'perpendicular',planetary:'coaxial',epicyclic:'coaxial',belt:'parallel',chain:'parallel',rack:'linear'};
  function axisRelation(stage){return AXIS_RELATIONS[stage.type]||'parallel';}
  function geometryContract(stage,geometry){
    var linear=stage.type==='rack', keys=['maxDiameter','width','pitchDiameterInput','pitchDiameterOutput','centerDistance'];
    keys.forEach(function(k){if(geometry[k]===undefined)geometry[k]=null;});
    geometry.axisRelation=geometry.axisRelation||axisRelation(stage);
    geometry.geometryStatus=linear?'linear':'evaluated';
    return geometry;
  }
  function validateGeometryResult(stage,geometry){
    if(!geometry||!geometry.axisRelation)return {valid:false,failures:['axisRelation']};
    var failures=[];['maxDiameter','width'].forEach(function(k){if(geometry[k]!=null&&(!Number.isFinite(geometry[k])||geometry[k]<=0))failures.push(k);});
    if(stage.type!=='rack')['pitchDiameterInput','pitchDiameterOutput'].forEach(function(k){if(geometry[k]!=null&&(!Number.isFinite(geometry[k])||geometry[k]<=0))failures.push(k);});
    if(geometry.centerDistance!=null&&(!Number.isFinite(geometry.centerDistance)||geometry.centerDistance<0))failures.push('centerDistance');
    return {valid:!failures.length,failures:failures};
  }
  function pairGeometry(stage) {
    var p = stage.parameters || {}, m = p.module || 1, a = radians(p.pressureAngle == null ? 20 : p.pressureAngle);
    var z1 = stage.input.teeth, z2 = stage.output.teeth, x1 = p.profileShiftInput || 0, x2 = p.profileShiftOutput || 0;
    var internal = stage.type === 'internal', beta = radians(stage.type === 'helical' ? (p.helixAngle || 20) : 0);
    var mt = m / Math.cos(beta), d1 = mt * z1, d2 = mt * z2;
    var center = (internal ? d2 - d1 : d1 + d2) / 2 + m * (x1 + x2);
    var alphaT=Math.atan(Math.tan(a)/Math.cos(beta));
    var nominalCenter=(internal ? d2-d1:d1+d2)/2, working=Math.acos(Math.max(-1,Math.min(1,nominalCenter*Math.cos(alphaT)/center)));
    var base1 = d1 * Math.cos(alphaT), base2 = d2 * Math.cos(alphaT);
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
      centerDistance: center, pressureAngleDeg: a * 180 / Math.PI, transversePressureAngleDeg:alphaT*180/Math.PI,workingPressureAngleDeg: working * 180 / Math.PI,
      transverseContactRatio: transverse, overlapContactRatio: overlap, totalContactRatio: transverse + overlap,
      maxDiameter: Math.max(outside1, outside2), width: p.faceWidth || 10 * m,axisRelation:axisRelation(stage) };
  }
  function gearForces(stage, torqueNm) {
    var g = pairGeometry(stage), p = stage.parameters || {}, alpha = radians(p.pressureAngle || 20);
    var beta = radians(stage.type === 'helical' ? (p.helixAngle || 20) : 0),alphaT=Math.atan(Math.tan(alpha)/Math.cos(beta));
    var ft = 2000 * torqueNm / g.pitchDiameterInput; // N: diameter is mm
    return { tangentialN: ft, radialN: ft * Math.tan(alphaT), axialN: ft * Math.tan(beta) };
  }
  function candidatePair(type, a, b, parameters) { return { type: type, input: { teeth: a }, output: { teeth: b }, parameters: parameters || {} }; }
  function pairCandidates(type, options, constraints) {
    var out = [], a0 = Math.max(constraints.minInput, options.inputMin), a1 = Math.min(constraints.maxInput, options.inputMax);
    var b0 = Math.max(constraints.minOutput, options.outputMin), b1 = Math.min(constraints.maxOutput, options.outputMax);
    for (var a = a0; a <= a1; a++) for (var b = b0; b <= b1; b++) {
      if (options.reductionOnly && b <= a) continue;
      if (type === 'internal' && b - a < 10) continue;
      if(Math.abs(b/a)>constraints.maxRatio)continue;
      out.push(candidatePair(type, a, b, options.typeParameters && options.typeParameters[type]));
    }
    return out;
  }
  function pair(id, name, constraints, efficiency, direction) {
    return { id: id, name: name, constraints: constraints, parameterDefinitions: {},
      validateConfiguration: function (s) { return !!(s.input && s.output && s.input.teeth > 0 && s.output.teeth > 0); },
      calculateRatio: pairRatio, calculateGeometry: function(s){return geometryContract(s,pairGeometry(s));},
      calculateEfficiency: function () { return efficiency; }, calculateForces: gearForces,
      rotationDirection: direction || pairDirection,
      generateCandidates: function (o) { return pairCandidates(id, o, constraints); } };
  }
  var types = {};

  /**
   * §4, §5 : les trois organes d'un planétaire — solaire, couronne,
   * porte-satellites — occupent chacun une fonction, et une seule. Les six
   * permutations sont toutes réalisables, et donnent des rapports, des sens et
   * des plages très différents ; c'est pourquoi la recherche automatique doit
   * pouvoir les essayer toutes plutôt que la seule S → C, couronne fixe.
   */
  var PLANETARY_TOPOLOGIES = [
    { inputMember: 'S', fixed: 'R', outputMember: 'C' },
    { inputMember: 'S', fixed: 'C', outputMember: 'R' },
    { inputMember: 'R', fixed: 'S', outputMember: 'C' },
    { inputMember: 'R', fixed: 'C', outputMember: 'S' },
    { inputMember: 'C', fixed: 'S', outputMember: 'R' },
    { inputMember: 'C', fixed: 'R', outputMember: 'S' }
  ];

  /** Les trois organes sont-ils bien distincts ? */
  function distinctMembers(s) {
    var input = s.inputMember || 'S', output = s.outputMember || 'C', fixed = s.fixed || 'R';
    return input !== output && input !== fixed && output !== fixed;
  }
  var CAPABILITIES={
    spur:['evaluated','evaluated','evaluated',true],helical:['evaluated','evaluated','evaluated',true],internal:['evaluated','evaluated','evaluated',true],
    bevel:['evaluated','partial','partial',true],worm:['evaluated','unsupported','unsupported',true],planetary:['partial','partial','partial',true],
    belt:['unsupported','unsupported','unsupported',false],chain:['unsupported','unsupported','unsupported',false],rack:['evaluated','unsupported','unsupported',true]
  };
  function register(definition) { if (!definition || !definition.id) throw new Error('Transmission id required');var c=CAPABILITIES[definition.id]||['unsupported','unsupported','unsupported',false];definition.capabilities=Object.freeze({ratio:'evaluated',geometry:'evaluated',forces:c[0],bending:c[1],contact:c[2],usesModule:c[3],manufacturing:'partial',geometricView:definition.id==='chain'?'unsupported':'partial',kinematicView:'evaluated'}); types[definition.id] = Object.freeze(definition); return definition; }
  register(pair('spur', 'Engrenage droit', { minInput: 6, maxInput: 200, minOutput: 6, maxOutput: 200, maxRatio: 8 }, 0.97));
  register(pair('helical', 'Engrenage hélicoïdal', { minInput: 8, maxInput: 200, minOutput: 8, maxOutput: 200, maxRatio: 10 }, 0.98));
  register(pair('internal', 'Engrenage intérieur', { minInput: 10, maxInput: 80, minOutput: 20, maxOutput: 300, maxRatio: 12 }, 0.98, function () { return 1; }));
  var bevel=pair('bevel', 'Engrenage conique', { minInput: 10, maxInput: 80, minOutput: 10, maxOutput: 120, maxRatio: 6 }, 0.96);
  bevel.calculateGeometry=function(s){var p=s.parameters||{},m=p.module||1,z1=s.input.teeth,z2=s.output.teeth,sigma=radians(p.shaftAngle==null?90:p.shaftAngle),d1=m*z1,d2=m*z2,delta1=Math.atan2(Math.sin(sigma),z2/z1+Math.cos(sigma)),delta2=sigma-delta1,R=d1/(2*Math.sin(delta1)),b=Math.min(p.faceWidth||10*m,R/3);return geometryContract(s,{pitchConeAngleInput:delta1*180/Math.PI,pitchConeAngleOutput:delta2*180/Math.PI,shaftAngleDeg:sigma*180/Math.PI,coneDistance:R,pitchDiameterInput:d1,pitchDiameterOutput:d2,outerDiameterInput:d1+2*m*Math.cos(delta1),outerDiameterOutput:d2+2*m*Math.cos(delta2),maxDiameter:Math.max(d1+2*m*Math.cos(delta1),d2+2*m*Math.cos(delta2)),width:b,centerDistance:null,axisRelation:Math.abs(sigma-Math.PI/2)<1e-9?'perpendicular':'crossed'});};
  register(bevel);
  register({ id: 'worm', name: 'Vis sans fin', constraints: { minInput: 1, maxInput: 6, minOutput: 15, maxOutput: 120, maxRatio: 120 }, parameterDefinitions: { wormStarts: [1, 6] },
    validateConfiguration: function (s) { return s.wormStarts >= 1 && s.wormStarts <= 6 && s.wheelTeeth >= 15; },
    calculateRatio: function (s) { return s.wheelTeeth / s.wormStarts; },
    calculateGeometry: function (s) { var m = s.parameters.module || 1, dw = m * s.wheelTeeth, ds = m * (s.parameters.diameterQuotient || 10); return geometryContract(s,{ pitchDiameterInput: ds, pitchDiameterOutput: dw, centerDistance: (ds + dw) / 2, maxDiameter: dw + 2 * m, width: 12 * m,axisRelation:'perpendicular' }); },
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
    validateConfiguration: function (s) {
      // §4 : entrée, sortie et organe fixe sont TROIS organes distincts. Sans
      // ce contrôle, une saisie « entrée = solaire, sortie = solaire » partait
      // au solveur et n'échouait qu'au calcul des vitesses, très loin de la
      // cause. Le moteur ne fait jamais confiance à l'interface.
      if (!distinctMembers(s)) return false;
      var zp = (s.ringTeeth - s.sunTeeth) / 2, n = s.planetCount || 3;
      return zp > 0 && Number.isInteger(zp) && Number.isInteger((s.sunTeeth + s.ringTeeth) / n);
    },
    calculateRatio: function (s) { return planetarySpeeds(s, 1).ratio; }, calculateSpeeds: planetarySpeeds,
    calculateGeometry: function (s) { var m = s.parameters.module || 1,ds=m*s.sunTeeth,dr=m*s.ringTeeth;return geometryContract(s,{ sunDiameter:ds, ringDiameter:dr, planetDiameter: m * (s.ringTeeth - s.sunTeeth) / 2,pitchDiameterInput:s.inputMember==='R'?dr:ds,pitchDiameterOutput:s.outputMember==='R'?dr:(s.outputMember==='S'?ds:dr), maxDiameter: m * (s.ringTeeth + 2), width: s.parameters.faceWidth || 10 * m, centerDistance: 0,axisRelation:'coaxial' }); },
    calculateEfficiency: function () { return 0.97; }, calculateForces: function (s, t) { var d = s.parameters.module * s.sunTeeth, n = s.planetCount || 3, ft = 2000 * t / d / n; return { tangentialN: ft, radialN: ft * Math.tan(radians(s.parameters.pressureAngle || 20)), axialN: 0 }; }, rotationDirection: function (s) { return Math.sign(this.calculateRatio(s)); },
    generateCandidates: function (o) {
      var out = [], p = o.typeParameters.planetary || o.typeParameters.epicyclic || {};
      // §5 : la recherche n'essayait qu'UNE topologie — solaire menant,
      // couronne fixe — alors que les six permutations sont réalisables et
      // donnent des rapports, des sens et des plages entièrement différents.
      // Chercher « le meilleur réducteur » en ignorant cinq d'entre elles
      // revenait à ne pas chercher.
      var topologies = p.topologyMode === 'fixed'
        ? [{ inputMember: p.inputMember || 'S', outputMember: p.outputMember || 'C', fixed: p.fixed || 'R' }]
        : PLANETARY_TOPOLOGIES;
      for (var zs = Math.max(12, o.inputMin); zs <= Math.min(60, o.inputMax); zs++) {
        for (var zr = Math.max(30, o.outputMin); zr <= Math.min(200, o.outputMax); zr++) {
          for (var t = 0; t < topologies.length; t++) {
            var s = { type: 'planetary', sunTeeth: zs, ringTeeth: zr, planetTeeth: (zr - zs) / 2,
              planetCount: p.planetCount || 3,
              inputMember: topologies[t].inputMember, outputMember: topologies[t].outputMember,
              fixed: topologies[t].fixed, parameters: p };
            if (this.validateConfiguration(s)) out.push(s);
          }
        }
      }
      return out;
    } });
  function beltLength(d1,d2,c,crossed){return 2*c+Math.PI*(d1+d2)/2+Math.pow(crossed?d1+d2:d2-d1,2)/(4*c);}
  function solveBeltCenter(d1,d2,length,crossed,guess){var c=guess;for(var i=0;i<12;i++){var f=beltLength(d1,d2,c,crossed)-length,h=.001,df=(beltLength(d1,d2,c+h,crossed)-beltLength(d1,d2,c-h,crossed))/(2*h);c-=f/df;}return c;}
  function beltGeometry(s) { var d1 = s.input.teeth * s.parameters.pitch / Math.PI, d2 = s.output.teeth * s.parameters.pitch / Math.PI, c = s.parameters.centerDistance,crossed=!!s.parameters.crossed, theoretical=beltLength(d1,d2,c,crossed),teeth=Math.max(1,Math.round(theoretical/s.parameters.pitch)),actual=teeth*s.parameters.pitch,corrected=solveBeltCenter(d1,d2,actual,crossed,c),arg=(crossed?d1+d2:Math.abs(d2-d1))/(2*corrected),wrap=crossed?180+2*Math.asin(Math.min(1,arg))*180/Math.PI:180-2*Math.asin(Math.min(1,arg))*180/Math.PI; return geometryContract(s,{ pitchDiameterInput:d1,pitchDiameterOutput:d2,centerDistance:corrected,theoreticalCenterDistance:c,theoreticalLength:theoretical,selectedBeltTeeth:teeth,actualLength:actual,correctedCenterDistance:corrected,length:actual,beltTeeth:teeth,wrapAngleDeg:wrap,maxDiameter:Math.max(d1,d2),width:s.parameters.width||10 }); }
  register({ id:'belt', name:'Courroie', constraints:{minInput:10,maxInput:200,minOutput:10,maxOutput:500,maxRatio:10}, parameterDefinitions:{}, validateConfiguration:function(s){return s.parameters.centerDistance>Math.abs(s.output.teeth-s.input.teeth)*s.parameters.pitch/(2*Math.PI);}, calculateRatio:pairRatio, calculateGeometry:beltGeometry, calculateEfficiency:function(s){return s.parameters.beltType==='timing'?0.98:0.95;}, calculateForces:function(){return {tangentialN:null,radialN:null,axialN:0};}, rotationDirection:function(s){return s.parameters.crossed?-1:1;}, generateCandidates:function(o){return pairCandidates('belt',o,this.constraints);} });
  register({ id:'chain', name:'Chaîne', constraints:{minInput:8,maxInput:120,minOutput:8,maxOutput:240,maxRatio:12}, parameterDefinitions:{}, validateConfiguration:function(){return true;}, calculateRatio:pairRatio, calculateGeometry:function(s){var p=s.parameters.pitch,c=s.parameters.centerDistance,z1=s.input.teeth,z2=s.output.teeth,A=(z1+z2)/2,B=Math.pow(z2-z1,2)/(4*Math.PI*Math.PI),x=2*c/p+A+B/(c/p),links=Math.round(x/2)*2,q=(links-A+Math.sqrt(Math.max(0,Math.pow(links-A,2)-8*B)))/4,corrected=q*p;return geometryContract(s,{pitchDiameterInput:p/Math.sin(Math.PI/z1),pitchDiameterOutput:p/Math.sin(Math.PI/z2),centerDistance:corrected,theoreticalLinks:x,selectedLinks:links,links:links,actualLength:links*p,length:links*p,correctedCenterDistance:corrected,maxDiameter:Math.max(p/Math.sin(Math.PI/z1),p/Math.sin(Math.PI/z2)),width:s.parameters.width||10});},calculateEfficiency:function(){return .97;},calculateForces:function(){return {tangentialN:null,radialN:null,axialN:0};},rotationDirection:function(){return 1;},generateCandidates:function(o){return pairCandidates('chain',o,this.constraints);} });
  register({ id:'rack', name:'Pignon-crémaillère', constraints:{minInput:6,maxInput:200,minOutput:1,maxOutput:1,maxRatio:Infinity},parameterDefinitions:{},validateConfiguration:function(s){return s.pinionTeeth>0;},calculateRatio:function(){return null;},calculateGeometry:function(s){var d=s.parameters.module*s.pinionTeeth;return geometryContract(s,{pitchDiameterInput:d,pitchDiameterOutput:null,centerDistance:null,travelPerRevolution:Math.PI*d,linearSpeedMmMin:Math.PI*d*(s.parameters.rpm||0),maxDiameter:d+2*s.parameters.module,width:s.parameters.faceWidth||10*s.parameters.module,axisRelation:'linear'});},calculateEfficiency:function(){return .97;},calculateForces:function(s,t){return {tangentialN:2000*t/(s.parameters.module*s.pinionTeeth),radialN:0,axialN:0};},rotationDirection:function(){return 0;},generateCandidates:function(){return [];} });
  types.epicyclic = types.planetary;
  /* Single UI/solver parameter schema. Definitions are attached after registration
     because transmission definitions themselves are frozen by register(). */
  var parameterDefinitions={
    spur:{pressureAngle:{label:'Angle de pression (°)',type:'number',default:20,min:14.5,max:25,step:.5},faceWidth:{label:'Largeur de dent (mm)',type:'number',default:10,min:1,step:.5},profileShiftInput:{label:'Déport x1',type:'number',default:0,min:-1,max:1,step:.05},profileShiftOutput:{label:'Déport x2',type:'number',default:0,min:-1,max:1,step:.05}},
    helical:{helixAngle:{label:"Angle d'hélice (°)",type:'number',default:20,min:5,max:45,step:1},pressureAngle:{label:'Angle de pression normal (°)',type:'number',default:20,min:14.5,max:25,step:.5},faceWidth:{label:'Largeur (mm)',type:'number',default:12,min:1,step:.5}},
    internal:{pressureAngle:{label:'Angle de pression (°)',type:'number',default:20,min:14.5,max:25,step:.5},profileShiftInput:{label:'Déport pignon x1',type:'number',default:0,min:-1,max:1,step:.05},profileShiftOutput:{label:'Déport couronne x2',type:'number',default:0,min:-1,max:1,step:.05}},
    bevel:{shaftAngle:{label:'Angle entre axes (°)',type:'number',default:90,min:10,max:170,step:5},faceWidth:{label:'Largeur (mm)',type:'number',default:10,min:1,step:.5}},
    worm:{wormStartsMin:{label:'Filets minimum',type:'number',default:1,min:1,max:6,step:1},wormStartsMax:{label:'Filets maximum',type:'number',default:6,min:1,max:6,step:1},leadAngle:{label:"Angle d'avance (°)",type:'number',default:20,min:5,max:45,step:1}},
    // §26, §27, §28 : « automatique » est la valeur par défaut et le reste
    // pour qui ne veut pas connaître S/R/C. Choisir « imposée » distingue une
    // topologie VOULUE d'une topologie simplement retenue par le moteur.
    planetary:{topologyMode:{label:'Configuration',type:'select',default:'auto',options:['auto','fixed'],optionLabels:{auto:'Automatique',fixed:'Imposée'}},planetCount:{label:'Nombre de satellites',type:'number',default:3,min:2,max:6,step:1},inputMember:{label:'Organe d’entrée',type:'select',default:'S',options:['S','R','C'],optionLabels:{S:'Solaire (S)',R:'Couronne (R)',C:'Porte-satellites (C)'},dependsOn:{topologyMode:'fixed'}},fixed:{label:'Organe fixe',type:'select',default:'R',options:['R','S','C'],optionLabels:{S:'Solaire (S)',R:'Couronne (R)',C:'Porte-satellites (C)'},dependsOn:{topologyMode:'fixed'}},outputMember:{label:'Organe de sortie',type:'select',default:'C',options:['C','S','R'],optionLabels:{S:'Solaire (S)',R:'Couronne (R)',C:'Porte-satellites (C)'},dependsOn:{topologyMode:'fixed'}}},
    belt:{profile:{label:'Profil',type:'select',default:'GT2',options:['GT2','GT3','HTD-3M','HTD-5M','HTD-8M','T5','T10']},centerDistance:{label:'Entraxe (mm)',type:'number',default:100,min:1,step:1},crossed:{label:'Courroie croisée',type:'checkbox',default:false}},
    chain:{pitch:{label:'Pas (mm)',type:'number',default:12.7,min:1,step:.1},centerDistance:{label:'Entraxe (mm)',type:'number',default:200,min:1,step:1}},
    rack:{faceWidth:{label:'Largeur pignon/crémaillère (mm)',type:'number',default:10,min:1,step:.5}}
  };
  var beltPitches={GT2:2,GT3:3,'HTD-3M':3,'HTD-5M':5,'HTD-8M':8,T5:5,T10:10};
  return { register: register, get: function(id){return types[id];}, distinctMembers: distinctMembers, PLANETARY_TOPOLOGIES: PLANETARY_TOPOLOGIES, list:function(){return Object.keys(types).filter(function(k){return k!=='epicyclic';}).map(function(k){return types[k];});},getAxisRelation:axisRelation,validateGeometryResult:validateGeometryResult,getToothCounts:function(s){return s.type==='worm'?[s.wheelTeeth]:s.type==='planetary'?[s.sunTeeth,s.planetTeeth,s.ringTeeth]:s.type==='rack'?[s.pinionTeeth]:[s.input.teeth,s.output.teeth];},getCharacteristicModule:function(s){return s.parameters&&s.parameters.module||null;},getCharacteristicWidths:function(s){var g=s.geometry||types[s.type].calculateGeometry(s);return g.width==null?[]:[g.width];},parameterDefinitions:parameterDefinitions,beltPitches:beltPitches, createLegacyStage:function(a,b,type,params){if(type==='worm')return {type:type,wormStarts:a,wheelTeeth:b,parameters:params||{}};if(type==='epicyclic'||type==='planetary')return {type:'planetary',sunTeeth:a,ringTeeth:b,planetTeeth:(b-a)/2,planetCount:(params&&params.planetCount)||3,inputMember:(params&&params.inputMember)||'S',outputMember:(params&&params.outputMember)||'C',fixed:(params&&params.fixed)||'R',parameters:params||{}};return candidatePair(type,a,b,params);}, toLegacy:function(s){return s.type==='worm'?[s.wormStarts,s.wheelTeeth,s.type]:s.type==='planetary'?[s.sunTeeth,s.ringTeeth,'epicyclic']:[s.input.teeth,s.output.teeth,s.type];} };
});
