// TypeParametersEditor.js - Les réglages d'une famille, là où ils servent (§15).
//
// L'angle d'hélice n'a de sens que si un hélicoïdal est exploré ; les organes
// soleil / couronne / porte-satellites, que pour un planétaire. Les afficher
// tous en permanence obligeait l'utilisateur à trier lui-même, et à croiser un
// « nombre de filets » alors qu'aucune vis n'était en jeu.
//
// L'éditeur ne connaît aucun paramètre : il lit le registre, qui reste la
// définition unique, et écrit dans `TechnicalSettingsModel`.
(function (GearApp) {
  'use strict';

  var Technical = GearApp.requirements.technicalSettings;

  /** La case du registre porte l'alias historique pour l'épicycloïdal. */
  function registryId(family) { return family === 'planetary' ? 'planetary' : family; }

  /**
   * Les trois rôles d'un planétaire. Trois organes, trois rôles : c'est une
   * PERMUTATION, pas trois choix libres — d'où l'échange plutôt que le refus.
   */
  var PLANETARY_ROLES = ['inputMember', 'fixed', 'outputMember'];

  function TypeParametersEditor(host, draft, onChange) {
    this.host = host;
    this.draft = draft;
    this.onChange = onChange || function () {};
    this._fields = [];
    // Quels blocs sont dépliés. Le rendu est intégral à chaque changement :
    // sans cette mémoire, régler un paramètre refermait le bloc dans lequel on
    // était en train de le régler.
    this._open = {};
  }

  TypeParametersEditor.prototype.setDraft = function (draft) { this.draft = draft; return this; };

  TypeParametersEditor.prototype.render = function () {
    if (!this.host) return this;
    var self = this;
    this.host.textContent = '';

    var families = this.draft.selectedTechnologies();
    this._fields = [];
    if (!families.length) return this;

    families.forEach(function (family) {
      var definitions = Technical.TechnicalSettingsModel.definitionsFor(registryId(family));
      if (!definitions || !Object.keys(definitions).length) return;

      var block = document.createElement('details');
      block.className = 'type-parameters';
      block.dataset.family = family;
      block.open = !!self._open[family];
      block.addEventListener('toggle', function () { self._open[family] = block.open; });

      var summary = document.createElement('summary');
      summary.textContent = GearTransmissionRegistry.familyName(family) + ' — paramètres';
      block.appendChild(summary);

      var grid = document.createElement('div');
      grid.className = 'type-parameters-grid';
      Object.keys(definitions).forEach(function (key) {
        grid.appendChild(self._field(family, key, definitions[key], definitions));
      });
      block.appendChild(grid);
      self.host.appendChild(block);
    });
    this._applyDependencies();
    return this;
  };

  /** La valeur courante d'un paramètre, défaut du registre compris. */
  TypeParametersEditor.prototype._value = function (registry, key, definitions) {
    var values = this.draft.technical.typeParameters[registry] || {};
    if (values[key] !== undefined) return values[key];
    return definitions && definitions[key] ? definitions[key].default : undefined;
  };

  /**
   * Un paramètre conditionné (`dependsOn`) n'est montré que lorsque sa
   * condition est remplie : en mode « Automatique », la recherche essaie les
   * six topologies, et imposer un organe d'entrée n'aurait aucun sens.
   */
  TypeParametersEditor.prototype._applyDependencies = function () {
    this._fields.forEach(function (field) {
      var conditions = field.definition.dependsOn;
      var visible = true;
      if (conditions) {
        Object.keys(conditions).forEach(function (key) {
          if (String(this._value(field.registry, key, field.definitions)) !== String(conditions[key])) visible = false;
        }, this);
      }
      field.label.hidden = !visible;
    }, this);
  };

  /**
   * Trois organes pour trois rôles : choisir la couronne comme entrée alors
   * qu'elle était fixe laisse un rôle orphelin. Plutôt que de refuser la
   * saisie — et de laisser l'utilisateur devant un état invalide à réparer —
   * on ÉCHANGE : toute permutation des trois organes reste une topologie
   * valide, et le registre n'a jamais à rejeter ce que l'éditeur produit.
   */
  TypeParametersEditor.prototype._swapPlanetaryRole = function (registry, key, value, definitions) {
    var technical = this.draft.technical;
    var previous = this._value(registry, key, definitions);
    if (previous === value) return;
    PLANETARY_ROLES.forEach(function (other) {
      if (other === key) return;
      if (this._value(registry, other, definitions) === value) technical.setTypeParameter(registry, other, previous);
    }, this);
  };

  /** Réaligne les contrôles sur le modèle après un échange d'organes. */
  TypeParametersEditor.prototype._syncControls = function (registry) {
    this._fields.forEach(function (field) {
      if (field.registry !== registry || field.definition.type !== 'select') return;
      field.control.value = String(this._value(registry, field.key, field.definitions));
    }, this);
  };

  TypeParametersEditor.prototype._field = function (family, key, definition, definitions) {
    var self = this, registry = registryId(family);
    var current = this._value(registry, key, definitions);

    var label = document.createElement('label');
    label.className = 'type-parameter';
    var text = document.createElement('span');
    text.textContent = definition.label;
    label.appendChild(text);

    var control;
    if (definition.type === 'select') {
      control = document.createElement('select');
      (definition.options || []).forEach(function (option) {
        var node = document.createElement('option');
        node.value = option;
        // Un code nu — « S », « auto » — ne dit rien : le registre donne le
        // libellé lisible, et l'éditeur ne le devine pas (§9).
        node.textContent = (definition.optionLabels && definition.optionLabels[option]) || option;
        control.appendChild(node);
      });
      control.value = String(current);
    } else if (definition.type === 'checkbox') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = !!current;
    } else {
      control = document.createElement('input');
      control.type = 'number';
      if (definition.min != null) control.min = definition.min;
      if (definition.max != null) control.max = definition.max;
      control.step = definition.step || 'any';
      control.value = current == null ? '' : String(current);
    }
    control.id = 'tpm_' + registry + '_' + key;
    control.dataset.family = registry;
    control.dataset.parameter = key;
    control.addEventListener('change', function () {
      var value = definition.type === 'checkbox' ? control.checked
        : definition.type === 'number' ? parseFloat(control.value)
          : control.value;
      // Un champ vidé revient au défaut du registre plutôt que de poser NaN.
      if (definition.type === 'number' && !isFinite(value)) value = definition.default;
      if (registry === 'planetary' && PLANETARY_ROLES.indexOf(key) >= 0) {
        self._swapPlanetaryRole(registry, key, value, definitions);
      }
      self.draft.technical.setTypeParameter(registry, key, value);
      self._syncControls(registry);
      self._applyDependencies();
      self.onChange(false);
    });
    label.appendChild(control);
    this._fields.push({ registry: registry, key: key, definition: definition,
      definitions: definitions, label: label, control: control });
    return label;
  };

  GearApp.ui.TypeParametersEditor = TypeParametersEditor;

})(GearApp);
