(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('../../transmissions/TransmissionRegistry.js') : root.GearTransmissionRegistry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KinematicLayoutEngine = api;
})(typeof self !== 'undefined' ? self : this, function (Registry) {
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
  function nextPerpendicular(axis, index) {
    var current = AXES.findIndex(function (candidate) { return candidate.name === axis.name; });
    return AXES[(current + 1 + (index % 2)) % AXES.length];
  }
  function project(point, projection, origin) {
    var horizontal = projection === 'orthogonal' ? point.x : point.x + point.z * 0.45;
    var vertical = projection === 'orthogonal' ? point.z : point.y - point.z * 0.3;
    return { id: point.id, x: origin.x + horizontal, y: origin.y + vertical, z: point.z, axis: point.axis, orientation: point.axis.name, role: point.role };
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

  KinematicLayoutEngine.prototype.layout = function (stages, projectionName) {
    var requestedProjection = projectionName || 'main', projection = requestedProjection, self = this;
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
        output.axis = nextPerpendicular(input.axis, index);
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
      var candidates = ['main', 'orthogonal'];
      projection = candidates.reduce(function (best, candidate) {
        var candidatePoints = shafts.map(function (shaft) { return project(shaft, candidate, self.origin); });
        var candidateScore = collisionScore(candidatePoints);
        return !best || candidateScore < best.score ? { name: candidate, score: candidateScore } : best;
      }, null).name;
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
