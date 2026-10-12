'use strict';
const $=id=>document.getElementById(id);const node=(tag,t)=>{const e=document.createElement(tag);e.textContent=String(t??'');return e;};
let plans=[],selected=null,generated=[],blocks=[],practica=[];
const today=new Date().toISOString().slice(0,10);
$('start').value=today;
function status(t){$('status').textContent=t;}
function roundRobin(names,rounds){
 if(names.length<3||names.length>100||new Set(names).size!==names.length)
  throw Error('3 bis 100 eindeutige Azubis erforderlich');
 if(!Number.isInteger(rounds)||rounds<1||rounds>100)throw Error('1 bis 100 Runden erlaubt');
 const count=Array.from({length:3},()=>new Array(names.length).fill(0)),cursor=[0,0,0],results=[];
 for(let turn=0;turn<rounds;turn++){
  const used=new Set(),row=[];
  for(let slot=0;slot<3;slot++){
   let min=Infinity;for(let i=0;i<names.length;i++)if(!used.has(i))min=Math.min(min,count[slot][i]);
   let chosen=-1;for(let p=0;p<names.length;p++){
    const i=(cursor[slot]+p)%names.length;
    if(!used.has(i)&&count[slot][i]===min){chosen=i;break;}
   }
   if(chosen<0)throw Error('Keine passende Person gefunden');
   used.add(chosen);count[slot][chosen]++;cursor[slot]=(chosen+1)%names.length;
   row.push(names[chosen]);
  }results.push(row);
 }return results;
}
const daysAfter=(date,amount)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+amount);return d.toISOString().slice(0,10);};
function renderMatrix(){
 $('assignments').replaceChildren();
 generated.forEach((row,i)=>{
  const tr=node('tr','');
  [daysAfter($('start').value,i*Number($('interval').value)),...row].forEach(cell=>tr.append(node('td',cell)));
  $('assignments').append(tr);
 });
}
function drawPlans(){
 $('plans-list').replaceChildren();
 for(const p of plans){const b=node('button',p.value.name+' · '+p.value.group);
  b.className='item'+(p.id===selected?.id?' active':'');b.onclick=()=>openPlan(p);$('plans-list').append(b);}
}
function openPlan(plan){
 selected=plan;
 for(const [id,key] of [['name','name'],['group','group'],['start','start'],['interval','interval'],['turns','turns']])
  $(id).value=plan.value[key];
 $('participants').value=plan.value.participants.join('\n');
 generated=plan.value.assignments||[];renderMatrix();drawPlans();status('Plan v'+plan.version+' geladen.');
}
$('generate').onclick=()=>{
 try{
  const names=$('participants').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  generated=roundRobin(names,Number($('turns').value));renderMatrix();
  status(generated.length+' Einteilungen berechnet. Neue Änderungen mit „Plan speichern“ sichern.');
 }catch(e){status('Berechnung fehlgeschlagen: '+e.message);}
};
$('new').onclick=()=>{selected=null;generated=[];$('name').value='Neuer Plan';$('participants').value='';renderMatrix();drawPlans();status('Neuer Plan angelegt – noch nicht gespeichert.');};
$('save').onclick=async()=>{
 const value={name:$('name').value.trim(),group:$('group').value.trim(),start:$('start').value,
  interval:Number($('interval').value),turns:Number($('turns').value),
  participants:$('participants').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
  assignments:generated};
 if(!value.name||!value.start||!generated.length){status('Bitte Plan benennen und zuerst berechnen.');return;}
 try{
  const r=selected?await SibylBridge.update('plans',selected.id,selected.version,value):
   await SibylBridge.create('plans',value);
  plans=await SibylBridge.list('plans');openPlan(plans.find(p=>p.id===r.id));status('Plan dauerhaft gespeichert · v'+r.version);
 }catch(e){status('Speichern fehlgeschlagen: '+e.message);}
};
$('archive').onclick=async()=>{
 if(!selected||!confirm('Plan archivieren?'))return;
 try{await SibylBridge.archive('plans',selected.id,selected.version);
  plans=await SibylBridge.list('plans');selected=null;generated=[];renderMatrix();drawPlans();status('Plan archiviert.');}
 catch(e){status(e.message);}
};
$('export').onclick=()=>{
 if(!generated.length){status('Bitte zuerst Plan berechnen.');return;}
 let csv='Datum;Primär;Sekundär;Weiterer\n';
 generated.forEach((r,i)=>{
  const fields=[daysAfter($('start').value,i*Number($('interval').value)),...r];
  csv+=fields.map(s=>'"'+String(s).replace(/"/g,'""')+'"').join(';')+'\n';
 });
 const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
 a.download='sibyl-planung.csv';a.click();status('CSV erstellt.');
};
document.querySelectorAll('[data-tab]').forEach(button=>{
 button.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));
  ['plans','blocks','practicums'].forEach(k=>$(k).hidden=k!==button.dataset.tab);
 };
});
async function listSecondary(collection,element){
 const rows=await SibylBridge.list(collection);
 $(element).replaceChildren();
 for(const row of rows){
  const b=node('button',JSON.stringify(row.value));b.className='item';b.onclick=async()=>{
   if(!confirm('Diesen Eintrag archivieren?'))return;
   await SibylBridge.archive(collection,row.id,row.version);await listSecondary(collection,element);
  };$(element).append(b);
 }return rows;
}
$('block-add').onclick=async()=>{
 const value={start:$('block-start').value,end:$('block-end').value,title:$('block-title').value.trim()};
 if(!value.start||!value.end||value.end<value.start||!value.title){status('Schulblock unvollständig.');return;}
 try{await SibylBridge.create('blocks',value);await listSecondary('blocks','block-list');status('Schulblock gespeichert.');}
 catch(e){status(e.message);}
};
$('practice-add').onclick=async()=>{
 const value={start:$('practice-start').value,end:$('practice-end').value,
  user:$('practice-user').value.trim(),place:$('practice-place').value.trim()};
 if(!value.start||!value.end||value.end<value.start||!value.user||!value.place){status('Praktikum unvollständig.');return;}
 try{await SibylBridge.create('practicums',value);await listSecondary('practicums','practice-list');status('Praktikum gespeichert.');}
 catch(e){status(e.message);}
};
Promise.all([SibylBridge.list('plans'),listSecondary('blocks','block-list'),listSecondary('practicums','practice-list')])
 .then(([items])=>{plans=items;if(plans.length)openPlan(plans[0]);else drawPlans();})
 .catch(e=>status('Datenspeicher nicht erreichbar: '+e.message));