/* Schéma cinématique : QUI entraîne QUOI, et à quelle vitesse.
 *
 * C'est une vue SYMBOLIQUE — rien n'y est à l'échelle — mais elle décrit le
 * même mécanisme que les autres, et doit donc en tenir la topologie du même
 * endroit. Elle la reconstruisait : l'axe d'un renvoi était choisi par la
 * PARITÉ du rang de l'étage, si bien que deux réducteurs identiques dessinés
 * à des rangs différents n'avaient pas la même géométrie. C'est exactement le
 * défaut que MechanicalGraph a corrigé pour les autres vues.
 */
(function (root, factory) {
  var common = typeof module === 'object' && module.exports;
  var api = factory(common ? require('../../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry,
    common ? require('../core/MechanicalGraph.js') : root.GearMechanicalGraph,
    common ? require('../core/ProjectionEngine.js') : root.GearProjectionEngine);
  if (common) module.exports = api;
  else root.KinematicLayoutEngine = api;
})(typeof self !== 'undefined' ? self : this, function (Registry, MechanicalGraph, Projection) {
  'use strict';

  var AXES = [
    { x: 1, y: 0, z: 0, name: 'X' },
    { x: 0, y: 1, z: 0, name: 'Y' },
    { x: 0, y: 0, z: 1, name: 'Z' }
  ];

  function typeOf(stage) { return stage.type || stage[2] || 'spur'; }
  function relation(stage) {
    return Registry.getAxisRelation({type:typeOf(stage)});
  }
  function copy(point) { return { id: point.id, x: point.x, y: point.y, z: point.z, axis: point.axis, role: point.role }; }
  /**
   * Étiquettes d'arbres : deux nœuds trop proches voient leur étiquette décalée
   * d'un cran. L'étiquette bascule sous le nœud plutôt que de sortir du cadre —
   * un « S1 · 375 rpm » hors viewBox serait purement et simplement perdu.
   */
  function resolveLabels(points, spacing, top) {
    spacing = spacing || 16;
    top = top == null ? 24 : top;
    var lanes = [];
    function free(x, y) {
      return !lanes.some(function (lane) { return Math.abs(lane.x - x) < 80 && Math.abs(lane.y - y) < spacing; });
    }
    return points.map(function (point) {
      var above = point.y - 52, below = point.y + 62;
      var y = above >= top ? above : below;
      var direction = y === above ? -1 : 1;
      for (var guard = 0; guard < 6 && !free(point.x, y); guard++) {
        var next = y + direction * spacing;
        y = next >= top ? next : below + guard * spacing;
      }
      lanes.push({ x: point.x, y: y });
      point.labelY = y;
      return point;
    });
  }

  /**
   * Normalisation : le monde 3D projeté peut sortir du cadre par le haut ou par
   * la gauche. On le recale et on dimensionne le viewBox sur son contenu réel,
   * plutôt que sur une hauteur constante.
   */
  function normalize(groups, minWidth) {
    var all = groups.reduce(function (list, group) { return list.concat(group); }, []);
    if (!all.length) return { width: minWidth, height: 330 };
    var minX = Math.min.apply(null, all.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, all.map(function (p) { return p.y; }));
    var maxX = Math.max.apply(null, all.map(function (p) { return p.x; }));
    var maxY = Math.max.apply(null, all.map(function (p) { return p.y; }));
    var dx = minX < 110 ? 110 - minX : 0;
    var dy = minY < 110 ? 110 - minY : 0;
    if (dx || dy) all.forEach(function (p) { p.x += dx; p.y += dy; });
    return { width: Math.max(minWidth, maxX + dx + 110), height: Math.max(330, maxY + dy + 110) };
  }
  /**
   * Le nom d'axe d'une direction réelle. Le graphe mécanique produit des axes
   * canoniques ; on retient la composante dominante, ce qui reste juste pour
   * une direction quelconque et donne toujours un nom au schéma.
   */
  function axisOf(direction) {
    var best = 0;
    for (var i = 1; i < 3; i++) if (Math.abs(direction[i]) > Math.abs(direction[best])) best = i;
    return AXES[best];
  }

  /**
   * La direction de l'axe mené de chaque mécanisme, telle que le modèle
   * spatial l'établit. Sans elle, on choisissait « l'axe suivant » par la
   * parité du rang : un renvoi placé en deuxième position ne partait pas dans
   * la même direction que le même renvoi placé en troisième.
   */
  function drivenAxes(stages, graph) {
    var byStage = {};
    if (!graph || !graph.mechanisms) return byStage;
    graph.mechanisms.forEach(function (mechanism) {
      if (!mechanism.outputPort || !mechanism.outputPort.shaftId) return;
      var axis = graph.axisFor(mechanism.outputPort.shaftId);
      if (axis) byStage[mechanism.stageIndex] = axis.direction;
    });
    return byStage;
  }
  /**
   * Les projections d'origine étaient deux formules écrites ici :
   *
   *     principale   x = X + 0,45·Z   y = Y − 0,30·Z
   *     orthogonale  x = X            y = Z
   *
   * La seconde supprimait purement et simplement Y. Ce n'était pas un choix de
   * point de vue mais une perte d'information — dans la vue où la projection
   * importe le moins, puisque le schéma sert à comprendre qui entraîne quoi.
   * Le moteur de projection en donne quatre, qui sont des bases orthonormées :
   * rien n'y est écrasé, seule la composante suivant le regard disparaît.
   *
   * Le repère du schéma a son Y vers le bas, comme l'écran ; le monde du moteur
   * l'a vers le haut. On rend donc la coordonnée au monde avant de projeter,
   * faute de quoi tout le schéma serait dessiné à l'envers.
   */
  var LEGACY_VIEWS = { main: 'iso', orthogonal: 'top' };

  function viewOf(name) {
    return Projection.view(LEGACY_VIEWS[name] || name);
  }

  function project(point, projection, origin) {
    var view = typeof projection === 'string' || projection == null ? viewOf(projection) : projection;
    var screen = Projection.project([point.x, -point.y, point.z], view);
    return { id: point.id, x: origin.x + screen[0], y: origin.y + screen[1], z: point.z,
      axis: point.axis, orientation: point.axis.name, role: point.role };
  }
  function collisionScore(points) {
    var score = 0;
    for (var i = 0; i < points.length; i++) for (var j = i + 1; j < points.length; j++) {
      var dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 42) score += 42 - distance;
    }
    return score;
  }

  function KinematicLayoutEngine(options) {
    options = options || {};
    this.shaftSpacing = options.shaftSpacing || 105;
    this.stageSpacing = options.stageSpacing || 145;
    this.origin = options.origin || { x: 85, y: 145 };
  }

  KinematicLayoutEngine.prototype.layout = function (stages, projectionName, options) {
    var requestedProjection = projectionName || 'main', projection = requestedProjection, self = this;
    // La topologie vient du graphe mécanique, pas d'une seconde lecture des
    // étages. Le renderer le passe quand il l'a déjà ; sinon on le construit,
    // plutôt que de deviner.
    var graph = (options && options.graph)
      || (MechanicalGraph && MechanicalGraph.build ? MechanicalGraph.build({ stages: stages }) : null);
    var driven = drivenAxes(stages, graph);
    var current = { id: 0, x: 0, y: 0, z: 0, axis: AXES[0], role: 'INPUT' };
    var shafts = [current], worldNodes = [];

    stages.forEach(function (stage, index) {
      var mode = relation(stage), input = current, output = copy(input);
      // stageIndex : l'étage qui met cet arbre en mouvement. C'est lui qui donne
      // la vitesse et le sens affichés sur le nœud d'arbre.
      output.stageIndex = index;
      if (mode === 'coaxial') {
        // Coaxial : même ligne d'axe, mais un second arbre concentrique (la
        // sortie d'un planétaire ne tourne pas comme son entrée).
        output.id = input.id;
        output.coaxial = true;
      } else if (mode === 'perpendicular') {
        output.id = index + 1;
        output.axis = driven[index] ? axisOf(driven[index]) : input.axis;
        output.x += self.stageSpacing;
        output.y += input.axis.name === 'Z' ? self.shaftSpacing : 0;
        output.z += input.axis.name === 'X' ? self.shaftSpacing : 0;
      } else if (mode === 'linear') {
        output.id = index + 1;
        output.axis = { x: input.axis.x, y: input.axis.y, z: input.axis.z, name: 'LINEAR' };
        output.x += self.stageSpacing;
      } else {
        output.id = index + 1;
        output.axis = input.axis;
        output.x += self.stageSpacing;
        if (input.axis.name === 'Z') output.z += (index % 2 ? 1 : -1) * self.shaftSpacing;
        else output.y += (index % 2 ? 1 : -1) * (mode==='internal-parallel'?self.shaftSpacing*.55:self.shaftSpacing);
      }
      shafts.push(output); current = output;
      worldNodes.push({ index: index, stage: stage, relation: mode, input: input, output: output });
    });
    if (current) current.role = 'OUTPUT';

    if (projection === 'auto') {
      // Un schéma symbolique n'a rien à mesurer : ce qui le rend utile est
      // qu'on y distingue les arbres. Le critère d'encombrement, discutable
      // pour un dessin coté, est ici le bon.
      var candidates = Projection.VIEWS.map(function (view) { return view.id; });
      projection = candidates.reduce(function (best, candidate) {
        var candidatePoints = shafts.map(function (shaft) { return project(shaft, candidate, self.origin); });
        var candidateScore = collisionScore(candidatePoints);
        return !best || candidateScore < best.score ? { name: candidate, score: candidateScore } : best;
      }, null).name;
    } else {
      projection = viewOf(projection).id;
    }
    var projectedShafts = shafts.filter(function (shaft, index, all) {
      return all.findIndex(function (candidate) { return candidate.id === shaft.id; }) === index;
    }).map(function (shaft) {
      var point = project(shaft, projection, self.origin);
      point.stageIndex = shaft.stageIndex;
      point.coaxial = !!shaft.coaxial;
      return point;
    });
    // Un étage coaxial ajoute un arbre concentrique : il est listé à part pour
    // que le renderer puisse afficher ses deux vitesses.
    var coaxialShafts = worldNodes.filter(function (node) { return node.relation === 'coaxial'; })
      .map(function (node) {
        var point = project(node.output, projection, self.origin);
        point.stageIndex = node.index;
        point.coaxial = true;
        return point;
      });
    var nodes = worldNodes.map(function (node) {
      return { index: node.index, stage: node.stage, relation: node.relation,
        input: project(node.input, projection, self.origin), output: project(node.output, projection, self.origin), projection: projection };
    });
    // Recalage puis étiquetage : les étiquettes sont posées après la
    // normalisation, sinon elles viseraient les anciennes coordonnées.
    var nodePoints = nodes.reduce(function (list, node) { return list.concat([node.input, node.output]); }, []);
    var box = normalize([projectedShafts, coaxialShafts, nodePoints],
      Math.max(460, stages.length * this.stageSpacing + 220));
    resolveLabels(projectedShafts.concat(coaxialShafts), 18);

    return { nodes: nodes, shafts: shafts, projectedShafts: projectedShafts, coaxialShafts: coaxialShafts,
      worldNodes: worldNodes,
      width: box.width, height: box.height,
      projection: projection, requestedProjection: requestedProjection };
  };

  KinematicLayoutEngine.relation = relation;
  KinematicLayoutEngine.project = project;
  KinematicLayoutEngine.collisionScore = collisionScore;
  KinematicLayoutEngine.resolveLabels = resolveLabels;
  KinematicLayoutEngine.normalize = normalize;
  return KinematicLayoutEngine;
});
