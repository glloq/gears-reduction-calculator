const test = require('node:test');
const assert = require('node:assert/strict');
const Share = require('../js/ui/ShareLink.js');

// Une session neuve, réduite à ce qui compte ici : des valeurs d'usine que les
// deux bouts du lien possèdent déjà, et qu'il est donc inutile de transporter.
const DEFAULTS = {
  workspace: { mode: 'design' },
  requirement: { architecture: { axisAngle: 0, coaxial: 'any', maxStages: null }, fabrication: { process: 'standard' } },
  technical: { typeParameters: { spur: { pressureAngle: 20, faceWidth: 10 }, worm: { leadAngle: 20 } } },
  revealed: []
};
const STAGES = [
  { type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, faceWidth: 20 } },
  { type: 'worm', wormStarts: 2, wheelTeeth: 40, parameters: { module: 2, leadAngle: 20 } }
];
const solution = extra => Object.assign({ stages: STAGES, target: 27,
  inputSpeedRpm: 1500, inputTorqueNm: 10 }, extra || {});

test('a link carries the solution itself, not a search to re-run', () => {
  // C'est tout l'objet du partage : « regarde cette solution » ne s'envoyait
  // pas. Le lien rouvrait une RECHERCHE, à charge pour le destinataire de la
  // relancer et de retrouver lui-même, dans quatre-vingts lignes, celle dont
  // on lui parlait — en supposant que le moteur n'ait pas changé d'avis.
  const link = Share.encode({ solution: solution(), session: DEFAULTS, view: {} }, DEFAULTS);
  const back = Share.decode(link, DEFAULTS);
  assert.deepEqual(back.solution.stages, STAGES);
  assert.equal(back.solution.target, 27);
  assert.equal(back.solution.inputSpeedRpm, 1500);
  assert.equal(back.solution.inputTorqueNm, 10);
});

test('a link says where it will open, in plain sight', () => {
  // Le point de vue reste LISIBLE dans l'adresse : on voit ce qu'un lien va
  // ouvrir avant de le suivre, et on peut le corriger à la main.
  const link = Share.encode({ view: { view: 'geometry', projection: 'iso-90', explode: true, stage: 2 } });
  assert.ok(link.indexOf('vue=geometry') >= 0, link);
  assert.ok(link.indexOf('oeil=iso-90') >= 0, link);
  assert.ok(link.indexOf('eclate=1') >= 0, link);
  // L'étage se compte à partir de 1 dans l'adresse : « le troisième étage »
  // n'est pas « etage=2 » pour qui la relit.
  assert.ok(link.indexOf('etage=3') >= 0, link);
  assert.deepEqual(Share.decode(link).view,
    { view: 'geometry', projection: 'iso-90', explode: true, stage: 2 });
});

test('the point of view comes back exactly, or not at all', () => {
  // Un lien qui rouvrirait le bon mécanisme sous un autre angle ne montrerait
  // pas ce qu'on montrait.
  const bare = Share.decode(Share.encode({ view: {} }));
  assert.deepEqual(bare.view, { view: null, projection: null, explode: false, stage: null });
  // Aucun étage désigné n'est pas l'étage zéro.
  assert.equal(Share.decode(Share.encode({ view: { stage: null } })).view.stage, null);
  assert.equal(Share.decode(Share.encode({ view: { stage: 0 } })).view.stage, 0);
});

test('a link carries what was decided, not the factory settings', () => {
  // Une session complète pèse près de deux mille caractères, dont les neuf
  // dixièmes sont des valeurs que le destinataire possède déjà.
  const session = JSON.parse(JSON.stringify(DEFAULTS));
  session.requirement.architecture.maxStages = 2;
  const link = Share.encode({ session: session, solution: solution(), view: {} }, DEFAULTS);
  const plain = Share.encode({ session: session, solution: solution(), view: {} });
  assert.ok(link.length < plain.length - 100, `${link.length} vs ${plain.length}`);
  // Et ce qui a été décidé revient, posé sur les valeurs d'usine.
  const back = Share.decode(link, DEFAULTS);
  assert.equal(back.session.requirement.architecture.maxStages, 2);
  assert.equal(back.session.technical.typeParameters.spur.pressureAngle, 20);
  assert.deepEqual(back.session, session);
});

test('a stage travels by what defines it, never by what a stage computes', () => {
  // La géométrie d'un étage se déduit de ses dentures : la transporter
  // tripleraît l'adresse, et pire, un lien ancien rouvrirait une géométrie
  // périmée à côté d'un moteur à jour.
  const fat = [Object.assign({}, STAGES[0], { geometry: { pitchDiameter: 30, centerDistance: 60 },
    mechanical: { torque: 4 }, efficiency: 0.97 })];
  assert.deepEqual(Share.bareStages(fat), [STAGES[0]]);
  const back = Share.decode(Share.encode({ solution: solution({ stages: fat }), view: {} }));
  assert.equal(back.solution.stages[0].geometry, undefined);
  assert.deepEqual(back.solution.stages[0].input, { teeth: 15 });
  // L'entrée n'est pas touchée : on partage une solution, on ne l'ampute pas.
  assert.ok(fat[0].geometry);
});

test('an address that shares nothing is refused rather than guessed', () => {
  assert.equal(Share.decode(''), null);
  assert.equal(Share.decode('?r=27&p=1'), null);
  assert.equal(Share.carries('?r=27'), false);
  assert.equal(Share.carries('?v=1&vue=teeth'), true);
  assert.equal(Share.carries(''), false);
  assert.equal(Share.carries(null), false);
  // Une version qu'on ne sait pas relire n'est pas devinée : ses implicites ne
  // sont peut-être plus les nôtres, et on rouvrirait autre chose.
  assert.equal(Share.decode('v=999&vue=teeth'), null);
  assert.equal(Share.decode('v=' + Share.VERSION).version, Share.VERSION);
});

test('a truncated payload does not take the rest of the link down with it', () => {
  // Une adresse se recopie à la main, se coupe en fin de ligne, se fait manger
  // un caractère par un client de messagerie.
  const link = Share.encode({ solution: solution(), session: DEFAULTS,
    view: { view: 'teeth', projection: 'front' } }, DEFAULTS);
  const broken = link.replace(/sol=[^&]+/, 'sol=xxxxNOTBASE64xxx');
  const back = Share.decode(broken, DEFAULTS);
  assert.notEqual(back, null);
  assert.equal(back.solution, null);
  assert.equal(back.view.view, 'teeth');
  assert.equal(back.view.projection, 'front');
});

test('a missing brief is not an empty brief', () => {
  // Sans cahier des charges, le lien ne dit RIEN du besoin : l'application
  // garde le sien, au lieu de le remplacer par du vide.
  const back = Share.decode(Share.encode({ solution: solution(), view: {} }, DEFAULTS), DEFAULTS);
  assert.equal(back.session, null);
  // Un cahier des charges identique aux valeurs d'usine n'a rien à dire non
  // plus : il ne pèse pas dans l'adresse.
  const same = Share.encode({ session: DEFAULTS, view: {} }, DEFAULTS);
  assert.equal(same.indexOf('cdc='), -1, same);
  // Mais le relire donne bien une session, celle d'usine.
  assert.deepEqual(Share.decode(Share.encode({ session: { revealed: ['x'] } }, DEFAULTS), DEFAULTS).revealed,
    Share.decode(Share.encode({ session: { revealed: ['x'] } }, DEFAULTS), DEFAULTS).revealed);
});

test('what differs is carried, what matches is left behind', () => {
  assert.equal(Share.prune({ a: 1 }, { a: 1 }), undefined);
  assert.deepEqual(Share.prune({ a: 1, b: 2 }, { a: 1, b: 3 }), { b: 2 });
  assert.deepEqual(Share.prune({ a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 9, d: 2 } } }), { a: { b: { c: 1 } } });
  // Une liste voyage d'un bloc : un diff par indice deviendrait faux au premier
  // élément inséré.
  assert.deepEqual(Share.prune({ a: [1, 2, 3] }, { a: [1, 9, 3] }), { a: [1, 2, 3] });
  // Effacer une valeur est une décision, et elle se transporte.
  assert.deepEqual(Share.prune({ a: null }, { a: 20 }), { a: null });
  // Greffer est l'exact inverse, et ne touche pas la référence.
  const reference = { a: 1, b: { c: 2, d: 3 } };
  assert.deepEqual(Share.graft({ b: { c: 9 } }, reference), { a: 1, b: { c: 9, d: 3 } });
  assert.deepEqual(reference, { a: 1, b: { c: 2, d: 3 } });
  assert.deepEqual(Share.graft(undefined, reference), reference);
});

test('accents survive the trip', () => {
  const named = [{ type: 'spur', label: 'étage arrière — réducteur 3:1', parameters: {} }];
  const back = Share.decode(Share.encode({ solution: solution({ stages: named }), view: {} }));
  assert.equal(back.solution.stages[0].label, 'étage arrière — réducteur 3:1');
  // Dans le navigateur, l'encodage passe par `btoa`, qui ne connaît QUE le
  // latin-1 : un « é » lui parvenant tel quel serait perdu, ou lèverait. Le
  // texte doit donc lui arriver en octets — un caractère par octet, valeurs 0
  // à 255 — et c'est cette conversion qu'on vérifie, le chemin Node ne
  // l'empruntant pas.
  const bytes = Share.utf8Bytes('étage arrière');
  bytes.split('').forEach(character => assert.ok(character.charCodeAt(0) < 256,
    'octet hors latin-1 : ' + character.charCodeAt(0)));
  // « é » est bien deux octets UTF-8, et non un caractère de plus de 255.
  assert.equal(Share.utf8Bytes('é').length, 2);
  assert.equal(Share.fromUtf8Bytes(bytes), 'étage arrière');
});

test('a real link stays short enough to be sent', () => {
  // Deux mille caractères est la limite au-delà de laquelle une adresse cesse
  // d'être transportable partout.
  const session = JSON.parse(JSON.stringify(DEFAULTS));
  session.requirement.architecture.maxStages = 3;
  const link = Share.encode({ session: session, solution: solution(),
    view: { view: 'teeth', projection: 'iso', explode: true, stage: 1 } }, DEFAULTS);
  assert.ok(link.length < 900, 'lien de ' + link.length + ' caractères');
});
