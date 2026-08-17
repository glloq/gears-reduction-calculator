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

test('invalid states are ignored rather than producing a NaN viewBox', () => {
  const svg = fakeSvg();
  const viewport = new ViewportController(svg);
  viewport.setState({ viewBox: [0, 0, NaN, 10] });
  assert.deepEqual(box(svg), [0, 0, 200, 100]);
  viewport.focus(null);
  viewport.zoomAt(10, 10, 0);
  assert.deepEqual(box(svg), [0, 0, 200, 100]);
});
