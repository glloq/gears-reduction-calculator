const test = require('node:test');
const assert = require('node:assert/strict');
const Thumb = require('../js/visualization/SolutionThumbnail.js');
const Engineering = require('../js/core/Engineering.js');
const Registry = require('../js/transmissions/TransmissionRegistry.js');

function analyzed(stages) {
  const copy = JSON.parse(JSON.stringify(stages));
  copy.forEach(stage => { if (stage.type === 'rack') stage.geometry = Registry.get('rack').calculateGeometry(stage); });
  return Engineering.analyzeSolution(copy, 3, { inputSpeedRpm: 1500, inputTorqueNm: 10 });
}

const SPUR = { type: 'spur', input: { teeth: 15 }, output: { teeth: 45 }, parameters: { module: 2, pressureAngle: 20, faceWidth: 20 } };
const BEVEL = { type: 'bevel', input: { teeth: 20 }, output: { teeth: 40 }, parameters: { module: 2, shaftAngle: 90, faceWidth: 15 } };
const BELT = { type: 'belt', input: { teeth: 20 }, output: { teeth: 60 }, parameters: { pitch: 5, centerDistance: 150, profile: 'HTD-5M' } };
const PLANETARY = { type: 'planetary', sunTeeth: 24, ringTeeth: 72, planetTeeth: 24, planetCount: 3,
  inputMember: 'S', outputMember: 'C', fixed: 'R', parameters: { module: 2, faceWidth: 20 } };
const RACK = { type: 'rack', pinionTeeth: 20, parameters: { module: 2, rpm: 1500, faceWidth: 20 } };

test('the thumbnail draws the pitch surfaces the engine computed, where it put them', () => {
  // Une vignette qui redessinerait à sa façon vaudrait moins que rien : elle
  // annoncerait un dessin qu'elle contredirait au clic suivant.
  const plan = Thumb.build(analyzed([SPUR]));
  const wheels = plan.shapes.filter(s => s.tag === 'ellipse');
  assert.equal(wheels.length, 2);
  // m = 2, Z = 15 et 45 : primitives de 30 et 90 mm, entraxe 60 mm.
  const radii = wheels.map(w => w.ry).sort((a, b) => a - b);
  assert.deepEqual(radii, [15, 45]);
  assert.equal(Math.hypot(wheels[1].cx - wheels[0].cx, wheels[1].cy - wheels[0].cy), 60);
  // Et le cadrage contient tout ce qui est dessiné, AVEC de l'air : une roue
  // dont le contour épouse exactement le bord se retrouve rognée d'un demi
  // trait à l'écran, l'épaisseur du trait n'étant pas dans le viewBox.
  const [x, y, w, h] = plan.viewBox;
  const margin = Math.max(w, h) * 0.02;
  wheels.forEach(wheel => {
    assert.ok(wheel.cx - wheel.rx > x + margin && wheel.cx + wheel.rx < x + w - margin, 'roue au ras du cadre en X');
    assert.ok(wheel.cy - wheel.ry > y + margin && wheel.cy + wheel.ry < y + h - margin, 'roue au ras du cadre en Y');
  });
});

test('two mechanisms that read alike in the table do not look alike (§12)', () => {
  // C'est toute la raison d'être de la vignette. Un train parallèle et un
  // planétaire coaxial se distinguent par la FORME, pas par les nombres.
  const parallel = Thumb.build(analyzed([SPUR]));
  const epicyclic = Thumb.build(analyzed([PLANETARY]));
  const centres = plan => plan.shapes.filter(s => s.tag === 'ellipse')
    .map(s => s.cx.toFixed(1) + ',' + s.cy.toFixed(1));
  assert.notDeepEqual(centres(parallel), centres(epicyclic));
  // Le planétaire montre cinq surfaces concentriques ou orbitales, pas deux.
  assert.equal(epicyclic.shapes.filter(s => s.tag === 'ellipse').length, 5);
});

test('a belt draws its real path, a rack its stroke, and neither becomes a wheel', () => {
  const belt = Thumb.build(analyzed([BELT]));
  const path = belt.shapes.filter(s => s.tag === 'path');
  assert.equal(path.length, 1, 'le brin de courroie manque');
  assert.match(path[0].d, /^M /);
  // La courroie est peinte AVANT ses poulies : sinon elle les barrerait.
  assert.equal(belt.shapes[0].tag, 'path');

  const rack = Thumb.build(analyzed([RACK]));
  const line = rack.shapes.filter(s => s.tag === 'line');
  assert.equal(line.length, 1, 'la crémaillère manque');
  // Sa longueur dessinée est sa course, pas un diamètre inventé.
  assert.ok(Math.hypot(line[0].x2 - line[0].x1, line[0].y2 - line[0].y1) > 50);
  assert.equal(rack.shapes.filter(s => s.tag === 'ellipse').length, 1, 'seul le pignon est une roue');
});

test('entry, exit and the held member are told apart', () => {
  const roles = Thumb.build(analyzed([PLANETARY])).shapes.map(s => s.role);
  assert.ok(roles.includes('input'), roles.join(' '));
  assert.ok(roles.includes('fixed'), 'le membre bloqué ne se distingue pas');
  // Un satellite n'est ni l'entrée ni la sortie : il ne doit pas en porter la couleur.
  assert.ok(roles.filter(r => r === 'intermediate').length >= 3);
});

test('a wheel seen edge-on stays an ellipse, and its axis keeps its screen angle', () => {
  // En isométrie, une roue est vue de biais : la reprendre en cercle ferait
  // mentir la vignette sur l'orientation de l'arbre.
  const plan = Thumb.build(analyzed([SPUR, BEVEL]), { view: 'iso' });
  const wheels = plan.shapes.filter(s => s.tag === 'ellipse');
  assert.ok(wheels.every(w => w.rx < w.ry), 'aucune roue n’est raccourcie en isométrie');
  assert.ok(wheels.some(w => Math.abs(w.rotate) > 1), 'aucun axe n’est incliné');
  // Le renvoi conique change de plan : les deux étages ne peuvent pas avoir
  // tous leurs axes à la même inclinaison.
  assert.ok(new Set(wheels.map(w => Math.round(w.rotate))).size > 1);
});

test('the markup is a self-contained svg, and an empty solution yields nothing', () => {
  const svg = Thumb.markup(analyzed([SPUR, BEVEL]));
  assert.match(svg, /^<svg class="solution-thumbnail" viewBox="[-0-9. ]+"/);
  assert.match(svg, /<\/svg>$/);
  assert.ok(!/undefined|NaN/.test(svg), svg.slice(0, 200));
  // Ce qui ne se dessine pas ne produit pas un cadre vide qu'on croirait cassé.
  assert.equal(Thumb.build(null), null);
  assert.equal(Thumb.build({ stages: [] }), null);
  assert.equal(Thumb.markup({ stages: [] }), '');
});
