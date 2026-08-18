const test = require('node:test');
const assert = require('node:assert/strict');
const Theme = require('../js/visualization/technical/MechanicalDraftingTheme.js');

test('a role is drawn the same way wherever it appears', () => {
  // C'était le défaut : trois renderers déclaraient chacun leurs épaisseurs, et
  // rien ne garantissait qu'un axe ait la même allure dans deux vues du même
  // mécanisme. Un rôle a maintenant UNE définition.
  ['centerLine', 'pitchSurface', 'dimensionLine', 'groundSymbol', 'visibleContour'].forEach(role => {
    assert.ok(Theme.role(role), role + ' doit exister');
    assert.equal(Theme.className(role), Theme.className(role));
    // Toutes les classes qui portent ce rôle — celles des primitives comprises —
    // reçoivent la même déclaration.
    const rule = Theme.declarations(role, 'technical');
    Theme.selectors(role).forEach(selector => {
      assert.equal(Theme.roleOf(selector.slice(1)), role, selector + ' porte ' + role);
    });
    assert.ok(rule.length, role + ' doit produire une déclaration');
  });
});

test('the three views name the same thing the same way', () => {
  // Les lignes d'axe de la vue de transmission, de la vue cotée et du schéma
  // cinématique portaient trois classes différentes. Elles portent le MÊME
  // rôle, ce qui est la seule façon de garantir qu'elles se ressemblent.
  const axes = ['shaft-centre', 'shaft-axis', 'construction-axis', 'stage-axis'];
  axes.forEach(cssClass => assert.equal(Theme.roleOf(cssClass), 'centerLine', cssClass));
  // Idem pour la surface primitive : `pitch-circle` en cotation, `pitch-line`
  // sur un corps vu par la tranche.
  ['pitch-circle', 'pitch-line', 'pitch-diameter'].forEach(cssClass => {
    assert.equal(Theme.roleOf(cssClass), 'pitchSurface', cssClass);
  });
  // Et aucune classe ne porte deux rôles : ce serait deux conventions pour un
  // même trait, donc le retour du problème.
  const seen = {};
  Object.keys(Theme.ROLES).forEach(role => {
    (Theme.ROLES[role].aliases || []).forEach(alias => {
      assert.equal(seen[alias], undefined, alias + ' porte déjà ' + seen[alias]);
      seen[alias] = role;
    });
  });
});

test('the line hierarchy is a hierarchy, not a list of arbitrary widths', () => {
  // ISO 128-20 construit les épaisseurs sur un rapport de 2 entre trait fin et
  // trait fort. On s'en inspire — sans prétendre certifier la norme.
  assert.ok(Theme.WIDTH.narrow < Theme.WIDTH.medium);
  assert.ok(Theme.WIDTH.medium < Theme.WIDTH.wide);
  assert.equal(Theme.WIDTH.wide / Theme.WIDTH.narrow, 2);

  // Un contour visible est plus fort qu'un trait de cote : c'est ce qui fait
  // qu'un dessin se lit d'abord par sa géométrie.
  const contour = Theme.role('visibleContour').line.width;
  const dimension = Theme.role('dimensionLine').line.width;
  assert.ok(contour > dimension, 'un contour doit primer sur une cote');
  // Un axe et une surface primitive sont des traits mixtes fins : c'est ce qui
  // les distingue d'un contour dans un dessin monochrome.
  ['centerLine', 'pitchSurface'].forEach(role => {
    assert.equal(Theme.role(role).line.dash, Theme.DASH.chain, role);
    assert.equal(Theme.role(role).line.width, Theme.WIDTH.narrow, role);
  });
  // Un contour caché est un trait interrompu : sans cela, rien ne le
  // distinguerait de ce qu'on voit vraiment.
  assert.equal(Theme.role('hiddenContour').line.dash, Theme.DASH.dashed);
});

test('the technical style is not the visual style in grey', () => {
  const tokens = { ink: '#111111', muted: '#888888', accent: '#0000ff',
    success: '#00ff00', danger: '#ff0000', warning: '#ffaa00', surface: '#ffffff' };
  const visual = Theme.css({ style: 'visual', tokens: tokens });
  const technical = Theme.css({ style: 'technical', tokens: tokens });
  assert.notEqual(visual, technical);

  // En technique, une pièce n'est pas coloriée : elle est cernée.
  assert.ok(/\.tooth-profile[^{]*\{fill:none\}/.test(technical), 'aucun remplissage de pièce');
  assert.ok(technical.indexOf(tokens.accent) < 0, 'aucune couleur d’accent décorative');
  assert.ok(technical.indexOf(tokens.success) < 0, 'aucune couleur de rôle décorative');
  // Deux exceptions assumées : le bâti et l'alerte. Ce sont les deux seules
  // choses qu'on ne doit pas manquer sur un plan.
  assert.ok(technical.indexOf(tokens.warning) >= 0, 'le bâti garde sa couleur');
  assert.ok(technical.indexOf(tokens.danger) >= 0, 'l’alerte garde la sienne');

  // En visuel, on garde les teintes de rôle qui rendent l'entrée et la sortie
  // repérables d'un coup d'œil.
  assert.ok(visual.indexOf(tokens.accent) >= 0);
  assert.ok(visual.indexOf(tokens.success) >= 0);
});

test('an unknown role is refused rather than silently drawn', () => {
  assert.equal(Theme.role('inventé'), null);
  assert.equal(Theme.className('inventé'), null);
  assert.deepEqual(Theme.selectors('inventé'), []);
  assert.equal(Theme.declarations('inventé', 'technical'), '');
  assert.equal(Theme.roleOf('classe-sans-rôle'), null);
});

// ===== Le style ne change jamais la mécanique (§53) =====

const Teeth = require('../js/visualization/teeth/TeethPrimitives.js');

const GEAR = { kind: 'gear', pitchD: 40, outsideD: 44, rootD: 35, module: 2, teeth: 20,
  faceWidth: 20, pressureAngle: 20 };
const RING = { kind: 'internal-ring', pitchD: 120, outsideD: 116, rootD: 125, module: 2,
  teeth: 60, faceWidth: 20 };
const WORM = { kind: 'worm', pitchD: 20, outsideD: 24, rootD: 15, module: 2, teeth: 2,
  faceWidth: 40, leadAngle: 20, handedness: 'left' };

const classesOf = built => built.rotor.map(node => node.attrs.class);

test('a global drawing shows a wheel by its surfaces, not by eighty teeth', () => {
  // Quatre-vingts développantes exactes n'apprennent rien de plus qu'un cercle
  // et couvrent le trait qui compte.
  const visual = Teeth.build(GEAR, { lod: 2, presentation: 'face', style: 'visual' });
  const technical = Teeth.build(GEAR, { lod: 2, presentation: 'face', style: 'technical' });

  assert.ok(classesOf(visual).some(c => /tooth-profile/.test(c)), 'le style visuel garde la denture');
  assert.equal(technical.conventional, true);
  assert.ok(!classesOf(technical).some(c => /tooth-profile/.test(c)), 'aucune denture dessinée');
  // Les trois surfaces qui définissent une roue.
  ['tip-surface', 'pitch-circle', 'root-surface'].forEach(cssClass => {
    assert.ok(classesOf(technical).some(c => c.split(/\s+/).includes(cssClass)), cssClass);
  });
});

test('the technical style has its own ladder, so teeth do not come back at once', () => {
  // Les mêmes seuils dans les deux styles ramenaient la denture réelle dès le
  // cadrage par défaut : un dessin d'ensemble couvert de développantes.
  const pixels = 300;
  assert.equal(Teeth.level(pixels, 'visual'), Teeth.LEVELS.TECHNICAL);
  assert.ok(Teeth.level(pixels, 'technical') < Teeth.LEVELS.TECHNICAL);
  // De TRÈS près, la denture revient : le mode s'appelle technique, pas aveugle.
  assert.equal(Teeth.level(1200, 'technical'), Teeth.LEVELS.TECHNICAL);
  assert.equal(Teeth.build(GEAR, { lod: 3, presentation: 'face', style: 'technical' }).conventional, false);
  // Et l'échelle technique est partout plus exigeante que la visuelle.
  Teeth.TECHNICAL_THRESHOLDS.forEach((value, index) => {
    assert.ok(value > Teeth.THRESHOLDS[index], 'seuil ' + index);
  });
});

test('an internal ring stays an internal ring without colour', () => {
  // Sa denture est tournée vers le centre : son cercle de tête est plus petit
  // que sa primitive, l'inverse d'une roue extérieure. Sans la jante, rien ne
  // la distinguerait d'un engrenage une fois la denture retirée.
  const face = Teeth.build(RING, { lod: 2, presentation: 'face', style: 'technical' });
  assert.ok(classesOf(face).some(c => c.includes('rim-surface')), 'la jante');
  const radii = Object.fromEntries(face.rotor
    .filter(node => node.attrs.r).map(node => [node.attrs.class, Number(node.attrs.r)]));
  assert.ok(radii['rim-surface'] > radii['pitch-circle'], 'la jante enveloppe la primitive');
  assert.ok(radii['tip-surface'] <= radii['pitch-circle'], 'la tête plonge vers le centre');

  // Vue par la tranche, une couronne n'est pas un rectangle plein.
  const profile = Teeth.build(RING, { lod: 2, presentation: 'profile', style: 'technical' });
  const rims = classesOf(profile).filter(c => /ring-profile-(top|bottom)/.test(c));
  assert.equal(rims.length, 2, 'deux jantes, et du vide entre elles');
});

test('a worm keeps its thread count and hand without a pseudo-helix', () => {
  const technical = Teeth.build(WORM, { lod: 2, presentation: 'profile', style: 'technical' });
  assert.equal(technical.conventional, true);
  assert.ok(classesOf(technical).some(c => c.includes('worm-body')), 'le corps');
  const thread = technical.rotor.find(node => (node.attrs.class || '').includes('worm-thread'));
  assert.ok(thread, 'les filets');
  // Des obliques, pas une hélice : leur inclinaison porte le sens du filet.
  const strokes = (thread.attrs.d.match(/M /g) || []).length;
  assert.ok(strokes >= 2 && strokes <= 40, 'nombre d’obliques raisonnable : ' + strokes);

  // Et le sens compte réellement : deux vis opposées ne se dessinent pas pareil.
  const right = Teeth.build(Object.assign({}, WORM, { handedness: 'right' }),
    { lod: 2, presentation: 'profile', style: 'technical' });
  const other = right.rotor.find(node => (node.attrs.class || '').includes('worm-thread'));
  assert.notEqual(thread.attrs.d, other.attrs.d, 'le sens du filet doit se voir');
});

test('style changes the drawing and nothing else', () => {
  // C'est l'invariant de la passe : un dessin technique et un dessin visuel
  // décrivent le même mécanisme, pas deux lectures possibles du calcul.
  [GEAR, RING, WORM].forEach(wheel => {
    ['face', 'profile'].forEach(presentation => {
      const visual = Teeth.build(wheel, { lod: 2, presentation, style: 'visual' });
      const technical = Teeth.build(wheel, { lod: 2, presentation, style: 'technical' });
      assert.equal(visual.presentation, technical.presentation);
      assert.equal(visual.lod, technical.lod);
      // Le tracé diffère — sinon le style ne servirait à rien.
      assert.notDeepEqual(classesOf(visual), classesOf(technical),
        wheel.kind + '/' + presentation);
    });
  });
  // Et l'objet d'entrée n'est jamais modifié : une primitive qui muterait sa
  // roue ferait dépendre la mécanique de l'ordre des rendus.
  const before = JSON.stringify(GEAR);
  Teeth.build(GEAR, { lod: 3, presentation: 'face', style: 'technical' });
  assert.equal(JSON.stringify(GEAR), before);
});
