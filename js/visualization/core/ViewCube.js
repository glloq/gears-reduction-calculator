/* Cube de vue — choisir d'où l'on regarde en montrant d'où l'on regarde.
 *
 * Le point de vue se choisissait dans une liste déroulante et par deux boutons
 * de rotation. C'est exact, et cela suppose qu'on ait déjà en tête ce que
 * « De dessus » ou « Iso 3/4 » vont donner. Un cube répond à la question
 * autrement : il montre l'orientation courante, et l'on clique la face ou le
 * coin qu'on veut voir. Rien à mémoriser, rien à traduire.
 *
 * Ce module ne dessine PAS un cube en perspective : il projette le cube unité
 * avec la MÊME caméra que le mécanisme (ProjectionEngine), si bien que le cube
 * et le dessin tournent ensemble et disent la même chose. Une face du cube est
 * un quadrilatère projeté, un coin un petit disque posé sur le sommet projeté.
 *
 * Descripteurs purs {tag, attrs} : aucune dépendance au DOM, donc testable
 * sous Node et réutilisable par n'importe quelle vue.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('./ProjectionEngine.js') : root.GearProjectionEngine);
  if (common) module.exports = api; else root.GearViewCube = api;
})(typeof self !== 'undefined' ? self : this, function (Projection) {
  'use strict';

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function fixed(value) { return finite(value, 0).toFixed(2); }
  function node(tag, attrs, text) { return { tag: tag, attrs: attrs, text: text }; }

  /**
   * LES SIX FACES du cube, chacune reliée à la vue qu'elle donne.
   *
   * `normal` est la normale sortante de la face, dans le monde. La vue qu'on
   * obtient en cliquant cette face est celle dont le REGARD est l'opposé de
   * cette normale : on se place devant la face et on regarde vers le cube.
   *
   *     face « De face »   normale [0,0,-1]   regard [0,0,+1]
   *
   * `label` est ce qu'on lit dessus. Il n'y en a que sur les faces, jamais sur
   * les coins : un coin porte une orientation, pas un nom.
   */
  var FACES = [
    { view: 'front', label: 'FACE', normal: [0, 0, -1] },
    { view: 'rear', label: 'ARR.', normal: [0, 0, 1] },
    { view: 'top', label: 'HAUT', normal: [0, -1, 0] },
    { view: 'bottom', label: 'BAS', normal: [0, 1, 0] },
    { view: 'side', label: 'BOUT', normal: [-1, 0, 0] },
    { view: 'side-far', label: 'BOUT', normal: [1, 0, 0] }
  ];

  /**
   * LES QUATRE COINS SUPÉRIEURS, un par azimut isométrique.
   *
   * Le coin d'où l'on regarde en `iso` est celui vers lequel pointe le regard,
   * soit [+1,+1,+1] : c'est le sommet OPPOSÉ à l'œil. On place donc la pastille
   * sur le sommet [−1,−1,−1] — celui qu'on voit —, et cliquer dessus revient à
   * s'y placer. Les quatre restent au-dessus du mécanisme, comme les quatre
   * azimuts eux-mêmes.
   */
  var CORNERS = ['iso', 'iso-90', 'iso-180', 'iso-270'].map(function (id) {
    var w = Projection.view(id).w;
    return { view: id, at: [-w[0], -w[1], -w[2]] };
  });

  /** Les huit sommets du cube unité, dans l'ordre binaire (x, y, z) ∈ {−1, +1}. */
  function corners() {
    var list = [];
    [-1, 1].forEach(function (x) {
      [-1, 1].forEach(function (y) {
        [-1, 1].forEach(function (z) { list.push([x, y, z]); });
      });
    });
    return list;
  }

  /** Les quatre sommets d'une face, tournés dans le sens de sa normale. */
  function quad(normal) {
    var axis = normal.reduce(function (best, value, index) {
      return Math.abs(value) > Math.abs(normal[best]) ? index : best;
    }, 0);
    var sign = normal[axis] < 0 ? -1 : 1;
    var others = [0, 1, 2].filter(function (i) { return i !== axis; });
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (uv) {
      var point = [0, 0, 0];
      point[axis] = sign;
      point[others[0]] = uv[0];
      point[others[1]] = uv[1];
      return point;
    });
  }

  /**
   * build(viewId, options) → le cube tel que CETTE caméra le voit.
   *
   * Les faces tournées vers l'œil sont cliquables et lisibles ; celles qui
   * regardent ailleurs ne sont pas dessinées — un cube transparent où l'on
   * cliquerait la face de derrière ne veut rien dire.
   *
   * @returns {{shapes: Array, size: number, active: string}}
   */
  function build(viewId, options) {
    var settings = options || {};
    var size = finite(settings.size, 64);
    // Le cube d'une vue dépliée n'a pas de sens : elle n'est pas une
    // projection, et rien ne tourne. On montre alors la caméra de `front`,
    // sans marquer aucune face active — le cube dit « voici les vues que je
    // peux vous donner », pas « vous y êtes ».
    var spatial = viewId && viewId !== 'unfolded';
    var camera = Projection.view(spatial ? viewId : 'front');
    var active = spatial ? camera.id : null;
    var radius = size / 2;
    // Le cube unité mesure √3 en diagonale : on le rentre dans le cadre.
    var scale = radius / Math.sqrt(3) * 0.92;
    function screen(point) {
      var flat = Projection.project(point, camera);
      return [radius + flat[0] * scale, radius + flat[1] * scale];
    }

    var shapes = [];
    var faces = [];
    FACES.forEach(function (face) {
      // Vue de biais, une face regarde l'œil quand sa normale s'oppose au
      // regard. C'est le même produit scalaire qui décide, pour une face de
      // cube comme pour une roue, de ce qu'on en voit.
      var facing = -(face.normal[0] * camera.w[0] + face.normal[1] * camera.w[1] + face.normal[2] * camera.w[2]);
      if (facing <= 1e-6) return;
      var points = quad(face.normal).map(screen);
      faces.push({ face: face, facing: facing, points: points });
    });
    // De la plus rasante à la plus frontale : la face qu'on voit le mieux se
    // pose par-dessus, et c'est elle qu'on attrape.
    faces.sort(function (a, b) { return a.facing - b.facing; });
    faces.forEach(function (entry) {
      var d = entry.points.map(function (point, i) {
        return (i ? 'L ' : 'M ') + fixed(point[0]) + ' ' + fixed(point[1]);
      }).join(' ') + ' Z';
      var centre = entry.points.reduce(function (sum, point) {
        return [sum[0] + point[0] / 4, sum[1] + point[1] / 4];
      }, [0, 0]);
      var current = active === entry.face.view;
      shapes.push(node('path', {
        class: 'view-cube-face' + (current ? ' is-active' : ''),
        d: d, 'data-view': entry.face.view, 'data-facing': entry.facing.toFixed(3),
        tabindex: '0', role: 'button',
        'aria-label': 'Regarder ' + entry.face.label.toLowerCase(),
        'aria-pressed': String(current)
      }));
      // Le nom ne se lit que sur une face assez ouverte : écrit sur une face
      // rasante, il devient une barre de pixels qui salit le cube.
      if (entry.facing > 0.5) {
        shapes.push(node('text', { class: 'view-cube-label', x: fixed(centre[0]), y: fixed(centre[1]),
          'text-anchor': 'middle', dy: '0.34em' }, entry.face.label));
      }
    });

    // Les coins par-dessus les faces : ils sont plus petits, et c'est le geste
    // le plus fréquent — on tourne autour bien plus souvent qu'on ne revient
    // à une vue plane.
    CORNERS.forEach(function (corner) {
      var depth = corner.at[0] * camera.w[0] + corner.at[1] * camera.w[1] + corner.at[2] * camera.w[2];
      // Un coin situé DERRIÈRE le cube est caché par lui : le proposer
      // reviendrait à cliquer au travers de la pièce.
      if (depth > -0.05) return;
      // Le coin où l'on SE TROUVE DÉJÀ ne se propose pas : en isométrie il se
      // projette au centre du cube, pile là où les trois faces se rejoignent
      // et où les noms se lisent. Ne restent donc que les coins qui mènent
      // ailleurs — et ils tombent aux sommets gauche et droit de la
      // silhouette, ce qui les rend lisibles comme « tourner par là ».
      if (active === corner.view) return;
      // Posée un peu EN DEHORS de la silhouette : sur le sommet même, la
      // pastille chevauche le nom de la face voisine, et l'on ne sait plus si
      // l'on clique le coin ou la face.
      var seat = screen(corner.at);
      var point = [radius + (seat[0] - radius) * 1.1, radius + (seat[1] - radius) * 1.1];
      shapes.push(node('circle', {
        class: 'view-cube-corner',
        cx: fixed(point[0]), cy: fixed(point[1]), r: fixed(size * 0.075),
        'data-view': corner.view, tabindex: '0', role: 'button',
        'aria-label': 'Vue isométrique ' + (Projection.isoQuarter(corner.view) + 1) + ' sur 4',
        'aria-pressed': 'false'
      }));
    });

    return { shapes: shapes, size: size, active: active,
      // Le trièdre du monde, projeté par la même caméra : il dit quel axe part
      // où, et c'est lui qui explique pourquoi une roue se voit en ellipse.
      axes: axes(camera, size) };
  }

  /**
   * LE TRIÈDRE DU MONDE, sous le cube.
   *
   * Trois segments partant d'une origine commune, chacun étiqueté. Ils sont
   * projetés par la caméra courante : en isométrie ils se séparent de 120°, et
   * vus en bout l'un d'eux se réduit à un point — ce que le dessin montre
   * aussi, et qu'il vaut mieux pouvoir vérifier d'un coup d'œil.
   */
  function axes(camera, size) {
    var reach = size * 0.2;
    var origin = [size * 0.5, size * 1.24];
    return [{ id: 'X', direction: [1, 0, 0] }, { id: 'Y', direction: [0, 1, 0] }, { id: 'Z', direction: [0, 0, 1] }]
      .map(function (axis) {
        var flat = Projection.project(axis.direction, camera);
        var end = [origin[0] + flat[0] * reach, origin[1] + flat[1] * reach];
        var span = Math.hypot(end[0] - origin[0], end[1] - origin[1]);
        return { id: axis.id, x1: origin[0], y1: origin[1], x2: end[0], y2: end[1],
          // Vu en bout, l'axe n'est plus un segment : c'est un point, et son
          // étiquette est tout ce qui en reste.
          endOn: span < size * 0.04,
          label: [origin[0] + flat[0] * (reach + size * 0.1), origin[1] + flat[1] * (reach + size * 0.1)] };
      });
  }

  return { build: build, FACES: FACES, CORNERS: CORNERS, quad: quad, corners: corners };
});
