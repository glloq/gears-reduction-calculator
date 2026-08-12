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

  _getTextColor() {
    return document.body.classList.contains('dark-theme') ? '#e0e0e0' : '#333';
  }

  _getStrokeColor() {
    return document.body.classList.contains('dark-theme') ? '#b0b0b0' : '#333';
  }

  _initSVG() {
    if (this.svg) this.container.removeChild(this.svg);

    this.svg = document.createElementNS(this.svgNS, "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "400");
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
    var isDark = document.body.classList.contains('dark-theme');
    this.svg.style.border = "1px solid " + (isDark ? "#333" : "#ccc");
    this.svg.style.background = isDark ? "#1a1a2e" : "#fafafa";
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
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
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
    textElem.setAttribute("fill", this._getTextColor());
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

  /**
   * Ajoute une zone de survol interactive avec tooltip sur un groupe SVG.
   */
  _addTooltipHitArea(group, cx, cy, rayon, tooltipLines) {
    const hitArea = document.createElementNS(this.svgNS, "circle");
    hitArea.setAttribute("r", rayon);
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("cursor", "pointer");
    hitArea.addEventListener("mouseenter", () => this._showTooltipLines(cx, cy - rayon - 15, tooltipLines));
    hitArea.addEventListener("mouseleave", () => this._hideTooltip());
    group.appendChild(hitArea);
  }

  _showTooltipLines(x, y, lines) {
    const text = this.tooltip.querySelector(".tooltip-text");
    const bg = this.tooltip.querySelector(".tooltip-bg");

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

    const textBBox = { width: 140, height: lines.length * 14 + 8 };
    bg.setAttribute("x", x - textBBox.width / 2 - 5);
    bg.setAttribute("y", y - 35 - textBBox.height / 2);
    bg.setAttribute("width", textBBox.width + 10);
    bg.setAttribute("height", textBBox.height + 4);

    this.tooltip.setAttribute("visibility", "visible");
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

  // ==================== DESSIN SPÉCIFIQUE PAR TYPE ====================

  /**
   * Dessine un engrenage intérieur (couronne + pignon interne).
   */
  drawInternalGear(cx, cy, nbDentsPignon, nbDentsCouronne, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${(rotation || 0) * 180 / Math.PI})`);

    const rCouronne = (mod * nbDentsCouronne) / 2;
    const rPignon = (mod * nbDentsPignon) / 2;

    // Couronne (anneau extérieur)
    const anneau = document.createElementNS(this.svgNS, "circle");
    anneau.setAttribute("r", rCouronne + mod * 2);
    anneau.setAttribute("fill", "none");
    anneau.setAttribute("stroke", "#666");
    anneau.setAttribute("stroke-width", mod * 0.8);
    group.appendChild(anneau);

    // Cercle intérieur de la couronne (dents internes)
    const interieur = document.createElementNS(this.svgNS, "circle");
    interieur.setAttribute("r", rCouronne);
    interieur.setAttribute("fill", "none");
    interieur.setAttribute("stroke", color || "#fdebd0");
    interieur.setAttribute("stroke-width", mod * 1.5);
    interieur.setAttribute("stroke-dasharray", `${mod * 1.2},${mod * 0.6}`);
    group.appendChild(interieur);

    // Pignon au centre (décalé)
    const entraxe = (rCouronne - rPignon);
    const pignonGroup = this.drawGear(0, 0, nbDentsPignon, mod, 20, 0, "", color);
    // Le pignon est déjà ajouté au mainGroup, on le retire pour le mettre dans notre groupe
    this.mainGroup.removeChild(pignonGroup);
    group.appendChild(pignonGroup);

    // Label
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rCouronne - mod * 4);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", this._getTextColor());
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif
    this._addTooltipHitArea(group, 0, 0, rCouronne + mod * 2, [
      `${label} - Engrenage intérieur`,
      `Pignon: ${nbDentsPignon} dents, Couronne: ${nbDentsCouronne} dents`,
      `Entraxe: ${entraxe.toFixed(1)} mm`,
      `Rapport: ${(nbDentsCouronne / nbDentsPignon).toFixed(3)}`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  }

  /**
   * Dessine une vis sans fin (vue schématique).
   */
  drawWormGear(cx, cy, nbFilets, nbDentsRoue, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rRoue = (mod * nbDentsRoue) / 2;
    const q = 10; // quotient de diamètre standard (cohérent avec TransmissionTypeRegistry)
    const diamVis = q * mod;
    const rVis = diamVis / 2;

    // Roue (cercle avec dents stylisées)
    const roue = document.createElementNS(this.svgNS, "circle");
    roue.setAttribute("r", rRoue);
    roue.setAttribute("fill", color || "#fcf3cf");
    roue.setAttribute("stroke", "#666");
    roue.setAttribute("stroke-width", "0.5");
    group.appendChild(roue);

    // Dents de la roue (simplifiées)
    for (let i = 0; i < nbDentsRoue; i++) {
      const angle = (2 * Math.PI * i) / nbDentsRoue;
      const x1 = rRoue * Math.cos(angle);
      const y1 = rRoue * Math.sin(angle);
      const x2 = (rRoue + mod) * Math.cos(angle);
      const y2 = (rRoue + mod) * Math.sin(angle);
      const tick = document.createElementNS(this.svgNS, "line");
      tick.setAttribute("x1", x1); tick.setAttribute("y1", y1);
      tick.setAttribute("x2", x2); tick.setAttribute("y2", y2);
      tick.setAttribute("stroke", "#888"); tick.setAttribute("stroke-width", "0.5");
      group.appendChild(tick);
    }

    // Vis sans fin (rectangle avec hélice, positionnée au-dessus)
    const visY = -rRoue - rVis - mod;
    const longueurVis = rRoue * 0.8;

    const visRect = document.createElementNS(this.svgNS, "rect");
    visRect.setAttribute("x", -longueurVis / 2);
    visRect.setAttribute("y", visY - rVis);
    visRect.setAttribute("width", longueurVis);
    visRect.setAttribute("height", rVis * 2);
    visRect.setAttribute("rx", rVis);
    visRect.setAttribute("fill", "#e0e0e0");
    visRect.setAttribute("stroke", "#666");
    visRect.setAttribute("stroke-width", "0.5");
    group.appendChild(visRect);

    // Filets de la vis (lignes en zigzag)
    const pas = longueurVis / (nbFilets * 3);
    let visPath = `M ${-longueurVis / 2} ${visY}`;
    for (let x = -longueurVis / 2; x < longueurVis / 2; x += pas) {
      visPath += ` L ${x + pas / 2} ${visY - rVis * 0.7} L ${x + pas} ${visY}`;
    }
    const filets = document.createElementNS(this.svgNS, "path");
    filets.setAttribute("d", visPath);
    filets.setAttribute("fill", "none");
    filets.setAttribute("stroke", "#444");
    filets.setAttribute("stroke-width", "0.8");
    group.appendChild(filets);

    // Axe de la vis
    const axeVis = document.createElementNS(this.svgNS, "line");
    axeVis.setAttribute("x1", -longueurVis); axeVis.setAttribute("y1", visY);
    axeVis.setAttribute("x2", longueurVis); axeVis.setAttribute("y2", visY);
    axeVis.setAttribute("stroke", "#999");
    axeVis.setAttribute("stroke-width", "0.3");
    axeVis.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeVis);

    // Indicateur axes 90°
    const angle90 = document.createElementNS(this.svgNS, "text");
    angle90.setAttribute("x", longueurVis * 0.7);
    angle90.setAttribute("y", visY + rVis + 8);
    angle90.setAttribute("font-size", "7");
    angle90.setAttribute("fill", "#999");
    angle90.textContent = "90\u00b0";
    group.appendChild(angle90);

    // Trou central roue
    const trou = document.createElementNS(this.svgNS, "circle");
    trou.setAttribute("r", rVis * 0.6);
    trou.setAttribute("fill", "#fafafa");
    trou.setAttribute("stroke", "#666");
    trou.setAttribute("stroke-width", "0.5");
    group.appendChild(trou);

    // Label
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", rRoue + mod * 3);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", this._getTextColor());
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif
    var angleAvance = Math.atan(nbFilets / 10) * 180 / Math.PI; // q=10
    this._addTooltipHitArea(group, 0, 0, rRoue + mod, [
      `${label} - Vis sans fin`,
      `Filets: ${nbFilets}, Dents roue: ${nbDentsRoue}`,
      `Rapport: ${(nbDentsRoue / nbFilets).toFixed(1)}:1`,
      `Angle avance: ${angleAvance.toFixed(1)}\u00b0`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  }

  /**
   * Dessine une transmission courroie-poulie.
   */
  drawBeltPulley(cx, cy, diamA, diamB, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rA = diamA / 2;
    const rB = diamB / 2;
    const entraxe = (diamA + diamB) * 1.5;

    // Poulie menante (gauche)
    const poulieA = document.createElementNS(this.svgNS, "circle");
    poulieA.setAttribute("cx", 0); poulieA.setAttribute("cy", 0);
    poulieA.setAttribute("r", rA);
    poulieA.setAttribute("fill", color || "#fadbd8");
    poulieA.setAttribute("stroke", "#666");
    poulieA.setAttribute("stroke-width", "0.5");
    group.appendChild(poulieA);

    // Gorge poulie A
    const gorgeA = document.createElementNS(this.svgNS, "circle");
    gorgeA.setAttribute("cx", 0); gorgeA.setAttribute("cy", 0);
    gorgeA.setAttribute("r", rA * 0.85);
    gorgeA.setAttribute("fill", "none");
    gorgeA.setAttribute("stroke", "#999");
    gorgeA.setAttribute("stroke-width", "0.3");
    gorgeA.setAttribute("stroke-dasharray", "1,2");
    group.appendChild(gorgeA);

    // Poulie menée (droite)
    const poulieB = document.createElementNS(this.svgNS, "circle");
    poulieB.setAttribute("cx", entraxe); poulieB.setAttribute("cy", 0);
    poulieB.setAttribute("r", rB);
    poulieB.setAttribute("fill", color || "#fadbd8");
    poulieB.setAttribute("stroke", "#666");
    poulieB.setAttribute("stroke-width", "0.5");
    group.appendChild(poulieB);

    // Gorge poulie B
    const gorgeB = document.createElementNS(this.svgNS, "circle");
    gorgeB.setAttribute("cx", entraxe); gorgeB.setAttribute("cy", 0);
    gorgeB.setAttribute("r", rB * 0.85);
    gorgeB.setAttribute("fill", "none");
    gorgeB.setAttribute("stroke", "#999");
    gorgeB.setAttribute("stroke-width", "0.3");
    gorgeB.setAttribute("stroke-dasharray", "1,2");
    group.appendChild(gorgeB);

    // Courroie (tangentes entre les deux cercles)
    const dy = rB - rA;
    const dist = entraxe;
    const sinA = dy / dist;
    const cosA = Math.sqrt(1 - sinA * sinA);

    // Brin supérieur
    const brinSup = document.createElementNS(this.svgNS, "line");
    brinSup.setAttribute("x1", rA * sinA);
    brinSup.setAttribute("y1", -rA * cosA);
    brinSup.setAttribute("x2", entraxe + rB * sinA);
    brinSup.setAttribute("y2", -rB * cosA);
    brinSup.setAttribute("stroke", this._getStrokeColor());
    brinSup.setAttribute("stroke-width", "1");
    group.appendChild(brinSup);

    // Brin inférieur
    const brinInf = document.createElementNS(this.svgNS, "line");
    brinInf.setAttribute("x1", -rA * sinA);
    brinInf.setAttribute("y1", rA * cosA);
    brinInf.setAttribute("x2", entraxe - rB * sinA);
    brinInf.setAttribute("y2", rB * cosA);
    brinInf.setAttribute("stroke", this._getStrokeColor());
    brinInf.setAttribute("stroke-width", "1");
    group.appendChild(brinInf);

    // Trous centraux
    [{ x: 0, r: rA }, { x: entraxe, r: rB }].forEach(p => {
      const trou = document.createElementNS(this.svgNS, "circle");
      trou.setAttribute("cx", p.x); trou.setAttribute("cy", 0);
      trou.setAttribute("r", Math.max(1, p.r * 0.15));
      trou.setAttribute("fill", "#fafafa");
      trou.setAttribute("stroke", "#666");
      trou.setAttribute("stroke-width", "0.3");
      group.appendChild(trou);
    });

    // Labels poulies
    const lblA = document.createElementNS(this.svgNS, "text");
    lblA.setAttribute("x", 0); lblA.setAttribute("y", rA + 10);
    lblA.setAttribute("text-anchor", "middle");
    lblA.setAttribute("font-size", Math.max(6, rA * 0.3));
    lblA.setAttribute("fill", this._getTextColor());
    lblA.textContent = `\u00d8${diamA}`;
    group.appendChild(lblA);

    const lblB = document.createElementNS(this.svgNS, "text");
    lblB.setAttribute("x", entraxe); lblB.setAttribute("y", rB + 10);
    lblB.setAttribute("text-anchor", "middle");
    lblB.setAttribute("font-size", Math.max(6, rB * 0.2));
    lblB.setAttribute("fill", this._getTextColor());
    lblB.textContent = `\u00d8${diamB}`;
    group.appendChild(lblB);

    // Label général
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", entraxe / 2);
    textElem.setAttribute("y", -Math.max(rA, rB) - 8);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", this._getTextColor());
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif (sur la plus grande poulie)
    const hitBelt = document.createElementNS(this.svgNS, "rect");
    hitBelt.setAttribute("x", -rA);
    hitBelt.setAttribute("y", -Math.max(rA, rB) - 5);
    hitBelt.setAttribute("width", entraxe + rA + rB);
    hitBelt.setAttribute("height", Math.max(rA, rB) * 2 + 10);
    hitBelt.setAttribute("fill", "transparent");
    hitBelt.setAttribute("cursor", "pointer");
    hitBelt.addEventListener("mouseenter", () => this._showTooltipLines(entraxe / 2, -Math.max(rA, rB) - 15, [
      `${label} - Courroie & Poulie`,
      `Poulie menante: \u00d8${diamA} mm`,
      `Poulie men\u00e9e: \u00d8${diamB} mm`,
      `Rapport: ${(diamB / diamA).toFixed(3)}`
    ]));
    hitBelt.addEventListener("mouseleave", () => this._hideTooltip());
    group.appendChild(hitBelt);

    this.mainGroup.appendChild(group);
    return { group, entraxe };
  }

  /**
   * Dessine un engrenage conique (vue schématique de côté).
   */
  drawBevelGear(cx, cy, nbDentsA, nbDentsB, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rA = (mod * nbDentsA) / 2;
    const rB = (mod * nbDentsB) / 2;

    // Cône pignon (horizontal, entrée à gauche)
    const pignon = document.createElementNS(this.svgNS, "polygon");
    pignon.setAttribute("points", `${-rA},${-rA} ${rA * 0.5},${-rA * 0.2} ${rA * 0.5},${rA * 0.2} ${-rA},${rA}`);
    pignon.setAttribute("fill", color || "#e8daef");
    pignon.setAttribute("stroke", "#666");
    pignon.setAttribute("stroke-width", "0.5");
    group.appendChild(pignon);

    // Cône roue (vertical, sortie en bas)
    const roue = document.createElementNS(this.svgNS, "polygon");
    roue.setAttribute("points", `${-rB * 0.2},${rB * 0.5} ${rB * 0.2},${rB * 0.5} ${rB},${rB + rA} ${-rB},${rB + rA}`);
    roue.setAttribute("fill", color || "#e8daef");
    roue.setAttribute("stroke", "#666");
    roue.setAttribute("stroke-width", "0.5");
    roue.setAttribute("opacity", "0.8");
    group.appendChild(roue);

    // Indicateur 90°
    const arc90 = document.createElementNS(this.svgNS, "path");
    const arcR = Math.min(rA, rB) * 0.4;
    arc90.setAttribute("d", `M ${arcR},0 A ${arcR},${arcR} 0 0,1 0,${arcR}`);
    arc90.setAttribute("fill", "none");
    arc90.setAttribute("stroke", "#999");
    arc90.setAttribute("stroke-width", "0.5");
    group.appendChild(arc90);

    const txt90 = document.createElementNS(this.svgNS, "text");
    txt90.setAttribute("x", arcR + 3); txt90.setAttribute("y", arcR + 3);
    txt90.setAttribute("font-size", "7"); txt90.setAttribute("fill", "#999");
    txt90.textContent = "90\u00b0";
    group.appendChild(txt90);

    // Axes
    const axeH = document.createElementNS(this.svgNS, "line");
    axeH.setAttribute("x1", -rA * 1.5); axeH.setAttribute("y1", 0);
    axeH.setAttribute("x2", rA); axeH.setAttribute("y2", 0);
    axeH.setAttribute("stroke", "#bbb"); axeH.setAttribute("stroke-width", "0.3");
    axeH.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeH);

    const axeV = document.createElementNS(this.svgNS, "line");
    axeV.setAttribute("x1", 0); axeV.setAttribute("y1", rB * 0.3);
    axeV.setAttribute("x2", 0); axeV.setAttribute("y2", rB + rA + rB * 0.3);
    axeV.setAttribute("stroke", "#bbb"); axeV.setAttribute("stroke-width", "0.3");
    axeV.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeV);

    // Label
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rA - 8);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", this._getTextColor());
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif
    this._addTooltipHitArea(group, 0, 0, Math.max(rA, rB) + mod, [
      `${label} - Engrenage conique`,
      `Pignon: ${nbDentsA} dents, Roue: ${nbDentsB} dents`,
      `Rapport: ${(nbDentsB / nbDentsA).toFixed(3)}`,
      `Axes \u00e0 90\u00b0`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  }

  /**
   * Dessine un train épicycloïdal schématique.
   */
  drawEpicyclicGear(cx, cy, dentsSolaire, dentsCouronne, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rSolaire = (mod * dentsSolaire) / 2;
    const rCouronne = (mod * dentsCouronne) / 2;
    const dentsSatellite = (dentsCouronne - dentsSolaire) / 2;
    const rSatellite = (mod * dentsSatellite) / 2;
    const rOrbiteSat = rSolaire + rSatellite;

    // Couronne extérieure (anneau)
    const couronne = document.createElementNS(this.svgNS, "circle");
    couronne.setAttribute("r", rCouronne + mod);
    couronne.setAttribute("fill", "none");
    couronne.setAttribute("stroke", "#555");
    couronne.setAttribute("stroke-width", mod * 1.5);
    group.appendChild(couronne);

    // Denture intérieure de la couronne
    const couronneInt = document.createElementNS(this.svgNS, "circle");
    couronneInt.setAttribute("r", rCouronne);
    couronneInt.setAttribute("fill", "none");
    couronneInt.setAttribute("stroke", "#999");
    couronneInt.setAttribute("stroke-width", mod * 0.5);
    couronneInt.setAttribute("stroke-dasharray", `${mod * 0.8},${mod * 0.5}`);
    group.appendChild(couronneInt);

    // Solaire au centre
    const solaireGroup = this.drawGear(0, 0, dentsSolaire, mod, 20, 0, "", color || "#d6eaf8");
    this.mainGroup.removeChild(solaireGroup);
    group.appendChild(solaireGroup);

    // Satellites (3 par défaut)
    const nbSat = 3;
    for (let s = 0; s < nbSat; s++) {
      const angle = (2 * Math.PI * s) / nbSat;
      const satX = rOrbiteSat * Math.cos(angle);
      const satY = rOrbiteSat * Math.sin(angle);

      const satGroup = this.drawGear(satX, satY, Math.max(6, Math.round(dentsSatellite)), mod * 0.9, 20, 0, "", "#fef9e7");
      this.mainGroup.removeChild(satGroup);
      group.appendChild(satGroup);
    }

    // Porte-satellites (cercle pointillé)
    const porteSat = document.createElementNS(this.svgNS, "circle");
    porteSat.setAttribute("r", rOrbiteSat);
    porteSat.setAttribute("fill", "none");
    porteSat.setAttribute("stroke", "#aaa");
    porteSat.setAttribute("stroke-width", "0.5");
    porteSat.setAttribute("stroke-dasharray", "4,3");
    group.appendChild(porteSat);

    // Label
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rCouronne - mod * 3);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", this._getTextColor());
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif
    this._addTooltipHitArea(group, 0, 0, rCouronne + mod, [
      `${label} - Train \u00e9picyclo\u00efdal`,
      `Solaire: ${dentsSolaire} dents, Couronne: ${dentsCouronne} dents`,
      `Satellite: ${Math.round(dentsSatellite)} dents`,
      `Rapport: ${(1 + dentsCouronne / dentsSolaire).toFixed(3)}`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  }

  // ==================== DESSIN DU TRAIN COMPLET (multi-types) ====================

  /**
   * Dessine un train de transmission complet, supportant différents types par étage.
   * @param {Array} solution - [[A1,B1,type?], [A2,B2,type?], ...]
   * @param {number} mod - Module des engrenages
   * @param {number} angleContact - Angle de pression
   */
  drawGearTrain(solution, mod, angleContact) {
    this.clear();
    this.gearData = [];

    mod = mod || 2;
    angleContact = angleContact || 20;

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let cx = 100;
    let cy = 200;
    let gearIndex = 0;
    let prevRotation = 0;

    for (let i = 0; i < solution.length; i++) {
      const A = solution[i][0];
      const B = solution[i][1];
      const typeId = solution[i][2] || 'spur';
      const type = getTransmissionType(typeId);
      const color = type.couleur;

      const labelA = `${letters[gearIndex]}: ${A} ${type.uniteA}`;
      const labelB = `${letters[gearIndex + 1]}: ${B} ${type.uniteB}`;
      const stageLabel = `${type.icone} ${letters[gearIndex]}${letters[gearIndex + 1]}`;

      const rotA = prevRotation;
      const rotB = -rotA * (A / B);

      let stageGroup, maxR, stageCx2;

      if (typeId === 'belt') {
        // Courroie et poulie
        const result = this.drawBeltPulley(cx, cy, A, B, mod, 0, stageLabel, color);
        stageGroup = result.group;
        const entraxe = result.entraxe;
        stageCx2 = cx + entraxe;
        maxR = Math.max(A, B) / 2;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: stageCx2, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'worm') {
        // Vis sans fin
        stageGroup = this.drawWormGear(cx, cy, A, B, mod, 0, stageLabel, color);
        const rRoue = (mod * B) / 2;
        stageCx2 = cx;
        maxR = rRoue + mod * A * 3;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'epicyclic') {
        // Train épicycloïdal
        stageGroup = this.drawEpicyclicGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx; // Coaxial
        maxR = (mod * B) / 2 + mod * 2;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'bevel') {
        // Engrenage conique
        stageGroup = this.drawBevelGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = Math.max((mod * A) / 2, (mod * B) / 2) + mod;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'internal') {
        // Engrenage intérieur
        stageGroup = this.drawInternalGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = (mod * B) / 2 + mod * 3;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else {
        // Engrenage droit ou hélicoïdal (même rendu visuel)
        const rA = (mod * A) / 2;
        const rB = (mod * B) / 2;
        const entraxe = rA + rB;

        const gearAGroup = this.drawGear(cx, cy, A, mod, angleContact, rotA, labelA, color);
        this.gearData.push({ group: gearAGroup, cx, cy, nbDents: A, typeId, rotation: rotA });

        const gearBCx = cx + entraxe;
        const gearBGroup = this.drawGear(gearBCx, cy, B, mod, angleContact, rotB, labelB, color);
        this.gearData.push({ group: gearBGroup, cx: gearBCx, cy, nbDents: B, typeId, rotation: rotB });

        this._drawDimensionLine(cx, cy + rA + 10, gearBCx, cy + rA + 10, `${entraxe.toFixed(1)} mm`);

        stageCx2 = gearBCx;
        maxR = Math.max(rA, rB);

        // Label hélicoïdal
        if (typeId === 'helical') {
          const helLabel = document.createElementNS(this.svgNS, "text");
          helLabel.setAttribute("x", (cx + gearBCx) / 2);
          helLabel.setAttribute("y", cy - maxR - mod * 3);
          helLabel.setAttribute("text-anchor", "middle");
          helLabel.setAttribute("font-size", "7");
          helLabel.setAttribute("fill", "#888");
          helLabel.textContent = "H\u00e9lico\u00efdal";
          this.mainGroup.appendChild(helLabel);
        }
      }

      // Type badge (petit label de type au-dessus de l'étage)
      const typeBadge = document.createElementNS(this.svgNS, "text");
      typeBadge.setAttribute("x", (cx + (stageCx2 || cx)) / 2);
      typeBadge.setAttribute("y", cy - (maxR || 30) - mod * 5);
      typeBadge.setAttribute("text-anchor", "middle");
      typeBadge.setAttribute("font-size", "6");
      typeBadge.setAttribute("fill", "#aaa");
      typeBadge.textContent = `\u2500 ${type.nomCourt} \u2500`;
      this.mainGroup.appendChild(typeBadge);

      // Avancer pour l'étage suivant
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

    // Labels ENTRÉE / SORTIE
    const firstData = this.gearData[0];
    const lastData = this.gearData[this.gearData.length - 1];
    if (firstData && lastData) {
      const firstR = (mod * firstData.nbDents) / 2;
      const lastR = (mod * lastData.nbDents) / 2;
      this._drawIOLabel(firstData.cx, firstData.cy + Math.max(firstR, 30) + 25, "ENTR\u00c9E", "#2ecc71");
      this._drawIOLabel(lastData.cx, lastData.cy + Math.max(lastR, 30) + 25, "SORTIE", "#e74c3c");
    }

    this._currentSolution = solution;
    this._currentMod = mod;
    this._currentAngleContact = angleContact;
    this._fitViewBox(mod);
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

  _fitViewBox(mod = this._currentMod) {
    if (this.gearData.length === 0) return;
    if (!Number.isFinite(mod) || mod <= 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.gearData.forEach(g => {
      const r = (mod * g.nbDents) / 2 + mod * 2;
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

  /**
   * Calcule le ratio d'un étage en utilisant la formule correcte par type.
   */
  _stageRatio(stageIndex) {
    const [A, B, typeId] = this._currentSolution[stageIndex];
    if (typeId === 'epicyclic') return 1 + B / A;
    return B / A; // spur, helical, internal, bevel, belt, worm
  }

  _animate() {
    if (!this.isAnimating) return;

    this.animationAngle += 0.02;

    this.gearData.forEach((gear, index) => {
      const pairIndex = Math.floor(index / 2);
      const isDriver = index % 2 === 0;

      // Rapport cumulé jusqu'à cet engrenage (utilise les formules par type)
      let cumulRatio = 1;
      for (let i = 0; i < pairIndex; i++) {
        cumulRatio *= this._stageRatio(i);
      }
      if (!isDriver) {
        cumulRatio *= this._stageRatio(pairIndex);
      }

      // Vitesse angulaire inversée par rapport au rapport cumulé
      const typeId = this._currentSolution[pairIndex] ? this._currentSolution[pairIndex][2] || 'spur' : 'spur';

      // Sens de rotation : alternance pour spur/helical/bevel, même sens pour internal/belt/epicyclic
      let sensSign = 1;
      for (let i = 0; i <= pairIndex; i++) {
        const stageType = this._currentSolution[i] ? this._currentSolution[i][2] || 'spur' : 'spur';
        if (i < pairIndex || !isDriver) {
          if (stageType === 'spur' || stageType === 'helical' || stageType === 'bevel' || stageType === 'worm') {
            sensSign *= -1;
          }
          // internal, belt, epicyclic : même sens (sensSign inchangé)
        }
      }

      const angleDeg = (this.animationAngle / cumulRatio) * sensSign * (180 / Math.PI);
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
