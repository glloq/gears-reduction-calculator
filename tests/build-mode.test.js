const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Workspace = require('../js/requirements/WorkspaceModel.js');
const Build = require('../js/requirements/BuildModel.js');
const Engine = require('../js/core/SearchEngine.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function chain(spec) {
  const model = new Build.BuildModel();
  spec.forEach(entry => {
    model.addStage(entry.family || null);
    const stage = model.stage(model.stages.length - 1);
    Object.keys(entry.values || {}).forEach(path => stage.set(path, entry.values[path]));
  });
  return model;
}

// ===== Le mode de travail n'est pas une intention de recherche =====

test('half the work modes run no solver at all', () => {
  const workspace = new Workspace.WorkspaceModel();
  // C'est précisément ce que `SearchIntentModel` ne pouvait pas exprimer :
  // « dis-moi ce que fait ce mécanisme » ne demande rien à aucun solveur.
  assert.equal(workspace.setMode('analyze').runsSearch(), false);
  assert.equal(workspace.setMode('analyze').searchIntent(), null);
  assert.equal(workspace.setMode('design').runsSearch(), true);
  assert.equal(workspace.setMode('explore').searchIntent(), 'maximize');
  assert.equal(workspace.setMode('optimize').searchIntent(), 'improve');
  // Décrire une chaîne, ce n'est pas décrire un besoin : le parcours diffère.
  assert.equal(workspace.setMode('build').editsChain(), true);
  assert.equal(workspace.setMode('design').editsChain(), false);
});

test('what Build runs is deduced from the chain, never asked twice', () => {
  const workspace = new Workspace.WorkspaceModel('build');
  // « Entièrement manuel », « compléter » et « dimensionner » ne diffèrent que
  // par ce qui est déjà connu. Les faire choisir en plus laisserait cocher
  // « manuel » sur une chaîne incomplète — une réponse qui contredit la saisie.
  assert.equal(workspace.engineFor(2), Workspace.ENGINES.complete);
  assert.equal(workspace.engineFor(0), Workspace.ENGINES.analyze);
  // Les autres modes ne dépendent pas de la chaîne.
  assert.equal(new Workspace.WorkspaceModel('design').engineFor(0), Workspace.ENGINES.search);
});

test('a mode with no effect is declared, never displayed', () => {
  const source = fs.readFileSync('js/requirements/WorkspaceModel.js', 'utf8');
  assert.deepEqual(Workspace.PLANNED.map(m => m.id), ['compare']);
  assert.ok(!Workspace.mode('compare'), 'un mode planifié ne doit pas être proposé');
  assert.match(source, /PLANNED/);
});

// ===== Trois degrés de liberté, déduits de ce qui est écrit =====

test('a stage is imposed, partial or automatic according to what it carries', () => {
  const model = chain([{ family: 'spur' }]);
  const stage = model.stage(0);
  assert.equal(stage.level(), Build.LEVELS.AUTO, 'une famille seule ne fixe rien');
  stage.set('input.teeth', 20);
  assert.equal(stage.level(), Build.LEVELS.PARTIAL);
  stage.set('output.teeth', 60);
  assert.equal(stage.level(), Build.LEVELS.FIXED);
  // Et l'inverse : vider un champ REDONNE la liberté. Sans cela, il serait
  // impossible de dé-fixer une denture après l'avoir saisie.
  stage.set('output.teeth', null);
  assert.equal(stage.level(), Build.LEVELS.PARTIAL);
  // Un étage sans famille reste automatique quoi qu'il arrive.
  assert.equal(chain([{}]).stage(0).level(), Build.LEVELS.AUTO);
});

test('changing family drops the teeth that no longer mean anything', () => {
  const model = chain([{ family: 'spur', values: { 'input.teeth': 20, 'output.teeth': 60 } }]);
  const stage = model.stage(0);
  assert.equal(stage.level(), Build.LEVELS.FIXED);
  // « 20 dents menantes » n'existe pas sur une vis : les garder produirait un
  // étage silencieusement faux, qui se croirait complet.
  stage.setFamily('worm');
  assert.deepEqual(stage.values, {});
  assert.equal(stage.level(), Build.LEVELS.AUTO);
  // Ce qui reste valable est conservé : le nombre de satellites survit à un
  // changement de topologie planétaire.
  const planetary = chain([{ family: 'planetary', values: { sunTeeth: 20, planetCount: 4 } }]).stage(0);
  planetary.setFamily('planetary');
  assert.equal(planetary.values.planetCount, 4);
});

test('the chain says how much is left to find, and refuses to pretend otherwise', () => {
  const model = chain([
    { family: 'bevel', values: { 'input.teeth': 18, 'output.teeth': 54 } },
    { family: 'spur', values: { 'input.teeth': 20 } }
  ]);
  assert.equal(model.unknownCount(), 1);
  assert.equal(model.isComplete(), false);
  // Une chaîne partielle ne rend PAS d'étages : le faire laisserait croire
  // qu'elle est calculable.
  assert.equal(model.toStages(), null);
  assert.equal(model.ratio(), null);
  assert.match(model.describe(), /1 à compléter/);

  model.stage(1).set('output.teeth', 60);
  assert.equal(model.isComplete(), true);
  assert.equal(model.toStages().length, 2);
  assert.equal(Math.round(model.ratio() * 1000) / 1000, 9);
});

test('a completed chain is analysed by the same engineering as any solution', () => {
  const model = chain([
    { family: 'spur', values: { 'input.teeth': 20, 'output.teeth': 60 } },
    { family: 'planetary', values: { sunTeeth: 20, ringTeeth: 70 } }
  ]).setModule(1.5);
  const solution = model.analyze({ inputSpeedRpm: 1500, inputTorqueNm: 10 });
  assert.ok(solution, 'la chaîne doit être analysable');
  assert.equal(Math.round(solution.ratio * 100) / 100, 13.5);
  assert.ok(solution.efficiency > 0 && solution.efficiency < 1);
  assert.ok(solution.mechanical.length === 2);
  assert.equal(solution.errorPercent, 0, 'rien n’a été visé : parler d’écart n’a pas de sens');
  assert.equal(solution.isBuilt, true);
});

test('a chain that cannot exist is reported, not analysed', () => {
  // (79 − 20) / 2 = 29,5 : le satellite devrait avoir une demi-dent.
  const model = chain([{ family: 'planetary', values: { sunTeeth: 20, ringTeeth: 79 } }]);
  assert.ok(model.errors().length, 'l’étage impossible doit être signalé');
  assert.equal(model.analyze({ inputSpeedRpm: 1500, inputTorqueNm: 10 }), null);
  // Un étage encore inconnu ne peut pas être faux : on ne juge que le décrit.
  assert.equal(chain([{ family: 'planetary', values: { sunTeeth: 20 } }]).errors().length, 0);
});

// ===== Le solveur ne cherche que les inconnues =====

function searchParams(model, target, overrides) {
  return Object.assign({
    objectiveMode: 'ratio', rapportCible: target, precisionToleree: 1,
    typesActifs: model.families().length ? model.families() : ['spur'],
    dentMenanteMin: 10, dentMenanteMax: 30, dentMeneeMin: 20, dentMeneeMax: 120,
    maxEtages: 4, module: 1, moduleMode: 'fixed', maxIterations: 300000,
    vitesseEntree: 1500, coupleEntree: 10, constraints: {}, weights: {},
    stageConstraints: model.toStageConstraints()
  }, overrides || {});
}

test('the solver honours the stages already decided and completes the rest', () => {
  const model = chain([
    { family: 'spur', values: { 'input.teeth': 20, 'output.teeth': 60 } },   // 3:1 imposé
    { family: 'spur' }                                                        // à trouver
  ]);
  const result = Engine.search(searchParams(model, 15));
  assert.ok(result.solutions.length, 'le solveur doit compléter la chaîne');
  result.solutions.forEach(solution => {
    assert.equal(solution.stages.length, 2, 'la longueur de la chaîne est une décision, pas une inconnue');
    assert.equal(solution.stages[0].input.teeth, 20);
    assert.equal(solution.stages[0].output.teeth, 60);
    assert.ok(Math.abs(solution.ratio - 15) / 15 * 100 <= 1);
  });
});

test('a partly known stage constrains without over-constraining', () => {
  // « pignon 20 dents, le reste à trouver » : c'est la demande la plus
  // fréquente dès qu'une roue est déjà taillée.
  const model = chain([{ family: 'spur', values: { 'input.teeth': 20 } }]);
  const result = Engine.search(searchParams(model, 3));
  assert.ok(result.solutions.length);
  result.solutions.forEach(solution => {
    assert.equal(solution.stages[0].input.teeth, 20);
    assert.equal(solution.stages[0].output.teeth, 60);
  });
});

test('a family imposed on one stage does not leak onto the others', () => {
  const model = chain([{ family: 'planetary' }, { family: 'spur' }]);
  const result = Engine.search(searchParams(model, 12));
  assert.ok(result.solutions.length);
  result.solutions.forEach(solution => {
    assert.equal(solution.stages[0].type, 'planetary');
    assert.equal(solution.stages[1].type, 'spur');
  });
});

test('a pinned tooth count outside the swept range is still reachable', () => {
  // 90 dents alors que la plage s'arrête à 50 : la recherche ne renvoyait rien,
  // sans dire que c'était la plage — et non la denture — qui bloquait.
  const model = chain([{ family: 'spur', values: { 'input.teeth': 18, 'output.teeth': 90 } }]);
  const params = searchParams(model, 5, { dentMeneeMax: 50 });
  const result = Engine.search(params);
  assert.ok(result.solutions.length, 'la denture épinglée doit élargir le balayage');
  assert.equal(result.solutions[0].stages[0].output.teeth, 90);
});

test('an imposed family is explored even when it was not ticked', () => {
  // Sans cette union, aucun candidat n'est engendré et la recherche échoue
  // sans expliquer que la famille demandée n'était simplement pas active.
  const model = chain([{ family: 'planetary' }]);
  const params = searchParams(model, 4.5, { typesActifs: ['spur'] });
  const result = Engine.search(params);
  assert.ok(result.solutions.length);
  assert.equal(result.solutions[0].stages[0].type, 'planetary');
});

test('the pinned members of a planetary are honoured by the solver', () => {
  const model = chain([{ family: 'planetary', values: { inputMember: 'R', fixed: 'S', outputMember: 'C' } }]);
  const result = Engine.search(searchParams(model, 1.5));
  assert.ok(result.solutions.length);
  result.solutions.forEach(solution => {
    assert.equal(solution.stages[0].inputMember, 'R');
    assert.equal(solution.stages[0].fixed, 'S');
  });
  assert.ok(Registry.get('planetary').validateConfiguration(result.solutions[0].stages[0]));
});

test('an unconstrained search is untouched by the new filter', () => {
  const free = Object.assign(searchParams(new Build.BuildModel(), 12), { stageConstraints: [] });
  const result = Engine.search(free);
  assert.ok(result.solutions.length, 'la recherche libre doit continuer de fonctionner');
  // Sans contrainte de chaîne, la profondeur reste explorée de 1 à maxEtages.
  assert.ok(result.solutions.some(s => s.stages.length === 1) ||
    result.solutions.every(s => s.stages.length <= 4));
});

// ===== §2 : rien n'est inventé quand rien n'est renseigné =====

const Engineering = require('../js/core/Engineering.js');

test('a chain analysed without service conditions leaves them unevaluated', () => {
  const stages = [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 },
    parameters: { module: 1.5, pressureAngle: 20 } }];
  const blind = Engineering.analyzeSolution(JSON.parse(JSON.stringify(stages)), 3, {});
  // Rapport et géométrie ne dépendent d'aucun régime : ils tiennent.
  assert.equal(blind.ratio, 3);
  assert.equal(blind.mechanical[0].geometry.pitchDiameterInput, 30);
  assert.ok(blind.efficiency > 0);
  // Tout le reste était rempli avec 1500 rpm et 10 N·m — un régime que
  // personne n'avait choisi, d'où des facteurs de sécurité d'apparence sérieuse.
  assert.equal(blind.inputSpeedRpm, null);
  assert.equal(blind.outputSpeedRpm, null);
  assert.equal(blind.inputTorqueNm, null);
  assert.equal(blind.outputTorqueNm, null);
  assert.equal(blind.inputPowerW, null);
  assert.equal(blind.outputPowerW, null);
  assert.equal(blind.lossPowerW, null);
  assert.equal(blind.thermalRisk, null, 'un risque thermique « faible » serait tiré de rien');
  assert.equal(blind.mechanical[0].bending, null);
  assert.equal(blind.mechanical[0].contact, null);
  assert.deepEqual(blind.mechanical[0].forces, { tangentialN: null, radialN: null, axialN: null });
  // « Je ne sais pas » n'est pas « c'est impossible » : les deux n'appellent
  // pas la même action de l'utilisateur.
  assert.equal(blind.mechanical[0].bendingStatus, 'not-evaluated');
  assert.notEqual(blind.mechanical[0].bendingStatus, 'unsupported');
  // Aucun avertissement tiré d'un effort qu'on n'a pas calculé.
  assert.equal(blind.warnings.filter(w => /AXIAL|THERMAL|SAFETY/.test(w.code)).length, 0);
});

test('stating the regime restores every level', () => {
  const stages = [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 },
    parameters: { module: 1.5, pressureAngle: 20 } }];
  const known = Engineering.analyzeSolution(JSON.parse(JSON.stringify(stages)), 3,
    { inputSpeedRpm: 900, inputTorqueNm: 25 });
  assert.equal(known.outputSpeedRpm, 300);
  assert.ok(known.outputTorqueNm > 70 && known.outputTorqueNm < 75);
  assert.ok(Number.isFinite(known.mechanical[0].bending.safetyFactor));
  assert.equal(known.mechanical[0].bendingStatus, 'evaluated');
  assert.ok(known.thermalRisk);
});

test('a fatigue or shaft estimate is skipped rather than guessed', () => {
  const stages = [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 },
    parameters: { module: 1.5, pressureAngle: 20 } }];
  const blind = Engineering.analyzeSolution(JSON.parse(JSON.stringify(stages)), 3,
    { fatigue: { enabled: true, hoursPerDay: 8 }, shaft: { supportDistanceMm: 40 } });
  assert.equal(blind.fatigue, undefined, 'pas de cycles sans vitesse');
  assert.equal(blind.shaft, undefined, 'pas de diamètre d’arbre sans couple');
});

test('the nominal regime assumed by the solver is named in exactly one place', () => {
  const Adapter = require('../js/requirements/LegacySearchAdapter.js');
  // Une recherche ne peut pas dimensionner sans un régime quelconque : celui-ci
  // est une HYPOTHÈSE, et la référence d'une comparaison doit être mesurée sous
  // la même, sinon le « avant / après » ne compare plus rien.
  assert.deepEqual(Adapter.SERVICE_DEFAULTS, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
  const engineering = fs.readFileSync('js/core/Engineering.js', 'utf8');
  assert.doesNotMatch(engineering, /inputTorqueNm==null\?10/);
  assert.doesNotMatch(engineering, /inputSpeedRpm==null\?1500/);
  const session = fs.readFileSync('js/ui/SearchSession.js', 'utf8');
  assert.doesNotMatch(session, /speed\.nominal\(\) \|\| 1500/);
  assert.match(session, /SERVICE_DEFAULTS/, 'la référence doit réclamer l’hypothèse explicitement');
});

// ===== §16 : la fiche d'un étage connaît sa famille =====

test('a worm reports what makes it a worm: its lead angle and its holding', () => {
  const worm = stage => ({ type: 'worm', wormStarts: 1, wheelTeeth: 40,
    parameters: Object.assign({ module: 2, frictionCoefficient: 0.06 }, stage) });
  // La raison la plus fréquente de choisir une vis est de tenir une charge à
  // l'arrêt — et ce n'est PAS une propriété de la famille : c'est l'angle
  // d'avance face au frottement qui décide. Une fiche générique laissait donc
  // de côté la seule chose qu'on voulait vérifier.
  assert.equal(Registry.wormDetails(worm({ leadAngle: 3 })).selfLocking, true);
  assert.equal(Registry.wormDetails(worm({ leadAngle: 20 })).selfLocking, false);
  // Le rendement inverse devient négatif quand la vis se bloque : impossible à
  // rétro-entraîner, ce que « irréversible » dit en mots.
  assert.ok(Registry.wormDetails(worm({ leadAngle: 3 })).backDrivingEfficiency < 0);
  assert.ok(Registry.wormDetails(worm({ leadAngle: 20 })).backDrivingEfficiency > 0);
  // Le seuil suit le frottement, pas une constante cachée.
  assert.equal(Registry.wormDetails(worm({ leadAngle: 5, frictionCoefficient: 0.2 })).selfLocking, true);
  assert.equal(Registry.wormDetails(worm({ leadAngle: 5, frictionCoefficient: 0.02 })).selfLocking, false);
});

test('the inspector attaches the family block, and drops the generic one', () => {
  const Inspector = require('../js/visualization/StageInspector.js');
  const Scene = require('../js/visualization/core/SceneBuilder.js');
  const solution = { stages: [{ type: 'worm', wormStarts: 2, wheelTeeth: 40,
    parameters: { module: 2, leadAngle: 18 } }], mechanical: [{ ratio: 20 }], inputSpeedRpm: 1500 };
  const data = Inspector.model(solution, 0, Registry, Scene.build(solution));
  assert.ok(data.worm, 'les détails de la vis doivent être joints');
  assert.equal(data.worm.starts, 2);
  assert.equal(data.worm.wheelTeeth, 40);
  // Un étage ordinaire n'a ni bloc vis ni bloc planétaire.
  const spur = { stages: [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 1 } }],
    mechanical: [{ ratio: 3 }], inputSpeedRpm: 1500 };
  const plain = Inspector.model(spur, 0, Registry, Scene.build(spur));
  assert.equal(plain.worm, null);
  assert.equal(plain.topology, null);
  assert.deepEqual(plain.teeth, [20, 60], 'lui garde sa ligne « Dents »');
});

// ===== §24, §25 : d'où vient chaque valeur, et comment reprendre la main =====

test('a completed chain remembers what the user pinned', () => {
  const model = chain([
    { family: 'spur', values: { 'input.teeth': 20 } },
    { family: 'planetary' }
  ]);
  const origin = model.toOrigin();
  // « 20 → 60 » ne dit pas que le 20 venait d'une roue déjà taillée et que le
  // 60 est une proposition. C'est exactement ce qu'on veut savoir avant de
  // fabriquer quoi que ce soit.
  assert.deepEqual(origin[0], { family: true, fields: { 'input.teeth': true } });
  assert.deepEqual(origin[1], { family: true, fields: {} });
  // C'est un INSTANTANÉ, pas un renvoi vers le modèle vivant : celui-ci peut
  // être édité ensuite, la solution affichée doit garder son origine.
  model.stage(0).set('output.teeth', 60);
  assert.deepEqual(origin[0].fields, { 'input.teeth': true });
});

test('the inspector marks pinned values apart from found ones', () => {
  const Inspector = require('../js/visualization/StageInspector.js');
  const Scene = require('../js/visualization/core/SceneBuilder.js');
  const solution = {
    stages: [{ type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 1 } }],
    mechanical: [{ ratio: 3 }], inputSpeedRpm: 1500,
    origin: [{ family: true, fields: { 'input.teeth': true } }]
  };
  const data = Inspector.model(solution, 0, Registry, Scene.build(solution));
  assert.deepEqual(data.origin.fields, { 'input.teeth': true });
  // Sans origine connue, rien n'est marqué : on ne prétend pas savoir.
  const blind = Object.assign({}, solution, { origin: null });
  assert.equal(Inspector.model(blind, 0, Registry, Scene.build(blind)).origin, null);
});

test('a found solution becomes editable, every stage imposed', () => {
  const stages = [
    { type: 'spur', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { module: 1.5 } },
    { type: 'planetary', sunTeeth: 20, ringTeeth: 70, planetTeeth: 25, planetCount: 3,
      inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 1.5 } }
  ];
  const model = Build.fromStages(stages);
  // Tous imposés : c'est la solution TELLE QU'ELLE EST qu'on reprend. Tout
  // ouvrir d'emblée perdrait précisément ce qu'on venait de reprendre.
  assert.deepEqual(model.levels(), ['fixed', 'fixed']);
  assert.equal(model.isComplete(), true);
  assert.equal(model.module, 1.5);
  assert.equal(Math.round(model.ratio() * 100) / 100, 13.5);
  // La topologie planétaire survit au passage : sinon le rapport changerait.
  assert.equal(model.stage(1).values.fixed, 'R');
  assert.equal(model.stage(1).values.planetCount, 3);
  // Et libérer une valeur rend la main au solveur.
  model.stage(0).set('output.teeth', null);
  assert.equal(model.unknownCount(), 1);
  // Aller-retour : la chaîne reconstruite redonne les mêmes étages.
  const round = Build.fromStages(Build.fromStages(stages).toStages());
  assert.deepEqual(round.levels(), ['fixed', 'fixed']);
  assert.equal(round.ratio(), model.ratio() === null ? round.ratio() : 13.5);
});

test('an unreachable chain blames the range, not the decisions', () => {
  const NearMiss = require('../js/requirements/NearMissAnalyzer.js');
  // Conseiller « élargissez les technologies ou le nombre d'étages » à qui vient
  // d'écrire sa chaîne revient à lui conseiller de l'annuler : ce sont des
  // décisions, pas des réglages oubliés.
  const search = NearMiss.analyze([], null, null);
  assert.match(search.text, /technologies/);
  const built = NearMiss.analyze([], null,
    { chain: true, unknownStages: 1, teethRange: { min: 10, max: 50 } });
  assert.match(built.text, /plage de dentures/);
  assert.match(built.text, /10 à 50 dents/);
  assert.match(built.text, /libérez une des valeurs/);
  assert.doesNotMatch(built.text, /nombre d’étages/);
  // Sans plage connue, on n'invente pas de bornes.
  assert.doesNotMatch(NearMiss.analyze([], null, { chain: true }).text, /\d+ à \d+/);
});
