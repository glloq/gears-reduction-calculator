/* GitHub Pages-safe worker; formulas are imported from the same files as the UI. */
importScripts('../transmissions/TransmissionRegistry.js', 'SearchEngine.js');
self.onmessage=function(event){
  var result=GearSearchEngine.search(event.data,function(s){self.postMessage({type:'progress',iterations:s.tested,maxIterations:event.data.maxIterations,profondeur:s.depth,rapportActuel:0,solutionsCount:s.solutions});});
  self.postMessage({type:'done',solutions:result.solutions.map(function(x){return x.stages.map(GearTransmissionRegistry.toLegacy);}),solutionModels:result.solutions,totalIterations:result.stats.tested,totalSolutions:result.stats.valid,stats:result.stats});
};
