/**
 * @module visualization/GearDrawer
 * @description Mixin de dessin d'engrenages pour GearSVG.
 *
 * Ce module ajoute au prototype de GearSVG toutes les méthodes de dessin :
 *   - Engrenage individuel avec profil en développante ({@link GearSVG#drawGear})
 *   - Engrenage intérieur couronne + pignon ({@link GearSVG#drawInternalGear})
 *   - Vis sans fin ({@link GearSVG#drawWormGear})
 *   - Courroie et poulie ({@link GearSVG#drawBeltPulley})
 *   - Engrenage conique ({@link GearSVG#drawBevelGear})
 *   - Train épicycloïdal ({@link GearSVG#drawEpicyclicGear})
 *   - Ligne de cote et labels E/S ({@link GearSVG#_drawDimensionLine}, {@link GearSVG#_drawIOLabel})
 *
 * Pattern mixin : les méthodes sont assignées à GearSVG.prototype après
 * la définition de la classe dans GearSVG.js. Elles accèdent aux propriétés
 * de l'instance (this.svgNS, this.mainGroup, etc.) via `this`.
 *
 * @see {@link module:GearSVG} pour le noyau de la classe
 * @see {@link module:visualization/SVGInteraction} pour les tooltips utilisés ici
 */
(function () {

  var proto = GearSVG.prototype;
  var SVG_CFG = GearApp.config.SVG;

  // ===== Dessin d'un engrenage individuel (profil en développante) =====

  /**
   * Dessine un engrenage complet avec profil de dents en développante de cercle.
   *
   * L'engrenage est composé de :
   *   - Un cercle de pied (fond de dent)
   *   - Le profil des dents calculé par développante (courbe involute)
   *   - Le cercle primitif (en pointillé bleu, pour référence)
   *   - Un trou central (axe) avec une croix
   *   - Un label textuel au-dessus
   *   - Une zone de survol invisible pour le tooltip interactif
   *
   * @param {number} cx - Coordonnée X du centre (espace SVG)
   * @param {number} cy - Coordonnée Y du centre (espace SVG)
   * @param {number} nbDents - Nombre de dents de l'engrenage
   * @param {number} mod - Module métrique (mm)
   * @param {number} angleContact - Angle de pression en degrés (typiquement 20°)
   * @param {number} rotation - Angle de rotation initiale en radians
   * @param {string} label - Texte affiché au-dessus
   * @param {string} color - Couleur de remplissage (CSS). Si null, gradient par défaut.
   * @returns {SVGGElement} Le groupe SVG <g> contenant l'engrenage complet
   */
  proto.drawGear = function (cx, cy, nbDents, mod, angleContact, rotation, label, color) {
    // --- Calcul des rayons caractéristiques ---
    var alpha = (angleContact || 20) * Math.PI / 180;
    var rayonPrimitive = (mod * nbDents) / 2;
    var rayonBase = rayonPrimitive * Math.cos(alpha);
    var rayonTete = rayonPrimitive + mod * SVG_CFG.TOOTH.ADDENDUM_FACTOR;
    var rayonPied = rayonPrimitive - mod * SVG_CFG.TOOTH.DEDENDUM_FACTOR;
    var rayonAlterationMin = Math.max(rayonBase, rayonPied);

    // --- Groupe SVG de l'engrenage ---
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${(rotation || 0) * 180 / Math.PI})`);

    // Cercle du pied (fond de dent)
    var cercleBase = document.createElementNS(this.svgNS, "circle");
    cercleBase.setAttribute("r", rayonPied);
    cercleBase.setAttribute("fill", color || "url(#gearGradient)");
    cercleBase.setAttribute("stroke", "#666");
    cercleBase.setAttribute("stroke-width", "0.5");
    group.appendChild(cercleBase);

    // Profil des dents en développante de cercle
    var toothPath = this._generateToothProfile(nbDents, rayonBase, rayonTete, rayonAlterationMin);
    var path = document.createElementNS(this.svgNS, "path");
    path.setAttribute("d", toothPath);
    path.setAttribute("fill", color || "url(#gearGradient)");
    path.setAttribute("stroke", "#444");
    path.setAttribute("stroke-width", "0.5");
    path.setAttribute("stroke-linejoin", "round");
    group.appendChild(path);

    // Cercle primitif (pointillé bleu)
    var cerclePrimitive = document.createElementNS(this.svgNS, "circle");
    cerclePrimitive.setAttribute("r", rayonPrimitive);
    cerclePrimitive.setAttribute("fill", "none");
    cerclePrimitive.setAttribute("stroke", "#0066cc");
    cerclePrimitive.setAttribute("stroke-width", "0.3");
    cerclePrimitive.setAttribute("stroke-dasharray", "2,2");
    cerclePrimitive.setAttribute("opacity", "0.5");
    group.appendChild(cerclePrimitive);

    // Trou central (axe)
    var trou = document.createElementNS(this.svgNS, "circle");
    var rayonTrou = Math.max(mod * 1.5, rayonPied * 0.15);
    trou.setAttribute("r", rayonTrou);
    trou.setAttribute("fill", "#fafafa");
    trou.setAttribute("stroke", "#666");
    trou.setAttribute("stroke-width", "0.5");
    group.appendChild(trou);

    // Croix au centre (repère visuel)
    var crossSize = rayonTrou * 0.6;
    var cross1 = document.createElementNS(this.svgNS, "line");
    cross1.setAttribute("x1", -crossSize); cross1.setAttribute("y1", 0);
    cross1.setAttribute("x2", crossSize); cross1.setAttribute("y2", 0);
    cross1.setAttribute("stroke", "#999"); cross1.setAttribute("stroke-width", "0.3");
    group.appendChild(cross1);
    var cross2 = document.createElementNS(this.svgNS, "line");
    cross2.setAttribute("x1", 0); cross2.setAttribute("y1", -crossSize);
    cross2.setAttribute("x2", 0); cross2.setAttribute("y2", crossSize);
    cross2.setAttribute("stroke", "#999"); cross2.setAttribute("stroke-width", "0.3");
    group.appendChild(cross2);

    // Label textuel au-dessus du sommet des dents
    var textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rayonTete - 5);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-family", "Arial");
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.setAttribute("transform", `rotate(${-(rotation || 0) * 180 / Math.PI})`);
    textElem.textContent = label || "";
    group.appendChild(textElem);

    // Zone de survol invisible (hit area) pour le tooltip
    var hitArea = document.createElementNS(this.svgNS, "circle");
    hitArea.setAttribute("r", rayonTete);
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("cursor", "pointer");
    hitArea.addEventListener("mouseenter", () => this._showTooltip(cx, cy - rayonTete - 15, label, nbDents, mod, rayonPrimitive));
    hitArea.addEventListener("mouseleave", () => this._hideTooltip());
    group.appendChild(hitArea);

    this.mainGroup.appendChild(group);
    return group;
  };

  // ===== Génération du profil de dent (développante de cercle / involute) =====

  /**
   * Génère le chemin SVG (attribut "d") du profil complet de toutes les dents.
   *
   * Pour chaque dent :
   *   1. Point dans le creux (fond de dent)
   *   2. Pied du flanc gauche
   *   3. Flanc gauche : courbe en développante
   *   4. Sommet de la dent
   *   5. Flanc droit : développante descendante (symétrique)
   *   6. Pied du flanc droit
   *   7. Retour au creux suivant
   *
   * @private
   * @param {number} nbDents - Nombre de dents
   * @param {number} rayonBase - Rayon du cercle de base
   * @param {number} rayonTete - Rayon du cercle de tête
   * @param {number} rayonPiedEffectif - Rayon effectif du pied de dent
   * @returns {string} La chaîne du chemin SVG ("M ... L ... Z")
   */
  proto._generateToothProfile = function (nbDents, rayonBase, rayonTete, rayonPiedEffectif) {
    var points = [];
    var angularPitch = (2 * Math.PI) / nbDents;
    var halfToothAngle = angularPitch / 4;
    var numPoints = SVG_CFG.TOOTH.INVOLUTE_POINTS;

    for (var i = 0; i < nbDents; i++) {
      var baseAngle = i * angularPitch;

      var leftFlank = this._involutePoints(rayonBase, rayonTete, baseAngle - halfToothAngle, 1, numPoints);
      var rightFlank = this._involutePoints(rayonBase, rayonTete, baseAngle + halfToothAngle, -1, numPoints);

      if (leftFlank.length > 0 && rightFlank.length > 0) {
        // Fond du creux précédant la dent
        var creux1Angle = baseAngle - angularPitch / 2;
        points.push({
          x: rayonPiedEffectif * Math.cos(creux1Angle),
          y: rayonPiedEffectif * Math.sin(creux1Angle)
        });

        // Pied du flanc gauche
        var piedGaucheAngle = baseAngle - halfToothAngle;
        points.push({
          x: rayonPiedEffectif * Math.cos(piedGaucheAngle),
          y: rayonPiedEffectif * Math.sin(piedGaucheAngle)
        });

        // Flanc gauche (montée en développante)
        points.push.apply(points, leftFlank);

        // Sommet de la dent
        points.push({
          x: rayonTete * Math.cos(baseAngle),
          y: rayonTete * Math.sin(baseAngle)
        });

        // Flanc droit (descente, points inversés)
        points.push.apply(points, rightFlank.reverse());

        // Pied du flanc droit
        var piedDroitAngle = baseAngle + halfToothAngle;
        points.push({
          x: rayonPiedEffectif * Math.cos(piedDroitAngle),
          y: rayonPiedEffectif * Math.sin(piedDroitAngle)
        });
      }
    }

    if (points.length === 0) return "";

    var d = `M ${points[0].x} ${points[0].y}`;
    for (var j = 1; j < points.length; j++) {
      d += ` L ${points[j].x} ${points[j].y}`;
    }
    d += " Z";
    return d;
  };

  /**
   * Calcule les points d'une courbe en développante de cercle (involute curve).
   *
   * Équations paramétriques (paramètre t) :
   *   - r(t) = Rb × sqrt(1 + t²)
   *   - theta(t) = t − arctan(t)
   *
   * @private
   * @param {number} rb - Rayon du cercle de base
   * @param {number} ra - Rayon du cercle de tête
   * @param {number} baseAngle - Angle de départ (radians)
   * @param {number} direction - Sens de la développante (+1 ou -1)
   * @param {number} numPoints - Nombre de points d'échantillonnage
   * @returns {Array<{x: number, y: number}>} Points de la courbe
   */
  proto._involutePoints = function (rb, ra, baseAngle, direction, numPoints) {
    var pts = [];
    var tMax = Math.sqrt((ra / rb) ** 2 - 1);

    for (var i = 0; i <= numPoints; i++) {
      var t = (tMax * i) / numPoints;
      var r = rb * Math.sqrt(1 + t * t);
      if (r > ra) break;
      var invAngle = t - Math.atan(t);
      var angle = baseAngle + direction * invAngle;
      pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
    }
    return pts;
  };

  // ===== Engrenage intérieur (couronne + pignon) =====

  /**
   * Dessine un engrenage intérieur (couronne + pignon interne).
   *
   * @param {number} cx - Coordonnée X du centre
   * @param {number} cy - Coordonnée Y du centre
   * @param {number} nbDentsPignon - Nombre de dents du pignon intérieur
   * @param {number} nbDentsCouronne - Nombre de dents de la couronne
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale (radians)
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGGElement} Le groupe SVG de l'engrenage intérieur
   */
  proto.drawInternalGear = function (cx, cy, nbDentsPignon, nbDentsCouronne, mod, rotation, label, color) {
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${(rotation || 0) * 180 / Math.PI})`);

    var rCouronne = (mod * nbDentsCouronne) / 2;
    var rPignon = (mod * nbDentsPignon) / 2;

    // Couronne (anneau extérieur)
    var anneau = document.createElementNS(this.svgNS, "circle");
    anneau.setAttribute("r", rCouronne + mod * 2);
    anneau.setAttribute("fill", "none");
    anneau.setAttribute("stroke", "#666");
    anneau.setAttribute("stroke-width", mod * 0.8);
    group.appendChild(anneau);

    // Denture interne stylisée
    var interieur = document.createElementNS(this.svgNS, "circle");
    interieur.setAttribute("r", rCouronne);
    interieur.setAttribute("fill", "none");
    interieur.setAttribute("stroke", color || "#fdebd0");
    interieur.setAttribute("stroke-width", mod * 1.5);
    interieur.setAttribute("stroke-dasharray", `${mod * 1.2},${mod * 0.6}`);
    group.appendChild(interieur);

    // Pignon central (dessiné via drawGear puis déplacé dans le groupe)
    var entraxe = rCouronne - rPignon;
    var pignonGroup = this.drawGear(0, 0, nbDentsPignon, mod, 20, 0, "", color);
    this.mainGroup.removeChild(pignonGroup);
    group.appendChild(pignonGroup);

    // Label de l'étage
    var textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rCouronne - mod * 4);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif
    this._addTooltipHitArea(group, 0, 0, rCouronne + mod * 2, [
      `${label} - Engrenage int\u00e9rieur`,
      `Pignon: ${nbDentsPignon} dents, Couronne: ${nbDentsCouronne} dents`,
      `Entraxe: ${entraxe.toFixed(1)} mm`,
      `Rapport: ${(nbDentsCouronne / nbDentsPignon).toFixed(3)}`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  };

  // ===== Vis sans fin =====

  /**
   * Dessine une vis sans fin (vue schématique).
   * Roue dentée + cylindre hélicoïdal + indicateur 90°.
   *
   * @param {number} cx - Coordonnée X du centre de la roue
   * @param {number} cy - Coordonnée Y du centre de la roue
   * @param {number} nbFilets - Nombre de filets de la vis
   * @param {number} nbDentsRoue - Nombre de dents de la roue
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGGElement} Le groupe SVG
   */
  proto.drawWormGear = function (cx, cy, nbFilets, nbDentsRoue, mod, rotation, label, color) {
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    var rRoue = (mod * nbDentsRoue) / 2;
    var q = GearApp.config.MECANIQUE.QUOTIENT_DIAMETRE_VIS;
    var diamVis = q * mod;
    var rVis = diamVis / 2;

    // --- Roue dentée (vue de face) ---
    var roue = document.createElementNS(this.svgNS, "circle");
    roue.setAttribute("r", rRoue);
    roue.setAttribute("fill", color || "#fcf3cf");
    roue.setAttribute("stroke", "#666");
    roue.setAttribute("stroke-width", "0.5");
    group.appendChild(roue);

    // Dents simplifiées (traits radiaux)
    for (var i = 0; i < nbDentsRoue; i++) {
      var angle = (2 * Math.PI * i) / nbDentsRoue;
      var x1 = rRoue * Math.cos(angle);
      var y1 = rRoue * Math.sin(angle);
      var x2 = (rRoue + mod) * Math.cos(angle);
      var y2 = (rRoue + mod) * Math.sin(angle);
      var tick = document.createElementNS(this.svgNS, "line");
      tick.setAttribute("x1", x1); tick.setAttribute("y1", y1);
      tick.setAttribute("x2", x2); tick.setAttribute("y2", y2);
      tick.setAttribute("stroke", "#888"); tick.setAttribute("stroke-width", "0.5");
      group.appendChild(tick);
    }

    // --- Vis sans fin (vue de côté) ---
    var visY = -rRoue - rVis - mod;
    var longueurVis = rRoue * 0.8;

    // Corps cylindrique
    var visRect = document.createElementNS(this.svgNS, "rect");
    visRect.setAttribute("x", -longueurVis / 2);
    visRect.setAttribute("y", visY - rVis);
    visRect.setAttribute("width", longueurVis);
    visRect.setAttribute("height", rVis * 2);
    visRect.setAttribute("rx", rVis);
    visRect.setAttribute("fill", "#e0e0e0");
    visRect.setAttribute("stroke", "#666");
    visRect.setAttribute("stroke-width", "0.5");
    group.appendChild(visRect);

    // Filets de la vis (zigzag)
    var pas = longueurVis / (nbFilets * 3);
    var visPath = `M ${-longueurVis / 2} ${visY}`;
    for (var x = -longueurVis / 2; x < longueurVis / 2; x += pas) {
      visPath += ` L ${x + pas / 2} ${visY - rVis * 0.7} L ${x + pas} ${visY}`;
    }
    var filets = document.createElementNS(this.svgNS, "path");
    filets.setAttribute("d", visPath);
    filets.setAttribute("fill", "none");
    filets.setAttribute("stroke", "#444");
    filets.setAttribute("stroke-width", "0.8");
    group.appendChild(filets);

    // Axe de la vis (pointillé)
    var axeVis = document.createElementNS(this.svgNS, "line");
    axeVis.setAttribute("x1", -longueurVis); axeVis.setAttribute("y1", visY);
    axeVis.setAttribute("x2", longueurVis); axeVis.setAttribute("y2", visY);
    axeVis.setAttribute("stroke", "#999");
    axeVis.setAttribute("stroke-width", "0.3");
    axeVis.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeVis);

    // Indicateur 90°
    var angle90 = document.createElementNS(this.svgNS, "text");
    angle90.setAttribute("x", longueurVis * 0.7);
    angle90.setAttribute("y", visY + rVis + 8);
    angle90.setAttribute("font-size", "7");
    angle90.setAttribute("fill", "#999");
    angle90.textContent = "90\u00b0";
    group.appendChild(angle90);

    // Trou central de la roue
    var trou = document.createElementNS(this.svgNS, "circle");
    trou.setAttribute("r", rVis * 0.6);
    trou.setAttribute("fill", "#fafafa");
    trou.setAttribute("stroke", "#666");
    trou.setAttribute("stroke-width", "0.5");
    group.appendChild(trou);

    // Label
    var textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", rRoue + mod * 3);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip avec angle d'avance
    var angleAvance = Math.atan(nbFilets / q) * 180 / Math.PI;
    this._addTooltipHitArea(group, 0, 0, rRoue + mod, [
      `${label} - Vis sans fin`,
      `Filets: ${nbFilets}, Dents roue: ${nbDentsRoue}`,
      `Rapport: ${(nbDentsRoue / nbFilets).toFixed(1)}:1`,
      `Angle avance: ${angleAvance.toFixed(1)}\u00b0`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  };

  // ===== Courroie et poulie =====

  /**
   * Dessine une transmission par courroie et poulie.
   * Deux poulies + deux brins de courroie (tangentes externes).
   *
   * @param {number} cx - Coordonnée X de la poulie menante
   * @param {number} cy - Coordonnée Y de la poulie menante
   * @param {number} diamA - Diamètre de la poulie menante (mm)
   * @param {number} diamB - Diamètre de la poulie menée (mm)
   * @param {number} mod - Module (dimensionnement du label)
   * @param {number} rotation - Non utilisé
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {{group: SVGGElement, entraxe: number}} Groupe SVG et distance entre axes
   */
  proto.drawBeltPulley = function (cx, cy, diamA, diamB, mod, rotation, label, color) {
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    var rA = diamA / 2;
    var rB = diamB / 2;
    var entraxe = (diamA + diamB) * 1.5;

    // Poulie menante (gauche)
    var poulieA = document.createElementNS(this.svgNS, "circle");
    poulieA.setAttribute("cx", 0); poulieA.setAttribute("cy", 0);
    poulieA.setAttribute("r", rA);
    poulieA.setAttribute("fill", color || "#fadbd8");
    poulieA.setAttribute("stroke", "#666");
    poulieA.setAttribute("stroke-width", "0.5");
    group.appendChild(poulieA);

    // Gorge poulie A
    var gorgeA = document.createElementNS(this.svgNS, "circle");
    gorgeA.setAttribute("cx", 0); gorgeA.setAttribute("cy", 0);
    gorgeA.setAttribute("r", rA * 0.85);
    gorgeA.setAttribute("fill", "none");
    gorgeA.setAttribute("stroke", "#999");
    gorgeA.setAttribute("stroke-width", "0.3");
    gorgeA.setAttribute("stroke-dasharray", "1,2");
    group.appendChild(gorgeA);

    // Poulie menée (droite)
    var poulieB = document.createElementNS(this.svgNS, "circle");
    poulieB.setAttribute("cx", entraxe); poulieB.setAttribute("cy", 0);
    poulieB.setAttribute("r", rB);
    poulieB.setAttribute("fill", color || "#fadbd8");
    poulieB.setAttribute("stroke", "#666");
    poulieB.setAttribute("stroke-width", "0.5");
    group.appendChild(poulieB);

    // Gorge poulie B
    var gorgeB = document.createElementNS(this.svgNS, "circle");
    gorgeB.setAttribute("cx", entraxe); gorgeB.setAttribute("cy", 0);
    gorgeB.setAttribute("r", rB * 0.85);
    gorgeB.setAttribute("fill", "none");
    gorgeB.setAttribute("stroke", "#999");
    gorgeB.setAttribute("stroke-width", "0.3");
    gorgeB.setAttribute("stroke-dasharray", "1,2");
    group.appendChild(gorgeB);

    // Courroie : tangentes externes entre les deux poulies
    var dy = rB - rA;
    var dist = entraxe;
    var sinA = dy / dist;
    var cosA = Math.sqrt(1 - sinA * sinA);

    // Brin supérieur
    var brinSup = document.createElementNS(this.svgNS, "line");
    brinSup.setAttribute("x1", rA * sinA);
    brinSup.setAttribute("y1", -rA * cosA);
    brinSup.setAttribute("x2", entraxe + rB * sinA);
    brinSup.setAttribute("y2", -rB * cosA);
    brinSup.setAttribute("stroke", "#333");
    brinSup.setAttribute("stroke-width", "1");
    group.appendChild(brinSup);

    // Brin inférieur
    var brinInf = document.createElementNS(this.svgNS, "line");
    brinInf.setAttribute("x1", -rA * sinA);
    brinInf.setAttribute("y1", rA * cosA);
    brinInf.setAttribute("x2", entraxe - rB * sinA);
    brinInf.setAttribute("y2", rB * cosA);
    brinInf.setAttribute("stroke", "#333");
    brinInf.setAttribute("stroke-width", "1");
    group.appendChild(brinInf);

    // Trous centraux
    [{ x: 0, r: rA }, { x: entraxe, r: rB }].forEach(p => {
      var trou = document.createElementNS(this.svgNS, "circle");
      trou.setAttribute("cx", p.x); trou.setAttribute("cy", 0);
      trou.setAttribute("r", Math.max(1, p.r * 0.15));
      trou.setAttribute("fill", "#fafafa");
      trou.setAttribute("stroke", "#666");
      trou.setAttribute("stroke-width", "0.3");
      group.appendChild(trou);
    });

    // Labels de diamètre
    var lblA = document.createElementNS(this.svgNS, "text");
    lblA.setAttribute("x", 0); lblA.setAttribute("y", rA + 10);
    lblA.setAttribute("text-anchor", "middle");
    lblA.setAttribute("font-size", Math.max(6, rA * 0.3));
    lblA.setAttribute("fill", "#333");
    lblA.textContent = `\u00d8${diamA}`;
    group.appendChild(lblA);

    var lblB = document.createElementNS(this.svgNS, "text");
    lblB.setAttribute("x", entraxe); lblB.setAttribute("y", rB + 10);
    lblB.setAttribute("text-anchor", "middle");
    lblB.setAttribute("font-size", Math.max(6, rB * 0.2));
    lblB.setAttribute("fill", "#333");
    lblB.textContent = `\u00d8${diamB}`;
    group.appendChild(lblB);

    // Label de l'étage
    var textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", entraxe / 2);
    textElem.setAttribute("y", -Math.max(rA, rB) - 8);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip
    var hitBelt = document.createElementNS(this.svgNS, "rect");
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
    return { group: group, entraxe: entraxe };
  };

  // ===== Engrenage conique =====

  /**
   * Dessine un engrenage conique (vue schématique de côté).
   * Deux trapèzes + indicateur 90° entre les axes.
   *
   * @param {number} cx - Coordonnée X du point d'intersection des axes
   * @param {number} cy - Coordonnée Y du point d'intersection
   * @param {number} nbDentsA - Nombre de dents du pignon (entrée)
   * @param {number} nbDentsB - Nombre de dents de la roue (sortie)
   * @param {number} mod - Module métrique
   * @param {number} rotation - Non utilisé
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGGElement} Le groupe SVG
   */
  proto.drawBevelGear = function (cx, cy, nbDentsA, nbDentsB, mod, rotation, label, color) {
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    var rA = (mod * nbDentsA) / 2;
    var rB = (mod * nbDentsB) / 2;

    // Cône du pignon (horizontal, trapézoïdal)
    var pignon = document.createElementNS(this.svgNS, "polygon");
    pignon.setAttribute("points", `${-rA},${-rA} ${rA * 0.5},${-rA * 0.2} ${rA * 0.5},${rA * 0.2} ${-rA},${rA}`);
    pignon.setAttribute("fill", color || "#e8daef");
    pignon.setAttribute("stroke", "#666");
    pignon.setAttribute("stroke-width", "0.5");
    group.appendChild(pignon);

    // Cône de la roue (vertical, trapézoïdal)
    var roue = document.createElementNS(this.svgNS, "polygon");
    roue.setAttribute("points", `${-rB * 0.2},${rB * 0.5} ${rB * 0.2},${rB * 0.5} ${rB},${rB + rA} ${-rB},${rB + rA}`);
    roue.setAttribute("fill", color || "#e8daef");
    roue.setAttribute("stroke", "#666");
    roue.setAttribute("stroke-width", "0.5");
    roue.setAttribute("opacity", "0.8");
    group.appendChild(roue);

    // Arc indicateur 90°
    var arc90 = document.createElementNS(this.svgNS, "path");
    var arcR = Math.min(rA, rB) * 0.4;
    arc90.setAttribute("d", `M ${arcR},0 A ${arcR},${arcR} 0 0,1 0,${arcR}`);
    arc90.setAttribute("fill", "none");
    arc90.setAttribute("stroke", "#999");
    arc90.setAttribute("stroke-width", "0.5");
    group.appendChild(arc90);

    var txt90 = document.createElementNS(this.svgNS, "text");
    txt90.setAttribute("x", arcR + 3); txt90.setAttribute("y", arcR + 3);
    txt90.setAttribute("font-size", "7"); txt90.setAttribute("fill", "#999");
    txt90.textContent = "90\u00b0";
    group.appendChild(txt90);

    // Axes en pointillé
    var axeH = document.createElementNS(this.svgNS, "line");
    axeH.setAttribute("x1", -rA * 1.5); axeH.setAttribute("y1", 0);
    axeH.setAttribute("x2", rA); axeH.setAttribute("y2", 0);
    axeH.setAttribute("stroke", "#bbb"); axeH.setAttribute("stroke-width", "0.3");
    axeH.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeH);

    var axeV = document.createElementNS(this.svgNS, "line");
    axeV.setAttribute("x1", 0); axeV.setAttribute("y1", rB * 0.3);
    axeV.setAttribute("x2", 0); axeV.setAttribute("y2", rB + rA + rB * 0.3);
    axeV.setAttribute("stroke", "#bbb"); axeV.setAttribute("stroke-width", "0.3");
    axeV.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeV);

    // Label
    var textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rA - 8);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip
    this._addTooltipHitArea(group, 0, 0, Math.max(rA, rB) + mod, [
      `${label} - Engrenage conique`,
      `Pignon: ${nbDentsA} dents, Roue: ${nbDentsB} dents`,
      `Rapport: ${(nbDentsB / nbDentsA).toFixed(3)}`,
      `Axes \u00e0 90\u00b0`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  };

  // ===== Train épicycloïdal =====

  /**
   * Dessine un train épicycloïdal schématique.
   * Solaire central + couronne + 3 satellites + porte-satellites.
   *
   * Rapport de réduction : i = 1 + Zcouronne / Zsolaire
   *
   * @param {number} cx - Coordonnée X du centre
   * @param {number} cy - Coordonnée Y du centre
   * @param {number} dentsSolaire - Nombre de dents du solaire
   * @param {number} dentsCouronne - Nombre de dents de la couronne
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur du solaire
   * @returns {SVGGElement} Le groupe SVG
   */
  proto.drawEpicyclicGear = function (cx, cy, dentsSolaire, dentsCouronne, mod, rotation, label, color) {
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    var rSolaire = (mod * dentsSolaire) / 2;
    var rCouronne = (mod * dentsCouronne) / 2;
    var dentsSatellite = (dentsCouronne - dentsSolaire) / 2;
    var rSatellite = (mod * dentsSatellite) / 2;
    var rOrbiteSat = rSolaire + rSatellite;

    // Couronne extérieure
    var couronne = document.createElementNS(this.svgNS, "circle");
    couronne.setAttribute("r", rCouronne + mod);
    couronne.setAttribute("fill", "none");
    couronne.setAttribute("stroke", "#555");
    couronne.setAttribute("stroke-width", mod * 1.5);
    group.appendChild(couronne);

    // Denture intérieure de la couronne
    var couronneInt = document.createElementNS(this.svgNS, "circle");
    couronneInt.setAttribute("r", rCouronne);
    couronneInt.setAttribute("fill", "none");
    couronneInt.setAttribute("stroke", "#999");
    couronneInt.setAttribute("stroke-width", mod * 0.5);
    couronneInt.setAttribute("stroke-dasharray", `${mod * 0.8},${mod * 0.5}`);
    group.appendChild(couronneInt);

    // Solaire central
    var solaireGroup = this.drawGear(0, 0, dentsSolaire, mod, 20, 0, "", color || "#d6eaf8");
    this.mainGroup.removeChild(solaireGroup);
    group.appendChild(solaireGroup);

    // Satellites (3, à 120° les uns des autres)
    var nbSat = 3;
    for (var s = 0; s < nbSat; s++) {
      var satAngle = (2 * Math.PI * s) / nbSat;
      var satX = rOrbiteSat * Math.cos(satAngle);
      var satY = rOrbiteSat * Math.sin(satAngle);
      var satGroup = this.drawGear(satX, satY, Math.max(6, Math.round(dentsSatellite)), mod * 0.9, 20, 0, "", "#fef9e7");
      this.mainGroup.removeChild(satGroup);
      group.appendChild(satGroup);
    }

    // Porte-satellites (orbite en pointillé)
    var porteSat = document.createElementNS(this.svgNS, "circle");
    porteSat.setAttribute("r", rOrbiteSat);
    porteSat.setAttribute("fill", "none");
    porteSat.setAttribute("stroke", "#aaa");
    porteSat.setAttribute("stroke-width", "0.5");
    porteSat.setAttribute("stroke-dasharray", "4,3");
    group.appendChild(porteSat);

    // Label
    var textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rCouronne - mod * 3);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip
    this._addTooltipHitArea(group, 0, 0, rCouronne + mod, [
      `${label} - Train \u00e9picyclo\u00efdal`,
      `Solaire: ${dentsSolaire} dents, Couronne: ${dentsCouronne} dents`,
      `Satellite: ${Math.round(dentsSatellite)} dents`,
      `Rapport: ${(1 + dentsCouronne / dentsSolaire).toFixed(3)}`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  };

  // ===== Éléments de cotation et d'annotation =====

  /**
   * Dessine une ligne de cote entre deux points avec un label.
   *
   * @private
   * @param {number} x1 - X de départ
   * @param {number} y1 - Y de départ
   * @param {number} x2 - X d'arrivée
   * @param {number} y2 - Y d'arrivée
   * @param {string} label - Texte de la cote
   */
  proto._drawDimensionLine = function (x1, y1, x2, y2, label) {
    var group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("class", "dimension");

    // Ligne de cote en pointillé
    var line = document.createElementNS(this.svgNS, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#888");
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("stroke-dasharray", "4,2");
    group.appendChild(line);

    // Flèches triangulaires aux extrémités
    var arrowSize = 3;
    [{ x: x1, dir: 1 }, { x: x2, dir: -1 }].forEach(function (pt) {
      var arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrow.setAttribute("points", `${pt.x},${y1} ${pt.x + pt.dir * arrowSize},${y1 - arrowSize} ${pt.x + pt.dir * arrowSize},${y1 + arrowSize}`);
      arrow.setAttribute("fill", "#888");
      group.appendChild(arrow);
    });

    // Texte de la cote
    var text = document.createElementNS(this.svgNS, "text");
    text.setAttribute("x", (x1 + x2) / 2);
    text.setAttribute("y", y1 + 12);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "8");
    text.setAttribute("fill", "#666");
    text.textContent = label;
    group.appendChild(text);

    this.mainGroup.appendChild(group);
  };

  /**
   * Dessine un label ENTREE ou SORTIE sous forme de rectangle coloré.
   *
   * @private
   * @param {number} cx - Coordonnée X du centre
   * @param {number} cy - Coordonnée Y du bord supérieur
   * @param {string} text - Texte du label
   * @param {string} color - Couleur de fond
   */
  proto._drawIOLabel = function (cx, cy, text, color) {
    var group = document.createElementNS(this.svgNS, "g");

    var rect = document.createElementNS(this.svgNS, "rect");
    rect.setAttribute("x", cx - 30);
    rect.setAttribute("y", cy);
    rect.setAttribute("width", 60);
    rect.setAttribute("height", 22);
    rect.setAttribute("rx", 4);
    rect.setAttribute("fill", color);
    rect.setAttribute("opacity", "0.8");
    group.appendChild(rect);

    var labelEl = document.createElementNS(this.svgNS, "text");
    labelEl.setAttribute("x", cx);
    labelEl.setAttribute("y", cy + 15);
    labelEl.setAttribute("text-anchor", "middle");
    labelEl.setAttribute("font-size", "10");
    labelEl.setAttribute("font-weight", "bold");
    labelEl.setAttribute("fill", "white");
    labelEl.textContent = text;
    group.appendChild(labelEl);

    this.mainGroup.appendChild(group);
  };

})();
