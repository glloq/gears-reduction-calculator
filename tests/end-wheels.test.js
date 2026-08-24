// end-wheels.test.js - Les deux roues qui existaient avant le réducteur.
//
// Le pignon déjà monté sur le moteur et la roue déjà taillée sur l'arbre de
// sortie ne sont pas des réglages : ce sont des pièces. La transmission doit
// s'y raccorder, et c'est tout ce qu'on lui demande de trouver entre les deux.
const test = require('node:test');
const assert = require('node:assert/strict');
const Build = require('../js/requirements/BuildModel.js');
const Engine = require('../js/core/SearchEngine.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function model(stageCount, families) {
  const built = new Build.BuildModel();
  for (let i = 0; i < stageCount; i++) built.addStage((families || [])[i] || null);
  return built;
}

function params(built, target, overrides) {
  return Object.assign({
    objectiveMode: 'ratio', rapportCible: target, precisionToleree: 1,
    typesActifs: built.families().length ? built.families() : ['spur'],
    dentMenanteMin: 10, dentMenanteMax: 30, dentMeneeMin: 20, dentMeneeMax: 120,
    maxEtages: 4, module: 1, moduleMode: 'fixed', maxIterations: 300000,
    vitesseEntree: 1500, coupleEntree: 10, constraints: {}, weights: {},
    stageConstraints: built.toStageConstraints()
  }, overrides || {});
}

// ===== Une roue est la moitié d'un engrènement, pas un étage de plus =====

test('an end wheel writes itself into the stage it meshes with', () => {
  const built = model(2, ['spur', 'spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12);
  built.outputWheel.setFamily('spur').set('teeth', 60);
  const resolved = built.resolved();
  // Entrée = organe MENANT du premier étage, sortie = organe MENÉ du dernier.
  assert.equal(resolved[0].values['input.teeth'], 12);
  assert.equal(resolved[1].values['output.teeth'], 60);
  // Et surtout : la chaîne fait toujours deux étages. Compter les roues à part
  // ferait apparaître des étages fantômes dans le rapport et l'encombrement.
  assert.equal(built.stages.length, 2);
  assert.equal(built.toStageConstraints().length, 2);
});

test('the organ a wheel designates is deduced from the family, never guessed', () => {
  const built = model(1, ['worm']);
  // « La roue d'entrée a 2 dents » n'a aucun sens sur une vis : ce qu'on tient
  // en main, ce sont deux FILETS. Le chemin suit donc la famille.
  built.inputWheel.setFamily('worm').set('teeth', 2);
  built.outputWheel.setFamily('worm').set('teeth', 40);
  const resolved = built.resolved();
  assert.equal(resolved[0].values.wormStarts, 2);
  assert.equal(resolved[0].values.wheelTeeth, 40);
  assert.equal(resolved[0].values['input.teeth'], undefined);

  const planetary = model(1, ['planetary']);
  planetary.inputWheel.setFamily('planetary').set('teeth', 18);
  assert.equal(planetary.resolved()[0].values.sunTeeth, 18);
});

test('a wheel removes an unknown instead of adding one', () => {
  const built = model(1, ['spur']);
  assert.equal(built.levels()[0], Build.LEVELS.AUTO);
  built.inputWheel.setFamily('spur').set('teeth', 12);
  assert.equal(built.levels()[0], Build.LEVELS.PARTIAL, 'la menante est désormais connue');
  built.outputWheel.setFamily('spur').set('teeth', 48);
  assert.equal(built.levels()[0], Build.LEVELS.FIXED);
  assert.equal(built.unknownCount(), 0);
  assert.equal(built.ratio(), 4);
  // Et l'inverse : effacer la roue REDONNE la liberté.
  built.outputWheel.clear();
  assert.equal(built.levels()[0], Build.LEVELS.PARTIAL);
});

test('a wheel names the family of the stage it meshes with', () => {
  // On voit la pièce avant d'avoir décidé quoi que ce soit du réducteur :
  // « j'ai un pignon conique » suffit à fixer la nature de l'engrènement.
  const built = model(1);
  built.inputWheel.setFamily('bevel').set('teeth', 18);
  assert.equal(built.resolved()[0].family, 'bevel');
  assert.deepEqual(built.families(), ['bevel']);
  assert.deepEqual(built.toTemplate(), [['bevel']]);
});

// ===== Le solveur ne cherche que ce qui reste =====

test('the solver honours both ends and completes the middle', () => {
  const built = model(2, ['spur', 'spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12);
  built.outputWheel.setFamily('spur').set('teeth', 60);
  const result = Engine.search(params(built, 20));
  assert.ok(result.solutions.length, 'le solveur doit compléter la chaîne');
  result.solutions.forEach(solution => {
    assert.equal(solution.stages.length, 2);
    assert.equal(solution.stages[0].input.teeth, 12);
    assert.equal(solution.stages[1].output.teeth, 60);
    assert.ok(Math.abs(solution.ratio - 20) / 20 * 100 <= 1);
  });
});

test('two real wheels may carry two different modules', () => {
  // C'était impossible : le moteur appliquait UN module à toute la chaîne, si
  // bien qu'un pignon moteur en module 0,8 et une roue de sortie en module 1,5
  // ne pouvaient pas coexister — alors que ce sont deux engrènements distincts.
  const built = model(2, ['spur', 'spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12).set('module', 0.8).set('faceWidth', 6);
  built.outputWheel.setFamily('spur').set('teeth', 60).set('module', 1.5);
  const result = Engine.search(params(built, 20));
  assert.ok(result.solutions.length);
  result.solutions.forEach(solution => {
    assert.equal(solution.stages[0].parameters.module, 0.8);
    assert.equal(solution.stages[0].parameters.faceWidth, 6);
    assert.equal(solution.stages[1].parameters.module, 1.5);
  });
  // La géométrie lit bien ces modules-là : Ø primitif = m · z.
  const first = result.solutions[0];
  assert.equal(first.mechanical[0].geometry.pitchDiameterInput, 0.8 * 12);
  assert.equal(first.mechanical[1].geometry.pitchDiameterOutput, 1.5 * 60);
});

test('a wheel bigger than the swept range is still reachable', () => {
  // La plage s'arrête à 50 dents, la roue en a 90 : sans élargissement, la
  // recherche ne renvoyait rien sans dire que c'était la PLAGE qui bloquait.
  const built = model(1, ['spur']);
  built.outputWheel.setFamily('spur').set('teeth', 90);
  const result = Engine.search(params(built, 5, { dentMeneeMax: 50 }));
  assert.ok(result.solutions.length);
  assert.equal(result.solutions[0].stages[0].output.teeth, 90);
});

test('a pulley is never given a module it does not have', () => {
  const built = model(1, ['belt']);
  built.inputWheel.set('module', 2);
  assert.equal(Registry.get('belt').capabilities.usesModule, false);
  const result = Engine.search(params(built, 2, { typesActifs: ['belt'],
    typeParameters: { belt: { profile: 'GT2', pitch: 2, beltType: 'timing', centerDistance: 120, crossed: false, width: 10 } } }));
  assert.ok(result.solutions.length);
  result.solutions.forEach(solution => {
    assert.equal(solution.stages[0].parameters.module, undefined,
      'un module écrit sur une poulie ferait lire une denture qui n’existe pas');
  });
});

test('a chain with no wheels searches exactly as before', () => {
  const built = model(1, ['spur']);
  const before = Engine.search(params(built, 3));
  assert.ok(before.solutions.length);
  assert.deepEqual(built.toStageConstraints()[0].parameters, {});
});

// ===== Une contradiction se montre, elle ne s'arbitre pas en silence =====

test('a wheel that contradicts its stage is reported, not resolved', () => {
  const built = model(1, ['spur']);
  built.inputWheel.setFamily('helical').set('teeth', 12);
  const errors = built.errors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].wheel, 'input');
  // Elle se corrige sur la roue OU sur l'étage : la ranger sous « Étage 1 »
  // enverrait modifier la mauvaise pièce.
  assert.equal(errors[0].stage, null);
  assert.match(errors[0].label, /entrée/);
  // La famille de l'étage l'emporte tant que la contradiction dure : rien
  // n'est réécrit dans le dos de l'utilisateur.
  assert.equal(built.resolved()[0].family, 'spur');
});

test('one stage cannot carry two wheels of two different modules', () => {
  const built = model(1, ['spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12).set('module', 1);
  built.outputWheel.setFamily('spur').set('teeth', 48).set('module', 2);
  // Les deux roues engrènent ENSEMBLE : deux modules décriraient un
  // engrènement impossible.
  assert.ok(built.errors().some(e => /module/.test(e.text)));
  built.outputWheel.set('module', 1);
  assert.deepEqual(built.errors(), []);
});

test('teeth without a family designate nothing, and it is said', () => {
  const built = model(1);
  built.inputWheel.set('teeth', 12);
  assert.ok(built.errors().some(e => /famille/.test(e.text)));
  // Une famille écrite sur l'étage suffit : elle n'a pas à être redite.
  built.stage(0).setFamily('spur');
  assert.deepEqual(built.errors(), []);
  assert.equal(built.resolved()[0].values['input.teeth'], 12);
});

test('a wheel without any stage is reported rather than ignored', () => {
  const built = new Build.BuildModel();
  built.outputWheel.setFamily('spur').set('teeth', 60);
  assert.ok(built.errors().some(e => e.wheel === 'output'));
  assert.deepEqual(built.resolved(), []);
});

// ===== Ce qui n'a plus de sens ne survit pas, et ce qui est décrit se range =====

test('changing family drops the quantities that no longer exist', () => {
  const wheel = new Build.EndWheel('input');
  wheel.setFamily('helical').set('teeth', 20).set('helixAngle', 15);
  assert.equal(wheel.get('helixAngle'), 15);
  wheel.setFamily('spur');
  assert.equal(wheel.get('helixAngle'), null, 'un pignon droit n’a pas d’angle d’hélice');
  assert.equal(wheel.get('teeth'), 20, 'ce qui vaut encore est gardé');
  // Une poulie n'a pas de module : le champ disparaît avec la famille.
  wheel.setFamily('spur').set('module', 1.5);
  wheel.setFamily('belt');
  assert.equal(wheel.get('module'), null);
});

test('described wheels survive being stored and reopened', () => {
  const built = model(2, ['spur', 'spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12).set('module', 0.8);
  built.outputWheel.setFamily('spur').set('teeth', 60);
  const copy = built.clone();
  assert.equal(copy.inputWheel.get('teeth'), 12);
  assert.equal(copy.inputWheel.get('module'), 0.8);
  assert.equal(copy.outputWheel.get('teeth'), 60);
  assert.deepEqual(copy.toStageConstraints(), built.toStageConstraints());
  // Le clone est bien indépendant : l'éditer ne touche pas l'original.
  copy.inputWheel.set('teeth', 14);
  assert.equal(built.inputWheel.get('teeth'), 12);
});

test('the trace says which values came from a real wheel', () => {
  const built = model(2, ['spur', 'spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12).set('module', 0.8);
  const origin = built.toOrigin();
  // « 12 → 96 » ne dit pas que le 12 était déjà taillé et monté.
  assert.equal(origin[0].wheel, 'input');
  assert.equal(origin[0].fields['input.teeth'], true);
  assert.equal(origin[0].parameters.module, true);
  assert.equal(origin[1].wheel, undefined);
});

test('a chain closed by its two wheels is analysed, not searched', () => {
  const built = model(1, ['spur']);
  built.inputWheel.setFamily('spur').set('teeth', 12).set('module', 1.5);
  built.outputWheel.setFamily('spur').set('teeth', 48);
  assert.equal(built.isComplete(), true);
  const solution = built.analyze({ inputSpeedRpm: 1500, inputTorqueNm: 10 });
  assert.ok(solution, 'une chaîne entièrement décrite se calcule directement');
  assert.equal(solution.ratio, 4);
  // Le module de la roue prime sur celui de la chaîne : elle a celui qu'elle a.
  assert.equal(solution.stages[0].parameters.module, 1.5);
});
