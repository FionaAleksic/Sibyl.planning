import {useEffect,useState,type FormEvent} from 'react';
import {planningService} from '../services/planningService';
import {entryState,partitionEntries} from '../services/planningTimeline';
import {previewBlockPlan,type BlockImportPreview} from '../services/blockImportPreview';
import {nextTabIndex} from '../services/tabNavigation';
import {errorMessage} from '../../../shared/services/apiClient';
import type {PlanningPlan,PlanningPerson,PlanningPracticum,PlanningBlockPlan,PlanningEntry} from '../../../shared/types';
import {ModuleView,ErrorMessage} from '../../../shared/components/ModuleView';
type Tab='plans'|'blocks'|'practicums'|'roster'|'rollover';
interface Draft {name:string;group_names:string;training_years:string;persons_per_turn:string;slot_priorities:Record<string,string>;interval_value:string;
  interval_unit:string;start_date:string;end_date:string;block_plan_id:string;consider_school:boolean;
  consider_practicum:boolean;exclude_blind:boolean;weekdays_only:boolean}
const empty:Draft={name:'',group_names:'',training_years:'1,2,3',persons_per_turn:'1',slot_priorities:{'1':'primary'},interval_value:'1',
  interval_unit:'week',start_date:'',end_date:'',block_plan_id:'',consider_school:true,consider_practicum:true,exclude_blind:false,weekdays_only:true};
const stringify=(v:unknown)=>v==null?'':String(v);
function draftFrom(plan:PlanningPlan):Draft{
  return {...empty,name:plan.name,group_names:(plan.group_names??[]).join(',')||plan.group_name||'',
    training_years:Array.isArray(plan.training_years)?plan.training_years.join(','):'1,2,3',
    persons_per_turn:String(plan.persons_per_turn??1),
    slot_priorities:plan.slot_priorities&&typeof plan.slot_priorities==='object'&&!Array.isArray(plan.slot_priorities)?
      {...plan.slot_priorities as Record<string,string>}:
      Object.fromEntries(Array.from({length:Number(plan.persons_per_turn??1)},(_,i)=>[String(i+1),'primary'])),
    interval_value:String(plan.interval_value??1),
    interval_unit:String(plan.interval_unit??'week'),start_date:plan.start_date??'',end_date:plan.end_date??'',
    block_plan_id:plan.block_plan_id??'',consider_school:plan.consider_school!==false,
    consider_practicum:plan.consider_practicum!==false,exclude_blind:plan.exclude_blind===true,
    weekdays_only:plan.weekdays_only!==false};
}
function parseDraft(d:Draft):Record<string,unknown>{
  return {name:d.name.trim(),group_names:d.group_names.split(',').map(s=>s.trim()).filter(Boolean),
    training_years:d.training_years.split(',').map(s=>Number(s.trim())).filter(Number.isInteger),
    persons_per_turn:Number(d.persons_per_turn),
    slot_priorities:Object.fromEntries(Array.from({length:Number(d.persons_per_turn)},(_,i)=>
      [String(i+1),d.slot_priorities[String(i+1)]??'primary'])),
    interval_value:Number(d.interval_value),interval_unit:d.interval_unit,
    start_date:d.start_date,end_date:d.end_date,block_plan_id:d.block_plan_id,
    consider_school:d.consider_school,consider_practicum:d.consider_practicum,
    exclude_blind:d.exclude_blind,weekdays_only:d.weekdays_only};
}
export function PlanningPage({isAdmin=false}:{isAdmin?:boolean}){
  const [tab,setTab]=useState<Tab>('plans');const [plans,setPlans]=useState<PlanningPlan[]>([]);
  const [blocks,setBlocks]=useState<PlanningBlockPlan[]>([]);const [practicums,setPracticums]=useState<PlanningPracticum[]>([]);
  const [people,setPeople]=useState<PlanningPerson[]>([]);const [selected,setSelected]=useState<PlanningPlan|null>(null);
  const [log,setLog]=useState<Array<Record<string,unknown>>>([]);const [showLog,setShowLog]=useState(false);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(false);const [draft,setDraft]=useState<Draft>(empty);
  const [practicumForm,setPracticumForm]=useState<PlanningPracticum|null>(null);
  const [blockPreview,setBlockPreview]=useState<BlockImportPreview|null>(null);
  const [rollovers,setRollovers]=useState<Array<Record<string,unknown>>>([]);
  async function load(t:Tab=tab){
    if(t==='plans'){const [p,b,r]=await Promise.all([planningService.list(),planningService.blockPlans(),planningService.roster()]);
      setPlans(p);setBlocks(b);setPeople(r);}
    if(t==='blocks')setBlocks(await planningService.blockPlans());
    if(t==='practicums'){const [p,r]=await Promise.all([planningService.practicums(),planningService.roster()]);setPracticums(p);setPeople(r);}
    if(t==='roster')setPeople(await planningService.roster());
    if(t==='rollover'&&isAdmin)setRollovers(await planningService.rollover());
  }
  useEffect(()=>{let active=true;Promise.all([planningService.list(),planningService.blockPlans(),planningService.roster()])
    .then(([p,b,r])=>{if(active){setPlans(p);setBlocks(b);setPeople(r);}})
    .catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[]);
  async function work(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  function changeTab(t:Tab){setTab(t);void work(()=>load(t));}
  function select(id:string){void work(async()=>{setSelected(await planningService.detail(id));setEditing(false);setShowLog(false);});}
  function beginCreate(){setDraft({...empty,block_plan_id:blocks.find(b=>b.is_usable)?.id??blocks[0]?.id??''});setSelected(null);setEditing(true);}
  function beginEdit(){if(!selected)return;setDraft(draftFrom(selected));setEditing(true);}
  function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!isAdmin)return;
    void work(async()=>{
      const payload=parseDraft(draft);
      const item=selected?await planningService.update(selected.id,payload):await planningService.create(payload);
      setSelected(item);setEditing(false);await load('plans');
    });}
  function remove(){if(!isAdmin||!selected||!window.confirm('Plan „'+selected.name+'“ endgültig löschen?'))return;
    void work(async()=>{await planningService.remove(selected.id);setSelected(null);await load('plans');});}
  function generate(){if(!isAdmin||!selected||!window.confirm('Plan aus dem aktuellen AD-Datenbestand neu berechnen?'))return;
    void work(async()=>{await planningService.generate(selected.id);setSelected(await planningService.detail(selected.id));await load('plans');});}
  function changeEntry(e:PlanningEntry){if(!isAdmin)return;
    const old=e.user_guid??'';const choice=window.prompt('Neue Objekt-GUID (leer = [EMPTY]):',old);
    if(choice===null)return;
    void work(async()=>{await planningService.changeEntry(e.id,choice.trim()||null);
      if(selected)setSelected(await planningService.detail(selected.id));
    });}
  function showHistory(){if(!isAdmin||!selected)return;void work(async()=>{setLog(await planningService.generationLog(selected.id));setShowLog(true);});}
  function importBlock(file:File|null){if(!file||!isAdmin)return;
    setBlockPreview(null);
    void work(async()=>{
      if(file.size>5*1024*1024)throw new Error('JSON-Datei darf höchstens 5 MB groß sein.');
      setBlockPreview(previewBlockPlan(JSON.parse(await file.text()) as unknown));
    });
  }
  function confirmBlockImport(){
    if(!blockPreview||!isAdmin)return;
    void work(async()=>{
      await planningService.importBlockPlan(blockPreview.data);
      setBlockPreview(null);await load('blocks');
    });
  }
  function removeBlock(b:PlanningBlockPlan){if(!isAdmin||!window.confirm('Blockwochenplan '+b.name+' löschen?'))return;
    void work(async()=>{await planningService.removeBlockPlan(b.id);await load('blocks');});}
  function savePracticum(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!practicumForm||!isAdmin)return;
    void work(async()=>{
      const {id,user_guid,start_date,end_date,company,note}=practicumForm;
      const data={user_guid,start_date,end_date,company:company??'',note:note??''};
      if(id)await planningService.updatePracticum(id,data);else await planningService.createPracticum(data);
      setPracticumForm(null);await load('practicums');
    });}
  function removePracticum(p:PlanningPracticum){if(!isAdmin||!window.confirm('Praktikum löschen?'))return;
    void work(async()=>{await planningService.removePracticum(p.id);await load('practicums');});}
  const {current,future,past}=partitionEntries(selected?.entries??[]);
  const tabs:{id:Tab;label:string}[]=[
    {id:'plans',label:'Pläne'},{id:'blocks',label:'Blockwochenpläne'},
    {id:'practicums',label:'Praktika'},{id:'roster',label:'AD-Personen'}
  ];
  if(isAdmin)tabs.push({id:'rollover',label:'Jahreswechsel'});
  function entryTable(entries:PlanningEntry[],heading:string){
    return <section><h3>{heading}</h3><div className="scroll-table"><table><thead><tr>
      <th>Von</th><th>Bis</th><th>Slot</th><th>Zugewiesen</th><th>Status</th>{isAdmin&&<th>Aktion</th>}
    </tr></thead><tbody>{entries.map(e=><tr key={e.id} className={entryState(e)==='current'?'current-row':''}>
      <td>{e.period_start}</td><td>{e.period_end}</td><td>{e.slot_no}</td>
      <td>{e.display_name_snapshot??e.username_snapshot??'[EMPTY]'}</td><td>{e.assignment_state??'–'}</td>
      {isAdmin&&<td><button type="button" disabled={busy} onClick={()=>changeEntry(e)}>Zuweisung ändern</button></td>}
    </tr>)}</tbody></table></div></section>;
  }
  return <ModuleView title="Pläne"><div role="tablist" aria-label="Planungsbereiche" className="tabs"
    onKeyDown={event=>{
      const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(index<0)return;
      const next=nextTabIndex(index,buttons.length,event.key);
      if(next<0)return;
      event.preventDefault();buttons[next]?.focus();buttons[next]?.click();
    }}>
    {tabs.map(t=>
      <button type="button" role="tab" tabIndex={tab===t.id?0:-1}
        aria-selected={tab===t.id} key={t.id} onClick={()=>changeTab(t.id)}>{t.label}</button>)}</div>
    <ErrorMessage message={error}/>
    {tab==='plans'&&<><div className="actions">{isAdmin&&<button disabled={busy} onClick={beginCreate}>Neuen Plan anlegen</button>}
      <button disabled={busy} onClick={()=>void work(()=>load('plans'))}>Aktualisieren</button></div>
      <div className="scroll-table"><table><thead><tr><th>Name</th><th>Gruppe</th><th>Start</th><th>Ende</th></tr></thead>
      <tbody>{plans.map(p=><tr key={p.id}><td><button className="link-button" onClick={()=>select(p.id)}>{p.name}</button></td>
      <td>{p.group_names?.join(', ')??p.group_name??'–'}</td><td>{p.start_date??'–'}</td><td>{p.end_date??'–'}</td></tr>)}</tbody></table></div>
      {editing&&<form className="form-panel" onSubmit={save}><h2>{selected?'Plan bearbeiten':'Plan anlegen'}</h2>
        <div className="fields">
          <label>Planname <input required maxLength={200} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
          <label>Fachrichtungen (Komma-getrennt) <input required value={draft.group_names} onChange={e=>setDraft({...draft,group_names:e.target.value})}/></label>
          <label>Lehrjahre (Komma-getrennt) <input required value={draft.training_years} onChange={e=>setDraft({...draft,training_years:e.target.value})}/></label>
          <label>Personen je Turn <input required type="number" min="1" max="20" value={draft.persons_per_turn}
            onChange={e=>setDraft({...draft,persons_per_turn:e.target.value})}/></label>
          <fieldset className="slot-priorities"><legend>Priorität je Slot</legend>
            <p className="hint">Jeder Slot hat Primär, Sekundär oder Tertiär. Mindestens ein Slot muss Primär bleiben.</p>
            {Array.from({length:Math.max(1,Math.min(20,Number(draft.persons_per_turn)||1))},(_,i)=>String(i+1))
              .map(slot=><label key={slot}>Slot {slot} <select value={draft.slot_priorities[slot]??'primary'}
                onChange={e=>setDraft({...draft,slot_priorities:{...draft.slot_priorities,[slot]:e.target.value}})}>
                <option value="primary">Primär</option><option value="secondary">Sekundär</option>
                <option value="tertiary">Tertiär</option></select></label>)}
          </fieldset>
          <label>Turnus <select value={draft.interval_unit} onChange={e=>setDraft({...draft,interval_unit:e.target.value})}>
            <option value="day">Tage</option><option value="week">Wochen</option><option value="month">Monate</option>
          </select></label>
          <label>Turnuslänge <input required type="number" min="1" value={draft.interval_value}
            onChange={e=>setDraft({...draft,interval_value:e.target.value})}/></label>
          <label>Beginn <input required type="date" value={draft.start_date} onChange={e=>setDraft({...draft,start_date:e.target.value})}/></label>
          <label>Ende <input required type="date" value={draft.end_date} onChange={e=>setDraft({...draft,end_date:e.target.value})}/></label>
          <label>Blockwochenplan <select required value={draft.block_plan_id} onChange={e=>setDraft({...draft,block_plan_id:e.target.value})}>
            <option value="">Bitte wählen</option>{blocks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          {([['consider_school','Schule beachten'],['consider_practicum','Praktika beachten'],['exclude_blind','Blinde ausnehmen'],
            ['weekdays_only','Nur Werktage']] as const).map(([key,label])=><label className="check-field" key={key}>
            <input type="checkbox" checked={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/>{label}</label>)}
        </div>
        <p className="hint">Bei bereits generierten Plänen sind bestimmte Parameter fachlich gesperrt. Der Server prüft dies.</p>
        <div className="actions"><button disabled={busy}>Speichern</button>
          <button type="button" onClick={()=>setEditing(false)}>Abbrechen</button></div></form>}
      {selected&&!editing&&<section className="detail"><h2>{selected.name}</h2><p>{selected.start_date} – {selected.end_date}</p>
        {isAdmin&&<div className="actions"><button disabled={busy} onClick={beginEdit}>Bearbeiten</button>
          <button disabled={busy} onClick={generate}>Generieren / aktualisieren</button>
          <button disabled={busy} onClick={showHistory}>Generierungsprotokoll</button>
          <button disabled={busy} onClick={remove}>Plan löschen</button></div>}
        <p className="hint" role="status">{current.length} aktuell · {future.length} kommende · {past.length} vergangene Einteilung(en).
          Aktuelle Einteilungen stehen zuerst.</p>
        {entryTable(current,'Aktuell eingeteilt')}
        {entryTable(future,'Kommende Einteilungen')}
        {entryTable(past,'Vergangene Einteilungen')}
        {showLog&&<section><h3>Entscheidungsprotokoll</h3><pre className="log-output">{JSON.stringify(log,null,2)}</pre></section>}
      </section>}</>}
    {tab==='blocks'&&<><div className="actions">{isAdmin&&<label className="file-control">JSON auswählen
      <input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void importBlock(e.target.files?.[0]??null);e.target.value='';}}/></label>}</div>
      {isAdmin&&blockPreview&&<section className="form-panel" aria-label="Blockplan-Importvorschau">
        <h2>Vorschau vor dem Import</h2>
        <p><strong>{blockPreview.name}</strong> · Schema {blockPreview.schemaVersion} ·
          {blockPreview.validFrom} bis {blockPreview.validUntil} · {blockPreview.weekCount} Wochen</p>
        <p className="hint">Die vollständige Wochenabdeckung wird beim Import zusätzlich vom Server geprüft.
          Bisher wurden keine Daten gespeichert.</p>
        <div className="actions"><button type="button" disabled={busy} onClick={confirmBlockImport}>Import bestätigen</button>
          <button type="button" onClick={()=>setBlockPreview(null)}>Abbrechen</button></div>
      </section>}
      <table><thead><tr><th>Blockwochenplan</th><th>Schuljahr</th><th>Von</th><th>Bis</th><th>Nutzbar</th></tr></thead>
      <tbody>{blocks.map(b=><tr key={b.id}><td>{b.name} {isAdmin&&<button onClick={()=>removeBlock(b)}>Löschen</button>}</td>
        <td>{b.school_year??'–'}</td><td>{b.valid_from??'–'}</td><td>{b.valid_until??'–'}</td>
        <td>{b.is_usable?'Ja':'Nein'}</td></tr>)}</tbody></table></>}
    {tab==='practicums'&&<><div className="actions">{isAdmin&&<button onClick={()=>setPracticumForm({
      id:'',user_guid:'',start_date:'',end_date:'',company:'',note:''})}>Praktikum anlegen</button>}</div>
      <table><thead><tr><th>Person</th><th>Unternehmen</th><th>Start</th><th>Ende</th>{isAdmin&&<th>Aktion</th>}</tr></thead>
      <tbody>{practicums.map(p=><tr key={p.id}><td>{p.display_name??p.username??p.user_guid}</td><td>{p.company??''}</td>
        <td>{p.start_date}</td><td>{p.end_date}</td>{isAdmin&&<td><button onClick={()=>setPracticumForm({...p})}>Bearbeiten</button>
        <button onClick={()=>removePracticum(p)}>Löschen</button></td>}</tr>)}</tbody></table>
      {practicumForm&&<form className="form-panel" onSubmit={savePracticum}><h3>Praktikum</h3><div className="fields">
        <label>Person <select required value={practicumForm.user_guid} onChange={e=>setPracticumForm({...practicumForm,user_guid:e.target.value})}>
          <option value="">Bitte wählen</option>{people.map(p=><option key={p.object_guid} value={p.object_guid}>{p.display_name} ({p.username})</option>)}</select></label>
        <label>Unternehmen <input required value={practicumForm.company??''} onChange={e=>setPracticumForm({...practicumForm,company:e.target.value})}/></label>
        <label>Von <input required type="date" value={practicumForm.start_date} onChange={e=>setPracticumForm({...practicumForm,start_date:e.target.value})}/></label>
        <label>Bis <input required type="date" value={practicumForm.end_date} onChange={e=>setPracticumForm({...practicumForm,end_date:e.target.value})}/></label>
        <label>Notiz <textarea value={practicumForm.note??''} onChange={e=>setPracticumForm({...practicumForm,note:e.target.value})}/></label>
      </div><div className="actions"><button disabled={busy}>Speichern</button><button type="button" onClick={()=>setPracticumForm(null)}>Abbrechen</button></div>
      </form>}</>}
    {tab==='roster'&&<><div className="actions">{isAdmin&&<button disabled={busy} onClick={()=>void work(async()=>{
      await planningService.syncRoster();await load('roster');})}>Mit AD synchronisieren</button>}</div>
      <table><thead><tr><th>Name</th><th>Benutzer</th><th>Gruppe</th><th>Lehrjahr</th><th>Aktiv</th></tr></thead>
      <tbody>{people.map(p=><tr key={p.object_guid}><td>{p.display_name}</td><td>{p.username}</td>
        <td>{p.group_name??'–'}</td><td>{p.training_year??'–'}</td><td>{p.active?'Ja':'Nein'}</td></tr>)}</tbody></table></>}
    {tab==='rollover'&&isAdmin&&<section aria-label="Jahreswechselstatus">
      <h2>Jahreswechsel – letzte fünf Vorgänge</h2>
      <p className="hint">Diese Ansicht liest ausschließlich den vorhandenen Status-Endpunkt und startet keinen Jahreswechsel.</p>
      <button type="button" disabled={busy} onClick={()=>void work(()=>load('rollover'))}>Status aktualisieren</button>
      <div className="scroll-table"><table><thead><tr><th>Jahr</th><th>Status</th><th>Start</th><th>Ende</th><th>Details</th></tr></thead>
        <tbody>{rollovers.map((r,i)=><tr key={stringify(r.rollover_year)||i}>
          <td>{stringify(r.rollover_year)}</td><td>{stringify(r.status)}</td>
          <td>{stringify(r.started_at)}</td><td>{stringify(r.finished_at)||'–'}</td>
          <td><pre className="log-output">{typeof r.details==='object'?JSON.stringify(r.details,null,2):stringify(r.details)}</pre></td>
        </tr>)}</tbody></table></div>{rollovers.length===0&&<p>Keine Jahreswechsel protokolliert.</p>}
    </section>}
    <p className="hint">{stringify(plans.length)} Pläne · Daten werden über die vorhandenen, zugriffsgeschützten APIs geladen.</p>
  </ModuleView>;
}
