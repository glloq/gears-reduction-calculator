const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../js/visualization/core/FidelityContract.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

const FAMILIES = ['spur', 'helical', 'internal', 'bevel', 'worm', 'planetary', 'belt', 'chain', 'rack'];

test('every family declares what it shows, in every view', () => {
  // Le trou que ce contrat bouche : une famille dont personne n'a jamais dit ce
  // que son dessin valait. Elle héritait d'un « partial » de registre que rien
  // ne lisait, et le dessin affirmait ce qu'il voulait.
  FAMILIES.forEach(family => {
    Contract.VIEWS.forEach(view => {
      if (view === 'kinematic') {
        assert.equal(Contract.of(family, view), 'schematic', family + ' en cinématique');
        return;
      }
      Contract.PRESENTATIONS.forEach(presentation => {
        const level = Contract.of(family, view, presentation);
        assert.ok(Contract.LEVELS.includes(level),
          family + ' · ' + view + ' · ' + presentation + ' : « ' + level + ' »');
      });
    });
  });
});

test('the registry of families and the contract cover exactly the same list', () => {
  // Une famille ajoutée au moteur sans être déclarée au contrat se dessinerait
  // sans que personne ne sache ce que son dessin vaut.
  assert.deepEqual(Contract.families().slice().sort(), FAMILIES.slice().sort());
  FAMILIES.forEach(id => assert.ok(Registry.get(id), 'famille ' + id + ' absente du registre'));
});

test('a family nobody declared gets no level at all, rather than a flattering one', () => {
  // Inventer « exact » pour ce qui n'a jamais été déclaré est précisément la
  // faute que ce module existe pour empêcher.
  assert.equal(Contract.of('cycloidal', 'teeth', 'face'), null);
  assert.equal(Contract.of('spur', 'exploded', 'face'), null);
  assert.equal(Contract.noteOf('cycloidal'), null);
});

test('the least faithful part of a drawing is what the drawing may claim', () => {
  // Un train droit + conique ne peut pas se dire « à l'échelle » sous prétexte
  // que ses roues droites le sont : c'est le cône de biais qui borne la lecture.
  const mixed = Contract.ofDrawing('teeth', [
    { family: 'spur', presentation: 'oblique' },
    { family: 'bevel', presentation: 'oblique' }
  ]);
  assert.equal(mixed, 'derived');
  assert.equal(Contract.ofDrawing('teeth', [{ family: 'spur', presentation: 'oblique' }]), 'exact');
  // Et une chaîne tire tout le dessin vers le conventionnel, ce qui est la
  // vérité : on ne mesure pas un maillon dessus.
  assert.equal(Contract.ofDrawing('teeth', [
    { family: 'spur', presentation: 'face' }, { family: 'chain', presentation: 'face' }]), 'conventional');
  assert.equal(Contract.worst(['exact', 'schematic', 'derived']), 'schematic');
  assert.equal(Contract.worst([]), null);
});

test('the three known approximations are declared, not hidden', () => {
  // Ce sont les trois seuls endroits où le dessin s'écarte de la surface. Les
  // taire les rendrait indiscernables d'un tracé exact.
  //
  // Un cône vu de biais : son contour apparent est approché.
  assert.equal(Contract.of('bevel', 'teeth', 'face'), 'exact');
  assert.equal(Contract.of('bevel', 'teeth', 'oblique'), 'derived');
  assert.equal(Contract.of('bevel', 'geometry', 'oblique'), 'derived');
  // Une roue hélicoïdale, elle, ne fait PLUS partie de la liste : sa pente de
  // flancs est tracée dans les trois présentations depuis qu'elle y a été
  // ajoutée, et la déclarer approchée serait devenu faux dans l'autre sens.
  Contract.PRESENTATIONS.forEach(p => {
    assert.equal(Contract.of('helical', 'teeth', p), 'exact', 'hélicoïdal ' + p);
  });
  // Une crémaillère vue de biais : sa hauteur de dent reste en vraie grandeur.
  assert.equal(Contract.of('rack', 'teeth', 'face'), 'exact');
  assert.equal(Contract.of('rack', 'teeth', 'oblique'), 'derived');
  // Les maillons d'une chaîne : conventionnels dans toutes les présentations.
  Contract.PRESENTATIONS.forEach(p => {
    assert.equal(Contract.of('chain', 'teeth', p), 'conventional', 'chaîne ' + p);
  });
  // Et chacune s'explique.
  ['bevel', 'rack', 'chain'].forEach(family => {
    assert.ok((Contract.noteOf(family) || '').length > 20, 'famille ' + family + ' sans explication');
  });
});

test('the chain is drawn, and the contract says so instead of denying it', () => {
  // Le registre déclarait `geometricView: unsupported` pour la chaîne pendant
  // que le renderer la dessinait dans les trois vues. Le contrat et le rendu
  // divergeaient : c'est ce désaccord qu'on supprime.
  Contract.VIEWS.forEach(view => {
    const level = view === 'kinematic' ? Contract.of('chain', view)
      : Contract.of('chain', view, 'oblique');
    assert.notEqual(level, 'unsupported', 'chaîne · ' + view);
  });
  // Et le registre mécanique ne prétend plus rien sur le dessin.
  assert.equal(Registry.get('chain').capabilities.geometricView, undefined);
});

test('each level says, in words, what may be read on the drawing', () => {
  Contract.LEVELS.forEach(level => {
    assert.ok(Contract.describe(level).length > 20, 'niveau ' + level + ' sans phrase');
    assert.ok(Contract.label(level).length > 2, 'niveau ' + level + ' sans libellé');
  });
  // L'ORDRE est le contrat : il décide lequel de deux niveaux borne la lecture.
  assert.ok(Contract.rank('exact') < Contract.rank('derived'));
  assert.ok(Contract.rank('derived') < Contract.rank('conventional'));
  assert.ok(Contract.rank('conventional') < Contract.rank('schematic'));
  assert.ok(Contract.rank('schematic') < Contract.rank('unsupported'));
});
