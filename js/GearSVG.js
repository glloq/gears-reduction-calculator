// GearSVG.js - Module de visualisation SVG interactive des engrenages
// Dessine des engrenages avec profils de dents en développante de cercle
// Supporte zoom, pan, tooltips, animation et export

class GearSVG {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.svgNS = "http://www.w3.org/2000/svg";
    this.svg = null;
    this.viewBox = { x: 0, y: 0, w: 800, h: 400 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.scale = 1;
    this.animationId = null;
    this.animationAngle = 0;
    this.gearElements = [];
    this.gearData = [];
    this.isAnimating = false;

    this._initSVG();
  }

  _initSVG() {
    if (this.svg) this.container.removeChild(this.svg);

    this.svg = document.createElementNS(this.svgNS, "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "400");
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
    this.svg.style.border = "1px solid #ccc";
    this.svg.style.background = "#fafafa";
    this.svg.style.cursor = "grab";
    this.svg.style.borderRadius = "8px";

    // Defs pour les filtres et gradients
    const defs = document.createElementNS(this.svgNS, "defs");

    // Ombre portée
    const filter = document.createElementNS(this.svgNS, "filter");
    filter.setAttribute("id", "gearShadow");
    const feOffset = document.createElementNS(this.svgNS, "feOffset");
    feOffset.setAttribute("dx", "1");
    feOffset.setAttribute("dy", "1");
    const feBlur = document.createElementNS(this.svgNS, "feGaussianBlur");
    feBlur.setAttribute("stdDeviation", "2");
    const feComposite = document.createElementNS(this.svgNS, "feComposite");
    feComposite.setAttribute("in", "SourceGraphic");
    filter.appendChild(feOffset);
    filter.appendChild(feBlur);
    filter.appendChild(feComposite);
    defs.appendChild(filter);

    // Gradient pour les engrenages
    const grad = document.createElementNS(this.svgNS, "radialGradient");
    grad.setAttribute("id", "gearGradient");
    const stop1 = document.createElementNS(this.svgNS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", "#e8e8e8");
    const stop2 = document.createElementNS(this.svgNS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", "#b0b0b0");
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    this.svg.appendChild(defs);

    // Groupe principal pour le pan/zoom
    this.mainGroup = document.createElementNS(this.svgNS, "g");
    this.mainGroup.setAttribute("id", "mainGroup");
    this.svg.appendChild(this.mainGroup);

    // Tooltip
    this.tooltip = document.createElementNS(this.svgNS, "g");
    this.tooltip.setAttribute("visibility", "hidden");
    this.tooltip.style.pointerEvents = "none";
    const tooltipBg = document.createElementNS(this.svgNS, "rect");
    tooltipBg.setAttribute("rx", "4");
    tooltipBg.setAttribute("ry", "4");
    tooltipBg.setAttribute("fill", "rgba(0,0,0,0.85)");
    tooltipBg.setAttribute("class", "tooltip-bg");
    this.tooltip.appendChild(tooltipBg);
    const tooltipText = document.createElementNS(this.svgNS, "text");
    tooltipText.setAttribute("fill", "white");
    tooltipText.setAttribute("font-size", "11");
    tooltipText.setAttribute("font-family", "Arial");
    tooltipText.setAttribute("class", "tooltip-text");
    this.tooltip.appendChild(tooltipText);
    this.svg.appendChild(this.tooltip);

    this.container.appendChild(this.svg);

    this._setupEvents();
  }

  _setupEvents() {
    // Zoom avec la molette
    this.svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      this.viewBox.w *= zoomFactor;
      this.viewBox.h *= zoomFactor;
      this.scale *= zoomFactor;
      this._updateViewBox();
    });

    // Pan avec le clic
    this.svg.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.svg.style.cursor = "grabbing";
      }
    });

    this.svg.addEventListener("mousemove", (e) => {
      if (this.isPanning) {
        const dx = (e.clientX - this.panStart.x) * (this.viewBox.w / this.svg.clientWidth);
        const dy = (e.clientY - this.panStart.y) * (this.viewBox.h / this.svg.clientHeight);
        this.viewBox.x -= dx;
        this.viewBox.y -= dy;
        this.panStart = { x: e.clientX, y: e.clientY };
        this._updateViewBox();
      }
    });

    this.svg.addEventListener("mouseup", () => {
      this.isPanning = false;
      this.svg.style.cursor = "grab";
    });

    this.svg.addEventListener("mouseleave", () => {
      this.isPanning = false;
      this.svg.style.cursor = "grab";
    });
  }

  _updateViewBox() {
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  /**
   * Dessine un engrenage complet avec profil de dents en développante.
   * @param {number} cx - Centre X
   * @param {number} cy - Centre Y
   * @param {number} nbDents - Nombre de dents
   * @param {number} mod - Module
   * @param {number} angleContact - Angle de pression (degrés)
   * @param {number} rotation - Angle de rotation initial (radians)
   * @param {string} label - Label de l'engrenage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGElement} Le groupe SVG de l'engrenage
   */
  drawGear(cx, cy, nbDents, mod, angleContact, rotation, label, color) {
    const alpha = (angleContact || 20) * Math.PI / 180;
    const rayonPrimitive = (mod * nbDents) / 2;
    const rayonBase = rayonPrimitive * Math.cos(alpha);
    const rayonTete = rayonPrimitive + mod;
    const rayonPied = rayonPrimitive - 1.25 * mod;
    const rayonAlterationMin = Math.max(rayonBase, rayonPied);

    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${(rotation || 0) * 180 / Math.PI})`);

    // Cercle du pied (fond)
    const cercleBase = document.createElementNS(this.svgNS, "circle");
    cercleBase.setAttribute("r", rayonPied);
    cercleBase.setAttribute("fill", color || "url(#gearGradient)");
    cercleBase.setAttribute("stroke", "#666");
    cercleBase.setAttribute("stroke-width", "0.5");
    group.appendChild(cercleBase);

    // Profil des dents
    const toothPath = this._generateToothProfile(nbDents, rayonBase, rayonTete, rayonAlterationMin);
    const path = document.createElementNS(this.svgNS, "path");
    path.setAttribute("d", toothPath);
    path.setAttribute("fill", color || "url(#gearGradient)");
    path.setAttribute("stroke", "#444");
    path.setAttribute("stroke-width", "0.5");
    path.setAttribute("stroke-linejoin", "round");
    group.appendChild(path);

    // Cercle primitif (pointillé)
    const cerclePrimitive = document.createElementNS(this.svgNS, "circle");
    cerclePrimitive.setAttribute("r", rayonPrimitive);
    cerclePrimitive.setAttribute("fill", "none");
    cerclePrimitive.setAttribute("stroke", "#0066cc");
    cerclePrimitive.setAttribute("stroke-width", "0.3");
    cerclePrimitive.setAttribute("stroke-dasharray", "2,2");
    cerclePrimitive.setAttribute("opacity", "0.5");
    group.appendChild(cerclePrimitive);

    // Trou central (axe)
    const trou = document.createElementNS(this.svgNS, "circle");
    const rayonTrou = Math.max(mod * 1.5, rayonPied * 0.15);
    trou.setAttribute("r", rayonTrou);
    trou.setAttribute("fill", "#fafafa");
    trou.setAttribute("stroke", "#666");
    trou.setAttribute("stroke-width", "0.5");
    group.appendChild(trou);

    // Croix au centre
    const crossSize = rayonTrou * 0.6;
    const cross1 = document.createElementNS(this.svgNS, "line");
    cross1.setAttribute("x1", -crossSize); cross1.setAttribute("y1", 0);
    cross1.setAttribute("x2", crossSize); cross1.setAttribute("y2", 0);
    cross1.setAttribute("stroke", "#999"); cross1.setAttribute("stroke-width", "0.3");
    group.appendChild(cross1);
    const cross2 = document.createElementNS(this.svgNS, "line");
    cross2.setAttribute("x1", 0); cross2.setAttribute("y1", -crossSize);
    cross2.setAttribute("x2", 0); cross2.setAttribute("y2", crossSize);
    cross2.setAttribute("stroke", "#999"); cross2.setAttribute("stroke-width", "0.3");
    group.appendChild(cross2);

    // Label
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rayonTete - 5);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-family", "Arial");
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    // Counter-rotate text so it stays readable
    textElem.setAttribute("transform", `rotate(${-(rotation || 0) * 180 / Math.PI})`);
    textElem.textContent = label || "";
    group.appendChild(textElem);

    // Tooltip interactif au survol
    const hitArea = document.createElementNS(this.svgNS, "circle");
    hitArea.setAttribute("r", rayonTete);
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("cursor", "pointer");
    hitArea.addEventListener("mouseenter", (e) => this._showTooltip(cx, cy - rayonTete - 15, label, nbDents, mod, rayonPrimitive));
    hitArea.addEventListener("mouseleave", () => this._hideTooltip());
    group.appendChild(hitArea);

    this.mainGroup.appendChild(group);
    return group;
  }

  _generateToothProfile(nbDents, rayonBase, rayonTete, rayonPiedEffectif) {
    const points = [];
    const angularPitch = (2 * Math.PI) / nbDents;
    const halfToothAngle = angularPitch / 4;

    for (let i = 0; i < nbDents; i++) {
      const baseAngle = i * angularPitch;

      // Points de développante pour le flanc gauche
      const leftFlank = this._involutePoints(rayonBase, rayonTete, baseAngle - halfToothAngle, 1, 8);
      // Points de développante pour le flanc droit
      const rightFlank = this._involutePoints(rayonBase, rayonTete, baseAngle + halfToothAngle, -1, 8);

      // Sommet de la dent (arc entre les deux flancs)
      if (leftFlank.length > 0 && rightFlank.length > 0) {
        // Début du creux -> montée flanc gauche -> sommet -> descente flanc droit -> creux suivant
        const creux1Angle = baseAngle - angularPitch / 2;
        const creux1 = {
          x: rayonPiedEffectif * Math.cos(creux1Angle),
          y: rayonPiedEffectif * Math.sin(creux1Angle)
        };
        points.push(creux1);

        // Pied du flanc gauche
        const piedGaucheAngle = baseAngle - halfToothAngle;
        points.push({
          x: rayonPiedEffectif * Math.cos(piedGaucheAngle),
          y: rayonPiedEffectif * Math.sin(piedGaucheAngle)
        });

        // Flanc gauche (montée)
        points.push(...leftFlank);

        // Sommet
        const sommetAngle = baseAngle;
        points.push({
          x: rayonTete * Math.cos(sommetAngle),
          y: rayonTete * Math.sin(sommetAngle)
        });

        // Flanc droit (descente)
        points.push(...rightFlank.reverse());

        // Pied du flanc droit
        const piedDroitAngle = baseAngle + halfToothAngle;
        points.push({
          x: rayonPiedEffectif * Math.cos(piedDroitAngle),
          y: rayonPiedEffectif * Math.sin(piedDroitAngle)
        });
      }
    }

    if (points.length === 0) return "";

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    d += " Z";
    return d;
  }

  _involutePoints(rb, ra, baseAngle, direction, numPoints) {
    const pts = [];
    const tMax = Math.sqrt((ra / rb) ** 2 - 1);

    for (let i = 0; i <= numPoints; i++) {
      const t = (tMax * i) / numPoints;
      const r = rb * Math.sqrt(1 + t * t);
      if (r > ra) break;

      const invAngle = t - Math.atan(t);
      const angle = baseAngle + direction * invAngle;
      pts.push({
        x: r * Math.cos(angle),
        y: r * Math.sin(angle)
      });
    }
    return pts;
  }

  _showTooltip(x, y, label, nbDents, mod, rayonPrimitive) {
    const text = this.tooltip.querySelector(".tooltip-text");
    const bg = this.tooltip.querySelector(".tooltip-bg");

    const lines = [
      `${label} - ${nbDents} dents`,
      `Module: ${mod}`,
      `Ø primitif: ${(rayonPrimitive * 2).toFixed(1)} mm`
    ];

    // Remove old tspans
    while (text.firstChild) text.removeChild(text.firstChild);

    lines.forEach((line, i) => {
      const tspan = document.createElementNS(this.svgNS, "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? 0 : 14);
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    text.setAttribute("x", x);
    text.setAttribute("y", y - 30);

    const textBBox = { width: 120, height: lines.length * 14 + 8 };
    bg.setAttribute("x", x - textBBox.width / 2 - 5);
    bg.setAttribute("y", y - 35 - textBBox.height / 2);
    bg.setAttribute("width", textBBox.width + 10);
    bg.setAttribute("height", textBBox.height + 4);

    this.tooltip.setAttribute("visibility", "visible");
  }

  _hideTooltip() {
    this.tooltip.setAttribute("visibility", "hidden");
  }

  /**
   * Dessine un train d'engrenages complet à partir d'une solution.
   * @param {Array} solution - [[A1,B1], [A2,B2], ...]
   * @param {number} mod - Module des engrenages
   * @param {number} angleContact - Angle de pression
   */
  drawGearTrain(solution, mod, angleContact) {
    this.clear();
    this.gearData = [];

    mod = mod || 2;
    angleContact = angleContact || 20;

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const colors = ["#d4e6f1", "#d5f5e3", "#fdebd0", "#e8daef", "#fadbd8", "#d6eaf8"];

    let cx = 100;
    let cy = 200;
    let gearIndex = 0;
    let prevRotation = 0;

    for (let i = 0; i < solution.length; i++) {
      const [A, B] = solution[i];
      const rA = (mod * A) / 2;
      const rB = (mod * B) / 2;

      const labelA = `${letters[gearIndex]}: ${A}`;
      const labelB = `${letters[gearIndex + 1]}: ${B}`;

      // Rotation inverse pour engrenages engrenés
      const rotA = prevRotation;
      const rotB = -rotA * (A / B);

      // Dessiner le pignon (menante)
      const gearAGroup = this.drawGear(cx, cy, A, mod, angleContact, rotA, labelA, colors[i % colors.length]);
      this.gearData.push({ group: gearAGroup, cx, cy, nbDents: A, ratio: A / B, rotation: rotA });

      // Dessiner la roue (menée), positionnée à l'entraxe
      const entraxe = rA + rB;
      const gearBCx = cx + entraxe;

      const gearBGroup = this.drawGear(gearBCx, cy, B, mod, angleContact, rotB, labelB, colors[(i + 1) % colors.length]);
      this.gearData.push({ group: gearBGroup, cx: gearBCx, cy, nbDents: B, ratio: B / A, rotation: rotB });

      // Ligne d'entraxe (cotation)
      this._drawDimensionLine(cx, cy + rA + 10, gearBCx, cy + rA + 10, `${entraxe.toFixed(1)} mm`);

      // Pour l'étage suivant, on repart depuis l'engrenage menée
      // avec un décalage vertical pour le prochain étage coaxial
      if (i < solution.length - 1) {
        // Liaison coaxiale - la menée et la menante suivante partagent le même axe
        cx = gearBCx;
        cy += 0; // Même ligne
        prevRotation = rotB;
      }

      gearIndex += 2;
    }

    // Labels IN / OUT
    const firstGear = this.gearData[0];
    const lastGear = this.gearData[this.gearData.length - 1];

    this._drawIOLabel(firstGear.cx, firstGear.cy + (mod * solution[0][0]) / 2 + 25, "ENTRÉE", "#2ecc71");
    this._drawIOLabel(lastGear.cx, lastGear.cy + (mod * solution[solution.length - 1][1]) / 2 + 25, "SORTIE", "#e74c3c");

    // Ajuster le viewBox pour contenir tout le dessin
    this._fitViewBox();

    // Stocker la solution pour l'animation
    this._currentSolution = solution;
    this._currentMod = mod;
    this._currentAngleContact = angleContact;
  }

  _drawDimensionLine(x1, y1, x2, y2, label) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("class", "dimension");

    // Ligne principale
    const line = document.createElementNS(this.svgNS, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#888");
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("stroke-dasharray", "4,2");
    group.appendChild(line);

    // Flèches
    const arrowSize = 3;
    [{ x: x1, dir: 1 }, { x: x2, dir: -1 }].forEach(({ x, dir }) => {
      const arrow = document.createElementNS(this.svgNS, "polygon");
      arrow.setAttribute("points", `${x},${y1} ${x + dir * arrowSize},${y1 - arrowSize} ${x + dir * arrowSize},${y1 + arrowSize}`);
      arrow.setAttribute("fill", "#888");
      group.appendChild(arrow);
    });

    // Texte
    const text = document.createElementNS(this.svgNS, "text");
    text.setAttribute("x", (x1 + x2) / 2);
    text.setAttribute("y", y1 + 12);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "8");
    text.setAttribute("fill", "#666");
    text.textContent = label;
    group.appendChild(text);

    this.mainGroup.appendChild(group);
  }

  _drawIOLabel(cx, cy, text, color) {
    const group = document.createElementNS(this.svgNS, "g");

    const rect = document.createElementNS(this.svgNS, "rect");
    rect.setAttribute("x", cx - 30);
    rect.setAttribute("y", cy);
    rect.setAttribute("width", 60);
    rect.setAttribute("height", 22);
    rect.setAttribute("rx", 4);
    rect.setAttribute("fill", color);
    rect.setAttribute("opacity", "0.8");
    group.appendChild(rect);

    const label = document.createElementNS(this.svgNS, "text");
    label.setAttribute("x", cx);
    label.setAttribute("y", cy + 15);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-weight", "bold");
    label.setAttribute("fill", "white");
    label.textContent = text;
    group.appendChild(label);

    this.mainGroup.appendChild(group);
  }

  _fitViewBox() {
    if (this.gearData.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.gearData.forEach(g => {
      const r = (this._currentMod * g.nbDents) / 2 + this._currentMod * 2;
      minX = Math.min(minX, g.cx - r);
      minY = Math.min(minY, g.cy - r);
      maxX = Math.max(maxX, g.cx + r);
      maxY = Math.max(maxY, g.cy + r);
    });

    const padding = 60;
    this.viewBox = {
      x: minX - padding,
      y: minY - padding,
      w: maxX - minX + 2 * padding,
      h: maxY - minY + 2 * padding + 30
    };
    this._updateViewBox();
  }

  /**
   * Démarre/arrête l'animation de rotation des engrenages.
   */
  toggleAnimation() {
    if (this.isAnimating) {
      this.stopAnimation();
    } else {
      this.startAnimation();
    }
  }

  startAnimation() {
    if (!this._currentSolution || this.isAnimating) return;
    this.isAnimating = true;
    this.animationAngle = 0;
    this._animate();
  }

  stopAnimation() {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  _animate() {
    if (!this.isAnimating) return;

    this.animationAngle += 0.02;

    this.gearData.forEach((gear, index) => {
      // Calculer la rotation basée sur le rapport de transmission
      let totalRatio = 1;
      const pairIndex = Math.floor(index / 2);
      const isDriver = index % 2 === 0;

      // Calculer le rapport cumulé
      for (let i = 0; i <= pairIndex; i++) {
        if (i < this._currentSolution.length) {
          const [A, B] = this._currentSolution[i];
          if (i < pairIndex || !isDriver) {
            totalRatio *= B / A;
          }
        }
      }

      const sign = index % 2 === 0 ? 1 : -1;
      const speedFactor = isDriver ? (pairIndex === 0 ? 1 : 1 / totalRatio * this._currentSolution[pairIndex][1] / this._currentSolution[pairIndex][0]) : 1 / totalRatio;
      const angle = this.animationAngle * sign / (index === 0 ? 1 : totalRatio / (isDriver ? this._currentSolution[pairIndex][1] / this._currentSolution[pairIndex][0] : 1));

      const angleDeg = (angle * 180 / Math.PI) * (index % 2 === 0 ? 1 : -1);
      gear.group.setAttribute("transform", `translate(${gear.cx}, ${gear.cy}) rotate(${angleDeg})`);
    });

    this.animationId = requestAnimationFrame(() => this._animate());
  }

  /**
   * Efface le SVG.
   */
  clear() {
    this.stopAnimation();
    while (this.mainGroup.firstChild) {
      this.mainGroup.removeChild(this.mainGroup.firstChild);
    }
    this.gearData = [];
    this.gearElements = [];
  }

  /**
   * Exporte le SVG en tant que chaîne.
   */
  exportSVG() {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(this.svg);
  }

  /**
   * Exporte en PNG via un canvas temporaire.
   */
  exportPNG(callback, scale = 2) {
    const svgData = this.exportSVG();
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = this.svg.clientWidth * scale;
      canvas.height = this.svg.clientHeight * scale;
      const canvasCtx = canvas.getContext("2d");
      canvasCtx.scale(scale, scale);
      canvasCtx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (callback) callback(blob);
      }, "image/png");
    };

    img.src = url;
  }

  /**
   * Réinitialise le zoom et le pan.
   */
  resetView() {
    this._fitViewBox();
  }
}

window.GearSVG = GearSVG;
