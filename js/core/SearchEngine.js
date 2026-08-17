(function(root,factory){
  var common=typeof module==='object'&&module.exports;
  var api=factory(common?require('../transmissions/TransmissionRegistry.js'):root.GearTransmissionRegistry,
    common?require('./Engineering.js'):root.GearEngineering,common?require('./ManufacturingRules.js'):root.ManufacturingRules,
    common?require('./LinearDriveSolver.js'):root.LinearDriveSolver);
  if(common)module.exports=api;else root.GearSearchEngine=api;
})(typeof self!=='undefined'?self:this,function(Registry,Engineering,ManufacturingRules,LinearDriveSolver){
  'use strict';
  var STANDARD_MODULES=[0.3,0.4,0.5,0.6,0.8,1,1.25,1.5,2,2.5,3,4,5];
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function teeth(stage,side){
    if(stage.type==='worm')return side==='input'?stage.wormStarts:stage.wheelTeeth;
    if(stage.type==='planetary')return side==='input'?stage.sunTeeth:stage.ringTeeth;
    return stage[side]&&stage[side].teeth;
  }
  function canonical(stages){return stages.map(function(s){return [s.type,teeth(s,'input'),teeth(s,'output'),s.parameters&&s.parameters.module].join(':');}).join('|');}
  function engineeringOptions(p){return {
    inputSpeedRpm:p.inputSpeedRpm||p.vitesseEntree||1500,inputTorqueNm:p.inputTorqueNm||p.coupleEntree||10,
    inputMaterial:p.inputMaterial||'C45',outputMaterial:p.outputMaterial||'C45',additiveDerating:p.additiveDerating||1,
    weights:p.weights||{},fatigue:p.fatigue,shaft:p.shaft
  };}
  function moduleChoices(p){
    var active=(p.typesActifs||['spur']).filter(function(id){return id!=='rack';});
    if(active.length&&active.every(function(id){var def=Registry.get(id);return def&&def.capabilities&&!def.capabilities.usesModule;}))return [null];
    // Inventaire réel : on ne choisit pas dans les modules normalisés, on
    // choisit parmi ceux qu'on possède.
    var owned=list(p.moduleList);
    if(owned.length)return owned.filter(function(m){return m>0;});
    if(p.moduleMode!=='automatic')return Number.isFinite(p.module)&&p.module>0?[p.module]:[];
    return STANDARD_MODULES.filter(function(m){return (!p.moduleMin||m>=p.moduleMin)&&(!p.moduleMax||m<=p.moduleMax);});
  }
  function list(value){return Array.isArray(value)?value.filter(function(v){return Number.isFinite(v);}):[];}
  /**
   * L'inventaire énumère des NOMBRES DE DENTS de roues possédées. Les filets
   * d'une vis sans fin n'en sont pas une : les compter là exclurait toute vis
   * dès qu'on possède un stock d'engrenages droits.
   */
  function inInventory(stage,inventory){
    var input=teeth(stage,'input'),output=teeth(stage,'output');
    if(stage.type!=='worm'&&input!=null&&inventory.indexOf(input)===-1)return false;
    return !(output!=null&&inventory.indexOf(output)===-1);
  }
  /**
   * Un cran de chaîne imposé par l'utilisateur : familles autorisées, et
   * valeurs épinglées désignées par leur CHEMIN dans l'étage. Le moteur n'a
   * ainsi rien à savoir des familles pour appliquer la contrainte — « 18 dents
   * menantes » et « 2 filets » se filtrent par le même code.
   */
  function read(stage,path){return path.split('.').reduce(function(node,key){return node==null?null:node[key];},stage);}
  function matchesSlot(slot,stage){
    if(!slot)return true;
    if(slot.families&&slot.families.length&&slot.families.indexOf(stage.type)===-1)return false;
    var fields=slot.fields||{},paths=Object.keys(fields);
    for(var i=0;i<paths.length;i++){
      var wanted=fields[paths[i]];
      if(wanted==null||wanted==='')continue;
      var actual=read(stage,paths[i]);
      if(typeof wanted==='number'){if(Number(actual)!==wanted)return false;}
      else if(String(actual)!==String(wanted))return false;
    }
    return true;
  }
  /** Dentures épinglées : la plage balayée doit les contenir, sinon on ne les trouve jamais. */
  function pinnedTeeth(slots){
    var out=[];
    (slots||[]).forEach(function(slot){
      Object.keys((slot&&slot.fields)||{}).forEach(function(path){
        var value=slot.fields[path];
        if(typeof value==='number'&&/teeth|Teeth|Starts/.test(path)&&value>0)out.push(value);
      });
    });
    return out;
  }
  function applyModule(stages,m){stages.forEach(function(s){s.parameters=s.parameters||{};var def=Registry.get(s.type);if(def.capabilities.usesModule&&m!=null)s.parameters.module=m;else if(!def.capabilities.usesModule)delete s.parameters.module;});}
  function assessment(solution){var known=[],coverage='full';solution.mechanical.forEach(function(m){if(m.mechanicalStatus!=='evaluated'||m.bendingStatus!=='evaluated'||m.contactStatus!=='evaluated')coverage=coverage==='full'?'partial':coverage;if(m.mechanicalStatus==='unsupported')coverage='unsupported';if(m.bending&&Number.isFinite(m.bending.safetyFactor))known.push(m.bending.safetyFactor);if(m.contact&&Number.isFinite(m.contact.safetyFactor))known.push(m.contact.safetyFactor);});return {coverage:coverage,minimum:known.length?Math.min.apply(Math,known):null};}
  function manufacturingMetric(solution){return solution.stages.reduce(function(v,s){return v+({spur:1,helical:2,internal:2,bevel:3,worm:3,planetary:4,belt:1,chain:2}[s.type]||3);},0);}
  function compare(mode){return function(a,b){
    if(mode==='minimumStages')return a.stages.length-b.stages.length||a.errorPercent-b.errorPercent;
    if(mode==='efficiency')return b.efficiency-a.efficiency||a.errorPercent-b.errorPercent;
    if(mode==='compact')return (a.dimensions.x*a.dimensions.y*Math.max(1,a.dimensions.z))-(b.dimensions.x*b.dimensions.y*Math.max(1,b.dimensions.z))||a.errorPercent-b.errorPercent;
    if(mode==='robust'){var aa=assessment(a),bb=assessment(b),rank={full:0,partial:1,unsupported:2};return rank[aa.coverage]-rank[bb.coverage]||(bb.minimum||0)-(aa.minimum||0)||a.errorPercent-b.errorPercent;}
    if(mode==='manufacturing')return manufacturingMetric(a)-manufacturingMetric(b)||a.errorPercent-b.errorPercent;
    if(mode==='global')return a.score.value-b.score.value;
    return a.errorPercent-b.errorPercent;
  };}
  function search(p,progress){
    if(p&&p.objectiveMode==='rotationTranslation')return LinearDriveSolver.solve(p,Engineering,ManufacturingRules,progress);
    p=p||{};var tested=0,start=Date.now(),found=[],seen={},rejections={ratio:0,geometry:0,dimensions:0,mechanics:0,manufacturing:0};
    var active=(p.typesActifs||['spur']).filter(function(id){return id!=='rack';}), typeParameters=p.typeParameters||{};
    // Gabarit d'architecture : typeTemplate[d] = types autorisés à la profondeur d
    // (null = libre). Les crans au-delà de la longueur explorée sont ignorés.
    var typeTemplate=(p.typeTemplate||[]).map(function(slot){return slot&&slot.length?slot.map(function(id){return id==='epicyclic'?'planetary':id;}):null;});
    // Chaîne en construction : chaque cran peut imposer sa famille ET ses
    // dentures. Le solveur ne cherche alors QUE les inconnues, au lieu de
    // reparcourir tout l'espace pour retomber sur ce qui était déjà décidé.
    var stageConstraints=(p.stageConstraints||[]).map(function(slot){
      if(!slot)return null;
      var families=slot.families&&slot.families.length?slot.families.map(function(id){return id==='epicyclic'?'planetary':id;}):null;
      return {families:families,fields:slot.fields||{}};
    });
    // La longueur de la chaîne est alors une DÉCISION, pas une inconnue : on
    // n'explore ni plus court ni plus long que ce qui a été construit.
    var exactDepth=stageConstraints.length?stageConstraints.length:null;
    // Une famille imposée qui ne serait pas dans les types actifs ne
    // produirait aucun candidat, et la recherche échouerait sans dire pourquoi.
    stageConstraints.forEach(function(slot){
      (slot&&slot.families||[]).forEach(function(id){if(active.indexOf(id)===-1)active.push(id);});
    });
    var inventory=list(p.teethInventory);
    var opts={inputMin:p.dentMenanteMin||6,inputMax:p.dentMenanteMax||60,outputMin:p.dentMeneeMin||6,outputMax:p.dentMeneeMax||120,reductionOnly:p.allowReductionOnly!==false,typeParameters:typeParameters};
    // Un inventaire ÉLARGIT le balayage à ce qu'il contient : sinon posséder
    // une roue de 80 dents ne servirait à rien tant que la plage s'arrête à 50.
    if(inventory.length){opts.inputMin=Math.min(opts.inputMin,Math.min.apply(Math,inventory));opts.inputMax=Math.max(opts.inputMax,Math.max.apply(Math,inventory));opts.outputMin=Math.min(opts.outputMin,Math.min.apply(Math,inventory));opts.outputMax=Math.max(opts.outputMax,Math.max.apply(Math,inventory));}
    // Même raison pour une denture épinglée : demander « 54 dents menées »
    // alors que la plage s'arrête à 50 ne renvoyait rien, sans expliquer que
    // c'était la plage — et non la denture — qui posait problème.
    var pinned=pinnedTeeth(stageConstraints);
    if(pinned.length){var lowest=Math.min.apply(Math,pinned),highest=Math.max.apply(Math,pinned);
      opts.inputMin=Math.min(opts.inputMin,lowest);opts.inputMax=Math.max(opts.inputMax,highest);
      opts.outputMin=Math.min(opts.outputMin,lowest);opts.outputMax=Math.max(opts.outputMax,highest);}
    var candidates=[];
    active.forEach(function(id){var def=Registry.get(id);if(!def)return;def.generateCandidates(opts).forEach(function(stage){
      if(inventory.length&&!inInventory(stage,inventory)){rejections.geometry++;return;}
      try{var ratio=def.calculateRatio(stage);if(def.validateConfiguration(stage)&&isFinite(ratio)&&ratio!==0&&Math.abs(ratio)<=def.constraints.maxRatio)candidates.push({stage:stage,ratio:Math.abs(ratio)});else rejections.geometry++;}catch(e){rejections.geometry++;}
    });});
    var maxIterations=Math.max(1,p.maxIterations||500000),target=p.rapportCible,tolerance=p.precisionToleree==null?.1:p.precisionToleree;
    var targetMin=target*(1-tolerance/100),targetMax=target*(1+tolerance/100);
    var minCandidateRatio=candidates.reduce(function(value,item){return Math.min(value,item.ratio);},Infinity);
    var maxCandidateRatio=candidates.reduce(function(value,item){return Math.max(value,item.ratio);},0);
    candidates.sort(function(a,b){return Math.abs(Math.log(a.ratio/target))-Math.abs(Math.log(b.ratio/target));});
    function canReach(ratio,remaining){if(!remaining)return ratio>=targetMin&&ratio<=targetMax;var low=ratio*Math.pow(minCandidateRatio,remaining),high=ratio*Math.pow(maxCandidateRatio,remaining);return low<=targetMax&&high>=targetMin;}
    var modules=moduleChoices(p);
    function evaluate(chain,ratio){
      var error=Math.abs(ratio-target)/target*100;if(error>tolerance){rejections.ratio++;return;}
      var accepted=null,moduleSelection={selected:null,tested:[],rejected:[]};
      for(var mi=0;mi<modules.length;mi++){
        var stages=clone(chain),reasons=[];moduleSelection.tested.push(modules[mi]);applyModule(stages,modules[mi]);
        try{
          var solution=Engineering.analyzeSolution(stages,target,engineeringOptions(p));
          var dimensions=Engineering.validateDimensions(solution.dimensions,p.constraints||{});
          if(!dimensions.valid){rejections.dimensions++;continue;}
          if(p.constraints&&p.constraints.minimumEfficiency&&solution.efficiency<p.constraints.minimumEfficiency){rejections.mechanics++;continue;}var minimumBending=p.constraints&&p.constraints.minimumBendingSafety,minimumContact=p.constraints&&p.constraints.minimumContactSafety;solution.mechanical.forEach(function(m){if(minimumBending&&m.bendingStatus!=='evaluated')reasons.push('UNSUPPORTED_BENDING_CHECK');else if(minimumBending&&m.bending.safetyFactor<minimumBending)reasons.push('BENDING_SAFETY_TOO_LOW','bendingSafety');if(minimumContact&&m.contactStatus!=='evaluated')reasons.push('UNSUPPORTED_CONTACT_CHECK');else if(minimumContact&&m.contact.safetyFactor<minimumContact)reasons.push('CONTACT_SAFETY_TOO_LOW','contactSafety');});if(reasons.length){rejections.mechanics++;moduleSelection.rejected.push({module:modules[mi],reasons:Array.from(new Set(reasons))});continue;}
          if(p.constraints&&p.constraints.minimumOutputTorqueNm&&solution.outputTorqueNm<p.constraints.minimumOutputTorqueNm){rejections.mechanics++;continue;}
          if(p.constraints&&p.constraints.minimumOutputSpeedRpm&&solution.outputSpeedRpm<p.constraints.minimumOutputSpeedRpm){rejections.mechanics++;continue;}
          if(p.constraints&&p.constraints.maximumOutputSpeedRpm&&solution.outputSpeedRpm>p.constraints.maximumOutputSpeedRpm){rejections.mechanics++;continue;}
          var manufacturing=ManufacturingRules.validate(solution,p.manufacturing||{});if(!manufacturing.valid){rejections.manufacturing++;continue;}solution.manufacturing=manufacturing;
          moduleSelection.selected=modules[mi];solution.moduleSelection=moduleSelection;solution.stats={moduleMode:p.moduleMode||'fixed',selectedModule:modules[mi]};accepted=solution;break;
        }catch(e){rejections.geometry++;}
      }
      if(accepted){var key=canonical(accepted.stages);if(!seen[key]){seen[key]=true;found.push(accepted);}}
    }
    function walk(chain,ratio,depth,limit){
      if(tested>=maxIterations)return;
      if(depth===limit){evaluate(chain,ratio);return;}
      for(var i=0;i<candidates.length&&tested<maxIterations;i++){
        var item=candidates[i],stage=item.stage;
        if(depth===0&&p.dentMenanteFixe!=null&&teeth(stage,'input')!==p.dentMenanteFixe)continue;
        if(depth===limit-1&&p.dentMeneeFixe!=null&&teeth(stage,'output')!==p.dentMeneeFixe)continue;
        if(typeTemplate[depth]&&typeTemplate[depth].indexOf(stage.type)===-1)continue;
        if(stageConstraints.length&&!matchesSlot(stageConstraints[depth],stage))continue;
        var def=Registry.get(stage.type),r=item.ratio;tested++;
        try{if(!def.validateConfiguration(stage)){rejections.geometry++;continue;}}catch(e){rejections.geometry++;continue;}
        var next=ratio*r;
        if(!canReach(next,limit-depth-1)){rejections.ratio++;continue;}
        walk(chain.concat([stage]),next,depth+1,limit);
        if(progress&&tested%1000===0)progress({tested:tested,depth:depth+1,currentRatio:next,solutions:found.length,rejections:rejections,elapsedMs:Date.now()-start});
      }
    }
    if(exactDepth){
      walk([],1,0,exactDepth);
    }else{
      for(var n=1;n<=(p.maxEtages||4)&&tested<maxIterations;n++){
        walk([],1,0,n);
        if(found.length&&(p.searchMode||'minimumStages')==='minimumStages')break;
      }
    }
    found.sort(compare(p.searchMode||'minimumStages'));
    var stats={tested:tested,rejected:Object.keys(rejections).reduce(function(n,k){return n+rejections[k];},0),rejections:rejections,valid:found.length,elapsedMs:Date.now()-start};if(candidates.length===0)stats.reason='NO_CANDIDATES';else if(modules.length===0)stats.reason='NO_MODULES';
    found.forEach(function(s){s.stats.search=stats;});
    return {solutions:found.slice(0,p.maxSolutions||10),stats:stats};
  }
  return {search:search,compare:compare,mechanicalAssessment:assessment,STANDARD_MODULES:STANDARD_MODULES};
});
