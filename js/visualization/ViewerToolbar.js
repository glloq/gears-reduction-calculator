// ViewerToolbar.js - Chef d'orchestre des trois vues du schéma.
//
// Il détient l'ÉTAT PARTAGÉ — vue courante, étage sélectionné, lecture et
// vitesse d'animation, overlays — et le réapplique à chaque changement de vue.
// Les renderers ne détiennent aucun de ces états : passer de Denture à
// Géométrie puis à Cinématique conserve la sélection, l'animation et les
// options d'affichage.
//
// Contrat d'évènements unique pour les trois vues :
//   viewer:stage-selected · viewer:stage-edit · viewer:view-changed
//   viewer:overlay-changed · viewer:animation-changed
(function (GearApp) {
  'use strict';

  // Overlays par vue : le menu « Affichage » n'expose que ceux qui ont un sens
  // dans la vue courante (le balisage porte data-views).
  var DEFAULT_OVERLAYS = {
    autoDetails: true, pitchCircles: true, lineOfAction: false, dimensions: true, axes: true,
    envelope: false, forces: false, rpm: true, ratios: true, powerFlow: true, spatialAxes: true, labels: true
  };

  /**
   * §3 : quatre INTENTIONS de lecture, plutôt que onze cases.
   *
   * Les overlays individuels sont un bon découpage technique — chacun a un sens
   * propre et se teste seul — mais ils font payer à l'utilisateur un travail qui
   * n'est pas le sien : décider, case par case, ce qu'il faut voir pour
   * répondre à une question. Or les questions sont peu nombreuses et connues :
   * de quoi c'est fait, comment ça bouge, quelle taille ça fait, est-ce que ça
   * tient. Chaque préréglage est la réponse d'usage à l'une d'elles.
   *
   * Un préréglage donne l'état COMPLET, pas seulement ce qu'il ajoute : sinon
   * passer de « Mécanique » à « Simple » laisserait traîner la ligne d'action —
   * exactement le piège des dispositions, déjà corrigé une fois.
   *
   * Et il emmène dans la VUE qui répond à sa question. Les trois vues sont
   * spécialisées : demander « Dimensionnement » en restant sur un schéma
   * cinématique — explicitement symbolique, sans échelle — donnait des cotes
   * dans la seule vue qui ne peut pas les porter. « Simple » ne change rien :
   * c'est une question qu'on se pose dans n'importe quelle vue.
   */
  var PRESETS = [
    { id: 'simple', label: 'Simple', help: 'De quoi c’est fait : les étages, l’entrée et la sortie.', view: null,
      overlays: { autoDetails: true, pitchCircles: false, lineOfAction: false, dimensions: false,
        axes: false, envelope: false, forces: false, rpm: false, ratios: true,
        powerFlow: false, spatialAxes: false, labels: true } },
    { id: 'motion', label: 'Mouvement', help: 'Comment ça bouge : sens, vitesses, chemin de la puissance.', view: 'kinematic',
      overlays: { autoDetails: true, pitchCircles: false, lineOfAction: false, dimensions: false,
        axes: true, envelope: false, forces: false, rpm: true, ratios: true,
        powerFlow: true, spatialAxes: true, labels: true } },
    { id: 'sizing', label: 'Dimensionnement', help: 'Quelle taille ça fait : cotes, axes, encombrement.', view: 'geometry',
      overlays: { autoDetails: true, pitchCircles: true, lineOfAction: false, dimensions: true,
        axes: true, envelope: true, forces: false, rpm: false, ratios: false,
        powerFlow: false, spatialAxes: true, labels: true } },
    { id: 'mechanical', label: 'Mécanique', help: 'Est-ce que ça tient : efforts, contact, alertes.', view: 'teeth',
      overlays: { autoDetails: true, pitchCircles: true, lineOfAction: true, dimensions: false,
        axes: false, envelope: false, forces: true, rpm: true, ratios: false,
        powerFlow: false, spatialAxes: false, labels: true } }
  ];

  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  function kebab(name) { return name.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }); }

  function ViewerToolbar(container) {
    this.container = container;
    // La denture réaliste est la vue par défaut : elle supporte désormais tous
    // les types, crémaillère comprise.
    this.currentView = 'teeth';
    this.selectedStage = -1;
    this.animationSpeed = 1;
    this.animationDirection = 1;
    this.animationPlaying = false;
    this.animationAngle = 0;
    // Cadence : 'pedagogical' (lisible, constante) ou 'relative' (proportionnelle
    // au régime réel d'entrée). Les poses sont identiques dans les deux cas.
    this.animationMode = 'pedagogical';
    this.overlays = Object.assign({}, DEFAULT_OVERLAYS);
    // Aucun préréglage actif au départ : l'état d'usine n'en est pas un, et
    // allumer un bouton qui ne décrit pas l'écran serait un mensonge de plus.
    this.preset = null;
    // §28 : d'où l'on regarde. Vide = automatique, c'est-à-dire la projection
    // qui montre le plus de denture. Le choix vaut pour toute la session : un
    // point de vue qui se réinitialiserait à chaque solution obligerait à le
    // reposer sans cesse pendant qu'on compare deux réducteurs.
    // Le point de vue, et le SYSTÈME qui va avec. « Dépliée » conserve les
    // longueurs vraies pour comprendre d'un coup d'œil ; les quatre autres
    // sont de vraies projections, où une longueur oblique apparaît raccourcie.
    // Les confondre sous un « Auto » ne rendait service à personne : on ne
    // savait plus si le dessin mesurait ou expliquait.
    this.projection = 'unfolded';
    // §2 : le STYLE de dessin. `visual` est ce que l'application montre depuis
    // toujours ; `technical` emprunte le vocabulaire du dessin d'ensemble. Le
    // style ne touche jamais à la mécanique — mêmes organes, mêmes rapports,
    // mêmes entraxes — seulement au langage graphique.
    this.style = 'visual';
    // §8 : un cadrage par vue, valable pour la solution en cours seulement.
    this.camera = {};
    this._cameraOwner = null;
    this.geometry = new GearApp.visualization.GeometryRenderer(container);
    this.kinematic = GearApp.visualization.kinematicRenderer;
    // Instances longue durée : chaque vue reconstruit son svg à chaque rendu.
    this.teeth = new GearApp.visualization.TrainRenderer(container);
    var self = this;
    this.inspector = new GearStageInspector.Inspector(container, {
      registry: GearTransmissionRegistry,
      onEdit: function (index) { self.container.dispatchEvent(new CustomEvent('viewer:stage-edit', { detail: { index: index } })); },
      onClose: function () { self.selectedStage = -1; self._syncFraming(); }
    });
  }

  ViewerToolbar.prototype.renderer = function () {
    if (this.currentView === 'kinematic') return this.kinematic;
    if (this.currentView === 'teeth') return this.teeth;
    return this.geometry;
  };

  ViewerToolbar.prototype.render = function (solution) {
    // Une autre solution invalide les cadrages mémorisés : un viewBox n'a de
    // sens que pour le dessin qui l'a produit.
    if (solution !== this._cameraOwner) { this.camera = {}; this._cameraOwner = solution; }
    this.solution = solution;
    var rendered = this.renderer().render(solution);
    // L'inspecteur lit la scène de la vue courante : mêmes vitesses, même
    // instant, quelle que soit la vue affichée.
    this.inspector.setSolution(solution, rendered && rendered.scene);
    this._applyState(rendered);
    this._restoreCamera(rendered);
    this._renderFidelity(rendered);
    this._syncZoomTier();
    this._syncFraming();
    this._syncProjection();
    return rendered;
  };

  /**
   * §8 : chaque vue garde SON cadrage.
   *
   * L'état partagé — étage, animation, overlays — traverse déjà les trois vues,
   * mais pas le zoom : partir examiner une denture puis revenir aux cotes
   * rendait le travail de cadrage à refaire. Le partager n'aurait pas de sens
   * non plus, les trois vues n'ayant ni la même échelle ni la même disposition.
   * Il est donc mémorisé PAR VUE, et seulement pour la solution en cours.
   */
  ViewerToolbar.prototype._restoreCamera = function (rendered) {
    var saved = this.camera && this.camera[this.currentView];
    var viewport = rendered && rendered.viewport;
    if (!saved || !viewport || !viewport.setState) return this;
    viewport.setState({ viewBox: saved.slice() });
    return this;
  };

  /** Le cadrage courant, retenu pour le retour dans cette vue. */
  ViewerToolbar.prototype._rememberCamera = function () {
    var renderer = this.renderer(), viewport = renderer && renderer.viewport;
    if (!viewport || !viewport.getState) return this;
    this.camera = this.camera || {};
    this.camera[this.currentView] = viewport.getState().viewBox.slice();
    return this;
  };

  /**
   * Plus rien à montrer. Le viewer gardait le dernier dessin quand un filtre
   * ne laissait passer aucune solution : l'écran annonçait « 0 / 50 » au-dessus
   * d'un mécanisme qui n'existait plus dans la liste, et l'inspecteur en
   * détaillait toujours les étages.
   */
  ViewerToolbar.prototype.clear = function () {
    this.solution = null;
    this.camera = {};
    this._cameraOwner = null;
    this.selectedStage = -1;
    this.inspector.setSolution(null, null);
    this.inspector.hide();
    // Le HUD suit le dessin : il n'a plus de cible.
    if (this.hud) this.hud.hide();
    ['teeth', 'geometry', 'kinematic'].forEach(function (name) {
      var renderer = this[name];
      if (renderer) { renderer.solution = null; renderer.svg = null; }
    }, this);
    if (this.container) this.container.innerHTML = '';
    this._ensureHudPanel();
    this._renderFidelity(null);
    this._syncFraming();
    return this;
  };

  /** Le panneau du HUD vit dans le conteneur : le vider le décroche. */
  ViewerToolbar.prototype._ensureHudPanel = function () {
    if (this.hud && this.hud._ensurePanel) this.hud._ensurePanel();
  };

  /**
   * §7 : les trois cadrages disent ce qu'ils peuvent faire, à l'instant présent.
   *
   * « Cadrer l'étage » sans étage sélectionné, et « 1:1 » sur un schéma
   * symbolique, sont deux boutons qui ne peuvent pas tenir leur promesse. Les
   * laisser cliquables et sans effet serait la même faute que les cartes sans
   * effet déjà retirées ailleurs : ils se désactivent, en disant pourquoi.
   */
  /**
   * §28 : d'où l'on regarde le mécanisme.
   *
   * Changer de point de vue ne déplace aucune pièce — c'est l'invariant du
   * modèle spatial —, mais cela change entièrement le dessin : le cadrage
   * mémorisé pour cette vue ne s'y applique plus, et le conserver ramènerait
   * sur un coin de l'ancien dessin.
   */
  ViewerToolbar.prototype.setProjection = function (id) {
    this.projection = id || 'unfolded';
    // Les trois vues dessinent le même mécanisme depuis le même endroit. Une
    // commande par vue — un sélecteur ici, trois boutons dans la Cinématique —
    // laissait croire à deux réglages indépendants, et il fallait les reposer
    // l'un après l'autre en changeant de vue.
    // La Cinématique est délibérément absente : son schéma est fonctionnel, et
    // le réorganiser au gré d'une caméra reviendrait à le prendre pour une vue
    // du mécanisme.
    ['teeth', 'geometry'].forEach(function (name) {
      if (this[name]) this[name].projection = this.projection;
    }, this);
    this.camera = {};
    if (this.solution) this.render(this.solution);
    this._syncProjection();
    this.container.dispatchEvent(new CustomEvent('viewer:projection-changed',
      { detail: { projection: this.projection || 'auto' } }));
    return this;
  };

  /**
   * La liste des points de vue vient du moteur de projection : une seconde
   * table ici finirait par ne plus lui correspondre. Le contrôle se désactive
   * hors du dessin spatial plutôt que de disparaître — la Cinématique est un
   * schéma, elle n'a pas de point de vue à offrir, et le dire vaut mieux que
   * de laisser croire qu'on a mal cliqué.
   */
  /**
   * §2, §60 : changer de style ne recalcule aucune mécanique.
   *
   * Le style vit sur les renderers, qui le passent aux primitives. Rien dans
   * Engineering, SceneBuilder ou MechanicalGraph n'en dépend : c'est ce qui
   * garantit qu'un dessin technique et un dessin visuel décrivent le même
   * mécanisme, et non deux lectures possibles du même calcul.
   */
  ViewerToolbar.prototype.setStyle = function (style) {
    this.style = style === 'technical' ? 'technical' : 'visual';
    ['teeth', 'geometry', 'kinematic'].forEach(function (name) {
      if (this[name]) this[name].style = this.style;
    }, this);
    this.container.classList.toggle('is-technical', this.style === 'technical');
    var host = this.container.closest ? this.container.closest('.svg-container') : null;
    if (host) host.classList.toggle('is-technical', this.style === 'technical');
    document.querySelectorAll('[data-style]').forEach(function (button) {
      var active = button.dataset.style === this.style;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }, this);
    if (this.solution) this.render(this.solution);
    this.container.dispatchEvent(new CustomEvent('viewer:style-changed', { detail: { style: this.style } }));
    return this;
  };

  ViewerToolbar.prototype._syncProjection = function () {
    var select = document.getElementById('viewerProjection');
    if (!select) return this;
    if (!select.options.length && typeof GearProjectionEngine !== 'undefined') {
      // La vue dépliée n'est pas une projection : elle vient donc en tête, et
      // sous son nom, plutôt que d'être le comportement caché du reste.
      var choices = [{ id: 'unfolded', label: 'Dépliée', help: UNFOLDED_HELP }]
        .concat(GearProjectionEngine.VIEWS);
      choices.forEach(function (view) {
        var option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.label;
        option.title = view.help;
        select.appendChild(option);
      });
    }
    select.value = this.projection || 'unfolded';
    // La Cinématique n'a pas de point de vue à choisir : elle est un schéma,
    // et le dire vaut mieux que de laisser croire qu'on a mal cliqué.
    var spatial = this.currentView !== 'kinematic';
    select.disabled = !spatial;
    select.title = !spatial
      ? 'Le schéma cinématique est fonctionnel : sa disposition ne dépend d’aucun point de vue'
      : this.projection === 'unfolded' || !this.projection ? UNFOLDED_HELP
        : (typeof GearProjectionEngine !== 'undefined' ? GearProjectionEngine.view(this.projection).help : '');
    var label = document.querySelector('.viewer-projection-label');
    if (label) label.classList.toggle('is-disabled', !spatial);
    return this;
  };

  ViewerToolbar.prototype._syncFraming = function () {
    var focus = document.getElementById('viewerFocus');
    if (focus) {
      var selected = this.selectedStage >= 0;
      focus.disabled = !selected;
      focus.title = selected ? 'Cadrer l’étage ' + (this.selectedStage + 1)
        : 'Sélectionnez d’abord un étage sur le dessin';
    }
    var actual = document.getElementById('viewerActualSize');
    if (actual) {
      // La Cinématique n'est pas en millimètres : « 1:1 » n'y voudrait rien dire.
      var metric = this.currentView !== 'kinematic';
      actual.disabled = !metric;
      actual.title = metric
        ? 'Échelle réelle : un millimètre dessiné occupe un millimètre d’écran'
        : 'Le schéma cinématique est symbolique : il n’a pas d’échelle réelle';
    }
    return this;
  };

  /**
   * §22, §23 : ce que la vue courante montre à l'ÉCHELLE, et ce qu'elle ne
   * fait que suggérer.
   *
   * Les trois vues n'ont pas le même statut, et rien ne le disait : la
   * Cinématique est un schéma symbolique — ses distances ne veulent rien dire
   * — tandis que la Géométrie est une vue cotée. Lire la première comme la
   * seconde, c'est mesurer un encombrement sur un dessin qui n'en porte
   * aucun. À quoi s'ajoute le cas particulier d'une solution dont le moteur
   * n'a pas fourni toutes les cotes : la scène l'a déjà noté membre par
   * membre, encore fallait-il le dire.
   */
  var FIDELITY = {
    // La phrase affirmait « dentures et entraxes à l'échelle réelle » quelle que
    // soit la vue. C'est vrai de la vue dépliée, et faux d'une projection, qui
    // raccourcit justement ce qui a de la profondeur : c'est `_systemFidelity`
    // qui le dit maintenant, et lui seul.
    teeth: 'Dentures à l’échelle réelle.',
    geometry: 'Vue cotée : diamètres, entraxes et courses sont ceux du calcul.',
    kinematic: 'Schéma symbolique : les positions et les tailles ne sont pas à l’échelle, seuls les liens et les vitesses ont un sens.'
  };

  /**
   * §54 : ce que vaut l'ÉCARTEMENT des organes sur leurs arbres.
   *
   * La phrase disait une bonne fois « la longueur des arbres est
   * schématique ». Elle l'était, faute d'abscisses ; elle ne l'est plus
   * toujours, et continuer à l'affirmer serait un mensonge dans l'autre sens.
   * Chaque abscisse porte maintenant sa provenance — mesurée, déduite d'un jeu
   * d'arbre par défaut, ou purement conventionnelle — et la vue dit la moins
   * bonne des trois, puisque c'est elle qui limite ce qu'on peut affirmer.
   */
  var UNFOLDED_HELP = 'Vue dépliée : les orientations viennent de la projection, ' +
    'les entraxes et les longueurs gardent leur valeur vraie.';

  /**
   * Lequel des deux systèmes le dessin utilise — et donc ce qu'on a le droit
   * d'y lire.
   *
   * La distinction n'existait pas : toutes les vues passaient par le dépliage,
   * et l'utilisateur croyait mesurer là où il comprenait. Une projection
   * raccourcit ce qui a de la profondeur, et le dire vaut mieux que de laisser
   * quelqu'un reporter une longueur prise sur l'écran.
   */
  ViewerToolbar.prototype._systemFidelity = function (rendered) {
    var mode = rendered && rendered.model && rendered.model.mode;
    if (mode === 'unfolded') return ' ' + UNFOLDED_HELP;
    if (mode === 'projected') {
      return ' Projection orthographique : les longueurs obliques apparaissent ' +
        'raccourcies ; les cotes donnent leur valeur réelle.';
    }
    return '';
  };

  ViewerToolbar.prototype._axialFidelity = function (rendered) {
    var wheels = rendered && rendered.model && rendered.model.wheels;
    if (!wheels || !wheels.length) return '';
    var seen = {};
    wheels.forEach(function (wheel) { if (wheel.axialProvenance) seen[wheel.axialProvenance] = true; });
    if (seen.schematic) return ' L’écartement des organes sur un même arbre est conventionnel : leur largeur de denture n’est pas calculée.';
    if (seen.derived) return ' L’écartement des organes sur un même arbre suit un jeu d’arbre par défaut.';
    return ' L’écartement des organes sur leurs arbres est celui du calcul.';
  };

  ViewerToolbar.prototype._renderFidelity = function (rendered) {
    var host = document.getElementById('viewerFidelity');
    if (!host) return;
    // Rien de dessiné, rien à qualifier : une phrase sur la fidélité d'un
    // dessin absent parlerait du précédent.
    if (!rendered) { host.textContent = ''; host.title = ''; host.hidden = true; host.classList.remove('has-derived'); return; }
    var text = FIDELITY[this.currentView] || '';
    text += this._systemFidelity(rendered);
    text += this._axialFidelity(rendered);
    var scene = rendered && rendered.scene;
    // Une cote reconstruite faute de mieux ne doit pas être lue comme une cote
    // calculée : la scène marque ces membres, la vue le répercute.
    var derived = scene && scene.members
      ? scene.members.filter(function (member) { return member.schematic; })
      : [];
    // §20 : cote par cote, ce qui est calculé et ce qui est reconstruit. La
    // phrase générale dit le statut de la VUE ; le détail dit celui de chaque
    // grandeur, ce qui est la question d'un ingénieur devant un plan.
    host.title = this._fidelityDetail(scene);
    if (derived.length) {
      var names = derived.map(function (member) { return member.memberName || member.role; });
      var unique = names.filter(function (name, i) { return names.indexOf(name) === i; });
      text += ' Cotes reconstruites, non calculées, pour : ' + unique.join(', ') + '.';
    }
    host.textContent = text;
    host.hidden = !text;
    host.classList.toggle('has-derived', derived.length > 0);
  };

  /** Réapplique l'état partagé à la vue qui vient d'être rendue. */
  ViewerToolbar.prototype._applyState = function (rendered) {
    if (!rendered) return;
    if (rendered.setAnimationSpeed) rendered.setAnimationSpeed(this.animationSpeed);
    if (rendered.setAnimationDirection) rendered.setAnimationDirection(this.animationDirection);
    if (rendered.setAutoDetails) rendered.setAutoDetails(this.overlays.autoDetails);
    if (rendered.setAnimationMode) rendered.setAnimationMode(this.animationMode);
    // L'animation reprend au même angle : les trois vues racontent la même
    // cinématique, au même instant.
    if (rendered.setAnimationAngle) rendered.setAnimationAngle(this.animationAngle);
    if (this.animationPlaying && rendered.animation && !rendered.animation.playing) {
      if (rendered.animation.seek) rendered.animation.seek(this.animationAngle);
      rendered.toggleAnimation();
    }
    this._applyOverlayClasses();
    if (this.selectedStage >= 0 && rendered.selectStage) {
      rendered.selectStage(this.selectedStage, true);
      this.inspector.show(this.selectedStage);
    }
  };

  /**
   * Applique un préréglage. Il pose l'état complet et devient le préréglage
   * actif ; toucher ensuite une case individuelle le quitte — l'écran ne doit
   * pas prétendre « Mécanique » quand on vient d'éteindre les efforts.
   */
  ViewerToolbar.prototype.setPreset = function (id) {
    var entry = preset(id);
    if (!entry) return this;
    this.preset = id;
    Object.keys(entry.overlays).forEach(function (name) {
      this.overlays[name] = entry.overlays[name];
    }, this);
    // La vue d'abord : setView() re-rend, et le rendu doit déjà connaître les
    // couches demandées. `preset` est réaffirmé après, setView repassant par
    // render().
    if (entry.view && entry.view !== this.currentView) {
      this.setView(entry.view);
      this.preset = id;
    }
    var renderer = this.renderer();
    if (renderer && renderer.setAutoDetails) renderer.setAutoDetails(this.overlays.autoDetails);
    this._applyOverlayClasses();
    this._syncOverlayInputs();
    this._markPreset();
    this.container.dispatchEvent(new CustomEvent('viewer:preset-changed', { detail: { preset: id } }));
    return this;
  };

  /** Les cases doivent refléter l'état : sinon elles décrivent le précédent. */
  ViewerToolbar.prototype._syncOverlayInputs = function () {
    var overlays = this.overlays;
    document.querySelectorAll('#viewerDisplayMenu [data-overlay]').forEach(function (input) {
      var wanted = !!overlays[input.dataset.overlay];
      if (input.checked !== wanted) input.checked = wanted;
    });
  };

  ViewerToolbar.prototype._markPreset = function () {
    var current = this.preset;
    document.querySelectorAll('[data-preset]').forEach(function (button) {
      var mine = button.dataset.preset === current;
      button.classList.toggle('active', mine);
      button.setAttribute('aria-pressed', String(mine));
    });
  };

  /**
   * Reporte le palier de lecture sur le conteneur. Le tracé, lui, garde sa
   * finesse calculée par roue : un seuil global se tromperait sur une roue de
   * 8 dents à côté d'une de 200.
   */
  ViewerToolbar.prototype._syncZoomTier = function () {
    var renderer = this.renderer();
    var viewport = renderer && renderer.viewport;
    var tier = viewport && viewport.zoomTier ? viewport.zoomTier() : null;
    var classes = this.container.classList;
    GearViewportController.ZOOM_TIERS.forEach(function (entry) {
      classes.toggle('zoom-' + entry.name, !!tier && tier.id === entry.id);
    });
    this.container.dataset.zoomTier = tier ? tier.name : '';
    return this;
  };

  ViewerToolbar.prototype._applyOverlayClasses = function () {
    var container = this.container, overlays = this.overlays;
    Object.keys(overlays).forEach(function (name) {
      container.classList.toggle('hide-' + kebab(name), !overlays[name]);
    });
  };

  ViewerToolbar.prototype.setView = function (view) {
    // Mémorise l'angle courant pour que la vue suivante reparte au même instant.
    var current = this.renderer();
    if (current && Number.isFinite(current._angle)) this.animationAngle = current._angle;
    if (current && current.animation && current.animation.playing) current.animation.pause();

    this.currentView = view === 'kinematic' ? 'kinematic' : view === 'teeth' ? 'teeth' : 'geometry';
    var name = this.currentView;
    document.querySelectorAll('.view-mode').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === name);
    });
    var section = this.container.closest('.viz-section');
    if (section) section.classList.toggle('kinematic-active', name === 'kinematic');
    document.querySelectorAll('#viewerDisplayMenu [data-views]').forEach(function (label) {
      label.hidden = label.dataset.views.split(' ').indexOf(name) < 0;
    });
    // Un intertitre sans ligne en dessous n'annonce rien : il se retire avec
    // elles quand la vue courante n'en propose aucune.
    document.querySelectorAll('#viewerDisplayMenu .display-menu-group').forEach(function (heading) {
      var next = heading.nextElementSibling, visible = false;
      while (next && !next.classList.contains('display-menu-group')) {
        if (!next.hidden) visible = true;
        next = next.nextElementSibling;
      }
      heading.hidden = !visible;
    });
    this._syncProjection();
    if (this.solution) this.render(this.solution);
    this.container.dispatchEvent(new CustomEvent('viewer:view-changed', { detail: { view: name } }));
  };

  /** Libellés des cotes, pour un détail lisible plutôt qu'un nom de champ. */
  var DIMENSION_LABELS = {
    pitchDiameter: 'Diamètre primitif', outsideDiameter: 'Diamètre extérieur',
    rootDiameter: 'Diamètre de pied', baseDiameter: 'Diamètre de base',
    centerDistance: 'Entraxe', width: 'Largeur', module: 'Module',
    teeth: 'Nombre de dents', orbitRadius: 'Rayon d’orbite',
    travelPerRevolution: 'Course par tour', coneAngleDeg: 'Angle de cône',
    leadAngleDeg: 'Angle d’avance', helixAngleDeg: 'Angle d’hélice'
  };

  /**
   * §20 : ● calculé, ○ déduit. Une cote reconstruite faute de mieux ne se lit
   * pas comme une cote calculée — sur un outil d'ingénierie, c'est la première
   * chose à savoir avant de reporter une valeur sur un plan.
   */
  ViewerToolbar.prototype._fidelityDetail = function (scene) {
    if (!scene || !scene.members) return '';
    var engine = {}, derived = {};
    scene.members.forEach(function (member) {
      Object.keys(member.provenance || {}).forEach(function (key) {
        (member.provenance[key] === 'engine' ? engine : derived)[key] = true;
      });
    });
    function list(marks, bucket) {
      return Object.keys(bucket).map(function (key) {
        return marks + ' ' + (DIMENSION_LABELS[key] || key);
      });
    }
    var lines = list('●', engine).concat(list('○', derived));
    if (!lines.length) return '';
    return '● calculé par le moteur · ○ reconstruit faute de mieux\n' + lines.join('\n');
  };

  ViewerToolbar.prototype.toggleAnimation = function () {
    var renderer = this.renderer();
    if (!renderer || !renderer.toggleAnimation) return;
    renderer.toggleAnimation();
    this.animationPlaying = !!(renderer.animation && renderer.animation.playing);
    var button = document.getElementById('viewerAnimate');
    if (button) {
      button.setAttribute('aria-pressed', String(this.animationPlaying));
      button.textContent = this.animationPlaying ? '❚❚' : '▶';
    }
    this.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { playing: this.animationPlaying } }));
  };

  ViewerToolbar.prototype.setOverlay = function (name, enabled) {
    this.overlays[name] = !!enabled;
    // Régler une case à la main quitte le préréglage : le contraire ferait
    // dire « Mécanique » à un écran dont on vient d'éteindre les efforts.
    this.preset = null;
    this._markPreset();
    this.container.classList.toggle('hide-' + kebab(name), !enabled);
    if (name === 'autoDetails') {
      var renderer = this.renderer();
      if (renderer && renderer.setAutoDetails) renderer.setAutoDetails(enabled);
    }
    this.container.dispatchEvent(new CustomEvent('viewer:overlay-changed',
      { detail: { overlay: name, enabled: !!enabled, view: this.currentView } }));
  };

  ViewerToolbar.prototype.bind = function () {
    var self = this, controls = document.querySelector('.viz-controls');
    // §4 : lire une roue au survol, tout de suite. L'information est déjà dans
    // les `<title>` ; seule sa consultation était lente.
    if (GearApp.visualization.ViewerHUD && !this.hud) {
      this.hud = new GearApp.visualization.ViewerHUD(this.container).bind();
    }
    // §2 : le palier de lecture suit le zoom, dans les trois vues. Il est porté
    // par une classe du conteneur, ce qui laisse chaque vue décider en CSS de
    // ce qu'elle montre à quel palier — sans qu'aucune n'ait à connaître les
    // seuils.
    this.container.addEventListener('viewport:changed', function () { self._syncZoomTier(); self._rememberCamera(); });
    if (!controls) return;
    controls.addEventListener('click', function (event) {
      var view = event.target.closest('.view-mode');
      if (view) { self.setView(view.dataset.view); return; }
      var styled = event.target.closest('[data-style]');
      if (styled) { self.setStyle(styled.dataset.style); return; }
      var chosen = event.target.closest('[data-preset]');
      if (chosen) { self.setPreset(chosen.dataset.preset); return; }
      var renderer = self.renderer();
      if (event.target.id === 'viewerAnimate') { self.toggleAnimation(); return; }
      if (event.target.id === 'viewerReverse') {
        self.animationDirection = self.animationDirection === -1 ? 1 : -1;
        if (renderer.setAnimationDirection) renderer.setAnimationDirection(self.animationDirection);
        event.target.setAttribute('aria-pressed', String(self.animationDirection === -1));
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { direction: self.animationDirection } }));
      }
      if (event.target.id === 'viewerMode') {
        self.animationMode = self.animationMode === 'relative' ? 'pedagogical' : 'relative';
        if (renderer.setAnimationMode) renderer.setAnimationMode(self.animationMode);
        event.target.setAttribute('aria-pressed', String(self.animationMode === 'relative'));
        event.target.textContent = self.animationMode === 'relative' ? 'Cadence réelle' : 'Cadence pédagogique';
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { mode: self.animationMode } }));
      }
      if (event.target.id === 'viewerReset' && renderer.resetView) renderer.resetView();
      if (event.target.id === 'viewerFocus' && renderer.focusStage) renderer.focusStage(self.selectedStage);
      if (event.target.id === 'viewerActualSize' && renderer.viewport) renderer.viewport.actualSize();
    });
    controls.addEventListener('change', function (event) {
      if (event.target.id === 'viewerProjection') { self.setProjection(event.target.value); return; }
      if (event.target.id === 'viewerSpeed') {
        var renderer = self.renderer(), speed = Number(event.target.value);
        self.animationSpeed = speed;
        if (renderer.setAnimationSpeed) renderer.setAnimationSpeed(speed);
        // Le résumé du menu porte la vitesse : une seule commande visible en
        // permanence, sans perdre l'information.
        var summary = document.querySelector('#viewerAnimationMenu > summary');
        if (summary) summary.textContent = event.target.options[event.target.selectedIndex].textContent;
        self.container.dispatchEvent(new CustomEvent('viewer:animation-changed', { detail: { speed: speed } }));
      }
      if (event.target.matches('[data-overlay]')) self.setOverlay(event.target.dataset.overlay, event.target.checked);
    });
    this.container.addEventListener('viewer:stage-selected', function (event) {
      self.selectedStage = event.detail.index;
      self.inspector.show(event.detail.index);
      self._syncFraming();
    });
    this._applyOverlayClasses();
  };

  ViewerToolbar.DEFAULT_OVERLAYS = DEFAULT_OVERLAYS;
  ViewerToolbar.PRESETS = PRESETS;
  ViewerToolbar.preset = preset;
  GearApp.visualization.ViewerToolbar = ViewerToolbar;
})(GearApp);
