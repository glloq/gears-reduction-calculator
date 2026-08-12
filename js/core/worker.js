/* GitHub Pages-safe worker; formulas are imported from the same files as the UI. */
importScripts('../transmissions/TransmissionRegistry.js', 'Engineering.js', 'ManufacturingRules.js', 'LinearDriveSolver.js', 'SearchEngine.js');
self.onmessage=function(event){
  var result=GearSearchEngine.search(event.data,function(s){self.postMessage({type:'progress',iterations:s.tested,maxIterations:event.data.maxIterations,profondeur:s.depth,rapportActuel:s.currentRatio,solutionsCount:s.solutions,rejections:s.rejections,elapsedMs:s.elapsedMs});});
  self.postMessage({type:'done',solutions:result.solutions,solutionModels:result.solutions,totalIterations:result.stats.tested,totalSolutions:result.stats.valid,stats:result.stats});
};
