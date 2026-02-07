/**
 * @module visualization/AnimationEngine
 * @description Mixin d'animation pour GearSVG.
 *
 * Ce module ajoute au prototype de GearSVG les méthodes de contrôle
 * et d'exécution de l'animation de rotation des engrenages :
 *   - Basculement on/off ({@link GearSVG#toggleAnimation})
 *   - Démarrage ({@link GearSVG#startAnimation})
 *   - Arrêt ({@link GearSVG#stopAnimation})
 *   - Boucle d'animation ({@link GearSVG#_animate})
 *   - Calcul du rapport par étage ({@link GearSVG#_stageRatio})
 *
 * L'animation utilise requestAnimationFrame pour un rendu fluide.
 * Chaque engrenage tourne à une vitesse proportionnelle au rapport cumulé
 * des étages précédents, avec un sens de rotation correct par type.
 *
 * Règles de sens de rotation :
 *   - spur, helical, bevel, worm : inversion du sens à chaque étage
 *   - internal, belt, epicyclic : même sens (pas d'inversion)
 *
 * @see {@link module:GearSVG} pour le noyau de la classe
 */
(function () {

  var proto = GearSVG.prototype;
  var SVG_CFG = GearApp.config.SVG;

  // ===== Contrôle de l'animation =====

  /**
   * Bascule l'état de l'animation (démarrer si arrêtée, arrêter si en cours).
   */
  proto.toggleAnimation = function () {
    if (this.isAnimating) {
      this.stopAnimation();
    } else {
      this.startAnimation();
    }
  };

  /**
   * Démarre l'animation de rotation des engrenages.
   */
  proto.startAnimation = function () {
    if (!this._currentSolution || this.isAnimating) return;
    this.isAnimating = true;
    this.animationAngle = 0;
    this._animate();
  };

  /**
   * Arrête l'animation de rotation.
   */
  proto.stopAnimation = function () {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  };

  // ===== Calcul du rapport par étage =====

  /**
   * Calcule le rapport de transmission d'un étage donné.
   *
   * Pour un train épicycloïdal (couronne fixe) : i = 1 + Zcouronne / Zsolaire
   * Pour tous les autres types : i = B / A
   *
   * @private
   * @param {number} stageIndex - Indice de l'étage (0-based)
   * @returns {number} Le rapport de transmission
   */
  proto._stageRatio = function (stageIndex) {
    var stage = this._currentSolution[stageIndex];
    var A = stage[0];
    var B = stage[1];
    var typeId = stage[2];
    if (typeId === 'epicyclic') return 1 + B / A;
    return B / A;
  };

  // ===== Boucle d'animation =====

  /**
   * Boucle d'animation principale (requestAnimationFrame).
   *
   * Pour chaque engrenage :
   *   1. Calcule le rapport cumulé de tous les étages précédents
   *   2. Détermine le sens de rotation selon le type de chaque étage traversé
   *   3. Applique la rotation via une transformation SVG translate + rotate
   *
   * @private
   */
  proto._animate = function () {
    if (!this.isAnimating) return;

    var self = this;

    // Incrémentation de l'angle de base (vitesse de l'engrenage d'entrée)
    this.animationAngle += SVG_CFG.ANIMATION_SPEED;

    this.gearData.forEach(function (gear, index) {
      // Chaque paire d'engrenages forme un étage (indices 0-1, 2-3, 4-5, ...)
      var pairIndex = Math.floor(index / 2);
      var isDriver = index % 2 === 0;

      // Rapport cumulé jusqu'à cet engrenage
      var cumulRatio = 1;
      for (var i = 0; i < pairIndex; i++) {
        cumulRatio *= self._stageRatio(i);
      }
      if (!isDriver) {
        cumulRatio *= self._stageRatio(pairIndex);
      }

      // Calcul du signe de rotation
      var sensSign = 1;
      for (var j = 0; j <= pairIndex; j++) {
        var stageType = self._currentSolution[j] ? self._currentSolution[j][2] || 'spur' : 'spur';
        if (j < pairIndex || !isDriver) {
          if (stageType === 'spur' || stageType === 'helical' || stageType === 'bevel' || stageType === 'worm') {
            sensSign *= -1;
          }
          // internal, belt, epicyclic : même sens (sensSign inchangé)
        }
      }

      // Application de la rotation
      var angleDeg = (self.animationAngle / cumulRatio) * sensSign * (180 / Math.PI);
      gear.group.setAttribute("transform", "translate(" + gear.cx + ", " + gear.cy + ") rotate(" + angleDeg + ")");
    });

    // Planification de la prochaine frame
    this.animationId = requestAnimationFrame(function () {
      self._animate();
    });
  };

})();
