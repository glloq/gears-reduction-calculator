const test = require('node:test');
const assert = require('node:assert/strict');
const ViewportController = require('../js/visualization/core/ViewportController.js');

// Double de <svg> : le contrôleur n'a besoin que du viewBox et de la taille
// affichée, ce qui le rend testable sans navigateur.
function fakeSvg(viewBox = '0 0 200 100', width = 800, height = 400) {
  const attributes = { viewBox };
  return {
    dataset: {},
    attributes,
    getAttribute: name => attributes[name],
    setAttribute: (name, value) => { attributes[name] = value; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height })
  };
}
function box(svg) { return svg.getAttribute('viewBox').split(' ').map(Number); }

test('the viewport reads, applies and restores its viewBox', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg);
  assert.deepEqual(viewport.getState().viewBox, [0, 0, 200, 100]);
  viewport.pan(10, -5);
  assert.deepEqual(box(svg), [10, -5, 200, 100]);
  viewport.reset();
  assert.deepEqual(box(svg), [0, 0, 200, 100]);
});

test('zoom is anchored on the pointed world coordinate', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg);
  // Le point (50, 25) doit rester au même endroit de l'écran après zoom.
  const before = (50 - 0) / 200;
  viewport.zoomAt(50, 25, 2);
  const [x, y, w, h] = box(svg);
  assert.equal(w, 100);
  assert.equal(h, 50);
  assert.ok(Math.abs((50 - x) / w - before) < 1e-9, 'ancrage conservé');
  assert.ok(Math.abs((25 - y) / h - 0.25) < 1e-9);
});

test('zoom is bounded relative to the fitted view', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg, { minScale: 0.5, maxScale: 4 });
  for (let i = 0; i < 20; i++) viewport.zoomAt(100, 50, 2);
  assert.equal(box(svg)[2], 50, 'jamais plus près que maxScale');
  for (let i = 0; i < 20; i++) viewport.zoomAt(100, 50, 0.5);
  assert.equal(box(svg)[2], 400, 'jamais plus loin que minScale');
});

test('focus and fit frame given bounds with padding', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg);
  viewport.focus({ x: 10, y: 10, width: 40, height: 20 }, 5);
  assert.deepEqual(box(svg), [5, 5, 50, 30]);
  // fit() redéfinit aussi la vue de référence : reset y revient.
  viewport.fit({ x: 0, y: 0, width: 100, height: 50 }, 0);
  viewport.pan(30, 30);
  viewport.reset();
  assert.deepEqual(box(svg), [0, 0, 100, 50]);
});

test('screen conversions drive both panning and the level of detail', () => {
  const svg = fakeSvg('0 0 200 100', 800, 400);
  const viewport = new ViewportController(svg);
  assert.deepEqual(viewport.toWorld(400, 200), { x: 100, y: 50 });
  assert.equal(viewport.pixelsPerUnit(), 4);         // 800 px pour 200 unités
  viewport.zoomAt(100, 50, 2);
  assert.equal(viewport.pixelsPerUnit(), 8);
  // Un dessin de 200 mm affiché sur 800 px : un pixel vaut 0,25 mm.
  assert.equal(ViewportController.screenUnit(svg, 200), 0.25);
});

test('the reading tier follows the zoom relative to the fitted view', () => {
  const viewport = new ViewportController(fakeSvg());
  assert.equal(viewport.zoomTier().name, 'overview');
  viewport.zoomAt(100, 50, 2);       // ×2
  assert.equal(viewport.zoomTier().name, 'medium');
  viewport.zoomAt(100, 50, 3);       // ×6
  assert.equal(viewport.zoomTier().name, 'close');
  viewport.zoomAt(100, 50, 3);       // ×18
  assert.equal(viewport.zoomTier().name, 'technical');
  viewport.reset();
  assert.equal(viewport.zoomTier().name, 'overview', 'revenir à l’ensemble revient au premier palier');
});

test('the tier is unit-agnostic: the same zoom gives the same tier in the three views', () => {
  // La cinématique est symbolique, la géométrie en millimètres. Un seuil en
  // pixels par unité les séparerait ; le zoom relatif les réunit.
  const symbolic = new ViewportController(fakeSvg('0 0 200 100'));
  const millimetres = new ViewportController(fakeSvg('0 0 640 320'));
  symbolic.zoomAt(100, 50, 6);
  millimetres.zoomAt(320, 160, 6);
  assert.equal(symbolic.zoomTier().id, millimetres.zoomTier().id);
  assert.equal(symbolic.zoomTier().name, 'close');
});

test('the tiers are ordered and cover every scale', () => {
  const tiers = ViewportController.ZOOM_TIERS;
  assert.equal(tiers[0].from, 0, 'un palier doit répondre même à l’échelle nulle');
  tiers.forEach((tier, index) => {
    assert.equal(tier.id, index, 'l’identifiant sert de classe CSS : il doit rester stable');
    if (index) assert.ok(tier.from > tiers[index - 1].from, 'seuils strictement croissants');
  });
});

test('focusElement frames a measurable element and refuses the others (§7)', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg);
  const element = { getBBox: () => ({ x: 20, y: 10, width: 40, height: 20 }) };
  assert.equal(viewport.focusElement(element, 0), true);
  assert.deepEqual(box(svg), [20, 10, 40, 20]);
  // Un élément détaché, vide ou absent laisse le cadrage tel quel : cadrer
  // « rien » donnerait un viewBox dégénéré, et l'interaction doit survivre.
  viewport.reset();
  assert.equal(viewport.focusElement(null), false);
  assert.equal(viewport.focusElement({ getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) }), false);
  assert.equal(viewport.focusElement({ getBBox: () => { throw new Error('not rendered'); } }), false);
  assert.deepEqual(box(svg), [0, 0, 200, 100]);
});

test('actual size makes one drawn millimetre a millimetre of screen (§7)', () => {
  // 800 px de large : à 96 dpi cela fait 800 / 3,7795 ≈ 211,7 mm de dessin.
  const svg = fakeSvg('0 0 200 100', 800, 400);
  const viewport = new ViewportController(svg, { minScale: 0.1, maxScale: 40 });
  assert.equal(viewport.actualSize(), true);
  const [x, y, width, height] = box(svg);
  assert.ok(Math.abs(width - 800 / (96 / 25.4)) < 0.01, 'largeur en millimètres réels');
  assert.ok(Math.abs(height / width - 100 / 200) < 1e-4, 'proportions conservées');
  // Le centre ne bouge pas : passer à l'échelle réelle sert à juger une taille.
  assert.ok(Math.abs((x + width / 2) - 100) < 0.01);
  assert.ok(Math.abs((y + height / 2) - 50) < 0.01);
  // Sans surface mesurable, rien ne peut être affirmé sur l'échelle.
  assert.equal(new ViewportController(fakeSvg('0 0 200 100', 0, 0)).actualSize(), false);
});

test('actual size stays inside the zoom bounds (§7)', () => {
  // Un réducteur de 4 m vu sur 800 px demanderait un zoom ×19 pour être à
  // l'échelle réelle. Les bornes valent aussi pour ce bouton, sinon il ferait
  // perdre le dessin — le cadrage s'arrête à maxScale.
  const wide = fakeSvg('0 0 4000 2000', 800, 400);
  new ViewportController(wide, { minScale: 0.5, maxScale: 4 }).actualSize();
  assert.equal(box(wide)[2], 1000, 'jamais plus près que maxScale');
  // Et un réducteur minuscule demanderait l'inverse : un dézoom, borné lui aussi.
  const tiny = fakeSvg('0 0 10 5', 800, 400);
  new ViewportController(tiny, { minScale: 0.5, maxScale: 4 }).actualSize();
  assert.equal(box(tiny)[2], 20, 'jamais plus loin que minScale');
});

test('invalid states are ignored rather than producing a NaN viewBox', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg);
  viewport.setState({ viewBox: [0, 0, NaN, 10] });
  assert.deepEqual(box(svg), [0, 0, 200, 100]);
  viewport.focus(null);
  viewport.zoomAt(10, 10, 0);
  assert.deepEqual(box(svg), [0, 0, 200, 100]);
});
