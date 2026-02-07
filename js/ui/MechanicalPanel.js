// MechanicalPanel.js - Panneau d'analyse mécanique détaillée
// Supporte le mode standard et le mode pro avec informations enrichies

(function (GearApp) {

  function MechanicalPanel(panelId) {
    this._panel = document.getElementById(panelId);
    this._proMode = false;
    this._params = null;
  }

  MechanicalPanel.prototype.hide = function () {
    if (this._panel) this._panel.style.display = "none";
  };

  MechanicalPanel.prototype.show = function (solution, params, proMode) {
    if (!this._panel) return null;
    this._proMode = !!proMode;
    this._params = params;

    if (!params || !params.module) {
      this._panel.innerHTML = '<p class="hint">Renseignez le module pour voir l\'analyse mécanique complète.</p>';
      this._panel.style.display = "block";
      return null;
    }

    var analyse = GearApp.core.GearMechanics.analyserTrainEngrenages(solution, params);
    this._panel.innerHTML = this._buildHTML(analyse);
    this._panel.style.display = "block";
    return analyse;
  };

  MechanicalPanel.prototype._buildHTML = function (analyse) {
    var html = '<h3>Analyse mécanique</h3>';
    html += this._buildSummaryCards(analyse);
    html += this._buildStagesTable(analyse);
    if (this._proMode) {
      html += this._buildProDetails(analyse);
    }
    html += this._buildGeometryDetails(analyse);
    return html;
  };

  MechanicalPanel.prototype._buildSummaryCards = function (analyse) {
    var sensLabel = analyse.sensRotationTotal > 0 ? 'Même sens' : 'Inversé';
    var rendClass = analyse.rendementTotal > 0.95 ? 'excellent' : analyse.rendementTotal > 0.90 ? 'good' : 'warning';
    var perteTotale = analyse.puissanceEntree - analyse.puissanceSortie;

    var html = '<div class="mech-summary">';
    html += this._card('Rapport total', analyse.rapportTotal.toFixed(4));
    html += this._card('Rendement total', (analyse.rendementTotal * 100).toFixed(1) + '%', rendClass);
    html += this._card('Vitesse sortie', analyse.vitesseSortie.toFixed(1) + ' tr/min');
    html += this._card('Couple sortie', analyse.coupleSortie.toFixed(2) + ' N.m');
    html += this._card('Puissance entrée', analyse.puissanceEntree.toFixed(1) + ' W');
    html += this._card('Puissance sortie', analyse.puissanceSortie.toFixed(1) + ' W');
    html += this._card('Sens rotation', sensLabel);

    if (this._proMode) {
      html += this._card('Pertes totales', perteTotale.toFixed(1) + ' W', perteTotale > analyse.puissanceEntree * 0.2 ? 'warning' : '');
    }

    html += '</div>';
    return html;
  };

  MechanicalPanel.prototype._card = function (label, value, extraClass) {
    return '<div class="mech-card">' +
      '<span class="mech-label">' + label + '</span>' +
      '<span class="mech-value' + (extraClass ? ' ' + extraClass : '') + '">' + value + '</span>' +
      '</div>';
  };

  MechanicalPanel.prototype._buildStagesTable = function (analyse) {
    var html = '<h4>Détails par étage</h4>';
    html += '<div class="stages-table-container"><table class="stages-table"><thead><tr>';
    html += '<th>Étage</th><th>Type</th><th>Menante</th><th>Menée</th><th>Rapport</th>';
    html += '<th>Entraxe</th><th>Rendement</th><th>Vitesse sortie</th>';
    html += '<th>Couple sortie</th><th>Rapp. conduite</th><th>Sécurité</th><th>Axes</th>';
    if (this._proMode) {
      html += '<th>V. périph.</th><th>Contrainte</th><th>Pertes</th>';
    }
    html += '</tr></thead><tbody>';

    var axesLabels = { parallel: 'Parallèle', perpendicular: '90°', coaxial: 'Coaxial', offset: 'Décalé' };
    var proMode = this._proMode;
    var angleContact = (this._params && this._params.angleContact) || 20;

    analyse.etages.forEach(function (etage, i) {
      var secMin = Math.min(etage.resistanceMenante.facteurSecurite, etage.resistanceMenee.facteurSecurite);
      var secClass = secMin >= 2 ? 'excellent' : secMin >= 1.5 ? 'good' : 'warning';

      var hasConduite = etage.rapportConduite !== null && etage.rapportConduite !== undefined;
      var conduiteText = hasConduite ? etage.rapportConduite.toFixed(2) : '-';
      var conduiteClass = hasConduite ? (etage.rapportConduite >= 1.2 ? 'excellent' : etage.rapportConduite >= 1.0 ? 'good' : 'warning') : '';

      var interfWarning = '';
      if (etage.typeId !== 'belt' && etage.typeId !== 'worm' && etage.typeId !== 'epicyclic') {
        var interf = GearApp.core.GearMechanics.verifierInterference(etage.dentsMenante, etage.dentsMenee, angleContact);
        if (interf.interfere && !interf.menanteSuffisant) {
          interfWarning = '<span class="warning-icon" title="Risque d\'interférence (min ' + interf.nbDentsMinimal + ' dents pour α=' + angleContact + '°)">!</span>';
        }
      }

      var entraxeText = etage.geometrie.entraxe !== null ? etage.geometrie.entraxe.toFixed(2) + ' mm' : '-';
      var axesText = axesLabels[etage.axesRelation] || etage.axesRelation;
      var sensIcon = etage.sensRotation > 0 ? '↻' : '↺';

      html += '<tr>';
      html += '<td>' + (i + 1) + '</td>';
      html += '<td><span class="type-badge ' + etage.typeId + '">' + etage.typeNomCourt + '</span></td>';
      html += '<td>' + etage.dentsMenante + ' ' + etage.uniteA + ' ' + interfWarning + '</td>';
      html += '<td>' + etage.dentsMenee + ' ' + etage.uniteB + '</td>';
      html += '<td>' + etage.rapport.toFixed(3) + '</td>';
      html += '<td>' + entraxeText + '</td>';
      html += '<td>' + (etage.rendement * 100).toFixed(1) + '%</td>';
      html += '<td>' + etage.vitesseSortie.toFixed(1) + ' tr/min</td>';
      html += '<td>' + etage.coupleSortie.toFixed(2) + ' N.m</td>';
      html += '<td class="' + conduiteClass + '">' + conduiteText + '</td>';
      html += '<td class="' + secClass + '">' + (secMin === Infinity ? '∞' : secMin.toFixed(1)) + '</td>';
      html += '<td>' + axesText + ' ' + sensIcon + '</td>';

      if (proMode) {
        // Vitesse périphérique
        var vpText = etage.vitessePeripherique ? etage.vitessePeripherique.toFixed(2) + ' m/s' : '-';
        var vpClass = etage.vitessePeripherique > 15 ? 'warning' : etage.vitessePeripherique > 10 ? 'good' : '';
        html += '<td class="' + vpClass + '">' + vpText + '</td>';

        // Contrainte de flexion max
        var contrainte = Math.max(etage.resistanceMenante.contrainteFlexion, etage.resistanceMenee.contrainteFlexion);
        var cText = contrainte > 0 ? contrainte.toFixed(1) + ' MPa' : '-';
        html += '<td>' + cText + '</td>';

        // Pertes de puissance
        html += '<td>' + etage.pertePuissance.toFixed(1) + ' W</td>';
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  };

  /**
   * Section Pro : informations avancées (jeu de denture, résistance Lewis, etc.)
   */
  MechanicalPanel.prototype._buildProDetails = function (analyse) {
    var html = '<div class="pro-analysis">';
    html += '<h4>Analyse avancée</h4>';

    var mod = (this._params && this._params.module) || 2;
    var qualiteISO = (this._params && this._params.qualiteISO) || 7;
    var angleContact = (this._params && this._params.angleContact) || 20;

    // Jeu de denture
    var jeu = GearApp.core.GearMechanics.calculerJeuDenture(mod, qualiteISO);
    html += '<div class="pro-section">';
    html += '<h5>Jeu de denture (ISO ' + jeu.qualiteISO + ')</h5>';
    html += '<div class="pro-grid">';
    html += '<div><strong>Jeu nominal:</strong> ' + jeu.jeu.toFixed(3) + ' mm</div>';
    html += '<div><strong>Jeu min:</strong> ' + jeu.jeuMin.toFixed(3) + ' mm</div>';
    html += '<div><strong>Jeu max:</strong> ' + jeu.jeuMax.toFixed(3) + ' mm</div>';
    html += '</div></div>';

    // Résistance Lewis détaillée par étage
    html += '<div class="pro-section">';
    html += '<h5>Résistance Lewis par étage</h5>';
    html += '<table class="stages-table"><thead><tr>';
    html += '<th>Étage</th><th>Élément</th><th>Facteur Y</th><th>Force tang. (N)</th>';
    html += '<th>Contrainte (MPa)</th><th>Sécurité</th>';
    html += '</tr></thead><tbody>';

    analyse.etages.forEach(function (etage, i) {
      if (etage.typeId === 'belt') return;

      var rA = etage.resistanceMenante;
      var rB = etage.resistanceMenee;

      if (rA.facteurLewis > 0) {
        var secAClass = rA.facteurSecurite >= 2 ? 'excellent' : rA.facteurSecurite >= 1.5 ? 'good' : 'warning';
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td>' + etage.labelA + ' (' + etage.dentsMenante + ')</td>';
        html += '<td>' + rA.facteurLewis.toFixed(4) + '</td>';
        html += '<td>' + rA.forceTangentielle.toFixed(1) + '</td>';
        html += '<td>' + rA.contrainteFlexion.toFixed(1) + '</td>';
        html += '<td class="' + secAClass + '">' + (rA.facteurSecurite === Infinity ? '∞' : rA.facteurSecurite.toFixed(2)) + '</td>';
        html += '</tr>';
      }

      if (rB.facteurLewis > 0) {
        var secBClass = rB.facteurSecurite >= 2 ? 'excellent' : rB.facteurSecurite >= 1.5 ? 'good' : 'warning';
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td>' + etage.labelB + ' (' + etage.dentsMenee + ')</td>';
        html += '<td>' + rB.facteurLewis.toFixed(4) + '</td>';
        html += '<td>' + rB.forceTangentielle.toFixed(1) + '</td>';
        html += '<td>' + rB.contrainteFlexion.toFixed(1) + '</td>';
        html += '<td class="' + secBClass + '">' + (rB.facteurSecurite === Infinity ? '∞' : rB.facteurSecurite.toFixed(2)) + '</td>';
        html += '</tr>';
      }
    });

    html += '</tbody></table></div>';

    // Contrainte de Hertz (contact) par étage
    var hasHertz = analyse.etages.some(function (e) { return e.hertzContact !== null; });
    if (hasHertz) {
      html += '<div class="pro-section">';
      html += '<h5>Contrainte de Hertz (contact) par étage</h5>';
      html += '<table class="stages-table"><thead><tr>';
      html += '<th>Étage</th><th>Type</th><th>σH (MPa)</th><th>Sécurité contact</th><th>ZH</th><th>Force tang. (N)</th>';
      html += '</tr></thead><tbody>';

      analyse.etages.forEach(function (etage, i) {
        if (!etage.hertzContact) return;
        var h = etage.hertzContact;
        var secClass = h.facteurSecuriteContact >= 1.3 ? 'excellent' : h.facteurSecuriteContact >= 1.0 ? 'good' : 'warning';
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td><span class="type-badge ' + etage.typeId + '">' + etage.typeNomCourt + '</span></td>';
        html += '<td>' + h.contrainteHertz.toFixed(1) + '</td>';
        html += '<td class="' + secClass + '">' + h.facteurSecuriteContact.toFixed(2) + '</td>';
        html += '<td>' + h.ZH.toFixed(3) + '</td>';
        html += '<td>' + h.forceTangentielle.toFixed(1) + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    // Vérification d'interférence détaillée
    html += '<div class="pro-section">';
    html += '<h5>Interférence</h5>';
    html += '<div class="pro-grid">';

    var nbDentsMin = Math.ceil(2 / Math.pow(Math.sin(angleContact * Math.PI / 180), 2));
    html += '<div><strong>Angle de pression:</strong> ' + angleContact + '°</div>';
    html += '<div><strong>Nb dents min (sans interférence):</strong> ' + nbDentsMin + '</div>';

    analyse.etages.forEach(function (etage, i) {
      if (etage.typeId === 'belt' || etage.typeId === 'worm' || etage.typeId === 'epicyclic') return;
      var interf = GearApp.core.GearMechanics.verifierInterference(etage.dentsMenante, etage.dentsMenee, angleContact);
      var status = interf.interfere ? '<span class="warning">Risque</span>' : '<span class="excellent">OK</span>';
      html += '<div><strong>Étage ' + (i + 1) + ':</strong> ' + status +
        ' (A=' + etage.dentsMenante + (interf.menanteSuffisant ? '✓' : '✗') +
        ', B=' + etage.dentsMenee + (interf.meneeSuffisant ? '✓' : '✗') + ')</div>';
    });

    html += '</div></div>';
    html += '</div>';
    return html;
  };

  MechanicalPanel.prototype._buildGeometryDetails = function (analyse) {
    var openAttr = this._proMode ? ' open' : '';
    var html = '<details' + openAttr + '><summary>Géométrie détaillée</summary><div class="geometry-details">';

    analyse.etages.forEach(function (etage, i) {
      var g = etage.geometrie;
      var typeId = etage.typeId;

      html += '<div class="geom-stage">';
      html += '<h5>Étage ' + (i + 1) + ' — <span class="type-badge ' + typeId + '">' + etage.typeNomCourt + '</span></h5>';
      html += '<div class="geom-grid">';

      if (g.pas) html += '<div><strong>Pas:</strong> ' + g.pas.toFixed(2) + ' mm</div>';
      if (g.entraxe !== null && g.entraxe !== undefined) html += '<div><strong>Entraxe:</strong> ' + g.entraxe.toFixed(2) + ' mm</div>';

      if (typeId === 'spur' || typeId === 'helical' || typeId === 'internal') {
        if (g.diamPrimitiveA) html += '<div><strong>' + etage.labelA + ' - Ø primitif:</strong> ' + g.diamPrimitiveA.toFixed(1) + ' mm</div>';
        if (g.diamTeteA) html += '<div><strong>' + etage.labelA + ' - Ø tête:</strong> ' + g.diamTeteA.toFixed(1) + ' mm</div>';
        if (g.diamPiedA) html += '<div><strong>' + etage.labelA + ' - Ø pied:</strong> ' + g.diamPiedA.toFixed(1) + ' mm</div>';
        if (g.diamBaseA) html += '<div><strong>' + etage.labelA + ' - Ø base:</strong> ' + g.diamBaseA.toFixed(1) + ' mm</div>';
        if (g.diamPrimitiveB) html += '<div><strong>' + etage.labelB + ' - Ø primitif:</strong> ' + g.diamPrimitiveB.toFixed(1) + ' mm</div>';
        if (g.diamTeteB) html += '<div><strong>' + etage.labelB + ' - Ø tête:</strong> ' + g.diamTeteB.toFixed(1) + ' mm</div>';
        if (g.diamPiedB) html += '<div><strong>' + etage.labelB + ' - Ø pied:</strong> ' + g.diamPiedB.toFixed(1) + ' mm</div>';
        if (g.diamBaseB) html += '<div><strong>' + etage.labelB + ' - Ø base:</strong> ' + g.diamBaseB.toFixed(1) + ' mm</div>';
        if (g.angleContact) html += '<div><strong>Angle de pression:</strong> ' + g.angleContact + '°</div>';
        if (typeId === 'helical' && g.angleHelice) html += '<div><strong>Angle hélice:</strong> ' + g.angleHelice + '°</div>';
        if (typeId === 'helical' && g.moduleApparent) html += '<div><strong>Module apparent:</strong> ' + g.moduleApparent.toFixed(3) + ' mm</div>';
        if (typeId === 'helical' && g.pasApparent) html += '<div><strong>Pas apparent:</strong> ' + g.pasApparent.toFixed(2) + ' mm</div>';
      } else if (typeId === 'bevel') {
        if (g.diamPrimitiveA) html += '<div><strong>Pignon Ø primitif:</strong> ' + g.diamPrimitiveA.toFixed(1) + ' mm</div>';
        if (g.diamPrimitiveB) html += '<div><strong>Roue Ø primitif:</strong> ' + g.diamPrimitiveB.toFixed(1) + ' mm</div>';
        if (g.diamTeteA) html += '<div><strong>Pignon Ø tête:</strong> ' + g.diamTeteA.toFixed(1) + ' mm</div>';
        if (g.diamTeteB) html += '<div><strong>Roue Ø tête:</strong> ' + g.diamTeteB.toFixed(1) + ' mm</div>';
        if (g.longueurCone) html += '<div><strong>Longueur cône:</strong> ' + g.longueurCone.toFixed(1) + ' mm</div>';
        if (g.angleCone1) html += '<div><strong>Angle cône pignon:</strong> ' + g.angleCone1.toFixed(1) + '°</div>';
        if (g.angleCone2) html += '<div><strong>Angle cône roue:</strong> ' + g.angleCone2.toFixed(1) + '°</div>';
        if (g.angleAxes) html += '<div><strong>Angle entre axes:</strong> ' + g.angleAxes + '°</div>';
      } else if (typeId === 'belt') {
        if (g.diamPrimitiveA) html += '<div><strong>Ø poulie menante:</strong> ' + g.diamPrimitiveA + ' mm</div>';
        if (g.diamPrimitiveB) html += '<div><strong>Ø poulie menée:</strong> ' + g.diamPrimitiveB + ' mm</div>';
        if (g.longueurCourroie) html += '<div><strong>Longueur courroie:</strong> ' + g.longueurCourroie.toFixed(1) + ' mm</div>';
        if (g.typeCourroie) html += '<div><strong>Type courroie:</strong> ' + g.typeCourroie + '</div>';
        if (g.angleEnroulementA) html += '<div><strong>Angle enroulement A:</strong> ' + g.angleEnroulementA.toFixed(1) + '°</div>';
        if (g.angleEnroulementB) html += '<div><strong>Angle enroulement B:</strong> ' + g.angleEnroulementB.toFixed(1) + '°</div>';
      } else if (typeId === 'epicyclic') {
        if (g.diamPrimitiveSolaire) html += '<div><strong>Ø solaire:</strong> ' + g.diamPrimitiveSolaire.toFixed(1) + ' mm</div>';
        if (g.diamPrimitiveCouronne) html += '<div><strong>Ø couronne:</strong> ' + g.diamPrimitiveCouronne.toFixed(1) + ' mm</div>';
        if (g.diamPrimitiveSatellite) html += '<div><strong>Ø satellite:</strong> ' + g.diamPrimitiveSatellite.toFixed(1) + ' mm</div>';
        if (g.dentsSatellite) html += '<div><strong>Dents satellite:</strong> ' + g.dentsSatellite + '</div>';
        if (g.nbSatellites) html += '<div><strong>Nb satellites:</strong> ' + g.nbSatellites + '</div>';
        if (g.diamExterieur) html += '<div><strong>Ø extérieur:</strong> ' + g.diamExterieur.toFixed(1) + ' mm</div>';
        if (g.config) html += '<div><strong>Configuration:</strong> ' + g.config + '</div>';
      } else if (typeId === 'worm') {
        if (g.diamPrimitiveVis) html += '<div><strong>Ø vis:</strong> ' + g.diamPrimitiveVis.toFixed(1) + ' mm</div>';
        if (g.diamPrimitiveRoue) html += '<div><strong>Ø roue:</strong> ' + g.diamPrimitiveRoue.toFixed(1) + ' mm</div>';
        if (g.nbFilets) html += '<div><strong>Nb filets:</strong> ' + g.nbFilets + '</div>';
        if (g.angleAvance) html += '<div><strong>Angle avance:</strong> ' + g.angleAvance.toFixed(1) + '°</div>';
        if (g.pasAxial) html += '<div><strong>Pas axial:</strong> ' + g.pasAxial.toFixed(2) + ' mm</div>';
        if (g.longueurVis) html += '<div><strong>Longueur vis:</strong> ' + g.longueurVis.toFixed(1) + ' mm</div>';
        html += '<div><strong>Irréversible:</strong> ' + (g.irreversible ? 'Oui' : 'Non') + '</div>';
      }

      html += '</div></div>';
    });

    html += '</div></details>';
    return html;
  };

  GearApp.ui.MechanicalPanel = MechanicalPanel;

})(GearApp);
