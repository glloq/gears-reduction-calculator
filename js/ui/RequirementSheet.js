// RequirementSheet.js - La fiche entrée / sortie (choix 2C et 3C).
//
// Plus de « mode de solveur » à choisir : l'utilisateur décrit ce qu'il a et ce
// qu'il veut, ligne par ligne, et chaque ligne porte son intention —
// « = », « ≈ », « ≥ », « ≤ » ou une plage. Le modèle en déduit le problème et
// l'annonce en clair sous la fiche ; c'est le diagnostic vivant du choix 10C,
// obtenu sans lancer le solveur.
//
// Les raccourcis fonctionnels (choix 2B) ne sont que des pré-remplissages de
// cette même fiche : ils accélèrent, ils n'ouvrent pas un second chemin.
(function (GearApp) {
  'use strict';

  var FIELDS = GearApp.requirements.requirement.FIELDS;

  // §8 : les symboles sont parfaits une fois compris, opaques avant. Un
  // `<select>` natif affiche le MÊME texte ouvert et fermé — épeler « Exact »
  // dans la liste l'épellerait aussi dans la case, et ferait déborder la
  // colonne. Le mot est donc porté par l'infobulle et par le nom accessible,
  // et l'épellation à l'ouverture attend un vrai composant de liste.
  var KINDS = [
    { id: 'exact', label: '=', name: 'Exact' },
    { id: 'target', label: '≈', name: 'Cible' },
    { id: 'min', label: '≥', name: 'Minimum' },
    { id: 'max', label: '≤', name: 'Maximum' },
    { id: 'range', label: '⇄', name: 'Plage' }
  ];

  // Choix 2B : des fonctions, pas des grandeurs. Chacune remplit la fiche.
  /**
   * Raccourcis : ils disent QUELLES grandeurs décrivent le problème, et rien
   * d'autre. Ils remplissaient auparavant des valeurs d'exemple (1500 → 125
   * rpm, 80 N·m…) qui dimensionnaient réellement la recherche sans que
   * personne ne les ait choisies. Ils ouvrent maintenant les bonnes lignes,
   * vides, et posent le focus sur la première.
   */
  var SHORTCUTS = [
    { id: 'slow', label: 'Ralentir un moteur',
      reveal: ['input.speed', 'output.speed'],
      clear: ['ratio', 'output.travelPerRev', 'output.force', 'output.linearSpeed'] },
    { id: 'torque', label: 'Augmenter le couple',
      reveal: ['input.speed', 'input.torque', 'output.torque', 'output.speed'],
      clear: ['ratio', 'output.travelPerRev', 'output.force'] },
    { id: 'angle', label: 'Changer d’axe',
      reveal: ['ratio'],
      clear: ['output.speed', 'output.travelPerRev', 'output.force'],
      architecture: { axisAngle: 90 } },
    { id: 'linear', label: 'Déplacer linéairement',
      reveal: ['output.travelPerRev'],
      clear: ['ratio', 'output.speed', 'output.torque'] },
    { id: 'ratio', label: 'Rapport connu',
      reveal: ['ratio'],
      clear: ['output.speed', 'output.travelPerRev', 'output.force', 'output.linearSpeed'] }
  ];

  function el(id) { return document.getElementById(id); }

  function RequirementSheet(session, onChange) {
    this.session = session;
    this.onChange = onChange || function () {};
    this.root = el('requirementSheet');
    this.menu = el('quantityMenu');
    this.addButton = el('addQuantityBtn');
    this.diagnostic = el('requirementDiagnostic');
    this.shortcuts = el('requirementShortcuts');
    this.architecture = el('architectureOptions');
  }

  /** Grandeurs à afficher : les essentielles, plus tout ce qui est renseigné. */
  RequirementSheet.prototype.visibleFields = function () {
    var session = this.session, model = session.requirement;
    var linear = model.inferProblem().mode === 'rotationTranslation';
    return FIELDS.filter(function (field) {
      // Une grandeur MONTRÉE compte, même vide : c'est ce qui permet d'ouvrir
      // « Rapport » sans lui inventer une valeur.
      if (session.isRevealed(field.path)) return true;
      if (field.linear && !linear) return model.get(field.path).isKnown();
      // §6 : puissance OU couple, selon ce que porte la plaque moteur. Les
      // deux à la fois n'apparaissent que si l'utilisateur le demande.
      if (field.motor) {
        var choice = session.motorInput();
        return choice === 'both' || choice === field.motor || model.get(field.path).isKnown();
      }
      return field.essential || model.get(field.path).isKnown();
    });
  };

  RequirementSheet.prototype.render = function () {
    if (!this.root) return this;
    var self = this, model = this.session.requirement;
    this.root.innerHTML = '';

    ['input', 'output', 'ratio'].forEach(function (side) {
      var fields = self.visibleFields().filter(function (f) { return f.side === side; });
      if (!fields.length) return;
      var block = document.createElement('div');
      block.className = 'requirement-block';
      block.dataset.side = side;
      var title = document.createElement('h3');
      title.className = 'requirement-title';
      title.textContent = side === 'input' ? 'Entrée' : side === 'output' ? 'Sortie souhaitée' : 'Rapport';
      block.appendChild(title);
      fields.forEach(function (field) { block.appendChild(self._row(field)); });
      if (side === 'input') block.appendChild(self._motorChoice());
      self.root.appendChild(block);
    });

    this._renderMenu();
    this._renderDiagnostic();
    if (this.architecture) this._renderArchitecture();
    this._renderDerived();
    return this;
  };

  /** Le rapport déduit, affiché là où l'ancien `#derivedRatio` le montrait. */
  RequirementSheet.prototype._renderDerived = function () {
    var derived = el('derivedRatio');
    if (!derived) return;
    var model = this.session.requirement;
    var ratio = model.ratioRequirement(), problem = model.inferProblem(), parts = [];
    if (ratio.isKnown() && problem.mode !== 'ratio') parts.push('Rapport déduit : ' + ratio.describe());
    derived.textContent = parts.join(' · ');

    // §6, §20 : le couple déduit s'annonce là où la puissance se saisit, et
    // non dans une ligne à part — c'est de cette saisie qu'il découle.
    var note = el('motorDerivedTorque');
    if (!note) return;
    var torque = model.inputTorqueRequirement();
    note.textContent = !model.input.torque.isKnown() && torque.isKnown()
      ? 'couple calculé ' + torque.describe() : '';
  };

  /**
   * §6 : « Je connais la puissance / le couple / les deux ». Une plaque moteur
   * porte presque toujours 1500 rpm et 750 W ; exiger un couple obligeait à le
   * calculer soi-même alors que le logiciel sait le faire.
   */
  var MOTOR_CHOICES = [
    { id: 'power', label: 'Puissance' },
    { id: 'torque', label: 'Couple' },
    { id: 'both', label: 'Les deux' }
  ];

  RequirementSheet.prototype._motorChoice = function () {
    var self = this, current = this.session.motorInput();
    var row = document.createElement('div');
    row.className = 'motor-choice';
    row.id = 'motorChoice';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Donnée moteur connue');
    row.appendChild(document.createElement('span')).textContent = 'Je connais :';
    MOTOR_CHOICES.forEach(function (choice) {
      var active = current === choice.id;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'motor-option' + (active ? ' active' : '');
      button.dataset.motor = choice.id;
      button.textContent = choice.label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(active));
      button.addEventListener('click', function () {
        self.session.setMotorInput(choice.id);
        self._changed();
      });
      row.appendChild(button);
    });

    // Le couple déduit est annoncé comme calculé : c'est une conséquence, pas
    // une saisie, et le confondre avec une donnée serait trompeur. La ligne
    // existe toujours, pour être remplie sans reconstruire la fiche — sinon
    // elle n'apparaîtrait qu'au prochain rendu structurel.
    var note = document.createElement('span');
    note.className = 'motor-derived';
    note.id = 'motorDerivedTorque';
    row.appendChild(note);
    return row;
  };

  RequirementSheet.prototype._row = function (field) {
    var self = this, quantity = this.session.requirement.get(field.path);
    var row = document.createElement('div');
    row.className = 'quantity-row';
    row.dataset.path = field.path;

    var label = document.createElement('label');
    label.className = 'quantity-label';
    label.textContent = field.label;
    row.appendChild(label);

    var kind = document.createElement('select');
    kind.className = 'quantity-kind';
    kind.setAttribute('aria-label', field.label + ' : type de valeur (exact, cible, minimum, maximum, plage)');
    KINDS.forEach(function (option) {
      var node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label;
      node.title = option.name + ' — ' + titleFor(option.id);
      node.setAttribute('aria-label', option.name);
      kind.appendChild(node);
    });
    kind.value = quantity.isKnown() ? quantity.kind : 'exact';
    kind.addEventListener('change', function () {
      // Changer d'intention change la STRUCTURE de la ligne (une plage a deux
      // bornes) : c'est le seul cas où elle doit être reconstruite.
      var second = row.querySelector('[data-slot="b"]');
      if (second) second.hidden = kind.value !== 'range';
      if (kind.value === 'range' && second && !String(second.value).trim()) {
        second.value = row.querySelector('[data-slot="a"]').value;
      }
      self._commit(field, row);
    });
    row.appendChild(kind);

    var bounds = quantity.bounds();
    var isRange = kind.value === 'range';
    row.appendChild(this._input(field, 'a', isRange ? bounds.min : quantity.value, field.label));
    var second = this._input(field, 'b', bounds.max, field.label + ' : borne haute');
    second.hidden = !isRange;
    row.appendChild(second);

    var unit = document.createElement('span');
    unit.className = 'quantity-unit';
    unit.textContent = field.unit;
    row.appendChild(unit);

    if (!field.essential) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quantity-remove';
      remove.setAttribute('aria-label', 'Retirer ' + field.label);
      remove.textContent = '×';
      remove.addEventListener('click', function () {
        // Retirer une ligne la retire vraiment : une grandeur seulement
        // MONTRÉE doit aussi cesser de l'être, sinon elle revient aussitôt.
        self.session.requirement.clear(field.path);
        self.session.conceal(field.path);
        self._changed();
      });
      row.appendChild(remove);
    }
    return row;
  };

  RequirementSheet.prototype._input = function (field, slot, value, label) {
    var self = this, input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.className = 'quantity-value';
    input.dataset.slot = slot;
    input.setAttribute('aria-label', label);
    input.value = value == null ? '' : String(Math.round(value * 10000) / 10000);
    input.addEventListener('change', function () { self._commit(field, input.closest('.quantity-row')); });
    return input;
  };

  /** Relit une ligne complète et la repose dans le modèle. */
  RequirementSheet.prototype._commit = function (field, row) {
    var Q = GearApp.requirements.Quantity;
    var kind = row.querySelector('.quantity-kind').value;
    var a = numberOf(row.querySelector('[data-slot="a"]'));
    var b = numberOf(row.querySelector('[data-slot="b"]'));
    var quantity;
    if (kind === 'range') quantity = a == null || b == null ? Q.unknown(field.unit) : Q.between(a, b, field.unit);
    else if (a == null) quantity = Q.unknown(field.unit);
    else if (kind === 'min') quantity = Q.atLeast(a, field.unit);
    else if (kind === 'max') quantity = Q.atMost(a, field.unit);
    else if (kind === 'target') quantity = Q.target(a, null, field.unit);
    else quantity = Q.exact(a, field.unit);
    this.session.requirement.set(field.path, quantity);
    // `structural: false` : la ligne éditée reste telle quelle, seuls le
    // diagnostic, le rapport déduit et le conseiller sont recalculés.
    this._changed(false);
  };

  RequirementSheet.prototype._renderMenu = function () {
    if (!this.menu || !this.addButton) return;
    var self = this, visible = this.visibleFields().map(function (f) { return f.path; });
    var linear = this.session.requirement.inferProblem().mode === 'rotationTranslation';
    var available = FIELDS.filter(function (field) {
      if (visible.indexOf(field.path) !== -1) return false;
      // Une grandeur linéaire reste proposable : c'est elle qui fera basculer
      // le problème, l'utilisateur n'a pas à annoncer le changement d'abord.
      return linear ? true : !field.linear || field.path === 'output.travelPerRev' || field.path === 'output.force';
    });
    this.menu.innerHTML = '';
    if (!available.length) { this.addButton.hidden = true; return; }
    this.addButton.hidden = false;
    available.forEach(function (field) {
      var item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.field = field.path;
      item.textContent = field.label;
      item.addEventListener('click', function () {
        // §2 : la ligne s'ouvre VIDE. Poser « 12:1 » parce qu'on a cliqué sur
        // « Rapport » dimensionnerait le réducteur à la place de l'utilisateur.
        self.session.reveal(field.path);
        self.menu.hidden = true;
        self.addButton.setAttribute('aria-expanded', 'false');
        self._changed();
        self._focus(field.path);
      });
      self.menu.appendChild(item);
    });
  };

  /**
   * §9 : le diagnostic listait TOUTES les notes. Avec les capacités actuelles
   * cela fait sept lignes dont cinq n'appellent aucune action, et le résumé
   * latéral porte déjà l'analyse détaillée. On montre donc l'état, la remarque
   * la plus utile, et le reste sur demande.
   */
  RequirementSheet.prototype._renderDiagnostic = function () {
    if (!this.diagnostic) return;
    var self = this, notes = this.session.diagnose();
    this.diagnostic.innerHTML = '';
    if (!notes.length) return;

    var blocking = notes.filter(function (note) { return note.level === 'error'; });
    var warnings = notes.filter(function (note) { return note.level === 'warn'; });
    var lead = blocking.concat(warnings)[0];
    var shown = blocking.length ? blocking : (lead ? [lead] : []);

    var state = document.createElement('span');
    state.className = 'diagnostic-note diagnostic-' + (blocking.length ? 'error' : 'ok');
    state.dataset.code = 'state';
    state.textContent = blocking.length ? '✕ Besoin incomplet' : '✓ Besoin exploitable';
    this.diagnostic.appendChild(state);

    shown.forEach(function (note) { self.diagnostic.appendChild(self._note(note)); });

    var rest = notes.filter(function (note) {
      return note !== lead && note.level !== 'ok' && shown.indexOf(note) === -1;
    });
    if (!rest.length) return;
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn-link diagnostic-more';
    more.id = 'diagnosticMore';
    more.textContent = this._diagnosticOpen
      ? 'Masquer les remarques'
      : rest.length + (rest.length > 1 ? ' autres remarques' : ' autre remarque');
    more.setAttribute('aria-expanded', String(!!this._diagnosticOpen));
    more.addEventListener('click', function () {
      self._diagnosticOpen = !self._diagnosticOpen;
      self._renderDiagnostic();
    });
    this.diagnostic.appendChild(more);
    if (this._diagnosticOpen) rest.forEach(function (note) { self.diagnostic.appendChild(self._note(note)); });
  };

  RequirementSheet.prototype._note = function (note) {
    var self = this;
    var line = document.createElement('span');
    line.className = 'diagnostic-note diagnostic-' + note.level;
    line.dataset.code = note.code;
    line.textContent = (note.level === 'error' ? '✕ ' : note.level === 'warn' ? '△ ' : '✓ ') + note.text;
    // §14 : une remarque qui désigne un champ y emmène.
    if (note.field) {
      line.classList.add('diagnostic-actionable');
      line.tabIndex = 0;
      line.setAttribute('role', 'button');
      line.title = 'Aller au champ concerné';
      var jump = function () { self.session.reveal(note.field); self._changed(); self._focus(note.field); };
      line.addEventListener('click', jump);
      line.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(); }
      });
    }
    return line;
  };

  RequirementSheet.prototype._renderArchitecture = function () {
    var self = this, architecture = this.session.requirement.architecture;
    Array.prototype.forEach.call(this.architecture.querySelectorAll('[data-architecture]'), function (control) {
      var key = control.dataset.architecture;
      if (control.type === 'checkbox') control.checked = architecture[key] === control.value || (control.value === '90' && architecture[key] === 90);
      else control.value = String(architecture[key]);
      if (control.dataset.bound) return;
      control.dataset.bound = '1';
      control.addEventListener('change', function () {
        // Relire le modèle À L'INSTANT du clic : une restauration remplace
        // l'objet `requirement`, et une capture au premier rendu écrirait dans
        // un modèle abandonné — le réglage semblerait alors sans effet.
        var live = self.session.requirement.architecture;
        live[key] = control.type === 'checkbox'
          ? (control.checked ? (control.value === '90' ? 90 : control.value) : (key === 'axisAngle' ? 0 : 'any'))
          : control.value;
        self._changed();
      });
    });
  };

  RequirementSheet.prototype.bind = function () {
    var self = this;
    if (this.addButton && this.menu) {
      this.addButton.addEventListener('click', function () {
        var open = self.menu.hidden;
        self.menu.hidden = !open;
        self.addButton.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', function (event) {
        if (self.menu.hidden) return;
        if (event.target.closest && event.target.closest('#quantityMenu, #addQuantityBtn')) return;
        self.menu.hidden = true;
        self.addButton.setAttribute('aria-expanded', 'false');
      });
    }
    if (this.shortcuts) {
      this.shortcuts.innerHTML = '';
      SHORTCUTS.forEach(function (shortcut) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'requirement-shortcut';
        button.dataset.shortcut = shortcut.id;
        button.textContent = shortcut.label;
        button.addEventListener('click', function () {
          var model = self.session.requirement;
          (shortcut.clear || []).forEach(function (path) { model.clear(path); self.session.conceal(path); });
          (shortcut.reveal || []).forEach(function (path) { self.session.reveal(path); });
          if (shortcut.architecture) Object.assign(model.architecture, shortcut.architecture);
          self._changed();
          self._focus(shortcut.reveal && shortcut.reveal[0]);
        });
        self.shortcuts.appendChild(button);
      });
    }
    return this.render();
  };

  /**
   * @param {boolean} [structural=true] Reconstruire la fiche. À laisser faux
   * quand le changement vient d'un champ que l'utilisateur est en train
   * d'éditer : le recréer lui volerait le focus.
   */
  RequirementSheet.prototype._changed = function (structural) {
    this.session._advice = null;
    if (structural === false) {
      this._renderDiagnostic();
      this._renderDerived();
      this.onChange(false);
      return;
    }
    this.render();
    this.onChange(true);
  };

  function numberOf(input) {
    if (!input) return null;
    var raw = String(input.value).trim();
    if (raw === '') return null;
    var parsed = Number(raw.replace(',', '.'));
    return isFinite(parsed) ? parsed : null;
  }

  /** Pose le curseur dans la ligne qui vient d'apparaître. */
  RequirementSheet.prototype._focus = function (path) {
    if (!path || !this.root) return;
    var input = this.root.querySelector('.quantity-row[data-path="' + path + '"] [data-slot="a"]');
    if (input && input.focus) input.focus();
  };

  function titleFor(kind) {
    return { exact: 'Exactement cette valeur', target: 'Autour de cette valeur', min: 'Au moins', max: 'Au plus', range: 'Entre deux valeurs' }[kind] || '';
  }

  GearApp.ui.RequirementSheet = RequirementSheet;
  RequirementSheet.SHORTCUTS = SHORTCUTS;
  RequirementSheet.KINDS = KINDS;

})(GearApp);
