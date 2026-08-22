// SolutionHeader.js - Savoir ce qu'on regarde, sans quitter le dessin.
//
// Une solution sélectionnée était décrite à trois endroits qu'on ne pouvait pas
// voir ensemble : sa carte, à gauche ; le dessin, au centre ; le panneau
// mécanique, en dessous. Identifier ce qu'on avait sous les yeux demandait donc
// un aller-retour du regard entre trois zones, et la question la plus banale —
// « quel étage suis-je en train d'inspecter ? » — n'avait aucune réponse
// immédiate.
//
// Deux bandes le règlent, juste au-dessus du dessin :
//
//   L'IDENTITÉ    ce que c'est, et ses chiffres décisifs
//   LES ÉTAGES    [Ensemble] [1 Conique] [2 Épicycloïdal] …
//
// La bande d'étages n'est pas un doublon du dessin : elle rend ADRESSABLE ce
// qui n'était atteignable qu'en visant une roue à la souris — impossible au
// clavier, et pénible dès qu'un train se recouvre.
(function (GearApp) {
  'use strict';
  if (typeof document === 'undefined' || !GearApp) return;

  var Evaluator = GearApp.requirements && GearApp.requirements.SolutionEvaluator;

  function el(id) { return document.getElementById(id); }
  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function num(value, digits, unit) {
    return (Number.isFinite(value) ? value.toFixed(digits) : '—') + (unit || '');
  }

  /**
   * Ce qu'on montre d'une solution en une ligne. Volontairement court : cette
   * bande répond à « qu'est-ce que je regarde ? », pas à « est-ce que ça
   * tient ? » — c'est le rôle de l'analyse mécanique, juste en dessous.
   */
  function metrics(solution) {
    if (solution.mode === 'rotationTranslation') {
      return [
        num(solution.travelPerRevolutionMm, 2, ' mm/tr'),
        num(solution.outputLinearSpeedMmMin, 0, ' mm/min'),
        num(solution.outputForceN, 1, ' N'),
        num(solution.dimensions && solution.dimensions.maxDiameter, 0, ' mm')
      ];
    }
    return [
      num(solution.ratio, 2, ' : 1'),
      num(solution.efficiency * 100, 1, ' %'),
      num(solution.outputTorqueNm, 1, ' N·m'),
      'Ø ' + num(solution.dimensions && solution.dimensions.maxDiameter, 0, ' mm')
    ];
  }

  function SolutionHeader(container, options) {
    options = options || {};
    this.container = typeof container === 'string' ? el(container) : container;
    this.bus = options.bus || GearApp.eventBus;
    this.viewer = options.viewer || null;
    this.solution = null;
    this.index = -1;
    this.stage = -1;
  }

  SolutionHeader.prototype.bind = function () {
    var self = this;
    this.identity = el('solutionIdentity');
    this.stagesHost = el('stageNav');
    this.chainHost = el('kinematicChain');
    if (!this.identity || !this.stagesHost) return this;

    this.bus.on('solution:selected', function (data) {
      self.solution = data.solution || null;
      self.index = data.index;
      // Changer de solution remet la lecture sur l'ensemble : garder « étage 3 »
      // alors qu'on vient d'afficher une chaîne à deux étages n'aurait pas de sens.
      self.stage = -1;
      self.render();
    });

    // Une roue cliquée dans le dessin doit allumer la puce correspondante :
    // les deux gestes désignent la même chose.
    if (this.viewer && this.viewer.container) {
      this.viewer.container.addEventListener('viewer:stage-selected', function (event) {
        self.stage = event.detail.index;
        self._markStages();
      });
    }
    this.stagesHost.addEventListener('click', function (event) {
      var chip = event.target.closest('[data-stage-nav]');
      if (!chip) return;
      self.select(chip.dataset.stageNav === 'all' ? -1 : Number(chip.dataset.stageNav));
    });
    this.render();
    return this;
  };

  /**
   * Désigne un étage, ou l'ensemble. Un seul chemin pour les deux gestes —
   * la puce et la roue — sinon les deux finiraient par diverger.
   */
  SolutionHeader.prototype.select = function (index) {
    this.stage = index;
    var viewer = this.viewer;
    if (viewer) {
      var renderer = viewer.renderer && viewer.renderer();
      if (index < 0) {
        viewer.selectedStage = -1;
        if (viewer.inspector) viewer.inspector.hide();
        if (renderer && renderer.selectStage) renderer.selectStage(-1, true);
        if (renderer && renderer.resetView) renderer.resetView();
      } else {
        viewer.selectedStage = index;
        // `selectStage` émet l'évènement : l'inspecteur, l'analyse et l'éditeur
        // se synchronisent par le même chemin qu'un clic sur le dessin.
        if (renderer && renderer.selectStage) renderer.selectStage(index);
        if (renderer && renderer.focusStage) renderer.focusStage(index);
      }
    }
    this._markStages();
    return this;
  };

  /**
   * Plus aucune solution à décrire. Sans cela, un filtre qui n'en laisse
   * passer aucune laissait l'identité, les puces d'étage et la chaîne
   * cinématique de la PRÉCÉDENTE à l'écran, sous un message annonçant qu'il
   * n'en reste aucune.
   */
  SolutionHeader.prototype.clear = function () {
    this.solution = null;
    this.index = -1;
    this.stage = -1;
    return this.render();
  };

  SolutionHeader.prototype.render = function () {
    if (!this.identity || !this.stagesHost) return this;
    var solution = this.solution;
    this.identity.textContent = '';
    this.stagesHost.textContent = '';
    var absent = !solution;
    this.identity.hidden = absent;
    this.stagesHost.hidden = absent;
    if (absent) {
      // La chaîne cinématique décrit la même solution : elle disparaît avec.
      if (this.chainHost) { this.chainHost.textContent = ''; this.chainHost.hidden = true; }
      return this;
    }

    var badge = this._badge();
    if (badge) this.identity.appendChild(node('span', 'identity-badge', badge));
    var architecture = (solution.stages || []).map(function (stage) {
      return GearTransmissionRegistry.familyName(stage.type, 'short');
    }).join(' → ');
    this.identity.appendChild(node('strong', 'identity-architecture', architecture));
    var row = node('span', 'identity-metrics');
    metrics(solution).forEach(function (value) { row.appendChild(node('span', 'identity-metric', value)); });
    this.identity.appendChild(row);

    var all = node('button', 'stage-chip', 'Ensemble');
    all.type = 'button';
    all.dataset.stageNav = 'all';
    this.stagesHost.appendChild(all);
    (solution.stages || []).forEach(function (stage, index) {
      var chip = node('button', 'stage-chip', (index + 1) + ' · ' + GearTransmissionRegistry.familyName(stage.type, 'short'));
      chip.type = 'button';
      chip.dataset.stageNav = String(index);
      this.stagesHost.appendChild(chip);
    }, this);
    this._markStages();
    this._renderChain();
    return this;
  };

  /**
   * §17 : la cascade des vitesses, de l'entrée à la sortie. Le tableau
   * mécanique dit tout — rapport, rendement, efforts — mais ne montre pas le
   * CHEMIN : combien de tours à la sortie de l'étage 1, dans quel sens, et ce
   * qu'il en reste à l'étage suivant. C'est ce qu'on lit d'abord sur un croquis
   * fait à la main, et c'est ce qui manquait.
   *
   * Les vitesses viennent du même calcul que le reste. Faute de régime — une
   * chaîne analysée sans conditions de service — la cascade dit les RAPPORTS,
   * qui eux ne dépendent d'aucun régime, et ne fabrique pas de tours/minute.
   */
  SolutionHeader.prototype._renderChain = function () {
    var host = this.chainHost, solution = this.solution;
    if (!host) return this;
    host.textContent = '';
    var stages = solution && solution.mechanical ? solution.mechanical : null;
    host.hidden = !stages || !stages.length;
    if (host.hidden) return this;

    var speed = solution.inputSpeedRpm;
    var known = Number.isFinite(speed);
    host.appendChild(this._chainNode('Entrée',
      known ? num(Math.abs(speed), 0, ' rpm') : 'régime non renseigné', 'chain-end'));
    var direction = 1;
    stages.forEach(function (stage, index) {
      var ratio = Math.abs(stage.ratio);
      var label = (index + 1) + ' · ' + GearTransmissionRegistry.familyName(stage.type, 'short');
      this.chainHost.appendChild(this._chainNode(label,
        Number.isFinite(ratio) ? num(ratio, 3, ' : 1') : '—', 'chain-stage', index));
      if (Number.isFinite(stage.signedRatio) && stage.signedRatio < 0) direction = -direction;
      if (known && Number.isFinite(ratio) && ratio !== 0) speed = speed / ratio;
      var arrow = index < stages.length - 1 ? 'Arbre ' + (index + 1) : 'Sortie';
      this.chainHost.appendChild(this._chainNode(arrow,
        known ? num(Math.abs(speed), 1, ' rpm ') + (direction < 0 ? '↻' : '↺') : '—',
        index < stages.length - 1 ? 'chain-shaft' : 'chain-end'));
    }, this);
    return this;
  };

  SolutionHeader.prototype._chainNode = function (label, value, className, stageIndex) {
    var item = node('li', 'chain-node ' + className);
    item.appendChild(node('span', 'chain-label', label));
    item.appendChild(node('strong', 'chain-value', value));
    if (stageIndex != null) {
      // Un maillon d'étage est cliquable : c'est le même geste que la puce.
      item.dataset.chainStage = String(stageIndex);
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      var self = this;
      var pick = function () { self.select(stageIndex); };
      item.addEventListener('click', pick);
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); }
      });
    }
    return item;
  };

  /** Le badge de tête, dans les termes de la question posée. */
  SolutionHeader.prototype._badge = function () {
    var solution = this.solution;
    if (!solution) return null;
    // Une transmission décrite par l'utilisateur n'est pas « recommandée » : il
    // n'y a rien eu à recommander.
    // Reçue par un lien : elle n'a été ni cherchée ici, ni décrite ici.
    if (solution.isShared) return 'Partagée';
    if (solution.isBuilt) return 'Analysée';
    if (solution.isExisting) return 'Référence';
    var workbench = GearApp._workbench;
    // Le badge est celui que la carte a calculé : deux calculs donneraient deux
    // verdicts pour une seule solution.
    var annotation = workbench && workbench._annotation;
    var position = workbench && workbench._poolIndexOf ? workbench._poolIndexOf(this.index) : this.index;
    var badges = annotation && annotation.byIndex ? annotation.byIndex[position] || [] : [];
    if (!badges.length) return null;
    var intent = workbench && workbench.session ? workbench.session.intent : null;
    if (badges.indexOf('recommended') >= 0) {
      return Evaluator && Evaluator.leadLabel ? Evaluator.leadLabel(intent) : 'Recommandée';
    }
    // §25 : LE BADGE D'UNE ALTERNATIVE SURVIT AU PASSAGE AU DESSIN.
    //
    // Il ne s'affichait que pour la recommandée. On cliquait « Meilleur
    // rendement », on arrivait sur le dessin, et plus rien ne disait POURQUOI
    // on regardait celle-là plutôt qu'une autre — c'est-à-dire ce qu'on était
    // venu vérifier.
    return Evaluator && Evaluator.label ? Evaluator.label(badges[0], intent) : null;
  };

  SolutionHeader.prototype._markStages = function () {
    var current = this.stage;
    Array.prototype.forEach.call(this.stagesHost.querySelectorAll('[data-stage-nav]'), function (chip) {
      var mine = chip.dataset.stageNav === 'all' ? current < 0 : Number(chip.dataset.stageNav) === current;
      chip.classList.toggle('active', mine);
      chip.setAttribute('aria-pressed', String(mine));
    });
    if (this.chainHost) {
      Array.prototype.forEach.call(this.chainHost.querySelectorAll('[data-chain-stage]'), function (item) {
        item.classList.toggle('active', Number(item.dataset.chainStage) === current);
      });
    }
  };

  GearApp.ui.SolutionHeader = SolutionHeader;
})(GearApp);
