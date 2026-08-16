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
  var KNOWLEDGE = GearApp.requirements.TransmissionAdvisor.KNOWLEDGE;

  /** La case du registre porte l'alias historique pour l'épicycloïdal. */
  function registryId(family) { return family === 'planetary' ? 'planetary' : family; }

  function TypeParametersEditor(host, draft, onChange) {
    this.host = host;
    this.draft = draft;
    this.onChange = onChange || function () {};
  }

  TypeParametersEditor.prototype.setDraft = function (draft) { this.draft = draft; return this; };

  TypeParametersEditor.prototype.render = function () {
    if (!this.host) return this;
    var self = this;
    this.host.textContent = '';

    var families = this.draft.selectedTechnologies();
    if (!families.length) return this;

    families.forEach(function (family) {
      var definitions = Technical.TechnicalSettingsModel.definitionsFor(registryId(family));
      if (!definitions || !Object.keys(definitions).length) return;

      var block = document.createElement('details');
      block.className = 'type-parameters';
      block.dataset.family = family;

      var summary = document.createElement('summary');
      summary.textContent = (KNOWLEDGE[family] ? KNOWLEDGE[family].name : family) + ' — paramètres';
      block.appendChild(summary);

      var grid = document.createElement('div');
      grid.className = 'type-parameters-grid';
      Object.keys(definitions).forEach(function (key) {
        grid.appendChild(self._field(family, key, definitions[key]));
      });
      block.appendChild(grid);
      self.host.appendChild(block);
    });
    return this;
  };

  TypeParametersEditor.prototype._field = function (family, key, definition) {
    var self = this, registry = registryId(family);
    var values = this.draft.technical.typeParameters[registry] || {};
    var current = values[key] !== undefined ? values[key] : definition.default;

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
        node.value = option; node.textContent = option;
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
      self.draft.technical.setTypeParameter(registry, key, value);
      self.onChange(false);
    });
    label.appendChild(control);
    return label;
  };

  GearApp.ui.TypeParametersEditor = TypeParametersEditor;

})(GearApp);
