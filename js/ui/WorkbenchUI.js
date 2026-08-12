// Progressive-disclosure workbench shell. It enhances the existing DOM while
// deliberately preserving every field id consumed by SearchParams.
(function (GearApp) {
  'use strict';
  var OPTIMIZATION_COPY = {
    minimumStages: 'Recherche la solution valide avec le moins d’étages.',
    precision: 'Priorise l’écart minimal au rapport cible.',
    efficiency: 'Priorise le rendement calculé parmi les solutions valides.',
    compact: 'Priorise l’encombrement calculé parmi les solutions respectant la tolérance.',
    robust: 'Favorise les marges de sécurité en flexion et au contact.',
    manufacturing: 'Favorise les architectures simples à fabriquer.',
    global: 'Équilibre précision, dimensions, rendement, résistance et fabrication.'
  };
  var TYPE_GROUPS = { spur:'gear', helical:'gear', internal:'gear', bevel:'gear', epicyclic:'gear', worm:'gear', belt:'flexible', chain:'flexible', rack:'linear' };
  function el(id) { return document.getElementById(id); }
  function finite(value, digits) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
  function minSafety(solution, key) {
    return (solution.mechanical || []).reduce(function (min, stage) {
      var value = stage[key] && stage[key].safetyFactor;
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
  }
  function WorkbenchUI(eventBus) { this.bus = eventBus; this.solutions = []; this.selected = 0; }
  WorkbenchUI.prototype.init = function () {
    this._prepareOptionalSafety();
    this._buildHeader(); this._enhanceSections(); this._enhanceObjective(); this._enhanceTypes();
    this._enhanceModule(); this._enhanceWeights(); this._enhanceVisualization(); this._enhanceCharts();
    this._bindViewSwitch(); this._bindFormSummary(); this._bindGlobalActions(); this.updateContext(); this.updateSummary();
    var self=this; this.bus.on('solution:selected',function(data){self.selected=data.index;self._markSelected();});
    this.bus.on('search:progress',function(data){var bar=document.querySelector('.sticky-progress');if(bar)bar.style.width=data.percent+'%';});
  };
  WorkbenchUI.prototype._prepareOptionalSafety = function () {
    // These are optional expert constraints. The old hard-coded values made every
    // standard search enforce SF/SH even though those controls were hidden.
    // URL/localStorage restoration runs after Workbench init and can still restore
    // an explicitly saved expert value.
    var bending=el('minimum_bending_safety'), contact=el('minimum_contact_safety');
    if(bending){bending.value='';bending.placeholder='SF min (ex. 1.5)';}
    if(contact){contact.value='';contact.placeholder='SH min (ex. 1.2)';}
  };
  WorkbenchUI.prototype._buildHeader = function () {
    var host=el('workbenchHeaderActions'), mode=el('proModeBtn'), theme=el('themeBtn'), presets=document.querySelector('.presets-section');
    if(mode){mode.removeAttribute('onclick');host.appendChild(mode);} if(presets){var details=document.createElement('details');details.className='preset-action preset-menu';var summary=document.createElement('summary');summary.textContent='Preset';details.append(summary,presets);host.appendChild(details);} if(theme){theme.removeAttribute('onclick');host.appendChild(theme);}
    var share=document.createElement('button');share.className='btn-icon share-action';share.textContent='Partager';share.addEventListener('click',function(){var url=GearApp.models.SearchParams.toURL?GearApp.models.SearchParams.toURL():location.href;if(navigator.clipboard)navigator.clipboard.writeText(url);});host.appendChild(share);
  };
  WorkbenchUI.prototype._enhanceSections = function () {
    var labels=['Objectif','Transmissions','Contraintes','Optimisation','Ingénierie','Fabrication','Durée de vie','Score'], workflowIndex=0;
    document.querySelectorAll('.sidebar>.param-section').forEach(function(section){
      if(section.classList.contains('presets-section')||section.querySelector('.help-section'))return;
      var title=section.querySelector(':scope>h3');if(!title)return;
      var step=workflowIndex++, expertOnly=step>=5, details=document.createElement('details');
      details.className='param-section workflow-details';details.open=step<2||step===3||step===4;
      if(expertOnly)details.classList.add('pro-only');
      var summary=document.createElement('summary');summary.innerHTML='<span class="workflow-step">'+(step+1)+'</span><span>'+(labels[step]||title.textContent)+'</span>'+(expertOnly?'<em>Expert</em>':'');
      var content=document.createElement('div');content.className='workflow-content';while(section.firstChild){if(section.firstChild!==title)content.appendChild(section.firstChild);else section.removeChild(title);}details.append(summary,content);section.replaceWith(details);
    });
    var action=document.querySelector('.search-action-bar'),start=el('startStopBtn');if(action&&start){start.removeAttribute('onclick');action.insertBefore(start,action.querySelector('.progress-container'));}
    var advanced=[el('max_iterations'),el('dent_menante_fixe'),el('dent_menee_fixe')];advanced.forEach(function(input){if(input&&input.previousElementSibling){input.previousElementSibling.classList.add('expert-only');input.classList.add('expert-only');}});
  };
  WorkbenchUI.prototype._enhanceObjective = function () {
    var mode=el('objective_mode'), ratio=el('rapport'), output=el('rpm_sortie_cible'), travel=el('linear_travel_per_rev');
    function wrap(nodes,className){var box=document.createElement('div');box.className='objective-fields '+className;nodes[0].parentNode.insertBefore(box,nodes[0]);nodes.forEach(function(node){if(node)box.appendChild(node);});return box;}
    if(ratio){wrap([ratio.previousElementSibling,ratio],'objective-ratio');}
    if(output){var need=[output.previousElementSibling,output].filter(Boolean);var box=wrap(need,'objective-need');var derived=document.createElement('output');derived.id='derivedRatio';derived.className='derived-ratio';box.appendChild(derived);}
    if(travel){var nodes=Array.from(document.querySelector('.objective-linear-fields').children);wrap(nodes,'objective-linear');document.querySelector('.objective-linear-fields').remove();}
    if(mode)mode.addEventListener('change',this.updateContext.bind(this));[el('vitesse_entree'),output].forEach(function(input){if(input)input.addEventListener('input',function(){var inputRpm=parseFloat(el('vitesse_entree').value),outputRpm=parseFloat(el('rpm_sortie_cible').value),derived=el('derivedRatio');if(derived)derived.textContent='Rapport cible dérivé : '+(inputRpm>0&&outputRpm>0?(inputRpm/outputRpm).toFixed(2):'—')+':1';});});
  };
  WorkbenchUI.prototype.updateContext = function () { var mode=el('objective_mode')?el('objective_mode').value:'ratio',linear=mode==='rotationTranslation';document.querySelectorAll('.objective-fields').forEach(function(group){group.classList.toggle('active',group.classList.contains('objective-'+(linear?'linear':mode)));});document.querySelectorAll('.type-checkbox').forEach(function(cb){var rack=cb.value==='rack';cb.disabled=linear?!rack:rack;cb.checked=linear?rack:(rack?false:cb.checked);cb.closest('.type-option').hidden=linear?!rack:rack;});var output=el('rpm_sortie_cible');if(output)output.dispatchEvent(new Event('input'));document.body.classList.toggle('linear-objective',linear);this.updateSummary(); };
  WorkbenchUI.prototype._enhanceTypes = function () { var grid=document.querySelector('.types-grid');if(!grid)return;var filters=document.createElement('div');filters.className='transmission-filters segmented';filters.innerHTML='<button type="button" class="active" data-filter="all">Toutes</button><button type="button" data-filter="gear">Engrenages</button><button type="button" data-filter="flexible">Flexibles</button><button type="button" data-filter="linear">Linéaires</button>';grid.parentNode.insertBefore(filters,grid);filters.addEventListener('click',function(event){if(!event.target.dataset.filter)return;filters.querySelectorAll('button').forEach(function(b){b.classList.toggle('active',b===event.target);});grid.querySelectorAll('.type-option').forEach(function(card){card.hidden=event.target.dataset.filter!=='all'&&TYPE_GROUPS[card.querySelector('input').value]!==event.target.dataset.filter;});}); };
  WorkbenchUI.prototype._enhanceModule = function () { var select=el('module_mode'),fixed=el('module'),min=el('module_min'),max=el('module_max');if(!select||!fixed)return;fixed.classList.add('module-fixed');if(min)min.classList.add('module-auto');if(max)max.classList.add('module-auto');var update=function(){var automatic=select.value==='automatic';fixed.disabled=automatic;fixed.classList.toggle('hidden',automatic);[min,max].forEach(function(input){if(input)input.classList.toggle('hidden',!automatic);});};select.addEventListener('change',update);update(); };
  WorkbenchUI.prototype._enhanceWeights = function () { document.querySelectorAll('input[type="range"][id^="weight_"]').forEach(function(range){var value=document.createElement('output');value.className='range-value';value.textContent=range.value;range.parentNode.insertBefore(value,range);range.addEventListener('input',function(){value.textContent=range.value;});}); };
  WorkbenchUI.prototype._enhanceVisualization = function () { var controls=document.querySelector('.viz-controls');if(!controls)return;controls.querySelectorAll('[onclick]').forEach(function(button){button.removeAttribute('onclick');});var exports=[['SVG','exporterSVG'],['PNG','exporterPNG'],['JSON','exporterJSON'],['CSV','exporterCSV']],details=document.createElement('details');details.className='export-menu';details.innerHTML='<summary>Export ▾</summary><div></div>';exports.forEach(function(item){var existing=Array.from(controls.querySelectorAll('button')).find(function(b){return b.textContent.trim()===item[0];});if(existing)existing.remove();var button=document.createElement('button');button.textContent=item[0];button.addEventListener('click',function(){if(window.UI&&UI[item[1]])UI[item[1]]();});details.lastChild.appendChild(button);});controls.appendChild(details); };
  WorkbenchUI.prototype._enhanceCharts = function () { var grid=document.querySelector('.charts-grid');if(!grid)return;var tabs=document.createElement('div');tabs.className='chart-tabs';var names=['Rapport','Multicritère','Couple / vitesse','Pertes','Sécurité'];Array.from(grid.children).forEach(function(chart,index){var button=document.createElement('button');button.textContent=names[index];button.classList.toggle('active',index===0);chart.classList.toggle('active',index===0);button.addEventListener('click',function(){tabs.querySelectorAll('button').forEach(function(b){b.classList.remove('active');});grid.querySelectorAll('.chart-container').forEach(function(c){c.classList.remove('active');});button.classList.add('active');chart.classList.add('active');});tabs.appendChild(button);});grid.parentNode.insertBefore(tabs,grid); };
  WorkbenchUI.prototype._bindViewSwitch = function () { var container=el('result-container'),cards=el('cardsViewBtn'),table=el('tableViewBtn');function set(tableMode){container.classList.toggle('results-table-mode',tableMode);cards.classList.toggle('active',!tableMode);table.classList.toggle('active',tableMode);cards.setAttribute('aria-selected',String(!tableMode));table.setAttribute('aria-selected',String(tableMode));}cards.addEventListener('click',function(){set(false);});table.addEventListener('click',function(){set(true);}); };
  WorkbenchUI.prototype._bindFormSummary = function () { var self=this,form=el('sidebar');form.addEventListener('input',function(){self.updateSummary();});form.addEventListener('change',function(){self.updateSummary();var select=el('search_mode'),copy=el('optimizationDescription');if(select&&copy)copy.textContent=OPTIMIZATION_COPY[select.value]||'';});var select=el('search_mode');if(select){var copy=document.createElement('p');copy.id='optimizationDescription';copy.className='field-help';copy.textContent=OPTIMIZATION_COPY[select.value];select.insertAdjacentElement('afterend',copy);} };
  WorkbenchUI.prototype.updateSummary = function () { var ratio=parseFloat(el('rapport').value)||0,mode=el('objective_mode').value;if(mode==='need'){var a=parseFloat(el('vitesse_entree').value),b=parseFloat(el('rpm_sortie_cible').value);if(a>0&&b>0)ratio=a/b;}var types=Array.from(document.querySelectorAll('.type-checkbox:checked')).map(function(c){return c.nextElementSibling.textContent;});var summary=el('configurationSummary');if(summary)summary.innerHTML='<strong>'+finite(ratio,2)+':1</strong><span>± '+el('precision').value+' %</span><span>'+types.join(' · ')+'</span><span>≤ '+el('etages').value+' étages · '+(OPTIMIZATION_COPY[el('search_mode').value]||'')+'</span>'; };
  WorkbenchUI.prototype._bindGlobalActions = function () { var mode=el('proModeBtn'),theme=el('themeBtn'),start=el('startStopBtn'),mobile=el('mobileMenuBtn'),overlay=el('sidebarOverlay');if(mode)mode.addEventListener('click',function(){window.toggleProMode();});if(theme)theme.addEventListener('click',function(){window.toggleTheme();});if(start)start.addEventListener('click',function(){window.lancerRecherche();});if(mobile){mobile.removeAttribute('onclick');mobile.addEventListener('click',function(){window.toggleMobileSidebar();});}if(overlay){overlay.removeAttribute('onclick');overlay.addEventListener('click',function(){window.toggleMobileSidebar();});} };
  WorkbenchUI.prototype.renderSolutions = function (solutions) { this.solutions=solutions||[];this.selected=0;document.body.classList.toggle('has-results',this.solutions.length>0);var host=el('solutionCards'),self=this;host.innerHTML='';this.solutions.slice(0,10).forEach(function(s,index){var tile=document.createElement('article');tile.className='solution-tile'+(index===self.selected?' selected':'');tile.tabIndex=0;tile.setAttribute('aria-label','Sélectionner la solution '+(index+1));var sf=minSafety(s,'bending'),sh=minSafety(s,'contact'),linear=s.mode==='rotationTranslation';var kpis=linear?'<span>Course<strong>'+finite(s.travelPerRevolutionMm,2)+' mm/tr</strong></span><span>Vitesse<strong>'+finite(s.outputLinearSpeedMmMin,0)+' mm/min</strong></span><span>Force<strong>'+finite(s.outputForceN,1)+' N</strong></span><span>Rendement<strong>'+finite(s.efficiency*100,1)+' %</strong></span><span>Diamètre pignon<strong>'+finite(s.dimensions&&s.dimensions.maxDiameter,1)+' mm</strong></span><span>Module<strong>'+finite(s.stats&&s.stats.selectedModule,2)+' mm</strong></span>':'<span>Rapport<strong>'+finite(s.ratio,3)+':1</strong></span><span>Rendement<strong>'+finite(s.efficiency*100,1)+' %</strong></span><span>Dimensions<strong>'+finite(s.dimensions&&s.dimensions.maxDiameter,0)+' mm</strong></span><span>SF / SH<strong>'+finite(sf,2)+' / '+finite(sh,2)+'</strong></span>';tile.innerHTML='<header><b>#'+(index+1)+'</b><span>score '+finite(s.score&&s.score.value,3)+'</span></header><h3>'+s.stages.map(function(x){return x.type;}).join(' → ')+'</h3><div class="tile-kpis">'+kpis+'</div>';function select(){self.selected=index;self.bus.emit('solution:selected',{index:index,solution:s});self._markSelected();}tile.addEventListener('click',select);tile.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});host.appendChild(tile);});this._markSelected(); };
  WorkbenchUI.prototype._markSelected = function () { document.querySelectorAll('.solution-tile').forEach(function(tile,index){tile.classList.toggle('selected',index===this.selected);}.bind(this));document.querySelectorAll('#resultats tr').forEach(function(row,index){row.classList.toggle('selected',index===this.selected);}.bind(this)); };
  GearApp.ui.WorkbenchUI = WorkbenchUI;
})(GearApp);
