(function(GearApp){
  'use strict';var NS='http://www.w3.org/2000/svg';
  function KinematicRenderer(container,options){this.container=typeof container==='string'?document.getElementById(container):container;this.layoutEngine=new KinematicLayoutEngine();this.projection=(options&&options.projection)||'main';this.solution=null;this.scale=1;this.tx=0;this.ty=0;}
  KinematicRenderer.prototype.setProjection=function(value){this.projection=value;return this.solution?this.render(this.solution):this;};
  KinematicRenderer.prototype.resetView=function(){this.scale=1;this.tx=0;this.ty=0;this._transform();};
  KinematicRenderer.prototype.exportSVG=function(){if(!this.svg)return '';var copy=this.svg.cloneNode(true);copy.setAttribute('xmlns',NS);return new XMLSerializer().serializeToString(copy);};
  KinematicRenderer.prototype.exportPNG=function(callback){if(!this.svg){callback(null);return;}var data=this.exportSVG(),blob=new Blob([data],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),image=new Image();image.onload=function(){var canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;var context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);canvas.toBlob(callback,'image/png');};image.src=url;};
  KinematicRenderer.prototype._transform=function(){if(this.viewport)this.viewport.setAttribute('transform','translate('+this.tx+' '+this.ty+') scale('+this.scale+')');};
  KinematicRenderer.prototype.render=function(solution){this.solution=solution;var stages=solution.stages||solution,layout=this.layoutEngine.layout(stages,this.projection),svg=document.createElementNS(NS,'svg'),viewport=document.createElementNS(NS,'g'),self=this;svg.setAttribute('viewBox','0 0 '+layout.width+' '+layout.height);svg.setAttribute('tabindex','0');svg.classList.add('kinematic-svg');viewport.classList.add('kinematic-viewport');this.viewport=viewport;
    layout.nodes.forEach(function(node){var type=node.stage.type||node.stage[2]||'spur',g=document.createElementNS(NS,'g');g.setAttribute('class','kinematic-stage '+type);g.setAttribute('data-stage',node.index);g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label','Étage '+(node.index+1)+' '+type);KinematicPrimitives.draw(type,g,node);var label=KinematicPrimitives.element('text',{x:(node.input.x+node.output.x)/2,y:32,'text-anchor':'middle',class:'stage-label'},'Étage '+(node.index+1)+' · '+type);g.appendChild(label);if(type==='planetary'||type==='epicyclic')g.appendChild(KinematicPrimitives.element('text',{x:node.input.x,y:node.input.y+76,'text-anchor':'middle',class:'role-label fixed-role'},'FIXED '+(node.stage.fixed||'R')));var mechanical=solution.mechanical&&solution.mechanical[node.index],metadata;if(type==='rack'){var geometry=node.stage.geometry||mechanical&&mechanical.geometry||{};metadata='pignon '+node.stage.pinionTeeth+' dents · module '+node.stage.parameters.module+' mm · Ø '+geometry.pitchDiameterInput+' mm · course '+geometry.travelPerRevolution+' mm/tr · vitesse '+geometry.linearSpeedMmMin+' mm/min · force '+solution.outputForceN+' N';}else metadata='rapport '+(mechanical&&Number.isFinite(mechanical.ratio)?mechanical.ratio.toFixed(3):'indisponible');var title=KinematicPrimitives.element('title',{},'Étage '+(node.index+1)+' — '+type+' — '+metadata);g.appendChild(title);g.addEventListener('click',function(){self.selectStage(node.index);});g.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();self.selectStage(node.index);}});viewport.appendChild(g);});
    var input=layout.nodes[0]&&layout.nodes[0].input,output=layout.nodes.length&&layout.nodes[layout.nodes.length-1].output;if(input)viewport.appendChild(KinematicPrimitives.element('text',{x:input.x,y:layout.height-18,class:'role-label input-role'},'INPUT'));if(output)viewport.appendChild(KinematicPrimitives.element('text',{x:output.x,y:layout.height-18,class:'role-label output-role'},'OUTPUT'));svg.appendChild(viewport);this._bindPanZoom(svg);this.container.innerHTML='';this.container.appendChild(svg);this.svg=svg;this._transform();this.container.dispatchEvent(new CustomEvent('visualization:renderer',{detail:{renderer:this}}));return this;};
  // Le surlignage de la ligne du panneau mécanique est centralisé dans
  // UIController._syncMechanicalRow (via l'évènement) : source unique pour
  // toutes les vues.
  KinematicRenderer.prototype.selectStage=function(index){if(!this.svg)return;this.svg.querySelectorAll('.kinematic-stage').forEach(function(g){g.classList.toggle('selected',Number(g.dataset.stage)===index);});this.container.dispatchEvent(new CustomEvent('kinematic:stage-selected',{detail:{index:index}}));};
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
