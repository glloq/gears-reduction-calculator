/**
 * @module GearSVG
 * @description Noyau de la visualisation SVG interactive des engrenages.
 *
 * Ce module définit la classe GearSVG avec :
 *   - Le constructeur et l'initialisation du SVG ({@link GearSVG#_initSVG})
 *   - L'orchestrateur de dessin du train complet ({@link GearSVG#drawGearTrain})
 *   - Le nettoyage ({@link GearSVG#clear})
 *   - L'export SVG et PNG ({@link GearSVG#exportSVG}, {@link GearSVG#exportPNG})
 *
 * Les fonctionnalités sont réparties en sous-modules (mixins) qui ajoutent
 * des méthodes au prototype après le chargement de ce fichier :
 *   - {@link module:visualization/GearDrawer} — dessin individuel par type
 *   - {@link module:visualization/SVGInteraction} — zoom, pan, tooltips
 *   - {@link module:visualization/AnimationEngine} — animation de rotation
 *
 * Ordre de chargement requis :
 *   1. GearSVG.js (ce fichier — définit la classe)
 *   2. GearDrawer.js (ajoute les méthodes de dessin)
 *   3. SVGInteraction.js (ajoute zoom/pan/tooltips)
 *   4. AnimationEngine.js (ajoute l'animation)
 *
 * @see {@link GearApp.visualization.GearSVG} pour le proxy dans le namespace
 */
(function () {

  var SVG_CFG = GearApp.config.SVG;

  // ===== Constructeur =====

  /**
   * @class GearSVG
   * @classdesc Classe de visualisation SVG interactive pour les trains d'engrenages.
   *
   * Crée un élément SVG dans un conteneur HTML, y dessine des engrenages avec
   * profils en développante de cercle, et gère les interactions utilisateur
   * (zoom, pan, tooltips, animation).
   *
   * @param {string} containerId - L'identifiant du conteneur HTML
   */
  function GearSVG(containerId) {
    /** @type {HTMLElement} Conteneur DOM parent du SVG */
    this.container = document.getElementById(containerId);

    /** @type {string} Espace de noms SVG pour la création d'éléments */
    this.svgNS = "http://www.w3.org/2000/svg";

    /** @type {SVGSVGElement|null} L'élément SVG racine */
    this.svg = null;

    /**
     * @type {{x: number, y: number, w: number, h: number}}
     * Boîte de vue SVG courante (contrôle le zoom et le pan)
     */
    this.viewBox = {
      x: SVG_CFG.VIEWBOX.X,
      y: SVG_CFG.VIEWBOX.Y,
      w: SVG_CFG.VIEWBOX.W,
      h: SVG_CFG.VIEWBOX.H
    };

    /** @type {boolean} Indique si un pan (déplacement) est en cours */
    this.isPanning = false;

    /** @type {{x: number, y: number}} Position de début du pan (coordonnées écran) */
    this.panStart = { x: 0, y: 0 };

    /** @type {number} Facteur d'échelle courant du zoom (1 = pas de zoom) */
    this.scale = 1;

    /** @type {number|null} Identifiant de la frame d'animation (requestAnimationFrame) */
    this.animationId = null;

    /** @type {number} Angle courant de l'animation (radians, engrenage d'entrée) */
    this.animationAngle = 0;

    /** @type {Array<SVGElement>} Éléments SVG des engrenages (usage interne) */
    this.gearElements = [];

    /**
     * @type {Array<{group: SVGElement, cx: number, cy: number, nbDents: number, typeId: string, rotation: number}>}
     * Données de chaque engrenage dessiné, pour l'animation et le calcul du viewBox
     */
    this.gearData = [];

    /** @type {boolean} Indique si l'animation de rotation est en cours */
    this.isAnimating = false;

    this._initSVG();
  }

  // ===== Initialisation du SVG =====

  /**
   * Initialise l'élément SVG, les defs (filtres, gradients), le groupe principal,
   * le tooltip et les gestionnaires d'événements.
   * @private
   */
  GearSVG.prototype._initSVG = function () {
    // Si un SVG existe déjà, le retirer avant de recréer
    if (this.svg) this.container.removeChild(this.svg);

    // --- Création de l'élément SVG racine ---
    this.svg = document.createElementNS(this.svgNS, "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", String(SVG_CFG.HEIGHT));
    this.svg.setAttribute("viewBox",
      this.viewBox.x + " " + this.viewBox.y + " " + this.viewBox.w + " " + this.viewBox.h
    );
    this.svg.style.border = "1px solid #ccc";
    this.svg.style.background = "#fafafa";
    this.svg.style.cursor = "grab";
    this.svg.style.borderRadius = "8px";

    // --- Section <defs> : filtres SVG et gradients réutilisables ---
    var defs = document.createElementNS(this.svgNS, "defs");

    // Filtre d'ombre portée (feOffset + feGaussianBlur + feComposite)
    var filter = document.createElementNS(this.svgNS, "filter");
    filter.setAttribute("id", "gearShadow");
    var feOffset = document.createElementNS(this.svgNS, "feOffset");
    feOffset.setAttribute("dx", String(SVG_CFG.SHADOW.DX));
    feOffset.setAttribute("dy", String(SVG_CFG.SHADOW.DY));
    var feBlur = document.createElementNS(this.svgNS, "feGaussianBlur");
    feBlur.setAttribute("stdDeviation", String(SVG_CFG.SHADOW.BLUR));
    var feComposite = document.createElementNS(this.svgNS, "feComposite");
    feComposite.setAttribute("in", "SourceGraphic");
    filter.appendChild(feOffset);
    filter.appendChild(feBlur);
    filter.appendChild(feComposite);
    defs.appendChild(filter);

    // Gradient radial métallique (centre clair → bord foncé)
    var grad = document.createElementNS(this.svgNS, "radialGradient");
    grad.setAttribute("id", "gearGradient");
    var stop1 = document.createElementNS(this.svgNS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", SVG_CFG.GRADIENT.CENTER);
    var stop2 = document.createElementNS(this.svgNS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", SVG_CFG.GRADIENT.EDGE);
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    this.svg.appendChild(defs);

    // --- Groupe principal <g> : contient tous les engrenages ---
    this.mainGroup = document.createElementNS(this.svgNS, "g");
    this.mainGroup.setAttribute("id", "mainGroup");
    this.svg.appendChild(this.mainGroup);

    // --- Tooltip : groupe SVG superposé (reste au premier plan) ---
    this.tooltip = document.createElementNS(this.svgNS, "g");
    this.tooltip.setAttribute("visibility", "hidden");
    this.tooltip.style.pointerEvents = "none";
    var tooltipBg = document.createElementNS(this.svgNS, "rect");
    tooltipBg.setAttribute("rx", "4");
    tooltipBg.setAttribute("ry", "4");
    tooltipBg.setAttribute("fill", "rgba(0,0,0,0.85)");
    tooltipBg.setAttribute("class", "tooltip-bg");
    this.tooltip.appendChild(tooltipBg);
    var tooltipText = document.createElementNS(this.svgNS, "text");
    tooltipText.setAttribute("fill", "white");
    tooltipText.setAttribute("font-size", "11");
    tooltipText.setAttribute("font-family", "Arial");
    tooltipText.setAttribute("class", "tooltip-text");
    this.tooltip.appendChild(tooltipText);
    this.svg.appendChild(this.tooltip);

    this.container.appendChild(this.svg);

    // Configuration des événements (défini dans SVGInteraction.js)
    this._setupEvents();
  };

  // ===== Dessin du train complet (multi-types) =====

  /**
   * Dessine un train de transmission complet, supportant différents types par étage.
   *
   * Parcourt chaque étage de la solution et délègue le dessin aux méthodes
   * spécialisées du mixin GearDrawer :
   *   - 'spur' / 'helical' : paire d'engrenages droits/hélicoïdaux
   *   - 'internal' : engrenage intérieur couronne + pignon
   *   - 'bevel' : engrenages coniques à 90°
   *   - 'belt' : transmission par courroie et poulie
   *   - 'epicyclic' : train épicycloïdal
   *   - 'worm' : vis sans fin
   *
   * Après le dessin, des labels "ENTREE" et "SORTIE" sont ajoutés,
   * et le viewBox est ajusté pour cadrer l'ensemble.
   *
   * @param {Array<Array<number|string>>} solution - Tableau d'étages [A, B, typeId?]
   * @param {number} mod - Module métrique (par défaut 2)
   * @param {number} angleContact - Angle de pression en degrés (par défaut 20)
   */
  GearSVG.prototype.drawGearTrain = function (solution, mod, angleContact) {
    this.clear();
    this.gearData = [];

    mod = mod || 2;
    angleContact = angleContact || 20;

    var letters = GearApp.config.GEAR_LETTERS;
    var cx = SVG_CFG.TRAIN_START.X;
    var cy = SVG_CFG.TRAIN_START.Y;
    var gearIndex = 0;
    var prevRotation = 0;

    for (var i = 0; i < solution.length; i++) {
      var A = solution[i][0];
      var B = solution[i][1];
      var typeId = solution[i][2] || 'spur';
      var type = getTransmissionType(typeId);
      var color = type.couleur;

      // Labels pour les engrenages de cet étage
      var labelA = letters[gearIndex] + ": " + A + " " + type.uniteA;
      var labelB = letters[gearIndex + 1] + ": " + B + " " + type.uniteB;
      var stageLabel = type.icone + " " + letters[gearIndex] + letters[gearIndex + 1];

      // Rotations initiales
      var rotA = prevRotation;
      var rotB = -rotA * (A / B);

      var stageGroup, maxR, stageCx2;

      // --- Dessin selon le type de transmission ---
      // Les méthodes de dessin sont définies dans GearDrawer.js (mixin)

      if (typeId === 'belt') {
        var result = this.drawBeltPulley(cx, cy, A, B, mod, 0, stageLabel, color);
        stageGroup = result.group;
        var entraxeBelt = result.entraxe;
        stageCx2 = cx + entraxeBelt;
        maxR = Math.max(A, B) / 2;
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: A, typeId: typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: stageCx2, cy: cy, nbDents: B, typeId: typeId, rotation: 0 });

      } else if (typeId === 'worm') {
        stageGroup = this.drawWormGear(cx, cy, A, B, mod, 0, stageLabel, color);
        var rRoue = (mod * B) / 2;
        stageCx2 = cx;
        maxR = rRoue + mod * A * 3;
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: A, typeId: typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: B, typeId: typeId, rotation: 0 });

      } else if (typeId === 'epicyclic') {
        stageGroup = this.drawEpicyclicGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = (mod * B) / 2 + mod * 2;
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: A, typeId: typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: B, typeId: typeId, rotation: 0 });

      } else if (typeId === 'bevel') {
        stageGroup = this.drawBevelGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = Math.max((mod * A) / 2, (mod * B) / 2) + mod;
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: A, typeId: typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: B, typeId: typeId, rotation: 0 });

      } else if (typeId === 'internal') {
        stageGroup = this.drawInternalGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = (mod * B) / 2 + mod * 3;
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: A, typeId: typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: cx, cy: cy, nbDents: B, typeId: typeId, rotation: 0 });

      } else {
        // Engrenage droit (spur) ou hélicoïdal (helical)
        var rA = (mod * A) / 2;
        var rB = (mod * B) / 2;
        var entraxeSH = rA + rB;

        var gearAGroup = this.drawGear(cx, cy, A, mod, angleContact, rotA, labelA, color);
        this.gearData.push({ group: gearAGroup, cx: cx, cy: cy, nbDents: A, typeId: typeId, rotation: rotA });

        var gearBCx = cx + entraxeSH;
        var gearBGroup = this.drawGear(gearBCx, cy, B, mod, angleContact, rotB, labelB, color);
        this.gearData.push({ group: gearBGroup, cx: gearBCx, cy: cy, nbDents: B, typeId: typeId, rotation: rotB });

        // Ligne de cote
        this._drawDimensionLine(cx, cy + rA + 10, gearBCx, cy + rA + 10, entraxeSH.toFixed(1) + " mm");

        stageCx2 = gearBCx;
        maxR = Math.max(rA, rB);

        // Label supplémentaire pour les hélicoïdaux
        if (typeId === 'helical') {
          var helLabel = document.createElementNS(this.svgNS, "text");
          helLabel.setAttribute("x", String((cx + gearBCx) / 2));
          helLabel.setAttribute("y", String(cy - maxR - mod * 3));
          helLabel.setAttribute("text-anchor", "middle");
          helLabel.setAttribute("font-size", "7");
          helLabel.setAttribute("fill", "#888");
          helLabel.textContent = "H\u00e9lico\u00efdal";
          this.mainGroup.appendChild(helLabel);
        }
      }

      // Badge de type au-dessus de l'étage
      var typeBadge = document.createElementNS(this.svgNS, "text");
      typeBadge.setAttribute("x", String((cx + (stageCx2 || cx)) / 2));
      typeBadge.setAttribute("y", String(cy - (maxR || 30) - mod * 5));
      typeBadge.setAttribute("text-anchor", "middle");
      typeBadge.setAttribute("font-size", "6");
      typeBadge.setAttribute("fill", "#aaa");
      typeBadge.textContent = "\u2500 " + type.nomCourt + " \u2500";
      this.mainGroup.appendChild(typeBadge);

      // --- Avancement horizontal pour l'étage suivant ---
      if (i < solution.length - 1) {
        if (typeId === 'belt') {
          cx = stageCx2 + 20;
        } else if (typeId === 'worm' || typeId === 'bevel') {
          cx += (maxR || 50) + 40;
        } else if (typeId === 'epicyclic' || typeId === 'internal') {
          cx += (maxR || 50) * 2 + 20;
        } else {
          cx = stageCx2;
        }
        prevRotation = rotB;
      }

      gearIndex += 2;
    }

    // --- Labels ENTREE / SORTIE ---
    var firstData = this.gearData[0];
    var lastData = this.gearData[this.gearData.length - 1];
    if (firstData && lastData) {
      var firstR = (mod * firstData.nbDents) / 2;
      var lastR = (mod * lastData.nbDents) / 2;
      this._drawIOLabel(firstData.cx, firstData.cy + Math.max(firstR, 30) + 25, "ENTR\u00c9E", SVG_CFG.IO_COLORS.ENTREE);
      this._drawIOLabel(lastData.cx, lastData.cy + Math.max(lastR, 30) + 25, "SORTIE", SVG_CFG.IO_COLORS.SORTIE);
    }

    // Cadrage automatique
    this._fitViewBox();

    // Sauvegarde pour l'animation et le redessin
    this._currentSolution = solution;
    this._currentMod = mod;
    this._currentAngleContact = angleContact;
  };

  // ===== Nettoyage =====

  /**
   * Efface tous les éléments du SVG et réinitialise les données.
   * Arrête l'animation si elle est en cours.
   */
  GearSVG.prototype.clear = function () {
    this.stopAnimation();
    while (this.mainGroup.firstChild) {
      this.mainGroup.removeChild(this.mainGroup.firstChild);
    }
    this.gearData = [];
    this.gearElements = [];
  };

  // ===== Export =====

  /**
   * Exporte le contenu SVG en tant que chaîne XML sérialisée.
   * @returns {string} Le SVG sérialisé en chaîne XML complète
   */
  GearSVG.prototype.exportSVG = function () {
    var serializer = new XMLSerializer();
    return serializer.serializeToString(this.svg);
  };

  /**
   * Exporte le SVG en image PNG via un canvas temporaire.
   *
   * Processus :
   *   1. Sérialise le SVG en XML
   *   2. Crée un Blob SVG et une URL d'objet
   *   3. Charge l'image SVG dans un élément Image
   *   4. Dessine sur un canvas avec mise à l'échelle
   *   5. Convertit le canvas en Blob PNG
   *
   * @param {function(Blob): void} callback - Fonction appelée avec le Blob PNG
   * @param {number} [scale] - Facteur de mise à l'échelle (défaut: config EXPORT_SCALE)
   */
  GearSVG.prototype.exportPNG = function (callback, scale) {
    scale = scale || SVG_CFG.EXPORT_SCALE;
    var self = this;
    var svgData = this.exportSVG();
    var svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(svgBlob);
    var img = new Image();

    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = self.svg.clientWidth * scale;
      canvas.height = self.svg.clientHeight * scale;
      var canvasCtx = canvas.getContext("2d");
      canvasCtx.scale(scale, scale);
      canvasCtx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob(function (blob) {
        if (callback) callback(blob);
      }, "image/png");
    };

    img.src = url;
  };

  // ===== Exposition globale =====

  // Exposition sur window pour compatibilité avec le chargement par balises <script>
  window.GearSVG = GearSVG;

})();
