const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function makeForm(overrides={}) {
  const defaults={rapport:'12',val_menante_min:'10',val_menante_max:'30',val_menee_min:'20',val_menee_max:'50',precision:'0.1',etages:'4',max_solutions:'10',max_iterations:'500000',dent_menante_fixe:'',dent_menee_fixe:'',module:'1',vitesse_entree:'1500',couple_entree:'10',objective_mode:'ratio',rpm_sortie_cible:'125',linear_travel_per_rev:'100',search_mode:'minimumStages',module_mode:'fixed',module_min:'',module_max:'',minimum_bending_safety:'',minimum_contact_safety:'',linear_speed_min:'',linear_speed_max:'',linear_force_min:'',rpm_sortie_min:'',rpm_sortie_max:'',minimum_output_torque:'',minimum_efficiency:'',max_diameter:'',max_length:'',max_width:'',input_material:'C45',output_material:'C45',additive_derating:'1',manufacturing_mode:'standard',manufacturing_min_module:'',manufacturing_min_teeth:'',manufacturing_min_width:'',printer_diameter:'',hours_per_day:'8',days_per_year:'250',service_years:'10',load_type:'constant',support_distance:'',shaft_allowable_shear:'80'};
  Object.assign(defaults,overrides);
  const els={}; for(const [id,value] of Object.entries(defaults))els[id]={id,value:String(value),innerText:String(value),checked:false,type:'number',trim(){return this.value.trim();}};
  els.reduction_only={checked:true};els['type-spur']={value:'spur',checked:true};els['type-rack']={value:'rack',checked:false};
  const document={getElementById:id=>els[id]||null,querySelectorAll:selector=>selector==='.type-checkbox:checked'?Object.values(els).filter(e=>e.checked&&(e.value==='spur'||e.value==='rack')):[]};
  const context={GearApp:{models:{}},GearTransmissionRegistry:{parameterDefinitions:{belt:{profile:{type:'text',default:'T2.5'}}},beltPitches:{'T2.5':2.5}},document,console,Blob,URL};
  vm.runInNewContext(fs.readFileSync('js/models/SearchParams.js','utf8'),context);
  return {SearchParams:context.GearApp.models.SearchParams,els};
}

test('ratio, need and linear modes map only relevant constraints',()=>{
  let {SearchParams}=makeForm({linear_force_min:'999',rpm_sortie_min:'100'});let p=SearchParams.fromForm();assert.equal(p.constraints.minimumOutputSpeedRpm,100);assert.equal(p.constraints.minimumOutputForceN,undefined);assert.equal(p.linearTravelPerRevolutionMm,null);
  ({SearchParams}=makeForm({objective_mode:'need',vitesse_entree:'1500',rpm_sortie_cible:'125'}));p=SearchParams.fromForm();assert.equal(p.rapportCible,12);assert.equal(p.validate().valid,true);
  ({SearchParams}=makeForm({objective_mode:'rotationTranslation',linear_force_min:'25',linear_speed_min:'1000',linear_speed_max:'9999',minimum_output_torque:'999'}));p=SearchParams.fromForm();assert.deepEqual(Array.from(p.typesActifs),['rack']);assert.equal(p.rapportCible,null);assert.equal(p.constraints.minimumOutputForceN,25);assert.equal(p.constraints.minimumLinearSpeedMmMin,1000);assert.equal(p.constraints.maximumLinearSpeedMmMin,9999);assert.equal(p.constraints.minimumOutputTorqueNm,undefined);assert.equal(p.validate().valid,true);
});

test('blank SF/SH are null and explicit values are constraints',()=>{let {SearchParams}=makeForm();let p=SearchParams.fromForm();assert.equal(p.constraints.minimumBendingSafety,null);assert.equal(p.constraints.minimumContactSafety,null);({SearchParams}=makeForm({minimum_bending_safety:'1.5',minimum_contact_safety:'1.2'}));p=SearchParams.fromForm();assert.equal(p.constraints.minimumBendingSafety,1.5);assert.equal(p.constraints.minimumContactSafety,1.2);});

test('zero is preserved and invalid ranges are rejected contextually',()=>{let {SearchParams}=makeForm({minimum_efficiency:'0',rpm_sortie_min:'200',rpm_sortie_max:'100'});let p=SearchParams.fromForm();assert.equal(p.constraints.minimumEfficiency,0);assert.equal(p.validate().valid,false);({SearchParams}=makeForm({objective_mode:'rotationTranslation',linear_speed_min:'200',linear_speed_max:'100'}));p=SearchParams.fromForm();assert.equal(p.validate().field,'linear_speed_min');});

test('fixed module is explicit while automatic ignores the fixed value',()=>{let {SearchParams}=makeForm({module:''});let p=SearchParams.fromForm();assert.equal(p.validate().field,'module');({SearchParams}=makeForm({module_mode:'automatic',module:'',module_min:'0.5',module_max:'2'}));p=SearchParams.fromForm();assert.equal(p.validate().valid,true);assert.equal(p.toWorkerParams().moduleMode,'automatic');});
