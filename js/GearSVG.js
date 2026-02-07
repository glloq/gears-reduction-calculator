/**
 * @module GearSVG
 * @description Module de visualisation SVG interactive des engrenages.
 *
 * Ce module dessine des engrenages avec des profils de dents calculés par
 * développante de cercle (courbe involute). Il supporte 7 types de transmission :
 *   - Engrenages droits (spur) et hélicoïdaux (helical)
 *   - Engrenages intérieurs (internal) avec couronne + pignon
 *   - Engrenages coniques (bevel) en vue schématique latérale
 *   - Transmissions par courroie et poulie (belt)
 *   - Trains épicycloïdaux (epicyclic) avec solaire, satellites et couronne
 *   - Vis sans fin (worm) en vue schématique
 *
 * Fonctionnalités interactives :
 *   - Zoom (molette de la souris) et pan (clic-glisser)
 *   - Tooltips au survol de chaque engrenage
 *   - Animation de rotation avec rapport cinématique correct par étage
 *   - Export en SVG (chaîne XML) et en PNG (via canvas temporaire)
 *
 * @see {@link GearApp.visualization.GearSVG} pour le proxy dans le namespace
 */

// ===== Classe principale =====

/**
 * @class GearSVG
 * @classdesc Classe de visualisation SVG interactive pour les trains d'engrenages.
 *
 * Crée un élément SVG dans un conteneur HTML, y dessine des engrenages avec
 * profils en développante de cercle, et gère les interactions utilisateur
 * (zoom, pan, tooltips, animation).
 *
 * Le SVG utilise un système de viewBox pour le zoom/pan, avec un groupe
 * principal (mainGroup) qui contient tous les éléments dessinés, et un
 * groupe tooltip superposé qui reste toujours au premier plan.
 */
class GearSVG {

  // ===== Construction et initialisation =====

  /**
   * Crée une nouvelle instance de GearSVG.
   * @param {string} containerId - L'identifiant du conteneur HTML dans lequel insérer le SVG
   */
  constructor(containerId) {
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
    this.viewBox = { x: 0, y: 0, w: 800, h: 400 };

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
     * Données de chaque engrenage dessiné, utilisées pour l'animation et le calcul du viewBox
     */
    this.gearData = [];

    /** @type {boolean} Indique si l'animation de rotation est en cours */
    this.isAnimating = false;

    this._initSVG();
  }

  /**
   * Initialise l'élément SVG, les defs (filtres, gradients), le groupe principal,
   * le tooltip et les gestionnaires d'événements.
   * @private
   */
  _initSVG() {
    // Si un SVG existe déjà, le retirer avant de recréer
    if (this.svg) this.container.removeChild(this.svg);

    // --- Création de l'élément SVG racine ---
    this.svg = document.createElementNS(this.svgNS, "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "400");
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
    this.svg.style.border = "1px solid #ccc";
    this.svg.style.background = "#fafafa";
    this.svg.style.cursor = "grab";
    this.svg.style.borderRadius = "8px";

    // --- Section <defs> : filtres SVG et gradients réutilisables ---
    const defs = document.createElementNS(this.svgNS, "defs");

    // Filtre d'ombre portée appliqué aux engrenages (feOffset + feGaussianBlur + feComposite)
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

    // Gradient radial par défaut pour le remplissage des engrenages
    // (centre clair #e8e8e8 vers bord plus foncé #b0b0b0, effet métallique)
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

    // --- Groupe principal <g> : contient tous les engrenages ---
    // Ce groupe est le parent de tous les éléments dessinés.
    // Le zoom et le pan modifient le viewBox du SVG, pas la transform de ce groupe.
    this.mainGroup = document.createElementNS(this.svgNS, "g");
    this.mainGroup.setAttribute("id", "mainGroup");
    this.svg.appendChild(this.mainGroup);

    // --- Tooltip : groupe SVG superposé au mainGroup ---
    // Le tooltip est ajouté directement au SVG (pas au mainGroup)
    // pour qu'il reste au premier plan et ne soit pas affecté par les transforms.
    // Il contient un <rect> de fond et un <text> multi-lignes (via <tspan>).
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

  // ===== Gestion des événements d'interaction =====

  /**
   * Configure les gestionnaires d'événements pour le zoom (molette)
   * et le pan (clic-glisser) sur l'élément SVG.
   * @private
   */
  _setupEvents() {
    // --- Zoom par molette ---
    // Le facteur de zoom est 1.1 (zoom arrière) ou 0.9 (zoom avant).
    // On agrandit/réduit les dimensions du viewBox pour simuler le zoom.
    this.svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      this.viewBox.w *= zoomFactor;
      this.viewBox.h *= zoomFactor;
      this.scale *= zoomFactor;
      this._updateViewBox();
    });

    // --- Pan (déplacement) par clic gauche + glisser ---
    // Au mousedown, on enregistre la position de départ.
    this.svg.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.svg.style.cursor = "grabbing";
      }
    });

    // Pendant le mousemove, si un pan est en cours, on calcule le déplacement
    // en coordonnées SVG (proportionnel au ratio viewBox / taille écran du SVG)
    // et on décale le viewBox en conséquence.
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

    // Fin du pan au relâchement du bouton ou sortie de la zone SVG
    this.svg.addEventListener("mouseup", () => {
      this.isPanning = false;
      this.svg.style.cursor = "grab";
    });

    this.svg.addEventListener("mouseleave", () => {
      this.isPanning = false;
      this.svg.style.cursor = "grab";
    });
  }

  /**
   * Met à jour l'attribut viewBox du SVG à partir de l'état interne.
   * Appelée après chaque opération de zoom ou de pan.
   * @private
   */
  _updateViewBox() {
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

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
   * @param {number} cx - Coordonnée X du centre de l'engrenage (espace SVG)
   * @param {number} cy - Coordonnée Y du centre de l'engrenage (espace SVG)
   * @param {number} nbDents - Nombre de dents de l'engrenage
   * @param {number} mod - Module métrique de l'engrenage (en mm)
   * @param {number} angleContact - Angle de pression en degrés (typiquement 20°)
   * @param {number} rotation - Angle de rotation initiale en radians
   * @param {string} label - Texte affiché au-dessus de l'engrenage
   * @param {string} color - Couleur de remplissage (CSS). Si null, utilise le gradient par défaut.
   * @returns {SVGGElement} Le groupe SVG <g> contenant l'engrenage complet
   */
  drawGear(cx, cy, nbDents, mod, angleContact, rotation, label, color) {
    // --- Calcul des rayons caractéristiques ---
    // alpha : angle de pression converti en radians (par défaut 20°)
    const alpha = (angleContact || 20) * Math.PI / 180;
    // Rayon primitif : rayon du cercle sur lequel les dents s'engrènent théoriquement
    const rayonPrimitive = (mod * nbDents) / 2;
    // Rayon de base : cercle à partir duquel la développante est tracée (Rb = Rp * cos(alpha))
    const rayonBase = rayonPrimitive * Math.cos(alpha);
    // Rayon de tête : sommet des dents (Rp + module)
    const rayonTete = rayonPrimitive + mod;
    // Rayon de pied : fond des creux entre les dents (Rp - 1.25 * module, norme ISO)
    const rayonPied = rayonPrimitive - 1.25 * mod;
    // Le rayon effectif de pied ne peut pas être inférieur au rayon de base
    // (sinon la développante n'est pas définie dans cette zone)
    const rayonAlterationMin = Math.max(rayonBase, rayonPied);

    // --- Groupe SVG de l'engrenage ---
    // Translater au centre (cx, cy) et appliquer la rotation initiale
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${(rotation || 0) * 180 / Math.PI})`);

    // Cercle du pied (fond de dent, disque plein sous les dents)
    const cercleBase = document.createElementNS(this.svgNS, "circle");
    cercleBase.setAttribute("r", rayonPied);
    cercleBase.setAttribute("fill", color || "url(#gearGradient)");
    cercleBase.setAttribute("stroke", "#666");
    cercleBase.setAttribute("stroke-width", "0.5");
    group.appendChild(cercleBase);

    // Profil des dents en développante de cercle (path SVG fermé)
    const toothPath = this._generateToothProfile(nbDents, rayonBase, rayonTete, rayonAlterationMin);
    const path = document.createElementNS(this.svgNS, "path");
    path.setAttribute("d", toothPath);
    path.setAttribute("fill", color || "url(#gearGradient)");
    path.setAttribute("stroke", "#444");
    path.setAttribute("stroke-width", "0.5");
    path.setAttribute("stroke-linejoin", "round");
    group.appendChild(path);

    // Cercle primitif (pointillé bleu, référence d'engrènement)
    const cerclePrimitive = document.createElementNS(this.svgNS, "circle");
    cerclePrimitive.setAttribute("r", rayonPrimitive);
    cerclePrimitive.setAttribute("fill", "none");
    cerclePrimitive.setAttribute("stroke", "#0066cc");
    cerclePrimitive.setAttribute("stroke-width", "0.3");
    cerclePrimitive.setAttribute("stroke-dasharray", "2,2");
    cerclePrimitive.setAttribute("opacity", "0.5");
    group.appendChild(cerclePrimitive);

    // Trou central (axe) : cercle blanc simulant le perçage d'arbre
    const trou = document.createElementNS(this.svgNS, "circle");
    const rayonTrou = Math.max(mod * 1.5, rayonPied * 0.15);
    trou.setAttribute("r", rayonTrou);
    trou.setAttribute("fill", "#fafafa");
    trou.setAttribute("stroke", "#666");
    trou.setAttribute("stroke-width", "0.5");
    group.appendChild(trou);

    // Croix au centre (repère visuel de l'axe de rotation)
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

    // Label textuel positionné au-dessus du sommet des dents
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rayonTete - 5);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-family", "Arial");
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    // Contre-rotation du texte pour qu'il reste lisible quand l'engrenage tourne
    textElem.setAttribute("transform", `rotate(${-(rotation || 0) * 180 / Math.PI})`);
    textElem.textContent = label || "";
    group.appendChild(textElem);

    // Zone de survol invisible (hit area) couvrant tout l'engrenage
    // pour déclencher l'affichage du tooltip au mouseenter
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

  // ===== Génération du profil de dent (développante de cercle / involute) =====

  /**
   * Génère le chemin SVG (attribut "d") du profil complet de toutes les dents.
   *
   * Pour chaque dent, le profil est construit ainsi :
   *   1. Point dans le creux (fond de dent, rayon = rayonPiedEffectif)
   *   2. Pied du flanc gauche (jonction creux / développante)
   *   3. Flanc gauche : courbe en développante montant du rayon de base au rayon de tête
   *   4. Sommet de la dent (arc au rayon de tête)
   *   5. Flanc droit : développante descendante (symétrique, inversée)
   *   6. Pied du flanc droit (jonction développante / creux)
   *   7. Retour au creux suivant
   *
   * Le profil est fermé par la commande "Z" pour former un polygone plein.
   *
   * @private
   * @param {number} nbDents - Nombre de dents
   * @param {number} rayonBase - Rayon du cercle de base (origine de la développante)
   * @param {number} rayonTete - Rayon du cercle de tête (sommet des dents)
   * @param {number} rayonPiedEffectif - Rayon effectif du pied de dent (max(Rb, Rpied))
   * @returns {string} La chaîne du chemin SVG ("M ... L ... Z")
   */
  _generateToothProfile(nbDents, rayonBase, rayonTete, rayonPiedEffectif) {
    const points = [];
    // Pas angulaire entre deux dents consécutives
    const angularPitch = (2 * Math.PI) / nbDents;
    // Demi-angle de la dent (chaque dent occupe la moitié du pas angulaire)
    const halfToothAngle = angularPitch / 4;

    for (let i = 0; i < nbDents; i++) {
      // Angle de base de la dent courante (centre de la dent)
      const baseAngle = i * angularPitch;

      // Calcul des points de développante pour le flanc gauche de la dent
      // direction = 1 : flanc dans le sens trigonométrique positif
      const leftFlank = this._involutePoints(rayonBase, rayonTete, baseAngle - halfToothAngle, 1, 8);
      // Calcul des points de développante pour le flanc droit de la dent
      // direction = -1 : flanc dans le sens trigonométrique négatif
      const rightFlank = this._involutePoints(rayonBase, rayonTete, baseAngle + halfToothAngle, -1, 8);

      // Construction du profil de la dent : creux -> flanc gauche -> sommet -> flanc droit -> creux
      if (leftFlank.length > 0 && rightFlank.length > 0) {
        // Point de départ : fond du creux précédant la dent
        const creux1Angle = baseAngle - angularPitch / 2;
        const creux1 = {
          x: rayonPiedEffectif * Math.cos(creux1Angle),
          y: rayonPiedEffectif * Math.sin(creux1Angle)
        };
        points.push(creux1);

        // Pied du flanc gauche : point de transition entre le creux et la développante
        const piedGaucheAngle = baseAngle - halfToothAngle;
        points.push({
          x: rayonPiedEffectif * Math.cos(piedGaucheAngle),
          y: rayonPiedEffectif * Math.sin(piedGaucheAngle)
        });

        // Flanc gauche (montée) : série de points le long de la courbe involute
        points.push(...leftFlank);

        // Sommet de la dent (point au rayon de tête, au centre angulaire de la dent)
        const sommetAngle = baseAngle;
        points.push({
          x: rayonTete * Math.cos(sommetAngle),
          y: rayonTete * Math.sin(sommetAngle)
        });

        // Flanc droit (descente) : développante inversée (points en ordre inverse)
        points.push(...rightFlank.reverse());

        // Pied du flanc droit : transition développante -> creux
        const piedDroitAngle = baseAngle + halfToothAngle;
        points.push({
          x: rayonPiedEffectif * Math.cos(piedDroitAngle),
          y: rayonPiedEffectif * Math.sin(piedDroitAngle)
        });
      }
    }

    if (points.length === 0) return "";

    // Construction de la chaîne SVG path : M (moveto) suivi de L (lineto) pour chaque point
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    d += " Z";
    return d;
  }

  /**
   * Calcule les points d'une courbe en développante de cercle (involute curve).
   *
   * La développante de cercle est la trajectoire décrite par l'extrémité d'un
   * fil que l'on déroule d'un cylindre (le cercle de base). Elle est utilisée
   * comme profil de flanc de dent dans les engrenages normalisés car elle
   * garantit un rapport de transmission constant.
   *
   * Équations paramétriques (paramètre t) :
   *   - r(t) = Rb * sqrt(1 + t²)    (rayon polaire)
   *   - theta(t) = t - arctan(t)     (angle d'involute)
   *
   * Le paramètre t varie de 0 (au cercle de base) à tMax (au cercle de tête).
   * tMax = sqrt((Ra/Rb)² - 1) où Ra est le rayon de tête.
   *
   * @private
   * @param {number} rb - Rayon du cercle de base
   * @param {number} ra - Rayon du cercle de tête (limite extérieure)
   * @param {number} baseAngle - Angle de départ de la courbe (radians)
   * @param {number} direction - Sens de la développante (+1 ou -1)
   * @param {number} numPoints - Nombre de points d'échantillonnage sur la courbe
   * @returns {Array<{x: number, y: number}>} Points de la courbe en coordonnées cartésiennes
   */
  _involutePoints(rb, ra, baseAngle, direction, numPoints) {
    const pts = [];
    // tMax : valeur maximale du paramètre pour atteindre le rayon de tête
    // Dérivé de r = Rb * sqrt(1 + t²) => t = sqrt((Ra/Rb)² - 1)
    const tMax = Math.sqrt((ra / rb) ** 2 - 1);

    for (let i = 0; i <= numPoints; i++) {
      // Paramètre t uniformément distribué entre 0 et tMax
      const t = (tMax * i) / numPoints;
      // Rayon polaire : distance du point au centre de l'engrenage
      const r = rb * Math.sqrt(1 + t * t);
      if (r > ra) break;

      // Angle d'involute : décalage angulaire dû au déroulement du fil
      // inv(t) = t - arctan(t), aussi appelé "fonction involute"
      const invAngle = t - Math.atan(t);
      // Angle final : angle de base + direction * angle d'involute
      const angle = baseAngle + direction * invAngle;
      pts.push({
        x: r * Math.cos(angle),
        y: r * Math.sin(angle)
      });
    }
    return pts;
  }

  // ===== Tooltip (info-bulle interactive) =====

  /**
   * Ajoute une zone de survol invisible (hit area) avec tooltip sur un groupe SVG.
   * Utilisée par les types de transmission spéciaux (vis sans fin, conique, etc.)
   * qui n'utilisent pas directement drawGear.
   *
   * @private
   * @param {SVGGElement} group - Le groupe SVG auquel ajouter la zone de survol
   * @param {number} cx - Coordonnée X du centre de la zone (espace local du groupe)
   * @param {number} cy - Coordonnée Y du centre de la zone (espace local du groupe)
   * @param {number} rayon - Rayon de la zone circulaire de détection
   * @param {Array<string>} tooltipLines - Lignes de texte à afficher dans le tooltip
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

  /**
   * Affiche le tooltip avec plusieurs lignes de texte.
   * Chaque ligne est rendue comme un <tspan> distinct dans l'élément <text>.
   * Le fond (rect) est dimensionné automatiquement pour englober toutes les lignes.
   *
   * @private
   * @param {number} x - Position X du tooltip (espace SVG)
   * @param {number} y - Position Y du tooltip (espace SVG)
   * @param {Array<string>} lines - Lignes de texte à afficher
   */
  _showTooltipLines(x, y, lines) {
    const text = this.tooltip.querySelector(".tooltip-text");
    const bg = this.tooltip.querySelector(".tooltip-bg");

    // Suppression des anciens <tspan>
    while (text.firstChild) text.removeChild(text.firstChild);

    // Création d'un <tspan> par ligne avec espacement vertical (dy=14)
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(this.svgNS, "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? 0 : 14);
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    text.setAttribute("x", x);
    text.setAttribute("y", y - 30);

    // Dimensionnement du fond du tooltip (estimation statique de la taille du texte)
    const textBBox = { width: 140, height: lines.length * 14 + 8 };
    bg.setAttribute("x", x - textBBox.width / 2 - 5);
    bg.setAttribute("y", y - 35 - textBBox.height / 2);
    bg.setAttribute("width", textBBox.width + 10);
    bg.setAttribute("height", textBBox.height + 4);

    this.tooltip.setAttribute("visibility", "visible");
  }

  /**
   * Affiche le tooltip standard d'un engrenage avec ses caractéristiques :
   * label, nombre de dents, module et diamètre primitif.
   *
   * @private
   * @param {number} x - Position X du tooltip (espace SVG)
   * @param {number} y - Position Y du tooltip (espace SVG)
   * @param {string} label - Label de l'engrenage
   * @param {number} nbDents - Nombre de dents
   * @param {number} mod - Module métrique
   * @param {number} rayonPrimitive - Rayon du cercle primitif
   */
  _showTooltip(x, y, label, nbDents, mod, rayonPrimitive) {
    const text = this.tooltip.querySelector(".tooltip-text");
    const bg = this.tooltip.querySelector(".tooltip-bg");

    const lines = [
      `${label} - ${nbDents} dents`,
      `Module: ${mod}`,
      `Ø primitif: ${(rayonPrimitive * 2).toFixed(1)} mm`
    ];

    // Suppression des anciens <tspan>
    while (text.firstChild) text.removeChild(text.firstChild);

    // Création des lignes du tooltip
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(this.svgNS, "tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? 0 : 14);
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    text.setAttribute("x", x);
    text.setAttribute("y", y - 30);

    // Dimensionnement du fond (estimation statique car getBBox n'est pas fiable avant le rendu)
    const textBBox = { width: 120, height: lines.length * 14 + 8 };
    bg.setAttribute("x", x - textBBox.width / 2 - 5);
    bg.setAttribute("y", y - 35 - textBBox.height / 2);
    bg.setAttribute("width", textBBox.width + 10);
    bg.setAttribute("height", textBBox.height + 4);

    this.tooltip.setAttribute("visibility", "visible");
  }

  /**
   * Masque le tooltip en le rendant invisible.
   * @private
   */
  _hideTooltip() {
    this.tooltip.setAttribute("visibility", "hidden");
  }

  // ===== Dessin spécifique par type de transmission =====

  /**
   * Dessine un engrenage intérieur (couronne + pignon interne).
   *
   * Un engrenage intérieur est composé d'une couronne (anneau avec dents internes)
   * et d'un pignon qui tourne à l'intérieur. Le pignon et la couronne tournent
   * dans le même sens (contrairement aux engrenages extérieurs).
   *
   * @param {number} cx - Coordonnée X du centre (espace SVG)
   * @param {number} cy - Coordonnée Y du centre (espace SVG)
   * @param {number} nbDentsPignon - Nombre de dents du pignon intérieur
   * @param {number} nbDentsCouronne - Nombre de dents de la couronne
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale (radians)
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGGElement} Le groupe SVG de l'engrenage intérieur
   */
  drawInternalGear(cx, cy, nbDentsPignon, nbDentsCouronne, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${(rotation || 0) * 180 / Math.PI})`);

    // Rayons primitifs de la couronne et du pignon
    const rCouronne = (mod * nbDentsCouronne) / 2;
    const rPignon = (mod * nbDentsPignon) / 2;

    // Couronne (anneau extérieur) : cercle épais représentant le corps de la couronne
    const anneau = document.createElementNS(this.svgNS, "circle");
    anneau.setAttribute("r", rCouronne + mod * 2);
    anneau.setAttribute("fill", "none");
    anneau.setAttribute("stroke", "#666");
    anneau.setAttribute("stroke-width", mod * 0.8);
    group.appendChild(anneau);

    // Cercle intérieur de la couronne : denture interne stylisée par un trait en pointillé
    const interieur = document.createElementNS(this.svgNS, "circle");
    interieur.setAttribute("r", rCouronne);
    interieur.setAttribute("fill", "none");
    interieur.setAttribute("stroke", color || "#fdebd0");
    interieur.setAttribute("stroke-width", mod * 1.5);
    interieur.setAttribute("stroke-dasharray", `${mod * 1.2},${mod * 0.6}`);
    group.appendChild(interieur);

    // Pignon central dessiné avec le profil en développante standard
    // Note : drawGear l'ajoute au mainGroup, on le retire pour le replacer dans notre groupe
    const entraxe = (rCouronne - rPignon);
    const pignonGroup = this.drawGear(0, 0, nbDentsPignon, mod, 20, 0, "", color);
    this.mainGroup.removeChild(pignonGroup);
    group.appendChild(pignonGroup);

    // Label de l'étage
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rCouronne - mod * 4);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif avec informations sur l'engrenage intérieur
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
   *
   * La vis sans fin est représentée par :
   *   - Une roue dentée (cercle avec dents simplifiées en traits radiaux)
   *   - Un cylindre horizontal (la vis) positionné au-dessus de la roue
   *   - Des filets en zigzag sur la vis pour représenter l'hélice
   *   - Un indicateur d'angle à 90° entre les axes
   *
   * Les axes de la vis et de la roue sont perpendiculaires (90°).
   *
   * @param {number} cx - Coordonnée X du centre de la roue (espace SVG)
   * @param {number} cy - Coordonnée Y du centre de la roue (espace SVG)
   * @param {number} nbFilets - Nombre de filets de la vis (1 à 4 typiquement)
   * @param {number} nbDentsRoue - Nombre de dents de la roue
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale (radians, non utilisé pour le schéma)
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGGElement} Le groupe SVG de la vis sans fin
   */
  drawWormGear(cx, cy, nbFilets, nbDentsRoue, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rRoue = (mod * nbDentsRoue) / 2;
    // Quotient de diamètre standard q=10, cohérent avec TransmissionTypeRegistry
    // Le diamètre de la vis = q * module
    const q = 10;
    const diamVis = q * mod;
    const rVis = diamVis / 2;

    // --- Roue dentée (vue de face) ---
    const roue = document.createElementNS(this.svgNS, "circle");
    roue.setAttribute("r", rRoue);
    roue.setAttribute("fill", color || "#fcf3cf");
    roue.setAttribute("stroke", "#666");
    roue.setAttribute("stroke-width", "0.5");
    group.appendChild(roue);

    // Dents de la roue (simplifiées : traits radiaux partant du cercle primitif)
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

    // --- Vis sans fin (vue de côté, positionnée au-dessus de la roue) ---
    // Position verticale de l'axe de la vis : au-dessus de la roue avec un espacement
    const visY = -rRoue - rVis - mod;
    // Longueur visible de la vis (proportionnelle au rayon de la roue)
    const longueurVis = rRoue * 0.8;

    // Corps cylindrique de la vis (rectangle arrondi)
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

    // Filets de la vis (zigzag) : représentation schématique de l'hélice
    // Le pas du zigzag dépend du nombre de filets
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

    // Axe de la vis (ligne horizontale en pointillé)
    const axeVis = document.createElementNS(this.svgNS, "line");
    axeVis.setAttribute("x1", -longueurVis); axeVis.setAttribute("y1", visY);
    axeVis.setAttribute("x2", longueurVis); axeVis.setAttribute("y2", visY);
    axeVis.setAttribute("stroke", "#999");
    axeVis.setAttribute("stroke-width", "0.3");
    axeVis.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeVis);

    // Indicateur d'angle 90° entre les axes de la vis et de la roue
    const angle90 = document.createElementNS(this.svgNS, "text");
    angle90.setAttribute("x", longueurVis * 0.7);
    angle90.setAttribute("y", visY + rVis + 8);
    angle90.setAttribute("font-size", "7");
    angle90.setAttribute("fill", "#999");
    angle90.textContent = "90\u00b0";
    group.appendChild(angle90);

    // Trou central de la roue
    const trou = document.createElementNS(this.svgNS, "circle");
    trou.setAttribute("r", rVis * 0.6);
    trou.setAttribute("fill", "#fafafa");
    trou.setAttribute("stroke", "#666");
    trou.setAttribute("stroke-width", "0.5");
    group.appendChild(trou);

    // Label de l'étage
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", rRoue + mod * 3);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif avec angle d'avance calculé : arctan(nb filets / q)
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
   * Dessine une transmission par courroie et poulie.
   *
   * La représentation comprend :
   *   - Deux poulies circulaires (menante à gauche, menée à droite)
   *   - Deux brins de courroie (tangentes externes entre les cercles)
   *   - Des gorges stylisées (cercles en pointillé)
   *   - Les trous centraux des axes
   *   - Les diamètres annotés et le label
   *
   * Le calcul des tangentes utilise la géométrie : pour deux cercles de rayons
   * rA et rB séparés d'une distance d, l'angle de la tangente externe est
   * sin(alpha) = (rB - rA) / d.
   *
   * @param {number} cx - Coordonnée X de la poulie menante (espace SVG)
   * @param {number} cy - Coordonnée Y de la poulie menante (espace SVG)
   * @param {number} diamA - Diamètre de la poulie menante (mm)
   * @param {number} diamB - Diamètre de la poulie menée (mm)
   * @param {number} mod - Module (utilisé uniquement pour le dimensionnement du label)
   * @param {number} rotation - Angle de rotation initiale (radians, non utilisé)
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage des poulies
   * @returns {{group: SVGGElement, entraxe: number}} Le groupe SVG et la distance entre axes
   */
  drawBeltPulley(cx, cy, diamA, diamB, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rA = diamA / 2;
    const rB = diamB / 2;
    // Entraxe : distance entre les centres des deux poulies (1.5x la somme des diamètres)
    const entraxe = (diamA + diamB) * 1.5;

    // --- Poulie menante (gauche) ---
    const poulieA = document.createElementNS(this.svgNS, "circle");
    poulieA.setAttribute("cx", 0); poulieA.setAttribute("cy", 0);
    poulieA.setAttribute("r", rA);
    poulieA.setAttribute("fill", color || "#fadbd8");
    poulieA.setAttribute("stroke", "#666");
    poulieA.setAttribute("stroke-width", "0.5");
    group.appendChild(poulieA);

    // Gorge de la poulie A (cercle intérieur en pointillé)
    const gorgeA = document.createElementNS(this.svgNS, "circle");
    gorgeA.setAttribute("cx", 0); gorgeA.setAttribute("cy", 0);
    gorgeA.setAttribute("r", rA * 0.85);
    gorgeA.setAttribute("fill", "none");
    gorgeA.setAttribute("stroke", "#999");
    gorgeA.setAttribute("stroke-width", "0.3");
    gorgeA.setAttribute("stroke-dasharray", "1,2");
    group.appendChild(gorgeA);

    // --- Poulie menée (droite) ---
    const poulieB = document.createElementNS(this.svgNS, "circle");
    poulieB.setAttribute("cx", entraxe); poulieB.setAttribute("cy", 0);
    poulieB.setAttribute("r", rB);
    poulieB.setAttribute("fill", color || "#fadbd8");
    poulieB.setAttribute("stroke", "#666");
    poulieB.setAttribute("stroke-width", "0.5");
    group.appendChild(poulieB);

    // Gorge de la poulie B (cercle intérieur en pointillé)
    const gorgeB = document.createElementNS(this.svgNS, "circle");
    gorgeB.setAttribute("cx", entraxe); gorgeB.setAttribute("cy", 0);
    gorgeB.setAttribute("r", rB * 0.85);
    gorgeB.setAttribute("fill", "none");
    gorgeB.setAttribute("stroke", "#999");
    gorgeB.setAttribute("stroke-width", "0.3");
    gorgeB.setAttribute("stroke-dasharray", "1,2");
    group.appendChild(gorgeB);

    // --- Courroie : calcul des tangentes externes ---
    // Pour deux cercles de rayons rA et rB distants de "entraxe",
    // les tangentes externes passent par les points de tangence définis par :
    //   sin(alpha) = (rB - rA) / entraxe
    //   cos(alpha) = sqrt(1 - sin²(alpha))
    const dy = rB - rA;
    const dist = entraxe;
    const sinA = dy / dist;
    const cosA = Math.sqrt(1 - sinA * sinA);

    // Brin supérieur de la courroie
    const brinSup = document.createElementNS(this.svgNS, "line");
    brinSup.setAttribute("x1", rA * sinA);
    brinSup.setAttribute("y1", -rA * cosA);
    brinSup.setAttribute("x2", entraxe + rB * sinA);
    brinSup.setAttribute("y2", -rB * cosA);
    brinSup.setAttribute("stroke", "#333");
    brinSup.setAttribute("stroke-width", "1");
    group.appendChild(brinSup);

    // Brin inférieur de la courroie
    const brinInf = document.createElementNS(this.svgNS, "line");
    brinInf.setAttribute("x1", -rA * sinA);
    brinInf.setAttribute("y1", rA * cosA);
    brinInf.setAttribute("x2", entraxe - rB * sinA);
    brinInf.setAttribute("y2", rB * cosA);
    brinInf.setAttribute("stroke", "#333");
    brinInf.setAttribute("stroke-width", "1");
    group.appendChild(brinInf);

    // Trous centraux des deux poulies (axes d'arbre)
    [{ x: 0, r: rA }, { x: entraxe, r: rB }].forEach(p => {
      const trou = document.createElementNS(this.svgNS, "circle");
      trou.setAttribute("cx", p.x); trou.setAttribute("cy", 0);
      trou.setAttribute("r", Math.max(1, p.r * 0.15));
      trou.setAttribute("fill", "#fafafa");
      trou.setAttribute("stroke", "#666");
      trou.setAttribute("stroke-width", "0.3");
      group.appendChild(trou);
    });

    // Labels de diamètre pour chaque poulie
    const lblA = document.createElementNS(this.svgNS, "text");
    lblA.setAttribute("x", 0); lblA.setAttribute("y", rA + 10);
    lblA.setAttribute("text-anchor", "middle");
    lblA.setAttribute("font-size", Math.max(6, rA * 0.3));
    lblA.setAttribute("fill", "#333");
    lblA.textContent = `\u00d8${diamA}`;
    group.appendChild(lblA);

    const lblB = document.createElementNS(this.svgNS, "text");
    lblB.setAttribute("x", entraxe); lblB.setAttribute("y", rB + 10);
    lblB.setAttribute("text-anchor", "middle");
    lblB.setAttribute("font-size", Math.max(6, rB * 0.2));
    lblB.setAttribute("fill", "#333");
    lblB.textContent = `\u00d8${diamB}`;
    group.appendChild(lblB);

    // Label général de l'étage (centré entre les deux poulies)
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", entraxe / 2);
    textElem.setAttribute("y", -Math.max(rA, rB) - 8);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif couvrant toute la zone de la transmission
    // (rectangle englobant les deux poulies et la courroie)
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
   *
   * Les engrenages coniques transmettent le mouvement entre deux axes à 90°.
   * La représentation utilise deux trapèzes (cônes tronqués vus de côté) :
   *   - Pignon (horizontal, entrée à gauche)
   *   - Roue (vertical, sortie en bas)
   * Un arc et un label "90°" indiquent l'angle entre les axes.
   *
   * @param {number} cx - Coordonnée X du point d'intersection des axes (espace SVG)
   * @param {number} cy - Coordonnée Y du point d'intersection des axes (espace SVG)
   * @param {number} nbDentsA - Nombre de dents du pignon (entrée)
   * @param {number} nbDentsB - Nombre de dents de la roue (sortie)
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale (radians, non utilisé pour le schéma)
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage
   * @returns {SVGGElement} Le groupe SVG de l'engrenage conique
   */
  drawBevelGear(cx, cy, nbDentsA, nbDentsB, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    const rA = (mod * nbDentsA) / 2;
    const rB = (mod * nbDentsB) / 2;

    // Cône du pignon (horizontal, forme trapézoïdale)
    // Large à gauche (côté entrée), rétréci vers le point de contact à droite
    const pignon = document.createElementNS(this.svgNS, "polygon");
    pignon.setAttribute("points", `${-rA},${-rA} ${rA * 0.5},${-rA * 0.2} ${rA * 0.5},${rA * 0.2} ${-rA},${rA}`);
    pignon.setAttribute("fill", color || "#e8daef");
    pignon.setAttribute("stroke", "#666");
    pignon.setAttribute("stroke-width", "0.5");
    group.appendChild(pignon);

    // Cône de la roue (vertical, forme trapézoïdale)
    // Rétréci en haut (côté point de contact), large en bas (côté sortie)
    const roue = document.createElementNS(this.svgNS, "polygon");
    roue.setAttribute("points", `${-rB * 0.2},${rB * 0.5} ${rB * 0.2},${rB * 0.5} ${rB},${rB + rA} ${-rB},${rB + rA}`);
    roue.setAttribute("fill", color || "#e8daef");
    roue.setAttribute("stroke", "#666");
    roue.setAttribute("stroke-width", "0.5");
    roue.setAttribute("opacity", "0.8");
    group.appendChild(roue);

    // Arc indicateur 90° entre les axes du pignon et de la roue
    // Arc SVG de rayon arcR, du point (arcR,0) au point (0,arcR), sens horaire
    const arc90 = document.createElementNS(this.svgNS, "path");
    const arcR = Math.min(rA, rB) * 0.4;
    arc90.setAttribute("d", `M ${arcR},0 A ${arcR},${arcR} 0 0,1 0,${arcR}`);
    arc90.setAttribute("fill", "none");
    arc90.setAttribute("stroke", "#999");
    arc90.setAttribute("stroke-width", "0.5");
    group.appendChild(arc90);

    // Label "90°" à côté de l'arc
    const txt90 = document.createElementNS(this.svgNS, "text");
    txt90.setAttribute("x", arcR + 3); txt90.setAttribute("y", arcR + 3);
    txt90.setAttribute("font-size", "7"); txt90.setAttribute("fill", "#999");
    txt90.textContent = "90\u00b0";
    group.appendChild(txt90);

    // Axe horizontal (pignon) en pointillé
    const axeH = document.createElementNS(this.svgNS, "line");
    axeH.setAttribute("x1", -rA * 1.5); axeH.setAttribute("y1", 0);
    axeH.setAttribute("x2", rA); axeH.setAttribute("y2", 0);
    axeH.setAttribute("stroke", "#bbb"); axeH.setAttribute("stroke-width", "0.3");
    axeH.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeH);

    // Axe vertical (roue) en pointillé
    const axeV = document.createElementNS(this.svgNS, "line");
    axeV.setAttribute("x1", 0); axeV.setAttribute("y1", rB * 0.3);
    axeV.setAttribute("x2", 0); axeV.setAttribute("y2", rB + rA + rB * 0.3);
    axeV.setAttribute("stroke", "#bbb"); axeV.setAttribute("stroke-width", "0.3");
    axeV.setAttribute("stroke-dasharray", "3,2");
    group.appendChild(axeV);

    // Label de l'étage
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rA - 8);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
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
   *
   * Un train épicycloïdal est composé de :
   *   - Un solaire central (engrenage avec profil en développante)
   *   - Une couronne extérieure (anneau fixe avec denture interne)
   *   - Des satellites (3 par défaut) disposés symétriquement entre le solaire et la couronne
   *   - Un porte-satellites (cercle en pointillé montrant l'orbite des satellites)
   *
   * Le rapport de réduction est : i = 1 + Zcouronne / Zsolaire
   * (avec couronne fixe et porte-satellites en sortie).
   *
   * Contrainte géométrique : le nombre de dents du satellite est
   * Zsat = (Zcouronne - Zsolaire) / 2.
   *
   * @param {number} cx - Coordonnée X du centre (espace SVG)
   * @param {number} cy - Coordonnée Y du centre (espace SVG)
   * @param {number} dentsSolaire - Nombre de dents du solaire
   * @param {number} dentsCouronne - Nombre de dents de la couronne
   * @param {number} mod - Module métrique
   * @param {number} rotation - Angle de rotation initiale (radians)
   * @param {string} label - Label de l'étage
   * @param {string} color - Couleur de remplissage du solaire
   * @returns {SVGGElement} Le groupe SVG du train épicycloïdal
   */
  drawEpicyclicGear(cx, cy, dentsSolaire, dentsCouronne, mod, rotation, label, color) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("transform", `translate(${cx}, ${cy})`);

    // Rayons primitifs des composants
    const rSolaire = (mod * dentsSolaire) / 2;
    const rCouronne = (mod * dentsCouronne) / 2;
    // Nombre de dents du satellite : déduit de la contrainte géométrique
    const dentsSatellite = (dentsCouronne - dentsSolaire) / 2;
    const rSatellite = (mod * dentsSatellite) / 2;
    // Rayon orbital des satellites : centre du satellite sur ce cercle
    const rOrbiteSat = rSolaire + rSatellite;

    // Couronne extérieure (anneau épais représentant le corps de la couronne)
    const couronne = document.createElementNS(this.svgNS, "circle");
    couronne.setAttribute("r", rCouronne + mod);
    couronne.setAttribute("fill", "none");
    couronne.setAttribute("stroke", "#555");
    couronne.setAttribute("stroke-width", mod * 1.5);
    group.appendChild(couronne);

    // Denture intérieure de la couronne (représentée par un trait en pointillé)
    const couronneInt = document.createElementNS(this.svgNS, "circle");
    couronneInt.setAttribute("r", rCouronne);
    couronneInt.setAttribute("fill", "none");
    couronneInt.setAttribute("stroke", "#999");
    couronneInt.setAttribute("stroke-width", mod * 0.5);
    couronneInt.setAttribute("stroke-dasharray", `${mod * 0.8},${mod * 0.5}`);
    group.appendChild(couronneInt);

    // Solaire central (engrenage avec profil en développante)
    // Note : drawGear l'ajoute au mainGroup, on le retire pour le replacer dans notre groupe
    const solaireGroup = this.drawGear(0, 0, dentsSolaire, mod, 20, 0, "", color || "#d6eaf8");
    this.mainGroup.removeChild(solaireGroup);
    group.appendChild(solaireGroup);

    // Satellites (3 par défaut, disposés à 120° les uns des autres)
    const nbSat = 3;
    for (let s = 0; s < nbSat; s++) {
      const angle = (2 * Math.PI * s) / nbSat;
      const satX = rOrbiteSat * Math.cos(angle);
      const satY = rOrbiteSat * Math.sin(angle);

      // Chaque satellite utilise un module légèrement réduit (0.9x) pour le rendu visuel
      // Minimum 6 dents pour éviter les problèmes de sous-coupe
      const satGroup = this.drawGear(satX, satY, Math.max(6, Math.round(dentsSatellite)), mod * 0.9, 20, 0, "", "#fef9e7");
      this.mainGroup.removeChild(satGroup);
      group.appendChild(satGroup);
    }

    // Porte-satellites (cercle en pointillé montrant l'orbite des centres des satellites)
    const porteSat = document.createElementNS(this.svgNS, "circle");
    porteSat.setAttribute("r", rOrbiteSat);
    porteSat.setAttribute("fill", "none");
    porteSat.setAttribute("stroke", "#aaa");
    porteSat.setAttribute("stroke-width", "0.5");
    porteSat.setAttribute("stroke-dasharray", "4,3");
    group.appendChild(porteSat);

    // Label de l'étage
    const textElem = document.createElementNS(this.svgNS, "text");
    textElem.setAttribute("x", 0);
    textElem.setAttribute("y", -rCouronne - mod * 3);
    textElem.setAttribute("text-anchor", "middle");
    textElem.setAttribute("font-size", Math.max(8, mod * 2.5));
    textElem.setAttribute("font-weight", "bold");
    textElem.setAttribute("fill", "#333");
    textElem.textContent = label;
    group.appendChild(textElem);

    // Tooltip interactif avec informations du train épicycloïdal
    this._addTooltipHitArea(group, 0, 0, rCouronne + mod, [
      `${label} - Train \u00e9picyclo\u00efdal`,
      `Solaire: ${dentsSolaire} dents, Couronne: ${dentsCouronne} dents`,
      `Satellite: ${Math.round(dentsSatellite)} dents`,
      `Rapport: ${(1 + dentsCouronne / dentsSolaire).toFixed(3)}`
    ]);

    this.mainGroup.appendChild(group);
    return group;
  }

  // ===== Dessin du train complet (multi-types) =====

  /**
   * Dessine un train de transmission complet, supportant différents types par étage.
   *
   * Parcourt chaque étage de la solution et appelle la méthode de dessin
   * appropriée selon le type de transmission :
   *   - 'spur' / 'helical' : paire d'engrenages droits/hélicoïdaux (drawGear x2)
   *   - 'internal' : engrenage intérieur couronne + pignon (drawInternalGear)
   *   - 'bevel' : engrenages coniques à 90° (drawBevelGear)
   *   - 'belt' : transmission par courroie et poulie (drawBeltPulley)
   *   - 'epicyclic' : train épicycloïdal (drawEpicyclicGear)
   *   - 'worm' : vis sans fin (drawWormGear)
   *
   * Après le dessin, des labels "ENTREE" et "SORTIE" sont ajoutés,
   * et le viewBox est ajusté pour cadrer l'ensemble du train.
   *
   * @param {Array<Array<number|string>>} solution - Tableau d'étages, chacun au format
   *   [A, B, typeId?] où A et B sont les nombres de dents (ou diamètres pour belt),
   *   et typeId est le type de transmission (par défaut 'spur').
   * @param {number} mod - Module métrique des engrenages (par défaut 2)
   * @param {number} angleContact - Angle de pression en degrés (par défaut 20)
   */
  drawGearTrain(solution, mod, angleContact) {
    this.clear();
    this.gearData = [];

    mod = mod || 2;
    angleContact = angleContact || 20;

    // Lettres de désignation des engrenages (A, B, C, D, ...)
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // Position courante de dessin (avance de gauche à droite)
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

      // Labels pour les engrenages de cet étage
      const labelA = `${letters[gearIndex]}: ${A} ${type.uniteA}`;
      const labelB = `${letters[gearIndex + 1]}: ${B} ${type.uniteB}`;
      const stageLabel = `${type.icone} ${letters[gearIndex]}${letters[gearIndex + 1]}`;

      // Rotations initiales : le mené tourne dans le sens inverse du menant (pour engrenages extérieurs)
      const rotA = prevRotation;
      const rotB = -rotA * (A / B);

      let stageGroup, maxR, stageCx2;

      // --- Dessin selon le type de transmission ---

      if (typeId === 'belt') {
        // Courroie et poulie : A et B sont des diamètres
        const result = this.drawBeltPulley(cx, cy, A, B, mod, 0, stageLabel, color);
        stageGroup = result.group;
        const entraxe = result.entraxe;
        stageCx2 = cx + entraxe;
        maxR = Math.max(A, B) / 2;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx: stageCx2, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'worm') {
        // Vis sans fin : A = nombre de filets, B = nombre de dents de la roue
        stageGroup = this.drawWormGear(cx, cy, A, B, mod, 0, stageLabel, color);
        const rRoue = (mod * B) / 2;
        stageCx2 = cx;
        maxR = rRoue + mod * A * 3;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'epicyclic') {
        // Train épicycloïdal : A = dents solaire, B = dents couronne (coaxial)
        stageGroup = this.drawEpicyclicGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx; // Coaxial : entrée et sortie sur le même axe
        maxR = (mod * B) / 2 + mod * 2;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'bevel') {
        // Engrenage conique : axes à 90°
        stageGroup = this.drawBevelGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = Math.max((mod * A) / 2, (mod * B) / 2) + mod;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else if (typeId === 'internal') {
        // Engrenage intérieur : pignon à l'intérieur de la couronne
        stageGroup = this.drawInternalGear(cx, cy, A, B, mod, 0, stageLabel, color);
        stageCx2 = cx;
        maxR = (mod * B) / 2 + mod * 3;
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: A, typeId, rotation: 0 });
        this.gearData.push({ group: stageGroup, cx, cy, nbDents: B, typeId, rotation: 0 });

      } else {
        // Engrenage droit (spur) ou hélicoïdal (helical) : même rendu visuel SVG
        // Deux engrenages côte à côte avec profil en développante
        const rA = (mod * A) / 2;
        const rB = (mod * B) / 2;
        const entraxe = rA + rB;

        const gearAGroup = this.drawGear(cx, cy, A, mod, angleContact, rotA, labelA, color);
        this.gearData.push({ group: gearAGroup, cx, cy, nbDents: A, typeId, rotation: rotA });

        const gearBCx = cx + entraxe;
        const gearBGroup = this.drawGear(gearBCx, cy, B, mod, angleContact, rotB, labelB, color);
        this.gearData.push({ group: gearBGroup, cx: gearBCx, cy, nbDents: B, typeId, rotation: rotB });

        // Ligne de cote montrant l'entraxe
        this._drawDimensionLine(cx, cy + rA + 10, gearBCx, cy + rA + 10, `${entraxe.toFixed(1)} mm`);

        stageCx2 = gearBCx;
        maxR = Math.max(rA, rB);

        // Label supplémentaire pour les engrenages hélicoïdaux
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

      // Badge de type (petit label au-dessus de l'étage indiquant le type de transmission)
      const typeBadge = document.createElementNS(this.svgNS, "text");
      typeBadge.setAttribute("x", (cx + (stageCx2 || cx)) / 2);
      typeBadge.setAttribute("y", cy - (maxR || 30) - mod * 5);
      typeBadge.setAttribute("text-anchor", "middle");
      typeBadge.setAttribute("font-size", "6");
      typeBadge.setAttribute("fill", "#aaa");
      typeBadge.textContent = `\u2500 ${type.nomCourt} \u2500`;
      this.mainGroup.appendChild(typeBadge);

      // --- Avancement horizontal pour l'étage suivant ---
      // L'espacement dépend du type de transmission (les types coaxiaux
      // nécessitent plus d'espace, les engrenages droits partagent un axe)
      if (i < solution.length - 1) {
        if (typeId === 'belt') {
          cx = stageCx2 + 20;
        } else if (typeId === 'worm' || typeId === 'bevel') {
          cx += (maxR || 50) + 40;
        } else if (typeId === 'epicyclic' || typeId === 'internal') {
          cx += (maxR || 50) * 2 + 20;
        } else {
          // Engrenage droit/hélicoïdal : l'engrenage mené de cet étage partage
          // le même axe que le menant de l'étage suivant
          cx = stageCx2;
        }
        prevRotation = rotB;
      }

      gearIndex += 2;
    }

    // --- Labels ENTREE / SORTIE ---
    // Positionnés sous le premier et le dernier engrenage du train
    const firstData = this.gearData[0];
    const lastData = this.gearData[this.gearData.length - 1];
    if (firstData && lastData) {
      const firstR = (mod * firstData.nbDents) / 2;
      const lastR = (mod * lastData.nbDents) / 2;
      this._drawIOLabel(firstData.cx, firstData.cy + Math.max(firstR, 30) + 25, "ENTR\u00c9E", "#2ecc71");
      this._drawIOLabel(lastData.cx, lastData.cy + Math.max(lastR, 30) + 25, "SORTIE", "#e74c3c");
    }

    // Ajuster le viewBox pour cadrer l'ensemble du train
    this._fitViewBox();

    // Sauvegarder les paramètres pour l'animation et le redessin
    this._currentSolution = solution;
    this._currentMod = mod;
    this._currentAngleContact = angleContact;
  }

  // ===== Éléments de cotation et d'annotation =====

  /**
   * Dessine une ligne de cote (cotation) entre deux points avec un label textuel.
   * La ligne est en pointillé avec des flèches aux extrémités.
   *
   * @private
   * @param {number} x1 - Coordonnée X du point de départ
   * @param {number} y1 - Coordonnée Y du point de départ
   * @param {number} x2 - Coordonnée X du point d'arrivée
   * @param {number} y2 - Coordonnée Y du point d'arrivée
   * @param {string} label - Texte de la cote (ex: "45.0 mm")
   */
  _drawDimensionLine(x1, y1, x2, y2, label) {
    const group = document.createElementNS(this.svgNS, "g");
    group.setAttribute("class", "dimension");

    // Ligne de cote principale en pointillé
    const line = document.createElementNS(this.svgNS, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#888");
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("stroke-dasharray", "4,2");
    group.appendChild(line);

    // Flèches triangulaires aux extrémités (pointant vers l'intérieur)
    const arrowSize = 3;
    [{ x: x1, dir: 1 }, { x: x2, dir: -1 }].forEach(({ x, dir }) => {
      const arrow = document.createElementNS(this.svgNS, "polygon");
      arrow.setAttribute("points", `${x},${y1} ${x + dir * arrowSize},${y1 - arrowSize} ${x + dir * arrowSize},${y1 + arrowSize}`);
      arrow.setAttribute("fill", "#888");
      group.appendChild(arrow);
    });

    // Texte de la cote (centré sous la ligne)
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

  /**
   * Dessine un label ENTREE ou SORTIE sous forme de rectangle coloré avec texte.
   *
   * @private
   * @param {number} cx - Coordonnée X du centre du label
   * @param {number} cy - Coordonnée Y du bord supérieur du label
   * @param {string} text - Texte du label ("ENTREE" ou "SORTIE")
   * @param {string} color - Couleur de fond du rectangle (vert pour entrée, rouge pour sortie)
   */
  _drawIOLabel(cx, cy, text, color) {
    const group = document.createElementNS(this.svgNS, "g");

    // Rectangle de fond arrondi avec opacité
    const rect = document.createElementNS(this.svgNS, "rect");
    rect.setAttribute("x", cx - 30);
    rect.setAttribute("y", cy);
    rect.setAttribute("width", 60);
    rect.setAttribute("height", 22);
    rect.setAttribute("rx", 4);
    rect.setAttribute("fill", color);
    rect.setAttribute("opacity", "0.8");
    group.appendChild(rect);

    // Texte blanc centré dans le rectangle
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

  /**
   * Ajuste le viewBox du SVG pour cadrer l'ensemble des engrenages dessinés.
   * Calcule les bornes min/max de tous les engrenages et ajoute un padding.
   * @private
   */
  _fitViewBox() {
    if (this.gearData.length === 0) return;

    // Calcul des bornes englobantes de tous les engrenages
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.gearData.forEach(g => {
      // Rayon total = rayon primitif + marge (2 modules pour les dents et l'espace)
      const r = (this._currentMod * g.nbDents) / 2 + this._currentMod * 2;
      minX = Math.min(minX, g.cx - r);
      minY = Math.min(minY, g.cy - r);
      maxX = Math.max(maxX, g.cx + r);
      maxY = Math.max(maxY, g.cy + r);
    });

    // Ajout d'un padding autour de la zone d'engrenages
    const padding = 60;
    this.viewBox = {
      x: minX - padding,
      y: minY - padding,
      w: maxX - minX + 2 * padding,
      h: maxY - minY + 2 * padding + 30
    };
    this._updateViewBox();
  }

  // ===== Animation de rotation =====

  /**
   * Bascule l'état de l'animation (démarrer si arrêtée, arrêter si en cours).
   */
  toggleAnimation() {
    if (this.isAnimating) {
      this.stopAnimation();
    } else {
      this.startAnimation();
    }
  }

  /**
   * Démarre l'animation de rotation des engrenages.
   * L'animation utilise requestAnimationFrame pour un rendu fluide.
   * Chaque engrenage tourne à une vitesse proportionnelle au rapport cumulé
   * des étages précédents, avec un sens de rotation correct par type.
   */
  startAnimation() {
    if (!this._currentSolution || this.isAnimating) return;
    this.isAnimating = true;
    this.animationAngle = 0;
    this._animate();
  }

  /**
   * Arrête l'animation de rotation.
   */
  stopAnimation() {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Calcule le rapport de transmission d'un étage donné en utilisant
   * la formule correcte selon le type de transmission.
   *
   * Pour un train épicycloïdal (couronne fixe) : i = 1 + Zcouronne / Zsolaire
   * Pour tous les autres types : i = B / A
   *
   * @private
   * @param {number} stageIndex - Indice de l'étage dans la solution (0-based)
   * @returns {number} Le rapport de transmission de l'étage
   */
  _stageRatio(stageIndex) {
    const [A, B, typeId] = this._currentSolution[stageIndex];
    if (typeId === 'epicyclic') return 1 + B / A;
    return B / A; // spur, helical, internal, bevel, belt, worm
  }

  /**
   * Boucle d'animation principale. Appelée récursivement via requestAnimationFrame.
   *
   * Pour chaque engrenage :
   *   1. Calcule le rapport cumulé de tous les étages précédents
   *   2. Détermine le sens de rotation selon le type de chaque étage traversé
   *   3. Applique la rotation via une transformation SVG translate + rotate
   *
   * Règles de sens de rotation :
   *   - spur, helical, bevel, worm : inversion du sens à chaque étage (engrenages extérieurs)
   *   - internal, belt, epicyclic : même sens (pas d'inversion)
   *
   * @private
   */
  _animate() {
    if (!this.isAnimating) return;

    // Incrémentation de l'angle de base (vitesse de l'engrenage d'entrée)
    this.animationAngle += 0.02;

    this.gearData.forEach((gear, index) => {
      // Chaque paire d'engrenages forme un étage (indices 0-1, 2-3, 4-5, ...)
      const pairIndex = Math.floor(index / 2);
      const isDriver = index % 2 === 0;

      // Calcul du rapport cumulé jusqu'à cet engrenage
      // Le rapport cumulé détermine la vitesse angulaire relative
      let cumulRatio = 1;
      for (let i = 0; i < pairIndex; i++) {
        cumulRatio *= this._stageRatio(i);
      }
      if (!isDriver) {
        cumulRatio *= this._stageRatio(pairIndex);
      }

      // Vitesse angulaire inversée par rapport au rapport cumulé
      const typeId = this._currentSolution[pairIndex] ? this._currentSolution[pairIndex][2] || 'spur' : 'spur';

      // Calcul du signe de rotation : on traverse chaque étage et on applique
      // l'inversion de sens uniquement pour les types à engrenages extérieurs
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

      // Application de la rotation via la transformation SVG
      // L'angle est inversement proportionnel au rapport cumulé (plus le rapport
      // est élevé, plus l'engrenage tourne lentement)
      const angleDeg = (this.animationAngle / cumulRatio) * sensSign * (180 / Math.PI);
      gear.group.setAttribute("transform", `translate(${gear.cx}, ${gear.cy}) rotate(${angleDeg})`);
    });

    // Planification de la prochaine frame d'animation
    this.animationId = requestAnimationFrame(() => this._animate());
  }

  // ===== Nettoyage =====

  /**
   * Efface tous les éléments du SVG et réinitialise les données.
   * Arrête l'animation si elle est en cours.
   */
  clear() {
    this.stopAnimation();
    while (this.mainGroup.firstChild) {
      this.mainGroup.removeChild(this.mainGroup.firstChild);
    }
    this.gearData = [];
    this.gearElements = [];
  }

  // ===== Export =====

  /**
   * Exporte le contenu SVG en tant que chaîne XML sérialisée.
   * Utile pour sauvegarder le schéma ou l'intégrer dans un document.
   *
   * @returns {string} Le SVG sérialisé en chaîne XML complète
   */
  exportSVG() {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(this.svg);
  }

  /**
   * Exporte le SVG en image PNG via un canvas temporaire.
   *
   * Processus :
   *   1. Sérialise le SVG en XML
   *   2. Crée un Blob SVG et une URL d'objet
   *   3. Charge l'image SVG dans un élément Image
   *   4. Dessine l'image sur un canvas temporaire (avec mise à l'échelle)
   *   5. Convertit le canvas en Blob PNG via toBlob()
   *   6. Appelle le callback avec le Blob résultant
   *
   * @param {function(Blob): void} callback - Fonction appelée avec le Blob PNG résultant
   * @param {number} [scale=2] - Facteur de mise à l'échelle pour la résolution (2 = double)
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

  // ===== Navigation =====

  /**
   * Réinitialise le zoom et le pan pour cadrer le train d'engrenages complet.
   */
  resetView() {
    this._fitViewBox();
  }
}

// Exposition globale pour compatibilité avec le chargement par balises <script>
window.GearSVG = GearSVG;
