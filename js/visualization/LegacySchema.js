// LegacySchema.js - Schéma Canvas 2D (encapsulé dans une classe)
// Wrapper OOP autour du code legacy de schema.js

(function (GearApp) {

  function LegacySchema(canvasId) {
    this._canvas = document.getElementById(canvasId);
    if (!this._canvas) return;
    this._ctx = this._canvas.getContext("2d");
    this._ctx.strokeStyle = "#000";
    this._ctx.lineWidth = 2;

    // Constantes
    this.DEFAULT_FACTOR = 3;
    this.SMALL_GAP = 2;
    this.HORIZ_OFFSET = 0;
    this.VERT_GAP = 15;
    this.INITIAL_X = 50;
    this.INITIAL_Y = 20;
    this.RECT_WIDTH = 50;
    this.RECT_HEIGHT = 30;
    this.T_HEIGHT = 7;
    this.BOTTOM_MARGIN = 10;
  }

  LegacySchema.prototype.displaySolution = function (solution) {
    if (!this._canvas || !solution) return;
    var gears = this._convertSolutionToGears(solution);
    this._drawAdaptiveAssembly(gears);
  };

  LegacySchema.prototype._getAxisLength = function (gear) {
    return gear.teeth * this.DEFAULT_FACTOR;
  };

  LegacySchema.prototype._getGearModule = function () {
    var el = document.getElementById("module");
    if (el && el.value.trim() !== "") return parseFloat(el.value);
    return null;
  };

  LegacySchema.prototype._drawGear = function (x, y, length, label, labelPos) {
    var ctx = this._ctx;
    var half = length / 2;
    var endBar = 6;

    ctx.beginPath(); ctx.moveTo(x - half, y); ctx.lineTo(x + half, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - half, y - endBar / 2); ctx.lineTo(x - half, y + endBar / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + half, y - endBar / 2); ctx.lineTo(x + half, y + endBar / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + this.T_HEIGHT); ctx.stroke();

    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    if (labelPos === "above") {
      ctx.fillText(label, x + 30, y - 10);
    } else {
      ctx.fillText(label, x, y + this.T_HEIGHT + 15);
    }
    return y + this.T_HEIGHT;
  };

  LegacySchema.prototype._drawVerticalLink = function (x, yTop, yBottom) {
    var ctx = this._ctx;
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBottom); ctx.stroke();
  };

  LegacySchema.prototype._drawLabelRectangle = function (centerX, topY, width, height, text, fillColor) {
    var ctx = this._ctx;
    var left = centerX - width / 2;
    ctx.beginPath(); ctx.rect(left, topY, width, height);
    ctx.fillStyle = fillColor || "#ddd"; ctx.fill();
    ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.fillStyle = "#000"; ctx.font = "12px Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, centerX, topY + height / 2);
  };

  LegacySchema.prototype._drawAdaptiveAssembly = function (gears) {
    var ctx = this._ctx;
    var canvas = this._canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var modValue = this._getGearModule();
    var startY = this.INITIAL_Y;
    if (modValue) startY += 30;
    var inOutY = canvas.height - this.RECT_HEIGHT - this.BOTTOM_MARGIN;
    var n = gears.length;
    if (n < 2) return;

    var currentX = this.INITIAL_X;
    var currentY = startY;
    var axisOdd1 = this._getAxisLength(gears[0]);
    this._drawGear(currentX, currentY, axisOdd1, gears[0].name + ": " + gears[0].teeth, "above");

    var axisEven1 = this._getAxisLength(gears[1]);
    var secondX = currentX + (axisOdd1 / 2) + this.SMALL_GAP + (axisEven1 / 2);
    this._drawGear(secondX, currentY, axisEven1, gears[1].name + ": " + gears[1].teeth, "above");

    if (modValue) {
      ctx.save(); ctx.strokeStyle = "gray"; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(currentX, currentY); ctx.lineTo(currentX, 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(secondX, currentY); ctx.lineTo(secondX, 15); ctx.stroke();
      ctx.restore();
      var cd = modValue * (gears[0].teeth + gears[1].teeth) / 2;
      ctx.fillStyle = "#000"; ctx.font = "10px Arial"; ctx.textAlign = "center";
      ctx.fillText(cd.toFixed(2) + " mm", (currentX + secondX) / 2, 15);
    }

    ctx.beginPath(); ctx.moveTo(currentX, currentY); ctx.lineTo(currentX, inOutY); ctx.stroke();
    this._drawLabelRectangle(currentX, inOutY, this.RECT_WIDTH, this.RECT_HEIGHT, "IN", "#ccffcc");

    if (n === 2) {
      ctx.beginPath(); ctx.moveTo(secondX, currentY); ctx.lineTo(secondX, inOutY); ctx.stroke();
      this._drawLabelRectangle(secondX, inOutY, this.RECT_WIDTH, this.RECT_HEIGHT, "OUT", "#ffcccc");
      return;
    }

    currentX = secondX;
    for (var i = 2; i < n; i += 2) {
      var axisOdd = this._getAxisLength(gears[i]);
      var axisEven = this._getAxisLength(gears[i + 1]);
      var newX = currentX + (axisOdd / 2) + this.SMALL_GAP + (axisEven / 2) + this.HORIZ_OFFSET;
      var gearBottomY = currentY + this.VERT_GAP;

      this._drawGear(currentX, gearBottomY, axisOdd, gears[i].name + ": " + gears[i].teeth, "below");
      this._drawVerticalLink(currentX, currentY, gearBottomY);
      this._drawGear(newX, gearBottomY, axisEven, gears[i + 1].name + ": " + gears[i + 1].teeth, "above");

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

    ctx.beginPath(); ctx.moveTo(currentX, currentY); ctx.lineTo(currentX, inOutY); ctx.stroke();
    this._drawLabelRectangle(currentX, inOutY, this.RECT_WIDTH, this.RECT_HEIGHT, "OUT", "#ADD8E6");
  };

  LegacySchema.prototype._convertSolutionToGears = function (solution) {
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var gears = [];
    if (solution.length > 0) {
      gears.push({ name: letters[0], teeth: solution[0][0] });
      gears.push({ name: letters[1], teeth: solution[0][1] });
    }
    for (var i = 1; i < solution.length; i++) {
      gears.push({ name: letters[2 * i], teeth: solution[i][0] });
      gears.push({ name: letters[2 * i + 1], teeth: solution[i][1] });
    }
    return gears;
  };

  GearApp.visualization.LegacySchema = LegacySchema;

})(GearApp);
