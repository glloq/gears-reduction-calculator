// AdvisorPanel.js - « Automatique » veut enfin dire quelque chose (choix 5C).
//
// L'ancien panneau cochait les huit familles rotatives et appelait ça un choix
// automatique. Celui-ci affiche le classement du conseiller, ses raisons, et
// ce que la sélection ne sait pas faire. L'utilisateur peut toujours reprendre
// la main — c'est alors une décision, plus un réglage par défaut subi.
(function (GearApp) {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function AdvisorPanel(session, onChange) {
    this.session = session;
    this.onChange = onChange || function () {};
    this.summary = el('technologySummary');
    this.list = el('advisorList');
    this.gaps = el('advisorGaps');
    this.modeButtons = el('technologyMode');
  }

  AdvisorPanel.prototype.render = function () {
    var advice = this.session.advice(), selected = this.session.selectedTechnologies();
    if (this.summary) {
      this.summary.textContent = this.session.technologyMode === 'auto'
        ? 'Conseillé : ' + (advice.recommended.map(function (e) { return e.name; }).join(', ') || 'aucune famille ne se détache')
        : selected.length + (selected.length > 1 ? ' familles choisies' : ' famille choisie');
      this.summary.dataset.mode = this.session.technologyMode;
    }
    if (this.modeButtons) {
      Array.prototype.forEach.call(this.modeButtons.querySelectorAll('[data-technology-mode]'), function (button) {
        var active = button.dataset.technologyMode === this.session.technologyMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }, this);
    }
    this._renderList(advice, selected);
    this._renderGaps(advice);
    return this;
  };

  AdvisorPanel.prototype._renderList = function (advice, selected) {
    if (!this.list) return;
    var self = this, manual = this.session.technologyMode === 'manual';
    this.list.innerHTML = '';
    var groups = [
      { id: 'recommended', label: 'Recommandé', entries: advice.recommended },
      { id: 'possible', label: 'Possible', entries: advice.possible },
      { id: 'excluded', label: 'Écarté', entries: advice.excluded }
    ];
    groups.forEach(function (group) {
      if (!group.entries.length) return;
      var heading = document.createElement('p');
      heading.className = 'advisor-group';
      heading.textContent = group.label;
      self.list.appendChild(heading);
      group.entries.forEach(function (entry) {
        self.list.appendChild(self._entry(entry, group.id, manual, selected.indexOf(entry.id) !== -1));
      });
    });
  };

  AdvisorPanel.prototype._entry = function (entry, verdict, manual, checked) {
    var self = this;
    var row = document.createElement('div');
    row.className = 'advisor-entry advisor-' + verdict;
    row.dataset.family = entry.id;

    var head = document.createElement('div');
    head.className = 'advisor-head';

    if (verdict !== 'excluded') {
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.disabled = !manual;
      box.id = 'advisor-' + entry.id;
      box.addEventListener('change', function () {
        var list = self.session.selectedTechnologies();
        var index = list.indexOf(entry.id);
        if (box.checked && index === -1) list.push(entry.id);
        if (!box.checked && index !== -1) list.splice(index, 1);
        self.session.technologies = list;
        self.onChange();
      });
      head.appendChild(box);
      var label = document.createElement('label');
      label.setAttribute('for', box.id);
      label.className = 'advisor-name';
      label.textContent = entry.name;
      head.appendChild(label);
    } else {
      var name = document.createElement('span');
      name.className = 'advisor-name';
      name.textContent = entry.name;
      head.appendChild(name);
    }

    if (verdict !== 'excluded') {
      var score = document.createElement('span');
      score.className = 'advisor-score';
      score.textContent = Math.round(entry.score * 100) + ' %';
      head.appendChild(score);
    }
    row.appendChild(head);

    if (entry.reasons && entry.reasons.length) {
      var reasons = document.createElement('ul');
      reasons.className = 'advisor-reasons';
      entry.reasons.slice(0, 3).forEach(function (reason) {
        var item = document.createElement('li');
        item.className = 'advisor-reason advisor-' + reason.level;
        item.textContent = (reason.level === 'pro' ? '✓ ' : reason.level === 'blocker' ? '× ' : '△ ') + reason.text;
        reasons.appendChild(item);
      });
      row.appendChild(reasons);
    }
    return row;
  };

  AdvisorPanel.prototype._renderGaps = function (advice) {
    if (!this.gaps) return;
    this.gaps.innerHTML = '';
    this.gaps.hidden = !advice.coverage.length;
    advice.coverage.forEach(function (gap) {
      var line = document.createElement('p');
      line.className = 'advisor-gap';
      line.dataset.code = gap.code;
      line.textContent = '△ ' + gap.text;
      this.gaps.appendChild(line);
    }, this);
  };

  AdvisorPanel.prototype.bind = function () {
    var self = this;
    if (this.modeButtons) {
      this.modeButtons.addEventListener('click', function (event) {
        var button = event.target.closest('[data-technology-mode]');
        if (!button) return;
        self.session.technologyMode = button.dataset.technologyMode;
        // Passer en manuel part de ce que le conseiller proposait : on ne
        // renvoie jamais l'utilisateur devant une liste vide.
        if (self.session.technologyMode === 'manual' && !self.session.technologies.length) {
          self.session.technologies = self.session.advice().selection.slice();
        }
        self.onChange();
      });
    }
    return this.render();
  };

  GearApp.ui.AdvisorPanel = AdvisorPanel;

})(GearApp);
