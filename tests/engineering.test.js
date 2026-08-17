const test=require('node:test');const assert=require('node:assert/strict');
global.GearTransmissionRegistry=require('../js/transmissions/TransmissionRegistry.js');
const R=global.GearTransmissionRegistry,E=require('../js/core/Engineering.js');
const stage=(a,b,type='spur',p={module:2,pressureAngle:20,faceWidth:20})=>R.createLegacyStage(a,b,type,p);
test('spur and compound ratios',()=>{assert.equal(R.get('spur').calculateRatio(stage(20,40)),2);assert.equal(R.get('spur').calculateRatio(stage(20,40))*R.get('spur').calculateRatio(stage(20,60)),6);});
test('worm starts are explicit and independent',()=>{let s=stage(2,60,'worm',{module:2,leadAngle:20});assert.equal(s.wormStarts,2);assert.equal(R.get('worm').calculateRatio(s),30);});
test('internal ratio and center distance',()=>{let s=stage(20,60,'internal',{module:2});assert.equal(R.get('internal').calculateRatio(s),3);assert.equal(R.get('internal').calculateGeometry(s).centerDistance,40);});
test('Willis configurations',()=>{let base={type:'planetary',sunTeeth:20,ringTeeth:60,planetTeeth:20,planetCount:4,parameters:{module:2}};assert.equal(R.get('planetary').calculateRatio({...base,inputMember:'S',outputMember:'C',fixed:'R'}),4);assert.equal(R.get('planetary').calculateRatio({...base,inputMember:'R',outputMember:'C',fixed:'S'}),4/3);assert.equal(R.get('planetary').calculateRatio({...base,inputMember:'S',outputMember:'R',fixed:'C'}),-3);assert.equal(R.get('planetary').validateConfiguration(base),true);});
test('belt length and chain even links',()=>{let b=stage(20,40,'belt',{pitch:2,centerDistance:100,beltType:'timing'}),g=R.get('belt').calculateGeometry(b);assert.ok(g.length>200);let c=stage(15,45,'chain',{pitch:12.7,centerDistance:300}),cg=R.get('chain').calculateGeometry(c);assert.equal(cg.links%2,0);assert.equal(R.get('chain').calculateRatio(c),3);});
test('rack travel',()=>{let s={type:'rack',pinionTeeth:20,parameters:{module:2,rpm:100}};assert.ok(Math.abs(R.get('rack').calculateGeometry(s).travelPerRevolution-40*Math.PI)<1e-9);});
test('geometry forces mechanics scoring and constraints',()=>{let s=stage(20,40),sol=E.analyzeSolution([s],2,{inputTorqueNm:10,inputSpeedRpm:1500,inputMaterial:'C45',outputMaterial:'C45'});assert.equal(sol.ratio,2);assert.ok(Math.abs(sol.mechanical[0].forces.tangentialN-500)<1e-9);assert.ok(sol.outputSpeedRpm===750&&sol.outputTorqueNm>19);assert.ok(sol.mechanical[0].bending.method.includes('Simplified'));assert.ok(sol.score.value>=0);assert.equal(E.validateDimensions(sol.dimensions,{maxDiameter:10}).valid,false);});
test('fatigue and shaft estimates are explicitly estimates',()=>{assert.ok(E.fatigue(1000,{}).cycles>0);assert.ok(E.shaftEstimate(10,500,{supportDistanceMm:100}).minimumDiameterMm>0);});

test('material selection changes bending and contact safety factors',()=>{const stage=R.createLegacyStage(20,60,'spur',{module:2,faceWidth:20});const steel=E.analyzeSolution([JSON.parse(JSON.stringify(stage))],3,{inputTorqueNm:20,inputMaterial:'steel42CrMo4',outputMaterial:'steel42CrMo4'});const plastic=E.analyzeSolution([JSON.parse(JSON.stringify(stage))],3,{inputTorqueNm:20,inputMaterial:'PLA',outputMaterial:'PLA'});assert.ok(steel.mechanical[0].bending.safetyFactor>plastic.mechanical[0].bending.safetyFactor);assert.ok(steel.mechanical[0].contact.safetyFactor>plastic.mechanical[0].contact.safetyFactor);});

test('solution conditionally includes per-stage fatigue and shaft estimates',()=>{const stages=[stage(20,40,'spur',{module:2}),stage(20,60,'spur',{module:2})];const solution=E.analyzeSolution(stages,6,{inputTorqueNm:10,inputSpeedRpm:1200,fatigue:{enabled:true,hoursPerDay:4,daysPerYear:200,years:5,loadType:'heavy'},shaft:{supportDistanceMm:100,allowableShearMPa:70}});assert.equal(solution.fatigue.length,2);assert.equal(solution.shaft.length,2);assert.equal(solution.fatigue[0].operatingHours,4000);assert.ok(solution.fatigue[0].cycles>solution.fatigue[1].cycles);assert.ok(solution.shaft.every(x=>x.minimumDiameterMm>0));const disabled=E.analyzeSolution([stage(20,40,'spur',{module:2})],2,{});assert.equal(disabled.fatigue,undefined);assert.equal(disabled.shaft,undefined);});

test('a bevel gear pushes along its shaft; a spur one does not', () => {
  // Le conique était calculé comme un cylindrique : hélice nulle, donc effort
  // axial nul. C'est faux dans le sens dangereux — c'est précisément l'effort
  // qui chasse le pignon de son engrènement et dimensionne son roulement.
  const Registry = require('../js/transmissions/TransmissionRegistry.js');
  const bevel = { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 },
    parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15 } };
  const forces = Registry.get('bevel').calculateForces(bevel, 10);
  assert.ok(forces.axialN > 0, 'un renvoi d’angle pousse le long de l’arbre');

  // À 1:1 sous 90°, le demi-angle vaut 45° : les deux composantes s'égalisent.
  const square = { type: 'bevel', input: { teeth: 20 }, output: { teeth: 20 },
    parameters: { module: 2, shaftAngle: 90, pressureAngle: 20, faceWidth: 15 } };
  const balanced = Registry.get('bevel').calculateForces(square, 10);
  assert.ok(Math.abs(balanced.axialN - balanced.radialN) < 1e-6);

  // Fr² + Fa² retrouve l'effort de séparation Ft·tanα : la décomposition est
  // une rotation, elle ne crée ni ne perd d'effort.
  const separation = forces.tangentialN * Math.tan(20 * Math.PI / 180);
  assert.ok(Math.abs(Math.hypot(forces.radialN, forces.axialN) - separation) < 1e-6);

  // Le cylindrique reste inchangé : δ = 0 redonne exactement l'ancien calcul.
  const spur = { type: 'spur', input: { teeth: 20 }, output: { teeth: 60 },
    parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } };
  const flat = Registry.get('spur').calculateForces(spur, 10);
  assert.equal(flat.axialN, 0);
  assert.ok(Math.abs(flat.radialN - flat.tangentialN * Math.tan(20 * Math.PI / 180)) < 1e-9);
});

test('a worm drive turns according to its thread hand and its mesh side', () => {
  // Le registre renvoyait −1 quoi qu'il arrive, comme un couple cylindrique.
  // Pour un renvoi à 90°, le sens dépend du sens du filet ET du côté où la roue
  // engrène : inverser l'un OU l'autre inverse la roue, inverser les deux la
  // laisse tourner comme avant.
  const Registry = require('../js/transmissions/TransmissionRegistry.js');
  const worm = (handedness, meshSide) => ({ type: 'worm', wormStarts: 2, wheelTeeth: 40,
    parameters: { module: 2, leadAngle: 20, diameterQuotient: 10, handedness, meshSide } });
  const sense = (h, s) => Registry.get('worm').rotationDirection(worm(h, s));
  assert.equal(sense('right', 1), -1);
  assert.equal(sense('left', 1), 1);
  assert.equal(sense('right', -1), 1);
  assert.equal(sense('left', -1), -1, 'les deux inversions se compensent');

  // Le cas par défaut redonne exactement le comportement précédent : cette
  // propriété ajoute une possibilité, elle ne retourne pas en silence tous les
  // réducteurs déjà décrits.
  assert.equal(Registry.get('worm').rotationDirection(
    { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2 } }), -1);

  // Et le sens est déclarable dans le schéma de paramètres, sans quoi le
  // renderer ne pourrait mathématiquement pas le connaître.
  assert.ok(Registry.parameterDefinitions.worm.handedness);
  assert.ok(Registry.parameterDefinitions.worm.meshSide);
});

test('a helical gear pushes to the side its helix leans', () => {
  const Registry = require('../js/transmissions/TransmissionRegistry.js');
  const helical = handedness => ({ type: 'helical', input: { teeth: 18 }, output: { teeth: 54 },
    parameters: { module: 2, helixAngle: 25, pressureAngle: 20, faceWidth: 20, handedness } });
  const right = Registry.get('helical').calculateForces(helical('right'), 10);
  const left = Registry.get('helical').calculateForces(helical('left'), 10);
  // Un effort axial sans signe ne dit pas de quel côté prévoir la butée.
  assert.ok(right.axialN > 0);
  assert.ok(Math.abs(left.axialN + right.axialN) < 1e-9, 'même intensité, sens opposé');
  // Le reste de l'engrènement est inchangé.
  assert.equal(left.tangentialN, right.tangentialN);
  assert.equal(left.radialN, right.radialN);
  assert.ok(Registry.parameterDefinitions.helical.handedness);
});
