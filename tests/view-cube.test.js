const test = require('node:test');
const assert = require('node:assert/strict');
const Cube = require('../js/visualization/core/ViewCube.js');
const Projection = require('../js/visualization/core/ProjectionEngine.js');

const { dot } = Projection.vector;
const facesOf = built => built.shapes.filter(s => /view-cube-face/.test(s.attrs.class));
const cornersOf = built => built.shapes.filter(s => /view-cube-corner/.test(s.attrs.class));
const labelsOf = built => built.shapes.filter(s => /view-cube-label/.test(s.attrs.class));
const points = shape => shape.attrs.d.split(/[ML] /).slice(1)
  .map(pair => pair.replace(' Z', '').trim().split(/\s+/).map(Number));

test('a face of the cube leads to the view that looks at it', () => {
  // Cliquer une face, c'est aller se placer devant elle et regarder le cube :
  // le regard de la vue obtenue est donc l'opposé de la normale de la face.
  // Sans cela, cliquer « HAUT » emmènerait dessous.
  Cube.FACES.forEach(face => {
    const seen = Projection.view(face.view);
    assert.equal(seen.id, face.view, face.view + ' : vue inconnue');
    [0, 1, 2].forEach(i => assert.ok(Math.abs(seen.w[i] + face.normal[i]) < 1e-12,
      face.view + ' : la face ne regarde pas dans le sens de sa vue'));
  });
  // Les six faces couvrent les six vues orthographiques, sans doublon.
  assert.equal(new Set(Cube.FACES.map(f => f.view)).size, 6);
});

test('only the faces turned towards the eye are drawn, and they are clickable', () => {
  // Vue de face, on voit UNE face ; en isométrie, TROIS — c'est ce qu'un cube
  // montre, et un cube transparent où l'on cliquerait la face de derrière ne
  // voudrait rien dire.
  assert.equal(facesOf(Cube.build('front')).length, 1);
  assert.equal(facesOf(Cube.build('top')).length, 1);
  assert.equal(facesOf(Cube.build('side')).length, 1);
  ['iso', 'iso-90', 'iso-180', 'iso-270'].forEach(view => {
    const faces = facesOf(Cube.build(view));
    assert.equal(faces.length, 3, view);
    // Et ce sont bien celles que la caméra regarde.
    const camera = Projection.view(view);
    faces.forEach(shape => {
      const face = Cube.FACES.filter(f => f.view === shape.attrs['data-view'])[0];
      assert.ok(-dot(face.normal, camera.w) > 0, view + ' : ' + shape.attrs['data-view'] + ' tourne le dos');
    });
  });
  // Chacune est un vrai bouton : atteignable au clavier, et nommée.
  facesOf(Cube.build('iso')).forEach(shape => {
    assert.equal(shape.attrs.role, 'button');
    assert.equal(shape.attrs.tabindex, '0');
    assert.ok(shape.attrs['aria-label']);
    assert.ok(shape.attrs['data-view']);
  });
});

test('the cube says where the camera is, and says it once', () => {
  ['front', 'top', 'side', 'rear', 'bottom', 'side-far'].forEach(view => {
    const built = Cube.build(view);
    assert.equal(built.active, view);
    const marked = built.shapes.filter(s => /is-active/.test(s.attrs.class));
    assert.equal(marked.length, 1, view + ' : ' + marked.length + ' éléments actifs');
    assert.equal(marked[0].attrs['data-view'], view);
    assert.equal(marked[0].attrs['aria-pressed'], 'true');
  });
  // La vue dépliée n'est pas une projection : le cube propose des vues, il
  // n'en affirme aucune.
  const flat = Cube.build('unfolded');
  assert.equal(flat.active, null);
  assert.equal(flat.shapes.filter(s => /is-active/.test(s.attrs.class)).length, 0);
  assert.ok(facesOf(flat).length > 0, 'un cube sans face ne se clique pas');
});

test('the corners are the four isometric azimuths, minus the one you are on', () => {
  assert.deepEqual(Cube.CORNERS.map(c => c.view), ['iso', 'iso-90', 'iso-180', 'iso-270']);
  // Le coin d'une vue iso est celui qu'on VOIT : à l'opposé du regard.
  Cube.CORNERS.forEach(corner => {
    const w = Projection.view(corner.view).w;
    [0, 1, 2].forEach(i => assert.ok(Math.abs(corner.at[i] + w[i]) < 1e-12, corner.view));
    // Tous au-dessus du mécanisme, comme les azimuts eux-mêmes.
    assert.ok(corner.at[1] < 0, corner.view + ' : coin sous le cube');
  });
  ['iso', 'iso-90', 'iso-180', 'iso-270'].forEach(view => {
    const offered = cornersOf(Cube.build(view)).map(s => s.attrs['data-view']);
    // Le coin où l'on est déjà ne se propose pas : il se projette au centre du
    // cube, pile là où les trois faces se rejoignent et où les noms se lisent.
    assert.ok(!offered.includes(view), view + ' : le coin courant est proposé');
    // Les deux quarts de tour voisins restent atteignables ; le coin opposé
    // est derrière le cube, donc caché par lui.
    assert.deepEqual(offered.sort(), [Projection.rotateIso(view, -1), Projection.rotateIso(view, 1)].sort(),
      view + ' : ' + offered.join(','));
  });
  // Depuis une vue plane, deux coins mènent à l'isométrie.
  assert.ok(cornersOf(Cube.build('front')).length >= 2);
});

test('the cube turns with the camera instead of being redrawn upright', () => {
  const drawings = ['iso', 'iso-90', 'iso-180', 'iso-270'].map(view =>
    facesOf(Cube.build(view)).map(s => s.attrs.d).join('|'));
  // Quatre azimuts, quatre dessins : un cube figé ne dirait rien de plus
  // qu'une icône, et ne pourrait pas contredire le mécanisme sans qu'on le
  // voie.
  assert.equal(new Set(drawings).size, 4);
  // La même face n'occupe pas la même place d'un azimut à l'autre.
  const seatOf = view => {
    const shape = facesOf(Cube.build(view)).filter(s => s.attrs['data-view'] === 'top')[0];
    return points(shape).map(p => p.map(v => v.toFixed(3)).join(',')).join(' ');
  };
  assert.notEqual(seatOf('iso'), seatOf('iso-90'));
  // Et il reste dans son cadre : un cube qui déborde recouvrirait le dessin.
  const built = Cube.build('iso', { size: 100 });
  facesOf(built).forEach(shape => points(shape).forEach(point => {
    assert.ok(point[0] >= -1 && point[0] <= 101, 'x hors cadre : ' + point[0]);
    assert.ok(point[1] >= -1 && point[1] <= 101, 'y hors cadre : ' + point[1]);
  }));
});

test('a name is written only on a face open enough to carry one', () => {
  // Vue de face, une seule face est ouverte : une seule est nommée.
  assert.equal(labelsOf(Cube.build('front')).length, 1);
  // En isométrie, les trois faces sont à 55° du regard : toutes lisibles.
  assert.equal(labelsOf(Cube.build('iso')).length, 3);
  // Aucun nom ne dépasse le nombre de faces dessinées, à aucun point de vue.
  Projection.ALL.forEach(view => {
    const built = Cube.build(view.id);
    assert.ok(labelsOf(built).length <= facesOf(built).length, view.id);
  });
});

test('the trihedron is projected by the same camera as the drawing', () => {
  ['front', 'top', 'side', 'iso', 'iso-180'].forEach(view => {
    const built = Cube.build(view, { size: 100 });
    assert.equal(built.axes.length, 3);
    const camera = Projection.view(view);
    built.axes.forEach((axis, index) => {
      const direction = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][index];
      const flat = Projection.project(direction, camera);
      const drawn = [axis.x2 - axis.x1, axis.y2 - axis.y1];
      const span = Math.hypot(drawn[0], drawn[1]);
      if (axis.endOn) {
        // Vu en bout, l'axe n'est plus un segment : c'est un point, et son
        // étiquette est tout ce qu'il en reste.
        assert.ok(Math.hypot(flat[0], flat[1]) < 1e-9, view + ' ' + axis.id);
        return;
      }
      // Sinon il pointe exactement là où la caméra le projette.
      assert.ok(Math.abs(drawn[0] / span - flat[0] / Math.hypot(flat[0], flat[1])) < 1e-9,
        view + ' ' + axis.id + ' : direction fausse');
    });
  });
  // Vu en bout de l'axe X, c'est bien X qui se réduit à un point.
  const endOn = Cube.build('side').axes.filter(axis => axis.endOn).map(axis => axis.id);
  assert.deepEqual(endOn, ['X']);
  // En isométrie, aucun des trois ne disparaît.
  assert.deepEqual(Cube.build('iso').axes.filter(axis => axis.endOn), []);
});
