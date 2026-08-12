const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../js/transmissions/TransmissionRegistry.js');
const E=require('../js/core/Engineering.js');
const Search=require('../js/core/SearchEngine.js');

function finiteOrNull(value,path){assert.notEqual(value,undefined,`${path} is undefined`);if(value!==null)assert.ok(Number.isFinite(value),`${path} is not finite`);}
function assertFiniteEngineeringResult(solution){
  for(const key of ['ratio','efficiency','inputSpeedRpm','outputSpeedRpm','inputTorqueNm','outputTorqueNm','inputPowerW','outputPowerW'])finiteOrNull(solution[key],key);
  for(const [key,value] of Object.entries(solution.dimensions))finiteOrNull(value,`dimensions.${key}`);
  solution.mechanical.forEach((m,i)=>{for(const [key,value] of Object.entries(m.geometry))if(typeof value==='number')finiteOrNull(value,`mechanical.${i}.geometry.${key}`);for(const key of ['tangentialN','radialN','axialN'])finiteOrNull(m.forces[key],`mechanical.${i}.forces.${key}`);for(const kind of ['bending','contact']){if(m[kind]===null){assert.equal(m.mechanicalStatus,'unsupported');continue;}finiteOrNull(m[kind].stressMPa,`${kind}.stress`);finiteOrNull(m[kind].safetyFactor,`${kind}.safety`);}});
}
const stage=(a,b,type='spur',parameters={module:2,pressureAngle:20,faceWidth:15})=>R.createLegacyStage(a,b,type,parameters);

test('finite engineering invariant and planetary Hertz across Willis configurations',()=>{
  const configurations=[['S','C','R'],['R','C','S'],['S','R','C']];
  for(const [inputMember,outputMember,fixed] of configurations){const p=stage(20,60,'planetary',{module:2,pressureAngle:20,faceWidth:15,planetCount:4,inputMember,outputMember,fixed});const solution=E.analyzeSolution([p],Math.abs(R.get('planetary').calculateRatio(p)),{inputTorqueNm:20});assertFiniteEngineeringResult(solution);assert.ok(Number.isFinite(solution.mechanical[0].contact.stressMPa));assert.ok(Number.isFinite(solution.mechanical[0].contact.safetyFactor));}
});

test('all rotary geometries implement their common contract',()=>{const samples=[stage(20,40),stage(20,40,'helical',{module:2,helixAngle:25}),stage(20,60,'internal',{module:2}),stage(20,40,'bevel',{module:2,shaftAngle:90}),stage(2,40,'worm',{module:2,leadAngle:20}),stage(20,60,'planetary',{module:2,planetCount:4}),stage(20,40,'belt',{module:1,pitch:2,centerDistance:100}),stage(15,45,'chain',{module:1,pitch:12.7,centerDistance:300})];for(const s of samples){const g=R.get(s.type).calculateGeometry(s);assert.equal(R.validateGeometryResult(s,g).valid,true,s.type);for(const key of ['pitchDiameterInput','pitchDiameterOutput','maxDiameter','width','centerDistance','axisRelation'])assert.notEqual(g[key],undefined,`${s.type}.${key}`);}});

test('candidate maxRatio is enforced centrally',()=>{for(const type of ['spur','helical','internal','bevel','belt','chain']){const def=R.get(type),opts={inputMin:10,inputMax:10,outputMin:Math.ceil(10*(def.constraints.maxRatio+1)),outputMax:Math.ceil(10*(def.constraints.maxRatio+1)),reductionOnly:true,typeParameters:{[type]:{pitch:2,centerDistance:500}}};assert.equal(def.generateCandidates(opts).length,0,type);}});

test('bevel cone angles and helical transverse geometry are coherent',()=>{const b=R.get('bevel').calculateGeometry(stage(20,40,'bevel',{module:2,shaftAngle:90,faceWidth:10}));assert.ok(Math.abs(b.pitchConeAngleInput+ b.pitchConeAngleOutput-90)<1e-10);assert.ok(Math.abs(b.pitchConeAngleInput-26.565051177)<1e-6);const h=R.get('helical').calculateGeometry(stage(20,40,'helical',{module:2,helixAngle:30,pressureAngle:20,faceWidth:20}));assert.ok(Math.abs(h.pitchDiameterInput-40/Math.cos(Math.PI/6))<1e-9);assert.ok(h.transversePressureAngleDeg>20);});

test('profile shift changes working center distance and pressure angle',()=>{const zero=R.get('spur').calculateGeometry(stage(20,40,'spur',{module:2,pressureAngle:20})),shift=R.get('spur').calculateGeometry(stage(20,40,'spur',{module:2,pressureAngle:20,profileShiftInput:.3,profileShiftOutput:.2}));assert.ok(Math.abs(zero.workingPressureAngleDeg-20)<1e-9);assert.ok(shift.centerDistance>zero.centerDistance);assert.ok(shift.workingPressureAngleDeg>zero.workingPressureAngleDeg);});

test('open/crossed belts and integer belt/chain lengths alter realizable center distance',()=>{const open=R.get('belt').calculateGeometry(stage(20,40,'belt',{pitch:2,centerDistance:100,crossed:false})),crossed=R.get('belt').calculateGeometry(stage(20,40,'belt',{pitch:2,centerDistance:100,crossed:true}));assert.notEqual(open.theoreticalLength,crossed.theoreticalLength);assert.equal(open.actualLength,open.selectedBeltTeeth*2);assert.ok(Number.isFinite(open.correctedCenterDistance));const chain=R.get('chain').calculateGeometry(stage(15,45,'chain',{pitch:12.7,centerDistance:300}));assert.equal(chain.selectedLinks%2,0);assert.equal(chain.actualLength,chain.selectedLinks*12.7);assert.ok(Number.isFinite(chain.correctedCenterDistance));});

test('automatic module is mechanically selected and records rejected modules',()=>{const base={rapportCible:3,dentMenanteMin:20,dentMenanteMax:20,dentMeneeMin:60,dentMeneeMax:60,precisionToleree:.001,maxEtages:1,maxSolutions:1,typesActifs:['spur'],typeParameters:{spur:{faceWidth:10}},moduleMode:'automatic',moduleMin:.5,moduleMax:5,vitesseEntree:1000,constraints:{minimumBendingSafety:1.5,minimumContactSafety:1.2}};const low=Search.search({...base,coupleEntree:1}).solutions[0],high=Search.search({...base,coupleEntree:20}).solutions[0];assert.ok(low&&high);assert.ok(high.moduleSelection.selected>low.moduleSelection.selected);assert.ok(high.moduleSelection.rejected.some(x=>x.reasons.includes('bendingSafety')||x.reasons.includes('contactSafety')));});

module.exports={assertFiniteEngineeringResult};
