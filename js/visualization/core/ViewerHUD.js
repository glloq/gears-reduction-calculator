// ViewerHUD.js - Lire une roue au survol, tout de suite.
//
// L'information était déjà là, et déjà juste : chaque roue, chaque étage, chaque
// arbre porte un `<title>` avec sa denture, son diamètre, sa vitesse, sa
// fonction. Techniquement correct — c'est même l'accessible name de l'élément —
// mais consultable seulement au bout d'une seconde d'immobilité, une ligne à la
// fois, et sans mise en forme. Sur un train de six étages, lire trois roues
// coûtait donc plus longtemps que de les compter.
//
// Ce module ne CALCULE rien et ne décide rien : il présente ce que les
// renderers écrivent déjà. C'est délibéré — un HUD qui reformulerait les
// grandeurs finirait par en dire une version divergente.
//
// Le `<title>` est déplacé dans `data-hud`, et l'accessible name repris par
// `aria-label` : sans cela l'infobulle native se superposerait au panneau une
// seconde plus tard. L'export reconstruit les `<title>` (voir SvgExport), pour
// qu'un SVG exporté reste lisible hors de l'application.
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  /** Au-delà, le panneau masquerait ce qu'on survole. */
  var OFFSET = 14;

  function ViewerHUD(container) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.panel = null;
    this._target = null;
  }

  ViewerHUD.prototype.bind = function () {
    var self = this;
    if (!this.container) return this;
    this._ensurePanel();

    // Le HUD suit le pointeur sur le conteneur, pas sur chaque élément : un
    // écouteur par roue coûterait cher et ne survivrait pas à un re-rendu.
    this.container.addEventListener('mousemove', function (event) { self._track(event); });
    this.container.addEventListener('mouseleave', function () { self.hide(); });
    // Un nouveau rendu remplace le SVG : les titres du nouveau doivent être
    // convertis, et le panneau refermé puisque sa cible n'existe plus.
    this.container.addEventListener('visualization:renderer', function () {
      // Les renderers vident le conteneur à chaque rendu : le panneau doit se
      // rattacher, sinon il ne survit pas au premier changement de solution.
      self._ensurePanel();
      self.hide();
      self.absorbTitles();
    });
    this.absorbTitles();
    return this;
  };

  /** Le panneau, créé une fois et rattaché aussi souvent qu'il le faut. */
  ViewerHUD.prototype._ensurePanel = function () {
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.className = 'viewer-hud';
      this.panel.id = 'viewerHud';
      this.panel.hidden = true;
      this.panel.setAttribute('aria-hidden', 'true');   // déjà lu par aria-label
    }
    if (this.panel.parentNode !== this.container) this.container.appendChild(this.panel);
    return this.panel;
  };

  /**
   * Déplace les `<title>` dans `data-hud`. Le texte reste accessible — il
   * devient `aria-label` — mais le navigateur n'en fait plus d'infobulle, qui
   * se superposerait au panneau.
   */
  ViewerHUD.prototype.absorbTitles = function () {
    if (!this.container) return this;
    var titles = this.container.querySelectorAll('svg title');
    Array.prototype.forEach.call(titles, function (title) {
      var owner = title.parentNode;
      if (!owner || owner.nodeName === 'svg') return;      // titre du document, à garder
      var text = title.textContent;
      owner.dataset.hud = text;
      if (!owner.getAttribute('aria-label')) owner.setAttribute('aria-label', text.replace(/\n+/g, ' · '));
      owner.removeChild(title);
    });
    return this;
  };

  /**
   * Ce que le pointeur désigne réellement.
   *
   * Le SVG superpose au dessin des annotations qui ne portent pas de grandeur :
   * repère d'indexation, ligne de cote, étiquette. Elles sont dessinées SŒURS
   * de la roue et non dedans — c'est le bon découpage, puisqu'on veut pouvoir
   * masquer une couche sans toucher aux pièces — mais elles interceptent le
   * survol. Se contenter du premier élément touché refermait donc le panneau
   * chaque fois qu'on croisait un trait : balayer une roue faisait clignoter le
   * HUD.
   *
   * On regarde donc toute la pile sous le pointeur, et on retient le premier
   * élément qui a quelque chose à dire. Enumérer les classes décoratives aurait
   * demandé de les recenser dans trois renderers — et d'y penser à la
   * quatrième.
   */
  ViewerHUD.prototype._owner = function (event) {
    var direct = event.target.closest ? event.target.closest('[data-hud]') : null;
    if (direct || !document.elementsFromPoint) return direct;
    var stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (var i = 0; i < stack.length; i++) {
      var found = stack[i].closest ? stack[i].closest('[data-hud]') : null;
      if (found) return found;
      if (stack[i] === this.container) break;   // sous le cadre, plus rien à lire
    }
    return null;
  };

  ViewerHUD.prototype._track = function (event) {
    var owner = this._owner(event);
    if (!owner) return this.hide();
    this._ensurePanel();
    if (owner !== this._target) {
      this._target = owner;
      this._fill(owner.dataset.hud);
    }
    this._place(event);
    return this;
  };

  /**
   * La première ligne est le titre — « Solaire (S) · Entrée », « Pignon
   * menant » — les suivantes ses grandeurs. C'est la forme que les renderers
   * écrivent déjà : le HUD la révèle, il ne l'invente pas.
   */
  ViewerHUD.prototype._fill = function (text) {
    this.panel.textContent = '';
    var lines = String(text || '').split('\n').filter(function (line) { return line.trim(); });
    if (!lines.length) return this.hide();
    var head = document.createElement('strong');
    head.className = 'hud-title';
    head.textContent = lines[0];
    this.panel.appendChild(head);
    lines.slice(1).forEach(function (line) {
      var row = document.createElement('span');
      row.className = 'hud-line';
      row.textContent = line;
      this.panel.appendChild(row);
    }, this);
    this.panel.hidden = false;
    return this;
  };

  /**
   * Le panneau se place à côté du pointeur, et se rabat quand il déborderait :
   * une info-bulle coupée par le bord du cadre ne s'affiche pas, elle se devine.
   */
  ViewerHUD.prototype._place = function (event) {
    var box = this.container.getBoundingClientRect();
    var x = event.clientX - box.left + OFFSET;
    var y = event.clientY - box.top + OFFSET;
    var width = this.panel.offsetWidth, height = this.panel.offsetHeight;
    if (x + width > box.width) x = Math.max(0, event.clientX - box.left - width - OFFSET);
    if (y + height > box.height) y = Math.max(0, event.clientY - box.top - height - OFFSET);
    this.panel.style.left = x.toFixed(0) + 'px';
    this.panel.style.top = y.toFixed(0) + 'px';
    return this;
  };

  ViewerHUD.prototype.hide = function () {
    this._target = null;
    if (this.panel) this.panel.hidden = true;
    return this;
  };

  GearApp.visualization = GearApp.visualization || {};
  GearApp.visualization.ViewerHUD = ViewerHUD;
})(GearApp);
