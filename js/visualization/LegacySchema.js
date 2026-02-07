/**
 * @module visualization/LegacySchema
 * @description Schéma Canvas 2D des trains d'engrenages (wrapper OOP du code legacy).
 *
 * Ce module encapsule le code legacy de rendu de schémas d'engrenages dans une
 * classe prototypale, intégrée au namespace GearApp.visualization.
 *
 * Le schéma est dessiné sur un élément <canvas> HTML avec l'API Canvas 2D.
 * Il représente un train d'engrenages en vue schématique simplifiée :
 *   - Chaque engrenage est un trait horizontal proportionnel au nombre de dents
 *   - Les engrenages d'un même étage sont côte à côte horizontalement
 *   - Les étages sont reliés par des liaisons verticales
 *   - Les labels IN et OUT marquent l'entrée et la sortie
 *   - Si un module est défini, les entraxes sont affichés en mm
 *
 * Ce module est conservé pour la compatibilité avec l'ancien rendu Canvas.
 * Le rendu SVG interactif (GearSVG) est désormais privilégié.
 *
 * @see {@link module:GearSVG} pour le rendu SVG interactif (remplacement moderne)
 */
(function (GearApp) {

  // ===== Constructeur =====

  /**
   * Crée un nouveau schéma Canvas pour les trains d'engrenages.
   *
   * Initialise le contexte de dessin 2D et les constantes de mise en page
   * utilisées pour positionner les éléments du schéma.
   *
   * @class LegacySchema
   * @param {string} canvasId - L'identifiant de l'élément <canvas> HTML
   */
  function LegacySchema(canvasId) {
    /** @type {HTMLCanvasElement|null} L'élément canvas du DOM */
    this._canvas = document.getElementById(canvasId);
    if (!this._canvas) return;

    /** @type {CanvasRenderingContext2D} Le contexte de dessin 2D */
    this._ctx = this._canvas.getContext("2d");
    this._ctx.strokeStyle = "#000";
    this._ctx.lineWidth = 2;

    // ===== Constantes de mise en page =====

    /** @type {number} Facteur de mise à l'échelle des engrenages (pixels par dent) */
    this.DEFAULT_FACTOR = 3;
    /** @type {number} Espacement horizontal entre deux engrenages d'un même étage (pixels) */
    this.SMALL_GAP = 2;
    /** @type {number} Décalage horizontal supplémentaire entre étages (pixels) */
    this.HORIZ_OFFSET = 0;
    /** @type {number} Espacement vertical entre étages successifs (pixels) */
    this.VERT_GAP = 15;
    /** @type {number} Position X initiale du premier engrenage (pixels) */
    this.INITIAL_X = 50;
    /** @type {number} Position Y initiale du premier étage (pixels) */
    this.INITIAL_Y = 20;
    /** @type {number} Largeur des rectangles de labels IN/OUT (pixels) */
    this.RECT_WIDTH = 50;
    /** @type {number} Hauteur des rectangles de labels IN/OUT (pixels) */
    this.RECT_HEIGHT = 30;
    /** @type {number} Hauteur du pied en T de chaque engrenage (pixels) */
    this.T_HEIGHT = 7;
    /** @type {number} Marge inférieure pour les labels IN/OUT (pixels) */
    this.BOTTOM_MARGIN = 10;
  }

  // ===== Méthode publique principale =====

  /**
   * Affiche une solution de train d'engrenages sur le canvas.
   *
   * Convertit la solution (tableau de tuples [A, B, typeId?]) en tableau
   * d'objets engrenage, puis dessine l'assemblage complet.
   *
   * @param {Array<Array<number|string>>} solution - La solution au format
   *   [[A1, B1, type?], [A2, B2, type?], ...] où A et B sont les nombres de dents
   */
  LegacySchema.prototype.displaySolution = function (solution) {
    if (!this._canvas || !solution) return;
    var gears = this._convertSolutionToGears(solution);
    this._drawAdaptiveAssembly(gears);
  };

  // ===== Méthodes utilitaires de calcul =====

  /**
   * Calcule la longueur visuelle d'un engrenage (en pixels) à partir de son nombre de dents.
   * Longueur = nombre de dents * facteur d'échelle.
   *
   * @private
   * @param {{name: string, teeth: number}} gear - L'objet engrenage
   * @returns {number} La longueur en pixels de l'engrenage sur le canvas
   */
  LegacySchema.prototype._getAxisLength = function (gear) {
    return gear.teeth * this.DEFAULT_FACTOR;
  };

  /**
   * Récupère la valeur du module métrique depuis le champ de formulaire.
   * Si le champ n'existe pas ou est vide, retourne null.
   *
   * @private
   * @returns {number|null} La valeur du module en mm, ou null si non défini
   */
  LegacySchema.prototype._getGearModule = function () {
    var el = document.getElementById("module");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return null;
  };

  // ===== Méthodes de dessin élémentaire =====

  /**
   * Dessine un engrenage individuel sur le canvas.
   *
   * Un engrenage est représenté schématiquement par :
   *   - Un trait horizontal (axe de l'engrenage, longueur proportionnelle aux dents)
   *   - Deux barres verticales aux extrémités (butées)
   *   - Un pied en T vers le bas (point de liaison avec l'étage)
   *   - Un label textuel (nom et nombre de dents)
   *
   * @private
   * @param {number} x - Coordonnée X du centre de l'engrenage
   * @param {number} y - Coordonnée Y du centre de l'engrenage
   * @param {number} length - Longueur totale de l'engrenage (pixels)
   * @param {string} label - Texte à afficher (ex: "A: 20")
   * @param {string} labelPos - Position du label : "above" (au-dessus) ou "below" (en dessous)
   * @returns {number} La coordonnée Y du bas du pied en T
   */
  LegacySchema.prototype._drawGear = function (x, y, length, label, labelPos) {
    var ctx = this._ctx;
    var half = length / 2;
    var endBar = 6;

    // Trait horizontal principal (axe de l'engrenage)
    ctx.beginPath(); ctx.moveTo(x - half, y); ctx.lineTo(x + half, y); ctx.stroke();
    // Barre verticale gauche (butée)
    ctx.beginPath(); ctx.moveTo(x - half, y - endBar / 2); ctx.lineTo(x - half, y + endBar / 2); ctx.stroke();
    // Barre verticale droite (butée)
    ctx.beginPath(); ctx.moveTo(x + half, y - endBar / 2); ctx.lineTo(x + half, y + endBar / 2); ctx.stroke();
    // Pied en T (liaison verticale vers le bas)
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + this.T_HEIGHT); ctx.stroke();

    // Label textuel positionné au-dessus ou en dessous
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    if (labelPos === "above") {
      ctx.fillText(label, x + 30, y - 10);
    } else {
      ctx.fillText(label, x, y + this.T_HEIGHT + 15);
    }
    return y + this.T_HEIGHT;
  };

  /**
   * Dessine une liaison verticale entre deux engrenages d'un même arbre.
   * Représente l'arbre qui relie l'engrenage mené d'un étage au menant de l'étage suivant.
   *
   * @private
   * @param {number} x - Coordonnée X de la liaison
   * @param {number} yTop - Coordonnée Y du point supérieur
   * @param {number} yBottom - Coordonnée Y du point inférieur
   */
  LegacySchema.prototype._drawVerticalLink = function (x, yTop, yBottom) {
    var ctx = this._ctx;
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBottom); ctx.stroke();
  };

  /**
   * Dessine un rectangle avec un label textuel centré (utilisé pour IN/OUT).
   *
   * @private
   * @param {number} centerX - Coordonnée X du centre du rectangle
   * @param {number} topY - Coordonnée Y du bord supérieur
   * @param {number} width - Largeur du rectangle
   * @param {number} height - Hauteur du rectangle
   * @param {string} text - Texte à afficher dans le rectangle
   * @param {string} fillColor - Couleur de remplissage du rectangle (CSS)
   */
  LegacySchema.prototype._drawLabelRectangle = function (centerX, topY, width, height, text, fillColor) {
    var ctx = this._ctx;
    var left = centerX - width / 2;
    // Dessin du rectangle avec remplissage et contour
    ctx.beginPath(); ctx.rect(left, topY, width, height);
    ctx.fillStyle = fillColor || "#ddd"; ctx.fill();
    ctx.strokeStyle = "#000"; ctx.stroke();
    // Texte centré dans le rectangle
    ctx.fillStyle = "#000"; ctx.font = "12px Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, centerX, topY + height / 2);
  };

  // ===== Dessin de l'assemblage complet =====

  /**
   * Dessine l'assemblage complet du train d'engrenages sur le canvas.
   *
   * Algorithme de disposition :
   *   1. Le premier étage (2 engrenages) est dessiné en haut
   *   2. Chaque étage suivant est décalé vers la droite et vers le bas
   *   3. Les engrenages d'un même étage sont côte à côte horizontalement
   *   4. Les étages consécutifs sont reliés par des liaisons verticales
   *   5. Si un module est défini, les entraxes sont affichés en pointillé
   *   6. Les labels IN (vert) et OUT (bleu) sont placés en bas
   *
   * @private
   * @param {Array<{name: string, teeth: number}>} gears - Tableau d'objets engrenage
   */
  LegacySchema.prototype._drawAdaptiveAssembly = function (gears) {
    var ctx = this._ctx;
    var canvas = this._canvas;

    // Effacer tout le canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Récupérer le module pour afficher les entraxes (optionnel)
    var modValue = this._getGearModule();
    var startY = this.INITIAL_Y;
    // Si un module est défini, décaler le dessin vers le bas pour laisser de la place aux cotes
    if (modValue) startY += 30;

    // Position Y des labels IN/OUT (en bas du canvas)
    var inOutY = canvas.height - this.RECT_HEIGHT - this.BOTTOM_MARGIN;
    var n = gears.length;
    if (n < 2) return;

    // --- Premier étage (engrenages 0 et 1) ---
    var currentX = this.INITIAL_X;
    var currentY = startY;
    var axisOdd1 = this._getAxisLength(gears[0]);
    this._drawGear(currentX, currentY, axisOdd1, gears[0].name + ": " + gears[0].teeth, "above");

    // Le deuxième engrenage est positionné à droite du premier
    // L'espacement = demi-longueur du premier + gap + demi-longueur du second
    var axisEven1 = this._getAxisLength(gears[1]);
    var secondX = currentX + (axisOdd1 / 2) + this.SMALL_GAP + (axisEven1 / 2);
    this._drawGear(secondX, currentY, axisEven1, gears[1].name + ": " + gears[1].teeth, "above");

    // Affichage de l'entraxe si le module est défini
    if (modValue) {
      // Lignes de rappel verticales en pointillé vers le haut
      ctx.save(); ctx.strokeStyle = "gray"; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(currentX, currentY); ctx.lineTo(currentX, 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(secondX, currentY); ctx.lineTo(secondX, 15); ctx.stroke();
      ctx.restore();
      // Calcul de l'entraxe : module * (Z1 + Z2) / 2
      var cd = modValue * (gears[0].teeth + gears[1].teeth) / 2;
      ctx.fillStyle = "#000"; ctx.font = "10px Arial"; ctx.textAlign = "center";
      ctx.fillText(cd.toFixed(2) + " mm", (currentX + secondX) / 2, 15);
    }

    // Liaison verticale vers le label IN
    ctx.beginPath(); ctx.moveTo(currentX, currentY); ctx.lineTo(currentX, inOutY); ctx.stroke();
    this._drawLabelRectangle(currentX, inOutY, this.RECT_WIDTH, this.RECT_HEIGHT, "IN", "#ccffcc");

    // Cas simple : seulement 2 engrenages (1 étage)
    if (n === 2) {
      ctx.beginPath(); ctx.moveTo(secondX, currentY); ctx.lineTo(secondX, inOutY); ctx.stroke();
      this._drawLabelRectangle(secondX, inOutY, this.RECT_WIDTH, this.RECT_HEIGHT, "OUT", "#ffcccc");
      return;
    }

    // --- Étages suivants (par paires d'engrenages) ---
    currentX = secondX;
    for (var i = 2; i < n; i += 2) {
      var axisOdd = this._getAxisLength(gears[i]);
      var axisEven = this._getAxisLength(gears[i + 1]);
      // Position X du deuxième engrenage de l'étage
      var newX = currentX + (axisOdd / 2) + this.SMALL_GAP + (axisEven / 2) + this.HORIZ_OFFSET;
      // Décalage vertical par rapport à l'étage précédent
      var gearBottomY = currentY + this.VERT_GAP;

      // Dessin des deux engrenages de l'étage et de la liaison verticale
      this._drawGear(currentX, gearBottomY, axisOdd, gears[i].name + ": " + gears[i].teeth, "below");
      this._drawVerticalLink(currentX, currentY, gearBottomY);
      this._drawGear(newX, gearBottomY, axisEven, gears[i + 1].name + ": " + gears[i + 1].teeth, "above");

      // Affichage de l'entraxe si le module est défini
      if (modValue) {
        var cd2 = modValue * (gears[i].teeth + gears[i + 1].teeth) / 2;
        ctx.save(); ctx.strokeStyle = "gray"; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(newX, gearBottomY); ctx.lineTo(newX, 15); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#000"; ctx.font = "10px Arial"; ctx.textAlign = "center";
        ctx.fillText(cd2.toFixed(2) + " mm", (currentX + newX) / 2, 15);
      }

      currentX = newX;
      currentY = gearBottomY;
    }

    // Liaison verticale vers le label OUT et rectangle de sortie
    ctx.beginPath(); ctx.moveTo(currentX, currentY); ctx.lineTo(currentX, inOutY); ctx.stroke();
    this._drawLabelRectangle(currentX, inOutY, this.RECT_WIDTH, this.RECT_HEIGHT, "OUT", "#ADD8E6");
  };

  // ===== Conversion des données =====

  /**
   * Convertit une solution (tableau de tuples [A, B, type?]) en tableau
   * d'objets engrenage avec nom (lettre) et nombre de dents.
   *
   * Chaque étage produit 2 engrenages nommés par des lettres consécutives :
   *   - Étage 0 : A (menant), B (mené)
   *   - Étage 1 : C (menant), D (mené)
   *   - Étage 2 : E (menant), F (mené)
   *   - etc.
   *
   * @private
   * @param {Array<Array<number|string>>} solution - La solution au format
   *   [[A1, B1, type?], [A2, B2, type?], ...]
   * @returns {Array<{name: string, teeth: number}>} Tableau d'objets engrenage
   */
  LegacySchema.prototype._convertSolutionToGears = function (solution) {
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var gears = [];
    // Premier étage
    if (solution.length > 0) {
      gears.push({ name: letters[0], teeth: solution[0][0] });
      gears.push({ name: letters[1], teeth: solution[0][1] });
    }
    // Étages suivants
    for (var i = 1; i < solution.length; i++) {
      gears.push({ name: letters[2 * i], teeth: solution[i][0] });
      gears.push({ name: letters[2 * i + 1], teeth: solution[i][1] });
    }
    return gears;
  };

  // ===== Enregistrement dans le namespace =====

  GearApp.visualization.LegacySchema = LegacySchema;

})(GearApp);
