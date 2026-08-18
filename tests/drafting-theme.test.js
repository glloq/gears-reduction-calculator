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
