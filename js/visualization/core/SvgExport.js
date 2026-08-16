(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.GearSvgExport = api; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function prepare(svg, options) {
    if (!svg) throw new TypeError('SVG required'); options = options || {};
    var clone = svg.cloneNode(true); clone.classList.remove('is-animated');
    clone.querySelectorAll('.selected').forEach(function (el) { el.classList.remove('selected'); });
    clone.querySelectorAll('[data-animation-transform]').forEach(function (el) { el.removeAttribute('data-animation-transform'); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', svg.getAttribute('viewBox') || '0 0 800 400');
    if (options.styleText) { var style = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style'); style.textContent = options.styleText; clone.insertBefore(style, clone.firstChild); }
    return clone;
  }
  function serialize(svg, options) { return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(prepare(svg, options)); }
  function download(svg, filename) { var blob = new Blob([serialize(svg)], { type: 'image/svg+xml;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename || 'transmission.svg'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 0); }
  return { prepare: prepare, serialize: serialize, download: download };
});
