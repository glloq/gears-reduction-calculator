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
    if(p.moduleMode!=='automatic')return Number.isFinite(p.module)&&p.module>0?[p.module]:[];
    return STANDARD_MODULES.filter(function(m){return (!p.moduleMin||m>=p.moduleMin)&&(!p.moduleMax||m<=p.moduleMax);});
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
    var opts={inputMin:p.dentMenanteMin||6,inputMax:p.dentMenanteMax||60,outputMin:p.dentMeneeMin||6,outputMax:p.dentMeneeMax||120,reductionOnly:p.allowReductionOnly!==false,typeParameters:typeParameters};
    var candidates=[];
    active.forEach(function(id){var def=Registry.get(id);if(!def)return;def.generateCandidates(opts).forEach(function(stage){
      try{var ratio=def.calculateRatio(stage);if(def.validateConfiguration(stage)&&isFinite(ratio)&&ratio!==0&&Math.abs(ratio)<=def.constraints.maxRatio)candidates.push({stage:stage,ratio:Math.abs(ratio)});else rejections.geometry++;}catch(e){rejections.geometry++;}
    });});
    var maxIterations=Math.max(1,p.maxIterations||500000),target=p.rapportCible,tolerance=p.precisionToleree==null?.1:p.precisionToleree;
    var targetMin=target*(1-tolerance/100),targetMax=target*(1+tolerance/100);
    var minCandidateRatio=candidates.reduce(function(value,item){return Math.min(value,item.ratio);},Infinity);
    var maxCandidateRatio=candidates.reduce(function(value,item){return Math.max(value,item.ratio);},0);
    candidates.sort(function(a,b){return Math.abs(Math.log(a.ratio/target))-Math.abs(Math.log(b.ratio/target));});
    function canReach(ratio,remaining){if(!remaining)return ratio>=targetMin&&ratio<=targetMax;var low=ratio*Math.pow(minCandidateRatio,remaining),high=ratio*Math.pow(maxCandidateRatio,remaining);return low<=targetMax&&high>=targetMin;}
    function evaluate(chain,ratio){
      var error=Math.abs(ratio-target)/target*100;if(error>tolerance){rejections.ratio++;return;}
      var modules=moduleChoices(p),accepted=null,moduleSelection={selected:null,tested:[],rejected:[]};
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
        var def=Registry.get(stage.type),r=item.ratio;tested++;
        try{if(!def.validateConfiguration(stage)){rejections.geometry++;continue;}}catch(e){rejections.geometry++;continue;}
        var next=ratio*r;
        if(!canReach(next,limit-depth-1)){rejections.ratio++;continue;}
        walk(chain.concat([stage]),next,depth+1,limit);
        if(progress&&tested%1000===0)progress({tested:tested,depth:depth+1,currentRatio:next,solutions:found.length,rejections:rejections,elapsedMs:Date.now()-start});
      }
    }
    for(var n=1;n<=(p.maxEtages||4)&&tested<maxIterations;n++){
      walk([],1,0,n);
      if(found.length&&(p.searchMode||'minimumStages')==='minimumStages')break;
    }
    found.sort(compare(p.searchMode||'minimumStages'));
    var stats={tested:tested,rejected:Object.keys(rejections).reduce(function(n,k){return n+rejections[k];},0),rejections:rejections,valid:found.length,elapsedMs:Date.now()-start};if(candidates.length===0)stats.reason='NO_CANDIDATES';
    found.forEach(function(s){s.stats.search=stats;});
    return {solutions:found.slice(0,p.maxSolutions||10),stats:stats};
  }
  return {search:search,compare:compare,mechanicalAssessment:assessment,STANDARD_MODULES:STANDARD_MODULES};
});
