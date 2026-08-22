// Vue en lecture seule du résultat du moteur : aucun recalcul mécanique ici.
(function(GearApp){
  // Les codes internes restent des identifiants dans le code et n'atteignent
  // jamais l'écran : un même catalogue les nomme pour tous les panneaux.
  var catalogue = GearSolutionCompliance;
  function MechanicalPanel(id){this._container=document.getElementById(id);}
  function n(v,d){return Number.isFinite(v)?v.toFixed(d==null?2:d):'—';}
  function familyName(type){return GearTransmissionRegistry.familyName(type,'short');}
  function memberName(code){return GearTransmissionRegistry.memberName(code);}

  /**
   * §21 : ce que l'analyse disait d'un planétaire — une ligne « planetary »,
   * un rapport, un rendement — ne permettait pas de le VÉRIFIER. Un train
   * épicycloïdal se contrôle sur trois choses que la table ne portait pas :
   * l'organe bloqué, le rapport de base, et les deux conditions de montage.
   * Le registre les calcule ; le panneau les affiche, il ne recalcule rien.
   */
  function planetaryBlock(solution){
    var rows=(solution.stages||[]).map(function(stage,i){
      if(stage.type!=='planetary'&&stage.type!=='epicyclic')return null;
      var d=GearTransmissionRegistry.planetaryDetails(stage);
      if(!d)return null;
      function verdict(condition){
        var value=Number.isInteger(condition.value)?condition.value:n(condition.value,2);
        return '<td class="'+(condition.satisfied?'':'mechanical-warning')+'">'+value+(condition.satisfied?' ✓':' ✗')+'</td>';
      }
      return '<tr><td>'+(i+1)+'</td><td>'+memberName(d.members.input)+'</td><td>'+memberName(d.members.fixed)+
        '</td><td>'+memberName(d.members.output)+'</td><td>'+n(d.basicRatio,3)+'</td>'+
        verdict(d.coaxial)+verdict(d.assembly)+'<td>'+d.planetCount+'</td></tr>';
    }).filter(Boolean);
    if(!rows.length)return '';
    return '<details><summary>Trains épicycloïdaux — topologie et montage</summary>'+
      '<table class="stages-table"><thead><tr><th>Étage</th><th>Entrée</th><th>Fixe</th><th>Sortie</th>'+
      '<th title="Rapport porte-satellites bloqué : −Zr/Zs">Rapport de base r₀</th>'+
      '<th title="(Zr − Zs)/2 doit être entier">Coaxialité</th>'+
      '<th title="(Zs + Zr)/n doit être entier">Équirépartition</th><th>Satellites</th></tr></thead><tbody>'+
      rows.join('')+'</tbody></table>'+
      '<p class="hint">Relation de Willis : (ωS − ωC) / (ωR − ωC) = r₀, C désignant le porte-satellites. '+
      'C\'est elle qui donne le rapport, et non les seules dentures : à dentures égales, deux organes bloqués '+
      'différents donnent deux rapports différents.</p></details>';
  }
  // Masquer ne suffit pas : ce panneau est une région `aria-live`, et son
  // contenu d'hier resterait lisible par une synthèse vocale — et retrouvable
  // dans le DOM — alors qu'aucune solution n'est sélectionnée.
  MechanicalPanel.prototype.hide=function(){if(!this._container)return;this._container.innerHTML='';this._container.style.display='none';this._container.hidden=true;};
  MechanicalPanel.prototype.show=function(solution,unused,proMode){if(!this._container||!solution||!solution.mechanical)return null;var linear=solution.mode==='rotationTranslation',html='<h3>Analyse mécanique — estimation d’ingénierie</h3><div class="mechanical-summary">'+
    (linear?'<div><strong>Course</strong> '+n(solution.travelPerRevolutionMm,2)+' mm/tr</div><div><strong>Vitesse linéaire</strong> '+n(solution.outputLinearSpeedMmMin,0)+' mm/min</div><div><strong>Effort sortie</strong> '+n(solution.outputForceN,1)+' N</div>':'<div><strong>Rapport</strong> '+n(solution.ratio,4)+'</div><div><strong>RPM</strong> '+n(solution.inputSpeedRpm,0)+' → '+n(solution.outputSpeedRpm,1)+'</div><div><strong>Couple</strong> '+n(solution.inputTorqueNm)+' → '+n(solution.outputTorqueNm)+' N·m</div>')+'<div><strong>Rendement</strong> '+n(solution.efficiency*100,1)+' %</div><div><strong>Puissance</strong> '+n(solution.outputPowerW,0)+' W</div><div><strong>Pertes</strong> '+n(solution.lossPowerW,0)+' W</div><div><strong>Dimensions</strong> '+n(solution.dimensions.length,0)+' × '+n(solution.dimensions.maxDiameter,0)+' × '+n(solution.dimensions.width,0)+' mm</div><div title="Moyenne pondérée des huit critères — écart, taille, pertes, risque mécanique, étages, bruit, fabrication, coût. Plus bas = mieux."><strong>Score global</strong> '+n(solution.score.value,3)+'</div></div>';
    html+='<table class="stages-table"><thead><tr><th>Étage</th><th>Type</th><th>Rapport</th><th>η</th><th>Ft / Fr / Fa (N)</th><th>Lewis simplifié SF</th><th>Hertz simplifié SH</th><th>Conduite</th></tr></thead><tbody>';
    solution.mechanical.forEach(function(m,i){var f=m.forces||{},g=m.geometry||{};html+='<tr id="mechanical-stage-'+i+'"><td>'+(i+1)+'</td><td>'+familyName(m.type)+'</td><td>'+n(m.ratio,3)+'</td><td>'+n(m.efficiency*100,1)+'%</td><td>'+n(f.tangentialN,0)+' / '+n(f.radialN,0)+' / '+n(f.axialN,0)+'</td><td>'+n(m.bending&&m.bending.safetyFactor,2)+'</td><td>'+n(m.contact&&m.contact.safetyFactor,2)+'</td><td>'+n(g.totalContactRatio,2)+'</td></tr>';});html+='</tbody></table>';
    html+=planetaryBlock(solution);
    if(proMode)html+='<details open><summary>Détail du score</summary><pre>'+JSON.stringify(solution.score,null,2)+'</pre></details>';
    if(proMode&&solution.fatigue)html+='<details><summary>Fatigue — estimation d’ingénierie</summary><table class="stages-table"><thead><tr><th>Étage</th><th>Cycles</th><th>Heures</th><th>Facteur usage</th></tr></thead><tbody>'+solution.fatigue.map(function(f,i){return '<tr><td>'+(i+1)+'</td><td>'+n(f.cycles,0)+'</td><td>'+n(f.operatingHours,0)+'</td><td>'+n(f.usageFactor,2)+'</td></tr>';}).join('')+'</tbody></table><p>Estimation de fatigue, non conforme ISO 6336-6.</p></details>';
    if(proMode&&solution.shaft)html+='<details><summary>Arbres — estimation d’ingénierie</summary><table class="stages-table"><thead><tr><th>Étage</th><th>Moment (N·mm)</th><th>Couple (N·mm)</th><th>Ø minimum (mm)</th></tr></thead><tbody>'+solution.shaft.map(function(s,i){return '<tr><td>'+(i+1)+'</td><td>'+n(s&&s.bendingMomentNmm,0)+'</td><td>'+n(s&&s.torqueNmm,0)+'</td><td>'+n(s&&s.minimumDiameterMm,2)+'</td></tr>';}).join('')+'</tbody></table><p>Estimation combinée flexion/torsion.</p></details>';
    // Constructibilité : règles appliquées et sélection du module (mode standard, pas expert)
    if(solution.manufacturing){
      var mf=solution.manufacturing,rules=mf.rules||{};
      var fab='<p>'+(mf.valid?'✓ Règles du procédé « '+(rules.mode||'standard')+' » respectées.':'⚠ Échecs : '+(mf.failures||[]).map(catalogue.label).join(', '))+'</p>';
      fab+='<table class="stages-table"><tbody>';
      if(rules.minimumModule!=null)fab+='<tr><td>Module minimum</td><td>'+rules.minimumModule+' mm</td></tr>';
      if(rules.minimumTeeth!=null)fab+='<tr><td>Dents minimum</td><td>'+rules.minimumTeeth+'</td></tr>';
      if(rules.minimumFaceWidth!=null)fab+='<tr><td>Largeur minimum</td><td>'+rules.minimumFaceWidth+' mm</td></tr>';
      if(rules.printerDiameter!=null)fab+='<tr><td>Ø plateau</td><td>'+rules.printerDiameter+' mm</td></tr>';
      fab+='</tbody></table>';
      (mf.recommendations||[]).forEach(function(rec){if(rec.code==='RECOMMENDED_BACKLASH')fab+='<p>Jeu de denture recommandé : '+rec.valueMm+' mm.</p>';});
      var ms=solution.moduleSelection;
      if(ms&&ms.tested&&ms.tested.length){
        fab+='<p>Modules testés : '+ms.tested.join(', ')+' mm — retenu : '+(ms.selected!=null?ms.selected+' mm':'aucun')+'.</p>';
        (ms.rejected||[]).forEach(function(item){var reasons=(item.reasons||[]).map(catalogue.label).filter(Boolean);if(reasons.length)fab+='<p class="hint">Module '+item.module+' mm rejeté : '+reasons.join(', ')+'.</p>';});
      }
      html+='<details><summary>Fabrication — module &amp; règles</summary>'+fab+'</details>';
    }
    if(solution.warnings.length)html+='<section class="warnings"><h4>Avertissements</h4>'+solution.warnings.map(function(w){var scope=Number.isFinite(w.stageIndex)?'Étage '+(w.stageIndex+1):'Chaîne complète';return '<p class="warning" data-warning="'+w.code+'"'+(Number.isFinite(w.stageIndex)?' data-stage="'+w.stageIndex+'"':'')+'><strong>'+scope+'</strong> — '+(w.message||catalogue.label(w.code))+' <small>'+(w.recommendation||'')+'</small></p>';}).join('')+'</section>';
    this._container.innerHTML=html;
    var title=this._container.querySelector('h3'),summary=this._container.querySelector('.mechanical-summary'),stages=this._container.querySelector('.stages-table');
    var tabs=document.createElement('div');tabs.className='analysis-tabs';tabs.setAttribute('role','tablist');
    var panels=[];
    function addTab(label,node){if(!node)return;var button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','tab');var panel=document.createElement('section');panel.className='analysis-panel';node.parentNode.insertBefore(panel,node);panel.appendChild(node);panels.push(panel);button.addEventListener('click',function(){Array.from(tabs.children).forEach(function(item){item.classList.toggle('active',item===button);item.setAttribute('aria-selected',String(item===button));});panels.forEach(function(item){item.hidden=item!==panel;});});tabs.appendChild(button);}
    addTab('Résumé',summary);addTab('Étages',stages);
    Array.from(this._container.querySelectorAll(':scope>details')).forEach(function(detail){addTab(detail.querySelector('summary').textContent.split('—')[0].trim(),detail);});
    addTab('Avertissements',this._container.querySelector('.warnings'));
    if(title)title.insertAdjacentElement('afterend',tabs);if(tabs.firstElementChild)tabs.firstElementChild.click();
    this._container.hidden=false;this._container.style.display='block';return solution;};
  GearApp.ui.MechanicalPanel=MechanicalPanel;
})(GearApp);
