/**
 * @module visualization/SVGInteraction
 * @description Mixin d'interaction SVG pour GearSVG.
 *
 * Ce module ajoute au prototype de GearSVG les méthodes de gestion
 * des interactions utilisateur :
 *   - Zoom (molette de la souris)
 *   - Pan (clic-glisser)
 *   - Tooltips (info-bulles au survol des engrenages)
 *   - Cadrage automatique du viewBox ({@link GearSVG#_fitViewBox})
 *   - Réinitialisation de la vue ({@link GearSVG#resetView})
 *
 * Pattern mixin : les méthodes sont assignées à GearSVG.prototype après
 * la définition de la classe dans GearSVG.js.
 *
 * @see {@link module:GearSVG} pour le noyau de la classe
 * @see {@link module:visualization/GearDrawer} pour les zones de survol (hit areas)
 */
(function () {

  var proto = GearSVG.prototype;
  var SVG_CFG = GearApp.config.SVG;

  // ===== Gestion des événements d'interaction =====

  /**
   * Configure les gestionnaires d'événements pour le zoom (molette)
   * et le pan (clic-glisser) sur l'élément SVG.
   *
   * @private
   */
  proto._setupEvents = function () {
    var self = this;

    // --- Zoom par molette ---
    this.svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var zoomFactor = e.deltaY > 0 ? SVG_CFG.ZOOM_FACTOR_IN : SVG_CFG.ZOOM_FACTOR_OUT;
      self.viewBox.w *= zoomFactor;
      self.viewBox.h *= zoomFactor;
      self.scale *= zoomFactor;
      self._updateViewBox();
    });

    // --- Pan (déplacement) par clic gauche + glisser ---
    this.svg.addEventListener("mousedown", function (e) {
      if (e.button === 0) {
        self.isPanning = true;
        self.panStart = { x: e.clientX, y: e.clientY };
        self.svg.style.cursor = "grabbing";
      }
    });

    // Calcul du déplacement en coordonnées SVG et mise à jour du viewBox
    this.svg.addEventListener("mousemove", function (e) {
      if (self.isPanning) {
        var dx = (e.clientX - self.panStart.x) * (self.viewBox.w / self.svg.clientWidth);
        var dy = (e.clientY - self.panStart.y) * (self.viewBox.h / self.svg.clientHeight);
        self.viewBox.x -= dx;
        self.viewBox.y -= dy;
        self.panStart = { x: e.clientX, y: e.clientY };
        self._updateViewBox();
      }
    });

    // Fin du pan
    this.svg.addEventListener("mouseup", function () {
      self.isPanning = false;
      self.svg.style.cursor = "grab";
    });

    this.svg.addEventListener("mouseleave", function () {
      self.isPanning = false;
      self.svg.style.cursor = "grab";
    });
  };

  /**
   * Met à jour l'attribut viewBox du SVG à partir de l'état interne.
   * @private
   */
  proto._updateViewBox = function () {
    this.svg.setAttribute("viewBox",
      this.viewBox.x + " " + this.viewBox.y + " " + this.viewBox.w + " " + this.viewBox.h
    );
  };

  // ===== Cadrage automatique =====

  /**
   * Ajuste le viewBox du SVG pour cadrer l'ensemble des engrenages dessinés.
   * Calcule les bornes min/max et ajoute un padding.
   *
   * @private
   */
  proto._fitViewBox = function () {
    if (this.gearData.length === 0) return;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var currentMod = this._currentMod;

    this.gearData.forEach(function (g) {
      var r = (currentMod * g.nbDents) / 2 + currentMod * 2;
      minX = Math.min(minX, g.cx - r);
      minY = Math.min(minY, g.cy - r);
      maxX = Math.max(maxX, g.cx + r);
      maxY = Math.max(maxY, g.cy + r);
    });

    var padding = SVG_CFG.FIT_PADDING;
    this.viewBox = {
      x: minX - padding,
      y: minY - padding,
      w: maxX - minX + 2 * padding,
      h: maxY - minY + 2 * padding + 30
    };
    this._updateViewBox();
  };

  /**
   * Réinitialise le zoom et le pan pour cadrer le train complet.
   */
  proto.resetView = function () {
    this._fitViewBox();
  };

  // ===== Tooltip (info-bulle interactive) =====

  /**
   * Ajoute une zone de survol invisible avec tooltip sur un groupe SVG.
   * Utilisée par les types de transmission spéciaux (vis sans fin, conique, etc.).
   *
   * @private
   * @param {SVGGElement} group - Le groupe SVG
   * @param {number} cx - Coordonnée X du centre
   * @param {number} cy - Coordonnée Y du centre
   * @param {number} rayon - Rayon de la zone de détection
   * @param {Array<string>} tooltipLines - Lignes de texte du tooltip
   */
  proto._addTooltipHitArea = function (group, cx, cy, rayon, tooltipLines) {
    var self = this;
    var hitArea = document.createElementNS(this.svgNS, "circle");
    hitArea.setAttribute("r", rayon);
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("cursor", "pointer");
    hitArea.addEventListener("mouseenter", function () {
      self._showTooltipLines(cx, cy - rayon - 15, tooltipLines);
    });
    hitArea.addEventListener("mouseleave", function () {
      self._hideTooltip();
    });
    group.appendChild(hitArea);
  };

  /**
   * Affiche le tooltip avec plusieurs lignes de texte.
   * Chaque ligne est un <tspan> distinct dans l'élément <text>.
   *
   * @private
   * @param {number} x - Position X (espace SVG)
   * @param {number} y - Position Y (espace SVG)
   * @param {Array<string>} lines - Lignes de texte
   */
  proto._showTooltipLines = function (x, y, lines) {
    var text = this.tooltip.querySelector(".tooltip-text");
    var bg = this.tooltip.querySelector(".tooltip-bg");
    var svgNS = this.svgNS;

    // Suppression des anciens <tspan>
    while (text.firstChild) text.removeChild(text.firstChild);

    // Création d'un <tspan> par ligne
    lines.forEach(function (line, i) {
      var tspan = document.createElementNS(svgNS, "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? 0 : 14);
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    text.setAttribute("x", x);
    text.setAttribute("y", y - 30);

    // Dimensionnement du fond (estimation statique)
    var textBBox = { width: 140, height: lines.length * 14 + 8 };
    bg.setAttribute("x", x - textBBox.width / 2 - 5);
    bg.setAttribute("y", y - 35 - textBBox.height / 2);
    bg.setAttribute("width", textBBox.width + 10);
    bg.setAttribute("height", textBBox.height + 4);

    this.tooltip.setAttribute("visibility", "visible");
  };

  /**
   * Affiche le tooltip standard d'un engrenage (label, dents, module, diamètre).
   *
   * @private
   * @param {number} x - Position X
   * @param {number} y - Position Y
   * @param {string} label - Label de l'engrenage
   * @param {number} nbDents - Nombre de dents
   * @param {number} mod - Module métrique
   * @param {number} rayonPrimitive - Rayon du cercle primitif
   */
  proto._showTooltip = function (x, y, label, nbDents, mod, rayonPrimitive) {
    var text = this.tooltip.querySelector(".tooltip-text");
    var bg = this.tooltip.querySelector(".tooltip-bg");
    var svgNS = this.svgNS;

    var lines = [
      label + " - " + nbDents + " dents",
      "Module: " + mod,
      "\u00d8 primitif: " + (rayonPrimitive * 2).toFixed(1) + " mm"
    ];

    // Suppression des anciens <tspan>
    while (text.firstChild) text.removeChild(text.firstChild);

    lines.forEach(function (line, i) {
      var tspan = document.createElementNS(svgNS, "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? 0 : 14);
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    text.setAttribute("x", x);
    text.setAttribute("y", y - 30);

    var textBBox = { width: 120, height: lines.length * 14 + 8 };
    bg.setAttribute("x", x - textBBox.width / 2 - 5);
    bg.setAttribute("y", y - 35 - textBBox.height / 2);
    bg.setAttribute("width", textBBox.width + 10);
    bg.setAttribute("height", textBBox.height + 4);

    this.tooltip.setAttribute("visibility", "visible");
  };

  /**
   * Masque le tooltip.
   * @private
   */
  proto._hideTooltip = function () {
    this.tooltip.setAttribute("visibility", "hidden");
  };

})();
