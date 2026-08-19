const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../js/visualization/core/LabelLayout.js');

const label = (id, x, y, extra) => Object.assign(
  { id: id, anchor: { x: x, y: y }, width: 80, height: 12, priority: 4 }, extra || {});
const boxOf = seat => ({ x: seat.x - 40, y: seat.y - 6, width: 80, height: 12 });
const shown = placed => placed.filter(seat => !seat.dropped);

test('two labels on the same anchor do not land on each other', () => {
  // C'est le cas qui a motivé le moteur : depuis que les étages s'empilent sur
  // leurs axes réels, quatre planétaires coaxiaux partagent une abscisse. Les
  // couloirs les mettaient bout à bout, très loin de ce qu'ils désignent.
  const placed = Layout.place([label('a', 100, 100), label('b', 100, 100), label('c', 100, 100)],
    { obstacles: [{ x: 60, y: 60, width: 80, height: 80 }] });
  assert.equal(shown(placed).length, 3);
  const boxes = shown(placed).map(boxOf);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.equal(Layout.overlap(boxes[i], boxes[j]), 0,
        'étiquettes ' + i + ' et ' + j + ' superposées');
    }
  }
});

test('a label never lands on a part when a free place exists', () => {
  const part = { x: 0, y: 0, width: 200, height: 200 };
  const placed = Layout.place([label('a', 100, 100)], { obstacles: [part] });
  assert.equal(placed[0].dropped, false);
  assert.equal(Layout.overlap(boxOf(placed[0]), part), 0, 'étiquette posée sur la pièce');
  // Elle s'est éloignée juste ce qu'il faut : la première distance qui libère.
  assert.ok(placed[0].distance > Layout.RINGS[0]);
  // Et elle est reliée à ce qu'elle désigne, puisqu'elle s'en est écartée.
  assert.ok(placed[0].leader, 'aucune ligne de rappel malgré l’éloignement');
  assert.equal(placed[0].leader.x2, 100);
  assert.equal(placed[0].leader.y2, 100);
});

test('a label posed right beside its part needs no leader line', () => {
  // Sans obstacle, l'étiquette reste collée à son ancre : la relier par un
  // trait n'apprendrait rien et ajouterait un tracé de plus.
  const placed = Layout.place([label('a', 100, 100)], {});
  assert.equal(placed[0].distance, Layout.RINGS[0]);
  assert.equal(placed[0].leader, null);
  // Et le demander explicitement n'en crée pas non plus.
  const forbidden = Layout.place([label('a', 100, 100, { leader: false })],
    { obstacles: [{ x: 0, y: 0, width: 200, height: 200 }] });
  assert.equal(forbidden[0].leader, null);
});

test('priority decides who gives way, not the order in the document', () => {
  // Deux étiquettes se disputent la seule place libre. Sans priorité, c'est la
  // première du document qui gagne — c'est-à-dire le hasard.
  const crowd = { x: 0, y: 0, width: 400, height: 130 };
  const first = Layout.place([label('basse', 200, 100, { priority: 6 }),
    label('haute', 200, 100, { priority: 1 })], { obstacles: [crowd] });
  const seats = {};
  first.forEach(seat => { seats[seat.id] = seat; });
  // La prioritaire est servie la première, donc au plus près de son ancre.
  assert.ok(seats.haute.distance <= seats.basse.distance,
    'la prioritaire s’est fait déloger : ' + seats.haute.distance + ' vs ' + seats.basse.distance);
  // L'ordre de RENDU, lui, reste celui d'entrée : l'appelant retrouve ses
  // étiquettes là où il les a mises.
  assert.deepEqual(first.map(seat => seat.id), ['basse', 'haute']);
});

test('a low-priority label is dropped only when nothing else works', () => {
  // Un dessin qui couvre tout : il n'y a aucune place propre.
  const wall = { x: -4000, y: -4000, width: 8000, height: 8000 };
  const crowded = Layout.place([label('a', 0, 0, { priority: 5 })],
    { obstacles: [wall], dropAbove: 4 });
  assert.equal(crowded[0].dropped, true, 'une étiquette illisible a été conservée');
  // La prioritaire, elle, reste : entrée, sortie et alerte ne disparaissent
  // jamais, quitte à être posées de travers.
  const kept = Layout.place([label('a', 0, 0, { priority: 1 })],
    { obstacles: [wall], dropAbove: 4 });
  assert.equal(kept[0].dropped, false);
  // Et sur un dessin normal, rien n'est abandonné : c'est le dernier recours,
  // pas la règle.
  const normal = Layout.place([label('a', 100, 100), label('b', 300, 100)],
    { obstacles: [{ x: 60, y: 60, width: 80, height: 80 }], dropAbove: 4 });
  assert.equal(shown(normal).length, 2);
});

test('a label pushed sideways is anchored so it points back at its part', () => {
  // Poussée à droite, elle commence près de la pièce ; poussée à gauche, elle
  // s'y termine. L'ancrer au milieu dans les deux cas l'éloignerait d'une
  // demi-largeur du côté où l'on regarde.
  Layout.DIRECTIONS.forEach(direction => {
    if (direction.dx > 0.01) assert.equal(direction.anchor, 'start');
    else if (direction.dx < -0.01) assert.equal(direction.anchor, 'end');
    else assert.equal(direction.anchor, 'middle');
  });
  // Le haut et le bas d'abord : un mécanisme est plus large que haut, et c'est
  // là qu'il reste de la place.
  assert.deepEqual(Layout.DIRECTIONS.slice(0, 2).map(d => d.dy), [-1, 1]);
});

test('leaving the frame costs, but never as much as being unreadable', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 200 };
  // Une pièce occupe tout le cadre : la seule place propre est dehors. On la
  // rend prioritaire, sinon c'est la règle d'abandon qui répondrait — et ce
  // n'est pas ce qu'on mesure ici.
  const placed = Layout.place([label('a', 200, 100, { priority: 1 })],
    { obstacles: [{ x: 0, y: 0, width: 400, height: 200 }], bounds: bounds });
  assert.equal(placed[0].dropped, false);
  assert.equal(Layout.overlap(boxOf(placed[0]), { x: 0, y: 0, width: 400, height: 200 }), 0);
  // À place égale, celle qui reste dans le cadre est préférée.
  const room = Layout.place([label('a', 200, 100)], { bounds: bounds });
  assert.ok(room[0].y > bounds.y, 'l’étiquette est sortie du cadre sans raison');
});

test('the answer lists every label handed in, in the order handed in', () => {
  const ids = ['x', 'y', 'z', 'w'];
  const placed = Layout.place(ids.map((id, i) => label(id, i * 40, 0, { priority: 4 - i })),
    { obstacles: [{ x: 0, y: -60, width: 200, height: 120 }] });
  assert.deepEqual(placed.map(seat => seat.id), ids);
  // Une liste vide n'est pas une erreur : un dessin sans étiquette existe.
  assert.deepEqual(Layout.place([], {}), []);
  assert.deepEqual(Layout.place(null, {}), []);
});
