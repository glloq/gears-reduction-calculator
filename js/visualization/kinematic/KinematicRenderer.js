(function(GearApp){
  'use strict';var NS='http://www.w3.org/2000/svg';
  function KinematicRenderer(container,options){this.container=typeof container==='string'?document.getElementById(container):container;this.layoutEngine=new KinematicLayoutEngine();this.projection=(options&&options.projection)||'auto';this.solution=null;this.scale=1;this.tx=0;this.ty=0;}
  KinematicRenderer.prototype.setProjection=function(value){this.projection=value;return this.solution?this.render(this.solution):this;};
  KinematicRenderer.prototype.resetView=function(){this.scale=1;this.tx=0;this.ty=0;this._transform();};
  KinematicRenderer.prototype.exportSVG=function(){return this.svg?GearSvgExport.serialize(this.svg):'';};
  KinematicRenderer.prototype.exportPNG=function(callback){if(!this.svg){callback(null);return;}var data=this.exportSVG(),blob=new Blob([data],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),image=new Image();image.onload=function(){var canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;var context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);canvas.toBlob(callback,'image/png');};image.src=url;};
  KinematicRenderer.prototype._transform=function(){if(this.viewport)this.viewport.setAttribute('transform','translate('+this.tx+' '+this.ty+') scale('+this.scale+')');};
  KinematicRenderer.prototype.render=function(solution){this.solution=solution;var stages=solution.stages||solution,layout=this.layoutEngine.layout(stages,this.projection),svg=document.createElementNS(NS,'svg'),viewport=document.createElementNS(NS,'g'),self=this;svg.setAttribute('viewBox','0 0 '+layout.width+' '+layout.height);svg.setAttribute('tabindex','0');svg.setAttribute('data-projection',layout.projection);svg.classList.add('kinematic-svg');viewport.classList.add('kinematic-viewport');this.viewport=viewport;
    var shaftLayer=KinematicPrimitives.element('g',{class:'kinematic-shaft-layer'}),rpm=Number(solution.inputSpeedRpm),cumulative=1;
    layout.projectedShafts.forEach(function(shaft,index){var vertical=shaft.orientation==='Z'||shaft.orientation==='LINEAR',length=vertical?82:112;shaftLayer.appendChild(KinematicPrimitives.element('line',vertical?{x1:shaft.x,y1:shaft.y-length/2,x2:shaft.x,y2:shaft.y+length/2,class:'kinematic-shaft'}:{x1:shaft.x-length/2,y1:shaft.y,x2:shaft.x+length/2,y2:shaft.y,class:'kinematic-shaft'}));var value=Number.isFinite(rpm)?rpm/cumulative:null,direction=value!=null&&value<0?'↻':'↺';shaftLayer.appendChild(KinematicPrimitives.element('text',{x:shaft.x,y:shaft.y-50,'text-anchor':'middle',class:'shaft-label'},'S'+shaft.id+(value==null?'':' · '+Math.abs(value).toFixed(0)+' rpm '+direction)));var mechanical=solution.mechanical&&solution.mechanical[index];if(mechanical&&Number.isFinite(mechanical.signedRatio||mechanical.ratio))cumulative*=mechanical.signedRatio||mechanical.ratio;});viewport.appendChild(shaftLayer);
    if(layout.nodes.length){var points=[layout.nodes[0].input].concat(layout.nodes.map(function(node){return node.output;}));viewport.appendChild(KinematicPrimitives.element('polyline',{points:points.map(function(point){return point.x+','+point.y;}).join(' '),class:'power-flow',fill:'none',stroke:'currentColor','stroke-width':2,'stroke-dasharray':'7 7'}));}
    layout.nodes.forEach(function(node){var type=node.stage.type||node.stage[2]||'spur',g=document.createElementNS(NS,'g');g.setAttribute('class','kinematic-stage '+type);g.setAttribute('data-stage',node.index);g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label','Étage '+(node.index+1)+' '+type);KinematicPrimitives.draw(type,g,node);var label=KinematicPrimitives.element('text',{x:(node.input.x+node.output.x)/2,y:32,'text-anchor':'middle',class:'stage-label'},'Étage '+(node.index+1)+' · '+type);g.appendChild(label);if(type==='planetary'||type==='epicyclic'){var roles=[['INPUT',node.stage.inputMember||'S','input-role'],['OUTPUT',node.stage.outputMember||'C','output-role'],['FIXED',node.stage.fixed||'R','fixed-role']];roles.forEach(function(role,index){g.appendChild(KinematicPrimitives.element('text',{x:node.input.x,y:node.input.y+78+index*16,'text-anchor':'middle',class:'role-label '+role[2]},role[0]+' '+role[1]));});}var mechanical=solution.mechanical&&solution.mechanical[node.index],metadata;if(type==='rack'){var geometry=node.stage.geometry||mechanical&&mechanical.geometry||{};metadata='pignon '+node.stage.pinionTeeth+' dents · module '+node.stage.parameters.module+' mm · Ø '+geometry.pitchDiameterInput+' mm · course '+geometry.travelPerRevolution+' mm/tr · vitesse '+geometry.linearSpeedMmMin+' mm/min · force '+solution.outputForceN+' N';}else metadata='rapport '+(mechanical&&Number.isFinite(mechanical.ratio)?mechanical.ratio.toFixed(3):'indisponible');var title=KinematicPrimitives.element('title',{},'Étage '+(node.index+1)+' — '+type+' — '+metadata);g.appendChild(title);g.addEventListener('click',function(){self.selectStage(node.index);});g.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();self.selectStage(node.index);}});viewport.appendChild(g);});
    var input=layout.nodes[0]&&layout.nodes[0].input,output=layout.nodes.length&&layout.nodes[layout.nodes.length-1].output;if(input)viewport.appendChild(KinematicPrimitives.element('text',{x:input.x,y:layout.height-18,class:'role-label input-role'},'INPUT'));if(output)viewport.appendChild(KinematicPrimitives.element('text',{x:output.x,y:layout.height-18,class:'role-label output-role'},'OUTPUT'));svg.appendChild(viewport);this._bindPanZoom(svg);this.container.innerHTML='';this.container.appendChild(svg);this.svg=svg;this._transform();this.container.dispatchEvent(new CustomEvent('visualization:renderer',{detail:{renderer:this}}));return this;};
  // Le surlignage de la ligne du panneau mécanique est centralisé dans
  // UIController._syncMechanicalRow (via l'évènement) : source unique pour
  // toutes les vues.
  KinematicRenderer.prototype.selectStage=function(index,silent){if(!this.svg)return;this.svg.querySelectorAll('.kinematic-stage').forEach(function(g){g.classList.toggle('selected',Number(g.dataset.stage)===index);});if(!silent)this.container.dispatchEvent(new CustomEvent('viewer:stage-selected',{detail:{index:index}}));};
  KinematicRenderer.prototype._bindPanZoom=function(svg){var self=this,drag=null;svg.addEventListener('wheel',function(e){e.preventDefault();self.scale=Math.max(.5,Math.min(3,self.scale*(e.deltaY<0?1.1:.9)));self._transform();},{passive:false});svg.addEventListener('pointerdown',function(e){drag={x:e.clientX-self.tx,y:e.clientY-self.ty};svg.setPointerCapture(e.pointerId);});svg.addEventListener('pointermove',function(e){if(drag){self.tx=e.clientX-drag.x;self.ty=e.clientY-drag.y;self._transform();}});svg.addEventListener('pointerup',function(){drag=null;});};
  GearApp.visualization.KinematicRenderer=KinematicRenderer;
  document.addEventListener('DOMContentLoaded',function(){
    var container=document.getElementById('svgContainer');
    var renderer=new KinematicRenderer(container);
    GearApp.visualization.kinematicRenderer=renderer;

    document.addEventListener('click',function(e){
      var current=GearApp.currentSolution;
      var projection=e.target.closest&&e.target.closest('[data-projection]');
      if(projection&&current){
        document.querySelectorAll('[data-projection]').forEach(function(b){
          b.classList.toggle('active',b===projection);
        });
        renderer.setProjection(projection.dataset.projection);
      }
      if(e.target.id==='kinematicReset'){
        renderer.resetView();
      }
    });
  });
})(GearApp);
