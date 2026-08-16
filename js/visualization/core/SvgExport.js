/* Export SVG/PNG partagé par les trois vues : une seule implémentation, donc
 * un seul comportement (jetons de thème résolus, sélection retirée, animations
 * figées, viewBox conservé).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GearSvgExport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  /**
   * prepare(svg, options) → clone autonome, prêt à sérialiser.
   * options.styleText : feuille de style résolue à intégrer.
   * options.technical : conserve les couches de cotation/construction même si
   *   elles sont masquées à l'écran.
   */
  function prepare(svg, options) {
    if (!svg) throw new TypeError('SVG required');
    options = options || {};
    var clone = svg.cloneNode(true);
    clone.classList.remove('is-animated');
    Array.prototype.forEach.call(clone.querySelectorAll('.selected'), function (el) { el.classList.remove('selected'); });
    Array.prototype.forEach.call(clone.querySelectorAll('[data-animation-transform]'), function (el) { el.removeAttribute('data-animation-transform'); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var viewBox = svg.getAttribute('viewBox') || svg.dataset.initialViewBox || '0 0 800 400';
    clone.setAttribute('viewBox', viewBox);
    var box = viewBox.trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite)) {
      clone.setAttribute('width', box[2].toFixed(0));
      clone.setAttribute('height', box[3].toFixed(0));
    }
    if (options.technical) clone.classList.add('is-technical-export');
    if (options.styleText) {
      var style = (clone.ownerDocument || document).createElementNS(NS, 'style');
      style.textContent = options.styleText + (options.technical ? '.dimension-layer,.construction,.mesh-overlay{display:inline}' : '');
      clone.insertBefore(style, clone.firstChild);
    }
    return clone;
  }

  function serialize(svg, options) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(prepare(svg, options));
  }

  /** Rasterisation : le SVG sérialisé est peint sur un canvas au fond du thème. */
  function toPNG(svg, options, callback) {
    options = options || {};
    if (!svg) { callback(null); return; }
    var width = options.width || 1600, height = options.height || 800;
    var background = options.background ||
      (typeof getComputedStyle === 'function' ? getComputedStyle(document.body).getPropertyValue('--surface-1').trim() : '') || '#ffffff';
    var blob = new Blob([serialize(svg, options)], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var image = new Image();
    image.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      var context = canvas.getContext('2d');
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(callback, 'image/png');
    };
    image.onerror = function () { URL.revokeObjectURL(url); callback(null); };
    image.src = url;
  }

  function download(svg, filename, options) {
    var blob = new Blob([serialize(svg, options)], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'transmission.svg'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  return { prepare: prepare, serialize: serialize, toPNG: toPNG, download: download };
});
